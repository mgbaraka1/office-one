'use strict';

// A deterministic scale guard, not a microbenchmark. It catches accidental
// N+1/full-payload regressions using a disposable 5,000-task / 10,000-session
// workspace while keeping thresholds generous enough for shared CI runners.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db');

// Guards against reading/copying the REAL production DB when this file is
// run directly (node test/<this file>) instead of via run-all.js — see
// test-bootstrap.js.
require('./test-bootstrap');

const source = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one', 'cooperation-tools.db');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'performance-smoke-'));
const target = path.join(workDir, 'cooperation-tools.db');
fs.copyFileSync(source, target);

let failed = false;
try {
  const raw = new DatabaseSync(target);
  const userId = raw.prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get().id;
  const insertTask = raw.prepare(
    `INSERT INTO tasks(user_id, name, sort_order, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?)`
  );
  const insertLog = raw.prepare(
    `INSERT INTO work_logs(user_id, task_id, date, description, minutes, sort_order, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const stamp = new Date().toISOString();
  raw.exec('BEGIN');
  try {
    for (let i = 0; i < 5_000; i += 1) {
      const id = Number(insertTask.run(userId, `Scale task ${i}`, i, stamp, stamp).lastInsertRowid);
      insertLog.run(userId, id, '2026-01-02', `Scale session A ${i}`, 15, 0, stamp, stamp);
      insertLog.run(userId, id, '2026-01-03', `Scale session B ${i}`, 30, 1, stamp, stamp);
    }
    raw.exec('COMMIT');
  } catch (error) {
    raw.exec('ROLLBACK');
    throw error;
  }
  raw.close();

  db.openConnection(workDir);
  db.applyMigrations();
  const indexStart = performance.now();
  const tasks = db.getTasksIndex(userId);
  const indexMs = performance.now() - indexStart;
  const searchStart = performance.now();
  const hits = db.searchWorkspace(userId, 'Scale task 4999', 30);
  const searchMs = performance.now() - searchStart;
  const bytes = Buffer.byteLength(JSON.stringify(tasks));
  // ── Revisit trigger (Finding 19, full-app audit) ──
  // listTasks()/getTasksIndex() (db.js) load every task/work-log row with no
  // LIMIT — fine at today's real-world scale and only tested up to the
  // 5,000-task/10,000-log ceiling below, but a genuine latent ceiling, not a
  // current bug. Don't build pagination speculatively; revisit only once a
  // real account's data approaches these numbers or the budgets below start
  // failing in CI.
  const checks = [
    ['task index returns the scaled workspace', tasks.length >= 5_000, `rows=${tasks.length}`],
    ['task index stays within the CI response budget', indexMs < 5_000, `${indexMs.toFixed(1)}ms`],
    ['FTS stays within the CI response budget', searchMs < 1_500 && hits.length > 0, `${searchMs.toFixed(1)}ms`],
    ['task index remains a summary payload', !tasks.some(task => Object.hasOwn(task, 'workLogs')), `${bytes} bytes`],
  ];
  for (const [name, pass, detail] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} (${detail})`);
    if (!pass) failed = true;
  }
} finally {
  try { db.close(); } catch {}
  fs.rmSync(workDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
