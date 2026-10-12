'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Catalog map (Settings → Catalog Map) — headless smoke test.
//
// Boots db.js directly against a private copy of the fixture profile's
// database; the copy is deleted at the end. The look-alike matcher is loaded
// from renderer/features/catalog-map.js into a bare VM context.
//
// Run:  node test/catalog-map-smoke.js
//
// Covers loadLookups' `uses` (agrees with inUse, rises by one per referencing
// record) and catalogLookAlikes (case, punctuation, Arabic letter forms and a
// one-letter typo match; containment, codes, number series and short names don't).
// ─────────────────────────────────────────────────────────────────────────────
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const vm   = require('node:vm');

const db = require('../db');

require('./test-bootstrap');

const results = [];
function record(flow, pass, details = '') { results.push({ flow, pass, details }); }

const prodDb = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one', 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: fixture DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-map-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}

let exitCode = 0;
try {
  db.openConnection(workDir);
  db.applyMigrations();
  const userId = db.getUserByUsername('fixture-user').id;

  const all = Object.values(db.loadLookups(userId).categories).flat();
  record('Every entry carries a numeric use count', all.length > 0 && all.every(o => Number.isInteger(o.uses) && o.uses >= 0));
  record('uses agrees with inUse', all.every(o => !!o.uses === !!o.inUse),
    JSON.stringify(all.filter(o => !!o.uses !== !!o.inUse).slice(0, 3)));

  const sys = db.loadLookups(userId).categories.SYSTEM[0];
  const before = sys.uses;
  db.createTask(userId, { name: 'Catalog map task', status: 'OPEN', system: sys.label, source: '' });
  db.createTask(userId, { name: 'Catalog map task 2', status: 'OPEN', system: sys.label, source: '' });
  const after = db.loadLookups(userId).categories.SYSTEM.find(o => o.id === sys.id).uses;
  record('Two tasks on a system raise its count by two', after === before + 2, `before=${before} after=${after}`);
} catch (err) {
  record('Unexpected error', false, err.stack || String(err));
} finally {
  try { db.closeConnection?.(); } catch {}
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
}

try {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'features', 'catalog-map.js'), 'utf8'), ctx);
  let id = 0;
  const e = (label, uses = 0, extra = {}) => ({ id: ++id, code: 'C' + id, label, uses, ...extra });
  const pairsOf = (category, items) => vm.runInContext('catalogLookAlikes', ctx)(category, items)
    .map(p => [p.a.label, p.b.label, p.reason]);

  let p = pairsOf('SYSTEM', [e('Acme Co.', 5), e('ACME-co', 1)]);
  record('Case and punctuation are ignored', p.length === 1 && p[0][2] === 'same', JSON.stringify(p));

  p = pairsOf('SYSTEM', [e('Payrol', 0), e('Payroll', 9)]);
  record('A one-letter typo matches, busier entry first', p.length === 1 && p[0][2] === 'typo' && p[0][0] === 'Payroll', JSON.stringify(p));

  p = pairsOf('DEPARTMENT', [e('الإدارة'), e('الادارة')]);
  record('Arabic alef forms are folded', p.length === 1 && p[0][2] === 'same', JSON.stringify(p));

  p = pairsOf('SYSTEM', [e('Quotation'), e('Quotation Approval'), e('Management'), e('Project Management')]);
  record('One name containing the other is not a match', p.length === 0, JSON.stringify(p));

  p = pairsOf('COMPANY', [e('Northwind', 0, { code: 'CL-01' }), e('Contoso', 0, { code: 'CL-02' }), e('Globex', 0, { code: 'CL-03' })]);
  record('Client codes in a series (CL-01, CL-02…) never make a pair', p.length === 0, JSON.stringify(p));

  p = pairsOf('SERVER_ROLE', [e('Application Server 1'), e('Application Server 2')]);
  record('Names that differ only by a number are a series, not a typo', p.length === 0, JSON.stringify(p));

  p = pairsOf('COMPANY', [e('منارة'), e('مناره')]);
  record('Ta marbuta and ha are folded', p.length === 1 && p[0][2] === 'same', JSON.stringify(p));

  p = pairsOf('SYSTEM', [e('ERP'), e('CRM'), e('BI Reports'), e('HR Self-Service')]);
  record('Unrelated and short names do not match', p.length === 0, JSON.stringify(p));

  p = pairsOf('SYSTEM', [e('Payroll', 0, { nameAr: 'الرواتب' }), e('Salaries', 0, { nameAr: 'الرواتب' })]);
  record('A shared Arabic name matches', p.length === 1, JSON.stringify(p));
} catch (err) {
  record('Unexpected error (matcher)', false, err.stack || String(err));
}

for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.flow}${r.pass ? '' : '\n      ' + r.details}`);
  if (!r.pass) exitCode = 1;
}
if (!results.length) exitCode = 1;
process.exit(exitCode);
