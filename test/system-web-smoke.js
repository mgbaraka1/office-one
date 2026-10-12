'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Systems web (clients:system-web) — headless data-layer smoke test.
//
// Boots db.js directly against a private copy of the fixture profile's
// database; the copy is deleted at the end.
//
// Run:  node test/system-web-smoke.js
//
// Covers getClientSystemWeb: a pair is linked by servers, projects, client
// tasks (with their logged minutes) and Knowledge Hub items, each counted on
// its own; a client with nothing linked has no rows; another login's records
// never show.
// ─────────────────────────────────────────────────────────────────────────────
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const db = require('../db');

require('./test-bootstrap');

const results = [];
function record(flow, pass, details = '') { results.push({ flow, pass, details }); }

const prodDb = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one', 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: fixture DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-web-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}

let exitCode = 0;
try {
  db.openConnection(workDir);
  db.applyMigrations();
  const userId = db.getUserByUsername('fixture-user').id;

  // A fresh client, so every link below is one this test made.
  const created = db.createClient(userId, { code: 'SWEB_TEST', nameEn: 'Systems Web Test' });
  const client = (created.client || created.item || db.listClients(userId, true).find(c => c.code === 'SWEB_TEST'));
  const idle = db.createClient(userId, { code: 'SWEB_IDLE', nameEn: 'Systems Web Idle' });
  const idleClient = idle.client || idle.item || db.listClients(userId, true).find(c => c.code === 'SWEB_IDLE');
  const [sysA, sysB] = db.getLookupsByCategory('SYSTEM');
  if (!client || !idleClient || !sysB) throw new Error('setup: need two clients and two SYSTEM lookups');
  const pair = (companyId, systemId) => db.getClientSystemWeb(userId).find(l => l.companyId === companyId && l.systemId === systemId);

  record('An unlinked client has no rows', !db.getClientSystemWeb(userId).some(l => l.companyId === client.id));

  db.createClientServer(userId, client.id, { systemName: sysA.label, role: 'APPLICATIONS', environment: 'PRODUCTION' });
  db.createClientServer(userId, client.id, { systemName: sysA.label, role: 'APPLICATIONS', environment: 'TEST' });
  let p = pair(client.id, sysA.id);
  record('Servers: two servers under a system count as 2', p?.servers === 2 && p.projects === 0 && p.tasks === 0, JSON.stringify(p));

  db.createProject(userId, { name: 'Systems web project', description: '', companyIds: [client.id], systemIds: [sysA.id, sysB.id], status: 'ACTIVE', category: 'NEW_PROJECT' });
  p = pair(client.id, sysA.id);
  const pB = pair(client.id, sysB.id);
  record('Projects: one project links the client to each of its systems', p?.projects === 1 && pB?.projects === 1 && pB.servers === 0,
    JSON.stringify({ p, pB }));

  const task = db.createTask(userId, { name: 'Systems web task', status: 'OPEN', company: client.code, system: sysB.label, source: '' });
  const taskId = task.id ?? task.task?.id;
  db.addWorkLog(userId, taskId, { date: '2090-01-02', description: 'a', minutes: 90, time: 'WORK_TIME' });
  db.addWorkLog(userId, taskId, { date: '2090-01-03', description: 'b', minutes: 30, time: 'WORK_TIME' });
  const pT = pair(client.id, sysB.id);
  record('Tasks: a client task counts once, with all its logged minutes', pT?.tasks === 1 && pT.minutes === 120, JSON.stringify(pT));

  db.createKnowledgeItem(userId, { title: 'Systems web doc', status: 'PUBLISHED', companyIds: [client.id], systemIds: [sysA.id] });
  p = pair(client.id, sysA.id);
  record('Knowledge Hub: an item linked to both counts', p?.knowledge === 1, JSON.stringify(p));

  record('A client with nothing linked still has no rows', !db.getClientSystemWeb(userId).some(l => l.companyId === idleClient.id));

  // Another login sees none of this login's links.
  const other = db.getConnection().prepare('SELECT id FROM users WHERE id != ? LIMIT 1').get(userId);
  if (other) {
    record('Another login sees none of these links',
      !db.getClientSystemWeb(other.id).some(l => l.companyId === client.id));
  }
} catch (err) {
  record('Unexpected error', false, err.stack || String(err));
} finally {
  try { db.closeConnection?.(); } catch {}
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
}

for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.flow}${r.pass ? '' : '\n      ' + r.details}`);
  if (!r.pass) exitCode = 1;
}
if (!results.length) exitCode = 1;
process.exit(exitCode);
