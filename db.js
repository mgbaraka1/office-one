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
  status:    ['Done', 'In Progress', 'Not Yet'],
};

// Seed data transcribed from the user's existing tracking spreadsheet — written
// only when initialising a brand-new database that has no JSON data to import.
const DEFAULT_LICENSES = [
  { id: 'lic_seed_01', item: 'السجل التجاري',                                   type: 'Governmental',         extras: [], docNumber: '1010225881',         issueDateHijri: '07-11-1445', expiryDateHijri: '16-12-1448', issueDate: '2024-05-15', expiryDate: '2027-05-14', notes: '' },
  { id: 'lic_seed_02', item: 'غرفة السعودة ( شهادة التوطين )',                   type: 'Governmental',         extras: [], docNumber: '384801-10203570',     issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2025-05-15', expiryDate: '2025-08-13', notes: '' },
  { id: 'lic_seed_03', item: 'غرفة الرياض ( الغرفة التجارية )',                  type: 'Governmental',         extras: [], docNumber: '173342',              issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2006-12-11', expiryDate: '2027-05-22', notes: '' },
  { id: 'lic_seed_04', item: 'الهيئة العامة للذكاء والدخل ( هيئة الزكاة والضريبة والجمارك )', type: 'Governmental', extras: [], docNumber: '1026578259', issueDateHijri: '06-05-1447', expiryDateHijri: '29-04-1448', issueDate: '2025-10-19', expiryDate: '2026-10-10', notes: '' },
  { id: 'lic_seed_05', item: 'شهادة التأمينات الاجتماعية',                       type: 'Governmental',         extras: [], docNumber: '110309257',           issueDateHijri: '12-09-1447', expiryDateHijri: '13-10-1447', issueDate: '2026-03-01', expiryDate: '2026-04-01', notes: '' },
  { id: 'lic_seed_07', item: 'فحص السيارة الكامري',                              type: 'Other',                extras: [], docNumber: '',                    issueDateHijri: '',           expiryDateHijri: '',           issueDate: '',           expiryDate: '',           notes: '' },
  { id: 'lic_seed_10', item: 'تجديد سيرفر اونلاين ( OVHcloud )',                 type: 'Service/Subscription', extras: [], docNumber: '',                    issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2026-05-01', expiryDate: '2026-06-01', notes: '' },
  { id: 'lic_seed_11', item: 'تجديد موقع المؤسسة',                               type: 'Service/Subscription', extras: [], docNumber: '',                    issueDateHijri: '',           expiryDateHijri: '',           issueDate: '',           expiryDate: '',           notes: '' },
  { id: 'lic_seed_17', item: 'فاتورة جيرا support ( Atlassian )',                type: 'Service/Subscription', extras: [], docNumber: '',                    issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2026-05-26', expiryDate: '2026-06-25', notes: '' },
  { id: 'lic_seed_18', item: 'فاتورة جيرا مهام ( Atlassian )',                   type: 'Service/Subscription', extras: [], docNumber: '',                    issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2026-05-26', expiryDate: '2026-06-26', notes: '' },
  { id: 'lic_seed_19', item: 'ايجار المكتب',                                     type: 'Other',                extras: [], docNumber: '',                    issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2025-08-01', expiryDate: '2026-07-31', notes: '' },
];

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

    CREATE TABLE IF NOT EXISTS licenses (
      id             TEXT PRIMARY KEY,
      item           TEXT, type TEXT, docNumber TEXT,
      issueDateHijri TEXT, expiryDateHijri TEXT,
      issueDate      TEXT, expiryDate TEXT, notes TEXT,
      sort_order     INTEGER
    );
    CREATE TABLE IF NOT EXISTS license_extras (
      license_id TEXT, seq INTEGER, label TEXT, value TEXT
    );

    CREATE TABLE IF NOT EXISTS insurance (
      id           TEXT PRIMARY KEY,
      item         TEXT, category TEXT, provider TEXT, policyNumber TEXT,
      issueDate    TEXT, expiryDate TEXT,
      sort_order   INTEGER
    );
    CREATE TABLE IF NOT EXISTS insurance_extras (
      insurance_id TEXT, seq INTEGER, label TEXT, value TEXT
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

  // Insurance
  const ins = readJson(path.join(userDataDir, 'insurance.json'));
  if (ins) saveInsurance(ins);

  // Licenses — import existing file if present, otherwise seed defaults.
  const lic = readJson(path.join(userDataDir, 'licenses.json'));
  if (lic && Array.isArray(lic.licenses)) saveLicenses(lic);
  else saveLicenses({ licenses: DEFAULT_LICENSES });

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

  // First run only: import any legacy JSON data / seed the licenses module.
  // On later runs, snapshot the existing DB into the rotating backups folder.
  if (isNew) tx(migrateFromJson);
  else rotateBackups();
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

// Scan every day's rows (newest day first), collecting { date, idx, row } for each
// row matching `predicate(row, date)` — `idx` is the row's position within that day.
// One table scan in the main process, shared by getCarryOver / getOpenItems (rather
// than N renderer round-trips).
function scanRows(predicate) {
  const days = db.prepare('SELECT date, rows FROM days ORDER BY date DESC').all();
  const items = [];
  for (const d of days) {
    safeParse(d.rows, []).forEach((row, idx) => {
      if (predicate(row, d.date)) items.push({ date: d.date, idx, row });
    });
  }
  return items;
}

// All "Not Yet" rows across every day (except `excludeDate`), newest day first.
function getCarryOver(excludeDate) {
  return scanRows((row, date) => date !== excludeDate && row.status === 'Not Yet');
}

// All open work across every day: status "In Progress" or "Not Yet"/"Pending".
function getOpenItems() {
  return scanRows(row => row.status === 'In Progress' || row.status === 'Not Yet' || row.status === 'Pending');
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

// ── Licenses ────────────────────────────────────────────────────────────────────
function loadLicenses() {
  const rows = db.prepare(
    'SELECT id, item, type, docNumber, issueDateHijri, expiryDateHijri, issueDate, expiryDate, notes FROM licenses ORDER BY sort_order'
  ).all();
  const extras = db.prepare('SELECT license_id, label, value FROM license_extras ORDER BY seq').all();
  const byId = new Map(rows.map(r => [r.id, Object.assign(r, { extras: [] })]));
  for (const e of extras) {
    const rec = byId.get(e.license_id);
    if (rec) rec.extras.push({ label: e.label, value: e.value });
  }
  return { licenses: rows };
}
function saveLicenses(data) {
  const list = Array.isArray(data?.licenses) ? data.licenses : [];
  tx(() => {
    db.exec('DELETE FROM license_extras');
    db.exec('DELETE FROM licenses');
    const stmt = db.prepare(`INSERT INTO licenses(id, item, type, docNumber, issueDateHijri, expiryDateHijri, issueDate, expiryDate, notes, sort_order)
                             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const exStmt = db.prepare('INSERT INTO license_extras(license_id, seq, label, value) VALUES(?, ?, ?, ?)');
    list.forEach((l, i) => {
      stmt.run(l.id, l.item ?? '', l.type ?? '', l.docNumber ?? '', l.issueDateHijri ?? '',
               l.expiryDateHijri ?? '', l.issueDate ?? '', l.expiryDate ?? '', l.notes ?? '', i);
      (l.extras || []).forEach((ex, j) => exStmt.run(l.id, j, ex.label ?? '', ex.value ?? ''));
    });
  });
}

// ── Insurance ───────────────────────────────────────────────────────────────────
function loadInsurance() {
  const rows = db.prepare(
    'SELECT id, item, category, provider, policyNumber, issueDate, expiryDate FROM insurance ORDER BY sort_order'
  ).all();
  const extras = db.prepare('SELECT insurance_id, label, value FROM insurance_extras ORDER BY seq').all();
  const byId = new Map(rows.map(r => [r.id, Object.assign(r, { extras: [] })]));
  for (const e of extras) {
    const rec = byId.get(e.insurance_id);
    if (rec) rec.extras.push({ label: e.label, value: e.value });
  }
  return { insurance: rows };
}
function saveInsurance(data) {
  const list = Array.isArray(data?.insurance) ? data.insurance : [];
  tx(() => {
    db.exec('DELETE FROM insurance_extras');
    db.exec('DELETE FROM insurance');
    const stmt = db.prepare(`INSERT INTO insurance(id, item, category, provider, policyNumber, issueDate, expiryDate, sort_order)
                             VALUES(?, ?, ?, ?, ?, ?, ?, ?)`);
    const exStmt = db.prepare('INSERT INTO insurance_extras(insurance_id, seq, label, value) VALUES(?, ?, ?, ?)');
    list.forEach((n, i) => {
      stmt.run(n.id, n.item ?? '', n.category ?? '', n.provider ?? '', n.policyNumber ?? '',
               n.issueDate ?? '', n.expiryDate ?? '', i);
      (n.extras || []).forEach((ex, j) => exStmt.run(n.id, j, ex.label ?? '', ex.value ?? ''));
    });
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
  saveDay, loadDay, listDays, loadDaysRange, getCarryOver, getOpenItems,
  loadLookups, saveLookups,
  loadSubscriptions, saveSubscriptions,
  loadLicenses, saveLicenses,
  loadInsurance, saveInsurance,
  loadPrefs, savePrefs,
};
