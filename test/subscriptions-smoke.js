// ─────────────────────────────────────────────────────────────────────────────
// Subscriptions — headless data-layer CRUD smoke test (Finding 28, full-app
// audit: "low priority, small effort" — no dedicated coverage existed before).
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron/IPC/renderer.
// SAFETY: never touches production. Copies the live DB into a throwaway temp
// dir and runs everything there; the temp dir is deleted at the end.
//
// Run:  node test/subscriptions-smoke.js
//
// Gates: create/update/delete via loadSubscriptions/saveSubscriptions (the
// whole-list replace-and-diff shape the renderer actually uses), defaultCurrency
// persistence, and per-user ownership isolation (one user's saveSubscriptions
// can't delete or see another user's rows).
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
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
console.log('Working copy: ' + path.join(workDir, 'cooperation-tools.db'));

let exitCode = 0;
try {
  db.openConnection(workDir);
  db.applyMigrations();

  const userRow = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'))
    .prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  if (!userRow) throw new Error('no active user in the copied DB');
  const userId = userRow.id;
  const otherUserRow = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'))
    .prepare('SELECT id FROM users WHERE id != ? LIMIT 1').get(userId);
  console.log('Using userId=' + userId + '\n');

  // ── Create ───────────────────────────────────────────────────────────────
  const before = db.loadSubscriptions(userId);
  const subA = {
    id: 'sub-smoke-a', name: 'Adobe Creative Cloud', cost: 54.99,
    currency: 'USD', billingCycle: 'MONTHLY', endDate: null, renewalDate: '2027-01-15',
  };
  db.saveSubscriptions(userId, { subscriptions: [...before.subscriptions, subA], defaultCurrency: 'USD' });
  const afterCreate = db.loadSubscriptions(userId);
  const createdA = afterCreate.subscriptions.find(s => s.id === subA.id);
  record('saveSubscriptions: create persists all fields',
    !!createdA && createdA.name === subA.name && createdA.cost === subA.cost
    && createdA.currency === subA.currency && createdA.billingCycle === subA.billingCycle
    && createdA.renewalDate === subA.renewalDate,
    JSON.stringify(createdA));

  // ── Update (whole-list replace, same id) ────────────────────────────────
  const subAUpdated = { ...subA, name: 'Adobe Creative Cloud (Team)', cost: 89.99, billingCycle: 'YEARLY', currency: 'EUR' };
  db.saveSubscriptions(userId, {
    subscriptions: afterCreate.subscriptions.map(s => (s.id === subA.id ? subAUpdated : s)),
    defaultCurrency: 'EUR',
  });
  const afterUpdate = db.loadSubscriptions(userId);
  const updatedA = afterUpdate.subscriptions.find(s => s.id === subA.id);
  record('saveSubscriptions: update changes fields in place, id stable',
    !!updatedA && updatedA.id === subA.id && updatedA.name === subAUpdated.name
    && updatedA.cost === subAUpdated.cost && updatedA.billingCycle === subAUpdated.billingCycle
    && updatedA.currency === subAUpdated.currency,
    JSON.stringify(updatedA));
  record('saveSubscriptions: defaultCurrency persists', afterUpdate.defaultCurrency === 'EUR', afterUpdate.defaultCurrency);

  // ── Second row, then delete-by-omission (whole-list diff) ──────────────
  const subB = {
    id: 'sub-smoke-b', name: 'GitHub Team', cost: 4, currency: 'USD',
    billingCycle: 'MONTHLY', endDate: null, renewalDate: '2027-03-01',
  };
  db.saveSubscriptions(userId, { subscriptions: [...afterUpdate.subscriptions, subB], defaultCurrency: 'EUR' });
  const afterAddB = db.loadSubscriptions(userId);
  record('saveSubscriptions: second row added alongside the first',
    afterAddB.subscriptions.some(s => s.id === subA.id) && afterAddB.subscriptions.some(s => s.id === subB.id),
    `count=${afterAddB.subscriptions.length}`);

  db.saveSubscriptions(userId, {
    subscriptions: afterAddB.subscriptions.filter(s => s.id !== subA.id),
    defaultCurrency: 'EUR',
  });
  const afterDeleteA = db.loadSubscriptions(userId);
  record('saveSubscriptions: omitting a row from the list deletes it',
    !afterDeleteA.subscriptions.some(s => s.id === subA.id) && afterDeleteA.subscriptions.some(s => s.id === subB.id),
    `count=${afterDeleteA.subscriptions.length}`);

  // ── Ownership gate ───────────────────────────────────────────────────────
  if (otherUserRow) {
    let ownershipErr = null;
    try {
      db.saveSubscriptions(otherUserRow.id, {
        subscriptions: [{ ...subB, name: 'stolen' }],
        defaultCurrency: 'USD',
      });
    } catch (err) {
      ownershipErr = err;
    }
    record('saveSubscriptions: another user cannot claim/overwrite this subscription id',
      !!ownershipErr, ownershipErr ? ownershipErr.message : '(no error thrown)');
    const subBStillOwnedByUser = db.loadSubscriptions(userId).subscriptions.find(s => s.id === subB.id);
    record('saveSubscriptions: subscription unaffected after the rejected cross-user write',
      !!subBStillOwnedByUser && subBStillOwnedByUser.name === subB.name, JSON.stringify(subBStillOwnedByUser));
  } else {
    record('Ownership gate: skipped (only one user in this DB copy)', true, '');
  }

  // ── Cleanup: remove the remaining smoke row ─────────────────────────────
  db.saveSubscriptions(userId, {
    subscriptions: db.loadSubscriptions(userId).subscriptions.filter(s => s.id !== subB.id),
    defaultCurrency: afterDeleteA.defaultCurrency,
  });
  const afterCleanup = db.loadSubscriptions(userId);
  record('saveSubscriptions: cleanup removes the last smoke row',
    !afterCleanup.subscriptions.some(s => s.id === subA.id || s.id === subB.id),
    `count=${afterCleanup.subscriptions.length}`);

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
