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
const LOOKUP_CATEGORIES = ['COMPANY', 'SYSTEM', 'ACTIVITY_TYPE', 'TIME_TYPE', 'ENTRY_STATUS', 'CURRENCY', 'BILLING_CYCLE', 'PROJECT_STATUS', 'PROJECT_DOCUMENT', 'COMPANY_DOCUMENT_CATEGORY', 'DEPARTMENT', 'PROJECT_CATEGORY', 'TASK_SOURCE_TYPE'];

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
  const projectIds = sweepOrphanProjectFiles();        // drop file folders for projects that no longer exist
  const companyDocumentIds = sweepOrphanCompanyDocumentFiles(); // same, for company_documents/{id}/ folders
  _lastOrphanSweepReport = { projectIds, companyDocumentIds, ranAt: new Date().toISOString() };
  try { encryptAllPendingCredentials(); } catch { /* best-effort — never blocks boot */ }
}

// Safety net for the deferred file purge: remove any projects/{id}/ folder whose
// project row no longer exists (e.g. a delete whose undo window lapsed while the
// app was closed). Runs once at boot, after backups. Best-effort; never throws.
// Milestone 6 — the sweeps below used to run silently (no return value, no
// record of what they found). Each now returns the list of removed folder
// names, and runMaintenance() stashes both lists here so the Settings ->
// Maintenance tab can show what the most recent boot's sweep actually did,
// instead of it only ever happening invisibly. In-memory only (resets each
// process launch) — a sweep's result is only meaningful for "what happened
// this boot", and by the time it's viewed the orphans are already gone, so
// there's nothing left to persist or re-scan.
let _lastOrphanSweepReport = { projectIds: [], companyDocumentIds: [], ranAt: null };
function getOrphanSweepReport() { return _lastOrphanSweepReport; }

function sweepOrphanProjectFiles() {
  const removed = [];
  try {
    const root = projectsRootDir();
    if (!fs.existsSync(root)) return removed;
    const live = new Set(db.prepare('SELECT id FROM projects').all().map(r => String(r.id)));
    for (const name of fs.readdirSync(root)) {
      if (/^\d+$/.test(name) && !live.has(name)) {
        fs.rmSync(path.join(root, name), { recursive: true, force: true });
        removed.push(name);
      }
    }
  } catch { /* non-critical */ }
  return removed;
}

// Same safety net as sweepOrphanProjectFiles, for company_documents/{id}/ folders.
function sweepOrphanCompanyDocumentFiles() {
  const removed = [];
  try {
    const root = companyDocumentsRootDir();
    if (!fs.existsSync(root)) return removed;
    const live = new Set(db.prepare('SELECT id FROM company_documents').all().map(r => String(r.id)));
    for (const name of fs.readdirSync(root)) {
      if (/^\d+$/.test(name) && !live.has(name)) {
        fs.rmSync(path.join(root, name), { recursive: true, force: true });
        removed.push(name);
      }
    }
  } catch { /* non-critical */ }
  return removed;
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
      .map(f => ({ name: f, mtimeMs: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => a.mtimeMs - b.mtimeMs)   // oldest first, by actual mtime — not filename text
      .map(f => f.name);
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

// Insert a new account and return its generated id. Caller supplies an already
// hashed password. Throws on a duplicate username (UNIQUE constraint).
function createUser(username, passwordHash) {
  const info = db.prepare(
    'INSERT INTO users(username, password_hash, created_at, is_active) VALUES(?, ?, ?, 1)'
  ).run(username, passwordHash, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

// ── Tasks + work logs (renderer sees the legacy "day rows" shape) ─────────────
// Since migration 012 the unit of work is a date-INDEPENDENT `tasks` row with
// child `work_logs` (one work session each). The `days` table survives only as
// per-date metadata (employee_name for reports). The renderer still works with the
// legacy shape { name, rows[] } where each row is one work session flattened with
// its task: { company, system, natural, time, description, source, status, minutes }.
// These helpers translate between that shape and the two tables and scope every
// query to the authenticated user (`userId`).
//
// Column split: task-level = name/status/company/system/source/project;
// work-log-level = date/description/minutes/time_type/activity_type. Display
// fields (company/system/natural) round-trip as their LABEL; logic fields
// (time/status) round-trip as their stable CODE, so the renderer compares
// codes, never strings.
//
// A per-task summary (count + first entry) cheap enough to inline as correlated
// subqueries into any existing task-joined query (aliased `t`) that today shows
// the legacy `t.source` text — Timesheet rows, Browse/Reports' day-entry rows,
// and the All Tasks/picker/palette task lists. Full per-entry detail is only
// ever fetched via getTaskSources()/getTask() (Task Detail). Declared before
// LOG_COLS below since it's inlined into that template literal.
const TASK_SOURCE_SUMMARY_COLS = `,
  (SELECT COUNT(*) FROM task_sources ts WHERE ts.task_id = t.id) AS source_count,
  (SELECT ts.source_ref FROM task_sources ts WHERE ts.task_id = t.id ORDER BY ts.sort_order, ts.id LIMIT 1) AS source_ref_first,
  (SELECT ts.source_url FROM task_sources ts WHERE ts.task_id = t.id ORDER BY ts.sort_order, ts.id LIMIT 1) AS source_url_first,
  (SELECT lc.code FROM task_sources ts JOIN lookup_codes lc ON lc.id = ts.source_type_id
     WHERE ts.task_id = t.id ORDER BY ts.sort_order, ts.id LIMIT 1) AS source_type_first`;

// Reads TASK_SOURCE_SUMMARY_COLS's four aliases back into the flat fields every
// summary-level API shape (Task, DayEntryRow) exposes alongside its rollups.
function taskSourceSummaryFields(r) {
  return {
    sourceCount: r.source_count || 0,
    firstSourceRef: r.source_ref_first || '',
    firstSourceUrl: r.source_url_first || '',
    firstSourceType: r.source_type_first || '',
  };
}

// A joined work_log(wl) + its parent task(t), aliased so one SELECT yields a flat
// row. Phase A is 1:1 (one work_log per task), so `eid` = the work_log id and a
// renderer row maps to exactly one (task, work_log) pair.
const LOG_JOIN = 'FROM work_logs wl JOIN tasks t ON t.id = wl.task_id';
const LOG_COLS = `wl.id AS wl_id, wl.task_id AS task_id, wl.date AS date,
  wl.description AS description, wl.minutes AS minutes, wl.time_type_id AS time_type_id,
  wl.activity_type_id AS activity_type_id, wl.sort_order AS sort_order,
  t.name AS task_name,
  t.company_id AS company_id, t.system_id AS system_id,
  t.status_id AS status_id, t.source AS source, t.project_id AS project_id
  ${TASK_SOURCE_SUMMARY_COLS}`;

// Joined work_log+task row → renderer row shape (minutes null → '' for the UI).
// Named to match the *ToApi convention used elsewhere (taskToApi, workLogToApi,
// etc.) — this is the mapper for the DayEntryRow shape (see ipc-types.js).
function dayEntryRowToApi(r) {
  return {
    eid: r.wl_id,
    taskId: r.task_id, taskName: r.task_name || '',
    company: lkLabel(r.company_id), system: lkLabel(r.system_id),
    natural: lkLabel(r.activity_type_id), time: lkCode(r.time_type_id),
    description: r.description || '', source: r.source || '',
    status: lkCode(r.status_id) || 'IN_PROGRESS',
    minutes: (r.minutes === null || r.minutes === undefined) ? '' : r.minutes,
    projectId: r.project_id ?? null,   // linked Project (nullable); rendered as a pill
    ...taskSourceSummaryFields(r),
  };
}

function getDayRow(userId, dateStr) {
  return db.prepare('SELECT id, employee_name FROM days WHERE user_id = ? AND date = ?')
    .get(userId, dateStr) || null;
}

// Distinct dates that actually have work sessions, newest first. Driven by
// work_logs (the source of truth for activity) — NOT the `days` table, which is
// now metadata-only and may lack a row for a date that has sessions.
function listDays(userId) {
  return db.prepare(
    'SELECT DISTINCT date FROM work_logs WHERE user_id = ? ORDER BY date DESC'
  ).all(userId).map(r => r.date);
}

// All dates in [from, to] inclusive that have work sessions, oldest first, each as
// {date, name, rows[]}. Driven by work_logs (so a date with sessions but no `days`
// metadata row is still included); the employee name is looked up from `days`
// (or '' when absent). Two queries total.
function loadDaysRange(userId, from, to) {
  const logs = db.prepare(
    `SELECT ${LOG_COLS} ${LOG_JOIN} WHERE wl.user_id = ? AND wl.date >= ? AND wl.date <= ? ORDER BY wl.date ASC, wl.sort_order, wl.id`
  ).all(userId, from, to);
  if (logs.length === 0) return [];

  const names = new Map(
    db.prepare('SELECT date, employee_name FROM days WHERE user_id = ? AND date >= ? AND date <= ?')
      .all(userId, from, to).map(d => [d.date, d.employee_name])
  );
  const byDate = new Map();
  const order = [];
  for (const l of logs) {
    let g = byDate.get(l.date);
    if (!g) { g = { date: l.date, name: names.get(l.date) || '', rows: [] }; byDate.set(l.date, g); order.push(l.date); }
    g.rows.push(dayEntryRowToApi(l));
  }
  return order.map(dt => byDate.get(dt));
}

// ── Companies / Systems views (read-only rollups over tasks + work_logs) ──────
// Both pages derive their data from the category FK columns on `tasks`, counting
// the work sessions (`work_logs`) that reference them. Grouped by the display
// LABEL (the same value shown everywhere else). `fkCol` is a fixed, internal
// column name (never user input), so interpolating it is injection-safe. Every
// query is scoped to the authenticated `userId`.
function distinctCategory(userId, fkCol) {
  return db.prepare(
    `SELECT lc.label AS name, COUNT(*) AS count
       ${LOG_JOIN}
       JOIN lookup_codes lc ON lc.id = t.${fkCol}
      WHERE wl.user_id = ?
      GROUP BY lc.label
      ORDER BY lc.label COLLATE NOCASE`
  ).all(userId);
}
function categoryEntries(userId, fkCol, name) {
  return db.prepare(
    `SELECT ${LOG_COLS}
       ${LOG_JOIN}
       JOIN lookup_codes lc ON lc.id = t.${fkCol}
      WHERE wl.user_id = ? AND lc.label = ?
      ORDER BY wl.date DESC, wl.sort_order, wl.id`
  ).all(userId, name).map(r => ({ date: r.date, ...dayEntryRowToApi(r) }));
}
function listCompanies(userId)        { return distinctCategory(userId, 'company_id'); }
function listSystems(userId)          { return distinctCategory(userId, 'system_id'); }
function companyEntries(userId, name) { return categoryEntries(userId, 'company_id', name); }
function systemEntries(userId, name)  { return categoryEntries(userId, 'system_id', name); }

// Custom date-range report (Milestone 4): work sessions in [from,to], optionally
// further narrowed by company/system label or a specific project id. A separate
// function rather than overloading loadDaysRange/days:range (Monthly Over-Time's
// own backing query), which has no filter params and is already relied on as-is.
// Filters are ANDed; any omitted filter is simply not applied. Company/System
// match by label (same convention categoryEntries already uses), Project by id.
function getFilteredWorkLogs(userId, filters) {
  const f = filters || {};
  const clauses = ['wl.user_id = ?'];
  const params = [userId];
  if (f.from) { clauses.push('wl.date >= ?'); params.push(f.from); }
  if (f.to)   { clauses.push('wl.date <= ?'); params.push(f.to); }
  if (f.company) {
    clauses.push("t.company_id = (SELECT id FROM lookup_codes WHERE category = 'COMPANY' AND label = ?)");
    params.push(f.company);
  }
  if (f.system) {
    clauses.push("t.system_id = (SELECT id FROM lookup_codes WHERE category = 'SYSTEM' AND label = ?)");
    params.push(f.system);
  }
  if (f.projectId != null) { clauses.push('t.project_id = ?'); params.push(Number(f.projectId)); }
  const rows = db.prepare(
    `SELECT ${LOG_COLS} ${LOG_JOIN} WHERE ${clauses.join(' AND ')} ORDER BY wl.date, wl.sort_order, wl.id`
  ).all(...params);
  return rows.map(r => ({ date: r.date, ...dayEntryRowToApi(r) }));
}

// ── Analytics aggregation (computed in SQL, not by shipping rows to the UI) ────
// All rollups the Analytics view needs, scoped to the user:
//   • period [from, to]  → totals + group-by-{company, system, time_type,
//                          activity_type} maps used for KPIs / bars / donuts
//   • span [spanFrom, spanTo] → per-day minute totals (all + Over-Time only) for
//                          the trend line and the activity heatmap
// Returns plain numbers + { key: minutes } maps; the renderer only draws them.
function getAnalytics(userId, from, to, spanFrom, spanTo) {
  const period = [userId, from, to];
  const FROM  = `FROM work_logs wl JOIN tasks t ON t.id = wl.task_id`;
  const WHERE = `WHERE wl.user_id = ? AND wl.date >= ? AND wl.date <= ?`;
  const doneId = lkId('ENTRY_STATUS', 'DONE');
  const otId   = lkId('TIME_TYPE', 'OVERTIME');

  const totals = db.prepare(
    `SELECT COALESCE(SUM(wl.minutes),0) AS totalMin,
            COUNT(*) AS recordCount,
            SUM(CASE WHEN t.status_id = ? THEN 1 ELSE 0 END) AS doneCount ${FROM} ${WHERE}`
  ).get(doneId, ...period);

  const activeDays = db.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT wl.date ${FROM} ${WHERE} GROUP BY wl.date HAVING COALESCE(SUM(wl.minutes),0) > 0
     )`
  ).get(...period).n;

  const mapOf = (sql) => {
    const m = {};
    for (const r of db.prepare(sql).all(...period)) m[r.k] = r.v;
    return m;
  };
  // company/system/natural keyed by display LABEL (INNER JOIN drops unset FKs).
  const byCompany = mapOf(`SELECT lc.label AS k, COALESCE(SUM(wl.minutes),0) AS v ${FROM} JOIN lookup_codes lc ON lc.id = t.company_id ${WHERE} GROUP BY lc.label`);
  const bySystem  = mapOf(`SELECT lc.label AS k, COALESCE(SUM(wl.minutes),0) AS v ${FROM} JOIN lookup_codes lc ON lc.id = t.system_id ${WHERE} GROUP BY lc.label`);
  // donuts only count sessions with logged minutes.
  const byNatural = mapOf(`SELECT lc.label AS k, SUM(wl.minutes) AS v ${FROM} JOIN lookup_codes lc ON lc.id = wl.activity_type_id ${WHERE} AND wl.minutes > 0 GROUP BY lc.label`);
  // time-type keyed by stable CODE; unset time_type buckets under 'OTHER'.
  const byType    = mapOf(`SELECT COALESCE(lc.code, 'OTHER') AS k, SUM(wl.minutes) AS v ${FROM} LEFT JOIN lookup_codes lc ON lc.id = wl.time_type_id ${WHERE} AND wl.minutes > 0 GROUP BY k`);
  // Milestone 4 — department (tasks.department_id, keyed by label) and project
  // category (projects.category_id via tasks.project_id, keyed by label) dimensions.
  const byDepartment = mapOf(`SELECT lc.label AS k, COALESCE(SUM(wl.minutes),0) AS v ${FROM} JOIN lookup_codes lc ON lc.id = t.department_id ${WHERE} GROUP BY lc.label`);
  const byProjectCategory = mapOf(
    `SELECT lc.label AS k, COALESCE(SUM(wl.minutes),0) AS v ${FROM} JOIN projects p ON p.id = t.project_id JOIN lookup_codes lc ON lc.id = p.category_id ${WHERE} GROUP BY lc.label`
  );

  const perDay = (otOnly) => {
    const m = {};
    const sql = `SELECT wl.date AS date, COALESCE(SUM(wl.minutes),0) AS mins
                 ${FROM} ${WHERE} ${otOnly ? 'AND wl.time_type_id = ?' : ''}
                 GROUP BY wl.date`;
    const args = otOnly ? [userId, spanFrom, spanTo, otId] : [userId, spanFrom, spanTo];
    for (const r of db.prepare(sql).all(...args)) m[r.date] = r.mins;
    return m;
  };

  return {
    totalMin: totals.totalMin, recordCount: totals.recordCount, doneCount: totals.doneCount || 0,
    activeDays, byCompany, bySystem, byNatural, byType, byDepartment, byProjectCategory,
    dayMin: perDay(false), dayOtMin: perDay(true),
  };
}

// Overview "now" numbers (today + month-to-date), computed in SQL.
function getOverviewStats(userId, today, monthStart) {
  const t = db.prepare(
    `SELECT COALESCE(SUM(wl.minutes),0) AS mins, COUNT(*) AS recs
     FROM work_logs wl
     WHERE wl.user_id = ? AND wl.date = ?`
  ).get(userId, today);
  const m = db.prepare(
    `SELECT COALESCE(SUM(wl.minutes),0) AS mins, COUNT(DISTINCT wl.date) AS days
     FROM work_logs wl
     WHERE wl.user_id = ? AND wl.date >= ? AND wl.date <= ?`
  ).get(userId, monthStart, today);
  return { todayMin: t.mins, todayRecs: t.recs, monthMin: m.mins, daysLogged: m.days };
}

// ── Attention center (Milestone 3) ──────────────────────────────────────────
// One aggregated read across every date-urgent source in the app: subscription
// renewals, Company Document renewals, and the three client_* tables that
// carry an expiry_date (Auth/VPN, External Services, Internal Systems —
// client_servers/client_databases have no expiry_date column). Deliberately
// returns raw dates + a deep-link target, not a computed urgency tier — the
// renderer already has daysUntil()/renewClass()/renewLabel() (Subscriptions'
// own helpers, already generic) and reuses them here instead of duplicating
// the same day-math server-side. `companyId` is set only for the three
// Clients-sourced types, letting the renderer deep-link into that specific
// client's detail view (openClientDetail(companyId, title)) instead of just
// the Clients list.
function getAttentionItems(userId) {
  const items = [];
  db.prepare('SELECT id, name, renewal_date FROM subscriptions WHERE user_id = ?').all(userId).forEach(s => {
    if (s.renewal_date) items.push({ type: 'subscription', id: s.id, title: s.name || 'Subscription', date: s.renewal_date, module: 'subscriptions' });
  });
  db.prepare('SELECT id, name, renewal_date FROM company_documents WHERE user_id = ?').all(userId).forEach(d => {
    if (d.renewal_date) items.push({ type: 'companyDocument', id: d.id, title: d.name || 'Document', date: d.renewal_date, module: 'companydocs' });
  });
  db.prepare('SELECT id, connection_name, expiry_date, company_id FROM client_vpn_connections WHERE user_id = ?').all(userId).forEach(v => {
    if (v.expiry_date) items.push({ type: 'clientVpn', id: v.id, title: v.connection_name || 'Auth', date: v.expiry_date, module: 'clients', companyId: v.company_id });
  });
  db.prepare('SELECT id, name, expiry_date, company_id FROM client_external_services WHERE user_id = ?').all(userId).forEach(e => {
    if (e.expiry_date) items.push({ type: 'clientExternal', id: e.id, title: e.name || 'External Service', date: e.expiry_date, module: 'clients', companyId: e.company_id });
  });
  db.prepare('SELECT id, name, expiry_date, company_id FROM client_internal_systems WHERE user_id = ?').all(userId).forEach(i => {
    if (i.expiry_date) items.push({ type: 'clientInternal', id: i.id, title: i.name || 'Internal System', date: i.expiry_date, module: 'clients', companyId: i.company_id });
  });
  return items;
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
        // Existing case-insensitive labels in this category, keyed by
        // lowercased-trimmed label -> the row id that currently owns it. Updated
        // as the batch is processed so two new items in the same save can't
        // collide with each other either. Prevents ever re-creating the kind of
        // case-only duplicate (e.g. "Acme" / "ACME") migration 003 could
        // historically seed — a relabel/add that would collide is skipped
        // rather than silently producing a second code for the same value.
        const usedLabels = new Map(
          db.prepare('SELECT id, label FROM lookup_codes WHERE category = ?').all(cat)
            .map(r => [r.label.trim().toLowerCase(), r.id])
        );
        list.forEach((item, i) => {
          const label = String(item.label ?? '').trim();
          if (!label) return;
          // Coerce once so a stringified id (e.g. from a JSON round-trip) still
          // matches the numeric ids lk().idTo/usedLabels are keyed by, instead of
          // silently falling through to the insert branch and creating a duplicate row.
          const itemId = (item.id != null && Number.isFinite(Number(item.id))) ? Number(item.id) : null;
          const key = label.toLowerCase();
          const owner = usedLabels.get(key);
          if (owner != null && owner !== itemId) return; // another code already owns this label — skip
          const sort   = Number.isInteger(item.sortOrder) ? item.sortOrder : i;
          const active = item.isActive === false ? 0 : 1;
          if (itemId != null && lk().idTo.has(itemId)) {
            upd.run(label, sort, active, itemId);
            usedLabels.set(key, itemId);
          } else {
            const code = uniqueCode(cat, String(item.code || '').trim().toUpperCase() || slugCode(label));
            const newId = Number(ins.run(cat, code, label, sort, active, now).lastInsertRowid);
            usedLabels.set(key, newId);
          }
        });
      }
    }
    if (data && typeof data.defaultName === 'string') appSet('default_employee_name', data.defaultName.trim());
  });
  lkInvalidate();
  return { ok: true };
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
  const now = new Date().toISOString();
  tx(() => {
    const keep = new Set(list.map(s => s.id));
    const del = db.prepare('DELETE FROM subscriptions WHERE id = ? AND user_id = ?');
    for (const row of db.prepare('SELECT id FROM subscriptions WHERE user_id = ?').all(userId)) {
      if (!keep.has(row.id)) del.run(row.id, userId);
    }
    const up = db.prepare(`INSERT INTO subscriptions(id, user_id, name, cost, currency_id, billing_cycle_id, end_date, renewal_date, sort_order, updated_at)
                           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(id) DO UPDATE SET
                             name=excluded.name, cost=excluded.cost, currency_id=excluded.currency_id,
                             billing_cycle_id=excluded.billing_cycle_id, end_date=excluded.end_date,
                             renewal_date=excluded.renewal_date, sort_order=excluded.sort_order, updated_at=excluded.updated_at`);
    list.forEach((s, i) => {
      const cost = Number.parseFloat(String(s.cost ?? '').replace(/[^0-9.]/g, '')) || 0;
      const currencyId = lkId('CURRENCY', s.currency) ?? lkId('CURRENCY', 'USD');
      const cycleId    = lkId('BILLING_CYCLE', s.billingCycle) ?? lkId('BILLING_CYCLE', 'MONTHLY');
      up.run(
        s.id, userId, s.name ?? '', cost, currencyId, cycleId,
        s.endDate || null, s.renewalDate || null, i, now
      );
    });
    appSet('subscriptions_default_currency', currency);
  });
  return { ok: true };
}

// ── Projects ──────────────────────────────────────────────────────────────────
// A Project is a container for a client/system engagement. It owns a fixed set of
// tracked documents (auto-created on insert) and links to existing tasks — both
// timesheet tasks (the `tasks` table, surfaced per work session) and "Not Yet"
// backlog tasks — via a nullable project_id FK. A project also references one or
// more COMPANY lookup codes (its
// clients, via the project_companies junction), one or more SYSTEM lookups (via
// the project_systems junction), and a PROJECT_STATUS lookup code (status). Since
// migration 031, a project also carries a required PROJECT_CATEGORY lookup code
// (category_id — New Project / CR on Existing Project / Project Annual Support,
// round-tripped as its code like status, since the UI branches on it) and an
// optional self-referencing related_project_id (only meaningful for the CR/Annual
// Support categories — the project this one is a change request against or is
// providing annual support for). Every query is scoped to the authenticated owner
// (`userId`). The tracked document types are driven by the PROJECT_DOCUMENT lookup
// category (manageable in Settings); a project_documents row stores availability
// keyed by the document's stable lookup code, created lazily on first toggle.
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

// Validate a CR/Annual-Support project's optional back-reference to the project
// it relates to: must belong to the user and cannot point at itself (excludeId is
// the project being written, or null on create where self-reference is moot).
function resolveRelatedProjectId(userId, relatedProjectId, excludeId = null) {
  if (relatedProjectId == null) return null;
  const rid = Number(relatedProjectId);
  if (!Number.isInteger(rid) || (excludeId != null && rid === Number(excludeId))) return null;
  return ownedProjectId(userId, rid);
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
      `INSERT INTO projects(user_id, name, description, status, category_id, related_project_id, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, data?.name ?? '', data?.description ?? '',
          data?.status || DEFAULT_PROJECT_STATUS,
          lkId('PROJECT_CATEGORY', data?.category),
          resolveRelatedProjectId(userId, data?.relatedProjectId),
          now, now).lastInsertRowid);
    setProjectCompanies(id, data?.companyIds);
    setProjectSystems(id, data?.systemIds);
  });
  return getProject(userId, id);
}

// All of the user's projects with a linked-task count, newest first — the list
// view's payload. taskCount is the number of TASKS linked to the project (each may
// have zero or many work sessions).
function listProjects(userId) {
  return db.prepare(
    `SELECT p.id, p.name, p.description, p.status,
            p.category_id AS categoryId, p.related_project_id AS relatedProjectId,
            (SELECT name FROM projects rp WHERE rp.id = p.related_project_id) AS relatedProjectName,
            p.created_at AS createdAt,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS taskCount
       FROM projects p
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC, p.id DESC`
  ).all(userId).map(({ categoryId, ...p }) => ({
    ...p,
    category: lkCode(categoryId),
    companies: projectCompanies(p.id),
    systems: projectSystems(p.id),
  }));
}

// One project in full: profile + its linked TASKS (each with nested work sessions,
// including zero-log "Not Yet" tasks) + document statuses. null if not owned.
// (ProjectTasksV2 shape — `tasks: Task[]`, replacing the old {entries, backlog}.)
function getProject(userId, id) {
  const row = db.prepare(
    `SELECT p.id, p.name, p.description, p.status,
            p.category_id AS categoryId, p.related_project_id AS relatedProjectId,
            (SELECT name FROM projects rp WHERE rp.id = p.related_project_id) AS relatedProjectName,
            p.created_at AS createdAt
       FROM projects p WHERE p.id = ? AND p.user_id = ?`
  ).get(id, userId);
  if (!row) return null;
  const { categoryId, ...p } = row;
  p.category = lkCode(categoryId);

  const tasks = projectTasks(userId, id);

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

  return { ...p, companies: projectCompanies(id), systems: projectSystems(id), tasks, documents };
}

// A project's linked tasks (ProjectTasksV2), each as a full Task with its ordered
// work sessions + rollups. Includes zero-log tasks (Not-Yet items linked to the
// project). Owner-scoped; ordered newest-first.
function projectTasks(userId, projectId) {
  return db.prepare(
    `SELECT t.* ${TASK_SOURCE_SUMMARY_COLS} FROM tasks t WHERE t.project_id = ? AND t.user_id = ? ORDER BY t.created_at DESC, t.id DESC`
  ).all(projectId, userId).map(t => {
    const workLogs = db.prepare(
      `SELECT ${WORK_LOG_COLS} FROM work_logs WHERE task_id = ? AND user_id = ? ORDER BY date DESC, sort_order, id`
    ).all(t.id, userId).map(workLogToApi);
    const roll = db.prepare(
      `SELECT COUNT(*) AS logCount, COALESCE(SUM(minutes),0) AS totalMinutes, MIN(date) AS firstDate, MAX(date) AS lastDate
         FROM work_logs WHERE task_id = ?`
    ).get(t.id);
    return taskToApi(t, {
      logCount: roll.logCount, totalMinutes: roll.totalMinutes, firstDate: roll.firstDate, lastDate: roll.lastDate, workLogs,
      ...taskSourceSummaryFields(t),
    });
  });
}

// Update a project's profile fields in place (documents/links untouched). Returns
// the refreshed project, or null if the caller doesn't own it.
function updateProject(userId, id, data) {
  if (!ownsProject(userId, id)) return null;
  tx(() => {
    db.prepare(
      `UPDATE projects SET name = ?, description = ?, status = ?, category_id = ?, related_project_id = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`
    ).run(data?.name ?? '', data?.description ?? '',
          data?.status || DEFAULT_PROJECT_STATUS,
          lkId('PROJECT_CATEGORY', data?.category),
          resolveRelatedProjectId(userId, data?.relatedProjectId, id),
          new Date().toISOString(), id, userId);
    setProjectCompanies(id, data?.companyIds);
    setProjectSystems(id, data?.systemIds);
  });
  return getProject(userId, id);
}

// In-memory record of which user just deleted which project id, kept only for the
// lifetime of this process (never persisted). By the time purgeProjectFiles/
// restoreProjectFiles run, the project row is already gone, so an ordinary
// "WHERE id=? AND user_id=?" ownership check is no longer possible — this map is
// the only record of who is allowed to purge or restore a given id's files. Only
// set when deleteProject actually removed a row the caller owned (never on a
// no-op delete of someone else's id); consumed (deleted) the moment it's checked.
const pendingProjectDeletes = new Map(); // projectId -> userId

// Delete a project. ON DELETE CASCADE drops its document rows; ON DELETE SET NULL
// unlinks (but never deletes) any linked timesheet/backlog tasks. The project's
// file folder is intentionally NOT removed here — it must survive the renderer's
// 5 s undo window, and is purged either when that window lapses (purgeProjectFiles)
// or by the boot-time orphan sweep (sweepOrphanProjectFiles) as a safety net.
function deleteProject(userId, id) {
  let changes = 0;
  tx(() => {
    changes = db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId).changes;
  });
  if (changes > 0) pendingProjectDeletes.set(Number(id), userId);
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
// The project row is already gone by this point, so ownership is checked against
// pendingProjectDeletes (set by deleteProject) instead of a DB row; the id is also
// coerced to an integer so the path can only ever resolve inside the data root.
function purgeProjectFiles(userId, projectId) {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false };
  if (pendingProjectDeletes.get(id) !== userId) return { ok: false, error: 'Not authorized to purge this project' };
  pendingProjectDeletes.delete(id);
  try { fs.rmSync(projectDir(id), { recursive: true, force: true }); } catch { /* best effort */ }
  return { ok: true };
}

// Undo a delete: the project was re-created under a NEW id, so move its file
// folder oldId → newId and re-insert each file's metadata (the old rows were
// CASCADE-deleted). `fileDocs` is the snapshot's documents that had a file:
// [{ documentType, file:{ path, originalName, size, mimeType, uploadedAt } }].
function restoreProjectFiles(userId, oldProjectId, newProjectId, fileDocs) {
  if (!ownsProject(userId, newProjectId)) return { ok: false, error: 'Project not found' };
  const oldId = Number(oldProjectId);
  if (pendingProjectDeletes.get(oldId) !== userId) return { ok: false, error: 'Not authorized to restore this project' };
  pendingProjectDeletes.delete(oldId);
  const oldDir = projectDir(oldId);
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

// ── Company Documents (standalone card-per-document module, independent of
// Projects) ────────────────────────────────────────────────────────────────
// Each row IS a user-created card — unlike `project_documents` (a fixed catalog
// slot per project that survives file removal), there is no catalog: `category`
// is a COMPANY_DOCUMENT_CATEGORY lookup code the user picks per card, and the
// row itself is deleted (not just its file) when the card is removed. At most
// one file per card (Option A: bytes on disk under
// <userData>/company_documents/{id}/, metadata here). Deleting a card leaves
// its file on disk so it survives the renderer's 5 s undo window;
// purgeCompanyDocumentFiles/restoreCompanyDocumentFile mirror the Projects
// delete/undo pattern (including the SQLite rowid-reuse caveat).

function ownsCompanyDocument(userId, id) {
  return !!db.prepare('SELECT 1 FROM company_documents WHERE id = ? AND user_id = ?').get(id, userId);
}

function companyDocumentToApi(r) {
  const hasFile = !!r.file_path;
  return {
    id: r.id, name: r.name, category: r.category || '', renewalDate: r.renewal_date || '',
    notes: r.notes || '', sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
    file: hasFile ? {
      path: r.file_path, originalName: r.original_name || '', size: r.file_size || 0,
      mimeType: r.mime_type || '', uploadedAt: r.uploaded_at || '',
      exists: fs.existsSync(path.join(userDataDir, r.file_path)),
    } : null,
  };
}

// All of the user's company documents, newest first — the list view's payload.
function listCompanyDocuments(userId) {
  return db.prepare(
    'SELECT * FROM company_documents WHERE user_id = ? ORDER BY created_at DESC, id DESC'
  ).all(userId).map(companyDocumentToApi);
}
function getCompanyDocument(userId, id) {
  const r = db.prepare('SELECT * FROM company_documents WHERE id = ? AND user_id = ?').get(id, userId);
  return r ? companyDocumentToApi(r) : null;
}
function createCompanyDocument(userId, data) {
  const now = new Date().toISOString();
  const category = lkId('COMPANY_DOCUMENT_CATEGORY', data?.category) != null ? data.category : null;
  const id = Number(db.prepare(
    `INSERT INTO company_documents(user_id, name, category, renewal_date, notes, sort_order, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(userId, data?.name ?? '', category, data?.renewalDate || null, data?.notes ?? '', now, now).lastInsertRowid);
  return getCompanyDocument(userId, id);
}
// Update a card's profile fields in place (file untouched). Returns the
// refreshed card, or null if the caller doesn't own it.
function updateCompanyDocument(userId, id, data) {
  if (!ownsCompanyDocument(userId, id)) return null;
  const category = lkId('COMPANY_DOCUMENT_CATEGORY', data?.category) != null ? data.category : null;
  db.prepare(
    `UPDATE company_documents SET name = ?, category = ?, renewal_date = ?, notes = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`
  ).run(data?.name ?? '', category, data?.renewalDate || null, data?.notes ?? '', new Date().toISOString(), id, userId);
  return getCompanyDocument(userId, id);
}
// In-memory record of which user just deleted which company-document id — same
// rationale as pendingProjectDeletes above (the row is gone by the time purge/
// restore runs, so this is the only ownership check still possible for those).
const pendingCompanyDocDeletes = new Map(); // companyDocId -> userId

// Delete a card. The file (if any) is intentionally NOT removed here — it must
// survive the renderer's 5 s undo window; purgeCompanyDocumentFiles removes it
// once that window lapses, restoreCompanyDocumentFile moves it onto the
// re-created card's new id if the user undoes.
function deleteCompanyDocument(userId, id) {
  const changes = db.prepare('DELETE FROM company_documents WHERE id = ? AND user_id = ?').run(id, userId).changes;
  if (changes > 0) pendingCompanyDocDeletes.set(Number(id), userId);
  return { ok: true };
}

// Copy a chosen file into the card's folder and record its metadata. Validates
// ownership and the extension allowlist (shared with Project Documents). If a
// file already exists for this card it is a REPLACE: the new file is written
// first, then the old one removed (best-effort). Returns
// { ok, document } | { ok:false, error }.
function saveCompanyDocumentFile(userId, id, srcPath) {
  if (!ownsCompanyDocument(userId, id)) return { ok: false, error: 'Document not found' };
  const ext = fileExt(srcPath);
  if (!PROJECT_DOC_EXTENSIONS.includes(ext)) {
    return { ok: false, error: `Unsupported file type (.${ext || '?'}). Allowed: ${PROJECT_DOC_EXTENSIONS.join(', ')}` };
  }
  let size;
  try { size = fs.statSync(srcPath).size; }
  catch { return { ok: false, error: 'Could not read the selected file' }; }

  const prev = db.prepare('SELECT file_path FROM company_documents WHERE id = ?').get(id);

  // {timestamp}.{ext} — one file slot per card, so no type prefix is needed.
  const relPath = path.join('company_documents', String(id), `${Date.now()}.${ext}`);
  const absPath = path.join(userDataDir, relPath);
  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.copyFileSync(srcPath, absPath);
  } catch (err) {
    return { ok: false, error: 'Could not save the file: ' + String(err?.message || err) };
  }

  try {
    db.prepare(
      `UPDATE company_documents
          SET file_path = ?, original_name = ?, file_size = ?, mime_type = ?, uploaded_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`
    ).run(relPath, path.basename(srcPath), size, PROJECT_DOC_TYPES[ext], new Date().toISOString(),
          new Date().toISOString(), id, userId);
  } catch (err) {
    // Metadata write failed — don't leave the just-copied orphan on disk.
    try { fs.rmSync(absPath, { force: true }); } catch { /* best effort */ }
    return { ok: false, error: 'Could not record the file: ' + String(err?.message || err) };
  }

  // Replace succeeded — remove the superseded file (best-effort; never blocks).
  if (prev?.file_path && prev.file_path !== relPath) {
    try { fs.rmSync(path.join(userDataDir, prev.file_path), { force: true }); } catch { /* best effort */ }
  }
  return { ok: true, document: getCompanyDocument(userId, id) };
}

// Resolve the absolute on-disk path of a card's file (for download / open),
// after an ownership check. `exists` reflects whether the file is actually present.
function resolveCompanyDocumentFile(userId, id) {
  if (!ownsCompanyDocument(userId, id)) return { ok: false, error: 'Document not found' };
  const r = db.prepare('SELECT file_path, original_name FROM company_documents WHERE id = ?').get(id);
  if (!r?.file_path) return { ok: false, error: 'No file for this document' };
  const absPath = path.join(userDataDir, r.file_path);
  return { ok: true, absPath, originalName: r.original_name || path.basename(r.file_path), exists: fs.existsSync(absPath) };
}

// Remove a card's file from disk and clear its metadata (keeps the card itself,
// just back to "no file"). Best-effort on the unlink.
function removeCompanyDocumentFile(userId, id) {
  if (!ownsCompanyDocument(userId, id)) return { ok: false, error: 'Document not found' };
  const r = db.prepare('SELECT file_path FROM company_documents WHERE id = ?').get(id);
  if (r?.file_path) {
    try { fs.rmSync(path.join(userDataDir, r.file_path), { force: true }); } catch { /* best effort */ }
  }
  db.prepare(
    `UPDATE company_documents
        SET file_path = NULL, original_name = NULL, file_size = NULL, mime_type = NULL, uploaded_at = NULL, updated_at = ?
      WHERE id = ? AND user_id = ?`
  ).run(new Date().toISOString(), id, userId);
  return { ok: true, document: getCompanyDocument(userId, id) };
}

// Delete a card's entire file folder (company_documents/{id}/). Called when the
// delete undo-window lapses. The card row is already gone by this point, so
// ownership is checked against pendingCompanyDocDeletes (set by
// deleteCompanyDocument) instead of a DB row; the id is also coerced to an
// integer so the path can only ever resolve inside the data root.
function purgeCompanyDocumentFiles(userId, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { ok: false };
  if (pendingCompanyDocDeletes.get(n) !== userId) return { ok: false, error: 'Not authorized to purge this document' };
  pendingCompanyDocDeletes.delete(n);
  try { fs.rmSync(companyDocumentDir(n), { recursive: true, force: true }); } catch { /* best effort */ }
  return { ok: true };
}

// Undo a delete: the card was re-created under a NEW id, so move its file
// folder oldId → newId and re-stamp the file metadata onto the new row (the old
// row was hard-deleted). `fileMeta` is the deleted card's `.file` snapshot, or
// null/undefined if it never had one.
function restoreCompanyDocumentFile(userId, oldId, newId, fileMeta) {
  if (!ownsCompanyDocument(userId, newId)) return { ok: false, error: 'Document not found' };
  const oldIdNum = Number(oldId);
  if (pendingCompanyDocDeletes.get(oldIdNum) !== userId) return { ok: false, error: 'Not authorized to restore this document' };
  pendingCompanyDocDeletes.delete(oldIdNum);
  if (!fileMeta?.path) return { ok: true, document: getCompanyDocument(userId, newId) };

  const oldDir = companyDocumentDir(oldIdNum);
  const newDir = companyDocumentDir(Number(newId));
  // SQLite reuses the highest deleted rowid, so undoing the delete of the newest
  // card re-creates it under the SAME id — the folder is already in place and
  // must NOT be moved/cleared. Only relocate when the id actually changed.
  if (path.resolve(oldDir) !== path.resolve(newDir)) {
    try {
      if (fs.existsSync(oldDir)) {
        fs.mkdirSync(path.dirname(newDir), { recursive: true });
        fs.rmSync(newDir, { recursive: true, force: true }); // freshly created card has no files
        fs.renameSync(oldDir, newDir);
      }
    } catch { /* fall through — re-stamp what metadata we can */ }
  }

  // Re-home the relative path onto the new id (same basename, new folder).
  const relPath = path.join('company_documents', String(Number(newId)), path.basename(fileMeta.path));
  if (!fs.existsSync(path.join(userDataDir, relPath))) return { ok: true, document: getCompanyDocument(userId, newId) }; // file didn't survive — skip

  db.prepare(
    `UPDATE company_documents
        SET file_path = ?, original_name = ?, file_size = ?, mime_type = ?, uploaded_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`
  ).run(relPath, fileMeta.originalName || path.basename(relPath), fileMeta.size || 0,
        fileMeta.mimeType || PROJECT_DOC_TYPES[fileExt(relPath)] || '', fileMeta.uploadedAt || new Date().toISOString(),
        new Date().toISOString(), newId, userId);
  return { ok: true, document: getCompanyDocument(userId, newId) };
}

// Link / unlink a task to a project, addressed directly by its task id (the
// two-level model — everything is a task now). Linking verifies project ownership;
// each UPDATE is owner-scoped so a user can only touch their own rows.
function linkTask(userId, projectId, taskId) {
  if (!ownsProject(userId, projectId)) return { ok: false, error: 'project not found' };
  db.prepare('UPDATE tasks SET project_id = ? WHERE id = ? AND user_id = ?')
    .run(projectId, taskId, userId);
  return { ok: true };
}
function unlinkTask(userId, taskId) {
  db.prepare('UPDATE tasks SET project_id = NULL WHERE id = ? AND user_id = ?')
    .run(taskId, userId);
  return { ok: true };
}

// Link / unlink a task to a department, the same shape as linkTask/unlinkTask
// above but for the DEPARTMENT lookup dimension (Internal Tasks). A task's
// project link and department link are independent — no exclusivity enforced.
function linkDepartmentTask(userId, taskId, departmentId) {
  if (!isLookupId('DEPARTMENT', departmentId)) return { ok: false, error: 'department not found' };
  db.prepare('UPDATE tasks SET department_id = ? WHERE id = ? AND user_id = ?')
    .run(Number(departmentId), taskId, userId);
  return { ok: true };
}
function unlinkDepartmentTask(userId, taskId) {
  db.prepare('UPDATE tasks SET department_id = NULL WHERE id = ? AND user_id = ?')
    .run(taskId, userId);
  return { ok: true };
}

// Tasks not linked to ANY project, for the "link an existing task" picker — every
// unlinked task (with-sessions and zero-log alike), owner-scoped, newest first,
// each with its rollups. Read-only; the UI links via linkTask.
function listLinkableTasks(userId) {
  return db.prepare(
    `SELECT * FROM tasks WHERE user_id = ? AND project_id IS NULL ORDER BY created_at DESC, id DESC`
  ).all(userId).map(t => {
    const roll = db.prepare(
      `SELECT COUNT(*) AS logCount, COALESCE(SUM(minutes),0) AS totalMinutes, MIN(date) AS firstDate, MAX(date) AS lastDate
         FROM work_logs WHERE task_id = ?`
    ).get(t.id);
    return taskToApi(t, {
      logCount: roll.logCount, totalMinutes: roll.totalMinutes, firstDate: roll.firstDate, lastDate: roll.lastDate,
    });
  });
}

// Same as listLinkableTasks but for the "link an existing task to a department"
// picker (department_id IS NULL instead of project_id IS NULL).
function listLinkableTasksForDepartment(userId) {
  return db.prepare(
    `SELECT * FROM tasks WHERE user_id = ? AND department_id IS NULL ORDER BY created_at DESC, id DESC`
  ).all(userId).map(t => {
    const roll = db.prepare(
      `SELECT COUNT(*) AS logCount, COALESCE(SUM(minutes),0) AS totalMinutes, MIN(date) AS firstDate, MAX(date) AS lastDate
         FROM work_logs WHERE task_id = ?`
    ).get(t.id);
    return taskToApi(t, {
      logCount: roll.logCount, totalMinutes: roll.totalMinutes, firstDate: roll.firstDate, lastDate: roll.lastDate,
    });
  });
}

// ── Departments (Internal Tasks) ──────────────────────────────────────────────
// Department is a plain DEPARTMENT lookup category (like Company/System) — no
// dedicated table, no create/update/delete here (managed via Settings' saveLookups).
// listDepartments shows every active department regardless of activity (same
// convention as listClients showing every active COMPANY lookup), each with a
// linked-task count; getDepartment nests its full tasks (with work sessions),
// the same shape getProject already returns for a project's tasks.

// All active departments + a linked-task count, for the Internal Tasks left list.
function listDepartments(userId) {
  return getLookupsByCategory('DEPARTMENT').map(d => ({
    id: d.id, code: d.code, label: d.label,
    taskCount: db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE department_id = ? AND user_id = ?').get(d.id, userId).n,
  }));
}

// A department's linked tasks, each as a full Task with its ordered work sessions
// + rollups. Includes zero-log tasks. Owner-scoped; ordered newest-first.
function departmentTasks(userId, departmentId) {
  return db.prepare(
    `SELECT t.* ${TASK_SOURCE_SUMMARY_COLS} FROM tasks t WHERE t.department_id = ? AND t.user_id = ? ORDER BY t.created_at DESC, t.id DESC`
  ).all(departmentId, userId).map(t => {
    const workLogs = db.prepare(
      `SELECT ${WORK_LOG_COLS} FROM work_logs WHERE task_id = ? AND user_id = ? ORDER BY date DESC, sort_order, id`
    ).all(t.id, userId).map(workLogToApi);
    const roll = db.prepare(
      `SELECT COUNT(*) AS logCount, COALESCE(SUM(minutes),0) AS totalMinutes, MIN(date) AS firstDate, MAX(date) AS lastDate
         FROM work_logs WHERE task_id = ?`
    ).get(t.id);
    return taskToApi(t, {
      logCount: roll.logCount, totalMinutes: roll.totalMinutes, firstDate: roll.firstDate, lastDate: roll.lastDate, workLogs,
      ...taskSourceSummaryFields(t),
    });
  });
}

// One department in full: its lookup identity + its linked tasks. null if `id`
// isn't a real active DEPARTMENT lookup.
function getDepartment(userId, id) {
  const d = getLookupsByCategory('DEPARTMENT').find(x => x.id === Number(id));
  if (!d) return null;
  return { id: d.id, code: d.code, label: d.label, tasks: departmentTasks(userId, d.id) };
}

// ── Tasks + work logs (v2 API for the two-level model) ────────────────────────
// The forward-looking data layer the renderer moves onto in Phase C. A `tasks` row
// is a date-INDEPENDENT unit of work; its `work_logs` are the dated sessions.
// Round-trips mirror the rest of the app: company/system resolve as LABELs,
// status as a stable CODE; project links are validated against ownership.
// (Activity type/"Natural" lives on work_logs, not tasks — see workLogToApi.)
// These are ADDITIVE — the legacy day:*/backlog:* shims above are untouched, so
// both APIs read/write the same tables side by side.

// One task row → the renderer's Task shape. `extra` carries per-call rollups
// (log counts / totals) and, from getTask, the ordered workLogs array.
function taskToApi(t, extra = {}) {
  return {
    id: t.id,
    name: t.name || '',
    status: lkCode(t.status_id) || 'IN_PROGRESS',
    company: lkLabel(t.company_id), system: lkLabel(t.system_id),
    department: lkLabel(t.department_id),
    source: t.source || '',
    projectId: t.project_id ?? null,
    departmentId: t.department_id ?? null,
    sortOrder: t.sort_order ?? 0,
    createdAt: t.created_at,
    ...extra,
  };
}

// One work_log row → the renderer's WorkLog shape (minutes null → '' for the UI).
function workLogToApi(w) {
  return {
    id: w.id,
    taskId: w.task_id,
    date: w.date,
    description: w.description || '',
    minutes: (w.minutes === null || w.minutes === undefined) ? '' : w.minutes,
    time: lkCode(w.time_type_id),
    natural: lkLabel(w.activity_type_id),
    sortOrder: w.sort_order ?? 0,
  };
}

const WORK_LOG_COLS = 'id, user_id, task_id, date, description, minutes, time_type_id, activity_type_id, sort_order, created_at, updated_at';

// API payload → task-level column values. Unknown/empty lookups → NULL (unset);
// status defaults to IN_PROGRESS; the project link is ownership-validated.
function taskWriteFields(userId, data) {
  return {
    name: String(data?.name ?? '').trim(),
    status_id: lkId('ENTRY_STATUS', data?.status) ?? lkId('ENTRY_STATUS', 'IN_PROGRESS'),
    company_id: lkId('COMPANY', data?.company),
    system_id: lkId('SYSTEM', data?.system),
    project_id: ownedProjectId(userId, data?.projectId),
    department_id: lkId('DEPARTMENT', data?.department),
    source: String(data?.source ?? ''),
  };
}

// API payload → work-log column values (the session: what/when/how long).
// A real calendar date in YYYY-MM-DD form (rejects out-of-range month/day like
// "2026-13-45" or "2026-02-30", not just the digit-grouping shape).
function isValidDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function workLogWriteFields(data) {
  const mins = (data?.minutes === '' || data?.minutes === null || data?.minutes === undefined) ? null : Number(data.minutes);
  const rawDate = String(data?.date ?? '').slice(0, 10);
  return {
    date: isValidDateStr(rawDate) ? rawDate : new Date().toISOString().slice(0, 10),
    description: String(data?.description ?? ''),
    minutes: (Number.isFinite(mins) && mins >= 0) ? mins : null,
    time_type_id: lkId('TIME_TYPE', data?.time),
    activity_type_id: lkId('ACTIVITY_TYPE', data?.natural),
  };
}

// ── Task Sources (structured source list — migration 033) ────────────────────
// A task's source is no longer a single free-text string (legacy `tasks.source`,
// kept untouched for backward compat) — it's a list of typed entries (Jira /
// Email / Teams-Chat / Meeting / Phone Call / Other), each with a primary ref,
// an optional url, and optional per-type extras (source_meta JSON). `type`
// round-trips as its TASK_SOURCE_TYPE lookup CODE — the renderer branches on it
// to pick which fields to show/edit, the same "logic field" convention
// time/status already follow — not its display label.
function taskSourceToApi(s) {
  return {
    id: s.id,
    taskId: s.task_id,
    type: lkCode(s.source_type_id) || '',
    ref: s.source_ref || '',
    url: s.source_url || '',
    meta: s.source_meta ? safeParse(s.source_meta, {}) : {},
    sortOrder: s.sort_order ?? 0,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

function ownsTaskSource(userId, id) {
  return !!db.prepare('SELECT 1 FROM task_sources WHERE id = ? AND user_id = ?').get(id, userId);
}

function taskSourceWriteFields(data) {
  const meta = (data?.meta && typeof data.meta === 'object' && Object.keys(data.meta).length) ? JSON.stringify(data.meta) : null;
  return {
    source_type_id: lkId('TASK_SOURCE_TYPE', data?.type),
    source_ref: String(data?.ref ?? ''),
    source_url: String(data?.url ?? ''),
    source_meta: meta,
  };
}

// All of a task's source entries, ordered. Empty if the task isn't owned.
function getTaskSources(userId, taskId) {
  if (!ownsTask(userId, taskId)) return [];
  return db.prepare(
    'SELECT * FROM task_sources WHERE task_id = ? AND user_id = ? ORDER BY sort_order, id'
  ).all(taskId, userId).map(taskSourceToApi);
}

function nextTaskSourceSort(taskId) {
  return db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM task_sources WHERE task_id = ?').get(taskId).n;
}

// Append one source entry to a task. null if the task isn't owned.
function createTaskSource(userId, taskId, data) {
  if (!ownsTask(userId, taskId)) return null;
  const now = new Date().toISOString();
  const f = taskSourceWriteFields(data);
  let id;
  tx(() => {
    id = Number(db.prepare(
      `INSERT INTO task_sources(user_id, task_id, source_type_id, source_ref, source_url, source_meta, sort_order, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`
    ).run(userId, taskId, f.source_type_id, f.source_ref, f.source_url, f.source_meta, nextTaskSourceSort(taskId), now, now).lastInsertRowid);
  });
  return taskSourceToApi(db.prepare('SELECT * FROM task_sources WHERE id = ?').get(id));
}

// Update one source entry's fields in place. null if the caller doesn't own it.
function updateTaskSource(userId, id, data) {
  if (!ownsTaskSource(userId, id)) return null;
  const now = new Date().toISOString();
  const f = taskSourceWriteFields(data);
  tx(() => {
    db.prepare(
      `UPDATE task_sources SET source_type_id=?, source_ref=?, source_url=?, source_meta=?, updated_at=?
        WHERE id=? AND user_id=?`
    ).run(f.source_type_id, f.source_ref, f.source_url, f.source_meta, now, id, userId);
  });
  return taskSourceToApi(db.prepare('SELECT * FROM task_sources WHERE id = ?').get(id));
}

// Delete one source entry. {ok:false} if the caller doesn't own it.
function deleteTaskSource(userId, id) {
  if (!ownsTaskSource(userId, id)) return { ok: false };
  tx(() => { db.prepare('DELETE FROM task_sources WHERE id = ? AND user_id = ?').run(id, userId); });
  return { ok: true };
}

// Ownership gates + append-order helpers (all owner-scoped).
function ownsTask(userId, taskId) {
  return !!db.prepare('SELECT 1 FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
}
function ownsWorkLog(userId, logId) {
  return !!db.prepare('SELECT 1 FROM work_logs WHERE id = ? AND user_id = ?').get(logId, userId);
}
function nextTaskSort(userId) {
  return db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tasks WHERE user_id = ?').get(userId).n;
}
function nextWorkLogSort(taskId) {
  return db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM work_logs WHERE task_id = ?').get(taskId).n;
}

// All of a user's tasks with rollups (log count / total minutes / first+last log
// date) plus each task's own nested work logs, newest-task-first — the All Tasks
// page's payload (and the Tasks-picker/palette payload elsewhere, which simply
// ignores the extra field). Two queries total (not N+1): one for the tasks, one
// for every one of the user's work logs, grouped in JS by task_id.
// Milestone 7 — the lightweight base query every task list needs (id, profile
// fields, and rollups), with NO nested work_logs. Used directly by tasks:index
// (the palette/pickers/All Tasks, none of which read sessions) and as the base
// listTasks() builds on by adding workLogs — so the two channels are always
// guaranteed to agree on the same set/order/rollup numbers for every task,
// rather than risking two SQL queries drifting out of sync over time.
function getTasksIndex(userId) {
  const tasks = db.prepare(
    `SELECT t.*,
            (SELECT COUNT(*)                 FROM work_logs w WHERE w.task_id = t.id) AS logCount,
            (SELECT COALESCE(SUM(w.minutes),0) FROM work_logs w WHERE w.task_id = t.id) AS totalMinutes,
            (SELECT MIN(w.date)              FROM work_logs w WHERE w.task_id = t.id) AS firstDate,
            (SELECT MAX(w.date)              FROM work_logs w WHERE w.task_id = t.id) AS lastDate
            ${TASK_SOURCE_SUMMARY_COLS}
       FROM tasks t WHERE t.user_id = ?
      ORDER BY t.created_at DESC, t.id DESC`
  ).all(userId);
  return tasks.map(t => taskToApi(t, {
    logCount: t.logCount, totalMinutes: t.totalMinutes, firstDate: t.firstDate, lastDate: t.lastDate,
    ...taskSourceSummaryFields(t),
  }));
}

function listTasks(userId) {
  const index = getTasksIndex(userId);
  const logsByTask = new Map();
  db.prepare(`SELECT ${WORK_LOG_COLS} FROM work_logs WHERE user_id = ? ORDER BY date DESC, sort_order, id`)
    .all(userId).forEach(w => {
      const list = logsByTask.get(w.task_id) || [];
      list.push(workLogToApi(w));
      logsByTask.set(w.task_id, list);
    });
  return index.map(t => ({ ...t, workLogs: logsByTask.get(t.id) || [] }));
}

// One task in full: profile + rollups + its ordered work logs + its full
// ordered list of source entries. null if not owned.
function getTask(userId, id) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, userId);
  if (!t) return null;
  const workLogs = db.prepare(
    `SELECT ${WORK_LOG_COLS} FROM work_logs WHERE task_id = ? AND user_id = ? ORDER BY date DESC, sort_order, id`
  ).all(id, userId).map(workLogToApi);
  const roll = db.prepare(
    `SELECT COUNT(*) AS logCount, COALESCE(SUM(minutes),0) AS totalMinutes, MIN(date) AS firstDate, MAX(date) AS lastDate
       FROM work_logs WHERE task_id = ?`
  ).get(id);
  const sources = getTaskSources(userId, id);
  return taskToApi(t, {
    logCount: roll.logCount, totalMinutes: roll.totalMinutes, firstDate: roll.firstDate, lastDate: roll.lastDate, workLogs,
    sources, sourceCount: sources.length,
  });
}

// Insert a standalone task (no work logs yet — the two-level analogue of a
// "Not Yet" item). Returns the full task.
function createTask(userId, data) {
  const now = new Date().toISOString();
  const f = taskWriteFields(userId, data);
  let id;
  tx(() => {
    id = Number(db.prepare(
      `INSERT INTO tasks(user_id, name, status_id, company_id, system_id, project_id, department_id, source, sort_order, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).run(userId, f.name, f.status_id, f.company_id, f.system_id, f.project_id, f.department_id, f.source, nextTaskSort(userId), now, now).lastInsertRowid);
  });
  return getTask(userId, id);
}

// Update a task's profile fields in place (its work logs are untouched). Returns
// the refreshed task, or null if the caller doesn't own it.
function updateTask(userId, id, data) {
  if (!ownsTask(userId, id)) return null;
  const now = new Date().toISOString();
  const f = taskWriteFields(userId, data);
  tx(() => {
    db.prepare(
      `UPDATE tasks SET name=?, status_id=?, company_id=?, system_id=?, project_id=?, department_id=?, source=?, updated_at=?
        WHERE id=? AND user_id=?`
    ).run(f.name, f.status_id, f.company_id, f.system_id, f.project_id, f.department_id, f.source, now, id, userId);
  });
  return getTask(userId, id);
}

// Delete a task. ON DELETE CASCADE removes its work logs (its project link simply
// vanishes with the row, exactly as a timesheet delete did before).
function deleteTask(userId, id) {
  tx(() => { db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(id, userId); });
  return { ok: true };
}

// All work logs for one task, ordered. Empty if the task isn't owned.
function listWorkLogs(userId, taskId) {
  if (!ownsTask(userId, taskId)) return [];
  return db.prepare(
    `SELECT ${WORK_LOG_COLS} FROM work_logs WHERE task_id = ? AND user_id = ? ORDER BY date DESC, sort_order, id`
  ).all(taskId, userId).map(workLogToApi);
}

// Every work session on a date, joined to its task for context — the log-centric
// "day view" the Timesheet renders (via worklogs:byDate).
function logsForDate(userId, date) {
  return db.prepare(
    `SELECT wl.id AS id, wl.task_id AS taskId, wl.date AS date, wl.description AS description,
            wl.minutes AS minutes, wl.time_type_id AS time_type_id, wl.activity_type_id AS activity_type_id,
            wl.sort_order AS sortOrder,
            t.name AS taskName, t.status_id AS status_id, t.company_id AS company_id,
            t.system_id AS system_id,
            t.source AS source, t.project_id AS projectId
            ${TASK_SOURCE_SUMMARY_COLS}
       FROM work_logs wl JOIN tasks t ON t.id = wl.task_id
      WHERE wl.user_id = ? AND wl.date = ?
      ORDER BY wl.sort_order, wl.id`
  ).all(userId, date).map(r => ({
    id: r.id, taskId: r.taskId, taskName: r.taskName || '',
    date: r.date, description: r.description || '',
    minutes: (r.minutes === null || r.minutes === undefined) ? '' : r.minutes,
    time: lkCode(r.time_type_id),
    status: lkCode(r.status_id) || 'IN_PROGRESS',
    company: lkLabel(r.company_id), system: lkLabel(r.system_id), natural: lkLabel(r.activity_type_id),
    source: r.source || '',
    projectId: r.projectId ?? null,
    sortOrder: r.sortOrder ?? 0,
    ...taskSourceSummaryFields(r),
  }));
}

// Upsert ONLY the per-date employee name on the `days` metadata row, without
// touching any work sessions (used by the reworked Timesheet, which persists its
// work logs granularly via tasks:* / worklogs:*). Returns { ok }.
function setDayName(userId, date, name) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO days(user_id, date, employee_name, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date)
     DO UPDATE SET employee_name = excluded.employee_name, updated_at = excluded.updated_at`
  ).run(userId, date, String(name ?? ''), now, now);
  return { ok: true };
}

// The employee name recorded for a date (from the `days` metadata row), or '' —
// lets the reworked Timesheet show the day's name without loading its entries.
function getDayName(userId, date) {
  const d = getDayRow(userId, date);
  return d ? (d.employee_name || '') : '';
}

// Add a work session to a task the user owns. Returns the refreshed task (with its
// logs) plus the new log id, or { ok:false } when the task isn't owned.
function addWorkLog(userId, taskId, data) {
  if (!ownsTask(userId, taskId)) return { ok: false, error: 'task not found' };
  const now = new Date().toISOString();
  const f = workLogWriteFields(data);
  let id;
  tx(() => {
    id = Number(db.prepare(
      `INSERT INTO work_logs(user_id, task_id, date, description, minutes, time_type_id, activity_type_id, sort_order, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`
    ).run(userId, taskId, f.date, f.description, f.minutes, f.time_type_id, f.activity_type_id, nextWorkLogSort(taskId), now, now).lastInsertRowid);
  });
  return { ok: true, id, task: getTask(userId, taskId) };
}

// Field-def list — same shape/role as the Clients-page history fields above
// (VPN_HISTORY_FIELDS etc.): which columns participate in the diff, and the
// human label for each. No field here is sensitive (work_logs carries no
// credentials), so there's no third "sensitive" element to mask. time_type_id
// and activity_type_id are diffed by their lookup CODE, not the raw FK id, so
// old/new values stay a human-facing string — the same intent client_field_history's
// fields have by simply being plain TEXT columns already.
const WORK_LOG_HISTORY_FIELDS = [
  ['date', 'Date'], ['description', 'Description'], ['minutes', 'Minutes'],
  ['time_type_id', 'Time Type'], ['activity_type_id', 'Natural'],
];

// Diffs `before` against `nextValues` (both keyed by the column names above)
// and inserts one work_log_history row per field that actually changed. Must
// be called inside the same tx() as the UPDATE — mirrors recordClientFieldHistory
// exactly: only on genuine edits to an existing row, never on create or delete.
function recordWorkLogHistory(userId, workLogId, before, nextValues) {
  const now = new Date().toISOString();
  WORK_LOG_HISTORY_FIELDS.forEach(([column, label]) => {
    const oldVal = before[column] ?? '';
    const newVal = nextValues[column] ?? '';
    if (String(oldVal) === String(newVal)) return;
    db.prepare(
      `INSERT INTO work_log_history(user_id, work_log_id, field_name, old_value, new_value, changed_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, workLogId, label, String(oldVal), String(newVal), now);
  });
}

// Read-only: a work log's history, newest first — mirrors getClientFieldHistory.
function getWorkLogHistory(userId, workLogId) {
  return db.prepare(
    `SELECT id, field_name AS fieldName, old_value AS oldValue, new_value AS newValue, changed_at AS changedAt
       FROM work_log_history WHERE user_id = ? AND work_log_id = ?
       ORDER BY changed_at DESC, id DESC`
  ).all(userId, Number(workLogId));
}

// Update a work log in place. Returns { ok, task } with the refreshed parent task.
function updateWorkLog(userId, id, data) {
  if (!ownsWorkLog(userId, id)) return { ok: false, error: 'work log not found' };
  const before = db.prepare('SELECT * FROM work_logs WHERE id = ?').get(id);
  const now = new Date().toISOString();
  const f = workLogWriteFields(data);
  const beforeForDiff = {
    date: before.date, description: before.description, minutes: before.minutes,
    time_type_id: lkCode(before.time_type_id), activity_type_id: lkCode(before.activity_type_id),
  };
  const next = {
    date: f.date, description: f.description, minutes: f.minutes,
    time_type_id: lkCode(f.time_type_id), activity_type_id: lkCode(f.activity_type_id),
  };
  let taskId;
  tx(() => {
    recordWorkLogHistory(userId, id, beforeForDiff, next);
    db.prepare(
      `UPDATE work_logs SET date=?, description=?, minutes=?, time_type_id=?, activity_type_id=?, updated_at=? WHERE id=? AND user_id=?`
    ).run(f.date, f.description, f.minutes, f.time_type_id, f.activity_type_id, now, id, userId);
    taskId = db.prepare('SELECT task_id FROM work_logs WHERE id = ?').get(id)?.task_id;
  });
  return { ok: true, task: (taskId != null) ? getTask(userId, taskId) : null };
}

// Reassign a work log to a different task the user owns — e.g. it was logged
// against the wrong task and needs moving without touching its own session
// fields. Appends it to the end of the target task's sessions and records a
// 'Task' work_log_history entry (by task NAME, not id, matching every other
// history field's human-facing convention). Returns the refreshed source and
// target tasks so the caller can re-render whichever it's showing; { ok:false }
// if the work log or the target task isn't owned by this user.
function moveWorkLog(userId, workLogId, targetTaskId) {
  if (!ownsWorkLog(userId, workLogId)) return { ok: false, error: 'work log not found' };
  if (!ownsTask(userId, targetTaskId)) return { ok: false, error: 'task not found' };
  const wl = db.prepare('SELECT task_id FROM work_logs WHERE id = ?').get(workLogId);
  const fromTaskId = wl.task_id;
  if (fromTaskId === Number(targetTaskId)) {
    return { ok: true, fromTask: getTask(userId, fromTaskId), toTask: getTask(userId, targetTaskId) };
  }
  const now = new Date().toISOString();
  tx(() => {
    const fromName = db.prepare('SELECT name FROM tasks WHERE id = ?').get(fromTaskId)?.name || '(untitled task)';
    const toName = db.prepare('SELECT name FROM tasks WHERE id = ?').get(targetTaskId)?.name || '(untitled task)';
    db.prepare(
      `INSERT INTO work_log_history(user_id, work_log_id, field_name, old_value, new_value, changed_at)
       VALUES (?, ?, 'Task', ?, ?, ?)`
    ).run(userId, workLogId, fromName, toName, now);
    db.prepare(
      `UPDATE work_logs SET task_id=?, sort_order=?, updated_at=? WHERE id=? AND user_id=?`
    ).run(targetTaskId, nextWorkLogSort(targetTaskId), now, workLogId, userId);
  });
  return { ok: true, fromTask: getTask(userId, fromTaskId), toTask: getTask(userId, targetTaskId) };
}

// Merge `sourceTaskId` into `targetTaskId`: moves every one of the source's
// work_logs onto the target (appended after its existing sessions, relative
// order among the moved logs preserved) and deletes the now-empty source task.
// Mirrors moveWorkLog's per-log work_log_history entry (field 'Task', by name)
// so the audit trail reads the same whether a session moved individually or as
// part of a merge. The TARGET task's own fields are never touched — this is a
// one-way absorption, not a field-level merge. Returns the ids that moved (so
// the caller's undo can move them back onto a recreated source task via
// moveWorkLog, rather than recreating the work_log rows and losing their
// history) and the refreshed target task.
function mergeTasks(userId, sourceTaskId, targetTaskId) {
  if (!ownsTask(userId, sourceTaskId)) return { ok: false, error: 'source task not found' };
  if (!ownsTask(userId, targetTaskId)) return { ok: false, error: 'target task not found' };
  if (Number(sourceTaskId) === Number(targetTaskId)) return { ok: false, error: 'cannot merge a task into itself' };
  const now = new Date().toISOString();
  let movedWorkLogIds = [];
  tx(() => {
    const sourceName = db.prepare('SELECT name FROM tasks WHERE id = ?').get(sourceTaskId)?.name || '(untitled task)';
    const targetName = db.prepare('SELECT name FROM tasks WHERE id = ?').get(targetTaskId)?.name || '(untitled task)';
    const logs = db.prepare('SELECT id FROM work_logs WHERE task_id = ? AND user_id = ? ORDER BY sort_order')
      .all(sourceTaskId, userId);
    movedWorkLogIds = logs.map(l => l.id);
    let sort = nextWorkLogSort(targetTaskId);
    logs.forEach(({ id }) => {
      db.prepare(
        `INSERT INTO work_log_history(user_id, work_log_id, field_name, old_value, new_value, changed_at)
         VALUES (?, ?, 'Task', ?, ?, ?)`
      ).run(userId, id, sourceName, targetName, now);
      db.prepare('UPDATE work_logs SET task_id=?, sort_order=?, updated_at=? WHERE id=? AND user_id=?')
        .run(targetTaskId, sort++, now, id, userId);
    });
    db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(sourceTaskId, userId);
  });
  return { ok: true, movedWorkLogIds, task: getTask(userId, targetTaskId) };
}

// Delete a work log. Returns { ok, task } with the (still-standing) parent task so
// the caller can re-render; the task itself is never removed here.
function deleteWorkLog(userId, id) {
  let taskId;
  tx(() => {
    taskId = db.prepare('SELECT task_id FROM work_logs WHERE id = ? AND user_id = ?').get(id, userId)?.task_id;
    db.prepare('DELETE FROM work_logs WHERE id = ? AND user_id = ?').run(id, userId);
  });
  return { ok: true, task: (taskId != null) ? getTask(userId, taskId) : null };
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

// ── Maintenance panel (Milestone 6) ─────────────────────────────────────────
// Lists the auto-rotated snapshots in <userData>/backups/ (name/mtime/size),
// newest first. Read-only.
function listBackups() {
  const dir = path.join(userDataDir, 'backups');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /^cooperation-tools-.*\.db$/.test(f))
    .map(f => {
      const stat = fs.statSync(path.join(dir, f));
      return { name: f, mtime: stat.mtime.toISOString(), size: stat.size };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

// Restore the live DB from one of the files listBackups() returns — the single
// riskiest operation in the app, since it replaces the live data file wholesale.
// Never accepts an arbitrary path from the renderer: `backupFilename` is
// resolved to a basename and checked against the real backups/ directory
// listing before anything is touched. Takes a forced pre-restore backup
// (outside backups/, mirroring migration 032's pre-encryption-backup pattern)
// BEFORE closing the connection, so a mistaken restore is itself always
// recoverable. Does not touch Electron (app.relaunch/exit) — main.js's IPC
// handler does that immediately after this returns ok, since the app must
// restart for a fresh db.openConnection() to pick up the restored file.
function restoreBackup(backupFilename) {
  const safeName = path.basename(String(backupFilename || ''));
  const match = listBackups().find(b => b.name === safeName);
  if (!match) return { ok: false, error: 'backup not found' };

  const srcFile = path.join(userDataDir, 'backups', safeName);
  const liveFile = dbPath();

  const preRestoreDir = path.join(userDataDir, 'pre-restore-backup');
  fs.mkdirSync(preRestoreDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  backup(path.join(preRestoreDir, `cooperation-tools-PRE-RESTORE-${stamp}.db`));

  close(); // checkpoints + closes — must happen before the live file is replaced

  for (const suffix of ['-wal', '-shm']) {
    const stale = liveFile + suffix;
    if (fs.existsSync(stale)) fs.rmSync(stale, { force: true });
  }
  fs.copyFileSync(srcFile, liveFile);

  return { ok: true };
}

// PRAGMA integrity_check + foreign_key_check against the live DB — entirely
// read-only, safe to run any time.
function checkIntegrity() {
  const integrityRows = db.prepare('PRAGMA integrity_check').all();
  const ok = integrityRows.length === 1 && integrityRows[0].integrity_check === 'ok';
  const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
  return {
    ok: ok && fkViolations.length === 0,
    integrityMessages: ok ? [] : integrityRows.map(r => r.integrity_check),
    foreignKeyViolations: fkViolations,
  };
}

// Case-insensitive label collisions per lookup_codes category — the exact class
// of bug migration 004_merge_lookups fixed once already, and that saveLookups
// now prevents going forward (see Conventions). Read-only; surfaces any that
// still exist from before that guard was added.
function findLookupDuplicates() {
  const rows = db.prepare('SELECT id, category, code, label, is_active FROM lookup_codes ORDER BY category, id').all();
  const byCategory = new Map();
  rows.forEach(r => {
    if (!byCategory.has(r.category)) byCategory.set(r.category, new Map());
    const byLabel = byCategory.get(r.category);
    const key = r.label.trim().toLowerCase();
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key).push({ id: r.id, code: r.code, label: r.label, isActive: !!r.is_active });
  });
  const dupes = [];
  byCategory.forEach((byLabel, category) => {
    byLabel.forEach(group => { if (group.length > 1) dupes.push({ category, codes: group }); });
  });
  return dupes;
}

// Which columns actually reference each lookup category's FK id (`simple`), plus
// junction tables needing conflict-safe repointing (`junctions`, since a project
// already linked to BOTH the source and target code would violate the junction's
// composite primary key — see mergeLookupDuplicate). Scoped to the categories most
// likely to carry genuine historical duplicates: COMPANY/SYSTEM/ACTIVITY_TYPE were
// all seeded from free-text historical data by migration 003 (companies/systems/
// naturals users actually typed), unlike the small hand-curated enum categories
// (TIME_TYPE, ENTRY_STATUS, CURRENCY, etc.) that were never subject to that.
const LOOKUP_MERGE_TARGETS = {
  COMPANY: {
    simple: [
      ['tasks', 'company_id'], ['client_vpn_connections', 'company_id'], ['client_servers', 'company_id'],
      ['client_databases', 'company_id'], ['client_external_services', 'company_id'], ['client_internal_systems', 'company_id'],
    ],
    junctions: [['project_companies', 'company_id', 'project_id']],
  },
  SYSTEM: {
    simple: [['tasks', 'system_id']],
    junctions: [['project_systems', 'system_id', 'project_id']],
  },
  ACTIVITY_TYPE: {
    simple: [['work_logs', 'activity_type_id']],
    junctions: [],
  },
};

// Merges `sourceId` into `targetId` within one lookup category: repoints every
// referencing row, then deletes the now-unreferenced source code. Mirrors
// migration 004_merge_lookups' repoint-then-delete pattern, generalized to the
// CURRENT schema (004 itself is frozen — it repoints day_entries/backlog, both
// long dropped — and is never re-run). Scoped to LOOKUP_MERGE_TARGETS' three
// categories; any other category is rejected rather than guessed at.
function mergeLookupDuplicate(category, targetId, sourceId) {
  const cfg = LOOKUP_MERGE_TARGETS[category];
  if (!cfg) return { ok: false, error: 'Merging is only supported for Companies, Systems, and Natural' };
  targetId = Number(targetId); sourceId = Number(sourceId);
  if (targetId === sourceId) return { ok: false, error: 'cannot merge a code into itself' };
  const target = db.prepare('SELECT id FROM lookup_codes WHERE id = ? AND category = ?').get(targetId, category);
  const source = db.prepare('SELECT id FROM lookup_codes WHERE id = ? AND category = ?').get(sourceId, category);
  if (!target || !source) return { ok: false, error: 'code not found in this category' };

  tx(() => {
    cfg.simple.forEach(([table, column]) => {
      db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(targetId, sourceId);
    });
    cfg.junctions.forEach(([table, column, otherColumn]) => {
      const rows = db.prepare(`SELECT ${otherColumn} AS other FROM ${table} WHERE ${column} = ?`).all(sourceId);
      rows.forEach(({ other }) => {
        const exists = db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? AND ${otherColumn} = ?`).get(targetId, other);
        if (exists) db.prepare(`DELETE FROM ${table} WHERE ${column} = ? AND ${otherColumn} = ?`).run(sourceId, other);
        else db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ? AND ${otherColumn} = ?`).run(targetId, sourceId, other);
      });
    });
    db.prepare('DELETE FROM lookup_codes WHERE id = ?').run(sourceId);
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  });
  lkInvalidate();
  return { ok: true };
}

// ── Project file storage (Option A: files on disk, metadata in SQLite) ────────
// Uploaded project documents live under the SAME userData root as the DB, nested
// per project so future project-scoped file types (attachments, exports) can sit
// alongside `documents/` rather than under it. These helpers only RESOLVE paths —
// they create/copy/delete nothing (that lands in Phase 2).
//   projectsRootDir()      -> <userData>/projects
//   projectDir(id)         -> <userData>/projects/{id}
function projectsRootDir() {
  return path.join(userDataDir, 'projects');
}
function projectDir(projectId) {
  return path.join(projectsRootDir(), String(projectId));
}
// Company Documents mirrors the same layout, one level up (no per-type
// subfolder needed — each card owns at most one file):
//   companyDocumentsRootDir() -> <userData>/company_documents
//   companyDocumentDir(id)    -> <userData>/company_documents/{id}
function companyDocumentsRootDir() {
  return path.join(userDataDir, 'company_documents');
}
function companyDocumentDir(id) {
  return path.join(companyDocumentsRootDir(), String(id));
}

// ── Clients (Auth + Server Information + Databases + External Services +
// Internal Systems, per COMPANY lookup) ───────────────────────────────────────
// There is no standalone "clients" table — the client roster IS the active
// COMPANY lookup catalog (managed from Settings → Companies, same place every
// other company dropdown in the app is sourced from). These five child tables
// hold small, per-user reference records keyed to a COMPANY lookup id, the
// same shape `project_companies` uses to link a project to its clients.

// ── Credential encryption (Milestone 2) ─────────────────────────────────────
// `password`/`secret_key` columns across the five client_* tables are
// encrypted at rest via Electron's `safeStorage` (Windows DPAPI), applied
// transparently here so every other create*/update*/getClient caller — and
// the renderer, which never sees ciphertext — is unaffected. db.js itself
// never touches the `electron` module directly (it must stay requireable
// under plain Node for the test/*.js smoke tests) — main.js calls
// `configureCredentialEncryption(electron.safeStorage)` once at boot, after
// `app.whenReady()`. With no cipher configured (the default — true for every
// test run that doesn't call this), encrypt/decrypt are a no-op passthrough,
// identical to pre-Milestone-2 behavior.
//
// A stored value's `enc:v1:` prefix marks it as ciphertext (base64 of
// `safeStorage.encryptString()`'s output); anything else is treated as
// legacy/plain. This makes both directions idempotent: encrypting an
// already-prefixed value is a no-op, and decrypting an unprefixed one just
// returns it as-is — so a DB with some rows encrypted and some not (e.g. an
// interrupted migration 032, or safeStorage genuinely unavailable) is always
// readable, never throws.
const CREDENTIAL_MARKER = 'enc:v1:';
let _credentialCipher = null; // electron.safeStorage-shaped: {isEncryptionAvailable, encryptString, decryptString}
function configureCredentialEncryption(safeStorageLike) {
  _credentialCipher = safeStorageLike || null;
}
function isCredentialEncryptionAvailable() {
  try { return !!(_credentialCipher && _credentialCipher.isEncryptionAvailable()); }
  catch { return false; }
}
function encryptCredentialValue(plain) {
  if (plain == null || plain === '') return plain ?? '';
  if (typeof plain === 'string' && plain.startsWith(CREDENTIAL_MARKER)) return plain; // already encrypted
  if (!isCredentialEncryptionAvailable()) return plain; // fallback: unencrypted (flagged via isCredentialEncryptionAvailable())
  try { return CREDENTIAL_MARKER + _credentialCipher.encryptString(String(plain)).toString('base64'); }
  catch { return plain; } // never let a crypto hiccup block a save
}
function decryptCredentialValue(stored) {
  if (stored == null || stored === '') return stored ?? '';
  if (typeof stored !== 'string' || !stored.startsWith(CREDENTIAL_MARKER)) return stored; // legacy/plain passthrough
  if (!isCredentialEncryptionAvailable()) return stored; // can't decrypt without the cipher — return ciphertext, don't throw
  try { return _credentialCipher.decryptString(Buffer.from(stored.slice(CREDENTIAL_MARKER.length), 'base64')); }
  catch { return stored; }
}

const CREDENTIAL_COLUMNS = [
  ['client_vpn_connections', ['password']],
  ['client_servers', ['password']],
  ['client_databases', ['password']],
  ['client_external_services', ['secret_key']],
  ['client_internal_systems', ['password', 'secret_key']],
];
// Encrypts every still-plaintext password/secret_key across the five client_*
// tables, in place. A no-op when no cipher is configured (returns early —
// nothing to do). Called from migration 032 (the first pass, right after its
// pre-migration backup) AND from every boot's runMaintenance() — deliberately
// NOT a one-shot: migrations only ever run once, so if 032 happened to apply
// on a boot where safeStorage wasn't available yet (or a row was created
// in that window), a one-shot migration alone would never retroactively
// encrypt it. Cheap and fully idempotent (encryptCredentialValue skips
// already-`enc:v1:`-prefixed values), so running it on every boot is safe.
function encryptAllPendingCredentials() {
  if (!isCredentialEncryptionAvailable()) return { encrypted: 0 };
  let encrypted = 0;
  CREDENTIAL_COLUMNS.forEach(([table, columns]) => {
    columns.forEach(column => {
      const rows = db.prepare(`SELECT id, ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`).all();
      rows.forEach(row => {
        const enc = encryptCredentialValue(row.v);
        if (enc !== row.v) {
          db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(enc, row.id);
          encrypted++;
        }
      });
    });
  });
  return { encrypted };
}

function clientVpnToApi(r) {
  return {
    id: r.id, companyId: r.company_id, connectionName: r.connection_name, vpnType: r.vpn_type,
    endpoint: r.endpoint, port: r.port, username: r.username, password: decryptCredentialValue(r.password),
    expiryDate: r.expiry_date || '', credentialLocation: r.credential_location || '',
    notes: r.notes, sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function clientServerToApi(r) {
  return {
    id: r.id, companyId: r.company_id, serverName: r.server_name, host: r.host, environment: r.environment,
    os: r.os, hostname: r.hostname, username: r.username, password: decryptCredentialValue(r.password), systemName: r.system_name,
    role: r.role || '', port: r.port || '', credentialLocation: r.credential_location || '',
    notes: r.notes, sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function clientDatabaseToApi(r) {
  return {
    id: r.id, companyId: r.company_id, name: r.name, engine: r.engine, host: r.host, port: r.port,
    username: r.username, password: decryptCredentialValue(r.password), version: r.version || '', credentialLocation: r.credential_location || '',
    notes: r.notes, sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function clientExternalServiceToApi(r) {
  return {
    id: r.id, companyId: r.company_id, name: r.name, url: r.url, companyCode: r.company_code,
    secretKey: decryptCredentialValue(r.secret_key), expiryDate: r.expiry_date || '', contact: r.contact || '',
    notes: r.notes, sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function clientInternalSystemToApi(r) {
  return {
    id: r.id, companyId: r.company_id, name: r.name, url: r.url, username: r.username, password: decryptCredentialValue(r.password),
    systemName: r.system_name, environment: r.environment, companyCode: r.company_code, secretKey: decryptCredentialValue(r.secret_key),
    expiryDate: r.expiry_date || '', role: r.role || '',
    subServices: safeParse(r.sub_services, []),
    notes: r.notes, sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ── Field-edit history (audit trail) ────────────────────────────────────────
// One row per changed field on an UPDATE to any of the five client_* tables
// (never on create/delete — delete-undo re-creates from a snapshot, which is
// a create, not an edit). `record_type` distinguishes which of the five
// tables `record_id` points into (see migration 027 for why there's no FK).
// Field-def lists below double as: (a) which columns participate in the
// diff, (b) the human label shown in the confirm dialog / history view, and
// (c) which fields are `sensitive` — those log a fixed '(hidden)' placeholder
// instead of the real value, so a permanent, potentially-backed-up audit
// table doesn't become a second store of every credential's full history.
const VPN_HISTORY_FIELDS = [
  ['connection_name', 'Connection Name'], ['vpn_type', 'Type'], ['endpoint', 'Endpoint'],
  ['port', 'Port'], ['username', 'Username'], ['password', 'Password', true],
  ['expiry_date', 'Expiry Date'], ['credential_location', 'Credential Location'], ['notes', 'Notes'],
];
const SERVER_HISTORY_FIELDS = [
  ['server_name', 'Server Name'], ['host', 'Host (IP)'], ['environment', 'Environment'], ['os', 'Operating System'],
  ['hostname', 'Hostname'], ['username', 'Username'], ['password', 'Password', true], ['system_name', 'System Name'],
  ['role', 'Role'], ['port', 'Port'], ['credential_location', 'Credential Location'], ['notes', 'Notes'],
];
const DATABASE_HISTORY_FIELDS = [
  ['name', 'Name'], ['engine', 'Engine'], ['host', 'Host'], ['port', 'Port'], ['username', 'Username'],
  ['password', 'Password', true], ['version', 'Version'], ['credential_location', 'Credential Location'], ['notes', 'Notes'],
];
const EXTERNAL_HISTORY_FIELDS = [
  ['name', 'Name'], ['url', 'URL'], ['company_code', 'Company Code'], ['secret_key', 'Secret Key', true],
  ['expiry_date', 'Expiry Date'], ['contact', 'Contact'], ['notes', 'Notes'],
];
const INTERNAL_HISTORY_FIELDS = [
  ['name', 'Name'], ['url', 'URL'], ['username', 'Username'], ['password', 'Password', true],
  ['system_name', 'System Name'], ['environment', 'Environment'], ['company_code', 'Company Code'],
  ['secret_key', 'Secret Key', true], ['expiry_date', 'Expiry Date'], ['role', 'Role'],
  ['sub_services', 'Sub-Services'], ['notes', 'Notes'],
];

// Diffs `before` (a raw DB row) against `nextValues` (the same shape of
// column -> new value the UPDATE is about to write) and inserts one
// client_field_history row per field that actually changed. Must be called
// inside the same tx() as the UPDATE so an edit can never commit without its
// audit row (or vice versa).
function recordClientFieldHistory(userId, recordType, recordId, before, nextValues, fieldDefs) {
  const now = new Date().toISOString();
  fieldDefs.forEach(([column, label, sensitive]) => {
    const oldVal = before[column] ?? '';
    const newVal = nextValues[column] ?? '';
    if (String(oldVal) === String(newVal)) return;
    const oldStr = sensitive ? '(hidden)' : String(oldVal);
    const newStr = sensitive ? '(hidden)' : String(newVal);
    db.prepare(
      `INSERT INTO client_field_history(user_id, record_type, record_id, field_name, old_value, new_value, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, recordType, recordId, label, oldStr, newStr, now);
  });
}

// Read-only: a record's history, newest first. `recordType` matches the
// discriminator used above ('vpn'|'server'|'database'|'external'|'internal').
function getClientFieldHistory(userId, recordType, recordId) {
  return db.prepare(
    `SELECT id, field_name AS fieldName, old_value AS oldValue, new_value AS newValue, changed_at AS changedAt
       FROM client_field_history WHERE user_id = ? AND record_type = ? AND record_id = ?
       ORDER BY changed_at DESC, id DESC`
  ).all(userId, recordType, Number(recordId));
}

// The Clients list page: every active COMPANY lookup, each with its auth/
// server/database/external-service/internal-system counts for this user
// (zero-activity companies still show — this is the catalog roster, not a
// work-log rollup like Browse's company list).
// Groups rows by company_id: `counts` for the card's "N servers"-style tally,
// `records` building one search-result-table row per record via `toRecord`
// — { type, typeLabel, name, detail, fields } using only human-identifying
// (never password/secretKey) columns — used by the list-view records search
// so a client with e.g. a "VPN"-typed Auth entry surfaces without opening
// its detail view first.
function groupClientRows(rows, toRecord) {
  const counts = new Map();
  const records = new Map();
  for (const r of rows) {
    counts.set(r.company_id, (counts.get(r.company_id) || 0) + 1);
    if (!records.has(r.company_id)) records.set(r.company_id, []);
    records.get(r.company_id).push(toRecord(r));
  }
  return { counts, records };
}

function listClients(userId) {
  const companies = getLookupsByCategory('COMPANY');
  const vpn = groupClientRows(
    db.prepare('SELECT id, company_id, connection_name, vpn_type, endpoint FROM client_vpn_connections WHERE user_id = ?').all(userId),
    r => ({
      id: r.id, type: 'auth', typeLabel: 'Auth', name: r.connection_name || r.vpn_type || '(unnamed)',
      detail: [r.vpn_type, r.endpoint].filter(Boolean).join(' · '),
      fields: [r.connection_name, r.vpn_type, r.endpoint].filter(Boolean),
    })
  );
  const srv = groupClientRows(
    db.prepare('SELECT id, company_id, server_name, host, hostname, system_name FROM client_servers WHERE user_id = ?').all(userId),
    r => ({
      id: r.id, type: 'servers', typeLabel: 'Server', name: r.server_name || '(unnamed)',
      detail: [r.host, r.hostname, r.system_name].filter(Boolean).join(' · '),
      fields: [r.server_name, r.host, r.hostname, r.system_name].filter(Boolean),
    })
  );
  const dbase = groupClientRows(
    db.prepare('SELECT id, company_id, name, engine, host FROM client_databases WHERE user_id = ?').all(userId),
    r => ({
      id: r.id, type: 'databases', typeLabel: 'Database', name: r.name || '(unnamed)',
      detail: [r.engine, r.host].filter(Boolean).join(' · '),
      fields: [r.name, r.engine, r.host].filter(Boolean),
    })
  );
  const ext = groupClientRows(
    db.prepare('SELECT id, company_id, name, url FROM client_external_services WHERE user_id = ?').all(userId),
    r => ({
      id: r.id, type: 'external', typeLabel: 'External', name: r.name || '(unnamed)',
      detail: r.url || '', fields: [r.name, r.url].filter(Boolean),
    })
  );
  const int_ = groupClientRows(
    db.prepare('SELECT id, company_id, name, url, system_name FROM client_internal_systems WHERE user_id = ?').all(userId),
    r => ({
      id: r.id, type: 'internal', typeLabel: 'Internal', name: r.name || '(unnamed)',
      detail: [r.system_name, r.url].filter(Boolean).join(' · '),
      fields: [r.name, r.url, r.system_name].filter(Boolean),
    })
  );
  return companies.map(c => ({
    id: c.id, label: c.label,
    vpnCount: vpn.counts.get(c.id) || 0, serverCount: srv.counts.get(c.id) || 0, databaseCount: dbase.counts.get(c.id) || 0,
    externalServiceCount: ext.counts.get(c.id) || 0, internalSystemCount: int_.counts.get(c.id) || 0,
    records: [
      ...(vpn.records.get(c.id) || []), ...(srv.records.get(c.id) || []), ...(dbase.records.get(c.id) || []),
      ...(ext.records.get(c.id) || []), ...(int_.records.get(c.id) || []),
    ],
  }));
}

// One client's detail: the COMPANY lookup's label + its auth connections,
// servers, databases, external services, and internal systems (all ordered).
// Returns null if companyId isn't a real COMPANY row.
function getClient(userId, companyId) {
  if (!isLookupId('COMPANY', Number(companyId))) return null;
  const vpnConnections = db.prepare(
    'SELECT * FROM client_vpn_connections WHERE company_id = ? AND user_id = ? ORDER BY sort_order, id'
  ).all(companyId, userId).map(clientVpnToApi);
  const servers = db.prepare(
    'SELECT * FROM client_servers WHERE company_id = ? AND user_id = ? ORDER BY sort_order, id'
  ).all(companyId, userId).map(clientServerToApi);
  const databases = db.prepare(
    'SELECT * FROM client_databases WHERE company_id = ? AND user_id = ? ORDER BY sort_order, id'
  ).all(companyId, userId).map(clientDatabaseToApi);
  const externalServices = db.prepare(
    'SELECT * FROM client_external_services WHERE company_id = ? AND user_id = ? ORDER BY sort_order, id'
  ).all(companyId, userId).map(clientExternalServiceToApi);
  const internalSystems = db.prepare(
    'SELECT * FROM client_internal_systems WHERE company_id = ? AND user_id = ? ORDER BY sort_order, id'
  ).all(companyId, userId).map(clientInternalSystemToApi);
  return { id: Number(companyId), label: lkLabel(Number(companyId)), vpnConnections, servers, databases, externalServices, internalSystems };
}

function createClientVpn(userId, companyId, data) {
  if (!isLookupId('COMPANY', Number(companyId))) return null;
  const now = new Date().toISOString();
  const id = Number(db.prepare(
    `INSERT INTO client_vpn_connections(user_id, company_id, connection_name, vpn_type, endpoint, port, username, password, expiry_date, credential_location, notes, sort_order, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(userId, companyId, data?.connectionName ?? '', data?.vpnType ?? '', data?.endpoint ?? '',
        data?.port ?? '', data?.username ?? '', encryptCredentialValue(data?.password ?? ''), data?.expiryDate ?? null,
        data?.credentialLocation ?? '', data?.notes ?? '', now, now).lastInsertRowid);
  return clientVpnToApi(db.prepare('SELECT * FROM client_vpn_connections WHERE id = ?').get(id));
}
function updateClientVpn(userId, id, data) {
  const beforeRaw = db.prepare('SELECT * FROM client_vpn_connections WHERE id = ? AND user_id = ?').get(id, userId);
  if (!beforeRaw) return null;
  const before = { ...beforeRaw, password: decryptCredentialValue(beforeRaw.password) }; // plaintext for the diff below
  const next = {
    connection_name: data?.connectionName ?? '', vpn_type: data?.vpnType ?? '', endpoint: data?.endpoint ?? '',
    port: data?.port ?? '', username: data?.username ?? '', password: data?.password ?? '',
    expiry_date: data?.expiryDate ?? null, credential_location: data?.credentialLocation ?? '', notes: data?.notes ?? '',
  };
  tx(() => {
    recordClientFieldHistory(userId, 'vpn', id, before, next, VPN_HISTORY_FIELDS);
    db.prepare(
      `UPDATE client_vpn_connections SET connection_name = ?, vpn_type = ?, endpoint = ?, port = ?, username = ?, password = ?,
         expiry_date = ?, credential_location = ?, notes = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`
    ).run(next.connection_name, next.vpn_type, next.endpoint, next.port, next.username, encryptCredentialValue(next.password),
          next.expiry_date, next.credential_location, next.notes, new Date().toISOString(), id, userId);
  });
  return clientVpnToApi(db.prepare('SELECT * FROM client_vpn_connections WHERE id = ?').get(id));
}
function deleteClientVpn(userId, id) {
  db.prepare('DELETE FROM client_vpn_connections WHERE id = ? AND user_id = ?').run(id, userId);
  return { ok: true };
}

function createClientServer(userId, companyId, data) {
  if (!isLookupId('COMPANY', Number(companyId))) return null;
  const now = new Date().toISOString();
  const id = Number(db.prepare(
    `INSERT INTO client_servers(user_id, company_id, server_name, host, environment, os, hostname, username, password, system_name, role, port, credential_location, notes, sort_order, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(userId, companyId, data?.serverName ?? '', data?.host ?? '', data?.environment ?? '', data?.os ?? '',
        data?.hostname ?? '', data?.username ?? '', encryptCredentialValue(data?.password ?? ''), data?.systemName ?? '',
        data?.role ?? '', data?.port ?? '', data?.credentialLocation ?? '', data?.notes ?? '', now, now).lastInsertRowid);
  return clientServerToApi(db.prepare('SELECT * FROM client_servers WHERE id = ?').get(id));
}
function updateClientServer(userId, id, data) {
  const beforeRaw = db.prepare('SELECT * FROM client_servers WHERE id = ? AND user_id = ?').get(id, userId);
  if (!beforeRaw) return null;
  const before = { ...beforeRaw, password: decryptCredentialValue(beforeRaw.password) };
  const next = {
    server_name: data?.serverName ?? '', host: data?.host ?? '', environment: data?.environment ?? '', os: data?.os ?? '',
    hostname: data?.hostname ?? '', username: data?.username ?? '', password: data?.password ?? '', system_name: data?.systemName ?? '',
    role: data?.role ?? '', port: data?.port ?? '', credential_location: data?.credentialLocation ?? '', notes: data?.notes ?? '',
  };
  tx(() => {
    recordClientFieldHistory(userId, 'server', id, before, next, SERVER_HISTORY_FIELDS);
    db.prepare(
      `UPDATE client_servers SET server_name = ?, host = ?, environment = ?, os = ?, hostname = ?, username = ?, password = ?,
         system_name = ?, role = ?, port = ?, credential_location = ?, notes = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`
    ).run(next.server_name, next.host, next.environment, next.os, next.hostname, next.username, encryptCredentialValue(next.password),
          next.system_name, next.role, next.port, next.credential_location, next.notes, new Date().toISOString(), id, userId);
  });
  return clientServerToApi(db.prepare('SELECT * FROM client_servers WHERE id = ?').get(id));
}
function deleteClientServer(userId, id) {
  db.prepare('DELETE FROM client_servers WHERE id = ? AND user_id = ?').run(id, userId);
  return { ok: true };
}
function renameClientServerSystemGroup(userId, companyId, oldName, newName) {
  const from = String(oldName ?? '').trim();
  const to = String(newName ?? '').trim();
  if (!from || !to) return { ok: false, count: 0 };
  const info = db.prepare(
    `UPDATE client_servers SET system_name = ?, updated_at = ?
      WHERE user_id = ? AND company_id = ? AND LOWER(system_name) = LOWER(?)`
  ).run(to, new Date().toISOString(), userId, companyId, from);
  return { ok: true, count: info.changes };
}
// Bulk-assigns an explicit set of servers into a (new or existing) System group,
// as opposed to renameClientServerSystemGroup's match-by-old-name bulk rename.
function assignClientServerGroup(userId, companyId, recordIds, groupName) {
  const name = String(groupName ?? '').trim();
  if (!name || !Array.isArray(recordIds) || !recordIds.length) return { ok: false, count: 0 };
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `UPDATE client_servers SET system_name = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND company_id = ?`
  );
  let count = 0;
  tx(() => { recordIds.forEach(id => { count += stmt.run(name, now, id, userId, companyId).changes; }); });
  return { ok: true, count };
}

function createClientDatabase(userId, companyId, data) {
  if (!isLookupId('COMPANY', Number(companyId))) return null;
  const now = new Date().toISOString();
  const id = Number(db.prepare(
    `INSERT INTO client_databases(user_id, company_id, name, engine, host, port, username, password, version, credential_location, notes, sort_order, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(userId, companyId, data?.name ?? '', data?.engine ?? '', data?.host ?? '',
        data?.port ?? '', data?.username ?? '', encryptCredentialValue(data?.password ?? ''), data?.version ?? '',
        data?.credentialLocation ?? '', data?.notes ?? '', now, now).lastInsertRowid);
  return clientDatabaseToApi(db.prepare('SELECT * FROM client_databases WHERE id = ?').get(id));
}
function updateClientDatabase(userId, id, data) {
  const beforeRaw = db.prepare('SELECT * FROM client_databases WHERE id = ? AND user_id = ?').get(id, userId);
  if (!beforeRaw) return null;
  const before = { ...beforeRaw, password: decryptCredentialValue(beforeRaw.password) };
  const next = {
    name: data?.name ?? '', engine: data?.engine ?? '', host: data?.host ?? '', port: data?.port ?? '',
    username: data?.username ?? '', password: data?.password ?? '',
    version: data?.version ?? '', credential_location: data?.credentialLocation ?? '', notes: data?.notes ?? '',
  };
  tx(() => {
    recordClientFieldHistory(userId, 'database', id, before, next, DATABASE_HISTORY_FIELDS);
    db.prepare(
      `UPDATE client_databases SET name = ?, engine = ?, host = ?, port = ?, username = ?, password = ?,
         version = ?, credential_location = ?, notes = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`
    ).run(next.name, next.engine, next.host, next.port, next.username, encryptCredentialValue(next.password),
          next.version, next.credential_location, next.notes, new Date().toISOString(), id, userId);
  });
  return clientDatabaseToApi(db.prepare('SELECT * FROM client_databases WHERE id = ?').get(id));
}
function deleteClientDatabase(userId, id) {
  db.prepare('DELETE FROM client_databases WHERE id = ? AND user_id = ?').run(id, userId);
  return { ok: true };
}

function createClientExternalService(userId, companyId, data) {
  if (!isLookupId('COMPANY', Number(companyId))) return null;
  const now = new Date().toISOString();
  const id = Number(db.prepare(
    `INSERT INTO client_external_services(user_id, company_id, name, url, company_code, secret_key, expiry_date, contact, notes, sort_order, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(userId, companyId, data?.name ?? '', data?.url ?? '', data?.companyCode ?? '', encryptCredentialValue(data?.secretKey ?? ''),
        data?.expiryDate ?? null, data?.contact ?? '', data?.notes ?? '', now, now).lastInsertRowid);
  return clientExternalServiceToApi(db.prepare('SELECT * FROM client_external_services WHERE id = ?').get(id));
}
function updateClientExternalService(userId, id, data) {
  const beforeRaw = db.prepare('SELECT * FROM client_external_services WHERE id = ? AND user_id = ?').get(id, userId);
  if (!beforeRaw) return null;
  const before = { ...beforeRaw, secret_key: decryptCredentialValue(beforeRaw.secret_key) };
  const next = {
    name: data?.name ?? '', url: data?.url ?? '', company_code: data?.companyCode ?? '', secret_key: data?.secretKey ?? '',
    expiry_date: data?.expiryDate ?? null, contact: data?.contact ?? '', notes: data?.notes ?? '',
  };
  tx(() => {
    recordClientFieldHistory(userId, 'external', id, before, next, EXTERNAL_HISTORY_FIELDS);
    db.prepare(
      `UPDATE client_external_services SET name = ?, url = ?, company_code = ?, secret_key = ?, expiry_date = ?, contact = ?, notes = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`
    ).run(next.name, next.url, next.company_code, encryptCredentialValue(next.secret_key), next.expiry_date, next.contact, next.notes,
          new Date().toISOString(), id, userId);
  });
  return clientExternalServiceToApi(db.prepare('SELECT * FROM client_external_services WHERE id = ?').get(id));
}
function deleteClientExternalService(userId, id) {
  db.prepare('DELETE FROM client_external_services WHERE id = ? AND user_id = ?').run(id, userId);
  return { ok: true };
}

function normalizeSubServices(subServices) {
  if (!Array.isArray(subServices)) return [];
  return subServices
    .map(s => ({ label: String(s?.label ?? '').trim(), url: String(s?.url ?? '').trim() }))
    .filter(s => s.label || s.url);
}

function createClientInternalSystem(userId, companyId, data) {
  if (!isLookupId('COMPANY', Number(companyId))) return null;
  const now = new Date().toISOString();
  const id = Number(db.prepare(
    `INSERT INTO client_internal_systems(user_id, company_id, name, url, username, password, system_name, environment, company_code, secret_key, expiry_date, role, sub_services, notes, sort_order, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(userId, companyId, data?.name ?? '', data?.url ?? '', data?.username ?? '', encryptCredentialValue(data?.password ?? ''),
        data?.systemName ?? '', data?.environment ?? '', data?.companyCode ?? '', encryptCredentialValue(data?.secretKey ?? ''),
        data?.expiryDate ?? null, data?.role ?? '',
        JSON.stringify(normalizeSubServices(data?.subServices)), data?.notes ?? '', now, now).lastInsertRowid);
  return clientInternalSystemToApi(db.prepare('SELECT * FROM client_internal_systems WHERE id = ?').get(id));
}
function updateClientInternalSystem(userId, id, data) {
  const beforeRaw = db.prepare('SELECT * FROM client_internal_systems WHERE id = ? AND user_id = ?').get(id, userId);
  if (!beforeRaw) return null;
  const before = { ...beforeRaw, password: decryptCredentialValue(beforeRaw.password), secret_key: decryptCredentialValue(beforeRaw.secret_key) };
  const next = {
    name: data?.name ?? '', url: data?.url ?? '', username: data?.username ?? '', password: data?.password ?? '',
    system_name: data?.systemName ?? '', environment: data?.environment ?? '', company_code: data?.companyCode ?? '',
    secret_key: data?.secretKey ?? '', expiry_date: data?.expiryDate ?? null, role: data?.role ?? '',
    sub_services: JSON.stringify(normalizeSubServices(data?.subServices)), notes: data?.notes ?? '',
  };
  tx(() => {
    recordClientFieldHistory(userId, 'internal', id, before, next, INTERNAL_HISTORY_FIELDS);
    db.prepare(
      `UPDATE client_internal_systems SET name = ?, url = ?, username = ?, password = ?, system_name = ?, environment = ?,
         company_code = ?, secret_key = ?, expiry_date = ?, role = ?, sub_services = ?, notes = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`
    ).run(next.name, next.url, next.username, encryptCredentialValue(next.password), next.system_name, next.environment,
          next.company_code, encryptCredentialValue(next.secret_key), next.expiry_date, next.role, next.sub_services, next.notes,
          new Date().toISOString(), id, userId);
  });
  return clientInternalSystemToApi(db.prepare('SELECT * FROM client_internal_systems WHERE id = ?').get(id));
}
function deleteClientInternalSystem(userId, id) {
  db.prepare('DELETE FROM client_internal_systems WHERE id = ? AND user_id = ?').run(id, userId);
  return { ok: true };
}
function renameClientInternalSystemGroup(userId, companyId, oldName, newName) {
  const from = String(oldName ?? '').trim();
  const to = String(newName ?? '').trim();
  if (!from || !to) return { ok: false, count: 0 };
  const info = db.prepare(
    `UPDATE client_internal_systems SET system_name = ?, updated_at = ?
      WHERE user_id = ? AND company_id = ? AND LOWER(system_name) = LOWER(?)`
  ).run(to, new Date().toISOString(), userId, companyId, from);
  return { ok: true, count: info.changes };
}
// Bulk-assigns an explicit set of internal systems into a (new or existing) System
// group, as opposed to renameClientInternalSystemGroup's match-by-old-name bulk rename.
function assignClientInternalGroup(userId, companyId, recordIds, groupName) {
  const name = String(groupName ?? '').trim();
  if (!name || !Array.isArray(recordIds) || !recordIds.length) return { ok: false, count: 0 };
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `UPDATE client_internal_systems SET system_name = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND company_id = ?`
  );
  let count = 0;
  tx(() => { recordIds.forEach(id => { count += stmt.run(name, now, id, userId, companyId).changes; }); });
  return { ok: true, count };
}

module.exports = {
  openConnection, applyMigrations, runMaintenance,
  close, backup, dbPath,
  projectsRootDir, projectDir,
  countUsers, getUserByUsername, createUser, getUnclaimedUser, claimUser,
  listDays, loadDaysRange,
  listCompanies, listSystems, companyEntries, systemEntries, getFilteredWorkLogs,
  getAnalytics, getOverviewStats, getAttentionItems,
  createProject, listProjects, getProject, updateProject, deleteProject,
  linkTask, unlinkTask, listLinkableTasks,
  listDepartments, getDepartment, linkDepartmentTask, unlinkDepartmentTask, listLinkableTasksForDepartment,
  listTasks, getTasksIndex, getTask, createTask, updateTask, deleteTask,
  getTaskSources, createTaskSource, updateTaskSource, deleteTaskSource,
  listWorkLogs, logsForDate, addWorkLog, updateWorkLog, moveWorkLog, mergeTasks, deleteWorkLog, getWorkLogHistory,
  setDayName, getDayName,
  saveProjectDocumentFile, resolveProjectDocumentFile, removeProjectDocumentFile,
  purgeProjectFiles, restoreProjectFiles,
  listCompanyDocuments, getCompanyDocument, createCompanyDocument, updateCompanyDocument, deleteCompanyDocument,
  saveCompanyDocumentFile, resolveCompanyDocumentFile, removeCompanyDocumentFile,
  purgeCompanyDocumentFiles, restoreCompanyDocumentFile, companyDocumentsRootDir,
  listClients, getClient, getClientFieldHistory,
  configureCredentialEncryption, isCredentialEncryptionAvailable, encryptCredentialValue, decryptCredentialValue,
  encryptAllPendingCredentials,
  createClientVpn, updateClientVpn, deleteClientVpn,
  createClientServer, updateClientServer, deleteClientServer, renameClientServerSystemGroup, assignClientServerGroup,
  createClientDatabase, updateClientDatabase, deleteClientDatabase,
  createClientExternalService, updateClientExternalService, deleteClientExternalService,
  createClientInternalSystem, updateClientInternalSystem, deleteClientInternalSystem, renameClientInternalSystemGroup, assignClientInternalGroup,
  loadLookups, saveLookups, getLookupsByCategory,
  loadSubscriptions, saveSubscriptions,
  loadPrefs, savePrefs,
  listBackups, restoreBackup, checkIntegrity, findLookupDuplicates, mergeLookupDuplicate, getOrphanSweepReport,
};
