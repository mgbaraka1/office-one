// ─────────────────────────────────────────────────────────────────────────────
// Timesheet task-link clobber fix — headless data-layer smoke test.
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron, no IPC, no
// renderer. Copies the live DB into a throwaway temp dir and runs there;
// never touches production.
//
// Run:  node test/task-link-preservation-smoke.js
//
// Background: the Timesheet save reconciler (persistTimesheet, index.html)
// used to call the full-row db.updateTask() for every task with a session on
// the viewed day, with a payload that had no project/department fields — so
// every autosave silently NULLed out any existing tasks.project_id /
// department_id. The fix is a metadata-only db.updateTaskMeta() (name/status/
// company/system/source ONLY) that the Timesheet now calls instead; the real
// link editors (openBacklogModal, Projects/Internal Tasks) keep using the
// full db.updateTask(). This test guards both directions plus the new
// task_field_history audit trail (migration 037).
//
// Since the 2026-08 domain separation, Department is no longer a link on a
// CLIENT task — it is a separate domain (internal:*). Gates 1/3/6/7/8 below
// were rewritten accordingly: what used to be "a department-linked task" is
// now an INTERNAL task (created via createInternalTask), and what used to be
// "updateTask() changes the department link" is now "updateTask() throws on
// an internal task; changing domain is convertTaskToInternal/ToClient".
//
// Gates exercised:
//   1. updateTaskMeta() on an INTERNAL task, called with a payload carrying a
//      non-empty company/system (the worst case), leaves departmentId
//      unchanged and company/system NULL.
//   2. updateTaskMeta() on a PROJECT-linked task leaves project_id unchanged.
//   3. updateTaskMeta() still updates the metadata fields it's supposed to
//      (name/status/source) on an internal task, without touching department.
//   4. task_field_history records a genuine status change made via
//      updateTaskMeta.
//   5. task_field_history records NO row when updateTaskMeta is called with
//      completely unchanged metadata (link fields were never in play).
//   6. The full updateTask() (the real link editors' own path) still CAN
//      change project_id, records it in task_field_history by human label
//      (project name), and silently ignores a `department` field in its
//      payload (department is not this channel's concern any more).
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
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-link-smoke-'));
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

  const project = db.createProject(userId, {
    name: 'Task-link smoke project', description: '', companyIds: [], systemIds: [],
    status: 'ACTIVE', category: 'NEW_PROJECT',
  });
  const dept = db.getLookupsByCategory('DEPARTMENT')[0];
  if (!dept) throw new Error('no DEPARTMENT lookup codes in this copy');

  // The exact shape persistTimesheet()'s tsTaskPayload(row) builds — a
  // projectId that updateTaskMeta must ignore.
  const reconcilerPayload = (overrides) => Object.assign({
    name: 'unchanged name', status: 'IN_PROGRESS', company: '', system: '', source: '',
    projectId: null,
  }, overrides);

  // ── Gate 1 — an internal task's departmentId survives updateTaskMeta, and
  //             its company/system stay NULL even if the payload (worst case)
  //             carries a non-empty one ────────────────────────────────────
  {
    const t = db.createInternalTask(userId, { name: 'Dept task', status: 'OPEN', department: dept.label });
    const before = db.getTask(userId, t.id);
    db.updateTaskMeta(userId, t.id, reconcilerPayload({
      name: before.name, status: before.status, source: before.source,
      company: 'should-be-ignored', system: 'should-be-ignored',
    }));
    const after = db.getTask(userId, t.id);
    record('Gate 1: updateTaskMeta() leaves an INTERNAL task\'s departmentId unchanged and company/system NULL',
      after.departmentId === before.departmentId && after.departmentId === dept.id
        && after.company === '' && after.system === '',
      `before=${before.departmentId} after=${after.departmentId} company="${after.company}" system="${after.system}"`);
  }

  // ── Gate 2 — project link survives updateTaskMeta ────────────────────────
  {
    const t = db.createTask(userId, { name: 'Project task', status: 'OPEN', projectId: project.id });
    const before = db.getTask(userId, t.id);
    db.updateTaskMeta(userId, t.id, reconcilerPayload({ name: before.name, status: before.status, company: before.company, system: before.system, source: before.source }));
    const after = db.getTask(userId, t.id);
    record('Gate 2: updateTaskMeta() leaves a PROJECT-linked task\'s projectId unchanged',
      after.projectId === before.projectId && after.projectId === project.id,
      `before=${before.projectId} after=${after.projectId}`);
  }

  // ── Gate 3 — updateTaskMeta() still updates the metadata fields it owns ──
  let metaTaskId;
  {
    const t = db.createInternalTask(userId, { name: 'Meta task', status: 'OPEN', department: dept.label });
    db.updateTaskMeta(userId, t.id, reconcilerPayload({ name: 'Renamed via meta', status: 'IN_PROGRESS', source: 'edited-source' }));
    const after = db.getTask(userId, t.id);
    record('Gate 3: updateTaskMeta() updates name/status/source, department untouched',
      after.name === 'Renamed via meta' && after.status === 'IN_PROGRESS' && after.source === 'edited-source' && after.departmentId === dept.id,
      JSON.stringify({ name: after.name, status: after.status, source: after.source, departmentId: after.departmentId }));
    metaTaskId = t.id;
  }

  // ── Gate 4 — task_field_history records a genuine change via updateTaskMeta ──
  {
    const before = db.getTaskFieldHistory(userId, metaTaskId);
    db.updateTaskMeta(userId, metaTaskId, reconcilerPayload({ name: 'Renamed via meta', status: 'BLOCKED', source: 'edited-source' }));
    const after = db.getTaskFieldHistory(userId, metaTaskId);
    const statusRow = after.find(r => r.fieldName === 'Status');
    record('Gate 4: task_field_history records a genuine status change made via updateTaskMeta',
      after.length > before.length && !!statusRow && statusRow.oldValue === 'IN_PROGRESS' && statusRow.newValue === 'BLOCKED',
      `beforeCount=${before.length} afterCount=${after.length} status=${statusRow ? statusRow.oldValue + '->' + statusRow.newValue : 'MISSING'}`);
  }

  // ── Gate 5 — no history row when nothing actually changed ────────────────
  {
    const t = db.getTask(userId, metaTaskId);
    const before = db.getTaskFieldHistory(userId, metaTaskId);
    db.updateTaskMeta(userId, metaTaskId, reconcilerPayload({ name: t.name, status: t.status, company: t.company, system: t.system, source: t.source }));
    const after = db.getTaskFieldHistory(userId, metaTaskId);
    record('Gate 5: updateTaskMeta() with unchanged metadata writes NO task_field_history row',
      after.length === before.length, `beforeCount=${before.length} afterCount=${after.length}`);
  }

  // ── Gate 6 — the full updateTask() (real link editors) still changes the
  //             project link, records it by human label, and silently ignores
  //             a `department` field in its payload (a CLIENT task can never
  //             pick up a department through this channel — see
  //             convertTaskToInternal for the only way to cross domains) ────
  {
    const t = db.createTask(userId, { name: 'Link editor task', status: 'OPEN' });
    const before = db.getTaskFieldHistory(userId, t.id);
    db.updateTask(userId, t.id, { name: t.name, status: 'OPEN', company: '', system: '', source: '', projectId: project.id, department: dept.label });
    const after = db.getTask(userId, t.id);
    const history = db.getTaskFieldHistory(userId, t.id);
    const deptRow = history.find(r => r.fieldName === 'Department');
    const projRow = history.find(r => r.fieldName === 'Project');
    const pass = after.projectId === project.id && after.departmentId === null
      && history.length > before.length
      && !deptRow    // department never even appears in the diff — it was null before and stays null
      && !!projRow && projRow.oldValue === '' && projRow.newValue === project.name;
    record('Gate 6: updateTask() changes the project link, audited by human label, and ignores a `department` field',
      pass, JSON.stringify({ projectId: after.projectId, departmentId: after.departmentId, deptRow, projRow }));
  }

  // ── Gate 7 — updateTask() preserves the legacy source column when the
  //             caller's payload omits it entirely (the New/Edit Task modal's
  //             actual payload shape — it manages sources via task_sources and
  //             never sends a `source` key at all) ────────────────────────────
  {
    const t = db.createTask(userId, { name: 'Legacy-source task', status: 'OPEN', source: 'LEGACY-JIRA-ABC-1' });
    // The exact shape submitBacklogModal's payload takes — no `source` key.
    db.updateTask(userId, t.id, { name: t.name, status: 'IN_PROGRESS', company: '', system: '' });
    const after = db.getTask(userId, t.id);
    record('Gate 7: updateTask() with no source key in the payload leaves the legacy source column unchanged',
      after.source === 'LEGACY-JIRA-ABC-1' && after.status === 'IN_PROGRESS',
      `source=${after.source} status=${after.status}`);
  }

  // ── Gate 8 — updateTaskMeta() has the same belt-and-braces guard, on an
  //             INTERNAL task ───────────────────────────────────────────────
  {
    const t = db.createInternalTask(userId, { name: 'Legacy-source meta task', status: 'OPEN', department: dept.label, source: 'LEGACY-EMAIL-SUBJECT' });
    // No `source` key at all (distinct from the reconciler's real payload,
    // which always sends one — this exercises the defense-in-depth guard for
    // any other/future caller that omits it).
    db.updateTaskMeta(userId, t.id, { name: t.name, status: 'BLOCKED' });
    const after = db.getTask(userId, t.id);
    record('Gate 8: updateTaskMeta() with no source key in the payload leaves the legacy source column unchanged',
      after.source === 'LEGACY-EMAIL-SUBJECT' && after.status === 'BLOCKED' && after.departmentId === dept.id,
      `source=${after.source} status=${after.status} departmentId=${after.departmentId}`);
  }

} catch (err) {
  console.error('\nTEST HARNESS ERROR: ' + (err && err.stack || err));
  exitCode = 2;
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n════════════════════ TASK-LINK-PRESERVATION SMOKE RESULTS ════════════════════');
let failed = 0;
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  if (!r.pass) failed++;
  console.log(`[${tag}] ${r.flow}\n        ${r.details}`);
}
console.log('──────────────────────────────────────────────────────────────────────');
console.log(`${results.length - failed}/${results.length} flows passed` + (failed ? `  (${failed} FAILED)` : '  — all green'));
if (failed > 0 && exitCode === 0) exitCode = 1;
process.exit(exitCode);
