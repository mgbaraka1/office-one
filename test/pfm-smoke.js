// ─────────────────────────────────────────────────────────────────────────────
// Project & Finance (Offers & CRs) — headless data-layer smoke test.
//
// Boots db.js directly (no Electron, no IPC, no renderer) against a private
// copy of the fixture profile's database; the copy is deleted at the end.
//
// Run:  node test/pfm-smoke.js
//
// Covers migration 062 (tables, triggers, guarded PFM_STATUS seed, idempotent
// re-run) and the Phase 1 data layer: create/update, the per-login Reference
// ID pool (case/space-insensitive, Offers + CRs together), privacy between
// logins, status moves writing their stage, planned stages, versions unique per
// item, fees as integer minor units, wrong-category lookups rejected by
// trigger, delete/undo/purge, the boot-time purge, the COMPANY merge repointing
// pfm_items, and the audit history. Phase 2 adds files: per-file results on a
// multi-add, bad extension / fake header / >100 MB refused, remove-undo-purge,
// path escape blocked, and the orphan sweep of the project_finance/ tree.
// Phase 5 adds Quick Find (migration 063's FTS triggers through edit, delete,
// undo and purge) and the Attention items (follow-up after 7 days on Sent,
// validity 3 days before it ends).
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { readRow } = require('./raw-db');

const db = require('../db');

// Must run before any os.homedir()-based path is computed — see test-bootstrap.js.
require('./test-bootstrap');

const results = [];
function record(flow, pass, details = '') { results.push({ flow, pass, details }); }

const prodDb = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one', 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: fixture DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfm-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
const dbFile = path.join(workDir, 'cooperation-tools.db');

let exitCode = 0;
try {
  db.openConnection(workDir);
  db.applyMigrations();
  const conn = db.getConnection();
  const count = sql => conn.prepare(sql).get().n;

  // ── Migration 062 ───────────────────────────────────────────────────────
  const statuses = db.getLookupsByCategory('PFM_STATUS').map(o => o.code);
  record('Migration: PFM_STATUS seeded in stage order',
    JSON.stringify(statuses) === JSON.stringify(['PREPARE', 'READY', 'SENT', 'ACCEPTED', 'REJECTED']), JSON.stringify(statuses));
  const arabic = readRow(dbFile, "SELECT name_ar FROM lookup_codes WHERE category = 'PFM_STATUS' AND code = 'SENT'");
  record('Migration: seeded statuses carry Arabic names', arabic?.name_ar === 'مُرسل', JSON.stringify(arabic));
  const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'pfm_%' ORDER BY name").all().map(r => r.name);
  record('Migration: all five pfm_ tables exist',
    JSON.stringify(tables) === JSON.stringify(['pfm_history', 'pfm_items', 'pfm_stages', 'pfm_version_files', 'pfm_versions']), JSON.stringify(tables));
  const triggersBefore = count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'");
  record('Migration: 8 lookup-category triggers installed',
    count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_pfm_%_category'") === 8);
  const head = count('SELECT MAX(version) AS n FROM schema_migrations');
  record('Migration: schema head is at least 62', head >= 62, `head=${head}`);

  // Guarded seed + idempotency: re-running 062's up() by hand must not add rows.
  require('../migrations/062_project_finance').up(conn);
  db.applyMigrations();
  record('Migration: re-running is a no-op (no duplicate statuses or triggers)',
    count("SELECT COUNT(*) AS n FROM lookup_codes WHERE category = 'PFM_STATUS'") === 5
      && count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'") === triggersBefore);

  // ── Setup ───────────────────────────────────────────────────────────────
  const userId = db.getUserByUsername('fixture-user').id;
  const otherId = db.createUser('pfm-other-user', 'not-a-real-hash');
  const companies = db.getLookupsByCategory('COMPANY');
  const companyA = companies.find(c => c.code === 'FIXTURE_COMPANY').id;
  const companyB = companies.find(c => c.code === 'FIXTURE_COMPANY_2').id;
  const currency = db.getLookupsByCategory('CURRENCY')[0]?.code;
  record('Setup: a CURRENCY code exists to price versions in', !!currency, String(currency));

  // ── Create ──────────────────────────────────────────────────────────────
  const created = db.createPfmItem(userId, {
    kind: 'OFFER', reference: '  OFF-001 ', title: 'Generic offer', companyId: companyA,
    contactName: ' Client Person ', memberName: ' Person A ', notes: 'first notes',
  });
  const offer = created.item;
  record('Create: offer created at the first status with a dated, named stage',
    created.ok && offer.reference === 'OFF-001' && offer.status === 'PREPARE' && offer.kind === 'OFFER'
      && offer.contactName === 'Client Person' && offer.stages.length === 1
      && offer.stages[0].memberName === 'Person A' && /^\d{4}-\d{2}-\d{2}$/.test(offer.stages[0].doneOn),
    JSON.stringify(created));
  record('Create: missing title / client / bad kind are refused',
    !db.createPfmItem(userId, { kind: 'OFFER', reference: 'X-1', companyId: companyA }).ok
      && !db.createPfmItem(userId, { kind: 'OFFER', reference: 'X-1', title: 't' }).ok
      && !db.createPfmItem(userId, { kind: 'INVOICE', reference: 'X-1', title: 't', companyId: companyA }).ok);
  record('Create: a wrong-category company id is refused',
    !db.createPfmItem(userId, { kind: 'OFFER', reference: 'X-2', title: 't', companyId: db.getLookupsByCategory('CURRENCY')[0].id }).ok);

  // ── Reference ID pool (D6) ──────────────────────────────────────────────
  const dupSame = db.createPfmItem(userId, { kind: 'OFFER', reference: 'off-001', title: 't', companyId: companyA });
  const dupCr = db.createPfmItem(userId, { kind: 'CR', reference: ' OFF-001  ', title: 't', companyId: companyB });
  record('Reference: duplicate refused regardless of case/spaces', !dupSame.ok && /already used/.test(dupSame.error), JSON.stringify(dupSame));
  record('Reference: an Offer and a CR share one pool', !dupCr.ok, JSON.stringify(dupCr));
  const otherSame = db.createPfmItem(otherId, { kind: 'OFFER', reference: 'OFF-001', title: 'Other login offer', companyId: companyA });
  record('Reference: another login may reuse the same reference', otherSame.ok, JSON.stringify(otherSame));
  const cr = db.createPfmItem(userId, { kind: 'CR', reference: 'CR-001', title: 'Generic change request', companyId: companyB }).item;
  const renameClash = db.updatePfmItem(userId, cr.id, { reference: 'Off-001' });
  record('Reference: renaming onto a used reference is refused', !renameClash.ok, JSON.stringify(renameClash));

  // ── Privacy (D1) ────────────────────────────────────────────────────────
  record('Privacy: another login cannot read, list, edit or delete the item',
    db.getPfmItem(otherId, offer.id) === null
      && !db.listPfmItems(otherId).some(i => i.id === offer.id)
      && !db.updatePfmItem(otherId, offer.id, { title: 'hijack' }).ok
      && !db.setPfmStatus(otherId, offer.id, { status: 'SENT' }).ok
      && !db.deletePfmItem(otherId, offer.id).ok
      && db.getPfmHistory(otherId, offer.id).length === 0);

  // ── Update (partial) ────────────────────────────────────────────────────
  const upd = db.updatePfmItem(userId, offer.id, { title: 'Generic offer (revised)', validUntil: '2090-01-31' });
  record('Update: only the sent keys change', upd.ok && upd.item.title === 'Generic offer (revised)'
    && upd.item.notes === 'first notes' && upd.item.contactName === 'Client Person' && upd.item.validUntil === '2090-01-31',
    JSON.stringify(upd.item));
  record('Update: an invalid date is refused', !db.updatePfmItem(userId, offer.id, { validUntil: '2090-02-30' }).ok);

  // ── Status + stages ─────────────────────────────────────────────────────
  const planned = db.savePfmStage(userId, offer.id, { status: 'SENT', memberName: 'Person B' });
  record('Stage: planning a person does not move the status',
    planned.ok && planned.item.status === 'PREPARE'
      && planned.item.stages.some(s => s.status === 'SENT' && s.memberName === 'Person B' && s.doneOn === ''),
    JSON.stringify(planned.item?.stages));
  const sent = db.setPfmStatus(userId, offer.id, { status: 'SENT', date: '2090-01-05' });
  const sentStage = sent.item.stages.find(s => s.status === 'SENT');
  record('Status: move keeps the planned person and stamps the date',
    sent.ok && sent.item.status === 'SENT' && sentStage.memberName === 'Person B' && sentStage.doneOn === '2090-01-05',
    JSON.stringify(sentStage));
  record('Status: an unknown status is refused', !db.setPfmStatus(userId, offer.id, { status: 'NOPE' }).ok);
  const accepted = db.setPfmStatus(userId, offer.id, { status: 'ACCEPTED', memberName: 'person b ', note: 'signed' });
  record('Status: ACCEPTED is final', accepted.ok && accepted.item.isFinal, JSON.stringify(accepted.item?.status));
  db.savePfmStage(userId, offer.id, { status: 'READY', memberName: 'Temp' });
  const cleared = db.savePfmStage(userId, offer.id, { status: 'READY', memberName: '' });
  record('Stage: a stage emptied of everything is removed',
    cleared.ok && !cleared.item.stages.some(s => s.status === 'READY'), JSON.stringify(cleared.item?.stages));
  const names = db.listPfmMemberNames(userId);
  record('Stage: past names are suggested once each (case/space folded)',
    names.filter(n => n.trim().toLowerCase() === 'person b').length === 1 && names.includes('Person A'), JSON.stringify(names));

  // ── Versions + fees ─────────────────────────────────────────────────────
  const v1 = db.createPfmVersion(userId, offer.id, { label: 'v1', feesMinor: 1200000, currency, date: '2090-01-02' });
  const v2 = db.createPfmVersion(userId, offer.id, { label: 'v2', feesMinor: 1050050, currency });
  record('Version: two versions created, newest is current',
    v1.ok && v2.ok && v2.item.currentVersion.label === 'v2' && v2.item.versions.length === 2, JSON.stringify(v2.item?.currentVersion));
  const stored = readRow(dbFile, 'SELECT fees_minor, typeof(fees_minor) AS t FROM pfm_versions WHERE id = ?', v2.version.id);
  record('Version: fees stored as integer minor units', stored.t === 'integer' && stored.fees_minor === 1050050, JSON.stringify(stored));
  record('Version: fractional / negative fees refused',
    !db.createPfmVersion(userId, offer.id, { label: 'v9', feesMinor: 10.5 }).ok
      && !db.createPfmVersion(userId, offer.id, { label: 'v9', feesMinor: -1 }).ok);
  const dupVersion = db.createPfmVersion(userId, offer.id, { label: ' V1 ' });
  record('Version: ID unique per item (case/space-insensitive)', !dupVersion.ok, JSON.stringify(dupVersion));
  record('Version: the same ID is fine on another item', db.createPfmVersion(userId, cr.id, { label: 'v1' }).ok);
  record('Version: an unknown currency is refused', !db.createPfmVersion(userId, offer.id, { label: 'v3', currency: 'NOT_A_CODE' }).ok);
  const vUpd = db.updatePfmVersion(userId, v1.version.id, { feesMinor: 1100000 });
  record('Version: partial update keeps the other fields',
    vUpd.ok && vUpd.item.versions.find(v => v.label === 'v1').feesMinor === 1100000
      && vUpd.item.versions.find(v => v.label === 'v1').date === '2090-01-02');
  db.deletePfmVersion(userId, v2.version.id);
  const afterVDel = db.getPfmItem(userId, offer.id);
  const vRestored = db.restorePfmVersion(userId, v2.version.id);
  record('Version: delete hides it, undo brings it back with the same id',
    afterVDel.currentVersion.label === 'v1' && vRestored.ok && vRestored.item.currentVersion.id === v2.version.id);
  record('Version: another login cannot touch it', !db.updatePfmVersion(otherId, v1.version.id, { label: 'x' }).ok);

  // ── Files (Phase 2) ─────────────────────────────────────────────────────
  const srcDir = path.join(workDir, 'src-files');
  fs.mkdirSync(srcDir);
  const src = (name, bytes) => { const p = path.join(srcDir, name); fs.writeFileSync(p, bytes); return p; };
  const goodPdf = src('offer.pdf', '%PDF-1.4\n% generic test file\n');
  const goodPng = src('drawing.png', Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]));
  const fakePdf = src('fake.pdf', 'plain text pretending to be a pdf');
  const badExt = src('tool.exe', 'MZ not allowed');
  const bigPdf = src('big.pdf', '%PDF-1.4\n');
  fs.truncateSync(bigPdf, 100 * 1024 * 1024 + 1);
  const pfmRoot = path.join(workDir, 'project_finance');
  const v1Dir = path.join(pfmRoot, String(offer.id), String(v1.version.id));

  const added = db.addPfmVersionFiles(userId, v1.version.id, [goodPdf, fakePdf, badExt, bigPdf, goodPng]);
  record('Files: each file passes or fails on its own',
    added.ok && JSON.stringify(added.results.map(r => r.ok)) === JSON.stringify([true, false, false, false, true]),
    JSON.stringify(added.results));
  record('Files: fake header, bad extension and >100 MB each give a clear error',
    /do not match/.test(added.results[1].error) && /Unsupported file type/.test(added.results[2].error)
      && /100 MB/.test(added.results[3].error), JSON.stringify(added.results.map(r => r.error)));
  const v1Files = added.item.versions.find(v => v.id === v1.version.id).files;
  record('Files: stored under project_finance/{item}/{version}/ with their original names',
    v1Files.length === 2 && v1Files.every(f => f.exists && fs.existsSync(path.join(v1Dir, path.basename(f.path))))
      && v1Files.map(f => f.originalName).join() === 'offer.pdf,drawing.png', JSON.stringify(v1Files));
  const pdfFile = v1Files[0];
  const resolved = db.resolvePfmFile(userId, pdfFile.id);
  record('Files: resolve returns a path inside the version folder',
    resolved.ok && resolved.exists && path.dirname(resolved.absPath) === v1Dir, JSON.stringify(resolved));
  record('Files: another login cannot resolve, add, remove or purge them',
    !db.resolvePfmFile(otherId, pdfFile.id).ok && !db.addPfmVersionFiles(otherId, v1.version.id, [goodPdf]).ok
      && !db.removePfmFile(otherId, pdfFile.id).ok && !db.purgePfmFile(otherId, pdfFile.id).ok);

  const removedFile = db.removePfmFile(userId, pdfFile.id);
  const hiddenFile = !removedFile.item.versions.find(v => v.id === v1.version.id).files.some(f => f.id === pdfFile.id);
  record('Files: remove hides it but keeps the bytes for undo',
    removedFile.ok && hiddenFile && fs.existsSync(resolved.absPath) && !db.resolvePfmFile(userId, pdfFile.id).ok);
  const restoredFile = db.restorePfmFile(userId, pdfFile.id);
  record('Files: undo brings the same file back',
    restoredFile.ok && restoredFile.item.versions.find(v => v.id === v1.version.id).files.some(f => f.id === pdfFile.id));
  record('Files: purge refuses a file that is not removed', !db.purgePfmFile(userId, pdfFile.id).ok && fs.existsSync(resolved.absPath));
  const pngFile = v1Files[1];
  const pngAbs = db.resolvePfmFile(userId, pngFile.id).absPath;
  db.removePfmFile(userId, pngFile.id);
  record('Files: purge after remove deletes the row and the bytes',
    db.purgePfmFile(userId, pngFile.id).ok && !fs.existsSync(pngAbs)
      && count(`SELECT COUNT(*) AS n FROM pfm_version_files WHERE id = ${pngFile.id}`) === 0);

  // A tampered stored path must never resolve outside its own version folder.
  const escapeTo = rel => {
    conn.prepare('UPDATE pfm_version_files SET file_path = ? WHERE id = ?').run(rel, pdfFile.id);
    return db.resolvePfmFile(userId, pdfFile.id);
  };
  const outside = escapeTo(path.join('..', '..', 'evil.pdf'));
  const sideways = escapeTo(path.join('projects', '1', 'x.pdf'));
  const absolute = escapeTo(path.join(workDir, 'cooperation-tools.db'));
  conn.prepare('UPDATE pfm_version_files SET file_path = ? WHERE id = ?').run(pdfFile.path, pdfFile.id);
  record('Files: path escape blocked (outside userData, another tree, absolute)',
    [outside, sideways, absolute].every(r => !r.ok && /invalid/i.test(r.error)), JSON.stringify([outside, sideways, absolute]));
  record('Files: the real path resolves again once restored', db.resolvePfmFile(userId, pdfFile.id).ok);

  // Orphan sweep: a dead item folder, a dead version folder under a live item,
  // and a stray file in a live version folder all go; the real file stays.
  fs.mkdirSync(path.join(pfmRoot, '999999', '1'), { recursive: true });
  fs.writeFileSync(path.join(pfmRoot, '999999', '1', 'x.pdf'), 'x');
  fs.mkdirSync(path.join(pfmRoot, String(offer.id), '888888'), { recursive: true });
  fs.writeFileSync(path.join(v1Dir, 'stray.pdf'), 'x');
  const sweep = db.runMaintenance().pfmFiles;
  record('Files: orphan sweep removes dead folders and stray files, keeps real ones',
    !fs.existsSync(path.join(pfmRoot, '999999')) && !fs.existsSync(path.join(pfmRoot, String(offer.id), '888888'))
      && !fs.existsSync(path.join(v1Dir, 'stray.pdf')) && fs.existsSync(resolved.absPath) && sweep.length === 3,
    JSON.stringify(sweep));
  record('Files: diagnostics see the stored file', db.getSystemDiagnostics().missingFiles.every(m => m.table !== 'pfm_version_files'));

  // ── Triggers ────────────────────────────────────────────────────────────
  const tryWrite = sql => { try { conn.prepare(sql).run(); return 'ok'; } catch (e) { return String(e.message); } };
  const wrongStatus = tryWrite(`UPDATE pfm_items SET status_id = ${companyA} WHERE id = ${offer.id}`);
  const wrongCompany = tryWrite(`UPDATE pfm_items SET company_id = (SELECT id FROM lookup_codes WHERE category = 'PFM_STATUS' LIMIT 1) WHERE id = ${offer.id}`);
  const wrongCurrency = tryWrite(`UPDATE pfm_versions SET currency_id = ${companyA} WHERE id = ${v1.version.id}`);
  const wrongStage = tryWrite(`INSERT INTO pfm_stages(item_id, status_id, updated_at) VALUES (${offer.id}, ${companyA}, 'x')`);
  record('Trigger: wrong-category lookups rejected on items, stages and versions',
    [wrongStatus, wrongCompany, wrongCurrency, wrongStage].every(m => /wrong lookup category/.test(m)),
    JSON.stringify([wrongStatus, wrongCompany, wrongCurrency, wrongStage]));
  record('Schema: kind CHECK rejects anything but OFFER/CR',
    tryWrite(`UPDATE pfm_items SET kind = 'INVOICE' WHERE id = ${offer.id}`) !== 'ok');

  // ── List + archive ──────────────────────────────────────────────────────
  record('List: filters by kind, client, status and search',
    db.listPfmItems(userId, { kind: 'CR' }).every(i => i.kind === 'CR')
      && db.listPfmItems(userId, { companyId: companyB }).every(i => i.companyId === companyB)
      && db.listPfmItems(userId, { status: 'ACCEPTED' }).map(i => i.id).join() === String(offer.id)
      && db.listPfmItems(userId, { search: 'off-0' }).map(i => i.id).join() === String(offer.id));
  const listed = db.listPfmItems(userId).find(i => i.id === offer.id);
  record('List: rows carry current fees and current person',
    listed.currentVersion?.feesMinor === 1050050 && listed.currentMember === 'person b', JSON.stringify(listed));
  db.archivePfmItem(userId, cr.id);
  record('Archive: hidden by default, shown with includeArchived, still holds its reference',
    !db.listPfmItems(userId).some(i => i.id === cr.id)
      && db.listPfmItems(userId, { includeArchived: true }).some(i => i.id === cr.id && i.archived)
      && /archived/.test(db.createPfmItem(userId, { kind: 'OFFER', reference: 'cr-001', title: 't', companyId: companyA }).error));
  record('Archive: unarchive brings it back', db.unarchivePfmItem(userId, cr.id).ok && db.listPfmItems(userId).some(i => i.id === cr.id));

  // ── Delete / undo / purge ───────────────────────────────────────────────
  db.deletePfmItem(userId, offer.id);
  const hidden = db.getPfmItem(userId, offer.id) === null && !db.listPfmItems(userId).some(i => i.id === offer.id);
  const restored = db.restorePfmItem(userId, offer.id);
  record('Delete: hidden, then undo restores the same id with its versions',
    hidden && restored.ok && restored.item.id === offer.id && restored.item.versions.length === 2);
  record('Purge: refuses a live (not deleted) item', !db.purgePfmItem(userId, offer.id).ok && !!db.getPfmItem(userId, offer.id));
  const history = db.getPfmHistory(userId, offer.id);
  const fields = new Set(history.map(h => h.field));
  record('History: create, edits, status, stage and version events recorded',
    ['Created', 'Title', 'Valid Until', 'Status', 'Sent: Person', 'Sent: Date', 'Version Added', 'v1: Fees', 'Deleted', 'Restored']
      .every(f => fields.has(f))
      && history.some(h => h.field === 'Status' && h.newValue === 'Accepted') && history[0].changedBy === 'fixture-user',
    JSON.stringify([...fields]));
  db.deletePfmItem(userId, offer.id);
  const purged = db.purgePfmItem(userId, offer.id);
  record('Purge: removes the item and its stages/versions, keeps the audit trail',
    purged.ok && count(`SELECT COUNT(*) AS n FROM pfm_items WHERE id = ${offer.id}`) === 0
      && count(`SELECT COUNT(*) AS n FROM pfm_stages WHERE item_id = ${offer.id}`) === 0
      && count(`SELECT COUNT(*) AS n FROM pfm_versions WHERE item_id = ${offer.id}`) === 0
      && count(`SELECT COUNT(*) AS n FROM pfm_history WHERE item_id = ${offer.id}`) > 0);
  record('Purge: the item\'s file folder goes with it',
    !fs.existsSync(path.join(workDir, 'project_finance', String(offer.id))));
  record('Purge: the reference is free again',
    db.createPfmItem(userId, { kind: 'OFFER', reference: 'OFF-001', title: 'Reused', companyId: companyA }).ok);

  // Boot-time purge of anything a closed session left inside its undo window.
  const leftover = db.createPfmItem(userId, { kind: 'OFFER', reference: 'OFF-LEFT', title: 't', companyId: companyA }).item;
  db.deletePfmItem(userId, leftover.id);
  const report = db.runMaintenance();
  record('Maintenance: boot purge removes rows left deleted',
    report.pfmPurged?.items >= 1 && count(`SELECT COUNT(*) AS n FROM pfm_items WHERE id = ${leftover.id}`) === 0,
    JSON.stringify(report.pfmPurged));

  // ── COMPANY duplicate merge repoints pfm_items ──────────────────────────
  const onB = db.createPfmItem(userId, { kind: 'OFFER', reference: 'OFF-B', title: 't', companyId: companyB }).item;
  const merge = db.mergeLookupDuplicate('COMPANY', companyA, companyB);
  record('Merge: merging two clients repoints their offers', merge.ok && db.getPfmItem(userId, onB.id).companyId === companyA,
    JSON.stringify(merge));

  // ── Quick Find (migration 063, plan E10) ────────────────────────────────
  const pfmHits = (uid, q) => db.searchWorkspace(uid, q).filter(r => r.kind === 'pfm');
  const qf = db.createPfmItem(userId, { kind: 'CR', reference: 'QF-ZEBRA-1', title: 'Quokka migration change', companyId: companyA }).item;
  const byTitle = pfmHits(userId, 'quokka');
  record('Quick Find: a new CR is found by title, as "REF · title" with its type',
    byTitle.length === 1 && byTitle[0].id === qf.id && byTitle[0].title === 'QF-ZEBRA-1 · Quokka migration change'
      && byTitle[0].subtitle === 'CR', JSON.stringify(byTitle));
  record('Quick Find: found by reference too', pfmHits(userId, 'QF-ZEBRA').some(r => r.id === qf.id));
  record('Quick Find: another login never sees it', pfmHits(otherId, 'quokka').length === 0);
  db.updatePfmItem(userId, qf.id, { title: 'Wombat migration change' });
  record('Quick Find: an edit re-indexes (old title gone, new one found)',
    pfmHits(userId, 'quokka').length === 0 && pfmHits(userId, 'wombat').length === 1);
  db.deletePfmItem(userId, qf.id);
  const qfHiddenInUndo = pfmHits(userId, 'wombat').length === 0;
  db.restorePfmItem(userId, qf.id);
  record('Quick Find: hidden during the delete-undo window, back after undo',
    qfHiddenInUndo && pfmHits(userId, 'wombat').length === 1);
  const pfmIndexRows = count("SELECT COUNT(*) AS n FROM workspace_search WHERE kind = 'pfm'");
  require('../migrations/063_pfm_workspace_search').up(conn);
  record('Quick Find: re-running migration 063 is a no-op',
    count("SELECT COUNT(*) AS n FROM workspace_search WHERE kind = 'pfm'") === pfmIndexRows
      && count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'workspace_search_pfm_%'") === 3);
  db.deletePfmItem(userId, qf.id);
  db.purgePfmItem(userId, qf.id);
  record('Quick Find: purge removes it from the index', pfmHits(userId, 'wombat').length === 0);

  // ── Attention (plan E2 follow-up, E3 validity) ──────────────────────────
  const att = (uid, today) => db.pfmAttentionItems(uid, today);
  const sentItem = db.createPfmItem(userId, { kind: 'OFFER', reference: 'ATT-SENT', title: 'Awaiting answer', companyId: companyA }).item;
  db.setPfmStatus(userId, sentItem.id, { status: 'SENT', date: '2090-03-01' });
  const followUp = today => att(userId, today).filter(a => a.type === 'pfmFollowUp' && a.id === sentItem.id);
  record('Attention: follow-up appears 7 days after Sent, dated that day, not before',
    followUp('2090-03-07').length === 0 && followUp('2090-03-08')[0]?.date === '2090-03-08'
      && followUp('2090-03-20')[0]?.date === '2090-03-08' && followUp('2090-03-20')[0]?.module === 'pfm',
    JSON.stringify(att(userId, '2090-03-08')));
  db.setPfmStatus(userId, sentItem.id, { status: 'REJECTED', date: '2090-03-09' });
  record('Attention: an answered offer needs no follow-up', followUp('2090-03-20').length === 0);

  const validItem = db.createPfmItem(userId, { kind: 'CR', reference: 'ATT-VALID', title: 'Expiring', companyId: companyA, validUntil: '2090-04-10' }).item;
  const expiry = today => att(userId, today).filter(a => a.type === 'pfmExpiry' && a.id === validItem.id);
  record('Attention: validity warns from 3 days before and after it ends',
    expiry('2090-04-06').length === 0 && expiry('2090-04-07')[0]?.date === '2090-04-10' && expiry('2090-05-01').length === 1);
  db.archivePfmItem(userId, validItem.id);
  const archivedQuiet = expiry('2090-04-08').length === 0;
  db.unarchivePfmItem(userId, validItem.id);
  db.setPfmStatus(userId, validItem.id, { status: 'ACCEPTED' });
  record('Attention: archived or final items stay quiet', archivedQuiet && expiry('2090-04-08').length === 0);
  record('Attention: another login sees none of them', att(otherId, '2090-05-01').length === 0);
  const now = new Date();
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dueToday = db.createPfmItem(userId, { kind: 'OFFER', reference: 'ATT-TODAY', title: 't', companyId: companyA, validUntil: localToday }).item;
  record('Attention: getAttentionItems includes Project & Finance items',
    db.getAttentionItems(userId).some(a => a.type === 'pfmExpiry' && a.id === dueToday.id));

  // ── Integrity ───────────────────────────────────────────────────────────
  const fk = conn.prepare('PRAGMA foreign_key_check').all();
  const integrity = conn.prepare('PRAGMA integrity_check').get();
  record('Integrity: foreign_key_check and integrity_check clean',
    fk.length === 0 && Object.values(integrity)[0] === 'ok', JSON.stringify({ fk, integrity }));
} catch (err) {
  exitCode = 1;
  console.error('FATAL:', err);
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n── Results ──');
for (const r of results) {
  console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.flow + (r.details && !r.pass ? '  (' + r.details + ')' : ''));
  if (!r.pass) exitCode = 1;
}
console.log('\n' + (exitCode === 0 ? 'ALL GREEN' : 'FAILURES PRESENT'));
process.exit(exitCode);
