// ══ SERVER WHEEL (Client → Servers → Wheel) ════════════════════════════════════
// A client's servers drawn around a circle: servers on one side in coloured
// arcs by System, and on the other the outside hosts they link to and the
// external parties they talk to, with a curved line for every link (migration
// 076's lists). A Linked Servers entry that matches another server's IP or
// hostname joins the two servers directly; one that matches none becomes an
// "other host" of its own. Hovering a name traces its links; clicking a server
// opens it, clicking a host or party keeps its links lit. Drawn with the
// Knowledge wheel's helpers and styles (knowledge-wheel.js, loaded first).

let serverWheelServers = [];
let serverWheelPinned = null;      // node key kept highlighted after a click
let serverWheelWidth = 0;
let serverWheelObserver = null;
let serverWheelHost = null;

const SW_SYSTEM_SLOTS = 8;          // the same fixed-order hues as the Knowledge wheel

function swT(text, vars) {
  const t = typeof window !== 'undefined' ? window.ctI18n?.t : null;
  return (t && t(text, vars)) || Object.entries(vars || {}).reduce((s, [k, v]) => s.replace('{' + k + '}', v), text);
}
const swNorm = v => String(v ?? '').trim().toLowerCase();

// A server's name on the wheel: where it lives first (so a cut-short label
// still shows it), then its role, then the environment when it is not
// Production (most are, so that stays quiet).
function serverWheelLabel(s) {
  const role = (typeof lkLabel === 'function' && lkLabel('SERVER_ROLE', s.role)) || s.roleLabel || '(no role)';
  const env = s.environment === 'TEST' ? 'UAT' : s.environment === 'BOTH' ? 'Production + UAT' : '';
  return [s.host || s.hostname || '', swT(role), env && swT(env)].filter(Boolean).join(' · ');
}

// Arcs in drawing order: one per System (by name, no-system last), then the
// other hosts, then the external parties. Each node is { key, kind, label,
// server | servers }. `links` holds each link once as { a, b } node keys.
function serverWheelModel(servers) {
  const systemName = s => (typeof lkLabel === 'function' && lkLabel('SYSTEM', s.systemName)) || s.systemName || '';
  const bySystem = new Map();
  servers.forEach(s => {
    const key = s.systemName || '';
    if (!bySystem.has(key)) bySystem.set(key, []);
    bySystem.get(key).push(s);
  });
  const systemKeys = [...bySystem.keys()].sort((a, b) =>
    (a ? 0 : 1) - (b ? 0 : 1) || systemName({ systemName: a }).localeCompare(systemName({ systemName: b })));
  const arcs = systemKeys.map((key, i) => ({
    kind: 'system', code: key, slot: i < SW_SYSTEM_SLOTS ? i + 1 : 0,
    label: key ? systemName(bySystem.get(key)[0]) : swT('No system'),
    nodes: bySystem.get(key).slice()
      // Number-aware, so 10.0.0.9 sorts before 10.0.0.10.
      .sort((a, b) => serverWheelLabel(a).localeCompare(serverWheelLabel(b), undefined, { numeric: true }))
      .map(s => ({ key: 's' + s.id, kind: 'server', label: serverWheelLabel(s), server: s })),
  }));

  // Every IP and hostname a server answers to. Two servers can share a
  // hostname (a cluster name), so one entry may match several.
  const answersTo = new Map();
  servers.forEach(s => [s.host, s.hostname].map(swNorm).filter(Boolean).forEach(name => {
    if (!answersTo.has(name)) answersTo.set(name, []);
    if (!answersTo.get(name).includes(s)) answersTo.get(name).push(s);
  }));

  const links = [];
  const seen = new Set();
  const link = (a, b) => {
    const id = a < b ? a + '|' + b : b + '|' + a;
    if (a === b || seen.has(id)) return;
    seen.add(id);
    links.push({ a, b });
  };
  const hosts = new Map(), parties = new Map();
  const hub = (map, prefix, kind, name, s) => {
    const k = swNorm(name);
    if (!map.has(k)) map.set(k, { key: prefix + k, kind, label: String(name).trim(), servers: [] });
    const node = map.get(k);
    if (!node.servers.includes(s)) node.servers.push(s);
    return node.key;
  };
  servers.forEach(s => {
    (s.linkedServers || []).forEach(entry => {
      const targets = (answersTo.get(swNorm(entry)) || []).filter(t => t !== s);
      if (targets.length) targets.forEach(t => link('s' + s.id, 's' + t.id));
      else if (!answersTo.get(swNorm(entry))) link('s' + s.id, hub(hosts, 'h:', 'host', entry, s));
    });
    (s.externalParties || []).forEach(p => link('s' + s.id, hub(parties, 'p:', 'party', p, s)));
  });
  if (hosts.size) arcs.push({ kind: 'hosts', label: swT('Other hosts'), slot: 0, nodes: [...hosts.values()] });
  if (parties.size) arcs.push({ kind: 'parties', label: swT('External Parties'), slot: 0, nodes: [...parties.values()] });
  return { arcs, links };
}

function buildServerWheel(servers) {
  const host = pjMk('div', 'kh-wheel cl-srv-wheel');
  // Drawn once it is in the page, so it can size itself to the column.
  requestAnimationFrame(() => { if (host.isConnected) drawServerWheel(host, servers); });
  return host;
}

function drawServerWheel(host, servers) {
  serverWheelServers = servers;
  serverWheelHost = host;
  host.innerHTML = '';
  const width = Math.max(320, host.clientWidth || 900);
  serverWheelWidth = width;
  ensureServerWheelObserver();

  const { arcs, links } = serverWheelModel(servers);
  const serverArcs = arcs.filter(a => a.kind === 'system');
  const hubArcs = arcs.filter(a => a.kind !== 'system');
  const nodeCount = arcs.reduce((n, a) => n + a.nodes.length, 0);

  // Servers centred on the left, hosts and parties on the right, one empty
  // slot between arcs — the Knowledge wheel's layout.
  const serverSlots = serverArcs.reduce((n, a) => n + a.nodes.length + 1, 0);
  const hubSlots = hubArcs.reduce((n, a) => n + a.nodes.length + 1, 0);
  const slots = Math.max(serverSlots + hubSlots, 12);
  const step = 360 / slots;
  const rtl = document.documentElement.dir === 'rtl';

  const room = window.innerHeight - host.getBoundingClientRect().top - 110;
  const size = Math.min(width - 32, 1000, Math.max(520, room));
  const labelRoom = Math.max(90, Math.min(170, size * 0.19));
  let R = size / 2 - labelRoom;
  R = Math.max(R, (nodeCount + arcs.length) * 14 / (2 * Math.PI));
  const H = 2 * (R + labelRoom);
  const W = Math.max(H, Math.min(width - 32, 2 * (R + 280)));
  const cx = W / 2, cy = H / 2;
  const hRoom = W / 2 - R - 20, vRoom = labelRoom - 12;
  const charsAt = deg => {
    const rad = deg * Math.PI / 180;
    const len = Math.min(hRoom / Math.max(Math.abs(Math.sin(rad)), 0.01), vRoom / Math.max(Math.abs(Math.cos(rad)), 0.01));
    return Math.max(8, Math.floor(len / 6.4));
  };

  let angle = 270 - (serverSlots * step) / 2 + step / 2;
  const pos = new Map();   // key -> { angle, node, arc }
  const place = arc => {
    arc.start = angle;
    arc.nodes.forEach(node => { pos.set(node.key, { angle, node, arc }); angle += step; });
    arc.end = angle - step;
    angle += step;
  };
  serverArcs.forEach(place);
  // A host or party linked to servers near the top goes near the top, so lines cross less.
  hubArcs.forEach(arc => {
    const height = node => {
      const ys = node.servers.map(s => Math.cos((pos.get('s' + s.id)?.angle || 0) * Math.PI / 180));
      return ys.reduce((sum, y) => sum + y, 0) / ys.length;
    };
    arc.nodes.sort((a, b) => height(b) - height(a) || a.label.localeCompare(b.label));
  });
  angle = 90 - (hubSlots * step) / 2 + step / 2;
  hubArcs.forEach(place);

  const pt = (deg, r) => {
    const rad = deg * Math.PI / 180;
    return [cx + (rtl ? -1 : 1) * Math.sin(rad) * r, cy - Math.cos(rad) * r];
  };
  const f = n => n.toFixed(1);
  const hint = 'Hover a server to trace its links. Click one to open it.';

  const info = pjMk('div', 'kw-info', hint);
  info.setAttribute('aria-live', 'polite');
  host.appendChild(info);

  const svg = kwSvg('svg', {
    class: 'kw-svg', viewBox: `0 0 ${f(W)} ${f(H)}`, role: 'img', direction: 'ltr',
    'aria-label': swT('Server wheel: servers, the hosts they link to and the external parties they talk to'),
  });
  svg.style.maxWidth = W + 'px';
  host.appendChild(svg);

  arcs.forEach(arc => {
    const a0 = arc.start - step * 0.4, a1 = arc.end + step * 0.4;
    const [x0, y0] = pt(a0, R + 7), [x1, y1] = pt(a1, R + 7);
    kwSvg('path', {
      class: 'kw-band ' + (arc.kind === 'system' ? 'kw-c' + arc.slot : 'kw-hub'),
      d: `M${f(x0)} ${f(y0)} A${f(R + 7)} ${f(R + 7)} 0 ${a1 - a0 > 180 ? 1 : 0} ${rtl ? 0 : 1} ${f(x1)} ${f(y1)}`,
    }, svg);
    if (arc.kind !== 'system') {
      const [lx, ly] = pt((arc.start + arc.end) / 2, R - 34);
      const t = kwSvg('text', { class: 'kw-arc-label', x: f(lx), y: f(ly), 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, svg);
      t.textContent = arc.label;
    }
  });

  // Each line is pulled toward the middle and toward its ends' arc centres, so
  // lines leaving one arc travel together. Coloured by the server's System.
  const edgeLayer = kwSvg('g', { class: 'kw-edges' }, svg);
  const edgesByKey = new Map();
  const addEdge = (key, path) => { if (!edgesByKey.has(key)) edgesByKey.set(key, []); edgesByKey.get(key).push(path); };
  const arcMid = arc => (arc.start + arc.end) / 2;
  links.forEach(({ a: ka, b: kb }) => {
    const a = pos.get(ka), b = pos.get(kb);
    if (!a || !b) return;
    const [ax, ay] = pt(a.angle, R - 6), [bx, by] = pt(b.angle, R - 6);
    const [c1x, c1y] = pt((a.angle + arcMid(a.arc)) / 2, R * 0.42);
    const [c2x, c2y] = pt((b.angle + arcMid(b.arc)) / 2, R * 0.42);
    const path = kwSvg('path', {
      class: 'kw-edge kw-c' + a.arc.slot + (b.node.kind === 'server' ? ' sw-edge-server' : ''),
      d: `M${f(ax)} ${f(ay)} C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(bx)} ${f(by)}`,
    }, edgeLayer);
    path.dataset.a = ka; path.dataset.b = kb;
    addEdge(ka, path); addEdge(kb, path);
  });

  const nodeLayer = kwSvg('g', { class: 'kw-nodes' }, svg);
  const nodeEls = new Map();
  const unlinked = [];
  pos.forEach(({ angle: deg, node, arc }) => {
    const isServer = node.kind === 'server';
    const linked = edgesByKey.has(node.key);
    if (isServer && !linked) unlinked.push(node.server);
    const inactive = isServer && node.server.status === 'INACTIVE';
    const g = kwSvg('g', {
      class: 'kw-node ' + (isServer ? 'is-article kw-c' + arc.slot : 'is-hub sw-' + node.kind)
        + (linked ? '' : ' is-unlinked') + (inactive ? ' sw-inactive' : ''),
      tabindex: '0', role: 'button',
    }, nodeLayer);
    const [x, y] = pt(deg, R);
    if (isServer) kwSvg('circle', { class: 'kw-dot', cx: f(x), cy: f(y), r: '4.5' }, g);
    else kwSvg('rect', { class: 'kw-dot', x: f(x - 4.5), y: f(y - 4.5), width: '9', height: '9', rx: '2' }, g);
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
    const full = isServer ? serverIdentityText(node.server) : node.label;
    const tip = kwSvg('title', {}, g);
    tip.textContent = full;
    tip.dataset.userContent = '';
    g.setAttribute('aria-label', full);
    nodeEls.set(node.key, g);

    const focusOn = () => serverWheelHighlight(svg, info, node, edgesByKey, nodeEls);
    const restore = () => serverWheelRestore(svg, info, pos, edgesByKey, nodeEls, hint);
    g.addEventListener('mouseenter', focusOn);
    g.addEventListener('focus', focusOn);
    g.addEventListener('mouseleave', restore);
    g.addEventListener('blur', restore);
    const activate = e => {
      e.stopPropagation();
      if (isServer) { openClientServerModal(node.server); return; }
      serverWheelPinned = serverWheelPinned === node.key ? null : node.key;
      restore();
    };
    g.addEventListener('click', activate);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(e); } });
  });
  svg.addEventListener('click', () => {
    if (!serverWheelPinned) return;
    serverWheelPinned = null;
    serverWheelRestore(svg, info, pos, edgesByKey, nodeEls, hint);
  });
  serverWheelRestore(svg, info, pos, edgesByKey, nodeEls, hint);

  const legend = pjMk('div', 'kw-legend');
  serverArcs.forEach(arc => {
    const item = pjMk('span', 'kw-legend-item');
    item.appendChild(pjMk('span', 'kw-swatch kw-c' + arc.slot));
    const name = pjMk('span', null, arc.label);
    if (arc.code) name.dataset.userContent = '';
    item.appendChild(name);
    item.appendChild(pjMk('span', 'kw-legend-count', String(arc.nodes.length)));
    legend.appendChild(item);
  });
  [['kw-swatch-hub', 'External party'], ['kw-swatch-hub sw-swatch-host', 'Host not among this client\'s servers'],
    ['kw-swatch-hollow', 'Not Active']].forEach(([cls, label]) => {
    const item = pjMk('span', 'kw-legend-item');
    item.appendChild(pjMk('span', 'kw-swatch ' + cls));
    item.appendChild(pjMk('span', null, label));
    legend.appendChild(item);
  });
  host.appendChild(legend);

  if (unlinked.length) {
    const note = pjMk('div', 'kw-unlinked');
    note.appendChild(pjMk('span', 'kw-unlinked-title', 'No linked servers or external parties yet:'));
    unlinked.forEach(s => {
      const b = pjMk('button', 'kw-unlinked-item', serverIdentityText(s));
      b.type = 'button';
      b.dataset.userContent = '';
      b.addEventListener('click', () => openClientServerModal(s));
      note.appendChild(b);
    });
    host.appendChild(note);
  }
}

function serverWheelCount(n, one, many) {
  return n === 1 ? swT(one) : swT(many, { n });
}

// Light one node, its lines and the names at their other ends; fade the rest.
function serverWheelHighlight(svg, info, node, edgesByKey, nodeEls) {
  svg.classList.add('has-focus');
  svg.querySelectorAll('.is-lit').forEach(el => el.classList.remove('is-lit'));
  nodeEls.get(node.key)?.classList.add('is-lit');
  const ends = new Set();
  (edgesByKey.get(node.key) || []).forEach(path => {
    path.classList.add('is-lit');
    [path.dataset.a, path.dataset.b].forEach(k => { nodeEls.get(k)?.classList.add('is-lit'); if (k !== node.key) ends.add(k); });
  });
  info.innerHTML = '';
  const name = pjMk('strong', null, node.kind === 'server' ? serverIdentityText(node.server) : node.label);
  name.dataset.userContent = '';
  info.appendChild(name);
  let detail;
  if (node.kind === 'server') {
    const servers = [...ends].filter(k => k[0] === 's').length;
    const hosts = [...ends].filter(k => k.startsWith('h:')).length;
    const parties = [...ends].filter(k => k.startsWith('p:')).length;
    detail = [serverWheelCount(servers + hosts, '1 linked server', '{n} linked servers'),
      serverWheelCount(parties, '1 external party', '{n} external parties')].join(' · ');
  } else {
    detail = serverWheelCount(node.servers.length, '1 server', '{n} servers');
  }
  info.appendChild(pjMk('span', 'kw-info-detail', detail));
}

function serverWheelRestore(svg, info, pos, edgesByKey, nodeEls, hint) {
  const pinned = serverWheelPinned && pos.get(serverWheelPinned);
  if (pinned) { serverWheelHighlight(svg, info, pinned.node, edgesByKey, nodeEls); return; }
  serverWheelPinned = null;
  svg.classList.remove('has-focus');
  svg.querySelectorAll('.is-lit').forEach(el => el.classList.remove('is-lit'));
  info.textContent = hint;
}

// The wheel redraws when its column changes width (window resize, side panel).
function ensureServerWheelObserver() {
  if (serverWheelObserver || typeof ResizeObserver === 'undefined') return;
  let timer = null;
  serverWheelObserver = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const host = serverWheelHost;
      if (!host || !host.isConnected) return;
      if (Math.abs((host.clientWidth || 0) - serverWheelWidth) < 8) return;
      drawServerWheel(host, serverWheelServers);
    }, 120);
  });
  serverWheelObserver.observe(document.documentElement);
}
