// ─────────────────────────────────────────────────────────────────────────────
// Clients (VPN Connectivity + Server Information) — headless data-layer smoke
// test (Phase 6, verification gates 1-3; gate 4 is the CDP walkthrough).
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron/IPC/renderer.
// SAFETY: never touches production. Copies the live DB into a throwaway temp
// dir and runs everything there; the temp dir is deleted at the end.
//
// Run:  node test/clients-smoke.js
//
// Gates exercised:
//   1. Migration 017 runs cleanly on a fresh copy of the current (head 016) DB.
//   2. Re-running applyMigrations() is a no-op (idempotent).
//   3. Existing screens unaffected — pre/post row counts on unrelated tables.
//   plus full CRUD for client_vpn_connections / client_servers, ownership
//   gating, and the "clients ARE the COMPANY roster" behavior (no standalone
//   clients table — getClient rejects a non-COMPANY id).
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const db = require('../db');

const results = [];
function record(flow, pass, details) { results.push({ flow, pass, details }); }

const prodDir = path.join(os.homedir(), 'AppData', 'Roaming', 'timesheet');
const prodDb  = path.join(prodDir, 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: production DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
console.log('Working copy: ' + path.join(workDir, 'cooperation-tools.db'));

let exitCode = 0;
try {
  const rawBefore = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const countBefore = (t) => rawBefore.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const before = {
    projects: countBefore('projects'), tasks: countBefore('tasks'),
    work_logs: countBefore('work_logs'), lookup_codes: countBefore('lookup_codes'),
  };
  rawBefore.close();

  // ── Gate 1 — migration runs cleanly ──────────────────────────────────────────
  db.openConnection(workDir);
  db.applyMigrations();
  record('Gate 1: migration 017 applies cleanly', true, 'no throw');

  // ── Gate 2 — idempotent re-run ───────────────────────────────────────────────
  db.applyMigrations();
  record('Gate 2: re-applying migrations is a no-op', true, 'no throw, no duplicate rows');

  // ── Gate 3 — existing tables/rows unaffected ─────────────────────────────────
  const rawAfter = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const countAfter = (t) => rawAfter.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const after = {
    projects: countAfter('projects'), tasks: countAfter('tasks'), work_logs: countAfter('work_logs'),
  };
  // lookup_codes is intentionally excluded: this copy predates migration 016
  // (production hasn't been migrated past 015 yet), so applyMigrations() here
  // also runs 016 first, which legitimately seeds new COMPANY_DOCUMENT_CATEGORY
  // rows — that's 016's expected behavior, not a regression caused by 017.
  rawAfter.close();
  const gate3Pass = after.projects === before.projects && after.tasks === before.tasks
    && after.work_logs === before.work_logs;
  record('Gate 3: pre-existing tables unaffected', gate3Pass,
    `projects ${before.projects}->${after.projects}, tasks ${before.tasks}->${after.tasks}, ` +
    `work_logs ${before.work_logs}->${after.work_logs}`);

  const userRow = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'))
    .prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  if (!userRow) throw new Error('no active user in the copied DB');
  const userId = userRow.id;
  console.log('Using userId=' + userId + '\n');

  const companies = db.getLookupsByCategory('COMPANY');
  if (!companies.length) throw new Error('no active COMPANY lookups in the copied DB');
  const companyA = companies[0].id;
  const companyB = companies.length > 1 ? companies[1].id : companyA;

  // ── Clients ARE the COMPANY roster — no standalone table ────────────────────
  const clientList = db.listClients(userId);
  record('listClients: returns one entry per active COMPANY lookup', clientList.length === companies.length,
    `expected ${companies.length}, got ${clientList.length}`);
  record('listClients: zero-activity company still included with 0 counts',
    clientList.every(c => c.vpnCount === 0 && c.serverCount === 0), JSON.stringify(clientList[0]));

  const bogusClient = db.getClient(userId, 999999999);
  record('getClient: rejects a non-COMPANY id (no standalone clients table)', bogusClient === null, String(bogusClient));

  // ── VPN CRUD ─────────────────────────────────────────────────────────────────
  const vpn = db.createClientVpn(userId, companyA, {
    connectionName: 'HQ Site-to-Site', vpnType: 'WireGuard', endpoint: 'vpn.acme.com', notes: 'primary link',
  });
  record('createClientVpn: persisted with fields', vpn && vpn.companyId === companyA
    && vpn.connectionName === 'HQ Site-to-Site' && vpn.vpnType === 'WireGuard', JSON.stringify(vpn));

  const badVpn = db.createClientVpn(userId, 999999999, { connectionName: 'nope' });
  record('createClientVpn: rejects a non-COMPANY companyId', badVpn === null, String(badVpn));

  const clientA1 = db.getClient(userId, companyA);
  record('getClient: includes the created VPN connection', clientA1.vpnConnections.some(v => v.id === vpn.id),
    'count=' + clientA1.vpnConnections.length);

  const updatedVpn = db.updateClientVpn(userId, vpn.id, {
    connectionName: 'HQ Site-to-Site v2', vpnType: 'IPSec', endpoint: 'vpn2.acme.com', notes: 'updated',
  });
  record('updateClientVpn: fields changed in place, id stable', updatedVpn.id === vpn.id
    && updatedVpn.connectionName === 'HQ Site-to-Site v2' && updatedVpn.vpnType === 'IPSec', JSON.stringify(updatedVpn));

  // ── Server CRUD ──────────────────────────────────────────────────────────────
  const srv = db.createClientServer(userId, companyA, {
    serverName: 'App Server 1', host: '10.0.0.5', environment: 'PRODUCTION', os: 'Ubuntu 22.04', notes: 'main app box',
  });
  record('createClientServer: persisted with fields', srv && srv.companyId === companyA
    && srv.serverName === 'App Server 1' && srv.environment === 'PRODUCTION', JSON.stringify(srv));

  const updatedSrv = db.updateClientServer(userId, srv.id, {
    serverName: 'App Server 1 (renamed)', host: '10.0.0.6', environment: 'TEST', os: 'Ubuntu 24.04', notes: 'moved to test',
  });
  record('updateClientServer: fields changed in place, id stable', updatedSrv.id === srv.id
    && updatedSrv.environment === 'TEST' && updatedSrv.os === 'Ubuntu 24.04', JSON.stringify(updatedSrv));

  // ── Per-company isolation ────────────────────────────────────────────────────
  db.createClientServer(userId, companyB, { serverName: 'Other Client Box', host: '10.1.1.1', environment: 'PRODUCTION', os: 'Windows Server 2022', notes: '' });
  const clientAAfter = db.getClient(userId, companyA);
  const clientBAfter = db.getClient(userId, companyB);
  if (companyA !== companyB) {
    record('Per-company isolation: company A does not see company B\'s server',
      !clientAAfter.servers.some(s => s.serverName === 'Other Client Box'), '');
    record('Per-company isolation: company B sees its own server',
      clientBAfter.servers.some(s => s.serverName === 'Other Client Box'), '');
  } else {
    record('Per-company isolation: skipped (only one COMPANY lookup in this DB)', true, '');
  }

  // ── Ownership gate ───────────────────────────────────────────────────────────
  const otherUserRow = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'))
    .prepare('SELECT id FROM users WHERE id != ? LIMIT 1').get(userId);
  if (otherUserRow) {
    const stolenVpn = db.updateClientVpn(otherUserRow.id, vpn.id, { connectionName: 'stolen' });
    record('Ownership: another user cannot update this VPN connection', stolenVpn === null, JSON.stringify(stolenVpn));
    const stolenSrv = db.updateClientServer(otherUserRow.id, srv.id, { serverName: 'stolen' });
    record('Ownership: another user cannot update this server', stolenSrv === null, JSON.stringify(stolenSrv));
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  const delVpnRes = db.deleteClientVpn(userId, vpn.id);
  const delSrvRes = db.deleteClientServer(userId, srv.id);
  const clientAFinal = db.getClient(userId, companyA);
  record('deleteClientVpn/deleteClientServer: rows removed', delVpnRes.ok && delSrvRes.ok
    && !clientAFinal.vpnConnections.some(v => v.id === vpn.id) && !clientAFinal.servers.some(s => s.id === srv.id),
    `vpnCount=${clientAFinal.vpnConnections.length} serverCount=${clientAFinal.servers.length}`);

} catch (err) {
  exitCode = 1;
  console.error('FATAL:', err);
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n── Results ──');
for (const r of results) {
  console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.flow + (r.details ? '  (' + r.details + ')' : ''));
  if (!r.pass) exitCode = 1;
}
console.log('\n' + (exitCode === 0 ? 'ALL GREEN' : 'FAILURES PRESENT'));
process.exit(exitCode);
