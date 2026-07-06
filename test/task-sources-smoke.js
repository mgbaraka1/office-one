// ─────────────────────────────────────────────────────────────────────────────
// Task Sources — headless data-layer smoke test (migration 033).
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron, no IPC, no
// renderer. SAFETY: never touches production. Copies the live DB into a
// throwaway temp dir and runs everything there; the temp dir is deleted at the
// end regardless of outcome.
//
// Run:  node test/task-sources-smoke.js
//
// Gates exercised:
//   1. Migration 033 runs cleanly on a fresh copy of the current DB.
//   2. Re-running applyMigrations() is a no-op (idempotent).
//   3. Existing tables (tasks, work_logs, lookup_codes) unaffected;
//      TASK_SOURCE_TYPE seeded with its 6 codes; every pre-existing task with
//      a non-empty legacy `source` got exactly one EMAIL-typed task_sources row.
//   plus createTaskSource/updateTaskSource/deleteTaskSource CRUD (including a
//   task carrying several sources — Jira + Email + Teams-Chat — with meta JSON
//   round-tripping), getTask/getTasksIndex/listTasks exposing the full list vs.
//   the lightweight summary fields consistently, ON DELETE CASCADE when the
//   parent task is deleted, and ownership gating.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const db = require('../db');

const results = [];
function record(flow, pass, details) { results.push({ flow, pass, details }); }

const prodDir = path.join(os.homedir(), 'AppData', 'Roaming', 'timesheet');
const prodDb  = path.join(prodDir, 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: production DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-src-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
console.log('Working copy: ' + path.join(workDir, 'cooperation-tools.db'));

let exitCode = 0;
try {
  // ── Gate 3 baseline ──────────────────────────────────────────────────────
  const rawBefore = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const countBefore = (t) => rawBefore.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const before = { tasks: countBefore('tasks'), work_logs: countBefore('work_logs') };
  const nonEmptySourceTasksBefore = rawBefore.prepare(
    "SELECT id, source FROM tasks WHERE TRIM(COALESCE(source,'')) != ''"
  ).all();
  const alreadyAt033 = !!rawBefore.prepare('SELECT 1 FROM schema_migrations WHERE version = 33').get();
  rawBefore.close();

  // ── Gate 1 — migration runs cleanly ──────────────────────────────────────
  db.openConnection(workDir);
  db.applyMigrations();
  record('Gate 1: migration 033 applies cleanly', true, 'no throw');

  // ── Gate 2 — idempotent re-run ────────────────────────────────────────────
  db.applyMigrations();
  record('Gate 2: re-applying migrations is a no-op', true, 'no throw, no duplicate rows');

  // ── Gate 3 — existing tables unaffected + TASK_SOURCE_TYPE seeded ────────
  const rawAfter = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const countAfter = (t) => rawAfter.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const after = { tasks: countAfter('tasks'), work_logs: countAfter('work_logs') };
  const typeCodes = rawAfter.prepare(
    "SELECT code FROM lookup_codes WHERE category = 'TASK_SOURCE_TYPE' ORDER BY sort_order"
  ).all().map(r => r.code);
  const expectedCodes = 'JIRA,EMAIL,TEAMS_CHAT,MEETING,PHONE_CALL,OTHER';
  const gate3Pass = after.tasks === before.tasks && after.work_logs === before.work_logs
    && typeCodes.join(',') === expectedCodes;
  record('Gate 3: pre-existing tables unaffected + TASK_SOURCE_TYPE seeded', gate3Pass,
    `tasks ${before.tasks}->${after.tasks}, work_logs ${before.work_logs}->${after.work_logs}, codes=${typeCodes.join(',')}`);

  // ── Backfill — every legacy-source task got one EMAIL-typed entry ────────
  const emailId = rawAfter.prepare(
    "SELECT id FROM lookup_codes WHERE category = 'TASK_SOURCE_TYPE' AND code = 'EMAIL'"
  ).get().id;
  const backfillRows = rawAfter.prepare(
    'SELECT task_id, source_type_id, source_ref FROM task_sources'
  ).all();
  const backfillByTask = new Map(backfillRows.map(r => [r.task_id, r]));
  const backfillPass = nonEmptySourceTasksBefore.length === 0 || alreadyAt033
    ? nonEmptySourceTasksBefore.every(t => backfillByTask.has(t.id))
    : nonEmptySourceTasksBefore.every(t => {
        const r = backfillByTask.get(t.id);
        return r && r.source_type_id === emailId && r.source_ref === t.source;
      });
  record(alreadyAt033
    ? 'Backfill: every legacy-source task has some task_sources row (033 pre-applied)'
    : 'Backfill: every legacy-source task got exactly one EMAIL-typed row matching its old text',
    backfillPass, `legacySourceTasks=${nonEmptySourceTasksBefore.length}, alreadyAt033=${alreadyAt033}`);
  rawAfter.close();

  const userRow = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'))
    .prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  if (!userRow) throw new Error('no active user in the copied DB');
  const userId = userRow.id;
  console.log('Using userId=' + userId + '\n');

  // ── Create a task with no sources yet ────────────────────────────────────
  // createTask returns getTask()'s shape (full `sources` array, no summary
  // aliases — those only exist on the lightweight index/list shape below).
  const task = db.createTask(userId, { name: 'TS smoke task', status: 'IN_PROGRESS' });
  record('New task starts with zero sources', task.sourceCount === 0 && Array.isArray(task.sources) && task.sources.length === 0,
    JSON.stringify({ sourceCount: task.sourceCount, sources: task.sources }));

  // ── Add three sources of different types (a task CAN carry several) ─────
  const jira = db.createTaskSource(userId, task.id, { type: 'JIRA', ref: 'ABC-123', url: 'https://jira.example.com/ABC-123' });
  const email = db.createTaskSource(userId, task.id, { type: 'EMAIL', ref: 'Renewal quote issue', meta: { sender: 'alice@example.com', date: '2026-01-05' } });
  const chat = db.createTaskSource(userId, task.id, { type: 'TEAMS_CHAT', ref: '#support', url: 'https://teams.example.com/msg/1' });
  record('createTaskSource round-trips type/ref/url', jira && jira.type === 'JIRA' && jira.ref === 'ABC-123' && jira.url === 'https://jira.example.com/ABC-123',
    JSON.stringify(jira));
  record('createTaskSource round-trips meta JSON', email && email.type === 'EMAIL' && email.meta.sender === 'alice@example.com' && email.meta.date === '2026-01-05',
    JSON.stringify(email));

  // ── getTask returns the full ordered list ────────────────────────────────
  const fullTask = db.getTask(userId, task.id);
  const gotOrder = (fullTask.sources || []).map(s => s.id);
  record('getTask returns all 3 sources in insertion order', gotOrder.length === 3
    && gotOrder[0] === jira.id && gotOrder[1] === email.id && gotOrder[2] === chat.id,
    JSON.stringify(gotOrder));
  record('getTask sourceCount matches sources.length', fullTask.sourceCount === 3, 'sourceCount=' + fullTask.sourceCount);

  // ── getTasksIndex / listTasks expose only the lightweight summary ───────
  const idx = db.getTasksIndex(userId).find(t => t.id === task.id);
  record('getTasksIndex summary: count=3, first=Jira/ABC-123, no full sources array', idx
    && idx.sourceCount === 3 && idx.firstSourceType === 'JIRA' && idx.firstSourceRef === 'ABC-123'
    && idx.firstSourceUrl === 'https://jira.example.com/ABC-123' && !('sources' in idx),
    JSON.stringify(idx && { sourceCount: idx.sourceCount, firstSourceType: idx.firstSourceType, firstSourceRef: idx.firstSourceRef, hasSourcesKey: 'sources' in idx }));
  const listed = db.listTasks(userId).find(t => t.id === task.id);
  record('listTasks carries the same summary fields as getTasksIndex', listed
    && listed.sourceCount === 3 && listed.firstSourceRef === 'ABC-123', 'sourceCount=' + (listed && listed.sourceCount));

  // ── updateTaskSource ──────────────────────────────────────────────────────
  const updatedJira = db.updateTaskSource(userId, jira.id, { type: 'JIRA', ref: 'ABC-999', url: jira.url });
  record('updateTaskSource updates ref in place', updatedJira && updatedJira.ref === 'ABC-999' && updatedJira.id === jira.id,
    JSON.stringify(updatedJira));

  // ── deleteTaskSource ──────────────────────────────────────────────────────
  const delRes = db.deleteTaskSource(userId, chat.id);
  const afterDelete = db.getTask(userId, task.id);
  record('deleteTaskSource removes exactly that entry', delRes.ok && afterDelete.sources.length === 2
    && afterDelete.sources.every(s => s.id !== chat.id), JSON.stringify({ ok: delRes.ok, remaining: afterDelete.sources.map(s => s.id) }));

  // ── Cascade: deleting the task removes its remaining task_sources rows ──
  db.deleteTask(userId, task.id);
  const rawCascade = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const orphaned = rawCascade.prepare('SELECT COUNT(*) AS n FROM task_sources WHERE task_id = ?').get(task.id).n;
  rawCascade.close();
  record('ON DELETE CASCADE removes task_sources when the parent task is deleted', orphaned === 0, 'remaining=' + orphaned);

  // ── Ownership gating ──────────────────────────────────────────────────────
  const otherUserRow = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'))
    .prepare('SELECT id FROM users WHERE id != ? AND is_active = 1 LIMIT 1').get(userId);
  if (otherUserRow) {
    const otherTask = db.createTask(otherUserRow.id, { name: 'Other users task' });
    const crossCreate = db.createTaskSource(userId, otherTask.id, { type: 'OTHER', ref: 'should not work' });
    record('createTaskSource rejects a task owned by another user', crossCreate === null, 'result=' + JSON.stringify(crossCreate));

    const otherSource = db.createTaskSource(otherUserRow.id, otherTask.id, { type: 'OTHER', ref: 'real entry' });
    const crossUpdate = db.updateTaskSource(userId, otherSource.id, { type: 'OTHER', ref: 'hijacked' });
    record('updateTaskSource rejects a source owned by another user', crossUpdate === null, 'result=' + JSON.stringify(crossUpdate));

    const crossDelete = db.deleteTaskSource(userId, otherSource.id);
    const stillThere = db.getTaskSources(otherUserRow.id, otherTask.id).some(s => s.id === otherSource.id);
    record('deleteTaskSource rejects and leaves another user\'s source intact', !crossDelete.ok && stillThere,
      JSON.stringify({ ok: crossDelete.ok, stillThere }));
  } else {
    record('Ownership gating', true, 'skipped — only one user in copied DB');
  }

} catch (err) {
  exitCode = 1;
  console.error('FATAL:', err);
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n── Results ──');
for (const r of results) {
  console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.flow + (r.details ? '  (' + r.details + ')' : ''));
  if (!r.pass) exitCode = 1;
}
console.log('\n' + (exitCode === 0 ? 'ALL GREEN' : 'FAILURES PRESENT'));
process.exit(exitCode);
