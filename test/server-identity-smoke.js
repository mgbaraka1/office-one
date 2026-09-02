// ─────────────────────────────────────────────────────────────────────────────
// Server identity (System - Role - Environment) — headless data-layer smoke test.
//
// Boots the app's data layer (db.js) DIRECTLY — no Electron, no IPC, no
// renderer. Copies the live DB into a throwaway temp dir and runs there;
// never touches production.
//
// Run:  node test/server-identity-smoke.js
//
// Covers migration 038 + the Clients server data layer it reshaped: Role stopped
// being free text and became the SERVER_ROLE lookup, and a server is now
// identified by the (System, Role, Environment) triple — all three required,
// unique within a client.
//
// Gates exercised:
//   1. Migration 038 applies cleanly and is idempotent (a second applyMigrations
//      is a no-op), and pre-existing client_servers rows are all still there.
//   2. SERVER_ROLE seeds the 3 spec'd roles active, plus the 2 mapping-only ones.
//   3. Every pre-existing server ends up with all three identity parts filled —
//      real values where they existed, nullN placeholders where they didn't.
//   4. The pre-038 free-text roles mapped onto real (non-placeholder) codes;
//      nothing that had a role text was left on a placeholder.
//   5. Every placeholder is distinct, soft-disabled, and the legacy `role` text
//      column was never rewritten.
//   6. No two servers under one client share a triple (the whole point).
//   7. createClientServer rejects an incomplete triple, and a duplicate one,
//      without writing anything.
//   8. updateClientServer rejects a duplicate triple and leaves the row intact;
//      a genuine role change goes through and is audited BY LABEL, not raw id.
//   9. The same triple under a DIFFERENT client is allowed (scoped per client).
//  10. assignClientServerGroup/renameClientServerSystemGroup refuse a bulk move
//      that would collide, without half-applying it.
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
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-identity-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
const dbFilePath = path.join(workDir, 'cooperation-tools.db');
console.log('Working copy (fully disposable): ' + dbFilePath);

const isPlaceholder = v => /^null\d+$/i.test(String(v ?? '').trim());

let exitCode = 0;
try {
  // Row count + legacy role text BEFORE the migration runs, so gates 1/3/5 can
  // compare against the real pre-038 state rather than trusting the after-state.
  const pre = new DatabaseSync(dbFilePath);
  const preHead = pre.prepare('SELECT MAX(version) v FROM schema_migrations').get().v;
  const preServers = pre.prepare('SELECT id, role FROM client_servers ORDER BY id').all();
  pre.close();
  const alreadyApplied = preHead >= 38;
  console.log(`Copy is at migration head ${preHead}${alreadyApplied ? ' (038 already applied — backfill assertions relax accordingly)' : ''}`);
  console.log(`Pre-existing servers: ${preServers.length}\n`);

  db.openConnection(workDir);
  db.applyMigrations();
  db.applyMigrations();   // Gate 1: second run must be a no-op, not a throw

  const raw = new DatabaseSync(dbFilePath);
  const userRow = raw.prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  if (!userRow) throw new Error('no active user in the copied DB');
  const userId = userRow.id;
  console.log('Using userId=' + userId + '\n');

  // ── Gate 1 — migration applied, nothing lost ────────────────────────────
  {
    const head = raw.prepare('SELECT MAX(version) v FROM schema_migrations').get().v;
    const now = raw.prepare('SELECT COUNT(*) c FROM client_servers').get().c;
    record('Gate 1: migrations 038+039 apply + are idempotent, and no pre-existing server row was lost',
      head >= 39 && now === preServers.length,
      `head=${head} servers before=${preServers.length} after=${now}`);
  }

  // ── Gate 2 — SERVER_ROLE catalog ────────────────────────────────────────
  {
    const active = db.getLookupsByCategory('SERVER_ROLE').map(o => o.code);
    const spec = ['APPLICATIONS', 'DATABASES', 'SERVICES'];
    const mappingOnly = ['RABBITMQ', 'APPLICATION_DATABASE'];
    record('Gate 2: SERVER_ROLE seeds Applications/Databases/Services (+ the 2 legacy-mapping roles) as active options',
      spec.every(c => active.includes(c)) && mappingOnly.every(c => active.includes(c)),
      `active codes=${JSON.stringify(active.filter(c => !/^NULL\d+$/.test(c)))}`);
  }

  // ── Gate 3 — every server has a complete identity ────────────────────────
  {
    const rows = raw.prepare(
      `SELECT s.id, s.system_name, s.environment, s.role_id, l.label AS role_label
         FROM client_servers s LEFT JOIN lookup_codes l ON l.id = s.role_id
        WHERE s.id IN (${preServers.map(r => r.id).join(',') || '-1'})`
    ).all();
    const incomplete = rows.filter(r =>
      !String(r.system_name ?? '').trim() || !String(r.environment ?? '').trim() || r.role_id == null);
    record('Gate 3: every pre-existing server has all three identity parts filled (real value or nullN placeholder)',
      preServers.length === 0 || incomplete.length === 0,
      `checked=${rows.length} incomplete=${incomplete.length}` +
      (incomplete.length ? ' -> ' + JSON.stringify(incomplete.slice(0, 3)) : ''));
  }

  // ── Gate 4 — legacy free-text roles mapped onto real codes ──────────────
  {
    const hadRoleIds = preServers.filter(r => String(r.role ?? '').trim()).map(r => r.id);
    const rows = hadRoleIds.length
      ? raw.prepare(
          `SELECT s.id, s.role, l.label AS role_label, l.is_active
             FROM client_servers s LEFT JOIN lookup_codes l ON l.id = s.role_id
            WHERE s.id IN (${hadRoleIds.join(',')})`
        ).all()
      : [];
    const stranded = rows.filter(r => isPlaceholder(r.role_label) || !r.is_active);
    record('Gate 4: every server that had a free-text role mapped onto a real (non-placeholder) SERVER_ROLE code',
      // Already-applied copies may have had roles re-picked by hand since; the
      // gate then only asserts none regressed onto a placeholder.
      stranded.length === 0,
      `had free-text role=${rows.length} stranded on placeholder=${stranded.length}` +
      (rows.length ? ' e.g. ' + JSON.stringify(rows.slice(0, 3).map(r => `${r.role} -> ${r.role_label}`)) : ''));
  }

  // ── Gate 5 — placeholders are distinct, disabled, and non-destructive ────
  {
    const ph = raw.prepare(
      "SELECT id, label, is_active FROM lookup_codes WHERE category = 'SERVER_ROLE' AND label LIKE 'null%'"
    ).all();
    const labels = ph.map(r => r.label.toLowerCase());
    const allDistinct = new Set(labels).size === labels.length;
    const allDisabled = ph.every(r => !r.is_active);
    // The pre-038 free-text column must be byte-for-byte untouched (inert legacy).
    const afterRoles = new Map(raw.prepare('SELECT id, role FROM client_servers').all().map(r => [r.id, r.role]));
    const legacyIntact = preServers.every(r => (afterRoles.get(r.id) ?? null) === (r.role ?? null));
    record('Gate 5: nullN role placeholders are distinct + soft-disabled, and the legacy free-text role column was never rewritten',
      allDistinct && allDisabled && legacyIntact,
      `placeholders=${ph.length} distinct=${allDistinct} allDisabled=${allDisabled} legacyColumnIntact=${legacyIntact}`);
  }

  // ── Gate 6 — the triples are actually unique ─────────────────────────────
  {
    const dups = raw.prepare(
      `SELECT COUNT(*) c FROM (
         SELECT user_id, company_id, LOWER(TRIM(system_name)) s, role_id, LOWER(TRIM(environment)) e
           FROM client_servers
          GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1)`
    ).get().c;
    record('Gate 6: no two servers under one client share a System / Role / Environment triple',
      dups === 0, `duplicate triples=${dups}`);
  }

  // ── Gate 6b — System is lookup-backed (migration 039) ───────────────────
  {
    const rows = raw.prepare(
      `SELECT s.id, s.system_id, s.system_name AS legacy, l.category, l.label, l.is_active
         FROM client_servers s LEFT JOIN lookup_codes l ON l.id = s.system_id`
    ).all();
    const unmapped = rows.filter(r => r.system_id == null);
    const wrongCat = rows.filter(r => r.system_id != null && r.category !== 'SYSTEM');
    // The confirmed consolidations must actually have happened.
    const mapped = new Map(rows.map(r => [String(r.legacy || '').toLowerCase(), r.label]));
    const expected = { 'webshop': 'Online Platform', 'agggregators': 'Aggregators', 'paygate': 'Payment Gateway',
                       'travel cover': 'Travel', 'travel cover servers': 'Travel' };
    const wrong = Object.entries(expected)
      .filter(([from, to]) => mapped.has(from) && mapped.get(from) !== to)
      .map(([from, to]) => from + ' -> ' + mapped.get(from) + ' (want ' + to + ')');
    record('Gate 6b: every server points at a real SYSTEM lookup row, and the confirmed consolidations landed',
      unmapped.length === 0 && wrongCat.length === 0 && wrong.length === 0,
      `servers=${rows.length} unmapped=${unmapped.length} wrongCategory=${wrongCat.length}` +
      (wrong.length ? ' MISMAPPED: ' + wrong.join('; ') : ' consolidations ok'));
  }

  // ── Gate 6c — free text is no longer a valid system ─────────────────────
  {
    const companies0 = db.getLookupsByCategory('COMPANY');
    const res = db.createClientServer(userId, companies0[0].id, {
      systemName: 'Not A Real System ' + Date.now(),
      role: 'APPLICATIONS', environment: 'PRODUCTION',
    });
    record('Gate 6c: a System that is not a SYSTEM lookup row is refused (free text no longer accepted)',
      res.ok === false, `result=${JSON.stringify(res)}`);
  }

  // A client to write test rows against, and a second one for gate 9.
  const companies = db.getLookupsByCategory('COMPANY');
  if (companies.length < 2) throw new Error('need 2 COMPANY lookups in this copy');
  const [coA, coB] = companies;
  // Three SYSTEM lookups this client has no servers under, so the write gates
  // below start from a clean slate. Systems are lookup rows since migration 039,
  // so the tests use real catalog entries rather than made-up strings.
  const usedByA = new Set(db.getClient(userId, coA.id).servers.map(s => s.systemName));
  const freeSystems = db.getLookupsByCategory('SYSTEM').filter(s => !usedByA.has(s.label));
  if (freeSystems.length < 3) throw new Error('need 3 unused SYSTEM lookups in this copy');
  const [sysA, sysB, sysC] = freeSystems;

  // ── Gate 7 — create: incomplete + duplicate both refused ─────────────────
  {
    const base = { systemName: sysA.label, role: 'APPLICATIONS', environment: 'PRODUCTION' };
    const noRole = db.createClientServer(userId, coA.id, { ...base, role: '' });
    const noSystem = db.createClientServer(userId, coA.id, { ...base, systemName: '  ' });
    const created = db.createClientServer(userId, coA.id, base);
    // The triple IS the whole payload's identity — nothing else distinguishes a
    // second server with the same one, so re-sending `base` verbatim is the dupe.
    const dupe = db.createClientServer(userId, coA.id, base);
    // Case + whitespace must not be a loophole around the triple.
    const dupeCase = db.createClientServer(userId, coA.id, { ...base, systemName: ' ' + sysA.label.toUpperCase() + ' ' });
    const count = raw.prepare('SELECT COUNT(*) c FROM client_servers WHERE system_id = ? AND company_id = ?')
      .get(sysA.id, coA.id).c;
    record('Gate 7: createClientServer refuses an incomplete triple and a duplicate one (incl. case/whitespace variants), writing nothing',
      noRole.ok === false && noSystem.ok === false && created.id > 0 &&
      dupe.ok === false && dupeCase.ok === false && count === 1,
      `noRole=${noRole.ok} noSystem=${noSystem.ok} created=#${created.id} dupe=${dupe.ok} dupeCaseVariant=${dupeCase.ok} rowsWritten=${count}`);
  }

  // ── Gate 8 — update: duplicate refused; a real change is audited by label ──
  {
    db.createClientServer(userId, coA.id, {
systemName: sysA.label, role: 'APPLICATIONS', environment: 'TEST',
    });
    const second = db.createClientServer(userId, coA.id, {
systemName: sysA.label, role: 'DATABASES', environment: 'TEST',
    });
    // Point `second` at Smoke B's exact triple — must be refused.
    const clash = db.updateClientServer(userId, second.id, {
systemName: sysA.label, role: 'APPLICATIONS', environment: 'TEST',
    });
    const stillThere = db.getClient(userId, coA.id).servers.find(s => s.id === second.id);
    // A non-clashing role change must go through and be audited by label.
    const moved = db.updateClientServer(userId, second.id, {
systemName: sysA.label, role: 'SERVICES', environment: 'TEST',
    });
    const hist = db.getClientFieldHistory(userId, 'server', second.id).filter(h => h.fieldName === 'Role');
    const audited = hist[0];
    record('Gate 8: updateClientServer refuses a duplicate triple (row untouched) and audits a real role change by LABEL, not id',
      clash.ok === false && stillThere.role === 'DATABASES' && moved.role === 'SERVICES' &&
      !!audited && audited.oldValue === 'Databases' && audited.newValue === 'Services',
      `clash=${clash.ok} roleAfterRefusal=${stillThere.role} roleAfterMove=${moved.role} ` +
      `audit="${audited ? audited.oldValue + ' -> ' + audited.newValue : '(none)'}"`);
  }

  // ── Gate 8b — a System change is audited by label too ───────────────────
  {
    const s = db.createClientServer(userId, coA.id, {
      systemName: sysA.label, role: 'RABBITMQ', environment: 'PRODUCTION',
    });
    const moved = db.updateClientServer(userId, s.id, {
      systemName: sysB.label, role: 'RABBITMQ', environment: 'PRODUCTION',
    });
    const audited = db.getClientFieldHistory(userId, 'server', s.id).find(h => h.fieldName === 'System');
    record('Gate 8b: changing a server\'s System persists and is audited by label, not raw FK id',
      moved.systemName === sysB.label && !!audited &&
      audited.oldValue === sysA.label && audited.newValue === sysB.label,
      `systemAfter=${moved.systemName} audit="${audited ? audited.oldValue + ' -> ' + audited.newValue : '(none)'}"`);
  }

  // ── Gate 9 — uniqueness is scoped per client ────────────────────────────
  {
    const sameTripleOtherClient = db.createClientServer(userId, coB.id, {
systemName: sysA.label, role: 'APPLICATIONS', environment: 'PRODUCTION',
    });
    record('Gate 9: the same triple under a DIFFERENT client is allowed',
      !!sameTripleOtherClient.id && sameTripleOtherClient.ok !== false,
      `created=#${sameTripleOtherClient.id || '-'} (${coB.label})`);
  }

  // ── Gate 10 — bulk group moves can't smuggle in a collision ─────────────
  {
    // Two servers sharing Role+Environment but sitting under different Systems:
    // folding both into one system would collide.
    const g1 = db.createClientServer(userId, coA.id, {
systemName: sysB.label, role: 'DATABASES', environment: 'PRODUCTION',
    });
    const g2 = db.createClientServer(userId, coA.id, {
systemName: sysC.label, role: 'DATABASES', environment: 'PRODUCTION',
    });
    const assign = db.assignClientServerGroup(userId, coA.id, [g1.id, g2.id], sysC.label);
    const rename = db.renameClientServerSystemGroup(userId, coA.id, sysB.label, sysC.label);
    const after = db.getClient(userId, coA.id).servers;
    const untouched = after.find(s => s.id === g1.id).systemName === sysB.label
                   && after.find(s => s.id === g2.id).systemName === sysC.label;
    // A move that does NOT collide must still work: g1 -> sysA (which has no
    // DATABASES/PRODUCTION server on this client).
    const ok = db.assignClientServerGroup(userId, coA.id, [g1.id], sysA.label);
    const g1After = db.getClient(userId, coA.id).servers.find(s => s.id === g1.id);
    record('Gate 10: bulk assign/move refuse a group move that would collide (nothing half-applied), but still allow a clean one',
      assign.ok === false && rename.ok === false && untouched &&
      ok.ok === true && ok.count === 1 && g1After.systemName === sysA.label,
      `assign=${assign.ok} rename=${rename.ok} rowsUntouched=${untouched} cleanMove=${ok.ok}/${ok.count} g1System=${g1After.systemName}`);
  }

  raw.close();
} catch (err) {
  console.error('\nTEST HARNESS ERROR: ' + (err && err.stack || err));
  exitCode = 2;
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n════════════════════ SERVER-IDENTITY SMOKE RESULTS ════════════════════');
let failed = 0;
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  if (!r.pass) failed++;
  console.log(`[${tag}] ${r.flow}\n        ${r.details}`);
}
console.log('──────────────────────────────────────────────────────────────────────');
console.log(`${results.length - failed}/${results.length} flows passed` + (failed ? `  (${failed} FAILED)` : '  — all green'));
if (failed > 0 && exitCode === 0) exitCode = 1;
process.exit(exitCode);
