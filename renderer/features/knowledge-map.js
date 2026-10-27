// ══ KNOWLEDGE MAP (Knowledge Hub → Map) ═══════════════════════════════════════
// The items the list would show as a network, in the spirit of Obsidian's graph
// view. Every article is a dot coloured by its type (the wheel's colours); each
// client, system, tag and project an article is linked to is a bigger "hub"
// with its own shape. A small force layout pulls linked dots together and
// pushes everything apart, so articles that share hubs gather into clusters and
// articles linked to nothing drift to the outer ring.
//
// Drawn on a canvas so thousands of dots stay smooth. Scroll zooms, dragging
// empty space pans, dragging a dot moves it. Hovering lights a dot and its
// neighbours; clicking an article opens it, clicking a hub keeps its links lit.
// The legend hides or shows types and hub kinds; the settings panel holds the
// label mode and the three forces. Read-only: nothing here writes data.
//
// Positions are kept per node key across redraws, so changing a filter moves
// only what changed instead of shuffling the whole map.

let knowledgeMapItems = [];
let knowledgeMapState = null;          // the live map: canvas, graph, view, simulation
let knowledgeMapPinned = null;         // node key kept lit after a click
let knowledgeMapObserver = null;
const knowledgeMapPositions = new Map();   // node key -> { x, y }
const knowledgeMapHidden = new Set();      // type codes switched off in the legend

const KM_HUB_KINDS = ['companies', 'systems', 'tags', 'projects'];
const KM_HUB_PREFIX = { companies: 'c', systems: 's', tags: 't', projects: 'p' };
const KM_LABEL_MODES = ['hubs', 'zoom', 'all'];
const KM_DEFAULTS = Object.freeze({
  companies: true, systems: true, tags: true, projects: true,
  labels: 'zoom', repel: 50, distance: 50, gravity: 50, panel: false,
});
let knowledgeMapSettings = { ...KM_DEFAULTS };

// ── Settings (kept in uiState.filters.knowledge.map) ──

function knowledgeMapRestoreSettings(saved) {
  knowledgeMapSettings = knowledgeViewSettings(KM_DEFAULTS, saved, { labels: KM_LABEL_MODES });
}

function knowledgeMapSaveSettings() { knowledgeSaveViewSettings('map', knowledgeMapSettings); }

// Slider values (0..100, 50 = default) to force strengths.
function knowledgeMapParams(s = knowledgeMapSettings) {
  return {
    charge: -(12 + s.repel * 0.56),        // -12 .. -68
    distance: 12 + s.distance * 0.76,      // 12 .. 88
    gravity: 0.004 + s.gravity * 0.00072,  // .004 .. .076
  };
}

// ── Model ──

// Articles (in the wheel's type colours) and one hub per client, system, tag
// and project they link to. Hubs of a kind switched off in `show`, and
// articles of a type in `hidden`, are left out. Articles come first in
// `nodes`, so hubs draw on top.
function knowledgeMapModel(items, show = {}, hidden = new Set()) {
  const types = new Map();
  knowledgeWheelModel(items).filter(a => a.kind === 'type')
    .forEach(a => types.set(a.code, { code: a.code, slot: a.slot, label: a.label, count: a.nodes.length, hidden: hidden.has(a.code) }));

  const articles = [], hubs = [], links = [], byKey = new Map(), seen = new Set();
  const visible = items.filter(item => !hidden.has(item.type || ''));
  visible.forEach(item => {
    const node = { key: 'a' + item.id, kind: 'article', label: item.title, item, slot: types.get(item.type || '')?.slot ?? 0, degree: 0, adj: [] };
    byKey.set(node.key, node); articles.push(node);
  });
  const hub = (kind, id, label) => {
    const key = KM_HUB_PREFIX[kind] + id;
    if (!byKey.has(key)) {
      const node = { key, kind, label, degree: 0, adj: [] };
      byKey.set(key, node); hubs.push(node);
    }
    return byKey.get(key);
  };
  const link = (article, target) => {
    const id = article.key + '|' + target.key;
    if (seen.has(id)) return;
    seen.add(id);
    links.push({ source: article, target });
    article.degree++; target.degree++;
    article.adj.push(target); target.adj.push(article);
  };
  visible.forEach(item => {
    const a = byKey.get('a' + item.id);
    ['companies', 'systems'].forEach(kind => {
      if (show[kind] === false) return;
      (item[kind] || []).forEach(l => link(a, hub(kind, l.id, knowledgeLinkName(kind, l))));
    });
    if (show.tags !== false) (item.tags || []).forEach(tag => link(a, hub('tags', tag.toLowerCase(), '#' + tag)));
    if (show.projects !== false && item.projectId) link(a, hub('projects', item.projectId, item.projectName || 'Project'));
  });
  return { nodes: [...articles, ...hubs], links, byKey, types };
}

// How many hubs of each kind the items have, whether or not they are shown.
function knowledgeMapHubCounts(items) {
  const sets = { companies: new Set(), systems: new Set(), tags: new Set(), projects: new Set() };
  items.forEach(item => {
    (item.companies || []).forEach(l => sets.companies.add(l.id));
    (item.systems || []).forEach(l => sets.systems.add(l.id));
    (item.tags || []).forEach(t => sets.tags.add(t.toLowerCase()));
    if (item.projectId) sets.projects.add(item.projectId);
  });
  return Object.fromEntries(KM_HUB_KINDS.map(k => [k, sets[k].size]));
}

// ── Force layout ──
// A small d3-style simulation: links pull (springs), every node pushes every
// other (Barnes-Hut approximated, so it stays fast with thousands of nodes),
// and a gentle pull keeps everything near the middle. Deterministic: the same
// items always settle the same way.

function knowledgeMapSimulation(graph, params, saved = new Map()) {
  const sim = {
    nodes: graph.nodes, links: graph.links, p: params,
    alpha: 1, alphaMin: 0.001, alphaDecay: 1 - Math.pow(0.001, 1 / 300), alphaTarget: 0, seed: 1,
  };
  graph.links.forEach(l => {
    l.strength = 1 / Math.min(l.source.degree, l.target.degree);
    l.bias = l.source.degree / (l.source.degree + l.target.degree);
  });
  kmApplyParams(sim, params);
  kmSeed(graph.nodes, saved);
  return sim;
}

function kmApplyParams(sim, params) {
  sim.p = params;
  // Hubs push harder, which opens a space around each cluster.
  sim.nodes.forEach(n => { n.charge = params.charge * (n.kind === 'article' ? 1 : 1 + Math.sqrt(n.degree) * 0.5); });
}

// Saved nodes keep their place; a new node starts beside a saved neighbour if
// it has one, otherwise on a sunflower spiral around the middle.
function kmSeed(nodes, saved) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  nodes.forEach((n, i) => {
    n.vx = 0; n.vy = 0; n.fx = null; n.fy = null;
    const at = saved.get(n.key);
    if (at) { n.x = at.x; n.y = at.y; n.placed = true; return; }
    n.placed = false;
    const r = 10 * Math.sqrt(0.5 + i), a = i * golden;
    n.x = r * Math.cos(a); n.y = r * Math.sin(a);
  });
  nodes.forEach((n, i) => {
    if (n.placed) return;
    const near = n.adj.find(m => m.placed);
    if (!near) return;
    const a = i * golden;
    n.x = near.x + 12 * Math.cos(a); n.y = near.y + 12 * Math.sin(a);
  });
}

function kmJiggle(sim) {
  sim.seed = (sim.seed * 1664525 + 1013904223) % 4294967296;
  return (sim.seed / 4294967296 - 0.5) * 1e-6;
}

// Plain loops here, not forEach: this runs for every node on every frame.
function kmTick(sim) {
  const { nodes, links, p, alpha } = sim;
  for (let i = 0; i < links.length; i++) {
    const l = links[i], s = l.source, t = l.target;
    let dx = t.x + t.vx - s.x - s.vx || kmJiggle(sim);
    let dy = t.y + t.vy - s.y - s.vy || kmJiggle(sim);
    const d = Math.sqrt(dx * dx + dy * dy);
    const f = (d - p.distance) / d * alpha * l.strength;
    dx *= f; dy *= f;
    t.vx -= dx * l.bias; t.vy -= dy * l.bias;
    s.vx += dx * (1 - l.bias); s.vy += dy * (1 - l.bias);
  }
  if (nodes.length > 1) {
    const tree = kmQuadtree(nodes), stack = [];
    for (let i = 0; i < nodes.length; i++) kmCharge(tree, nodes[i], alpha, sim, stack);
  }
  const g = p.gravity * alpha;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0; continue; }
    n.vx = (n.vx - n.x * g) * 0.6;
    n.vy = (n.vy - n.y * g) * 0.6;
    n.x += n.vx; n.y += n.vy;
  }
  sim.alpha += (sim.alphaTarget - sim.alpha) * sim.alphaDecay;
}

function kmQuadtree(nodes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x;
    if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y;
  }
  const root = kmCell(x0, y0, Math.max(x1 - x0, y1 - y0, 1) * 1.0001);
  for (let i = 0; i < nodes.length; i++) kmInsert(root, nodes[i], 0);
  kmAccumulate(root);
  return root;
}

function kmCell(x0, y0, s) {
  return { x0, y0, s, children: null, points: null, value: 0, cx: 0, cy: 0 };
}

function kmInsert(q, n, depth) {
  for (;;) {
    if (!q.children) {
      if (!q.points) { q.points = [n]; return; }
      // Same spot, or as deep as is useful: share the leaf.
      if (depth > 30 || (q.points[0].x === n.x && q.points[0].y === n.y)) { q.points.push(n); return; }
      const old = q.points;
      q.points = null; q.children = [null, null, null, null];
      for (let i = 0; i < old.length; i++) kmInsert(kmChild(q, old[i]), old[i], depth + 1);
    }
    q = kmChild(q, n);
    depth++;
  }
}

function kmChild(q, n) {
  const h = q.s / 2;
  const i = (n.x >= q.x0 + h ? 1 : 0) + (n.y >= q.y0 + h ? 2 : 0);
  return q.children[i] || (q.children[i] = kmCell(q.x0 + (i & 1 ? h : 0), q.y0 + (i & 2 ? h : 0), h));
}

function kmAccumulate(q) {
  let value = 0, wx = 0, wy = 0, w = 0;
  if (q.points) {
    for (let i = 0; i < q.points.length; i++) {
      const n = q.points[i], a = Math.abs(n.charge);
      value += n.charge; wx += n.x * a; wy += n.y * a; w += a;
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const c = q.children[i];
      if (!c) continue;
      kmAccumulate(c);
      const a = Math.abs(c.value);
      value += c.value; wx += c.cx * a; wy += c.cy * a; w += a;
    }
  }
  q.value = value;
  q.cx = w ? wx / w : q.x0 + q.s / 2;
  q.cy = w ? wy / w : q.y0 + q.s / 2;
}

const KM_THETA2 = 0.81;   // Barnes-Hut accuracy (theta 0.9, as d3)
function kmCharge(root, n, alpha, sim, stack) {
  stack.length = 0;
  stack.push(root);
  while (stack.length) {
    const q = stack.pop();
    if (q.children) {
      const dx = q.cx - n.x, dy = q.cy - n.y;
      let l = dx * dx + dy * dy;
      if (q.s * q.s / KM_THETA2 < l) {   // far enough: treat the cell as one body
        if (l < 1) l = Math.sqrt(l);
        const f = q.value * alpha / l;
        n.vx += dx * f; n.vy += dy * f;
      } else {
        for (let i = 0; i < 4; i++) if (q.children[i]) stack.push(q.children[i]);
      }
      continue;
    }
    for (let i = 0; i < q.points.length; i++) {
      const o = q.points[i];
      if (o === n) continue;
      let dx = o.x - n.x, dy = o.y - n.y, l = dx * dx + dy * dy;
      if (l === 0) { dx = kmJiggle(sim); dy = kmJiggle(sim); l = dx * dx + dy * dy; }
      if (l < 1) l = Math.sqrt(l);
      const f = o.charge * alpha / l;
      n.vx += dx * f; n.vy += dy * f;
    }
  }
}

// Runs the simulation to rest without drawing (used by the smoke test).
function knowledgeMapSettle(sim, maxTicks = 400) {
  for (let i = 0; i < maxTicks && sim.alpha >= sim.alphaMin; i++) kmTick(sim);
  return sim;
}

// ── Drawing ──

function kmRadius(n, hubMax) {
  return n.kind === 'article' ? 3 + Math.min(3, Math.sqrt(n.degree) * 0.8) : 5 + 12 * Math.sqrt(n.degree / hubMax);
}

function setKnowledgeMapSetting(key, value) {
  knowledgeMapSettings[key] = value;
  knowledgeMapSaveSettings();
}

function drawKnowledgeMap(host, items) {
  const prev = knowledgeMapState;
  if (prev) { cancelAnimationFrame(prev.raf); kmRemember(prev); }
  knowledgeMapItems = items;
  host.innerHTML = '';
  ensureKnowledgeMapObserver(host);

  // Forget hidden types that are no longer in the list, and never hide them all.
  const present = new Set(items.map(item => item.type || ''));
  [...knowledgeMapHidden].forEach(code => { if (!present.has(code)) knowledgeMapHidden.delete(code); });
  if (knowledgeMapHidden.size >= present.size) knowledgeMapHidden.clear();

  const graph = knowledgeMapModel(items, knowledgeMapSettings, knowledgeMapHidden);
  if (knowledgeMapPinned && !graph.byKey.has(knowledgeMapPinned)) knowledgeMapPinned = null;
  const hubMax = Math.max(1, ...graph.nodes.filter(n => n.kind !== 'article').map(n => n.degree));
  graph.nodes.forEach(n => {
    n.r = kmRadius(n, hubMax);
    n.short = kwTruncate(n.label, n.kind === 'article' ? 34 : 28);
  });

  const info = pjMk('div', 'kw-info km-info');
  info.setAttribute('aria-live', 'polite');
  host.appendChild(info);
  host.appendChild(kmLegend(host, items, graph));

  const stage = pjMk('div', 'km-stage');
  const canvas = document.createElement('canvas');
  canvas.className = 'km-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Knowledge map: articles and the clients, systems, tags and projects they are linked to');
  stage.appendChild(canvas);
  host.appendChild(stage);

  const fresh = graph.nodes.filter(n => !knowledgeMapPositions.has(n.key)).length;
  // Mostly the same dots (a type hidden, a filter widened): keep the user's
  // zoom and pan. Mostly new ones: start fitted, whatever the last map was.
  const same = fresh < graph.nodes.length * 0.5;
  const keepView = same && prev?.userMoved && prev.view;
  const sim = knowledgeMapSimulation(graph, knowledgeMapParams(), knowledgeMapPositions);
  const state = {
    host, stage, canvas, ctx: canvas.getContext('2d'), info, graph, sim,
    view: keepView ? { ...prev.view } : { x: 0, y: 0, k: 1 },
    userMoved: !!keepView, hover: null, press: null, raf: 0, width: 0, height: 0, dpr: 1,
    font: getComputedStyle(host).fontFamily || 'sans-serif',
  };
  knowledgeMapState = state;
  // Mostly placed already (a filter changed): settle gently, no jump.
  if (same) sim.alpha = fresh ? 0.35 : 0.12;
  // A brand-new layout settles most of the way before the first frame, so the
  // map opens looking like itself rather than as a ball that bursts open.
  else { const t0 = performance.now(); while (sim.alpha > 0.08 && performance.now() - t0 < 160) kmTick(sim); }

  stage.appendChild(kmPanel(state));
  stage.appendChild(kmZoomControls(state));
  kmBindPointer(state);
  kmResize(state);
  if (!state.userMoved) kmFit(state);
  kmInfo(state);

  const loose = graph.nodes.filter(n => n.kind === 'article' && !n.degree);
  if (loose.length) {
    const note = pjMk('div', 'kw-unlinked');
    note.appendChild(pjMk('span', 'kw-unlinked-title', 'Not linked to anything shown yet:'));
    loose.forEach(n => {
      const b = pjMk('button', 'kw-unlinked-item', n.label);
      b.type = 'button';
      b.dataset.userContent = '';
      b.addEventListener('click', () => openKnowledgeDetail(n.item.id));
      note.appendChild(b);
    });
    host.appendChild(note);
  }
  kmDraw(state);   // the first frame now, not a frame later
  kmKick(state);
}

function kmRemember(state) {
  state.graph.nodes.forEach(n => knowledgeMapPositions.set(n.key, { x: n.x, y: n.y }));
}

// The canvas fills the column and the rest of the window's height.
function kmResize(state) {
  const { stage, canvas } = state;
  const width = Math.max(300, stage.clientWidth || 900);
  const room = window.innerHeight - stage.getBoundingClientRect().top - 24;
  const height = Math.round(Math.min(1100, Math.max(420, room)));
  const dpr = window.devicePixelRatio || 1;
  // Keep the middle of the view where it was.
  if (state.width) { state.view.x += (width - state.width) / 2; state.view.y += (height - state.height) / 2; }
  Object.assign(state, { width, height, dpr });
  stage.style.height = height + 'px';
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
}

function kmFit(state) {
  const nodes = state.graph.nodes;
  if (!nodes.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  nodes.forEach(n => { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r); });
  const pad = 36;
  const k = Math.min(3, Math.max(0.05, Math.min((state.width - 2 * pad) / Math.max(x1 - x0, 1), (state.height - 2 * pad) / Math.max(y1 - y0, 1))));
  state.view = { k, x: state.width / 2 - (x0 + x1) / 2 * k, y: state.height / 2 - (y0 + y1) / 2 * k };
}

function kmZoom(state, factor, sx = state.width / 2, sy = state.height / 2) {
  const v = state.view;
  const k = Math.min(8, Math.max(0.05, v.k * factor));
  v.x = sx - (sx - v.x) * (k / v.k);
  v.y = sy - (sy - v.y) * (k / v.k);
  v.k = k;
  state.userMoved = true;
  kmKick(state);
}

// One animation loop: ticks the layout while it is still moving, draws, and
// stops by itself once the map is at rest and nothing is being dragged.
function kmKick(state) {
  if (state.raf) return;
  state.raf = requestAnimationFrame(() => {
    state.raf = 0;
    if (knowledgeMapState !== state || !state.canvas.isConnected || state.host.hidden) return;
    const sim = state.sim;
    const hot = sim.alpha >= sim.alphaMin || sim.alphaTarget > 0;
    if (hot) {
      kmTick(sim);
      if (sim.nodes.length < 900) kmTick(sim);
      if (!state.userMoved) kmFit(state);
    }
    kmDraw(state);
    if (hot) kmKick(state);
    else kmRemember(state);
  });
}

function kmReheat(state, alpha) {
  state.sim.alpha = Math.max(state.sim.alpha, alpha);
  kmKick(state);
}

function kmColors(state) {
  const css = getComputedStyle(state.stage);
  const v = name => css.getPropertyValue(name).trim();
  return {
    link: v('--km-link') || '#999', hub: v('--km-hub') || '#333', label: v('--km-label') || '#222',
    halo: v('--km-halo') || '#fff', bg: v('--km-bg') || '#fff',
    slots: [v('--kw-other'), ...Array.from({ length: KW_TYPE_SLOTS }, (_, i) => v('--kw-' + (i + 1)))].map(c => c || '#888'),
  };
}

function kmFocus(state) {
  return state.hover || (knowledgeMapPinned && state.graph.byKey.get(knowledgeMapPinned)) || null;
}

function kmShape(ctx, n) {
  const { x, y, r } = n;
  ctx.beginPath();
  if (n.kind === 'systems') ctx.rect(x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76);
  else if (n.kind === 'tags') { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.15, y); ctx.lineTo(x, y + r * 1.15); ctx.lineTo(x - r * 1.15, y); ctx.closePath(); }
  else if (n.kind === 'projects') {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + i * Math.PI / 3;
      if (i) ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); else ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath();
  } else ctx.arc(x, y, r, 0, Math.PI * 2);
}

function kmDraw(state) {
  const { ctx, view, graph, dpr, width, height } = state;
  if (!ctx) return;
  const c = kmColors(state);
  const k = view.k;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * view.x, dpr * view.y);

  const focus = kmFocus(state);
  const lit = focus ? new Set([focus, ...focus.adj]) : null;
  const touches = l => l.source === focus || l.target === focus;

  // Links: all the quiet ones in one stroke, then the lit ones in colour.
  ctx.lineWidth = 1 / k;
  ctx.strokeStyle = c.link;
  ctx.globalAlpha = lit ? 0.07 : 0.45;
  ctx.beginPath();
  graph.links.forEach(l => { if (lit && touches(l)) return; ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y); });
  ctx.stroke();
  if (lit) {
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 1.8 / k;
    graph.links.forEach(l => {
      if (!touches(l)) return;
      ctx.strokeStyle = c.slots[l.source.slot] || c.link;
      ctx.beginPath(); ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y); ctx.stroke();
    });
  }

  // Nodes. An article linked to nothing shown is hollow.
  graph.nodes.forEach(n => {
    ctx.globalAlpha = lit && !lit.has(n) ? 0.16 : 1;
    kmShape(ctx, n);
    if (n.kind === 'article') {
      if (n.degree) { ctx.fillStyle = c.slots[n.slot]; ctx.fill(); }
      else { ctx.fillStyle = c.bg; ctx.fill(); ctx.lineWidth = 1.6 / k; ctx.strokeStyle = c.slots[n.slot]; ctx.stroke(); }
    } else {
      ctx.fillStyle = c.hub; ctx.fill();
    }
    if (n === focus) { ctx.lineWidth = 2.5 / k; ctx.strokeStyle = c.label; ctx.stroke(); }
  });

  kmDrawLabels(state, c, focus, lit);
}

// Labels are drawn in screen pixels (the same size at any zoom) and never on
// top of one another: the hovered dot first, then hubs biggest-first, then
// articles. A label that would overlap one already placed, or a hub's shape,
// is skipped until zooming in makes room for it.
function kmDrawLabels(state, c, focus, lit) {
  const { ctx, view, graph, dpr, width, height } = state;
  const k = view.k;
  const mode = knowledgeMapSettings.labels;
  const fewLit = lit && (lit.size <= 40 || k >= 1.2);
  const show = n => {
    if (lit) return lit.has(n) && (n.kind !== 'article' || n === focus || fewLit);
    if (n.kind !== 'article') return true;
    return mode === 'all' || (mode === 'zoom' && k >= 1.4);
  };
  const rank = n => (n === focus ? 0 : n.kind !== 'article' ? 1 : lit?.has(n) ? 2 : 3);
  const sx = n => view.x + n.x * k, sy = n => view.y + n.y * k;
  const onScreen = n => sx(n) > -150 && sx(n) < width + 150 && sy(n) > -30 && sy(n) < height + 10;
  const picked = graph.nodes.filter(n => show(n) && onScreen(n))
    .sort((a, b) => rank(a) - rank(b) || b.degree - a.degree);

  const boxes = [];
  const hits = box => boxes.some(o => o.node !== box.node && box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0);
  // Hub shapes are obstacles too, so a name never runs across another hub.
  graph.nodes.forEach(n => {
    if (n.kind === 'article' || !onScreen(n)) return;
    const r = n.r * k * 1.1;
    boxes.push({ node: n, x0: sx(n) - r, x1: sx(n) + r, y0: sy(n) - r, y1: sy(n) + r });
  });

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  picked.forEach(n => {
    ctx.font = `${n.kind === 'article' ? 400 : 700} ${n.kind === 'article' ? 11 : 12}px ${state.font}`;
    const w = ctx.measureText(n.short).width, h = n.kind === 'article' ? 13 : 14;
    const cx = sx(n), cy = sy(n), r = n.r * k;
    // Below the dot first; when a neighbour is in the way, above, then beside it.
    const spots = [[cx, cy + r + 3], [cx, cy - r - 3 - h], [cx + r + 5 + w / 2, cy - h / 2], [cx - r - 5 - w / 2, cy - h / 2]];
    let box = null;
    for (const [x, y] of spots) {
      const b = { node: n, x: x, y: y, x0: x - w / 2 - 2, x1: x + w / 2 + 2, y0: y - 1, y1: y + h };
      if (!hits(b)) { box = b; break; }
      if (n === focus && !box) box = b;   // the hovered name is always written
    }
    if (!box) return;
    boxes.push(box);
    ctx.strokeStyle = c.halo;
    ctx.strokeText(n.short, box.x, box.y);
    ctx.fillStyle = c.label;
    ctx.fillText(n.short, box.x, box.y);
  });
}

// ── Readout ──

function kmInfo(state) {
  const info = state.info;
  const node = kmFocus(state);
  if (!node) { info.textContent = 'Scroll to zoom, drag to move. Click an article to open it.'; return; }
  info.innerHTML = '';
  const name = pjMk('strong', null, node.label);
  name.dataset.userContent = '';
  info.appendChild(name);
  if (node.kind === 'article') {
    const type = state.graph.types.get(node.item.type || '');
    if (type) {
      const chip = pjMk('span', 'kw-info-type', type.label);
      if (type.code) chip.dataset.userContent = '';
      info.appendChild(chip);
    }
    const count = kind => node.adj.filter(m => m.kind === kind).length;
    const c = count('companies'), s = count('systems'), t = count('tags'), p = count('projects');
    const parts = [];
    if (c) parts.push(knowledgeWheelCount(c, '1 client', '{n} clients'));
    if (s) parts.push(knowledgeWheelCount(s, '1 system', '{n} systems'));
    if (t) parts.push(knowledgeWheelCount(t, '1 tag', '{n} tags'));
    if (p) parts.push(window.ctI18n?.t('Project') || 'Project');
    info.appendChild(pjMk('span', 'kw-info-detail', parts.length ? parts.join(' · ')
      : (window.ctI18n?.t('Not linked to anything shown yet') || 'Not linked to anything shown yet')));
  } else {
    info.appendChild(pjMk('span', 'kw-info-type', KM_KIND_ONE[node.kind]));
    info.appendChild(pjMk('span', 'kw-info-detail', knowledgeWheelCount(node.degree, '1 article', '{n} articles')));
  }
}

const KM_KIND_ONE = { companies: 'Client', systems: 'System', tags: 'Tag', projects: 'Project' };
const KM_KIND_MANY = { companies: 'Clients', systems: 'Systems', tags: 'Tags', projects: 'Projects' };

// ── Pointer, wheel and keyboard ──

function kmLocal(state, e) {
  const r = state.canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// The node under a screen point: the nearest one whose dot (or a 6px target,
// whichever is bigger) covers it.
function kmHit(state, pt) {
  const { view } = state;
  const wx = (pt.x - view.x) / view.k, wy = (pt.y - view.y) / view.k;
  let best = null, bestScore = Infinity;
  state.graph.nodes.forEach(n => {
    const reach = Math.max(n.r, 6 / view.k);
    const d = Math.hypot(n.x - wx, n.y - wy);
    if (d <= reach && d / reach < bestScore) { best = n; bestScore = d / reach; }
  });
  return best;
}

function kmSetHover(state, node) {
  if (state.hover === node) return;
  state.hover = node;
  state.canvas.style.cursor = node ? 'pointer' : (state.press ? 'grabbing' : 'grab');
  kmInfo(state);
  kmKick(state);
}

function kmBindPointer(state) {
  const { canvas } = state;
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const pt = kmLocal(state, e);
    const node = kmHit(state, pt);
    state.press = { node, x: pt.x, y: pt.y, vx: state.view.x, vy: state.view.y, moved: false };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  });
  canvas.addEventListener('pointermove', e => {
    const pt = kmLocal(state, e);
    const press = state.press;
    if (!press) { kmSetHover(state, kmHit(state, pt)); return; }
    if (!press.moved && Math.hypot(pt.x - press.x, pt.y - press.y) < 4) return;
    if (!press.moved) {
      press.moved = true;
      state.userMoved = true;
      if (press.node) { state.sim.alphaTarget = 0.3; kmReheat(state, 0.3); }
      else canvas.style.cursor = 'grabbing';
    }
    if (press.node) {
      press.node.fx = (pt.x - state.view.x) / state.view.k;
      press.node.fy = (pt.y - state.view.y) / state.view.k;
    } else {
      state.view.x = press.vx + pt.x - press.x;
      state.view.y = press.vy + pt.y - press.y;
    }
    kmKick(state);
  });
  const release = e => {
    const press = state.press;
    if (!press) return;
    state.press = null;
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (press.node && press.moved) { press.node.fx = null; press.node.fy = null; state.sim.alphaTarget = 0; }
    if (!press.moved && e.type === 'pointerup') kmActivate(state, press.node);
    kmSetHover(state, kmHit(state, kmLocal(state, e)));
    kmKick(state);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { if (!state.press) kmSetHover(state, null); });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const pt = kmLocal(state, e);
    kmZoom(state, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), pt.x, pt.y);
  }, { passive: false });
  canvas.addEventListener('dblclick', e => {
    if (kmHit(state, kmLocal(state, e))) return;
    state.userMoved = false;
    kmFit(state); kmKick(state);
  });
  canvas.addEventListener('keydown', e => {
    const pan = 60;
    if (e.key === '+' || e.key === '=') kmZoom(state, 1.25);
    else if (e.key === '-' || e.key === '_') kmZoom(state, 0.8);
    else if (e.key === '0') { state.userMoved = false; kmFit(state); kmKick(state); }
    else if (e.key === 'Escape' && knowledgeMapPinned) { knowledgeMapPinned = null; kmInfo(state); kmKick(state); }
    else if (e.key.startsWith('Arrow')) {
      state.view.x += e.key === 'ArrowLeft' ? pan : e.key === 'ArrowRight' ? -pan : 0;
      state.view.y += e.key === 'ArrowUp' ? pan : e.key === 'ArrowDown' ? -pan : 0;
      state.userMoved = true; kmKick(state);
    } else return;
    e.preventDefault();
  });
  canvas.style.cursor = 'grab';
}

// A click on an article opens it and keeps it lit; on a hub it toggles the
// hub's links staying lit; on empty space it lets go of whatever was lit.
function kmActivate(state, node) {
  if (node?.kind === 'article') {
    knowledgeMapPinned = node.key;
    kmInfo(state); kmKick(state);
    openKnowledgeDetail(node.item.id);
    return;
  }
  knowledgeMapPinned = node && knowledgeMapPinned !== node.key ? node.key : null;
  kmInfo(state); kmKick(state);
}

// ── Legend, settings panel, zoom buttons ──

function kmLegend(host, items, graph) {
  const wrap = pjMk('div', 'km-legends');
  const redraw = () => { knowledgeMapPinned = null; drawKnowledgeMap(host, knowledgeMapItems); };

  // Types: click to hide or show (never all of them).
  const types = [...graph.types.values()];
  const typeRow = pjMk('div', 'kw-legend');
  types.forEach(type => {
    const b = pjMk('button', 'kw-legend-item kw-legend-toggle kw-c' + type.slot + (type.hidden ? ' is-off' : ''));
    b.type = 'button';
    b.title = 'Click to hide or show this type';
    b.setAttribute('aria-pressed', String(!type.hidden));
    b.appendChild(pjMk('span', 'kw-swatch'));
    const name = pjMk('span', null, type.label);
    if (type.code) name.dataset.userContent = '';
    b.appendChild(name);
    b.appendChild(pjMk('span', 'kw-legend-count', String(type.count)));
    b.addEventListener('click', () => {
      if (type.hidden) knowledgeMapHidden.delete(type.code);
      else if (types.length - knowledgeMapHidden.size > 1) knowledgeMapHidden.add(type.code);
      else return;
      redraw();
    });
    typeRow.appendChild(b);
  });
  if (knowledgeMapHidden.size) {
    const all = pjMk('button', 'kw-legend-reset', 'Show all types');
    all.type = 'button';
    all.addEventListener('click', () => { knowledgeMapHidden.clear(); redraw(); });
    typeRow.appendChild(all);
  }
  wrap.appendChild(typeRow);

  // Hub kinds, each with its shape: click to hide or show.
  const counts = knowledgeMapHubCounts(items.filter(item => !knowledgeMapHidden.has(item.type || '')));
  const hubRow = pjMk('div', 'kw-legend kw-legend-key');
  KM_HUB_KINDS.forEach(kind => {
    if (!counts[kind]) return;
    const on = knowledgeMapSettings[kind] !== false;
    const b = pjMk('button', 'kw-legend-item kw-legend-toggle' + (on ? '' : ' is-off'));
    b.type = 'button';
    b.title = 'Click to hide or show these on the map';
    b.dataset.kind = kind;
    b.setAttribute('aria-pressed', String(on));
    b.appendChild(pjMk('span', 'km-shape km-shape-' + kind));
    b.appendChild(pjMk('span', null, KM_KIND_MANY[kind]));
    b.appendChild(pjMk('span', 'kw-legend-count', String(counts[kind])));
    b.addEventListener('click', () => { setKnowledgeMapSetting(kind, !on); redraw(); });
    hubRow.appendChild(b);
  });
  const hollow = pjMk('span', 'kw-legend-item');
  hollow.appendChild(pjMk('span', 'kw-swatch kw-swatch-hollow'));
  hollow.appendChild(pjMk('span', null, 'Not linked to anything shown'));
  hubRow.appendChild(hollow);
  wrap.appendChild(hubRow);
  return wrap;
}

function kmPanel(state) {
  const s = knowledgeMapSettings;
  return knowledgeSettingsPanel({
    title: 'Map settings', open: s.panel,
    onToggle: open => setKnowledgeMapSetting('panel', open),
    segs: [{
      label: 'Labels', value: s.labels, options: [['hubs', 'Hubs'], ['zoom', 'Zoomed in'], ['all', 'All']],
      onChange: mode => { setKnowledgeMapSetting('labels', mode); kmKick(state); },
    }],
    ranges: [['repel', 'Repel force'], ['distance', 'Link distance'], ['gravity', 'Pull to centre']].map(([key, label]) => ({
      label, value: s[key],
      onInput: value => {
        setKnowledgeMapSetting(key, value);
        kmApplyParams(state.sim, knowledgeMapParams());
        kmReheat(state, 0.3);
      },
    })),
    actions: [
      { label: 'Re-run layout', run: () => {
        state.graph.nodes.forEach(n => knowledgeMapPositions.delete(n.key));
        kmSeed(state.graph.nodes, knowledgeMapPositions);
        state.sim.alpha = 1;
        state.userMoved = false;
        kmKick(state);
      } },
      { label: 'Reset', run: () => {
        ['labels', 'repel', 'distance', 'gravity'].forEach(k => { knowledgeMapSettings[k] = KM_DEFAULTS[k]; });
        knowledgeMapSaveSettings();
        drawKnowledgeMap(state.host, knowledgeMapItems);
      } },
    ],
  });
}

function kmZoomControls(state) {
  const box = pjMk('div', 'km-zoom');
  [['plus', 'Zoom in', () => kmZoom(state, 1.3)],
    ['minus', 'Zoom out', () => kmZoom(state, 1 / 1.3)],
    ['maximize-2', 'Fit to view', () => { state.userMoved = false; kmFit(state); kmKick(state); }]].forEach(([icon, title, run]) => {
    const b = pjMk('button', 'km-zoom-btn');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = ic(icon);
    b.addEventListener('click', run);
    box.appendChild(b);
  });
  return box;
}

// Opening an article narrows the column (the side panel), and the window can
// change height: resize the canvas without re-running the layout.
function ensureKnowledgeMapObserver(host) {
  if (knowledgeMapObserver) return;
  let timer = null;
  const refit = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const state = knowledgeMapState;
      if (!state || state.host !== host || host.hidden || knowledgeView !== 'map') return;
      kmResize(state);
      if (!state.userMoved) kmFit(state);
      kmKick(state);
    }, 100);
  };
  if (typeof ResizeObserver !== 'undefined') { knowledgeMapObserver = new ResizeObserver(refit); knowledgeMapObserver.observe(host); }
  else knowledgeMapObserver = true;
  window.addEventListener('resize', refit);
  // The app's theme switch changes the colours, which the canvas reads on each draw.
  new MutationObserver(() => { if (knowledgeMapState) kmKick(knowledgeMapState); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
