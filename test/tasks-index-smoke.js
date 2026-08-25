// ─────────────────────────────────────────────────────────────────────────────
// Lightweight tasks index — headless data-layer smoke test (Milestone 7).
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron, no IPC, no
// renderer.
//
// SAFETY: never touches production. Copies the live DB into a throwaway temp
// dir and runs everything there; the temp dir is deleted at the end.
//
// Run:  node test/tasks-index-smoke.js
//
// Gates exercised:
//   1. getTasksIndex() returns the exact same set of task ids, in the same
//      order, as listTasks() — they share one base query (getTasksIndex is
//      listTasks' own foundation, with workLogs added on top), so this also
//      guards against the two ever silently drifting apart.
//   2. Correct logCount/totalMinutes/lastDate/firstDate for a seeded
//      multi-session task.
//   3. A zero-log task reports logCount: 0 and firstDate/lastDate: null,
//      not a thrown error.
//   4. getTasksIndex()'s entries carry no `workLogs` key at all (the whole
//      point of the lightweight payload) while listTasks()'s do.
//   5. Payload-size measurement against the real production dataset (copied
//      into this test's own throwaway dir, per the ROADMAP's "measure before
//      optimizing further" instruction) — logged for visibility; not a
//      pass/fail gate, since there's no a priori "correct" size, only a
//      before/after comparison worth recording.
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
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-idx-smoke-'));
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

  // ── Gate 5 — payload-size measurement (logged, not pass/fail) ───────────────
  const fullBefore = db.listTasks(userId);
  const indexBefore = db.getTasksIndex(userId);
  const fullBytes = Buffer.byteLength(JSON.stringify(fullBefore));
  const indexBytes = Buffer.byteLength(JSON.stringify(indexBefore));
  console.log(`Payload size on the real dataset (${fullBefore.length} tasks): ` +
    `tasks:list=${fullBytes} bytes, tasks:index=${indexBytes} bytes ` +
    `(${Math.round((1 - indexBytes / fullBytes) * 100)}% smaller).\n`);

  // ── Seed a multi-session task + a zero-log task ──────────────────────────────
  const naturalLabel = db.getLookupsByCategory('ACTIVITY_TYPE')[0]?.label || '';
  const multiTask = db.createTask(userId, { name: 'TI multi-session task', status: 'OPEN', company: '', system: '', source: '' });
  db.addWorkLog(userId, multiTask.id, { date: '2096-01-10', description: 'first', minutes: 20, time: 'WORK_TIME', natural: naturalLabel });
  db.addWorkLog(userId, multiTask.id, { date: '2096-01-15', description: 'second', minutes: 40, time: 'WORK_TIME', natural: naturalLabel });
  const zeroTask = db.createTask(userId, { name: 'TI zero-log task', status: 'OPEN', company: '', system: '', source: '' });

  const fullList = db.listTasks(userId);
  const indexList = db.getTasksIndex(userId);

  // ── Gate 1 — identical id set, same order ────────────────────────────────────
  const fullIds = fullList.map(t => t.id);
  const indexIds = indexList.map(t => t.id);
  record('Gate 1: getTasksIndex() returns the exact same set of task ids, in the same order, as listTasks()',
    JSON.stringify(fullIds) === JSON.stringify(indexIds), `count=${fullIds.length} idsMatch=${JSON.stringify(fullIds) === JSON.stringify(indexIds)}`);

  // ── Gate 2 — rollups for the multi-session task ──────────────────────────────
  const idxMulti = indexList.find(t => t.id === multiTask.id);
  record('Gate 2: correct logCount/totalMinutes/firstDate/lastDate for a seeded multi-session task',
    idxMulti && idxMulti.logCount === 2 && idxMulti.totalMinutes === 60 && idxMulti.firstDate === '2096-01-10' && idxMulti.lastDate === '2096-01-15',
    JSON.stringify(idxMulti));

  // ── Gate 3 — zero-log task ────────────────────────────────────────────────────
  const idxZero = indexList.find(t => t.id === zeroTask.id);
  record('Gate 3: a zero-log task reports logCount:0 and firstDate/lastDate:null, no throw',
    idxZero && idxZero.logCount === 0 && idxZero.firstDate === null && idxZero.lastDate === null,
    JSON.stringify(idxZero));

  // ── Gate 4 — no workLogs key at all on the lightweight payload ───────────────
  const fullMulti = fullList.find(t => t.id === multiTask.id);
  record('Gate 4: getTasksIndex() entries carry no workLogs key at all; listTasks() entries do',
    !('workLogs' in idxMulti) && Array.isArray(fullMulti.workLogs) && fullMulti.workLogs.length === 2,
    `indexHasWorkLogs=${'workLogs' in idxMulti} fullWorkLogsLength=${fullMulti.workLogs && fullMulti.workLogs.length}`);

} catch (err) {
  console.error('\nTEST HARNESS ERROR: ' + (err && err.stack || err));
  exitCode = 2;
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n════════════════════ TASKS-INDEX SMOKE RESULTS ════════════════════');
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
