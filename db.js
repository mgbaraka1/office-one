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

// ── Defaults / seed data ──────────────────────────────────────────────────────
const DEFAULT_LOOKUPS = {
  companies: ['Amana', 'Arabia', 'Liva', 'Maknanah', 'ACME', 'Elm Almaknanah', 'AJT', 'Saudi Enaya', 'Salama'],
  projects:  ['Visa', 'Online Platform', 'Data Hub', 'QA Test', 'Uploader', 'BILLING Visa', 'Payment Gateway', '-'],
  natural:   ['Ticket', 'Task', 'Meeting', 'Call', '-'],
  timeType:  ['Work Time', 'Over Time', 'Training', 'Leave', 'Holiday'],
  status:    ['Done', 'In Progress'],
};

let db;          // DatabaseSync instance
let userDataDir; // for one-time JSON migration

// ── Schema ──────────────────────────────────────────────────────────────────
function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS days (
      date TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      rows TEXT NOT NULL DEFAULT '[]'   -- JSON array of row objects (variable shape)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id           TEXT PRIMARY KEY,
      name         TEXT, cost TEXT, currency TEXT,
      billingCycle TEXT, endDate TEXT, renewalDate TEXT,
      sort_order   INTEGER
    );

    -- "Not Yet" backlog: a day-agnostic pool of tasks (no date binding). A task
    -- is picked out of here and assigned into a specific day when worked on.
    CREATE TABLE IF NOT EXISTS backlog (
      id          TEXT PRIMARY KEY,
      company     TEXT, project TEXT, natural TEXT, time TEXT,
      description TEXT, source TEXT,
      tags        TEXT,            -- JSON array of strings
      createdAt   TEXT,            -- ISO timestamp set when the task entered the pool (null = unknown/legacy)
      sort_order  INTEGER
    );

    -- Generic key/value store: lookups, default currency, window bounds, flags.
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

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

// ── meta helpers ──────────────────────────────────────────────────────────────
function metaGet(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : undefined;
}
function metaSet(key, value) {
  db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// ── One-time import of pre-existing JSON files (older app versions) ─────────────
// Non-destructive: reads the JSON files but never modifies or deletes them.
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch {
    const bak = file + '.bak';
    if (fs.existsSync(bak)) { try { return JSON.parse(fs.readFileSync(bak, 'utf-8')); } catch { return null; } }
    return null;
  }
}

function migrateFromJson() {
  // Days
  const daysDir = path.join(userDataDir, 'days');
  if (fs.existsSync(daysDir)) {
    const files = fs.readdirSync(daysDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
    for (const f of files) {
      const data = readJson(path.join(daysDir, f));
      if (data) saveDay(f.replace('.json', ''), data);
    }
  }

  // Lookups
  const lookups = readJson(path.join(userDataDir, 'lookups.json'));
  if (lookups) metaSet('lookups', JSON.stringify(lookups));

  // Subscriptions
  const subs = readJson(path.join(userDataDir, 'subscriptions.json'));
  if (subs) saveSubscriptions(subs);

  // Window prefs
  const prefs = readJson(path.join(userDataDir, 'prefs.json'));
  if (prefs) metaSet('window_prefs', JSON.stringify(prefs));
}

// ── Public init ─────────────────────────────────────────────────────────────
function init(dir) {
  userDataDir = dir;
  const dbPath = path.join(dir, 'cooperation-tools.db');
  const isNew  = !fs.existsSync(dbPath);

  db = new DatabaseSync(dbPath);   // auto-creates the file if missing
  db.exec('PRAGMA journal_mode = WAL');   // crash-safe writes
  db.exec('PRAGMA synchronous = NORMAL'); // WAL-recommended: durable + fast (only the
                                          //   last txn is at risk on power loss, never corruption)
  db.exec('PRAGMA busy_timeout = 5000');  // wait up to 5s on a lock (backup/PDF window) instead
                                          //   of throwing SQLITE_BUSY
  db.exec('PRAGMA foreign_keys = ON');
  createSchema();
  ensureBacklogColumns();   // additive migration for DBs created before createdAt existed

  // First run only: import any legacy JSON data. On later runs, snapshot the
  // existing DB into the rotating backups folder.
  if (isNew) tx(migrateFromJson);
  else rotateBackups();

  // The Licenses and Insurance modules were removed. Drop their tables (one-time
  // cleanup). On an existing DB the rotateBackups() snapshot above captures the
  // data first, so there's still a recovery copy in backups/.
  dropRemovedModuleTables();

  // "Not Yet" is now a day-agnostic backlog, not a per-day row status. One-time:
  // move every existing "Not Yet"/"Pending" day-row into the backlog table and
  // drop "Not Yet" from the saved status lookup. Guarded by a meta flag so it
  // runs exactly once; the rotateBackups() snapshot above is the recovery copy.
  migrateNotYetToBacklog();
}

// Additive, idempotent column migration: older DBs predate backlog.createdAt.
// SQLite's ADD COLUMN is cheap and backfills existing rows with NULL (= "unknown
// arrival time"), which the analytics task-flow widgets render as such.
function ensureBacklogColumns() {
  const cols = db.prepare('PRAGMA table_info(backlog)').all().map(c => c.name);
  if (!cols.includes('createdAt')) db.exec('ALTER TABLE backlog ADD COLUMN createdAt TEXT');
}

// One-time conversion of legacy per-day "Not Yet" rows into the standalone
// backlog pool. Idempotent via the `notyet_backlog_migrated` meta flag.
function migrateNotYetToBacklog() {
  if (metaGet('notyet_backlog_migrated') === '1') return;
  const isNotYet = (r) => r && (r.status === 'Not Yet' || r.status === 'Pending');
  tx(() => {
    const days = db.prepare('SELECT date, rows FROM days ORDER BY date ASC').all();
    const insert = db.prepare(`INSERT INTO backlog(id, company, project, natural, time, description, source, tags, sort_order)
                               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let order = 0;
    for (const d of days) {
      const rows = safeParse(d.rows, []);
      const moved = rows.filter(isNotYet);
      if (moved.length === 0) continue;
      const keep = rows.filter(r => !isNotYet(r));
      moved.forEach(r => {
        const id = 'bl_' + Date.now().toString(36) + '_' + order + '_' + Math.random().toString(36).slice(2, 7);
        insert.run(
          id, r.company ?? '', r.project ?? '', r.natural ?? '', r.time ?? '',
          r.description ?? '', r.source ?? '',
          JSON.stringify(Array.isArray(r.tags) ? r.tags : []), order++
        );
      });
      // A day left with no rows would otherwise show as a phantom "has data" day
      // on the calendar — remove it. Otherwise persist the trimmed rows.
      if (keep.length === 0) db.prepare('DELETE FROM days WHERE date = ?').run(d.date);
      else db.prepare('UPDATE days SET rows = ? WHERE date = ?').run(JSON.stringify(keep), d.date);
    }

    // Drop "Not Yet"/"Pending" from the saved status lookup so the day Add/Edit
    // form no longer offers it (DEFAULT_LOOKUPS already excludes it for fresh DBs).
    const lk = metaGet('lookups');
    if (lk) {
      const parsed = safeParse(lk, null);
      if (parsed && Array.isArray(parsed.status)) {
        parsed.status = parsed.status.filter(s => s !== 'Not Yet' && s !== 'Pending');
        metaSet('lookups', JSON.stringify(parsed));
      }
    }

    metaSet('notyet_backlog_migrated', '1');
  });
}

// One-time teardown of tables for modules that no longer exist (Licenses,
// Insurance). DROP IF EXISTS is a no-op once they're gone / on a fresh DB.
function dropRemovedModuleTables() {
  try {
    db.exec(`
      DROP TABLE IF EXISTS license_extras;
      DROP TABLE IF EXISTS licenses;
      DROP TABLE IF EXISTS insurance_extras;
      DROP TABLE IF EXISTS insurance;
    `);
  } catch { /* non-critical */ }
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

// ── Days ──────────────────────────────────────────────────────────────────────
function saveDay(dateStr, data) {
  const name = data?.name || '';
  const rows = JSON.stringify(data?.rows || []);
  db.prepare(`INSERT INTO days(date, name, rows) VALUES(?, ?, ?)
              ON CONFLICT(date) DO UPDATE SET name = excluded.name, rows = excluded.rows`)
    .run(dateStr, name, rows);
}

function loadDay(dateStr) {
  const row = db.prepare('SELECT name, rows FROM days WHERE date = ?').get(dateStr);
  if (!row) return null;
  return { name: row.name, rows: safeParse(row.rows, []) };
}

function listDays() {
  return db.prepare('SELECT date FROM days ORDER BY date DESC').all().map(r => r.date);
}

// All days in [from, to] inclusive, oldest first — one query (powers Analytics +
// range reports without N IPC round-trips). Returns [{date, name, rows[]}].
function loadDaysRange(from, to) {
  const recs = db.prepare(
    'SELECT date, name, rows FROM days WHERE date >= ? AND date <= ? ORDER BY date ASC'
  ).all(from, to);
  return recs.map(r => ({ date: r.date, name: r.name, rows: safeParse(r.rows, []) }));
}

// ── Backlog ("Not Yet" pool) ────────────────────────────────────────────────────
// A day-agnostic list of tasks. Returns { backlog: [...] }; mirrors the
// subscriptions IPC shape so the renderer treats it the same way.
function loadBacklog() {
  const backlog = db.prepare(
    'SELECT id, company, project, natural, time, description, source, tags, createdAt FROM backlog ORDER BY sort_order'
  ).all().map(t => ({
    id: t.id,
    company: t.company || '', project: t.project || '', natural: t.natural || '', time: t.time || '',
    description: t.description || '', source: t.source || '',
    tags: safeParse(t.tags, []),
    createdAt: t.createdAt || null,
  }));
  return { backlog };
}

function saveBacklog(data) {
  const list = Array.isArray(data?.backlog) ? data.backlog : [];
  tx(() => {
    db.exec('DELETE FROM backlog');
    const stmt = db.prepare(`INSERT INTO backlog(id, company, project, natural, time, description, source, tags, createdAt, sort_order)
                             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    list.forEach((t, i) => stmt.run(
      t.id, t.company ?? '', t.project ?? '', t.natural ?? '', t.time ?? '',
      t.description ?? '', t.source ?? '',
      JSON.stringify(Array.isArray(t.tags) ? t.tags : []), t.createdAt ?? null, i
    ));
  });
}

// ── Lookups ────────────────────────────────────────────────────────────────────
function loadLookups() {
  const v = metaGet('lookups');
  return v ? safeParse(v, DEFAULT_LOOKUPS) : DEFAULT_LOOKUPS;
}
function saveLookups(data) {
  metaSet('lookups', JSON.stringify(data));
}

// ── Subscriptions ───────────────────────────────────────────────────────────────
function loadSubscriptions() {
  const subscriptions = db.prepare(
    'SELECT id, name, cost, currency, billingCycle, endDate, renewalDate FROM subscriptions ORDER BY sort_order'
  ).all();
  const defaultCurrency = metaGet('subscriptions_default_currency') || 'USD';
  return { subscriptions, defaultCurrency };
}
function saveSubscriptions(data) {
  const list = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
  const currency = data?.defaultCurrency || 'USD';
  tx(() => {
    db.exec('DELETE FROM subscriptions');
    const stmt = db.prepare(`INSERT INTO subscriptions(id, name, cost, currency, billingCycle, endDate, renewalDate, sort_order)
                             VALUES(?, ?, ?, ?, ?, ?, ?, ?)`);
    list.forEach((s, i) => stmt.run(
      s.id, s.name ?? '', s.cost ?? '', s.currency ?? '',
      s.billingCycle ?? '', s.endDate ?? '', s.renewalDate ?? '', i
    ));
    metaSet('subscriptions_default_currency', currency);
  });
}

// ── Window prefs ────────────────────────────────────────────────────────────────
function loadPrefs() {
  const v = metaGet('window_prefs');
  return v ? safeParse(v, {}) : {};
}
function savePrefs(prefs) {
  try { metaSet('window_prefs', JSON.stringify(prefs)); } catch { /* non-critical */ }
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
  init, close, backup, dbPath,
  saveDay, loadDay, listDays, loadDaysRange,
  loadBacklog, saveBacklog,
  loadLookups, saveLookups,
  loadSubscriptions, saveSubscriptions,
  loadPrefs, savePrefs,
};
