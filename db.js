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
const crypto = require('node:crypto');

// ── Lookup catalog categories (see migration 003) ────────────────────────────
// Every bounded category/type/status field is normalized into the `lookup_codes`
// table under one of these category discriminators. The renderer fetches options
// per-category and stores a stable `code` (logic fields) or display `label`
// (company/system/activity) — never a hardcoded string.
const LOOKUP_CATEGORIES = ['COMPANY', 'SYSTEM', 'ACTIVITY_TYPE', 'TIME_TYPE', 'ENTRY_STATUS', 'CURRENCY', 'BILLING_CYCLE', 'PROJECT_STATUS', 'PROJECT_DOCUMENT', 'COMPANY_DOCUMENT_CATEGORY', 'KNOWLEDGE_TYPE', 'DEPARTMENT', 'TASK_SOURCE_TYPE', 'SERVER_ROLE'];

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

// Resolve a path and prove it stays inside the expected root. Renderer-controlled
// lookup codes and database metadata must never escape userData.
function resolveInside(root, ...parts) {
  const base = path.resolve(root);
  const candidate = path.resolve(base, ...parts.map(p => String(p ?? '')));
  const rel = path.relative(base, candidate);
  if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) {
    throw new Error('Resolved path is outside the allowed data directory');
  }
  return candidate;
}

function resolveStoredPath(relativePath) {
  if (!relativePath || path.isAbsolute(String(relativePath))) throw new Error('Invalid stored file path');
  return resolveInside(userDataDir, relativePath);
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
function userGet(userId, key) {
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key);
  return row ? row.value : undefined;
}
function userSet(userId, key, value) {
  db.prepare(`INSERT INTO user_settings(user_id, key, value) VALUES(?, ?, ?)
              ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`).run(userId, key, value);
}

// ── Lookup catalog cache (normalized categories) ──────────────────────────────
// An in-memory snapshot of `lookup_codes`, rebuilt lazily and invalidated on edit.
// Used to resolve a category value → its id on WRITE (accepting either the stable
// `code` or the display `label`), and an id → its code/label on READ.
let lkCache = null;
function lkBuild() {
  const rows = db.prepare(
    'SELECT id, category, code, label, name_en, name_ar, sort_order, is_active FROM lookup_codes ORDER BY category, sort_order, id'
  ).all();
  const byCat = {}, idTo = new Map(), valToId = new Map();
  for (const r of rows) {
    (byCat[r.category] ||= []).push(r);
    idTo.set(r.id, r);
    valToId.set(r.category + '|' + r.code, r.id);
    // a display label resolves too (company/system rows round-trip by label)
    if (!valToId.has(r.category + '|' + r.label)) valToId.set(r.category + '|' + r.label, r.id);
    if (r.name_en && !valToId.has(r.category + '|' + r.name_en)) valToId.set(r.category + '|' + r.name_en, r.id);
    if (r.name_ar && !valToId.has(r.category + '|' + r.name_ar)) valToId.set(r.category + '|' + r.name_ar, r.id);
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
function companyProfileFields(id) {
  const r = id == null ? null : lk().idTo.get(Number(id));
  if (!r || r.category !== 'COMPANY') return { companyCode: '', companyNameEn: '', companyNameAr: '' };
  return { companyCode: r.code || '', companyNameEn: r.name_en || r.label || '', companyNameAr: r.name_ar || '' };
}
// True if `id` is a real lookup row in the given category — used to validate FK ids
// arriving from the renderer (companies multi-select, project system) before storing.
function isLookupId(category, id) {
  if (id == null || id === '') return false;
  const r = lk().idTo.get(Number(id));
  return !!(r && r.category === category);
}
// True if `id` is a lookup row that is still active (not soft-disabled). Lets a
// mapper tell a live value from a retired one — e.g. client_servers.role_id
// pointing at one of migration 038's soft-disabled nullN placeholders.
function isLookupActive(id) {
  if (id == null || id === '') return false;
  const r = lk().idTo.get(Number(id));
  return !!(r && r.is_active);
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
// `PRAGMA foreign_keys` must toggle outside a transaction). A migration marked
// `destructive: true` receives a full snapshot before it runs on an existing DB.
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
    if (m.destructive && !dbWasNew) {
      const dir = path.join(userDataDir, 'pre-migration-backup');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      backup(path.join(dir, `cooperation-tools-PRE-MIGRATION-${m.version}-${stamp}.db`));
    }
    const run = () => { m.up(db); record.run(m.version, m.name, new Date().toISOString()); };
    if (m.manualTransaction) run();   // migration owns its own tx/PRAGMA sequencing
    else tx(run);
  }
}

// Step 3 — best-effort housekeeping. Never throws; never blocks boot.
function runMaintenance() {
  // Security maintenance must precede every automatic snapshot. A database
  // that first gained safeStorage after migration 032 may still contain
  // pending plaintext values; rotating before this pass would preserve them.
  try {
    encryptAllPendingCredentials();
    sanitizeLegacyCredentialBackups();
  }
  catch (err) { console.error('[security] credential maintenance failed:', String(err?.message || err)); }
  const backup = !dbWasNew ? rotateBackups() : { ok: true, skipped: true };
  const projectIds = sweepOrphanProjectFiles();        // drop file folders for projects that no longer exist
  const companyDocumentIds = sweepOrphanCompanyDocumentFiles(); // same, for company_documents/{id}/ folders
  const knowledgeItemIds = sweepOrphanKnowledgeFiles();
  _lastOrphanSweepReport = { projectIds, companyDocumentIds, knowledgeItemIds, backup, ranAt: new Date().toISOString() };
  return _lastOrphanSweepReport;
}
// A lookup with no access rows is global. Once any access row exists it is
// private and only the listed users may resolve or select it.
function canAccessLookup(userId, id) {
  if (id == null || id === '') return false;
  const restricted = db.prepare('SELECT 1 FROM lookup_code_user_access WHERE lookup_id = ? LIMIT 1').get(Number(id));
  if (!restricted) return true;
  if (userId == null) return false;
  return !!db.prepare('SELECT 1 FROM lookup_code_user_access WHERE lookup_id = ? AND user_id = ?').get(Number(id), Number(userId));
}
function lkIdForUser(userId, category, value) {
  const id = lkId(category, value);
  return id != null && canAccessLookup(userId, id) ? id : null;
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
let _lastOrphanSweepReport = { projectIds: [], companyDocumentIds: [], knowledgeItemIds: [], backup: null, ranAt: null };
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
    return { ok: true };
  } catch (err) {
    const error = String(err?.message || err);
    console.error('[backup] automatic rotation failed:', error);
    return { ok: false, error };
  }
}

function sweepOrphanKnowledgeFiles() {
  const removed = [];
  try {
    const root = knowledgeRootDir();
    if (!fs.existsSync(root)) return removed;
    const live = new Set(db.prepare('SELECT id FROM knowledge_items').all().map(r => String(r.id)));
    for (const name of fs.readdirSync(root)) {
      if (/^\d+$/.test(name) && !live.has(name)) {
        fs.rmSync(path.join(root, name), { recursive: true, force: true });
        removed.push(name);
      }
    }
  } catch { /* non-critical */ }
  return removed;
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
  db.prepare('UPDATE users SET username = ?, password_hash = ?, is_active = 1, is_admin = 1 WHERE id = ?')
    .run(username, passwordHash, id);
}

function getUserByUsername(username) {
  return db.prepare(
    'SELECT id, username, password_hash, created_at, is_active, is_admin FROM users WHERE username = ?'
  ).get(username) || null;
}

function getUserById(id) {
  return db.prepare(
    'SELECT id, username, password_hash, created_at, is_active, is_admin FROM users WHERE id = ?'
  ).get(id) || null;
}

function listUsers() {
  return db.prepare(
    `SELECT id, username, created_at AS createdAt, is_active AS isActive, is_admin AS isAdmin
       FROM users
      WHERE username != '__unclaimed__'
      ORDER BY is_active DESC, LOWER(username), id`
  ).all().map(row => ({
    ...row,
    isActive: !!row.isActive,
    isAdmin: !!row.isAdmin,
  }));
}

function countActiveAdmins() {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_active = 1 AND is_admin = 1').get().n;
}

// Insert a new account and return its generated id. Caller supplies an already
// hashed password. Throws on a duplicate username (UNIQUE constraint).
function createUser(username, passwordHash, isAdmin = false) {
  const info = db.prepare(
    'INSERT INTO users(username, password_hash, created_at, is_active, is_admin) VALUES(?, ?, ?, 1, ?)'
  ).run(username, passwordHash, new Date().toISOString(), isAdmin ? 1 : 0);
  return Number(info.lastInsertRowid);
}

function updateUserPassword(id, passwordHash) {
  return db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND is_active = 1')
    .run(passwordHash, id).changes > 0;
}

function updateUserAccount(id, data) {
  const current = getUserById(id);
  if (!current || current.username === '__unclaimed__') return false;
  const passwordHash = data?.passwordHash || current.password_hash;
  return db.prepare(
    'UPDATE users SET username = ?, is_admin = ?, is_active = ?, password_hash = ? WHERE id = ?'
  ).run(
    data?.username ?? current.username,
    data?.isAdmin == null ? current.is_admin : (data.isAdmin ? 1 : 0),
    data?.isActive == null ? current.is_active : (data.isActive ? 1 : 0),
    passwordHash,
    id
  ).changes > 0;
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
    ...companyProfileFields(r.company_id),
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
  // Department is keyed by its display label (INNER JOIN drops unset FKs).
  const byDepartment = mapOf(`SELECT lc.label AS k, COALESCE(SUM(wl.minutes),0) AS v ${FROM} JOIN lookup_codes lc ON lc.id = t.department_id ${WHERE} GROUP BY lc.label`);

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
    activeDays, byCompany, bySystem, byNatural, byType, byDepartment,
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
// renewals, Company Document renewals, and the two client_* tables that carry
// an expiry_date AND still have a UI (Auth/VPN, Internal Systems —
// client_servers has no expiry_date column, and the External Services section
// was retired, so its own expiry_date no longer feeds this). Deliberately
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
  db.prepare('SELECT id, name, expiry_date, company_id FROM client_internal_systems WHERE user_id = ?').all(userId).forEach(i => {
    if (i.expiry_date) items.push({ type: 'clientInternal', id: i.id, title: i.name || 'Internal System', date: i.expiry_date, module: 'clients', companyId: i.company_id });
  });
  return items;
}

// Compact cross-module activity stream for the Overview. Append-only task and
// session histories provide precise changes; document-oriented modules
// contribute their latest update. Credential values and article content never
// enter this payload.
function getRecentActivity(userId, requestedLimit = 16) {
  const limit = Math.max(1, Math.min(50, Number(requestedLimit) || 16));
  return db.prepare(
    `SELECT kind, entityId, parentId, title, detail, changedAt, module FROM (
       SELECT 'task' AS kind, h.task_id AS entityId, NULL AS parentId,
              COALESCE(t.name, 'Deleted task #' || h.task_id) AS title,
              h.field_name || ' changed' AS detail, h.changed_at AS changedAt, 'all-tasks' AS module
         FROM task_field_history h
         LEFT JOIN tasks t ON t.id = h.task_id AND t.user_id = h.user_id
        WHERE h.user_id = ?
       UNION ALL
       SELECT 'session', h.work_log_id, wl.task_id,
              COALESCE(t.name, 'Deleted session #' || h.work_log_id),
              h.field_name || ' changed', h.changed_at, 'all-tasks'
         FROM work_log_history h
         LEFT JOIN work_logs wl ON wl.id = h.work_log_id AND wl.user_id = h.user_id
         LEFT JOIN tasks t ON t.id = wl.task_id AND t.user_id = h.user_id
        WHERE h.user_id = ?
       UNION ALL
       SELECT 'project', p.id, NULL, p.name, 'Project updated', p.updated_at, 'clients'
         FROM projects p WHERE p.user_id = ?
       UNION ALL
       SELECT 'knowledge', k.id, NULL, k.title, 'Knowledge item updated', k.updated_at, 'knowledge'
         FROM knowledge_items k WHERE k.user_id = ?
       UNION ALL
       SELECT 'company-document', d.id, NULL, d.name, 'Company document updated', d.updated_at, 'companydocs'
         FROM company_documents d WHERE d.user_id = ?
     ) ORDER BY changedAt DESC LIMIT ?`
  ).all(userId, userId, userId, userId, userId, limit).map(row => ({
    kind: row.kind,
    id: row.entityId,
    parentId: row.parentId ?? null,
    title: row.title || '',
    detail: row.detail || '',
    changedAt: row.changedAt || '',
    module: row.module,
  }));
}

// ── Lookups (normalized catalog — shared app config, not per-user) ────────────
// Options for one category, ordered for dropdowns. Active-only by default; the
// Settings editor passes includeInactive to manage soft-disabled entries.
function getLookupsByCategory(category, includeInactive = false, userId = null) {
  return (lk().byCat[category] || [])
    .filter(r => (includeInactive || r.is_active) && (userId == null || canAccessLookup(userId, r.id)))
    .map(r => ({
      id: r.id, code: r.code, label: r.label,
      nameEn: category === 'COMPANY' ? (r.name_en || r.label) : undefined,
      nameAr: category === 'COMPANY' ? (r.name_ar || '') : undefined,
      sortOrder: r.sort_order, isActive: !!r.is_active,
    }));
}
// Full catalog (every category, incl. inactive) + the default employee name —
// what the renderer loads once at boot to build all dropdowns.
function loadLookups(userId) {
  const categories = {};
  for (const cat of LOOKUP_CATEGORIES) categories[cat] = getLookupsByCategory(cat, true, userId);
  return { categories, defaultName: userGet(userId, 'default_employee_name') || '' };
}
// Persist edits from the Settings catalog editor. Existing rows are updated in
// place and entries are NEVER hard-deleted — disable via isActive:false. COMPANY
// rows are richer client profiles: their user-facing business code and bilingual
// names are editable, while lookup_codes.id remains the immutable FK identity so
// linked tasks/projects/infrastructure cannot be detached by a profile rename.
function saveLookups(userId, data) {
  tx(() => {
    if (data && data.categories) {
      const now = new Date().toISOString();
      const upd = db.prepare('UPDATE lookup_codes SET label = ?, sort_order = ?, is_active = ? WHERE id = ?');
      const updCompany = db.prepare('UPDATE lookup_codes SET code = ?, label = ?, name_en = ?, name_ar = ?, sort_order = ?, is_active = ? WHERE id = ? AND category = \'COMPANY\'');
      const ins = db.prepare('INSERT INTO lookup_codes(category, code, label, name_en, name_ar, sort_order, is_active, created_at) VALUES(?,?,?,?,?,?,?,?)');
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
          const nameEn = cat === 'COMPANY' ? String(item.nameEn ?? item.label ?? '').trim() : '';
          const nameAr = cat === 'COMPANY' ? String(item.nameAr ?? '').trim() : '';
          const label = cat === 'COMPANY' ? nameEn : String(item.label ?? '').trim();
          if (!label) return;
          // Coerce once so a stringified id (e.g. from a JSON round-trip) still
          // matches the numeric ids lk().idTo/usedLabels are keyed by, instead of
          // silently falling through to the insert branch and creating a duplicate row.
          const itemId = (item.id != null && Number.isFinite(Number(item.id))) ? Number(item.id) : null;
          const key = label.toLowerCase();
          const owner = usedLabels.get(key);
          if (owner != null && owner !== itemId) return; // another code already owns this label — skip
          if (itemId != null && !canAccessLookup(userId, itemId)) return; // guessed private id
          const sort   = Number.isInteger(item.sortOrder) ? item.sortOrder : i;
          const active = item.isActive === false ? 0 : 1;
          if (itemId != null && lk().idTo.has(itemId)) {
            if (cat === 'COMPANY') {
              const businessCode = String(item.code || '').trim().toUpperCase();
              if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(businessCode)) throw new Error('A client needs a valid unique company code');
              const conflict = db.prepare('SELECT id FROM lookup_codes WHERE category = \'COMPANY\' AND code = ? COLLATE NOCASE AND id != ?').get(businessCode, itemId);
              if (conflict) throw new Error(`Company code ${businessCode} is already in use`);
              updCompany.run(businessCode, nameEn, nameEn, nameAr, sort, active, itemId);
            } else upd.run(label, sort, active, itemId);
            usedLabels.set(key, itemId);
          } else {
            const requestedCode = String(item.code || '').trim().toUpperCase();
            const baseCode = requestedCode || slugCode(label);
            const validCode = cat === 'COMPANY' ? /^[A-Z0-9][A-Z0-9_-]{0,63}$/ : /^[A-Z][A-Z0-9_]{0,63}$/;
            if (!validCode.test(baseCode)) {
              throw new Error(`Invalid lookup code for ${cat}`);
            }
            if (cat === 'COMPANY' && db.prepare('SELECT 1 FROM lookup_codes WHERE category = \'COMPANY\' AND code = ? COLLATE NOCASE').get(baseCode)) {
              throw new Error(`Company code ${baseCode} is already in use`);
            }
            const code = cat === 'COMPANY' ? baseCode : uniqueCode(cat, baseCode);
            const newId = Number(ins.run(cat, code, label, nameEn, nameAr, sort, active, now).lastInsertRowid);
            usedLabels.set(key, newId);
          }
        });
      }
    }
    if (data && typeof data.defaultName === 'string') userSet(userId, 'default_employee_name', data.defaultName.trim());
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
  const defaultCurrency = userGet(userId, 'subscriptions_default_currency') || 'USD';
  return { subscriptions, defaultCurrency };
}
function saveSubscriptions(userId, data) {
  const list = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
  const currency = data?.defaultCurrency || 'USD';
  const now = new Date().toISOString();
  tx(() => {
    const ownerStmt = db.prepare('SELECT user_id FROM subscriptions WHERE id = ?');
    for (const s of list) {
      const id = String(s?.id ?? '');
      if (!id || id.length > 128) throw new Error('Invalid subscription id');
      const existing = ownerStmt.get(id);
      if (existing && Number(existing.user_id) !== Number(userId)) {
        throw new Error('Subscription id belongs to another account');
      }
    }
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
                             renewal_date=excluded.renewal_date, sort_order=excluded.sort_order, updated_at=excluded.updated_at
                           WHERE subscriptions.user_id = excluded.user_id`);
    list.forEach((s, i) => {
      const cost = Number.parseFloat(String(s.cost ?? '').replace(/[^0-9.]/g, '')) || 0;
      const currencyId = lkId('CURRENCY', s.currency) ?? lkId('CURRENCY', 'USD');
      const cycleId    = lkId('BILLING_CYCLE', s.billingCycle) ?? lkId('BILLING_CYCLE', 'MONTHLY');
      up.run(
        s.id, userId, s.name ?? '', cost, currencyId, cycleId,
        s.endDate || null, s.renewalDate || null, i, now
      );
    });
    userSet(userId, 'subscriptions_default_currency', currency);
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
// the project_systems junction), and a PROJECT_STATUS lookup code (status). Every
// query is scoped to the authenticated owner (`userId`). The tracked document types are driven by the PROJECT_DOCUMENT lookup
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
const KNOWLEDGE_DOC_TYPES = {
  ...PROJECT_DOC_TYPES,
  xls:  'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt:  'text/plain',
};
const KNOWLEDGE_DOC_EXTENSIONS = Object.keys(KNOWLEDGE_DOC_TYPES);
const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

function safeDocumentType(documentType) {
  const code = String(documentType ?? '');
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(code) && lkId('PROJECT_DOCUMENT', code) != null ? code : null;
}

function uploadHeaderMatches(srcPath, ext) {
  const fd = fs.openSync(srcPath, 'r');
  try {
    const b = Buffer.alloc(16);
    const n = fs.readSync(fd, b, 0, b.length, 0);
    const h = b.subarray(0, n);
    const starts = (...bytes) => bytes.every((v, i) => h[i] === v);
    if (ext === 'pdf') return h.subarray(0, 5).toString('ascii') === '%PDF-';
    if (ext === 'doc') return starts(0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1);
    if (ext === 'docx') return starts(0x50, 0x4B, 0x03, 0x04) || starts(0x50, 0x4B, 0x05, 0x06);
    if (ext === 'png') return starts(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A);
    if (ext === 'jpg' || ext === 'jpeg') return starts(0xFF, 0xD8, 0xFF);
    if (ext === 'gif') return ['GIF87a', 'GIF89a'].includes(h.subarray(0, 6).toString('ascii'));
    if (ext === 'webp') return h.subarray(0, 4).toString('ascii') === 'RIFF' && h.subarray(8, 12).toString('ascii') === 'WEBP';
    return false;
  } finally {
    fs.closeSync(fd);
  }
}
function knowledgeUploadHeaderMatches(srcPath, ext) {
  if (ext === 'xls') return uploadHeaderMatches(srcPath, 'doc');
  if (ext === 'xlsx') return uploadHeaderMatches(srcPath, 'docx');
  if (ext === 'txt') {
    const fd = fs.openSync(srcPath, 'r');
    try { const sample = Buffer.alloc(4096); const n = fs.readSync(fd, sample, 0, sample.length, 0); return !sample.subarray(0, n).includes(0); }
    finally { fs.closeSync(fd); }
  }
  return uploadHeaderMatches(srcPath, ext);
}

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

// Validate a Sub-Project's parent link (migration 035): must belong to the user,
// cannot point at itself, and — nesting is capped at one level deep — the parent
// itself must be a top-level project (its own parent_project_id must be NULL), so
// a sub-project can never itself gain sub-projects. App-layer only.
function resolveParentProjectId(userId, parentProjectId, excludeId = null) {
  if (parentProjectId == null) return null;
  const pid = Number(parentProjectId);
  if (!Number.isInteger(pid) || (excludeId != null && pid === Number(excludeId))) return null;
  const parent = db.prepare('SELECT parent_project_id FROM projects WHERE id = ? AND user_id = ?').get(pid, userId);
  if (!parent || parent.parent_project_id != null) return null;
  return pid;
}

// Resolve a support-year record the caller owns (via its parent project), or
// null. Used when a task carries an inline supportYearId.
function ownedSupportYearId(userId, supportYearId) {
  if (supportYearId == null || !Number.isFinite(Number(supportYearId))) return null;
  const row = db.prepare(
    `SELECT sy.id FROM project_support_years sy JOIN projects p ON p.id = sy.project_id
      WHERE sy.id = ? AND p.user_id = ?`
  ).get(Number(supportYearId), userId);
  return row ? Number(row.id) : null;
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

// The bilingual COMPANY profiles linked to a project.
function projectCompanies(projectId) {
  return db.prepare(
    `SELECT pc.company_id AS id, lc.code, lc.label,
            COALESCE(NULLIF(lc.name_en, ''), lc.label) AS nameEn,
            COALESCE(lc.name_ar, '') AS nameAr
       FROM project_companies pc
       JOIN lookup_codes lc ON lc.id = pc.company_id
      WHERE pc.project_id = ?
      ORDER BY lc.sort_order, lc.label`
  ).all(projectId);
}

// Replace a project's system links with the given lookup ids (SYSTEM category).
// Invalid / non-SYSTEM / duplicate ids are skipped. Caller wraps this in a tx.
// Mirrors setProjectCompanies — a project can span several systems (migration 009).
function setProjectSystems(userId, projectId, systemIds) {
  db.prepare('DELETE FROM project_systems WHERE project_id = ?').run(projectId);
  const ins = db.prepare('INSERT OR IGNORE INTO project_systems(project_id, system_id) VALUES(?, ?)');
  const seen = new Set();
  for (const raw of (Array.isArray(systemIds) ? systemIds : [])) {
    const id = Number(raw);
    if (!Number.isInteger(id) || seen.has(id) || !isLookupId('SYSTEM', id) || !canAccessLookup(userId, id)) continue;
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
      `INSERT INTO projects(user_id, name, description, status, parent_project_id, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, data?.name ?? '', data?.description ?? '',
          data?.status || DEFAULT_PROJECT_STATUS,
          resolveParentProjectId(userId, data?.parentProjectId),
          now, now).lastInsertRowid);
    setProjectCompanies(id, data?.companyIds);
    setProjectSystems(userId, id, data?.systemIds);
  });
  return getProject(userId, id);
}

// All of the user's TOP-LEVEL projects with a linked-task count, newest first —
// the list view's payload (migration 035: Sub-Projects no longer appear in this
// flat grid — they only ever show nested inside their parent's detail view via
// getProject's own subProjects array). taskCount is the number of TASKS linked
// directly to the project (each may have zero or many work sessions) — it does
// NOT include a sub-project's or a support-year's own tasks.
function listProjects(userId) {
  return db.prepare(
    `SELECT p.id, p.name, p.description, p.status,
            p.created_at AS createdAt,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS taskCount,
            (SELECT COUNT(*) FROM projects sp WHERE sp.parent_project_id = p.id) AS subProjectCount,
            (SELECT COUNT(*) FROM project_support_years sy WHERE sy.project_id = p.id) AS supportYearCount
       FROM projects p
      WHERE p.user_id = ? AND p.parent_project_id IS NULL
      ORDER BY p.created_at DESC, p.id DESC`
  ).all(userId).map(p => ({
    ...p,
    companies: projectCompanies(p.id),
    systems: projectSystems(p.id),
  }));
}

// One project in full: profile + its linked TASKS (each with nested work sessions,
// including zero-log "Not Yet" tasks) + document statuses. null if not owned.
// (ProjectTasksV2 shape — `tasks: Task[]`, replacing the old {entries, backlog}.)
// parentProjectId/parentProjectName are still read back (migration 035's
// parent_project_id column) but nothing in the app sets it anymore — the
// Sub-Projects and Annual Support UI/IPC surface was retired; see the schema
// note under "projects" in CLAUDE.md.
function getProject(userId, id) {
  const row = db.prepare(
    `SELECT p.id, p.name, p.description, p.status,
            p.parent_project_id AS parentProjectId,
            (SELECT name FROM projects pp WHERE pp.id = p.parent_project_id) AS parentProjectName,
            p.created_at AS createdAt
       FROM projects p WHERE p.id = ? AND p.user_id = ?`
  ).get(id, userId);
  if (!row) return null;
  const p = row;

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
      exists: (() => { try { return fs.existsSync(resolveStoredPath(r.file_path)); } catch { return false; } })(),
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
  const current = db.prepare(
    'SELECT parent_project_id FROM projects WHERE id = ? AND user_id = ?'
  ).get(id, userId);
  const parentProjectId = Object.prototype.hasOwnProperty.call(data || {}, 'parentProjectId')
    ? resolveParentProjectId(userId, data.parentProjectId, id)
    : current.parent_project_id;
  tx(() => {
    db.prepare(
      `UPDATE projects SET name = ?, description = ?, status = ?, parent_project_id = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`
    ).run(data?.name ?? '', data?.description ?? '',
          data?.status || DEFAULT_PROJECT_STATUS,
          parentProjectId,
          new Date().toISOString(), id, userId);
    setProjectCompanies(id, data?.companyIds);
    setProjectSystems(userId, id, data?.systemIds);
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
  documentType = safeDocumentType(documentType);
  if (!documentType) return { ok: false, error: 'Unknown or unsafe document type' };
  const ext = fileExt(srcPath);
  if (!PROJECT_DOC_EXTENSIONS.includes(ext)) {
    return { ok: false, error: `Unsupported file type (.${ext || '?'}). Allowed: ${PROJECT_DOC_EXTENSIONS.join(', ')}` };
  }
  let size;
  try { size = fs.statSync(srcPath).size; }
  catch { return { ok: false, error: 'Could not read the selected file' }; }
  if (size <= 0 || size > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: 'File must be between 1 byte and 100 MB' };
  }
  try {
    if (!uploadHeaderMatches(srcPath, ext)) return { ok: false, error: 'The file contents do not match its extension' };
  } catch { return { ok: false, error: 'Could not validate the selected file' }; }

  // Prior file (for the replace case) — capture before we overwrite the row.
  const prev = db.prepare(`SELECT file_path, original_name, file_size, mime_type, uploaded_at
                             FROM project_documents WHERE project_id = ? AND document_type = ?`)
    .get(projectId, documentType);

  // {docType}-{timestamp}.{ext} — the timestamp makes duplicate filenames impossible.
  const relPath = path.join('projects', String(projectId), 'documents', `${documentType}-${Date.now()}.${ext}`);
  const absPath = resolveStoredPath(relPath);
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

  // Keep the superseded bytes until the next orphan sweep so replacement can
  // be undone from the renderer's five-second action toast.
  const replacedFile = prev?.file_path ? {
    path: prev.file_path, originalName: prev.original_name || '', size: prev.file_size || 0,
    mimeType: prev.mime_type || '', uploadedAt: prev.uploaded_at || '',
  } : null;
  return { ok: true, project: getProject(userId, projectId), replacedFile };
}

// Resolve the absolute on-disk path of a stored document (for download / open),
// after an ownership check. `exists` reflects whether the file is actually present.
function resolveProjectDocumentFile(userId, projectId, documentType) {
  if (!ownsProject(userId, projectId)) return { ok: false, error: 'Project not found' };
  documentType = safeDocumentType(documentType);
  if (!documentType) return { ok: false, error: 'Unknown or unsafe document type' };
  const r = db.prepare('SELECT file_path, original_name FROM project_documents WHERE project_id = ? AND document_type = ?')
    .get(projectId, documentType);
  if (!r?.file_path) return { ok: false, error: 'No file for this document' };
  let absPath;
  try { absPath = resolveStoredPath(r.file_path); }
  catch { return { ok: false, error: 'Stored file path is invalid' }; }
  return { ok: true, absPath, originalName: r.original_name || path.basename(r.file_path), exists: fs.existsSync(absPath) };
}

// Remove a document's file from disk and clear its metadata (keeps the row so the
// slot stays listed, just back to "not available"). Best-effort on the unlink.
function removeProjectDocumentFile(userId, projectId, documentType) {
  if (!ownsProject(userId, projectId)) return { ok: false, error: 'Project not found' };
  documentType = safeDocumentType(documentType);
  if (!documentType) return { ok: false, error: 'Unknown or unsafe document type' };
  const r = db.prepare(`SELECT file_path, original_name, file_size, mime_type, uploaded_at
                          FROM project_documents WHERE project_id = ? AND document_type = ?`)
    .get(projectId, documentType);
  db.prepare(
    `UPDATE project_documents
        SET is_available = 0, file_path = NULL, original_name = NULL, file_size = NULL, mime_type = NULL, uploaded_at = NULL
      WHERE project_id = ? AND document_type = ?`
  ).run(projectId, documentType);
  const removedFile = r?.file_path ? {
    path: r.file_path, originalName: r.original_name || '', size: r.file_size || 0,
    mimeType: r.mime_type || '', uploadedAt: r.uploaded_at || '',
  } : null;
  return { ok: true, project: getProject(userId, projectId), removedFile };
}

function restoreProjectDocumentFile(userId, projectId, documentType, fileMeta) {
  if (!ownsProject(userId, projectId)) return { ok: false, error: 'Project not found' };
  documentType = safeDocumentType(documentType);
  if (!documentType || !fileMeta?.path) return { ok: false, error: 'Invalid restore request' };
  let absPath;
  try {
    absPath = resolveStoredPath(fileMeta.path);
    resolveInside(path.join(projectDir(Number(projectId)), 'documents'), absPath);
  } catch { return { ok: false, error: 'Stored file path is invalid' }; }
  if (!fs.existsSync(absPath)) return { ok: false, error: 'The previous file is no longer available' };
  const current = db.prepare(`SELECT file_path, original_name, file_size, mime_type, uploaded_at
                                FROM project_documents WHERE project_id = ? AND document_type = ?`)
    .get(projectId, documentType);
  db.prepare(
    `UPDATE project_documents SET is_available = 1, file_path = ?, original_name = ?,
       file_size = ?, mime_type = ?, uploaded_at = ? WHERE project_id = ? AND document_type = ?`
  ).run(fileMeta.path, String(fileMeta.originalName || path.basename(fileMeta.path)), Number(fileMeta.size) || 0,
        String(fileMeta.mimeType || ''), String(fileMeta.uploadedAt || new Date().toISOString()), projectId, documentType);
  const replacedFile = current?.file_path && current.file_path !== fileMeta.path ? {
    path: current.file_path, originalName: current.original_name || '', size: current.file_size || 0,
    mimeType: current.mime_type || '', uploadedAt: current.uploaded_at || '',
  } : null;
  return { ok: true, project: getProject(userId, projectId), replacedFile };
}

function purgeUnreferencedProjectDocumentFile(userId, projectId, relPath) {
  if (!ownsProject(userId, projectId) || !relPath) return { ok: false };
  const referenced = db.prepare('SELECT 1 FROM project_documents WHERE project_id = ? AND file_path = ?')
    .get(projectId, relPath);
  if (referenced) return { ok: false, error: 'File is still in use' };
  try {
    const absPath = resolveStoredPath(relPath);
    resolveInside(path.join(projectDir(Number(projectId)), 'documents'), absPath);
    fs.rmSync(absPath, { force: true });
    return { ok: true };
  } catch { return { ok: false, error: 'Invalid stored file path' }; }
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
    if (!fs.existsSync(resolveStoredPath(relPath))) continue; // file didn't survive — skip
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
      exists: (() => { try { return fs.existsSync(resolveStoredPath(r.file_path)); } catch { return false; } })(),
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
  if (size <= 0 || size > MAX_DOCUMENT_BYTES) return { ok: false, error: 'File must be between 1 byte and 100 MB' };
  try {
    if (!uploadHeaderMatches(srcPath, ext)) return { ok: false, error: 'The file contents do not match its extension' };
  } catch { return { ok: false, error: 'Could not validate the selected file' }; }

  const prev = db.prepare(`SELECT file_path, original_name, file_size, mime_type, uploaded_at
                             FROM company_documents WHERE id = ? AND user_id = ?`).get(id, userId);

  // {timestamp}.{ext} — one file slot per card, so no type prefix is needed.
  const relPath = path.join('company_documents', String(id), `${Date.now()}.${ext}`);
  const absPath = resolveStoredPath(relPath);
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

  const replacedFile = prev?.file_path ? {
    path: prev.file_path, originalName: prev.original_name || '', size: prev.file_size || 0,
    mimeType: prev.mime_type || '', uploadedAt: prev.uploaded_at || '',
  } : null;
  return { ok: true, document: getCompanyDocument(userId, id), replacedFile };
}

// Resolve the absolute on-disk path of a card's file (for download / open),
// after an ownership check. `exists` reflects whether the file is actually present.
function resolveCompanyDocumentFile(userId, id) {
  if (!ownsCompanyDocument(userId, id)) return { ok: false, error: 'Document not found' };
  const r = db.prepare('SELECT file_path, original_name FROM company_documents WHERE id = ?').get(id);
  if (!r?.file_path) return { ok: false, error: 'No file for this document' };
  let absPath;
  try { absPath = resolveStoredPath(r.file_path); }
  catch { return { ok: false, error: 'Stored file path is invalid' }; }
  return { ok: true, absPath, originalName: r.original_name || path.basename(r.file_path), exists: fs.existsSync(absPath) };
}

// Remove a card's file from disk and clear its metadata (keeps the card itself,
// just back to "no file"). Best-effort on the unlink.
function removeCompanyDocumentFile(userId, id) {
  if (!ownsCompanyDocument(userId, id)) return { ok: false, error: 'Document not found' };
  const r = db.prepare(`SELECT file_path, original_name, file_size, mime_type, uploaded_at
                          FROM company_documents WHERE id = ? AND user_id = ?`).get(id, userId);
  db.prepare(
    `UPDATE company_documents
        SET file_path = NULL, original_name = NULL, file_size = NULL, mime_type = NULL, uploaded_at = NULL, updated_at = ?
      WHERE id = ? AND user_id = ?`
  ).run(new Date().toISOString(), id, userId);
  const removedFile = r?.file_path ? {
    path: r.file_path, originalName: r.original_name || '', size: r.file_size || 0,
    mimeType: r.mime_type || '', uploadedAt: r.uploaded_at || '',
  } : null;
  return { ok: true, document: getCompanyDocument(userId, id), removedFile };
}

function restoreRemovedCompanyDocumentFile(userId, id, fileMeta) {
  if (!ownsCompanyDocument(userId, id) || !fileMeta?.path) return { ok: false, error: 'Document not found' };
  let absPath;
  try {
    absPath = resolveStoredPath(fileMeta.path);
    resolveInside(companyDocumentDir(Number(id)), absPath);
  } catch { return { ok: false, error: 'Stored file path is invalid' }; }
  if (!fs.existsSync(absPath)) return { ok: false, error: 'The previous file is no longer available' };
  const current = db.prepare(`SELECT file_path, original_name, file_size, mime_type, uploaded_at
                                FROM company_documents WHERE id = ? AND user_id = ?`).get(id, userId);
  db.prepare(`UPDATE company_documents SET file_path = ?, original_name = ?, file_size = ?, mime_type = ?,
                uploaded_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(fileMeta.path, String(fileMeta.originalName || path.basename(fileMeta.path)), Number(fileMeta.size) || 0,
      String(fileMeta.mimeType || ''), String(fileMeta.uploadedAt || new Date().toISOString()),
      new Date().toISOString(), id, userId);
  const replacedFile = current?.file_path && current.file_path !== fileMeta.path ? {
    path: current.file_path, originalName: current.original_name || '', size: current.file_size || 0,
    mimeType: current.mime_type || '', uploadedAt: current.uploaded_at || '',
  } : null;
  return { ok: true, document: getCompanyDocument(userId, id), replacedFile };
}

function purgeUnreferencedCompanyDocumentFile(userId, id, relPath) {
  if (!ownsCompanyDocument(userId, id) || !relPath) return { ok: false };
  const referenced = db.prepare('SELECT 1 FROM company_documents WHERE id = ? AND user_id = ? AND file_path = ?')
    .get(id, userId, relPath);
  if (referenced) return { ok: false, error: 'File is still in use' };
  try {
    const absPath = resolveStoredPath(relPath);
    resolveInside(companyDocumentDir(Number(id)), absPath);
    fs.rmSync(absPath, { force: true });
    return { ok: true };
  } catch { return { ok: false, error: 'Invalid stored file path' }; }
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
  if (!fs.existsSync(resolveStoredPath(relPath))) return { ok: true, document: getCompanyDocument(userId, newId) }; // file didn't survive — skip

  db.prepare(
    `UPDATE company_documents
        SET file_path = ?, original_name = ?, file_size = ?, mime_type = ?, uploaded_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`
  ).run(relPath, fileMeta.originalName || path.basename(relPath), fileMeta.size || 0,
        fileMeta.mimeType || PROJECT_DOC_TYPES[fileExt(relPath)] || '', fileMeta.uploadedAt || new Date().toISOString(),
        new Date().toISOString(), newId, userId);
  return { ok: true, document: getCompanyDocument(userId, newId) };
}

// ── Knowledge Hub ────────────────────────────────────────────────────────────
// User-owned articles with tags, groups, and version-labeled documents. Files live under
// <userData>/knowledge_hub/{itemId}/attachments/.
const KNOWLEDGE_STATUSES = new Set(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
const pendingKnowledgeDeletes = new Map(); // deleted item id -> user id

function ownsKnowledgeItem(userId, id) {
  return !!db.prepare('SELECT 1 FROM knowledge_items WHERE id = ? AND user_id = ?').get(id, userId);
}
function knowledgeStatus(value) {
  const s = String(value || 'DRAFT').toUpperCase();
  return KNOWLEDGE_STATUSES.has(s) ? s : 'DRAFT';
}
function knowledgeAttachmentToApi(r) {
  return {
    id: r.id, path: r.file_path, originalName: r.original_name || '', size: r.file_size || 0,
    name: r.document_name || r.original_name || '', version: r.version_label || '1.0',
    mimeType: r.mime_type || '', uploadedAt: r.uploaded_at || '', sortOrder: r.sort_order || 0,
    exists: (() => { try { return fs.existsSync(resolveStoredPath(r.file_path)); } catch { return false; } })(),
  };
}
function knowledgeItemToApi(r) {
  const itemId = r.id;
  const documents = db.prepare(
    'SELECT * FROM knowledge_attachments WHERE item_id = ? AND user_id = ? ORDER BY sort_order, id'
  ).all(itemId, r.user_id).map(knowledgeAttachmentToApi);
  const tags = db.prepare(
    `SELECT kt.name FROM knowledge_item_tags kit JOIN knowledge_tags kt ON kt.id = kit.tag_id
      WHERE kit.item_id = ? AND kt.user_id = ? ORDER BY kt.name COLLATE NOCASE`
  ).all(itemId, r.user_id).map(x => x.name);
  const groups = db.prepare(
    `SELECT g.id, g.name FROM knowledge_group_items gi
       JOIN knowledge_groups g ON g.id = gi.group_id
      WHERE gi.item_id = ? AND g.user_id = ? ORDER BY g.sort_order, g.name COLLATE NOCASE`
  ).all(itemId, r.user_id).map(x => ({ id: x.id, name: x.name }));
  return {
    id: itemId, title: r.title || '', type: lkCode(r.type_id), typeLabel: lkLabel(r.type_id),
    status: r.status, summary: r.summary || '', content: r.content || '',
    createdAt: r.created_at, updatedAt: r.updated_at, documents, tags, groups,
  };
}
function listKnowledgeItems(userId) {
  const rows = db.prepare('SELECT * FROM knowledge_items WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(userId);
  if (!rows.length) return [];
  const tagsByItem = new Map(), groupsByItem = new Map(), documentsByItem = new Map();
  db.prepare(
    `SELECT kit.item_id, kt.name FROM knowledge_item_tags kit
       JOIN knowledge_tags kt ON kt.id = kit.tag_id
       JOIN knowledge_items k ON k.id = kit.item_id
      WHERE k.user_id = ? AND kt.user_id = ?
      ORDER BY kt.name COLLATE NOCASE`
  ).all(userId, userId).forEach(row => {
    if (!tagsByItem.has(row.item_id)) tagsByItem.set(row.item_id, []);
    tagsByItem.get(row.item_id).push(row.name);
  });
  db.prepare(
    `SELECT gi.item_id, g.id, g.name FROM knowledge_group_items gi
       JOIN knowledge_groups g ON g.id = gi.group_id
       JOIN knowledge_items k ON k.id = gi.item_id
      WHERE k.user_id = ? AND g.user_id = ?
      ORDER BY g.sort_order, g.name COLLATE NOCASE`
  ).all(userId, userId).forEach(row => {
    if (!groupsByItem.has(row.item_id)) groupsByItem.set(row.item_id, []);
    groupsByItem.get(row.item_id).push({ id: row.id, name: row.name });
  });
  db.prepare(
    `SELECT a.item_id, a.document_name, a.version_label, a.original_name
       FROM knowledge_attachments a
       JOIN knowledge_items k ON k.id = a.item_id
      WHERE a.user_id = ? AND k.user_id = ?
      ORDER BY a.sort_order, a.id`
  ).all(userId, userId).forEach(row => {
    if (!documentsByItem.has(row.item_id)) documentsByItem.set(row.item_id, []);
    documentsByItem.get(row.item_id).push({
      name: row.document_name || row.original_name || '',
      version: row.version_label || '1.0',
      originalName: row.original_name || '',
    });
  });
  return rows.map(row => {
    const documents = documentsByItem.get(row.id) || [];
    return {
      id: row.id, title: row.title || '', type: lkCode(row.type_id), typeLabel: lkLabel(row.type_id),
      status: row.status, summary: row.summary || '', content: row.content || '',
      createdAt: row.created_at, updatedAt: row.updated_at,
      tags: tagsByItem.get(row.id) || [], groups: groupsByItem.get(row.id) || [],
      documents, documentCount: documents.length,
    };
  });
}
function getKnowledgeItem(userId, id) {
  const r = db.prepare('SELECT * FROM knowledge_items WHERE id = ? AND user_id = ?').get(id, userId);
  return r ? knowledgeItemToApi(r) : null;
}
function setKnowledgeChildren(userId, itemId, data) {
  db.prepare('DELETE FROM knowledge_item_tags WHERE item_id = ?').run(itemId);
  const ensureTag = db.prepare(
    `INSERT INTO knowledge_tags(user_id, name, created_at) VALUES(?, ?, ?)
     ON CONFLICT(user_id, name) DO UPDATE SET name = excluded.name RETURNING id`
  );
  const addTag = db.prepare('INSERT OR IGNORE INTO knowledge_item_tags(item_id, tag_id) VALUES(?, ?)');
  const seen = new Set();
  (Array.isArray(data?.tags) ? data.tags : []).slice(0, 30).forEach(value => {
    const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    const row = ensureTag.get(userId, name, new Date().toISOString());
    addTag.run(itemId, row.id);
  });
  if (Object.prototype.hasOwnProperty.call(data || {}, 'groupIds')) {
    db.prepare('DELETE FROM knowledge_group_items WHERE item_id = ?').run(itemId);
    const ownsGroup = db.prepare('SELECT 1 FROM knowledge_groups WHERE id = ? AND user_id = ?');
    const nextSort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM knowledge_group_items WHERE group_id = ?');
    const addGroup = db.prepare('INSERT OR IGNORE INTO knowledge_group_items(group_id, item_id, sort_order) VALUES(?, ?, ?)');
    const seenGroups = new Set();
    (Array.isArray(data?.groupIds) ? data.groupIds : []).slice(0, 100).forEach(value => {
      const groupId = Number(value);
      if (!Number.isInteger(groupId) || groupId <= 0 || seenGroups.has(groupId) || !ownsGroup.get(groupId, userId)) return;
      seenGroups.add(groupId);
      addGroup.run(groupId, itemId, nextSort.get(groupId).n);
    });
  }
}
function createKnowledgeItem(userId, data) {
  const title = String(data?.title || '').trim();
  if (!title) throw new Error('Knowledge title is required');
  const typeId = lkIdForUser(userId, 'KNOWLEDGE_TYPE', data?.type);
  const now = new Date().toISOString();
  let id;
  tx(() => {
    id = Number(db.prepare(
      `INSERT INTO knowledge_items(user_id, title, type_id, status, summary, content, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, title.slice(0, 300), typeId, knowledgeStatus(data?.status), String(data?.summary || '').slice(0, 2000),
      String(data?.content || ''), now, now).lastInsertRowid);
    setKnowledgeChildren(userId, id, data);
  });
  return getKnowledgeItem(userId, id);
}
function updateKnowledgeItem(userId, id, data) {
  if (!ownsKnowledgeItem(userId, id)) return null;
  const title = String(data?.title || '').trim();
  if (!title) throw new Error('Knowledge title is required');
  const typeId = lkIdForUser(userId, 'KNOWLEDGE_TYPE', data?.type);
  tx(() => {
    db.prepare(
      `UPDATE knowledge_items SET title = ?, type_id = ?, status = ?, summary = ?, content = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`
    ).run(title.slice(0, 300), typeId, knowledgeStatus(data?.status), String(data?.summary || '').slice(0, 2000),
      String(data?.content || ''), new Date().toISOString(), id, userId);
    setKnowledgeChildren(userId, id, data);
  });
  return getKnowledgeItem(userId, id);
}
function deleteKnowledgeItem(userId, id) {
  const snapshot = getKnowledgeItem(userId, id);
  if (!snapshot) return { ok: false, error: 'Knowledge item not found' };
  db.prepare('DELETE FROM knowledge_items WHERE id = ? AND user_id = ?').run(id, userId);
  pendingKnowledgeDeletes.set(Number(id), userId);
  return { ok: true, snapshot };
}
function restoreKnowledgeItem(userId, oldId, snapshot) {
  if (pendingKnowledgeDeletes.get(Number(oldId)) !== userId) return { ok: false, error: 'Not authorized to restore this item' };
  const restored = createKnowledgeItem(userId, {
    title: snapshot?.title, type: snapshot?.type, status: snapshot?.status, summary: snapshot?.summary,
    content: snapshot?.content, tags: snapshot?.tags,
  });
  pendingKnowledgeDeletes.delete(Number(oldId));
  const oldDir = knowledgeItemDir(Number(oldId));
  const newDir = knowledgeItemDir(restored.id);
  if (path.resolve(oldDir) !== path.resolve(newDir) && fs.existsSync(oldDir)) {
    try { fs.rmSync(newDir, { recursive: true, force: true }); fs.renameSync(oldDir, newDir); } catch { /* best effort */ }
  }
  const add = db.prepare(
    `INSERT INTO knowledge_attachments(user_id, item_id, file_path, original_name, file_size, mime_type, sort_order, uploaded_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
  );
  (snapshot?.documents || []).forEach((file, index) => {
    const rel = path.join('knowledge_hub', String(restored.id), 'attachments', path.basename(String(file.path || '')));
    let exists = false;
    try { exists = !!path.basename(String(file.path || '')) && fs.existsSync(resolveStoredPath(rel)); } catch { /* skip */ }
    if (exists) add.run(userId, restored.id, rel, file.originalName || path.basename(rel), Number(file.size) || 0,
      file.mimeType || '', index, file.uploadedAt || new Date().toISOString());
  });
  const setDocumentMeta = db.prepare(
    'UPDATE knowledge_attachments SET document_name = ?, version_label = ? WHERE item_id = ? AND sort_order = ?'
  );
  (snapshot?.documents || []).forEach((file, index) =>
    setDocumentMeta.run(String(file.name || file.originalName || 'Document').slice(0, 200),
      String(file.version || '1.0').slice(0, 60), restored.id, index));
  const restoreMembership = db.prepare(
    `INSERT OR IGNORE INTO knowledge_group_items(group_id, item_id, sort_order)
     SELECT id, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM knowledge_group_items WHERE group_id = knowledge_groups.id), 0)
       FROM knowledge_groups WHERE id = ? AND user_id = ?`
  );
  (snapshot?.groups || []).forEach(group => restoreMembership.run(restored.id, group.id, userId));
  return { ok: true, item: getKnowledgeItem(userId, restored.id) };
}
function saveKnowledgeAttachment(userId, itemId, srcPath, documentMeta = {}) {
  if (!ownsKnowledgeItem(userId, itemId)) return { ok: false, error: 'Knowledge item not found' };
  const documentName = String(documentMeta?.name || path.basename(srcPath)).trim().slice(0, 200) || path.basename(srcPath);
  const versionLabel = String(documentMeta?.version || '1.0').trim().slice(0, 60) || '1.0';
  const duplicate = db.prepare(
    `SELECT 1 FROM knowledge_attachments
      WHERE item_id = ? AND user_id = ?
        AND LOWER(TRIM(document_name)) = LOWER(TRIM(?))
        AND LOWER(TRIM(version_label)) = LOWER(TRIM(?))`
  ).get(itemId, userId, documentName, versionLabel);
  if (duplicate) return { ok: false, error: 'This document version already exists' };
  const ext = fileExt(srcPath);
  if (!KNOWLEDGE_DOC_EXTENSIONS.includes(ext)) return { ok: false, error: `Unsupported file type (.${ext || '?'})` };
  let size;
  try { size = fs.statSync(srcPath).size; } catch { return { ok: false, error: 'Could not read the selected file' }; }
  if (size <= 0 || size > MAX_DOCUMENT_BYTES) return { ok: false, error: 'File must be between 1 byte and 100 MB' };
  try { if (!knowledgeUploadHeaderMatches(srcPath, ext)) return { ok: false, error: 'The file contents do not match its extension' }; }
  catch { return { ok: false, error: 'Could not validate the selected file' }; }
  const relPath = path.join('knowledge_hub', String(itemId), 'attachments', `${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`);
  const absPath = resolveStoredPath(relPath);
  try { fs.mkdirSync(path.dirname(absPath), { recursive: true }); fs.copyFileSync(srcPath, absPath); }
  catch (err) { return { ok: false, error: 'Could not save the file: ' + String(err?.message || err) }; }
  try {
    const sort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM knowledge_attachments WHERE item_id = ?').get(itemId).n;
    db.prepare(
      `INSERT INTO knowledge_attachments(user_id, item_id, file_path, original_name, file_size, mime_type, sort_order, uploaded_at, document_name, version_label)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, itemId, relPath, path.basename(srcPath), size, KNOWLEDGE_DOC_TYPES[ext], sort, new Date().toISOString(),
      documentName, versionLabel);
    db.prepare('UPDATE knowledge_items SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), itemId);
  } catch (err) { try { fs.rmSync(absPath, { force: true }); } catch {} return { ok: false, error: String(err?.message || err) }; }
  return { ok: true, item: getKnowledgeItem(userId, itemId) };
}
function resolveKnowledgeAttachment(userId, attachmentId) {
  const r = db.prepare(
    `SELECT a.* FROM knowledge_attachments a JOIN knowledge_items k ON k.id = a.item_id
      WHERE a.id = ? AND a.user_id = ? AND k.user_id = ?`
  ).get(attachmentId, userId, userId);
  if (!r) return { ok: false, error: 'Attachment not found' };
  let absPath;
  try { absPath = resolveStoredPath(r.file_path); resolveInside(knowledgeItemDir(r.item_id), absPath); }
  catch { return { ok: false, error: 'Stored file path is invalid' }; }
  return { ok: true, absPath, originalName: r.original_name, exists: fs.existsSync(absPath) };
}
function removeKnowledgeAttachment(userId, attachmentId) {
  const r = db.prepare(
    `SELECT a.* FROM knowledge_attachments a JOIN knowledge_items k ON k.id = a.item_id
      WHERE a.id = ? AND a.user_id = ? AND k.user_id = ?`
  ).get(attachmentId, userId, userId);
  if (!r) return { ok: false, error: 'Attachment not found' };
  db.prepare('DELETE FROM knowledge_attachments WHERE id = ? AND user_id = ?').run(attachmentId, userId);
  db.prepare('UPDATE knowledge_items SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), r.item_id);
  return { ok: true, item: getKnowledgeItem(userId, r.item_id), removedFile: knowledgeAttachmentToApi(r) };
}
function restoreKnowledgeAttachment(userId, itemId, fileMeta) {
  if (!ownsKnowledgeItem(userId, itemId) || !fileMeta?.path) return { ok: false, error: 'Knowledge item not found' };
  const documentName = String(fileMeta.name || fileMeta.originalName || 'Document').trim().slice(0, 200) || 'Document';
  const versionLabel = String(fileMeta.version || '1.0').trim().slice(0, 60) || '1.0';
  if (db.prepare(
    `SELECT 1 FROM knowledge_attachments
      WHERE item_id = ? AND user_id = ?
        AND LOWER(TRIM(document_name)) = LOWER(TRIM(?))
        AND LOWER(TRIM(version_label)) = LOWER(TRIM(?))`
  ).get(itemId, userId, documentName, versionLabel)) {
    return { ok: false, error: 'This document version already exists' };
  }
  let absPath;
  try { absPath = resolveStoredPath(fileMeta.path); resolveInside(knowledgeItemDir(itemId), absPath); }
  catch { return { ok: false, error: 'Stored file path is invalid' }; }
  if (!fs.existsSync(absPath)) return { ok: false, error: 'The previous file is no longer available' };
  const sort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM knowledge_attachments WHERE item_id = ?').get(itemId).n;
  db.prepare(
    `INSERT INTO knowledge_attachments(user_id, item_id, file_path, original_name, file_size, mime_type, sort_order, uploaded_at, document_name, version_label)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, itemId, fileMeta.path, fileMeta.originalName || path.basename(fileMeta.path), Number(fileMeta.size) || 0,
    fileMeta.mimeType || '', sort, fileMeta.uploadedAt || new Date().toISOString(),
    documentName, versionLabel);
  return { ok: true, item: getKnowledgeItem(userId, itemId) };
}
function purgeKnowledgeAttachment(userId, itemId, relPath) {
  if (!ownsKnowledgeItem(userId, itemId) || !relPath) return { ok: false };
  if (db.prepare('SELECT 1 FROM knowledge_attachments WHERE item_id = ? AND user_id = ? AND file_path = ?').get(itemId, userId, relPath)) {
    return { ok: false, error: 'File is still in use' };
  }
  try { const abs = resolveStoredPath(relPath); resolveInside(knowledgeItemDir(itemId), abs); fs.rmSync(abs, { force: true }); return { ok: true }; }
  catch { return { ok: false, error: 'Invalid stored file path' }; }
}
function purgeKnowledgeFiles(userId, itemId) {
  const n = Number(itemId);
  if (pendingKnowledgeDeletes.get(n) !== userId) return { ok: false, error: 'Not authorized to purge this item' };
  pendingKnowledgeDeletes.delete(n);
  try { fs.rmSync(knowledgeItemDir(n), { recursive: true, force: true }); } catch {}
  return { ok: true };
}

function knowledgeGroupToApi(r) {
  const itemIds = db.prepare(
    `SELECT gi.item_id FROM knowledge_group_items gi
       JOIN knowledge_items k ON k.id = gi.item_id
      WHERE gi.group_id = ? AND k.user_id = ? ORDER BY gi.sort_order, gi.item_id`
  ).all(r.id, r.user_id).map(x => x.item_id);
  return {
    id: r.id, name: r.name, description: r.description || '', sortOrder: r.sort_order || 0,
    itemIds, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function listKnowledgeGroups(userId) {
  return db.prepare('SELECT * FROM knowledge_groups WHERE user_id = ? ORDER BY sort_order, name COLLATE NOCASE')
    .all(userId).map(knowledgeGroupToApi);
}
function setKnowledgeGroupItems(userId, groupId, itemIds) {
  db.prepare('DELETE FROM knowledge_group_items WHERE group_id = ?').run(groupId);
  const owns = db.prepare('SELECT 1 FROM knowledge_items WHERE id = ? AND user_id = ?');
  const add = db.prepare('INSERT OR IGNORE INTO knowledge_group_items(group_id, item_id, sort_order) VALUES(?, ?, ?)');
  const seen = new Set();
  (Array.isArray(itemIds) ? itemIds : []).slice(0, 500).forEach(value => {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id) || !owns.get(id, userId)) return;
    seen.add(id);
    add.run(groupId, id, seen.size - 1);
  });
}
function createKnowledgeGroup(userId, data) {
  const name = String(data?.name || '').trim();
  if (!name) throw new Error('Group name is required');
  const now = new Date().toISOString();
  let id;
  tx(() => {
    const sort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM knowledge_groups WHERE user_id = ?').get(userId).n;
    id = Number(db.prepare(
      `INSERT INTO knowledge_groups(user_id, name, description, sort_order, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?)`
    ).run(userId, name.slice(0, 120), String(data?.description || '').slice(0, 1000), sort, now, now).lastInsertRowid);
    setKnowledgeGroupItems(userId, id, data?.itemIds);
  });
  return listKnowledgeGroups(userId).find(x => x.id === id);
}
function updateKnowledgeGroup(userId, id, data) {
  const current = db.prepare('SELECT * FROM knowledge_groups WHERE id = ? AND user_id = ?').get(id, userId);
  if (!current) return null;
  const name = String(data?.name || '').trim();
  if (!name) throw new Error('Group name is required');
  tx(() => {
    db.prepare(
      `UPDATE knowledge_groups SET name = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    ).run(name.slice(0, 120), String(data?.description || '').slice(0, 1000), new Date().toISOString(), id, userId);
    setKnowledgeGroupItems(userId, id, data?.itemIds);
  });
  return listKnowledgeGroups(userId).find(x => x.id === Number(id));
}
function deleteKnowledgeGroup(userId, id) {
  const group = listKnowledgeGroups(userId).find(x => x.id === Number(id));
  if (!group) return { ok: false, error: 'Group not found' };
  db.prepare('DELETE FROM knowledge_groups WHERE id = ? AND user_id = ?').run(id, userId);
  return { ok: true, snapshot: group };
}

// Link / unlink a task to a project, addressed directly by its task id (the
// two-level model — everything is a task now). Linking verifies project ownership;
// each UPDATE is owner-scoped so a user can only touch their own rows. Milestone 9:
// a task already linked to a Department is rejected (Project/Department are
// mutually exclusive) — belt-and-braces alongside listLinkableTasks() no longer
// offering department-linked tasks to this picker in the first place.
function linkTask(userId, projectId, taskId) {
  if (!ownsProject(userId, projectId)) return { ok: false, error: 'project not found' };
  const row = db.prepare('SELECT department_id, support_year_id FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  if (!row) return { ok: false, error: 'task not found' };
  if (row.department_id != null) return { ok: false, error: 'task is already linked to a Department' };
  if (row.support_year_id != null) return { ok: false, error: 'task is already linked to a Support Year' };
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
// above but for the DEPARTMENT lookup dimension (Internal Tasks). Milestone 9:
// Project/Department are mutually exclusive — a task already linked to a
// Project is rejected here for the same reason linkTask rejects the reverse.
function linkDepartmentTask(userId, taskId, departmentId) {
  if (!isLookupId('DEPARTMENT', departmentId)) return { ok: false, error: 'department not found' };
  const row = db.prepare('SELECT project_id, support_year_id FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  if (!row) return { ok: false, error: 'task not found' };
  if (row.project_id != null) return { ok: false, error: 'task is already linked to a Project' };
  if (row.support_year_id != null) return { ok: false, error: 'task is already linked to a Support Year' };
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
// each with its rollups. Read-only; the UI links via linkTask. Milestone 9: also
// excludes department-linked tasks (Project/Department are mutually exclusive),
// so this picker never offers an Internal task as something to fold into a Project.
// Migration 035: also excludes Support-Year-linked tasks, for the same reason.
function listLinkableTasks(userId) {
  return db.prepare(
    `SELECT * FROM tasks WHERE user_id = ? AND project_id IS NULL AND department_id IS NULL AND support_year_id IS NULL ORDER BY created_at DESC, id DESC`
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
// picker (department_id IS NULL instead of project_id IS NULL). Milestone 9: also
// excludes project-linked tasks, for the same mutual-exclusivity reason. Migration
// 035: also excludes Support-Year-linked tasks.
function listLinkableTasksForDepartment(userId) {
  return db.prepare(
    `SELECT * FROM tasks WHERE user_id = ? AND department_id IS NULL AND project_id IS NULL AND support_year_id IS NULL ORDER BY created_at DESC, id DESC`
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
    supportYearId: t.support_year_id ?? null,
    sortOrder: t.sort_order ?? 0,
    createdAt: t.created_at,
    ...companyProfileFields(t.company_id),
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
    system_id: lkIdForUser(userId, 'SYSTEM', data?.system),
    project_id: ownedProjectId(userId, data?.projectId),
    department_id: lkId('DEPARTMENT', data?.department),
    support_year_id: ownedSupportYearId(userId, data?.supportYearId),
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
  const mins = Number(data?.minutes);
  const rawDate = String(data?.date ?? '').slice(0, 10);
  if (!isValidDateStr(rawDate)) throw new Error('A valid work-log date is required');
  if (!Number.isInteger(mins) || mins < 1 || mins > 1440) throw new Error('Minutes must be a whole number from 1 to 1440');
  return {
    date: rawDate,
    description: String(data?.description ?? ''),
    minutes: mins,
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
    `WITH log_rollup AS (
       SELECT task_id, COUNT(*) AS logCount, COALESCE(SUM(minutes), 0) AS totalMinutes,
              MIN(date) AS firstDate, MAX(date) AS lastDate
         FROM work_logs WHERE user_id = ? GROUP BY task_id
     ),
     ranked_sources AS (
       SELECT ts.task_id, ts.source_ref, ts.source_url, lc.code AS source_type,
              COUNT(*) OVER (PARTITION BY ts.task_id) AS source_count,
              ROW_NUMBER() OVER (PARTITION BY ts.task_id ORDER BY ts.sort_order, ts.id) AS source_rank
         FROM task_sources ts
         LEFT JOIN lookup_codes lc ON lc.id = ts.source_type_id
        WHERE ts.user_id = ?
     ),
     source_rollup AS (
       SELECT task_id, MAX(source_count) AS source_count,
              MAX(CASE WHEN source_rank = 1 THEN source_ref END) AS source_ref_first,
              MAX(CASE WHEN source_rank = 1 THEN source_url END) AS source_url_first,
              MAX(CASE WHEN source_rank = 1 THEN source_type END) AS source_type_first
         FROM ranked_sources GROUP BY task_id
     )
     SELECT t.*, COALESCE(l.logCount, 0) AS logCount,
            COALESCE(l.totalMinutes, 0) AS totalMinutes,
            l.firstDate, l.lastDate,
            COALESCE(s.source_count, 0) AS source_count,
            s.source_ref_first, s.source_url_first, s.source_type_first
       FROM tasks t
       LEFT JOIN log_rollup l ON l.task_id = t.id
       LEFT JOIN source_rollup s ON s.task_id = t.id
      WHERE t.user_id = ?
      ORDER BY t.created_at DESC, t.id DESC`
  ).all(userId, userId, userId);
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

// Milestone 9 (extended by migration 035) — a task is Project work, Internal
// (department) work, work on one specific Support Year, or neither, but never
// more than one of the three: enforced here so every write path (create/update/
// link) shares one check rather than duplicating the condition. Thrown (not
// returned as {ok:false}) so it propagates through ipcMain.handle's built-in
// throw-to-rejected-promise behavior and every existing renderer call site's
// try/catch around createTask/updateTask keeps working unchanged.
function assertTaskLinkExclusive(projectId, departmentId, supportYearId) {
  const set = [projectId, departmentId, supportYearId].filter(v => v != null).length;
  if (set > 1) {
    throw new Error('A task cannot be linked to more than one of Project, Department, or Support Year');
  }
}

// task_field_history (migration 037) — same "diff already-resolved human
// values" pattern updateWorkLog uses for recordWorkLogHistory, scoped to a
// task's own profile fields. project_id/department_id are diffed by the
// linked project's NAME / the DEPARTMENT lookup's LABEL (not the raw id) so
// old/new values stay human-facing, matching every other history field here.
const TASK_HISTORY_FIELDS = [
  ['name', 'Name'], ['status', 'Status'], ['company', 'Company'], ['system', 'System'],
  ['project', 'Project'], ['department', 'Department'], ['source', 'Source'],
];

function projectNameById(id) {
  if (id == null) return '';
  const row = db.prepare('SELECT name FROM projects WHERE id = ?').get(id);
  return row ? (row.name || '') : '';
}

// Raw task column values (status_id/company_id/... as ids) -> the human-facing
// snapshot recordTaskHistory diffs against. Takes a plain object shaped like a
// `tasks` row (or a subset built from write-field values) so both updateTask
// (full row) and updateTaskMeta (metadata-only) can share it.
function taskHistorySnapshot(row) {
  return {
    name: row.name || '',
    status: lkCode(row.status_id) || '',
    company: lkLabel(row.company_id) || '',
    system: lkLabel(row.system_id) || '',
    project: projectNameById(row.project_id),
    department: lkLabel(row.department_id) || '',
    source: row.source || '',
  };
}

// Diffs `before` against `nextValues` (both already-resolved human snapshots
// from taskHistorySnapshot) and inserts one task_field_history row per field
// that actually changed. Must be called inside the same tx() as the UPDATE —
// mirrors recordWorkLogHistory/recordClientFieldHistory: only on genuine
// edits to an existing row, never on create or delete.
function recordTaskHistory(userId, taskId, before, nextValues) {
  const now = new Date().toISOString();
  TASK_HISTORY_FIELDS.forEach(([field, label]) => {
    const oldVal = before[field] ?? '';
    const newVal = nextValues[field] ?? '';
    if (String(oldVal) === String(newVal)) return;
    db.prepare(
      `INSERT INTO task_field_history(user_id, task_id, field_name, old_value, new_value, changed_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, taskId, label, String(oldVal), String(newVal), now);
  });
}

// Read-only: a task's history, newest first — mirrors getWorkLogHistory /
// getClientFieldHistory. Exported for parity; not yet wired to any UI beyond
// the tasks:field-history channel itself (same "recorded and readable, not
// yet surfaced" convention getWorkLogHistory started with).
function getTaskFieldHistory(userId, taskId) {
  return db.prepare(
    `SELECT id, field_name AS fieldName, old_value AS oldValue, new_value AS newValue, changed_at AS changedAt
       FROM task_field_history WHERE user_id = ? AND task_id = ?
       ORDER BY changed_at DESC, id DESC`
  ).all(userId, Number(taskId));
}

// Insert a standalone task (no work logs yet — the two-level analogue of a
// "Not Yet" item). Returns the full task.
function createTask(userId, data) {
  const now = new Date().toISOString();
  const f = taskWriteFields(userId, data);
  assertTaskLinkExclusive(f.project_id, f.department_id, f.support_year_id);
  let id;
  tx(() => {
    id = Number(db.prepare(
      `INSERT INTO tasks(user_id, name, status_id, company_id, system_id, project_id, department_id, support_year_id, source, sort_order, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(userId, f.name, f.status_id, f.company_id, f.system_id, f.project_id, f.department_id, f.support_year_id, f.source, nextTaskSort(userId), now, now).lastInsertRowid);
  });
  return getTask(userId, id);
}

// Update a task's profile fields in place (its work logs are untouched). This
// is the full-row editor — it CAN change project_id/department_id — used by
// the actual link editors (openBacklogModal, Projects/Internal Tasks/All
// Tasks). The Timesheet must never call this; see updateTaskMeta below.
// Returns the refreshed task, or null if the caller doesn't own it.
function updateTask(userId, id, data) {
  if (!ownsTask(userId, id)) return null;
  const before = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  const now = new Date().toISOString();
  const f = taskWriteFields(userId, data);
  // The legacy `source` column is a fallback-only field no current UI writes
  // new data into — task origin is now tracked via the task_sources table
  // (see CLAUDE.md: "kept exactly as-is ... new/edited tasks no longer write
  // to it at all"). A caller whose payload omits `source` entirely (e.g. the
  // New/Edit Task modal, which manages sources through task_sources and never
  // includes a `source` key) must not blank it — only a caller that
  // explicitly sends a `source` key (even '') actually intends to change it.
  if (data?.source === undefined) f.source = before.source || '';
  assertTaskLinkExclusive(f.project_id, f.department_id, f.support_year_id);
  const beforeForDiff = taskHistorySnapshot(before);
  const next = taskHistorySnapshot({
    name: f.name, status_id: f.status_id, company_id: f.company_id, system_id: f.system_id,
    project_id: f.project_id, department_id: f.department_id, source: f.source,
  });
  tx(() => {
    recordTaskHistory(userId, id, beforeForDiff, next);
    db.prepare(
      `UPDATE tasks SET name=?, status_id=?, company_id=?, system_id=?, project_id=?, department_id=?, support_year_id=?, source=?, updated_at=?
        WHERE id=? AND user_id=?`
    ).run(f.name, f.status_id, f.company_id, f.system_id, f.project_id, f.department_id, f.support_year_id, f.source, now, id, userId);
  });
  return getTask(userId, id);
}

// Metadata-only task update: name / status / company / system / source ONLY —
// never references project_id / department_id / support_year_id, in the SET
// clause or anywhere else. This is the update path the Timesheet reconciler
// (persistTimesheet) and its Edit Record modal must use: the Timesheet is a
// *session* surface and has no business writing task link columns, but its
// save flow used to call the full updateTask with a link-less payload on
// every task with a session on the viewed day — silently NULLing out any
// existing project/department link on autosave. See migration 037's own note.
// Returns the refreshed task, or null if the caller doesn't own it.
function updateTaskMeta(userId, id, data) {
  if (!ownsTask(userId, id)) return null;
  const before = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  const now = new Date().toISOString();
  const name = String(data?.name ?? '').trim();
  const status_id = lkId('ENTRY_STATUS', data?.status) ?? lkId('ENTRY_STATUS', 'IN_PROGRESS');
  const company_id = lkId('COMPANY', data?.company);
  const system_id = lkIdForUser(userId, 'SYSTEM', data?.system);
  // Same "don't blank a legacy fallback field the caller didn't actually send"
  // guard as updateTask() — belt-and-braces here too, since the Timesheet's
  // own payload (tsTaskPayload) always sends *some* source string, so this
  // only ever matters if a future caller's payload omits the key entirely.
  const source = (data?.source === undefined) ? (before.source || '') : String(data.source ?? '');
  const beforeForDiff = taskHistorySnapshot(before);
  const next = taskHistorySnapshot({
    name, status_id, company_id, system_id,
    project_id: before.project_id, department_id: before.department_id, source,
  });
  tx(() => {
    recordTaskHistory(userId, id, beforeForDiff, next);
    db.prepare(
      `UPDATE tasks SET name=?, status_id=?, company_id=?, system_id=?, source=?, updated_at=?
        WHERE id=? AND user_id=?`
    ).run(name, status_id, company_id, system_id, source, now, id, userId);
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
            t.source AS source, t.project_id AS projectId, t.department_id AS departmentId
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
    departmentId: r.departmentId ?? null,
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
    autoAdvanceTaskStatus(userId, taskId);
  });
  return { ok: true, id, task: getTask(userId, taskId) };
}

// Milestone 10 — logging a session against an OPEN task moves it to
// IN_PROGRESS automatically, one less manual status click on the common
// "just started working on it" path. Never touches BLOCKED/DONE (the WHERE
// clause only matches a task currently at OPEN) and is a completely ordinary
// UPDATE — the same shape any manual status edit already writes, no special
// audit trail needed beyond that.
function autoAdvanceTaskStatus(userId, taskId) {
  const openId = lkId('ENTRY_STATUS', 'OPEN');
  const inProgressId = lkId('ENTRY_STATUS', 'IN_PROGRESS');
  if (openId == null || inProgressId == null) return;
  db.prepare('UPDATE tasks SET status_id = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status_id = ?')
    .run(inProgressId, new Date().toISOString(), taskId, userId, openId);
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

// ── UI state (Milestone 11 — this machine only, same convention as window
// prefs above): last active module + per-module filter state, so the renderer
// can land back where the user left off instead of always Analytics. Exposed
// to the renderer (unlike window_prefs, which main.js reads/writes for itself
// before any window exists) since only the renderer knows which module/filter
// UI is active. One JSON blob, same shape as the renderer's own in-memory
// `uiState` object — db.js never interprets its contents.
function loadUiState(userId) {
  const row = db.prepare('SELECT value FROM user_ui_state WHERE user_id = ?').get(userId);
  const v = row?.value;
  return v ? safeParse(v, {}) : {};
}

function workspaceSearchQuery(text) {
  const tokens = String(text ?? '').normalize('NFKC').match(/[\p{L}\p{N}_-]+/gu) || [];
  return tokens.slice(0, 12).map(token => `"${token.replaceAll('"', '""')}"*`).join(' AND ');
}

// Bounded, user-scoped search for the command palette. Blank queries return
// recently touched items; nonblank queries use migration 046's FTS5 index.
function searchWorkspace(userId, text, requestedLimit = 30) {
  const limit = Math.max(1, Math.min(50, Number(requestedLimit) || 30));
  const query = workspaceSearchQuery(text);
  const rows = query
    ? db.prepare(
      `SELECT kind, entity_id AS id, title, subtitle, updated_at AS updatedAt, bm25(workspace_search) AS rank
         FROM workspace_search
        WHERE workspace_search MATCH ? AND user_id = ?
        ORDER BY rank, updated_at DESC LIMIT ?`
    ).all(query, Number(userId), limit)
    : db.prepare(
      `SELECT kind, entity_id AS id, title, subtitle, updated_at AS updatedAt, 0 AS rank
         FROM workspace_search WHERE user_id = ?
        ORDER BY updated_at DESC LIMIT ?`
    ).all(Number(userId), limit);
  return rows.map(row => ({
    kind: row.kind,
    id: /^\d+$/.test(String(row.id)) ? Number(row.id) : String(row.id),
    title: row.title || '',
    subtitle: row.subtitle || '',
    updatedAt: row.updatedAt || '',
  }));
}
function saveUiState(userId, state) {
  try {
    db.prepare(`INSERT INTO user_ui_state(user_id, value) VALUES(?, ?)
                ON CONFLICT(user_id) DO UPDATE SET value = excluded.value`)
      .run(userId, JSON.stringify(state || {}));
  } catch { /* non-critical */ }
}

// ── Lifecycle / backup ──────────────────────────────────────────────────────
// Checkpoint the WAL into the main DB file and close the handle cleanly. Called
// on app quit so we don't leave a large -wal file behind.
function close() {
  if (!db) return;
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
  try { db.close(); } catch { /* already closing */ }
  db = undefined;
  lkInvalidate();
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

function validateBackupCandidate(file) {
  let candidate;
  try {
    candidate = new DatabaseSync(file, { readOnly: true });
    const integrity = candidate.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
      return { ok: false, error: 'Backup failed SQLite integrity_check' };
    }
    const fk = candidate.prepare('PRAGMA foreign_key_check').all();
    if (fk.length) return { ok: false, error: 'Backup contains dangling foreign-key references' };
    const required = new Set(candidate.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'`
    ).all().map(r => r.name));
    for (const name of ['users', 'schema_migrations', 'tasks', 'work_logs']) {
      if (!required.has(name)) return { ok: false, error: `Backup is missing required table: ${name}` };
    }
    const candidateHead = Number(candidate.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v ?? -1);
    const currentHead = Number(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v ?? -1);
    if (candidateHead < 0 || candidateHead > currentHead) {
      return { ok: false, error: 'Backup schema is not compatible with this app version' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Backup could not be validated: ' + String(err?.message || err) };
  } finally {
    try { candidate?.close(); } catch { /* best effort */ }
  }
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

  const validation = validateBackupCandidate(srcFile);
  if (!validation.ok) return validation;

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

// ── Full Backup (Milestone 8) ───────────────────────────────────────────────
// One action that captures everything the app owns — not just the DB. Copies
// the checkpointed DB, the projects/, company_documents/, and knowledge_hub/ file trees, and
// the rotating backups/ snapshots into a single new timestamped folder, plus
// a manifest.json summary. `desktopDir` is passed in by the caller (main.js
// resolves app.getPath('desktop')) — db.js never imports electron, the same
// separation configureCredentialEncryption() already established. Read-only
// with respect to <userData>: nothing here is written back into it.

// Recursively copies `src` into `dest`. A missing `src` is not an error (a
// fresh-ish install may have no projects/, company_documents/, or knowledge_hub/ yet) — it's
// reported via `existed: false` so the manifest can note it was skipped.
function copyDirRecursive(src, dest) {
  let count = 0, bytes = 0;
  if (!fs.existsSync(src)) return { count, bytes, existed: false };
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      const sub = copyDirRecursive(s, d);
      count += sub.count; bytes += sub.bytes;
    } else if (ent.isFile()) {
      fs.copyFileSync(s, d);
      count++;
      bytes += fs.statSync(s).size;
    }
    // symlinks/sockets etc. skipped — these trees only ever hold plain files
  }
  return { count, bytes, existed: true };
}

// Read-only recovery-readiness snapshot for administrators. This deliberately
// combines database health, backup validation, attachment reachability, storage
// headroom, and encryption portability in one place so a green integrity check
// cannot be mistaken for a complete recovery plan.
function getSystemDiagnostics() {
  const integrity = checkIntegrity();
  const backups = listBackups();
  const backupResults = backups.map(item => ({
    ...item,
    ...validateBackupCandidate(path.join(userDataDir, 'backups', item.name)),
  }));
  const missingFiles = [];
  let referencedFiles = 0;
  for (const [table, column] of [
    ['project_documents', 'file_path'],
    ['company_documents', 'file_path'],
    ['knowledge_attachments', 'file_path'],
  ]) {
    const rows = db.prepare(`SELECT id, ${column} AS filePath FROM "${table}" WHERE ${column} IS NOT NULL AND ${column} != ''`).all();
    for (const row of rows) {
      referencedFiles++;
      try {
        if (!fs.existsSync(resolveStoredPath(row.filePath))) missingFiles.push({ table, id: row.id, path: row.filePath });
      } catch {
        missingFiles.push({ table, id: row.id, path: row.filePath });
      }
    }
  }
  const fileSize = file => {
    try { return fs.statSync(file).size; } catch { return 0; }
  };
  let freeBytes = null;
  try { freeBytes = Number(fs.statfsSync(userDataDir).bavail) * Number(fs.statfsSync(userDataDir).bsize); } catch {}
  const schemaHead = Number(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v || 0);
  const searchRows = Number(db.prepare('SELECT COUNT(*) AS n FROM workspace_search').get()?.n || 0);
  return {
    generatedAt: new Date().toISOString(),
    appVersion: getAppVersion() || '',
    schemaHead,
    sqliteVersion: db.prepare('SELECT sqlite_version() AS v').get().v,
    journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode,
    foreignKeysEnabled: Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys) === 1,
    integrity,
    dataDirectory: userDataDir,
    databaseBytes: fileSize(dbPath()),
    walBytes: fileSize(dbPath() + '-wal'),
    freeBytes,
    users: Number(db.prepare('SELECT COUNT(*) AS n FROM users').get().n),
    workspaceSearchRows: searchRows,
    referencedFiles,
    missingFiles,
    backups: {
      count: backupResults.length,
      validCount: backupResults.filter(item => item.ok).length,
      latest: backupResults[0] || null,
      invalid: backupResults.filter(item => !item.ok).map(item => ({ name: item.name, error: item.error })),
    },
    credentialEncryptionAvailable: isCredentialEncryptionAvailable(),
    credentialPortability: 'Encrypted client passwords and secret keys are tied to the Windows account that created them.',
  };
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function buildBackupFileInventory(root) {
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && ent.name !== 'manifest.json') {
        const stat = fs.statSync(abs);
        files.push({
          path: path.relative(root, abs).split(path.sep).join('/'),
          size: stat.size,
          sha256: sha256File(abs),
        });
      }
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function getAppVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version; }
  catch { return null; }
}

function fullBackup(desktopDir) {
  if (!db) throw new Error('database not open');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const destRoot = path.join(desktopDir, `CooperationTools-Backup-${stamp}`);
  fs.mkdirSync(destRoot, { recursive: true });

  // Checkpointed DB copy — self-contained, no -wal/-shm needed (mirrors db:backup).
  backup(path.join(destRoot, 'cooperation-tools.db'));

  const folders = {};
  for (const [key, srcDir] of [
    ['projects', projectsRootDir()],
    ['company_documents', companyDocumentsRootDir()],
    ['knowledge_hub', knowledgeRootDir()],
    ['backups', path.join(userDataDir, 'backups')],
  ]) {
    const destDir = path.join(destRoot, key);
    const res = copyDirRecursive(srcDir, destDir);
    fs.mkdirSync(destDir, { recursive: true }); // always present, even empty, for a consistent folder shape
    folders[key] = res.existed
      ? { fileCount: res.count, byteCount: res.bytes }
      : { fileCount: 0, byteCount: 0, skipped: true };
  }

  const headRow = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  const tableNames = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
  ).all().map(r => r.name);
  const tableRowCounts = {};
  for (const t of tableNames) tableRowCounts[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;

  const dbBytes = fs.statSync(path.join(destRoot, 'cooperation-tools.db')).size;
  const totalFileCount = 1 + Object.values(folders).reduce((n, f) => n + f.fileCount, 0);
  const totalByteCount = dbBytes + Object.values(folders).reduce((n, f) => n + f.byteCount, 0);

  const manifest = {
    appVersion: getAppVersion(),
    createdAt: new Date().toISOString(),
    schemaHead: headRow ? headRow.v : null,
    tableRowCounts,
    folders,
    totalFileCount,
    totalByteCount,
    fileInventory: buildBackupFileInventory(destRoot),
  };
  fs.writeFileSync(path.join(destRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return { ok: true, path: destRoot, manifest };
}

const FULL_BACKUP_DIRS = ['projects', 'company_documents', 'knowledge_hub', 'backups'];

function inspectFullBackup(bundleDir) {
  const root = path.resolve(String(bundleDir || ''));
  try {
    if (!fs.statSync(root).isDirectory()) return { ok: false, error: 'Selected backup is not a folder' };
  } catch {
    return { ok: false, error: 'Selected backup folder does not exist' };
  }
  if (!path.basename(root).startsWith('CooperationTools-Backup-')) {
    return { ok: false, error: 'Selected folder is not a Cooperation Tools full backup' };
  }

  const manifestFile = path.join(root, 'manifest.json');
  const candidateDb = path.join(root, 'cooperation-tools.db');
  if (!fs.existsSync(manifestFile) || !fs.existsSync(candidateDb)) {
    return { ok: false, error: 'Full backup is missing its manifest or database' };
  }

  let manifest;
  try {
    const stat = fs.statSync(manifestFile);
    if (stat.size > 25 * 1024 * 1024) return { ok: false, error: 'Backup manifest is unexpectedly large' };
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (err) {
    return { ok: false, error: 'Backup manifest could not be read: ' + String(err?.message || err) };
  }

  const dbValidation = validateBackupCandidate(candidateDb);
  if (!dbValidation.ok) return dbValidation;

  const warnings = [];
  const inventory = Array.isArray(manifest.fileInventory) ? manifest.fileInventory : null;
  if (inventory) {
    const seen = new Set();
    for (const item of inventory) {
      const rel = String(item?.path || '');
      if (!rel || seen.has(rel)) return { ok: false, error: 'Backup manifest contains an invalid file inventory' };
      seen.add(rel);
      let abs;
      try { abs = resolveInside(root, ...rel.split('/')); }
      catch { return { ok: false, error: 'Backup manifest contains an unsafe file path' }; }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return { ok: false, error: 'Backup file is missing: ' + rel };
      }
      const size = fs.statSync(abs).size;
      if (size !== Number(item.size) || sha256File(abs) !== item.sha256) {
        return { ok: false, error: 'Backup file failed checksum validation: ' + rel };
      }
    }
    if (!seen.has('cooperation-tools.db')) {
      return { ok: false, error: 'Backup manifest does not cover the database file' };
    }
  } else {
    warnings.push('This backup predates file checksums; database and attachment references were still validated.');
  }

  let candidate;
  try {
    candidate = new DatabaseSync(candidateDb, { readOnly: true });
    const actualHead = Number(candidate.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v ?? -1);
    if (Number(manifest.schemaHead) !== actualHead) {
      return { ok: false, error: 'Backup manifest schema version does not match its database' };
    }
    const refs = [
      ['project_documents', 'file_path'],
      ['company_documents', 'file_path'],
      ['knowledge_attachments', 'file_path'],
    ];
    for (const [table, column] of refs) {
      const exists = candidate.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) continue;
      const rows = candidate.prepare(`SELECT ${column} AS filePath FROM "${table}" WHERE ${column} IS NOT NULL AND ${column} != ''`).all();
      for (const row of rows) {
        const rel = String(row.filePath || '');
        let abs;
        try {
          if (path.isAbsolute(rel)) throw new Error('absolute path');
          abs = resolveInside(root, rel);
        } catch {
          return { ok: false, error: `Backup database contains an unsafe file path in ${table}` };
        }
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          return { ok: false, error: `Backup is missing a file referenced by ${table}: ${rel}` };
        }
      }
    }
  } catch (err) {
    return { ok: false, error: 'Backup attachment references could not be validated: ' + String(err?.message || err) };
  } finally {
    try { candidate?.close(); } catch {}
  }

  return {
    ok: true,
    path: root,
    name: path.basename(root),
    manifest: {
      appVersion: manifest.appVersion || '',
      createdAt: manifest.createdAt || '',
      schemaHead: manifest.schemaHead,
      totalFileCount: Number(manifest.totalFileCount) || 0,
      totalByteCount: Number(manifest.totalByteCount) || 0,
    },
    warnings,
  };
}

function restoreFullBackup(bundleDir) {
  const inspection = inspectFullBackup(bundleDir);
  if (!inspection.ok) return inspection;

  const sourceRoot = inspection.path;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const recoveryRoot = path.join(userDataDir, 'pre-full-restore-backup');
  fs.mkdirSync(recoveryRoot, { recursive: true });
  const recovery = fullBackup(recoveryRoot);

  const stageRoot = resolveInside(userDataDir, `.full-restore-stage-${stamp}`);
  const rollbackRoot = resolveInside(userDataDir, `.full-restore-rollback-${stamp}`);
  fs.mkdirSync(stageRoot, { recursive: true });
  try {
    fs.copyFileSync(path.join(sourceRoot, 'cooperation-tools.db'), path.join(stageRoot, 'cooperation-tools.db'));
    for (const dir of FULL_BACKUP_DIRS) {
      const source = path.join(sourceRoot, dir);
      const target = path.join(stageRoot, dir);
      copyDirRecursive(source, target);
      fs.mkdirSync(target, { recursive: true });
    }
  } catch (err) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    return { ok: false, error: 'Full restore could not be staged: ' + String(err?.message || err) };
  }

  close();
  fs.mkdirSync(rollbackRoot, { recursive: true });
  const installed = [];
  const movedAside = [];
  const targets = ['cooperation-tools.db', ...FULL_BACKUP_DIRS];
  try {
    for (const name of targets) {
      const live = path.join(userDataDir, name);
      if (fs.existsSync(live)) {
        fs.renameSync(live, path.join(rollbackRoot, name));
        movedAside.push(name);
      }
    }
    for (const name of targets) {
      const staged = path.join(stageRoot, name);
      fs.renameSync(staged, path.join(userDataDir, name));
      installed.push(name);
    }
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.rmSync(rollbackRoot, { recursive: true, force: true });
    return { ok: true, recoveryPath: recovery.path };
  } catch (err) {
    for (const name of installed.reverse()) {
      const live = path.join(userDataDir, name);
      if (fs.existsSync(live)) fs.rmSync(live, { recursive: true, force: true });
    }
    for (const name of movedAside.reverse()) {
      const saved = path.join(rollbackRoot, name);
      if (fs.existsSync(saved)) fs.renameSync(saved, path.join(userDataDir, name));
    }
    try { fs.rmSync(stageRoot, { recursive: true, force: true }); } catch {}
    try { openConnection(userDataDir); } catch {}
    return { ok: false, error: 'Full restore failed and the previous data was put back: ' + String(err?.message || err) };
  }
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
      // client_databases/client_external_services are retired (no UI, no CRUD, no rows)
      // but still listed: a repoint over an empty table is free, and dropping them here
      // would silently leave dangling FKs if a row ever reappeared.
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
function knowledgeRootDir() {
  return path.join(userDataDir, 'knowledge_hub');
}
function knowledgeItemDir(id) {
  return path.join(knowledgeRootDir(), String(id));
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
let _allowPlaintextCredentialsForTests = false;
function configureCredentialEncryption(safeStorageLike) {
  _credentialCipher = safeStorageLike || null;
}
function allowPlaintextCredentialsForTests() {
  _allowPlaintextCredentialsForTests = true;
}
function disallowPlaintextCredentialsForTests() {
  _allowPlaintextCredentialsForTests = false;
}
function isCredentialEncryptionAvailable() {
  try { return !!(_credentialCipher && _credentialCipher.isEncryptionAvailable()); }
  catch { return false; }
}
function encryptCredentialValue(plain) {
  if (plain == null || plain === '') return plain ?? '';
  if (typeof plain === 'string' && plain.startsWith(CREDENTIAL_MARKER)) return plain; // already encrypted
  if (!isCredentialEncryptionAvailable()) {
    if (_allowPlaintextCredentialsForTests) return plain;
    throw new Error('Secure credential storage is unavailable; the secret was not saved');
  }
  try { return CREDENTIAL_MARKER + _credentialCipher.encryptString(String(plain)).toString('base64'); }
  catch (err) { throw new Error('Credential encryption failed; the secret was not saved', { cause: err }); }
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
  // Retired sections (no UI, no CRUD, no rows) — kept so the pass still catches
  // any legacy plaintext credential that outlived its section.
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
  tx(() => {
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
  });
  return { encrypted };
}

// Migration 032 originally copied the database before encrypting credentials.
// Sanitize those exact rollback copies in place once safeStorage is available.
// Each file remains a valid, restorable SQLite database; only credential cells
// are transformed, atomically, with the same marker/cipher as the live store.
function sanitizeLegacyCredentialBackups() {
  if (!isCredentialEncryptionAvailable()) return { files: 0, encrypted: 0 };
  const backupDir = path.join(userDataDir, 'pre-encryption-backup');
  if (!fs.existsSync(backupDir)) return { files: 0, encrypted: 0 };
  const names = fs.readdirSync(backupDir)
    .filter(name => /^cooperation-tools-PRE-032-ENCRYPT-.*\.db$/.test(name));
  let files = 0, encrypted = 0;
  for (const name of names) {
    const file = resolveInside(backupDir, name);
    const backupDb = new DatabaseSync(file);
    try {
      backupDb.exec('PRAGMA busy_timeout = 5000');
      backupDb.exec('BEGIN IMMEDIATE');
      for (const [table, columns] of CREDENTIAL_COLUMNS) {
        const exists = backupDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
        if (!exists) continue;
        for (const column of columns) {
          const rows = backupDb.prepare(`SELECT id, ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`).all();
          for (const row of rows) {
            const enc = encryptCredentialValue(row.v);
            if (enc !== row.v) {
              backupDb.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(enc, row.id);
              encrypted++;
            }
          }
        }
      }
      backupDb.exec('COMMIT');
      backupDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      files++;
    } catch (err) {
      try { backupDb.exec('ROLLBACK'); } catch {}
      throw err;
    } finally {
      backupDb.close();
    }
  }
  return { files, encrypted };
}

function clientVpnToApi(r) {
  return {
    id: r.id, companyId: r.company_id, connectionName: r.connection_name, vpnType: r.vpn_type,
    endpoint: r.endpoint, port: r.port, username: r.username, password: decryptCredentialValue(r.password),
    expiryDate: r.expiry_date || '', credentialLocation: r.credential_location || '',
    notes: r.notes, sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
// The identity triple's two lookup-backed parts follow their category's own
// round-trip convention: `role` as the SERVER_ROLE **code** (a logic field, like
// status) and `systemName` as the SYSTEM **label** (a display
// field, like company/system everywhere else — which also keeps the renderer's
// label-based System grouping working unchanged). `roleActive`/`systemActive`
// false marks one of migration 038/039's nullN placeholders: still the row's
// current value, but never an offerable choice. `legacyRole`/`legacySystemName`
// are the pre-lookup free text — read-only, never written again, kept so a
// mapped value's original wording stays visible.
function clientServerToApi(r) {
  return {
    id: r.id, companyId: r.company_id, host: r.host, environment: r.environment,
    os: r.os, hostname: r.hostname, username: r.username, password: decryptCredentialValue(r.password),
    systemId: r.system_id, systemName: lkLabel(r.system_id), systemActive: isLookupActive(r.system_id),
    legacySystemName: r.system_name || '',
    role: lkCode(r.role_id), roleLabel: lkLabel(r.role_id), roleActive: isLookupActive(r.role_id),
    legacyRole: r.role || '',
    // A server has no name of its own: the identity triple names it. The old
    // free-text name/port/credential_location columns are inert legacy plumbing
    // now — read-only, never written again (same convention as `role`/`system_name`).
    legacyServerName: r.server_name || '', legacyPort: r.port || '',
    legacyCredentialLocation: r.credential_location || '',
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
// One row per changed field on an UPDATE to any of the three client_* tables
// that still have a UI (never on create/delete — delete-undo re-creates from a
// snapshot, which is a create, not an edit). `record_type` distinguishes which
// table `record_id` points into (see migration 027 for why there's no FK); the
// retired 'database'/'external' discriminators are never written again, but any
// historical row carrying one is left in place, unread.
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
// `system_id`/`role_id` are diffed by raw FK id but recorded by their human
// label — the same "audit the human-facing value, not the id" rule
// recordTaskHistory follows.
const lkLabelOf = v => lkLabel(v == null || v === '' ? null : Number(v));
const SERVER_HISTORY_FIELDS = [
  ['host', 'Host (IP)'], ['environment', 'Environment'], ['os', 'Operating System'],
  ['hostname', 'Hostname'], ['username', 'Username'], ['password', 'Password', true],
  ['system_id', 'System', false, lkLabelOf],
  ['role_id', 'Role', false, lkLabelOf],
  ['notes', 'Notes'],
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
  fieldDefs.forEach(([column, label, sensitive, fmt]) => {
    const oldVal = before[column] ?? '';
    const newVal = nextValues[column] ?? '';
    if (String(oldVal) === String(newVal)) return;
    // `fmt` maps a stored value to its human-facing form for the audit row (an FK
    // id -> its lookup label). The comparison above always stays on raw values.
    const show = v => (fmt ? String(fmt(v) ?? '') : String(v));
    const oldStr = sensitive ? '(hidden)' : show(oldVal);
    const newStr = sensitive ? '(hidden)' : show(newVal);
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
  // System/Role come from the lookup ids, not the inert legacy text columns
  // (migrations 038/039) — so this list stays searchable by a server's identity.
  const srv = groupClientRows(
    db.prepare('SELECT id, company_id, host, hostname, os, environment, system_id, role_id FROM client_servers WHERE user_id = ?').all(userId),
    r => ({
      id: r.id, type: 'servers', typeLabel: 'Server', name: serverIdentityLabel(r),
      detail: [r.host, r.hostname, r.os].filter(Boolean).join(' · '),
      fields: [r.host, r.hostname, r.os, lkLabel(r.system_id), lkLabel(r.role_id)].filter(Boolean),
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
    id: c.id, code: c.code, label: c.label, nameEn: c.nameEn || c.label, nameAr: c.nameAr || '',
    vpnCount: vpn.counts.get(c.id) || 0, serverCount: srv.counts.get(c.id) || 0,
    internalSystemCount: int_.counts.get(c.id) || 0,
    records: [
      ...(vpn.records.get(c.id) || []), ...(srv.records.get(c.id) || []),
      ...(int_.records.get(c.id) || []),
    ],
  }));
}

// One client's detail: the COMPANY lookup's label + its auth connections,
// servers, and internal systems (all ordered). Returns null if companyId isn't
// a real COMPANY row.
function getClient(userId, companyId) {
  if (!isLookupId('COMPANY', Number(companyId))) return null;
  const vpnConnections = db.prepare(
    'SELECT * FROM client_vpn_connections WHERE company_id = ? AND user_id = ? ORDER BY sort_order, id'
  ).all(companyId, userId).map(clientVpnToApi);
  const servers = db.prepare(
    'SELECT * FROM client_servers WHERE company_id = ? AND user_id = ? ORDER BY sort_order, id'
  ).all(companyId, userId).map(clientServerToApi);
  const internalSystems = db.prepare(
    'SELECT * FROM client_internal_systems WHERE company_id = ? AND user_id = ? ORDER BY sort_order, id'
  ).all(companyId, userId).map(clientInternalSystemToApi);
  const profile = companyProfileFields(companyId);
  return {
    id: Number(companyId), code: profile.companyCode, label: profile.companyNameEn,
    nameEn: profile.companyNameEn, nameAr: profile.companyNameAr,
    vpnConnections, servers, internalSystems,
  };
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

// ── Server identity: System - Role - Environment ─────────────────────────────
// Since migration 038 a server is identified by that triple: all three required,
// unique within a client. Enforced here so the UI gets a readable message, and
// again by a UNIQUE index on the table so a bug can't slip a duplicate past this.
const SERVER_IDENTITY_ERROR = 'A server with this System / Role / Environment already exists for this client.';
const SERVER_IDENTITY_INCOMPLETE = 'A server needs a System, a Role and an Environment.';

// The triple as one human string — a server has no name of its own, so this is
// what names it wherever one is needed (the records search). Mirrors the
// renderer's own serverIdentityText()/srvEnvLabel(); TEST reads "UAT".
function serverIdentityLabel(r) {
  const env = r.environment === 'PRODUCTION' ? 'Production' : (r.environment === 'TEST' ? 'UAT' : r.environment);
  return [lkLabel(r.system_id) || '(no system)', lkLabel(r.role_id) || '(no role)', env || '(no environment)'].join(' - ');
}

// Resolves + validates the identity triple out of an incoming payload.
// `systemName` accepts a SYSTEM label or code (lkId resolves either); since
// migration 039 it must resolve to a real lookup row — free text is no longer a
// valid system. Returns { ok: false, error } rather than throwing: the renderer
// surfaces it.
function resolveServerIdentity(userId, companyId, data, excludeId) {
  const environment = String(data?.environment ?? '').trim();
  const systemId = lkIdForUser(userId, 'SYSTEM', String(data?.systemName ?? '').trim());
  const roleId = lkId('SERVER_ROLE', data?.role ?? '');
  if (systemId == null || !environment || roleId == null) return { ok: false, error: SERVER_IDENTITY_INCOMPLETE };
  const clash = db.prepare(
    `SELECT id FROM client_servers
      WHERE user_id = ? AND company_id = ?
        AND system_id IS ?
        AND role_id IS ?
        AND LOWER(TRIM(environment)) = LOWER(TRIM(?))
        AND id IS NOT ?`
  ).get(userId, companyId, systemId, roleId, environment, excludeId ?? null);
  if (clash) return { ok: false, error: SERVER_IDENTITY_ERROR, conflictId: clash.id };
  return { ok: true, systemId, environment, roleId };
}

function createClientServer(userId, companyId, data) {
  if (!isLookupId('COMPANY', Number(companyId))) return null;
  const identity = resolveServerIdentity(userId, companyId, data, null);
  if (!identity.ok) return identity;
  const now = new Date().toISOString();
  // The inert legacy columns (`role`, `system_name`, `server_name`, `port`,
  // `credential_location`) are deliberately left out of the INSERT; the identity
  // triple names the server, and role_id/system_id are the live fields.
  const id = Number(db.prepare(
    `INSERT INTO client_servers(user_id, company_id, host, environment, os, hostname, username, password, system_id, role_id, notes, sort_order, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(userId, companyId, data?.host ?? '', identity.environment, data?.os ?? '',
        data?.hostname ?? '', data?.username ?? '', encryptCredentialValue(data?.password ?? ''), identity.systemId,
        identity.roleId, data?.notes ?? '', now, now).lastInsertRowid);
  return clientServerToApi(db.prepare('SELECT * FROM client_servers WHERE id = ?').get(id));
}
function updateClientServer(userId, id, data) {
  const beforeRaw = db.prepare('SELECT * FROM client_servers WHERE id = ? AND user_id = ?').get(id, userId);
  if (!beforeRaw) return null;
  const identity = resolveServerIdentity(userId, beforeRaw.company_id, data, id);
  if (!identity.ok) return identity;
  const before = { ...beforeRaw, password: decryptCredentialValue(beforeRaw.password) };
  const next = {
    host: data?.host ?? '', environment: identity.environment, os: data?.os ?? '',
    hostname: data?.hostname ?? '', username: data?.username ?? '', password: data?.password ?? '', system_id: identity.systemId,
    role_id: identity.roleId, notes: data?.notes ?? '',
  };
  tx(() => {
    recordClientFieldHistory(userId, 'server', id, before, next, SERVER_HISTORY_FIELDS);
    db.prepare(
      `UPDATE client_servers SET host = ?, environment = ?, os = ?, hostname = ?, username = ?, password = ?,
         system_id = ?, role_id = ?, notes = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`
    ).run(next.host, next.environment, next.os, next.hostname, next.username, encryptCredentialValue(next.password),
          next.system_id, next.role_id, next.notes, new Date().toISOString(), id, userId);
  });
  return clientServerToApi(db.prepare('SELECT * FROM client_servers WHERE id = ?').get(id));
}
function deleteClientServer(userId, id) {
  db.prepare('DELETE FROM client_servers WHERE id = ? AND user_id = ?').run(id, userId);
  return { ok: true };
}
// Both bulk-System writes below can break the identity triple's uniqueness by
// moving rows under a System name that already has a row with the same
// Role + Environment — so each dry-runs the resulting triples first and refuses
// the whole batch rather than letting the UNIQUE index throw a raw SQLite error
// halfway through. Returns the clashing rows so the UI can name them.
function serverGroupMoveConflicts(userId, companyId, movingIds, systemId) {
  const rows = db.prepare(
    'SELECT id, system_id, role_id, environment FROM client_servers WHERE user_id = ? AND company_id = ?'
  ).all(userId, companyId);
  const moving = new Set(movingIds.map(Number));
  const key = (sys, roleId, env) => [sys, roleId, String(env ?? '').trim().toLowerCase()].join('|');
  const taken = new Map();
  const conflicts = [];
  for (const r of rows) {
    const sys = moving.has(r.id) ? systemId : r.system_id;
    const k = key(sys, r.role_id, r.environment);
    // Named by the identity the row would END UP with, since that's the triple
    // that would collide — not the one it has right now.
    const identity = serverIdentityLabel({ ...r, system_id: sys });
    if (taken.has(k)) conflicts.push({ id: r.id, identity, conflictsWith: taken.get(k).identity });
    else taken.set(k, { id: r.id, identity });
  }
  return conflicts;
}

// Since migration 039 a server group IS a SYSTEM lookup, so this MOVES a group's
// servers onto a different system rather than renaming a free-text tag. Renaming
// the system itself is a catalog edit (Settings -> Systems), which correctly
// relabels it everywhere at once instead of only on this client's servers.
// Name/channel kept for continuity. `oldName`/`newName` are SYSTEM labels/codes.
function renameClientServerSystemGroup(userId, companyId, oldName, newName) {
  const fromId = lkIdForUser(userId, 'SYSTEM', String(oldName ?? '').trim());
  const toId = lkIdForUser(userId, 'SYSTEM', String(newName ?? '').trim());
  if (fromId == null || toId == null) return { ok: false, count: 0 };
  const movingIds = db.prepare(
    'SELECT id FROM client_servers WHERE user_id = ? AND company_id = ? AND system_id IS ?'
  ).all(userId, companyId, fromId).map(r => r.id);
  const conflicts = serverGroupMoveConflicts(userId, companyId, movingIds, toId);
  if (conflicts.length) return { ok: false, count: 0, error: SERVER_IDENTITY_ERROR, conflicts };
  const info = db.prepare(
    `UPDATE client_servers SET system_id = ?, updated_at = ?
      WHERE user_id = ? AND company_id = ? AND system_id IS ?`
  ).run(toId, new Date().toISOString(), userId, companyId, fromId);
  return { ok: true, count: info.changes };
}
// Bulk-assigns an explicit set of servers into a (new or existing) System group,
// as opposed to renameClientServerSystemGroup's match-by-old-name bulk rename.
// `groupName` is a SYSTEM label/code since migration 039 (a group is a system).
function assignClientServerGroup(userId, companyId, recordIds, groupName) {
  const systemId = lkIdForUser(userId, 'SYSTEM', String(groupName ?? '').trim());
  if (systemId == null || !Array.isArray(recordIds) || !recordIds.length) return { ok: false, count: 0 };
  const conflicts = serverGroupMoveConflicts(userId, companyId, recordIds, systemId);
  if (conflicts.length) return { ok: false, count: 0, error: SERVER_IDENTITY_ERROR, conflicts };
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `UPDATE client_servers SET system_id = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND company_id = ?`
  );
  let count = 0;
  tx(() => { recordIds.forEach(id => { count += stmt.run(systemId, now, id, userId, companyId).changes; }); });
  return { ok: true, count };
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
  projectsRootDir, knowledgeRootDir,
  countUsers, getUserByUsername, getUserById, listUsers, countActiveAdmins,
  createUser, updateUserPassword, updateUserAccount, getUnclaimedUser, claimUser,
  listDays, loadDaysRange,
  listCompanies, listSystems, companyEntries, systemEntries, getFilteredWorkLogs,
  getAnalytics, getOverviewStats, getAttentionItems, getRecentActivity,
  createProject, listProjects, getProject, updateProject, deleteProject,
  linkTask, unlinkTask, listLinkableTasks,
  listDepartments, getDepartment, linkDepartmentTask, unlinkDepartmentTask, listLinkableTasksForDepartment,
  listTasks, getTasksIndex, getTask, searchWorkspace, createTask, updateTask, updateTaskMeta, deleteTask,
  getTaskSources, createTaskSource, updateTaskSource, deleteTaskSource, getTaskFieldHistory,
  listWorkLogs, logsForDate, addWorkLog, updateWorkLog, moveWorkLog, mergeTasks, deleteWorkLog, getWorkLogHistory,
  setDayName, getDayName,
  saveProjectDocumentFile, resolveProjectDocumentFile, removeProjectDocumentFile, restoreProjectDocumentFile,
  purgeUnreferencedProjectDocumentFile,
  purgeProjectFiles, restoreProjectFiles,
  listCompanyDocuments, getCompanyDocument, createCompanyDocument, updateCompanyDocument, deleteCompanyDocument,
  saveCompanyDocumentFile, resolveCompanyDocumentFile, removeCompanyDocumentFile, restoreRemovedCompanyDocumentFile,
  purgeUnreferencedCompanyDocumentFile,
  purgeCompanyDocumentFiles, restoreCompanyDocumentFile,
  listKnowledgeItems, getKnowledgeItem, createKnowledgeItem, updateKnowledgeItem, deleteKnowledgeItem, restoreKnowledgeItem,
  saveKnowledgeAttachment, resolveKnowledgeAttachment, removeKnowledgeAttachment, restoreKnowledgeAttachment,
  purgeKnowledgeAttachment, purgeKnowledgeFiles,
  listKnowledgeGroups, createKnowledgeGroup, updateKnowledgeGroup, deleteKnowledgeGroup,
  listClients, getClient, getClientFieldHistory,
  configureCredentialEncryption, allowPlaintextCredentialsForTests, disallowPlaintextCredentialsForTests,
  isCredentialEncryptionAvailable,
  encryptAllPendingCredentials, sanitizeLegacyCredentialBackups,
  createClientVpn, updateClientVpn, deleteClientVpn,
  createClientServer, updateClientServer, deleteClientServer, renameClientServerSystemGroup, assignClientServerGroup,
  createClientInternalSystem, updateClientInternalSystem, deleteClientInternalSystem, renameClientInternalSystemGroup, assignClientInternalGroup,
  loadLookups, saveLookups, getLookupsByCategory,
  loadSubscriptions, saveSubscriptions,
  loadPrefs, savePrefs,
  loadUiState, saveUiState,
  listBackups, restoreBackup, checkIntegrity, getSystemDiagnostics, findLookupDuplicates, mergeLookupDuplicate, getOrphanSweepReport,
  fullBackup, inspectFullBackup, restoreFullBackup,
};
