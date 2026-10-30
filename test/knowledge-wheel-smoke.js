'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge wheel (Knowledge Hub → Wheel) — headless smoke test.
//
// Loads renderer/features/knowledge-wheel.js into a bare VM context with the
// few renderer globals it reads stubbed, and checks knowledgeWheelModel.
//
// Run:  node test/knowledge-wheel-smoke.js
//
// Covers: one arc per type in catalog order with untyped articles last; each
// client and system appears once however many articles link it; an article
// with no links still gets a place; no Clients/Systems arc when nothing links.
// ─────────────────────────────────────────────────────────────────────────────
const fs   = require('node:fs');
const path = require('node:path');
const vm   = require('node:vm');

const results = [];
function record(flow, pass, details = '') { results.push({ flow, pass, details }); }

try {
  const ctx = vm.createContext({
    LK: { categories: { KNOWLEDGE_TYPE: [{ code: 'MANUAL' }, { code: 'GUIDE' }, { code: 'SOP' }] } },
    lkLabel: (_cat, code) => ({ MANUAL: 'Manual', GUIDE: 'Guide', SOP: 'SOP' })[code] || '',
    knowledgeLinkName: (_kind, link) => link.nameEn,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'features', 'knowledge-wheel.js'), 'utf8'), ctx);
  const model = vm.runInContext('knowledgeWheelModel', ctx);

  const acme = { id: 1, nameEn: 'Acme' }, north = { id: 2, nameEn: 'Northwind' }, erp = { id: 9, nameEn: 'ERP' };
  const items = [
    { id: 11, title: 'Zeta guide', type: 'GUIDE', companies: [acme], systems: [erp] },
    { id: 12, title: 'Alpha guide', type: 'GUIDE', companies: [acme, north], systems: [] },
    { id: 13, title: 'Manual one', type: 'MANUAL', companies: [], systems: [erp] },
    { id: 14, title: 'Loose note', type: '', companies: [], systems: [] },
  ];
  const arcs = model(items);
  const kinds = arcs.map(a => a.kind + ':' + (a.code ?? a.label));
  record('Arcs: types in catalog order, untyped last, then Clients and Systems',
    JSON.stringify(kinds) === JSON.stringify(['type:MANUAL', 'type:GUIDE', 'type:', 'companies:Clients', 'systems:Systems']), JSON.stringify(kinds));

  const guide = arcs.find(a => a.code === 'GUIDE');
  record('Articles inside a type are in title order', guide.nodes.map(n => n.label).join('|') === 'Alpha guide|Zeta guide',
    guide.nodes.map(n => n.label).join('|'));

  const clients = arcs.find(a => a.kind === 'companies');
  const acmeNode = clients.nodes.find(n => n.label === 'Acme');
  record('A client linked by two articles appears once, holding both', clients.nodes.length === 2 && acmeNode.items.length === 2,
    JSON.stringify(clients.nodes.map(n => [n.label, n.items.length])));

  record('An article with no links still has a place on the wheel',
    arcs.some(a => a.nodes.some(n => n.kind === 'article' && n.item.id === 14)));

  record('Type slots follow arc order (fixed hues, never by size)', arcs.filter(a => a.kind === 'type').map(a => a.slot).join(',') === '1,2,3');

  const hid = model(items, new Set(['GUIDE']));
  const hidGuide = hid.find(a => a.code === 'GUIDE');
  const hidClients = hid.find(a => a.kind === 'companies');
  record('A hidden type keeps its arc and slot but adds no clients',
    hidGuide.hidden === true && hidGuide.slot === 2 && !hidClients
      && hid.find(a => a.kind === 'systems').nodes[0].items.length === 1,
    JSON.stringify(hid.map(a => [a.kind, a.code, a.hidden, a.nodes.length])));

  const many = Array.from({ length: 12 }, (_, i) => ({ code: 'T' + i }));
  const ctx12 = vm.createContext({ LK: { categories: { KNOWLEDGE_TYPE: many } }, lkLabel: () => '', knowledgeLinkName: () => '' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'features', 'knowledge-wheel.js'), 'utf8'), ctx12);
  const slots = vm.runInContext('knowledgeWheelModel', ctx12)(many.map((t, i) => ({ id: i, title: 'x' + i, type: t.code })))
    .map(a => a.slot);
  record('Twelve types each get their own colour', new Set(slots).size === 12 && !slots.includes(0), slots.join(','));

  const centre = vm.runInContext('kwCentreLargest', ctx)([1, 5, 3, 2].map(n => ({ n, nodes: Array(n) })));
  record('The largest type is drawn in the middle', centre[Math.floor(centre.length / 2)].n === 5 || centre[Math.floor((centre.length - 1) / 2)].n === 5,
    centre.map(a => a.n).join(','));

  const lonely = model([{ id: 20, title: 'Alone', type: 'SOP', companies: [], systems: [] }]);
  record('No Clients or Systems arc when nothing is linked', lonely.length === 1 && lonely[0].kind === 'type', JSON.stringify(lonely.map(a => a.kind)));

  const withProject = model([...items, { id: 15, title: 'Go-live notes', type: 'SOP', companies: [], systems: [], tags: ['Ops'], projectId: 7, projectName: 'Go-live' }]);
  const projectArc = withProject.find(a => a.kind === 'projects');
  record('A project is a hub in its own arc, after Tags',
    withProject.slice(-2).map(a => a.kind).join(',') === 'tags,projects' && projectArc.nodes[0].label === 'Go-live' && projectArc.nodes[0].items.length === 1,
    JSON.stringify(withProject.map(a => a.kind)));
  const noSystems = model(items, new Set(), { systems: false, tags: false });
  record('A hub kind switched off gets no arc', !noSystems.some(a => a.kind === 'systems' || a.kind === 'tags') && noSystems.some(a => a.kind === 'companies'),
    JSON.stringify(noSystems.map(a => a.kind)));

  const restore = vm.runInContext('knowledgeViewSettings', ctx);
  const defaults = vm.runInContext('KW_DEFAULTS', ctx);
  const back = restore(defaults, { tags: false, labels: 'hubs', bundling: 250, links: null, size: '30', panel: 1, extra: 'x' }, { labels: ['all', 'hubs'] });
  record('Saved wheel settings are checked: booleans, 0..100 numbers, known words only',
    back.tags === false && back.labels === 'hubs' && back.bundling === 100 && back.links === 50 && back.size === 30 && back.panel === false && !('extra' in back),
    JSON.stringify(back));
  record('Unknown label mode falls back to the default', restore(defaults, { labels: 'zoom' }, { labels: ['all', 'hubs'] }).labels === 'all');
  const matches = vm.runInContext('knowledgeWheelMatches', ctx);
  const names = [{ label: 'SQL: Sample' }, { label: '#SQL' }, { label: 'Acme' }, { label: 'تجربة' }];
  record('Find matches any part of a name, in any case',
    matches(names, ' sql ').map(n => n.label).join('|') === 'SQL: Sample|#SQL' && matches(names, 'تجر').length === 1);
  record('An empty find box matches nothing', matches(names, '  ').length === 0);
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
