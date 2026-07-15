// ─────────────────────────────────────────────────────────────────────────────
// Attention center — headless data-layer smoke test (Milestone 3).
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron, no IPC, no
// renderer. Verifies db.getAttentionItems() correctly aggregates every
// date-urgent source (subscription renewals, Company Document renewals, and
// the three client_* tables with an expiry_date) into one list, tagged with
// enough info (type/date/module/companyId) for the renderer to compute
// urgency (daysUntil/renewClass/renewLabel, already generic helpers) and
// deep-link without any source-specific IPC calls of its own.
//
// SAFETY: never touches production. Copies the live DB into a throwaway temp
// dir and runs everything there; the temp dir is deleted at the end.
//
// Run:  node test/attention-center-smoke.js
//
// Gates exercised:
//   1. A seeded subscription/company document/VPN/internal-system, each with a
//      distinct renewal/expiry date, all appear in getAttentionItems() with the
//      right type/title/date/module.
//   2. Client-sourced items carry companyId (for the deep-link into that
//      specific client's detail view); subscription/companyDocument items
//      do not.
//   3. A record with no renewal/expiry date set at all is correctly excluded
//      (not mis-tiered as some default date).
//   4. client_servers (no expiry_date column) never contributes items — only
//      the two client_* tables that have the column AND still have a UI do.
//      (client_external_services has the column but its section was retired,
//      so it's no longer read as a source at all.)
//   5. Per-user isolation: a second user's records never leak into the
//      first user's attention list.
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
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attn-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
console.log('Working copy: ' + path.join(workDir, 'cooperation-tools.db'));

let exitCode = 0;
try {
  db.openConnection(workDir);
  db.applyMigrations();

  const raw = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const userRow = raw.prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  raw.close();
  if (!userRow) throw new Error('no active user in the copied DB');
  const userId = userRow.id;
  console.log('Using userId=' + userId + '\n');

  const companyId = db.getLookupsByCategory('COMPANY')[0]?.id;
  if (!companyId) throw new Error('no COMPANY lookup to attach test records to');

  // ── Seed one distinctly-dated record per attention source ───────────────────
  const before = db.getAttentionItems(userId).length;

  const subs = db.loadSubscriptions(userId).subscriptions || [];
  db.saveSubscriptions(userId, {
    subscriptions: [...subs, { id: 'attn-test-sub', name: 'ATTN test subscription', cost: 10, currency: 'USD', billingCycle: 'MONTHLY', endDate: '', renewalDate: '2099-01-01' }],
    defaultCurrency: 'USD',
  });

  const doc = db.createCompanyDocument(userId, { name: 'ATTN test document', category: '', renewalDate: '2099-02-02', notes: '' });
  const noDateDoc = db.createCompanyDocument(userId, { name: 'ATTN doc with no renewal date', category: '', renewalDate: '', notes: '' });

  const vpn = db.createClientVpn(userId, companyId, { connectionName: 'ATTN test vpn', password: '', expiryDate: '2099-03-03' });
  const int_ = db.createClientInternalSystem(userId, companyId, { name: 'ATTN test internal', password: '', secretKey: '', expiryDate: '2099-05-05' });
  // No-expiry-date controls on the two tables that DO have the column and a UI,
  // plus client_servers, which has no expiry_date column at all.
  const vpnNoDate = db.createClientVpn(userId, companyId, { connectionName: 'ATTN vpn no expiry', password: '' });
  // A server IS its (System, Role, Environment) triple since migrations 038/039 —
  // all three required — so seeding one needs a real SYSTEM this client has no
  // server under, or the create is (correctly) refused and this gate would pass
  // vacuously, proving nothing about client_servers.
  const usedSystems = new Set(db.getClient(userId, companyId).servers.map(s => s.systemName));
  const freeSystem = db.getLookupsByCategory('SYSTEM').find(s => !usedSystems.has(s.label));
  if (!freeSystem) throw new Error('need an unused SYSTEM lookup in this copy');
  const server = db.createClientServer(userId, companyId, {
    systemName: freeSystem.label, role: 'APPLICATIONS', environment: 'PRODUCTION', password: '',
  });
  if (!server?.id) throw new Error('could not seed the server control');

  const items = db.getAttentionItems(userId);

  const findByTitle = (title) => items.find(i => i.title === title);

  const subItem = findByTitle('ATTN test subscription');
  record('Gate 1a: seeded subscription appears with type=subscription, correct date/module',
    !!subItem && subItem.type === 'subscription' && subItem.date === '2099-01-01' && subItem.module === 'subscriptions',
    JSON.stringify(subItem));

  const docItem = findByTitle('ATTN test document');
  record('Gate 1b: seeded company document appears with type=companyDocument, correct date/module',
    !!docItem && docItem.type === 'companyDocument' && docItem.date === '2099-02-02' && docItem.module === 'companydocs',
    JSON.stringify(docItem));

  const vpnItem = findByTitle('ATTN test vpn');
  record('Gate 1c: seeded VPN/Auth record appears with type=clientVpn, correct date/module',
    !!vpnItem && vpnItem.type === 'clientVpn' && vpnItem.date === '2099-03-03' && vpnItem.module === 'clients',
    JSON.stringify(vpnItem));

  const intItem = findByTitle('ATTN test internal');
  record('Gate 1d: seeded Internal System appears with type=clientInternal, correct date/module',
    !!intItem && intItem.type === 'clientInternal' && intItem.date === '2099-05-05' && intItem.module === 'clients',
    JSON.stringify(intItem));

  record('Gate 2: client-sourced items carry companyId; subscription/companyDocument items do not',
    vpnItem.companyId === companyId && intItem.companyId === companyId
      && subItem.companyId == null && docItem.companyId == null,
    `vpn.companyId=${vpnItem.companyId} sub.companyId=${subItem.companyId} doc.companyId=${docItem.companyId}`);

  record('Gate 3: a record with no renewal/expiry date set is excluded entirely',
    !findByTitle('ATTN doc with no renewal date') && !findByTitle('ATTN vpn no expiry'),
    `noDateDocFound=${!!findByTitle('ATTN doc with no renewal date')} noDateVpnFound=${!!findByTitle('ATTN vpn no expiry')}`);

  // A server has no name to look up by, so this checks the item TYPES instead —
  // which is the real claim anyway: the table is not a source at all.
  const serverItems = items.filter(i => i.type === 'server' || i.type === 'database');
  record('Gate 4a: client_servers (no expiry_date column) never contributes items',
    serverItems.length === 0,
    `server/database-typed items=${serverItems.length} (seeded server #${server.id})`);

  // The retired External Services section: client_external_services still HAS an
  // expiry_date column and could still hold a legacy row, so this seeds one by raw
  // SQL (the CRUD is gone) and asserts getAttentionItems() no longer reads it.
  const raw2 = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  raw2.prepare(
    `INSERT INTO client_external_services(user_id, company_id, name, url, company_code, secret_key, expiry_date, contact, notes, sort_order, created_at, updated_at)
     VALUES(?, ?, 'ATTN retired external', '', '', '', '2099-04-04', '', '', 0, ?, ?)`
  ).run(userId, companyId, new Date().toISOString(), new Date().toISOString());
  raw2.close();
  const afterExt = db.getAttentionItems(userId);
  record('Gate 4b: a legacy client_external_services row (retired section) contributes no item',
    !afterExt.some(i => i.title === 'ATTN retired external') && !afterExt.some(i => i.type === 'clientExternal'),
    `foundByTitle=${afterExt.some(i => i.title === 'ATTN retired external')} clientExternalTyped=${afterExt.filter(i => i.type === 'clientExternal').length}`);

  record('Gate (sanity): exactly 4 new attention items were added by this seed (4 dated records)',
    items.length === before + 4, `before=${before} after=${items.length}`);

  // ── Gate 5 — per-user isolation ──────────────────────────────────────────────
  const otherUsername = 'attn-smoke-other-' + Date.now();
  const otherUserId = db.createUser(otherUsername, 'hashed-not-real');
  const otherItemsBefore = db.getAttentionItems(otherUserId);
  record('Gate 5: a second user sees none of the first user\'s attention items',
    otherItemsBefore.every(i => i.title.indexOf('ATTN test') === -1),
    `otherUserItemCount=${otherItemsBefore.length}`);

} catch (err) {
  console.error('\nTEST HARNESS ERROR: ' + (err && err.stack || err));
  exitCode = 2;
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n════════════════════ ATTENTION CENTER SMOKE RESULTS ════════════════════');
let failed = 0;
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  if (!r.pass) failed++;
  console.log(`[${tag}] ${r.flow}\n        ${r.details}`);
}
console.log('─────────────────────────────────────────────────────────────────────────');
console.log(`${results.length - failed}/${results.length} flows passed` + (failed ? `  (${failed} FAILED)` : '  — all green'));
if (failed > 0 && exitCode === 0) exitCode = 1;
process.exit(exitCode);
