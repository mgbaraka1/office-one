// ══ KNOWLEDGE WHEEL (Knowledge Hub → Wheel) ═══════════════════════════════════
// The items the list would show, drawn around a circle: articles on one side in
// coloured arcs by type, the clients and systems they are linked to on the
// other, and a curved line for every link. Tags (#SQL) are hubs too, in an arc
// of their own after Systems. Hovering a name traces its links; clicking an
// article opens it, clicking a client, system or tag keeps its links lit. An
// article with none of them is drawn hollow and listed underneath — it is the
// one nobody will find by browsing. Clicking a type in the legend hides it (and
// any client, system or tag only it links to); the biggest type is drawn in the
// middle of the left side, where its labels read level. The box beside the
// readout finds names (Enter opens or pins a single match), hovering a type in
// the legend lights all of its lines, and a pinned client, system or tag lists
// its articles under the wheel.

let knowledgeWheelItems = [];
let knowledgeWheelPinned = null;   // node key kept highlighted after a click
let knowledgeWheelWidth = 0;
let knowledgeWheelObserver = null;
const knowledgeWheelHidden = new Set();   // type codes switched off in the legend
let knowledgeWheelQuery = '';   // text in the find box, kept across redraws

const KW_TYPE_SLOTS = 12;           // fixed-order categorical hues (app.css --kw-1..12)
const KW_NS = 'http://www.w3.org/2000/svg';
const KW_HUB_KINDS = [['companies', 'Clients'], ['systems', 'Systems'], ['tags', 'Tags'], ['projects', 'Projects']];

// Wheel settings (uiState.filters.knowledge.wheel). Sliders run 0..100 with
// 50 the original look: bundling sets how far toward the middle the lines bend,
// links how strong the resting lines are, size scales the whole wheel.
const KW_DEFAULTS = Object.freeze({
  companies: true, systems: true, tags: true, projects: true,
  labels: 'all', bundling: 50, links: 50, size: 50, panel: false,
});
let knowledgeWheelSettings = { ...KW_DEFAULTS };
let knowledgeWheelPanel = null;   // kept across redraws so a slider is never pulled out mid-drag

function knowledgeWheelRestoreSettings(saved) {
  knowledgeWheelSettings = knowledgeViewSettings(KW_DEFAULTS, saved, { labels: ['all', 'hubs'] });
}

function setKnowledgeWheelSetting(key, value) {
  knowledgeWheelSettings[key] = value;
  knowledgeSaveViewSettings('wheel', knowledgeWheelSettings);
}

// Saved view settings, checked against their defaults: a boolean stays a
// boolean, a number is clamped to 0..100, a word must be one of `choices`.
// Shared with the Map (knowledge-map.js).
function knowledgeViewSettings(defaults, saved, choices = {}) {
  const s = { ...defaults };
  if (!saved || typeof saved !== 'object') return s;
  Object.keys(defaults).forEach(k => {
    const d = defaults[k], v = saved[k];
    if (typeof d === 'boolean') { if (typeof v === 'boolean') s[k] = v; }
    else if (typeof d === 'number') {
      const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
      if (v !== '' && Number.isFinite(n)) s[k] = Math.min(100, Math.max(0, Math.round(n)));
    } else if ((choices[k] || []).includes(v)) s[k] = v;
  });
  return s;
}

function knowledgeSaveViewSettings(view, settings) {
  if (typeof uiState === 'undefined') return;
  uiState.filters ||= {};
  uiState.filters.knowledge = Object.assign({}, uiState.filters.knowledge, { [view]: { ...settings } });
  saveUiStateDebounced();
}

// The collapsible settings card shared by the Wheel and the Map: segmented
// choices, 0..100 sliders and small buttons.
function knowledgeSettingsPanel({ title, open, onToggle, segs = [], ranges = [], actions = [] }) {
  const panel = pjMk('div', 'km-panel' + (open ? '' : ' is-collapsed'));
  const toggle = pjMk('button', 'km-panel-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(!!open));
  toggle.innerHTML = ic('sliders-horizontal');
  toggle.appendChild(pjMk('span', null, title));
  toggle.addEventListener('click', () => {
    const nowOpen = !panel.classList.toggle('is-collapsed');
    toggle.setAttribute('aria-expanded', String(nowOpen));
    onToggle(nowOpen);
  });
  panel.appendChild(toggle);
  const body = pjMk('div', 'km-panel-body');
  segs.forEach(({ label, options, value, onChange }) => {
    const field = pjMk('div', 'km-field');
    field.appendChild(pjMk('span', 'km-field-label', label));
    const seg = pjMk('div', 'seg-ctl km-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', label);
    options.forEach(([optValue, optLabel]) => {
      const b = pjMk('button', 'seg-btn' + (value === optValue ? ' active' : ''), optLabel);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(value === optValue));
      b.addEventListener('click', () => {
        seg.querySelectorAll('.seg-btn').forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', String(on)); });
        onChange(optValue);
      });
      seg.appendChild(b);
    });
    field.appendChild(seg);
    body.appendChild(field);
  });
  ranges.forEach(({ label, value, onInput }) => {
    const field = pjMk('label', 'km-field');
    field.appendChild(pjMk('span', 'km-field-label', label));
    const input = document.createElement('input');
    input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1';
    input.value = String(value);
    input.className = 'km-range';
    input.addEventListener('input', () => onInput(Number(input.value)));
    field.appendChild(input);
    body.appendChild(field);
  });
  if (actions.length) {
    const row = pjMk('div', 'km-panel-actions');
    actions.forEach(({ label, run }) => {
      const b = pjMk('button', 'btn small', label);
      b.type = 'button';
      b.addEventListener('click', run);
      row.appendChild(b);
    });
    body.appendChild(row);
  }
  panel.appendChild(body);
  return panel;
}

// ── Hover card (shared with the Map) ──
// A small card beside the hovered name: the name, what it is, and how much
// hangs off it (documents, connections). The readout line above the drawing
// stays the accessible one; the card is for the eye only.

// Documents on an article, each version family counted once (as its panel lists them).
function knowledgeDocCount(item) {
  const docs = item?.documents || [];
  return typeof knowledgeDocumentFamilies === 'function' ? knowledgeDocumentFamilies(docs).length : docs.length;
}

function knowledgeTipStats({ articles, documents, connections }) {
  const parts = [];
  if (articles != null) parts.push(knowledgeWheelCount(articles, '1 article', '{n} articles'));
  parts.push(knowledgeWheelCount(documents, '1 document', '{n} documents'));
  parts.push(knowledgeWheelCount(connections, '1 connection', '{n} connections'));
  return parts.join(' · ');
}

function knowledgeTip(host) {
  const tip = pjMk('div', 'kh-tip');
  tip.setAttribute('aria-hidden', 'true');
  tip.hidden = true;
  host.appendChild(tip);
  return tip;
}

// `mark` is the class of the little swatch or shape before the kind.
function knowledgeFillTip(tip, { name, kind, userKind, mark, stats }) {
  tip.innerHTML = '';
  const title = pjMk('strong', null, name);
  title.dataset.userContent = '';
  tip.appendChild(title);
  const line = pjMk('span', 'kh-tip-kind');
  line.appendChild(pjMk('span', mark));
  const k = pjMk('span', null, kind);
  if (userKind) k.dataset.userContent = '';
  line.appendChild(k);
  tip.appendChild(line);
  tip.appendChild(pjMk('span', 'kh-tip-stats', stats));
  tip.hidden = false;
}

// Beside the point (x, y) in the container's pixels, `r` away from it: to the
// right if there is room, otherwise to the left, and always inside W x H.
function knowledgePlaceTip(tip, x, y, r, W, H) {
  if (tip.hidden) return;
  const off = x < 0 || x > W || y < 0 || y > H;
  tip.style.visibility = off ? 'hidden' : '';
  if (off) return;
  const w = tip.offsetWidth, h = tip.offsetHeight, gap = r + 10;
  let left = x + gap;
  if (left + w > W - 6) left = x - gap - w;
  left = Math.max(6, Math.min(left, W - w - 6));
  const top = Math.max(6, Math.min(y - h / 2, H - h - 6));
  tip.style.left = Math.round(left) + 'px';
  tip.style.top = Math.round(top) + 'px';
}

function setKnowledgeView(view) {
  knowledgeView = view === 'wheel' || view === 'map' ? view : 'list';   // map: knowledge-map.js
  knowledgeWheelPinned = null;
  knowledgeWheelQuery = '';
  renderKnowledgeList();
}

function syncKnowledgeViewCtl() {
  document.querySelectorAll('#kh-view-ctl .seg-btn').forEach(b => {
    const on = b.dataset.view === knowledgeView;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function kwSvg(tag, attrs = {}, parent) {
  const el = document.createElementNS(KW_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  if (parent) parent.appendChild(el);
  return el;
}

function kwTruncate(text, max) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, Math.max(1, max - 1)).trimEnd() + '…' : s;
}

// Shortens text to fit maxPx in the given CSS font, measured rather than
// guessed per character, so wide scripts and fonts never run off the edge.
let kwMeasureCtx = null;
function kwFitText(text, maxPx, font) {
  const s = String(text || '');
  kwMeasureCtx = kwMeasureCtx || document.createElement('canvas').getContext('2d');
  if (!kwMeasureCtx) return kwTruncate(s, Math.floor(maxPx / 7));
  kwMeasureCtx.font = font;
  const fits = t => kwMeasureCtx.measureText(t).width <= maxPx;
  if (fits(s)) return s;
  let lo = 1, hi = s.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(s.slice(0, mid).trimEnd() + '…')) lo = mid; else hi = mid - 1;
  }
  return s.slice(0, lo).trimEnd() + '…';
}

// Biggest arc in the middle, the rest alternating outward, so the largest
// group sits where labels are level and easiest to read.
function kwCentreLargest(arcs) {
  const out = [];
  arcs.slice().sort((a, b) => b.nodes.length - a.nodes.length)
    .forEach((arc, i) => (i % 2 ? out.unshift(arc) : out.push(arc)));
  return out;
}

// Arcs in drawing order: one per knowledge type (catalog order, untyped last),
// then Clients, Systems, Tags and Projects. Each node is { key, kind, label, item|link }.
// A type in `hidden` keeps its arc (and colour slot) but is flagged hidden, and
// its articles add no hubs. A hub kind set to false in `show` gets no arc.
function knowledgeWheelModel(items, hidden = new Set(), show = {}) {
  const typeOrder = (LK.categories.KNOWLEDGE_TYPE || []).map(o => o.code);
  const byType = new Map();
  items.forEach(item => {
    const key = item.type || '';
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key).push(item);
  });
  const typeKeys = [...byType.keys()].sort((a, b) => {
    const ia = a ? typeOrder.indexOf(a) : 1e9, ib = b ? typeOrder.indexOf(b) : 1e9;
    return (ia < 0 ? 1e8 : ia) - (ib < 0 ? 1e8 : ib) || a.localeCompare(b);
  });
  const arcs = typeKeys.map((code, i) => ({
    kind: 'type', code, slot: i < KW_TYPE_SLOTS ? i + 1 : 0,
    hidden: hidden.has(code),
    label: code ? (lkLabel('KNOWLEDGE_TYPE', code) || byType.get(code)[0].typeLabel || code) : 'No type',
    nodes: byType.get(code).slice().sort((a, b) => a.title.localeCompare(b.title))
      .map(item => ({ key: 'a' + item.id, kind: 'article', label: item.title, item })),
  }));
  items = items.filter(item => !hidden.has(item.type || ''));
  [['companies', 'Clients'], ['systems', 'Systems']].forEach(([kind, label]) => {
    if (show[kind] === false) return;
    const hubs = new Map();
    items.forEach(item => (item[kind] || []).forEach(link => {
      if (!hubs.has(link.id)) hubs.set(link.id, { key: kind[0] + link.id, kind, label: knowledgeLinkName(kind, link), link, items: [] });
      hubs.get(link.id).items.push(item);
    }));
    if (hubs.size) arcs.push({ kind, label, slot: 0, nodes: [...hubs.values()] });
  });
  // One hub per tag, whatever its case on each item.
  const tags = new Map();
  if (show.tags !== false) items.forEach(item => (item.tags || []).forEach(tag => {
    const id = tag.toLowerCase();
    if (!tags.has(id)) tags.set(id, { key: 't' + id, kind: 'tags', label: '#' + tag, items: [] });
    tags.get(id).items.push(item);
  }));
  if (tags.size) arcs.push({ kind: 'tags', label: 'Tags', slot: 0, nodes: [...tags.values()] });
  // One hub per project (an item has at most one, migration 081).
  const projects = new Map();
  if (show.projects !== false) items.forEach(item => {
    if (!item.projectId) return;
    if (!projects.has(item.projectId)) projects.set(item.projectId, { key: 'p' + item.projectId, kind: 'projects', label: item.projectName || 'Project', items: [] });
    projects.get(item.projectId).items.push(item);
  });
  if (projects.size) arcs.push({ kind: 'projects', label: 'Projects', slot: 0, nodes: [...projects.values()] });
  return arcs;
}

function drawKnowledgeWheel(host, items) {
  knowledgeWheelItems = items;
  const ws = knowledgeWheelSettings;
  [...host.children].forEach(el => { if (el !== knowledgeWheelPanel) el.remove(); });
  if (!knowledgeWheelPanel || knowledgeWheelPanel.parentNode !== host) {
    knowledgeWheelPanel = knowledgeWheelSettingsPanel(host);
    host.appendChild(knowledgeWheelPanel);
  }
  const width = Math.max(320, host.clientWidth || 900);
  knowledgeWheelWidth = width;
  ensureKnowledgeWheelObserver(host);

  // Forget hidden types that are no longer in the list, and never hide them all.
  const present = new Set(items.map(item => item.type || ''));
  [...knowledgeWheelHidden].forEach(code => { if (!present.has(code)) knowledgeWheelHidden.delete(code); });
  if (knowledgeWheelHidden.size >= present.size) knowledgeWheelHidden.clear();
  const allArcs = knowledgeWheelModel(items, knowledgeWheelHidden, ws);
  const typeArcs = allArcs.filter(a => a.kind === 'type');
  const arcs = allArcs.filter(a => !a.hidden);
  const articleArcs = kwCentreLargest(arcs.filter(a => a.kind === 'type'));
  const hubArcs = arcs.filter(a => a.kind !== 'type');
  const nodeCount = arcs.reduce((n, a) => n + a.nodes.length, 0);

  // One empty slot between arcs. Articles are centred on the left, clients and
  // systems on the right, so most lines cross the middle the way the eye reads.
  const articleSlots = articleArcs.reduce((n, a) => n + a.nodes.length + 1, 0);
  const hubSlots = hubArcs.reduce((n, a) => n + a.nodes.length + 1, 0);
  const slots = Math.max(articleSlots + hubSlots, 12);
  const step = 360 / slots;
  const rtl = document.documentElement.dir === 'rtl';

  // Fits the window as well as the column, leaving room for the readout and legend.
  const room = window.innerHeight - host.getBoundingClientRect().top - 110;
  const size = Math.min(width - 32, 1000, Math.max(520, room));
  const labelRoom = Math.max(90, Math.min(170, size * 0.19));
  let R = size / 2 - labelRoom;
  R = Math.max(R, (nodeCount + arcs.length) * 14 / (2 * Math.PI));   // keep labels from touching
  // The circle is sized by height; labels on the left and right may run into
  // the column's spare width, so each label's length depends on its angle.
  const H = 2 * (R + labelRoom);
  const W = Math.max(H, Math.min(width - 32, 2 * (R + 280)));
  const cx = W / 2, cy = H / 2;
  // Labels start at R + 16; keep a small margin before the edge of the drawing.
  const hRoom = W / 2 - R - 24, vRoom = labelRoom - 24;
  const pxAt = deg => {
    const rad = deg * Math.PI / 180;
    const len = Math.min(hRoom / Math.max(Math.abs(Math.sin(rad)), 0.01), vRoom / Math.max(Math.abs(Math.cos(rad)), 0.01));
    return Math.max(50, len * 0.96);
  };

  // Angles: 0 = top, clockwise. Articles fill [270 - span/2, 270 + span/2].
  let angle = 270 - (articleSlots * step) / 2 + step / 2;
  const pos = new Map();   // key -> { angle, node, arc }
  const place = arc => {
    arc.start = angle;
    arc.nodes.forEach(node => { pos.set(node.key, { angle, node, arc }); angle += step; });
    arc.end = angle - step;
    angle += step;   // the gap
  };
  articleArcs.forEach(place);
  // What each client, system or tag holds, by type, for the hover readout.
  hubArcs.forEach(arc => arc.nodes.forEach(hub => {
    const byArc = new Map();
    hub.items.forEach(item => {
      const at = pos.get('a' + item.id);
      if (at) byArc.set(at.arc, (byArc.get(at.arc) || 0) + 1);
    });
    hub.typeCounts = [...byArc].map(([a, n]) => ({ arc: a, n })).sort((a, b) => b.n - a.n);
  }));
  const hubMax = Math.max(1, ...hubArcs.flatMap(arc => arc.nodes.map(hub => hub.items.length)));
  // Clients and systems sit in the order that keeps their lines from crossing:
  // one linked to articles near the top goes near the top.
  hubArcs.forEach(arc => {
    const height = node => {
      const ys = node.items.map(it => Math.cos((pos.get('a' + it.id)?.angle || 0) * Math.PI / 180));
      return ys.reduce((s, y) => s + y, 0) / ys.length;
    };
    arc.nodes.sort((a, b) => height(b) - height(a) || a.label.localeCompare(b.label));
  });
  // The hubs fill the right-hand side, top to bottom.
  angle = 90 - (hubSlots * step) / 2 + step / 2;
  hubArcs.forEach(place);

  const pt = (deg, r) => {
    const rad = deg * Math.PI / 180;
    return [cx + (rtl ? -1 : 1) * Math.sin(rad) * r, cy - Math.cos(rad) * r];
  };
  const f = n => n.toFixed(1);

  // ── Header: the hover readout and a box to find a name ──
  const head = pjMk('div', 'kw-head');
  const info = pjMk('div', 'kw-info', 'Hover a name to trace its links. Click an article to open it.');
  info.setAttribute('aria-live', 'polite');
  head.appendChild(info);
  const find = document.createElement('input');
  find.type = 'search';
  find.className = 'km-search kw-find';
  find.placeholder = 'Find a name on the wheel';
  find.setAttribute('aria-label', 'Find a name on the wheel');
  find.value = knowledgeWheelQuery;
  head.appendChild(find);
  host.appendChild(head);
  // Sit the settings card just under the header, whatever its height (the
  // Arabic font and the search box make it taller than the CSS fallback).
  if (knowledgeWheelPanel && head.offsetHeight) {
    knowledgeWheelPanel.style.top = (head.offsetTop + head.offsetHeight + 6) + 'px';
  }

  const svg = kwSvg('svg', {
    class: 'kw-svg', viewBox: `0 0 ${f(W)} ${f(H)}`, role: 'img', direction: 'ltr',
    'aria-label': 'Knowledge wheel: articles and the clients, systems and tags they are linked to',
  });
  svg.style.maxWidth = Math.round(W * (0.5 + ws.size * 0.01)) + 'px';
  knowledgeWheelApplyLook(svg);
  host.appendChild(svg);
  // The articles of a pinned client, system or tag, under the wheel.
  const list = pjMk('div', 'kw-unlinked kw-linked');
  list.hidden = true;
  host.appendChild(list);

  // Arc bands just outside the dots.
  arcs.forEach(arc => {
    const a0 = arc.start - step * 0.4, a1 = arc.end + step * 0.4;
    const [x0, y0] = pt(a0, R + 7), [x1, y1] = pt(a1, R + 7);
    const large = a1 - a0 > 180 ? 1 : 0;
    const sweep = rtl ? 0 : 1;
    kwSvg('path', {
      class: 'kw-band ' + (arc.kind === 'type' ? 'kw-c' + arc.slot : 'kw-hub'),
      d: `M${f(x0)} ${f(y0)} A${f(R + 7)} ${f(R + 7)} 0 ${large} ${sweep} ${f(x1)} ${f(y1)}`,
    }, svg);
  });

  // Links: one cubic per article→client/system, pulled toward the middle and
  // toward each end's arc centre so lines leaving one arc travel together.
  const edgeLayer = kwSvg('g', { class: 'kw-edges' }, svg);
  const edgesByKey = new Map();
  const addEdge = (key, path) => { if (!edgesByKey.has(key)) edgesByKey.set(key, []); edgesByKey.get(key).push(path); };
  const arcMid = arc => (arc.start + arc.end) / 2;
  hubArcs.forEach(arc => arc.nodes.forEach(hub => hub.items.forEach(item => {
    const a = pos.get('a' + item.id), b = pos.get(hub.key);
    if (!a || !b) return;
    const [ax, ay] = pt(a.angle, R - 6), [bx, by] = pt(b.angle, R - 6);
    const bend = R * (0.82 - ws.bundling * 0.008);   // 50 = 0.42 R, the original curve
    const [c1x, c1y] = pt((a.angle + arcMid(a.arc)) / 2, bend);
    const [c2x, c2y] = pt((b.angle + arcMid(b.arc)) / 2, bend);
    const path = kwSvg('path', {
      class: 'kw-edge kw-c' + a.arc.slot,
      d: `M${f(ax)} ${f(ay)} C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(bx)} ${f(by)}`,
    }, edgeLayer);
    path.dataset.a = a.node.key; path.dataset.b = hub.key;
    addEdge(a.node.key, path); addEdge(hub.key, path);
  })));

  // Arc names (Clients, Systems, Tags) go above the lines so they stay readable.
  hubArcs.forEach(arc => {
    const [lx, ly] = pt((arc.start + arc.end) / 2, R - 34);
    const t = kwSvg('text', { class: 'kw-arc-label', x: f(lx), y: f(ly), 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, svg);
    t.textContent = arc.label;
  });

  // Nodes: a dot (articles) or a square (clients/systems/tags, sized by how
  // many articles they hold) and a radial label.
  const fontFamily = getComputedStyle(svg).fontFamily || 'sans-serif';
  const nodeLayer = kwSvg('g', { class: 'kw-nodes' }, svg);
  const nodeEls = new Map();
  const unlinked = [];
  const ctx = { svg, info, pos, edgesByKey, nodeEls, list };
  pos.forEach(({ angle: deg, node, arc }) => {
    const isArticle = node.kind === 'article';
    const linked = edgesByKey.has(node.key);
    if (isArticle && !linked) unlinked.push(node.item);
    const g = kwSvg('g', {
      class: 'kw-node ' + (isArticle ? 'is-article kw-c' + arc.slot : 'is-hub') + (linked ? '' : ' is-unlinked'),
      tabindex: '0', role: 'button',
    }, nodeLayer);
    const [x, y] = pt(deg, R);
    if (isArticle) kwSvg('circle', { class: 'kw-dot', cx: f(x), cy: f(y), r: '4.5' }, g);
    else {
      const side = 7 + 9 * Math.sqrt(node.items.length / hubMax);
      kwSvg('rect', { class: 'kw-dot', x: f(x - side / 2), y: f(y - side / 2), width: f(side), height: f(side), rx: '2' }, g);
    }
    // Labels read outward; on the left half they are flipped so none is upside down.
    const screenDeg = rtl ? 360 - ((deg % 360) + 360) % 360 : ((deg % 360) + 360) % 360;
    const left = screenDeg > 180;
    const [tx, ty] = pt(deg, R + 16);
    const rot = left ? screenDeg + 90 : screenDeg - 90;
    const text = kwSvg('text', {
      class: 'kw-label', x: f(tx), y: f(ty), 'dominant-baseline': 'middle',
      'text-anchor': left ? 'end' : 'start', transform: `rotate(${f(rot)} ${f(tx)} ${f(ty)})`,
    }, g);
    text.textContent = kwFitText(node.label, pxAt(deg), `${isArticle ? 400 : 700} 11.5px ${fontFamily}`);
    text.dataset.userContent = '';
    const tip = kwSvg('title', {}, g);
    tip.textContent = node.label;
    tip.dataset.userContent = '';
    g.setAttribute('aria-label', node.label);
    nodeEls.set(node.key, g);

    const focusOn = () => knowledgeWheelHighlight(ctx, node, arc);
    g.addEventListener('mouseenter', focusOn);
    g.addEventListener('focus', focusOn);
    g.addEventListener('mouseleave', () => knowledgeWheelRestore(ctx));
    g.addEventListener('blur', () => knowledgeWheelRestore(ctx));
    const activate = e => {
      e.stopPropagation();
      if (isArticle) { openKnowledgeDetail(node.item.id); return; }
      knowledgeWheelPinned = knowledgeWheelPinned === node.key ? null : node.key;
      knowledgeWheelRestore(ctx);
    };
    g.addEventListener('click', activate);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(e); } });
  });
  svg.addEventListener('click', () => {
    if (!knowledgeWheelPinned) return;
    knowledgeWheelPinned = null;
    knowledgeWheelRestore(ctx);
  });
  find.addEventListener('input', () => {
    knowledgeWheelQuery = find.value;
    knowledgeWheelPinned = null;
    knowledgeWheelRestore(ctx);
  });
  find.addEventListener('keydown', e => {
    if (e.key === 'Escape' && find.value) {
      e.preventDefault();
      find.value = knowledgeWheelQuery = '';
      knowledgeWheelRestore(ctx);
    } else if (e.key === 'Enter') {
      const hits = knowledgeWheelMatches([...pos.values()].map(p => p.node), knowledgeWheelQuery);
      if (hits.length !== 1) return;
      e.preventDefault();
      if (hits[0].kind === 'article') { openKnowledgeDetail(hits[0].item.id); return; }
      knowledgeWheelPinned = hits[0].key;
      knowledgeWheelRestore(ctx);
    }
  });
  knowledgeWheelRestore(ctx);

  // ── Legend ──
  // Each type is a toggle: click to hide or show it.
  const legend = pjMk('div', 'kw-legend');
  const redraw = () => { knowledgeWheelPinned = null; drawKnowledgeWheel(host, knowledgeWheelItems); };
  typeArcs.forEach(arc => {
    const item = pjMk('button', 'kw-legend-item kw-legend-toggle' + (arc.hidden ? ' is-off' : ''));
    item.type = 'button';
    item.title = 'Click to hide or show this type';
    item.setAttribute('aria-pressed', String(!arc.hidden));
    item.appendChild(pjMk('span', 'kw-swatch kw-c' + arc.slot));
    const name = pjMk('span', null, arc.label);
    if (arc.code) name.dataset.userContent = '';
    item.appendChild(name);
    item.appendChild(pjMk('span', 'kw-legend-count', String(arc.nodes.length)));
    if (!arc.hidden) {
      const lightType = () => knowledgeWheelLightType(ctx, arc);
      item.addEventListener('mouseenter', lightType);
      item.addEventListener('focus', lightType);
      item.addEventListener('mouseleave', () => knowledgeWheelRestore(ctx));
      item.addEventListener('blur', () => knowledgeWheelRestore(ctx));
    }
    item.addEventListener('click', () => {
      if (arc.hidden) knowledgeWheelHidden.delete(arc.code);
      else if (typeArcs.length - knowledgeWheelHidden.size > 1) knowledgeWheelHidden.add(arc.code);
      else return;
      redraw();
    });
    legend.appendChild(item);
  });
  if (knowledgeWheelHidden.size) {
    const all = pjMk('button', 'kw-legend-reset', 'Show all types');
    all.type = 'button';
    all.addEventListener('click', () => { knowledgeWheelHidden.clear(); redraw(); });
    legend.appendChild(all);
  }
  // Hub kinds: click to hide or show a whole arc.
  const keyRow = pjMk('div', 'kw-legend kw-legend-key');
  const kindCounts = knowledgeMapHubCounts(items.filter(item => !knowledgeWheelHidden.has(item.type || '')));
  KW_HUB_KINDS.forEach(([kind, label]) => {
    if (!kindCounts[kind]) return;
    const on = ws[kind] !== false;
    const b = pjMk('button', 'kw-legend-item kw-legend-toggle' + (on ? '' : ' is-off'));
    b.type = 'button';
    b.title = 'Click to hide or show these on the wheel';
    b.dataset.kind = kind;
    b.setAttribute('aria-pressed', String(on));
    b.appendChild(pjMk('span', 'kw-swatch kw-swatch-hub'));
    b.appendChild(pjMk('span', null, label));
    b.appendChild(pjMk('span', 'kw-legend-count', String(kindCounts[kind])));
    b.addEventListener('click', () => { setKnowledgeWheelSetting(kind, !on); redraw(); });
    keyRow.appendChild(b);
  });
  const hollow = pjMk('span', 'kw-legend-item');
  hollow.appendChild(pjMk('span', 'kw-swatch kw-swatch-hollow'));
  hollow.appendChild(pjMk('span', null, 'Not linked to anything shown'));
  keyRow.appendChild(hollow);
  host.appendChild(legend);
  host.appendChild(keyRow);

  if (unlinked.length) {
    const note = pjMk('div', 'kw-unlinked');
    note.appendChild(pjMk('span', 'kw-unlinked-title', 'Not linked to anything shown yet:'));
    unlinked.forEach(item => {
      const b = pjMk('button', 'kw-unlinked-item', item.title);
      b.type = 'button';
      b.dataset.userContent = '';
      b.addEventListener('click', () => openKnowledgeDetail(item.id));
      note.appendChild(b);
    });
    host.appendChild(note);
  }
}

function knowledgeWheelCount(n, one, many) {
  return n === 1 ? (window.ctI18n?.t(one) || one) : (window.ctI18n?.t(many, { n }) || many.replace('{n}', n));
}

// Names whose text contains the query (any case); none for an empty query.
function knowledgeWheelMatches(nodes, query) {
  const q = String(query || '').trim().toLowerCase();
  return q ? nodes.filter(node => String(node.label || '').toLowerCase().includes(q)) : [];
}

// Light the given nodes, their lines and the names at the other ends; fade the rest.
function knowledgeWheelLight(ctx, keys) {
  const { svg, edgesByKey, nodeEls } = ctx;
  svg.classList.add('has-focus');
  svg.querySelectorAll('.is-lit, .is-match').forEach(el => el.classList.remove('is-lit', 'is-match'));
  keys.forEach(key => {
    nodeEls.get(key)?.classList.add('is-lit');
    (edgesByKey.get(key) || []).forEach(path => {
      path.classList.add('is-lit');
      nodeEls.get(path.dataset.a)?.classList.add('is-lit');
      nodeEls.get(path.dataset.b)?.classList.add('is-lit');
    });
  });
}

// A type hovered in the legend: all of its articles and their lines.
function knowledgeWheelLightType(ctx, arc) {
  knowledgeWheelLight(ctx, arc.nodes.map(node => node.key));
  const links = arc.nodes.reduce((n, node) => n + (ctx.edgesByKey.get(node.key) || []).length, 0);
  const { info } = ctx;
  info.innerHTML = '';
  const name = pjMk('strong', null, arc.label);
  if (arc.code) name.dataset.userContent = '';
  info.appendChild(name);
  info.appendChild(pjMk('span', 'kw-info-detail', [knowledgeWheelCount(arc.nodes.length, '1 article', '{n} articles'),
    knowledgeWheelCount(links, '1 connection', '{n} connections')].join(' · ')));
}

// Under the wheel: the articles of a pinned client, system or tag; hidden otherwise.
function knowledgeWheelShowLinked(ctx, node) {
  const { list, pos } = ctx;
  if (!list) return;
  if (!node || node.kind === 'article') { list.hidden = true; list.innerHTML = ''; delete list.dataset.key; return; }
  if (list.dataset.key === node.key) return;
  list.innerHTML = '';
  list.dataset.key = node.key;
  const title = pjMk('span', 'kw-unlinked-title');
  const name = pjMk('strong', null, node.label);
  name.dataset.userContent = '';
  title.appendChild(name);
  title.appendChild(pjMk('span', 'kw-linked-count', knowledgeWheelCount(node.items.length, '1 article', '{n} articles')));
  list.appendChild(title);
  node.items.slice().sort((a, b) => a.title.localeCompare(b.title)).forEach(item => {
    const b = pjMk('button', 'kw-unlinked-item kw-linked-item');
    b.type = 'button';
    b.appendChild(pjMk('span', 'kw-swatch kw-c' + (pos.get('a' + item.id)?.arc.slot ?? 0)));
    const t = pjMk('span', null, item.title);
    t.dataset.userContent = '';
    b.appendChild(t);
    b.addEventListener('click', () => openKnowledgeDetail(item.id));
    list.appendChild(b);
  });
  list.hidden = false;
}

// Light one node, its lines and the names at their other ends; fade the rest.
function knowledgeWheelHighlight(ctx, node, arc) {
  const { info } = ctx;
  knowledgeWheelLight(ctx, [node.key]);
  info.innerHTML = '';
  const name = pjMk('strong', null, node.label);
  name.dataset.userContent = '';
  info.appendChild(name);
  let detail;
  if (node.kind === 'article') {
    const on = kind => knowledgeWheelSettings[kind] !== false;
    const c = on('companies') ? (node.item.companies || []).length : 0, s = on('systems') ? (node.item.systems || []).length : 0;
    const t = on('tags') ? (node.item.tags || []).length : 0, p = on('projects') && node.item.projectId ? 1 : 0;
    const parts = [];
    if (c) parts.push(knowledgeWheelCount(c, '1 client', '{n} clients'));
    if (s) parts.push(knowledgeWheelCount(s, '1 system', '{n} systems'));
    if (t) parts.push(knowledgeWheelCount(t, '1 tag', '{n} tags'));
    if (p) parts.push(window.ctI18n?.t('Project') || 'Project');
    detail = parts.length ? parts.join(' · ') : (window.ctI18n?.t('Not linked to anything shown yet') || 'Not linked to anything shown yet');
    const type = pjMk('span', 'kw-info-type', arc.label);
    if (arc.code) type.dataset.userContent = '';
    info.appendChild(type);
  } else {
    const types = node.typeCounts || [];
    detail = [knowledgeWheelCount(node.items.length, '1 article', '{n} articles'),
      knowledgeWheelCount(types.length, '1 type', '{n} types')].join(' · ');
  }
  info.appendChild(pjMk('span', 'kw-info-detail', detail));
  (node.typeCounts || []).forEach(({ arc: typeArc, n }) => {
    const chip = pjMk('span', 'kw-info-chip');
    chip.appendChild(pjMk('span', 'kw-swatch kw-c' + typeArc.slot));
    const label = pjMk('span', null, typeArc.label);
    if (typeArc.code) label.dataset.userContent = '';
    chip.appendChild(label);
    chip.appendChild(pjMk('span', 'kw-legend-count', String(n)));
    info.appendChild(chip);
  });
}

// Back to the resting state: the pinned name, else the find box's matches,
// else nothing lit.
function knowledgeWheelRestore(ctx) {
  const { svg, info, pos, nodeEls } = ctx;
  const pinned = knowledgeWheelPinned && pos.get(knowledgeWheelPinned);
  if (pinned) {
    knowledgeWheelHighlight(ctx, pinned.node, pinned.arc);
    knowledgeWheelShowLinked(ctx, pinned.node);
    return;
  }
  knowledgeWheelPinned = null;
  knowledgeWheelShowLinked(ctx, null);
  if (knowledgeWheelQuery.trim()) {
    const hits = knowledgeWheelMatches([...pos.values()].map(p => p.node), knowledgeWheelQuery);
    knowledgeWheelLight(ctx, hits.map(node => node.key));
    hits.forEach(node => nodeEls.get(node.key)?.classList.add('is-match'));
    info.innerHTML = '';
    info.appendChild(pjMk('span', 'kw-info-detail', hits.length
      ? knowledgeWheelCount(hits.length, '1 match', '{n} matches')
      : (window.ctI18n?.t('No names match') || 'No names match')));
    return;
  }
  svg.classList.remove('has-focus');
  svg.querySelectorAll('.is-lit, .is-match').forEach(el => el.classList.remove('is-lit', 'is-match'));
  info.textContent = 'Hover a name to trace its links. Click an article to open it.';
}

// Labels and line strength change the drawing in place; bundling and size
// redraw it (the panel stays, so a slider keeps its drag).
function knowledgeWheelApplyLook(svg) {
  const ws = knowledgeWheelSettings;
  svg.classList.toggle('kw-hubs-only', ws.labels === 'hubs');
  svg.style.setProperty('--kw-edge-rest', (0.04 + ws.links * 0.0036).toFixed(3));
}

function knowledgeWheelSettingsPanel(host) {
  const ws = knowledgeWheelSettings;
  const svg = () => host.querySelector('.kw-svg');
  let pending = 0;
  const redraw = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => drawKnowledgeWheel(host, knowledgeWheelItems));
  };
  return knowledgeSettingsPanel({
    title: 'Wheel settings', open: ws.panel,
    onToggle: open => setKnowledgeWheelSetting('panel', open),
    segs: [{
      label: 'Labels', value: ws.labels, options: [['all', 'All'], ['hubs', 'Hubs only']],
      onChange: mode => { setKnowledgeWheelSetting('labels', mode); if (svg()) knowledgeWheelApplyLook(svg()); },
    }],
    ranges: [
      { label: 'Link bundling', value: ws.bundling, onInput: v => { setKnowledgeWheelSetting('bundling', v); redraw(); } },
      { label: 'Link visibility', value: ws.links, onInput: v => { setKnowledgeWheelSetting('links', v); if (svg()) knowledgeWheelApplyLook(svg()); } },
      { label: 'Wheel size', value: ws.size, onInput: v => { setKnowledgeWheelSetting('size', v); redraw(); } },
    ],
    actions: [{ label: 'Reset', run: () => {
      ['labels', 'bundling', 'links', 'size'].forEach(k => { knowledgeWheelSettings[k] = KW_DEFAULTS[k]; });
      knowledgeSaveViewSettings('wheel', knowledgeWheelSettings);
      knowledgeWheelPanel?.remove();
      knowledgeWheelPanel = null;
      drawKnowledgeWheel(host, knowledgeWheelItems);
    } }],
  });
}

// Opening an article narrows the list area (the side panel), so the wheel
// redraws whenever its width changes.
function ensureKnowledgeWheelObserver(host) {
  if (knowledgeWheelObserver || typeof ResizeObserver === 'undefined') return;
  let timer = null;
  knowledgeWheelObserver = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (host.hidden || knowledgeView !== 'wheel') return;
      if (Math.abs((host.clientWidth || 0) - knowledgeWheelWidth) < 8) return;
      drawKnowledgeWheel(host, knowledgeWheelItems);
    }, 120);
  });
  knowledgeWheelObserver.observe(host);
}
