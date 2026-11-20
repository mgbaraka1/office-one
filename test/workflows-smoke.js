// ─────────────────────────────────────────────────────────────────────────────
// Workflows — the shared lifecycle table (renderer/workflows.js) is the truth.
//
// Run:  node test/workflows-smoke.js
//
// 1. The table is well formed: every move starts and lands on a known status,
//    every rule names known statuses, it is frozen, unknown actions throw.
// 2. It matches the database: the statement statuses equal migration 066's
//    CHECK list, and index.html loads it before every script that reads it.
// 3. It matches db.js's behaviour: for every statement status × action, the
//    real data layer accepts exactly what `can()` says (on a private copy of
//    the fixture database, deleted at the end).
// 4. Nothing drifts back: no raw status comparison for these machines in
//    db.js or the renderer files that use them.
// All names and numbers are made up.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

// Must run before any os.homedir()-based path is computed — see test-bootstrap.js.
require('./test-bootstrap');

const db = require('../db');
const W = require('../renderer/workflows');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const results = [];
function record(flow, pass, details = '') { results.push({ flow, pass, details }); }

// ── 1. Shape ────────────────────────────────────────────────────────────────
for (const [name, m] of Object.entries({ OUTS_STATEMENT: W.OUTS_STATEMENT, KNOWLEDGE_ITEM: W.KNOWLEDGE_ITEM })) {
  const known = new Set(m.states);
  const bad = [];
  if (!known.has(m.initial)) bad.push('initial ' + m.initial);
  Object.entries(m.transitions).forEach(([a, t]) => {
    if (!known.has(t.to)) bad.push(`${a}.to ${t.to}`);
    t.from.forEach(s => { if (!known.has(s)) bad.push(`${a}.from ${s}`); });
  });
  Object.entries(m.rules || {}).forEach(([r, list]) => list.forEach(s => { if (!known.has(s)) bad.push(`${r} ${s}`); }));
  const clash = Object.keys(m.transitions).filter(a => m.rules && Object.hasOwn(m.rules, a));
  record(`Shape: ${name} names only its own statuses, no action is both a move and a rule`, !bad.length && !clash.length, [...bad, ...clash].join(', '));
}
record('Shape: Offer/CR anchors are final-aware (Rejected and Paid are final)',
  W.PFM_ITEM.final.includes(W.PFM_ITEM.rejected) && W.PFM_ITEM.final.includes('PAID') && !W.PFM_ITEM.final.includes(W.PFM_ITEM.decision));
let threw = 0;
try { W.can(W.OUTS_STATEMENT, 'DRAFT', 'nope'); } catch { threw++; }
try { W.target(W.OUTS_STATEMENT, 'editPeriod'); } catch { threw++; }
try { W.sqlList(W.OUTS_STATEMENT, 'nope'); } catch { threw++; }
record('Shape: an unknown action throws rather than answering "no"', threw === 3);
let mutated = false;
try { W.OUTS_STATEMENT.rules.delete.push('PAID'); mutated = true; } catch { /* frozen */ }
record('Shape: the table is frozen', !mutated && Object.isFrozen(W.OUTS_STATEMENT.transitions.issue.from));
record('Shape: sqlList quotes the rule list', W.sqlList(W.OUTS_STATEMENT, 'billed') === "('ISSUED', 'PAID')");

// ── 2. Database + load order ────────────────────────────────────────────────
{
  const m = read('migrations/066_outsource.js').match(/status\s+TEXT[^\n]*\n[^\n]*CHECK \(status IN \(([^)]*)\)\)/);
  const check = m ? m[1].split(',').map(s => s.trim().replace(/'/g, '')) : [];
  record('Database: statement statuses equal migration 066\'s CHECK list',
    JSON.stringify(check) === JSON.stringify(W.OUTS_STATEMENT.states), JSON.stringify(check));
  const srcs = [...read('index.html').matchAll(/<script\s+src="([^"]+)"/g)].map(x => x[1]);
  const at = f => srcs.indexOf(f);
  const wf = at('renderer/workflows.js');
  record('Load order: index.html loads workflows.js before core.js and every feature that reads it',
    wf >= 0 && ['renderer/core.js', 'renderer/features/pfm.js', 'renderer/features/outsource.js', 'renderer/features/knowledge.js']
      .every(f => at(f) > wf), JSON.stringify(srcs.slice(0, 6)));
}

// ── 3. db.js behaves exactly as the table says ──────────────────────────────
const prodDb = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one', 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: fixture DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflows-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}

let exitCode = 0;
try {
  db.openConnection(workDir);
  db.applyMigrations();
  const userId = db.getUserByUsername('fixture-user').id;
  const currency = db.getLookupsByCategory('CURRENCY')[0]?.code;
  const res = db.createOutsResource(userId, { name: 'Workflow Person', currency }).resource;
  db.addOutsRate(userId, res.id, { rateMinor: 10000, effectiveFrom: '2091-01-01' });
  const project = db.createOutsProject(userId, res.id, { name: 'Workflow Project' }).project;

  // Each case gets its own month, so issuing one never locks another's entries.
  let month = 0;
  function statementIn(status) {
    const y = 2091 + Math.floor(month / 12), mm = String((month % 12) + 1).padStart(2, '0');
    month++;
    const from = `${y}-${mm}-01`, to = `${y}-${mm}-28`;
    db.createOutsEntry(userId, project.id, { date: `${y}-${mm}-10`, minutes: 60, description: 'made up' });
    const s = db.createOutsStatement(userId, res.id, { periodFrom: from, periodTo: to }).statement;
    const go = { ISSUED: ['issue'], PAID: ['issue', 'markPaid'], CANCELLED: ['cancel'] }[status] || [];
    for (const step of go) {
      const r = { issue: db.issueOutsStatement, markPaid: db.markOutsStatementPaid, cancel: db.cancelOutsStatement }[step](userId, s.id);
      if (!r.ok) throw new Error(`Could not reach ${status}: ${step} → ${r.error}`);
    }
    return { id: s.id, from, to };
  }
  const attempt = {
    issue:      s => db.issueOutsStatement(userId, s.id),
    markPaid:   s => db.markOutsStatementPaid(userId, s.id),
    markUnpaid: s => db.markOutsStatementUnpaid(userId, s.id),
    cancel:     s => db.cancelOutsStatement(userId, s.id),
    editPeriod: s => db.updateOutsStatement(userId, s.id, { periodFrom: s.from, periodTo: s.to.replace(/28$/, '27') }),
    delete:     s => db.deleteOutsStatement(userId, s.id),
  };
  const wrong = [];
  for (const status of W.OUTS_STATEMENT.states) {
    for (const [action, run] of Object.entries(attempt)) {
      const s = statementIn(status);
      const r = run(s);
      // Cancelling a cancelled statement is a harmless no-op (a double click).
      const expected = W.can(W.OUTS_STATEMENT, status, action) || (action === 'cancel' && status === 'CANCELLED');
      const landed = db.getOutsStatement(userId, s.id)?.status;
      const wantStatus = W.OUTS_STATEMENT.transitions[action] && expected ? W.target(W.OUTS_STATEMENT, action) : status;
      if (!!r.ok !== expected) wrong.push(`${status}.${action}: ok=${r.ok} (${r.error || ''})`);
      else if (action !== 'delete' && landed !== wantStatus) wrong.push(`${status}.${action}: landed on ${landed}`);
    }
  }
  record(`Behaviour: db.js accepts exactly what the table allows (${W.OUTS_STATEMENT.states.length} statuses × ${Object.keys(attempt).length} actions)`,
    !wrong.length, wrong.join('; '));
  const conn = db.getConnection();
  const fk = conn.prepare('PRAGMA foreign_key_check').all();
  record('Integrity: foreign_key_check clean after the matrix', fk.length === 0, JSON.stringify(fk));
} catch (err) {
  exitCode = 1;
  console.error('FATAL:', err);
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── 4. No drift back to raw comparisons ─────────────────────────────────────
{
  const hits = (rel, re) => read(rel).split(/\r?\n/).map((l, i) => re.test(l) ? `${rel}:${i + 1}` : null).filter(Boolean);
  const outs = /(status\s*[!=]==?\s*'(DRAFT|ISSUED|PAID|CANCELLED)'|status\s+IN\s*\('(DRAFT|ISSUED|PAID|CANCELLED)')/;
  const pfm = /[!=]==\s*'(ACCEPTED|REJECTED)'|indexOf\('ACCEPTED'\)|new Set\(\['PAID'/;
  const kh = /\.status\s*[!=]==\s*'(DRAFT|ARCHIVED)'/;
  const found = [
    ...hits('db.js', outs), ...hits('db.js', pfm),
    ...hits('renderer/features/outsource.js', outs),
    ...hits('renderer/features/pfm.js', pfm),
    ...hits('renderer/features/knowledge.js', kh),
  ];
  record('Drift: no raw lifecycle comparison outside renderer/workflows.js', !found.length, found.join(', '));
}

console.log('\n── Results ──');
for (const r of results) {
  console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.flow + (r.details && !r.pass ? '  (' + r.details + ')' : ''));
  if (!r.pass) exitCode = 1;
}
console.log('\n' + (exitCode === 0 ? 'ALL GREEN' : 'FAILURES PRESENT'));
process.exit(exitCode);
