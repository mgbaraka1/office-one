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
const LOOKUP_CATEGORIES = ['COMPANY', 'SYSTEM', 'ACTIVITY_TYPE', 'TIME_TYPE', 'ENTRY_STATUS', 'CURRENCY', 'BILLING_CYCLE'];

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
  };
}

const ENTRY_COLS = 'id, company_id, system_id, activity_type_id, time_type_id, status_id, description, source, minutes, tags';

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
      company_id=?, system_id=?, activity_type_id=?, time_type_id=?, status_id=?, description=?, source=?, minutes=?, tags=?, sort_order=?, updated_at=?
      WHERE id=?`);
    const ins = db.prepare(`INSERT INTO day_entries
      (user_id, day_id, company_id, system_id, activity_type_id, time_type_id, status_id, description, source, minutes, tags, sort_order, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

    const sameContent = (e, n) =>
      e.company_id === n.company_id && e.system_id === n.system_id &&
      e.activity_type_id === n.activity_type_id && e.time_type_id === n.time_type_id &&
      e.status_id === n.status_id && e.description === n.description && e.source === n.source &&
      (e.minutes ?? null) === n.minutes && (e.tags || '[]') === n.tags;

    rows.forEach((r, i) => {
      const n = rowToEntry(r);
      let eid = null;
      if (r.eid != null && byId.has(r.eid) && !consumed.has(r.eid)) {
        eid = r.eid;                                   // 1) match by stable id
      } else {
        const m = existing.find(e => !consumed.has(e.id) && sameContent(e, n));
        if (m) eid = m.id;                             // 2) content-match (idempotent re-save)
      }
      if (eid != null) {
        consumed.add(eid);
        upd.run(n.company_id, n.system_id, n.activity_type_id, n.time_type_id, n.status_id, n.description, n.source, n.minutes, n.tags, i, now, eid);
      } else {
        eid = Number(ins.run(userId, day.id, n.company_id, n.system_id, n.activity_type_id, n.time_type_id, n.status_id, n.description, n.source, n.minutes, n.tags, i, now, now).lastInsertRowid);
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
    'SELECT id, company_id, system_id, activity_type_id, time_type_id, description, source, tags FROM backlog WHERE user_id = ? ORDER BY sort_order'
  ).all(userId).map(t => ({
    id: t.id,
    company: lkLabel(t.company_id), system: lkLabel(t.system_id), natural: lkLabel(t.activity_type_id), time: lkCode(t.time_type_id),
    description: t.description || '', source: t.source || '',
    tags: safeParse(t.tags, []),
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
    const up = db.prepare(`INSERT INTO backlog(id, user_id, company_id, system_id, activity_type_id, time_type_id, description, source, tags, sort_order)
                           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(id) DO UPDATE SET
                             company_id=excluded.company_id, system_id=excluded.system_id,
                             activity_type_id=excluded.activity_type_id, time_type_id=excluded.time_type_id,
                             description=excluded.description, source=excluded.source,
                             tags=excluded.tags, sort_order=excluded.sort_order`);
    list.forEach((t, i) => up.run(
      t.id, userId,
      lkId('COMPANY', t.company), lkId('SYSTEM', t.system),
      lkId('ACTIVITY_TYPE', t.natural), lkId('TIME_TYPE', t.time),
      t.description ?? '', t.source ?? '',
      JSON.stringify(Array.isArray(t.tags) ? t.tags : []), i
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

module.exports = {
  openConnection, applyMigrations, runMaintenance, isFreshDatabase,
  close, backup, dbPath,
  countUsers, getUserByUsername, getUserById, createUser, getUnclaimedUser, claimUser,
  saveDay, loadDay, listDays, loadDaysRange,
  listCompanies, listSystems, companyEntries, systemEntries,
  getAnalytics, getOverviewStats,
  loadBacklog, saveBacklog,
  loadLookups, saveLookups, getLookupsByCategory,
  loadSubscriptions, saveSubscriptions,
  loadPrefs, savePrefs,
};
