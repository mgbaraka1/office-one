'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const db = require('../db');
const auth = require('../auth');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-boundary-smoke-'));
const results = [];
const record = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
let exitCode = 0;

try {
  db.openConnection(workDir);
  db.applyMigrations();

  const overlongAscii = 'a'.repeat(72) + 'x';
  const overlongUtf8 = 'é'.repeat(37); // 37 characters, 74 UTF-8 bytes
  const rejectedSetup = auth.setup('boundary-admin', overlongAscii);
  record('First-account setup rejects passwords beyond bcrypt 72-byte boundary',
    rejectedSetup.ok === false && /72 UTF-8 bytes/.test(rejectedSetup.error || ''), rejectedSetup.error);

  const rejectedUtf8 = auth.setup('boundary-admin', overlongUtf8);
  record('Password boundary is measured in UTF-8 bytes, not JavaScript characters',
    rejectedUtf8.ok === false && /72 UTF-8 bytes/.test(rejectedUtf8.error || ''), rejectedUtf8.error);

  const valid72 = 'v'.repeat(72);
  const setup = auth.setup('boundary-admin', valid72);
  record('A legitimate 72-byte password remains accepted', setup.ok === true);
  auth.logout();
  record('The accepted boundary password authenticates', auth.login('boundary-admin', valid72).ok === true);
  auth.logout();

  // Prove legacy hashes cannot retain the suffix-alias bypass. Both the exact
  // historical long value and a different suffix must fail before bcrypt.
  const legacyPrefix = 'p'.repeat(72);
  db.createUser('legacy-long', bcrypt.hashSync(legacyPrefix + '-original', 4), false);
  const exactLegacy = auth.login('legacy-long', legacyPrefix + '-original');
  const aliasLegacy = auth.login('legacy-long', legacyPrefix + '-attacker');
  record('Legacy overlong bcrypt hashes no longer accept the original or an alias suffix',
    exactLegacy.ok === false && aliasLegacy.ok === false);

  auth.login('boundary-admin', valid72);
  const addLong = auth.addUser('too-long-user', overlongAscii);
  const changeLong = auth.changePassword(valid72, overlongUtf8);
  auth.logout();
  const unchanged = auth.login('boundary-admin', valid72);
  record('Admin add-user rejects an overlong password', addLong.ok === false);
  record('Password change rejects an overlong password and preserves the old credential',
    changeLong.ok === false && unchanged.ok === true);
} catch (error) {
  console.error(error.stack || error);
  exitCode = 2;
} finally {
  try { auth.logout(); } catch {}
  try { db.close(); } catch {}
  fs.rmSync(workDir, { recursive: true, force: true });
}

for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` (${result.detail})` : ''}`);
if (results.some(result => !result.pass)) exitCode = 1;
process.exit(exitCode);
