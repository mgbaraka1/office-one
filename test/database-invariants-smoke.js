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

const sourceDir = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one');
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
  // migration 048's link-exclusivity trigger and migration 053's
  // internal-no-client-fields trigger can both
  // legitimately reject this same malformed update — this task already has a
  // company_id, so setting department_id on it violates both rules at once.
  // Either message proves SQLite rejected the write; which one fires first
  // is a SQLite trigger-ordering detail, not something either invariant's
  // correctness depends on.
  const exclusive = expectAbort(
    () => raw.prepare('UPDATE tasks SET project_id = 1, department_id = ? WHERE id = ?').run(department.id, task.id),
    /only one project, department, or support year|cannot carry a client company or system/
  );
  const category = expectAbort(
    () => raw.prepare('UPDATE tasks SET status_id = ? WHERE id = ?').run(company.id, task.id),
    /wrong lookup category/
  );
  const unchanged = raw.prepare('SELECT project_id, department_id, status_id FROM tasks WHERE id = ?').get(task.id);

  // migration 053: an already-internal task (department_id set, company_id
  // already NULL after the migration's own cleanup) rejects a write that
  // would newly attach a company — isolates this specific trigger from the
  // link-exclusivity one above (department_id isn't even being touched here).
  const internalTask = raw.prepare('SELECT id, company_id FROM tasks WHERE department_id IS NOT NULL LIMIT 1').get();
  let internalNoCompany = true, internalNoCompanyDetail = 'no internal task in this fixture — skipped';
  if (internalTask) {
    const internalNoCompanyBefore = raw.prepare('SELECT company_id FROM tasks WHERE id = ?').get(internalTask.id);
    internalNoCompany = expectAbort(
      () => raw.prepare('UPDATE tasks SET company_id = ? WHERE id = ?').run(company.id, internalTask.id),
      /cannot carry a client company or system/
    );
    const internalNoCompanyAfter = raw.prepare('SELECT company_id FROM tasks WHERE id = ?').get(internalTask.id);
    internalNoCompany = internalNoCompany && internalNoCompanyAfter.company_id === internalNoCompanyBefore.company_id;
    internalNoCompanyDetail = `taskId=${internalTask.id}`;
  }

  const triggers = raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_%'").get().n;
  raw.close();

  const checks = [
    ['migration 050 is applied', head >= 50, `head=${head}`],
    ['SQLite rejects cross-linked tasks', exclusive],
    ['SQLite rejects lookup-category confusion', category],
    ['rejected writes leave the task unchanged', JSON.stringify(unchanged) === JSON.stringify(before)],
    ['SQLite rejects a company attached to an internal task', internalNoCompany, internalNoCompanyDetail],
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
