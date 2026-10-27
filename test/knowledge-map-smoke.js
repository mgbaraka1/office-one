'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge map (Knowledge Hub → Map) — headless smoke test.
//
// Loads renderer/features/knowledge-wheel.js and knowledge-map.js into a bare
// VM context with the few renderer globals they read stubbed, and checks the
// model and the force layout. Drawing is not covered (no canvas here).
//
// Run:  node test/knowledge-map-smoke.js
//
// Covers: one hub per client/system/tag/project however many articles link it
// (tags merged across case); duplicate links dropped; hub kinds switched off
// and hidden types leave the model; articles come before hubs; the layout
// settles to finite, repeatable positions; an article sits nearer its own hub
// than another; an unlinked article ends up further out than linked ones; saved
// positions are kept and a new node starts beside a saved neighbour; saved
// settings are clamped; a 2,000-article map settles in reasonable time.
// ─────────────────────────────────────────────────────────────────────────────
const fs   = require('node:fs');
const path = require('node:path');
const vm   = require('node:vm');
const { performance } = require('node:perf_hooks');

const results = [];
function record(flow, pass, details = '') { results.push({ flow, pass, details }); }

function load() {
  const ctx = vm.createContext({
    LK: { categories: { KNOWLEDGE_TYPE: [{ code: 'MANUAL' }, { code: 'GUIDE' }] } },
    lkLabel: (_cat, code) => ({ MANUAL: 'Manual', GUIDE: 'Guide' })[code] || '',
    knowledgeLinkName: (_kind, link) => link.nameEn,
    Math, Number, Object, Array, Set, Map, JSON, performance,
  });
  ['knowledge-wheel.js', 'knowledge-map.js'].forEach(file =>
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'features', file), 'utf8'), ctx));
  return ctx;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

try {
  const ctx = load();
  const model = vm.runInContext('knowledgeMapModel', ctx);
  const simulate = vm.runInContext('knowledgeMapSimulation', ctx);
  const settle = vm.runInContext('knowledgeMapSettle', ctx);
  const params = vm.runInContext('knowledgeMapParams', ctx)();

  const acme = { id: 1, nameEn: 'Acme' }, north = { id: 2, nameEn: 'Northwind' }, erp = { id: 9, nameEn: 'ERP' };
  const items = [
    { id: 11, title: 'Zeta guide', type: 'GUIDE', companies: [acme, acme], systems: [erp], tags: ['SQL'], projectId: 5, projectName: 'Go-live' },
    { id: 12, title: 'Alpha guide', type: 'GUIDE', companies: [acme, north], systems: [], tags: ['sql'] },
    { id: 13, title: 'Manual one', type: 'MANUAL', companies: [], systems: [erp], tags: [] },
    { id: 14, title: 'Loose note', type: '', companies: [], systems: [], tags: [] },
    { id: 15, title: 'Tag only', type: 'MANUAL', companies: [], systems: [], tags: ['Ops'] },
  ];

  const g = model(items);
  const keys = g.nodes.map(n => n.key);
  record('Articles come first, then one hub per client, system, tag and project',
    JSON.stringify(keys) === JSON.stringify(['a11', 'a12', 'a13', 'a14', 'a15', 'c1', 's9', 'tsql', 'p5', 'c2', 'tops']), JSON.stringify(keys));
  const acmeHub = g.byKey.get('c1'), sqlHub = g.byKey.get('tsql');
  record('A client linked twice by one article counts once', acmeHub.degree === 2 && g.byKey.get('a11').degree === 4,
    `acme=${acmeHub.degree} zeta=${g.byKey.get('a11').degree}`);
  record('Tags merge across case and keep the first spelling', sqlHub.degree === 2 && sqlHub.label === '#SQL', sqlHub.label);
  record('A project is a hub labelled with its name', g.byKey.get('p5')?.label === 'Go-live');
  record('Links match the degrees', g.links.length === g.nodes.filter(n => n.kind !== 'article').reduce((s, n) => s + n.degree, 0), String(g.links.length));
  record('Articles take the same type colour as on the wheel', g.byKey.get('a13').slot === 1 && g.byKey.get('a11').slot === 2 && g.byKey.get('a14').slot === 3,
    [13, 11, 14].map(id => g.byKey.get('a' + id).slot).join(','));

  const noTags = model(items, { tags: false });
  record('Switching tags off drops tag hubs and leaves a tag-only article unlinked',
    !noTags.byKey.has('tsql') && noTags.byKey.get('a15').degree === 0, JSON.stringify(noTags.nodes.map(n => n.key)));
  const noGuide = model(items, {}, new Set(['GUIDE']));
  record('A hidden type drops its articles and the hubs only it linked',
    !noGuide.byKey.has('a11') && !noGuide.byKey.has('c1') && !noGuide.byKey.has('p5') && noGuide.byKey.get('s9').degree === 1
      && noGuide.types.get('GUIDE').hidden === true, JSON.stringify(noGuide.nodes.map(n => n.key)));

  const counts = vm.runInContext('knowledgeMapHubCounts', ctx)(items);
  record('Hub counts per kind', JSON.stringify(counts) === JSON.stringify({ companies: 2, systems: 1, tags: 2, projects: 1 }), JSON.stringify(counts));

  // Two clusters: articles on client A, articles on client B, plus loose ones.
  const cluster = [];
  for (let i = 0; i < 30; i++) cluster.push({ id: 100 + i, title: 'A' + i, type: 'GUIDE', companies: [{ id: 50, nameEn: 'A' }], systems: [], tags: [] });
  for (let i = 0; i < 30; i++) cluster.push({ id: 200 + i, title: 'B' + i, type: 'MANUAL', companies: [{ id: 60, nameEn: 'B' }], systems: [], tags: [] });
  for (let i = 0; i < 6; i++) cluster.push({ id: 300 + i, title: 'L' + i, type: '', companies: [], systems: [], tags: [] });
  const run = () => { const gr = model(cluster); settle(simulate(gr, params), 600); return gr; };
  const c1 = run(), c2 = run();
  record('Every position is a finite number', c1.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
  record('The same items settle the same way', c1.nodes.every((n, i) => n.x === c2.nodes[i].x && n.y === c2.nodes[i].y));
  const hubA = c1.byKey.get('c50'), hubB = c1.byKey.get('c60');
  const aArticles = c1.nodes.filter(n => n.key.startsWith('a1'));
  const near = aArticles.filter(n => dist(n, hubA) < dist(n, hubB)).length;
  record('Articles gather round their own client', near === aArticles.length, `${near}/${aArticles.length}`);
  const centre = { x: c1.nodes.reduce((s, n) => s + n.x, 0) / c1.nodes.length, y: c1.nodes.reduce((s, n) => s + n.y, 0) / c1.nodes.length };
  const linkedR = c1.nodes.filter(n => n.kind === 'article' && n.degree).map(n => dist(n, centre)).sort((a, b) => a - b);
  const looseR = c1.nodes.filter(n => n.kind === 'article' && !n.degree).map(n => dist(n, centre));
  const median = linkedR[Math.floor(linkedR.length / 2)];
  record('Unlinked articles drift further out than the linked ones', looseR.every(r => r > median), `median ${median.toFixed(1)} loose ${looseR.map(r => r.toFixed(1)).join(',')}`);
  record('The two clusters do not sit on top of each other', dist(hubA, hubB) > params.distance * 1.5, dist(hubA, hubB).toFixed(1));

  // Saved positions: kept as they were; a new article starts beside its saved hub.
  const saved = new Map([['c50', { x: 500, y: -300 }], ['a100', { x: 480, y: -290 }]]);
  const g2 = model(cluster.slice(0, 3));
  simulate(g2, params, saved);
  const a101 = g2.byKey.get('a101');
  record('Saved positions are kept on redraw', g2.byKey.get('c50').x === 500 && g2.byKey.get('a100').y === -290);
  record('A new article starts beside a saved neighbour', dist(a101, { x: 500, y: -300 }) < 20, `${a101.x.toFixed(1)},${a101.y.toFixed(1)}`);

  // Settings restore: bad values fall back or are clamped.
  vm.runInContext('knowledgeMapRestoreSettings({ tags: false, labels: "nope", repel: 400, distance: "x", gravity: -3, panel: "yes" })', ctx);
  const s = vm.runInContext('knowledgeMapSettings', ctx);
  record('Saved settings are clamped and checked',
    s.tags === false && s.companies === true && s.labels === 'zoom' && s.repel === 100 && s.distance === 50 && s.gravity === 0 && s.panel === false,
    JSON.stringify(s));

  // Scale: 2,000 articles over 120 hubs.
  const big = Array.from({ length: 2000 }, (_, i) => ({
    id: i, title: 'Item ' + i, type: i % 3 ? 'GUIDE' : 'MANUAL',
    companies: [{ id: i % 40, nameEn: 'C' + (i % 40) }], systems: i % 2 ? [{ id: i % 30, nameEn: 'S' + (i % 30) }] : [], tags: i % 5 ? [] : ['t' + (i % 50)],
  }));
  const t0 = Date.now();
  const gb = model(big);
  settle(simulate(gb, params), 300);
  const ms = Date.now() - t0;
  record('A 2,000-article map settles in under 15 seconds headless', ms < 15000 && gb.nodes.every(n => Number.isFinite(n.x)), `${ms} ms for ${gb.nodes.length} nodes`);
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
