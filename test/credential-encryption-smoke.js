// ─────────────────────────────────────────────────────────────────────────────
// Credential encryption at rest — headless data-layer smoke test (Milestone 2,
// migration 032 + db.js's encryptAllPendingCredentials()).
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron, no IPC, no
// renderer. db.js never touches the real `electron` module (only main.js
// does, via db.configureCredentialEncryption(electron.safeStorage) at boot),
// so this test injects a FAKE safeStorage-shaped cipher (isEncryptionAvailable/
// encryptString/decryptString) to exercise the real encrypt/decrypt code path
// without needing a genuine Electron process.
//
// SAFETY: never touches production. Copies the live DB into a throwaway temp
// dir and runs everything there; the temp dir is deleted at the end.
//
// Run:  node test/credential-encryption-smoke.js
//
// Gates exercised:
//   1. With NO cipher configured (safeStorage "unavailable"): passwords
//      round-trip as literal plain text through create/read, unchanged.
//   2. Configuring a cipher, then applying migrations for the first time:
//      migration 032 encrypts every already-plaintext password/secret_key
//      across all five tables, then takes an encrypted rollback backup
//      tables (idempotent on re-run — no double-encryption).
//   3. db.js's encryptAllPendingCredentials() (NOT just the one-shot
//      migration) is what actually does the encrypting — proven by manually
//      downgrading an already-encrypted value back to raw plaintext and
//      confirming a second call (simulating a later boot's runMaintenance())
//      catches it, since migrations never re-run but this does.
//   4. Fresh create/update calls round-trip transparently, and
//      client_field_history rows stay the fixed '(hidden)' placeholder,
//      completely unaffected by encryption — including no spurious history
//      row when the same password is saved again unchanged (the diff must
//      compare decrypted plaintext, not ciphertext-vs-plaintext).
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

const prodDir = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one');
const prodDb  = path.join(prodDir, 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: production DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-enc-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
const dbFilePath = path.join(workDir, 'cooperation-tools.db');
console.log('Working copy: ' + dbFilePath);

// A simple, fully-reversible fake cipher — not real cryptography, just enough
// to exercise the marker-prefix/encrypt-decrypt plumbing end to end.
const FAKE_TAG = 'FAKE1:';
const fakeCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (str) => Buffer.from(FAKE_TAG + str, 'utf8'),
  decryptString: (buf) => {
    const s = buf.toString('utf8');
    if (!s.startsWith(FAKE_TAG)) throw new Error('fakeCipher: not our ciphertext');
    return s.slice(FAKE_TAG.length);
  },
};

let exitCode = 0;
try {
  db.openConnection(workDir);

  const rawUser = new DatabaseSync(dbFilePath);
  const userRow = rawUser.prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  const alreadyAt032 = !!rawUser.prepare("SELECT 1 FROM schema_migrations WHERE version = 32").get();
  rawUser.close();
  if (!userRow) throw new Error('no active user in the copied DB');
  const userId = userRow.id;
  console.log('Using userId=' + userId + '\n');

  const companyId = db.getLookupsByCategory('COMPANY')[0]?.id;
  if (!companyId) throw new Error('no COMPANY lookup to attach test records to');
  // Since migrations 038/039 a server IS its (System, Role, Environment) triple —
  // all three required and unique per client — so the seed below needs a real
  // SYSTEM this client has no server under, or the create is (correctly) refused.
  const usedSystems = new Set(db.getClient(userId, companyId).servers.map(s => s.systemName));
  const freeSystem = db.getLookupsByCategory('SYSTEM').find(s => !usedSystems.has(s.label));
  if (!freeSystem) throw new Error('need an unused SYSTEM lookup in this copy');

  // ── Gate 1 — no cipher configured: literal plain-text passthrough ──────────
  db.configureCredentialEncryption(null);
  record('Gate 1a: isCredentialEncryptionAvailable() is false with no cipher configured',
    db.isCredentialEncryptionAvailable() === false, 'available=' + db.isCredentialEncryptionAvailable());

  const plainVpn = db.createClientVpn(userId, companyId, { connectionName: 'CE plain test', password: 'plain-pw-123', notes: 'no cipher' });
  const rawPlainRow = new DatabaseSync(dbFilePath).prepare('SELECT password FROM client_vpn_connections WHERE id = ?').get(plainVpn.id);
  record('Gate 1b: with no cipher, password round-trips unchanged and is stored as literal plain text',
    plainVpn.password === 'plain-pw-123' && rawPlainRow.password === 'plain-pw-123',
    `apiValue="${plainVpn.password}" rawStoredValue="${rawPlainRow.password}"`);

  // Seed one plaintext credential per table via a normal create call (still no
  // cipher) — these simulate pre-existing rows written before encryption was
  // ever wired up, which is exactly the population migration 032 must catch.
  // client_databases/client_external_services are seeded by RAW SQL: their
  // sections are retired and the CRUD is gone, but both tables stay in db.js's
  // CREDENTIAL_COLUMNS so the pass still catches a legacy plaintext credential
  // that outlived its section — which is exactly what these two rows stand in for.
  const rawSeed = new DatabaseSync(dbFilePath);
  const nowIso = new Date().toISOString();
  const seedDbId = Number(rawSeed.prepare(
    `INSERT INTO client_databases(user_id, company_id, name, engine, host, port, username, password, version, credential_location, notes, sort_order, created_at, updated_at)
     VALUES(?, ?, 'CE seed db', '', '', '', '', 'seed-db-pw', '', '', '', 0, ?, ?)`
  ).run(userId, companyId, nowIso, nowIso).lastInsertRowid);
  const seedExtId = Number(rawSeed.prepare(
    `INSERT INTO client_external_services(user_id, company_id, name, url, company_code, secret_key, expiry_date, contact, notes, sort_order, created_at, updated_at)
     VALUES(?, ?, 'CE seed ext', '', '', 'seed-ext-secret', NULL, '', '', 0, ?, ?)`
  ).run(userId, companyId, nowIso, nowIso).lastInsertRowid);
  rawSeed.close();
  const seeded = {
    vpn: db.createClientVpn(userId, companyId, { connectionName: 'CE seed vpn', password: 'seed-vpn-pw' }),
    server: db.createClientServer(userId, companyId, {
      systemName: freeSystem.label, role: 'APPLICATIONS', environment: 'PRODUCTION', password: 'seed-server-pw',
    }),
    database: { id: seedDbId },
    external: { id: seedExtId },
    internal: db.createClientInternalSystem(userId, companyId, { name: 'CE seed int', password: 'seed-int-pw', secretKey: 'seed-int-secret' }),
  };
  // A refused create returns {ok:false}, not a record — without this the later
  // gates would quietly skip whichever table failed to seed instead of failing.
  for (const [k, v] of Object.entries(seeded)) {
    if (!v || !v.id) throw new Error(`could not seed the ${k} record: ${JSON.stringify(v)}`);
  }

  // ── Gate 2 — configure the fake cipher, apply migrations for the first time ─
  db.configureCredentialEncryption(fakeCipher);
  record('Gate 2a: isCredentialEncryptionAvailable() is true once a cipher is configured',
    db.isCredentialEncryptionAvailable() === true, 'available=' + db.isCredentialEncryptionAvailable());

  db.applyMigrations(); // migration 032 runs here for the first time (or is a no-op if this copy is already past it)
  record('Gate 2b: applying migrations with a cipher configured does not throw', true, 'no throw');

  if (!alreadyAt032) {
    const rawAfter = new DatabaseSync(dbFilePath);
    const checks = [
      ['client_vpn_connections', 'password', seeded.vpn.id, 'seed-vpn-pw'],
      ['client_servers', 'password', seeded.server.id, 'seed-server-pw'],
      ['client_databases', 'password', seeded.database.id, 'seed-db-pw'],
      ['client_external_services', 'secret_key', seeded.external.id, 'seed-ext-secret'],
      ['client_internal_systems', 'password', seeded.internal.id, 'seed-int-pw'],
      ['client_internal_systems', 'secret_key', seeded.internal.id, 'seed-int-secret'],
    ];
    const allEncrypted = checks.every(([table, col, id, plain]) => {
      const row = rawAfter.prepare(`SELECT ${col} AS v FROM ${table} WHERE id = ?`).get(id);
      return row.v.startsWith('enc:v1:') && row.v !== plain && !row.v.includes(plain);
    });
    rawAfter.close();
    record('Gate 2c: migration 032 encrypted every pre-existing plaintext credential (marker prefix, no raw plaintext left in the DB file)',
      allEncrypted, `allEncrypted=${allEncrypted}`);

    const backupDir = path.join(workDir, 'pre-encryption-backup');
    const backupFiles = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
    const backupName = backupFiles.find(f => f.startsWith('cooperation-tools-PRE-032-ENCRYPT-') && f.endsWith('.db'));
    let backupEncrypted = false;
    if (backupName) {
      const backupDb = new DatabaseSync(path.join(backupDir, backupName));
      const backupRow = backupDb.prepare('SELECT password AS v FROM client_vpn_connections WHERE id = ?').get(seeded.vpn.id);
      backupEncrypted = !!backupRow && backupRow.v.startsWith('enc:v1:') && !backupRow.v.includes('seed-vpn-pw');
      backupDb.close();
    }
    record('Gate 2d: migration 032 rollback backup exists and contains encrypted, not plaintext, credentials',
      !!backupName && backupEncrypted, `file=${backupName || '(missing)'} encrypted=${backupEncrypted}`);

    // Idempotent re-run: applying again must not double-encrypt (no nested marker).
    db.applyMigrations();
    const rawTwice = new DatabaseSync(dbFilePath);
    const vpnRow = rawTwice.prepare('SELECT password AS v FROM client_vpn_connections WHERE id = ?').get(seeded.vpn.id);
    rawTwice.close();
    record('Gate 2e: re-applying migrations is idempotent (no double-encryption)',
      !vpnRow.v.includes('enc:v1:enc:v1:'), `value starts with: ${vpnRow.v.slice(0, 20)}...`);

    const vpnApi = db.getClient(userId, companyId).vpnConnections.find(v => v.id === seeded.vpn.id);
    const internalApi = db.getClient(userId, companyId).internalSystems.find(v => v.id === seeded.internal.id);
    record('Gate 2f: getClient decrypts transparently — the renderer never sees ciphertext',
      vpnApi && vpnApi.password === 'seed-vpn-pw' && internalApi && internalApi.password === 'seed-int-pw' && internalApi.secretKey === 'seed-int-secret',
      `vpnPassword="${vpnApi && vpnApi.password}" internalPassword="${internalApi && internalApi.password}" internalSecret="${internalApi && internalApi.secretKey}"`);
  } else {
    record('Gate 2c-2f: skipped (this DB copy already had migration 032 applied before this run)', true, 'alreadyAt032=true');
  }

  // ── Gate 3 — encryptAllPendingCredentials() self-heals across "boots", ──────
  // unlike the one-shot migration — proven by manually downgrading an
  // encrypted value back to raw plaintext (simulating a row that somehow
  // stayed unencrypted through 032, e.g. created in a cipher-unavailable
  // window) and confirming a fresh call still catches it.
  {
    const rawDowngrade = new DatabaseSync(dbFilePath);
    rawDowngrade.prepare('UPDATE client_vpn_connections SET password = ? WHERE id = ?').run('downgraded-plain-pw', seeded.vpn.id);
    rawDowngrade.close();
    const res = db.encryptAllPendingCredentials();
    const rawCheck = new DatabaseSync(dbFilePath).prepare('SELECT password AS v FROM client_vpn_connections WHERE id = ?').get(seeded.vpn.id);
    record('Gate 3: encryptAllPendingCredentials() catches a manually-downgraded plaintext value on a later call (self-healing, not one-shot)',
      res.encrypted >= 1 && rawCheck.v.startsWith('enc:v1:') && !rawCheck.v.includes('downgraded-plain-pw'),
      `encryptedCount=${res.encrypted} rawValue="${rawCheck.v.slice(0, 20)}..."`);
  }

  // Older releases already left plaintext rollback copies on disk. Simulate
  // one and prove the maintenance sanitizer preserves the DB while encrypting
  // its credential cells in place.
  {
    const backupDir = path.join(workDir, 'pre-encryption-backup');
    fs.mkdirSync(backupDir, { recursive: true });
    const legacyPath = path.join(backupDir, 'cooperation-tools-PRE-032-ENCRYPT-LEGACY.db');
    db.backup(legacyPath);
    const legacyRaw = new DatabaseSync(legacyPath);
    legacyRaw.prepare('UPDATE client_vpn_connections SET password = ? WHERE id = ?').run('legacy-backup-plain', seeded.vpn.id);
    legacyRaw.close();
    const sanitized = db.sanitizeLegacyCredentialBackups();
    const sanitizedRaw = new DatabaseSync(legacyPath);
    const sanitizedRow = sanitizedRaw.prepare('SELECT password AS v FROM client_vpn_connections WHERE id = ?').get(seeded.vpn.id);
    sanitizedRaw.close();
    record('Gate 3b: maintenance sanitizes a legacy plaintext migration backup in place',
      sanitized.files >= 1 && sanitized.encrypted >= 1 && sanitizedRow.v.startsWith('enc:v1:') && !sanitizedRow.v.includes('legacy-backup-plain'),
      `files=${sanitized.files} encrypted=${sanitized.encrypted}`);
  }

  // ── Gate 4 — create/update round-trip with the cipher live ──────────────────
  const vpn2 = db.createClientVpn(userId, companyId, { connectionName: 'CE round-trip vpn', password: 'rt-secret-1' });
  const rawVpn2 = new DatabaseSync(dbFilePath).prepare('SELECT password FROM client_vpn_connections WHERE id = ?').get(vpn2.id);
  const roundTripOk = vpn2.password === 'rt-secret-1' && rawVpn2.password.startsWith('enc:v1:') && !rawVpn2.password.includes('rt-secret-1');
  record('Gate 4a: createClientVpn encrypts on write, getClient/ToApi decrypts on read (round-trip transparent)',
    roundTripOk, `apiPassword="${vpn2.password}" rawStored="${rawVpn2.password.slice(0, 20)}..."`);

  const updated = db.updateClientVpn(userId, vpn2.id, { connectionName: 'CE round-trip vpn v2', password: 'rt-secret-2' });
  const historyRows = db.getClientFieldHistory(userId, 'vpn', vpn2.id);
  const pwHistoryRow = historyRows.find(r => r.fieldName === 'Password');
  record('Gate 4b: updateClientVpn re-encrypts the new password; client_field_history still only ever stores \'(hidden)\'',
    updated.password === 'rt-secret-2' && !!pwHistoryRow && pwHistoryRow.oldValue === '(hidden)' && pwHistoryRow.newValue === '(hidden)',
    `updatedPassword="${updated.password}" historyOld="${pwHistoryRow && pwHistoryRow.oldValue}" historyNew="${pwHistoryRow && pwHistoryRow.newValue}"`);

  // Saving with the SAME password again must not spuriously record a history
  // row (the diff must compare decrypted plaintext, not ciphertext-vs-plaintext).
  const historyCountBefore = db.getClientFieldHistory(userId, 'vpn', vpn2.id).length;
  db.updateClientVpn(userId, vpn2.id, { connectionName: 'CE round-trip vpn v2', password: 'rt-secret-2' });
  const historyCountAfter = db.getClientFieldHistory(userId, 'vpn', vpn2.id).length;
  record('Gate 4c: re-saving the identical password does not record a spurious history row (diff compares plaintext, not ciphertext)',
    historyCountAfter === historyCountBefore, `before=${historyCountBefore} after=${historyCountAfter}`);

} catch (err) {
  console.error('\nTEST HARNESS ERROR: ' + (err && err.stack || err));
  exitCode = 2;
} finally {
  try { db.configureCredentialEncryption(null); } catch { /* ignore */ }
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n════════════════════ CREDENTIAL ENCRYPTION SMOKE RESULTS ════════════════════');
let failed = 0;
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  if (!r.pass) failed++;
  console.log(`[${tag}] ${r.flow}\n        ${r.details}`);
}
console.log('───────────────────────────────────────────────────────────────────────────');
console.log(`${results.length - failed}/${results.length} flows passed` + (failed ? `  (${failed} FAILED)` : '  — all green'));
if (failed > 0 && exitCode === 0) exitCode = 1;
process.exit(exitCode);
