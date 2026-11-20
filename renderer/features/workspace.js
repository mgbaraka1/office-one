// ── Browse dimension (Companies | Systems | Work Nature) ──
let browseKind = 'companies';
function setBrowseKind(kind) {
  if (!CP_DEF[kind]) kind = 'companies';
  browseKind = kind;
  document.querySelectorAll('#browse-kind-ctl .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.kind === kind));
  Object.keys(CP_DEF).forEach(k => {
    document.getElementById('browse-body-' + k).style.display = k === kind ? '' : 'none';
  });
  setAppTitle('Browse', window.ctI18n?.t?.(CP_DEF[kind].title));
  openCatPage(kind);
  uiState.filters.browse = { kind, selected: cpState[kind].selected };
  saveUiStateDebounced();
}
// Cross-link entry point: open Browse pre-selected on one company / system /
// work-nature value.
function openBrowseSlice(kind, name) {
  cpState[kind].selected = name;
  resetCatFilters(cpState[kind]);
  browseKind = kind;
  if (activeModule === 'browse') setBrowseKind(kind);
  else switchModule('browse');
}

// ══ COMPANIES / SYSTEMS / WORK NATURE — read-only views over tasks + work_logs ══
// The dimensions are identical except for which category column they group by,
// so a single parameterized renderer drives them (kind = 'companies' |
// 'systems' | 'natures'). Data is read via the companies:/systems:/natures: IPC
// channels (always scoped to the session user in main); these pages never write.
const CP_DEF = {
  companies: { noun: 'company',     title: 'Companies',   icon: ic('building-2'), listApi: 'listCompanies', entriesApi: 'companyEntries' },
  systems:   { noun: 'system',      title: 'Systems',     icon: ic('folder'),     listApi: 'listSystems',   entriesApi: 'systemEntries' },
  natures:   { noun: 'work nature', title: 'Work Nature', icon: ic('tag'),        listApi: 'listNatures',   entriesApi: 'natureEntries' },
};
let cpState = {
  // q: session search; sub: the chip picked (null = all); visible: the rows
  // listed now; drawer: the session shown in the side panel; openTasks: task
  // lines expanded in the Tasks view.
  companies: { list: [], selected: null, entries: [], from: '', to: '', type: '', q: '', sub: null, visible: [], drawer: null, openTasks: new Set() },
  systems:   { list: [], selected: null, entries: [], from: '', to: '', type: '', q: '', sub: null, visible: [], drawer: null, openTasks: new Set() },
  natures:   { list: [], selected: null, entries: [], from: '', to: '', type: '', q: '', sub: null, visible: [], drawer: null, openTasks: new Set() },
};
// A new slice starts with every filter and the panel cleared.
function resetCatFilters(st) {
  st.from = ''; st.to = ''; st.type = ''; st.q = ''; st.sub = null;
  st.drawer = null; st.openTasks = new Set();
}
// The label a dimension value is shown by (list and title).
function catDisplayName(kind, value) {
  if (kind === 'companies') return companyDisplayName(value);
  return lkLabel(kind === 'systems' ? 'SYSTEM' : 'ACTIVITY_TYPE', value);
}

// Entered via switchModule(kind): (re)load the value list, keep a valid selection.
async function openCatPage(kind) {
  const def = CP_DEF[kind]; const st = cpState[kind];
  if (!document.getElementById(kind + '-list').childElementCount) showSkeleton(kind + '-list', 'text', 6);
  let list;
  try { list = await window.api[def.listApi](); }
  catch { toast('Could not load ' + kind); return; }
  st.list = Array.isArray(list) ? list : [];
  // Only a handful of work natures: busiest first reads better than A–Z.
  if (kind === 'natures') st.list.sort((a, b) => b.count - a.count);
  if (st.selected && !st.list.some(x => x.name === st.selected)) st.selected = null;
  renderCatList(kind);
  if (st.selected) loadCatEntries(kind, st.selected);
  else renderCatRecords(kind);
}

function renderCatList(kind) {
  const def = CP_DEF[kind]; const st = cpState[kind];
  const q = (document.getElementById(kind + '-search').value || '').trim().toLowerCase();
  const wrap = document.getElementById(kind + '-list');
  wrap.innerHTML = '';
  const displayName = value => catDisplayName(kind, value);
  const items = q ? st.list.filter(x =>
    [x.name, displayName(x.name)].some(value => String(value || '').toLowerCase().includes(q))) : st.list;
  if (!items.length) {
    const empty = document.createElement('div'); empty.className = 'cp-list-empty';
    empty.textContent = st.list.length ? 'No matches' : ('No ' + def.noun + ' data yet');
    wrap.appendChild(empty); return;
  }
  items.forEach(x => {
    const btn = document.createElement('button');
    btn.className = 'cp-list-item' + (x.name === st.selected ? ' active' : '');
    const nm = document.createElement('span'); nm.className = 'cp-list-name';
    nm.dataset.userContent = ''; nm.textContent = displayName(x.name); nm.title = displayName(x.name);
    const ct = document.createElement('span'); ct.className = 'cp-list-count';
    ct.textContent = x.count;
    btn.appendChild(nm); btn.appendChild(ct);
    btn.addEventListener('click', () => selectCat(kind, x.name));
    wrap.appendChild(btn);
  });
}

function selectCat(kind, name) {
  const st = cpState[kind];
  st.selected = name; resetCatFilters(st);
  renderCatList(kind);
  loadCatEntries(kind, name);
  uiState.filters.browse = { kind, selected: name };
  saveUiStateDebounced();
}

async function loadCatEntries(kind, name) {
  const def = CP_DEF[kind]; const st = cpState[kind];
  showSkeleton(kind + '-records', 'text', 6);
  let entries;
  try { entries = await window.api[def.entriesApi](name); }
  catch { toast('Could not load records'); return; }
  if (st.selected !== name) return;   // selection changed while this was loading
  st.entries = Array.isArray(entries) ? entries : [];
  renderCatRecords(kind);
}

// Quick date ranges for the Browse filter bar. Each returns [from, to] as
// YYYY-MM-DD; '' leaves that end open.
const CP_PRESETS = [
  { key: 'all',   label: 'All time',      range: () => ['', ''] },
  { key: 'month', label: 'This month',    range: () => { const d = new Date(); return [fmt(new Date(d.getFullYear(), d.getMonth(), 1)), fmt(d)]; } },
  { key: '30d',   label: 'Last 30 days',  range: () => { const d = new Date(); const s = new Date(d); s.setDate(d.getDate() - 29); return [fmt(s), fmt(d)]; } },
  { key: '3m',    label: 'Last 3 months', range: () => { const d = new Date(); return [fmt(new Date(d.getFullYear(), d.getMonth() - 2, 1)), fmt(d)]; } },
  { key: 'year',  label: 'This year',     range: () => { const d = new Date(); return [fmt(new Date(d.getFullYear(), 0, 1)), fmt(d)]; } },
];
const CP_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// How the records are listed: 'sessions' (one line per work session, grouped
// by month) or 'tasks' (one line per task, expandable to its sessions). Shared
// by all three dimensions for the app session.
let cpView = 'sessions';

const cpT = (k, v) => (window.ctI18n?.t ? window.ctI18n.t(k, v)
  : k.replace(/\{(\w+)\}/g, (_, n) => (v || {})[n]));
const cpCo = v => (v ? companyDisplayName(v) : '');
const cpSy = v => (v ? lkLabel('SYSTEM', v) : '');
const cpNat = v => (v ? lkLabel('ACTIVITY_TYPE', v) : '');

// Per dimension: the one "category" column (the two other dimensions, on one
// line — the browsed one is already the title) for a session line and for a
// task line, plus the field the narrowing chips group by.
const CP_VIEW_DEF = {
  companies: { head: 'System / Natural',  parts: r => [cpSy(r.system), cpNat(r.natural)],
               taskHead: 'System',  taskParts: r => [cpSy(r.system), ''],
               chipField: 'system',  chipLabel: 'System',  chipShow: cpSy },
  systems:   { head: 'Company / Natural', parts: r => [cpCo(r.company), cpNat(r.natural)],
               taskHead: 'Company', taskParts: r => [cpCo(r.company), ''],
               chipField: 'company', chipLabel: 'Company', chipShow: cpCo },
  natures:   { head: 'Company / System',  parts: r => [cpCo(r.company), cpSy(r.system)],
               taskHead: 'Company / System', taskParts: r => [cpCo(r.company), cpSy(r.system)],
               chipField: 'company', chipLabel: 'Company', chipShow: cpCo },
};

// Build the records panel shell once per selection (header, two toolbar rows,
// chips, table); filter changes only recompute the chips, summary and table
// via applyCatFilter, so the inputs keep their focus.
function renderCatRecords(kind) {
  const def = CP_DEF[kind]; const st = cpState[kind];
  const host = document.getElementById(kind + '-records');
  host.innerHTML = '';
  host.classList.remove('cp-has-drawer');
  renderCatDrawer(kind);

  if (!st.selected) {
    const ph = document.createElement('div'); ph.className = 'cp-placeholder';
    ph.innerHTML = '<div class="icon">' + def.icon + '</div><p>Select a ' + def.noun + ' to view its records</p>';
    host.appendChild(ph); return;
  }

  const head = document.createElement('div'); head.className = 'cp-records-head';
  const title = document.createElement('h2'); title.className = 'cp-records-title';
  title.textContent = catDisplayName(kind, st.selected);
  head.appendChild(title);
  const sub = document.createElement('span'); sub.className = 'cp-records-sub';
  sub.id = kind + '-records-sub';
  head.appendChild(sub);
  host.appendChild(head);
  // Stats: a row of tiles under the title.
  const summary = document.createElement('div'); summary.className = 'cp-stats';
  summary.id = kind + '-summary';
  host.appendChild(summary);

  // Toolbar row 1: quick ranges, then From – To, type and Clear. The fields
  // carry no visible label; the label is their tooltip and accessible name.
  const bar = document.createElement('div'); bar.className = 'cp-filter-bar';
  const mkField = (labelText, inputEl) => {
    inputEl.title = labelText; inputEl.setAttribute('aria-label', labelText);
    inputEl.classList.add('cp-filter-input');
    return inputEl;
  };
  const fromInp = document.createElement('input'); fromInp.type = 'date'; fromInp.value = st.from;
  fromInp.addEventListener('change', () => { st.from = fromInp.value; applyCatFilter(kind); });
  const toInp = document.createElement('input'); toInp.type = 'date'; toInp.value = st.to;
  toInp.addEventListener('change', () => { st.to = toInp.value; applyCatFilter(kind); });
  const typeSel = document.createElement('select');
  const allOpt = document.createElement('option'); allOpt.value = ''; allOpt.textContent = 'All types';
  typeSel.appendChild(allOpt);
  lkOptions('TIME_TYPE').forEach(o => {
    const opt = document.createElement('option'); opt.dataset.userContent = ''; opt.value = o.code; opt.textContent = lookupDisplayName(o);
    typeSel.appendChild(opt);
  });
  typeSel.value = st.type;
  typeSel.addEventListener('change', () => { st.type = typeSel.value; applyCatFilter(kind); });

  // Quick ranges: one click fills From/To. The matching chip lights up in
  // applyCatFilter, so a hand-typed range that equals a preset lights it too.
  const presets = document.createElement('div'); presets.className = 'cp-presets';
  presets.id = kind + '-presets';
  presets.setAttribute('role', 'group');
  presets.setAttribute('aria-label', 'Quick range');
  CP_PRESETS.forEach(p => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cp-preset'; b.dataset.preset = p.key;
    b.textContent = p.label;
    b.addEventListener('click', () => {
      const [from, to] = p.range();
      st.from = from; st.to = to;
      fromInp.value = from; toInp.value = to;
      applyCatFilter(kind);
    });
    presets.appendChild(b);
  });
  bar.appendChild(presets);

  bar.appendChild(mkField('From', fromInp));
  const dash = document.createElement('span'); dash.className = 'cp-range-dash'; dash.textContent = '–';
  bar.appendChild(dash);
  bar.appendChild(mkField('To', toInp));
  bar.appendChild(mkField('Type', typeSel));
  const clearBtn = document.createElement('button'); clearBtn.className = 'cp-filter-clear';
  clearBtn.id = kind + '-filter-clear';
  clearBtn.innerHTML = ic('x');
  clearBtn.title = 'Clear filters';
  bar.appendChild(clearBtn);
  host.appendChild(bar);

  // Toolbar row 2: search the sessions, and the Sessions | Tasks switch.
  const bar2 = document.createElement('div'); bar2.className = 'cp-filter-bar cp-filter-bar2';
  const searchWrap = document.createElement('label'); searchWrap.className = 'cp-rec-search';
  searchWrap.innerHTML = ic('search');
  const qInp = document.createElement('input'); qInp.type = 'search'; qInp.value = st.q;
  qInp.placeholder = 'Search sessions…';
  qInp.setAttribute('aria-label', 'Search sessions…');
  qInp.addEventListener('input', () => { st.q = qInp.value; applyCatFilter(kind); });
  searchWrap.appendChild(qInp);
  bar2.appendChild(searchWrap);
  const viewCtl = document.createElement('div'); viewCtl.className = 'seg-ctl cp-view-ctl';
  viewCtl.id = kind + '-view-ctl';
  viewCtl.setAttribute('role', 'group');
  viewCtl.setAttribute('aria-label', 'View');
  [['sessions', 'list', 'Sessions'], ['tasks', 'layers', 'Tasks']].forEach(([v, icon, label]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'seg-btn' + (cpView === v ? ' active' : ''); b.dataset.view = v;
    b.innerHTML = ic(icon); b.appendChild(document.createTextNode(label));
    b.setAttribute('aria-pressed', cpView === v ? 'true' : 'false');
    b.addEventListener('click', () => {
      cpView = v;
      viewCtl.querySelectorAll('.seg-btn').forEach(x => {
        x.classList.toggle('active', x.dataset.view === v);
        x.setAttribute('aria-pressed', x.dataset.view === v ? 'true' : 'false');
      });
      applyCatFilter(kind);
    });
    viewCtl.appendChild(b);
  });
  bar2.appendChild(viewCtl);
  host.appendChild(bar2);

  clearBtn.addEventListener('click', () => {
    st.from = ''; st.to = ''; st.type = ''; st.q = ''; st.sub = null;
    fromInp.value = ''; toInp.value = ''; typeSel.value = ''; qInp.value = '';
    applyCatFilter(kind);
  });

  // Narrowing chips: the second dimension, with counts.
  const chips = document.createElement('div'); chips.className = 'cp-sub-chips';
  chips.id = kind + '-chips';
  host.appendChild(chips);

  const wrap = document.createElement('div'); wrap.className = 'cp-table-wrap';
  const table = document.createElement('table'); table.id = kind + '-table';
  wrap.appendChild(table);
  host.appendChild(wrap);

  applyCatFilter(kind);
}

function applyCatFilter(kind) {
  const st = cpState[kind]; const vd = CP_VIEW_DEF[kind];
  let rows = st.entries.slice();
  if (st.from) rows = rows.filter(r => r.date >= st.from);
  if (st.to)   rows = rows.filter(r => r.date <= st.to);
  if (st.type) rows = rows.filter(r => r.time === st.type);
  const q = (st.q || '').trim().toLowerCase();
  if (q) {
    rows = rows.filter(r => [r.description, r.taskName, cpCo(r.company), cpSy(r.system), r.date]
      .some(v => String(v || '').toLowerCase().includes(q)));
  }
  renderCatChips(kind, rows);
  if (st.sub !== null) rows = rows.filter(r => (r[vd.chipField] || '') === st.sub);
  st.visible = rows;

  // Summary chips
  const totalMin = rows.reduce((s, r) => s + (parseFloat(r.minutes) || 0), 0);
  const summary = document.getElementById(kind + '-summary');
  summary.innerHTML = '';
  // One tile per figure: label, value, and an optional hint line.
  const tile = (lbl, val, hint, cls) => {
    const c = document.createElement('div'); c.className = 'cp-stat' + (cls ? ' ' + cls : '');
    const l = document.createElement('span'); l.className = 'cp-stat-lbl'; l.textContent = lbl;
    const v = document.createElement('span'); v.className = 'cp-stat-val'; v.textContent = val;
    c.appendChild(v); c.appendChild(l);
    if (hint) { const h = document.createElement('span'); h.className = 'cp-stat-hint'; h.textContent = hint; c.appendChild(h); }
    summary.appendChild(c);
    return c;
  };
  const hrs = min => cpT('{h} h', { h: (min / 60).toFixed(2) });
  const otMin = rows.filter(r => r.time === 'OVERTIME').reduce((s, r) => s + (parseFloat(r.minutes) || 0), 0);
  const days = new Set(rows.map(r => r.date).filter(Boolean));
  const taskCount = new Set(rows.map(r => r.taskId ?? 'e' + r.eid)).size;
  tile('Entries', String(rows.length), cpT('{n} tasks', { n: taskCount }));
  tile('Total Hours', hrs(totalMin));
  tile('Active Days', String(days.size));
  tile('Avg / Day', days.size ? hrs(totalMin / days.size) : hrs(0));
  if (otMin > 0) {
    const pct = totalMin ? Math.round(otMin / totalMin * 100) : 0;
    tile('Over-Time Hours', hrs(otMin), cpT(pct + '% of total'), 'cp-stat-warn');
  }

  // Subtitle: the date span the filtered rows cover.
  const sub = document.getElementById(kind + '-records-sub');
  if (sub) {
    const dates = [...days].sort();
    sub.textContent = !dates.length ? '' : dates.length === 1 ? dates[0]
      : dates[0] + ' → ' + dates[dates.length - 1];
  }

  // Light the preset chip that matches the current range; Clear shows only
  // when something is filtered.
  document.querySelectorAll('#' + kind + '-presets .cp-preset').forEach(b => {
    const p = CP_PRESETS.find(x => x.key === b.dataset.preset);
    const [from, to] = p.range();
    const on = from === st.from && to === st.to;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const clearBtn = document.getElementById(kind + '-filter-clear');
  if (clearBtn) clearBtn.hidden = !(st.from || st.to || st.type || q || st.sub !== null);

  renderCatTable(kind);
  renderCatDrawer(kind);
}

// Chips for the second dimension (System for a company, Company otherwise),
// counted over the rows the other filters leave; the busiest first.
function renderCatChips(kind, rows) {
  const st = cpState[kind]; const vd = CP_VIEW_DEF[kind];
  const host = document.getElementById(kind + '-chips');
  if (!host) return;
  const counts = new Map();
  rows.forEach(r => { const v = r[vd.chipField] || ''; counts.set(v, (counts.get(v) || 0) + 1); });
  if (st.sub !== null && !counts.has(st.sub)) counts.set(st.sub, 0);
  host.innerHTML = '';
  host.hidden = counts.size < 2 && st.sub === null;
  if (host.hidden) return;
  const lbl = document.createElement('span'); lbl.className = 'cp-sub-label';
  lbl.textContent = vd.chipLabel;
  host.appendChild(lbl);
  const mk = (value, text, n) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cp-sub-chip' + (st.sub === value ? ' active' : '');
    b.setAttribute('aria-pressed', st.sub === value ? 'true' : 'false');
    const nm = document.createElement('span'); nm.className = 'cp-sub-name'; nm.textContent = text;
    if (value !== null) nm.dataset.userContent = '';
    const ct = document.createElement('span'); ct.className = 'cp-sub-count'; ct.textContent = n;
    b.appendChild(nm); b.appendChild(ct);
    b.addEventListener('click', () => {
      st.sub = (value === null || st.sub === value) ? null : value;
      applyCatFilter(kind);
    });
    host.appendChild(b);
  };
  mk(null, 'All', rows.length);
  [...counts].sort((a, b) => b[1] - a[1]).forEach(([v, n]) => mk(v, v ? vd.chipShow(v) : '—', n));
}

function renderCatTable(kind) {
  const table = document.getElementById(kind + '-table');
  if (!table) return;
  table.className = 'cp-table cp-table-' + cpView;
  table.innerHTML = '';
  if (cpView === 'tasks') buildCatTaskTable(kind, table);
  else buildCatSessionTable(kind, table);
}

function cpEmptyRow(kind, colCount) {
  const st = cpState[kind];
  const tr = document.createElement('tr');
  const td = document.createElement('td'); td.colSpan = colCount; td.className = 'cp-records-empty';
  td.textContent = st.entries.length
    ? cpT('No records match the current filters')
    // The noun is itself a dictionary key, so translate it before it is
    // interpolated — otherwise the Arabic sentence ends in "company".
    : cpT('No records for this {noun}', { noun: cpT(CP_DEF[kind].noun) });
  tr.appendChild(td);
  return tr;
}
function cpTd(cls, child) {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  if (child != null) td.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  return td;
}
// "Main · sub" on one line, cut with "…"; the full text is the tooltip.
function cpCatLine(parts) {
  const [main, sub] = parts;
  const line = document.createElement('div'); line.className = 'cp-cat-line';
  const a = document.createElement('span'); a.dataset.userContent = ''; a.textContent = main || '—';
  line.appendChild(a);
  if (sub) {
    const b = document.createElement('span'); b.className = 'cp-cat-sub'; b.dataset.userContent = '';
    b.textContent = ' · ' + sub;
    line.appendChild(b);
  }
  line.title = [main, sub].filter(Boolean).join(' · ');
  return line;
}
function cpTimePill(r) {
  const s = document.createElement('span');
  s.className = 'cp-time-pill' + (r.time === 'OVERTIME' ? ' cp-time-ot' : '');
  s.textContent = lkLabel('TIME_TYPE', r.time);
  return s;
}
function cpStatusTd(status) {
  const badge = document.createElement('span'); badge.className = 'status-badge';
  badge.textContent = lkLabel('ENTRY_STATUS', status);
  return cpTd(statusClass(status), badge);
}
function cpHours(min) {
  const m = parseFloat(min);
  const s = document.createElement('span'); s.className = 'hours-val';
  s.textContent = isNaN(m) ? '—' : (m / 60).toFixed(2);
  if (!isNaN(m)) s.title = cpT('{n} min', { n: m });
  return s;
}
// A row that opens the session panel on click or Enter / Space.
function cpMakeOpenable(tr, run) {
  tr.tabIndex = 0;
  tr.addEventListener('click', run);
  tr.addEventListener('keydown', e => {
    if (e.target !== tr) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
  });
}

// ── Sessions view: one line per session, grouped by month ──
function buildCatSessionTable(kind, table) {
  const st = cpState[kind]; const vd = CP_VIEW_DEF[kind];
  const rows = st.visible;
  table.innerHTML = '<thead><tr>' +
    '<th class="cp-col-num">#</th>' +
    '<th class="cp-col-date">Date</th>' +
    '<th class="cp-col-cat">' + vd.head + '</th>' +
    '<th class="cp-col-time">Time</th>' +
    '<th class="cp-col-desc">Description</th>' +
    '<th class="cp-col-status">Status</th>' +
    '<th class="cp-col-num-r">Hours</th></tr></thead>';
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  const colCount = 7;
  if (!rows.length) { tbody.appendChild(cpEmptyRow(kind, colCount)); return; }
  // Month divider rows carry that month's entry count and hours; numbering
  // runs on across the groups.
  const monthTotals = new Map();
  rows.forEach(r => {
    const key = String(r.date || '').slice(0, 7);
    const t = monthTotals.get(key) || { n: 0, min: 0 };
    t.n++; t.min += parseFloat(r.minutes) || 0;
    monthTotals.set(key, t);
  });
  let lastMonth = null;
  rows.forEach((r, i) => {
    const key = String(r.date || '').slice(0, 7);
    if (key !== lastMonth) {
      lastMonth = key;
      tbody.appendChild(buildMonthRow(key, monthTotals.get(key), colCount));
    }
    tbody.appendChild(buildCatSessionRow(kind, r, i));
  });
}

function buildMonthRow(key, totals, colCount) {
  const tr = document.createElement('tr'); tr.className = 'cp-month-row';
  const td = document.createElement('td'); td.colSpan = colCount;
  const inner = document.createElement('div'); inner.className = 'cp-month-inner';
  const name = document.createElement('span'); name.className = 'cp-month-name';
  const [y, m] = key.split('-');
  // "June 2026" — i18n's month + year rule translates it as one string.
  name.textContent = CP_MONTHS[Number(m) - 1] ? CP_MONTHS[Number(m) - 1] + ' ' + y : (key || '—');
  const meta = document.createElement('span'); meta.className = 'cp-month-meta';
  meta.textContent = cpT('{n} entries', { n: totals.n }) + ' · ' + cpT('{h} h', { h: (totals.min / 60).toFixed(2) });
  inner.appendChild(name); inner.appendChild(meta);
  td.appendChild(inner); tr.appendChild(td);
  return tr;
}

function buildCatSessionRow(kind, r, i) {
  const st = cpState[kind]; const vd = CP_VIEW_DEF[kind];
  const tr = document.createElement('tr');
  tr.className = 'cp-row' + (r.eid === st.drawer ? ' cp-row-active' : '');
  tr.dataset.eid = r.eid;
  const num = document.createElement('span'); num.className = 'cell-num'; num.textContent = i + 1;
  tr.appendChild(cpTd('cp-cell-num', num));
  const date = document.createElement('span'); date.className = 'cp-date-cell'; date.textContent = r.date;
  tr.appendChild(cpTd('', date));
  tr.appendChild(cpTd('', cpCatLine(vd.parts(r))));
  tr.appendChild(cpTd('', cpTimePill(r)));
  const desc = document.createElement('div'); desc.className = 'cp-desc-line';
  desc.dataset.userContent = ''; desc.textContent = r.description; desc.title = r.description;
  tr.appendChild(cpTd('', desc));
  tr.appendChild(cpStatusTd(r.status));
  tr.appendChild(cpTd('cp-cell-hours', cpHours(r.minutes)));
  cpMakeOpenable(tr, () => openCatDrawer(kind, r.eid));
  return tr;
}

// ── Tasks view: one line per task, expandable to its sessions ──
function buildCatTaskTable(kind, table) {
  const st = cpState[kind]; const vd = CP_VIEW_DEF[kind];
  table.innerHTML = '<thead><tr>' +
    '<th class="cp-col-num">#</th>' +
    '<th class="cp-col-desc">Task</th>' +
    '<th class="cp-col-cat">' + vd.taskHead + '</th>' +
    '<th class="cp-col-count">Sessions</th>' +
    '<th class="cp-col-range">Dates</th>' +
    '<th class="cp-col-status">Status</th>' +
    '<th class="cp-col-num-r">Hours</th>' +
    '<th class="cp-col-act"><span class="sr-only">Actions</span></th></tr></thead>';
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  const colCount = 8;
  if (!st.visible.length) { tbody.appendChild(cpEmptyRow(kind, colCount)); return; }
  // Rows arrive oldest first, so insertion order is each task's first date.
  const groups = new Map();
  st.visible.forEach(r => {
    const key = r.taskId != null ? 't' + r.taskId : 'e' + r.eid;
    let g = groups.get(key);
    if (!g) { g = { key, first: r, last: r, rows: [], min: 0 }; groups.set(key, g); }
    g.rows.push(r); g.last = r; g.min += parseFloat(r.minutes) || 0;
  });
  [...groups.values()].forEach((g, i) => {
    const open = st.openTasks.has(g.key);
    const tr = document.createElement('tr');
    tr.className = 'cp-row cp-task-row' + (open ? ' open' : '');
    tr.setAttribute('aria-expanded', open ? 'true' : 'false');
    const num = document.createElement('span'); num.className = 'cell-num'; num.textContent = i + 1;
    tr.appendChild(cpTd('cp-cell-num', num));
    const name = document.createElement('div'); name.className = 'cp-task-name';
    const caret = document.createElement('span'); caret.className = 'cp-caret';
    caret.innerHTML = ic(open ? 'chevron-down' : 'chevron-right');
    const txt = document.createElement('span'); txt.className = 'cp-task-text'; txt.dataset.userContent = '';
    txt.textContent = g.first.taskName || g.first.description;
    name.title = txt.textContent;
    name.appendChild(caret); name.appendChild(txt);
    tr.appendChild(cpTd('', name));
    tr.appendChild(cpTd('', cpCatLine(vd.taskParts(g.first))));
    tr.appendChild(cpTd('cp-cell-count', String(g.rows.length)));
    const range = document.createElement('span'); range.className = 'cp-date-cell';
    range.textContent = g.first.date === g.last.date ? g.first.date : g.first.date + ' → ' + g.last.date;
    tr.appendChild(cpTd('', range));
    tr.appendChild(cpStatusTd(g.first.status));
    tr.appendChild(cpTd('cp-cell-hours', cpHours(g.min)));
    const actTd = cpTd('cp-cell-act');
    if (g.first.taskId) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'row-btn'; b.innerHTML = ic('eye');
      b.title = 'View task details';
      b.addEventListener('click', e => { e.stopPropagation(); openTaskDetail(g.first.taskId); });
      actTd.appendChild(b);
    }
    tr.appendChild(actTd);
    cpMakeOpenable(tr, () => {
      if (st.openTasks.has(g.key)) st.openTasks.delete(g.key); else st.openTasks.add(g.key);
      renderCatTable(kind);
    });
    tbody.appendChild(tr);
    if (!open) return;
    // Its sessions: date · time · description · hours, each opening the panel.
    g.rows.forEach(r => {
      const sr = document.createElement('tr');
      sr.className = 'cp-row cp-sub-row' + (r.eid === st.drawer ? ' cp-row-active' : '');
      sr.dataset.eid = r.eid;
      const td = document.createElement('td'); td.colSpan = colCount;
      const line = document.createElement('div'); line.className = 'cp-sub-line';
      const d = document.createElement('span'); d.className = 'cp-date-cell'; d.textContent = r.date;
      const desc = document.createElement('span'); desc.className = 'cp-desc-line';
      desc.dataset.userContent = ''; desc.textContent = r.description; desc.title = r.description;
      line.appendChild(d); line.appendChild(cpTimePill(r)); line.appendChild(desc); line.appendChild(cpHours(r.minutes));
      td.appendChild(line); sr.appendChild(td);
      cpMakeOpenable(sr, () => openCatDrawer(kind, r.eid));
      tbody.appendChild(sr);
    });
  });
}

// ── Session panel: the full session, its task, and what can be done with it ──
// It sits over the end of the records panel; ↑ / ↓ step through the listed
// sessions and Esc closes it.
function cpDrawerEl(kind) {
  let el = document.getElementById(kind + '-drawer');
  if (!el) {
    el = document.createElement('aside');
    el.id = kind + '-drawer'; el.className = 'cp-drawer'; el.hidden = true;
    el.setAttribute('aria-label', 'Session');
    document.getElementById('browse-body-' + kind).appendChild(el);
  }
  return el;
}
function cpMarkActive(kind) {
  const eid = cpState[kind].drawer;
  document.querySelectorAll('#' + kind + '-table tr[data-eid]').forEach(tr =>
    tr.classList.toggle('cp-row-active', eid != null && String(eid) === tr.dataset.eid));
}
function openCatDrawer(kind, eid) {
  cpState[kind].drawer = eid;
  cpMarkActive(kind);
  renderCatDrawer(kind);
}
function closeCatDrawer(kind) {
  cpState[kind].drawer = null;
  cpMarkActive(kind);
  renderCatDrawer(kind);
}
function stepCatDrawer(kind, delta) {
  const st = cpState[kind];
  const idx = st.visible.findIndex(r => r.eid === st.drawer);
  const next = st.visible[idx + delta];
  if (!next) return;
  openCatDrawer(kind, next.eid);
  document.querySelector('#' + kind + '-table tr[data-eid="' + next.eid + '"]')?.scrollIntoView({ block: 'nearest' });
}

function renderCatDrawer(kind) {
  const st = cpState[kind];
  const el = cpDrawerEl(kind);
  const host = document.getElementById(kind + '-records');
  const r = st.drawer != null ? st.visible.find(x => x.eid === st.drawer) : null;
  if (!r) {
    st.drawer = null; el.hidden = true; el.innerHTML = '';
    host?.classList.remove('cp-has-drawer');
    return;
  }
  el.hidden = false; el.innerHTML = '';
  host?.classList.add('cp-has-drawer');
  const mkBtn = (cls, icon, label, run, title) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.innerHTML = ic(icon);
    if (label) b.appendChild(document.createTextNode(label));
    b.title = title || label;
    b.addEventListener('click', run);
    return b;
  };

  const idx = st.visible.findIndex(x => x.eid === r.eid);
  const head = document.createElement('div'); head.className = 'cp-drawer-head';
  const ttl = document.createElement('div'); ttl.className = 'cp-drawer-title';
  const dt = document.createElement('span'); dt.className = 'cp-drawer-date'; dt.textContent = r.date;
  const pos = document.createElement('span'); pos.className = 'cp-drawer-pos';
  pos.textContent = (idx + 1) + ' / ' + st.visible.length;
  ttl.appendChild(dt); ttl.appendChild(pos);
  head.appendChild(ttl);
  const nav = document.createElement('div'); nav.className = 'cp-drawer-nav';
  const prev = mkBtn('row-btn', 'chevron-up', '', () => stepCatDrawer(kind, -1), 'Previous session');
  prev.disabled = idx <= 0;
  const next = mkBtn('row-btn', 'chevron-down', '', () => stepCatDrawer(kind, 1), 'Next session');
  next.disabled = idx >= st.visible.length - 1;
  nav.appendChild(prev); nav.appendChild(next);
  nav.appendChild(mkBtn('row-btn', 'x', '', () => closeCatDrawer(kind), 'Close'));
  head.appendChild(nav);
  el.appendChild(head);

  const desc = document.createElement('p'); desc.className = 'cp-drawer-desc';
  desc.dataset.userContent = ''; desc.textContent = r.description || '—';
  el.appendChild(desc);

  const meta = document.createElement('dl'); meta.className = 'cp-drawer-meta';
  const row = (label, node) => {
    const dtEl = document.createElement('dt'); dtEl.textContent = label;
    const dd = document.createElement('dd');
    dd.appendChild(typeof node === 'string' ? document.createTextNode(node) : node);
    meta.appendChild(dtEl); meta.appendChild(dd);
  };
  // A value that opens the Browse slice for it (not for the one already open).
  const slice = (toKind, value, text) => {
    if (!value) return document.createTextNode('—');
    if (toKind === kind) { const s = document.createElement('span'); s.dataset.userContent = ''; s.textContent = text; return s; }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cell-link'; b.dataset.userContent = ''; b.textContent = text;
    b.title = 'Browse all work for ' + text;
    b.addEventListener('click', () => openBrowseSlice(toKind, value));
    return b;
  };
  const m = parseFloat(r.minutes);
  row('Hours', isNaN(m) ? '—' : (m / 60).toFixed(2) + ' · ' + cpT('{n} min', { n: m }));
  row('Time', cpTimePill(r));
  row('Natural', slice('natures', r.natural, cpNat(r.natural)));
  const badge = document.createElement('span'); badge.className = 'status-badge ' + statusClass(r.status);
  badge.textContent = lkLabel('ENTRY_STATUS', r.status);
  row('Status', badge);
  row('Company', slice('companies', r.company, cpCo(r.company)));
  row('System', slice('systems', r.system, cpSy(r.system)));
  const src = buildSourceCell(r).firstChild;
  if (src && src.textContent.trim()) { src.className = 'cp-drawer-src'; row('Source', src); }
  el.appendChild(meta);

  if (r.taskName) {
    const task = document.createElement('div'); task.className = 'cp-drawer-task';
    const lbl = document.createElement('span'); lbl.className = 'cp-drawer-label'; lbl.textContent = 'Task';
    const nm = document.createElement('span'); nm.className = 'cp-drawer-task-name';
    nm.dataset.userContent = ''; nm.textContent = r.taskName;
    task.appendChild(lbl); task.appendChild(nm);
    el.appendChild(task);
  }

  const acts = document.createElement('div'); acts.className = 'cp-drawer-acts';
  if (r.eid) {
    acts.appendChild(mkBtn('btn primary', 'pencil', 'Edit session', () => openSessionModal(
      { id: r.eid, taskId: r.taskId, taskName: r.taskName, date: r.date, time: r.time,
        natural: r.natural, description: r.description, minutes: r.minutes },
      { onSaved: () => refreshCatQuiet(kind) })));
  }
  if (r.taskId) acts.appendChild(mkBtn('btn', 'eye', 'View task details', () => openTaskDetail(r.taskId)));
  acts.appendChild(mkBtn('btn', 'calendar', 'Open this day in the Timesheet',
    () => { switchModule('timesheet'); switchDay(r.date); }));
  el.appendChild(acts);
}

// ↑ / ↓ move through the sessions while the panel is open; Esc closes it.
// Ignored while typing in a field or when a modal is on top.
document.addEventListener('keydown', e => {
  if (activeModule !== 'browse') return;
  const st = cpState[browseKind];
  if (!st || st.drawer == null) return;
  if (document.querySelector('.modal-overlay.open')) return;
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'Escape') closeCatDrawer(browseKind);
  else if (e.key === 'ArrowDown') { e.preventDefault(); stepCatDrawer(browseKind, 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); stepCatDrawer(browseKind, -1); }
});

// Re-fetch the value list and the open slice without the skeleton or a
// rebuilt toolbar — used after a session is edited from Browse, so filters,
// focus, scroll position and the open panel stay put.
async function refreshCatQuiet(kind = browseKind) {
  const def = CP_DEF[kind]; const st = cpState[kind];
  let list, entries;
  try {
    [list, entries] = await Promise.all([
      window.api[def.listApi](),
      st.selected ? window.api[def.entriesApi](st.selected) : null,
    ]);
  } catch { return; }
  st.list = Array.isArray(list) ? list : [];
  if (kind === 'natures') st.list.sort((a, b) => b.count - a.count);
  renderCatList(kind);
  if (!st.selected) return;
  st.entries = Array.isArray(entries) ? entries : [];
  if (document.getElementById(kind + '-table')) applyCatFilter(kind);
  else renderCatRecords(kind);
}

// ── Subscriptions: data ──
async function loadSubscriptionsData() {
  if (!subsLoaded) {
    document.getElementById('sub-table').style.display = '';
    showTableSkeleton('sub-tbody', 5);
  }
  let data;
  try { data = await window.api.loadSubscriptions(); }
  catch { toast('Could not load subscriptions'); return; }
  subscriptions = (data && Array.isArray(data.subscriptions)) ? data.subscriptions : [];
  subPrefs.defaultCurrency = (data && data.defaultCurrency) ? data.defaultCurrency : 'USD';
  subsLoaded = true;
  renderSubscriptions();
}

async function saveSubscriptionsData() {
  try {
    await window.api.saveSubscriptions({
      subscriptions: subscriptions.map(s => Object.assign({}, s)),
      defaultCurrency: subPrefs.defaultCurrency,
    });
    return true;
  } catch { toast('Could not save subscriptions'); return false; }
}

function autoSaveSubscriptions() {
  clearTimeout(_subSaveTimer);
  _subSaveTimer = setTimeout(saveSubscriptionsData, 300);
}

// ── Module search filters ──
function applySubFilter() { subFilter = document.getElementById('sub-filter').value.toLowerCase().trim(); renderSubscriptions(); }

// ── Theme toggle ──
// Per-account (see loadUserPreferencesFromMain in core.js): localStorage
// remains a mirror so renderer/bootstrap.js can paint the right theme
// synchronously before login (when no account is known yet), but once a user
// is signed in their own DB-stored value is authoritative and overrides it.
// The standalone sidebar toggle is gone — light/dark is the Appearance choice
// inside View & Comfort — so "applying the theme" means syncing those two choice
// buttons' pressed state, exactly like every other workspace choice.
function applyThemeLabel() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const active = 'theme:' + (dark ? 'dark' : 'light');
  document.querySelectorAll('[data-workspace-choice^="theme:"]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.workspaceChoice === active));
  });
}
function applyLoadedTheme(theme) {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('ct-theme', theme === 'dark' ? 'dark' : 'light'); } catch (e) {}
  applyThemeLabel();
}
function setWorkspaceTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  applyLoadedTheme(theme);
  saveUserPreference('theme', theme);
}
// Still the command palette's entry point (one keystroke, no picker), and the
// only caller that needs the current value flipped rather than named.
function toggleTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  setWorkspaceTheme(dark ? 'light' : 'dark');
}

// ── Calm Workspace preferences ──
// Per-account, same convention as theme above. Focus Mode is not persisted at
// all (neither per-account nor per-machine), so navigation is always present
// again after a fresh launch.
const WORKSPACE_VIEW_DEFAULTS = Object.freeze({ density: 'balanced', canvas: 'calm', motion: 'reduced', scale: '100' });
let workspaceViewPrefs = Object.assign({}, WORKSPACE_VIEW_DEFAULTS);
function loadWorkspaceViewPrefs() {
  try {
    const stored = JSON.parse(localStorage.getItem('ct-workspace-view') || '{}');
    if (['compact','balanced','spacious'].includes(stored.density)) workspaceViewPrefs.density = stored.density;
    if (['calm','structured'].includes(stored.canvas)) workspaceViewPrefs.canvas = stored.canvas;
    if (['gentle','reduced'].includes(stored.motion)) workspaceViewPrefs.motion = stored.motion;
    if (['80','90','100','110'].includes(stored.scale)) workspaceViewPrefs.scale = stored.scale;
  } catch (e) {
    workspaceViewPrefs = Object.assign({}, WORKSPACE_VIEW_DEFAULTS);
  }
}
function applyWorkspaceViewPreferences() {
  document.body.dataset.density = workspaceViewPrefs.density;
  document.body.classList.toggle('workspace-calm', workspaceViewPrefs.canvas === 'calm');
  document.body.classList.toggle('workspace-structured', workspaceViewPrefs.canvas === 'structured');
  document.body.classList.toggle('workspace-reduced-motion', workspaceViewPrefs.motion === 'reduced');
  applyUiScale(workspaceViewPrefs.scale);
  document.querySelectorAll('[data-workspace-choice]:not([data-workspace-choice^="theme:"])').forEach(btn => {
    const [key, value] = btn.dataset.workspaceChoice.split(':');
    btn.setAttribute('aria-pressed', String(workspaceViewPrefs[key] === value));
  });
  applyThemeLabel();
}
function setWorkspaceView(key, value) {
  const allowed = {
    density: ['compact','balanced','spacious'],
    canvas: ['calm','structured'],
    motion: ['gentle','reduced'],
    scale: ['80','90','100','110'],
  };
  if (!allowed[key]?.includes(value)) return;
  workspaceViewPrefs[key] = value;
  try { localStorage.setItem('ct-workspace-view', JSON.stringify(workspaceViewPrefs)); } catch (e) {}
  applyWorkspaceViewPreferences();
  saveUserPreference(key, value);
}
function resetWorkspaceView() {
  workspaceViewPrefs = Object.assign({}, WORKSPACE_VIEW_DEFAULTS);
  try { localStorage.removeItem('ct-workspace-view'); } catch (e) {}
  applyWorkspaceViewPreferences();
  Object.entries(WORKSPACE_VIEW_DEFAULTS).forEach(([key, value]) => saveUserPreference(key, value));
}
function openWorkspaceView() {
  applyWorkspaceViewPreferences();
  document.getElementById('workspace-view-overlay').classList.add('open');
}
function closeWorkspaceView() {
  document.getElementById('workspace-view-overlay').classList.remove('open');
}
function workspaceViewOverlayClick(e) {
  if (e.target === document.getElementById('workspace-view-overlay')) closeWorkspaceView();
}
function toggleFocusMode(force) {
  const enter = typeof force === 'boolean' ? force : !document.body.classList.contains('focus-mode');
  document.body.classList.toggle('focus-mode', enter);
  const btn = document.getElementById('workspace-focus-toggle');
  if (btn) btn.textContent = enter ? 'Exit Focus' : 'Enter Focus';
  if (enter) closeWorkspaceView();
}

// ── Workspace rail ──
// Per-account, same convention as theme above: localStorage is only the
// pre-login guess; forceCompact (passed by loadUserPreferencesFromMain once
// the account is known) overrides it with that account's own DB-stored value.
function applySidebarPreference(forceCompact) {
  let compact = false;
  if (typeof forceCompact === 'boolean') {
    compact = forceCompact;
    try { localStorage.setItem('ct-sidebar-compact', compact ? '1' : '0'); } catch (e) {}
  } else {
    try { compact = localStorage.getItem('ct-sidebar-compact') === '1'; } catch (e) {}
  }
  document.body.classList.toggle('sidebar-collapsed', compact);
  const btn = document.getElementById('sidebar-collapse');
  if (btn) {
    btn.setAttribute('aria-pressed', String(compact));
    btn.title = compact ? 'Expand navigation' : 'Collapse navigation';
  }
}
function toggleSidebar() {
  const compact = !document.body.classList.contains('sidebar-collapsed');
  applySidebarPreference(compact);
  saveUserPreference('sidebar', compact ? 'compact' : 'expanded');
}

// ── Home overview (merged into the Analytics view) ──
function greetWord() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// A seeded TIME_TYPE label when the lookup exists, otherwise the English
// fallback (which i18n localizes) — never the raw SCREAMING_CASE code, which
// lkLabel returns verbatim when the catalog row is missing.
function timeTypeLabel(code, fallback) {
  const label = lkLabel('TIME_TYPE', code);
  return label && label !== code ? label : fallback;
}

// The Overview hero's clock and dates — the login screen's brand side
// (authToday in shell.js), in the session language with Western digits.
// Ticks on the minute but only repaints while Overview is on screen.
function renderDashToday() {
  const timeEl = document.getElementById('dash-time');
  if (!timeEl) return;
  const lang = window.ctI18n?.getLanguage?.() === 'ar' ? 'ar' : 'en-GB';
  const f = (cal, opts) => new Intl.DateTimeFormat(lang + '-u-ca-' + cal + '-nu-latn', opts);
  const now = new Date();
  const parts = f('gregory', { hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(now);
  const period = parts.find(p => p.type === 'dayPeriod');
  timeEl.textContent = parts.filter(p => p.type !== 'dayPeriod').map(p => p.value).join('').trim();
  document.getElementById('dash-period').textContent = period ? period.value : '';
  document.getElementById('dash-clock').dateTime = now.toISOString();
  document.getElementById('dash-date').textContent =
    f('gregory', { weekday: 'long' }).format(now) + ' · ' + f('gregory', { day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  document.getElementById('dash-hijri').textContent = f('islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(now);
}
(function dashTodayTick() {
  const mod = document.getElementById('module-analytics');
  if (mod && mod.offsetParent !== null) renderDashToday();
  setTimeout(dashTodayTick, 60000 - (Date.now() % 60000) + 50);
})();
document.addEventListener('ct:languagechange', renderDashToday);

async function renderOverview() {
  const isAr = window.ctI18n?.getLanguage?.() === 'ar';
  const displayName = isAr
    ? (_currentUser?.nameAr || _currentUser?.nameEn || _currentUser?.username)
    : (_currentUser?.nameEn || _currentUser?.username);
  const name = (displayName || '').split(' ')[0] || (_currentUser?.username || '');
  document.getElementById('dash-hello').textContent = `${greetWord()}, ${name}`;
  renderDashToday();
  // Today + month-to-date hours — aggregated in SQL (no day blobs shipped).
  if (!document.getElementById('dash-stats').childElementCount) showSkeleton('dash-stats', 'cards', 1);
  const now = new Date();
  const today = fmt(now);
  const monthStart = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
  const ov = await window.api.loadOverviewStats(today, monthStart);
  const todayMin = ov.todayMin, todayRecs = ov.todayRecs;

  // Cross-module attention data — one aggregated read (attention:list) across
  // subscription renewals, Company Document renewals, and the two client_*
  // tables with an expiry_date and a UI (Auth/VPN, Internal Systems), instead
  // of each source re-deriving its own urgency separately.
  const ATTENTION_META = {
    subscription:     { icon: ic('credit-card'),    kind: 'Renews' },
    companyDocument:  { icon: ic('calendar-check'), kind: 'Renews' },
    clientVpn:        { icon: ic('layers'),          kind: 'Auth expires' },
    clientInternal:   { icon: ic('layers'),          kind: 'Internal System expires' },
    // Project & Finance — already filtered by db.js (follow-up after 7 days on
    // Sent; validity 3 days before it ends), so the 30-day window below never trims them.
    pfmFollowUp:      { icon: ic('briefcase'),       kind: 'Sent, no answer — follow up' },
    pfmExpiry:        { icon: ic('briefcase'),       kind: 'Validity ends' },
  };
  let rawAttention = [];
  try { rawAttention = await window.api.getAttentionItems(); } catch { rawAttention = []; }
  if (!Array.isArray(rawAttention)) rawAttention = [];

  const attention = [];
  rawAttention.forEach(a => {
    const d = daysUntil(a.date);
    if (d === null || d > 30 || isPageHidden(a.module)) return;
    const meta = ATTENTION_META[a.type] || { icon: ic('bell'), kind: 'Due' };
    attention.push({ icon: meta.icon, title: a.title, days: d, module: a.module, kind: meta.kind, companyId: a.companyId ?? null, clientId: a.clientId ?? null, id: a.id, type: a.type });
  });
  attention.sort((a, b) => a.days - b.days);

  // Hero chips: only what is true right now, whatever period is selected
  // below. This month is not repeated here — the Time Tracking tiles show it.
  const urgentCount = attention.filter(a => a.days <= 7).length;
  const chips = isPageHidden('timesheet') ? [] : [
    { icon: 'clock', value: (todayMin / 60).toFixed(1), unit: hourUnitWord(todayMin / 60), label: 'Today',
      foot: `${todayRecs} record${todayRecs === 1 ? '' : 's'}`, cls: 'accent', run: "switchModule('timesheet')" },
  ];
  // Outsource (Phase 6): what this login still owes external resources —
  // unbilled hours at their rates plus issued, unpaid statements. Only shown
  // once something is owed; a second currency goes in the foot.
  let owed = null;
  if (!isPageHidden('outsource')) {
    try { owed = await window.api.getOutsUnpaidSummary(); } catch { owed = null; }
  }
  const owedTotals = (owed?.totals || []).filter(t => t.unpaidMinor > 0);
  if (owedTotals.length) {
    const money = t => anMoney(t.unpaidMinor) + ' ' + (CURRENCY_SYMBOLS[t.currency] || t.currency || '');
    chips.push({
      icon: 'users', value: anMoney(owedTotals[0].unpaidMinor),
      unit: esc(CURRENCY_SYMBOLS[owedTotals[0].currency] || owedTotals[0].currency || ''), label: 'Owed to Outsource',
      foot: owedTotals.length > 1 ? owedTotals.slice(1).map(money).join(' · ') : 'Unbilled hours + issued statements',
      cls: 'outs-owed', run: "switchModule('outsource')",
    });
  }
  if (attention.length) {
    chips.push({
      icon: 'bell', value: String(attention.length), unit: '', label: 'Needs Attention',
      foot: urgentCount ? `${urgentCount} within 7 days` : 'Next 30 days',
      cls: urgentCount ? 'warn' : 'attn', run: 'focusDashAttention()',
    });
  }
  document.getElementById('dash-stats').innerHTML = chips.map(c => `
    <button type="button" class="dash-chip ${c.cls}" data-onclick="${c.run}">
      <span class="dash-chip-icon">${ic(c.icon)}</span>
      <span class="dash-chip-text">
        <span class="dash-chip-value">${esc(c.value)}${c.unit ? `<small> ${c.unit}</small>` : ''}</span>
        <span class="dash-chip-label">${c.label}</span>
      </span>
      <span class="dash-chip-foot">${esc(c.foot)}</span>
    </button>`).join('');

  // Attention list
  document.getElementById('dash-attention-sub').textContent = attention.length ? `${attention.length} item${attention.length === 1 ? '' : 's'}` : '';
  const attEl = document.getElementById('dash-attention');
  if (!attention.length) {
    attEl.innerHTML = `<div class="dash-empty dash-empty-ok"><span class="de-icon">${ic('circle-check')}</span>All clear — nothing due in the next 30 days.</div>`;
  } else {
    attEl.innerHTML = attention.slice(0, 8).map((a, i) => {
      const cls = renewClass(a.days);
      return `
        <div class="dash-att-item" data-att-idx="${i}">
          <span class="dash-att-icon">${a.icon}</span>
          <div class="dash-att-body">
            <div class="dash-att-title">${esc(a.title)}</div>
            <div class="dash-att-meta">${a.kind} · ${esc(a.module)}</div>
          </div>
          <span class="renew-badge ${cls}">${renewLabel(a.days)}</span>
        </div>`;
    }).join('');
    // Deep-link via addEventListener (not inline onclick) so a title containing
    // a quote character can never break out of an attribute string.
    attEl.querySelectorAll('.dash-att-item').forEach(el => {
      const a = attention[Number(el.dataset.attIdx)];
      el.addEventListener('click', () => {
        switchModule(a.module);
        if (a.module === 'pfm') openPfmDetail(a.id);
        else if (a.companyId != null) openClientDetail(a.companyId, a.title);
        else if (a.type === 'subscription') scrollToAndHighlight('[data-sub-id="' + a.id + '"]');
        else if (a.type === 'companyDocument') scrollToAndHighlight('[data-doc-id="' + a.id + '"]');
      });
    });
  }

  // Sidebar attention badge (urgent count, ≤7 days or overdue) — one per
  // source module, all fed by the same aggregated attention list.
  const urgent = m => attention.filter(a => a.module === m && a.days <= 7).length;
  setNavBadge('subscriptions', urgent('subscriptions'));
  setNavBadge('companydocs', urgent('companydocs'));
  setNavBadge('clients', urgent('clients'));
  setNavBadge('pfm', urgent('pfm'));

}

// The hero's attention chip: scroll down to the renewals card and flash it.
function focusDashAttention() {
  const card = document.getElementById('dash-attention-card');
  if (!card) return;
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  card.classList.remove('an-flash');
  void card.offsetWidth;   // restart the animation on a repeat click
  card.classList.add('an-flash');
}

function setNavBadge(module, count) {
  const el = document.getElementById('nav-badge-' + module);
  if (!el) return;
  if (count > 0) { el.textContent = count; el.classList.add('show'); }
  else { el.textContent = ''; el.classList.remove('show'); }
}

// ════════════════════════════════════════════════════════════════════════════
// ANALYTICS MODULE — read-only insights derived from existing data (one query).
// ════════════════════════════════════════════════════════════════════════════
// Keyed by TIME_TYPE lookup code (+ 'OTHER' for unset). Colors come from the
// --chart-1…--chart-6 design tokens (app.css), not one-off hex literals.
const AN_TYPE_COLORS = {
  'WORK_TIME': 'var(--chart-1)', 'OVERTIME': 'var(--chart-2)', 'TRAINING': 'var(--chart-3)',
  'LEAVE': 'var(--chart-4)', 'HOLIDAY': 'var(--chart-5)', 'OTHER': 'var(--chart-6)',
};
const AN_FALLBACK = ['#a855f7', '#84cc16', '#14b8a6', '#f97316', '#0ea5e9', '#d946ef'];
let _anTrendSeq = 0;   // monotonic id source for per-trend SVG gradients

function anFmtHrs(mins) {
  if (!mins) return '0 hours';
  if (mins < 60) return mins + 'm';
  const disp = (mins / 60).toFixed(1);
  return disp + ' ' + (disp === '1.0' ? 'hour' : 'hours');
}

// Thousands-grouped money display for the Over-Time Income KPI (e.g. 1,000.00) —
// scoped to Analytics rather than core.js's minorToStr, which the salary field
// renders without a separator.
function anMoney(minor) {
  return (Number(minor || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setAnPeriod(p) {
  anPeriod = p;
  document.querySelectorAll('#an-period .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.period === p));
  const range = document.getElementById('an-range');
  range.classList.toggle('show', p === 'custom');
  if (p === 'custom' && !document.getElementById('an-from').value) {
    const now = fmt(new Date()).slice(0, 7); // YYYY-MM
    document.getElementById('an-from').value = now;
    document.getElementById('an-to').value   = now;
  }
  renderAnalytics();
}

// The custom range's month pickers: the native input sits invisibly over a
// label written in the app's language, and a click opens its picker.
function openAnMonth(id) {
  try { document.getElementById(id).showPicker(); } catch { /* picker already open or unsupported */ }
}
// Move the whole custom range one month back or forward.
function stepAnRange(dir) {
  const shift = id => {
    const el = document.getElementById(id);
    const [y, m] = (el.value || fmt(new Date()).slice(0, 7)).split('-').map(Number);
    el.value = fmt(new Date(y, m - 1 + dir, 1)).slice(0, 7);
  };
  shift('an-from'); shift('an-to');
  renderAnalytics();
}
function updateAnMonthText(fromM, toM) {
  const locale = window.ctI18n?.getLanguage?.() === 'ar' ? 'ar-u-nu-latn' : 'en-US';
  const text = v => { const [y, m] = v.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' }); };
  document.getElementById('an-from-text').textContent = text(fromM);
  document.getElementById('an-to-text').textContent = text(toM);
}

// Resolve the active period to a {from, to, label} window of YYYY-MM-DD strings.
function anRange() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const to = fmt(today);
  if (anPeriod === 'custom') {
    const curM = to.slice(0, 7); // YYYY-MM
    let fromM = document.getElementById('an-from').value || curM;
    let toM   = document.getElementById('an-to').value   || fromM;
    if (fromM > toM) { const x = fromM; fromM = toM; toM = x; }
    updateAnMonthText(fromM, toM);
    const [fy, fmo] = fromM.split('-').map(Number);
    const [ty, tmo] = toM.split('-').map(Number);
    const from = fmt(new Date(fy, fmo - 1, 1));   // first day of from-month
    const t    = fmt(new Date(ty, tmo, 0));        // last day of to-month
    const monthLabel = (y, m) => new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const label = fromM === toM ? monthLabel(fy, fmo) : `${monthLabel(fy, fmo)} → ${monthLabel(ty, tmo)}`;
    return { from, to: t, label };
  }
  if (anPeriod === 'week') {
    const s = new Date(today); s.setDate(today.getDate() - today.getDay()); // back to Sunday
    return { from: fmt(s), to, label: 'This week' };
  }
  if (anPeriod === 'month') {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: fmt(s), to, label: today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }
  if (anPeriod === 'year') {
    const s = new Date(today.getFullYear(), 0, 1);
    return { from: fmt(s), to, label: String(today.getFullYear()) };
  }
  // fallback: this month
  const s = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: fmt(s), to, label: today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
}

async function renderAnalytics() {
  // The Analytics view is also the home overview — populate the merged
  // greeting / "now" stat cards / Needs-Attention list.
  renderOverview();

  const { from, to, label } = anRange();
  // Surface the active period next to the Time Tracking section header so it's
  // clear which window the KPIs/charts below cover (the stat cards above are "now").
  document.getElementById('an-period-tag').textContent = label;

  // The heatmap shows a fixed window independent of the selected period: the full
  // calendar year (Jan → Dec). Future days render as faded "empty" cells.
  const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
  const yearStart = new Date(todayD.getFullYear(), 0, 1);
  const yearEnd = new Date(todayD.getFullYear(), 11, 31);
  // Year strip starts on the Sunday on/before Jan 1 so weeks align to columns,
  // and runs through the week containing Dec 31 so all 12 months are shown.
  const yearFirstSunday = new Date(yearStart); yearFirstSunday.setDate(yearStart.getDate() - yearStart.getDay());
  const yearLastSunday = new Date(yearEnd); yearLastSunday.setDate(yearEnd.getDate() - yearEnd.getDay());
  const yearWeeks = Math.round((yearLastSunday - yearFirstSunday) / (7 * 864e5)) + 1;
  const heatFrom = fmt(yearFirstSunday);

  // One aggregation call spanning both the period (KPIs/bars/donuts) and the
  // heatmap/trend window (per-day series). All group-bys + sums run in SQL — the
  // renderer receives only small maps + scalars, never the raw rows.
  // First paint: shimmer placeholders in the KPI/chart slots while SQL runs.
  if (!document.getElementById('an-kpis').childElementCount) {
    showSkeleton('an-kpis', 'cards', 5);
    showSkeleton('an-company', 'text', 5);
    showSkeleton('an-system', 'text', 5);
    showSkeleton('an-trend', 'text', 4);
  }
  const fetchFrom = heatFrom < from ? heatFrom : from;
  const fetchTo   = to > fmt(todayD) ? to : fmt(todayD);
  const fromDate = new Date(from + 'T00:00:00');
  const toDate = new Date(to + 'T00:00:00');
  const spanDays = Math.max(1, Math.round((toDate - fromDate) / 864e5) + 1);
  const previousToDate = new Date(fromDate); previousToDate.setDate(previousToDate.getDate() - 1);
  const previousFromDate = new Date(previousToDate); previousFromDate.setDate(previousFromDate.getDate() - spanDays + 1);
  const previousFrom = fmt(previousFromDate), previousTo = fmt(previousToDate);
  const [an, previous] = await Promise.all([
    window.api.loadAnalytics(from, to, fetchFrom, fetchTo),
    window.api.loadAnalytics(previousFrom, previousTo, previousFrom, previousTo),
  ]);

  const dayMin = an.dayMin, dayOtMin = an.dayOtMin;
  const byCompany = an.byCompany, bySystem = an.bySystem, byType = an.byType, byNatural = an.byNatural;
  const byDepartment = an.byDepartment || {};
  const totalMin = an.totalMin, recordCount = an.recordCount, activeDays = an.activeDays;

  const workMin = byType['WORK_TIME'] || 0;
  const otMin   = byType['OVERTIME'] || 0;
  const pct = (m) => totalMin ? Math.round((m / totalMin) * 100) : 0;
  const previousTotal = Number(previous?.totalMin || 0);
  const periodDelta = previousTotal
    ? Math.round(((totalMin - previousTotal) / previousTotal) * 100)
    : null;

  // ── KPIs ──
  // Client vs Internal — the one combined total
  // above, then this card breaks out how much of it was internal work. Only
  // shown once there's actually some internal time in the period, so a user
  // who never logs internal work doesn't see a permanent "0h" card.
  const internalMin = Number(an.internalMin || 0);
  const kpis = [
    { label: 'Total Hours', icon: 'clock', hue: 'total', val: (totalMin / 60).toFixed(1), unit: hourUnitWord(totalMin / 60), foot: `${recordCount} record${recordCount === 1 ? '' : 's'}`, delta: periodDelta },
    { label: timeTypeLabel('WORK_TIME', 'Work Time'), icon: 'briefcase', hue: 'work', val: (workMin / 60).toFixed(1),  unit: hourUnitWord(workMin / 60), foot: `${pct(workMin)}% of total`, share: pct(workMin) },
    { label: timeTypeLabel('OVERTIME', 'Over Time'), icon: 'moon', hue: 'ot', val: (otMin / 60).toFixed(1),    unit: hourUnitWord(otMin / 60), foot: `${pct(otMin)}% of total`, share: pct(otMin) },
    { label: 'Avg / Day', icon: 'activity', hue: 'avg', val: activeDays ? (totalMin / 60 / activeDays).toFixed(1) : '0', unit: hourUnitWord(activeDays ? totalMin / 60 / activeDays : 0), foot: `${activeDays} active day${activeDays === 1 ? '' : 's'}` },
    // Only shown once a salary + Over-Time hours are both present for the period —
    // an otHourlyMinor of 0 means the user has no salary configured yet (db.js's
    // getAnalytics), so there's nothing meaningful to show.
    ...(otMin > 0 && an.otHourlyMinor > 0 ? [{
      label: 'Over-Time Income', icon: 'credit-card', hue: 'income', val: anMoney(an.otIncomeMinor), unit: (CURRENCY_SYMBOLS[an.currencyCode] || an.currencyCode) || '',
      foot: `${hoursPhrase(Math.round(otMin / 60 * 10) / 10)} × ${anMoney(an.otHourlyMinor)}${an.currencyCode ? ' ' + (CURRENCY_SYMBOLS[an.currencyCode] || an.currencyCode) : ''}/${window.ctI18n?.getLanguage?.() === 'ar' ? 'ساعة' : 'hour'}`,
    }] : []),
    ...(internalMin > 0 ? [{ label: 'Internal Work', icon: 'building', hue: 'internal', val: (internalMin / 60).toFixed(1), unit: hourUnitWord(internalMin / 60), foot: `${pct(internalMin)}% of total`, share: pct(internalMin) }] : []),
  ];
  // One even row of tiles; flex lets a wrapped row stretch rather than leave a
  // hole. Total carries the change against the previous period of the same
  // length as a ▲/▼ badge; a share of the total gets a thin bar in the tile's hue.
  const deltaBadge = d => d == null ? ''
    : `<span class="an-delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}" title="Compared with the previous period">${d > 0 ? '▲' : d < 0 ? '▼' : '•'} ${Math.abs(d)}%</span>`;
  document.getElementById('an-kpis').innerHTML = kpis.map(k => `
    <div class="an-tile an-tile-${k.hue}">
      <span class="an-tile-icon">${ic(k.icon)}</span>
      <span class="an-tile-text">
        <span class="an-tile-top">
          <span class="an-tile-val">${esc(k.val)}<small>${k.unit && k.unit !== '%' ? ' ' : ''}${k.unit}</small></span>
          ${deltaBadge(k.delta)}
        </span>
        <span class="an-tile-label">${esc(k.label)}</span>
        <span class="an-tile-foot" title="${esc(k.foot)}">${k.foot}</span>
        ${k.share != null ? `<span class="an-tile-bar"><span style="width:${Math.min(100, k.share)}%"></span></span>` : ''}
      </span>
    </div>`).join('');

  // ── Bar charts: company + system (each bar cross-links into Browse) ──
  renderAnBars('an-company', byCompany, 'an-company-sub', 'companies');
  renderAnBars('an-system', bySystem, 'an-system-sub', 'systems');

  // Department cross-links into All Tasks, since Browse has no equivalent slice.
  renderAnBars('an-department', byDepartment, 'an-department-sub', 'department');

  // ── Daily hours: total as the area, over time as a second line ──
  // Follows the selected period. Drawn at the card's real width (see
  // drawAnTrend), so its text is never stretched.
  const hasOt = Object.keys(dayOtMin).some(d => d >= from && d <= to && dayOtMin[d] > 0);
  _anTrendArgs = { from, to, dayMin, dayOtMin: hasOt ? dayOtMin : null };
  drawAnTrend();
  document.getElementById('an-trend-sub').textContent = label;
  document.getElementById('an-trend-legend').innerHTML =
    '<span class="an-leg an-leg-total">Total</span>' + (hasOt ? '<span class="an-leg an-leg-ot">Over Time</span>' : '');

  // ── Time breakdown donut (by time type) ──
  const typeSegs = Object.entries(byType)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v], i) => ({ label: k === 'OTHER' ? 'Other' : lkLabel('TIME_TYPE', k), value: v, color: AN_TYPE_COLORS[k] || AN_FALLBACK[i % AN_FALLBACK.length] }));
  document.getElementById('an-type').innerHTML = anDonut(typeSegs);
  document.getElementById('an-type-sub').textContent = typeSegs.length ? `${typeSegs.length} types` : '';

  // ── Activity donut (by natural: Ticket / Task / Meeting / Call) ──
  const natSegs = Object.entries(byNatural)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v], i) => ({ label: lkLabel('ACTIVITY_TYPE', k), value: v, color: AN_FALLBACK[i % AN_FALLBACK.length] }));
  document.getElementById('an-activity').innerHTML = anDonut(natSegs);
  document.getElementById('an-activity-sub').textContent = natSegs.length ? `${natSegs.length} types` : '';

  // ── Heatmap: This Year ──
  // GitHub-style week-column strip spanning the full calendar year (Jan→Dec),
  // stretched full-width so every month is visible without scrolling.
  document.getElementById('an-heat').innerHTML = anHeatmap(yearFirstSunday, yearWeeks, dayMin, todayD);
  document.getElementById('an-heat-sub').textContent = `Jan – Dec ${todayD.getFullYear()}`;

  // ── Recurring spend (subscriptions) ──
  renderAnSpend();
}

// Render a top-N horizontal bar chart of {key: minutes} into `elId`. With a
// `linkKind` ('companies' | 'systems' → cross-links into that Browse slice;
// 'department' → Milestone 4 click-through into the All Tasks page — see
// anBarRow's onclick mapping). A falsy linkKind (e.g. project category,
// which has no page to click into anymore) renders plain, non-clickable bars.
function renderAnBars(elId, map, subId, linkKind) {
  const items = Object.entries(map).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const visibleLabel = key => linkKind === 'companies' ? companyDisplayName(key)
    : linkKind === 'systems' ? lkLabel('SYSTEM', key)
    : linkKind === 'department' ? lkLabel('DEPARTMENT', key)
    : key;
  const el = document.getElementById(elId);
  if (subId) document.getElementById(subId).textContent = items.length ? `${items.length}` : '';
  if (!items.length) { el.innerHTML = `<div class="an-empty">No tracked time in this period.</div>`; return; }
  const top = items.slice(0, 8);
  const max = top[0][1];
  const total = items.reduce((sum, [, v]) => sum + v, 0);
  // Every value in hours with one decimal, so a short entry reads "0.3 hours"
  // in line with the rest instead of switching to minutes.
  const hrs = v => (v / 60).toFixed(1) + ' ' + hourUnitWord(Math.round(v / 6) / 10);
  const rows = items.map(([k, v]) => `<tr><td>${esc(visibleLabel(k))}</td><td>${esc(hrs(v))}</td></tr>`).join('');
  el.innerHTML = `<div class="an-bars">${top.map(([k, v]) => anBarRow(k, v, max, hrs(v), Math.round((v / total) * 100), linkKind, visibleLabel(k))).join('')}</div>
    <details class="an-data-details"><summary>View data table</summary>
      <table class="an-data-table"><thead><tr><th>Category</th><th>Hours</th></tr></thead><tbody>${rows}</tbody></table>
    </details>`;
}

const AN_BAR_LINK_ATTRS = {
  companies:      (label, visible) => ` data-kind="companies" data-name="${esc(label)}" title="Browse all work for ${esc(visible)}" data-onclick="openBrowseSlice(this.dataset.kind, this.dataset.name)"`,
  systems:        (label, visible) => ` data-kind="systems" data-name="${esc(label)}" title="Browse all work for ${esc(visible)}" data-onclick="openBrowseSlice(this.dataset.kind, this.dataset.name)"`,
  department:     (label, visible) => ` data-name="${esc(label)}" title="Open Internal Work filtered to ${esc(visible)}" data-onclick="openAllTasksForDepartment(this.dataset.name)"`,
};
// One bar: the label, the bar (scaled to the largest), the hours and that
// row's share of the card's total.
function anBarRow(label, value, max, display, share, linkKind, visibleLabel = label) {
  const style = `width:${Math.max(2, Math.round((value / max) * 100))}%`;
  const linkFn = linkKind && AN_BAR_LINK_ATTRS[linkKind];
  const linkAttrs = linkFn ? linkFn(label, visibleLabel) : '';
  const tag = linkFn ? 'button' : 'div';
  const type = linkFn ? ' type="button"' : '';
  return `
    <${tag}${type} class="an-bar-row${linkFn ? ' clickable' : ''}"${linkAttrs}>
      <span class="an-bar-label" title="${esc(visibleLabel)}">${esc(visibleLabel)}</span>
      <span class="an-bar-track"><span class="an-bar-fill" style="${style}"></span></span>
      <span class="an-bar-val">${esc(display)}</span>
      <span class="an-bar-pct">${share}%</span>
    </${tag}>`;
}

// Analytics' "Hours by Department" bar, which has no Browse-slice equivalent
// Browse only slices by company/system. Since the domain separation,
// internal work is its own page — this resolves the label to a lookup id and
// routes into Internal Work's All Internal view, preset-filtered to it.
function openAllTasksForDepartment(label) {
  const dept = lkFind('DEPARTMENT', label);
  openInternalWorkForDepartment(dept ? dept.id : null);
}

// SVG donut from [{label, value, color}] segments.
function anDonut(segments) {
  if (!segments.length) return `<div class="an-empty">No tracked time in this period.</div>`;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = 52, C = 2 * Math.PI * r;
  let offset = 0;
  const circles = segments.map(s => {
    const dash = (s.value / total) * C;
    const c = `<circle r="${r}" cx="60" cy="60" fill="none" stroke="${s.color}" stroke-width="15"
                 stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}"
                 stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 60 60)"/>`;
    offset += dash;
    return c;
  }).join('');
  const legend = segments.map(s => `
    <div class="an-legend-item">
      <span class="an-legend-dot" style="background:${s.color}"></span>${esc(s.label)}
      <span class="an-legend-val">${anFmtHrs(s.value)} · ${Math.round((s.value / total) * 100)}%</span>
    </div>`).join('');
  const totalHrsDisp = (total / 60).toFixed(1);
  const totalHrsWord = totalHrsDisp === '1.0' ? 'total hour' : 'total hours';
  return `
    <div class="an-donut-wrap">
      <svg class="an-donut" width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="Time breakdown, ${totalHrsDisp} ${totalHrsWord}">
        <title>Time breakdown, ${totalHrsDisp} ${totalHrsWord}</title>
        ${circles}
        <text class="an-donut-center" x="60" y="58" text-anchor="middle">${(total / 60).toFixed(1)}h</text>
        <text class="an-donut-center-sub" x="60" y="72" text-anchor="middle">TOTAL</text>
      </svg>
      <div class="an-legend">${legend}</div>
    </div>`;
}

// The last trend drawn, so a resize can redraw it at the new width.
let _anTrendArgs = null;
function drawAnTrend() {
  const el = document.getElementById('an-trend');
  if (!el || !_anTrendArgs) return;
  const { from, to, dayMin, dayOtMin } = _anTrendArgs;
  el.innerHTML = anTrend(from, to, dayMin, dayOtMin, el.clientWidth);
}
let _anTrendWidth = 0;
if (typeof ResizeObserver === 'function' && document.getElementById('an-trend')) {
  new ResizeObserver(entries => {
    const w = Math.round(entries[0]?.contentRect.width || 0);
    if (w && Math.abs(w - _anTrendWidth) > 24) { _anTrendWidth = w; drawAnTrend(); }
  }).observe(document.getElementById('an-trend'));
}

// SVG daily-hours trend over [from, to]. Adds a "nice" rounded y-axis, an
// average reference line (over active days), an emphasised + labelled peak,
// per-point hover tooltips, and a gradient area fill. `otMin`, when given,
// adds over time as a second line on the same scale. The viewBox is the
// drawn width in pixels, so labels keep their size instead of stretching.
function anTrend(from, to, dayMin, otMin = null, width = 900) {
  const dates = [];
  const d = new Date(from + 'T00:00:00'), end = new Date(to + 'T00:00:00');
  while (d <= end) { dates.push(fmt(d)); d.setDate(d.getDate() + 1); }
  if (!dates.length) return `<div class="an-empty">No data.</div>`;
  const vals = dates.map(dt => (dayMin[dt] || 0) / 60);
  const otVals = otMin ? dates.map(dt => (otMin[dt] || 0) / 60) : null;
  const rawMax = Math.max(0, ...vals);
  const maxV = Math.max(2, Math.ceil(rawMax / 2) * 2);   // round up to a clean even number
  const active = vals.filter(v => v > 0);
  const avg = active.length ? active.reduce((s, v) => s + v, 0) / active.length : 0;
  const peakIdx = vals.reduce((bi, v, i) => v > vals[bi] ? i : bi, 0);

  const W = Math.max(320, Math.round(width) || 900), H = 200, padL = 30, padR = 14, padT = 22, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = dates.length;
  const x = i => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = v => padT + innerH - (v / maxV) * innerH;

  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const linePath = `M ${pts.join(' L ')}`;
  const otPath = otVals ? 'M ' + otVals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L ') : '';
  const areaPath = `M ${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} L ${pts.join(' L ')} L ${x(n - 1).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  // y gridlines at 0, mid, max (clean integers thanks to the even maxV)
  const grids = [0, maxV / 2, maxV].map(v => `
    <line class="an-trend-grid" x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}"/>
    <text class="an-trend-lbl" x="2" y="${(y(v) + 3).toFixed(1)}">${v.toFixed(0)}</text>`).join('');

  // average reference line
  const avgLine = avg > 0 ? `
    <line class="an-trend-avg" x1="${padL}" y1="${y(avg).toFixed(1)}" x2="${W - padR}" y2="${y(avg).toFixed(1)}"/>
    <text class="an-trend-avg-lbl" x="${(W - padR).toFixed(1)}" y="${(y(avg) - 5).toFixed(1)}" text-anchor="end">avg ${avg.toFixed(1)}h</text>` : '';

  // x labels: ~5 evenly spaced
  const labelIdx = [...new Set([0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1])];
  const xlabels = labelIdx.map(i => {
    const dd = new Date(dates[i] + 'T00:00:00');
    const t = dd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    return `<text class="an-trend-lbl" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${t}</text>`;
  }).join('');

  // dots with native hover tooltips; the peak is enlarged
  const dots = n <= 45 ? vals.map((v, i) => {
    if (v <= 0) return '';
    const peak = i === peakIdx;
    const lbl = new Date(dates[i] + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const hDisp = v.toFixed(1);
    return `<circle class="an-trend-dot${peak ? ' peak' : ''}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${peak ? 4 : 2.5}"><title>${lbl} · ${hDisp} ${hDisp === '1.0' ? 'hour' : 'hours'}</title></circle>`;
  }).join('') : '';
  const peakLbl = vals[peakIdx] > 0
    ? `<text class="an-trend-peak-lbl" x="${x(peakIdx).toFixed(1)}" y="${(y(vals[peakIdx]) - 10).toFixed(1)}" text-anchor="middle">${vals[peakIdx].toFixed(1)}h</text>`
    : '';

  // Unique gradient id per call — multiple trends coexist on the page.
  const gradId = 'anTrendGrad' + (++_anTrendSeq);
  const activeRows = dates.map((date, i) => {
    if (vals[i] <= 0) return '';
    const hDisp = vals[i].toFixed(1);
    return `<tr><td>${date}</td><td>${hDisp} ${hDisp === '1.0' ? 'hour' : 'hours'}</td></tr>`;
  }).join('');
  const rawMaxDisp = rawMax.toFixed(1), avgDisp = avg.toFixed(1);
  return `<svg class="an-trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily hours trend from ${from} to ${to}; peak ${rawMaxDisp} ${rawMaxDisp === '1.0' ? 'hour' : 'hours'}, average ${avgDisp} ${avgDisp === '1.0' ? 'hour' : 'hours'}">
    <title>Daily hours trend from ${from} to ${to}</title>
    <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/>
    </linearGradient></defs>
    ${grids}
    ${avgLine}
    <path class="an-trend-area" style="fill:url(#${gradId})" d="${areaPath}"/>
    <path class="an-trend-line" d="${linePath}"/>
    ${otPath ? `<path class="an-trend-ot" d="${otPath}"/>` : ''}
    ${dots}
    ${peakLbl}
    ${xlabels}
  </svg>
  <details class="an-data-details"><summary>View active-day data</summary>
    <table class="an-data-table"><thead><tr><th>Date</th><th>Hours</th></tr></thead><tbody>${activeRows || '<tr><td colspan="2">No active days</td></tr>'}</tbody></table>
  </details>`;
}

// GitHub-style contribution grid. `start` is a Sunday; renders `weeks` columns,
// with month labels along the top and Mon/Wed/Fri labels down the left.
function anHeatmap(start, weeks, dayMin, today) {
  const cols = [], monthLbl = [];
  const cur = new Date(start);
  let prevMonth = -1;
  for (let w = 0; w < weeks; w++) {
    // Label a column with its month name when the month rolls over.
    const m = cur.getMonth();
    monthLbl.push(m !== prevMonth ? cur.toLocaleDateString('en-US', { month: 'short' }) : '');
    prevMonth = m;
    let col = '';
    for (let day = 0; day < 7; day++) {
      const ds = fmt(cur);
      const future = cur > today;
      const mins = dayMin[ds] || 0;
      let cls = '';
      if (future) cls = 'empty';
      else if (mins === 0) cls = '';
      else if (mins < 120) cls = 'h1';
      else if (mins < 240) cls = 'h2';
      else if (mins < 360) cls = 'h3';
      else cls = 'h4';
      const title = future ? '' : `${ds} · ${anFmtHrs(mins)}`;
      const onclick = future ? '' : ` data-onclick="anJumpToDay('${ds}')"`;
      col += future
        ? `<span class="an-heat-cell ${cls}" aria-hidden="true"></span>`
        : `<button type="button" class="an-heat-cell ${cls}" title="${title}" aria-label="${title}"${onclick}></button>`;
      cur.setDate(cur.getDate() + 1);
    }
    cols.push(`<div class="an-heat-col">${col}</div>`);
  }
  // A label too close to the next one (e.g. a lone leading week of last
  // December) would collide with it — drop the earlier label.
  let next = Infinity;
  for (let w = weeks - 1; w >= 0; w--) {
    if (!monthLbl[w]) continue;
    if (next - w < 3) monthLbl[w] = '';
    else next = w;
  }
  const months = monthLbl.map(l => `<span class="an-heat-mcol">${l}</span>`).join('');
  const wd = ['', 'Mon', '', 'Wed', '', 'Fri', ''].map(l => `<span class="an-heat-wd">${l}</span>`).join('');
  // One grid so the weekday column sizes to its (translated) labels and the
  // month row lines up with the cells in both LTR and RTL.
  return `
    <div class="an-heat-grid">
      <span></span>
      <div class="an-heat-months">${months}</div>
      <div class="an-heat-weekdays">${wd}</div>
      <div class="an-heat">${cols.join('')}</div>
    </div>`;
}

function anJumpToDay(ds) {
  switchModule('timesheet');
  switchDay(ds);
}

async function renderAnSpend() {
  const data = await window.api.loadSubscriptions();
  const subs = (data && data.subscriptions) || [];
  const el = document.getElementById('an-spend');
  // Sum monthly + yearly equivalents per currency.
  const cur = {};   // currency -> { monthly, yearly }
  const costed = [];   // each subscription with a cost, for the biggest-costs list
  subs.forEach(s => {
    const cost = parseFloat(String(s.cost).replace(/[^0-9.]/g, '')) || 0;
    if (!cost) return;
    const c = s.currency || 'USD';
    cur[c] = cur[c] || { monthly: 0, yearly: 0 };
    let yearly;
    if (s.billingCycle === 'MONTHLY') { cur[c].monthly += cost; cur[c].yearly += cost * 12; yearly = cost * 12; }
    else { cur[c].yearly += cost; cur[c].monthly += cost / 12; yearly = cost; }   // Custom → treat as yearly
    costed.push({ s, c, cost, yearly });
  });
  const entries = Object.entries(cur);
  document.getElementById('an-spend-sub').textContent = `${subs.length} subscription${subs.length === 1 ? '' : 's'}`;
  if (!entries.length) { el.innerHTML = `<div class="an-empty">No subscription costs recorded.</div>`; return; }
  const sym = c => CURRENCY_SYMBOLS[c] || c;
  // One total per currency (monthly big, yearly under it), then the three
  // biggest subscriptions by yearly cost, then a way into the module.
  const totals = entries.map(([c, v]) => `
    <div class="an-spend-total">
      <span class="an-spend-big">${v.monthly.toFixed(0)}<small> ${esc(sym(c))}</small></span>
      <span class="an-spend-per">Monthly</span>
      <span class="an-spend-year"><b>${v.yearly.toFixed(0)} ${esc(sym(c))}</b> Yearly</span>
    </div>`).join('');
  const top = costed.sort((a, b) => b.yearly - a.yearly).slice(0, 3);
  const list = top.map(({ s, c, cost }) => `
    <div class="an-spend-item">
      <span class="an-spend-name" data-user-content>${esc(s.name || 'Untitled')}</span>
      <span class="an-spend-cycle">${esc(lkLabel('BILLING_CYCLE', s.billingCycle) || s.billingCycle || '')}</span>
      <span class="an-spend-cost">${cost.toFixed(0)} ${esc(sym(c))}</span>
    </div>`).join('');
  el.innerHTML = `<div class="an-spend-totals">${totals}</div>
    ${top.length ? `<div class="an-spend-head">Biggest costs</div><div class="an-spend-list">${list}</div>` : ''}
    <button type="button" class="an-spend-link" data-onclick="switchModule('subscriptions')">Open Subscriptions</button>`;
}

// Export the current analytics view to PDF (light theme, self-contained HTML).
async function exportAnalyticsPDF() {
  const css = [...document.styleSheets].flatMap(s => {
    try { return [...s.cssRules].map(r => r.cssText); } catch { return []; }
  }).join('\n');
  const { label } = anRange();
  const body = document.getElementById('an-scroll').innerHTML;
  const lang = window.ctI18n?.getLanguage?.() === 'ar' ? 'ar' : 'en';
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const locale = lang === 'ar' ? 'ar-SA' : 'en-US';
  const tr = (key, vars) => window.ctI18n?.t?.(key, vars) || key;
  const html = `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><head><meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src data:; font-src data:">
    <style>${css}
      ${window.CAIRO_PRINT_FONT_CSS || ''}
      body { font-family:'Cairo','Segoe UI',Tahoma,Arial,sans-serif; background:#fff; padding:28px 32px; display:block; direction:${dir}; text-align:${dir === 'rtl' ? 'right' : 'left'}; }
      .an-report-title { font-size:20px; font-weight:700; color:#2a2722; margin-bottom:4px; }
      .an-report-sub { font-size:12px; color:#8a857c; margin-bottom:20px; }
    </style></head>
    <body>
      <div class="an-report-title">${esc(tr('Analytics — {label}', { label }))}</div>
      <div class="an-report-sub">${esc(tr('Office ONE'))} · ${esc(tr('generated {date}', { date: new Date().toLocaleString(locale) }))}</div>
      ${body}
    </body></html>`;
  const res = await window.api.exportPDF(html, `analytics-${fmt(new Date())}.pdf`);
  if (res && res.ok) toast('PDF saved');
  else if (res && res.error) toast('PDF failed: ' + res.error);
}

// ── Full Backup (Milestone 8) ──
// Captures the DB + projects/ + company_documents/ + knowledge_hub/ + backups/ into one new
// timestamped Desktop folder. Shared by Settings -> Backup Data and the command
// palette; `btnId` lets each caller show its own loading state.
// Asks for the optional portability passphrase first, then backs up. The
// passphrase never leaves this call: it goes straight to the main process and is
// neither stored nor echoed anywhere.
let _pendingBackupBtnId = null;
function runFullBackup(btnId) {
  _pendingBackupBtnId = btnId || null;
  const pass = document.getElementById('backup-passphrase');
  const confirm = document.getElementById('backup-passphrase-confirm');
  if (pass) pass.value = '';
  if (confirm) confirm.value = '';
  syncBackupPassphrase();
  document.getElementById('backup-passphrase-overlay').classList.add('open');
}
function closeBackupPassphrase() {
  document.getElementById('backup-passphrase-overlay').classList.remove('open');
  // Never leave a passphrase sitting in a DOM node after the dialog closes.
  const pass = document.getElementById('backup-passphrase');
  const confirm = document.getElementById('backup-passphrase-confirm');
  if (pass) pass.value = '';
  if (confirm) confirm.value = '';
}
function backupPassphraseOverlayClick(e) {
  if (e.target === document.getElementById('backup-passphrase-overlay')) closeBackupPassphrase();
}
// An empty passphrase is a valid choice (a this-computer-only backup); a
// mismatched one is not, because the passphrase is unrecoverable and a typo
// would lock the credentials away for good.
function syncBackupPassphrase() {
  const pass = document.getElementById('backup-passphrase');
  const confirm = document.getElementById('backup-passphrase-confirm');
  const warn = document.getElementById('backup-passphrase-warning');
  const go = document.getElementById('backup-passphrase-go');
  if (!pass || !confirm || !warn || !go) return;
  const mismatch = pass.value !== '' && pass.value !== confirm.value;
  warn.style.display = mismatch ? '' : 'none';
  warn.textContent = mismatch ? 'The two passphrases do not match.' : '';
  go.disabled = mismatch;
  go.textContent = pass.value === '' ? 'Back Up (this computer only)' : 'Back Up (portable)';
}
async function confirmBackupPassphrase() {
  const pass = document.getElementById('backup-passphrase');
  const passphrase = pass ? pass.value : '';
  closeBackupPassphrase();
  return performFullBackup(_pendingBackupBtnId, passphrase);
}

async function performFullBackup(btnId, passphrase) {
  const btn = btnId ? document.getElementById(btnId) : null;
  const orig = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Backing up…'; }
  let res;
  try { res = await window.api.fullBackup(passphrase || ''); }
  catch { res = { ok: false, error: 'failed' }; }
  if (btn) { btn.disabled = false; btn.textContent = orig; }
  if (res && res.ok) {
    toast(window.ctI18n?.t?.('Full backup saved to {path}', { path: res.path }) || `Full backup saved to ${res.path}`, {
      actionLabel: 'Open folder',
      onAction: () => window.api.openBackupFolder(res.path),
      duration: 6000,
    });
  } else if (res && res.error) {
    toast('Full backup failed: ' + res.error);
  }
  return res;
}

async function chooseFullBackupForRestore(btnId) {
  const btn = document.getElementById(btnId);
  const host = document.getElementById('maint-fullrestore-confirm');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Validating…';
  host.innerHTML = '';
  let selected;
  try { selected = await window.api.selectFullBackup(); }
  catch { selected = { ok: false, error: 'The backup folder could not be validated.' }; }
  btn.disabled = false;
  btn.textContent = original;
  if (selected?.canceled) return;
  if (!selected?.ok) { toast(selected?.error || 'That folder is not a valid full backup.'); return; }

  const box = pjMk('div', 'maint-confirm');
  box.style.flexWrap = 'wrap';
  const summary = pjMk('div', 'maint-row-main');
  summary.appendChild(pjMk('div', 'maint-row-title', selected.name));
  const meta = selected.manifest || {};
  const details = [
    meta.createdAt ? new Date(meta.createdAt).toLocaleString() : '',
    meta.totalFileCount ? `${meta.totalFileCount} files` : '',
    meta.totalByteCount ? fmtFileSize(meta.totalByteCount) : '',
    meta.schemaHead != null ? `schema ${meta.schemaHead}` : '',
  ].filter(Boolean).join(' · ');
  summary.appendChild(pjMk('div', 'maint-row-meta', details));
  (selected.warnings || []).forEach(warning =>
    summary.appendChild(pjMk('div', 'maint-result-bad', warning)));

  // A portable bundle's credentials are sealed with a passphrase rather than
  // this machine's key. Restoring without it still restores everything else, so
  // this is offered, not demanded — but say plainly what leaving it empty costs.
  let passInput = null;
  if (selected.credentialsPortable) {
    summary.appendChild(pjMk('div', 'maint-row-meta',
      "This backup's credentials are passphrase-protected. Enter it to restore them to this computer; leave it empty to restore everything else and re-enter the credentials later."));
    passInput = document.createElement('input');
    passInput.type = 'password';
    passInput.autocomplete = 'off';
    passInput.placeholder = 'Backup passphrase (optional)';
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type "' + selected.name + '" to confirm';
  const restoreBtn = pjMk('button', 'btn', 'Restore Everything Now');
  restoreBtn.disabled = true;
  restoreBtn.style.cssText = 'background:var(--bad);color:#fff;border-color:var(--bad)';
  const cancelBtn = pjMk('button', 'btn', 'Cancel');
  input.addEventListener('input', () => { restoreBtn.disabled = input.value !== selected.name; });
  cancelBtn.addEventListener('click', () => host.innerHTML = '');
  restoreBtn.addEventListener('click', async () => {
    restoreBtn.disabled = true;
    restoreBtn.textContent = 'Creating safety backup…';
    try {
      await flushPending();
      const res = await window.api.restoreSelectedFullBackup(passInput ? passInput.value : '');
      if (!res?.ok) {
        toast(res?.error || 'Full restore failed');
        restoreBtn.disabled = false;
        restoreBtn.textContent = 'Restore Everything Now';
        // A wrong passphrase changed nothing and the selection is still valid,
        // so leave the box up for another try rather than making them re-pick
        // the folder.
        if (passInput && /passphrase/i.test(res?.error || '')) passInput.focus();
        return;
      }
      toast('Restoring all data and restarting…');
    } catch (err) {
      toast('Full restore stopped: ' + String(err?.message || err || 'save failed'));
      restoreBtn.disabled = false;
      restoreBtn.textContent = 'Restore Everything Now';
    }
  });
  box.appendChild(summary);
  if (passInput) box.appendChild(passInput);
  box.appendChild(input);
  box.appendChild(restoreBtn);
  box.appendChild(cancelBtn);
  host.appendChild(box);
  input.focus();
}

// ── Database backup ──
// Reached from Settings -> Backup Data and from the command palette, so the
// outcome has to land somewhere that exists in both cases: a toast, with the
// Settings button showing the in-flight state when it happens to be on screen.
// This used to repaint the sidebar's Backup Data button, which is gone.
async function backupDatabase() {
  const btn = document.getElementById('backup-dbonly-btn');
  const orig = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Backing up…'; }
  let res;
  try { res = await window.api.backupDatabase(); } catch { res = { ok: false, error: 'failed' }; }
  if (btn) { btn.disabled = false; btn.textContent = orig; }
  // Neither ok nor error means the user canceled the save dialog — stay quiet.
  if (res?.ok) toast('Database backed up');
  else if (res?.error) toast('Backup failed: ' + res.error);
  return res;
}

// ── Subscriptions: helpers ──
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}

function renewClass(daysLeft) {
  if (daysLeft === null) return 'ok';
  if (daysLeft <= 7)  return 'urgent';
  if (daysLeft <= 30) return 'soon';
  return 'ok';
}

function renewLabel(daysLeft) {
  if (daysLeft === null) return '—';
  if (daysLeft < 0)  return `${Math.abs(daysLeft)}d overdue`;
  if (daysLeft === 0) return 'Today';
  return `in ${daysLeft}d`;
}

// One billing cycle after dateStr (dir = -1: one cycle before). '' for a Custom cycle.
function addInterval(dateStr, cycle, dir = 1) {
  const d = new Date(dateStr + 'T00:00:00');
  const months = (cycle === 'MONTHLY' ? 1 : cycle === 'YEARLY' ? 12 : 0) * dir;
  if (!months) return '';
  // Clamp to the target month's last day, so Jan 31 → Feb 28 rather than Mar 3.
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return fmt(d);
}

// A subscription's cost as a number, and what it comes to per year.
// Custom cycles are counted as yearly (same rule as the Overview spend card).
function subCost(s) {
  return parseFloat(String(s.cost == null ? '' : s.cost).replace(/[^0-9.]/g, '')) || 0;
}
function subYearlyCost(s) {
  const cost = subCost(s);
  return s.billingCycle === 'MONTHLY' ? cost * 12 : cost;
}
function subCurrencyLabel(code) {
  return lkLabel('CURRENCY', code || 'USD') || code || 'USD';
}
function subMoney(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// The one date that matters for a row: the renewal date, or the end date when
// there is no renewal. kind: 'renews' | 'ends' | 'ended' | null.
function subNextDate(s) {
  if (s.renewalDate) return { date: s.renewalDate, kind: 'renews' };
  if (s.endDate) return { date: s.endDate, kind: daysUntil(s.endDate) < 0 ? 'ended' : 'ends' };
  return { date: null, kind: null };
}

// Renewals more than 30 days out are plain text; only near or overdue ones get a coloured pill.
function subBadge(next) {
  const badge = document.createElement('span');
  if (next.kind === 'ended') {
    badge.className = 'renew-badge ended';
    badge.textContent = 'Ended';
    return badge;
  }
  const days = daysUntil(next.date);
  const cls = renewClass(days);
  badge.className = 'renew-badge ' + (cls === 'ok' ? 'later' : cls);
  badge.textContent = subCountdown(days, next.date);
  return badge;
}

// Countdown in days up to a month out ("in 12d"), then in months/years
// ("in 8 months", "in 1 year 11 months"). Overdue stays exact in days.
function subCountdown(days, dateStr) {
  if (days === null || days <= 30) return renewLabel(days);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  let m = (d.getFullYear() - t.getFullYear()) * 12 + d.getMonth() - t.getMonth();
  if (d.getDate() < t.getDate()) m--;
  m = Math.max(m, 1);
  const y = Math.floor(m / 12), r = m % 12;
  const mo = n => `${n} month${n === 1 ? '' : 's'}`;
  const yr = n => `${n} year${n === 1 ? '' : 's'}`;
  return 'in ' + (y && r ? `${yr(y)} ${mo(r)}` : y ? yr(y) : mo(r));
}

// How far through the current term a renewing subscription is, 0–1.
// The term runs from one cycle before the renewal date up to it. null when
// there is no renewal date or the cycle is Custom.
function subTermProgress(sub) {
  if (!sub.renewalDate) return null;
  const start = addInterval(sub.renewalDate, sub.billingCycle, -1);
  if (!start) return null;
  const a = new Date(start + 'T00:00:00'), b = new Date(sub.renewalDate + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.min(1, Math.max(0, (now - a) / (b - a)));
}

// Column sort. key '' = default (soonest renewal first). Header click:
// ascending → descending → back to the default, as on Project & Finance.
let subSort = { key: '', dir: 1 };
function setSubSort(key) {
  if (subSort.key !== key) { subSort.key = key; subSort.dir = 1; }
  else if (subSort.dir === 1) subSort.dir = -1;
  else subSort.key = '';
  renderSubscriptions();
}
function renderSubSortHeaders() {
  document.querySelectorAll('#sub-table th[data-sub-sort]').forEach(th => {
    if (th.dataset.subSort === subSort.key) th.setAttribute('aria-sort', subSort.dir === 1 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });
}
function compareSubs(a, b) {
  const key = subSort.key || 'next';
  const dir = subSort.key ? subSort.dir : 1;
  if (key === 'name') return dir * String(a.name || '').localeCompare(String(b.name || ''));
  if (key === 'cost') return dir * (subYearlyCost(a) - subYearlyCost(b));
  if (key === 'cycle') return dir * String(lkLabel('BILLING_CYCLE', a.billingCycle) || '').localeCompare(String(lkLabel('BILLING_CYCLE', b.billingCycle) || ''));
  // next: ended rows and rows with no date always go last, whichever direction.
  const da = subNextDate(a), db = subNextDate(b);
  const rank = n => (!n.date ? 2 : n.kind === 'ended' ? 1 : 0);
  if (rank(da) !== rank(db)) return rank(da) - rank(db);
  if (!da.date || !db.date) return 0;
  return dir * da.date.localeCompare(db.date);
}

// ── Subscriptions: totals strip ──
function renderSubTotals() {
  const bar = document.getElementById('sub-totals');
  if (!bar) return;
  if (subscriptions.length === 0) { bar.hidden = true; return; }
  bar.hidden = false;

  const perCur = {};   // currency -> yearly total
  subscriptions.forEach(s => {
    const yearly = subYearlyCost(s);
    if (!yearly) return;
    const c = s.currency || 'USD';
    perCur[c] = (perCur[c] || 0) + yearly;
  });
  const lines = fn => {
    const entries = Object.entries(perCur);
    if (!entries.length) return '<span class="sub-total-line">—</span>';
    return entries.map(([c, y]) =>
      `<span class="sub-total-line">${esc(subCurrencyLabel(c))} ${esc(subMoney(fn(y)))}</span>`).join('');
  };
  document.getElementById('sub-total-year').innerHTML = lines(y => y);
  document.getElementById('sub-total-month').innerHTML = lines(y => y / 12);

  // Next renewal: the soonest row that hasn't ended (an overdue one counts — it needs attention most).
  const upcoming = subscriptions.map(s => ({ s, next: subNextDate(s) }))
    .filter(x => x.next.date && x.next.kind !== 'ended')
    .sort((a, b) => a.next.date.localeCompare(b.next.date))[0];
  const nextVal = document.getElementById('sub-next-date');
  const nextMeta = document.getElementById('sub-next-meta');
  nextMeta.innerHTML = '';
  if (!upcoming) { nextVal.textContent = '—'; return; }
  nextVal.textContent = upcoming.next.date;
  const name = document.createElement('span');
  name.className = 'sub-next-name';
  name.setAttribute('data-user-content', '');
  name.textContent = upcoming.s.name || '—';
  nextMeta.appendChild(name);
  nextMeta.appendChild(subBadge(upcoming.next));
}

// ── Subscriptions: render ──
function renderSubscriptions() {
  const tbody = document.getElementById('sub-tbody');
  const table = document.getElementById('sub-table');
  const empty = document.getElementById('sub-empty-state');
  tbody.innerHTML = '';
  renderSubTotals();
  renderSubSortHeaders();

  if (subscriptions.length === 0) {
    table.style.display = 'none';
    empty.hidden = false;
    return;
  }
  table.style.display = '';
  empty.hidden = true;

  // Each currency's yearly total, for the "share of spend" line; only shown
  // when a currency has more than one costed subscription.
  const curTotals = {};
  subscriptions.forEach(s => {
    const y = subYearlyCost(s); if (!y) return;
    const c = s.currency || 'USD';
    curTotals[c] = curTotals[c] || { sum: 0, n: 0 };
    curTotals[c].sum += y; curTotals[c].n++;
  });

  const sorted = subscriptions.slice().sort(compareSubs).filter(s => textMatch([s.name, s.cost, s.currency, lkLabel('BILLING_CYCLE', s.billingCycle), s.endDate, s.renewalDate], subFilter));

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="no-matches">No matches</td></tr>';
    return;
  }

  sorted.forEach(sub => {
    const tr = document.createElement('tr');
    tr.dataset.subId = sub.id;   // Milestone 11 — palette deep-link scroll+highlight target
    const next = subNextDate(sub);
    if (next.kind === 'ended') tr.classList.add('sub-ended');
    // Click (or Enter on) the row to edit; clicks inside the action buttons don't count.
    tr.classList.add('sub-row');
    tr.tabIndex = 0;
    tr.addEventListener('click', e => { if (!e.target.closest('.row-actions, button, a, input')) openSubModal(sub.id); });
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === tr) openSubModal(sub.id); });

    tr.appendChild(textCell(sub.name));

    // Cost, with the yearly equivalent for monthly plans and the row's share
    // of its currency's yearly spend underneath.
    const costBox = document.createElement('div');
    const costSpan = document.createElement('span');
    costSpan.className = 'sub-cost';
    const costNum = parseFloat(sub.cost);
    const costText = isNaN(costNum) ? sub.cost : costNum.toFixed(2);
    costSpan.textContent = subCurrencyLabel(sub.currency) + ' ' + costText;
    costBox.appendChild(costSpan);
    const yearly = subYearlyCost(sub);
    const tot = curTotals[sub.currency || 'USD'];
    const meta = [];
    if (sub.billingCycle === 'MONTHLY' && yearly) {
      const v = document.createElement('span'); v.textContent = subCurrencyLabel(sub.currency) + ' ' + subMoney(yearly);
      const l = document.createElement('span'); l.textContent = 'per year';
      meta.push([v, l]);
    }
    if (yearly && tot && tot.n > 1) {
      const v = document.createElement('span'); v.textContent = Math.round(yearly / tot.sum * 100) + '%';
      const l = document.createElement('span'); l.textContent = 'of yearly spend';
      meta.push([v, l]);
    }
    if (meta.length) {
      const m = document.createElement('div');
      m.className = 'sub-cost-meta';
      meta.forEach((pair, i) => {
        if (i) { const dot = document.createElement('span'); dot.textContent = '·'; m.appendChild(dot); }
        pair.forEach(el => m.appendChild(el));
      });
      costBox.appendChild(m);
    }
    tr.appendChild(cellWrap(costBox, 'cell'));

    tr.appendChild(textCell(lkLabel('BILLING_CYCLE', sub.billingCycle)));

    // Next Renewal: one date + its countdown. A future end date that differs
    // from the renewal shows underneath; a past end date is just the last term.
    const when = document.createElement('div');
    when.className = 'sub-when';
    const line = document.createElement('div');
    line.className = 'sub-when-line';
    const dateEl = document.createElement('span');
    dateEl.className = 'sub-when-date';
    dateEl.textContent = next.date || '—';
    line.appendChild(dateEl);
    if (next.date) line.appendChild(subBadge(next));
    when.appendChild(line);
    if (next.kind === 'renews' && sub.endDate && sub.endDate !== sub.renewalDate && daysUntil(sub.endDate) >= 0) {
      const ends = document.createElement('div');
      ends.className = 'sub-when-ends';
      const lbl = document.createElement('span'); lbl.textContent = 'Ends';
      const d = document.createElement('span'); d.textContent = sub.endDate;
      ends.appendChild(lbl); ends.appendChild(d);
      when.appendChild(ends);
    }
    // Thin bar: how much of the current term has passed. Colour follows the countdown.
    const progress = next.kind === 'renews' ? subTermProgress(sub) : null;
    if (progress !== null) {
      const bar = document.createElement('div');
      bar.className = 'sub-term ' + renewClass(daysUntil(sub.renewalDate));
      bar.setAttribute('aria-hidden', 'true');
      const fillEl = document.createElement('span');
      fillEl.style.width = Math.round(progress * 100) + '%';
      bar.appendChild(fillEl);
      when.appendChild(bar);
    }
    tr.appendChild(cellWrap(when, 'cell'));

    const acts = document.createElement('div');
    acts.className = 'row-actions';

    // Mark as renewed: moves the dates forward one cycle (monthly/yearly only).
    const canRenew = (sub.billingCycle === 'MONTHLY' || sub.billingCycle === 'YEARLY') && !!(sub.renewalDate || sub.endDate);
    const renewBtn = document.createElement('button');
    renewBtn.className = 'row-btn'; renewBtn.innerHTML = ic('calendar-check');
    renewBtn.title = 'Mark as renewed';
    renewBtn.addEventListener('click', () => markSubRenewed(sub.id));

    const editBtn = document.createElement('button');
    editBtn.className = 'row-btn'; editBtn.innerHTML = ic('pencil');
    editBtn.title = 'Edit'; editBtn.addEventListener('click', () => openSubModal(sub.id));

    const delBtn = document.createElement('button');
    delBtn.className = 'row-btn del'; delBtn.innerHTML = ic('trash-2');
    delBtn.title = 'Delete';
    const fill = () => { if (canRenew) acts.appendChild(renewBtn); acts.appendChild(editBtn); acts.appendChild(delBtn); };
    const restore = () => { acts.innerHTML = ''; fill(); };
    delBtn.addEventListener('click', () => showDeleteConfirm(acts, () => {
      const removeIdx = subscriptions.indexOf(sub);
      const removed = subscriptions.splice(removeIdx, 1)[0];
      showSubUndoToast({ kind: 'delete', sub: removed, idx: removeIdx });
      renderSubscriptions(); autoSaveSubscriptions();
    }, restore));

    fill();
    tr.appendChild(cellWrap(acts, 'cell'));

    tbody.appendChild(tr);
  });
}

// Move a subscription forward one billing cycle: the old renewal date becomes
// the end of the term just paid, and the next renewal is one cycle after it.
// Same end → renewal relationship the modal suggests (suggestSubRenewal).
function markSubRenewed(id) {
  const sub = subscriptions.find(s => s.id === id);
  if (!sub) return;
  const base = sub.renewalDate || sub.endDate;
  const nextDate = base ? addInterval(base, sub.billingCycle) : '';
  if (!nextDate) return;
  // Renewed again while the toast is still up: keep the dates from before the
  // first renew, so one Undo takes back every step.
  const pending = undoSubscription?.kind === 'renew' && undoSubscription.id === id
    && document.getElementById('sub-undo-toast').classList.contains('visible');
  const before = pending ? undoSubscription.before : { endDate: sub.endDate, renewalDate: sub.renewalDate };
  sub.endDate = base;
  sub.renewalDate = nextDate;
  showSubUndoToast({ kind: 'renew', id, before });
  renderSubscriptions(); autoSaveSubscriptions();
  if (typeof scrollToAndHighlight === 'function') scrollToAndHighlight('[data-sub-id="' + id + '"]');
}

// ── Subscriptions: undo ──
// action: { kind: 'delete', sub, idx } | { kind: 'renew', id, before }
function showSubUndoToast(action) {
  undoSubscription = action;
  clearTimeout(_undoSubTimer);
  document.getElementById('sub-undo-toast-msg').textContent =
    action.kind === 'renew' ? 'Subscription renewed' : 'Subscription deleted';
  const toast = document.getElementById('sub-undo-toast');
  toast.classList.add('visible');
  _undoSubTimer = setTimeout(hideSubUndoToast, 5000);
}

function hideSubUndoToast() {
  document.getElementById('sub-undo-toast').classList.remove('visible');
  undoSubscription = null;
}

function undoDeleteSub() {
  if (!undoSubscription) return;
  const action = undoSubscription;
  if (action.kind === 'renew') {
    const sub = subscriptions.find(s => s.id === action.id);
    if (sub) Object.assign(sub, action.before);
  } else {
    subscriptions.splice(Math.min(action.idx, subscriptions.length), 0, Object.assign({}, action.sub));
  }
  hideSubUndoToast();
  renderSubscriptions();
  autoSaveSubscriptions();
}

// ── Subscriptions: modal ──
function openSubModal(id = null) {
  subEditId = id;
  const sub = id !== null ? subscriptions.find(s => s.id === id) : null;
  const isEdit = !!sub;
  document.getElementById('sub-modal-title').textContent = isEdit ? 'Edit Subscription' : 'Add Subscription';
  document.querySelector('#sub-modal .modal-footer .btn.primary').textContent = isEdit ? 'Save Changes' : 'Add Subscription';

  document.getElementById('s-name').value     = sub ? sub.name : '';
  document.getElementById('s-cost').value     = sub ? sub.cost : '';
  // Currency + cycle <select> options come from the lookup catalog (value = code).
  populateSelect('s-currency', 'currency',     sub ? (sub.currency || 'USD') : subPrefs.defaultCurrency);
  populateSelect('s-cycle',    'billingCycle', sub ? sub.billingCycle : 'MONTHLY');
  document.getElementById('s-end').value      = sub ? (sub.endDate || '') : '';
  document.getElementById('s-renewal').value  = sub ? (sub.renewalDate || '') : '';

  clearSubErrors();
  document.getElementById('sub-modal-overlay').classList.add('open');
  document.getElementById('s-name').focus();
}

function closeSubModal() {
  document.getElementById('sub-modal-overlay').classList.remove('open');
  subEditId = null;
}

function subOverlayClick(e) {
  if (e.target === document.getElementById('sub-modal-overlay')) closeSubModal();
}

// ── Subscriptions: settings ──
function openSubSettings() {
  populateSelect('sub-setting-currency', 'currency', subPrefs.defaultCurrency);
  document.getElementById('sub-settings-overlay').classList.add('open');
}

function closeSubSettings() {
  document.getElementById('sub-settings-overlay').classList.remove('open');
}

function subSettingsOverlayClick(e) {
  if (e.target === document.getElementById('sub-settings-overlay')) closeSubSettings();
}

function saveSubSettings() {
  subPrefs.defaultCurrency = document.getElementById('sub-setting-currency').value;
  closeSubSettings();
  autoSaveSubscriptions();
}

// Auto-suggest the renewal date from the end date + billing cycle, without overwriting a value the user already typed
// End-date and billing-cycle <select>/<input> both call this: suggest a
// renewal date (end + 1 cycle) only when one isn't already filled in.
function suggestSubRenewal() {
  const cycle = document.getElementById('s-cycle').value;
  const end   = document.getElementById('s-end').value;
  const renewalEl = document.getElementById('s-renewal');
  if (end && !renewalEl.value && (cycle === 'MONTHLY' || cycle === 'YEARLY')) {
    renewalEl.value = addInterval(end, cycle);
  }
}
function onEndDateChange() { suggestSubRenewal(); }
function onCycleChange()   { suggestSubRenewal(); }

function submitSubModal() {
  clearSubErrors();

  const name   = document.getElementById('s-name').value.trim();
  const costRaw = document.getElementById('s-cost').value.trim();
  const currency = document.getElementById('s-currency').value;
  const cycle  = document.getElementById('s-cycle').value;
  const end    = document.getElementById('s-end').value;
  const renewal = document.getElementById('s-renewal').value;

  let valid = true;
  if (!name) { markError('s-name'); valid = false; }

  const cost = parseFloat(costRaw);
  if (costRaw === '' || isNaN(cost) || cost < 0) { markError('s-cost'); valid = false; }

  if (!end)     { markError('s-end'); valid = false; }
  if (!renewal) { markError('s-renewal'); valid = false; }

  if (!valid) return;

  const record = {
    id:           subEditId !== null ? subEditId : 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name,
    cost:         costRaw,
    currency,
    billingCycle: cycle,
    endDate:      end,
    renewalDate:  renewal,
  };

  if (subEditId !== null) {
    const idx = subscriptions.findIndex(s => s.id === subEditId);
    if (idx !== -1) subscriptions[idx] = record;
  } else {
    subscriptions.push(record);
  }

  closeSubModal();
  renderSubscriptions();
  autoSaveSubscriptions();
}

function clearSubErrors()  { clearErrorsIn('#sub-modal'); }

// ════════════════════════════════════════════════════════════════════════════
// PROJECTS — a container entity (profile + tracked documents + linked tasks).
// Unlike the debounced modules, project writes persist immediately through the
// projects:* IPC channels; the detail view is re-read after each change.
// ════════════════════════════════════════════════════════════════════════════
// Status is a PROJECT_STATUS lookup code (e.g. 'ACTIVE'); resolve its label from the
// catalog. The three seeded codes carry distinct pill colors; custom codes default
// to the neutral "active" coloring.
const PJ_STATUS_CLASS = { 'ACTIVE': 'active', 'ON_HOLD': 'on-hold', 'COMPLETED': 'completed' };
function pjStatusLabel(s) { return lkLabel('PROJECT_STATUS', s) || (s || 'Active'); }
function pjStatusClass(s) { return 'pj-status pj-status-' + (PJ_STATUS_CLASS[s] || 'active'); }
// Small DOM helper local to the Projects module (uniquely named to avoid clashes).
function pjMk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

async function loadProjectsList() {
  let list;
  try { list = await window.api.listProjects(); }
  catch { toast('Could not load projects'); return; }
  projectsList = Array.isArray(list) ? list : [];
  projectsLoaded = true;
  syncProjectIndex();
  // Projects now live inside the Clients module (the retired Clients Projects
  // page was merged into it) — refresh whichever Clients view is showing: the
  // Projects section in an open client's detail, or the per-card project counts
  // on the client list.
  if (activeModule === 'clients') {
  if (currentClient && document.getElementById('client-detail-sections')) renderClientDetail(currentClient);
    else if (clientsLoaded) renderClientsList();
  }
}
