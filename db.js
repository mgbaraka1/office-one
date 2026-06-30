// ─────────────────────────────────────────────────────────────────────────────
// Data layer — embedded SQLite (zero-config, self-contained)
//
// Uses Node's built-in `node:sqlite` module, which ships *inside* Electron
// (Electron 42 bundles Node 24). That means:
//   • no external database engine to install (no Postgres/MySQL/etc.)
//   • no native module to compile or rebuild — nothing to `npm install` beyond
//     Electron itself
//   • the database file is created automatically on first run
//   • schema + seed data are applied in code at startup
// So a fresh clone "just works": install dependencies, run, done.
//
// One SQLite file holds everything: `cooperation-tools.db` in the app's
// userData folder. On the very first run we transparently import any pre-existing
// JSON data files (from older versions of the app) into the database, WITHOUT
// touching or deleting them — they stay on disk as an untouched safety backup.
// ─────────────────────────────────────────────────────────────────────────────

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs   = require('node:fs');

// ── Lookup catalog categories (see migration 003) ────────────────────────────
// Every bounded category/type/status field is normalized into the `lookup_codes`
// table under one of these category discriminators. The renderer fetches options
// per-category and stores a stable `code` (logic fields) or display `label`
// (company/system/activity) — never a hardcoded string.
const LOOKUP_CATEGORIES = ['COMPANY', 'SYSTEM', 'ACTIVITY_TYPE', 'TIME_TYPE', 'ENTRY_STATUS', 'CURRENCY', 'BILLING_CYCLE', 'PROJECT_STATUS', 'PROJECT_DOCUMENT'];

let db;          // DatabaseSync instance
let userDataDir; // resolved userData folder (backups, db file)
let dbWasNew = false; // true when openConnection created the file this run

// Run a set of writes inside a single transaction (atomic + crash-safe).
// Reentrant: nested tx() calls join the outermost transaction (SQLite has no
// nested BEGIN), so e.g. migration can wrap several saveX() calls as one unit.
let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) { fn(); return; }
  txDepth++;
  db.exec('BEGIN');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { txDepth--; }
}

// Parse JSON text read out of a TEXT column, returning `fallback` (never throwing)
// on any malformed/empty value. Every JSON column read funnels through here.
function safeParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

// ── Typed key/value stores (replaced the single generic `meta` table) ─────────
//   app_settings  — shared application config that should travel with the data
//                   (lookups, default subscription currency)
//   machine_prefs — state tied to THIS machine, never to the data (window bounds)
function kvGet(table, key) {
  const row = db.prepare(`SELECT value FROM ${table} WHERE key = ?`).get(key);
  return row ? row.value : undefined;
}
function kvSet(table, key, value) {
  db.prepare(`INSERT INTO ${table}(key, value) VALUES(?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}
const appGet = (key) => kvGet('app_settings', key);
const appSet = (key, value) => kvSet('app_settings', key, value);
const machineGet = (key) => kvGet('machine_prefs', key);
const machineSet = (key, value) => kvSet('machine_prefs', key, value);

// ── Lookup catalog cache (normalized categories) ──────────────────────────────
// An in-memory snapshot of `lookup_codes`, rebuilt lazily and invalidated on edit.
// Used to resolve a category value → its id on WRITE (accepting either the stable
// `code` or the display `label`), and an id → its code/label on READ.
let lkCache = null;
function lkBuild() {
  const rows = db.prepare(
    'SELECT id, category, code, label, sort_order, is_active FROM lookup_codes ORDER BY category, sort_order, id'
  ).all();
  const byCat = {}, idTo = new Map(), valToId = new Map();
  for (const r of rows) {
    (byCat[r.category] ||= []).push(r);
    idTo.set(r.id, r);
    valToId.set(r.category + '|' + r.code, r.id);
    // a display label resolves too (company/system rows round-trip by label)
    if (!valToId.has(r.category + '|' + r.label)) valToId.set(r.category + '|' + r.label, r.id);
  }
  lkCache = { byCat, idTo, valToId };
}
function lk() { if (!lkCache) lkBuild(); return lkCache; }
function lkInvalidate() { lkCache = null; }
// value may be a stable code OR a display label; '' / null → null (unset).
function lkId(category, value) {
  if (value == null || value === '') return null;
  return lk().valToId.get(category + '|' + value) ?? null;
}
function lkCode(id)  { const r = id == null ? null : lk().idTo.get(id); return r ? r.code  : ''; }
function lkLabel(id) { const r = id == null ? null : lk().idTo.get(id); return r ? r.label : ''; }
// True if `id` is a real lookup row in the given category — used to validate FK ids
// arriving from the renderer (companies multi-select, project system) before storing.
function isLookupId(category, id) {
  if (id == null || id === '') return false;
  const r = lk().idTo.get(Number(id));
  return !!(r && r.category === category);
}
function slugCode(s) { return String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'NA'; }
function uniqueCode(category, base) {
  const exists = db.prepare('SELECT 1 FROM lookup_codes WHERE category = ? AND code = ?');
  let code = base, i = 2;
  while (exists.get(category, code)) code = base + '_' + (i++);
  return code;
}

// ── Boot sequence ─────────────────────────────────────────────────────────────
// Boot is three explicit, sequential steps (called in order from main.js):
//   1. openConnection(dir) — open/create the file, apply connection PRAGMAs
//   2. applyMigrations()   — bring the schema up to the latest version
//   3. runMaintenance()    — best-effort upkeep (backup rotation, dead-table sweep)
// They are deliberately separate so each can fail/log independently and so the
// boot order is obvious at the call site rather than buried inside one function.

// Step 1 — open (or create) the database file and apply connection-level PRAGMAs.
function openConnection(dir) {
  userDataDir = dir;
  const file = path.join(dir, 'cooperation-tools.db');
  dbWasNew = !fs.existsSync(file);

  db = new DatabaseSync(file);            // auto-creates the file if missing
  db.exec('PRAGMA journal_mode = WAL');   // crash-safe writes
  db.exec('PRAGMA synchronous = NORMAL'); // WAL-recommended: durable + fast (only the
                                          //   last txn is at risk on power loss, never corruption)
  db.exec('PRAGMA busy_timeout = 5000');  // wait up to 5s on a lock (backup/PDF window) instead
                                          //   of throwing SQLITE_BUSY
  db.exec('PRAGMA foreign_keys = ON');    // enforce FK constraints on every connection
}

// Step 2 — run every pending versioned migration, in order, exactly once.
// Each migration file in ./migrations exports { version, name, up(db) } and is
// recorded in `schema_migrations` once applied. By default a migration runs
// inside a single transaction; a migration may set `manualTransaction: true` to
// manage its own transaction/PRAGMA sequencing (needed for table rebuilds where
// `PRAGMA foreign_keys` must toggle outside a transaction).
function applyMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
             version    INTEGER PRIMARY KEY,
             name       TEXT NOT NULL,
             applied_at TEXT NOT NULL
           );`);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );

  const dir = path.join(__dirname, 'migrations');
  const migrations = fs.readdirSync(dir)
    .filter(f => /^\d{3}_.*\.js$/.test(f))
    .map(f => require(path.join(dir, f)))
    .sort((a, b) => a.version - b.version);

  const record = db.prepare(
    'INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)'
  );

  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    const run = () => { m.up(db); record.run(m.version, m.name, new Date().toISOString()); };
    if (m.manualTransaction) run();   // migration owns its own tx/PRAGMA sequencing
    else tx(run);
  }
}

// Step 3 — best-effort housekeeping. Never throws; never blocks boot.
function runMaintenance() {
  if (!dbWasNew) rotateBackups();   // snapshot an existing DB before the user touches it
  sweepOrphanProjectFiles();        // drop file folders for projects that no longer exist
}

// Safety net for the deferred file purge: remove any projects/{id}/ folder whose
// project row no longer exists (e.g. a delete whose undo window lapsed while the
// app was closed). Runs once at boot, after backups. Best-effort; never throws.
function sweepOrphanProjectFiles() {
  try {
    const root = projectsRootDir();
    if (!fs.existsSync(root)) return;
    const live = new Set(db.prepare('SELECT id FROM projects').all().map(r => String(r.id)));
    for (const name of fs.readdirSync(root)) {
      if (/^\d+$/.test(name) && !live.has(name)) {
        fs.rmSync(path.join(root, name), { recursive: true, force: true });
      }
    }
  } catch { /* non-critical */ }
}

// Was the database file freshly created this run? (e.g. first launch → show setup)
function isFreshDatabase() {
  return dbWasNew;
}

// Snapshot the current DB into <userData>/backups/, keeping the newest `keep`.
// Best-effort: never blocks startup if it fails.
function rotateBackups(keep = 5) {
  try {
    const dir = path.join(userDataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(dbPath(), path.join(dir, `cooperation-tools-${stamp}.db`));
    const files = fs.readdirSync(dir)
      .filter(f => /^cooperation-tools-.*\.db$/.test(f))
      .sort();   // lexicographic === chronological for this stamp format
    while (files.length > keep) fs.rmSync(path.join(dir, files.shift()), { force: true });
  } catch { /* non-critical */ }
}

// ── Users (authentication) ──────────────────────────────────────────────────
// Row shape: { id, username, password_hash, created_at, is_active }. Password
// hashing/verification lives in auth.js — this layer only stores/reads the hash.
// Counts only ACTIVE accounts: an inactive '__unclaimed__' placeholder (created
// by migration 002 to own pre-existing data) must not count as "a user exists",
// so first-run setup still appears and claims it.
function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_active = 1').get().n;
}

// The inactive placeholder that owns pre-existing data on a database that had
// data before any account was created (see migration 002). null if none.
function getUnclaimedUser() {
  return db.prepare(
    "SELECT id FROM users WHERE is_active = 0 AND username = '__unclaimed__' LIMIT 1"
  ).get() || null;
}

// Turn the placeholder into the real first account, in place, so it keeps owning
// all the data migration 002 assigned to it.
function claimUser(id, username, passwordHash) {
  db.prepare('UPDATE users SET username = ?, password_hash = ?, is_active = 1 WHERE id = ?')
    .run(username, passwordHash, id);
}

function getUserByUsername(username) {
  return db.prepare(
    'SELECT id, username, password_hash, created_at, is_active FROM users WHERE username = ?'
  ).get(username) || null;
}

function getUserById(id) {
  return db.prepare(
    'SELECT id, username, created_at, is_active FROM users WHERE id = ?'
  ).get(id) || null;
}

// Insert a new account and return its generated id. Caller supplies an already
// hashed password. Throws on a duplicate username (UNIQUE constraint).
function createUser(username, passwordHash) {
  const info = db.prepare(
    'INSERT INTO users(username, password_hash, created_at, is_active) VALUES(?, ?, ?, 1)'
  ).run(username, passwordHash, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

// ── Days + entries ──────────────────────────────────────────────────────────
// Storage is normalized: a `days` row (owner + date + employee_name) with child
// `day_entries`. The renderer still works with the shape { name, rows[] } where
// each row is { company, system, natural, time, description, source, status,
// minutes, tags[] } — these functions translate between the two and scope every
// query to the authenticated user (`userId`).

// Stored day_entries row → renderer row shape (note the renamed columns:
// activity_type→natural, time_type→time; minutes null → '' for the UI). `eid` is
// the stable DB id, carried on the row so saveDay can update entries in place
// (per-entry UPSERT) instead of rewriting them.
// Category fields are stored as FK ids into lookup_codes. Display fields
// (company/system/natural) round-trip as their LABEL; logic fields (time/status)
// round-trip as their stable CODE, so the renderer compares codes, never strings.
function entryToRow(e) {
  return {
    eid: e.id,
    company: lkLabel(e.company_id), system: lkLabel(e.system_id),
    natural: lkLabel(e.activity_type_id), time: lkCode(e.time_type_id),
    description: e.description || '', source: e.source || '',
    status: lkCode(e.status_id) || 'IN_PROGRESS',
    minutes: (e.minutes === null || e.minutes === undefined) ? '' : e.minutes,
    tags: safeParse(e.tags, []),
    projectId: e.project_id ?? null,   // linked Project (nullable); rendered as a pill
  };
}

const ENTRY_COLS = 'id, company_id, system_id, activity_type_id, time_type_id, status_id, description, source, minutes, tags, project_id';

// Renderer row → normalized FK column values (the inverse of entryToRow).
function rowToEntry(r) {
  const mins = (r.minutes === '' || r.minutes === null || r.minutes === undefined) ? null : Number(r.minutes);
  return {
    company_id: lkId('COMPANY', r.company), system_id: lkId('SYSTEM', r.system),
    activity_type_id: lkId('ACTIVITY_TYPE', r.natural), time_type_id: lkId('TIME_TYPE', r.time),
    status_id: lkId('ENTRY_STATUS', r.status) ?? lkId('ENTRY_STATUS', 'IN_PROGRESS'),
    description: r.description ?? '', source: r.source ?? '',
    minutes: Number.isFinite(mins) ? mins : null,
    tags: JSON.stringify(Array.isArray(r.tags) ? r.tags : []),
    // Linked Project id (validated against ownership in saveDay; null = unlinked).
    project_id: (r.projectId == null || r.projectId === '') ? null : Number(r.projectId),
  };
}

function getDayRow(userId, dateStr) {
  return db.prepare('SELECT id, employee_name FROM days WHERE user_id = ? AND date = ?')
    .get(userId, dateStr) || null;
}

// Persist one day with a per-entry UPSERT (not a full rewrite):
//   • a row whose `eid` matches an existing entry → UPDATE that entry in place
//   • a new row (no/unknown eid) → INSERT
//   • an existing entry no longer present in the rows → DELETE
// Returns { eids: [...] } — the canonical entry id for each input row, in order,
// so the renderer can adopt the ids of freshly-inserted rows (keeping subsequent
// saves stable). A content-match fallback + a `consumed` guard make the operation
// idempotent and safe under re-saves, duplicates, and cross-day moves even before
// the renderer has reconciled ids.
function saveDay(userId, dateStr, data) {
  const name = data?.name || '';
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const now  = new Date().toISOString();
  const eids = new Array(rows.length).fill(null);

  tx(() => {
    db.prepare(`INSERT INTO days(user_id, date, employee_name, created_at, updated_at)
                VALUES(?, ?, ?, ?, ?)
                ON CONFLICT(user_id, date)
                DO UPDATE SET employee_name = excluded.employee_name, updated_at = excluded.updated_at`)
      .run(userId, dateStr, name, now, now);
    const day = getDayRow(userId, dateStr);

    const existing = db.prepare(
      `SELECT ${ENTRY_COLS} FROM day_entries WHERE day_id = ? ORDER BY sort_order, id`
    ).all(day.id);
    const byId = new Map(existing.map(e => [e.id, e]));
    const consumed = new Set();

    const upd = db.prepare(`UPDATE day_entries SET
      company_id=?, system_id=?, activity_type_id=?, time_type_id=?, status_id=?, description=?, source=?, minutes=?, tags=?, project_id=?, sort_order=?, updated_at=?
      WHERE id=?`);
    const ins = db.prepare(`INSERT INTO day_entries
      (user_id, day_id, company_id, system_id, activity_type_id, time_type_id, status_id, description, source, minutes, tags, project_id, sort_order, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

    const sameContent = (e, n) =>
      e.company_id === n.company_id && e.system_id === n.system_id &&
      e.activity_type_id === n.activity_type_id && e.time_type_id === n.time_type_id &&
      e.status_id === n.status_id && e.description === n.description && e.source === n.source &&
      (e.minutes ?? null) === n.minutes && (e.tags || '[]') === n.tags &&
      (e.project_id ?? null) === n.project_id;

    rows.forEach((r, i) => {
      const n = rowToEntry(r);
      n.project_id = ownedProjectId(userId, n.project_id);   // ignore links to projects the user doesn't own
      let eid = null;
      if (r.eid != null && byId.has(r.eid) && !consumed.has(r.eid)) {
        eid = r.eid;                                   // 1) match by stable id
      } else {
        const m = existing.find(e => !consumed.has(e.id) && sameContent(e, n));
        if (m) eid = m.id;                             // 2) content-match (idempotent re-save)
      }
      if (eid != null) {
        consumed.add(eid);
        upd.run(n.company_id, n.system_id, n.activity_type_id, n.time_type_id, n.status_id, n.description, n.source, n.minutes, n.tags, n.project_id, i, now, eid);
      } else {
        eid = Number(ins.run(userId, day.id, n.company_id, n.system_id, n.activity_type_id, n.time_type_id, n.status_id, n.description, n.source, n.minutes, n.tags, n.project_id, i, now, now).lastInsertRowid);
        consumed.add(eid);
      }
      eids[i] = eid;
    });

    const del = db.prepare('DELETE FROM day_entries WHERE id = ?');
    for (const e of existing) if (!consumed.has(e.id)) del.run(e.id);
  });

  return { eids };
}

function loadDay(userId, dateStr) {
  const day = getDayRow(userId, dateStr);
  if (!day) return null;
  const rows = db.prepare(
    `SELECT ${ENTRY_COLS} FROM day_entries WHERE day_id = ? ORDER BY sort_order, id`
  ).all(day.id).map(entryToRow);
  return { name: day.employee_name, rows };
}

// Only days that actually have entries (avoids phantom "has data" calendar marks
// for an empty day row). Newest first.
function listDays(userId) {
  return db.prepare(
    `SELECT d.date FROM days d
     WHERE d.user_id = ? AND EXISTS (SELECT 1 FROM day_entries e WHERE e.day_id = d.id)
     ORDER BY d.date DESC`
  ).all(userId).map(r => r.date);
}

// All days in [from, to] inclusive, oldest first — two queries total (days, then
// their entries) instead of N round-trips. Returns [{date, name, rows[]}].
function loadDaysRange(userId, from, to) {
  const days = db.prepare(
    'SELECT id, date, employee_name FROM days WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date ASC'
  ).all(userId, from, to);
  if (days.length === 0) return [];

  const byId = new Map(days.map(d => [d.id, { date: d.date, name: d.employee_name, rows: [] }]));
  const placeholders = days.map(() => '?').join(',');
  const entries = db.prepare(
    `SELECT day_id, ${ENTRY_COLS} FROM day_entries WHERE day_id IN (${placeholders}) ORDER BY sort_order, id`
  ).all(...days.map(d => d.id));
  for (const e of entries) { const d = byId.get(e.day_id); if (d) d.rows.push(entryToRow(e)); }
  return days.map(d => byId.get(d.id));
}

// ── Companies / Systems views (read-only rollups over existing day_entries) ───
// Both pages derive their data from the category FK columns already on
// day_entries — no new table or schema change. Entries are grouped by the
// display LABEL (the same value shown everywhere else). `fkCol` is a fixed,
// internal column name (never user input), so interpolating it is injection-safe.
// Every query is scoped to the authenticated `userId`.
function distinctCategory(userId, fkCol) {
  return db.prepare(
    `SELECT lc.label AS name, COUNT(*) AS count
       FROM days d JOIN day_entries e ON e.day_id = d.id
       JOIN lookup_codes lc ON lc.id = e.${fkCol}
      WHERE d.user_id = ?
      GROUP BY lc.label
      ORDER BY lc.label COLLATE NOCASE`
  ).all(userId);
}
function categoryEntries(userId, fkCol, name) {
  return db.prepare(
    `SELECT d.date AS date, e.*
       FROM days d JOIN day_entries e ON e.day_id = d.id
       JOIN lookup_codes lc ON lc.id = e.${fkCol}
      WHERE d.user_id = ? AND lc.label = ?
      ORDER BY d.date DESC, e.sort_order, e.id`
  ).all(userId, name).map(e => ({ date: e.date, ...entryToRow(e) }));
}
function listCompanies(userId)        { return distinctCategory(userId, 'company_id'); }
function listSystems(userId)          { return distinctCategory(userId, 'system_id'); }
function companyEntries(userId, name) { return categoryEntries(userId, 'company_id', name); }
function systemEntries(userId, name)  { return categoryEntries(userId, 'system_id', name); }

// ── Analytics aggregation (computed in SQL, not by shipping rows to the UI) ────
// All rollups the Analytics view needs, scoped to the user:
//   • period [from, to]  → totals + group-by-{company, system, time_type,
//                          activity_type} maps used for KPIs / bars / donuts
//   • span [spanFrom, spanTo] → per-day minute totals (all + Over-Time only) for
//                          the trend line and the activity heatmap
// Returns plain numbers + { key: minutes } maps; the renderer only draws them.
function getAnalytics(userId, from, to, spanFrom, spanTo) {
  const period = [userId, from, to];
  const FROM  = `FROM days d JOIN day_entries e ON e.day_id = d.id`;
  const WHERE = `WHERE d.user_id = ? AND d.date >= ? AND d.date <= ?`;
  const doneId = lkId('ENTRY_STATUS', 'DONE');
  const otId   = lkId('TIME_TYPE', 'OVERTIME');

  const totals = db.prepare(
    `SELECT COALESCE(SUM(e.minutes),0) AS totalMin,
            COUNT(*) AS recordCount,
            SUM(CASE WHEN e.status_id = ? THEN 1 ELSE 0 END) AS doneCount ${FROM} ${WHERE}`
  ).get(doneId, ...period);

  const activeDays = db.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT d.date ${FROM} ${WHERE} GROUP BY d.date HAVING COALESCE(SUM(e.minutes),0) > 0
     )`
  ).get(...period).n;

  const mapOf = (sql) => {
    const m = {};
    for (const r of db.prepare(sql).all(...period)) m[r.k] = r.v;
    return m;
  };
  // company/system/natural keyed by display LABEL (INNER JOIN drops unset FKs).
  const byCompany = mapOf(`SELECT lc.label AS k, COALESCE(SUM(e.minutes),0) AS v ${FROM} JOIN lookup_codes lc ON lc.id = e.company_id ${WHERE} GROUP BY lc.label`);
  const bySystem  = mapOf(`SELECT lc.label AS k, COALESCE(SUM(e.minutes),0) AS v ${FROM} JOIN lookup_codes lc ON lc.id = e.system_id ${WHERE} GROUP BY lc.label`);
  // donuts only count entries with logged minutes.
  const byNatural = mapOf(`SELECT lc.label AS k, SUM(e.minutes) AS v ${FROM} JOIN lookup_codes lc ON lc.id = e.activity_type_id ${WHERE} AND e.minutes > 0 GROUP BY lc.label`);
  // time-type keyed by stable CODE; unset time_type buckets under 'OTHER'.
  const byType    = mapOf(`SELECT COALESCE(lc.code, 'OTHER') AS k, SUM(e.minutes) AS v ${FROM} LEFT JOIN lookup_codes lc ON lc.id = e.time_type_id ${WHERE} AND e.minutes > 0 GROUP BY k`);

  const perDay = (otOnly) => {
    const m = {};
    const sql = `SELECT d.date AS date, COALESCE(SUM(e.minutes),0) AS mins
                 ${FROM} ${WHERE} ${otOnly ? 'AND e.time_type_id = ?' : ''}
                 GROUP BY d.date`;
    const args = otOnly ? [userId, spanFrom, spanTo, otId] : [userId, spanFrom, spanTo];
    for (const r of db.prepare(sql).all(...args)) m[r.date] = r.mins;
    return m;
  };

  return {
    totalMin: totals.totalMin, recordCount: totals.recordCount, doneCount: totals.doneCount || 0,
    activeDays, byCompany, bySystem, byNatural, byType,
    dayMin: perDay(false), dayOtMin: perDay(true),
  };
}

// Overview "now" numbers (today + month-to-date), computed in SQL.
function getOverviewStats(userId, today, monthStart) {
  const t = db.prepare(
    `SELECT COALESCE(SUM(e.minutes),0) AS mins, COUNT(*) AS recs
     FROM days d JOIN day_entries e ON e.day_id = d.id
     WHERE d.user_id = ? AND d.date = ?`
  ).get(userId, today);
  const m = db.prepare(
    `SELECT COALESCE(SUM(e.minutes),0) AS mins, COUNT(DISTINCT d.date) AS days
     FROM days d JOIN day_entries e ON e.day_id = d.id
     WHERE d.user_id = ? AND d.date >= ? AND d.date <= ?`
  ).get(userId, monthStart, today);
  return { todayMin: t.mins, todayRecs: t.recs, monthMin: m.mins, daysLogged: m.days };
}

// ── Backlog ("Not Yet" pool) ────────────────────────────────────────────────────
// A day-agnostic list of tasks. Returns { backlog: [...] }; mirrors the
// subscriptions IPC shape so the renderer treats it the same way.
function loadBacklog(userId) {
  const backlog = db.prepare(
    'SELECT id, company_id, system_id, activity_type_id, time_type_id, description, source, tags, project_id FROM backlog WHERE user_id = ? ORDER BY sort_order'
  ).all(userId).map(t => ({
    id: t.id,
    company: lkLabel(t.company_id), system: lkLabel(t.system_id), natural: lkLabel(t.activity_type_id), time: lkCode(t.time_type_id),
    description: t.description || '', source: t.source || '',
    tags: safeParse(t.tags, []),
    projectId: t.project_id ?? null,   // linked Project (nullable); rendered as a pill
  }));
  return { backlog };
}

// Upsert each task in place and delete only the tasks that were removed — no
// blanket delete-all + reinsert. Scoped to the owner.
function saveBacklog(userId, data) {
  const list = Array.isArray(data?.backlog) ? data.backlog : [];
  tx(() => {
    const keep = new Set(list.map(t => t.id));
    const del = db.prepare('DELETE FROM backlog WHERE id = ? AND user_id = ?');
    for (const row of db.prepare('SELECT id FROM backlog WHERE user_id = ?').all(userId)) {
      if (!keep.has(row.id)) del.run(row.id, userId);
    }
    const up = db.prepare(`INSERT INTO backlog(id, user_id, company_id, system_id, activity_type_id, time_type_id, description, source, tags, project_id, sort_order)
                           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(id) DO UPDATE SET
                             company_id=excluded.company_id, system_id=excluded.system_id,
                             activity_type_id=excluded.activity_type_id, time_type_id=excluded.time_type_id,
                             description=excluded.description, source=excluded.source,
                             tags=excluded.tags, project_id=excluded.project_id, sort_order=excluded.sort_order`);
    list.forEach((t, i) => up.run(
      t.id, userId,
      lkId('COMPANY', t.company), lkId('SYSTEM', t.system),
      lkId('ACTIVITY_TYPE', t.natural), lkId('TIME_TYPE', t.time),
      t.description ?? '', t.source ?? '',
      JSON.stringify(Array.isArray(t.tags) ? t.tags : []),
      ownedProjectId(userId, t.projectId), i
    ));
  });
}

// ── Lookups (normalized catalog — shared app config, not per-user) ────────────
// Options for one category, ordered for dropdowns. Active-only by default; the
// Settings editor passes includeInactive to manage soft-disabled entries.
function getLookupsByCategory(category, includeInactive = false) {
  return (lk().byCat[category] || [])
    .filter(r => includeInactive || r.is_active)
    .map(r => ({ id: r.id, code: r.code, label: r.label, sortOrder: r.sort_order, isActive: !!r.is_active }));
}
// Full catalog (every category, incl. inactive) + the default employee name —
// what the renderer loads once at boot to build all dropdowns.
function loadLookups() {
  const categories = {};
  for (const cat of LOOKUP_CATEGORIES) categories[cat] = getLookupsByCategory(cat, true);
  return { categories, defaultName: appGet('default_employee_name') || '' };
}
// Persist edits from the Settings catalog editor. Existing rows are updated in
// place (label / order / active); new rows get a generated unique code. Entries
// are NEVER hard-deleted — disable via isActive:false (soft-disable). Codes are
// immutable once created (they are the stable identity historical rows point at).
function saveLookups(data) {
  tx(() => {
    if (data && data.categories) {
      const now = new Date().toISOString();
      const upd = db.prepare('UPDATE lookup_codes SET label = ?, sort_order = ?, is_active = ? WHERE id = ?');
      const ins = db.prepare('INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at) VALUES(?,?,?,?,?,?)');
      for (const [cat, list] of Object.entries(data.categories)) {
        if (!LOOKUP_CATEGORIES.includes(cat) || !Array.isArray(list)) continue;
        list.forEach((item, i) => {
          const label = String(item.label ?? '').trim();
          if (!label) return;
          const sort   = Number.isInteger(item.sortOrder) ? item.sortOrder : i;
          const active = item.isActive === false ? 0 : 1;
          if (item.id != null && lk().idTo.has(item.id)) {
            upd.run(label, sort, active, item.id);
          } else {
            const code = uniqueCode(cat, String(item.code || '').trim().toUpperCase() || slugCode(label));
            ins.run(cat, code, label, sort, active, now);
          }
        });
      }
    }
    if (data && typeof data.defaultName === 'string') appSet('default_employee_name', data.defaultName.trim());
  });
  lkInvalidate();
}

// ── Subscriptions ───────────────────────────────────────────────────────────────
// Columns are snake_case in storage; aliased back to the camelCase shape the
// renderer expects. `cost` is a REAL number.
function loadSubscriptions(userId) {
  const subscriptions = db.prepare(
    `SELECT id, name, cost, currency_id, billing_cycle_id,
            end_date AS endDate, renewal_date AS renewalDate
     FROM subscriptions WHERE user_id = ? ORDER BY sort_order`
  ).all(userId).map(s => ({
    id: s.id, name: s.name, cost: s.cost,
    currency: lkCode(s.currency_id) || 'USD',
    billingCycle: lkCode(s.billing_cycle_id) || 'MONTHLY',
    endDate: s.endDate, renewalDate: s.renewalDate,
  }));
  const defaultCurrency = appGet('subscriptions_default_currency') || 'USD';
  return { subscriptions, defaultCurrency };
}
function saveSubscriptions(userId, data) {
  const list = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
  const currency = data?.defaultCurrency || 'USD';
  tx(() => {
    const keep = new Set(list.map(s => s.id));
    const del = db.prepare('DELETE FROM subscriptions WHERE id = ? AND user_id = ?');
    for (const row of db.prepare('SELECT id FROM subscriptions WHERE user_id = ?').all(userId)) {
      if (!keep.has(row.id)) del.run(row.id, userId);
    }
    const up = db.prepare(`INSERT INTO subscriptions(id, user_id, name, cost, currency_id, billing_cycle_id, end_date, renewal_date, sort_order)
                           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(id) DO UPDATE SET
                             name=excluded.name, cost=excluded.cost, currency_id=excluded.currency_id,
                             billing_cycle_id=excluded.billing_cycle_id, end_date=excluded.end_date,
                             renewal_date=excluded.renewal_date, sort_order=excluded.sort_order`);
    list.forEach((s, i) => {
      const cost = Number.parseFloat(String(s.cost ?? '').replace(/[^0-9.]/g, '')) || 0;
      const currencyId = lkId('CURRENCY', s.currency) ?? lkId('CURRENCY', 'USD');
      const cycleId    = lkId('BILLING_CYCLE', s.billingCycle) ?? lkId('BILLING_CYCLE', 'MONTHLY');
      up.run(
        s.id, userId, s.name ?? '', cost, currencyId, cycleId,
        s.endDate || null, s.renewalDate || null, i
      );
    });
    appSet('subscriptions_default_currency', currency);
  });
}

// ── Projects ──────────────────────────────────────────────────────────────────
// A Project is a container for a client/system engagement. It owns a fixed set of
// tracked documents (auto-created on insert) and links to existing tasks — both
// timesheet entries (day_entries) and "Not Yet" backlog tasks — via a nullable
// project_id FK. A project also references one or more COMPANY lookup codes (its
// clients, via the project_companies junction), one or more SYSTEM lookups (via
// the project_systems junction), and a PROJECT_STATUS lookup code (status). Every
// query is scoped to the authenticated owner (`userId`). The tracked document
// types are driven by the PROJECT_DOCUMENT lookup category (manageable in
// Settings); a project_documents row stores availability keyed by the document's
// stable lookup code, created lazily on first toggle.
const DEFAULT_PROJECT_STATUS = 'ACTIVE';

// Allowed upload types for project documents → mime, keyed by lowercase extension
// (no leading dot). Enforced server-side on every upload; the renderer/dialog also
// filters by these. PDF + Word + common web image formats only.
const PROJECT_DOC_TYPES = {
  pdf:  'application/pdf',
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  gif:  'image/gif',
  webp: 'image/webp',
};
const PROJECT_DOC_EXTENSIONS = Object.keys(PROJECT_DOC_TYPES);

// Lowercase extension (no dot) of a path, '' if none.
function fileExt(p) {
  return path.extname(String(p || '')).replace(/^\./, '').toLowerCase();
}

// Resolve a project the caller owns, or null. Used to gate document/link writes.
function ownsProject(userId, projectId) {
  return !!db.prepare('SELECT 1 FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
}

// Return `projectId` when it is a real project the user owns, else null. Used when
// a task carries an inline `projectId` (set from the timesheet/backlog views) to
// never persist a link to a missing or someone else's project.
function ownedProjectId(userId, projectId) {
  if (projectId == null || !Number.isFinite(Number(projectId))) return null;
  return ownsProject(userId, Number(projectId)) ? Number(projectId) : null;
}

// Replace a project's company links with the given lookup ids (COMPANY category).
// Invalid / non-COMPANY / duplicate ids are skipped. Caller wraps this in a tx.
function setProjectCompanies(projectId, companyIds) {
  db.prepare('DELETE FROM project_companies WHERE project_id = ?').run(projectId);
  const ins = db.prepare('INSERT OR IGNORE INTO project_companies(project_id, company_id) VALUES(?, ?)');
  const seen = new Set();
  for (const raw of (Array.isArray(companyIds) ? companyIds : [])) {
    const id = Number(raw);
    if (!Number.isInteger(id) || seen.has(id) || !isLookupId('COMPANY', id)) continue;
    seen.add(id);
    ins.run(projectId, id);
  }
}

// The COMPANY lookups linked to a project, as { id, label } ordered for display.
function projectCompanies(projectId) {
  return db.prepare(
    `SELECT pc.company_id AS id, lc.label AS label
       FROM project_companies pc
       JOIN lookup_codes lc ON lc.id = pc.company_id
      WHERE pc.project_id = ?
      ORDER BY lc.sort_order, lc.label`
  ).all(projectId);
}

// Replace a project's system links with the given lookup ids (SYSTEM category).
// Invalid / non-SYSTEM / duplicate ids are skipped. Caller wraps this in a tx.
// Mirrors setProjectCompanies — a project can span several systems (migration 009).
function setProjectSystems(projectId, systemIds) {
  db.prepare('DELETE FROM project_systems WHERE project_id = ?').run(projectId);
  const ins = db.prepare('INSERT OR IGNORE INTO project_systems(project_id, system_id) VALUES(?, ?)');
  const seen = new Set();
  for (const raw of (Array.isArray(systemIds) ? systemIds : [])) {
    const id = Number(raw);
    if (!Number.isInteger(id) || seen.has(id) || !isLookupId('SYSTEM', id)) continue;
    seen.add(id);
    ins.run(projectId, id);
  }
}

// The SYSTEM lookups linked to a project, as { id, label } ordered for display.
function projectSystems(projectId) {
  return db.prepare(
    `SELECT ps.system_id AS id, lc.label AS label
       FROM project_systems ps
       JOIN lookup_codes lc ON lc.id = ps.system_id
      WHERE ps.project_id = ?
      ORDER BY lc.sort_order, lc.label`
  ).all(projectId);
}

// Insert a project plus its company / system links. Returns the full project
// (profile + tasks + documents). Document availability rows are not created here —
// they are upserted lazily on first toggle; the tracked types come from the
// PROJECT_DOCUMENT lookup catalog (see getProject).
function createProject(userId, data) {
  const now = new Date().toISOString();
  let id;
  tx(() => {
    id = Number(db.prepare(
      `INSERT INTO projects(user_id, name, description, status, created_at)
       VALUES(?, ?, ?, ?, ?)`
    ).run(userId, data?.name ?? '', data?.description ?? '',
          data?.status || DEFAULT_PROJECT_STATUS, now).lastInsertRowid);
    setProjectCompanies(id, data?.companyIds);
    setProjectSystems(id, data?.systemIds);
  });
  return getProject(userId, id);
}

// All of the user's projects with a linked-task count (entries + backlog), newest
// first — the list view's payload.
function listProjects(userId) {
  return db.prepare(
    `SELECT p.id, p.name, p.description, p.status,
            p.created_at AS createdAt,
            (SELECT COUNT(*) FROM day_entries e WHERE e.project_id = p.id)
          + (SELECT COUNT(*) FROM backlog b WHERE b.project_id = p.id) AS taskCount
       FROM projects p
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC, p.id DESC`
  ).all(userId).map(p => ({
    ...p,
    companies: projectCompanies(p.id),
    systems: projectSystems(p.id),
  }));
}

// One project in full: profile + linked tasks (timesheet entries, each with its
// day's date, and backlog tasks) + the three document statuses. null if not owned.
function getProject(userId, id) {
  const p = db.prepare(
    `SELECT id, name, description, status, created_at AS createdAt
       FROM projects WHERE id = ? AND user_id = ?`
  ).get(id, userId);
  if (!p) return null;

  const entries = db.prepare(
    `SELECT d.date AS date, e.* FROM day_entries e
       JOIN days d ON d.id = e.day_id
      WHERE e.project_id = ? AND e.user_id = ?
      ORDER BY d.date DESC, e.sort_order, e.id`
  ).all(id, userId).map(e => ({ kind: 'entry', date: e.date, ...entryToRow(e) }));

  const backlog = db.prepare(
    `SELECT id, company_id, system_id, activity_type_id, time_type_id, description, source, tags
       FROM backlog WHERE project_id = ? AND user_id = ? ORDER BY sort_order`
  ).all(id, userId).map(t => ({
    kind: 'backlog', id: t.id,
    company: lkLabel(t.company_id), system: lkLabel(t.system_id),
    natural: lkLabel(t.activity_type_id), time: lkCode(t.time_type_id),
    description: t.description || '', source: t.source || '',
    tags: safeParse(t.tags, []),
  }));

  // Tracked documents = the active PROJECT_DOCUMENT lookups (ordered), each merged
  // with this project's stored row. `documentType` is the stable lookup code;
  // `label` is the human name. A document is "available" iff it has a stored file;
  // `file` carries the on-disk metadata (or null) and a computed `exists` flag so
  // the UI can surface a "file missing on disk" state without trusting the DB.
  const rowByCode = new Map(
    db.prepare(
      `SELECT document_type, is_available, file_path, original_name, file_size, mime_type, uploaded_at
         FROM project_documents WHERE project_id = ?`
    ).all(id).map(r => [r.document_type, r])
  );
  const documents = getLookupsByCategory('PROJECT_DOCUMENT', false).map(o => {
    const r = rowByCode.get(o.code);
    const hasFile = !!r?.file_path;
    const file = hasFile ? {
      path: r.file_path,
      originalName: r.original_name || '',
      size: r.file_size || 0,
      mimeType: r.mime_type || '',
      uploadedAt: r.uploaded_at || '',
      exists: fs.existsSync(path.join(userDataDir, r.file_path)),
    } : null;
    return { documentType: o.code, label: o.label, isAvailable: hasFile, file };
  });

  return { ...p, companies: projectCompanies(id), systems: projectSystems(id), tasks: { entries, backlog }, documents };
}

// Update a project's profile fields in place (documents/links untouched). Returns
// the refreshed project, or null if the caller doesn't own it.
function updateProject(userId, id, data) {
  if (!ownsProject(userId, id)) return null;
  tx(() => {
    db.prepare(
      `UPDATE projects SET name = ?, description = ?, status = ?
        WHERE id = ? AND user_id = ?`
    ).run(data?.name ?? '', data?.description ?? '',
          data?.status || DEFAULT_PROJECT_STATUS, id, userId);
    setProjectCompanies(id, data?.companyIds);
    setProjectSystems(id, data?.systemIds);
  });
  return getProject(userId, id);
}

// Delete a project. ON DELETE CASCADE drops its document rows; ON DELETE SET NULL
// unlinks (but never deletes) any linked timesheet/backlog tasks. The project's
// file folder is intentionally NOT removed here — it must survive the renderer's
// 5 s undo window, and is purged either when that window lapses (purgeProjectFiles)
// or by the boot-time orphan sweep (sweepOrphanProjectFiles) as a safety net.
function deleteProject(userId, id) {
  tx(() => {
    db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId);
  });
  return { ok: true };
}

// ── Project document FILES (Option A: bytes on disk, metadata in SQLite) ──────
// Files live at <userData>/projects/{projectId}/documents/{docType}-{ts}.{ext};
// only the relative path + metadata is stored. All paths are constrained to the
// project's own folder (projectId is coerced to an integer), so a renderer can
// never reach outside the data root.

// Copy a chosen file into the project's documents folder and record its metadata.
// Validates ownership, the document code, and the extension allowlist. If a file
// already exists for this (project, type) it is a REPLACE: the new file is written
// first, then the old one removed (best-effort). Returns { ok, project } | { ok:false, error }.
function saveProjectDocumentFile(userId, projectId, documentType, srcPath) {
  if (!ownsProject(userId, projectId)) return { ok: false, error: 'Project not found' };
  if (lkId('PROJECT_DOCUMENT', documentType) == null) return { ok: false, error: 'Unknown document type' };
  const ext = fileExt(srcPath);
  if (!PROJECT_DOC_EXTENSIONS.includes(ext)) {
    return { ok: false, error: `Unsupported file type (.${ext || '?'}). Allowed: ${PROJECT_DOC_EXTENSIONS.join(', ')}` };
  }
  let size;
  try { size = fs.statSync(srcPath).size; }
  catch { return { ok: false, error: 'Could not read the selected file' }; }

  // Prior file (for the replace case) — capture before we overwrite the row.
  const prev = db.prepare('SELECT file_path FROM project_documents WHERE project_id = ? AND document_type = ?')
    .get(projectId, documentType);

  // {docType}-{timestamp}.{ext} — the timestamp makes duplicate filenames impossible.
  const relPath = path.join('projects', String(projectId), 'documents', `${documentType}-${Date.now()}.${ext}`);
  const absPath = path.join(userDataDir, relPath);
  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.copyFileSync(srcPath, absPath);
  } catch (err) {
    return { ok: false, error: 'Could not save the file: ' + String(err?.message || err) };
  }

  try {
    db.prepare(
      `INSERT INTO project_documents(project_id, document_type, is_available, file_path, original_name, file_size, mime_type, uploaded_at)
       VALUES(?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, document_type) DO UPDATE SET
         is_available = 1, file_path = excluded.file_path, original_name = excluded.original_name,
         file_size = excluded.file_size, mime_type = excluded.mime_type, uploaded_at = excluded.uploaded_at`
    ).run(projectId, documentType, relPath, path.basename(srcPath), size, PROJECT_DOC_TYPES[ext], new Date().toISOString());
  } catch (err) {
    // Metadata write failed — don't leave the just-copied orphan on disk.
    try { fs.rmSync(absPath, { force: true }); } catch { /* best effort */ }
    return { ok: false, error: 'Could not record the file: ' + String(err?.message || err) };
  }

  // Replace succeeded — remove the superseded file (best-effort; never blocks).
  if (prev?.file_path && prev.file_path !== relPath) {
    try { fs.rmSync(path.join(userDataDir, prev.file_path), { force: true }); } catch { /* best effort */ }
  }
  return { ok: true, project: getProject(userId, projectId) };
}

// Resolve the absolute on-disk path of a stored document (for download / open),
// after an ownership check. `exists` reflects whether the file is actually present.
function resolveProjectDocumentFile(userId, projectId, documentType) {
  if (!ownsProject(userId, projectId)) return { ok: false, error: 'Project not found' };
  const r = db.prepare('SELECT file_path, original_name FROM project_documents WHERE project_id = ? AND document_type = ?')
    .get(projectId, documentType);
  if (!r?.file_path) return { ok: false, error: 'No file for this document' };
  const absPath = path.join(userDataDir, r.file_path);
  return { ok: true, absPath, originalName: r.original_name || path.basename(r.file_path), exists: fs.existsSync(absPath) };
}

// Remove a document's file from disk and clear its metadata (keeps the row so the
// slot stays listed, just back to "not available"). Best-effort on the unlink.
function removeProjectDocumentFile(userId, projectId, documentType) {
  if (!ownsProject(userId, projectId)) return { ok: false, error: 'Project not found' };
  const r = db.prepare('SELECT file_path FROM project_documents WHERE project_id = ? AND document_type = ?')
    .get(projectId, documentType);
  if (r?.file_path) {
    try { fs.rmSync(path.join(userDataDir, r.file_path), { force: true }); } catch { /* best effort */ }
  }
  db.prepare(
    `UPDATE project_documents
        SET is_available = 0, file_path = NULL, original_name = NULL, file_size = NULL, mime_type = NULL, uploaded_at = NULL
      WHERE project_id = ? AND document_type = ?`
  ).run(projectId, documentType);
  return { ok: true, project: getProject(userId, projectId) };
}

// Delete a project's ENTIRE file folder (projects/{id}/ — not just documents/, so
// future sibling file types go too). Called when the delete undo-window lapses.
// No ownership check is possible (the row is already gone); the id is coerced to
// an integer so the path can only ever resolve inside the data root.
function purgeProjectFiles(projectId) {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false };
  try { fs.rmSync(projectDir(id), { recursive: true, force: true }); } catch { /* best effort */ }
  return { ok: true };
}

// Undo a delete: the project was re-created under a NEW id, so move its file
// folder oldId → newId and re-insert each file's metadata (the old rows were
// CASCADE-deleted). `fileDocs` is the snapshot's documents that had a file:
// [{ documentType, file:{ path, originalName, size, mimeType, uploadedAt } }].
function restoreProjectFiles(userId, oldProjectId, newProjectId, fileDocs) {
  if (!ownsProject(userId, newProjectId)) return { ok: false, error: 'Project not found' };
  const oldDir = projectDir(Number(oldProjectId));
  const newDir = projectDir(Number(newProjectId));
  // SQLite reuses the highest deleted rowid, so undoing the delete of the newest
  // project re-creates it under the SAME id — the folder is already in place and
  // must NOT be moved/cleared. Only relocate when the id actually changed.
  if (path.resolve(oldDir) !== path.resolve(newDir)) {
    try {
      if (fs.existsSync(oldDir)) {
        fs.mkdirSync(path.dirname(newDir), { recursive: true });
        fs.rmSync(newDir, { recursive: true, force: true }); // freshly created project has no files
        fs.renameSync(oldDir, newDir);
      }
    } catch { /* fall through — re-insert what metadata we can */ }
  }

  const ins = db.prepare(
    `INSERT INTO project_documents(project_id, document_type, is_available, file_path, original_name, file_size, mime_type, uploaded_at)
     VALUES(?, ?, 1, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, document_type) DO UPDATE SET
       is_available = 1, file_path = excluded.file_path, original_name = excluded.original_name,
       file_size = excluded.file_size, mime_type = excluded.mime_type, uploaded_at = excluded.uploaded_at`
  );
  for (const d of (Array.isArray(fileDocs) ? fileDocs : [])) {
    if (!d?.file?.path || lkId('PROJECT_DOCUMENT', d.documentType) == null) continue;
    // Re-home the relative path onto the new id (same basename, new folder).
    const relPath = path.join('projects', String(Number(newProjectId)), 'documents', path.basename(d.file.path));
    if (!fs.existsSync(path.join(userDataDir, relPath))) continue; // file didn't survive — skip
    ins.run(newProjectId, d.documentType, relPath, d.file.originalName || path.basename(relPath),
            d.file.size || 0, d.file.mimeType || PROJECT_DOC_TYPES[fileExt(relPath)] || '', d.file.uploadedAt || new Date().toISOString());
  }
  return { ok: true, project: getProject(userId, newProjectId) };
}

// Link / unlink an existing task to a project. `kind` selects the table and is
// validated to a fixed set (injection-safe). Linking verifies project ownership;
// the task UPDATE is scoped to the owner so a user can only touch their own rows.
function projectTaskTable(kind) {
  return kind === 'backlog' ? 'backlog' : 'day_entries';   // default: timesheet entry
}
function linkTask(userId, projectId, kind, taskId) {
  if (!ownsProject(userId, projectId)) return { ok: false, error: 'project not found' };
  db.prepare(`UPDATE ${projectTaskTable(kind)} SET project_id = ? WHERE id = ? AND user_id = ?`)
    .run(projectId, taskId, userId);
  return { ok: true };
}
function unlinkTask(userId, kind, taskId) {
  db.prepare(`UPDATE ${projectTaskTable(kind)} SET project_id = NULL WHERE id = ? AND user_id = ?`)
    .run(taskId, userId);
  return { ok: true };
}

// Tasks not yet linked to ANY project, for the "link an existing task" picker:
// the day-agnostic backlog pool plus every timesheet entry (with its date). Both
// scoped to the owner. Kept read-only; the UI links via linkTask.
function listLinkableTasks(userId) {
  const entries = db.prepare(
    `SELECT d.date AS date, e.* FROM day_entries e
       JOIN days d ON d.id = e.day_id
      WHERE e.user_id = ? AND e.project_id IS NULL
      ORDER BY d.date DESC, e.sort_order, e.id`
  ).all(userId).map(e => ({ kind: 'entry', date: e.date, ...entryToRow(e) }));

  const backlog = db.prepare(
    `SELECT id, company_id, system_id, activity_type_id, time_type_id, description, source, tags
       FROM backlog WHERE user_id = ? AND project_id IS NULL ORDER BY sort_order`
  ).all(userId).map(t => ({
    kind: 'backlog', id: t.id,
    company: lkLabel(t.company_id), system: lkLabel(t.system_id),
    natural: lkLabel(t.activity_type_id), time: lkCode(t.time_type_id),
    description: t.description || '', source: t.source || '',
    tags: safeParse(t.tags, []),
  }));

  return { entries, backlog };
}

// ── Window prefs (this machine only) ──────────────────────────────────────────
function loadPrefs() {
  const v = machineGet('window_prefs');
  return v ? safeParse(v, {}) : {};
}
function savePrefs(prefs) {
  try { machineSet('window_prefs', JSON.stringify(prefs)); } catch { /* non-critical */ }
}

// ── Lifecycle / backup ──────────────────────────────────────────────────────
// Checkpoint the WAL into the main DB file and close the handle cleanly. Called
// on app quit so we don't leave a large -wal file behind.
function close() {
  if (!db) return;
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
  try { db.close(); } catch { /* already closing */ }
  db = undefined;
}

// Copy the live database to `destPath`. Checkpoints first so the single .db file
// is complete and self-contained (no need to also copy -wal/-shm).
function backup(destPath) {
  if (!db) throw new Error('database not open');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(path.join(userDataDir, 'cooperation-tools.db'), destPath);
}

function dbPath() {
  return path.join(userDataDir, 'cooperation-tools.db');
}

// ── Project file storage (Option A: files on disk, metadata in SQLite) ────────
// Uploaded project documents live under the SAME userData root as the DB, nested
// per project so future project-scoped file types (attachments, exports) can sit
// alongside `documents/` rather than under it. These helpers only RESOLVE paths —
// they create/copy/delete nothing (that lands in Phase 2).
//   projectsRootDir()      -> <userData>/projects
//   projectDir(id)         -> <userData>/projects/{id}
//   projectDocumentsDir(id)-> <userData>/projects/{id}/documents
function projectsRootDir() {
  return path.join(userDataDir, 'projects');
}
function projectDir(projectId) {
  return path.join(projectsRootDir(), String(projectId));
}
function projectDocumentsDir(projectId) {
  return path.join(projectDir(projectId), 'documents');
}

module.exports = {
  openConnection, applyMigrations, runMaintenance, isFreshDatabase,
  close, backup, dbPath,
  projectsRootDir, projectDir, projectDocumentsDir,
  countUsers, getUserByUsername, getUserById, createUser, getUnclaimedUser, claimUser,
  saveDay, loadDay, listDays, loadDaysRange,
  listCompanies, listSystems, companyEntries, systemEntries,
  getAnalytics, getOverviewStats,
  loadBacklog, saveBacklog,
  createProject, listProjects, getProject, updateProject, deleteProject,
  linkTask, unlinkTask, listLinkableTasks,
  saveProjectDocumentFile, resolveProjectDocumentFile, removeProjectDocumentFile,
  purgeProjectFiles, restoreProjectFiles,
  loadLookups, saveLookups, getLookupsByCategory,
  loadSubscriptions, saveSubscriptions,
  loadPrefs, savePrefs,
};
