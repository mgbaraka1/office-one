// ─────────────────────────────────────────────────────────────────────────────
// Task & session workflow overhaul (Milestone 1) — headless data-layer smoke test.
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron, no IPC, no renderer
// — and drives the exact db.* calls the new Milestone-1 renderer flows make:
//   - Task Detail's "+ Add Session" (compact create-mode modal)
//   - Task Detail's "Merge into another task…" (+ its undo)
//   - the new worklogs:history / db.getWorkLogHistory surface
//
// SAFETY: never touches production. Copies the live DB into a throwaway temp
// dir and runs everything there; the temp dir is deleted at the end.
//
// Run:  node test/task-sessions-smoke.js
//
// Flows exercised:
//   1. Add Session (Task Detail) — session lands on the requested date/task,
//      task metadata is never mutated.
//   2. Merge — every session moves from source to target, source is deleted,
//      target's own fields (name/status/company/system/source/projectId) are
//      untouched, and one work_log_history "Task" entry is recorded per moved
//      session (mirroring moveWorkLog's own convention).
//   3. Merge undo (simulated the way the renderer does it: recreate the source
//      task, then worklogs:move each moved id back onto it) restores the
//      source's session count and leaves the target with only its original
//      sessions again.
//   4. worklogs:history (db.getWorkLogHistory) returns rows, newest first,
//      after a genuine field edit via updateWorkLog.
//   5. Milestone 10's auto-status transition — addWorkLog() advances an OPEN
//      task to IN_PROGRESS, never touches BLOCKED/DONE, and is a no-op on an
//      already-IN_PROGRESS task.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const db = require('../db');

const DAY_A = '2098-03-10';
const DAY_B = '2098-04-11';

const results = [];
function record(flow, pass, details) { results.push({ flow, pass, details }); }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function taskMeta(t) {
  return { name: t.name, status: t.status, company: t.company, system: t.system,
           source: t.source, projectId: t.projectId };
}

const prodDir = path.join(os.homedir(), 'AppData', 'Roaming', 'timesheet');
const prodDb  = path.join(prodDir, 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: production DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
console.log('Working copy: ' + path.join(workDir, 'cooperation-tools.db'));

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

  const naturalLabel = db.getLookupsByCategory('ACTIVITY_TYPE')[0]?.label || '';

  const newTaskPayload = (name, status) => ({
    name, status: status || 'OPEN', company: '', system: '', source: 'ts-smoke-test', projectId: null,
  });

  // ── FLOW 1 — Add Session (Task Detail's compact create-mode modal) ──────────
  let sessionTaskId, sessionTaskMeta;
  {
    const t = db.createTask(userId, newTaskPayload('TS flow1 add-session target'));
    const first = db.addWorkLog(userId, t.id, { date: DAY_A, description: 'flow1 first session', minutes: 30, time: 'WORK_TIME', natural: naturalLabel });
    const before = taskMeta(db.getTask(userId, t.id));
    // The Add Session modal only ever calls worklogs:add against the fixed task —
    // never touches the task itself.
    const second = db.addWorkLog(userId, t.id, { date: DAY_B, description: 'flow1 added via Task Detail', minutes: 25, time: 'WORK_TIME', natural: naturalLabel });
    const after = db.getTask(userId, t.id);
    const metaUnchanged = eq(before, taskMeta(after));
    const added = after.workLogs.find(w => w.date === DAY_B && w.description === 'flow1 added via Task Detail');
    const pass = first.ok && second.ok && after.logCount === 2 && metaUnchanged && !!added;
    record('1. Add Session from Task Detail lands on the right task/date, metadata untouched', pass,
      `taskId=${t.id} logCount=${after.logCount} metaUnchanged=${metaUnchanged} landedOn=${added ? added.date : 'MISSING'}`);
    sessionTaskId = t.id;
    sessionTaskMeta = taskMeta(after);
  }

  // ── FLOW 2 — Merge: source's sessions move onto target; target untouched ────
  let mergeSourceId, mergeTargetId, movedIds, sourceSnapshotForUndo;
  {
    const source = db.createTask(userId, newTaskPayload('TS merge source', 'OPEN'));
    db.addWorkLog(userId, source.id, { date: DAY_A, description: 'src session 1', minutes: 15, time: 'WORK_TIME', natural: naturalLabel });
    db.addWorkLog(userId, source.id, { date: DAY_B, description: 'src session 2', minutes: 22, time: 'OVERTIME', natural: naturalLabel });
    const sourceBefore = db.getTask(userId, source.id);
    sourceSnapshotForUndo = taskMeta(sourceBefore);

    const target = db.createTask(userId, newTaskPayload('TS merge target', 'IN_PROGRESS'));
    db.addWorkLog(userId, target.id, { date: DAY_A, description: 'tgt session 1', minutes: 40, time: 'WORK_TIME', natural: naturalLabel });
    const targetBefore = taskMeta(db.getTask(userId, target.id));

    const res = db.mergeTasks(userId, source.id, target.id);
    const sourceGone = db.getTask(userId, source.id) === null;
    const targetAfter = db.getTask(userId, target.id);
    const targetMetaUnchanged = eq(targetBefore, taskMeta(targetAfter));
    const allDescriptions = (targetAfter.workLogs || []).map(w => w.description).sort();
    const expectedDescriptions = ['src session 1', 'src session 2', 'tgt session 1'].sort();
    const historyRows = res.movedWorkLogIds ? res.movedWorkLogIds.map(id => db.getWorkLogHistory(userId, id)) : [];
    const eachMoveHasTaskHistory = historyRows.every(rows => rows.some(r => r.fieldName === 'Task'));

    const pass = res.ok && sourceGone && targetMetaUnchanged
              && targetAfter.logCount === 3 && eq(allDescriptions, expectedDescriptions)
              && res.movedWorkLogIds && res.movedWorkLogIds.length === 2 && eachMoveHasTaskHistory;
    record('2. Merge moves all sessions onto target, deletes source, target metadata untouched', pass,
      `sourceGone=${sourceGone} targetLogCount=${targetAfter.logCount} targetMetaUnchanged=${targetMetaUnchanged} movedCount=${res.movedWorkLogIds && res.movedWorkLogIds.length} historyRecorded=${eachMoveHasTaskHistory}`);

    mergeSourceId = source.id;
    mergeTargetId = target.id;
    movedIds = res.movedWorkLogIds || [];
  }

  // ── FLOW 3 — Merge undo: recreate source, move the same work_logs back ──────
  {
    const restored = db.createTask(userId, sourceSnapshotForUndo);
    movedIds.forEach(id => db.moveWorkLog(userId, id, restored.id));
    const restoredAfter = db.getTask(userId, restored.id);
    const targetAfter = db.getTask(userId, mergeTargetId);
    const restoredDescriptions = (restoredAfter.workLogs || []).map(w => w.description).sort();
    const pass = restoredAfter.logCount === 2 && eq(restoredDescriptions, ['src session 1', 'src session 2'])
              && targetAfter.logCount === 1 && targetAfter.workLogs[0].description === 'tgt session 1';
    record('3. Merge undo restores the source task and moves its sessions back', pass,
      `restoredLogCount=${restoredAfter.logCount} targetLogCountAfterUndo=${targetAfter.logCount}`);
  }

  // ── FLOW 4 — worklogs:history (db.getWorkLogHistory) surfaces edits ──────────
  {
    const t = db.createTask(userId, newTaskPayload('TS history test'));
    const added = db.addWorkLog(userId, t.id, { date: DAY_A, description: 'before edit', minutes: 10, time: 'WORK_TIME', natural: naturalLabel });
    const beforeHistory = db.getWorkLogHistory(userId, added.id);
    db.updateWorkLog(userId, added.id, { date: DAY_A, description: 'after edit', minutes: 50, time: 'WORK_TIME', natural: naturalLabel });
    const afterHistory = db.getWorkLogHistory(userId, added.id);
    const minutesRow = afterHistory.find(r => r.fieldName === 'Minutes');
    const descRow = afterHistory.find(r => r.fieldName === 'Description');
    const pass = beforeHistory.length === 0 && afterHistory.length >= 2
              && !!minutesRow && minutesRow.oldValue === '10' && minutesRow.newValue === '50'
              && !!descRow && descRow.oldValue === 'before edit' && descRow.newValue === 'after edit';
    record('4. worklogs:history returns rows after a genuine edit', pass,
      `beforeCount=${beforeHistory.length} afterCount=${afterHistory.length} minutes=${minutesRow ? minutesRow.oldValue + '->' + minutesRow.newValue : 'MISSING'}`);
  }

  // ── FLOW 5 — auto-status transition (Milestone 10) ───────────────────────────
  // Logging a session against an OPEN task advances it to IN_PROGRESS
  // automatically; BLOCKED/DONE tasks are never touched by the same call.
  {
    const openTask = db.createTask(userId, newTaskPayload('TS auto-status OPEN task', 'OPEN'));
    db.addWorkLog(userId, openTask.id, { date: DAY_A, description: 'first session ever', minutes: 20, time: 'WORK_TIME', natural: naturalLabel });
    const openAfter = db.getTask(userId, openTask.id);
    record('5a. Logging a session against an OPEN task auto-advances it to IN_PROGRESS',
      openAfter.status === 'IN_PROGRESS', `status=${openAfter.status}`);

    const blockedTask = db.createTask(userId, newTaskPayload('TS auto-status BLOCKED task', 'BLOCKED'));
    db.addWorkLog(userId, blockedTask.id, { date: DAY_A, description: 'session on a blocked task', minutes: 15, time: 'WORK_TIME', natural: naturalLabel });
    const blockedAfter = db.getTask(userId, blockedTask.id);
    record('5b. Logging a session against a BLOCKED task leaves its status untouched',
      blockedAfter.status === 'BLOCKED', `status=${blockedAfter.status}`);

    const doneTask = db.createTask(userId, newTaskPayload('TS auto-status DONE task', 'DONE'));
    db.addWorkLog(userId, doneTask.id, { date: DAY_A, description: 'session on a done task', minutes: 10, time: 'WORK_TIME', natural: naturalLabel });
    const doneAfter = db.getTask(userId, doneTask.id);
    record('5c. Logging a session against a DONE task leaves its status untouched',
      doneAfter.status === 'DONE', `status=${doneAfter.status}`);

    const inProgressTask = db.createTask(userId, newTaskPayload('TS auto-status IN_PROGRESS task', 'IN_PROGRESS'));
    db.addWorkLog(userId, inProgressTask.id, { date: DAY_A, description: 'another session', minutes: 12, time: 'WORK_TIME', natural: naturalLabel });
    const inProgressAfter = db.getTask(userId, inProgressTask.id);
    record('5d. Logging a session against an already-IN_PROGRESS task is a no-op status-wise',
      inProgressAfter.status === 'IN_PROGRESS', `status=${inProgressAfter.status}`);
  }

} catch (err) {
  console.error('\nTEST HARNESS ERROR: ' + (err && err.stack || err));
  exitCode = 2;
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n════════════════════ TASK-SESSIONS SMOKE RESULTS ════════════════════');
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
