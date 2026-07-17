'use strict';

// Runs all standalone smoke tests against a generated fixture database. Child
// tests retain their historic copy-to-temp setup, but HOME/USERPROFILE points
// at a synthetic profile, so production data is never read or copied.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const bcrypt = require('bcryptjs');
const db = require('../db');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('-smoke.js')).sort();
if (!files.length) {
  console.error('No smoke tests found in ' + dir);
  process.exit(1);
}

console.log(`Running ${files.length} test file(s): ${files.join(', ')}\n`);
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cooperation-tools-test-home-'));
const fixtureDir = path.join(fakeHome, 'AppData', 'Roaming', 'timesheet');
fs.mkdirSync(fixtureDir, { recursive: true });

db.openConnection(fixtureDir);
db.applyMigrations();
const placeholder = db.getUnclaimedUser();
const passwordHash = bcrypt.hashSync('fixture-password', 4);
let fixtureUserId;
if (placeholder) { db.claimUser(placeholder.id, 'fixture-user', passwordHash); fixtureUserId = placeholder.id; }
else if (db.countUsers() === 0) fixtureUserId = db.createUser('fixture-user', passwordHash, true);
else fixtureUserId = db.getUserByUsername('fixture-user')?.id;
db.saveLookups(fixtureUserId, { categories: {
  COMPANY: [
    { code: 'FIXTURE_COMPANY', label: 'Fixture Company', isActive: true },
    { code: 'FIXTURE_COMPANY_2', label: 'Fixture Company Two', isActive: true },
  ],
  SYSTEM: [
    { code: 'FIXTURE_SYSTEM', label: 'Fixture System', isActive: true },
    { code: 'FIXTURE_SYSTEM_2', label: 'Fixture System Two', isActive: true },
    { code: 'FIXTURE_SYSTEM_3', label: 'Fixture System Three', isActive: true },
    { code: 'FIXTURE_SYSTEM_4', label: 'Fixture System Four', isActive: true },
    { code: 'FIXTURE_SYSTEM_5', label: 'Fixture System Five', isActive: true },
  ],
  DEPARTMENT: [{ code: 'FIXTURE_DEPARTMENT', label: 'Fixture Department', isActive: true }],
} });
function ensureLookup(category, code, label) {
  const existing = db.getLookupsByCategory(category, true);
  if (existing.some(item => item.code === code)) return;
  db.saveLookups(fixtureUserId, { categories: { [category]: [
    ...existing.map(item => ({ ...item })),
    { code, label, isActive: true },
  ] } });
}
ensureLookup('TIME_TYPE', 'WORK_TIME', 'Work Time');
ensureLookup('TIME_TYPE', 'OVERTIME', 'Over Time');
ensureLookup('ACTIVITY_TYPE', 'TASK', 'Task');
ensureLookup('ENTRY_STATUS', 'OPEN', 'Open');
ensureLookup('ENTRY_STATUS', 'IN_PROGRESS', 'In Progress');
const baselineTask = db.createTask(fixtureUserId, {
  name: 'Fixture baseline task', status: 'IN_PROGRESS', company: 'Fixture Company', system: 'Fixture System', source: '',
});
db.addWorkLog(fixtureUserId, baselineTask.id, {
  date: '2090-01-01', description: 'Fixture baseline session', minutes: 15, time: 'WORK_TIME', natural: 'Task',
});
db.close();

const bootstrap = path.join(dir, 'test-bootstrap.js');
const bootstrapOption = bootstrap.replaceAll('\\', '/');
const childEnv = {
  ...process.env,
  HOME: fakeHome,
  USERPROFILE: fakeHome,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${bootstrapOption}`.trim(),
};

let failed = 0;
try {
  for (const file of files) {
    console.log(`\nRunning ${file}`);
    const result = spawnSync(process.execPath, [path.join(dir, file)], { stdio: 'inherit', env: childEnv });
    if (result.status !== 0) {
      console.error(`\nFAILED: ${file} (exit code ${result.status})`);
      failed = result.status || 1;
      break;
    }
  }
} finally {
  fs.rmSync(fakeHome, { recursive: true, force: true });
}

if (failed) process.exit(failed);
console.log(`\nAll ${files.length} test file(s) passed.`);
