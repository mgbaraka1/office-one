'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db');

// Guards against reading/copying the REAL production DB when this file is
// run directly (node test/<this file>) instead of via run-all.js — see
// test-bootstrap.js.
require('./test-bootstrap');

const sourceDir = path.join(os.homedir(), 'AppData', 'Roaming', 'timesheet');
const sourceDb = path.join(sourceDir, 'cooperation-tools.db');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'database-invariants-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const source = sourceDb + suffix;
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(workDir, 'cooperation-tools.db' + suffix));
}

function expectAbort(fn, pattern) {
  try { fn(); return false; }
  catch (error) { return pattern.test(String(error?.message || error)); }
}

let failed = false;
try {
  db.openConnection(workDir);
  db.applyMigrations();
  const raw = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const head = raw.prepare('SELECT MAX(version) AS n FROM schema_migrations').get().n;
  const task = raw.prepare('SELECT id FROM tasks ORDER BY id LIMIT 1').get();
  const company = raw.prepare("SELECT id FROM lookup_codes WHERE category='COMPANY' ORDER BY id LIMIT 1").get();
  const department = raw.prepare("SELECT id FROM lookup_codes WHERE category='DEPARTMENT' ORDER BY id LIMIT 1").get();

  const before = raw.prepare('SELECT project_id, department_id, status_id FROM tasks WHERE id = ?').get(task.id);
  const exclusive = expectAbort(
    () => raw.prepare('UPDATE tasks SET project_id = 1, department_id = ? WHERE id = ?').run(department.id, task.id),
    /only one project, department, or support year/
  );
  const category = expectAbort(
    () => raw.prepare('UPDATE tasks SET status_id = ? WHERE id = ?').run(company.id, task.id),
    /wrong lookup category/
  );
  const unchanged = raw.prepare('SELECT project_id, department_id, status_id FROM tasks WHERE id = ?').get(task.id);
  const triggers = raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_%'").get().n;
  raw.close();

  const checks = [
    ['migration 050 is the active schema head', head === 50, `head=${head}`],
    ['SQLite rejects cross-linked tasks', exclusive],
    ['SQLite rejects lookup-category confusion', category],
    ['rejected writes leave the task unchanged', JSON.stringify(unchanged) === JSON.stringify(before)],
    ['invariant triggers were installed', triggers >= 32, `triggers=${triggers}`],
  ];
  for (const [name, pass, detail = ''] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
    if (!pass) failed = true;
  }
} finally {
  try { db.close(); } catch {}
  fs.rmSync(workDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
