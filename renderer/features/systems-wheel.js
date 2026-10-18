// ══ SYSTEMS WHEEL (Clients → Systems wheel) ═══════════════════════════════════
// The Systems web drawn around a circle: clients on one side, systems on the
// other, a curved line wherever this login's records link the two. It reads the
// same model the web builds in clients.js (same "Linked through" sources, same
// crossing-minimised order, same pinned system), so switching between the two
// keeps everything in place. A line's thickness is how many records link the
// pair; a system's shade is how many clients use it. Hovering a name traces its
// links; clicking a client opens it, clicking a system keeps its links lit.
// Drawn with the Knowledge wheel's helpers and styles (knowledge-wheel.js,
// loaded first).

// Angles (0 = top, clockwise) for every node: clients centred on the left and
// systems on the right, each running top to bottom in the order given, with
// one empty slot after each side. Returns { step, clients, systems } where the
// last two are [{ id, angle }] in the order given.
function systemsWheelPlacement(clientIds, systemIds) {
  const cSlots = clientIds.length + 1, sSlots = systemIds.length + 1;
  const step = 360 / Math.max(cSlots + sSlots, 12);
  // The left side runs bottom to top as the angle grows, so it is filled from
  // the far end to keep the first client at the top.
  const cStart = 270 - (cSlots * step) / 2 + step / 2;
  const clients = clientIds.map((id, i) => ({ id, angle: cStart + (clientIds.length - 1 - i) * step }));
  const sStart = 90 - (sSlots * step) / 2 + step / 2;
  const systems = systemIds.map((id, i) => ({ id, angle: sStart + i * step }));
  return { step, clients, systems };
}

// `model` is { clients, systems, cOrder, sOrder, links } from drawClientsWeb:
// clients/systems are Map(id -> { id, name, links }), links carry their weight w.
function drawSystemsWheel(host, model) {
  const { clients, systems, cOrder, sOrder, links } = model;
  const box = pjMk('div', 'kh-wheel cl-sys-wheel');
  host.appendChild(box);
  const width = Math.max(320, box.clientWidth || 900);
  const rtl = document.documentElement.dir === 'rtl';

  const placed = systemsWheelPlacement(cOrder.map(n => n.id), sOrder.map(n => n.id));
  const step = placed.step;
  const nodeCount = cOrder.length + sOrder.length;

  // The Knowledge wheel's sizing: fit the window and the column.
  const room = window.innerHeight - box.getBoundingClientRect().top - 110;
  const size = Math.min(width - 32, 1000, Math.max(520, room));
  const labelRoom = Math.max(90, Math.min(170, size * 0.19));
  let R = size / 2 - labelRoom;
  R = Math.max(R, (nodeCount + 2) * 14 / (2 * Math.PI));
  const H = 2 * (R + labelRoom);
  const W = Math.max(H, Math.min(width - 32, 2 * (R + 280)));
  const cx = W / 2, cy = H / 2;
  const hRoom = W / 2 - R - 20, vRoom = labelRoom - 12;
  const charsAt = deg => {
    const rad = deg * Math.PI / 180;
    const len = Math.min(hRoom / Math.max(Math.abs(Math.sin(rad)), 0.01), vRoom / Math.max(Math.abs(Math.cos(rad)), 0.01));
    return Math.max(8, Math.floor(len / 6.4));
  };
  const pt = (deg, r) => {
    const rad = deg * Math.PI / 180;
    return [cx + (rtl ? -1 : 1) * Math.sin(rad) * r, cy - Math.cos(rad) * r];
  };
  const f = n => n.toFixed(1);
  const hint = 'Hover a name to trace its links. Click a client to open it.';

  // key -> { angle, kind, node }
  const pos = new Map();
  placed.clients.forEach(({ id, angle }) => pos.set('c' + id, { angle, kind: 'client', node: clients.get(id) }));
  placed.systems.forEach(({ id, angle }) => pos.set('s' + id, { angle, kind: 'system', node: systems.get(id) }));

  const info = pjMk('div', 'kw-info', hint);
  info.setAttribute('aria-live', 'polite');
  box.appendChild(info);

  const svg = kwSvg('svg', {
    class: 'kw-svg', viewBox: `0 0 ${f(W)} ${f(H)}`, role: 'img', direction: 'ltr',
    'aria-label': 'Systems wheel: clients and the systems they use',
  });
  svg.style.maxWidth = W + 'px';
  box.appendChild(svg);

  // One band per side, with its name just inside the circle.
  [[placed.clients, 'Clients', 'kw-band'], [placed.systems, 'Systems', 'kw-band kw-hub']].forEach(([side, label, cls]) => {
    if (!side.length) return;
    const angles = side.map(n => n.angle);
    const a0 = Math.min(...angles) - step * 0.4, a1 = Math.max(...angles) + step * 0.4;
    const [x0, y0] = pt(a0, R + 7), [x1, y1] = pt(a1, R + 7);
    kwSvg('path', {
      class: cls,
      d: `M${f(x0)} ${f(y0)} A${f(R + 7)} ${f(R + 7)} 0 ${a1 - a0 > 180 ? 1 : 0} ${rtl ? 0 : 1} ${f(x1)} ${f(y1)}`,
    }, svg);
    const [lx, ly] = pt((a0 + a1) / 2, R - 34);
    const t = kwSvg('text', { class: 'kw-arc-label', x: f(lx), y: f(ly), 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, svg);
    t.textContent = label;
  });

  // Lines pulled toward the middle and toward each side's centre, so lines
  // leaving one side travel together.
  const mid = side => side.length ? (side[0].angle + side[side.length - 1].angle) / 2 : 0;
  const cMid = mid(placed.clients), sMid = mid(placed.systems);
  const maxW = Math.max(...links.map(l => l.w));
  const edgeLayer = kwSvg('g', { class: 'kw-edges' }, svg);
  const edgesByKey = new Map();
  const addEdge = (key, path) => { if (!edgesByKey.has(key)) edgesByKey.set(key, []); edgesByKey.get(key).push(path); };
  links.forEach(l => {
    const ka = 'c' + l.companyId, kb = 's' + l.systemId;
    const a = pos.get(ka), b = pos.get(kb);
    if (!a || !b) return;
    const [ax, ay] = pt(a.angle, R - 6), [bx, by] = pt(b.angle, R - 6);
    const [c1x, c1y] = pt((a.angle + cMid) / 2, R * 0.42);
    const [c2x, c2y] = pt((b.angle + sMid) / 2, R * 0.42);
    const path = kwSvg('path', {
      class: 'kw-edge',
      d: `M${f(ax)} ${f(ay)} C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(bx)} ${f(by)}`,
    }, edgeLayer);
    path.style.strokeWidth = (1.2 + 4.8 * Math.sqrt(l.w / maxW)).toFixed(2);
    const tip = kwSvg('title', {}, path);
    tip.textContent = clientsWebLinkText(l, a.node.name, b.node.name);
    tip.dataset.userContent = '';
    path.dataset.a = ka; path.dataset.b = kb;
    addEdge(ka, path); addEdge(kb, path);
  });

  // Nodes: a dot for a client, a square for a system shaded by how many
  // clients use it.
  const maxShare = Math.max(...sOrder.map(s => s.links.length));
  const nodeLayer = kwSvg('g', { class: 'kw-nodes' }, svg);
  const nodeEls = new Map();
  const highlight = key => systemsWheelHighlight(svg, info, pos.get(key), key, edgesByKey, nodeEls);
  const restore = () => {
    const pinned = clientsWebPinned != null && pos.has('s' + clientsWebPinned) ? 's' + clientsWebPinned : null;
    if (pinned) { highlight(pinned); return; }
    svg.classList.remove('has-focus');
    svg.querySelectorAll('.is-lit').forEach(el => el.classList.remove('is-lit'));
    info.textContent = hint;
  };
  pos.forEach(({ angle: deg, kind, node }, key) => {
    const isClient = kind === 'client';
    const g = kwSvg('g', { class: 'kw-node ' + (isClient ? 'is-article' : 'is-hub'), tabindex: '0', role: 'button' }, nodeLayer);
    const [x, y] = pt(deg, R);
    if (isClient) kwSvg('circle', { class: 'kw-dot', cx: f(x), cy: f(y), r: '4.5' }, g);
    else {
      const dot = kwSvg('rect', { class: 'kw-dot', x: f(x - 5), y: f(y - 5), width: '10', height: '10', rx: '2' }, g);
      const share = Math.round(25 + 75 * (node.links.length - 1) / Math.max(1, maxShare - 1));
      dot.style.fill = `color-mix(in srgb, var(--primary) ${share}%, var(--muted))`;
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
    text.textContent = kwTruncate(node.name, charsAt(deg));
    text.dataset.userContent = '';
    const tip = kwSvg('title', {}, g);
    tip.textContent = node.name;
    tip.dataset.userContent = '';
    g.setAttribute('aria-label', node.name);
    if (!isClient) g.setAttribute('aria-pressed', String(clientsWebPinned === node.id));
    nodeEls.set(key, g);

    g.addEventListener('mouseenter', () => highlight(key));
    g.addEventListener('focus', () => highlight(key));
    g.addEventListener('mouseleave', restore);
    g.addEventListener('blur', restore);
    const activate = e => {
      e.stopPropagation();
      if (isClient) { openClientDetail(node.id); return; }
      clientsWebPinned = clientsWebPinned === node.id ? null : node.id;
      nodeEls.forEach((el, k) => { if (k[0] === 's') el.setAttribute('aria-pressed', String(k === 's' + clientsWebPinned)); });
      restore();
    };
    g.addEventListener('click', activate);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(e); } });
  });
  svg.addEventListener('click', () => {
    if (clientsWebPinned == null) return;
    clientsWebPinned = null;
    nodeEls.forEach((el, k) => { if (k[0] === 's') el.setAttribute('aria-pressed', 'false'); });
    restore();
  });
  restore();

  const legend = pjMk('div', 'kw-legend');
  [['kw-swatch', 'Client'], ['kw-swatch kw-swatch-hub cl-sys-swatch', 'System']].forEach(([cls, label]) => {
    const item = pjMk('span', 'kw-legend-item');
    item.appendChild(pjMk('span', cls));
    item.appendChild(pjMk('span', null, label));
    legend.appendChild(item);
  });
  legend.append(pjMk('span', null, 'Thicker line = more linked records'),
    pjMk('span', null, 'Darker system = used by more clients'));
  box.appendChild(legend);
}

// Light one node, its lines and the names at their other ends; fade the rest.
function systemsWheelHighlight(svg, info, at, key, edgesByKey, nodeEls) {
  svg.classList.add('has-focus');
  svg.querySelectorAll('.is-lit').forEach(el => el.classList.remove('is-lit'));
  nodeEls.get(key)?.classList.add('is-lit');
  (edgesByKey.get(key) || []).forEach(path => {
    path.classList.add('is-lit');
    nodeEls.get(path.dataset.a)?.classList.add('is-lit');
    nodeEls.get(path.dataset.b)?.classList.add('is-lit');
  });
  info.innerHTML = '';
  const name = pjMk('strong', null, at.node.name);
  name.dataset.userContent = '';
  info.appendChild(name);
  info.appendChild(pjMk('span', 'kw-info-detail',
    clientsWebCount(at.node.links.length, at.kind === 'client' ? 'system' : 'client')));
}
