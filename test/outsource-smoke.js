// ─────────────────────────────────────────────────────────────────────────────
// Outsource — headless data-layer smoke test.
//
// Boots db.js directly (no Electron, no IPC, no renderer) against a private
// copy of the fixture profile's database; the copy is deleted at the end.
//
// Run:  node test/outsource-smoke.js
//
// Covers migration 066 (tables, triggers, idempotent re-run) and the Phase 1
// data layer: resources (create/update, name clash per login, currency check,
// deactivate, delete/undo/purge, no delete once billed), rates (history,
// one per date, the rate in force on a date, delete/undo), entries (the
// `90` / `1:30` / `1.5h` time parser, required date, edit/delete/undo/purge,
// locked once on a statement), the per-project × rate summary and its
// half-up rounding, privacy between logins, the project datalist, Quick Find
// triggers, the audit history and the boot-time purge.
// All names and numbers here are made up.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const db = require('../db');

// Must run before any os.homedir()-based path is computed — see test-bootstrap.js.
require('./test-bootstrap');

const results = [];
function record(flow, pass, details = '') { results.push({ flow, pass, details }); }

const prodDb = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one', 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: fixture DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outsource-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}

let exitCode = 0;
try {
  db.openConnection(workDir);
  db.applyMigrations();
  const conn = db.getConnection();
  const count = (sql, ...p) => conn.prepare(sql).get(...p).n;
  const search = (kind, entityId) => count(
    'SELECT COUNT(*) AS n FROM workspace_search WHERE kind = ? AND entity_id = ?', kind, String(entityId));

  // ── Migration 066 ───────────────────────────────────────────────────────
  const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'outs_%' ORDER BY name").all().map(r => r.name);
  record('Migration: all six outs_ tables exist',
    JSON.stringify(tables) === JSON.stringify(['outs_entries', 'outs_history', 'outs_rates', 'outs_resources', 'outs_statement_lines', 'outs_statements']),
    JSON.stringify(tables));
  record('Migration: 4 lookup-category + 7 Quick Find triggers installed',
    count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_outs_%_category'") === 4
      && count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'workspace_search_outs_%'") === 7);
  record('Migration: no foreign key to projects, tasks, work_logs or pfm',
    tables.every(t => conn.prepare(`PRAGMA foreign_key_list(${t})`).all()
      .every(fk => ['users', 'lookup_codes'].includes(fk.table) || fk.table.startsWith('outs_'))));
  const head = count('SELECT MAX(version) AS n FROM schema_migrations');
  record('Migration: schema head is at least 66', head >= 66, `head=${head}`);
  const triggersBefore = count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'");
  require('../migrations/066_outsource').up(conn);
  db.applyMigrations();
  record('Migration: re-running is a no-op',
    count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'") === triggersBefore);

  // ── Setup ───────────────────────────────────────────────────────────────
  const userId = db.getUserByUsername('fixture-user').id;
  const otherId = db.createUser('outs-other-user', 'not-a-real-hash');
  const currencies = db.getLookupsByCategory('CURRENCY');
  const currency = currencies[0]?.code;
  record('Setup: a CURRENCY code exists', !!currency, String(currency));

  // ── Time parser (D7) ────────────────────────────────────────────────────
  const p = v => db.parseOutsMinutes(v).value ?? null;
  const cases = [
    ['90', 90], [90, 90], ['90m', 90], ['90 min', 90], ['1:30', 90], ['0:45', 45], ['1.5h', 90],
    ['1,5h', 90], ['1.5 hours', 90], ['2h', 120], ['.5h', 30], ['1h30', 90], ['1h 30m', 90],
    ['٩٠', 90], ['١٫٥h', 90], ['0.33h', 20],
  ];
  const wrong = cases.filter(([input, want]) => p(input) !== want);
  record('Time: 90, 1:30, 1.5h and friends all parse to minutes', wrong.length === 0,
    JSON.stringify(wrong.map(([i]) => [i, p(i)])));
  const bad = ['', '0', '-5', 'abc', '1:75', '1.5', 1.5, '25h', '1441', null];
  const accepted = bad.filter(v => p(v) !== null);
  record('Time: empty, zero, negative, junk, bare decimals and >24h are refused', accepted.length === 0,
    JSON.stringify(accepted));
  record('Time: 24h exactly is allowed', p('24h') === 1440 && p('1440') === 1440);

  // ── Resources ───────────────────────────────────────────────────────────
  const created = db.createOutsResource(userId, { name: '  Resource A ', email: 'a@example.test', currency });
  const resA = created.resource;
  record('Resource: created, trimmed, active, in the chosen currency',
    created.ok && resA.name === 'Resource A' && resA.isActive && resA.currency === currency
      && resA.rates.length === 0 && resA.currentRateMinor === null, JSON.stringify(created));
  record('Resource: missing name / currency, bad email are refused',
    !db.createOutsResource(userId, { currency }).ok
      && !db.createOutsResource(userId, { name: 'X' }).ok
      && !db.createOutsResource(userId, { name: 'X', currency: 'NOPE' }).ok
      && !db.createOutsResource(userId, { name: 'X', currency, email: 'not-an-email' }).ok);
  const dup = db.createOutsResource(userId, { name: 'resource a', currency });
  record('Resource: same name on one login refused (case-insensitive)', !dup.ok && /already/.test(dup.error), JSON.stringify(dup));
  const otherRes = db.createOutsResource(otherId, { name: 'Resource A', currency });
  record('Resource: another login may use the same name', otherRes.ok);
  let threw = false;
  try {
    conn.prepare('UPDATE outs_resources SET currency_id = ? WHERE id = ?')
      .run(db.getLookupsByCategory('COMPANY')[0].id, resA.id);
  } catch { threw = true; }
  record('Resource: a wrong-category currency id is rejected by trigger', threw);

  const upd = db.updateOutsResource(userId, resA.id, { phone: ' 000 ' });
  record('Resource: partial update changes only what was sent',
    upd.ok && upd.resource.phone === '000' && upd.resource.email === 'a@example.test' && upd.resource.name === 'Resource A',
    JSON.stringify(upd));
  db.setOutsResourceActive(userId, resA.id, false);
  const hiddenInactive = !db.listOutsResources(userId).some(r => r.id === resA.id);
  const shownAll = db.listOutsResources(userId, { includeInactive: true }).some(r => r.id === resA.id && !r.isActive);
  db.setOutsResourceActive(userId, resA.id, true);
  record('Resource: deactivated resources leave the default list only', hiddenInactive && shownAll);

  // ── Privacy (D1) ────────────────────────────────────────────────────────
  record('Privacy: another login cannot see, edit or delete the resource',
    db.getOutsResource(otherId, resA.id) === null
      && !db.updateOutsResource(otherId, resA.id, { name: 'Hijack' }).ok
      && !db.deleteOutsResource(otherId, resA.id).ok
      && !db.addOutsRate(otherId, resA.id, { rateMinor: 1, effectiveFrom: '2090-01-01' }).ok
      && !db.createOutsEntry(otherId, resA.id, { date: '2090-01-01', minutes: 60 }).ok
      && !db.listOutsResources(otherId, { includeInactive: true }).some(r => r.id === resA.id));

  // ── Rates (D3, D5) ──────────────────────────────────────────────────────
  const r1 = db.addOutsRate(userId, resA.id, { rateMinor: 20000, effectiveFrom: '2090-01-01' });
  const r2 = db.addOutsRate(userId, resA.id, { rateMinor: 25000, effectiveFrom: '2090-07-01' });
  record('Rate: two rates added, newest first',
    r1.ok && r2.ok && r2.resource.rates.map(t => t.effectiveFrom).join() === '2090-07-01,2090-01-01', JSON.stringify(r2));
  const sameDay = db.addOutsRate(userId, resA.id, { rateMinor: 1, effectiveFrom: '2090-07-01' });
  record('Rate: a second rate on the same date is refused', !sameDay.ok, JSON.stringify(sameDay));
  record('Rate: negative, fractional, missing rate or date refused',
    !db.addOutsRate(userId, resA.id, { rateMinor: -1, effectiveFrom: '2090-02-01' }).ok
      && !db.addOutsRate(userId, resA.id, { rateMinor: 1.5, effectiveFrom: '2090-02-01' }).ok
      && !db.addOutsRate(userId, resA.id, { effectiveFrom: '2090-02-01' }).ok
      && !db.addOutsRate(userId, resA.id, { rateMinor: 1 }).ok
      && !db.addOutsRate(userId, resA.id, { rateMinor: 1, effectiveFrom: '2090-02-30' }).ok);

  // ── Entries ─────────────────────────────────────────────────────────────
  const add = (date, minutes, project, description = 'Generic work') =>
    db.createOutsEntry(userId, resA.id, { date, minutes, project, description });
  const e1 = add('2089-12-31', '60', 'Project One');           // before the first rate
  const e2 = add('2090-06-28', '1:30', 'Project One');         // 200.00/h
  const e3 = add('2090-06-29', '20', '  project   one ');      // same project, other spelling
  const e4 = add('2090-07-02', '1.5h', 'Project Two');         // 250.00/h
  const e5 = add('2090-07-03', 7, 'Project One');              // 250.00/h — a second line for One
  record('Entry: created with the time parsed and project tidied',
    [e1, e2, e3, e4, e5].every(r => r.ok) && e2.entry.minutes === 90 && e4.entry.minutes === 90
      && e3.entry.project === 'project one' && e1.entry.rateMinor === null && e2.entry.rateMinor === 20000
      && e4.entry.rateMinor === 25000 && !e2.entry.locked, JSON.stringify([e1, e2, e3]));
  record('Entry: missing or invalid date / time refused',
    !db.createOutsEntry(userId, resA.id, { minutes: 60 }).ok
      && !db.createOutsEntry(userId, resA.id, { date: '2090-13-01', minutes: 60 }).ok
      && !db.createOutsEntry(userId, resA.id, { date: '2090-01-01' }).ok
      && !db.createOutsEntry(userId, resA.id, { date: '2090-01-01', minutes: '0' }).ok);

  // ── Summary: per project × rate, half-up once per line ──────────────────
  const list = db.listOutsEntries(userId, resA.id);
  const s = list.summary;
  const line = (project, rate) => s.lines.find(l => l.project.toLowerCase() === project && l.rateMinor === rate);
  // One @200: 90+20 = 110 min → 110 × 20000 / 60 = 36666.67 → 36667.
  // One @250: 7 min → 7 × 25000 / 60 = 2916.67 → 2917. Two @250: 90 min → 37500.
  record('Summary: entries oldest first, lines per project × rate, rounded half-up per line',
    list.ok && list.entries.map(e => e.date).join() === '2089-12-31,2090-06-28,2090-06-29,2090-07-02,2090-07-03'
      && s.totalMinutes === 267 && line('project one', 20000)?.minutes === 110
      && line('project one', 20000)?.amountMinor === 36667 && line('project one', 25000)?.amountMinor === 2917
      && line('project two', 25000)?.amountMinor === 37500 && s.totalMinor === 36667 + 2917 + 37500,
    JSON.stringify(s));
  record('Summary: an entry before the first rate is flagged, not priced',
    s.missingRate === 1 && line('project one', null)?.amountMinor === null);
  const july = db.listOutsEntries(userId, resA.id, { from: '2090-07-01', to: '2090-07-31', project: 'PROJECT ONE' });
  record('Filter: date range + project (folded)', july.entries.length === 1 && july.entries[0].id === e5.entry.id,
    JSON.stringify(july.entries));
  record('Filter: bad filter date refused', !db.listOutsEntries(userId, resA.id, { from: 'soon' }).ok);

  const detail = db.getOutsResource(userId, resA.id);
  record('Resource: unbilled / unpaid totals match the summary',
    detail.unbilledMinutes === 267 && detail.unbilledMinor === s.totalMinor && detail.unpaidMinor === s.totalMinor
      && detail.unbilledMissingRate === 1 && detail.lastEntryDate === '2090-07-03', JSON.stringify(detail));

  // Rate history: changing a rate re-prices unbilled entries; deleting the only
  // rate for a period leaves those entries unrated; undo brings it back.
  const rateJuly = r2.resource.rates[0];
  db.updateOutsRate(userId, rateJuly.id, { rateMinor: 30000 });
  const repriced = db.listOutsEntries(userId, resA.id).entries.find(e => e.id === e4.entry.id).rateMinor;
  const rateJan = r2.resource.rates[1];
  db.deleteOutsRate(userId, rateJan.id);
  const unrated = db.listOutsEntries(userId, resA.id).entries.find(e => e.id === e2.entry.id).rateMinor;
  const restored = db.restoreOutsRate(userId, rateJan.id);
  record('Rate: edit re-prices open entries; delete + undo round-trips',
    repriced === 30000 && unrated === null && restored.ok
      && db.listOutsEntries(userId, resA.id).entries.find(e => e.id === e2.entry.id).rateMinor === 20000);
  db.deleteOutsRate(userId, rateJan.id);
  db.addOutsRate(userId, resA.id, { rateMinor: 1, effectiveFrom: '2090-01-01' });
  const blocked = db.restoreOutsRate(userId, rateJan.id);
  record('Rate: undo refused when the date was re-used meanwhile', !blocked.ok, JSON.stringify(blocked));

  // ── Entry edit / delete / undo / purge ──────────────────────────────────
  const edited = db.updateOutsEntry(userId, e3.entry.id, { minutes: '0:40' });
  record('Entry: partial edit keeps the other fields',
    edited.ok && edited.entry.minutes === 40 && edited.entry.project === 'project one' && edited.entry.date === '2090-06-29');
  db.deleteOutsEntry(userId, e3.entry.id);
  const goneFromList = !db.listOutsEntries(userId, resA.id).entries.some(e => e.id === e3.entry.id);
  const undone = db.restoreOutsEntry(userId, e3.entry.id);
  record('Entry: delete hides it, undo brings it back unchanged',
    goneFromList && undone.ok && undone.entry.minutes === 40);
  db.deleteOutsEntry(userId, e3.entry.id);
  record('Entry: purge only removes an already-deleted entry',
    !db.purgeOutsEntry(userId, e2.entry.id).ok && db.purgeOutsEntry(userId, e3.entry.id).ok
      && count('SELECT COUNT(*) AS n FROM outs_entries WHERE id = ?', e3.entry.id) === 0);
  record('Privacy: another login cannot touch or list the entries',
    !db.updateOutsEntry(otherId, e2.entry.id, { minutes: 1 }).ok && !db.deleteOutsEntry(otherId, e2.entry.id).ok
      && !db.listOutsEntries(otherId, resA.id).ok);

  // ── Locking (the statement flow itself is Phase 4) ──────────────────────
  const now = new Date().toISOString();
  const stId = Number(conn.prepare(
    `INSERT INTO outs_statements(user_id, resource_id, reference, reference_key, period_from, period_to, status, created_at, updated_at)
     VALUES (?, ?, 'ST-001', 'st-001', '2090-06-01', '2090-06-30', 'ISSUED', ?, ?)`
  ).run(userId, resA.id, now, now).lastInsertRowid);
  conn.prepare('UPDATE outs_entries SET statement_id = ? WHERE id = ?').run(stId, e2.entry.id);
  const lockedEntry = db.listOutsEntries(userId, resA.id).entries.find(e => e.id === e2.entry.id);
  record('Lock: an entry on an issued statement is locked and cannot be edited or deleted',
    lockedEntry.locked && !db.updateOutsEntry(userId, e2.entry.id, { minutes: 5 }).ok
      && !db.deleteOutsEntry(userId, e2.entry.id).ok);
  record('Lock: unbilled filter leaves it out',
    !db.listOutsEntries(userId, resA.id, { unbilled: true }).entries.some(e => e.id === e2.entry.id));
  const noDelete = db.deleteOutsResource(userId, resA.id);
  record('Resource: cannot be deleted once it has an issued statement', !noDelete.ok, JSON.stringify(noDelete));
  conn.prepare("UPDATE outs_statements SET status = 'CANCELLED' WHERE id = ?").run(stId);
  conn.prepare('UPDATE outs_entries SET statement_id = NULL WHERE id = ?').run(e2.entry.id);

  // ── Project datalist ────────────────────────────────────────────────────
  db.createOutsEntry(otherId, otherRes.resource.id, { date: '2090-01-01', minutes: 5, project: 'Other Login Project' });
  const projects = db.listOutsProjects(userId);
  record('Projects: distinct (folded), this login only',
    projects.filter(pr => pr.toLowerCase() === 'project one').length === 1 && projects.includes('Project Two')
      && !projects.includes('Other Login Project'), JSON.stringify(projects));

  // ── Quick Find (migration 066 triggers) ─────────────────────────────────
  const key = `${resA.id}:${e4.entry.id}`;
  record('Search: resource and entries are indexed for their login only',
    search('outs-resource', resA.id) === 1 && search('outs-entry', key) === 1
      && db.searchWorkspace(userId, 'Resource A').some(r => r.kind === 'outs-resource' && r.id === resA.id)
      && !db.searchWorkspace(otherId, 'Project Two').some(r => r.kind === 'outs-entry'));
  db.updateOutsEntry(userId, e4.entry.id, { description: 'Renamed task' });
  record('Search: an entry edit re-indexes it',
    db.searchWorkspace(userId, 'Renamed task').some(r => r.kind === 'outs-entry' && r.id === key));
  db.updateOutsResource(userId, resA.id, { name: 'Resource Renamed' });
  const sub = conn.prepare("SELECT subtitle FROM workspace_search WHERE kind = 'outs-entry' AND entity_id = ?").get(key)?.subtitle;
  record('Search: renaming the resource refreshes its entries', /^Resource Renamed · 2090-07-02/.test(sub || ''), String(sub));
  db.deleteOutsEntry(userId, e4.entry.id);
  const entryHidden = search('outs-entry', key) === 0;
  db.restoreOutsEntry(userId, e4.entry.id);
  record('Search: a deleted entry leaves the index, undo puts it back', entryHidden && search('outs-entry', key) === 1);

  // ── Resource delete / undo / purge ──────────────────────────────────────
  conn.prepare('DELETE FROM outs_statements WHERE id = ?').run(stId);
  const resB = db.createOutsResource(userId, { name: 'Resource B', currency }).resource;
  db.addOutsRate(userId, resB.id, { rateMinor: 100, effectiveFrom: '2090-01-01' });
  const eB = db.createOutsEntry(userId, resB.id, { date: '2090-01-02', minutes: 30, project: 'P' }).entry;
  const del = db.deleteOutsResource(userId, resB.id);
  const hidden = db.getOutsResource(userId, resB.id) === null && !db.listOutsResources(userId).some(r => r.id === resB.id)
    && search('outs-resource', resB.id) === 0 && search('outs-entry', `${resB.id}:${eB.id}`) === 0
    && !db.updateOutsEntry(userId, eB.id, { minutes: 1 }).ok;
  const back = db.restoreOutsResource(userId, resB.id);
  record('Resource: delete hides it and its entries everywhere; undo restores both',
    del.ok && hidden && back.ok && search('outs-entry', `${resB.id}:${eB.id}`) === 1
      && db.listOutsEntries(userId, resB.id).entries.length === 1);
  db.deleteOutsResource(userId, resB.id);
  const purged = db.purgeOutsResource(userId, resB.id);
  record('Resource: purge removes it with its rates and entries (cascade)',
    purged.ok && count('SELECT COUNT(*) AS n FROM outs_rates WHERE resource_id = ?', resB.id) === 0
      && count('SELECT COUNT(*) AS n FROM outs_entries WHERE resource_id = ?', resB.id) === 0
      && search('outs-entry', `${resB.id}:${eB.id}`) === 0);
  const resC = db.createOutsResource(userId, { name: 'Resource C', currency }).resource;
  db.deleteOutsResource(userId, resC.id);
  const clash = db.createOutsResource(userId, { name: 'Resource C', currency });
  record('Resource: a deleted name is free again; restoring into the clash is refused',
    clash.ok && !db.restoreOutsResource(userId, resC.id).ok);

  // ── Month total ─────────────────────────────────────────────────────────
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  db.createOutsEntry(userId, resA.id, { date: today, minutes: '2h' });
  record('Resource: hours this month counts only this month',
    db.getOutsResource(userId, resA.id).monthMinutes === 120);

  // ── History ─────────────────────────────────────────────────────────────
  const history = db.getOutsHistory(userId, resA.id);
  const fields = new Set(history.map(h => h.field));
  record('History: resource, rate and entry changes are recorded',
    ['Created', 'Phone', 'Active', 'Name', 'Rate Added', 'Rate', 'Rate Deleted', 'Rate Restored',
      'Minutes', 'Entry Deleted', 'Entry Restored', 'Description'].every(f => fields.has(f))
      && history.every(h => h.changedBy === 'fixture-user'), JSON.stringify([...fields]));
  record('History: another login reads nothing', db.getOutsHistory(otherId, resA.id).length === 0);

  // ── Boot-time purge ─────────────────────────────────────────────────────
  const leftover = db.createOutsEntry(userId, resA.id, { date: '2090-02-02', minutes: 5 }).entry;
  db.deleteOutsEntry(userId, leftover.id);
  const report = db.runMaintenance();
  record('Maintenance: rows left in their undo window are purged at boot',
    report.outsPurged?.entries >= 1 && report.outsPurged?.resources >= 1
      && count('SELECT COUNT(*) AS n FROM outs_entries WHERE id = ?', leftover.id) === 0
      && count('SELECT COUNT(*) AS n FROM outs_resources WHERE id = ?', resC.id) === 0,
    JSON.stringify(report.outsPurged));

  // ── Integrity ───────────────────────────────────────────────────────────
  const fk = conn.prepare('PRAGMA foreign_key_check').all();
  const integrity = conn.prepare('PRAGMA integrity_check').get();
  record('Integrity: foreign_key_check and integrity_check clean',
    fk.length === 0 && Object.values(integrity)[0] === 'ok', JSON.stringify({ fk, integrity }));
} catch (err) {
  exitCode = 1;
  console.error('FATAL:', err);
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n── Results ──');
for (const r of results) {
  console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.flow + (r.details && !r.pass ? '  (' + r.details + ')' : ''));
  if (!r.pass) exitCode = 1;
}
console.log('\n' + (exitCode === 0 ? 'ALL GREEN' : 'FAILURES PRESENT'));
process.exit(exitCode);
