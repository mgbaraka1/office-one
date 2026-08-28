'use strict';

// Migration 050 and bilingual managed-catalog regression coverage. The all-test
// runner redirects the production-looking source path to a generated fixture;
// this suite makes another private copy and never writes to the source fixture.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db');

// Guards against reading/copying the REAL production DB when this file is
// run directly (node test/<this file>) instead of via run-all.js — see
// test-bootstrap.js.
require('./test-bootstrap');

const source = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one', 'cooperation-tools.db');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilingual-lookups-smoke-'));
const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilingual-lookups-fresh-'));
fs.copyFileSync(source, path.join(workDir, 'cooperation-tools.db'));

let failed = false;
function check(name, pass, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failed = true;
}

try {
  db.openConnection(workDir);
  db.applyMigrations();
  const user = db.getUserByUsername('fixture-user') || db.listUsers()[0];
  if (!user) throw new Error('No fixture user');

  const statuses = db.getLookupsByCategory('ENTRY_STATUS', true);
  const ticket = statuses.find(item => item.code === 'OPEN');
  check('built-in catalog labels expose English and Arabic names',
    ticket?.nameEn === 'Open' && ticket?.nameAr === 'مفتوحة', JSON.stringify(ticket));

  db.saveLookups(user.id, { categories: { ENTRY_STATUS: [{
    id: ticket.id, code: ticket.code, label: 'Available',
    nameEn: 'Available', nameAr: 'متاحة', isActive: true,
  }] } });
  const updated = db.getLookupsByCategory('ENTRY_STATUS', true).find(item => item.id === ticket.id);
  check('Settings saves both language labels on the same immutable lookup row',
    updated?.id === ticket.id && updated?.label === 'Available'
      && updated?.nameEn === 'Available' && updated?.nameAr === 'متاحة');

  db.close();
  const raw = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'), { readOnly: true });
  const head = raw.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version;
  const stored = raw.prepare('SELECT id, name_en, name_ar FROM lookup_codes WHERE category = ? AND code = ?')
    .get('ENTRY_STATUS', 'OPEN');
  raw.close();
  check('migration 050 is applied without replacing the lookup id',
    head >= 50 && stored.id === ticket.id && stored.name_en === 'Available' && stored.name_ar === 'متاحة',
    `head=${head}, id=${stored.id}`);

  // ── Migration 059: the fresh-install seed ────────────────────────────────
  // 003 built TIME_TYPE/ACTIVITY_TYPE from the legacy blob UNION the values
  // already in the data — both empty on a brand-new database, so both
  // categories came up with zero rows and a first-run user got blank Time
  // Type / Natural dropdowns. 059 seeds them, but ONLY when the category is
  // empty. No existing install can exercise that path, so it can only be
  // caught here: this section boots a genuinely empty database.
  db.close();
  fs.rmSync(freshDir, { recursive: true, force: true });
  fs.mkdirSync(freshDir, { recursive: true });
  db.openConnection(freshDir);
  db.applyMigrations();

  for (const [category, expected] of [['TIME_TYPE', 'WORK_TIME'], ['ACTIVITY_TYPE', 'TICKET']]) {
    const rows = db.getLookupsByCategory(category, true);
    check(`fresh install seeds ${category} rather than leaving the dropdown empty`,
      rows.length === 5 && rows.some(item => item.code === expected),
      `${rows.length} rows`);
    check(`fresh install ${category} rows carry both language labels`,
      rows.every(item => item.nameEn && item.nameAr && item.nameEn.trim() && item.nameAr.trim()));
  }

  // COMPANY staying empty is deliberate — the roster is the user's to create.
  check('fresh install leaves COMPANY empty for the user to populate',
    db.getLookupsByCategory('COMPANY', true).length === 0);

  // The guard that makes 059 safe on a live database: a curated catalog is
  // never re-seeded, re-labelled, re-ordered or re-enabled.
  // Edited straight on the connection: a fresh database has no account yet, and
  // saveLookups() needs one to attribute the change to. What is under test here
  // is the migration's guard, not the Settings write path (covered above).
  db.getConnection().prepare(
    `UPDATE lookup_codes SET label = ?, name_en = ?, name_ar = ?, is_active = 0
      WHERE category = 'TIME_TYPE' AND code = 'WORK_TIME'`
  ).run('Billable Hours', 'Billable Hours', 'ساعات مدفوعة');
  const before = JSON.stringify(db.getLookupsByCategory('TIME_TYPE', true));
  require('../migrations/059_seed_fixed_lookups.js').up(db.getConnection());
  check('migration 059 is a no-op once the category has rows',
    JSON.stringify(db.getLookupsByCategory('TIME_TYPE', true)) === before);

  // Windows holds the SQLite file open; the finally block cannot remove the
  // directory until this connection is closed.
  db.close();
} catch (error) {
  console.error(error);
  failed = true;
  try { db.close(); } catch (_) {}
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.rmSync(freshDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
