// ─────────────────────────────────────────────────────────────────────────────
// Reports & Analytics — headless data-layer smoke test (Milestone 4).
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron, no IPC, no
// renderer. Reports/Analytics are renderer-side PDF/HTML builders over
// read-only IPC, so this test asserts the underlying db.js aggregation
// functions return correct grouped rollups for a seeded dataset, rather than
// attempting to render actual PDFs.
//
// SAFETY: never touches production. Copies the live DB into a throwaway temp
// dir and runs everything there; the temp dir is deleted at the end.
//
// Run:  node test/reports-analytics-smoke.js
//
// Gates exercised:
//   1. getAnalytics's byDepartment map correctly aggregates minutes for a
//      seeded department-linked task, keyed by lookup label.
//   2. A task without a department contributes no accidental "(none)" bucket.
//   3. getFilteredWorkLogs (the Custom Date-Range report's backing query)
//      correctly narrows by from/to, by company, by system, and by
//      projectId, each independently and combined (ANDed).
//   4. getFilteredWorkLogs with no filters at all returns every session
//      (sanity check that an absent filter is truly a no-op, not an
//      accidental empty-string/null mismatch).
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

const prodDir = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one');
const prodDb  = path.join(prodDir, 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: production DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-an-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
console.log('Working copy: ' + path.join(workDir, 'cooperation-tools.db'));

const DAY_A = '2097-06-01';
const DAY_B = '2097-06-15';
const DAY_C = '2097-07-01'; // outside the A/B range, for from/to filter gates

let exitCode = 0;
try {
  db.openConnection(workDir);
  db.applyMigrations();

  const raw = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const userRow = raw.prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  raw.close();
  if (!userRow) throw new Error('no active user in the copied DB');
  const userId = userRow.id;
  console.log('Using userId=' + userId + '\n');

  const companyLabel = db.getLookupsByCategory('COMPANY')[0]?.label;
  const systemLabel = db.getLookupsByCategory('SYSTEM')[0]?.label;
  const deptOpt = db.getLookupsByCategory('DEPARTMENT')[0];
  if (!companyLabel || !systemLabel || !deptOpt) throw new Error('missing a required lookup category to seed against');

  // ── Gate 1/2 — Analytics department dimension ──────────────────────────────
  const project = db.createProject(userId, { name: 'RA test project', description: '', companyIds: [], systemIds: [], status: 'ACTIVE' });
  // Internal tasks are now their own domain —
  // department-linked tasks are created via createInternalTask, not by
  // passing `department` to the client-only createTask.
  const deptTask = db.createInternalTask(userId, { name: 'RA dept task', status: 'OPEN', source: '', department: deptOpt.label });
  db.addWorkLog(userId, deptTask.id, { date: DAY_A, description: 'dept session', minutes: 45, time: 'WORK_TIME' });
  const projTask = db.createTask(userId, { name: 'RA project task', status: 'OPEN', company: '', system: '', source: '', projectId: project.id });
  db.addWorkLog(userId, projTask.id, { date: DAY_A, description: 'proj session', minutes: 30, time: 'WORK_TIME' });
  const plainTask = db.createTask(userId, { name: 'RA plain task', status: 'OPEN', company: '', system: '', source: '' });
  db.addWorkLog(userId, plainTask.id, { date: DAY_A, description: 'plain session', minutes: 15, time: 'WORK_TIME' });

  const an = db.getAnalytics(userId, DAY_A, DAY_A, DAY_A, DAY_A);
  record('Gate 1: byDepartment aggregates the seeded department-linked task\'s minutes under its label',
    (an.byDepartment[deptOpt.label] || 0) >= 45, `byDepartment[${deptOpt.label}]=${an.byDepartment[deptOpt.label]}`);

  const plainInDept = Object.values(an.byDepartment).length && an.byDepartment['undefined'];
  record('Gate 2: a task without a department contributes no undefined bucket',
    !plainInDept, `plainInDept=${!!plainInDept}`);

  // getAnalytics also splits total minutes into clientMin/internalMin
  // The combined KPI-header split means the 45-minute
  // internal session must land in internalMin, and the 30+15 client sessions
  // in clientMin, and the two must sum to the day's total.
  record('Gate 1b: clientMin/internalMin split correctly and sum to the total',
    an.internalMin === 45 && an.clientMin === 45 && (an.clientMin + an.internalMin) === an.totalMin,
    `clientMin=${an.clientMin} internalMin=${an.internalMin} totalMin=${an.totalMin}`);

  // ── Gates 3/4 — getFilteredWorkLogs (Custom Date-Range report) ──────────────
  const fCompany = db.createTask(userId, { name: 'RA filter company task', status: 'OPEN', company: companyLabel, system: '', source: '' });
  db.addWorkLog(userId, fCompany.id, { date: DAY_A, description: 'company-scoped session', minutes: 10, time: 'WORK_TIME' });
  const fSystem = db.createTask(userId, { name: 'RA filter system task', status: 'OPEN', company: '', system: systemLabel, source: '' });
  db.addWorkLog(userId, fSystem.id, { date: DAY_B, description: 'system-scoped session', minutes: 20, time: 'WORK_TIME' });
  const fProject = db.createTask(userId, { name: 'RA filter project task', status: 'OPEN', company: '', system: '', source: '', projectId: project.id });
  db.addWorkLog(userId, fProject.id, { date: DAY_C, description: 'project-scoped session, out of A-B range', minutes: 5, time: 'WORK_TIME' });

  const byRange = db.getFilteredWorkLogs(userId, { from: DAY_A, to: DAY_B });
  const rangeDescs = byRange.map(r => r.description);
  record('Gate 3a: from/to narrows to sessions within the range (excludes DAY_C)',
    rangeDescs.includes('company-scoped session') && rangeDescs.includes('system-scoped session') && !rangeDescs.includes('project-scoped session, out of A-B range'),
    `count=${byRange.length}`);

  const byCompanyOnly = db.getFilteredWorkLogs(userId, { company: companyLabel });
  record('Gate 3b: company filter narrows to that company\'s sessions only',
    byCompanyOnly.some(r => r.description === 'company-scoped session') && !byCompanyOnly.some(r => r.description === 'system-scoped session'),
    `count=${byCompanyOnly.length}`);

  const bySystemOnly = db.getFilteredWorkLogs(userId, { system: systemLabel });
  record('Gate 3c: system filter narrows to that system\'s sessions only',
    bySystemOnly.some(r => r.description === 'system-scoped session') && !bySystemOnly.some(r => r.description === 'company-scoped session'),
    `count=${bySystemOnly.length}`);

  const byProjectOnly = db.getFilteredWorkLogs(userId, { projectId: project.id });
  record('Gate 3d: projectId filter narrows to that project\'s sessions only',
    byProjectOnly.some(r => r.description === 'project-scoped session, out of A-B range') && !byProjectOnly.some(r => r.description === 'company-scoped session'),
    `count=${byProjectOnly.length}`);

  const combined = db.getFilteredWorkLogs(userId, { from: DAY_A, to: DAY_B, company: companyLabel });
  record('Gate 3e: combined filters are ANDed (from/to AND company)',
    combined.length === 1 && combined[0].description === 'company-scoped session', `count=${combined.length}`);

  const noFilters = db.getFilteredWorkLogs(userId, {});
  const allForUser = db.getFilteredWorkLogs(userId, undefined);
  record('Gate 4: no filters at all returns every one of the user\'s sessions (absent filter is a true no-op)',
    noFilters.length === allForUser.length && noFilters.length >= 6, `count=${noFilters.length}`);

} catch (err) {
  console.error('\nTEST HARNESS ERROR: ' + (err && err.stack || err));
  exitCode = 2;
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n════════════════════ REPORTS & ANALYTICS SMOKE RESULTS ════════════════════');
let failed = 0;
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  if (!r.pass) failed++;
  console.log(`[${tag}] ${r.flow}\n        ${r.details}`);
}
console.log('────────────────────────────────────────────────────────────────────────────');
console.log(`${results.length - failed}/${results.length} flows passed` + (failed ? `  (${failed} FAILED)` : '  — all green'));
if (failed > 0 && exitCode === 0) exitCode = 1;
process.exit(exitCode);
