// ─────────────────────────────────────────────────────────────────────────────
// Internal/Project task separation — headless data-layer smoke test (Milestone 9).
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron, no IPC, no
// renderer. Copies the live DB into a throwaway temp dir and runs there.
//
// Run:  node test/task-separation-smoke.js
//
// Background: a data audit against a copy of production found ZERO tasks with
// both project_id AND department_id set (out of 322 total) — so there was no
// conflicting real data to resolve, and no migration was needed for this
// milestone (see ROADMAP.md's Milestone 9 write-up). This test instead covers
// the exclusivity rule going forward, at every write path that can set either
// field.
//
// Gates exercised:
//   1. createTask() with both a projectId and a department throws.
//   2. createTask() with only a projectId, or only a department, succeeds.
//   3. updateTask() that would leave a task linked to both throws, and the
//      task's stored fields are unchanged after the throw (no partial write).
//   4. linkTask() (Project link) rejects a task that already has a
//      department_id set, with {ok:false}, and does not touch the row.
//   5. linkDepartmentTask() rejects a task that already has a project_id set,
//      with {ok:false}, and does not touch the row.
//   6. listLinkableTasks() (Projects' "Link Task" picker) excludes
//      department-linked tasks.
//   7. listLinkableTasksForDepartment() excludes project-linked tasks.
//   8. A task with neither link appears in both linkable-task lists.
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
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-sep-smoke-'));
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
  const dualLinked = raw.prepare('SELECT COUNT(*) c FROM tasks WHERE project_id IS NOT NULL AND department_id IS NOT NULL').get().c;
  raw.close();
  if (!userRow) throw new Error('no active user in the copied DB');
  const userId = userRow.id;
  console.log('Using userId=' + userId + '; dual-linked tasks in this copy: ' + dualLinked + '\n');

  const project = db.createProject(userId, {
    name: 'Task-sep smoke project', description: '', companyIds: [], systemIds: [],
    status: 'ACTIVE', category: 'NEW_PROJECT',
  });
  const dept = db.getLookupsByCategory('DEPARTMENT')[0];
  if (!dept) throw new Error('no DEPARTMENT lookup codes in this copy');

  // ── Gate 1/2 — createTask() ──────────────────────────────────────────────
  let createBothThrew = false;
  try { db.createTask(userId, { name: 'Both linked', status: 'OPEN', projectId: project.id, department: dept.label }); }
  catch { createBothThrew = true; }
  record('Gate 1: createTask() with both projectId and department throws', createBothThrew, 'threw=' + createBothThrew);

  const projectOnlyTask = db.createTask(userId, { name: 'Project-only task', status: 'OPEN', projectId: project.id });
  const deptOnlyTask = db.createTask(userId, { name: 'Department-only task', status: 'OPEN', department: dept.label });
  record('Gate 2: createTask() with only projectId or only department succeeds',
    projectOnlyTask.projectId === project.id && deptOnlyTask.departmentId === dept.id,
    JSON.stringify({ projectOnlyTask: projectOnlyTask.projectId, deptOnlyTask: deptOnlyTask.departmentId }));

  // ── Gate 3 — updateTask() ────────────────────────────────────────────────
  const beforeUpdate = db.getTask(userId, deptOnlyTask.id);
  let updateBothThrew = false;
  try { db.updateTask(userId, deptOnlyTask.id, { name: deptOnlyTask.name, status: 'OPEN', department: dept.label, projectId: project.id }); }
  catch { updateBothThrew = true; }
  const afterUpdate = db.getTask(userId, deptOnlyTask.id);
  record('Gate 3: updateTask() that would set both throws, and the row is unchanged after (no partial write)',
    updateBothThrew && afterUpdate.projectId === null && afterUpdate.departmentId === beforeUpdate.departmentId,
    JSON.stringify({ threw: updateBothThrew, before: beforeUpdate, after: afterUpdate }));

  // ── Gate 4 — linkTask() rejects a department-linked task ────────────────
  const linkRes = db.linkTask(userId, project.id, deptOnlyTask.id);
  const deptTaskAfterLinkAttempt = db.getTask(userId, deptOnlyTask.id);
  record('Gate 4: linkTask() rejects a task already linked to a Department, row untouched',
    linkRes.ok === false && deptTaskAfterLinkAttempt.projectId === null && deptTaskAfterLinkAttempt.departmentId === dept.id,
    JSON.stringify({ linkRes, task: deptTaskAfterLinkAttempt }));

  // ── Gate 5 — linkDepartmentTask() rejects a project-linked task ─────────
  const linkDeptRes = db.linkDepartmentTask(userId, projectOnlyTask.id, dept.id);
  const projTaskAfterLinkAttempt = db.getTask(userId, projectOnlyTask.id);
  record('Gate 5: linkDepartmentTask() rejects a task already linked to a Project, row untouched',
    linkDeptRes.ok === false && projTaskAfterLinkAttempt.departmentId === null && projTaskAfterLinkAttempt.projectId === project.id,
    JSON.stringify({ linkDeptRes, task: projTaskAfterLinkAttempt }));

  // ── Gate 6/7/8 — the two linkable-task pickers stop cross-offering ──────
  const unlinkedTask = db.createTask(userId, { name: 'Fully unlinked task', status: 'OPEN' });
  const linkable = db.listLinkableTasks(userId);
  const linkableForDept = db.listLinkableTasksForDepartment(userId);
  record('Gate 6: listLinkableTasks() excludes the department-linked task',
    !linkable.some(t => t.id === deptOnlyTask.id), 'excluded=' + !linkable.some(t => t.id === deptOnlyTask.id));
  record('Gate 7: listLinkableTasksForDepartment() excludes the project-linked task',
    !linkableForDept.some(t => t.id === projectOnlyTask.id), 'excluded=' + !linkableForDept.some(t => t.id === projectOnlyTask.id));
  record('Gate 8: a task with neither link appears in both linkable-task lists',
    linkable.some(t => t.id === unlinkedTask.id) && linkableForDept.some(t => t.id === unlinkedTask.id),
    JSON.stringify({ inProjectPicker: linkable.some(t => t.id === unlinkedTask.id), inDeptPicker: linkableForDept.some(t => t.id === unlinkedTask.id) }));

} catch (err) {
  console.error('\nTEST HARNESS ERROR: ' + (err && err.stack || err));
  exitCode = 2;
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n════════════════════ TASK SEPARATION SMOKE RESULTS ════════════════════');
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
