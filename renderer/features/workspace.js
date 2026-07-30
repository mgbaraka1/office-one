// ── Browse dimension (Companies | Systems) ──
let browseKind = 'companies';
function setBrowseKind(kind) {
  browseKind = kind;
  document.querySelectorAll('#browse-kind-ctl .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.kind === kind));
  document.getElementById('browse-body-companies').style.display = kind === 'companies' ? '' : 'none';
  document.getElementById('browse-body-systems').style.display  = kind === 'systems'  ? '' : 'none';
  window.api.setTitle('Cooperation Tools — Browse — ' + (kind === 'companies' ? 'Companies' : 'Systems'));
  openCatPage(kind);
  uiState.filters.browse = { kind, selected: cpState[kind].selected };
  saveUiStateDebounced();
}
// Cross-link entry point: open Browse pre-selected on one company / system value.
function openBrowseSlice(kind, name) {
  cpState[kind].selected = name;
  cpState[kind].from = ''; cpState[kind].to = ''; cpState[kind].type = '';
  browseKind = kind;
  if (activeModule === 'browse') setBrowseKind(kind);
  else switchModule('browse');
}

// ══ COMPANIES / SYSTEMS — read-only views over tasks + work_logs ════════════
// Both pages are identical except for which category column they group by, so a
// single parameterized renderer drives them (kind = 'companies' | 'systems').
// Data is read via the companies:/systems: IPC channels (always scoped to the
// session user in main); these pages never write.
const CP_DEF = {
  companies: { noun: 'company', icon: ic('building-2'), listApi: 'listCompanies', entriesApi: 'companyEntries' },
  systems:   { noun: 'system',  icon: ic('folder'),  listApi: 'listSystems',   entriesApi: 'systemEntries' },
};
let cpState = {
  companies: { list: [], selected: null, entries: [], from: '', to: '', type: '' },
  systems:   { list: [], selected: null, entries: [], from: '', to: '', type: '' },
};

// Entered via switchModule(kind): (re)load the value list, keep a valid selection.
async function openCatPage(kind) {
  const def = CP_DEF[kind]; const st = cpState[kind];
  if (!document.getElementById(kind + '-list').childElementCount) showSkeleton(kind + '-list', 'text', 6);
  let list;
  try { list = await window.api[def.listApi](); }
  catch { toast('Could not load ' + kind); return; }
  st.list = Array.isArray(list) ? list : [];
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
  const items = q ? st.list.filter(x => x.name.toLowerCase().includes(q)) : st.list;
  if (!items.length) {
    const empty = document.createElement('div'); empty.className = 'cp-list-empty';
    empty.textContent = st.list.length ? 'No matches' : ('No ' + def.noun + ' data yet');
    wrap.appendChild(empty); return;
  }
  items.forEach(x => {
    const btn = document.createElement('button');
    btn.className = 'cp-list-item' + (x.name === st.selected ? ' active' : '');
    const nm = document.createElement('span'); nm.className = 'cp-list-name';
    nm.textContent = x.name; nm.title = x.name;
    const ct = document.createElement('span'); ct.className = 'cp-list-count';
    ct.textContent = x.count;
    btn.appendChild(nm); btn.appendChild(ct);
    btn.addEventListener('click', () => selectCat(kind, x.name));
    wrap.appendChild(btn);
  });
}

function selectCat(kind, name) {
  const st = cpState[kind];
  st.selected = name; st.from = ''; st.to = ''; st.type = '';
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

// Build the records panel shell once per selection (header + filter bar +
// summary + table); filter changes only recompute the body via applyCatFilter
// so the date/select inputs keep their focus.
function renderCatRecords(kind) {
  const def = CP_DEF[kind]; const st = cpState[kind];
  const host = document.getElementById(kind + '-records');
  host.innerHTML = '';

  if (!st.selected) {
    const ph = document.createElement('div'); ph.className = 'cp-placeholder';
    ph.innerHTML = '<div class="icon">' + def.icon + '</div><p>Select a ' + def.noun + ' to view its records</p>';
    host.appendChild(ph); return;
  }

  const head = document.createElement('div'); head.className = 'cp-records-head';
  const title = document.createElement('h2'); title.className = 'cp-records-title';
  title.textContent = st.selected;
  head.appendChild(title);
  host.appendChild(head);

  // Filter bar: date range + entry (time) type
  const bar = document.createElement('div'); bar.className = 'cp-filter-bar';
  const mkField = (labelText, inputEl) => {
    const f = document.createElement('div'); f.className = 'cp-filter-field';
    const l = document.createElement('label'); l.textContent = labelText;
    f.appendChild(l); f.appendChild(inputEl); return f;
  };
  const fromInp = document.createElement('input'); fromInp.type = 'date'; fromInp.value = st.from;
  fromInp.addEventListener('change', () => { st.from = fromInp.value; applyCatFilter(kind); });
  const toInp = document.createElement('input'); toInp.type = 'date'; toInp.value = st.to;
  toInp.addEventListener('change', () => { st.to = toInp.value; applyCatFilter(kind); });
  const typeSel = document.createElement('select');
  const allOpt = document.createElement('option'); allOpt.value = ''; allOpt.textContent = 'All types';
  typeSel.appendChild(allOpt);
  lkOptions('TIME_TYPE').forEach(o => {
    const opt = document.createElement('option'); opt.value = o.code; opt.textContent = o.label;
    typeSel.appendChild(opt);
  });
  typeSel.value = st.type;
  typeSel.addEventListener('change', () => { st.type = typeSel.value; applyCatFilter(kind); });

  bar.appendChild(mkField('From', fromInp));
  bar.appendChild(mkField('To', toInp));
  bar.appendChild(mkField('Type', typeSel));
  const clearBtn = document.createElement('button'); clearBtn.className = 'cp-filter-clear';
  clearBtn.innerHTML = ic('x') + ' Clear filters';
  clearBtn.addEventListener('click', () => {
    st.from = ''; st.to = ''; st.type = '';
    fromInp.value = ''; toInp.value = ''; typeSel.value = '';
    applyCatFilter(kind);
  });
  bar.appendChild(clearBtn);
  host.appendChild(bar);

  // Summary
  const summary = document.createElement('div'); summary.className = 'cp-summary';
  summary.id = kind + '-summary';
  host.appendChild(summary);

  // Table
  const wrap = document.createElement('div');
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr>' +
    '<th style="width:36px">#</th>' +
    '<th>Date</th><th>Company</th><th>System</th><th>Natural</th><th>Time</th>' +
    '<th style="min-width:220px">Description</th><th style="min-width:160px">Source</th>' +
    '<th>Status</th>' +
    '<th style="width:80px;text-align:right">Minutes</th>' +
    '<th style="width:70px;text-align:right">Hours</th></tr></thead>' +
    '<tbody id="' + kind + '-rec-tbody"></tbody>';
  wrap.appendChild(table);
  host.appendChild(wrap);

  applyCatFilter(kind);
}

function applyCatFilter(kind) {
  const st = cpState[kind];
  let rows = st.entries.slice();
  if (st.from) rows = rows.filter(r => r.date >= st.from);
  if (st.to)   rows = rows.filter(r => r.date <= st.to);
  if (st.type) rows = rows.filter(r => r.time === st.type);

  // Summary chips
  const totalMin = rows.reduce((s, r) => s + (parseFloat(r.minutes) || 0), 0);
  const summary = document.getElementById(kind + '-summary');
  summary.innerHTML = '';
  const chip = (val, lbl) => {
    const c = document.createElement('div'); c.className = 'cp-summary-chip';
    const v = document.createElement('span'); v.className = 'cp-summary-val'; v.textContent = val;
    const l = document.createElement('span'); l.className = 'cp-summary-lbl'; l.textContent = lbl;
    c.appendChild(v); c.appendChild(l); return c;
  };
  summary.appendChild(chip(rows.length, 'Entries'));
  summary.appendChild(chip((totalMin / 60).toFixed(2), 'Total Hours'));

  // Table body
  const tbody = document.getElementById(kind + '-rec-tbody');
  tbody.innerHTML = '';
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td'); td.colSpan = 11; td.className = 'cp-records-empty';
    td.textContent = st.entries.length ? 'No records match the current filters' : ('No records for this ' + CP_DEF[kind].noun);
    tr.appendChild(td); tbody.appendChild(tr); return;
  }
  rows.forEach((r, i) => tbody.appendChild(buildReadonlyRow(r, i)));
}

// One read-only timesheet-style row (mirrors the Timesheet columns + Date, no
// row actions — these pages never edit).
function buildReadonlyRow(r, i) {
  const tr = document.createElement('tr');

  const numTd = document.createElement('td');
  const numDiv = document.createElement('div'); numDiv.className = 'cell cell-center';
  const numSpan = document.createElement('span'); numSpan.className = 'cell-num'; numSpan.textContent = i + 1;
  numDiv.appendChild(numSpan); numTd.appendChild(numDiv); tr.appendChild(numTd);

  const dateTd = document.createElement('td');
  const dateDiv = document.createElement('div'); dateDiv.className = 'cell';
  // Date cross-links to that day's timesheet.
  const dateBtn = document.createElement('button');
  dateBtn.className = 'cell-link cp-date-cell'; dateBtn.textContent = r.date;
  dateBtn.title = 'Open this day in the Timesheet';
  dateBtn.addEventListener('click', () => { switchModule('timesheet'); switchDay(r.date); });
  dateDiv.appendChild(dateBtn); dateTd.appendChild(dateDiv); tr.appendChild(dateTd);

  tr.appendChild(linkCell(r.company, 'companies'));
  tr.appendChild(linkCell(r.system, 'systems'));
  tr.appendChild(textCell(r.natural));

  const timeTd = document.createElement('td');
  const timeDiv = document.createElement('div'); timeDiv.className = 'cell';
  const timeSpan = document.createElement('span'); timeSpan.textContent = lkLabel('TIME_TYPE', r.time);
  if (r.time === 'OVERTIME') timeSpan.style.color = 'var(--bad)';
  timeDiv.appendChild(timeSpan); timeTd.appendChild(timeDiv); tr.appendChild(timeTd);

  const descTd = document.createElement('td');
  const descDiv = document.createElement('div'); descDiv.className = 'cell desc-cell';
  const descSpan = document.createElement('span'); descSpan.className = 'desc-text'; descSpan.textContent = r.description;
  descDiv.appendChild(descSpan);
  descTd.appendChild(descDiv); tr.appendChild(descTd);

  tr.appendChild(buildSourceCell(r));

  const stTd = document.createElement('td'); stTd.className = statusClass(r.status);
  const stDiv = document.createElement('div'); stDiv.className = 'cell';
  const badge = document.createElement('span'); badge.className = 'status-badge';
  badge.textContent = lkLabel('ENTRY_STATUS', r.status);
  stDiv.appendChild(badge); stTd.appendChild(stDiv); tr.appendChild(stTd);

  const minTd = document.createElement('td'); minTd.style.textAlign = 'right';
  const minDiv = document.createElement('div'); minDiv.className = 'cell cell-right';
  const minSpan = document.createElement('span'); minSpan.textContent = r.minutes || '—';
  minDiv.appendChild(minSpan); minTd.appendChild(minDiv); tr.appendChild(minTd);

  const m = parseFloat(r.minutes);
  const hrsSpan = document.createElement('span'); hrsSpan.className = 'hours-val';
  hrsSpan.textContent = isNaN(m) ? '—' : (m / 60).toFixed(2);
  tr.appendChild(cellWrap(hrsSpan, 'cell cell-right'));

  return tr;
}

// ── Subscriptions: data ──
async function loadSubscriptionsData() {
  if (!subsLoaded) {
    document.getElementById('sub-table').style.display = '';
    showTableSkeleton('sub-tbody', 7);
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
  } catch { toast('Could not save subscriptions'); }
}

function autoSaveSubscriptions() {
  clearTimeout(_subSaveTimer);
  _subSaveTimer = setTimeout(saveSubscriptionsData, 300);
}

// ── Module search filters ──
function applySubFilter() { subFilter = document.getElementById('sub-filter').value.toLowerCase().trim(); renderSubscriptions(); }

// ── Theme toggle ──
function applyThemeLabel() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (icon)  { icon.innerHTML = dark ? ic('sun') : ic('moon'); icon.dataset.iced = '1'; }
  if (label) label.textContent = dark ? 'Light Mode' : 'Dark Mode';
}
function toggleTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (dark) document.documentElement.removeAttribute('data-theme');
  else      document.documentElement.setAttribute('data-theme', 'dark');
  try { localStorage.setItem('ct-theme', dark ? 'light' : 'dark'); } catch (e) {}
  applyThemeLabel();
}

// ── Calm Workspace preferences ──
// Presentation-only and deliberately local to this machine. Focus Mode is not
// persisted, so navigation is always present again after a fresh launch.
const WORKSPACE_VIEW_DEFAULTS = Object.freeze({ density: 'balanced', canvas: 'calm', motion: 'reduced' });
let workspaceViewPrefs = Object.assign({}, WORKSPACE_VIEW_DEFAULTS);
function loadWorkspaceViewPrefs() {
  try {
    const stored = JSON.parse(localStorage.getItem('ct-workspace-view') || '{}');
    if (['compact','balanced','spacious'].includes(stored.density)) workspaceViewPrefs.density = stored.density;
    if (['calm','structured'].includes(stored.canvas)) workspaceViewPrefs.canvas = stored.canvas;
    if (['gentle','reduced'].includes(stored.motion)) workspaceViewPrefs.motion = stored.motion;
  } catch (e) {
    workspaceViewPrefs = Object.assign({}, WORKSPACE_VIEW_DEFAULTS);
  }
}
function applyWorkspaceViewPreferences() {
  document.body.dataset.density = workspaceViewPrefs.density;
  document.body.classList.toggle('workspace-calm', workspaceViewPrefs.canvas === 'calm');
  document.body.classList.toggle('workspace-structured', workspaceViewPrefs.canvas === 'structured');
  document.body.classList.toggle('workspace-reduced-motion', workspaceViewPrefs.motion === 'reduced');
  document.querySelectorAll('[data-workspace-choice]').forEach(btn => {
    const [key, value] = btn.dataset.workspaceChoice.split(':');
    btn.setAttribute('aria-pressed', String(workspaceViewPrefs[key] === value));
  });
}
function setWorkspaceView(key, value) {
  const allowed = {
    density: ['compact','balanced','spacious'],
    canvas: ['calm','structured'],
    motion: ['gentle','reduced'],
  };
  if (!allowed[key]?.includes(value)) return;
  workspaceViewPrefs[key] = value;
  try { localStorage.setItem('ct-workspace-view', JSON.stringify(workspaceViewPrefs)); } catch (e) {}
  applyWorkspaceViewPreferences();
}
function resetWorkspaceView() {
  workspaceViewPrefs = Object.assign({}, WORKSPACE_VIEW_DEFAULTS);
  try { localStorage.removeItem('ct-workspace-view'); } catch (e) {}
  applyWorkspaceViewPreferences();
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
// Manual collapse is intentionally machine-local like theme: it describes how
// this device's window should use space, not user-owned application data.
function applySidebarPreference() {
  let compact = false;
  try { compact = localStorage.getItem('ct-sidebar-compact') === '1'; } catch (e) {}
  document.body.classList.toggle('sidebar-collapsed', compact);
  const btn = document.getElementById('sidebar-collapse');
  if (btn) {
    btn.setAttribute('aria-pressed', String(compact));
    btn.title = compact ? 'Expand navigation' : 'Collapse navigation';
  }
}
function toggleSidebar() {
  const compact = !document.body.classList.contains('sidebar-collapsed');
  try { localStorage.setItem('ct-sidebar-compact', compact ? '1' : '0'); } catch (e) {}
  applySidebarPreference();
}

// ── Home overview (merged into the Analytics view) ──
function greetWord() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

async function renderOverview() {
  const name = LK.defaultName ? LK.defaultName.split(' ')[0] : 'Moustafa';
  document.getElementById('dash-hello').textContent = `${greetWord()}, ${name}`;
  document.getElementById('dash-date').textContent =
    new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  // Today + month-to-date hours — aggregated in SQL (no day blobs shipped).
  if (!document.getElementById('dash-stats').childElementCount) showSkeleton('dash-stats', 'cards', 2);
  const now = new Date();
  const today = fmt(now);
  const monthStart = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
  const ov = await window.api.loadOverviewStats(today, monthStart);
  const todayMin = ov.todayMin, todayRecs = ov.todayRecs, monthMin = ov.monthMin;
  const daysLogged = ov.daysLogged;

  // Cross-module attention data — one aggregated read (attention:list) across
  // subscription renewals, Company Document renewals, and the two client_*
  // tables with an expiry_date and a UI (Auth/VPN, Internal Systems), instead
  // of each source re-deriving its own urgency separately.
  const ATTENTION_META = {
    subscription:     { icon: ic('credit-card'),    kind: 'Renews' },
    companyDocument:  { icon: ic('calendar-check'), kind: 'Renews' },
    clientVpn:        { icon: ic('layers'),          kind: 'Auth expires' },
    clientInternal:   { icon: ic('layers'),          kind: 'Internal System expires' },
  };
  let rawAttention = [];
  try { rawAttention = await window.api.getAttentionItems(); } catch { rawAttention = []; }
  if (!Array.isArray(rawAttention)) rawAttention = [];

  const attention = [];
  rawAttention.forEach(a => {
    const d = daysUntil(a.date);
    if (d === null || d > 30) return;
    const meta = ATTENTION_META[a.type] || { icon: ic('bell'), kind: 'Due' };
    attention.push({ icon: meta.icon, title: a.title, days: d, module: a.module, kind: meta.kind, companyId: a.companyId ?? null, id: a.id, type: a.type });
  });
  attention.sort((a, b) => a.days - b.days);

  // Stat cards
  const stats = [
    { label: ic('clock') + ' Today',      value: (todayMin / 60).toFixed(1), unit: 'h', foot: `${todayRecs} record${todayRecs === 1 ? '' : 's'}`, cls: 'accent', go: 'timesheet' },
    { label: ic('calendar') + ' This Month', value: (monthMin / 60).toFixed(1), unit: 'h', foot: `${daysLogged} day${daysLogged === 1 ? '' : 's'} logged`, cls: '', go: 'timesheet' },
  ];
  document.getElementById('dash-stats').innerHTML = stats.map(s => `
    <div class="dash-stat ${s.cls}" ${s.go ? `onclick="switchModule('${s.go}')"` : ''}>
      <span class="ds-label">${s.label}</span>
      <span class="ds-value">${esc(s.value)}${s.unit ? `<small> ${s.unit}</small>` : ''}</span>
      <span class="ds-foot">${esc(s.foot)}</span>
    </div>`).join('');

  // Attention list
  document.getElementById('dash-attention-sub').textContent = attention.length ? `${attention.length} item${attention.length === 1 ? '' : 's'}` : '';
  const attEl = document.getElementById('dash-attention');
  if (!attention.length) {
    attEl.innerHTML = `<div class="dash-empty"><span class="de-icon">${ic('circle-check')}</span>All clear — nothing due in the next 30 days.</div>`;
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
        if (a.companyId != null) openClientDetail(a.companyId, a.title);
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

  const activityHost = document.getElementById('dash-activity');
  let activity = [];
  try { activity = await window.api.getRecentActivity(); } catch { activity = []; }
  if (!activity.length) {
    activityHost.innerHTML = '<div class="dash-empty"><span class="de-icon">' + ic('history') + '</span>Your recent changes will appear here.</div>';
  } else {
    activityHost.innerHTML = activity.slice(0, 12).map((item, index) => `
      <div class="dash-att-item" data-activity-idx="${index}">
        <span class="dash-att-icon">${ic(item.kind === 'knowledge' ? 'book-open' : item.kind === 'project' ? 'clipboard-list' : item.kind === 'company-document' ? 'file-text' : 'history')}</span>
        <div class="dash-att-body">
          <div class="dash-att-title">${esc(item.title)}</div>
          <div class="dash-att-meta">${esc(item.detail)} · ${esc(new Date(item.changedAt).toLocaleString())}</div>
        </div>
      </div>`).join('');
    activityHost.querySelectorAll('.dash-att-item').forEach(element => {
      const item = activity[Number(element.dataset.activityIdx)];
      element.addEventListener('click', async () => {
        if (item.kind === 'task') {
          switchModule('all-tasks');
          await openTaskDetail(item.id);
        } else if (item.kind === 'session' && item.parentId) {
          switchModule('all-tasks');
          await openTaskDetail(item.parentId);
        } else if (item.kind === 'project') {
          openProjectById(item.id);
        } else if (item.kind === 'knowledge') {
          switchModule('knowledge');
          openKnowledgeDetail(item.id);
        } else if (item.kind === 'company-document') {
          switchModule('companydocs');
          scrollToAndHighlight('[data-doc-id="' + item.id + '"]');
        }
      });
    });
  }
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
// Keyed by TIME_TYPE lookup code (+ 'OTHER' for unset).
const AN_TYPE_COLORS = {
  'WORK_TIME': 'var(--primary)', 'OVERTIME': 'var(--bad)', 'TRAINING': '#22d3ee',
  'LEAVE': '#f59e0b', 'HOLIDAY': '#22c55e', 'OTHER': '#94a3b8',
};
const AN_FALLBACK = ['#a855f7', '#84cc16', '#14b8a6', '#f97316', '#0ea5e9', '#d946ef'];
let _anTrendSeq = 0;   // monotonic id source for per-trend SVG gradients

function anFmtHrs(mins) {
  if (!mins) return '0h';
  if (mins < 60) return mins + 'm';
  return (mins / 60).toFixed(1) + 'h';
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

// Resolve the active period to a {from, to, label} window of YYYY-MM-DD strings.
function anRange() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const to = fmt(today);
  if (anPeriod === 'custom') {
    const curM = to.slice(0, 7); // YYYY-MM
    let fromM = document.getElementById('an-from').value || curM;
    let toM   = document.getElementById('an-to').value   || fromM;
    if (fromM > toM) { const x = fromM; fromM = toM; toM = x; }
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
    showSkeleton('an-trend-ot', 'text', 4);
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
  const totalMin = an.totalMin, recordCount = an.recordCount, activeDays = an.activeDays, doneCount = an.doneCount;

  const workMin = byType['WORK_TIME'] || 0;
  const otMin   = byType['OVERTIME'] || 0;
  const pct = (m) => totalMin ? Math.round((m / totalMin) * 100) : 0;
  const completionRate = recordCount ? Math.round((doneCount / recordCount) * 100) : 0;
  const previousTotal = Number(previous?.totalMin || 0);
  const periodDelta = previousTotal
    ? Math.round(((totalMin - previousTotal) / previousTotal) * 100)
    : null;
  const comparison = periodDelta == null ? 'no previous activity' : `${periodDelta >= 0 ? '+' : ''}${periodDelta}% vs previous period`;

  // ── KPIs ──
  const kpis = [
    { label: 'Total Hours', val: (totalMin / 60).toFixed(1), unit: 'h', foot: `${recordCount} record${recordCount === 1 ? '' : 's'} · ${comparison}`, cls: 'accent' },
    { label: lkLabel('TIME_TYPE', 'WORK_TIME') || 'Work Time', val: (workMin / 60).toFixed(1),  unit: 'h', foot: `${pct(workMin)}% of total`, cls: '' },
    { label: lkLabel('TIME_TYPE', 'OVERTIME')  || 'Over Time', val: (otMin / 60).toFixed(1),    unit: 'h', foot: `${pct(otMin)}% of total`, cls: '' },
    { label: 'Avg / Day',   val: activeDays ? (totalMin / 60 / activeDays).toFixed(1) : '0', unit: 'h', foot: `${activeDays} active day${activeDays === 1 ? '' : 's'}`, cls: '' },
    { label: 'Completion',  val: String(completionRate), unit: '%', foot: `${doneCount} of ${recordCount} done`, cls: '' },
  ];
  document.getElementById('an-kpis').innerHTML = kpis.map(k => `
    <div class="an-kpi ${k.cls}">
      <span class="an-kpi-label">${esc(k.label)}</span>
      <span class="an-kpi-val">${esc(k.val)}<small>${k.unit}</small></span>
      <span class="an-kpi-foot">${k.foot}</span>
    </div>`).join('');

  // ── Bar charts: company + system (each bar cross-links into Browse) ──
  renderAnBars('an-company', byCompany, 'an-company-sub', 'companies');
  renderAnBars('an-system', bySystem, 'an-system-sub', 'systems');

  // Department cross-links into All Tasks, since Browse has no equivalent slice.
  renderAnBars('an-department', byDepartment, 'an-department-sub', 'department');

  // ── Daily hours + companion Over-Time trend ──
  // These follow the selected period so the charts reflect the searched range.
  document.getElementById('an-trend').innerHTML = anTrend(from, to, dayMin);
  document.getElementById('an-trend-sub').textContent = label;
  const hasOt = Object.keys(dayOtMin).some(d => d >= from && d <= to && dayOtMin[d] > 0);
  document.getElementById('an-trend-ot').innerHTML = hasOt
    ? anTrend(from, to, dayOtMin)
    : `<div class="an-empty">No over-time hours in this period.</div>`;
  document.getElementById('an-trend-ot-sub').textContent = hasOt ? label : '';

  // ── Time breakdown donut (by time type) ──
  const typeSegs = Object.entries(byType)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v], i) => ({ label: k === 'OTHER' ? 'Other' : lkLabel('TIME_TYPE', k), value: v, color: AN_TYPE_COLORS[k] || AN_FALLBACK[i % AN_FALLBACK.length] }));
  document.getElementById('an-type').innerHTML = anDonut(typeSegs, totalMin);
  document.getElementById('an-type-sub').textContent = typeSegs.length ? `${typeSegs.length} types` : '';

  // ── Activity donut (by natural: Ticket / Task / Meeting / Call) ──
  const natSegs = Object.entries(byNatural)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v], i) => ({ label: k, value: v, color: AN_FALLBACK[i % AN_FALLBACK.length] }));
  document.getElementById('an-activity').innerHTML = anDonut(natSegs, totalMin);
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
  const el = document.getElementById(elId);
  if (subId) document.getElementById(subId).textContent = items.length ? `${items.length}` : '';
  if (!items.length) { el.innerHTML = `<div class="an-empty">No tracked time in this period.</div>`; return; }
  const top = items.slice(0, 8);
  const max = top[0][1];
  const rows = items.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(anFmtHrs(v))}</td></tr>`).join('');
  el.innerHTML = `<div class="an-bars">${top.map(([k, v]) => anBarRow(k, v, max, anFmtHrs(v), null, linkKind)).join('')}</div>
    <details class="an-data-details"><summary>View data table</summary>
      <table class="an-data-table"><thead><tr><th>Category</th><th>Hours</th></tr></thead><tbody>${rows}</tbody></table>
    </details>`;
}

const AN_BAR_LINK_ATTRS = {
  companies:      (label) => ` data-kind="companies" data-name="${esc(label)}" title="Browse all work for ${esc(label)}" onclick="openBrowseSlice(this.dataset.kind, this.dataset.name)"`,
  systems:        (label) => ` data-kind="systems" data-name="${esc(label)}" title="Browse all work for ${esc(label)}" onclick="openBrowseSlice(this.dataset.kind, this.dataset.name)"`,
  department:     (label) => ` data-name="${esc(label)}" title="Open All Tasks filtered to ${esc(label)}" onclick="openAllTasksForDepartment(this.dataset.name)"`,
};
function anBarRow(label, value, max, display, color, linkKind) {
  const w = Math.max(2, Math.round((value / max) * 100));
  const style = `width:${w}%${color ? `;background:${color}` : ''}`;
  const linkFn = linkKind && AN_BAR_LINK_ATTRS[linkKind];
  const linkAttrs = linkFn ? linkFn(label) : '';
  const tag = linkFn ? 'button' : 'div';
  const type = linkFn ? ' type="button"' : '';
  return `
    <${tag}${type} class="an-bar-row${linkFn ? ' clickable' : ''}"${linkAttrs}>
      <span class="an-bar-label" title="${esc(label)}">${esc(label)}</span>
      <span class="an-bar-track"><span class="an-bar-fill" style="${style}"></span></span>
      <span class="an-bar-val">${esc(display)}</span>
    </${tag}>`;
}

// Milestone 4 chart click-through — Analytics' "Hours by Department" bar,
// which has no Browse-slice equivalent (Browse only slices by company/
// system). Resolves to All Tasks' department filter (by lookup id, not
// label), that dimension's own existing filter UI, not a new one.
function openAllTasksForDepartment(label) {
  const dept = lkFind('DEPARTMENT', label);
  atPresetFilter = { departmentId: dept ? dept.id : null };
  switchModule('all-tasks');
}

// SVG donut from [{label, value, color}] segments.
function anDonut(segments, totalMin) {
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
  return `
    <div class="an-donut-wrap">
      <svg class="an-donut" width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="Time breakdown, ${(total / 60).toFixed(1)} total hours">
        <title>Time breakdown, ${(total / 60).toFixed(1)} total hours</title>
        ${circles}
        <text class="an-donut-center" x="60" y="58" text-anchor="middle">${(total / 60).toFixed(1)}h</text>
        <text class="an-donut-center-sub" x="60" y="72" text-anchor="middle">TOTAL</text>
      </svg>
      <div class="an-legend">${legend}</div>
    </div>`;
}

// SVG daily-hours trend over [from, to]. Adds a "nice" rounded y-axis, an
// average reference line (over active days), an emphasised + labelled peak,
// per-point hover tooltips, and a gradient area fill.
function anTrend(from, to, dayMin) {
  const dates = [];
  const d = new Date(from + 'T00:00:00'), end = new Date(to + 'T00:00:00');
  while (d <= end) { dates.push(fmt(d)); d.setDate(d.getDate() + 1); }
  if (!dates.length) return `<div class="an-empty">No data.</div>`;
  const vals = dates.map(dt => (dayMin[dt] || 0) / 60);
  const rawMax = Math.max(0, ...vals);
  const maxV = Math.max(2, Math.ceil(rawMax / 2) * 2);   // round up to a clean even number
  const active = vals.filter(v => v > 0);
  const avg = active.length ? active.reduce((s, v) => s + v, 0) / active.length : 0;
  const peakIdx = vals.reduce((bi, v, i) => v > vals[bi] ? i : bi, 0);

  const W = 900, H = 170, padL = 30, padR = 14, padT = 20, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = dates.length;
  const x = i => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = v => padT + innerH - (v / maxV) * innerH;

  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const linePath = `M ${pts.join(' L ')}`;
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
    return `<circle class="an-trend-dot${peak ? ' peak' : ''}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${peak ? 4 : 2.5}"><title>${lbl} · ${v.toFixed(1)}h</title></circle>`;
  }).join('') : '';
  const peakLbl = vals[peakIdx] > 0
    ? `<text class="an-trend-peak-lbl" x="${x(peakIdx).toFixed(1)}" y="${(y(vals[peakIdx]) - 10).toFixed(1)}" text-anchor="middle">${vals[peakIdx].toFixed(1)}h</text>`
    : '';

  // Unique gradient id per call — multiple trends coexist on the page.
  const gradId = 'anTrendGrad' + (++_anTrendSeq);
  const activeRows = dates.map((date, i) => vals[i] > 0 ? `<tr><td>${date}</td><td>${vals[i].toFixed(1)}h</td></tr>` : '').join('');
  return `<svg class="an-trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily hours trend from ${from} to ${to}; peak ${rawMax.toFixed(1)} hours, average ${avg.toFixed(1)} hours">
    <title>Daily hours trend from ${from} to ${to}</title>
    <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/>
    </linearGradient></defs>
    ${grids}
    ${avgLine}
    <path class="an-trend-area" style="fill:url(#${gradId})" d="${areaPath}"/>
    <path class="an-trend-line" d="${linePath}"/>
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
  const cols = [], months = [];
  const cur = new Date(start);
  let prevMonth = -1;
  for (let w = 0; w < weeks; w++) {
    // Label a column with its month name when the month rolls over.
    const m = cur.getMonth();
    months.push(`<span class="an-heat-mcol">${m !== prevMonth ? cur.toLocaleDateString('en-US', { month: 'short' }) : ''}</span>`);
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
      const onclick = future ? '' : ` onclick="anJumpToDay('${ds}')"`;
      col += future
        ? `<span class="an-heat-cell ${cls}" aria-hidden="true"></span>`
        : `<button type="button" class="an-heat-cell ${cls}" title="${title}" aria-label="${title}"${onclick}></button>`;
      cur.setDate(cur.getDate() + 1);
    }
    cols.push(`<div class="an-heat-col">${col}</div>`);
  }
  const wd = ['', 'Mon', '', 'Wed', '', 'Fri', ''].map(l => `<span class="an-heat-wd">${l}</span>`).join('');
  return `
    <div class="an-heat-months">${months.join('')}</div>
    <div class="an-heat-body">
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
  subs.forEach(s => {
    const cost = parseFloat(String(s.cost).replace(/[^0-9.]/g, '')) || 0;
    if (!cost) return;
    const c = s.currency || 'USD';
    cur[c] = cur[c] || { monthly: 0, yearly: 0 };
    if (s.billingCycle === 'YEARLY')      { cur[c].yearly += cost;       cur[c].monthly += cost / 12; }
    else if (s.billingCycle === 'MONTHLY'){ cur[c].monthly += cost;      cur[c].yearly  += cost * 12; }
    else { cur[c].yearly += cost; cur[c].monthly += cost / 12; }   // Custom → treat as yearly
  });
  const entries = Object.entries(cur);
  document.getElementById('an-spend-sub').textContent = `${subs.length} subscription${subs.length === 1 ? '' : 's'}`;
  if (!entries.length) { el.innerHTML = `<div class="an-empty">No subscription costs recorded.</div>`; return; }
  el.innerHTML = entries.map(([c, v]) => `
    <div class="an-spend-row">
      <span class="an-spend-cur">${esc(c)}</span>
      <span class="an-spend-vals"><b>${v.monthly.toFixed(0)}</b> / mo &nbsp;·&nbsp; <b>${v.yearly.toFixed(0)}</b> / yr</span>
    </div>`).join('');
}

// Export the current analytics view to PDF (light theme, self-contained HTML).
async function exportAnalyticsPDF() {
  const css = [...document.styleSheets].flatMap(s => {
    try { return [...s.cssRules].map(r => r.cssText); } catch { return []; }
  }).join('\n');
  const { label } = anRange();
  const body = document.getElementById('an-scroll').innerHTML;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src data:">
    <style>${css}
      body { font-family:'Segoe UI',Arial,sans-serif; background:#fff; padding:28px 32px; display:block; }
      .an-report-title { font-size:20px; font-weight:700; color:#2a2722; margin-bottom:4px; }
      .an-report-sub { font-size:12px; color:#8a857c; margin-bottom:20px; }
    </style></head>
    <body>
      <div class="an-report-title">Analytics — ${esc(label)}</div>
      <div class="an-report-sub">Cooperation Tools · generated ${new Date().toLocaleString('en-US')}</div>
      ${body}
    </body></html>`;
  const res = await window.api.exportPDF(html, `analytics-${fmt(new Date())}.pdf`);
  if (res && res.ok) toast('PDF saved');
  else if (res && res.error) toast('PDF failed: ' + res.error);
}

// ── Backup Data choice menu (sidebar 💾) ──
// The sidebar button now opens a small choice — a full backup (Milestone 8,
// everything the app owns) or the original database-only save-dialog flow —
// instead of jumping straight to one of them. Rendered once at boot.
function renderBackupChoiceMenu() {
  const menu = document.getElementById('backup-choice-menu');
  if (!menu) return;
  menu.innerHTML = '';
  const full = document.createElement('button');
  full.innerHTML = '<span>Full backup to Desktop</span>';
  full.addEventListener('click', () => { menu.classList.remove('open'); runFullBackup(); });
  const dbOnly = document.createElement('button');
  dbOnly.innerHTML = '<span>Database only…</span>';
  dbOnly.addEventListener('click', () => { menu.classList.remove('open'); backupDatabase(); });
  menu.appendChild(full);
  menu.appendChild(dbOnly);
}

// ── Full Backup (Milestone 8) ──
// Captures the DB + projects/ + company_documents/ + knowledge_hub/ + backups/ into one new
// timestamped Desktop folder. Shared by the sidebar menu and the Settings ->
// Maintenance card; `btnId` lets each caller show its own loading state.
async function runFullBackup(btnId) {
  const btn = btnId ? document.getElementById(btnId) : null;
  const orig = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Backing up…'; }
  let res;
  try { res = await window.api.fullBackup(); }
  catch { res = { ok: false, error: 'failed' }; }
  if (btn) { btn.disabled = false; btn.textContent = orig; }
  if (res && res.ok) {
    toast(`Full backup saved to ${res.path}`, {
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
      const res = await window.api.restoreSelectedFullBackup();
      if (!res?.ok) {
        toast(res?.error || 'Full restore failed');
        restoreBtn.disabled = false;
        restoreBtn.textContent = 'Restore Everything Now';
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
  box.appendChild(input);
  box.appendChild(restoreBtn);
  box.appendChild(cancelBtn);
  host.appendChild(box);
  input.focus();
}

// ── Database backup ──
async function backupDatabase() {
  const btn = document.getElementById('backup-btn');
  const orig = btn.innerHTML;
  let res;
  try { res = await window.api.backupDatabase(); } catch { res = { ok: false, error: 'failed' }; }
  if (res?.ok) btn.innerHTML = '<span class="nav-icon">' + ic('circle-check') + '</span>Backed up';
  else if (res?.error) btn.innerHTML = '<span class="nav-icon">' + ic('triangle-alert') + '</span>Failed';
  else return;   // user canceled the save dialog
  setTimeout(() => { btn.innerHTML = orig; }, 2200);
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

function addInterval(dateStr, cycle) {
  const d = new Date(dateStr + 'T00:00:00');
  if (cycle === 'MONTHLY') d.setMonth(d.getMonth() + 1);
  else if (cycle === 'YEARLY') d.setFullYear(d.getFullYear() + 1);
  else return '';
  return fmt(d);
}

// ── Subscriptions: render ──
function renderSubscriptions() {
  const tbody = document.getElementById('sub-tbody');
  const table = document.getElementById('sub-table');
  const empty = document.getElementById('sub-empty-state');
  tbody.innerHTML = '';

  if (subscriptions.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }
  table.style.display = '';
  empty.style.display = 'none';

  const sorted = subscriptions.slice().sort((a, b) => {
    const da = daysUntil(a.renewalDate), db = daysUntil(b.renewalDate);
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  }).filter(s => textMatch([s.name, s.cost, s.currency, lkLabel('BILLING_CYCLE', s.billingCycle), s.endDate, s.renewalDate], subFilter));

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="no-matches">No matches</td></tr>';
    return;
  }

  sorted.forEach(sub => {
    const tr = document.createElement('tr');
    tr.dataset.subId = sub.id;   // Milestone 11 — palette deep-link scroll+highlight target

    tr.appendChild(textCell(sub.name));

    const costSpan = document.createElement('span');
    costSpan.className = 'sub-cost';
    const costNum = parseFloat(sub.cost);
    const costText = isNaN(costNum) ? sub.cost : costNum.toFixed(2);
    costSpan.textContent = (sub.currency || 'USD') + ' ' + costText;
    tr.appendChild(cellWrap(costSpan, 'cell'));

    tr.appendChild(textCell(lkLabel('BILLING_CYCLE', sub.billingCycle)));
    tr.appendChild(textCell(sub.endDate || '—'));
    tr.appendChild(textCell(sub.renewalDate || '—'));

    const daysLeft = daysUntil(sub.renewalDate);
    const badge = document.createElement('span');
    badge.className = 'renew-badge ' + renewClass(daysLeft);
    badge.textContent = renewLabel(daysLeft);
    tr.appendChild(cellWrap(badge, 'cell'));

    const acts = document.createElement('div');
    acts.className = 'row-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'row-btn'; editBtn.innerHTML = ic('pencil');
    editBtn.title = 'Edit'; editBtn.addEventListener('click', () => openSubModal(sub.id));

    const delBtn = document.createElement('button');
    delBtn.className = 'row-btn del'; delBtn.innerHTML = ic('trash-2');
    delBtn.title = 'Delete';
    const restore = () => { acts.innerHTML = ''; acts.appendChild(editBtn); acts.appendChild(delBtn); };
    delBtn.addEventListener('click', () => showDeleteConfirm(acts, () => {
      const removeIdx = subscriptions.indexOf(sub);
      const removed = subscriptions.splice(removeIdx, 1)[0];
      showSubUndoToast(removed, removeIdx);
      renderSubscriptions(); autoSaveSubscriptions();
    }, restore));

    acts.appendChild(editBtn); acts.appendChild(delBtn);
    tr.appendChild(cellWrap(acts, 'cell'));

    tbody.appendChild(tr);
  });
}

// ── Subscriptions: undo ──
function showSubUndoToast(sub, idx) {
  undoSubscription = { sub, idx };
  clearTimeout(_undoSubTimer);
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
  const { sub, idx } = undoSubscription;
  subscriptions.splice(Math.min(idx, subscriptions.length), 0, Object.assign({}, sub));
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
