'use strict';

// The 2026-08-25 rename of package.json's `name` (`timesheet` → `office-one`)
// moved the folder Electron hands the app, because Electron derives userData
// from that name. db.carryOverLegacyUserData() is what keeps an existing
// install's database reachable across that move, so it is the single most
// data-destructive thing in the tree if it is wrong: a bug here looks to the
// user like every record they ever entered has vanished.
//
// Run standalone with: node test/userdata-carryover-smoke.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('./test-bootstrap');

const db = require('../db');
const DB = db.DB_FILENAME;

const results = [];
function check(name, pass, details = '') {
  results.push({ name, pass, details });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${details ? '  (' + details + ')' : ''}`);
}

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'carryover-smoke-'));
  return { root, legacy: path.join(root, 'timesheet'), current: path.join(root, 'office-one') };
}

// A legacy profile that looks like a real one: a database (plus its WAL/SHM
// working files), an upload tree, a rotating snapshot, and a Chromium cache
// that must NOT come across.
function seedLegacy(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, DB), 'REAL-DATABASE-BYTES');
  fs.writeFileSync(path.join(dir, DB + '-wal'), 'WAL');
  fs.writeFileSync(path.join(dir, DB + '-shm'), 'SHM');
  fs.mkdirSync(path.join(dir, 'projects', '7'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', '7', 'contract.pdf'), 'PDF');
  fs.mkdirSync(path.join(dir, 'finance', 'contract', '3'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'finance', 'contract', '3', 'signed.pdf'), 'FIN');
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'backups', 'cooperation-tools-2026-08-01.db'), 'SNAPSHOT');
  fs.mkdirSync(path.join(dir, 'Cache'), { recursive: true });      // Chromium's, disposable
  fs.writeFileSync(path.join(dir, 'Cache', 'data_0'), 'CHROMIUM');
}

const read = p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

// ── 1. The happy path: a real pre-rebrand profile is carried across ─────────
{
  const { legacy, current } = scratch();
  seedLegacy(legacy);

  const result = db.carryOverLegacyUserData(current, legacy);

  check('a pre-rebrand profile is carried over', result.ok, result.reason);
  check('the database itself arrives intact',
    read(path.join(current, DB)) === 'REAL-DATABASE-BYTES');
  check('the WAL and SHM working files come with it (a consistent set, not a torn one)',
    read(path.join(current, DB + '-wal')) === 'WAL' && read(path.join(current, DB + '-shm')) === 'SHM');
  check('uploaded project files are carried recursively',
    read(path.join(current, 'projects', '7', 'contract.pdf')) === 'PDF');
  check('Finance attachments are carried recursively',
    read(path.join(current, 'finance', 'contract', '3', 'signed.pdf')) === 'FIN');
  check('rotating snapshots are carried',
    read(path.join(current, 'backups', 'cooperation-tools-2026-08-01.db')) === 'SNAPSHOT');

  // The whole point of copying an explicit allowlist rather than the directory.
  check("Chromium's disposable cache is NOT carried over",
    !fs.existsSync(path.join(current, 'Cache')));

  // The legacy folder is the recovery point — a move would destroy it.
  check('the legacy folder is left completely intact (it is the recovery point)',
    read(path.join(legacy, DB)) === 'REAL-DATABASE-BYTES'
    && read(path.join(legacy, 'projects', '7', 'contract.pdf')) === 'PDF');
}

// ── 2. Idempotence: booting again must never touch the carried-over data ────
{
  const { legacy, current } = scratch();
  seedLegacy(legacy);

  db.carryOverLegacyUserData(current, legacy);
  // Simulate the user actually working in the app after the first boot.
  fs.writeFileSync(path.join(current, DB), 'NEWER-DATABASE-WITH-TODAYS-WORK');

  const second = db.carryOverLegacyUserData(current, legacy);

  check('a second boot refuses to run again', !second.ok, second.reason);
  check('a second boot NEVER overwrites work done since the first',
    read(path.join(current, DB)) === 'NEWER-DATABASE-WITH-TODAYS-WORK');
}

// ── 3. The cases that must decline rather than act ──────────────────────────
{
  const { legacy, current } = scratch();

  // Nothing to carry: a genuinely fresh install on a machine that never had the
  // old app. Must not create a half-built profile.
  fs.mkdirSync(legacy, { recursive: true });
  const nothing = db.carryOverLegacyUserData(current, legacy);
  check('a fresh install with no legacy data declines', !nothing.ok, nothing.reason);
  check('declining leaves no stray destination directory behind', !fs.existsSync(current));

  // Same directory — the guard against a future rename that resolves to itself.
  seedLegacy(legacy);
  const self = db.carryOverLegacyUserData(legacy, legacy);
  check('a carry-over onto the same directory declines', !self.ok, self.reason);
  check('the same-directory guard did not disturb the database',
    read(path.join(legacy, DB)) === 'REAL-DATABASE-BYTES');

  const blank = db.carryOverLegacyUserData('', legacy);
  check('a missing path declines rather than throwing', !blank.ok, blank.reason);
}

// ── 4. The entry list must stay in step with the directories db.js creates ──
{
  for (const required of [DB, 'backups', 'projects', 'company_documents', 'knowledge_hub', 'finance']) {
    check(`USER_DATA_ENTRIES covers ${required}`, db.USER_DATA_ENTRIES.includes(required));
  }
  // Pre-055 Finance uploads: a database restored from an old backup can still
  // have these, and runMaintenance() only relocates them if they arrived.
  check('USER_DATA_ENTRIES still covers the pre-055 finance_it/ upload tree',
    db.USER_DATA_ENTRIES.includes('finance_it'));
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} userdata carry-over gates passed.`);
if (failed.length) {
  console.error('FAILED: ' + failed.map(f => f.name).join('; '));
  process.exit(1);
}
