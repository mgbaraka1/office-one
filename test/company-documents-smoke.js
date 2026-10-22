// ─────────────────────────────────────────────────────────────────────────────
// Company Documents — headless data-layer smoke test (Phase 5, verification
// gates 1-3; gate 4 — the new screen itself — is walked through manually via
// CDP once the renderer UI exists).
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron, no IPC, no
// renderer. SAFETY: never touches production. Copies the live DB into a
// throwaway temp dir and runs everything there; the temp dir is deleted at the
// end regardless of outcome.
//
// Run:  node test/company-documents-smoke.js
//
// Gates exercised:
//   1. Migration 016 runs cleanly on a fresh copy of the current (head 015) DB.
//   2. Re-running applyMigrations() is a no-op (idempotent) — proves the
//      migration doesn't error/duplicate on a second boot.
//   3. Existing screens unaffected — spot-checks that pre-existing tables
//      (projects, tasks, lookup_codes categories) are untouched in row count.
//   plus full CRUD + file lifecycle (upload/replace/remove/delete+undo/purge)
//   against the new company_documents table and its on-disk file folder.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readRow } = require('./raw-db');

const db = require('../db');

const results = [];
function record(flow, pass, details) { results.push({ flow, pass, details }); }

// Guards against reading/copying the REAL production DB when this file is
// run directly (node test/<this file>) instead of via run-all.js — see
// test-bootstrap.js.
require('./test-bootstrap');

const prodDir = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one');
const prodDb  = path.join(prodDir, 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: production DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
console.log('Working copy: ' + path.join(workDir, 'cooperation-tools.db'));

let exitCode = 0;
try {
  // ── Gate 3 baseline — row counts on tables company_documents must NOT touch ──
  const rawBefore = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const countBefore = (t) => rawBefore.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const before = {
    projects: countBefore('projects'), tasks: countBefore('tasks'),
    work_logs: countBefore('work_logs'), lookup_codes: countBefore('lookup_codes'),
  };
  rawBefore.close();

  // ── Gate 1 — migration runs cleanly ──────────────────────────────────────────
  db.openConnection(workDir);
  db.applyMigrations();
  record('Gate 1: migration 016 applies cleanly', true, 'no throw');

  // ── Gate 2 — idempotent re-run ───────────────────────────────────────────────
  db.applyMigrations();
  record('Gate 2: re-applying migrations is a no-op', true, 'no throw, no duplicate rows');

  // ── Gate 3 — existing tables/rows unaffected ─────────────────────────────────
  const rawAfter = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const countAfter = (t) => rawAfter.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const after = {
    projects: countAfter('projects'), tasks: countAfter('tasks'),
    work_logs: countAfter('work_logs'),
  };
  const lookupCatsAfter = rawAfter.prepare(
    "SELECT DISTINCT category FROM lookup_codes ORDER BY category"
  ).all().map(r => r.category);
  rawAfter.close();
  const gate3Pass = after.projects === before.projects && after.tasks === before.tasks
    && after.work_logs === before.work_logs && lookupCatsAfter.includes('COMPANY_DOCUMENT_CATEGORY');
  record('Gate 3: pre-existing tables unaffected + new lookup category present', gate3Pass,
    `projects ${before.projects}->${after.projects}, tasks ${before.tasks}->${after.tasks}, ` +
    `work_logs ${before.work_logs}->${after.work_logs}, categories=${lookupCatsAfter.join(',')}`);

  const userRow = readRow(path.join(workDir, 'cooperation-tools.db'), 'SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1');
  if (!userRow) throw new Error('no active user in the copied DB');
  const userId = userRow.id;
  console.log('Using userId=' + userId + '\n');

  // ── Seeded category sanity ───────────────────────────────────────────────────
  const categories = db.getLookupsByCategory('COMPANY_DOCUMENT_CATEGORY');
  record('Seed: COMPANY_DOCUMENT_CATEGORY has 7 active options', categories.length === 7,
    categories.map(c => c.code).join(','));

  // ── Create ────────────────────────────────────────────────────────────────
  const created = db.createCompanyDocument(userId, {
    name: 'VAT Certificate', category: 'LEGAL', renewalDate: '2027-01-01', notes: 'renews yearly',
  });
  record('Create: card persisted with fields', created && created.name === 'VAT Certificate'
    && created.category === 'LEGAL' && created.renewalDate === '2027-01-01' && created.file === null,
    JSON.stringify(created));

  // Unknown category is rejected (stored as null, not the raw junk string).
  const createdBadCat = db.createCompanyDocument(userId, { name: 'Bad cat test', category: 'NOT_REAL' });
  record('Create: unknown category coerced to null', createdBadCat.category === '', 'category=' + createdBadCat.category);
  db.deleteCompanyDocument(userId, createdBadCat.id);

  // ── List / Get ────────────────────────────────────────────────────────────
  const list = db.listCompanyDocuments(userId);
  record('List: includes the created card', list.some(d => d.id === created.id), 'count=' + list.length);

  // ── Update ────────────────────────────────────────────────────────────────
  const updated = db.updateCompanyDocument(userId, created.id, {
    name: 'VAT Certificate 2027', category: 'TAX', renewalDate: '2027-06-01', notes: 'updated',
  });
  record('Update: fields changed in place, id stable', updated.id === created.id
    && updated.name === 'VAT Certificate 2027' && updated.category === 'TAX', JSON.stringify(updated));

  // ── Reference number (migration 080): trimmed, saved, and found by Quick Find ──
  const numbered = db.updateCompanyDocument(userId, created.id, {
    name: 'VAT Certificate 2027', category: 'TAX', renewalDate: '2027-06-01', notes: 'updated', docNumber: '  3009876543  ',
  });
  const searchHits = q => {
    const raw = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'), { readOnly: true });
    try {
      return raw.prepare("SELECT entity_id FROM workspace_search WHERE workspace_search MATCH ? AND kind = 'company-document'")
        .all(q).map(r => r.entity_id);
    } finally { raw.close(); }
  };
  record('Number: trimmed and saved', numbered.docNumber === '3009876543', JSON.stringify(numbered.docNumber));
  record('Number: indexed for Quick Find', searchHits('3009876543').includes(created.id), '');
  db.updateCompanyDocument(userId, created.id, { name: 'VAT Certificate 2027', category: 'TAX', renewalDate: '2027-06-01', notes: 'updated' });
  record('Number: clearing it re-indexes', !searchHits('3009876543').includes(created.id)
    && db.getCompanyDocument(userId, created.id).docNumber === '', '');

  // Ownership gate: another user's id must not be able to update/read it.
  const otherUserRow = readRow(path.join(workDir, 'cooperation-tools.db'), 'SELECT id FROM users WHERE id != ? LIMIT 1', userId);
  if (otherUserRow) {
    const stolen = db.updateCompanyDocument(otherUserRow.id, created.id, { name: 'stolen' });
    record('Ownership: another user cannot update this card', stolen === null, 'result=' + JSON.stringify(stolen));
  }

  // ── File: upload ──────────────────────────────────────────────────────────
  const srcFile = path.join(workDir, 'source.pdf');
  fs.writeFileSync(srcFile, '%PDF-1.4 fake content for smoke test');
  const uploadRes = db.saveCompanyDocumentFile(userId, created.id, srcFile);
  const afterUpload = uploadRes.ok ? uploadRes.document : null;
  const fileAbs1 = afterUpload && afterUpload.file ? path.join(workDir, afterUpload.file.path) : null;
  record('Upload: file copied + metadata recorded + exists on disk', uploadRes.ok
    && afterUpload.file && afterUpload.file.exists && fs.existsSync(fileAbs1), JSON.stringify(uploadRes.ok && afterUpload.file));

  // Unsupported extension is rejected.
  const badFile = path.join(workDir, 'source.exe');
  fs.writeFileSync(badFile, 'nope');
  const badRes = db.saveCompanyDocumentFile(userId, created.id, badFile);
  record('Upload: unsupported extension rejected', badRes.ok === false, JSON.stringify(badRes));

  // ── File: replace ─────────────────────────────────────────────────────────
  const srcFile2 = path.join(workDir, 'source2.png');
  fs.writeFileSync(srcFile2, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const replaceRes = db.saveCompanyDocumentFile(userId, created.id, srcFile2);
  const afterReplace = replaceRes.ok ? replaceRes.document : null;
  record('Replace: new file recorded, previous file retained for undo', replaceRes.ok
    && afterReplace.file.originalName === 'source2.png' && fileAbs1 && fs.existsSync(fileAbs1) && replaceRes.replacedFile,
    'newName=' + (afterReplace && afterReplace.file.originalName) + ' oldRetained=' + (fileAbs1 && fs.existsSync(fileAbs1)));

  // ── File: resolve (download/open path resolution) ────────────────────────
  const resolved = db.resolveCompanyDocumentFile(userId, created.id);
  record('Resolve: absolute path exists', resolved.ok && resolved.exists, JSON.stringify(resolved.ok && resolved.exists));

  // ── File: remove (keeps card, clears file) ────────────────────────────────
  const fileAbs2 = path.join(userDataDirOf(workDir), afterReplace.file.path);
  const removeRes = db.removeCompanyDocumentFile(userId, created.id);
  record('Remove: card survives, metadata clears, bytes retained for undo', removeRes.ok
    && removeRes.document.file === null && fs.existsSync(fileAbs2) && removeRes.removedFile,
    JSON.stringify(removeRes.ok && removeRes.document.file));
  const restoredRemoval = db.restoreRemovedCompanyDocumentFile(userId, created.id, removeRes.removedFile);
  record('Remove undo: previous file metadata is restored', restoredRemoval.ok
    && restoredRemoval.document.file?.originalName === 'source2.png', JSON.stringify(restoredRemoval.document.file));

  // ── Delete + undo/purge lifecycle (mirrors Projects delete/restore) ───────
  // Re-upload a file so the delete/undo dance actually has something to move.
  db.saveCompanyDocumentFile(userId, created.id, srcFile2);
  const snapshot = db.getCompanyDocument(userId, created.id);
  const delRes = db.deleteCompanyDocument(userId, created.id);
  record('Delete: row removed', delRes.ok && db.getCompanyDocument(userId, created.id) === null, JSON.stringify(delRes));
  const fileAbsAtDelete = path.join(userDataDirOf(workDir), snapshot.file.path);
  record('Delete: file survives on disk (undo window)', fs.existsSync(fileAbsAtDelete), fileAbsAtDelete);

  // Undo: re-create under a new id, then restore the file onto it.
  const recreated = db.createCompanyDocument(userId, {
    name: snapshot.name, category: snapshot.category, renewalDate: snapshot.renewalDate, notes: snapshot.notes,
  });
  const restoreRes = db.restoreCompanyDocumentFile(userId, snapshot.id, recreated.id, snapshot.file);
  const restoredDoc = restoreRes.ok ? restoreRes.document : null;
  record('Undo: file moved onto new id + re-stamped', restoreRes.ok && restoredDoc.file
    && restoredDoc.file.originalName === snapshot.file.originalName && fs.existsSync(path.join(userDataDirOf(workDir), restoredDoc.file.path)),
    JSON.stringify(restoreRes.ok && restoredDoc && restoredDoc.file));

  // Purge lifecycle: delete again, then simulate the undo window lapsing.
  db.deleteCompanyDocument(userId, recreated.id);
  const purgeRes = db.purgeCompanyDocumentFiles(userId, recreated.id);
  const purgedDirGone = !fs.existsSync(path.join(userDataDirOf(workDir), 'company_documents', String(recreated.id)));
  record('Purge: whole folder removed on undo-window lapse', purgeRes.ok && purgedDirGone, JSON.stringify({ purgeRes, purgedDirGone }));

  // Boot-time orphan sweep also catches folders left behind without a purge call.
  fs.mkdirSync(path.join(userDataDirOf(workDir), 'company_documents', '999999'), { recursive: true });
  db.runMaintenance();
  const sweptGone = !fs.existsSync(path.join(userDataDirOf(workDir), 'company_documents', '999999'));
  record('Orphan sweep: stray id folder removed at boot maintenance', sweptGone, 'gone=' + sweptGone);

  // ── Templates (migration 075: the same cards with kind 'TEMPLATE') ────────
  const tplCategories = db.getLookupsByCategory('TEMPLATE_CATEGORY');
  record('Templates: TEMPLATE_CATEGORY has 7 active options', tplCategories.length === 7,
    tplCategories.map(c => c.code).join(','));
  const tpl = db.createCompanyDocument(userId, {
    name: 'Service Agreement', category: 'CONTRACT', renewalDate: '2027-01-01', notes: 'starter',
  }, 'TEMPLATE');
  record('Templates: created with its kind and category, never a renewal date', tpl.kind === 'TEMPLATE'
    && tpl.category === 'CONTRACT' && tpl.renewalDate === '', JSON.stringify(tpl));
  const docWithTplCat = db.createCompanyDocument(userId, { name: 'Wrong catalog', category: 'CONTRACT' });
  record('Templates: a document cannot take a template category', docWithTplCat.category === '' && docWithTplCat.kind === 'DOCUMENT',
    JSON.stringify(docWithTplCat));
  db.deleteCompanyDocument(userId, docWithTplCat.id);
  record('Templates: each list holds only its own kind',
    db.listCompanyDocuments(userId, 'TEMPLATE').some(d => d.id === tpl.id)
      && !db.listCompanyDocuments(userId).some(d => d.id === tpl.id), '');
  const tplUpdated = db.updateCompanyDocument(userId, tpl.id, { name: 'Service Agreement v2', category: 'LEGAL', renewalDate: '2027-01-01' });
  record('Templates: update keeps the kind, checks the template catalog, drops a renewal date',
    tplUpdated.kind === 'TEMPLATE' && tplUpdated.category === '' && tplUpdated.renewalDate === '', JSON.stringify(tplUpdated));
  const tplNumbered = db.updateCompanyDocument(userId, tpl.id, { name: 'Service Agreement v2', docNumber: '123' });
  record('Templates: never keep a reference number', tplNumbered.docNumber === '', JSON.stringify(tplNumbered.docNumber));
  const xlsx = path.join(workDir, 'rates.xlsx');
  fs.writeFileSync(xlsx, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
  const tplUpload = db.saveCompanyDocumentFile(userId, tpl.id, xlsx);
  const docForXlsx = db.createCompanyDocument(userId, { name: 'Doc xlsx' });
  const docUpload = db.saveCompanyDocumentFile(userId, docForXlsx.id, xlsx);
  record('Templates: a template takes an .xlsx, a document still does not',
    tplUpload.ok && tplUpload.document.file.mimeType.includes('spreadsheet') && docUpload.ok === false,
    JSON.stringify({ tpl: tplUpload.ok, doc: docUpload }));
  db.deleteCompanyDocument(userId, docForXlsx.id);
  const pptx = path.join(workDir, 'deck.pptx');
  fs.writeFileSync(pptx, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
  const fakePpt = path.join(workDir, 'fake.ppt');
  fs.writeFileSync(fakePpt, 'not an OLE file');
  const pptxRes = db.saveCompanyDocumentFile(userId, tpl.id, pptx);
  const fakeRes = db.saveCompanyDocumentFile(userId, tpl.id, fakePpt);
  record('Templates: a template takes a .pptx, a .ppt with the wrong contents is refused',
    pptxRes.ok && pptxRes.document.file.mimeType.includes('presentation') && fakeRes.ok === false,
    JSON.stringify({ pptx: pptxRes.ok, fake: fakeRes }));
  record('Templates: Quick Find indexes a template as kind template',
    db.searchWorkspace(userId, 'Service Agreement').some(h => h.kind === 'template' && h.id === tpl.id), '');
  record('Templates: no attention item for a template',
    !db.getAttentionItems(userId).some(a => a.id === tpl.id), '');
  db.deleteCompanyDocument(userId, tpl.id);
  record('Templates: delete clears its search row',
    !db.searchWorkspace(userId, 'Service Agreement').some(h => h.id === tpl.id), '');

} catch (err) {
  exitCode = 1;
  console.error('FATAL:', err);
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function userDataDirOf(dir) { return dir; }

console.log('\n── Results ──');
for (const r of results) {
  console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.flow + (r.details ? '  (' + r.details + ')' : ''));
  if (!r.pass) exitCode = 1;
}
console.log('\n' + (exitCode === 0 ? 'ALL GREEN' : 'FAILURES PRESENT'));
process.exit(exitCode);
