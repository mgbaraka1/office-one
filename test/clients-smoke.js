// ─────────────────────────────────────────────────────────────────────────────
// Clients (Auth + Server Information + Internal Systems) — headless data-layer
// smoke test (Phase 6, verification gates 1-3; gate 4 is the CDP walkthrough).
// The Databases and External Services sections were retired (UI + IPC + CRUD
// removed, rows deleted); their tables survive in the schema, unread.
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
//   client_internal_systems, ownership gating, and the "clients ARE the COMPANY
//   roster" behavior (no standalone clients table — getClient rejects a
//   non-COMPANY id).
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const db = require('../db');

const results = [];
function record(flow, pass, details) { results.push({ flow, pass, details }); }

// Guards against reading/copying the REAL production DB when this file is
// run directly (node test/<this file>) instead of via run-all.js — see
// test-bootstrap.js.
require('./test-bootstrap');

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
  const intTally = new Map(rawCounts.prepare(
    'SELECT company_id, COUNT(*) AS c FROM client_internal_systems WHERE user_id = ? GROUP BY company_id'
  ).all(userId).map(r => [r.company_id, r.c]));
  rawCounts.close();
  record('listClients: counts match raw per-company tallies (zero-activity companies still included)',
    clientList.every(c => c.vpnCount === (vpnTally.get(c.id) || 0) && c.serverCount === (srvTally.get(c.id) || 0)
      && c.internalSystemCount === (intTally.get(c.id) || 0)),
    JSON.stringify(clientList));

  // A company added through Settings becomes a zero-activity Client without a
  // second create operation or a row in a separate clients table.
  const autoClientLabel = 'Auto Client Smoke ' + Date.now();
  db.saveLookups(userId, { categories: {
    COMPANY: [{ id: null, code: null, label: autoClientLabel, sortOrder: companies.length, isActive: true }],
  } });
  const autoClient = db.listClients(userId).find(c => c.label === autoClientLabel);
  record('new COMPANY lookup automatically becomes a Client',
    !!autoClient && autoClient.vpnCount === 0 && autoClient.serverCount === 0 && autoClient.internalSystemCount === 0,
    JSON.stringify(autoClient));

  const bogusClient = db.getClient(userId, 999999999);
  record('getClient: rejects a non-COMPANY id (no standalone clients table)', bogusClient === null, String(bogusClient));

  // ── Roster CRUD (the Clients page owns the COMPANY catalog) ─────────────────
  // Settings has no Companies tab: creating, renaming, archiving and reordering
  // a client all run through these four. Every one returns { ok, ... } instead
  // of throwing, so a refusal is never a partial write.
  const stamp = Date.now();
  const newCode = 'ROSTER_' + stamp;
  const created = db.createClient(userId, { code: newCode, nameEn: 'Roster Smoke ' + stamp, nameAr: 'عميل الاختبار' });
  record('createClient: creates an active client with both names',
    created.ok && created.client.code === newCode
      && created.client.nameEn === 'Roster Smoke ' + stamp
      && created.client.nameAr === 'عميل الاختبار'
      && created.client.isActive === true,
    JSON.stringify(created));
  const newClientId = created.client?.id;

  record('createClient: the new client is immediately a Client in the roster',
    db.listClients(userId).some(c => c.id === newClientId));

  // Refusals. Each must leave the catalog exactly as it was.
  const countBeforeRefusals = db.getLookupsByCategory('COMPANY', true).length;
  const badCode = db.createClient(userId, { code: 'has spaces!', nameEn: 'Bad Code ' + stamp });
  record('createClient: rejects a malformed company code', badCode.ok === false && !!badCode.error, badCode.error);
  const dupCode = db.createClient(userId, { code: newCode, nameEn: 'Different Name ' + stamp });
  record('createClient: rejects a duplicate company code',
    dupCode.ok === false && /already in use/i.test(dupCode.error || ''), dupCode.error);
  const dupCodeCase = db.createClient(userId, { code: newCode.toLowerCase(), nameEn: 'Case Clash ' + stamp });
  record('createClient: duplicate code detection is case-insensitive',
    dupCodeCase.ok === false && /already in use/i.test(dupCodeCase.error || ''), dupCodeCase.error);
  const blankName = db.createClient(userId, { code: 'BLANK_' + stamp, nameEn: '   ' });
  record('createClient: rejects a blank English name', blankName.ok === false && !!blankName.error, blankName.error);
  const dupLabel = db.createClient(userId, { code: 'OTHER_' + stamp, nameEn: 'ROSTER SMOKE ' + stamp });
  record('createClient: rejects a case-insensitively colliding name',
    dupLabel.ok === false && /already exists/i.test(dupLabel.error || ''), dupLabel.error);
  record('createClient: every refusal left the catalog unchanged',
    db.getLookupsByCategory('COMPANY', true).length === countBeforeRefusals);

  // Rename: names change, code never does — the point of the whole exercise.
  const renamed = db.renameClient(userId, newClientId, { nameEn: 'Roster Renamed ' + stamp, nameAr: 'الاسم الجديد' });
  record('renameClient: updates both names and leaves the code alone',
    renamed.ok && renamed.client.nameEn === 'Roster Renamed ' + stamp
      && renamed.client.nameAr === 'الاسم الجديد' && renamed.client.code === newCode,
    JSON.stringify(renamed.client));
  const renameBlank = db.renameClient(userId, newClientId, { nameEn: '' });
  record('renameClient: rejects a blank English name', renameBlank.ok === false, renameBlank.error);
  const renameUnknown = db.renameClient(userId, 999999999, { nameEn: 'Nope' });
  record('renameClient: rejects a non-COMPANY id', renameUnknown.ok === false, renameUnknown.error);

  // Archive / restore round trip. Archiving is a soft-disable, so the row is
  // still there — it just leaves the default roster and the company dropdowns.
  const archived = db.setClientActive(userId, newClientId, false);
  record('setClientActive: archiving hides the client from the default roster',
    archived.ok && !db.listClients(userId).some(c => c.id === newClientId));
  record('setClientActive: an archived client still exists, via includeArchived',
    db.listClients(userId, true).some(c => c.id === newClientId && c.isActive === false));
  record('getClient: reports an archived client as inactive but still returns it',
    db.getClient(userId, newClientId)?.isActive === false);
  const restored = db.setClientActive(userId, newClientId, true);
  record('setClientActive: restoring puts the client back in the roster',
    restored.ok && db.listClients(userId).some(c => c.id === newClientId));

  // Reorder decides the order of every company dropdown in the app.
  const rosterIds = db.listClients(userId).map(c => c.id);
  if (rosterIds.length >= 2) {
    const reversed = rosterIds.slice().reverse();
    const reorder = db.reorderClients(userId, reversed);
    record('reorderClients: the roster comes back in the requested order',
      reorder.ok && JSON.stringify(db.listClients(userId).map(c => c.id)) === JSON.stringify(reversed),
      JSON.stringify(db.listClients(userId).map(c => c.id)));
    // A stale list from an open tab must not be able to wedge the catalog.
    const withJunk = db.reorderClients(userId, [999999999, ...rosterIds]);
    record('reorderClients: skips ids that are not COMPANY rows',
      withJunk.ok && JSON.stringify(db.listClients(userId).map(c => c.id)) === JSON.stringify(rosterIds));

    // Arranging happens with archived clients hidden, so a reorder that names
    // only the visible rows must not disturb where the hidden ones sit — it
    // reuses the named rows' own sort_order slots instead of renumbering 0..n.
    db.setClientActive(userId, newClientId, false);
    const hiddenSortBefore = db.getLookupsByCategory('COMPANY', true)
      .find(c => c.id === newClientId)?.sortOrder;
    const visibleIds = db.listClients(userId).map(c => c.id);
    db.reorderClients(userId, visibleIds.slice().reverse());
    const hiddenSortAfter = db.getLookupsByCategory('COMPANY', true)
      .find(c => c.id === newClientId)?.sortOrder;
    record('reorderClients: leaves an archived client\'s position untouched',
      hiddenSortBefore === hiddenSortAfter, `before=${hiddenSortBefore} after=${hiddenSortAfter}`);
    record('reorderClients: still reorders the visible rows it was given',
      JSON.stringify(db.listClients(userId).map(c => c.id)) === JSON.stringify(visibleIds.slice().reverse()));
    db.setClientActive(userId, newClientId, true);
  } else {
    record('reorderClients: skipped (fewer than two clients in this DB)', true, '');
  }
  record('reorderClients: rejects a non-array order', db.reorderClients(userId, 'nope').ok === false);

  // The code column must be unreachable by every update path, not just by the
  // ones that decline to offer it.
  const codeAfterEverything = db.listClients(userId, true).find(c => c.id === newClientId)?.code;
  record('a company code survives rename, archive, restore and reorder untouched',
    codeAfterEverything === newCode, `code=${codeAfterEverything}`);

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
  db.createClientInternalSystem(userId, companyB, { name: 'Other Client Portal', url: 'http://10.2.2.2/', username: 'x', password: 'y', notes: '' });
  const clientAAfter = db.getClient(userId, companyA);
  const clientBAfter = db.getClient(userId, companyB);
  if (companyA !== companyB) {
    record('Per-company isolation: company A does not see company B\'s server',
      !clientAAfter.servers.some(s => s.host === '10.1.1.1'), '');
    record('Per-company isolation: company B sees its own server',
      clientBAfter.servers.some(s => s.host === '10.1.1.1'), '');
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
    const stolenInt = db.updateClientInternalSystem(otherUserRow.id, int.id, { name: 'stolen' });
    record('Ownership: another user cannot update this internal system', stolenInt === null, JSON.stringify(stolenInt));
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  const delVpnRes = db.deleteClientVpn(userId, vpn.id);
  const delSrvRes = db.deleteClientServer(userId, srv.id);
  const delIntRes = db.deleteClientInternalSystem(userId, int.id);
  const clientAFinal = db.getClient(userId, companyA);
  record('deleteClientVpn/deleteClientServer/deleteClientInternalSystem: rows removed',
    delVpnRes.ok && delSrvRes.ok && delIntRes.ok
    && !clientAFinal.vpnConnections.some(v => v.id === vpn.id) && !clientAFinal.servers.some(s => s.id === srv.id)
    && !clientAFinal.internalSystems.some(s => s.id === int.id),
    `vpnCount=${clientAFinal.vpnConnections.length} serverCount=${clientAFinal.servers.length} intCount=${clientAFinal.internalSystems.length}`);

  // ── Retired sections: the two removed CRUD surfaces are gone, and getClient
  //    no longer returns their arrays at all (not just an empty one).
  const retiredFns = [
    'createClientDatabase', 'updateClientDatabase', 'deleteClientDatabase',
    'createClientExternalService', 'updateClientExternalService', 'deleteClientExternalService',
  ];
  record('Retired: db.js exposes no Database/External Service CRUD',
    retiredFns.every(fn => db[fn] === undefined),
    'still exported: ' + (retiredFns.filter(fn => db[fn] !== undefined).join(', ') || '(none)'));
  record('Retired: getClient returns no databases/externalServices keys, and no count fields on listClients',
    !('databases' in clientAFinal) && !('externalServices' in clientAFinal)
      && db.listClients(userId).every(c => !('databaseCount' in c) && !('externalServiceCount' in c)),
    'clientKeys=' + Object.keys(clientAFinal).join(','));

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
