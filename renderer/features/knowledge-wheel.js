// ══ KNOWLEDGE WHEEL (Knowledge Hub → Wheel) ═══════════════════════════════════
// The items the list would show, drawn around a circle: articles on one side in
// coloured arcs by type, the clients and systems they are linked to on the
// other, and a curved line for every link. Tags (#SQL) are hubs too, in an arc
// of their own after Systems. Hovering a name traces its links; clicking an
// article opens it, clicking a client, system or tag keeps its links lit. An
// article with none of them is drawn hollow and listed underneath — it is the
// one nobody will find by browsing.

let knowledgeWheelItems = [];
let knowledgeWheelPinned = null;   // node key kept highlighted after a click
let knowledgeWheelWidth = 0;
let knowledgeWheelObserver = null;

const KW_TYPE_SLOTS = 8;            // fixed-order categorical hues (app.css --kw-1..8)
const KW_NS = 'http://www.w3.org/2000/svg';

function setKnowledgeView(view) {
  knowledgeView = view === 'wheel' ? 'wheel' : 'list';
  knowledgeWheelPinned = null;
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

// Arcs in drawing order: one per knowledge type (catalog order, untyped last),
// then Clients, then Systems, then Tags. Each node is { key, kind, label, item|link }.
function knowledgeWheelModel(items) {
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
    label: code ? (lkLabel('KNOWLEDGE_TYPE', code) || byType.get(code)[0].typeLabel || code) : 'No type',
    nodes: byType.get(code).slice().sort((a, b) => a.title.localeCompare(b.title))
      .map(item => ({ key: 'a' + item.id, kind: 'article', label: item.title, item })),
  }));
  [['companies', 'Clients'], ['systems', 'Systems']].forEach(([kind, label]) => {
    const hubs = new Map();
    items.forEach(item => (item[kind] || []).forEach(link => {
      if (!hubs.has(link.id)) hubs.set(link.id, { key: kind[0] + link.id, kind, label: knowledgeLinkName(kind, link), link, items: [] });
      hubs.get(link.id).items.push(item);
    }));
    if (hubs.size) arcs.push({ kind, label, slot: 0, nodes: [...hubs.values()] });
  });
  // One hub per tag, whatever its case on each item.
  const tags = new Map();
  items.forEach(item => (item.tags || []).forEach(tag => {
    const id = tag.toLowerCase();
    if (!tags.has(id)) tags.set(id, { key: 't' + id, kind: 'tags', label: '#' + tag, items: [] });
    tags.get(id).items.push(item);
  }));
  if (tags.size) arcs.push({ kind: 'tags', label: 'Tags', slot: 0, nodes: [...tags.values()] });
  return arcs;
}

function drawKnowledgeWheel(host, items) {
  knowledgeWheelItems = items;
  host.innerHTML = '';
  const width = Math.max(320, host.clientWidth || 900);
  knowledgeWheelWidth = width;
  ensureKnowledgeWheelObserver(host);

  const arcs = knowledgeWheelModel(items);
  const articleArcs = arcs.filter(a => a.kind === 'type');
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
  const hRoom = W / 2 - R - 20, vRoom = labelRoom - 12;
  const charsAt = deg => {
    const rad = deg * Math.PI / 180;
    const len = Math.min(hRoom / Math.max(Math.abs(Math.sin(rad)), 0.01), vRoom / Math.max(Math.abs(Math.cos(rad)), 0.01));
    return Math.max(8, Math.floor(len / 6.4));
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

  // ── Header: the hover readout and the legend ──
  const info = pjMk('div', 'kw-info', 'Hover a name to trace its links. Click an article to open it.');
  info.setAttribute('aria-live', 'polite');
  host.appendChild(info);

  const svg = kwSvg('svg', {
    class: 'kw-svg', viewBox: `0 0 ${f(W)} ${f(H)}`, role: 'img', direction: 'ltr',
    'aria-label': 'Knowledge wheel: articles and the clients, systems and tags they are linked to',
  });
  svg.style.maxWidth = W + 'px';
  host.appendChild(svg);

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
    if (arc.kind !== 'type') {
      const mid = (arc.start + arc.end) / 2;
      const [lx, ly] = pt(mid, R - 34);
      const t = kwSvg('text', { class: 'kw-arc-label', x: f(lx), y: f(ly), 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, svg);
      t.textContent = arc.label;
    }
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
    const [c1x, c1y] = pt((a.angle + arcMid(a.arc)) / 2, R * 0.42);
    const [c2x, c2y] = pt((b.angle + arcMid(b.arc)) / 2, R * 0.42);
    const path = kwSvg('path', {
      class: 'kw-edge kw-c' + a.arc.slot,
      d: `M${f(ax)} ${f(ay)} C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(bx)} ${f(by)}`,
    }, edgeLayer);
    path.dataset.a = a.node.key; path.dataset.b = hub.key;
    addEdge(a.node.key, path); addEdge(hub.key, path);
  })));

  // Nodes: a dot (articles) or a square (clients/systems) and a radial label.
  const nodeLayer = kwSvg('g', { class: 'kw-nodes' }, svg);
  const nodeEls = new Map();
  const unlinked = [];
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
    else kwSvg('rect', { class: 'kw-dot', x: f(x - 4.5), y: f(y - 4.5), width: '9', height: '9', rx: '2' }, g);
    // Labels read outward; on the left half they are flipped so none is upside down.
    const screenDeg = rtl ? 360 - ((deg % 360) + 360) % 360 : ((deg % 360) + 360) % 360;
    const left = screenDeg > 180;
    const [tx, ty] = pt(deg, R + 16);
    const rot = left ? screenDeg + 90 : screenDeg - 90;
    const text = kwSvg('text', {
      class: 'kw-label', x: f(tx), y: f(ty), 'dominant-baseline': 'middle',
      'text-anchor': left ? 'end' : 'start', transform: `rotate(${f(rot)} ${f(tx)} ${f(ty)})`,
    }, g);
    text.textContent = kwTruncate(node.label, charsAt(deg));
    text.dataset.userContent = '';
    const tip = kwSvg('title', {}, g);
    tip.textContent = node.label;
    tip.dataset.userContent = '';
    g.setAttribute('aria-label', node.label);
    nodeEls.set(node.key, g);

    const focusOn = () => knowledgeWheelHighlight(svg, info, node, arc, edgesByKey, nodeEls);
    g.addEventListener('mouseenter', focusOn);
    g.addEventListener('focus', focusOn);
    g.addEventListener('mouseleave', () => knowledgeWheelRestore(svg, info, pos, edgesByKey, nodeEls));
    g.addEventListener('blur', () => knowledgeWheelRestore(svg, info, pos, edgesByKey, nodeEls));
    const activate = e => {
      e.stopPropagation();
      if (isArticle) { openKnowledgeDetail(node.item.id); return; }
      knowledgeWheelPinned = knowledgeWheelPinned === node.key ? null : node.key;
      knowledgeWheelRestore(svg, info, pos, edgesByKey, nodeEls);
    };
    g.addEventListener('click', activate);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(e); } });
  });
  svg.addEventListener('click', () => {
    if (!knowledgeWheelPinned) return;
    knowledgeWheelPinned = null;
    knowledgeWheelRestore(svg, info, pos, edgesByKey, nodeEls);
  });
  knowledgeWheelRestore(svg, info, pos, edgesByKey, nodeEls);

  // ── Legend ──
  const legend = pjMk('div', 'kw-legend');
  articleArcs.forEach(arc => {
    const item = pjMk('span', 'kw-legend-item');
    item.appendChild(pjMk('span', 'kw-swatch kw-c' + arc.slot));
    const name = pjMk('span', null, arc.label);
    if (arc.code) name.dataset.userContent = '';
    item.appendChild(name);
    item.appendChild(pjMk('span', 'kw-legend-count', String(arc.nodes.length)));
    legend.appendChild(item);
  });
  [['kw-swatch-hub', 'Client, system or tag'], ['kw-swatch-hollow', 'No client, system or tag']].forEach(([cls, label]) => {
    const item = pjMk('span', 'kw-legend-item');
    item.appendChild(pjMk('span', 'kw-swatch ' + cls));
    item.appendChild(pjMk('span', null, label));
    legend.appendChild(item);
  });
  host.appendChild(legend);

  if (unlinked.length) {
    const note = pjMk('div', 'kw-unlinked');
    note.appendChild(pjMk('span', 'kw-unlinked-title', 'No client, system or tag yet:'));
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

// Light one node, its lines and the names at their other ends; fade the rest.
function knowledgeWheelHighlight(svg, info, node, arc, edgesByKey, nodeEls) {
  svg.classList.add('has-focus');
  svg.querySelectorAll('.is-lit').forEach(el => el.classList.remove('is-lit'));
  nodeEls.get(node.key)?.classList.add('is-lit');
  (edgesByKey.get(node.key) || []).forEach(path => {
    path.classList.add('is-lit');
    nodeEls.get(path.dataset.a)?.classList.add('is-lit');
    nodeEls.get(path.dataset.b)?.classList.add('is-lit');
  });
  info.innerHTML = '';
  const name = pjMk('strong', null, node.label);
  name.dataset.userContent = '';
  info.appendChild(name);
  let detail;
  if (node.kind === 'article') {
    const c = (node.item.companies || []).length, s = (node.item.systems || []).length, t = (node.item.tags || []).length;
    detail = !c && !s && !t ? (window.ctI18n?.t('No client, system or tag yet') || 'No client, system or tag yet')
      : [knowledgeWheelCount(c, '1 client', '{n} clients'), knowledgeWheelCount(s, '1 system', '{n} systems'),
        ...(t ? [knowledgeWheelCount(t, '1 tag', '{n} tags')] : [])].join(' · ');
    const type = pjMk('span', 'kw-info-type', arc.label);
    if (arc.code) type.dataset.userContent = '';
    info.appendChild(type);
  } else {
    detail = knowledgeWheelCount(node.items.length, '1 article', '{n} articles');
  }
  info.appendChild(pjMk('span', 'kw-info-detail', detail));
}

function knowledgeWheelRestore(svg, info, pos, edgesByKey, nodeEls) {
  const pinned = knowledgeWheelPinned && pos.get(knowledgeWheelPinned);
  if (pinned) { knowledgeWheelHighlight(svg, info, pinned.node, pinned.arc, edgesByKey, nodeEls); return; }
  knowledgeWheelPinned = null;
  svg.classList.remove('has-focus');
  svg.querySelectorAll('.is-lit').forEach(el => el.classList.remove('is-lit'));
  info.textContent = 'Hover a name to trace its links. Click an article to open it.';
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
