// ─────────────────────────────────────────────────────────────────────────────
// Full Backup — headless data-layer smoke test (Milestone 8).
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron, no IPC, no
// renderer. Everything runs inside one throwaway temp directory copied from
// production at the start; db.fullBackup() itself is pointed at a second,
// equally throwaway temp directory standing in for the real Desktop — never
// anything resembling a real Desktop folder or <userData>.
//
// SAFETY: never touches production or a real Desktop. Both temp dirs are
// deleted at the end.
//
// Run:  node test/full-backup-smoke.js
//
// Gates exercised:
//   1. fullBackup() creates the expected folder structure (db file, projects/,
//      company_documents/, backups/, manifest.json) under a new
//      OfficeONE-Backup-{stamp}/ folder.
//   2. The copied DB file opens standalone and passes PRAGMA integrity_check.
//   3. Seeded files under projects/ and company_documents/ are copied
//      recursively (nested subfolders included) with correct file counts.
//   4. An empty/missing backups/ source folder doesn't error — reported as
//      skipped in the manifest with fileCount 0.
//   5. manifest.json's tableRowCounts match the live DB's own counts for a
//      couple of representative tables, and schemaHead matches the real
//      migration head.
//   6. Nothing is written under the source <userData> (workDir) itself —
//      fullBackup() only ever writes into the destination folder.
//   7. The manifest carries SHA-256 checksums; tampering is rejected.
//   8. Full restore replaces the DB and all managed file trees only after
//      staging them, and creates a complete pre-restore recovery bundle.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const db = require('../db');

const results = [];
function record(flow, pass, details) { results.push({ flow, pass, details }); }

// Guards against reading/copying the REAL production DB when this file is
// run directly (node test/<this file>) instead of via run-all.js — see
// test-bootstrap.js.
require('./test-bootstrap');

const prodDir = path.join(os.homedir(), 'AppData', 'Roaming', 'timesheet');
const prodDb  = path.join(prodDir, 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: production DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullbackup-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
const dbFilePath = path.join(workDir, 'cooperation-tools.db');
console.log('Working copy (fully disposable): ' + dbFilePath);

const fakeDesktopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullbackup-smoke-desktop-'));
console.log('Fake Desktop dir (fully disposable): ' + fakeDesktopDir);

let exitCode = 0;
try {
  db.openConnection(workDir);
  db.applyMigrations();

  const raw = new DatabaseSync(dbFilePath);
  const userRow = raw.prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  raw.close();
  if (!userRow) throw new Error('no active user in the copied DB');
  const userId = userRow.id;
  console.log('Using userId=' + userId + '\n');

  // Seed real file trees so the recursive copy has something to prove: a
  // nested projects/{id}/documents/ file and a company_documents/{id}/ file.
  // company_documents/ is left entirely absent from workDir on purpose (a
  // fresh-ish install may never have created it) to exercise the "missing
  // source folder" gate.
  const seededProjectDir = path.join(db.projectsRootDir(), '999999', 'documents');
  fs.mkdirSync(seededProjectDir, { recursive: true });
  fs.writeFileSync(path.join(seededProjectDir, 'quote.pdf'), 'fake pdf bytes');
  fs.writeFileSync(path.join(db.projectsRootDir(), '999999', 'note.txt'), 'top-level file too');

  // ── Gate 1/2/3/4 — run the full backup ──────────────────────────────────
  const res = db.fullBackup(fakeDesktopDir);
  record('Gate 1a: fullBackup() returns ok with a path under the fake Desktop dir',
    res.ok === true && res.path.startsWith(fakeDesktopDir), JSON.stringify({ ok: res.ok, path: res.path }));

  const destRoot = res.path;
  const expectedEntries = ['cooperation-tools.db', 'projects', 'company_documents', 'knowledge_hub', 'backups', 'manifest.json'];
  const actualEntries = fs.existsSync(destRoot) ? fs.readdirSync(destRoot) : [];
  record('Gate 1b: backup folder contains db file, all data-tree copies, and manifest.json',
    expectedEntries.every(e => actualEntries.includes(e)), JSON.stringify(actualEntries));

  // ── Gate 1c — db.fullBackup()'s own folder-name prefix is the current
  // entry of db.FULL_BACKUP_PREFIXES, and main.js's openBackupFolder handler
  // reads that same shared list (never a hardcoded literal) so the two can
  // never silently drift apart again the way they once did after the
  // Cooperation Tools → Office ONE rebrand.
  record('Gate 1c: fullBackup() names the folder with db.FULL_BACKUP_PREFIXES[0]',
    path.basename(destRoot).startsWith(db.FULL_BACKUP_PREFIXES[0]), path.basename(destRoot));
  const mainJsSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  record('Gate 1d: main.js\'s openBackupFolder handler reads db.FULL_BACKUP_PREFIXES, not a hardcoded prefix literal',
    /db\.FULL_BACKUP_PREFIXES/.test(mainJsSrc) && !/startsWith\(['"]CooperationTools-Backup-['"]\)/.test(mainJsSrc),
    'references db.FULL_BACKUP_PREFIXES=' + /db\.FULL_BACKUP_PREFIXES/.test(mainJsSrc));

  // ── Gate 2 — the copied DB opens standalone and passes integrity_check ──
  const copiedDbPath = path.join(destRoot, 'cooperation-tools.db');
  const copiedDb = new DatabaseSync(copiedDbPath);
  const integrityRows = copiedDb.prepare('PRAGMA integrity_check').all();
  const copiedOk = integrityRows.length === 1 && integrityRows[0].integrity_check === 'ok';
  const copiedTaskCount = copiedDb.prepare('SELECT COUNT(*) AS c FROM tasks').get().c;
  copiedDb.close();
  record('Gate 2: the copied DB opens standalone and passes integrity_check',
    copiedOk, JSON.stringify(integrityRows).slice(0, 150));

  // ── Gate 3 — seeded files copied recursively with correct nesting ───────
  const copiedProjectFile = path.join(destRoot, 'projects', '999999', 'documents', 'quote.pdf');
  const copiedTopLevelFile = path.join(destRoot, 'projects', '999999', 'note.txt');
  record('Gate 3a: nested projects/{id}/documents/ file was copied byte-for-byte',
    fs.existsSync(copiedProjectFile) && fs.readFileSync(copiedProjectFile, 'utf8') === 'fake pdf bytes',
    'exists=' + fs.existsSync(copiedProjectFile));
  record('Gate 3b: top-level projects/{id}/ file (sibling of documents/) was also copied',
    fs.existsSync(copiedTopLevelFile), 'exists=' + fs.existsSync(copiedTopLevelFile));
  record('Gate 3c: manifest reports the projects/ folder\'s file count correctly (2 files)',
    res.manifest.folders.projects.fileCount === 2, JSON.stringify(res.manifest.folders.projects));

  // ── Gate 4 — missing company_documents/ source folder is a non-error ────
  const companyDocsDestDir = path.join(destRoot, 'company_documents');
  record('Gate 4a: a missing source folder (company_documents/ was never created in workDir) does not throw',
    fs.existsSync(companyDocsDestDir), 'destDir exists=' + fs.existsSync(companyDocsDestDir));
  record('Gate 4b: manifest marks the missing folder as skipped with fileCount 0',
    res.manifest.folders.company_documents.skipped === true && res.manifest.folders.company_documents.fileCount === 0,
    JSON.stringify(res.manifest.folders.company_documents));

  // ── Gate 5 — manifest content sanity (row counts + schema head) ─────────
  const manifestOnDisk = JSON.parse(fs.readFileSync(path.join(destRoot, 'manifest.json'), 'utf8'));
  const liveCheckDb = new DatabaseSync(dbFilePath);
  const liveTaskCount = liveCheckDb.prepare('SELECT COUNT(*) AS c FROM tasks').get().c;
  const liveHeadRow = liveCheckDb.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  liveCheckDb.close();
  record('Gate 5a: manifest.json on disk matches the returned manifest object',
    manifestOnDisk.schemaHead === res.manifest.schemaHead && manifestOnDisk.tableRowCounts.tasks === res.manifest.tableRowCounts.tasks,
    JSON.stringify({ onDisk: manifestOnDisk.schemaHead, returned: res.manifest.schemaHead }));
  record('Gate 5b: manifest tableRowCounts.tasks matches the live DB\'s own count (includes the seed-time state, before the seeded files above — those were file-only, no DB rows added)',
    res.manifest.tableRowCounts.tasks === liveTaskCount, `manifest=${res.manifest.tableRowCounts.tasks} live=${liveTaskCount}`);
  record('Gate 5c: manifest schemaHead matches the real migration head',
    res.manifest.schemaHead === liveHeadRow.v, `manifest=${res.manifest.schemaHead} live=${liveHeadRow.v}`);
  record('Gate 5d: manifest.totalFileCount/totalByteCount are positive and consistent',
    res.manifest.totalFileCount > 0 && res.manifest.totalByteCount > 0, JSON.stringify({ files: res.manifest.totalFileCount, bytes: res.manifest.totalByteCount }));
  record('Gate 5e: manifest contains a checksum inventory covering the DB and seeded project files',
    Array.isArray(res.manifest.fileInventory)
      && res.manifest.fileInventory.some(f => f.path === 'cooperation-tools.db' && /^[a-f0-9]{64}$/.test(f.sha256))
      && res.manifest.fileInventory.some(f => f.path === 'projects/999999/documents/quote.pdf'),
    `inventory=${res.manifest.fileInventory?.length || 0}`);

  // ── Gate 6 — nothing written back into the source userData (workDir) ────
  const workDirEntriesBefore = new Set(['cooperation-tools.db', 'cooperation-tools.db-wal', 'cooperation-tools.db-shm', 'projects']);
  const workDirEntriesAfter = fs.readdirSync(workDir);
  const unexpectedNewEntries = workDirEntriesAfter.filter(e => !workDirEntriesBefore.has(e) && e !== 'backups'); // rotateBackups() itself is a separate, pre-existing mechanism
  record('Gate 6: fullBackup() wrote nothing new under the source userData dir itself',
    unexpectedNewEntries.length === 0, 'unexpectedNewEntries=' + JSON.stringify(unexpectedNewEntries));

  // ── Gate 7 — validation rejects a bundle whose file no longer matches its checksum
  const tamperedRoot = path.join(fakeDesktopDir, 'OfficeONE-Backup-TAMPERED');
  fs.cpSync(destRoot, tamperedRoot, { recursive: true });
  fs.writeFileSync(path.join(tamperedRoot, 'projects', '999999', 'documents', 'quote.pdf'), 'tampered bytes');
  const tamperedInspection = db.inspectFullBackup(tamperedRoot);
  record('Gate 7: inspectFullBackup() rejects a tampered managed file',
    tamperedInspection.ok === false && /checksum/i.test(tamperedInspection.error || ''),
    JSON.stringify(tamperedInspection));

  // ── Gate 8 — restore the complete known-good bundle (disposable workDir only)
  const postBackupTask = db.createTask(userId, { name: 'Created after full backup', status: 'OPEN' });
  fs.writeFileSync(path.join(seededProjectDir, 'quote.pdf'), 'changed after backup');
  fs.writeFileSync(path.join(db.projectsRootDir(), 'live-only.txt'), 'must disappear on restore');
  const validInspection = db.inspectFullBackup(destRoot);
  record('Gate 8a: inspectFullBackup() validates the untouched bundle before restore',
    validInspection.ok === true, JSON.stringify(validInspection));

  const restore = db.restoreFullBackup(destRoot);
  record('Gate 8b: restoreFullBackup() completes and reports its recovery bundle',
    restore.ok === true && fs.existsSync(restore.recoveryPath),
    JSON.stringify(restore));

  if (restore.ok) {
    db.openConnection(workDir);
    const restoredProjectFile = path.join(db.projectsRootDir(), '999999', 'documents', 'quote.pdf');
    record('Gate 8c: full restore replaces both database state and managed file trees',
      db.getTask(userId, postBackupTask.id) === null
        && fs.readFileSync(restoredProjectFile, 'utf8') === 'fake pdf bytes'
        && !fs.existsSync(path.join(db.projectsRootDir(), 'live-only.txt')),
      JSON.stringify({
        postBackupTaskGone: db.getTask(userId, postBackupTask.id) === null,
        restoredBytes: fs.readFileSync(restoredProjectFile, 'utf8'),
        liveOnlyGone: !fs.existsSync(path.join(db.projectsRootDir(), 'live-only.txt')),
      }));
    record('Gate 8d: pre-full-restore recovery bundle contains its own DB, manifest, and managed trees',
      fs.existsSync(path.join(restore.recoveryPath, 'cooperation-tools.db'))
        && fs.existsSync(path.join(restore.recoveryPath, 'manifest.json'))
        && fs.existsSync(path.join(restore.recoveryPath, 'projects')),
      restore.recoveryPath);
  }

} catch (err) {
  console.error('\nTEST HARNESS ERROR: ' + (err && err.stack || err));
  exitCode = 2;
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(fakeDesktopDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n════════════════════ FULL BACKUP SMOKE RESULTS ════════════════════');
let failed = 0;
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  if (!r.pass) failed++;
  console.log(`[${tag}] ${r.flow}\n        ${r.details}`);
}
console.log('─────────────────────────────────────────────────────────────────');
console.log(`${results.length - failed}/${results.length} flows passed` + (failed ? `  (${failed} FAILED)` : '  — all green'));
if (failed > 0 && exitCode === 0) exitCode = 1;
process.exit(exitCode);
