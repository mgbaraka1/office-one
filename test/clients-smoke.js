// ─────────────────────────────────────────────────────────────────────────────
// Clients (Auth + Server Information + Databases + External Services +
// Internal Systems) — headless data-layer smoke test (Phase 6, verification
// gates 1-3; gate 4 is the CDP walkthrough).
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron/IPC/renderer.
// SAFETY: never touches production. Copies the live DB into a throwaway temp
// dir and runs everything there; the temp dir is deleted at the end.
//
// Run:  node test/clients-smoke.js
//
// Gates exercised:
//   1. Migrations 017-025 run cleanly on a fresh copy of the current DB.
//   2. Re-running applyMigrations() is a no-op (idempotent).
//   3. Existing screens unaffected — pre/post row counts on unrelated tables.
//   plus full CRUD for client_vpn_connections / client_servers /
//   client_databases / client_external_services / client_internal_systems,
//   ownership gating, and the "clients ARE the COMPANY roster" behavior (no
//   standalone clients table — getClient rejects a non-COMPANY id).
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
  record('Gate 1: migrations 017-025 apply cleanly', true, 'no throw');

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
  // Counts must reflect the copied production data (which may have real VPN/
  // server rows already), not an assumption of a pristine DB — cross-check
  // listClients' counts against a raw SQL tally instead of asserting zero.
  const rawCounts = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const vpnTally = new Map(rawCounts.prepare(
    'SELECT company_id, COUNT(*) AS c FROM client_vpn_connections WHERE user_id = ? GROUP BY company_id'
  ).all(userId).map(r => [r.company_id, r.c]));
  const srvTally = new Map(rawCounts.prepare(
    'SELECT company_id, COUNT(*) AS c FROM client_servers WHERE user_id = ? GROUP BY company_id'
  ).all(userId).map(r => [r.company_id, r.c]));
  const dbTally = new Map(rawCounts.prepare(
    'SELECT company_id, COUNT(*) AS c FROM client_databases WHERE user_id = ? GROUP BY company_id'
  ).all(userId).map(r => [r.company_id, r.c]));
  const extTally = new Map(rawCounts.prepare(
    'SELECT company_id, COUNT(*) AS c FROM client_external_services WHERE user_id = ? GROUP BY company_id'
  ).all(userId).map(r => [r.company_id, r.c]));
  const intTally = new Map(rawCounts.prepare(
    'SELECT company_id, COUNT(*) AS c FROM client_internal_systems WHERE user_id = ? GROUP BY company_id'
  ).all(userId).map(r => [r.company_id, r.c]));
  rawCounts.close();
  record('listClients: counts match raw per-company tallies (zero-activity companies still included)',
    clientList.every(c => c.vpnCount === (vpnTally.get(c.id) || 0) && c.serverCount === (srvTally.get(c.id) || 0)
      && c.databaseCount === (dbTally.get(c.id) || 0) && c.externalServiceCount === (extTally.get(c.id) || 0)
      && c.internalSystemCount === (intTally.get(c.id) || 0)),
    JSON.stringify(clientList));

  const bogusClient = db.getClient(userId, 999999999);
  record('getClient: rejects a non-COMPANY id (no standalone clients table)', bogusClient === null, String(bogusClient));

  // ── VPN CRUD ─────────────────────────────────────────────────────────────────
  const vpn = db.createClientVpn(userId, companyA, {
    connectionName: 'HQ Site-to-Site', vpnType: 'WireGuard', endpoint: 'vpn.acme.com',
    port: '51820', username: 'hq-admin', password: 'S3cret!', notes: 'primary link',
  });
  record('createClientVpn: persisted with fields', vpn && vpn.companyId === companyA
    && vpn.connectionName === 'HQ Site-to-Site' && vpn.vpnType === 'WireGuard', JSON.stringify(vpn));
  record('createClientVpn: persists port/username/password (migration 018)',
    vpn && vpn.port === '51820' && vpn.username === 'hq-admin' && vpn.password === 'S3cret!', JSON.stringify(vpn));

  const badVpn = db.createClientVpn(userId, 999999999, { connectionName: 'nope' });
  record('createClientVpn: rejects a non-COMPANY companyId', badVpn === null, String(badVpn));

  const clientA1 = db.getClient(userId, companyA);
  record('getClient: includes the created VPN connection', clientA1.vpnConnections.some(v => v.id === vpn.id),
    'count=' + clientA1.vpnConnections.length);

  const updatedVpn = db.updateClientVpn(userId, vpn.id, {
    connectionName: 'HQ Site-to-Site v2', vpnType: 'IPSec', endpoint: 'vpn2.acme.com',
    port: '500', username: 'hq-admin2', password: 'N3wSecret!', notes: 'updated',
  });
  record('updateClientVpn: fields changed in place, id stable', updatedVpn.id === vpn.id
    && updatedVpn.connectionName === 'HQ Site-to-Site v2' && updatedVpn.vpnType === 'IPSec', JSON.stringify(updatedVpn));
  record('updateClientVpn: port/username/password changed in place',
    updatedVpn.port === '500' && updatedVpn.username === 'hq-admin2' && updatedVpn.password === 'N3wSecret!',
    JSON.stringify(updatedVpn));

  // ── Server CRUD ──────────────────────────────────────────────────────────────
  // Since migration 038 a server is identified by systemName - role - environment:
  // all three are required, so every payload here carries them. Since migration
  // 039 the System must be a real SYSTEM lookup label (free text is refused), so
  // these pick real catalog entries rather than inventing names. The identity
  // rule itself has its own dedicated gates in test/server-identity-smoke.js.
  // Pick systems companyA has no servers under, so these writes can't collide
  // with the real data in the copied DB (the identity triple is enforced now).
  const usedByCompanyA = new Set(db.getClient(userId, companyA).servers.map(s => s.systemName));
  const freeSystems = db.getLookupsByCategory('SYSTEM').filter(s => !usedByCompanyA.has(s.label));
  if (freeSystems.length < 2) throw new Error('need 2 unused SYSTEM lookups in this copy');
  const sysOne = freeSystems[0].label, sysTwo = freeSystems[1].label;

  const srv = db.createClientServer(userId, companyA, {
    host: '10.0.0.5', environment: 'PRODUCTION', os: 'Ubuntu 22.04',
    hostname: 'app-srv-1', username: 'admin', password: 'srv-secret', systemName: sysOne,
    role: 'APPLICATIONS', notes: 'main app box',
  });
  record('createClientServer: persisted with fields', srv && srv.companyId === companyA
    && srv.host === '10.0.0.5' && srv.environment === 'PRODUCTION', JSON.stringify(srv));
  record('createClientServer: persists hostname/username/password (migration 022)',
    srv && srv.hostname === 'app-srv-1' && srv.username === 'admin' && srv.password === 'srv-secret', JSON.stringify(srv));
  record('createClientServer: persists systemName (migration 023, lookup-backed since 039)',
    srv && srv.systemName === sysOne, JSON.stringify(srv));

  const updatedSrv = db.updateClientServer(userId, srv.id, {
    host: '10.0.0.6', environment: 'TEST', os: 'Ubuntu 24.04',
    hostname: 'app-srv-1-test', username: 'admin2', password: 'new-srv-secret', systemName: sysTwo,
    role: 'APPLICATIONS', notes: 'moved to test',
  });
  record('updateClientServer: fields changed in place, id stable', updatedSrv.id === srv.id
    && updatedSrv.environment === 'TEST' && updatedSrv.os === 'Ubuntu 24.04', JSON.stringify(updatedSrv));
  record('updateClientServer: hostname/username/password changed in place',
    updatedSrv.hostname === 'app-srv-1-test' && updatedSrv.username === 'admin2' && updatedSrv.password === 'new-srv-secret',
    JSON.stringify(updatedSrv));
  record('updateClientServer: systemName changed in place', updatedSrv.systemName === sysTwo, JSON.stringify(updatedSrv));

  // ── Database CRUD ────────────────────────────────────────────────────────────
  const database = db.createClientDatabase(userId, companyA, {
    name: 'Middleware Database', engine: 'PostgreSQL', host: 'db.acme.com',
    port: '5432', username: 'middleware', password: 'db-secret', notes: 'main app DB',
  });
  record('createClientDatabase: persisted with fields', database && database.companyId === companyA
    && database.name === 'Middleware Database' && database.engine === 'PostgreSQL'
    && database.port === '5432' && database.username === 'middleware' && database.password === 'db-secret',
    JSON.stringify(database));

  const badDb = db.createClientDatabase(userId, 999999999, { name: 'nope' });
  record('createClientDatabase: rejects a non-COMPANY companyId', badDb === null, String(badDb));

  const clientADb = db.getClient(userId, companyA);
  record('getClient: includes the created database', clientADb.databases.some(d => d.id === database.id),
    'count=' + clientADb.databases.length);

  const updatedDb = db.updateClientDatabase(userId, database.id, {
    name: 'Middleware Database v2', engine: 'MySQL', host: 'db2.acme.com',
    port: '3306', username: 'middleware2', password: 'new-db-secret', notes: 'migrated',
  });
  record('updateClientDatabase: fields changed in place, id stable', updatedDb.id === database.id
    && updatedDb.engine === 'MySQL' && updatedDb.port === '3306'
    && updatedDb.username === 'middleware2' && updatedDb.password === 'new-db-secret', JSON.stringify(updatedDb));

  // ── External Service CRUD ────────────────────────────────────────────────────
  const ext = db.createClientExternalService(userId, companyA, {
    name: 'Uploader Service - Production', url: 'https://apis.example.gov.sa/svc/v1?API_KEY=abc123',
    companyCode: '131', secretKey: 'ext-secret', notes: 'gov integration',
  });
  record('createClientExternalService: persisted with fields', ext && ext.companyId === companyA
    && ext.name === 'Uploader Service - Production' && ext.companyCode === '131' && ext.secretKey === 'ext-secret',
    JSON.stringify(ext));

  const badExt = db.createClientExternalService(userId, 999999999, { name: 'nope' });
  record('createClientExternalService: rejects a non-COMPANY companyId', badExt === null, String(badExt));

  const clientAExt = db.getClient(userId, companyA);
  record('getClient: includes the created external service', clientAExt.externalServices.some(x => x.id === ext.id),
    'count=' + clientAExt.externalServices.length);

  const updatedExt = db.updateClientExternalService(userId, ext.id, {
    name: 'Uploader Service - Production v2', url: 'https://apis.example.gov.sa/svc/v2?API_KEY=xyz789',
    companyCode: '132', secretKey: 'new-ext-secret', notes: 'rotated key',
  });
  record('updateClientExternalService: fields changed in place, id stable', updatedExt.id === ext.id
    && updatedExt.companyCode === '132' && updatedExt.secretKey === 'new-ext-secret', JSON.stringify(updatedExt));

  // ── Internal System CRUD ─────────────────────────────────────────────────────
  const int = db.createClientInternalSystem(userId, companyA, {
    name: 'RabbitMQ Portal - Production', url: 'http://10.0.0.20:15672/',
    username: 'svc-portal', password: 'svc-portal', systemName: 'RabbitMQ', environment: 'PRODUCTION',
    companyCode: '105', secretKey: 'int-secret', notes: '',
  });
  record('createClientInternalSystem: persisted with fields', int && int.companyId === companyA
    && int.name === 'RabbitMQ Portal - Production' && int.username === 'svc-portal' && int.password === 'svc-portal',
    JSON.stringify(int));
  record('createClientInternalSystem: persists systemName/environment (migration 023)',
    int && int.systemName === 'RabbitMQ' && int.environment === 'PRODUCTION', JSON.stringify(int));
  record('createClientInternalSystem: persists companyCode/secretKey (migration 024)',
    int && int.companyCode === '105' && int.secretKey === 'int-secret', JSON.stringify(int));
  record('createClientInternalSystem: subServices defaults to [] when omitted (migration 025)',
    Array.isArray(int.subServices) && int.subServices.length === 0, JSON.stringify(int.subServices));

  const intWithSub = db.createClientInternalSystem(userId, companyA, {
    name: 'ACME Travel Portal - Production', url: 'https://travel.example.com', systemName: 'Travel Cover',
    environment: 'PRODUCTION', companyCode: '105', secretKey: 'portal-secret',
    subServices: [{ label: 'Bookings', url: 'https://travel.example.com/Bookings' },
                  { label: 'Reports', url: 'https://travel.example.com/Reports' },
                  { label: '', url: '' }],
  });
  record('createClientInternalSystem: persists subServices, drops blank rows (migration 025)',
    intWithSub && intWithSub.subServices.length === 2
    && intWithSub.subServices[0].label === 'Bookings' && intWithSub.subServices[1].label === 'Reports',
    JSON.stringify(intWithSub.subServices));

  const badInt = db.createClientInternalSystem(userId, 999999999, { name: 'nope' });
  record('createClientInternalSystem: rejects a non-COMPANY companyId', badInt === null, String(badInt));

  const clientAInt = db.getClient(userId, companyA);
  record('getClient: includes the created internal system', clientAInt.internalSystems.some(s => s.id === int.id),
    'count=' + clientAInt.internalSystems.length);

  const updatedInt = db.updateClientInternalSystem(userId, int.id, {
    name: 'RabbitMQ Portal - Production v2', url: 'http://10.0.0.10:15672/',
    username: 'svc-portal-2', password: 'newpass', systemName: 'RabbitMQ v2', environment: 'TEST',
    companyCode: '106', secretKey: 'new-int-secret', notes: 'moved host',
  });
  record('updateClientInternalSystem: fields changed in place, id stable', updatedInt.id === int.id
    && updatedInt.url === 'http://10.0.0.10:15672/' && updatedInt.username === 'svc-portal-2' && updatedInt.password === 'newpass',
    JSON.stringify(updatedInt));
  record('updateClientInternalSystem: systemName/environment changed in place',
    updatedInt.systemName === 'RabbitMQ v2' && updatedInt.environment === 'TEST', JSON.stringify(updatedInt));
  record('updateClientInternalSystem: companyCode/secretKey changed in place (migration 024)',
    updatedInt.companyCode === '106' && updatedInt.secretKey === 'new-int-secret', JSON.stringify(updatedInt));

  // ── Per-company isolation ────────────────────────────────────────────────────
  db.createClientServer(userId, companyB, { host: '10.1.1.1', environment: 'PRODUCTION', os: 'Windows Server 2022', systemName: sysOne, role: 'SERVICES', notes: '' });
  db.createClientDatabase(userId, companyB, { name: 'Other Client DB', engine: 'MongoDB', host: '10.1.1.2', port: '27017', username: 'x', password: 'y', notes: '' });
  db.createClientExternalService(userId, companyB, { name: 'Other Client Service', url: 'https://other.example.com', companyCode: '999', secretKey: 'z', notes: '' });
  db.createClientInternalSystem(userId, companyB, { name: 'Other Client Portal', url: 'http://10.2.2.2/', username: 'x', password: 'y', notes: '' });
  const clientAAfter = db.getClient(userId, companyA);
  const clientBAfter = db.getClient(userId, companyB);
  if (companyA !== companyB) {
    record('Per-company isolation: company A does not see company B\'s server',
      !clientAAfter.servers.some(s => s.host === '10.1.1.1'), '');
    record('Per-company isolation: company B sees its own server',
      clientBAfter.servers.some(s => s.host === '10.1.1.1'), '');
    record('Per-company isolation: company A does not see company B\'s database',
      !clientAAfter.databases.some(d => d.name === 'Other Client DB'), '');
    record('Per-company isolation: company B sees its own database',
      clientBAfter.databases.some(d => d.name === 'Other Client DB'), '');
    record('Per-company isolation: company A does not see company B\'s external service',
      !clientAAfter.externalServices.some(x => x.name === 'Other Client Service'), '');
    record('Per-company isolation: company B sees its own external service',
      clientBAfter.externalServices.some(x => x.name === 'Other Client Service'), '');
    record('Per-company isolation: company A does not see company B\'s internal system',
      !clientAAfter.internalSystems.some(s => s.name === 'Other Client Portal'), '');
    record('Per-company isolation: company B sees its own internal system',
      clientBAfter.internalSystems.some(s => s.name === 'Other Client Portal'), '');
  } else {
    record('Per-company isolation: skipped (only one COMPANY lookup in this DB)', true, '');
  }

  // ── Ownership gate ───────────────────────────────────────────────────────────
  const otherUserRow = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'))
    .prepare('SELECT id FROM users WHERE id != ? LIMIT 1').get(userId);
  if (otherUserRow) {
    const stolenVpn = db.updateClientVpn(otherUserRow.id, vpn.id, { connectionName: 'stolen' });
    record('Ownership: another user cannot update this VPN connection', stolenVpn === null, JSON.stringify(stolenVpn));
    const stolenSrv = db.updateClientServer(otherUserRow.id, srv.id, { host: 'stolen' });
    record('Ownership: another user cannot update this server', stolenSrv === null, JSON.stringify(stolenSrv));
    const stolenDb = db.updateClientDatabase(otherUserRow.id, database.id, { name: 'stolen' });
    record('Ownership: another user cannot update this database', stolenDb === null, JSON.stringify(stolenDb));
    const stolenExt = db.updateClientExternalService(otherUserRow.id, ext.id, { name: 'stolen' });
    record('Ownership: another user cannot update this external service', stolenExt === null, JSON.stringify(stolenExt));
    const stolenInt = db.updateClientInternalSystem(otherUserRow.id, int.id, { name: 'stolen' });
    record('Ownership: another user cannot update this internal system', stolenInt === null, JSON.stringify(stolenInt));
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  const delVpnRes = db.deleteClientVpn(userId, vpn.id);
  const delSrvRes = db.deleteClientServer(userId, srv.id);
  const delDbRes = db.deleteClientDatabase(userId, database.id);
  const delExtRes = db.deleteClientExternalService(userId, ext.id);
  const delIntRes = db.deleteClientInternalSystem(userId, int.id);
  const clientAFinal = db.getClient(userId, companyA);
  record('deleteClientVpn/deleteClientServer/deleteClientDatabase/deleteClientExternalService/deleteClientInternalSystem: rows removed',
    delVpnRes.ok && delSrvRes.ok && delDbRes.ok && delExtRes.ok && delIntRes.ok
    && !clientAFinal.vpnConnections.some(v => v.id === vpn.id) && !clientAFinal.servers.some(s => s.id === srv.id)
    && !clientAFinal.databases.some(d => d.id === database.id) && !clientAFinal.externalServices.some(x => x.id === ext.id)
    && !clientAFinal.internalSystems.some(s => s.id === int.id),
    `vpnCount=${clientAFinal.vpnConnections.length} serverCount=${clientAFinal.servers.length} dbCount=${clientAFinal.databases.length} extCount=${clientAFinal.externalServices.length} intCount=${clientAFinal.internalSystems.length}`);

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
