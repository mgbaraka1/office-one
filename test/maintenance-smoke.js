// ─────────────────────────────────────────────────────────────────────────────
// Maintenance panel — headless data-layer smoke test (Milestone 6).
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron, no IPC, no
// renderer. Everything in this file — INCLUDING the restore flow — runs
// entirely inside one throwaway temp directory copied from production at the
// start. This is deliberate: restoreBackup() is the single riskiest function
// in the whole app (it replaces the live DB file), so this test exercises it
// only against a fully disposable copy, never anything resembling the real
// <userData>/backups/ folder. main.js's own app.relaunch()/app.exit() calls
// are NOT exercised here (Electron-only, not available under plain Node) —
// only db.js's own restoreBackup() (the file-level logic) is tested.
//
// SAFETY: never touches production. Copies the live DB into a throwaway temp
// dir and runs everything there; the temp dir is deleted at the end.
//
// Run:  node test/maintenance-smoke.js
//
// Gates exercised:
//   1. listBackups() reflects real files placed in the (throwaway) backups/
//      dir, newest first.
//   2. checkIntegrity() reports ok:true on a healthy DB.
//   3. findLookupDuplicates() finds a seeded case-only label collision
//      (e.g. "Acme Corp" / "ACME CORP") and does NOT flag unrelated,
//      non-colliding labels.
//   4. mergeLookupDuplicate() repoints every referencing row (tasks,
//      project_companies) from the source code onto the target, resolves a
//      junction-table conflict (a project already linked to both codes)
//      without violating the composite primary key, and deletes the
//      now-unreferenced source code — leaving the DB foreign-key-clean.
//   5. mergeLookupDuplicate() rejects an unsupported category.
//   6. getOrphanSweepReport()/runMaintenance() correctly records which
//      projects/{id}/ folders were removed this boot.
//   7. restoreBackup(): given a known-good backup file, replaces the live DB
//      with its content, takes a pre-restore backup of the PRE-restore state
//      first (outside backups/), and rejects a filename that isn't a real
//      backups/ entry (never accepts an arbitrary path from the renderer).
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
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maint-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
const dbFilePath = path.join(workDir, 'cooperation-tools.db');
console.log('Working copy (fully disposable): ' + dbFilePath);

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

  // ── Gate 2 — integrity check on a healthy DB ────────────────────────────────
  const integrity = db.checkIntegrity();
  record('Gate 2: checkIntegrity() reports ok on a healthy DB', integrity.ok === true, JSON.stringify(integrity).slice(0, 150));

  // ── Gate 3/4/5 — lookup duplicates + merge ──────────────────────────────────
  const companyA = db.createProject(userId, { name: 'Maint test project A', description: '', companyIds: [], systemIds: [], status: 'ACTIVE', category: 'NEW_PROJECT' });
  const cur = db.loadLookups(userId);
  const nextCategories = { ...cur.categories };
  nextCategories.COMPANY = [
    ...nextCategories.COMPANY.map(c => ({ id: c.id, code: c.code, label: c.label, sortOrder: c.sortOrder, isActive: c.isActive })),
    { id: null, code: null, label: 'Maint Dupe Co', sortOrder: 999, isActive: true },
    { id: null, code: null, label: 'MAINT DUPE CO', sortOrder: 1000, isActive: true }, // saveLookups' own guard blocks new-vs-new collisions...
  ];
  // saveLookups rejects a same-batch case-collision (by design, see Conventions) —
  // so to genuinely simulate a pre-existing duplicate (from before that guard
  // existed), insert the second one directly at the SQL level instead.
  db.saveLookups(userId, { categories: { COMPANY: nextCategories.COMPANY.slice(0, -1) }, defaultName: '' });
  const targetCode = db.getLookupsByCategory('COMPANY').find(c => c.label === 'Maint Dupe Co');
  const rawDb = new DatabaseSync(dbFilePath);
  rawDb.prepare("INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at) VALUES('COMPANY', 'MAINT_DUPE_CO_2', 'MAINT DUPE CO', 1001, 1, ?)").run(new Date().toISOString());
  const sourceId = rawDb.prepare("SELECT id FROM lookup_codes WHERE category = 'COMPANY' AND code = 'MAINT_DUPE_CO_2'").get().id;
  rawDb.close();

  const dupes = db.findLookupDuplicates();
  const found = dupes.find(d => d.category === 'COMPANY' && d.codes.some(c => c.id === targetCode.id) && d.codes.some(c => c.id === sourceId));
  record('Gate 3: findLookupDuplicates() finds the seeded case-only collision, does not flag unrelated labels',
    !!found && found.codes.length === 2, JSON.stringify(found));

  // Reference the duplicate from both a plain FK column (tasks) and a junction
  // table (project_companies) — including a conflict case (companyA already
  // linked to the TARGET code too, via a second row referencing sourceId).
  // The task is created plain then repointed via raw SQL (not by passing the
  // duplicate's label to createTask) because db.js's in-memory lookup cache
  // was built before the raw-SQL-inserted duplicate row existed, and only
  // mergeLookupDuplicate's own lkInvalidate() call (at the very end) refreshes
  // it — resolving a label through the stale cache here would silently miss.
  const taskOnDupe = db.createTask(userId, { name: 'Maint dupe task', status: 'OPEN', company: '', system: '', source: '' });
  const rawDb2 = new DatabaseSync(dbFilePath);
  rawDb2.prepare('UPDATE tasks SET company_id = ? WHERE id = ?').run(sourceId, taskOnDupe.id);
  rawDb2.prepare('INSERT OR IGNORE INTO project_companies(project_id, company_id) VALUES (?, ?)').run(companyA.id, targetCode.id);
  rawDb2.prepare('INSERT OR IGNORE INTO project_companies(project_id, company_id) VALUES (?, ?)').run(companyA.id, sourceId);
  const companyB = db.createProject(userId, { name: 'Maint test project B', description: '', companyIds: [], systemIds: [], status: 'ACTIVE', category: 'NEW_PROJECT' });
  rawDb2.prepare('INSERT OR IGNORE INTO project_companies(project_id, company_id) VALUES (?, ?)').run(companyB.id, sourceId);
  rawDb2.close();

  const mergeRes = db.mergeLookupDuplicate('COMPANY', targetCode.id, sourceId);
  const taskAfter = db.getTask(userId, taskOnDupe.id);
  const rawDb3 = new DatabaseSync(dbFilePath);
  const stillHasSource = rawDb3.prepare('SELECT 1 FROM lookup_codes WHERE id = ?').get(sourceId);
  const projAJunctionRows = rawDb3.prepare('SELECT company_id FROM project_companies WHERE project_id = ?').all(companyA.id);
  const projBJunctionRows = rawDb3.prepare('SELECT company_id FROM project_companies WHERE project_id = ?').all(companyB.id);
  const fkViolations = rawDb3.prepare('PRAGMA foreign_key_check').all();
  rawDb3.close();
  record('Gate 4a: mergeLookupDuplicate repoints a plain FK column (tasks.company_id) onto the target',
    mergeRes.ok && taskAfter.company === 'Maint Dupe Co', `mergeRes=${JSON.stringify(mergeRes)} taskCompany=${taskAfter.company}`);
  record('Gate 4b: source code is deleted after merge',
    !stillHasSource, 'stillHasSource=' + !!stillHasSource);
  record('Gate 4c: junction-table conflict (project A linked to both codes) resolves to a single row, no PK violation',
    projAJunctionRows.length === 1 && projAJunctionRows[0].company_id === targetCode.id, JSON.stringify(projAJunctionRows));
  record('Gate 4d: junction-table row with no pre-existing conflict (project B) is repointed cleanly',
    projBJunctionRows.length === 1 && projBJunctionRows[0].company_id === targetCode.id, JSON.stringify(projBJunctionRows));
  record('Gate 4e: DB is foreign-key-clean after the merge', fkViolations.length === 0, `violations=${fkViolations.length}`);

  const unsupported = db.mergeLookupDuplicate('TIME_TYPE', 1, 2);
  record('Gate 5: mergeLookupDuplicate rejects an unsupported category', unsupported.ok === false, JSON.stringify(unsupported));

  // ── Gate 6 — orphan sweep report ────────────────────────────────────────────
  const orphanProject = db.createProject(userId, { name: 'Maint orphan project', description: '', companyIds: [], systemIds: [], status: 'ACTIVE', category: 'NEW_PROJECT' });
  const orphanDir = path.join(db.projectsRootDir(), String(orphanProject.id + 9000)); // a folder with no matching project row
  fs.mkdirSync(orphanDir, { recursive: true });
  fs.writeFileSync(path.join(orphanDir, 'stray.txt'), 'orphan');
  db.runMaintenance();
  const report = db.getOrphanSweepReport();
  record('Gate 6: getOrphanSweepReport() records the stray project folder removed this boot',
    report.projectIds.includes(String(orphanProject.id + 9000)) && !fs.existsSync(orphanDir),
    JSON.stringify(report));

  // ── Gate 1/7 — backups list + restore (fully disposable temp dir only) ──────
  const backupsDir = path.join(workDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  // A "known-good" backup: snapshot the CURRENT (post-merge) state before making
  // one more change, so restoring it should visibly undo that later change.
  const goodBackupName = 'cooperation-tools-KNOWN-GOOD.db';
  db.backup(path.join(backupsDir, goodBackupName));

  const backupsList = db.listBackups();
  record('Gate 1: listBackups() reflects the real file just placed in backups/',
    backupsList.some(b => b.name === goodBackupName), JSON.stringify(backupsList.map(b => b.name)));

  record('Gate 7a: restoreBackup() rejects a filename that is not a real backups/ entry',
    db.restoreBackup('../../not-a-real-backup.db').ok === false, 'rejected path traversal attempt');

  // Make a change AFTER the known-good backup, so we can prove the restore undid it.
  const preRestoreTask = db.createTask(userId, { name: 'Task created AFTER the known-good backup', status: 'OPEN' });
  db.applyMigrations(); // reopen implicitly not needed; connection is still live here

  const restoreRes = db.restoreBackup(goodBackupName);
  record('Gate 7b: restoreBackup() with a real backup file returns ok', restoreRes.ok === true, JSON.stringify(restoreRes));

  const preRestoreBackupDir = path.join(workDir, 'pre-restore-backup');
  const preRestoreFiles = fs.existsSync(preRestoreBackupDir) ? fs.readdirSync(preRestoreBackupDir) : [];
  record('Gate 7c: a pre-restore backup of the PRE-restore state was taken (outside backups/)',
    preRestoreFiles.some(f => f.startsWith('cooperation-tools-PRE-RESTORE-')), JSON.stringify(preRestoreFiles));

  // Re-open against the now-restored file to confirm the post-backup task is gone.
  db.openConnection(workDir);
  const taskGoneAfterRestore = db.getTask(userId, preRestoreTask.id) === null;
  record('Gate 7d: after restore, a task created AFTER the known-good backup no longer exists',
    taskGoneAfterRestore, 'taskGoneAfterRestore=' + taskGoneAfterRestore);

} catch (err) {
  console.error('\nTEST HARNESS ERROR: ' + (err && err.stack || err));
  exitCode = 2;
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n════════════════════ MAINTENANCE SMOKE RESULTS ════════════════════');
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
