// ══ CLIENTS — VPN Connectivity + Server Information per COMPANY lookup ═════
// No standalone clients table: the roster IS the active COMPANY lookup
// catalog (Settings → Companies). This module only adds two small per-user
// child record types (VPN connections, servers) keyed to a company id, shown
// via a Projects-style list+detail view (list = card grid, detail = two
// editable sub-list sections).
let clientsList = [];
let clientsLoaded = false;
let clientRecordFilter = '';  // matches within each client's own records (auth/servers/internal)
let currentClient = null;       // Client (from clients:get) shown in the detail view
let clientVpnEditId = null;      // null = create mode in the Auth modal
let clientServerEditId = null;   // null = create mode in the Server modal
let clientInternalEditId = null; // null = create mode in the Internal System modal
let clientGroupRenameKind = null;    // 'server' | 'internal' — which section's group is being renamed
let clientGroupRenameOldName = null; // the group's current systemName
let clientNewGroupKind = null;       // 'server' | 'internal' — which section's "+ New Group" modal is open

// Detail-view search (per human-identifying fields only — never credentials)
// + one active workspace tab. Reset per client on open; preserved across an
// in-place reload (post-CRUD refresh of the same client).
let clientDetailSearch = '';
// This client's Finance profile + summary, or null when it has none. Loaded on
// demand (the Finance tab is the only thing that needs it) and cleared whenever
// a different client is opened.
let clientFinance = null;
let clientFinanceLoadedFor = null;
const CLIENT_DETAIL_TYPES = [
  { key: 'overview',  label: 'Overview' },
  { key: 'projects',  label: 'Projects' },
  { key: 'finance',   label: 'Finance' },
  { key: 'auth',      label: 'Access' },
  { key: 'servers',   label: 'Servers' },
  { key: 'internal',  label: 'Systems' },
];
let clientDetailTab = 'overview';

// Every active COMPANY lookup is automatically a Client. Settings can change
// that catalog while this module is not visible, so discard the cached roster
// after a catalog save and let the next Clients visit load the current list.
function invalidateClientsCatalog() {
  clientsList = [];
  clientsLoaded = false;
  currentClient = null;
}

function initClientsModule() {
  showClientsListView();
  // Projects are shown inside each client's detail (and counted on the list
  // cards) since the Clients Projects page was merged in — make sure the shared
  // projectsList is loaded; loadProjectsList() re-renders this view when it lands.
  if (!projectsLoaded) loadProjectsList();
  if (!clientsLoaded) loadClientsList();
  else renderClientsList();
}

async function loadClientsList() {
  const grid = document.getElementById('clients-grid');
  if (!grid.childElementCount) { grid.style.display = ''; showSkeleton(grid, 'cards', 3); }
  let list;
  try { list = await window.api.listClients(); }
  catch { toast('Could not load clients'); return; }
  clientsList = Array.isArray(list) ? list : [];
  clientsLoaded = true;
  renderClientsList();
}

function applyClientRecordFilter() {
  clientRecordFilter = (document.getElementById('clients-records-filter').value || '').toLowerCase().trim();
  renderClientsList();
}

function showClientsListView() {
  document.getElementById('clients-detail-view').style.display = 'none';
  document.getElementById('clients-list-view').style.display = '';
}
function showClientDetailView() {
  document.getElementById('clients-list-view').style.display = 'none';
  document.getElementById('clients-detail-view').style.display = '';
}

function buildClientCard(c, projectCount) {
  const card = pjMk('div', 'pj-card');
  card.addEventListener('click', () => openClientDetail(c.id));

  const head = pjMk('div', 'pj-card-head');
  const identity = pjMk('div', 'client-card-identity');
  identity.appendChild(pjMk('div', 'pj-card-name', companyDisplayName(c, false) || 'Untitled'));
  head.appendChild(identity);
  if (c.code) head.appendChild(pjMk('span', 'client-code-badge', c.code));
  card.appendChild(head);

  const foot = pjMk('div', 'pj-card-foot');
  const count = pjMk('span', 'pj-card-count');
  count.innerHTML = ic('zap');
  count.appendChild(document.createTextNode(
    c.vpnCount + ' auth' + ' · ' + c.serverCount + ' server' + (c.serverCount === 1 ? '' : 's')
    + ' · ' + c.internalSystemCount + ' internal'
    + ' · ' + (projectCount || 0) + ' project' + (projectCount === 1 ? '' : 's')));
  foot.appendChild(count);
  const open = pjMk('span', 'pj-card-open', 'Open');
  open.insertAdjacentHTML('beforeend', ic('chevron-right'));
  foot.appendChild(open);
  card.appendChild(foot);

  return card;
}

// Per-company project count (first-linked-company grouping, see cpjPrimaryCompany)
// — used for the list-card badge and reused wherever a client's project tally
// is needed. Reads the shared projectsList (empty until loadProjectsList lands).
function clientProjectCounts() {
  const counts = new Map();
  projectsList.forEach(p => {
    const co = cpjPrimaryCompany(p);
    if (co) counts.set(co.id, (counts.get(co.id) || 0) + 1);
  });
  return counts;
}

// List view: an empty search box shows the usual card grid; typing in it
// switches to a flat table of every matching record (across all clients),
// built from each client's `records` (see listClients() in db.js).
function renderClientsList() {
  const grid    = document.getElementById('clients-grid');
  const results = document.getElementById('clients-search-results');
  const empty   = document.getElementById('clients-empty-state');
  grid.innerHTML = '';
  results.innerHTML = '';

  if (clientsList.length === 0) {
    grid.style.display = 'none';
    results.style.display = 'none';
    empty.hidden = false;
    empty.querySelector('p').innerHTML = 'No companies yet — add one in <strong>Settings → Companies</strong>';
    return;
  }

  const q = clientRecordFilter;
  if (!q) {
    results.style.display = 'none';
    grid.style.display = '';
    empty.hidden = true;
    const projCounts = clientProjectCounts();
    clientsList.forEach(c => grid.appendChild(buildClientCard(c, projCounts.get(c.id) || 0)));
    return;
  }

  grid.style.display = 'none';
  const matches = [];
  clientsList.forEach(c => {
    if (textMatch([c.code, c.nameEn, c.nameAr, c.label], q)) {
      // Search still matches across both languages above, but the result shows
      // only the current-language name (via companyDisplayName) plus the code.
      matches.push({ companyId: c.id, companyLabel: companyDisplayName(c, false), type: 'profile', typeLabel: 'Client Profile', name: companyDisplayName(c), detail: c.code || '', fields: [] });
    }
    (c.records || []).forEach(r => {
      if (textMatch(r.fields, q)) matches.push({ companyId: c.id, companyLabel: companyDisplayName(c, false), ...r });
    });
  });

  if (matches.length === 0) {
    results.style.display = 'none';
    empty.hidden = false;
    empty.querySelector('p').textContent = 'No records match your search';
    return;
  }
  empty.hidden = true;
  results.style.display = '';
  renderClientSearchResults(matches, q);
}

// Renders the records-search results table: one row per matched record
// (across every client), clicking a row opens that client's detail view
// with the same search term preset so the match is already visible there.
function renderClientSearchResults(matches, q) {
  const host = document.getElementById('clients-search-results');
  host.innerHTML = '';

  const summary = pjMk('div', 'cl-search-summary',
    matches.length + ' record' + (matches.length === 1 ? '' : 's') + ' matched');
  host.appendChild(summary);

  const table = document.createElement('table');
  table.className = 'cl-search-table';
  table.innerHTML = '<thead><tr><th>Client</th><th>Type</th><th>Name</th><th>Details</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');

  matches.forEach(m => {
    const tr = document.createElement('tr');
    tr.addEventListener('click', () => m.type === 'profile' ? openClientDetail(m.companyId) : openClientRecordInfoModal(m, q));

    const tdClient = document.createElement('td');
    tdClient.innerHTML = '<div class="cell"><strong>' + esc(m.companyLabel) + '</strong></div>';
    tr.appendChild(tdClient);

    const tdType = document.createElement('td');
    tdType.innerHTML = '<div class="cell"><span class="cl-type-pill">' + esc(m.typeLabel) + '</span></div>';
    tr.appendChild(tdType);

    const tdName = document.createElement('td');
    tdName.innerHTML = '<div class="cell">' + esc(m.name) + '</div>';
    tr.appendChild(tdName);

    const tdDetail = document.createElement('td');
    tdDetail.innerHTML = '<div class="cell cell-muted">' + esc(m.detail || '') + '</div>';
    tr.appendChild(tdDetail);

    const tdOpen = document.createElement('td');
    tdOpen.innerHTML = '<div class="cell cell-right"><span class="pj-card-open" style="opacity:1;transform:none">View' + ic('eye') + '</span></div>';
    tr.appendChild(tdOpen);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  host.appendChild(table);
}

// `presetSearch`, when given (drilling in from the list view's records-search
// results table), seeds the detail view's own search box with the same query
// instead of resetting it, so the matched record is already visible/highlighted.
async function openClientDetail(companyId, presetSearch) {
  let client;
  try { client = await window.api.getClient(companyId); }
  catch { toast('Could not open client'); return; }
  if (!client) { toast('Client not found'); return; }
  currentClient = client;
  if (clientFinanceLoadedFor !== client.id) { clientFinance = null; clientFinanceLoadedFor = null; }
  clientDetailSearch = presetSearch || '';
  clientDetailTab = presetSearch ? 'overview' : (uiState.filters.clients?.tab || 'overview');
  if (!CLIENT_DETAIL_TYPES.some(t => t.key === clientDetailTab)) clientDetailTab = 'overview';
  showClientDetailView();
  renderClientDetail(client);
  // The Projects section reads the shared projectsList; load it if it isn't yet
  // (loadProjectsList re-renders the open client's sections when it lands).
  if (!projectsLoaded) loadProjectsList();
  uiState.filters.clients = { companyId, tab: clientDetailTab };
  saveUiStateDebounced();
}
async function reloadCurrentClient() {
  if (!currentClient) return;
  let client;
  try { client = await window.api.getClient(currentClient.id); }
  catch { return; }
  if (!client) { backToClientsList(); return; }
  currentClient = client;
  renderClientDetail(client);
}

// ── Record info popup (opened from a records-search result row) ──
// One field-def list per record `type`, mirroring db.js's *_HISTORY_FIELDS
// (same columns, same 'sensitive' flag) but keyed to the camelCase shape
// `clients:get` actually returns. Every non-empty field is a click-to-copy row.
const CLIENT_RECORD_INFO_FIELDS = {
  auth: [
    ['connectionName', 'Connection Name'], ['vpnType', 'Type'], ['endpoint', 'Endpoint'], ['port', 'Port'],
    ['username', 'Username'], ['password', 'Password', true], ['expiryDate', 'Expiry Date'],
    ['credentialLocation', 'Credential Location'], ['notes', 'Notes'],
  ],
  servers: [
    ['systemName', 'System'], ['roleLabel', 'Role'], ['environment', 'Environment'],
    ['host', 'Host (IP)'], ['hostname', 'Hostname'], ['os', 'Operating System'],
    ['username', 'Username'], ['password', 'Password', true], ['notes', 'Notes'],
  ],
  internal: [
    ['name', 'Name'], ['url', 'URL'], ['username', 'Username'], ['password', 'Password', true],
    ['systemName', 'System Name'], ['environment', 'Environment'], ['companyCode', 'Company Code'],
    ['secretKey', 'Secret Key', true], ['expiryDate', 'Expiry Date'], ['role', 'Role'], ['notes', 'Notes'],
  ],
};
const CLIENT_RECORD_ARRAY_KEY = {
  auth: 'vpnConnections', servers: 'servers', internal: 'internalSystems',
};
let _clientRecordInfoCurrent = null; // { companyId, presetSearch } — for the "Open Client" footer button

// `record` is a row from the records-search results table ({companyId, companyLabel,
// type, typeLabel, name, id, ...}); `presetSearch` is carried through to "Open Client".
async function openClientRecordInfoModal(record, presetSearch) {
  _clientRecordInfoCurrent = { companyId: record.companyId, presetSearch: presetSearch || '' };
  document.getElementById('client-record-info-title').dataset.userContent = '';
  document.getElementById('client-record-info-title').textContent = record.name || 'Record';
  document.getElementById('client-record-info-sub').textContent = record.companyLabel + ' · ' + record.typeLabel;
  const list = document.getElementById('client-record-info-list');
  list.innerHTML = '<div class="cp-records-empty">Loading…</div>';
  document.getElementById('client-record-info-overlay').classList.add('open');

  let client;
  try { client = await window.api.getClient(record.companyId); }
  catch { list.innerHTML = '<div class="cp-records-empty">Could not load record.</div>'; return; }
  const arr = client ? client[CLIENT_RECORD_ARRAY_KEY[record.type]] : null;
  const full = Array.isArray(arr) ? arr.find(r => r.id === record.id) : null;
  if (!full) { list.innerHTML = '<div class="cp-records-empty">This record no longer exists.</div>'; return; }

  list.innerHTML = '';
  (CLIENT_RECORD_INFO_FIELDS[record.type] || []).forEach(([key, label, sensitive]) => {
    const value = full[key];
    const row = pjMk('div', 'cl-info-row' + (value ? '' : ' not-copyable'));
    const main = pjMk('div', 'cl-info-main');
    main.appendChild(pjMk('div', 'cl-info-label', label));
    main.appendChild(pjMk('div', 'cl-info-value' + (value ? '' : ' empty'), value ? (sensitive ? '••••••••' : value) : '(empty)'));
    row.appendChild(main);
    if (value) {
      row.appendChild(pjMk('div', 'cl-info-copy-hint', 'Click to copy'));
      row.addEventListener('click', () => copyClientFieldValue(value, label));
    }
    list.appendChild(row);
  });

  // Sub-Services (internal systems only) — a structured list, not a flat field;
  // each sub-endpoint's URL is its own copy target.
  if (record.type === 'internal' && Array.isArray(full.subServices) && full.subServices.length) {
    const row = pjMk('div', 'cl-info-row not-copyable');
    const main = pjMk('div', 'cl-info-main');
    main.appendChild(pjMk('div', 'cl-info-label', 'Sub-Services'));
    const sub = pjMk('div', 'cl-info-subrow');
    full.subServices.forEach(s => {
      const line = pjMk('div', 'cl-info-subrow-line');
      line.appendChild(pjMk('span', 'cl-info-value', (s.label || 'Endpoint') + ': ' + s.url));
      line.appendChild(pjMk('span', 'cl-info-copy-hint', 'Click to copy'));
      line.addEventListener('click', (e) => { e.stopPropagation(); copyClientFieldValue(s.url, s.label || 'Endpoint'); });
      sub.appendChild(line);
    });
    main.appendChild(sub);
    row.appendChild(main);
    list.appendChild(row);
  }
}
function closeClientRecordInfoModal() {
  document.getElementById('client-record-info-overlay').classList.remove('open');
  _clientRecordInfoCurrent = null;
}
function clientRecordInfoOverlayClick(e) {
  if (e.target === document.getElementById('client-record-info-overlay')) closeClientRecordInfoModal();
}
function openClientFromRecordInfo() {
  if (!_clientRecordInfoCurrent) return;
  const { companyId, presetSearch } = _clientRecordInfoCurrent;
  closeClientRecordInfoModal();
  openClientDetail(companyId, presetSearch);
}

async function copyClientFieldValue(value, label) {
  const text = String(value ?? '');
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    let copied = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      copied = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch { copied = false; }
    if (!copied) { toast('Could not copy to clipboard'); return; }
  }
  toast((label || 'Value') + ' copied to clipboard');
}
function backToClientsList() {
  currentClient = null;
  showClientsListView();
  loadClientsList();
  uiState.filters.clients = {};
  saveUiStateDebounced();
}

function renderClientDetail(c) {
  const host = document.getElementById('clients-detail-view');
  host.innerHTML = '';

  const crumbs = pjMk('div', 'pj-crumbs');
  const crumbRoot = pjMk('button', 'pj-crumb-link', 'Clients');
  crumbRoot.addEventListener('click', backToClientsList);
  crumbs.appendChild(crumbRoot);
  const sep = pjMk('span', 'pj-crumb-sep');
  sep.innerHTML = ic('chevron-right');
  crumbs.appendChild(sep);
  crumbs.appendChild(pjMk('span', 'pj-crumb-here', companyDisplayName(c, false) || 'Untitled'));
  host.appendChild(crumbs);

  const head = pjMk('div', 'pj-detail-head');
  const titleBlock = pjMk('div', 'client-detail-identity');
  titleBlock.appendChild(pjMk('div', 'pj-detail-title', companyDisplayName(c, false) || 'Untitled'));
  // Show only the language-neutral code as the secondary line — never the
  // other language's name (Arabic mode shows Arabic only, English shows English).
  if (c.code) titleBlock.appendChild(pjMk('div', 'client-detail-alt', c.code));
  head.appendChild(titleBlock);
  host.appendChild(head);

  // Search + workspace-tab toolbar. Kept out of the re-rendered section
  // container so typing in the search box never rebuilds (and loses focus
  // on) the input itself — only #client-detail-sections is rebuilt below.
  const toolbar = pjMk('div', 'cl-detail-toolbar');
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.id = 'client-detail-search';
  searchInput.className = 'mod-search cl-detail-search';
  searchInput.placeholder = "Search this client's records…";
  searchInput.value = clientDetailSearch;
  searchInput.addEventListener('input', applyClientDetailSearch);
  toolbar.appendChild(searchInput);
  const typeChips = pjMk('div', 'seg-ctl workspace-tabs');
  typeChips.setAttribute('aria-label', 'Client workspace');
  const projectCount = projectsList.filter(p => cpjPrimaryCompany(p)?.id === c.id).length;
  const counts = {
    projects: projectCount,
    auth: Array.isArray(c.vpnConnections) ? c.vpnConnections.length : 0,
    servers: Array.isArray(c.servers) ? c.servers.length : 0,
    internal: Array.isArray(c.internalSystems) ? c.internalSystems.length : 0,
  };
  CLIENT_DETAIL_TYPES.forEach(t => {
    const count = t.key === 'overview' ? '' : ` (${counts[t.key] || 0})`;
    const btn = pjMk('button', 'seg-btn' + (clientDetailTab === t.key ? ' active' : ''), t.label + count);
    btn.type = 'button';
    btn.addEventListener('click', () => setClientDetailTab(t.key));
    typeChips.appendChild(btn);
  });
  toolbar.appendChild(typeChips);
  host.appendChild(toolbar);

  const sectionsHost = pjMk('div', 'cl-detail-sections');
  sectionsHost.id = 'client-detail-sections';
  host.appendChild(sectionsHost);

  renderClientDetailSections(c);
}

// Rebuilds only the record sections (not the toolbar/search input above),
// filtered by `clientDetailSearch` (human-identifying fields only — never
// password/secretKey, per the no-credential-search rule) and the active detail tab.
// Called on every search keystroke / workspace-tab switch, and once from
// renderClientDetail on open/reload.
// Finance data for the open client, fetched once per client. Finance keeps its
// own per-user roster keyed to a company id (migration 056), so a client that
// has never been invoiced simply has no row — not an error.
async function loadClientFinance(companyId) {
  if (clientFinanceLoadedFor === companyId) return;
  clientFinanceLoadedFor = companyId;
  clientFinance = null;
  try {
    const clients = await window.api.listFinanceClients();
    const match = (clients || []).find(fc => fc.companyId === companyId);
    if (!match) return;
    const [summary, contracts, invoices] = await Promise.all([
      window.api.getFinanceClientSummary(match.id),
      window.api.listFinanceContracts(match.id),
      window.api.listFinanceInvoices(match.id),
    ]);
    clientFinance = { client: match, summary, contracts, invoices };
  } catch { clientFinance = null; }
  if (currentClient && currentClient.id === companyId) renderClientDetailSections(currentClient);
}

function renderClientDetailSections(c) {
  const host = document.getElementById('client-detail-sections');
  if (!host) return;
  host.innerHTML = '';

  const q = clientDetailSearch;
  const allServers = Array.isArray(c.servers) ? c.servers : [];
  const allInternalSystems = Array.isArray(c.internalSystems) ? c.internalSystems : [];
  const vpns = Array.isArray(c.vpnConnections) ? c.vpnConnections : [];

  if (!q && clientDetailTab === 'overview') {
    renderClientOverview(host, c, allServers, allInternalSystems, vpns);
    return;
  }
  const showSection = key => !!q || clientDetailTab === key;

  // ── Finance section (this client's contracts and invoices, from the Finance
  // module's own data layer). Read-only here: it is a window into Finance, not
  // a second place to edit it, so every action routes into the module itself. ──
  if (showSection('finance')) {
    const finSec = pjMk('div', 'pj-section');
    const finHead = pjMk('div', 'pj-section-head');
    const finTitle = pjMk('div', 'pj-section-title');
    finTitle.innerHTML = ic('credit-card');
    finTitle.appendChild(document.createTextNode('Finance'));
    finHead.appendChild(finTitle);
    const finActions = pjMk('div', 'pj-section-actions');
    const openBtn = pjMk('button', 'btn');
    openBtn.innerHTML = ic('arrow-right') + ' Open in Finance';
    openBtn.addEventListener('click', () => {
      switchModule('finance');
      if (clientFinance) openFinanceClientDetail(clientFinance.client.id);
    });
    finActions.appendChild(openBtn);
    finHead.appendChild(finActions);
    finSec.appendChild(finHead);

    if (clientFinanceLoadedFor !== c.id) {
      finSec.appendChild(pjMk('div', 'cp-records-empty', 'Loading…'));
      loadClientFinance(c.id);
    } else if (!clientFinance) {
      finSec.appendChild(pjMk('div', 'cp-records-empty', 'This client has no financial records yet.'));
    } else {
      // Reuses the Overview tab's own stat-card grid rather than a parallel
      // set of Finance-only classes, so the two tabs stay visually identical.
      const sum = clientFinance.summary || {};
      const grid = pjMk('div', 'client-overview-grid');
      [
        ['Contracts', String(sum.contractCount || 0)],
        ['Invoiced', finMoney(sum.invoicedMinor)],
        ['Paid', finMoney(sum.paidMinor)],
        ['Outstanding', finMoney(sum.outstandingMinor)],
      ].forEach(([label, value]) => {
        const card = pjMk('div', 'client-overview-card');
        card.appendChild(pjMk('b', '', value));
        card.appendChild(pjMk('span', '', label));
        grid.appendChild(card);
      });
      finSec.appendChild(grid);

      const contracts = (clientFinance.contracts || []).filter(k => textMatch([k.title, k.ref, k.status], q));
      if (!contracts.length) {
        finSec.appendChild(pjMk('div', 'cp-records-empty',
          clientFinance.contracts.length ? 'No contracts match your search.' : 'No contracts yet.'));
      } else {
        contracts.forEach(k => {
          const row = pjMk('div', 'cl-item-card');
          const main = pjMk('div', 'cl-item-main');
          const name = pjMk('div', 'cl-item-title', k.title || 'Untitled');
          name.dataset.userContent = '';
          main.appendChild(name);
          main.appendChild(pjMk('div', 'cl-item-meta',
            [k.ref, k.statusLabelEn || k.status, k.endDate ? 'ends ' + k.endDate : ''].filter(Boolean).join(' · ')));
          row.appendChild(main);
          row.addEventListener('click', () => {
            switchModule('finance');
            openFinanceClientDetail(clientFinance.client.id);
          });
          finSec.appendChild(row);
        });
      }
    }
    host.appendChild(finSec);
  }

  // ── Projects section (this client's own projects — merged in from the retired
  // Clients Projects page; a project is grouped under its FIRST linked company,
  // so it appears under exactly one client. Cards reuse buildProjectCard and
  // click through to the single-project detail view via openProjectById). ──
  if (showSection('projects')) {
    const projects = projectsList.filter(p => {
      const co = cpjPrimaryCompany(p);
      return co && co.id === c.id;
    });
    const shownProjects = projects.filter(p => textMatch(
      [p.name, ...(p.systems || []).map(s => s.label), pjStatusLabel(p.status), p.description], q));
    const pjSec = pjMk('div', 'pj-section');
    const pjHead = pjMk('div', 'pj-section-head');
    const pjTitle = pjMk('div', 'pj-section-title');
    pjTitle.innerHTML = ic('briefcase');
    pjTitle.appendChild(document.createTextNode('Projects (' + projects.length + ')'));
    pjHead.appendChild(pjTitle);
    const pjActions = pjMk('div', 'pj-section-actions');
    const pjAddBtn = pjMk('button', 'btn primary');
    pjAddBtn.innerHTML = ic('plus') + ' New Project';
    pjAddBtn.addEventListener('click', () => openProjectModal());
    pjActions.appendChild(pjAddBtn);
    pjHead.appendChild(pjActions);
    pjSec.appendChild(pjHead);
    if (projects.length === 0) pjSec.appendChild(pjMk('div', 'cp-records-empty', 'No projects for this client yet.'));
    else if (shownProjects.length === 0) pjSec.appendChild(pjMk('div', 'cp-records-empty', 'No projects match your search.'));
    else {
      const pjGrid = pjMk('div', 'pj-grid');
      shownProjects.forEach(p => pjGrid.appendChild(buildProjectCard(p, openProjectById)));
      pjSec.appendChild(pjGrid);
    }
    host.appendChild(pjSec);
  }

  // ── Auth section (VPN, PAM, and other login/connection records) ──
  if (showSection('auth')) {
    const vpnSec = pjMk('div', 'pj-section');
    const vHead = pjMk('div', 'pj-section-head');
    const vTitle = pjMk('div', 'pj-section-title');
    vTitle.innerHTML = ic('zap');
    vTitle.appendChild(document.createTextNode('Auth (' + vpns.length + ')'));
    vHead.appendChild(vTitle);
    const vActions = pjMk('div', 'pj-section-actions');
    const vAddBtn = pjMk('button', 'btn primary');
    vAddBtn.innerHTML = ic('plus') + ' Add Connection';
    vAddBtn.addEventListener('click', () => openClientVpnModal());
    vActions.appendChild(vAddBtn);
    vHead.appendChild(vActions);
    vpnSec.appendChild(vHead);
    const shownVpns = vpns.filter(v => textMatch([v.connectionName, v.vpnType, v.endpoint], q));
    if (vpns.length === 0) vpnSec.appendChild(pjMk('div', 'cp-records-empty', 'No auth connections recorded yet.'));
    else if (shownVpns.length === 0) vpnSec.appendChild(pjMk('div', 'cp-records-empty', 'No auth connections match your search.'));
    else shownVpns.forEach(v => vpnSec.appendChild(buildClientVpnCard(v)));
    host.appendChild(vpnSec);
  }

  // ── Server Information section (servers sharing a System name are grouped
  // into a sub-card, split into one page per environment; the rest render flat) ──
  if (showSection('servers')) {
    const srvSec = pjMk('div', 'pj-section');
    const sHead = pjMk('div', 'pj-section-head');
    const sTitle = pjMk('div', 'pj-section-title');
    sTitle.innerHTML = ic('folder');
    sTitle.appendChild(document.createTextNode('Server Information (' + allServers.length + ')'));
    sHead.appendChild(sTitle);
    const sActions = pjMk('div', 'pj-section-actions');
    const sAddGroupBtn = pjMk('button', 'btn');
    sAddGroupBtn.innerHTML = ic('plus') + ' New Group';
    sAddGroupBtn.title = 'Group existing servers under a new (or existing) System name';
    sAddGroupBtn.addEventListener('click', () => openClientNewGroupModal('server'));
    sActions.appendChild(sAddGroupBtn);
    const sAddBtn = pjMk('button', 'btn primary');
    sAddBtn.innerHTML = ic('plus') + ' Add Server';
    sAddBtn.addEventListener('click', () => openClientServerModal());
    sActions.appendChild(sAddBtn);
    sHead.appendChild(sActions);
    srvSec.appendChild(sHead);
    // roleLabel joins the searchable fields now that Role is part of a server's
    // identity (migration 038) — searching "Applications" should find them.
    // `environment` is deliberately left out: "Production" matches most servers,
    // which is noise rather than a search.
    const shownServers = allServers.filter(s => textMatch([s.host, s.hostname, s.os, s.systemName, s.roleLabel], q));
    if (allServers.length === 0) {
      srvSec.appendChild(pjMk('div', 'cp-records-empty', 'No servers recorded yet.'));
    } else if (shownServers.length === 0) {
      srvSec.appendChild(pjMk('div', 'cp-records-empty', 'No servers match your search.'));
    } else {
      const { groups: serverGroups, ungrouped: ungroupedServers } = groupBySystemName(shownServers);
      serverGroups.forEach(g => srvSec.appendChild(buildSystemGroupCard(g, buildClientServerCard, 'server')));
      ungroupedServers.forEach(s => srvSec.appendChild(buildClientServerCard(s)));
    }
    host.appendChild(srvSec);
  }

  // ── Internal Systems section (portals sharing a System name are grouped
  // into a sub-card, split into one page per environment; the rest render flat) ──
  if (showSection('internal')) {
    const intSec = pjMk('div', 'pj-section');
    const iHead = pjMk('div', 'pj-section-head');
    const iTitle = pjMk('div', 'pj-section-title');
    iTitle.innerHTML = ic('layout-dashboard');
    iTitle.appendChild(document.createTextNode('Internal Systems (' + allInternalSystems.length + ')'));
    iHead.appendChild(iTitle);
    const iActions = pjMk('div', 'pj-section-actions');
    const iAddGroupBtn = pjMk('button', 'btn');
    iAddGroupBtn.innerHTML = ic('plus') + ' New Group';
    iAddGroupBtn.title = 'Group existing internal systems under a new (or existing) System name';
    iAddGroupBtn.addEventListener('click', () => openClientNewGroupModal('internal'));
    iActions.appendChild(iAddGroupBtn);
    const iAddBtn = pjMk('button', 'btn primary');
    iAddBtn.innerHTML = ic('plus') + ' Add System';
    iAddBtn.addEventListener('click', () => openClientInternalModal());
    iActions.appendChild(iAddBtn);
    iHead.appendChild(iActions);
    intSec.appendChild(iHead);
    const shownInternal = allInternalSystems.filter(s => textMatch([s.name, s.url, s.systemName], q));
    if (allInternalSystems.length === 0) {
      intSec.appendChild(pjMk('div', 'cp-records-empty', 'No internal systems recorded yet.'));
    } else if (shownInternal.length === 0) {
      intSec.appendChild(pjMk('div', 'cp-records-empty', 'No internal systems match your search.'));
    } else {
      const { groups: internalGroups, ungrouped: ungroupedInternal } = groupBySystemName(shownInternal);
      internalGroups.forEach(g => intSec.appendChild(buildSystemGroupCard(g, buildClientInternalSystemCard, 'internal')));
      ungroupedInternal.forEach(s => intSec.appendChild(buildClientInternalSystemCard(s)));
    }
    host.appendChild(intSec);
  }
}

function renderClientOverview(host, c, servers, internalSystems, vpns) {
  // Show only the active interface language's name (plus the language-neutral
  // code) — never both languages at once. Both stored names remain editable in
  // the Client Profile form under Settings.
  const profile = pjMk('div', 'client-profile-summary');
  [
    ['Company Code', c.code || '—'],
    ['Name', companyDisplayName(c, false) || c.label || '—'],
  ].forEach(([label, value]) => {
    const field = pjMk('div', 'client-profile-summary-field');
    field.appendChild(pjMk('span', '', label));
    const val = pjMk('b', '', value); val.dataset.userContent = ''; field.appendChild(val);
    profile.appendChild(field);
  });
  host.appendChild(profile);

  const projects = projectsList.filter(p => cpjPrimaryCompany(p)?.id === c.id);
  const grid = pjMk('div', 'client-overview-grid');
  [
    ['Projects', projects.length],
    ['Access records', vpns.length],
    ['Servers', servers.length],
    ['Internal systems', internalSystems.length],
  ].forEach(([label, count]) => {
    const card = pjMk('div', 'client-overview-card');
    card.appendChild(pjMk('b', '', String(count)));
    card.appendChild(pjMk('span', '', label));
    grid.appendChild(card);
  });
  host.appendChild(grid);

  const actions = pjMk('div', 'client-overview-actions');
  [
    ['plus', 'New Project', () => openProjectModal(), 'primary'],
    ['zap', 'Add Access', () => openClientVpnModal(), ''],
    ['server', 'Add Server', () => openClientServerModal(), ''],
    ['layout-dashboard', 'Add System', () => openClientInternalModal(), ''],
  ].forEach(([icon, label, run, emphasis]) => {
    const btn = pjMk('button', 'btn' + (emphasis ? ' ' + emphasis : ''));
    btn.type = 'button'; btn.innerHTML = ic(icon) + label; btn.addEventListener('click', run);
    actions.appendChild(btn);
  });
  host.appendChild(actions);

  const note = pjMk('div', 'pj-section');
  const title = pjMk('div', 'pj-section-title');
  title.innerHTML = ic('layers') + 'Workspace summary';
  note.appendChild(title);
  note.appendChild(pjMk('div', 'general-hint',
    'Use the tabs above to manage this client’s projects, access records, servers, and internal systems. Search spans every tab without searching passwords or secret keys.'));
  host.appendChild(note);
}

function applyClientDetailSearch() {
  clientDetailSearch = (document.getElementById('client-detail-search').value || '').toLowerCase().trim();
  renderClientDetailSections(currentClient);
}

function setClientDetailTab(key) {
  if (!CLIENT_DETAIL_TYPES.some(t => t.key === key)) key = 'overview';
  clientDetailTab = key;
  clientDetailSearch = '';
  if (currentClient) {
    uiState.filters.clients = { companyId: currentClient.id, tab: key };
    saveUiStateDebounced();
    renderClientDetail(currentClient);
  }
}

// "Updated 3 days ago" / "Updated today" / falls back to an absolute date
// past 30 days — reads the updatedAt (or createdAt) already returned by every
// client_* mapper in db.js; no schema/IPC change needed.
function clUpdatedLabel(record) {
  const iso = record?.updatedAt || record?.createdAt;
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  let label;
  if (diffDays <= 0) label = 'today';
  else if (diffDays === 1) label = '1 day ago';
  else if (diffDays < 7) label = diffDays + ' days ago';
  else if (diffDays < 30) { const w = Math.floor(diffDays / 7); label = w + (w === 1 ? ' week ago' : ' weeks ago'); }
  else label = d.toLocaleDateString();
  return 'Updated ' + label;
}

// Groups a single section's items (Servers, or Internal Systems) that share a
// non-empty System name into one entry per (systemName, environment) pair —
// e.g. "RabbitMQ" gets a Production page and a Test/UAT page. Items with no
// System name are returned in `ungrouped` and render flat as before.
const SYSTEM_ENV_ORDER = ['PRODUCTION', 'TEST', ''];
function groupBySystemName(items) {
  const groups = new Map();
  const ungrouped = [];
  items.forEach(item => {
    const raw = (item.systemName || '').trim();
    if (!raw) { ungrouped.push(item); return; }
    const key = raw.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: raw, envs: new Map() });
    const group = groups.get(key);
    const envKey = item.environment || '';
    if (!group.envs.has(envKey)) group.envs.set(envKey, { env: envKey, items: [] });
    group.envs.get(envKey).items.push(item);
  });
  const sortedGroups = Array.from(groups.values())
    .map(g => ({
      name: g.name,
      envs: Array.from(g.envs.values()).sort((a, b) => SYSTEM_ENV_ORDER.indexOf(a.env) - SYSTEM_ENV_ORDER.indexOf(b.env)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { groups: sortedGroups, ungrouped };
}

function buildSystemGroupCard(group, cardBuilder, kind) {
  const card = pjMk('div', 'cl-system-group');
  const titleRow = pjMk('div', 'cl-system-group-title');
  titleRow.appendChild(document.createTextNode(kind === 'server' ? lkLabel('SYSTEM', group.name) : group.name));
  const renameBtn = pjMk('button', 'cd-icon-btn');
  renameBtn.innerHTML = ic('pencil');
  // Servers group by a SYSTEM lookup, so the action is "move to another system"
  // rather than a rename (see openClientGroupRenameModal).
  renameBtn.title = kind === 'server' ? 'Move group to another system' : 'Rename group';
  renameBtn.addEventListener('click', () => openClientGroupRenameModal(kind, group.name));
  titleRow.appendChild(renameBtn);
  card.appendChild(titleRow);
  group.envs.forEach(e => {
    const envSec = pjMk('div', 'cl-system-env');
    e.items.forEach(item => envSec.appendChild(cardBuilder(item)));
    card.appendChild(envSec);
  });
  return card;
}

// ── System group modal — for internal systems, bulk-renames the free-text
// systemName tag on every record in the group. For servers (migration 039) a
// group IS a SYSTEM lookup, so it instead MOVES the group's servers onto another
// system; renaming the system itself belongs in Settings → Systems, which
// relabels it everywhere at once rather than only on this client's servers. ──
function openClientGroupRenameModal(kind, name) {
  clientGroupRenameKind = kind;
  clientGroupRenameOldName = name;
  const isServer = kind === 'server';
  document.getElementById('cgr-title').textContent = isServer ? 'Move System Group' : 'Rename System Group';
  document.getElementById('cgr-system-row').style.display = isServer ? '' : 'none';
  document.getElementById('cgr-name-row').style.display = isServer ? 'none' : '';
  if (isServer) fillIdentitySelect('cgr-system', 'SYSTEM', 'label', name, 'Select a system…', 'system');
  else document.getElementById('cgr-name').value = name;
  clearErrorsIn('#client-group-rename-modal');
  document.getElementById('client-group-rename-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById(isServer ? 'cgr-system' : 'cgr-name').focus(), 80);
}
function closeClientGroupRenameModal() {
  document.getElementById('client-group-rename-modal-overlay').classList.remove('open');
  clientGroupRenameKind = null;
  clientGroupRenameOldName = null;
}
function clientGroupRenameOverlayClick(e) {
  if (e.target === document.getElementById('client-group-rename-modal-overlay')) closeClientGroupRenameModal();
}
async function submitClientGroupRename() {
  clearErrorsIn('#client-group-rename-modal');
  const isServer = clientGroupRenameKind === 'server';
  const field = isServer ? 'cgr-system' : 'cgr-name';
  const newName = document.getElementById(field).value.trim();
  if (!newName) { markError(field); return; }
  let res;
  try {
    if (isServer) res = await window.api.renameClientServerSystemGroup(currentClient.id, clientGroupRenameOldName, newName);
    else res = await window.api.renameClientInternalSystemGroup(currentClient.id, clientGroupRenameOldName, newName);
  } catch { toast('Could not save group'); return; }
  // Moving a server group can land two servers on the same
  // System / Role / Environment — refused whole rather than half-applied.
  if (res && res.ok === false && res.error) { markError(field); toast(res.error); return; }
  closeClientGroupRenameModal();
  toast(isServer ? 'Group moved' : 'Group renamed');
  await reloadCurrentClient();
}

// ── "+ New Group" modal — folds a chosen set of EXISTING servers/internal systems
// into a new (or existing) System group; a group is just a shared systemName, so
// this is a bulk field assignment, not a create of a new entity. ──
function openClientNewGroupModal(kind) {
  clientNewGroupKind = kind;
  const isServer = kind === 'server';
  document.getElementById('client-new-group-modal-title').textContent = isServer ? 'New Server Group' : 'New System Group';
  const records = (isServer ? currentClient?.servers : currentClient?.internalSystems) || [];
  document.getElementById('cng-system-row').style.display = isServer ? '' : 'none';
  document.getElementById('cng-name-row').style.display = isServer ? 'none' : '';
  if (isServer) fillIdentitySelect('cng-system', 'SYSTEM', 'label', '', 'Select a system…', 'system');
  document.getElementById('cng-name').value = '';
  const list = document.getElementById('cng-list');
  list.innerHTML = '';
  const submitBtn = document.getElementById('client-new-group-modal-submit');
  if (!records.length) {
    list.appendChild(pjMk('div', 'cp-records-empty', isServer
      ? 'No servers recorded yet — add a server first, then group it here.'
      : 'No internal systems recorded yet — add one first, then group it here.'));
    submitBtn.disabled = true;
  } else {
    submitBtn.disabled = false;
    records.forEach(r => {
      const row = pjMk('div', 'cng-row');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = 'cng-item-' + r.id; cb.value = String(r.id);
      row.appendChild(cb);
      const label = pjMk('label', null, isServer ? serverIdentityText(r) : r.name);
      label.htmlFor = cb.id;
      row.appendChild(label);
      if (r.systemName) row.appendChild(pjMk('span', 'cng-row-group', 'in “' + r.systemName + '”'));
      list.appendChild(row);
    });
  }
  clearErrorsIn('#client-new-group-modal');
  document.getElementById('client-new-group-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('cng-name').focus(), 80);
}
function closeClientNewGroupModal() {
  document.getElementById('client-new-group-modal-overlay').classList.remove('open');
  clientNewGroupKind = null;
}
function clientNewGroupModalOverlayClick(e) {
  if (e.target === document.getElementById('client-new-group-modal-overlay')) closeClientNewGroupModal();
}
async function submitClientNewGroupModal() {
  clearErrorsIn('#client-new-group-modal');
  const isServer = clientNewGroupKind === 'server';
  const field = isServer ? 'cng-system' : 'cng-name';
  const name = document.getElementById(field).value.trim();
  if (!name) { markError(field); return; }
  const ids = Array.from(document.querySelectorAll('#cng-list input[type="checkbox"]:checked')).map(cb => Number(cb.value));
  if (!ids.length) { toast('Select at least one record to include'); return; }
  let res;
  try {
    if (isServer) res = await window.api.assignClientServerGroup(currentClient.id, ids, name);
    else res = await window.api.assignClientInternalGroup(currentClient.id, ids, name);
  } catch { toast('Could not create group'); return; }
  // Same identity clash as the move above: two picked servers sharing a
  // Role + Environment can't both sit under one System.
  if (res && res.ok === false && res.error) { markError(field); toast(res.error); return; }
  closeClientNewGroupModal();
  toast('Group created');
  await reloadCurrentClient();
}

// ── Field-edit confirmation + read-only history (shared across all 5 record types) ──
// Field-def lists mirror db.js's *_HISTORY_FIELDS (same labels), keyed by the
// camelCase API field name instead of the raw column name.
const VPN_CONFIRM_FIELDS = [
  ['connectionName', 'Connection Name'], ['vpnType', 'Type'], ['endpoint', 'Endpoint'],
  ['port', 'Port'], ['username', 'Username'], ['password', 'Password'],
  ['expiryDate', 'Expiry Date'], ['credentialLocation', 'Credential Location'], ['notes', 'Notes'],
];
const SERVER_CONFIRM_FIELDS = [
  ['host', 'Host (IP)'], ['environment', 'Environment'], ['os', 'Operating System'],
  ['hostname', 'Hostname'], ['username', 'Username'], ['password', 'Password'],
  ['systemName', 'System'],   // already a SYSTEM label on both sides of the diff
  ['role', 'Role', v => lkLabel('SERVER_ROLE', v)],
  ['notes', 'Notes'],
];
const DATABASE_CONFIRM_FIELDS = [
  ['name', 'Name'], ['engine', 'Engine'], ['host', 'Host'], ['port', 'Port'], ['username', 'Username'],
  ['password', 'Password'], ['version', 'Version'], ['credentialLocation', 'Credential Location'], ['notes', 'Notes'],
];
const EXTERNAL_CONFIRM_FIELDS = [
  ['name', 'Name'], ['url', 'URL'], ['companyCode', 'Company Code'], ['secretKey', 'Secret Key'],
  ['expiryDate', 'Expiry Date'], ['contact', 'Contact'], ['notes', 'Notes'],
];
const INTERNAL_CONFIRM_FIELDS = [
  ['name', 'Name'], ['url', 'URL'], ['username', 'Username'], ['password', 'Password'],
  ['systemName', 'System Name'], ['environment', 'Environment'], ['companyCode', 'Company Code'],
  ['secretKey', 'Secret Key'], ['expiryDate', 'Expiry Date'], ['role', 'Role'],
  ['subServices', 'Sub-Services'], ['notes', 'Notes'],
];

// String form of a field value for diffing/display — arrays (subServices)
// compare/display as JSON since a plain String() on an array of objects is unreadable.
function clFieldStr(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return JSON.stringify(v);
  return String(v);
}

// Diffs the existing record against the form's new values. Only fields whose
// OLD value was non-empty AND actually changed are returned — a previously-
// empty field being filled in for the first time is a fill-in, not an edit,
// and per the Phase 2 spec never needs confirmation.
// `fmt` (optional 3rd element of a field def) maps a stored value to its
// human-facing form for the dialog — a lookup code to its label. The comparison
// itself always stays on the raw stored values.
function diffClientFields(before, next, fieldDefs) {
  const changes = [];
  fieldDefs.forEach(([key, label, fmt]) => {
    const oldStr = before ? clFieldStr(before[key]) : '';
    const newStr = clFieldStr(next[key]);
    if (!oldStr || oldStr === newStr) return;
    const show = v => (fmt ? clFieldStr(fmt(v)) : v);
    changes.push({ label, oldValue: show(oldStr), newValue: show(newStr) });
  });
  return changes;
}

// Promise-based confirm dialog showing old → new per changed field. Resolves
// true (proceed) / false (cancelled) — callers must await it before calling
// the update API so an edit can never commit without the user seeing the diff.
let _clientEditConfirmResolve = null;
function confirmClientFieldChanges(changes) {
  return new Promise(resolve => {
    _clientEditConfirmResolve = resolve;
    const list = document.getElementById('client-edit-confirm-list');
    list.innerHTML = '';
    changes.forEach(c => {
      const row = pjMk('div', 'cl-history-row');
      row.appendChild(pjMk('div', 'cl-history-field', c.label));
      const diff = pjMk('div', 'cl-history-diff');
      diff.appendChild(pjMk('span', 'cl-history-old', c.oldValue || '(empty)'));
      diff.appendChild(pjMk('span', 'cl-history-arrow', '→'));
      diff.appendChild(pjMk('span', 'cl-history-new', c.newValue || '(empty)'));
      row.appendChild(diff);
      list.appendChild(row);
    });
    document.getElementById('client-edit-confirm-overlay').classList.add('open');
  });
}
function acceptClientEditConfirm() {
  document.getElementById('client-edit-confirm-overlay').classList.remove('open');
  if (_clientEditConfirmResolve) { _clientEditConfirmResolve(true); _clientEditConfirmResolve = null; }
}
function cancelClientEditConfirm() {
  document.getElementById('client-edit-confirm-overlay').classList.remove('open');
  if (_clientEditConfirmResolve) { _clientEditConfirmResolve(false); _clientEditConfirmResolve = null; }
}
function clientEditConfirmOverlayClick(e) {
  if (e.target === document.getElementById('client-edit-confirm-overlay')) cancelClientEditConfirm();
}

// Read-only history view — one modal shared by all 5 record types.
async function openClientHistoryModal(recordType, recordId, title) {
  document.getElementById('client-history-modal-title').textContent = 'History — ' + (title || 'record');
  const list = document.getElementById('client-history-list');
  list.innerHTML = '<div class="cp-records-empty">Loading…</div>';
  document.getElementById('client-history-overlay').classList.add('open');
  let rows;
  try { rows = await window.api.getClientFieldHistory(recordType, recordId); }
  catch { list.innerHTML = '<div class="cp-records-empty">Could not load history.</div>'; return; }
  if (!Array.isArray(rows) || rows.length === 0) {
    list.innerHTML = '<div class="cp-records-empty">No changes recorded yet.</div>';
    return;
  }
  list.innerHTML = '';
  rows.forEach(r => {
    const row = pjMk('div', 'cl-history-row');
    const head = pjMk('div', 'cl-history-head');
    head.appendChild(pjMk('span', 'cl-history-field', r.fieldName));
    head.appendChild(pjMk('span', 'cl-history-when', new Date(r.changedAt).toLocaleString()));
    row.appendChild(head);
    const diff = pjMk('div', 'cl-history-diff');
    const category = r.fieldName === 'System' ? 'SYSTEM' : r.fieldName === 'Role' ? 'SERVER_ROLE' : null;
    const shown = value => category && value ? lkLabel(category, value) : value;
    diff.appendChild(pjMk('span', 'cl-history-old', shown(r.oldValue) || '(empty)'));
    diff.appendChild(pjMk('span', 'cl-history-arrow', '→'));
    diff.appendChild(pjMk('span', 'cl-history-new', shown(r.newValue) || '(empty)'));
    row.appendChild(diff);
    list.appendChild(row);
  });
}
function closeClientHistoryModal() {
  document.getElementById('client-history-overlay').classList.remove('open');
}
function clientHistoryOverlayClick(e) {
  if (e.target === document.getElementById('client-history-overlay')) closeClientHistoryModal();
}

function buildClientSecretControl(label, value) {
  const wrap = pjMk('span', 'cl-pw-wrap');
  const text = pjMk('span', 'cl-pw-text', '••••••••');
  let masked = true;
  let revealTimer = null;
  const reveal = pjMk('button', 'cd-icon-btn cl-pw-toggle');
  reveal.innerHTML = ic('eye');
  reveal.title = `Show ${label.toLowerCase()} for 15 seconds`;
  reveal.addEventListener('click', () => {
    clearTimeout(revealTimer);
    masked = !masked;
    text.textContent = masked ? '••••••••' : value;
    reveal.setAttribute('aria-pressed', String(!masked));
    if (!masked) revealTimer = setTimeout(() => {
      masked = true;
      text.textContent = '••••••••';
      reveal.setAttribute('aria-pressed', 'false');
    }, 15_000);
  });
  const copy = pjMk('button', 'cd-icon-btn cl-pw-copy');
  copy.innerHTML = ic('copy');
  copy.title = `Copy ${label.toLowerCase()} (clipboard clears in 30 seconds)`;
  copy.addEventListener('click', async () => {
    try {
      const result = await window.api.copySecret(value);
      toast(result?.ok ? `${label} copied — clipboard clears in 30 seconds` : `Could not copy ${label.toLowerCase()}`);
    } catch { toast(`Could not copy ${label.toLowerCase()}`); }
  });
  wrap.appendChild(document.createTextNode(label + ': '));
  wrap.appendChild(text);
  wrap.appendChild(reveal);
  wrap.appendChild(copy);
  return wrap;
}

function buildClientVpnCard(v) {
  const card = pjMk('div', 'cl-item-card');
  const main = pjMk('div', 'cl-item-main');
  main.appendChild(pjMk('div', 'cl-item-title', v.connectionName || '(unnamed connection)'));
  const metaBits = [v.vpnType, v.endpoint, v.port ? ('Port ' + v.port) : ''].filter(Boolean).join(' · ');
  if (metaBits) main.appendChild(pjMk('div', 'cl-item-meta', metaBits));
  if (v.username || v.password) {
    const cred = pjMk('div', 'cl-item-meta cl-item-cred');
    if (v.username) cred.appendChild(pjMk('span', null, 'User: ' + v.username));
    if (v.password) {
      cred.appendChild(buildClientSecretControl('Password', v.password));
    }
    main.appendChild(cred);
  }
  if (v.credentialLocation) main.appendChild(pjMk('div', 'cl-item-meta', 'Credential location: ' + v.credentialLocation));
  if (v.expiryDate) {
    const status = cdRenewalStatus(v.expiryDate);
    const row = pjMk('div', 'cd-renewal' + (status ? ' ' + status : ''));
    row.innerHTML = ic('calendar-clock');
    const prefix = status === 'overdue' ? 'Overdue — ' : status === 'soon' ? 'Expires soon — ' : 'Expires ';
    row.appendChild(document.createTextNode(prefix + new Date(v.expiryDate + 'T00:00:00').toLocaleDateString()));
    main.appendChild(row);
  }
  if (v.notes) main.appendChild(pjMk('div', 'cl-item-notes', v.notes));
  main.appendChild(pjMk('div', 'cl-item-updated', clUpdatedLabel(v)));
  card.appendChild(main);

  const actions = pjMk('div', 'cl-item-actions');
  const histBtn = pjMk('button', 'cd-icon-btn');
  histBtn.innerHTML = ic('clock');
  histBtn.title = 'View history';
  histBtn.addEventListener('click', () => openClientHistoryModal('vpn', v.id, v.connectionName));
  actions.appendChild(histBtn);
  const editBtn = pjMk('button', 'cd-icon-btn');
  editBtn.innerHTML = ic('pencil');
  editBtn.title = 'Edit';
  editBtn.addEventListener('click', () => openClientVpnModal(v));
  actions.appendChild(editBtn);
  const delBtn = pjMk('button', 'cd-icon-btn danger');
  delBtn.innerHTML = ic('trash-2');
  delBtn.title = 'Delete';
  delBtn.addEventListener('click', () =>
    showDeleteConfirm(actions, () => deleteClientVpnEntry(v.id), () => renderClientDetail(currentClient)));
  actions.appendChild(delBtn);
  card.appendChild(actions);
  return card;
}

// 'PRODUCTION'|'TEST' -> their display labels; anything else is one of migration
// 038's nullN environment placeholders and shows as-is.
function srvEnvLabel(env) {
  if (env === 'PRODUCTION') return 'Production';
  if (env === 'TEST') return 'UAT';
  return env || '';
}
function srvEnvIsKnown(env) { return env === 'PRODUCTION' || env === 'TEST'; }

// Plain-text form of a server's identity — for anywhere that needs a name for
// the record (history modal title, group checklist, toasts). A server has no
// name of its own anymore: the triple IS its name.
function serverIdentityText(s) {
  return [lkLabel('SYSTEM', s.systemName) || '(no system)', lkLabel('SERVER_ROLE', s.role) || s.roleLabel || '(no role)',
    srvEnvLabel(s.environment) || '(no environment)'].join(' - ');
}

// The card's identity line — the server's title, and the same
// "System - Role - Environment" string the Add/Edit modal previews, since that
// triple is what identifies the server. Each part is called out in amber when
// it's still a nullN placeholder, so what needs fixing is obvious without
// opening the record.
function buildServerIdentityLine(s) {
  const line = pjMk('div', 'cl-item-title cl-server-identity');
  const part = (text, isPlaceholder, fallback) => {
    if (!text) return pjMk('span', 'cl-item-muted', fallback);
    return isPlaceholder ? pjMk('span', 'cl-role-placeholder', text) : pjMk('span', null, text);
  };
  // System/Role are lookup-backed: a soft-disabled code is one of migration
  // 038/039's nullN placeholders, which is exactly what needs calling out.
  line.appendChild(part(lkLabel('SYSTEM', s.systemName), !!s.systemId && !s.systemActive, '(no system)'));
  line.appendChild(document.createTextNode(' - '));
  line.appendChild(part(lkLabel('SERVER_ROLE', s.role) || s.roleLabel, !!s.role && !s.roleActive, '(no role)'));
  line.appendChild(document.createTextNode(' - '));
  const env = part(srvEnvLabel(s.environment), !srvEnvIsKnown(s.environment), '(no environment)');
  if (srvEnvIsKnown(s.environment)) env.classList.add('cl-srv-env-' + s.environment.toLowerCase());
  line.appendChild(env);
  return line;
}

function buildClientServerCard(s) {
  const card = pjMk('div', 'cl-item-card');
  const main = pjMk('div', 'cl-item-main');
  main.appendChild(buildServerIdentityLine(s));
  const metaBits = [s.host, s.hostname, s.os].filter(Boolean).join(' · ');
  if (metaBits) main.appendChild(pjMk('div', 'cl-item-meta', metaBits));
  if (s.username || s.password) {
    const cred = pjMk('div', 'cl-item-meta cl-item-cred');
    if (s.username) cred.appendChild(pjMk('span', null, 'User: ' + s.username));
    if (s.password) {
      cred.appendChild(buildClientSecretControl('Password', s.password));
    }
    main.appendChild(cred);
  }
  if (s.notes) main.appendChild(pjMk('div', 'cl-item-notes', s.notes));
  main.appendChild(pjMk('div', 'cl-item-updated', clUpdatedLabel(s)));
  card.appendChild(main);

  const actions = pjMk('div', 'cl-item-actions');
  const histBtn = pjMk('button', 'cd-icon-btn');
  histBtn.innerHTML = ic('clock');
  histBtn.title = 'View history';
  histBtn.addEventListener('click', () => openClientHistoryModal('server', s.id, serverIdentityText(s)));
  actions.appendChild(histBtn);
  const editBtn = pjMk('button', 'cd-icon-btn');
  editBtn.innerHTML = ic('pencil');
  editBtn.title = 'Edit';
  editBtn.addEventListener('click', () => openClientServerModal(s));
  actions.appendChild(editBtn);
  const delBtn = pjMk('button', 'cd-icon-btn danger');
  delBtn.innerHTML = ic('trash-2');
  delBtn.title = 'Delete';
  delBtn.addEventListener('click', () =>
    showDeleteConfirm(actions, () => deleteClientServerEntry(s.id), () => renderClientDetail(currentClient)));
  actions.appendChild(delBtn);
  card.appendChild(actions);
  return card;
}

// ── Auth connection modal (VPN, PAM, etc.) ──
function openClientVpnModal(v) {
  clientVpnEditId = v ? v.id : null;
  document.getElementById('client-vpn-modal-title').textContent = v ? 'Edit Auth Connection' : 'Add Auth Connection';
  document.getElementById('client-vpn-modal-submit').textContent = v ? 'Save Changes' : 'Add Connection';
  document.getElementById('cv-name').value = v ? (v.connectionName || '') : '';
  document.getElementById('cv-type').value = v ? (v.vpnType || '') : '';
  document.getElementById('cv-endpoint').value = v ? (v.endpoint || '') : '';
  document.getElementById('cv-port').value = v ? (v.port || '') : '';
  document.getElementById('cv-username').value = v ? (v.username || '') : '';
  document.getElementById('cv-password').value = v ? (v.password || '') : '';
  document.getElementById('cv-expiry').value = v ? (v.expiryDate || '') : '';
  document.getElementById('cv-cred-location').value = v ? (v.credentialLocation || '') : '';
  document.getElementById('cv-notes').value = v ? (v.notes || '') : '';
  document.querySelector('#client-vpn-modal .modal-more').open = !!(v && (v.expiryDate || v.credentialLocation || v.notes));
  clearErrorsIn('#client-vpn-modal');
  document.getElementById('client-vpn-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('cv-name').focus(), 80);
}
function closeClientVpnModal() {
  document.getElementById('client-vpn-modal-overlay').classList.remove('open');
  clientVpnEditId = null;
}
function clientVpnOverlayClick(e) {
  if (e.target === document.getElementById('client-vpn-modal-overlay')) closeClientVpnModal();
}
async function submitClientVpnModal() {
  clearErrorsIn('#client-vpn-modal');
  const connectionName = document.getElementById('cv-name').value.trim();
  if (!connectionName) { markError('cv-name'); return; }
  const data = {
    connectionName,
    vpnType:  document.getElementById('cv-type').value.trim(),
    endpoint: document.getElementById('cv-endpoint').value.trim(),
    port:     document.getElementById('cv-port').value.trim(),
    username: document.getElementById('cv-username').value.trim(),
    password: document.getElementById('cv-password').value.trim(),
    expiryDate: document.getElementById('cv-expiry').value || null,
    credentialLocation: document.getElementById('cv-cred-location').value.trim(),
    notes:    document.getElementById('cv-notes').value.trim(),
  };
  if (clientVpnEditId != null) {
    const before = (currentClient?.vpnConnections || []).find(v => v.id === clientVpnEditId);
    const changes = diffClientFields(before, data, VPN_CONFIRM_FIELDS);
    if (changes.length && !(await confirmClientFieldChanges(changes))) return;
  }
  try {
    if (clientVpnEditId != null) await window.api.updateClientVpn(clientVpnEditId, data);
    else await window.api.createClientVpn(currentClient.id, data);
    closeClientVpnModal();
    toast('VPN connection saved');
  } catch { toast('Could not save VPN connection'); return; }
  await reloadCurrentClient();
}
// Delete + undo (re-creates the connection on undo — same pattern as
// doDeleteProjectTask's zero-log task undo; no file involved here).
async function deleteClientVpnEntry(id) {
  const snapshot = (currentClient?.vpnConnections || []).find(v => v.id === id);
  try { await window.api.deleteClientVpn(id); }
  catch { toast('Could not delete VPN connection'); renderClientDetail(currentClient); return; }
  await reloadCurrentClient();
  if (!snapshot) return;
  showGenericUndo('VPN connection deleted', async () => {
    try {
      await window.api.createClientVpn(snapshot.companyId, {
        connectionName: snapshot.connectionName, vpnType: snapshot.vpnType,
        endpoint: snapshot.endpoint, port: snapshot.port, username: snapshot.username,
        password: snapshot.password, expiryDate: snapshot.expiryDate, credentialLocation: snapshot.credentialLocation,
        notes: snapshot.notes,
      });
    } catch { toast('Could not restore VPN connection'); return; }
    await reloadCurrentClient();
  });
}

// ── Server modal ──
// Fills one of the identity dropdowns from its lookup catalog. Only ACTIVE codes
// are offerable, but a record still sitting on one of migration 038/039's
// soft-disabled nullN placeholders keeps it as its current value — otherwise
// editing anything else on that record would silently re-point it at whatever
// happened to be first in the list. `valueKey` follows the category's own
// round-trip convention: SERVER_ROLE by code, SYSTEM by label.
function fillIdentitySelect(selectId, category, valueKey, current, blankText, kindWord) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = blankText;
  sel.appendChild(blank);
  const active = lkOptions(category);
  active.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o[valueKey];
    opt.dataset.userContent = ''; opt.textContent = lookupDisplayName(o);
    sel.appendChild(opt);
  });
  const cur = current || '';
  if (cur && !active.some(o => o[valueKey] === cur)) {
    const opt = document.createElement('option');
    opt.value = cur;
    opt.textContent = (lkLabel(category, cur) || cur) + ' — placeholder, pick a real ' + kindWord;
    sel.appendChild(opt);
  }
  sel.value = cur;
}

// The Environment select is a fixed Production/UAT pair, so a legacy row carrying
// a nullN placeholder environment needs its value added back the same way.
function fillServerEnvSelect(s) {
  const sel = document.getElementById('cs-environment');
  sel.querySelectorAll('option[data-placeholder]').forEach(o => o.remove());
  const env = s ? (s.environment || '') : '';
  if (env && env !== 'PRODUCTION' && env !== 'TEST') {
    const opt = document.createElement('option');
    opt.value = env;
    opt.dataset.placeholder = '1';
    opt.textContent = env + ' — placeholder, pick a real environment';
    sel.appendChild(opt);
  }
  sel.value = env || 'PRODUCTION';
}

// Live "System - Role - Environment" line under the identity row, so the thing
// that has to be unique is visible as one value while it's being typed.
function renderServerIdentityPreview() {
  const el = document.getElementById('cs-identity-preview');
  if (!el) return;
  // Resolve all three through the catalog/label helpers rather than reading the
  // option's text, which carries the "— placeholder, pick a real X" suffix.
  const system = lkLabel('SYSTEM', document.getElementById('cs-system').value);
  const role = lkLabel('SERVER_ROLE', document.getElementById('cs-role').value);
  const env = srvEnvLabel(document.getElementById('cs-environment').value);
  el.classList.remove('bad');
  if (!system || !role || !env) {
    el.textContent = 'All three identify the server and must be unique for this client.';
    return;
  }
  el.innerHTML = 'Identity: <span class="cs-identity-value">' +
    esc(system) + ' - ' + esc(role) + ' - ' + esc(env) + '</span>';
}

function openClientServerModal(s) {
  clientServerEditId = s ? s.id : null;
  document.getElementById('client-server-modal-title').textContent = s ? 'Edit Server' : 'Add Server';
  document.getElementById('client-server-modal-submit').textContent = s ? 'Save Changes' : 'Add Server';
  document.getElementById('cs-host').value = s ? (s.host || '') : '';
  fillIdentitySelect('cs-system', 'SYSTEM', 'label', s ? s.systemName : '', 'Select a system…', 'system');
  fillIdentitySelect('cs-role', 'SERVER_ROLE', 'code', s ? s.role : '', 'Select a role…', 'role');
  fillServerEnvSelect(s);
  document.getElementById('cs-hostname').value = s ? (s.hostname || '') : '';
  document.getElementById('cs-os').value = s ? (s.os || '') : '';
  document.getElementById('cs-username').value = s ? (s.username || '') : '';
  document.getElementById('cs-password').value = s ? (s.password || '') : '';
  document.getElementById('cs-notes').value = s ? (s.notes || '') : '';
  renderServerIdentityPreview();
  clearErrorsIn('#client-server-modal');
  document.getElementById('client-server-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('cs-system').focus(), 80);
}
function closeClientServerModal() {
  document.getElementById('client-server-modal-overlay').classList.remove('open');
  clientServerEditId = null;
}
function clientServerOverlayClick(e) {
  if (e.target === document.getElementById('client-server-modal-overlay')) closeClientServerModal();
}
async function submitClientServerModal() {
  clearErrorsIn('#client-server-modal');
  const systemName = document.getElementById('cs-system').value;   // a SYSTEM label
  const role = document.getElementById('cs-role').value;
  const environment = document.getElementById('cs-environment').value;
  // System / Role / Environment are what identify the server — all three required.
  let bad = false;
  if (!systemName) { markError('cs-system'); bad = true; }
  if (!role) { markError('cs-role'); bad = true; }
  if (!environment) { markError('cs-environment'); bad = true; }
  if (bad) return;
  const data = {
    systemName, role, environment,
    host:        document.getElementById('cs-host').value.trim(),
    hostname:    document.getElementById('cs-hostname').value.trim(),
    os:          document.getElementById('cs-os').value.trim(),
    username:    document.getElementById('cs-username').value.trim(),
    password:    document.getElementById('cs-password').value.trim(),
    notes:       document.getElementById('cs-notes').value.trim(),
  };
  if (clientServerEditId != null) {
    const before = (currentClient?.servers || []).find(s => s.id === clientServerEditId);
    const changes = diffClientFields(before, data, SERVER_CONFIRM_FIELDS);
    if (changes.length && !(await confirmClientFieldChanges(changes))) return;
  }
  let res;
  try {
    if (clientServerEditId != null) res = await window.api.updateClientServer(clientServerEditId, data);
    else res = await window.api.createClientServer(currentClient.id, data);
  } catch { toast('Could not save server'); return; }
  // A rejected identity comes back as {ok:false,error} rather than throwing — the
  // modal stays open with the three parts flagged so the clash can be fixed.
  if (res && res.ok === false) {
    ['cs-system', 'cs-role', 'cs-environment'].forEach(markError);
    const preview = document.getElementById('cs-identity-preview');
    preview.classList.add('bad');
    preview.textContent = res.error || 'That System / Role / Environment is already taken.';
    return;
  }
  closeClientServerModal();
  toast('Server saved');
  await reloadCurrentClient();
}
async function deleteClientServerEntry(id) {
  const snapshot = (currentClient?.servers || []).find(s => s.id === id);
  try { await window.api.deleteClientServer(id); }
  catch { toast('Could not delete server'); renderClientDetail(currentClient); return; }
  await reloadCurrentClient();
  if (!snapshot) return;
  showGenericUndo('Server deleted', async () => {
    let res;
    try {
      res = await window.api.createClientServer(snapshot.companyId, {
        host: snapshot.host, environment: snapshot.environment,
        systemName: snapshot.systemName, hostname: snapshot.hostname, os: snapshot.os, username: snapshot.username,
        password: snapshot.password, role: snapshot.role, notes: snapshot.notes,
      });
    } catch { toast('Could not restore server'); return; }
    // Its identity can have been taken by another server during the undo window.
    if (res && res.ok === false) { toast(res.error || 'Could not restore server'); return; }
    await reloadCurrentClient();
  });
}

function buildClientInternalSystemCard(s) {
  const card = pjMk('div', 'cl-item-card');
  const main = pjMk('div', 'cl-item-main');
  const title = pjMk('div', 'cl-item-title');
  title.appendChild(document.createTextNode(s.name || '(unnamed system)'));
  if (s.environment) {
    const envLabel = s.environment === 'PRODUCTION' ? 'Production' : (s.environment === 'TEST' ? 'UAT' : s.environment);
    title.appendChild(pjMk('span', 'cl-env-badge ' + s.environment.toLowerCase(), envLabel));
  }
  main.appendChild(title);
  if (s.url) main.appendChild(pjMk('div', 'cl-item-meta', s.url));
  if (s.username || s.password) {
    const cred = pjMk('div', 'cl-item-meta cl-item-cred');
    if (s.username) cred.appendChild(pjMk('span', null, 'User: ' + s.username));
    if (s.password) {
      cred.appendChild(buildClientSecretControl('Password', s.password));
    }
    main.appendChild(cred);
  }
  if (s.companyCode || s.secretKey) {
    const svcCred = pjMk('div', 'cl-item-meta cl-item-cred');
    if (s.companyCode) svcCred.appendChild(pjMk('span', null, 'Company Code: ' + s.companyCode));
    if (s.secretKey) {
      svcCred.appendChild(buildClientSecretControl('Secret Key', s.secretKey));
    }
    main.appendChild(svcCred);
  }
  if (Array.isArray(s.subServices) && s.subServices.length) {
    const subList = pjMk('div', 'cl-subsvc-list');
    s.subServices.forEach(sub => {
      const row = pjMk('div', 'cl-subsvc-row-view');
      if (sub.label) row.appendChild(pjMk('span', 'cl-subsvc-label', sub.label + ':'));
      if (sub.url) row.appendChild(pjMk('span', null, sub.url));
      subList.appendChild(row);
    });
    main.appendChild(subList);
  }
  if (s.role) main.appendChild(pjMk('div', 'cl-item-meta', 'Role: ' + s.role));
  if (s.expiryDate) {
    const status = cdRenewalStatus(s.expiryDate);
    const row = pjMk('div', 'cd-renewal' + (status ? ' ' + status : ''));
    row.innerHTML = ic('calendar-clock');
    const prefix = status === 'overdue' ? 'Overdue — ' : status === 'soon' ? 'Expires soon — ' : 'Expires ';
    row.appendChild(document.createTextNode(prefix + new Date(s.expiryDate + 'T00:00:00').toLocaleDateString()));
    main.appendChild(row);
  }
  if (s.notes) main.appendChild(pjMk('div', 'cl-item-notes', s.notes));
  main.appendChild(pjMk('div', 'cl-item-updated', clUpdatedLabel(s)));
  card.appendChild(main);

  const actions = pjMk('div', 'cl-item-actions');
  const histBtn = pjMk('button', 'cd-icon-btn');
  histBtn.innerHTML = ic('clock');
  histBtn.title = 'View history';
  histBtn.addEventListener('click', () => openClientHistoryModal('internal', s.id, s.name));
  actions.appendChild(histBtn);
  const editBtn = pjMk('button', 'cd-icon-btn');
  editBtn.innerHTML = ic('pencil');
  editBtn.title = 'Edit';
  editBtn.addEventListener('click', () => openClientInternalModal(s));
  actions.appendChild(editBtn);
  const delBtn = pjMk('button', 'cd-icon-btn danger');
  delBtn.innerHTML = ic('trash-2');
  delBtn.title = 'Delete';
  delBtn.addEventListener('click', () =>
    showDeleteConfirm(actions, () => deleteClientInternalSystemEntry(s.id), () => renderClientDetail(currentClient)));
  actions.appendChild(delBtn);
  card.appendChild(actions);
  return card;
}

// ── Internal System modal ──
function addClientInternalSubServiceRow(label, url) {
  const list = document.getElementById('cint-subservices-list');
  const row = pjMk('div', 'cint-subsvc-row');
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'Label (e.g. Bookings)';
  labelInput.className = 'cint-subsvc-label-input';
  labelInput.value = label || '';
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.placeholder = 'https://...';
  urlInput.className = 'cint-subsvc-url-input';
  urlInput.value = url || '';
  const removeBtn = pjMk('button', 'cd-icon-btn danger');
  removeBtn.type = 'button';
  removeBtn.innerHTML = ic('trash-2');
  removeBtn.title = 'Remove';
  removeBtn.addEventListener('click', () => row.remove());
  row.appendChild(labelInput);
  row.appendChild(urlInput);
  row.appendChild(removeBtn);
  list.appendChild(row);
}
function readClientInternalSubServiceRows() {
  return [...document.querySelectorAll('#cint-subservices-list .cint-subsvc-row')].map(row => ({
    label: row.querySelector('.cint-subsvc-label-input').value.trim(),
    url: row.querySelector('.cint-subsvc-url-input').value.trim(),
  })).filter(s => s.label || s.url);
}
function openClientInternalModal(s) {
  clientInternalEditId = s ? s.id : null;
  document.getElementById('client-internal-modal-title').textContent = s ? 'Edit Internal System' : 'Add Internal System';
  document.getElementById('client-internal-modal-submit').textContent = s ? 'Save Changes' : 'Add System';
  document.getElementById('cint-name').value = s ? (s.name || '') : '';
  document.getElementById('cint-system').value = s ? (s.systemName || '') : '';
  document.getElementById('cint-environment').value = s ? (s.environment || '') : '';
  document.getElementById('cint-url').value = s ? (s.url || '') : '';
  document.getElementById('cint-username').value = s ? (s.username || '') : '';
  document.getElementById('cint-password').value = s ? (s.password || '') : '';
  document.getElementById('cint-company-code').value = s ? (s.companyCode || '') : '';
  document.getElementById('cint-secret-key').value = s ? (s.secretKey || '') : '';
  document.getElementById('cint-expiry').value = s ? (s.expiryDate || '') : '';
  document.getElementById('cint-role').value = s ? (s.role || '') : '';
  document.getElementById('cint-notes').value = s ? (s.notes || '') : '';
  document.getElementById('cint-subservices-list').innerHTML = '';
  (s && Array.isArray(s.subServices) ? s.subServices : []).forEach(sub => addClientInternalSubServiceRow(sub.label, sub.url));
  document.querySelector('#client-internal-modal .modal-more').open = !!(s && (
    s.companyCode || s.secretKey || s.expiryDate || s.role || s.notes || (s.subServices || []).length
  ));
  clearErrorsIn('#client-internal-modal');
  document.getElementById('client-internal-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('cint-name').focus(), 80);
}
function closeClientInternalModal() {
  document.getElementById('client-internal-modal-overlay').classList.remove('open');
  clientInternalEditId = null;
}
function clientInternalOverlayClick(e) {
  if (e.target === document.getElementById('client-internal-modal-overlay')) closeClientInternalModal();
}
async function submitClientInternalModal() {
  clearErrorsIn('#client-internal-modal');
  const name = document.getElementById('cint-name').value.trim();
  if (!name) { markError('cint-name'); return; }
  const data = {
    name,
    systemName:  document.getElementById('cint-system').value.trim(),
    environment: document.getElementById('cint-environment').value,
    url:      document.getElementById('cint-url').value.trim(),
    username: document.getElementById('cint-username').value.trim(),
    password: document.getElementById('cint-password').value.trim(),
    companyCode: document.getElementById('cint-company-code').value.trim(),
    secretKey:   document.getElementById('cint-secret-key').value.trim(),
    expiryDate:  document.getElementById('cint-expiry').value || null,
    role:        document.getElementById('cint-role').value.trim(),
    subServices: readClientInternalSubServiceRows(),
    notes:    document.getElementById('cint-notes').value.trim(),
  };
  if (clientInternalEditId != null) {
    const before = (currentClient?.internalSystems || []).find(s => s.id === clientInternalEditId);
    const changes = diffClientFields(before, data, INTERNAL_CONFIRM_FIELDS);
    if (changes.length && !(await confirmClientFieldChanges(changes))) return;
  }
  try {
    if (clientInternalEditId != null) await window.api.updateClientInternalSystem(clientInternalEditId, data);
    else await window.api.createClientInternalSystem(currentClient.id, data);
    closeClientInternalModal();
    toast('Internal system saved');
  } catch { toast('Could not save internal system'); return; }
  await reloadCurrentClient();
}
async function deleteClientInternalSystemEntry(id) {
  const snapshot = (currentClient?.internalSystems || []).find(s => s.id === id);
  try { await window.api.deleteClientInternalSystem(id); }
  catch { toast('Could not delete internal system'); renderClientDetail(currentClient); return; }
  await reloadCurrentClient();
  if (!snapshot) return;
  showGenericUndo('Internal system deleted', async () => {
    try {
      await window.api.createClientInternalSystem(snapshot.companyId, {
        name: snapshot.name, systemName: snapshot.systemName, environment: snapshot.environment,
        url: snapshot.url, username: snapshot.username, password: snapshot.password,
        companyCode: snapshot.companyCode, secretKey: snapshot.secretKey,
        expiryDate: snapshot.expiryDate, role: snapshot.role, subServices: snapshot.subServices, notes: snapshot.notes,
      });
    } catch { toast('Could not restore internal system'); return; }
    await reloadCurrentClient();
  });
}
