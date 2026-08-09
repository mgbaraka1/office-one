// ─────────────────────────────────────────────────────────────────────────────
// Client / Internal task domain separation — headless data-layer smoke test.
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron, no IPC, no
// renderer. Copies the live DB into a throwaway temp dir and runs there.
//
// Run:  node test/task-separation-smoke.js
//
// Background: this test used to cover Milestone 9's Project/Department mutual
// exclusivity (a task could carry at most one of projectId/department, linked
// or unlinked via linkTask/linkDepartmentTask). The 2026-08 domain separation
// went further: Client work and Internal (department) work are now two
// entirely separate domains with their own API surface (tasks:* vs internal:*)
// — a task can no longer be cross-linked between them at all, only explicitly
// *converted*. linkDepartmentTask/unlinkDepartmentTask/listLinkableTasksForDept
// are gone; this file now exercises the replacement shape end to end.
//
// Gates exercised:
//   1. createTask() (client) silently ignores a `department` in the payload —
//      the result is a client task with department_id NULL.
//   2. createInternalTask() silently ignores company/system/projectId in the
//      payload — the result is internal, with all three NULL.
//   3. createInternalTask() with no resolvable department throws.
//   4. updateTask() (client-only) throws when called on an existing internal
//      task — it must go through updateInternalTask or convertTaskToClient.
//   5. updateInternalTask() throws when called on an existing client task.
//   6. updateTaskMeta() — the Timesheet autosave path — on an internal task
//      with a non-empty `company` in the payload leaves company_id/system_id
//      NULL. This is the single highest-risk regression the plan calls out:
//      without this guard, every autosave of a day containing internal work
//      would silently re-attach a client company to it.
//   7. convertTaskToInternal() clears company/system/project, sets the
//      department, and writes task_field_history rows (including a `Kind`
//      row) for every field that changed.
//   8. convertTaskToInternal() with no department returns {ok:false} and
//      leaves the row untouched.
//   9. convertTaskToClient() is the mirror of gate 7/8 (requires company AND
//      system; clears department/project).
//  10. listTasks() (tasks:list) returns CLIENT tasks only.
//  11. listInternalTasks() (internal:list) returns INTERNAL tasks only.
//  12. getTasksIndex() (tasks:index — pickers/palette) is NOT filtered by
//      domain; both a client and an internal task appear in it.
//  13. listLinkableTasks() (Projects' "Link Task" picker) excludes internal
//      tasks — a client Project can never fold in internal work.
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
  raw.close();
  if (!userRow) throw new Error('no active user in the copied DB');
  const userId = userRow.id;
  console.log('Using userId=' + userId + '\n');

  const project = db.createProject(userId, {
    name: 'Task-sep smoke project', description: '', companyIds: [], systemIds: [],
    status: 'ACTIVE', category: 'NEW_PROJECT',
  });
  const companies = db.loadLookups(userId).categories.COMPANY;
  const systems = db.loadLookups(userId).categories.SYSTEM;
  const dept = db.loadLookups(userId).categories.DEPARTMENT.find(d => d.isActive) || db.loadLookups(userId).categories.DEPARTMENT[0];
  const company = companies[0], system = systems[0];
  if (!dept) throw new Error('no DEPARTMENT lookup codes in this copy');
  if (!company || !system) throw new Error('no COMPANY/SYSTEM lookup codes in this copy');

  // ── Gate 1 — createTask() (client) ignores a `department` payload field ──
  const clientTask = db.createTask(userId, {
    name: 'Client task', status: 'OPEN', company: company.label, system: system.label, department: dept.label,
  });
  record('Gate 1: createTask() ignores `department` — result is client, department NULL',
    clientTask.kind === 'CLIENT' && clientTask.departmentId === null && clientTask.company === company.label,
    JSON.stringify({ kind: clientTask.kind, departmentId: clientTask.departmentId, company: clientTask.company }));

  // ── Gate 2 — createInternalTask() ignores company/system/projectId ──────
  const internalTask = db.createInternalTask(userId, {
    name: 'Internal task', status: 'OPEN', department: dept.label,
    company: company.label, system: system.label, projectId: project.id,
  });
  record('Gate 2: createInternalTask() ignores company/system/projectId — result is internal, all three NULL',
    internalTask.kind === 'INTERNAL' && internalTask.departmentId === dept.id
      && internalTask.company === '' && internalTask.system === '' && internalTask.projectId === null,
    JSON.stringify({ kind: internalTask.kind, departmentId: internalTask.departmentId, company: internalTask.company, system: internalTask.system, projectId: internalTask.projectId }));

  // ── Gate 3 — createInternalTask() with no department throws ─────────────
  let noDeptThrew = false;
  try { db.createInternalTask(userId, { name: 'No department', status: 'OPEN' }); }
  catch { noDeptThrew = true; }
  record('Gate 3: createInternalTask() with no resolvable department throws', noDeptThrew, 'threw=' + noDeptThrew);

  // ── Gate 4 — updateTask() throws on an internal task ────────────────────
  let updateTaskOnInternalThrew = false;
  try { db.updateTask(userId, internalTask.id, { name: 'x', status: 'OPEN', company: company.label, system: system.label }); }
  catch { updateTaskOnInternalThrew = true; }
  record('Gate 4: updateTask() (client-only) throws when called on an internal task', updateTaskOnInternalThrew, 'threw=' + updateTaskOnInternalThrew);

  // ── Gate 5 — updateInternalTask() throws on a client task ───────────────
  let updateInternalOnClientThrew = false;
  try { db.updateInternalTask(userId, clientTask.id, { name: 'x', status: 'OPEN', department: dept.label }); }
  catch { updateInternalOnClientThrew = true; }
  record('Gate 5: updateInternalTask() throws when called on a client task', updateInternalOnClientThrew, 'threw=' + updateInternalOnClientThrew);

  // ── Gate 6 — updateTaskMeta() autosave guard (the critical one) ─────────
  const metaResult = db.updateTaskMeta(userId, internalTask.id, {
    name: internalTask.name, status: 'IN_PROGRESS', company: company.label, system: system.label, source: '',
  });
  record('Gate 6: updateTaskMeta() on an internal task never writes company/system, even when the payload carries them',
    metaResult.company === '' && metaResult.system === '' && metaResult.kind === 'INTERNAL' && metaResult.departmentId === dept.id,
    JSON.stringify({ company: metaResult.company, system: metaResult.system, kind: metaResult.kind, departmentId: metaResult.departmentId }));

  // ── Gate 7 — convertTaskToInternal() clears fields + writes history ─────
  const toConvert = db.createTask(userId, { name: 'Convert me', status: 'OPEN', company: company.label, system: system.label, projectId: project.id });
  const historyBefore = db.getTaskFieldHistory(userId, toConvert.id).length;
  const convertRes = db.convertTaskToInternal(userId, toConvert.id, { department: dept.label });
  const historyAfter = db.getTaskFieldHistory(userId, toConvert.id);
  const kindRow = historyAfter.find(h => h.fieldName === 'Kind');
  record('Gate 7: convertTaskToInternal() clears company/system/project, sets department, writes history incl. Kind',
    convertRes.ok === true && convertRes.task.kind === 'INTERNAL' && convertRes.task.company === '' && convertRes.task.system === ''
      && convertRes.task.projectId === null && convertRes.task.departmentId === dept.id
      && historyAfter.length > historyBefore && !!kindRow && kindRow.oldValue === 'Client' && kindRow.newValue === 'Internal',
    JSON.stringify({ convertRes, historyBefore, historyAfterCount: historyAfter.length, kindRow }));

  // ── Gate 8 — convertTaskToInternal() with no department rejects, no write ──
  const beforeBadConvert = db.getTask(userId, clientTask.id);
  const badConvert = db.convertTaskToInternal(userId, clientTask.id, {});
  const afterBadConvert = db.getTask(userId, clientTask.id);
  record('Gate 8: convertTaskToInternal() with no department returns {ok:false}, row untouched',
    badConvert.ok === false && afterBadConvert.kind === 'CLIENT' && afterBadConvert.company === beforeBadConvert.company,
    JSON.stringify({ badConvert, before: beforeBadConvert.kind, after: afterBadConvert.kind }));

  // ── Gate 9 — convertTaskToClient() is the mirror ────────────────────────
  const convertBackRes = db.convertTaskToClient(userId, toConvert.id, { company: company.label, system: system.label });
  const convertBackMissing = db.convertTaskToClient(userId, internalTask.id, { company: company.label }); // no system
  record('Gate 9: convertTaskToClient() succeeds with company+system, rejects with only company',
    convertBackRes.ok === true && convertBackRes.task.kind === 'CLIENT' && convertBackRes.task.departmentId === null
      && convertBackMissing.ok === false,
    JSON.stringify({ convertBackRes: { ok: convertBackRes.ok, kind: convertBackRes.task?.kind }, convertBackMissing }));

  // ── Gate 10/11 — listTasks()/listInternalTasks() partition by domain ────
  const clientList = db.listTasks(userId);
  const internalList = db.listInternalTasks(userId);
  record('Gate 10: listTasks() returns CLIENT tasks only',
    clientList.every(t => t.kind === 'CLIENT') && clientList.some(t => t.id === clientTask.id) && !clientList.some(t => t.id === internalTask.id),
    'count=' + clientList.length + ' allClient=' + clientList.every(t => t.kind === 'CLIENT'));
  record('Gate 11: listInternalTasks() returns INTERNAL tasks only',
    internalList.every(t => t.kind === 'INTERNAL') && internalList.some(t => t.id === internalTask.id) && !internalList.some(t => t.id === clientTask.id),
    'count=' + internalList.length + ' allInternal=' + internalList.every(t => t.kind === 'INTERNAL'));

  // ── Gate 12 — getTasksIndex() (pickers) is unfiltered by domain ─────────
  const index = db.getTasksIndex(userId);
  record('Gate 12: getTasksIndex() (pickers/palette) offers both domains',
    index.some(t => t.id === clientTask.id) && index.some(t => t.id === internalTask.id),
    JSON.stringify({ hasClient: index.some(t => t.id === clientTask.id), hasInternal: index.some(t => t.id === internalTask.id) }));

  // ── Gate 13 — listLinkableTasks() excludes internal tasks ───────────────
  const linkable = db.listLinkableTasks(userId);
  record('Gate 13: listLinkableTasks() (Projects\' Link Task picker) excludes internal tasks',
    !linkable.some(t => t.id === internalTask.id),
    'excluded=' + !linkable.some(t => t.id === internalTask.id));

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
