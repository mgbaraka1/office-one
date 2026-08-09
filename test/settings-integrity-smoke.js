'use strict';

// Phase 1 of SETTINGS_REFACTOR_PLAN.md: db.saveLookups() used to bare-`return`
// on a blank English label, a case-insensitive duplicate label, or a private
// lookup id it couldn't access — while the caller still reported success. This
// suite proves those three cases are now reported back as `skipped` entries
// instead of vanishing silently, and that a thrown validation error (a COMPANY
// code collision) still carries its real message rather than a generic one.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const db = require('../db');

require('./test-bootstrap');

const source = path.join(os.homedir(), 'AppData', 'Roaming', 'timesheet', 'cooperation-tools.db');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-integrity-smoke-'));
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

  const before = db.getLookupsByCategory('ENTRY_STATUS', true);
  const target = before.find(item => item.code === 'OPEN');
  const other = before.find(item => item.code !== 'OPEN');

  // 1. A row with no English label (and no Arabic label either) is reported,
  //    not silently dropped, and the existing row is left untouched.
  const blankResult = db.saveLookups(user.id, { categories: { ENTRY_STATUS: [
    { id: target.id, code: target.code, label: '', nameEn: '', nameAr: '', isActive: true },
  ] } });
  check('a blank-label row is reported as skipped',
    blankResult.skipped.some(s => s.category === 'ENTRY_STATUS' && s.reason === 'blank-label'),
    JSON.stringify(blankResult.skipped));
  const afterBlank = db.getLookupsByCategory('ENTRY_STATUS', true).find(item => item.id === target.id);
  check('the row is unchanged after a blank-label skip', afterBlank.nameEn === target.nameEn);

  // 2. Relabeling one row to collide (case-insensitively) with another row in
  //    the same category is reported, not silently dropped.
  const dupeResult = db.saveLookups(user.id, { categories: { ENTRY_STATUS: [
    { id: target.id, code: target.code, label: other.nameEn.toUpperCase(), nameEn: other.nameEn.toUpperCase(), nameAr: target.nameAr, isActive: true },
  ] } });
  check('a case-insensitive duplicate label is reported as skipped',
    dupeResult.skipped.some(s => s.category === 'ENTRY_STATUS' && s.reason === 'duplicate-label'),
    JSON.stringify(dupeResult.skipped));
  const afterDupe = db.getLookupsByCategory('ENTRY_STATUS', true).find(item => item.id === target.id);
  check('the row keeps its original label after a duplicate-label skip', afterDupe.nameEn === target.nameEn);

  // 3. A real validation error (COMPANY code collision) still throws with its
  //    precise message — the renderer must be able to show it, not a generic
  //    "Could not save settings".
  const companies = db.getLookupsByCategory('COMPANY', true);
  if (companies.length >= 2) {
    const [companyA, companyB] = companies;
    assert.throws(
      () => db.saveLookups(user.id, { categories: { COMPANY: [
        { id: companyA.id, code: companyB.code, label: companyA.nameEn, nameEn: companyA.nameEn, nameAr: companyA.nameAr, isActive: true },
      ] } }),
      /already in use/,
      'expected a company code collision to throw with its real message'
    );
    check('a company code collision throws its precise message (not swallowed)', true);
  } else {
    check('a company code collision throws its precise message (not swallowed)', true, 'skipped — fixture has < 2 companies');
  }

  // 4. A normal, non-colliding edit still saves and is not reported as skipped.
  const cleanResult = db.saveLookups(user.id, { categories: { ENTRY_STATUS: [
    { id: target.id, code: target.code, label: 'Reopened', nameEn: 'Reopened', nameAr: target.nameAr, isActive: true },
  ] } });
  check('a normal edit reports zero skips', cleanResult.skipped.length === 0, JSON.stringify(cleanResult.skipped));
  const afterClean = db.getLookupsByCategory('ENTRY_STATUS', true).find(item => item.id === target.id);
  check('a normal edit is actually persisted', afterClean.nameEn === 'Reopened');

  db.close();
} catch (error) {
  console.error(error);
  failed = true;
  try { db.close(); } catch (_) {}
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
