// ─────────────────────────────────────────────────────────────────────────────
// Outsource — headless data-layer smoke test.
//
// Boots db.js directly (no Electron, no IPC, no renderer) against a private
// copy of the fixture profile's database; the copy is deleted at the end.
//
// Run:  node test/outsource-smoke.js
//
// Covers migrations 066 + 067 (tables, triggers, idempotent re-run, the 067
// backfill of projects for older entries) and the data layer: resources (name
// clash per login, currency check, deactivate, delete/undo/purge, no delete
// once billed), rates (history, one per date, the rate in force on a date,
// the draft-statement warning), projects inside a person (name clash per
// person, rename, delete/undo/purge, no delete once billed), entries inside a
// project (the `90` / `1:30` / `1.5h` parser, edit, move, delete/undo/purge),
// the per-project × rate summary and its half-up rounding, statements (draft
// preview, issue = snapshot + lock, no double billing, a snapshot that
// survives a rate change, paid / unpaid, cancel unlocks, delete rules),
// privacy between logins, Quick Find triggers, the Overview unpaid summary,
// the audit history and the boot-time purge. All names and numbers are made up.
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

  // ── Migrations 066 + 067 ────────────────────────────────────────────────
  const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'outs_%' ORDER BY name").all().map(r => r.name);
  record('Migration: all seven outs_ tables exist',
    JSON.stringify(tables) === JSON.stringify(['outs_entries', 'outs_history', 'outs_projects', 'outs_rates', 'outs_resources', 'outs_statement_lines', 'outs_statements']),
    JSON.stringify(tables));
  const searchTriggers = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'workspace_search_outs_%' ORDER BY name").all().map(r => r.name);
  record('Migration: 4 lookup-category + 11 Quick Find triggers installed',
    count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_outs_%_category'") === 4
      && searchTriggers.length === 11 && !searchTriggers.includes('workspace_search_outs_resources_au_entries'),
    JSON.stringify(searchTriggers));
  record('Migration: no foreign key to projects, tasks, work_logs or pfm',
    tables.every(t => conn.prepare(`PRAGMA foreign_key_list(${t})`).all()
      .every(fk => ['users', 'lookup_codes'].includes(fk.table) || fk.table.startsWith('outs_'))));
  record('Migration: outs_history accepts project rows; entries and lines carry project_id',
    conn.prepare("SELECT sql FROM sqlite_master WHERE name = 'outs_history'").get().sql.includes("'project'")
      && conn.prepare('PRAGMA table_info(outs_entries)').all().some(c => c.name === 'project_id')
      && conn.prepare('PRAGMA table_info(outs_statement_lines)').all().some(c => c.name === 'project_id'));
  const head = count('SELECT MAX(version) AS n FROM schema_migrations');
  record('Migration: schema head is at least 67', head >= 67, `head=${head}`);
  const triggersBefore = count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'");
  require('../migrations/066_outsource').up(conn);
  require('../migrations/067_outsource_projects').up(conn);
  db.applyMigrations();
  record('Migration: re-running 066 and 067 is a no-op',
    count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'") === triggersBefore
      && count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name = 'workspace_search_outs_resources_au_entries'") === 0);

  // ── Setup ───────────────────────────────────────────────────────────────
  const userId = db.getUserByUsername('fixture-user').id;
  const otherId = db.createUser('outs-other-user', 'not-a-real-hash');
  const currency = db.getLookupsByCategory('CURRENCY')[0]?.code;
  record('Setup: a CURRENCY code exists', !!currency, String(currency));

  // ── 067 backfill: entries written before projects existed ───────────────
  {
    const res = db.createOutsResource(userId, { name: 'Backfill Person', currency }).resource;
    const now = new Date().toISOString();
    const legacy = conn.prepare(
      `INSERT INTO outs_entries(user_id, resource_id, work_date, minutes, description, project, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'legacy', ?, ?, ?)`
    );
    ['Alpha', ' alpha ', '', 'Beta'].forEach(name => legacy.run(userId, res.id, '2090-01-01', 10, name, now, now));
    require('../migrations/067_outsource_projects').up(conn);
    const names = db.listOutsProjects(userId, res.id).map(p => p.name).sort().join(',');
    // Same timestamps, so the newest row (' alpha ') is the spelling that wins.
    record('Backfill: older entries get one project per folded name, "General" when blank',
      names === 'Beta,General,alpha' && count('SELECT COUNT(*) AS n FROM outs_entries WHERE project_id IS NULL') === 0, names);
    db.deleteOutsResource(userId, res.id);
    db.purgeOutsResource(userId, res.id);
  }

  // ── Time parser (D7) ────────────────────────────────────────────────────
  const p = v => db.parseOutsMinutes(v).value ?? null;
  const cases = [
    ['90', 90], [90, 90], ['90m', 90], ['90 min', 90], ['1:30', 90], ['0:45', 45], ['1.5h', 90],
    ['1,5h', 90], ['1.5 hours', 90], ['2h', 120], ['.5h', 30], ['1h30', 90], ['1h 30m', 90],
    ['٩٠', 90], ['١٫٥h', 90], ['0.33h', 20],
  ];
  const wrong = cases.filter(([input, want]) => p(input) !== want);
  record('Time: 90, 1:30, 1.5h and friends all parse to minutes', wrong.length === 0, JSON.stringify(wrong.map(([i]) => [i, p(i)])));
  const accepted = ['', '0', '-5', 'abc', '1:75', '1.5', 1.5, '25h', '1441', null].filter(v => p(v) !== null);
  record('Time: empty, zero, negative, junk, bare decimals and >24h are refused', accepted.length === 0, JSON.stringify(accepted));

  // ── Resources ───────────────────────────────────────────────────────────
  const created = db.createOutsResource(userId, { name: '  Resource A ', email: 'a@example.test', currency });
  const resA = created.resource;
  record('Resource: created, trimmed, active, in the chosen currency',
    created.ok && resA.name === 'Resource A' && resA.isActive && resA.currency === currency && resA.currentRateMinor === null,
    JSON.stringify(created));
  record('Resource: missing name / currency, bad email are refused',
    !db.createOutsResource(userId, { currency }).ok && !db.createOutsResource(userId, { name: 'X' }).ok
      && !db.createOutsResource(userId, { name: 'X', currency: 'NOPE' }).ok
      && !db.createOutsResource(userId, { name: 'X', currency, email: 'not-an-email' }).ok);
  record('Resource: same name on one login refused (case-insensitive)', !db.createOutsResource(userId, { name: 'resource a', currency }).ok);
  const otherRes = db.createOutsResource(otherId, { name: 'Resource A', currency }).resource;
  record('Resource: another login may use the same name', !!otherRes);
  let threw = false;
  try { conn.prepare('UPDATE outs_resources SET currency_id = ? WHERE id = ?').run(db.getLookupsByCategory('COMPANY')[0].id, resA.id); }
  catch { threw = true; }
  record('Resource: a wrong-category currency id is rejected by trigger', threw);
  db.setOutsResourceActive(userId, resA.id, false);
  const hiddenInactive = !db.listOutsResources(userId).some(r => r.id === resA.id);
  db.setOutsResourceActive(userId, resA.id, true);
  record('Resource: deactivated resources leave the default list only', hiddenInactive);

  // ── Rates (D3, D5) ──────────────────────────────────────────────────────
  const r1 = db.addOutsRate(userId, resA.id, { rateMinor: 20000, effectiveFrom: '2090-01-01' });
  const r2 = db.addOutsRate(userId, resA.id, { rateMinor: 25000, effectiveFrom: '2090-07-01' });
  record('Rate: two rates added, newest first',
    r1.ok && r2.ok && r2.resource.rates.map(t => t.effectiveFrom).join() === '2090-07-01,2090-01-01');
  record('Rate: a second rate on the same date, negative or fractional rates are refused',
    !db.addOutsRate(userId, resA.id, { rateMinor: 1, effectiveFrom: '2090-07-01' }).ok
      && !db.addOutsRate(userId, resA.id, { rateMinor: -1, effectiveFrom: '2090-02-01' }).ok
      && !db.addOutsRate(userId, resA.id, { rateMinor: 1.5, effectiveFrom: '2090-02-01' }).ok);

  // ── Projects inside a person (067) ──────────────────────────────────────
  const pOne = db.createOutsProject(userId, resA.id, { name: '  Project   One ' });
  const pTwo = db.createOutsProject(userId, resA.id, { name: 'Project Two', notes: 'generic' });
  record('Project: created inside the person, name tidied',
    pOne.ok && pOne.project.name === 'Project One' && pOne.project.resourceId === resA.id && pTwo.ok, JSON.stringify(pOne));
  record('Project: a second project with the same name in one person is refused; another person may use it',
    !db.createOutsProject(userId, resA.id, { name: 'project one' }).ok
      && db.createOutsProject(otherId, otherRes.id, { name: 'Project One' }).ok);
  const otherProject = db.listOutsProjects(otherId, otherRes.id)[0];
  record('Project: missing name refused; another login cannot add to this person',
    !db.createOutsProject(userId, resA.id, { name: ' ' }).ok && !db.createOutsProject(otherId, resA.id, { name: 'X' }).ok);
  const P1 = pOne.project.id;
  const P2 = pTwo.project.id;

  // ── Entries inside a project ────────────────────────────────────────────
  const add = (projectId, date, minutes, description = 'Generic work') =>
    db.createOutsEntry(userId, projectId, { date, minutes, description });
  const e1 = add(P1, '2089-12-31', '60');     // before the first rate
  const e2 = add(P1, '2090-06-28', '1:30');   // 200.00/h
  const e3 = add(P1, '2090-06-29', '20');     // 200.00/h
  const e4 = add(P2, '2090-07-02', '1.5h');   // 250.00/h
  const e5 = add(P1, '2090-07-03', 7);        // 250.00/h — a second line for One
  record('Entry: written inside its project, time parsed, priced by date',
    [e1, e2, e3, e4, e5].every(r => r.ok) && e2.entry.minutes === 90 && e2.entry.projectId === P1
      && e2.entry.project === 'Project One' && e1.entry.rateMinor === null && e2.entry.rateMinor === 20000
      && e4.entry.rateMinor === 25000, JSON.stringify([e1, e2]));
  record('Entry: missing or invalid date / time refused; another login cannot write into the project',
    !db.createOutsEntry(userId, P1, { minutes: 60 }).ok && !db.createOutsEntry(userId, P1, { date: '2090-13-01', minutes: 60 }).ok
      && !db.createOutsEntry(userId, P1, { date: '2090-01-01' }).ok && !db.createOutsEntry(otherId, P1, { date: '2090-01-01', minutes: 5 }).ok);

  // ── Summary: per project × rate, half-up once per line ──────────────────
  const list = db.listOutsEntries(userId, resA.id);
  const s = list.summary;
  const line = (projectId, rate) => s.lines.find(l => l.projectId === projectId && l.rateMinor === rate);
  // One @200: 90+20 = 110 min → 110 × 20000 / 60 = 36666.67 → 36667.
  // One @250: 7 min → 2916.67 → 2917. Two @250: 90 min → 37500.
  record('Summary: lines per project × rate, rounded half-up per line',
    s.totalMinutes === 267 && line(P1, 20000)?.minutes === 110 && line(P1, 20000)?.amountMinor === 36667
      && line(P1, 25000)?.amountMinor === 2917 && line(P2, 25000)?.amountMinor === 37500
      && s.totalMinor === 36667 + 2917 + 37500 && s.missingRate === 1 && line(P1, null)?.amountMinor === null, JSON.stringify(s));
  const oneOnly = db.listOutsEntries(userId, resA.id, { projectId: P1, from: '2090-07-01', to: '2090-07-31' });
  record('Filter: one project + a date range', oneOnly.entries.length === 1 && oneOnly.entries[0].id === e5.entry.id);
  const projects = db.listOutsProjects(userId, resA.id);
  const one = projects.find(x => x.id === P1);
  record('Project list: totals per project',
    projects.length === 2 && one.entryCount === 4 && one.totalMinutes === 177 && one.unbilledMissingRate === 1
      && one.unbilledMinor === 36667 + 2917 && one.lastEntryDate === '2090-07-03', JSON.stringify(one));

  // ── Entry edit / move / delete / undo / purge ───────────────────────────
  const edited = db.updateOutsEntry(userId, e3.entry.id, { minutes: '0:40' });
  record('Entry: partial edit keeps the other fields', edited.ok && edited.entry.minutes === 40 && edited.entry.date === '2090-06-29');
  const moved = db.updateOutsEntry(userId, e3.entry.id, { projectId: P2 });
  const movedBack = db.updateOutsEntry(userId, e3.entry.id, { projectId: P1 });
  record('Entry: moves to another project of the same person only',
    moved.ok && moved.entry.projectId === P2 && moved.entry.project === 'Project Two' && movedBack.ok
      && !db.updateOutsEntry(userId, e3.entry.id, { projectId: otherProject.id }).ok
      && db.listOutsEntries(userId, resA.id).entries.find(e => e.id === e3.entry.id).projectId === P1);
  db.deleteOutsEntry(userId, e3.entry.id);
  const gone = !db.listOutsEntries(userId, resA.id).entries.some(e => e.id === e3.entry.id);
  const undone = db.restoreOutsEntry(userId, e3.entry.id);
  record('Entry: delete hides it, undo brings it back', gone && undone.ok && undone.entry.minutes === 40);
  record('Privacy: another login cannot touch or list the entries',
    !db.updateOutsEntry(otherId, e2.entry.id, { minutes: 1 }).ok && !db.deleteOutsEntry(otherId, e2.entry.id).ok
      && !db.listOutsEntries(otherId, resA.id).ok && db.listOutsProjects(otherId, resA.id).length === 0);

  // ── Project rename / delete / undo ──────────────────────────────────────
  const renamed = db.updateOutsProject(userId, P2, { name: 'Project Two Renamed' });
  record('Project: rename flows to its entries (and 066\'s text column)',
    renamed.ok && db.listOutsEntries(userId, resA.id, { projectId: P2 }).entries.every(e => e.project === 'Project Two Renamed')
      && count("SELECT COUNT(*) AS n FROM outs_entries WHERE project_id = ? AND project <> 'Project Two Renamed'", P2) === 0);
  record('Project: rename into a sibling name is refused', !db.updateOutsProject(userId, P2, { name: 'PROJECT ONE' }).ok);
  db.deleteOutsProject(userId, P2);
  const hiddenWithProject = !db.listOutsEntries(userId, resA.id).entries.some(e => e.projectId === P2)
    && !db.updateOutsEntry(userId, e4.entry.id, { minutes: 5 }).ok
    && search('outs-entry', `${resA.id}:${P2}:${e4.entry.id}`) === 0 && search('outs-project', `${resA.id}:${P2}`) === 0;
  const projectBack = db.restoreOutsProject(userId, P2);
  record('Project: delete hides its entries everywhere; undo brings them back',
    hiddenWithProject && projectBack.ok && search('outs-entry', `${resA.id}:${P2}:${e4.entry.id}`) === 1);

  // ── Statements (Phase 4) ────────────────────────────────────────────────
  // A rate for the whole 2089 year so e1 can be billed later.
  const draft = db.createOutsStatement(userId, resA.id, { periodFrom: '2089-12-01', periodTo: '2090-06-30' });
  record('Statement: draft numbered ST-001 with a live preview',
    draft.ok && draft.statement.reference === 'ST-001' && draft.statement.status === 'DRAFT'
      && draft.statement.entries.length === 3 && draft.statement.missingRate === 1, JSON.stringify(draft.statement));
  const blocked = db.issueOutsStatement(userId, draft.statement.id);
  record('Statement: cannot be issued while an entry has no rate', !blocked.ok && /no rate/.test(blocked.error), JSON.stringify(blocked));
  const warn = db.addOutsRate(userId, resA.id, { rateMinor: 10000, effectiveFrom: '2089-01-01' });
  record('Rate: a new rate reports the draft statements it changes', warn.ok && warn.draftsAffected === 1, JSON.stringify(warn.draftsAffected));
  const issued = db.issueOutsStatement(userId, draft.statement.id);
  // e1 60 min @100 = 10000; e2+e3 130 min @200 = 43333.33 → 43333.
  record('Statement: issue snapshots lines and totals',
    issued.ok && issued.statement.status === 'ISSUED' && issued.statement.totalMinutes === 190
      && issued.statement.totalMinor === 10000 + 43333 && issued.statement.lines.length === 2
      && issued.statement.lines.every(l => l.projectId === P1) && issued.statement.entries.length === 3,
    JSON.stringify(issued.statement));
  const lockedEntry = db.listOutsEntries(userId, resA.id).entries.find(e => e.id === e2.entry.id);
  record('Lock: issued entries are locked — no edit, delete or move',
    lockedEntry.locked && !db.updateOutsEntry(userId, e2.entry.id, { minutes: 5 }).ok && !db.deleteOutsEntry(userId, e2.entry.id).ok);
  const second = db.createOutsStatement(userId, resA.id, { periodFrom: '2089-01-01', periodTo: '2090-12-31' });
  record('Statement: no double billing — an overlapping draft only sees unbilled entries',
    second.ok && second.statement.reference === 'ST-002' && second.statement.entries.every(e => !e.locked)
      && !second.statement.entries.some(e => e.id === e2.entry.id), JSON.stringify(second.statement.entries.map(e => e.id)));
  db.updateOutsRate(userId, r1.resource.rates.find(t => t.effectiveFrom === '2090-01-01').id, { rateMinor: 99900 });
  const after = db.getOutsStatement(userId, draft.statement.id);
  record('Statement: a later rate change leaves the issued snapshot alone',
    after.totalMinor === 53333 && after.lines.find(l => l.rateMinor === 20000)?.amountMinor === 43333);
  const res1 = db.getOutsResource(userId, resA.id);
  record('Resource: unpaid = unbilled + issued', res1.issuedMinor === 53333 && res1.unpaidMinor === res1.unbilledMinor + 53333, JSON.stringify(res1));
  record('Resource: cannot be deleted, project with billed entries cannot be deleted',
    !db.deleteOutsResource(userId, resA.id).ok && !db.deleteOutsProject(userId, P1).ok);
  record('Statement: only a draft changes its period; a draft or cancelled one can be deleted',
    !db.updateOutsStatement(userId, draft.statement.id, { periodTo: '2090-07-31' }).ok
      && db.updateOutsStatement(userId, draft.statement.id, { notes: 'generic note' }).ok
      && !db.deleteOutsStatement(userId, draft.statement.id).ok);
  record('Statement: duplicate number refused', !db.updateOutsStatement(userId, second.statement.id, { reference: 'st-001' }).ok);

  const paid = db.markOutsStatementPaid(userId, draft.statement.id, { paidOn: '2090-08-05', note: 'bank transfer' });
  record('Statement: marked paid with date and note; unpaid total drops',
    paid.ok && paid.statement.status === 'PAID' && paid.statement.paidAt === '2090-08-05'
      && db.getOutsResource(userId, resA.id).issuedMinor === 0);
  record('Statement: a paid statement cannot be cancelled', !db.cancelOutsStatement(userId, draft.statement.id).ok);
  const unpaid = db.markOutsStatementUnpaid(userId, draft.statement.id);
  const cancelled = db.cancelOutsStatement(userId, draft.statement.id);
  record('Statement: unpaid → cancel unlocks its entries; the snapshot stays',
    unpaid.ok && cancelled.ok && cancelled.statement.status === 'CANCELLED' && cancelled.statement.lines.length === 2
      && !db.listOutsEntries(userId, resA.id).entries.find(e => e.id === e2.entry.id).locked
      && db.updateOutsEntry(userId, e2.entry.id, { description: 'Editable again' }).ok);
  const del = db.deleteOutsStatement(userId, draft.statement.id);
  const restoredSt = db.restoreOutsStatement(userId, draft.statement.id);
  record('Statement: a cancelled statement can be deleted and restored', del.ok && restoredSt.ok);
  const reissue = db.issueOutsStatement(userId, second.statement.id);
  record('Statement: the freed entries are billed by the next statement',
    reissue.ok && reissue.statement.entries.some(e => e.id === e2.entry.id) && reissue.statement.totalMinutes === 287,
    JSON.stringify(reissue.statement && reissue.statement.totalMinutes));
  record('Statement: empty period refused; another login cannot see or issue',
    !db.issueOutsStatement(userId, db.createOutsStatement(userId, resA.id, { periodFrom: '2095-01-01', periodTo: '2095-01-31' }).statement.id).ok
      && db.getOutsStatement(otherId, second.statement.id) === null && !db.issueOutsStatement(otherId, second.statement.id).ok
      && db.listOutsStatements(otherId, resA.id).length === 0);
  record('Statement: list newest period first, drafts priced live',
    db.listOutsStatements(userId, resA.id).map(x => x.reference).join() === 'ST-003,ST-002,ST-001');

  // ── Overview summary ────────────────────────────────────────────────────
  const sum = db.getOutsUnpaidSummary(userId);
  record('Overview: unpaid summary per currency for this login only',
    sum.totals.length >= 1 && sum.totals[0].currency === currency && sum.totals[0].issuedMinor > 0
      && db.getOutsUnpaidSummary(otherId).people <= 1, JSON.stringify(sum));

  // ── Quick Find (066 + 067 triggers) ─────────────────────────────────────
  // A fresh entry: the ones above are now locked on ST-002.
  const e6 = db.createOutsEntry(userId, P1, { date: '2091-01-03', minutes: 15 }).entry;
  const key = `${resA.id}:${P1}:${e6.id}`;
  record('Search: resource, project and entries are indexed for their login only',
    search('outs-resource', resA.id) === 1 && search('outs-project', `${resA.id}:${P1}`) === 1 && search('outs-entry', key) === 1
      && db.searchWorkspace(userId, 'Resource A').some(r => r.kind === 'outs-resource' && r.id === resA.id)
      && !db.searchWorkspace(otherId, 'Generic work').some(r => r.kind === 'outs-entry' && r.id === key));
  db.updateOutsEntry(userId, e6.id, { description: 'Renamed task' });
  record('Search: an entry edit re-indexes it', db.searchWorkspace(userId, 'Renamed task').some(r => r.kind === 'outs-entry' && r.id === key));
  db.updateOutsProject(userId, P1, { name: 'Project One Renamed' });
  db.updateOutsResource(userId, resA.id, { name: 'Resource Renamed' });
  const sub = conn.prepare("SELECT subtitle FROM workspace_search WHERE kind = 'outs-entry' AND entity_id = ?").get(key)?.subtitle;
  record('Search: renaming the project and the resource refreshes the entry',
    sub === 'Resource Renamed · Project One Renamed · 2091-01-03', String(sub));

  // ── Resource delete / undo / purge ──────────────────────────────────────
  const resB = db.createOutsResource(userId, { name: 'Resource B', currency }).resource;
  const pB = db.createOutsProject(userId, resB.id, { name: 'P' }).project;
  const eB = db.createOutsEntry(userId, pB.id, { date: '2090-01-02', minutes: 30 }).entry;
  db.deleteOutsResource(userId, resB.id);
  const hidden = db.getOutsResource(userId, resB.id) === null && search('outs-entry', `${resB.id}:${pB.id}:${eB.id}`) === 0
    && search('outs-project', `${resB.id}:${pB.id}`) === 0 && !db.updateOutsEntry(userId, eB.id, { minutes: 1 }).ok;
  db.restoreOutsResource(userId, resB.id);
  record('Resource: delete hides it, its projects and entries; undo restores all',
    hidden && search('outs-entry', `${resB.id}:${pB.id}:${eB.id}`) === 1 && db.listOutsEntries(userId, resB.id).entries.length === 1);
  db.deleteOutsResource(userId, resB.id);
  record('Resource: purge removes it with its projects and entries (cascade)',
    db.purgeOutsResource(userId, resB.id).ok && count('SELECT COUNT(*) AS n FROM outs_projects WHERE resource_id = ?', resB.id) === 0
      && count('SELECT COUNT(*) AS n FROM outs_entries WHERE resource_id = ?', resB.id) === 0);

  // ── History ─────────────────────────────────────────────────────────────
  const fields = new Set(db.getOutsHistory(userId, resA.id).map(h => h.field));
  record('History: resource, project, rate, entry and statement changes are recorded',
    ['Created', 'Active', 'Rate Added', 'Rate', 'Project Added', 'Project Name', 'Project Deleted', 'Project Restored',
      'Minutes', 'Project', 'Entry Deleted', 'Entry Restored', 'Statement Created', 'ST-001: Status', 'Statement Deleted']
      .every(f => fields.has(f)), JSON.stringify([...fields]));

  // ── Boot-time purge ─────────────────────────────────────────────────────
  const pTmp = db.createOutsProject(userId, resA.id, { name: 'Temporary' }).project;
  db.deleteOutsProject(userId, pTmp.id);
  const leftover = db.createOutsEntry(userId, P2, { date: '2090-02-02', minutes: 5 }).entry;
  db.deleteOutsEntry(userId, leftover.id);
  const report = db.runMaintenance();
  record('Maintenance: rows left in their undo window are purged at boot',
    report.outsPurged?.entries >= 1 && report.outsPurged?.projects >= 1
      && count('SELECT COUNT(*) AS n FROM outs_entries WHERE id = ?', leftover.id) === 0
      && count('SELECT COUNT(*) AS n FROM outs_projects WHERE id = ?', pTmp.id) === 0, JSON.stringify(report.outsPurged));

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
