'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db');

// Guards against reading/copying the REAL production DB when this file is
// run directly (node test/<this file>) instead of via run-all.js — see
// test-bootstrap.js.
require('./test-bootstrap');

const sourceDir = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'private-system-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = path.join(sourceDir, 'cooperation-tools.db' + suffix);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
const dbFile = path.join(workDir, 'cooperation-tools.db');
const results = [];
const record = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
let exitCode = 0;

try {
  db.openConnection(workDir);
  db.applyMigrations();
  const owner = db.getUserByUsername('fixture-user');
  const otherId = db.createUser('private-lookup-other', bcrypt.hashSync('other-password', 4), false);
  const existing = db.getLookupsByCategory('SYSTEM', true);
  db.saveLookups(owner.id, { categories: { SYSTEM: [
    ...existing.map(item => ({ ...item })),
    { code: 'OWNER_SECRET_SYSTEM', label: 'Owner Secret System', isActive: true },
  ] } });
  const secret = db.getLookupsByCategory('SYSTEM', true).find(item => item.code === 'OWNER_SECRET_SYSTEM');
  db.close();

  const raw = new DatabaseSync(dbFile);
  raw.prepare('INSERT INTO lookup_code_user_access(lookup_id, user_id, created_at) VALUES(?, ?, ?)')
    .run(secret.id, owner.id, new Date().toISOString());
  raw.close();

  db.openConnection(workDir);
  db.applyMigrations();
  const ownerSystems = db.loadLookups(owner.id).categories.SYSTEM;
  const otherSystems = db.loadLookups(otherId).categories.SYSTEM;
  record('Owner can enumerate a private migrated SYSTEM lookup', ownerSystems.some(item => item.id === secret.id));
  record('Another account cannot enumerate the owner private SYSTEM lookup', !otherSystems.some(item => item.id === secret.id));
  record('Direct category IPC backing query is also user-scoped',
    !db.getLookupsByCategory('SYSTEM', true, otherId).some(item => item.id === secret.id));

  const ownerTask = db.createTask(owner.id, { name: 'Owner private task', status: 'OPEN', system: secret.label });
  const otherTask = db.createTask(otherId, { name: 'Other guessed task', status: 'OPEN', system: secret.label });
  record('Owner may use their private SYSTEM lookup', ownerTask.system === secret.label);
  record('A guessed private label cannot be linked by another account', otherTask.system === '');
} catch (error) {
  console.error(error.stack || error);
  exitCode = 2;
} finally {
  try { db.close(); } catch {}
  fs.rmSync(workDir, { recursive: true, force: true });
}

for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` (${result.detail})` : ''}`);
if (results.some(result => !result.pass)) exitCode = 1;
process.exit(exitCode);
