'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Server wheel (Client → Servers → Wheel) — headless smoke test.
//
// Loads renderer/features/server-wheel.js into a bare VM context with the few
// renderer globals it reads stubbed, and checks serverWheelModel.
//
// Run:  node test/server-wheel-smoke.js
//
// Covers: one arc per System by name with no-system last; a Linked Servers
// entry matching another server's IP joins the two once, however many sides
// list it; a shared hostname (a cluster name) reaches every server carrying
// it; an entry matching no server becomes one "other host" holding every
// server that lists it; external parties merge case-insensitively; a server
// never links to itself; no host or party arc when nothing needs one.
// ─────────────────────────────────────────────────────────────────────────────
const fs   = require('node:fs');
const path = require('node:path');
const vm   = require('node:vm');

const results = [];
function record(flow, pass, details = '') { results.push({ flow, pass, details }); }

try {
  const ctx = vm.createContext({
    lkLabel: (cat, code) => (cat === 'SYSTEM' ? code : ({ SERVICES: 'Services', DATABASES: 'Databases', APPLICATIONS: 'Applications' })[code]) || '',
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'features', 'server-wheel.js'), 'utf8'), ctx);
  const model = vm.runInContext('serverWheelModel', ctx);

  const srv = (id, systemName, role, host, extra = {}) => ({
    id, systemName, role, host, hostname: '', environment: 'PRODUCTION', linkedServers: [], externalParties: [], ...extra,
  });
  const servers = [
    srv(1, 'Booking', 'APPLICATIONS', '10.0.0.11', { linkedServers: ['10.0.0.12', 'core-db.example.local'], externalParties: ['Party Alpha'] }),
    srv(2, 'Booking', 'DATABASES', '10.0.0.12', { linkedServers: ['10.0.0.11', '10.0.0.12'] }),
    srv(3, 'Portal', 'DATABASES', '10.0.0.21', { hostname: 'SQL-01' }),
    srv(4, 'Portal', 'DATABASES', '10.0.0.22', { hostname: 'sql-01', environment: 'TEST' }),
    srv(5, 'Billing', 'SERVICES', '10.0.0.31', { linkedServers: ['SQL-01', 'Core-DB.example.local'], externalParties: [' party alpha ', 'Party Beta'] }),
    srv(6, '', 'SERVICES', '10.0.0.41'),
  ];
  const { arcs, links } = model(servers);
  const order = arcs.map(a => a.kind + ':' + a.label);
  record('Arcs: Systems by name with no-system last, then other hosts, then external parties',
    JSON.stringify(order) === JSON.stringify(['system:Billing', 'system:Booking', 'system:Portal', 'system:No system', 'hosts:Other hosts', 'parties:External Parties']),
    JSON.stringify(order));

  const has = (a, b) => links.some(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
  const pairCount = links.filter(l => [l.a, l.b].sort().join() === 's1,s2').length;
  record('Two servers listing each other are joined by one line', pairCount === 1, JSON.stringify(links));
  record('A server listing its own IP never links to itself', !links.some(l => l.a === l.b));
  record('A shared hostname (cluster name) reaches every server carrying it, case-insensitively',
    has('s5', 's3') && has('s5', 's4'), JSON.stringify(links));

  const hosts = arcs.find(a => a.kind === 'hosts');
  record('An entry matching no server becomes one other host holding every server that lists it',
    hosts.nodes.length === 1 && hosts.nodes[0].servers.length === 2 && has('s1', hosts.nodes[0].key) && has('s5', hosts.nodes[0].key),
    JSON.stringify(hosts.nodes.map(n => [n.label, n.servers.length])));

  const parties = arcs.find(a => a.kind === 'parties');
  const alpha = parties.nodes.find(n => n.label === 'Party Alpha');
  record('External parties merge case- and space-insensitively',
    parties.nodes.length === 2 && alpha && alpha.servers.length === 2, JSON.stringify(parties.nodes.map(n => [n.label, n.servers.length])));

  const booking = arcs.find(a => a.label === 'Booking');
  record('A server is named by IP and role, with the environment only when not Production',
    booking.nodes.map(n => n.label).join('|') === '10.0.0.11 · Applications|10.0.0.12 · Databases'
      && arcs.find(a => a.label === 'Portal').nodes.some(n => n.label === '10.0.0.22 · Databases · UAT'),
    booking.nodes.map(n => n.label).join('|'));

  record('System slots follow arc order (fixed hues, never by size)',
    arcs.filter(a => a.kind === 'system').map(a => a.slot).join(',') === '1,2,3,4');

  const lonely = model([srv(7, 'Booking', 'SERVICES', '10.0.0.51')]);
  record('No host or party arc when nothing needs one', lonely.arcs.length === 1 && lonely.links.length === 0,
    JSON.stringify(lonely.arcs.map(a => a.kind)));
} catch (err) {
  record('Unexpected error', false, err.stack || String(err));
}

let exitCode = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.flow}${r.pass ? '' : '\n      ' + r.details}`);
  if (!r.pass) exitCode = 1;
}
if (!results.length) exitCode = 1;
process.exit(exitCode);
