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

const source = path.join(os.homedir(), 'AppData', 'Roaming', 'timesheet', 'cooperation-tools.db');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilingual-lookups-smoke-'));
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
    head === 50 && stored.id === ticket.id && stored.name_en === 'Available' && stored.name_ar === 'متاحة',
    `head=${head}, id=${stored.id}`);
} catch (error) {
  console.error(error);
  failed = true;
  try { db.close(); } catch (_) {}
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
