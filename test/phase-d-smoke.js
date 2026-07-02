// ─────────────────────────────────────────────────────────────────────────────
// Phase D — headless data-layer smoke test.
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron, no IPC, no renderer —
// and drives the exact db.* calls each reworked renderer flow makes, then verifies
// the resulting rows. It confirms DATA flows only (not rendering/lock visuals).
//
// SAFETY: never touches production. It copies the live DB into a throwaway temp
// dir and runs everything there; the temp dir is deleted at the end.
//
// Run:  node test/phase-d-smoke.js      (Node 24 ships node:sqlite natively)
//   or: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron test/phase-d-smoke.js
//
// Flows exercised (mirroring index.html submitModal / persistTimesheet /
// openProjectNewTask → the db.js calls they issue):
//   1. Add Record — new task, same day        (createTask + addWorkLog @ DAY_A)
//   2. Add Record — new task, different day    (createTask + addWorkLog @ DAY_B)
//   3. Add Record — existing task, same day    (addWorkLog only @ DAY_A; task untouched)
//   4. Add Record — existing task, different day(addWorkLog only @ DAY_B; task untouched)
//   5. Per-row Add session — 2nd log on a task  (addWorkLog @ DAY_B on flow-1 task)
//   6. Projects — create zero-log task pre-linked(createTask{projectId}; 0 logs; in project)
//   + cross-cutting: task metadata is NEVER mutated when logging an existing task,
//     and every session lands on exactly the date requested.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const db = require('../db');

// Two distinctive dates, far from any real data, so queries are unambiguous.
const DAY_A = '2099-01-15';
const DAY_B = '2099-02-20';

const results = [];
function record(flow, pass, details) { results.push({ flow, pass, details }); }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// The task-level fields that must survive unchanged when only a session is added.
function taskMeta(t) {
  return { name: t.name, status: t.status, company: t.company, system: t.system,
           natural: t.natural, source: t.source, tags: t.tags, projectId: t.projectId };
}

// ── Set up an isolated copy of production data ───────────────────────────────
const prodDir = path.join(os.homedir(), 'AppData', 'Roaming', 'timesheet');
const prodDb  = path.join(prodDir, 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: production DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
console.log('Working copy: ' + path.join(workDir, 'cooperation-tools.db'));

let exitCode = 0;
try {
  db.openConnection(workDir);
  db.applyMigrations();               // no-op at head 014; proves the copy is current

  // userId: the only thing we read raw (no session in a headless context).
  const raw = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const userRow = raw.prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  raw.close();
  if (!userRow) throw new Error('no active user in the copied DB');
  const userId = userRow.id;
  console.log('Using userId=' + userId + '\n');

  // Valid lookup values so the FK ids actually resolve (label in, label out).
  const companyLabel = db.getLookupsByCategory('COMPANY')[0]?.label || '';
  const systemLabel  = db.getLookupsByCategory('SYSTEM')[0]?.label || '';
  const naturalLabel = db.getLookupsByCategory('ACTIVITY_TYPE')[0]?.label || '';

  let flow1TaskId, flow1Meta;   // carried from flow 1 into flow 5

  const newTaskPayload = (name) => ({
    name, status: 'IN_PROGRESS', company: companyLabel, system: systemLabel,
    natural: naturalLabel, source: 'phase-d-test', tags: ['pd'], projectId: null,
  });

  // ── FLOW 1 — Add Record: new task, same day (DAY_A) ────────────────────────
  {
    const t = db.createTask(userId, newTaskPayload('PD flow1 new same-day'));
    const r = db.addWorkLog(userId, t.id, { date: DAY_A, description: 'flow1 session', minutes: 30, time: 'WORK_TIME' });
    const got = db.getTask(userId, t.id);
    const wl  = got.workLogs[0] || {};
    const pass = r.ok && got.logCount === 1 && wl.date === DAY_A && wl.minutes === 30
              && got.company === companyLabel && got.name === 'PD flow1 new same-day';
    record('1. Add Record — new task, same day', pass,
      `taskId=${t.id} logCount=${got.logCount} wl.date=${wl.date} wl.minutes=${wl.minutes} company="${got.company}"`);
    flow1TaskId = t.id;                          // reused by flow 5
    flow1Meta   = taskMeta(got);
  }

  // ── FLOW 2 — Add Record: new task, different day (DAY_B) ────────────────────
  {
    const t = db.createTask(userId, newTaskPayload('PD flow2 new diff-day'));
    const r = db.addWorkLog(userId, t.id, { date: DAY_B, description: 'flow2 session', minutes: 45, time: 'WORK_TIME' });
    const got = db.getTask(userId, t.id);
    const wl  = got.workLogs[0] || {};
    const pass = r.ok && got.logCount === 1 && wl.date === DAY_B && wl.minutes === 45;
    record('2. Add Record — new task, different day', pass,
      `taskId=${t.id} logCount=${got.logCount} wl.date=${wl.date} (expected ${DAY_B}) wl.minutes=${wl.minutes}`);
  }

  // Pick a genuine PRE-EXISTING production task the user owns (with logs + real
  // metadata), excluding anything this test just created, for flows 3/4.
  const existing = db.listTasks(userId).find(t => t.logCount >= 1 && t.company && !t.name.startsWith('PD '));
  if (!existing) throw new Error('no suitable pre-existing task (with logs + company) to test against');

  // ── FLOW 3 — Add Record: existing task, same day (DAY_A) ───────────────────
  {
    const before = taskMeta(db.getTask(userId, existing.id));
    const beforeCount = db.getTask(userId, existing.id).logCount;
    const r = db.addWorkLog(userId, existing.id, { date: DAY_A, description: 'flow3 session on existing', minutes: 12, time: 'WORK_TIME' });
    const after = db.getTask(userId, existing.id);
    const metaUnchanged = eq(before, taskMeta(after));
    const added = after.workLogs.find(w => w.date === DAY_A && w.minutes === 12 && w.description === 'flow3 session on existing');
    const pass = r.ok && metaUnchanged && !!added && after.logCount === beforeCount + 1;
    record('3. Add Record — existing task, same day (metadata untouched)', pass,
      `taskId=${existing.id} logCount ${beforeCount}→${after.logCount} metaUnchanged=${metaUnchanged} landedOn=${added ? added.date : 'MISSING'}`);
  }

  // ── FLOW 4 — Add Record: existing task, different day (DAY_B) ───────────────
  {
    const before = taskMeta(db.getTask(userId, existing.id));
    const beforeCount = db.getTask(userId, existing.id).logCount;
    const r = db.addWorkLog(userId, existing.id, { date: DAY_B, description: 'flow4 session on existing', minutes: 18, time: 'OVERTIME' });
    const after = db.getTask(userId, existing.id);
    const metaUnchanged = eq(before, taskMeta(after));
    const added = after.workLogs.find(w => w.date === DAY_B && w.minutes === 18 && w.time === 'OVERTIME');
    const pass = r.ok && metaUnchanged && !!added && after.logCount === beforeCount + 1;
    record('4. Add Record — existing task, different day (metadata untouched)', pass,
      `taskId=${existing.id} logCount ${beforeCount}→${after.logCount} metaUnchanged=${metaUnchanged} landedOn=${added ? added.date : 'MISSING'} time=${added ? added.time : '-'}`);
  }

  // ── FLOW 5 — Per-row Add session: a 2nd log on the flow-1 task ──────────────
  {
    const taskId = flow1TaskId;
    const r = db.addWorkLog(userId, taskId, { date: DAY_B, description: 'flow5 second session', minutes: 20, time: 'OVERTIME' });
    const after = db.getTask(userId, taskId);
    const dates = after.workLogs.map(w => w.date).sort();
    const metaUnchanged = eq(flow1Meta, taskMeta(after));
    const pass = r.ok && after.logCount === 2 && eq(dates, [DAY_A, DAY_B]) && metaUnchanged;
    record('5. Per-row Add session — 2nd log on same task', pass,
      `taskId=${taskId} logCount=${after.logCount} dates=${JSON.stringify(dates)} metaUnchanged=${metaUnchanged}`);
  }

  // ── FLOW 6 — Projects: create a zero-log task pre-linked to a project ───────
  {
    let project = db.listProjects(userId)[0];
    if (!project) {
      project = db.createProject(userId, { name: 'PD test project', description: '', companyIds: [], systemIds: [], status: 'ACTIVE' });
    }
    const t = db.createTask(userId, { name: 'PD flow6 project task', status: 'IN_PROGRESS',
      company: '', system: '', natural: '', source: '', tags: [], projectId: project.id });
    const got = db.getTask(userId, t.id);
    const proj = db.getProject(userId, project.id);
    const inProject = (proj.tasks || []).find(x => x.id === t.id);
    const pass = got.projectId === project.id && got.logCount === 0
              && !!inProject && (inProject.workLogs || []).length === 0;
    record('6. Projects — create zero-log task pre-linked', pass,
      `projectId=${project.id} taskId=${t.id} task.projectId=${got.projectId} logCount=${got.logCount} shownInProject=${!!inProject}`);
  }

} catch (err) {
  console.error('\nTEST HARNESS ERROR: ' + (err && err.stack || err));
  exitCode = 2;
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log('\n════════════════════ PHASE D SMOKE RESULTS ════════════════════');
let failed = 0;
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  if (!r.pass) failed++;
  console.log(`[${tag}] ${r.flow}\n        ${r.details}`);
}
console.log('────────────────────────────────────────────────────────────────');
console.log(`${results.length - failed}/${results.length} flows passed` + (failed ? `  (${failed} FAILED)` : '  — all green'));
if (failed > 0 && exitCode === 0) exitCode = 1;
process.exit(exitCode);
