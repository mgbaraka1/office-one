'use strict';

// Migration 047 and bilingual client-profile regression coverage.
// The all-tests runner points the production-looking path at a generated fixture;
// this test still works on a private copy so it never mutates even that fixture.
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
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-profile-smoke-'));
const target = path.join(workDir, 'cooperation-tools.db');
fs.copyFileSync(source, target);

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

let exitCode = 0;
try {
  db.openConnection(workDir);
  db.applyMigrations();
  const user = db.getUserByUsername('fixture-user') || db.listUsers()[0];
  if (!user) throw new Error('No fixture user');

  const before = db.getLookupsByCategory('COMPANY', true);
  check('existing companies are backfilled with an English name',
    before.every(c => c.nameEn === c.label && typeof c.nameAr === 'string'));

  db.saveLookups(user.id, { categories: { COMPANY: [{
    code: 'CLIENT_047_TEST', label: 'Profile Test', nameEn: 'Profile Test',
    nameAr: 'عميل الاختبار', isActive: true,
  }] } });
  const created = db.getLookupsByCategory('COMPANY', true).find(c => c.code === 'CLIENT_047_TEST');
  check('a bilingual client profile can be created',
    created && created.nameEn === 'Profile Test' && created.nameAr === 'عميل الاختبار');

  const task = db.createTask(user.id, {
    name: 'Client profile link test', status: 'IN_PROGRESS', company: created.code,
    system: '', source: '',
  });
  const originalId = created.id;

  // A company code is WRITE-ONCE. saveLookups used to run a COMPANY-specific
  // UPDATE that included `code`, so an existing client's business code could be
  // rewritten after the fact. It no longer can: no update path in db.js touches
  // lookup_codes.code for any category. A caller that sends a changed code is
  // not an error — the field is simply ignored, while the names still save.
  db.saveLookups(user.id, { categories: { COMPANY: [{
    ...created, code: 'CLIENT_047_RENAMED', label: 'Renamed Client',
    nameEn: 'Renamed Client', nameAr: 'العميل بعد التعديل',
  }] } });

  const updated = db.getTask(user.id, task.id);
  check('a name edit reaches the linked task, and the code does not change',
    updated.companyCode === 'CLIENT_047_TEST'
      && updated.companyNameEn === 'Renamed Client'
      && updated.companyNameAr === 'العميل بعد التعديل',
    `task=${task.id}, companyId=${originalId}, code=${updated.companyCode}`);
  const client = db.listClients(user.id).find(c => c.id === originalId);
  check('Clients exposes the unchanged code plus both names',
    client?.code === 'CLIENT_047_TEST'
      && client?.nameEn === 'Renamed Client'
      && client?.nameAr === 'العميل بعد التعديل');

  // The same guarantee through the Clients page's own rename channel, which
  // does not even accept a code — passing one must have no effect.
  const renamed = db.renameClient(user.id, originalId, {
    nameEn: 'Renamed Again', nameAr: 'مرة أخرى', code: 'CLIENT_047_HIJACK',
  });
  check('renameClient updates both names', renamed.ok
    && renamed.client.nameEn === 'Renamed Again' && renamed.client.nameAr === 'مرة أخرى');
  check('renameClient cannot change the company code',
    renamed.client.code === 'CLIENT_047_TEST', `code=${renamed.client?.code}`);

  let duplicateRejected = false;
  try {
    db.saveLookups(user.id, { categories: { COMPANY: [{
      code: 'CLIENT_047_TEST', label: 'Duplicate Code', nameEn: 'Duplicate Code',
      nameAr: '', isActive: true,
    }] } });
  } catch (error) {
    duplicateRejected = /already in use/i.test(String(error?.message || error));
  }
  check('duplicate business codes are rejected', duplicateRejected);

  db.close();
  const raw = new DatabaseSync(target, { readOnly: true });
  const cols = raw.prepare('PRAGMA table_info(lookup_codes)').all().map(c => c.name);
  const linked = raw.prepare('SELECT company_id FROM tasks WHERE id = ?').get(task.id);
  const version = raw.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version;
  check('migration 047 adds both profile columns', version >= 47 && cols.includes('name_en') && cols.includes('name_ar'));
  check('the stored task FK remains the immutable company row id', Number(linked.company_id) === Number(originalId));
  raw.close();

  if (checks.some(c => !c.pass)) exitCode = 1;
} catch (error) {
  console.error(error);
  exitCode = 1;
  try { db.close(); } catch (_) {}
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}

if (exitCode) process.exit(exitCode);
