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
// validity 3 days before it ends). Migration 074 adds the delivery flow
// (Rejected only out of Sent), stage files, the optional project link with its
// relink on a project-delete undo, and the move of project documents onto Offers.
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

  // ── Migrations 062 + 074 ────────────────────────────────────────────────
  const FLOW = ['PREPARE', 'READY', 'SENT', 'ACCEPTED', 'UAT_APPROVED', 'PRODUCTION_APPROVED', 'INVOICED', 'PAID', 'REJECTED'];
  const statuses = db.getLookupsByCategory('PFM_STATUS').map(o => o.code);
  record('Migration: PFM_STATUS holds the delivery flow in stage order, Rejected last',
    JSON.stringify(statuses) === JSON.stringify(FLOW), JSON.stringify(statuses));
  const arabic = readRow(dbFile, "SELECT name_ar FROM lookup_codes WHERE category = 'PFM_STATUS' AND code = 'SENT'");
  record('Migration: seeded statuses carry Arabic names', arabic?.name_ar === 'مُرسل', JSON.stringify(arabic));
  const acceptedName = readRow(dbFile, "SELECT name_en, name_ar FROM lookup_codes WHERE category = 'PFM_STATUS' AND code = 'ACCEPTED'");
  record('Migration 074: Accepted reads as the quote approval',
    acceptedName?.name_en === 'Accepted (Quote Approval)' && acceptedName?.name_ar === 'مقبول (اعتماد العرض)', JSON.stringify(acceptedName));
  const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'pfm_%' ORDER BY name").all().map(r => r.name);
  record('Migration: all six pfm_ tables exist',
    JSON.stringify(tables) === JSON.stringify(['pfm_history', 'pfm_items', 'pfm_stage_files', 'pfm_stages', 'pfm_version_files', 'pfm_versions']), JSON.stringify(tables));
  const triggersBefore = count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'");
  record('Migration: 10 lookup-category triggers installed',
    count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_pfm_%_category'") === 10);
  const head = count('SELECT MAX(version) AS n FROM schema_migrations');
  record('Migration: schema head is at least 62', head >= 62, `head=${head}`);

  // Guarded seed + idempotency: re-running 062's up() by hand must not add rows.
  require('../migrations/062_project_finance').up(conn);
  require('../migrations/074_pfm_delivery_flow').up(conn);
  db.applyMigrations();
  record('Migration: re-running is a no-op (no duplicate statuses or triggers)',
    count("SELECT COUNT(*) AS n FROM lookup_codes WHERE category = 'PFM_STATUS'") === FLOW.length
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

  // ── History: typing is one edit, not one row per pause ─────────────────
  const nameRows = () => db.getPfmHistory(userId, offer.id).filter(h => h.field === 'Client Contact Name');
  const nameRowsBefore = nameRows().length;
  ['Cli', 'Client', 'Client Other'].forEach(v => db.updatePfmItem(userId, offer.id, { contactName: v }));
  const merged = nameRows();
  record('History: a run of edits to one field is one row, old → final',
    merged.length === nameRowsBefore + 1 && merged[0].oldValue === 'Client Person' && merged[0].newValue === 'Client Other',
    JSON.stringify(merged));
  db.updatePfmItem(userId, offer.id, { contactName: 'Client Person' });
  record('History: typing back to the original leaves no row', nameRows().length === nameRowsBefore,
    JSON.stringify(nameRows()));
  db.updatePfmItem(userId, offer.id, { contactName: 'Client Other' });
  db.updatePfmItem(userId, offer.id, { title: 'Generic offer (interim)' });
  db.updatePfmItem(userId, offer.id, { contactName: 'Client Person' });
  db.updatePfmItem(userId, offer.id, { title: 'Generic offer (revised)' });
  record('History: another change in between keeps edits separate', nameRows().length === nameRowsBefore + 2,
    JSON.stringify(nameRows()));

  // ── Client channel (migration 064) ──────────────────────────────────────
  const viaEmail = db.updatePfmItem(userId, offer.id, { channel: 'email', channelRef: ' Generic subject ' });
  record('Channel: Email stores its title/subject', viaEmail.ok && viaEmail.item.channel === 'EMAIL'
    && viaEmail.item.channelRef === 'Generic subject', JSON.stringify(viaEmail));
  record('Channel: an unknown channel is refused', !db.updatePfmItem(userId, offer.id, { channel: 'FAX' }).ok);
  record('Channel: a Jira reference must be an http(s) URL',
    !db.updatePfmItem(userId, offer.id, { channel: 'JIRA', channelRef: 'ABC-123' }).ok);
  const viaJira = db.updatePfmItem(userId, offer.id, { channel: 'JIRA', channelRef: 'https://jira.example.test/browse/ABC-1' });
  record('Channel: Jira stores its URL', viaJira.ok && viaJira.item.channel === 'JIRA'
    && viaJira.item.channelRef === 'https://jira.example.test/browse/ABC-1', JSON.stringify(viaJira));
  const noChannel = db.updatePfmItem(userId, offer.id, { channel: '', channelRef: 'ignored' });
  record('Channel: clearing the channel clears its reference',
    noChannel.ok && noChannel.item.channel === '' && noChannel.item.channelRef === '', JSON.stringify(noChannel));
  record('Channel: changes are in the item history',
    db.getPfmHistory(userId, offer.id).some(h => h.field === 'Channel'));

  // ── Status + stages ─────────────────────────────────────────────────────
  const planned = db.savePfmStage(userId, offer.id, { status: 'SENT', memberName: 'Person B' });
  record('Stage: planning a person does not move the status',
    planned.ok && planned.item.status === 'PREPARE'
      && planned.item.stages.some(s => s.status === 'SENT' && s.memberName === 'Person B' && s.doneOn === ''),
    JSON.stringify(planned.item?.stages));
  const dated = db.savePfmStage(userId, offer.id, { status: 'READY', memberName: 'Person A', doneOn: '2090-01-03' });
  record('Stage: dating a later stage moves the status to it',
    dated.ok && dated.item.status === 'READY'
      && db.getPfmHistory(userId, offer.id).some(h => h.field === 'Status'), JSON.stringify(dated.item?.status));
  const sent =db.setPfmStatus(userId, offer.id, { status: 'SENT', date: '2090-01-05' });
  const sentStage = sent.item.stages.find(s => s.status === 'SENT');
  record('Status: move keeps the planned person and stamps the date',
    sent.ok && sent.item.status === 'SENT' && sentStage.memberName === 'Person B' && sentStage.doneOn === '2090-01-05',
    JSON.stringify(sentStage));
  record('Status: an unknown status is refused', !db.setPfmStatus(userId, offer.id, { status: 'NOPE' }).ok);
  const accepted = db.setPfmStatus(userId, offer.id, { status: 'ACCEPTED', memberName: 'person b ', note: 'signed' });
  record('Status: ACCEPTED is no longer final (delivery follows it)', accepted.ok && !accepted.item.isFinal, JSON.stringify(accepted.item?.status));
  const redated = db.savePfmStage(userId, offer.id, { status: 'PREPARE', doneOn: '2090-01-01' });
  record('Stage: dating an earlier stage never moves the status back',
    redated.ok && redated.item.status === 'ACCEPTED', JSON.stringify(redated.item?.status));
  db.savePfmStage(userId, offer.id, { status: 'UAT_APPROVED', memberName: 'Temp' });
  const cleared = db.savePfmStage(userId, offer.id, { status: 'UAT_APPROVED', memberName: '' });
  record('Stage: a stage emptied of everything is removed',
    cleared.ok && !cleared.item.stages.some(s => s.status === 'UAT_APPROVED'), JSON.stringify(cleared.item?.stages));
  const stageOf = (res, code) => res.item.stages.find(s => s.status === code);
  const undone = db.savePfmStage(userId, offer.id, { status: 'ACCEPTED', doneOn: '' });
  record('Stage: marking the current stage not done steps the status back to the last done stage',
    undone.ok && undone.item.status === 'SENT' && stageOf(undone, 'ACCEPTED')?.doneOn === ''
      && stageOf(undone, 'ACCEPTED')?.note === 'signed', JSON.stringify(undone.item?.status));
  const movedBack = db.setPfmStatus(userId, offer.id, { status: 'PREPARE', date: '2090-01-07' });
  record('Status: moving back makes every later stage not done, keeping its person',
    movedBack.ok && movedBack.item.status === 'PREPARE'
      && ['READY', 'SENT'].every(code => stageOf(movedBack, code)?.doneOn === '')
      && stageOf(movedBack, 'READY')?.memberName === 'Person A'
      && db.getPfmHistory(userId, offer.id).some(h => h.field === 'Ready: Date' && h.oldValue === '2090-01-03'),
    JSON.stringify(movedBack.item?.stages));
  const nextOf = () => db.listPfmItems(userId).find(i => i.id === offer.id)?.nextStep;
  record('List: the next step is the first not-done stage after the current one that has a person',
    JSON.stringify(nextOf()) === JSON.stringify({ status: 'READY', memberName: 'Person A', note: '' }), JSON.stringify(nextOf()));
  db.savePfmStage(userId, offer.id, { status: 'READY', note: 'Add the price, then send' });
  record('List: the next step carries its note', nextOf()?.note === 'Add the price, then send', JSON.stringify(nextOf()));
  const firstUndone = db.savePfmStage(userId, offer.id, { status: 'PREPARE', doneOn: '' });
  record('Stage: the first status has nothing before it, so it stays current',
    firstUndone.ok && firstUndone.item.status === 'PREPARE', JSON.stringify(firstUndone.item?.status));
  // Rejected is the other way out of Sent (migration 074), never after Accepted.
  db.setPfmStatus(userId, offer.id, { status: 'SENT', date: '2090-01-09' });
  const rejected = db.setPfmStatus(userId, offer.id, { status: 'REJECTED', date: '2090-01-10' });
  record('Status: Sent → Rejected is allowed and final', rejected.ok && rejected.item.isFinal, JSON.stringify(rejected.item?.status));
  const deliverWhileRejected = db.savePfmStage(userId, offer.id, { status: 'ACCEPTED', doneOn: '2090-01-10' });
  record('Status: a rejected item cannot date a delivery stage',
    !deliverWhileRejected.ok && /rejected/.test(deliverWhileRejected.error), JSON.stringify(deliverWhileRejected));
  const reopened = db.setPfmStatus(userId, offer.id, { status: 'ACCEPTED', date: '2090-01-11' });
  record('Status: moving a rejected item to Accepted un-does the rejection',
    reopened.ok && reopened.item.status === 'ACCEPTED' && stageOf(reopened, 'REJECTED')?.doneOn === '', JSON.stringify(reopened.item?.stages));
  const lateReject = db.setPfmStatus(userId, offer.id, { status: 'REJECTED' });
  const lateRejectStage = db.savePfmStage(userId, offer.id, { status: 'REJECTED', doneOn: '2090-01-12' });
  record('Status: an accepted item can not be rejected (move or dated stage)',
    !lateReject.ok && !lateRejectStage.ok && /cannot be rejected/.test(lateReject.error)
      && db.getPfmItem(userId, offer.id).status === 'ACCEPTED', JSON.stringify([lateReject, lateRejectStage]));
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

  // The list's ZIP export takes only the newest version's files.
  const latestBefore = db.listPfmLatestFiles(userId, [offer.id])[0];
  record('ZIP export: an older version\'s files are left out',
    latestBefore.version === 'v2' && latestBefore.files.length === 0, JSON.stringify(latestBefore));
  db.addPfmVersionFiles(userId, v2.version.id, [goodPdf]);
  const latest = db.listPfmLatestFiles(userId, [offer.id, 999999])[0];
  record('ZIP export: the newest version\'s files come with the client, reference and title',
    db.listPfmLatestFiles(userId, [offer.id, 999999]).length === 1 && latest.company === db.listPfmItems(userId).find(i => i.id === offer.id).company
      && latest.reference && latest.title && latest.files.length === 1 && latest.files[0].exists
      && latest.files[0].originalName === 'offer.pdf' && fs.existsSync(latest.files[0].absPath), JSON.stringify(latest));
  record('ZIP export: another login gets nothing', db.listPfmLatestFiles(otherId, [offer.id]).length === 0);

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
  record('List: rows carry current fees, current person and the current status note',
    listed.currentVersion?.feesMinor === 1050050 && listed.currentMember === 'person b' && listed.currentNote === 'signed',
    JSON.stringify(listed));
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
      && history.some(h => h.field === 'Status' && /^Accepted/.test(h.newValue)) && history[0].changedBy === 'fixture-user',
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
  record('Attention: archived or accepted items stay quiet', archivedQuiet && expiry('2090-04-08').length === 0);
  db.setPfmStatus(userId, validItem.id, { status: 'INVOICED' });
  record('Attention: a delivery stage after Accepted stays quiet too', expiry('2090-04-08').length === 0);
  record('Attention: another login sees none of them', att(otherId, '2090-05-01').length === 0);
  const now = new Date();
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dueToday = db.createPfmItem(userId, { kind: 'OFFER', reference: 'ATT-TODAY', title: 't', companyId: companyA, validUntil: localToday }).item;
  record('Attention: getAttentionItems includes Project & Finance items',
    db.getAttentionItems(userId).some(a => a.type === 'pfmExpiry' && a.id === dueToday.id));

  // ── Delivery flow (migration 074) ───────────────────────────────────────
  const flowItem = db.createPfmItem(userId, { kind: 'CR', reference: 'FLOW-1', title: 'Delivery', companyId: companyA }).item;
  db.setPfmStatus(userId, flowItem.id, { status: 'SENT' });
  db.setPfmStatus(userId, flowItem.id, { status: 'ACCEPTED' });
  const walked = ['UAT_APPROVED', 'PRODUCTION_APPROVED', 'INVOICED', 'PAID'].map(code => db.setPfmStatus(userId, flowItem.id, { status: code }));
  record('Flow: Accepted → UAT → Production → Invoiced → Paid, only Paid is final',
    walked.every(r => r.ok) && walked[3].item.status === 'PAID' && walked[3].item.isFinal && !walked[2].item.isFinal,
    JSON.stringify(walked.map(r => r.item?.status)));

  // ── Stage files ─────────────────────────────────────────────────────────
  const invoicedId = conn.prepare("SELECT id FROM lookup_codes WHERE category = 'PFM_STATUS' AND code = 'INVOICED'").get().id;
  const stageDir = path.join(pfmRoot, String(flowItem.id), 'stages', String(invoicedId));
  const stageAdd = db.addPfmStageFiles(userId, flowItem.id, 'INVOICED', [goodPdf, fakePdf]);
  const invoiceFile = stageAdd.item?.stageFiles?.find(f => f.status === 'INVOICED');
  record('Stage files: each passes or fails on its own, stored under stages/{status}/',
    stageAdd.ok && JSON.stringify(stageAdd.results.map(r => r.ok)) === '[true,false]' && invoiceFile?.originalName === 'offer.pdf'
      && invoiceFile.exists && fs.existsSync(path.join(stageDir, path.basename(invoiceFile.path))), JSON.stringify(stageAdd));
  record('Stage files: unknown status and another login are refused',
    !db.addPfmStageFiles(userId, flowItem.id, 'NOPE', [goodPdf]).ok && !db.addPfmStageFiles(otherId, flowItem.id, 'INVOICED', [goodPdf]).ok
      && !db.resolvePfmStageFile(otherId, invoiceFile.id).ok && !db.removePfmStageFile(otherId, invoiceFile.id).ok);
  const stageResolved = db.resolvePfmStageFile(userId, invoiceFile.id);
  record('Stage files: resolve stays inside the stage folder',
    stageResolved.ok && stageResolved.exists && path.dirname(stageResolved.absPath) === stageDir, JSON.stringify(stageResolved));
  conn.prepare('UPDATE pfm_stage_files SET file_path = ? WHERE id = ?').run(path.join('..', '..', 'evil.pdf'), invoiceFile.id);
  const stageEscape = db.resolvePfmStageFile(userId, invoiceFile.id);
  conn.prepare('UPDATE pfm_stage_files SET file_path = ? WHERE id = ?').run(invoiceFile.path, invoiceFile.id);
  record('Stage files: path escape blocked', !stageEscape.ok && /invalid/i.test(stageEscape.error), JSON.stringify(stageEscape));
  const stageRemoved = db.removePfmStageFile(userId, invoiceFile.id);
  const stageRestored = db.restorePfmStageFile(userId, invoiceFile.id);
  record('Stage files: remove hides it, undo brings it back',
    stageRemoved.ok && stageRemoved.item.stageFiles.length === 0 && stageRestored.ok && stageRestored.item.stageFiles.length === 1);
  record('Stage files: part of the ZIP export',
    db.listPfmLatestFiles(userId, [flowItem.id])[0].files.some(f => f.originalName === 'offer.pdf' && f.exists));
  fs.writeFileSync(path.join(stageDir, 'stray.pdf'), 'x');
  const stageSweep = db.runMaintenance().pfmFiles;
  record('Stage files: orphan sweep removes a stray file, keeps the real one',
    !fs.existsSync(path.join(stageDir, 'stray.pdf')) && fs.existsSync(stageResolved.absPath), JSON.stringify(stageSweep));
  record('Stage files: diagnostics see the stored file', db.getSystemDiagnostics().missingFiles.every(m => m.table !== 'pfm_stage_files'));
  record('Trigger: a wrong-category stage-file status is rejected',
    /wrong lookup category/.test(tryWrite(`UPDATE pfm_stage_files SET status_id = ${companyA} WHERE id = ${invoiceFile.id}`)));
  db.removePfmStageFile(userId, invoiceFile.id);
  record('Stage files: purge after remove deletes the row and the bytes',
    db.purgePfmStageFile(userId, invoiceFile.id).ok && !fs.existsSync(stageResolved.absPath)
      && count(`SELECT COUNT(*) AS n FROM pfm_stage_files WHERE id = ${invoiceFile.id}`) === 0);

  // ── Project link ────────────────────────────────────────────────────────
  const project = db.createProject(userId, { name: 'Generic project', companyIds: [companyA] });
  const bare = db.createProject(userId, { name: 'Project without client', companyIds: [] });
  const othersProject = db.createProject(otherId, { name: 'Other login project', companyIds: [companyA] });
  const linked = db.updatePfmItem(userId, flowItem.id, { projectId: project.id });
  record('Project: links to a project the client is on',
    linked.ok && linked.item.projectId === project.id && linked.item.projectName === 'Generic project', JSON.stringify(linked));
  record('Project: a project not on the client, or another login\'s, is refused',
    /project of this client/.test(db.updatePfmItem(userId, flowItem.id, { projectId: bare.id }).error || '')
      && !db.updatePfmItem(userId, flowItem.id, { projectId: othersProject.id }).ok);
  record('Project: the list filters by project, and the link is in the history',
    db.listPfmItems(userId, { projectId: project.id }).map(i => i.id).join() === String(flowItem.id)
      && db.getPfmHistory(userId, flowItem.id).some(h => h.field === 'Project' && h.newValue === 'Generic project'));
  const withProject = db.createPfmItem(userId, { kind: 'OFFER', reference: 'FLOW-2', title: 't', companyId: companyA, projectId: project.id });
  record('Project: an item can be created already linked', withProject.ok && withProject.item.projectId === project.id);
  db.deleteProject(userId, project.id);
  const unlinked = db.getPfmItem(userId, flowItem.id);
  const again = db.createProject(userId, { name: 'Generic project', companyIds: [companyA] });
  record('Project: another login cannot relink', !db.relinkPfmProject(otherId, again.id, [flowItem.id]).ok);
  const relinked = db.relinkPfmProject(userId, again.id, [flowItem.id, withProject.item.id]);
  record('Project: deleting it unlinks, undo (re-created project) links again',
    unlinked.projectId === null && relinked.ok && relinked.count === 2 && db.getPfmItem(userId, flowItem.id).projectId === again.id,
    JSON.stringify(relinked));

  // ── Migration 074: project documents move onto an Offer ─────────────────
  // Migration 081 dropped the (empty) table; put back the shape 074 read.
  conn.exec(`CREATE TABLE IF NOT EXISTS project_documents (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL, is_available INTEGER NOT NULL DEFAULT 0,
    file_path TEXT, original_name TEXT, file_size INTEGER, mime_type TEXT, uploaded_at TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_documents_unique ON project_documents(project_id, document_type);`);
  const docProject = db.createProject(userId, { name: 'Project with documents', companyIds: [companyA] });
  const docDir = path.join(workDir, 'projects', String(docProject.id), 'documents');
  fs.mkdirSync(docDir, { recursive: true });
  const putDoc = (type, name, bytes, day) => {
    const rel = path.join('projects', String(docProject.id), 'documents', `${type}-1.pdf`);
    fs.writeFileSync(path.join(workDir, rel), bytes);
    conn.prepare(`INSERT INTO project_documents(project_id, document_type, is_available, file_path, original_name, file_size, mime_type, uploaded_at)
                  VALUES (?, ?, 1, ?, ?, ?, 'application/pdf', ?)`).run(docProject.id, type, rel, name, Buffer.byteLength(bytes), `2090-06-${day}T10:00:00.000Z`);
    return rel;
  };
  const quoteRel = putDoc('QUOTATION', 'quote.pdf', '%PDF-1.4\nquote\n', '01');
  putDoc('QUOTATION_APPROVAL', 'approval.pdf', '%PDF-1.4\napproval\n', '03');
  putDoc('INVOICE', 'invoice.pdf', '%PDF-1.4\ninvoice\n', '09');
  require('../migrations/074_pfm_delivery_flow').up(conn, { userDataDir: workDir });
  const movedRow = db.listPfmItems(userId, { projectId: docProject.id })[0];
  const moved = movedRow && db.getPfmItem(userId, movedRow.id);
  const bytesOf = rel => fs.readFileSync(path.join(workDir, rel), 'utf8');
  record('Move: one Offer per project, linked, at its furthest stage, dated by upload',
    moved?.kind === 'OFFER' && moved.reference === `PRJ-${docProject.id}` && moved.title === 'Project with documents'
      && moved.status === 'INVOICED' && moved.stages.find(s => s.status === 'SENT')?.doneOn === '2090-06-01'
      && moved.stages.find(s => s.status === 'ACCEPTED')?.doneOn === '2090-06-03', JSON.stringify(moved));
  const v1File = moved?.versions[0]?.files[0];
  record('Move: the quotation is version V1, the approval and invoice are stage files, bytes identical',
    moved?.versions.length === 1 && moved.versions[0].label === 'V1' && v1File?.originalName === 'quote.pdf'
      && bytesOf(v1File.path) === '%PDF-1.4\nquote\n'
      && moved.stageFiles.map(f => f.status + ':' + f.originalName).join() === 'ACCEPTED:approval.pdf,INVOICED:invoice.pdf'
      && bytesOf(moved.stageFiles[1].path) === '%PDF-1.4\ninvoice\n', JSON.stringify(moved?.stageFiles));
  record('Move: the project\'s document rows go, the original files stay on disk',
    count(`SELECT COUNT(*) AS n FROM project_documents WHERE project_id = ${docProject.id}`) === 0
      && fs.existsSync(path.join(workDir, quoteRel)));
  const itemsBefore = count('SELECT COUNT(*) AS n FROM pfm_items');
  require('../migrations/074_pfm_delivery_flow').up(conn, { userDataDir: workDir });
  record('Move: re-running moves nothing again', count('SELECT COUNT(*) AS n FROM pfm_items') === itemsBefore);

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
