'use strict';

// db.saveLookups() used to bare-`return`
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

  // 3. A company code is write-once, so there is no such thing as an existing
  //    row's code colliding: saveLookups ignores `code` on every update. What
  //    still has to fail loudly is a NEW row claiming a code already in use.
  const companies = db.getLookupsByCategory('COMPANY', true);
  if (companies.length >= 2) {
    const [companyA, companyB] = companies;
    // Sending companyB's code for companyA is not an error and is not a rename
    // — it simply has no effect, while the row's names still save normally.
    db.saveLookups(user.id, { categories: { COMPANY: [
      { id: companyA.id, code: companyB.code, label: companyA.nameEn, nameEn: companyA.nameEn, nameAr: companyA.nameAr, isActive: true },
    ] } });
    const afterCodeEdit = db.getLookupsByCategory('COMPANY', true).find(c => c.id === companyA.id);
    check('a company code cannot be changed through saveLookups',
      afterCodeEdit.code === companyA.code, `before=${companyA.code} after=${afterCodeEdit.code}`);

    // A brand-new row is the one place a code is set, and a clash there still
    // throws its precise message — the renderer must be able to show it, not a
    // generic "Could not save settings".
    assert.throws(
      () => db.saveLookups(user.id, { categories: { COMPANY: [
        { id: null, code: companyB.code, label: 'Code Clash', nameEn: 'Code Clash', nameAr: '', isActive: true },
      ] } }),
      /already in use/,
      'expected a new company code collision to throw with its real message'
    );
    check('a new company code collision throws its precise message (not swallowed)', true);

    // The Clients page's own create path reports the same clash as a refusal
    // rather than an exception, so a rejected create is never a partial write.
    const refused = db.createClient(user.id, { code: companyB.code, nameEn: 'Code Clash Two' });
    check('createClient refuses a duplicate code without throwing',
      refused.ok === false && /already in use/.test(refused.error || ''), refused.error);
  } else {
    check('a company code cannot be changed through saveLookups', true, 'skipped — fixture has < 2 companies');
    check('a new company code collision throws its precise message (not swallowed)', true, 'skipped — fixture has < 2 companies');
    check('createClient refuses a duplicate code without throwing', true, 'skipped — fixture has < 2 companies');
  }

  // 4. A normal, non-colliding edit still saves and is not reported as skipped.
  const cleanResult = db.saveLookups(user.id, { categories: { ENTRY_STATUS: [
    { id: target.id, code: target.code, label: 'Reopened', nameEn: 'Reopened', nameAr: target.nameAr, isActive: true },
  ] } });
  check('a normal edit reports zero skips', cleanResult.skipped.length === 0, JSON.stringify(cleanResult.skipped));
  const afterClean = db.getLookupsByCategory('ENTRY_STATUS', true).find(item => item.id === target.id);
  check('a normal edit is actually persisted', afterClean.nameEn === 'Reopened');

// ── Catalog audit trail (migration 058) ─────────────────────────────────────
// lookup_codes had no history of any kind. That was survivable while the
// catalog editor was administrator-only; it is not, now that the admin concept
// is gone and any account can rename a company — a rename that propagates to
// every task, project, report and invoice referencing it.
try {
  const histUser = user.id;
  const second = db.createUser('hist-second', 'x', false);

  db.saveLookups(histUser, { categories: { COMPANY: [
    ...db.getLookupsByCategory('COMPANY', true).map(r => ({ ...r })),
    { code: 'AUDITCO', label: 'Audit Co', nameEn: 'Audit Co', nameAr: '', isActive: true },
  ] } });
  const created = db.getLookupsByCategory('COMPANY', true).find(r => r.code === 'AUDITCO');
  const afterCreate = db.getLookupCodeHistory(created.id);
  check('a newly added catalog value is recorded',
    afterCreate.some(h => h.fieldName === 'English Name' && h.newValue === 'Audit Co'),
    JSON.stringify(afterCreate.map(h => h.fieldName)));

  // A rename by a DIFFERENT account — attribution is the whole point.
  db.saveLookups(second, { categories: { COMPANY: db.getLookupsByCategory('COMPANY', true)
    .map(r => (r.id === created.id ? { ...r, nameEn: 'Audit Company', label: 'Audit Company' } : { ...r })) } });
  const afterRename = db.getLookupCodeHistory(created.id);
  const renameRow = afterRename.find(h => h.fieldName === 'English Name' && h.newValue === 'Audit Company');
  check('a rename records old value, new value and the acting account',
    !!renameRow && renameRow.oldValue === 'Audit Co' && !!renameRow.changedBy,
    JSON.stringify(renameRow));
  check('history spans accounts rather than being user-scoped',
    new Set(afterRename.map(h => h.changedBy)).size >= 2,
    JSON.stringify([...new Set(afterRename.map(h => h.changedBy))]));

  // Soft-disable is the app's stand-in for deletion, so it must be auditable.
  db.saveLookups(histUser, { categories: { COMPANY: db.getLookupsByCategory('COMPANY', true)
    .map(r => (r.id === created.id ? { ...r, isActive: false } : { ...r })) } });
  const afterDisable = db.getLookupCodeHistory(created.id);
  check('a soft-disable is recorded as an Active change',
    afterDisable.some(h => h.fieldName === 'Active' && h.oldValue === 'Yes' && h.newValue === 'No'),
    JSON.stringify(afterDisable.filter(h => h.fieldName === 'Active')));

  // Reordering is presentation, not meaning — it must not spam the audit log.
  const beforeReorder = db.getLookupCodeHistory(created.id).length;
  db.saveLookups(histUser, { categories: { COMPANY: db.getLookupsByCategory('COMPANY', true)
    .map((r, i) => ({ ...r, sortOrder: 100 - i })) } });
  check('reordering the catalog writes no history rows',
    db.getLookupCodeHistory(created.id).length === beforeReorder,
    beforeReorder + ' -> ' + db.getLookupCodeHistory(created.id).length);

  check('newest change comes first',
    afterDisable.length > 1 && afterDisable[0].changedAt >= afterDisable[afterDisable.length - 1].changedAt);
} catch (error) {
  check('catalog audit trail', false, String(error && error.message));
}

  db.close();
} catch (error) {
  console.error(error);
  failed = true;
  try { db.close(); } catch (_) {}
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
