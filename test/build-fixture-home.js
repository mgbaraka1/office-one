'use strict';

// Shared fixture-profile builder. Single source of truth for what a "fixture
// production profile" contains, used both by run-all.js (which builds one
// fixture home for every spawned smoke test) and by test-bootstrap.js's
// standalone fallback (which builds its own when a smoke test is run
// directly, bypassing run-all.js — see that file for why this matters).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const db = require('../db');

module.exports = function buildFixtureHome(prefix = 'office-one-test-home-') {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const fixtureDir = path.join(fakeHome, 'AppData', 'Roaming', 'office-one');
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

  return { fakeHome, fixtureDir, fixtureUserId };
};
