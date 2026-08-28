// ─────────────────────────────────────────────────────────────────────────────
// Portable credentials — headless data-layer smoke test.
//
// The failure this exists to prevent, in full:
//
//   safeStorage's key is per-Windows-account and per-machine, and it lives in
//   `Local State` INSIDE the userData folder. So a database can be completely
//   intact and still unopenable — it came from another machine in a Full
//   Backup, or its folder was renamed and the key was left behind. That second
//   case actually happened, on the 2026-08-25 `timesheet` → `office-one`
//   rename, and cost 73 credentials until the old key file was copied by hand.
//
//   What made it look like data loss rather than a wrong key was the read path:
//   decryptCredentialValue() answered a failed decrypt by returning the STORED
//   VALUE, so the Clients page rendered the raw `enc:v1:…` blob under a reveal
//   button as though it were the password.
//
// Gates exercised:
//   1. readCredential() reports a foreign-key blob as unreadable and NEVER
//      returns the ciphertext as the value.  ← the regression that bit
//   2. nextCredentialValue() preserves an unreadable credential when an
//      unrelated edit saves an empty value, instead of destroying it.
//   3. exportPortableCredentials() rewrites `enc:v1:` → `enc:p1:` in a bundle's
//      copy, leaving no machine-bound credential behind.
//   4. A wrong passphrase is rejected by the manifest verifier.
//   5. Full round-trip: export under machine A's key, import under machine B's,
//      and the plaintext comes back exactly.
//   6. Export refuses rather than half-converting when a credential cannot be
//      read on this machine.
//
// SAFETY: never touches production. Copies the live DB into a throwaway temp
// dir and runs everything there; the temp dir is deleted at the end.
//
// Run:  node test/portable-credentials-smoke.js
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Guards against reading/copying the REAL production DB when this file is run
// directly instead of via run-all.js — must come before any homedir path.
require('./test-bootstrap');

const db = require('../db');

const results = [];
function record(flow, pass, details) { results.push({ flow, pass, details }); }

const prodDir = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one');
const prodDb  = path.join(prodDir, 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: production DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-cred-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
const dbFilePath = path.join(workDir, 'cooperation-tools.db');
console.log('Working copy: ' + dbFilePath);

// Two fake safeStorage-shaped ciphers standing in for two different machines.
// Each refuses the other's ciphertext, which is exactly how a real DPAPI key
// mismatch presents.
function makeCipher(tag) {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (str) => Buffer.from(tag + str, 'utf8'),
    decryptString: (buf) => {
      const s = buf.toString('utf8');
      if (!s.startsWith(tag)) throw new Error('wrong machine key');
      return s.slice(tag.length);
    },
  };
}
const machineA = makeCipher('MACHINE-A:');
const machineB = makeCipher('MACHINE-B:');

// Every ad-hoc read opens and CLOSES its own handle: an open DatabaseSync keeps
// a Windows file lock that makes the temp-dir cleanup fail with EPERM.
function readPassword(file, id) {
  const h = new DatabaseSync(file);
  try { return h.prepare('SELECT password FROM client_vpn_connections WHERE id = ?').get(id).password; }
  finally { h.close(); }
}

// Leaves only the one VPN row this test seeded, so the round-trip runs on a
// credential the fake ciphers actually own rather than whatever the fixture DB
// happened to carry.
function clearCredentialsExceptVpn(file, keepVpnId) {
  const h = new DatabaseSync(file);
  try {
    h.prepare("UPDATE client_vpn_connections SET password = '' WHERE id != ?").run(keepVpnId);
    h.prepare("UPDATE client_servers SET password = ''").run();
    h.prepare("UPDATE client_internal_systems SET password = '', secret_key = ''").run();
  } finally { h.close(); }
}

// A credential sealed with a key this process is NOT currently configured with.
function plantForeignCredential(file, vpnId, cipherBuf) {
  const h = new DatabaseSync(file);
  try {
    h.prepare('UPDATE client_vpn_connections SET password = ? WHERE id = ?')
      .run('enc:v1:' + cipherBuf.toString('base64'), vpnId);
  } finally { h.close(); }
}

function countPrefix(file, prefix) {
  const h = new DatabaseSync(file);
  try {
    // The markers are fixed literals with no LIKE wildcards — no ESCAPE needed.
    return h.prepare(
      'SELECT COUNT(*) AS c FROM client_vpn_connections WHERE password LIKE ?'
    ).get(prefix + '%').c;
  } finally { h.close(); }
}

const PASSPHRASE = 'correct horse battery staple';
const SECRET = 'sup3r-s3cret-pw!';

let exitCode = 0;
try {
  db.openConnection(workDir);
  db.applyMigrations();

  const raw = new DatabaseSync(dbFilePath);
  let userRow;
  try { userRow = raw.prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get(); }
  finally { raw.close(); }
  if (!userRow) throw new Error('no active user in the copied DB');
  const userId = userRow.id;

  const companyId = db.getLookupsByCategory('COMPANY')[0]?.id;
  if (!companyId) throw new Error('no COMPANY lookup to attach test records to');

  // ── Seed one credential under machine A's key ──────────────────────────────
  db.configureCredentialEncryption(machineA);
  const vpn = db.createClientVpn(userId, companyId, {
    connectionName: 'Portable test ' + Date.now(), password: SECRET, notes: 'portable smoke',
  });
  record('seed: credential round-trips under its own machine key',
    vpn.password === SECRET && vpn.passwordUnreadable === false,
    `value="${vpn.password}" unreadable=${vpn.passwordUnreadable}`);

  const storedA = readPassword(dbFilePath, vpn.id);

  // ── Gate 1 — a foreign key reads as unreadable, never as the ciphertext ────
  db.configureCredentialEncryption(machineB);
  const foreign = db.readCredential(storedA);
  record('Gate 1a: a credential from another machine reports unreadable',
    foreign.unreadable === true && foreign.reason === 'foreign-key',
    `unreadable=${foreign.unreadable} reason=${foreign.reason}`);
  record('Gate 1b: its ciphertext is NEVER handed back as the value',
    foreign.value === '' && !String(foreign.value).includes('enc:v1:'),
    `value="${foreign.value}"`);

  const apiRow = db.getClient(userId, companyId).vpnConnections.find(v => v.id === vpn.id);
  record('Gate 1c: the API surfaces the unreadable flag instead of the blob',
    apiRow && apiRow.password === '' && apiRow.passwordUnreadable === true,
    `password="${apiRow?.password}" flag=${apiRow?.passwordUnreadable}`);

  // ── Gate 2 — an unrelated save must not destroy what it cannot read ────────
  db.updateClientVpn(userId, vpn.id, {
    connectionName: 'Portable test renamed', password: '', notes: 'edited without touching the password',
  });
  const afterEdit = readPassword(dbFilePath, vpn.id);
  record('Gate 2: an unrelated edit preserves an unreadable credential',
    afterEdit === storedA,
    afterEdit === storedA ? 'ciphertext untouched' : `DESTROYED: was ${storedA.length}B, now "${afterEdit}"`);

  // ── Build a bundle copy carrying only credentials this test owns ──────────
  // db.backup(), NOT copyFileSync: the connection is in WAL mode, so a raw file
  // copy silently omits every uncheckpointed write — including the seed above.
  db.configureCredentialEncryption(machineA); // back on the machine that owns the key
  const bundleDb = path.join(workDir, 'bundle-copy.db');
  db.backup(bundleDb);
  clearCredentialsExceptVpn(bundleDb, vpn.id);

  // ── Gate 3 — export rewrites every credential to the portable form ────────
  const exported = db.exportPortableCredentials(bundleDb, PASSPHRASE);
  record('Gate 3a: export succeeds and reports what it converted',
    exported.ok === true && exported.converted > 0,
    `ok=${exported.ok} converted=${exported.converted} err=${exported.error || '-'}`);

  record('Gate 3b: no machine-bound credential is left in the bundle',
    countPrefix(bundleDb, 'enc:v1:') === 0 && countPrefix(bundleDb, 'enc:p1:') > 0,
    `enc:v1:=${countPrefix(bundleDb, 'enc:v1:')} enc:p1:=${countPrefix(bundleDb, 'enc:p1:')}`);

  record('Gate 3c: the envelope carries salt + KDF params + verifier, never the passphrase',
    !!exported.envelope.salt && !!exported.envelope.kdf && !!exported.envelope.verifier
      && !JSON.stringify(exported.envelope).includes(PASSPHRASE),
    'kdf=' + JSON.stringify(exported.envelope.kdf));

  // ── Gate 4 — a wrong passphrase is refused ────────────────────────────────
  db.configureCredentialEncryption(machineB); // now on the receiving machine
  const wrong = db.importPortableCredentials(bundleDb, 'not the passphrase', exported.envelope);
  record('Gate 4a: a wrong passphrase is rejected outright',
    wrong.ok === false && /does not match/i.test(wrong.error || ''),
    `ok=${wrong.ok} error="${wrong.error}"`);
  record('Gate 4b: a rejected passphrase changes nothing in the bundle',
    countPrefix(bundleDb, 'enc:p1:') > 0 && countPrefix(bundleDb, 'enc:v1:') === 0,
    'still portable, still locked');

  // ── Gate 5 — full round-trip onto a different machine key ─────────────────
  const imported = db.importPortableCredentials(bundleDb, PASSPHRASE, exported.envelope);
  record('Gate 5a: the correct passphrase unlocks the bundle',
    imported.ok === true && imported.converted > 0,
    `ok=${imported.ok} converted=${imported.converted} err=${imported.error || '-'}`);

  const restored = readPassword(bundleDb, vpn.id);
  record('Gate 5b: the restored credential is re-wrapped under the RECEIVING machine key',
    restored.startsWith('enc:v1:') && db.readCredential(restored).value === SECRET,
    `prefix=${restored.slice(0, 7)} plaintext="${db.readCredential(restored).value}"`);

  record('Gate 5c: machine A can no longer read what machine B re-wrapped',
    (() => {
      db.configureCredentialEncryption(machineA);
      const back = db.readCredential(restored);
      db.configureCredentialEncryption(machineB);
      return back.unreadable === true;
    })(),
    'a credential belongs to exactly one machine at a time');

  // ── Gate 6 — export refuses rather than half-converting ───────────────────
  // A bundle whose credentials cannot all be read here must not be written at
  // all: shipping it would put a backup on the desktop that quietly lacks the
  // passwords its owner believes are in it.
  const refuseDb = path.join(workDir, 'refuse-copy.db');
  db.backup(refuseDb);
  clearCredentialsExceptVpn(refuseDb, vpn.id);
  plantForeignCredential(refuseDb, vpn.id, machineA.encryptString(SECRET)); // machineB is active
  const refused = db.exportPortableCredentials(refuseDb, PASSPHRASE);
  record('Gate 6a: export refuses when a credential cannot be read on this machine',
    refused.ok === false && refused.unreadable > 0,
    `ok=${refused.ok} unreadable=${refused.unreadable} err="${refused.error || '-'}"`);
  record('Gate 6b: a refused export converts nothing',
    countPrefix(refuseDb, 'enc:p1:') === 0,
    'the copy is left exactly as it was');

  // Cleanup the seeded row so a re-run against a fresh copy stays clean.
  db.configureCredentialEncryption(machineA);
  db.deleteClientVpn(userId, vpn.id);
} catch (err) {
  record('harness', false, String(err?.stack || err));
  exitCode = 1;
} finally {
  try { db.close(); } catch {}
  try { fs.rmSync(workDir, { recursive: true, force: true }); }
  catch (err) { console.warn('note: temp dir left behind (' + err.code + '): ' + workDir); }
}

for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.flow}${r.details ? '  — ' + r.details : ''}`);
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} portable-credential gates passed.`);
if (failed.length || exitCode) {
  console.error('FAILED: ' + (failed.map(f => f.flow).join('; ') || 'harness error'));
  process.exit(1);
}
