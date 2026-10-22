// ══ CLIENTS — the client roster + VPN/Server/System records per COMPANY lookup ═
// No standalone clients table: the roster IS the COMPANY lookup catalog. This
// page owns that catalog end to end — creating, renaming, archiving and
// reordering clients all happen here, not in Settings (there is no Companies
// tab; see renderer/settings-registry.js). On top of the roster it adds three
// small per-user child record types (VPN connections, servers, internal
// systems) keyed to a company id, shown via a Projects-style list+detail view
// (list = card grid, detail = editable sub-list sections).
//
// A client's `code` is deliberately never editable anywhere in this file. It is
// set once by the New Client modal and is unreachable afterwards, in the UI and
// in db.js alike, because it is the stable business identity linked records are
// filed under.
let clientsList = [];
let clientsLoaded = false;
let clientRecordFilter = '';  // matches within each client's own records (auth/servers/internal)
let clientsShowArchived = false;  // "Show archived" — includes soft-disabled (is_active = 0) clients
let clientsArrangeMode = false;   // "Arrange" — reveals per-card move up/down controls
let clientsSort = '';             // '' = the saved (Arrange) order, 'asc' / 'desc' = by name; view only
let clientsView = 'cards';        // 'cards' | 'web' | 'wheel' — the roster as cards, or as the Systems web / wheel
let clientsWebLinks = null;       // clients:system-web rows; null = fetch on next draw
const clientsWebSources = new Set(['servers', 'projects', 'tasks', 'knowledge']);
let clientsWebPinned = null;      // system id kept highlighted by a click, or null
let currentClient = null;       // Client (from clients:get) shown in the detail view
let clientVpnEditId = null;      // null = create mode in the Auth modal
let clientServerEditId = null;   // null = create mode in the Server modal
let clientDatabaseEditId = null;   // null = create mode in the Database modal
let clientServersView = 'list';    // 'list' | 'map' | 'wheel' — how the Servers section is drawn
let clientInternalEditId = null; // null = create mode in the Internal System modal
let clientGroupRenameKind = null;    // 'server' | 'internal' — which section's group is being renamed
let clientGroupRenameOldName = null; // the group's current systemName
let clientNewGroupKind = null;       // 'server' | 'internal' — which section's "+ New Group" modal is open

// Detail-view search (per human-identifying fields only — never credentials)
// + one active workspace tab. Reset per client on open; preserved across an
// in-place reload (post-CRUD refresh of the same client).
let clientDetailSearch = '';
const CLIENT_DETAIL_TYPES = [
  { key: 'overview',  label: 'Overview' },
  { key: 'projects',  label: 'Projects' },
  { key: 'knowledge', label: 'Knowledge Hub' },
  { key: 'pfm',       label: 'Offers & CRs' },
  { key: 'auth',      label: 'Access' },
  { key: 'servers',   label: 'Servers' },
  { key: 'internal',  label: 'Systems' },
];
let clientDetailTab = 'overview';
// Two client sections belong to pages of their own; switching that page off
// in Settings → Pages hides the section here too.
function clientTabHidden(key) {
  return (key === 'pfm' || key === 'knowledge') && isPageHidden(key);
}

// Every active COMPANY lookup is automatically a Client. A catalog merge from
// Settings → Maintenance can change that catalog while this module is not
// visible, so discard the cached roster and let the next Clients visit load the
// current list.
function invalidateClientsCatalog() {
  clientsList = [];
  clientsLoaded = false;
  currentClient = null;
}

function initClientsModule() {
  clientsWebLinks = null;   // the web is rebuilt from fresh links on every visit
  showClientsListView();
  syncClientsToolbarState();
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
  try { list = await window.api.listClients(clientsShowArchived); }
  catch { toast('Could not load clients'); return; }
  clientsList = Array.isArray(list) ? list : [];
  clientsLoaded = true;
  renderClientsList();
}

function applyClientRecordFilter() {
  clientRecordFilter = (document.getElementById('clients-records-filter').value || '').toLowerCase().trim();
  renderClientsList();
}

// ── Roster management ─────────────────────────────────────────────────────────
// Create / rename / archive / reorder. These write the shared COMPANY lookup
// catalog, so after every one of them the renderer's own copy of that catalog
// (LK) has to be refreshed or company dropdowns across Timesheet, Tasks,
// Projects and Browse keep showing the pre-change list until a restart.
async function refreshCompanyCatalog() {
  try { LK = await window.api.loadLookups(); }
  catch { toast('Saved — reopen the app to refresh company lists'); }
}

function syncClientsToolbarState() {
  const archivedBtn = document.getElementById('clients-archived-btn');
  const arrangeBtn = document.getElementById('clients-arrange-btn');
  if (archivedBtn) {
    archivedBtn.classList.toggle('active', clientsShowArchived);
    archivedBtn.setAttribute('aria-pressed', String(clientsShowArchived));
  }
  if (arrangeBtn) {
    arrangeBtn.classList.toggle('active', clientsArrangeMode);
    arrangeBtn.setAttribute('aria-pressed', String(clientsArrangeMode));
    // Moving a card only makes sense in the saved order it moves within.
    arrangeBtn.disabled = !!clientsSort;
  }
  document.querySelectorAll('#clients-sort-ctl .seg-btn').forEach(b => {
    const active = (b.dataset.sort || '') === clientsSort;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('#clients-view-ctl .seg-btn').forEach(b => {
    const active = b.dataset.view === clientsView;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  // Search, name order and Arrange act on the cards only.
  const web = clientsView !== 'cards';
  const search = document.querySelector('#clients-list-view .cl-records-search-wrap');
  if (search) search.hidden = web;
  const sortCtl = document.getElementById('clients-sort-ctl');
  if (sortCtl) sortCtl.hidden = web;
  if (arrangeBtn) arrangeBtn.hidden = web;
}

function setClientsView(view) {
  clientsView = view === 'web' || view === 'wheel' ? view : 'cards';
  if (clientsView !== 'cards') { clientsArrangeMode = false; clientsWebLinks = null; }
  syncClientsToolbarState();
  renderClientsList();
}

// Name order is a view of the roster, not a write: the saved order (which
// every company dropdown follows) only changes through Arrange.
function setClientsSort(dir) {
  clientsSort = dir || '';
  if (clientsSort) clientsArrangeMode = false;
  syncClientsToolbarState();
  renderClientsList();
}
function clientsInViewOrder() {
  if (!clientsSort) return clientsList;
  const lang = rptLanguage();
  const dir = clientsSort === 'desc' ? -1 : 1;
  return clientsList.slice().sort((a, b) =>
    dir * (companyDisplayName(a) || '').localeCompare(companyDisplayName(b) || '', lang, { sensitivity: 'base', numeric: true }));
}

function toggleClientsShowArchived() {
  clientsShowArchived = !clientsShowArchived;
  syncClientsToolbarState();
  loadClientsList();
}

function toggleClientsArrange() {
  clientsArrangeMode = !clientsArrangeMode;
  syncClientsToolbarState();
  renderClientsList();
}

// Move up / move down, mirroring the catalog editor's own reorder controls.
// Reordering is what sets the order of every company dropdown in the app.
function buildClientReorderControls(index, total) {
  const wrap = pjMk('div', 'cl-card-reorder');
  // The card itself opens the client on click, so every control inside it has
  // to stop propagation or arranging would navigate away mid-arrange.
  const button = (icon, title, disabled, delta) => {
    const btn = pjMk('button', 'lookup-item-reorder-btn');
    btn.type = 'button';
    btn.innerHTML = ic(icon);
    btn.title = title;
    btn.disabled = disabled;
    btn.addEventListener('click', e => { e.stopPropagation(); moveClientInOrder(index, delta); });
    return btn;
  };
  wrap.addEventListener('click', e => e.stopPropagation());
  wrap.appendChild(button('chevron-up', 'Move up', index === 0, -1));
  wrap.appendChild(button('chevron-down', 'Move down', index === total - 1, 1));
  return wrap;
}

async function moveClientInOrder(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= clientsList.length) return;
  // Reorder the local list first and repaint, so arranging feels immediate;
  // the server call then persists exactly what is on screen.
  const next = clientsList.slice();
  [next[index], next[target]] = [next[target], next[index]];
  clientsList = next;
  renderClientsList();

  let res;
  try { res = await window.api.reorderClients(clientsList.map(c => c.id)); }
  catch { res = null; }
  if (!res?.ok) {
    toast(res?.error || 'Could not save the new order');
    loadClientsList();   // resync from the server rather than leave a lie on screen
    return;
  }
  refreshCompanyCatalog();
}

// Archive / restore. A soft-disable, never a delete — every historical task,
// project and invoice keeps pointing at the client; it just leaves the roster
// and the company dropdowns.
async function setClientArchived(companyId, isActive, { silent = false } = {}) {
  let res;
  try { res = await window.api.setClientActive(companyId, isActive); }
  catch { res = null; }
  if (!res?.ok) { toast(res?.error || 'Could not update this client'); return false; }

  await refreshCompanyCatalog();
  clientsLoaded = false;
  await loadClientsList();
  if (currentClient && currentClient.id === companyId) openClientDetail(companyId);
  if (!silent) {
    toast(isActive ? 'Client restored' : 'Client archived', {
      actionLabel: 'Undo',
      onAction: () => setClientArchived(companyId, !isActive, { silent: true }),
    });
  }
  return true;
}

// Inline rename from the client's own Overview tab, on the app-wide 300 ms
// auto-save debounce. Names only — the code has its own confirmed edit
// (buildClientIdentityEditor's Save), never this debounce.
let _clientRenameTimer = null;
function saveClientNamesDebounced(companyId) {
  clearTimeout(_clientRenameTimer);
  _clientRenameTimer = setTimeout(() => saveClientNames(companyId), 300);
}

async function saveClientNames(companyId) {
  const enInput = document.getElementById('cl-identity-name-en');
  const arInput = document.getElementById('cl-identity-name-ar');
  // The tab may have been switched (or another client opened) while the
  // debounce was pending — there is nothing to read, so there is nothing to save.
  if (!enInput || !arInput || !currentClient || currentClient.id !== companyId) return;

  const nameEn = enInput.value.trim();
  const nameAr = arInput.value.trim();
  if (!nameEn) { markError('cl-identity-name-en'); return; }
  if (nameEn === (currentClient.nameEn || '') && nameAr === (currentClient.nameAr || '')) return;

  let res;
  try { res = await window.api.renameClient(companyId, { nameEn, nameAr }); }
  catch { toast('Could not save the client name'); return; }
  if (!res?.ok) { markError('cl-identity-name-en'); toast(res?.error || 'Could not save the client name'); return; }

  clearErrorsIn('#clients-detail-view');
  currentClient.nameEn = res.client.nameEn;
  currentClient.nameAr = res.client.nameAr;
  currentClient.label  = res.client.label;
  // Patch the two places the name is already painted rather than re-rendering
  // the detail view, which would blow away focus and the caret mid-typing.
  const shown = companyDisplayName(currentClient) || 'Untitled';
  const title = document.querySelector('#clients-detail-view .pj-detail-title');
  if (title) title.textContent = shown;
  const crumb = document.querySelector('#clients-detail-view .pj-crumb-here');
  if (crumb) crumb.textContent = shown;
  // Every company dropdown in the app reads LK, so it has to hear about this too.
  await refreshCompanyCatalog();
  clientsLoaded = false;
}

// ── New Client modal ──────────────────────────────────────────────────────────
// Create only. A code can be changed later from the client's Overview tab.
function openClientCreateModal() {
  document.getElementById('cl-new-code').value = '';
  document.getElementById('cl-new-name-en').value = '';
  document.getElementById('cl-new-name-ar').value = '';
  clearErrorsIn('#client-create-modal');
  document.getElementById('client-create-modal-overlay').classList.add('open');
}
function closeClientCreateModal() {
  document.getElementById('client-create-modal-overlay').classList.remove('open');
}
function clientCreateOverlayClick(e) {
  if (e.target === document.getElementById('client-create-modal-overlay')) closeClientCreateModal();
}

// Codes are upper-case and space-free by construction, so the field shapes what
// is typed instead of rejecting it after the fact. Matches the pattern db.js
// validates against (COMPANY_CODE_RE).
function normalizeClientCodeInput(el) {
  const caretAtEnd = el.selectionStart === el.value.length;
  el.value = el.value.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_-]/g, '');
  if (caretAtEnd) el.setSelectionRange(el.value.length, el.value.length);
}

async function submitClientCreateModal() {
  clearErrorsIn('#client-create-modal');
  const code   = document.getElementById('cl-new-code').value.trim().toUpperCase();
  const nameEn = document.getElementById('cl-new-name-en').value.trim();
  const nameAr = document.getElementById('cl-new-name-ar').value.trim();

  if (!code) { markError('cl-new-code'); toast('A client needs a company code'); return; }
  if (!nameEn) { markError('cl-new-name-en'); toast('A client needs an English name'); return; }

  let res;
  try { res = await window.api.createClient({ code, nameEn, nameAr }); }
  catch { toast('Could not create the client'); return; }
  if (!res?.ok) {
    // The server distinguishes a code clash from a name clash; point the error
    // at whichever field the user actually has to change.
    markError(/code/i.test(res?.error || '') ? 'cl-new-code' : 'cl-new-name-en');
    toast(res?.error || 'Could not create the client');
    return;
  }

  closeClientCreateModal();
  await refreshCompanyCatalog();
  clientsLoaded = false;
  await loadClientsList();
  toast('Client created');
  openClientDetail(res.client.id);
}

function showClientsListView() {
  document.getElementById('clients-detail-view').style.display = 'none';
  document.getElementById('clients-list-view').style.display = '';
}
function showClientDetailView() {
  document.getElementById('clients-list-view').style.display = 'none';
  document.getElementById('clients-detail-view').style.display = '';
}

// `index`/`total` position the card within the roster, for Arrange mode's
// move up/down buttons. Both are omitted when the card isn't in the ordered
// grid (e.g. a search-results context), which simply hides those controls.
function buildClientCard(c, projectCount, index, total) {
  const archived = c.isActive === false;
  const card = pjMk('div', 'pj-card' + (archived ? ' cl-card-archived' : ''));
  card.addEventListener('click', () => openClientDetail(c.id));

  const head = pjMk('div', 'pj-card-head');
  const identity = pjMk('div', 'client-card-identity');
  identity.appendChild(pjMk('div', 'pj-card-name', companyDisplayName(c) || 'Untitled'));
  head.appendChild(identity);
  if (c.code) head.appendChild(pjMk('span', 'client-code-badge', c.code));
  if (archived) head.appendChild(pjMk('span', 'cl-archived-badge', 'Archived'));
  card.appendChild(head);

  // One chip per record type, each its own icon + number + label so the label
  // translates on its own and the number never drifts under RTL bidi. Same
  // icons as the detail view's section tiles; an empty type is dimmed.
  const stats = pjMk('div', 'cl-card-stats');
  [
    ['folder', projectCount || 0, 'Projects'],
    ['zap', c.vpnCount || 0, 'Access'],
    ['server', c.serverCount || 0, 'Servers'],
    ['layout-dashboard', c.internalSystemCount || 0, 'Systems'],
  ].forEach(([icon, n, label]) => {
    const chip = pjMk('span', 'cl-card-stat' + (n ? '' : ' is-empty'));
    chip.innerHTML = ic(icon);
    chip.appendChild(pjMk('b', 'cl-card-stat-n', String(n)));
    chip.appendChild(pjMk('span', 'cl-card-stat-label', label));
    stats.appendChild(chip);
  });
  card.appendChild(stats);

  const foot = pjMk('div', 'pj-card-foot cl-card-foot');

  // An archived client's primary action is getting it back, so Restore takes
  // the slot "Open" normally holds. Opening it still works via the card body.
  if (archived) {
    const restore = pjMk('button', 'btn cl-card-restore');
    restore.type = 'button';
    restore.innerHTML = ic('rotate-ccw') + 'Restore';
    restore.addEventListener('click', e => { e.stopPropagation(); setClientArchived(c.id, false); });
    foot.appendChild(restore);
  } else {
    const open = pjMk('span', 'pj-card-open', 'Open');
    open.insertAdjacentHTML('beforeend', ic('chevron-right'));
    foot.appendChild(open);
  }
  card.appendChild(foot);

  if (clientsArrangeMode && Number.isInteger(index) && Number.isInteger(total)) {
    card.appendChild(buildClientReorderControls(index, total));
  }

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
  const web     = document.getElementById('clients-web');
  grid.innerHTML = '';
  results.innerHTML = '';
  web.hidden = true;

  if (clientsView !== 'cards' && clientsList.length) {
    grid.style.display = 'none';
    results.style.display = 'none';
    empty.hidden = true;
    web.hidden = false;
    renderClientsWeb(web);
    return;
  }

  if (clientsList.length === 0) {
    grid.style.display = 'none';
    results.style.display = 'none';
    empty.hidden = false;
    empty.querySelector('p').innerHTML = clientsShowArchived
      ? 'No clients yet — click <strong>+ New Client</strong> to add one'
      : 'No active clients — click <strong>+ New Client</strong> to add one, or <strong>Show archived</strong>';
    return;
  }

  const q = clientRecordFilter;
  if (!q) {
    results.style.display = 'none';
    grid.style.display = '';
    empty.hidden = true;
    const projCounts = clientProjectCounts();
    // Arrange's move buttons index into the saved order, so a name-sorted
    // view passes no position and the card leaves them off.
    const sorted = !!clientsSort;
    clientsInViewOrder().forEach((c, i) =>
      grid.appendChild(sorted
        ? buildClientCard(c, projCounts.get(c.id) || 0)
        : buildClientCard(c, projCounts.get(c.id) || 0, i, clientsList.length)));
    return;
  }

  grid.style.display = 'none';
  const matches = [];
  clientsList.forEach(c => {
    if (textMatch([c.code, c.nameEn, c.nameAr, c.label], q)) {
      // Search still matches across both languages above, but the result shows
      // only the current-language name (via companyDisplayName) plus the code.
      matches.push({ companyId: c.id, companyLabel: companyDisplayName(c), type: 'profile', typeLabel: 'Client Profile', name: companyDisplayName(c), detail: c.code || '', fields: [] });
    }
    (c.records || []).forEach(r => {
      if (textMatch(r.fields, q)) matches.push({ companyId: c.id, companyLabel: companyDisplayName(c), ...r });
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

// ══ SYSTEMS WEB ══
// Clients on one side, systems on the other, a line wherever this login's
// records link the two (servers, projects, client tasks, Knowledge Hub items).
// A line's thickness is how many records link the pair; a system's shade is
// how many clients use it, so a shared system — the one an outage hits
// hardest — stands out. Order is barycentric (each side sorted by the mean
// position of what it links to) so lines cross as little as possible.
const CLIENTS_WEB_SOURCES = [['servers', 'Servers'], ['projects', 'Projects'], ['tasks', 'Tasks'], ['knowledge', 'Knowledge Hub']];
const CLIENTS_WEB_ROW = 44;    // px per node row
const CLIENTS_WEB_NODE_W = 210;

async function renderClientsWeb(host) {
  if (!clientsWebLinks) {
    host.innerHTML = '';
    host.appendChild(pjMk('div', 'cp-records-empty', 'Loading…'));
    try { clientsWebLinks = await window.api.getClientSystemWeb(); }
    catch { toast('Could not load the systems web'); clientsWebLinks = []; }
    if (clientsView === 'cards' || host.hidden) return;
  }
  drawClientsWeb(host);
}

// "1 client" / "3 clients", "1 system" / "3 systems".
function clientsWebCount(n, noun) {
  const key = n === 1 ? '1 ' + noun : '{n} ' + noun + 's';
  return window.ctI18n?.t?.(key, { n }) || key.replace('{n}', n);
}

// Tasks and Knowledge Hub links follow their pages in Settings → Pages.
function clientsWebSourceHidden(key) {
  return (key === 'tasks' && isPageHidden('all-tasks')) || (key === 'knowledge' && isPageHidden('knowledge'));
}
function clientsWebOn(key) {
  return clientsWebSources.has(key) && !clientsWebSourceHidden(key);
}

function clientsWebWeight(l) {
  return (clientsWebOn('servers') ? l.servers : 0) + (clientsWebOn('projects') ? l.projects : 0)
    + (clientsWebOn('tasks') ? l.tasks : 0) + (clientsWebOn('knowledge') ? l.knowledge : 0);
}

// "Acme ↔ ERP" plus what links them, for a line's hover text.
function clientsWebLinkText(l, clientName, systemName) {
  const t = (text, vars) => window.ctI18n?.t?.(text, vars) || text.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  const parts = [];
  if (clientsWebOn('servers') && l.servers) parts.push(t('{n} server(s)', { n: l.servers }));
  if (clientsWebOn('projects') && l.projects) parts.push(t('{n} project(s)', { n: l.projects }));
  if (clientsWebOn('tasks') && l.tasks) {
    parts.push(t('{n} task(s)', { n: l.tasks }) + (l.minutes ? ' (' + hoursPhrase(Math.round(l.minutes / 6) / 10) + ')' : ''));
  }
  if (clientsWebOn('knowledge') && l.knowledge) parts.push(t('{n} Knowledge Hub item(s)', { n: l.knowledge }));
  return clientName + ' ↔ ' + systemName + '\n' + parts.join(' · ');
}

function drawClientsWeb(host) {
  host.innerHTML = '';

  // "Linked through" — which record types count as a link.
  const sources = pjMk('div', 'cl-web-sources');
  sources.appendChild(pjMk('span', 'cl-web-sources-label', 'Linked through'));
  CLIENTS_WEB_SOURCES.filter(([key]) => !clientsWebSourceHidden(key)).forEach(([key, label]) => {
    const on = clientsWebSources.has(key);
    const b = pjMk('button', 'pfm-chip' + (on ? ' active' : ''), label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => {
      // At least one source stays on, or there would be nothing to draw.
      if (on && CLIENTS_WEB_SOURCES.filter(([k]) => clientsWebOn(k)).length === 1) return;
      if (on) clientsWebSources.delete(key); else clientsWebSources.add(key);
      drawClientsWeb(host);
    });
    sources.appendChild(b);
  });
  host.appendChild(sources);

  const shown = new Map(clientsList.map(c => [c.id, c]));
  const links = (clientsWebLinks || [])
    .filter(l => shown.has(l.companyId) && (LK.categories.SYSTEM || []).some(s => Number(s.id) === l.systemId))
    .map(l => ({ ...l, w: clientsWebWeight(l) }))
    .filter(l => l.w > 0);
  if (!links.length) {
    host.appendChild(pjMk('div', 'cp-records-empty', 'No client is linked to a system yet.'));
    return;
  }

  const clients = new Map();
  const systems = new Map();
  const nodeOf = (map, id, name) => {
    if (!map.has(id)) map.set(id, { id, name, links: [] });
    return map.get(id);
  };
  links.forEach(l => {
    nodeOf(clients, l.companyId, companyDisplayName(shown.get(l.companyId))).links.push(l);
    nodeOf(systems, l.systemId, lkLabelById('SYSTEM', l.systemId)).links.push(l);
  });
  const lang = rptLanguage();
  const byName = (a, b) => a.name.localeCompare(b.name, lang, { sensitivity: 'base', numeric: true });
  let cOrder = [...clients.values()].sort((a, b) => b.links.length - a.links.length || byName(a, b));
  let sOrder = [...systems.values()].sort((a, b) => b.links.length - a.links.length || byName(a, b));
  const rank = order => new Map(order.map((n, i) => [n.id, i]));
  const mean = (node, ranks, key) => {
    let sum = 0, weight = 0;
    node.links.forEach(l => { sum += ranks.get(l[key]) * l.w; weight += l.w; });
    return weight ? sum / weight : 0;
  };
  for (let pass = 0; pass < 6; pass++) {
    const cr = rank(cOrder);
    sOrder = sOrder.map(n => ({ n, m: mean(n, cr, 'companyId') })).sort((a, b) => a.m - b.m).map(x => x.n);
    const sr = rank(sOrder);
    cOrder = cOrder.map(n => ({ n, m: mean(n, sr, 'systemId') })).sort((a, b) => a.m - b.m).map(x => x.n);
  }

  // Headline: the systems the most clients share.
  const shared = [...systems.values()].filter(s => s.links.length > 1)
    .sort((a, b) => b.links.length - a.links.length || byName(a, b)).slice(0, 3);
  if (shared.length) {
    const head = pjMk('div', 'cl-web-headline');
    head.appendChild(pjMk('span', 'cl-web-headline-label', 'Most shared'));
    shared.forEach(s => {
      const chip = pjMk('button', 'cl-web-shared');
      chip.type = 'button';
      const name = pjMk('b', '', s.name);
      name.dataset.userContent = '';
      chip.appendChild(name);
      chip.appendChild(pjMk('span', '', clientsWebCount(s.links.length, 'client')));
      chip.addEventListener('click', () => { clientsWebPinned = clientsWebPinned === s.id ? null : s.id; drawClientsWeb(host); });
      head.appendChild(chip);
    });
    host.appendChild(head);
  }

  // The same model drawn around a circle (systems-wheel.js).
  if (clientsView === 'wheel') {
    drawSystemsWheel(host, { clients, systems, cOrder, sOrder, links });
    clientsWebUnlinkedNote(host, clients);
    return;
  }

  // ── The stage: HTML nodes over an SVG of lines ──
  const rows = Math.max(cOrder.length, sOrder.length);
  const H = rows * CLIENTS_WEB_ROW;
  // The box around the stage has 12px padding and a 1px border on each side.
  const W = Math.max(560, (host.clientWidth || 900) - 26);
  const rtl = document.documentElement.dir === 'rtl';
  const yOf = (i, n) => (i + 0.5) * H / n;
  const cy = new Map(cOrder.map((n, i) => [n.id, yOf(i, cOrder.length)]));
  const sy = new Map(sOrder.map((n, i) => [n.id, yOf(i, sOrder.length)]));
  const xIn = x => (rtl ? W - x : x);
  const x1 = xIn(CLIENTS_WEB_NODE_W), x2 = xIn(W - CLIENTS_WEB_NODE_W);

  const stage = pjMk('div', 'cl-web-stage');
  stage.style.height = H + 'px';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'cl-web-links');
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('aria-hidden', 'true');
  const maxW = Math.max(...links.map(l => l.w));
  links.forEach(l => {
    const a = cy.get(l.companyId), b = sy.get(l.systemId), mid = (x1 + x2) / 2;
    const d = `M${x1},${a} C${mid},${a} ${mid},${b} ${x2},${b}`;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'cl-web-link');
    g.dataset.c = l.companyId; g.dataset.s = l.systemId;
    const line = document.createElementNS(NS, 'path');
    line.setAttribute('d', d);
    line.setAttribute('class', 'cl-web-line');
    line.setAttribute('stroke-width', (1.5 + 6.5 * Math.sqrt(l.w / maxW)).toFixed(2));
    // A wider invisible twin is the hover target, so a thin line is easy to hit.
    const hit = document.createElementNS(NS, 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('class', 'cl-web-hit');
    const title = document.createElementNS(NS, 'title');
    title.textContent = clientsWebLinkText(l, clients.get(l.companyId).name, systems.get(l.systemId).name);
    hit.appendChild(title);
    hit.addEventListener('mouseenter', () => lightUp({ c: l.companyId, s: l.systemId }));
    hit.addEventListener('mouseleave', () => lightUp(null));
    g.append(line, hit);
    svg.appendChild(g);
  });
  stage.appendChild(svg);

  // Light up one node's (or one line's) neighbourhood and dim the rest; with
  // nothing hovered, the pinned system (if any) stays lit.
  const lightUp = focus => {
    const f = focus || (clientsWebPinned != null && systems.has(clientsWebPinned) ? { s: clientsWebPinned } : null);
    stage.classList.toggle('has-focus', !!f);
    const litC = new Set(), litS = new Set();
    stage.querySelectorAll('.cl-web-link').forEach(g => {
      const c = Number(g.dataset.c), s = Number(g.dataset.s);
      const on = !!f && (f.c == null || f.c === c) && (f.s == null || f.s === s);
      g.classList.toggle('is-lit', on);
      if (on) { litC.add(c); litS.add(s); }
    });
    stage.querySelectorAll('.cl-web-node').forEach(n => {
      const id = Number(n.dataset.id);
      n.classList.toggle('is-lit', n.dataset.kind === 'client' ? litC.has(id) : litS.has(id));
    });
  };

  const maxShare = Math.max(...sOrder.map(s => s.links.length));
  const node = (kind, n, y) => {
    const b = pjMk('button', 'cl-web-node is-' + kind);
    b.type = 'button';
    b.dataset.kind = kind; b.dataset.id = n.id;
    b.style.top = (y - 16) + 'px';
    const name = pjMk('span', 'cl-web-name', n.name);
    name.dataset.userContent = ''; name.dir = 'auto';
    b.appendChild(name);
    b.appendChild(pjMk('span', 'cl-web-count',
      kind === 'client' ? clientsWebCount(n.links.length, 'system') : clientsWebCount(n.links.length, 'client')));
    const focus = kind === 'client' ? { c: n.id } : { s: n.id };
    b.addEventListener('mouseenter', () => lightUp(focus));
    b.addEventListener('mouseleave', () => lightUp(null));
    b.addEventListener('focus', () => lightUp(focus));
    b.addEventListener('blur', () => lightUp(null));
    if (kind === 'client') {
      b.title = 'Open client';
      b.addEventListener('click', () => openClientDetail(n.id));
    } else {
      // Sequential shade: the more clients share a system, the stronger it is.
      b.style.setProperty('--share', String(Math.round(8 + 34 * (n.links.length - 1) / Math.max(1, maxShare - 1))) + '%');
      b.title = 'Click to keep it highlighted';
      b.setAttribute('aria-pressed', String(clientsWebPinned === n.id));
      b.addEventListener('click', () => { clientsWebPinned = clientsWebPinned === n.id ? null : n.id; lightUp(null); b.setAttribute('aria-pressed', String(clientsWebPinned === n.id)); });
    }
    return b;
  };
  cOrder.forEach(n => stage.appendChild(node('client', n, cy.get(n.id))));
  sOrder.forEach(n => stage.appendChild(node('system', n, sy.get(n.id))));

  const scroller = pjMk('div', 'cl-web-scroll');
  const colHeads = pjMk('div', 'cl-web-colheads');
  colHeads.append(pjMk('span', '', 'Clients'), pjMk('span', '', 'Systems'));
  scroller.append(colHeads, stage);
  colHeads.style.width = stage.style.width = W + 'px';
  host.appendChild(scroller);
  lightUp(null);

  const legend = pjMk('div', 'cl-web-legend');
  legend.append(pjMk('span', '', 'Thicker line = more linked records'),
    pjMk('span', '', 'Darker system = used by more clients'));
  host.appendChild(legend);
  clientsWebUnlinkedNote(host, clients);
}

// Clients the web and wheel leave out because nothing links them to a system.
function clientsWebUnlinkedNote(host, clients) {
  const unlinked = clientsList.filter(c => !clients.has(c.id));
  if (unlinked.length) {
    const note = pjMk('div', 'cl-web-unlinked');
    note.appendChild(pjMk('span', '', 'Not linked to any system yet:'));
    const names = pjMk('span', '', unlinked.map(c => companyDisplayName(c)).join(', '));
    names.dataset.userContent = '';
    note.appendChild(names);
    host.appendChild(note);
  }
}

// The web is laid out to the page's width, so it is redrawn when that changes.
let clientsWebResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(clientsWebResizeTimer);
  clientsWebResizeTimer = setTimeout(() => {
    const host = document.getElementById('clients-web');
    if (host && !host.hidden && clientsView !== 'cards' && clientsWebLinks) drawClientsWeb(host);
  }, 150);
});

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
// `tab`, when given, wins over both the preset search and the remembered tab —
// it is how a deep link lands on the right part of the client's page.
async function openClientDetail(companyId, presetSearch, tab) {
  let client;
  try { client = await window.api.getClient(companyId); }
  catch { toast('Could not open client'); return; }
  if (!client) { toast('Client not found'); return; }
  currentClient = client;
  clientDetailSearch = tab ? '' : (presetSearch || '');
  clientDetailTab = tab || (presetSearch ? 'overview' : (uiState.filters.clients?.tab || 'overview'));
  if (!CLIENT_DETAIL_TYPES.some(t => t.key === clientDetailTab) || clientTabHidden(clientDetailTab)) clientDetailTab = 'overview';
  clientPfmFor = null;   // a fresh open re-reads this client's Offers & CRs
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
    ['host', 'Host (IP)'], ['hostname', 'Hostname'], ['os', 'Operating System'], ['accessMethod', 'Access'],
    ['status', 'Status'], ['linkedServers', 'Linked Servers'], ['workloads', 'Workloads'],
    ['externalParties', 'External Parties'],
    ['username', 'Username'], ['password', 'Password', true], ['notes', 'Notes'],
  ],
  databases: [
    ['name', 'Name'], ['engine', 'Engine'], ['version', 'Version'], ['port', 'Port'],
    ['username', 'Username'], ['password', 'Password', true],
    ['connectionString', 'Connection String', true], ['notes', 'Notes'],
  ],
  internal: [
    ['name', 'Name'], ['url', 'URL'], ['username', 'Username'], ['password', 'Password', true],
    ['systemName', 'System Name'], ['environment', 'Environment'], ['companyCode', 'Company Code'],
    ['secretKey', 'Secret Key', true], ['expiryDate', 'Expiry Date'], ['role', 'Role'], ['notes', 'Notes'],
  ],
};
// Databases live inside their servers, so they are gathered from there.
const CLIENT_RECORD_ARRAYS = {
  auth: c => c.vpnConnections, servers: c => c.servers, internal: c => c.internalSystems,
  databases: c => (c.servers || []).flatMap(s => s.databases || []),
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
  const arr = client ? CLIENT_RECORD_ARRAYS[record.type]?.(client) : null;
  const full = Array.isArray(arr) ? arr.find(r => r.id === record.id) : null;
  if (!full) { list.innerHTML = '<div class="cp-records-empty">This record no longer exists.</div>'; return; }

  list.innerHTML = '';
  // A PAM server's login lives in the PAM vault, so it is not shown here either.
  const viaPam = record.type === 'servers' && full.accessMethod === 'PAM';
  (CLIENT_RECORD_INFO_FIELDS[record.type] || []).forEach(([key, label, sensitive]) => {
    if (viaPam && (key === 'username' || key === 'password')) return;
    // A server's lists (migration 076) copy as one item per line; its status reads as words.
    let value = full[key];
    if (Array.isArray(value)) value = value.join('\n');
    else if (record.type === 'servers' && key === 'status') value = srvStatusLabel(value);
    // A credential this device holds no key for reads back empty — say so,
    // rather than letting it pass as '(empty)', which would mean "never set".
    const locked = sensitive && !value && full[key + 'Unreadable'];
    const row = pjMk('div', 'cl-info-row' + (value ? '' : ' not-copyable'));
    const main = pjMk('div', 'cl-info-main');
    main.appendChild(pjMk('div', 'cl-info-label', label));
    main.appendChild(pjMk('div', 'cl-info-value' + (value ? '' : ' empty'),
      locked ? 'Cannot be read on this device' : value ? (sensitive ? '••••••••' : value) : '(empty)'));
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
  crumbs.appendChild(pjMk('span', 'pj-crumb-here', companyDisplayName(c) || 'Untitled'));
  host.appendChild(crumbs);

  // The header is the identity: the name (with a rename pencil), the code
  // chip (with its own confirmed edit) and Archive. Shown on every tab.
  const head = pjMk('div', 'pj-detail-head cl-detail-head');
  head.appendChild(buildClientIdentityHeader(c));
  head.appendChild(buildClientArchiveSlot(c));
  host.appendChild(head);

  // Search toolbar, then the section tiles. Kept out of the re-rendered section
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
  host.appendChild(toolbar);
  host.appendChild(buildClientSectionTiles(c));
  updateClientDetailTabCounts();
  ensureClientPfmRows(c.id);
  ensureKnowledgeIndex();

  const sectionsHost = pjMk('div', 'cl-detail-sections');
  sectionsHost.id = 'client-detail-sections';
  host.appendChild(sectionsHost);

  renderClientDetailSections(c);
}

// The section tiles are the client page's navigation: one per section, in the
// same hues as the Overview timeline, each with its count. A tile opens its
// section; clicking the open one goes back to the Overview.
const CLIENT_SECTION_TILES = [
  ['projects', 'Projects', 'folder', 'project'],
  ['pfm', 'Offers & CRs', 'file-text', 'offer'],
  ['knowledge', 'Knowledge Hub', 'book-open', 'knowledge'],
  ['auth', 'Access records', 'zap', 'access'],
  ['servers', 'Servers', 'server', 'server'],
  ['internal', 'Internal systems', 'layout-dashboard', 'internal'],
];
function buildClientSectionTiles(c) {
  const counts = clientDetailTabCounts(c);
  const grid = pjMk('div', 'client-overview-grid');
  grid.id = 'client-detail-tabs';
  grid.setAttribute('aria-label', 'Client workspace');
  CLIENT_SECTION_TILES.filter(([key]) => !clientTabHidden(key)).forEach(([key, label, icon, hue]) => {
    const active = clientDetailTab === key;
    const card = pjMk('button', 'client-overview-card cl-tl-' + hue + (active ? ' active' : '')
      + (counts[key] ? '' : ' is-zero'));
    card.type = 'button';
    card.dataset.clientTab = key;
    card.setAttribute('aria-pressed', String(active));
    if (active) card.title = 'Back to overview';
    card.addEventListener('click', () => setClientDetailTab(clientDetailTab === key ? 'overview' : key));
    const tile = pjMk('span', 'cl-tl-icon');
    tile.innerHTML = ic(icon);
    card.appendChild(tile);
    const text = pjMk('span', 'client-overview-text');
    text.appendChild(pjMk('b', '', String(counts[key] || 0)));
    text.appendChild(pjMk('span', '', label));
    card.appendChild(text);
    grid.appendChild(card);
  });
  return grid;
}

// Each section's record count, for the tiles.
function clientDetailTabCounts(c) {
  return {
    projects: projectsList.filter(p => cpjPrimaryCompany(p)?.id === c.id).length,
    pfm: clientPfmCount(c.id),
    knowledge: clientKnowledgeCount(c.id),
    auth: Array.isArray(c.vpnConnections) ? c.vpnConnections.length : 0,
    servers: Array.isArray(c.servers) ? c.servers.length : 0,
    internal: Array.isArray(c.internalSystems) ? c.internalSystems.length : 0,
  };
}
// Knowledge Hub items linked to this client (the Hub index loads on demand).
function clientKnowledgeCount(companyId) {
  return knowledgeLoaded ? knowledgeItemsLinkedTo([companyId]).length : 0;
}
// Called when the Hub index loads or changes, so the open client's counts follow.
function refreshClientKnowledgeCount() {
  if (!currentClient) return;
  updateClientDetailTabCounts();
  refreshClientOverviewBody();
}
function updateClientDetailTabCounts() {
  if (!currentClient) return;
  const counts = clientDetailTabCounts(currentClient);
  document.querySelectorAll('#client-detail-tabs [data-client-tab]').forEach(card => {
    const n = counts[card.dataset.clientTab] || 0;
    card.querySelector('b').textContent = String(n);
    card.classList.toggle('is-zero', !n);
  });
}

// Rebuilds only the record sections (not the toolbar/search input above),
// filtered by `clientDetailSearch` (human-identifying fields only — never
// password/secretKey, per the no-credential-search rule) and the active detail tab.
// Called on every search keystroke / workspace-tab switch, and once from
// renderClientDetail on open/reload.
function renderClientDetailSections(c) {
  const host = document.getElementById('client-detail-sections');
  if (!host) return;
  host.innerHTML = '';

  const q = clientDetailSearch;
  const allServers = Array.isArray(c.servers) ? c.servers : [];
  const allInternalSystems = Array.isArray(c.internalSystems) ? c.internalSystems : [];
  const vpns = Array.isArray(c.vpnConnections) ? c.vpnConnections : [];

  if (!q && clientDetailTab === 'overview') {
    renderClientOverview(host, c);
    return;
  }
  const showSection = key => !clientTabHidden(key) && (!!q || clientDetailTab === key);

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

  // ── Knowledge Hub items linked to this client (built in knowledge.js) ──
  if (showSection('knowledge')) {
    host.appendChild(buildKnowledgeLinkedSection({ companyIds: [c.id], q, emptyText: 'No Knowledge Hub items for this client yet.' }));
  }

  // ── Offers & CRs (Project & Finance, this client only — built in pfm.js) ──
  if (showSection('pfm')) host.appendChild(buildClientPfmSection(c, q));

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
    const sView = pjMk('div', 'seg-ctl');
    sView.setAttribute('role', 'group');
    sView.setAttribute('aria-label', 'Show servers as');
    [['list', 'rows-3', 'List'], ['map', 'layers', 'Map'], ['wheel', 'share-2', 'Wheel']].forEach(([view, icon, label]) => {
      const b = pjMk('button', 'seg-btn' + (clientServersView === view ? ' active' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(clientServersView === view));
      b.innerHTML = ic(icon);
      b.appendChild(document.createTextNode(label));
      b.addEventListener('click', () => { clientServersView = view; renderClientDetailSections(c); });
      sView.appendChild(b);
    });
    sActions.appendChild(sView);
    const sAddGroupBtn = pjMk('button', 'btn');
    sAddGroupBtn.innerHTML = ic('plus') + ' New Group';
    sAddGroupBtn.title = 'Group existing servers under a new (or existing) System name';
    sAddGroupBtn.addEventListener('click', () => openClientNewGroupModal('server'));
    sActions.appendChild(sAddGroupBtn);
    // A database sits on a server, so there is nothing to add it to until one exists.
    const sAddDbBtn = pjMk('button', 'btn');
    sAddDbBtn.innerHTML = ic('database') + ' Add Database';
    sAddDbBtn.disabled = allServers.length === 0;
    if (sAddDbBtn.disabled) sAddDbBtn.title = 'Add a server first';
    sAddDbBtn.addEventListener('click', () => openClientDatabaseModal(null, null));
    sActions.appendChild(sAddDbBtn);
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
    // A server is also found by the databases it hosts, and by its three lists (076).
    const shownServers = allServers.filter(s => textMatch([s.host, s.hostname, s.os, s.systemName, s.roleLabel,
      ...(s.databases || []).flatMap(d => [d.name, d.engine]),
      ...(s.linkedServers || []), ...(s.workloads || []), ...(s.externalParties || [])], q));
    if (allServers.length === 0) {
      srvSec.appendChild(pjMk('div', 'cp-records-empty', 'No servers recorded yet.'));
    } else if (shownServers.length === 0) {
      srvSec.appendChild(pjMk('div', 'cp-records-empty', 'No servers match your search.'));
    } else if (clientServersView === 'map') {
      srvSec.appendChild(buildClientServerMap(c, shownServers));
    } else if (clientServersView === 'wheel') {
      srvSec.appendChild(buildServerWheel(shownServers));
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

// The identity half of the header. View: the display name (current language
// only — never the other one) with one Edit pencil, and the code as a chip.
// Edit swaps it in place for the company code and BOTH names (you cannot
// maintain an Arabic name you cannot see). Names auto-save on the usual
// debounce; the code never does — Save asks "Change company code?" inline,
// and changeClientCode raises the undo toast. Escape closes without touching
// the code.
function buildClientIdentityHeader(c) {
  const block = pjMk('div', 'client-detail-identity');
  const showView = () => {
    block.innerHTML = '';
    const row = pjMk('div', 'cl-title-row');
    const title = pjMk('div', 'pj-detail-title', companyDisplayName(c) || 'Untitled');
    title.dataset.userContent = '';
    row.appendChild(title);
    const edit = pjMk('button', 'row-btn cl-title-edit');
    edit.type = 'button';
    edit.id = 'cl-identity-edit';
    edit.innerHTML = ic('pencil');
    edit.title = 'Edit code and names';
    edit.setAttribute('aria-label', 'Edit code and names');
    edit.addEventListener('click', showEdit);
    row.appendChild(edit);
    block.appendChild(row);
    const chip = pjMk('div', 'cl-identity-code is-chip');
    chip.title = 'Company Code';
    const code = pjMk('b', '', c.code || '—');
    code.dataset.userContent = '';
    chip.appendChild(code);
    block.appendChild(chip);
  };
  const showEdit = () => {
    block.innerHTML = '';
    block.appendChild(buildClientIdentityEditor(c, showView));
    document.getElementById('cl-identity-name-en')?.focus();
  };
  showView();
  return block;
}

function buildClientIdentityEditor(c, close) {
  const wrap = pjMk('div', 'cl-identity-editor');
  const editor = pjMk('div', 'client-profile-summary');
  const field = (caption, id, cls) => {
    const f = pjMk('div', 'client-profile-summary-field' + (cls ? ' ' + cls : ''));
    const label = document.createElement('label');
    label.textContent = caption;
    label.setAttribute('for', id);
    f.appendChild(label);
    const input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.className = 'cl-identity-input';
    input.dataset.userContent = '';
    f.appendChild(input);
    editor.appendChild(f);
    return input;
  };
  const codeInput = field('Company Code', 'cl-identity-code', 'cl-identity-code-field');
  codeInput.dir = 'ltr';
  codeInput.value = c.code || '';
  codeInput.addEventListener('input', () => normalizeClientCodeInput(codeInput));
  const enInput = field('English Name', 'cl-identity-name-en');
  enInput.dir = 'ltr';
  enInput.value = c.nameEn || c.label || '';
  const arInput = field('Arabic Name', 'cl-identity-name-ar');
  arInput.dir = 'rtl';
  arInput.value = c.nameAr || '';
  [enInput, arInput].forEach(input => input.addEventListener('input', () => saveClientNamesDebounced(c.id)));

  const acts = pjMk('div', 'cl-code-acts');
  const renderActs = () => {
    acts.innerHTML = '';
    const save = pjMk('button', 'btn primary', 'Save');
    save.type = 'button';
    save.addEventListener('click', finish);
    acts.appendChild(save);
  };
  // Flush the names first; English cannot be blank (saveClientNames marks it).
  const flushNames = async () => {
    clearTimeout(_clientRenameTimer);
    await saveClientNames(c.id);
    return !!enInput.value.trim();
  };
  const finish = async () => {
    clearErrorsIn('#clients-detail-view');
    if (!await flushNames()) return;
    const code = codeInput.value.trim().toUpperCase();
    if (!code) { markError('cl-identity-code'); toast('A client needs a company code'); return; }
    if (code === c.code) { close(); return; }
    showDeleteConfirm(acts, async () => {
      if (await changeClientCode(c.id, code)) return;   // re-opens the client page
      markError('cl-identity-code');
      renderActs();
    }, renderActs, 'Change company code?');
  };
  [codeInput, enInput, arInput].forEach(input => input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(); }
    else if (e.key === 'Escape') { e.preventDefault(); if (await flushNames()) close(); }
  }));
  renderActs();
  editor.appendChild(acts);
  wrap.appendChild(editor);
  wrap.appendChild(pjMk('span', 'modal-hint',
    'Must be unique. Links stay intact; files already exported keep the old code.'));
  return wrap;
}

// Archive acts on the client itself, so it sits at the end of the header. It
// confirms inline before acting (plus the undo toast setClientArchived raises).
// Restoring an already-archived client needs neither.
function buildClientArchiveSlot(c) {
  const archiveSlot = pjMk('div', 'cl-archive-slot');
  const renderArchiveAction = () => {
    archiveSlot.innerHTML = '';
    if (c.isActive === false) {
      const restore = pjMk('button', 'btn');
      restore.type = 'button';
      restore.innerHTML = ic('rotate-ccw') + 'Restore Client';
      restore.addEventListener('click', () => setClientArchived(c.id, true));
      archiveSlot.appendChild(restore);
      return;
    }
    const archive = pjMk('button', 'btn');
    archive.type = 'button';
    archive.innerHTML = ic('ban') + 'Archive Client';
    archive.title = 'Hide this client from the roster and from company dropdowns. Nothing is deleted.';
    archive.addEventListener('click', () =>
      showDeleteConfirm(archiveSlot, () => setClientArchived(c.id, false), renderArchiveAction, 'Archive this client?'));
    archiveSlot.appendChild(archive);
    archiveSlot.appendChild(buildClientDeleteButton(c, archiveSlot, renderArchiveAction));
  };
  renderArchiveAction();
  return archiveSlot;
}

// Delete is offered only to a client nothing points at. It starts disabled and
// is enabled once the main process confirms zero links; deleteClient re-checks
// inside its own write, so this is a hint, never the guard.
function buildClientDeleteButton(c, slot, rerender) {
  const del = pjMk('button', 'btn');
  del.type = 'button';
  del.innerHTML = ic('trash-2') + 'Delete Client';
  del.disabled = true;
  del.title = 'Checking for linked records…';
  window.api.getClientLinkCount(c.id).then(res => {
    if (!del.isConnected || !res?.ok) return;
    del.disabled = res.count > 0;
    del.title = res.count > 0
      ? 'This client is still linked to other records. Archive it instead.'
      : 'Nothing is linked to this client, so it can be deleted.';
  }).catch(() => {});
  del.addEventListener('click', () =>
    showDeleteConfirm(slot, () => deleteClientPermanently(c.id), rerender, 'Delete this client?'));
  return del;
}

async function deleteClientPermanently(companyId) {
  let res;
  try { res = await window.api.deleteClient(companyId); }
  catch { res = null; }
  if (!res?.ok) { toast(res?.error || 'Could not delete this client'); return false; }

  await refreshCompanyCatalog();
  clientsLoaded = false;
  backToClientsList();
  toast('Client deleted', {
    actionLabel: 'Undo', duration: 5000,
    onAction: async () => {
      let r;
      try { r = await window.api.restoreDeletedClient(companyId); }
      catch { r = null; }
      if (!r?.ok) { toast(r?.error || 'Could not restore this client'); return; }
      await refreshCompanyCatalog();
      clientsLoaded = false;
      openClientDetail(companyId);
    },
  });
  return true;
}

// Returns true on success. The undo toast sets the old code back, through the
// same uniqueness check (so it refuses only if another client took it since).
async function changeClientCode(companyId, code, { silent = false } = {}) {
  const before = currentClient && currentClient.id === companyId ? currentClient.code : null;
  let res;
  try { res = await window.api.changeClientCode(companyId, code); }
  catch { res = null; }
  if (!res?.ok) { toast(res?.error || 'Could not change the company code'); return false; }

  await refreshCompanyCatalog();
  clientsLoaded = false;
  await loadClientsList();
  if (currentClient && currentClient.id === companyId) openClientDetail(companyId);
  if (!silent) {
    toast('Company code changed', before ? {
      actionLabel: 'Undo', duration: 5000,
      onAction: () => changeClientCode(companyId, before, { silent: true }),
    } : undefined);
  }
  return true;
}

function renderClientOverview(host, c) {
  // Lives in its own container so it can be refilled in place when the
  // Offers & CRs rows or the Knowledge Hub index land.
  const body = pjMk('div', 'cl-overview-body');
  body.id = 'cl-overview-body';
  host.appendChild(body);
  fillClientOverviewBody(body, c);
}

// Called when async client data (Offers & CRs, Knowledge Hub) arrives.
function refreshClientOverviewBody() {
  const body = document.getElementById('cl-overview-body');
  if (body && currentClient) fillClientOverviewBody(body, currentClient);
}

function fillClientOverviewBody(body, c) {
  body.innerHTML = '';
  const counts = clientDetailTabCounts(c);

  // Adding happens inside each section (open its tile). A brand-new client
  // gets a short pointer to that instead of two empty panels. Only once
  // every source has loaded, so a client with records never flashes it.
  const allLoaded = projectsLoaded && knowledgeLoaded && clientPfmFor === c.id;
  if (allLoaded && Object.entries(counts).every(([key, n]) => !n || clientTabHidden(key))) {
    const guide = pjMk('div', 'pj-section cl-empty-guide');
    const title = pjMk('div', 'pj-section-title');
    title.innerHTML = ic('layers') + 'Nothing recorded for this client yet';
    guide.appendChild(title);
    guide.appendChild(pjMk('div', 'general-hint',
      'Open a section above to add its first record. Everything you add shows up here.'));
    body.appendChild(guide);
    return;
  }

  // Two panels side by side; they stack on a narrow window.
  const split = pjMk('div', 'cl-overview-split');
  split.appendChild(buildClientNeedsAttention(c));
  split.appendChild(buildClientRecentActivity(c));
  body.appendChild(split);
}

// What to act on for this client: logins and offers that have expired or will
// within 30 days, offers/CRs waiting on someone, and stored credentials this
// device cannot read. Worst first; each row opens its record.
const CLIENT_ATTENTION_LIMIT = 8;
function buildClientNeedsAttention(c) {
  const items = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysUntil = dateStr => Math.round((new Date(dateStr + 'T00:00:00') - today) / 86400000);
  const dueText = n => n < 0 ? 'Expired ' + (-n) + (n === -1 ? ' day ago' : ' days ago')
    : n === 0 ? 'Expires today' : 'Expires in ' + n + (n === 1 ? ' day' : ' days');
  // rank: 0 overdue, 1 due soon (ordered by date), 2 waiting, 3 unreadable.
  const push = (rank, order, level, icon, kind, name, why, open) =>
    items.push({ rank, order, level, icon, kind, name, why, open });
  const checkDate = (dateStr, icon, kind, name, open) => {
    if (!dateStr) return;
    const n = daysUntil(dateStr);
    if (isNaN(n) || n > 30) return;
    push(n < 0 ? 0 : 1, n, n < 0 ? 'bad' : 'warn', icon, kind, name, dueText(n), open);
  };

  (c.vpnConnections || []).forEach(v => {
    const open = () => openClientVpnModal(v);
    checkDate(v.expiryDate, 'zap', 'Access', v.connectionName, open);
    if (v.passwordUnreadable) push(3, 0, 'muted', 'lock', 'Access', v.connectionName, 'Cannot be read on this device', open);
  });
  (c.internalSystems || []).forEach(s => {
    const open = () => openClientInternalModal(s);
    checkDate(s.expiryDate, 'layout-dashboard', 'Internal system', s.name, open);
    if (s.passwordUnreadable || s.secretKeyUnreadable)
      push(3, 0, 'muted', 'lock', 'Internal system', s.name, 'Cannot be read on this device', open);
  });
  (c.servers || []).forEach(s => {
    if (!s.passwordUnreadable || s.accessMethod === 'PAM') return;
    push(3, 0, 'muted', 'lock', 'Server', [s.systemName, s.hostname || s.host].filter(Boolean).join(' · '),
      'Cannot be read on this device', () => openClientServerModal(s));
  });
  if (clientPfmFor === c.id && !isPageHidden('pfm')) clientPfmRows.filter(i => !i.isFinal && !i.archived).forEach(i => {
    const name = [i.reference, i.title].filter(Boolean).join(' · ');
    const open = () => openPfmDetail(i.id);
    checkDate(i.validUntil, 'file-text', pfmKindLabel(i.kind), name, open);
    if (i.nextStep) {
      const who = [pfmStatusName(i.nextStep.status), i.nextStep.memberName].filter(Boolean).join(' · ');
      push(2, 0, 'info', 'clipboard-list', pfmKindLabel(i.kind), name, who, open);
    }
  });

  items.sort((a, b) => a.rank - b.rank || a.order - b.order);

  const section = pjMk('div', 'pj-section');
  const head = pjMk('div', 'pj-section-title');
  head.innerHTML = ic('triangle-alert') + 'Needs attention';
  if (items.length) head.appendChild(pjMk('span', 'cl-att-count', String(items.length)));
  section.appendChild(head);
  if (!items.length) {
    const clear = pjMk('div', 'cl-att-clear');
    clear.innerHTML = ic('circle-check');
    clear.appendChild(pjMk('span', '', 'All clear. Nothing needs attention.'));
    section.appendChild(clear);
    return section;
  }
  const list = pjMk('div', 'cl-att-list');
  items.slice(0, CLIENT_ATTENTION_LIMIT).forEach(it => {
    const row = pjMk('button', 'cl-tl-row cl-att-' + it.level);
    row.type = 'button';
    row.addEventListener('click', it.open);
    const icon = pjMk('span', 'cl-tl-icon');
    icon.innerHTML = ic(it.icon);
    row.appendChild(icon);
    const main = pjMk('span', 'cl-tl-main');
    const name = pjMk('span', 'cl-tl-name', it.name || 'Untitled');
    if (it.name) name.dataset.userContent = '';
    main.appendChild(name);
    main.appendChild(pjMk('span', 'cl-tl-pill', it.kind));
    row.appendChild(main);
    const why = pjMk('span', 'cl-att-why', it.why);
    // A waiting step names a status and a person, both record content.
    if (it.rank === 2) why.dataset.userContent = '';
    row.appendChild(why);
    list.appendChild(row);
  });
  if (items.length > CLIENT_ATTENTION_LIMIT)
    list.appendChild(pjMk('div', 'cl-att-more', '+' + (items.length - CLIENT_ATTENTION_LIMIT) + ' more'));
  section.appendChild(list);
  return section;
}

// The latest changes across every tab, newest first, grouped by calendar day.
// Each row opens its record. Projects carry only a creation date, so that
// stands in for their last change.
const CLIENT_RECENT_LIMIT = 8;
function buildClientRecentActivity(c) {
  const entries = [];
  const add = (record, type, icon, kind, name, open) => {
    const when = new Date(record.updatedAt || record.createdAt || '');
    if (!isNaN(when.getTime())) entries.push({ when, type, icon, kind, name, open });
  };

  projectsList.filter(p => cpjPrimaryCompany(p)?.id === c.id)
    .forEach(p => add(p, 'project', 'folder', 'Project', p.name, () => openProjectById(p.id)));
  if (clientPfmFor === c.id && !isPageHidden('pfm')) clientPfmRows.forEach(i => add(i, i.kind === 'CR' ? 'cr' : 'offer',
    i.kind === 'CR' ? 'pencil' : 'file-text', pfmKindLabel(i.kind),
    [i.reference, i.title].filter(Boolean).join(' · '), () => openPfmDetail(i.id)));
  if (knowledgeLoaded && !isPageHidden('knowledge')) knowledgeItemsLinkedTo([c.id])
    .forEach(k => add(k, 'knowledge', 'book-open', 'Knowledge Hub', k.title, () => openKnowledgeInHub(k.id)));
  (c.vpnConnections || []).forEach(v => add(v, 'access', 'zap', 'Access', v.connectionName, () => openClientVpnModal(v)));
  (c.servers || []).forEach(s => add(s, 'server', 'server', 'Server',
    [s.systemName, s.hostname || s.host].filter(Boolean).join(' · '), () => openClientServerModal(s)));
  (c.internalSystems || []).forEach(s =>
    add(s, 'internal', 'layout-dashboard', 'Internal system', s.name, () => openClientInternalModal(s)));

  entries.sort((a, b) => b.when - a.when);

  const section = pjMk('div', 'pj-section');
  const title = pjMk('div', 'pj-section-title');
  title.innerHTML = ic('clock') + 'Recent activity';
  section.appendChild(title);
  if (!entries.length) {
    section.appendChild(pjMk('div', 'cp-records-empty', 'Nothing has changed yet.'));
    return section;
  }

  // Buckets by local calendar day, so "Yesterday" means the date, not 24 hours.
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 86400000;
  const bucketOf = d => {
    const t = d.getTime();
    if (t >= startOfToday.getTime()) return 'Today';
    if (t >= startOfToday.getTime() - dayMs) return 'Yesterday';
    if (t >= startOfToday.getTime() - 6 * dayMs) return 'This week';
    return 'Earlier';
  };
  // Western digits in Arabic too, matching the rest of the app.
  const locale = document.documentElement.lang === 'ar' ? 'ar-u-nu-latn' : undefined;
  const whenText = (d, bucket) =>
    bucket === 'Today' || bucket === 'Yesterday' ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      : bucket === 'This week' ? d.toLocaleDateString(locale, { weekday: 'long' })
        : d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  let group = null, groupName = '';
  entries.slice(0, CLIENT_RECENT_LIMIT).forEach(e => {
    const bucket = bucketOf(e.when);
    if (bucket !== groupName) {
      groupName = bucket;
      section.appendChild(pjMk('div', 'cl-tl-day', bucket));
      group = pjMk('div', 'cl-tl-group');
      section.appendChild(group);
    }
    const row = pjMk('button', 'cl-tl-row cl-tl-' + e.type);
    row.type = 'button';
    row.addEventListener('click', e.open);
    const icon = pjMk('span', 'cl-tl-icon');
    icon.innerHTML = ic(e.icon);
    row.appendChild(icon);
    const main = pjMk('span', 'cl-tl-main');
    const name = pjMk('span', 'cl-tl-name', e.name || 'Untitled');
    if (e.name) name.dataset.userContent = '';
    main.appendChild(name);
    main.appendChild(pjMk('span', 'cl-tl-pill', e.kind));
    row.appendChild(main);
    const when = pjMk('span', 'cl-tl-when', whenText(e.when, bucket));
    when.dataset.userContent = '';
    when.title = e.when.toLocaleString(locale);
    row.appendChild(when);
    group.appendChild(row);
  });
  return section;
}

function applyClientDetailSearch() {
  clientDetailSearch = (document.getElementById('client-detail-search').value || '').toLowerCase().trim();
  renderClientDetailSections(currentClient);
}

function setClientDetailTab(key) {
  if (!CLIENT_DETAIL_TYPES.some(t => t.key === key) || clientTabHidden(key)) key = 'overview';
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
const SYSTEM_ENV_ORDER = ['PRODUCTION', 'TEST', 'BOTH', ''];
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
  ['hostname', 'Hostname'], ['accessMethod', 'Access'], ['username', 'Username'], ['password', 'Password'],
  ['systemName', 'System'],   // already a SYSTEM label on both sides of the diff
  ['role', 'Role', v => lkLabel('SERVER_ROLE', v)],
  ['status', 'Status', v => srvStatusLabel(v)],
  ['linkedServers', 'Linked Servers', clListStr], ['workloads', 'Workloads', clListStr],
  ['externalParties', 'External Parties', clListStr],
  ['notes', 'Notes'],
];
const DATABASE_CONFIRM_FIELDS = [
  ['serverId', 'Server', v => {
    const s = (currentClient?.servers || []).find(x => String(x.id) === String(v));
    return s ? serverIdentityText(s) : v;
  }],
  ['name', 'Name'], ['environment', 'Environment', srvEnvLabel],
  ['engine', 'Engine'], ['version', 'Version'], ['port', 'Port'], ['username', 'Username'],
  ['password', 'Password'], ['connectionString', 'Connection String'], ['notes', 'Notes'],
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
// A server's plain lists (migration 076) read as their items, comma-separated.
// diffClientFields hands the formatter the JSON string form, so parse it back.
function clListStr(v) {
  if (typeof v === 'string' && v.startsWith('[')) { try { v = JSON.parse(v); } catch { /* shown as is */ } }
  return Array.isArray(v) ? v.join(', ') : clFieldStr(v);
}
function srvStatusLabel(v) { return v === 'INACTIVE' ? 'Not Active' : 'Active'; }
function clFieldStr(v) {
  if (v == null) return '';
  // An empty list is an empty field: filling it for the first time is not an edit.
  if (Array.isArray(v)) return v.length ? JSON.stringify(v) : '';
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

// `unreadable` means the stored credential exists and is intact, but this
// machine holds the wrong key for it — safeStorage's key is per-Windows-account
// and per-machine (see db.js's readCredential). That is emphatically NOT the
// same as "no password", and it must never be shown as one.
//
// It used to be shown as something far worse: the read path answered a failed
// decrypt by returning the stored value, so this control cheerfully revealed the
// raw `enc:v1:…` blob as though it were the secret. Now the reveal and copy
// buttons are withheld — there is nothing to reveal or copy — and the row says
// what happened and what to do about it.
function buildClientSecretControl(label, value, unreadable) {
  const wrap = pjMk('span', 'cl-pw-wrap');
  if (unreadable) {
    wrap.appendChild(document.createTextNode(label + ': '));
    const warn = pjMk('span', 'cl-pw-locked');
    warn.innerHTML = ic('lock');
    warn.appendChild(document.createTextNode('Cannot be read on this device'));
    warn.title = 'This credential was saved by a different Windows account or on a different computer, so its key is not available here. The stored value is intact — restore the backup with its passphrase, or re-enter the credential to replace it.';
    wrap.appendChild(warn);
    return wrap;
  }
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

// A value on a record card that copies itself on click: the text plus a small
// copy icon. `label` names it in the "… copied" toast. Passwords and secret
// keys do NOT use this — they go through buildClientSecretControl, whose copy
// clears the clipboard again after 30 seconds.
function clCopyValue(value, label) {
  const btn = pjMk('button', 'cl-copy-val');
  btn.type = 'button'; btn.title = 'Click to copy';
  const text = pjMk('span', null, String(value));
  text.dataset.userContent = ''; text.dir = 'auto';
  btn.appendChild(text);
  btn.insertAdjacentHTML('beforeend', ic('copy'));
  btn.addEventListener('click', () => copyClientFieldValue(value, label));
  return btn;
}
// "Caption: value" with the value as the copy target. The caption is its own
// text node so the i18n observer translates it without touching the value.
function clCopyField(caption, value, label) {
  const wrap = pjMk('span', 'cl-copy-field');
  wrap.appendChild(document.createTextNode(caption + ' '));
  wrap.appendChild(clCopyValue(value, label));
  return wrap;
}
// A card's meta line: strings stay plain text, nodes are placed as given, and
// the parts are joined with the same " · " the cards have always used.
function clMetaLine(parts) {
  const line = pjMk('div', 'cl-item-meta cl-item-metaline');
  parts.filter(Boolean).forEach((part, i) => {
    if (i) line.appendChild(pjMk('span', 'cl-meta-sep', '·'));
    line.appendChild(typeof part === 'string' ? pjMk('span', null, part) : part);
  });
  return line;
}

function buildClientVpnCard(v) {
  const card = pjMk('div', 'cl-item-card');
  const main = pjMk('div', 'cl-item-main');
  main.appendChild(pjMk('div', 'cl-item-title', v.connectionName || '(unnamed connection)'));
  if (v.vpnType || v.endpoint || v.port) {
    main.appendChild(clMetaLine([v.vpnType, v.endpoint && clCopyValue(v.endpoint, 'Endpoint'),
      v.port && clCopyField('Port', v.port, 'Port')]));
  }
  if (v.username || v.password || v.passwordUnreadable) {
    const cred = pjMk('div', 'cl-item-meta cl-item-cred');
    if (v.username) cred.appendChild(clCopyField('User:', v.username, 'Username'));
    // An unreadable credential is empty in `password` but still very much there —
    // render on the flag too, or it would silently disappear from the card.
    if (v.password || v.passwordUnreadable) {
      cred.appendChild(buildClientSecretControl('Password', v.password, v.passwordUnreadable));
    }
    main.appendChild(cred);
  }
  if (v.credentialLocation) main.appendChild(clMetaLine([clCopyField('Credential location:', v.credentialLocation, 'Credential Location')]));
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

// 'PRODUCTION'|'TEST'|'BOTH' -> their display labels; anything else is one of
// migration 038's nullN environment placeholders and shows as-is. 'BOTH' is one
// server serving Production and UAT alike — a value of its own, so it never
// clashes with a separate Production or UAT server under the same System/Role.
function srvEnvLabel(env) {
  if (env === 'PRODUCTION') return 'Production';
  if (env === 'TEST') return 'UAT';
  if (env === 'BOTH') return 'Production + UAT';
  return env || '';
}
function srvEnvIsKnown(env) { return env === 'PRODUCTION' || env === 'TEST' || env === 'BOTH'; }

// Plain-text form of a server's identity — for anywhere that needs a name for
// the record (history modal title, group checklist, database picker, toasts).
// A server has no name of its own: the triple names it, and since migration 077
// the IP follows in brackets, because two servers can share the triple.
function serverIdentityText(s) {
  // Joined into one string, the parts are invisible to the DOM translator — so
  // each is translated on its own first.
  const tr = text => window.ctI18n?.t?.(text) || text;
  const triple = [lkLabel('SYSTEM', s.systemName) || '(no system)', lkLabel('SERVER_ROLE', s.role) || s.roleLabel || '(no role)',
    srvEnvLabel(s.environment) || '(no environment)'].map(tr).join(' - ');
  const host = String(s.host ?? '').trim();
  return host ? triple + ' (' + host + ')' : triple;
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
  const inactive = s.status === 'INACTIVE';
  const card = pjMk('div', 'cl-item-card' + (inactive ? ' cl-srv-inactive' : ''));
  const main = pjMk('div', 'cl-item-main');
  const identity = buildServerIdentityLine(s);
  if (inactive) identity.appendChild(pjMk('span', 'cl-srv-status-badge', 'Not Active'));
  main.appendChild(identity);
  const viaPam = s.accessMethod === 'PAM';
  if (s.host || s.hostname || s.os || viaPam) {
    main.appendChild(clMetaLine([s.host && clCopyValue(s.host, 'Host (IP)'),
      s.hostname && clCopyValue(s.hostname, 'Hostname'), s.os, viaPam && pjMk('span', 'cl-access-pam', 'Via PAM')]));
  }
  // A PAM server's login lives in the PAM vault: any stored credentials stay
  // kept but are not shown.
  if (!viaPam && (s.username || s.password || s.passwordUnreadable)) {
    const cred = pjMk('div', 'cl-item-meta cl-item-cred');
    if (s.username) cred.appendChild(clCopyField('User:', s.username, 'Username'));
    if (s.password || s.passwordUnreadable) {
      cred.appendChild(buildClientSecretControl('Password', s.password, s.passwordUnreadable));
    }
    main.appendChild(cred);
  }
  [['linkedServers', 'Linked Servers', 'share-2'], ['workloads', 'Workloads', 'layers'],
    ['externalParties', 'External Parties', 'plug']].forEach(([key, label, icon]) => {
    const list = buildServerListLine(s[key], label, icon);
    if (list) main.appendChild(list);
  });
  if (s.notes) main.appendChild(pjMk('div', 'cl-item-notes', s.notes));
  main.appendChild(pjMk('div', 'cl-item-updated', clUpdatedLabel(s)));
  const dbList = buildServerDatabaseList(s);
  if (dbList) main.appendChild(dbList);
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
  // Its databases go with it, so the confirm says so.
  const dbCount = (s.databases || []).length;
  const delLabel = dbCount ? (window.ctI18n?.t?.('Delete with its {n} database(s)?', { n: dbCount })
    || `Delete with its ${dbCount} database(s)?`) : undefined;
  delBtn.addEventListener('click', () =>
    showDeleteConfirm(actions, () => deleteClientServerEntry(s.id), () => renderClientDetail(currentClient), delLabel));
  actions.appendChild(delBtn);
  card.appendChild(actions);
  return card;
}

// One of a server's plain lists (migration 076) as a labelled row of chips,
// each click-to-copy, with the item count beside the label. A long list shows
// its first few chips and a "+N more" chip that expands it in place, so one
// busy server does not swamp the card. Nothing when the list is empty.
const SERVER_LIST_PREVIEW = 6;
function buildServerListLine(items, label, icon) {
  if (!Array.isArray(items) || !items.length) return null;
  const tr = (text, vars) => window.ctI18n?.t?.(text, vars) || text.replace('{n}', vars?.n);
  const row = pjMk('div', 'cl-srv-list');
  const head = pjMk('span', 'cl-srv-list-label');
  head.innerHTML = ic(icon);
  head.appendChild(pjMk('span', null, label));
  head.appendChild(pjMk('span', 'cl-srv-list-count', String(items.length)));
  row.appendChild(head);
  const chips = pjMk('div', 'cl-srv-list-chips');
  const render = expanded => {
    const shown = expanded || items.length <= SERVER_LIST_PREVIEW + 1 ? items : items.slice(0, SERVER_LIST_PREVIEW);
    chips.replaceChildren();
    shown.forEach(item => {
      const chip = pjMk('button', 'cl-srv-chip', item);
      chip.type = 'button';
      chip.dataset.userContent = ''; chip.dir = 'auto';
      chip.title = 'Click to copy';
      chip.addEventListener('click', () => copyClientFieldValue(item, label));
      chips.appendChild(chip);
    });
    if (shown.length === items.length && !expanded) return;
    const toggle = pjMk('button', 'cl-srv-chip cl-srv-chip-more',
      expanded ? tr('Show less') : tr('+{n} more', { n: items.length - shown.length }));
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(!!expanded));
    toggle.addEventListener('click', () => render(!expanded));
    chips.appendChild(toggle);
  };
  render(false);
  row.appendChild(chips);
  return row;
}

// ── Server map: the Servers section drawn as a tree ──
// Client → System → Server → Database, left to right (mirrored in Arabic).
// Colour is the environment; a database whose environment differs from its
// server's is flagged, since that is easy to miss in the list. Identity and
// host only — never a username, password or connection string. A server or
// database node opens its edit modal.
function buildClientServerMap(c, servers) {
  const wrap = pjMk('div', 'cl-map');
  const legend = pjMk('div', 'cl-map-legend');
  [['production', 'Production'], ['test', 'UAT'], ['both', 'Production + UAT']].forEach(([env, label]) => {
    const item = pjMk('span', 'cl-map-key cl-map-env-' + env);
    item.appendChild(pjMk('i'));
    item.appendChild(document.createTextNode(label));
    legend.appendChild(item);
  });
  const mismatchKey = pjMk('span', 'cl-map-key');
  mismatchKey.innerHTML = ic('triangle-alert', 'cl-map-warn');
  mismatchKey.appendChild(document.createTextNode('Environment differs from its server'));
  legend.appendChild(mismatchKey);
  wrap.appendChild(legend);

  const userText = (cls, text) => {
    const el = pjMk('span', cls, text);
    el.dataset.userContent = ''; el.dir = 'auto';
    return el;
  };
  const envClass = env => 'cl-map-env-' + (srvEnvIsKnown(env) ? env.toLowerCase() : 'unknown');
  const branch = (node, children) => {
    const li = pjMk('li');
    li.appendChild(node);
    if (children && children.length) {
      const ul = pjMk('ul', 'cl-map-children');
      children.forEach(child => ul.appendChild(child));
      li.appendChild(ul);
    }
    return li;
  };

  const dbNode = (s, d) => {
    const env = d.environment === 'TEST' ? 'TEST' : 'PRODUCTION';
    const node = pjMk('button', 'cl-map-node is-db ' + envClass(env));
    node.type = 'button';
    node.title = 'Edit Database';
    const head = pjMk('span', 'cl-map-line');
    head.innerHTML = ic('database');
    head.appendChild(userText('cl-map-name', d.name));
    // A shared server holds either kind, so only a one-environment server can disagree.
    if (srvEnvIsKnown(s.environment) && s.environment !== 'BOTH' && s.environment !== env) {
      const warn = pjMk('span', 'cl-map-warn-tag');
      warn.innerHTML = ic('triangle-alert', 'cl-map-warn');
      warn.title = 'Environment differs from its server';
      head.appendChild(warn);
    }
    node.appendChild(head);
    const engine = [d.engine, d.version].filter(Boolean).join(' ');
    if (engine || d.port) node.appendChild(userText('cl-map-sub', [engine, d.port].filter(Boolean).join(' : ')));
    node.addEventListener('click', () => openClientDatabaseModal(s.id, d));
    return branch(node);
  };

  const serverNode = s => {
    const node = pjMk('button', 'cl-map-node is-server ' + envClass(s.environment));
    node.type = 'button';
    node.title = 'Edit Server';
    const head = pjMk('span', 'cl-map-line');
    head.innerHTML = ic('server');
    head.appendChild(userText('cl-map-name', lkLabel('SERVER_ROLE', s.role) || s.roleLabel || '(no role)'));
    head.appendChild(pjMk('span', 'cl-map-env', srvEnvLabel(s.environment) || '(no environment)'));
    node.appendChild(head);
    const where = [s.hostname, s.host].filter(Boolean).join(' · ');
    if (where) node.appendChild(userText('cl-map-sub cl-map-mono', where));
    node.appendChild(pjMk('span', 'cl-map-access' + (s.accessMethod === 'PAM' ? ' is-pam' : ''),
      s.accessMethod === 'PAM' ? 'PAM' : 'RDP'));
    node.addEventListener('click', () => openClientServerModal(s));
    return branch(node, (s.databases || []).map(d => dbNode(s, d)));
  };

  const systemNode = (name, list) => {
    const node = pjMk('div', 'cl-map-node is-system');
    const head = pjMk('span', 'cl-map-line');
    head.innerHTML = ic('layers');
    if (name) head.appendChild(userText('cl-map-name', lkLabel('SYSTEM', name)));
    else head.appendChild(pjMk('span', 'cl-map-name cl-item-muted', '(no system)'));
    node.appendChild(head);
    return branch(node, list.map(serverNode));
  };

  const { groups, ungrouped } = groupBySystemName(servers);
  const systems = groups.map(g => systemNode(g.name, g.envs.flatMap(e => e.items)));
  if (ungrouped.length) {
    const byEnv = (a, b) => SYSTEM_ENV_ORDER.indexOf(a.environment || '') - SYSTEM_ENV_ORDER.indexOf(b.environment || '');
    systems.push(systemNode('', ungrouped.slice().sort(byEnv)));
  }

  const root = pjMk('div', 'cl-map-node is-client');
  const rootHead = pjMk('span', 'cl-map-line');
  rootHead.innerHTML = ic('building-2');
  rootHead.appendChild(userText('cl-map-name', companyDisplayName(c) || 'Untitled'));
  root.appendChild(rootHead);
  const tree = pjMk('ul', 'cl-map-tree');
  tree.appendChild(branch(root, systems));
  const scroller = pjMk('div', 'cl-map-scroll');
  scroller.appendChild(tree);
  wrap.appendChild(scroller);
  return wrap;
}

// ── Databases hosted on a server (migration 071) ──
// The server card is the machine; each database on it is its own row with its
// own connection details, listed inside the card.
// Only a server that hosts a database gets the list; adding one is done from
// the section's own "Add Database" button.
function buildServerDatabaseList(s) {
  const dbs = s.databases || [];
  if (!dbs.length) return null;
  const list = pjMk('div', 'cl-db-list');
  const title = pjMk('div', 'cl-db-title');
  title.innerHTML = ic('database');
  title.appendChild(document.createTextNode('Databases'));
  list.appendChild(title);
  dbs.forEach(d => list.appendChild(buildClientDatabaseRow(s, d)));
  return list;
}

function buildClientDatabaseRow(s, d) {
  const row = pjMk('div', 'cl-db-row');
  const main = pjMk('div', 'cl-item-main');
  // dir="auto" goes on an inner span: on the block itself, a Latin name made the
  // whole line LTR and pushed it to the far side of an Arabic card.
  const name = pjMk('div', 'cl-db-name');
  const nameText = pjMk('span', null, d.name);
  nameText.dataset.userContent = ''; nameText.dir = 'auto';
  name.appendChild(nameText);
  // Its own environment, in the same colour the server line uses.
  const env = d.environment === 'TEST' ? 'TEST' : 'PRODUCTION';
  name.appendChild(document.createTextNode(' - '));
  name.appendChild(pjMk('span', 'cl-srv-env-' + env.toLowerCase(), srvEnvLabel(env)));
  main.appendChild(name);
  const engine = [d.engine, d.version].filter(Boolean).join(' ');
  if (engine || d.port) {
    main.appendChild(clMetaLine([engine, d.port && clCopyField('Port', d.port, 'Port')]));
  }
  if (d.username || d.password || d.passwordUnreadable) {
    const cred = pjMk('div', 'cl-item-meta cl-item-cred');
    if (d.username) cred.appendChild(clCopyField('User:', d.username, 'Username'));
    if (d.password || d.passwordUnreadable) {
      cred.appendChild(buildClientSecretControl('Password', d.password, d.passwordUnreadable));
    }
    main.appendChild(cred);
  }
  // A connection string often carries the password, so it gets the same
  // masked, self-clearing control rather than a plain copy value.
  if (d.connectionString || d.connectionStringUnreadable) {
    const conn = pjMk('div', 'cl-item-meta cl-item-cred');
    conn.appendChild(buildClientSecretControl('Connection string', d.connectionString, d.connectionStringUnreadable));
    main.appendChild(conn);
  }
  if (d.notes) main.appendChild(pjMk('div', 'cl-item-notes', d.notes));
  row.appendChild(main);

  const actions = pjMk('div', 'cl-item-actions');
  const histBtn = pjMk('button', 'cd-icon-btn');
  histBtn.innerHTML = ic('clock');
  histBtn.title = 'View history';
  histBtn.addEventListener('click', () => openClientHistoryModal('database', d.id, d.name));
  actions.appendChild(histBtn);
  const editBtn = pjMk('button', 'cd-icon-btn');
  editBtn.innerHTML = ic('pencil');
  editBtn.title = 'Edit';
  editBtn.addEventListener('click', () => openClientDatabaseModal(s.id, d));
  actions.appendChild(editBtn);
  const delBtn = pjMk('button', 'cd-icon-btn danger');
  delBtn.innerHTML = ic('trash-2');
  delBtn.title = 'Delete';
  delBtn.addEventListener('click', () =>
    showDeleteConfirm(actions, () => deleteClientDatabaseEntry(d.id), () => renderClientDetail(currentClient)));
  actions.appendChild(delBtn);
  row.appendChild(actions);
  return row;
}

// The API payload for a database, from a record or an undo snapshot.
function clientDatabasePayload(d) {
  return {
    name: d.name, environment: d.environment, engine: d.engine, version: d.version, port: d.port, username: d.username,
    password: d.password, connectionString: d.connectionString, notes: d.notes,
  };
}

// Production / UAT toggle (migration 073).
let clientDatabaseEnvironment = 'PRODUCTION';
function setDatabaseEnvironment(env) {
  clientDatabaseEnvironment = env === 'TEST' ? 'TEST' : 'PRODUCTION';
  [['cdb-env-production', 'PRODUCTION'], ['cdb-env-test', 'TEST']].forEach(([id, value]) => {
    const b = document.getElementById(id);
    const on = clientDatabaseEnvironment === value;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
// A new database starts in its server's environment; still changeable, since
// the two can differ. An edit keeps what it has.
function onDatabaseServerPicked() {
  if (clientDatabaseEditId != null) return;
  const id = Number(document.getElementById('cdb-server').value);
  const server = (currentClient?.servers || []).find(s => s.id === id);
  // A database is Production or UAT on its own, so a shared ('BOTH') server
  // leaves the current choice alone rather than picking one for it.
  if (server && (server.environment === 'PRODUCTION' || server.environment === 'TEST')) setDatabaseEnvironment(server.environment);
}
function findClientDatabase(id) {
  return (currentClient?.servers || []).flatMap(s => s.databases || []).find(d => d.id === id);
}

// The Server picker: every server of this client, named by its identity. A
// new database starts with none picked, so the choice is always deliberate.
function fillDatabaseServerSelect(currentId) {
  const sel = document.getElementById('cdb-server');
  sel.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Select a server…';
  sel.appendChild(blank);
  (currentClient?.servers || []).forEach(s => {
    const opt = document.createElement('option');
    opt.value = String(s.id);
    // Already translated part by part, so the translator must leave it alone.
    opt.dataset.userContent = ''; opt.textContent = serverIdentityText(s);
    sel.appendChild(opt);
  });
  sel.value = currentId != null ? String(currentId) : '';
}

// `serverId` preselects the server (editing a database); null leaves it to pick.
function openClientDatabaseModal(serverId, d) {
  clientDatabaseEditId = d ? d.id : null;
  document.getElementById('client-database-modal-title').textContent = d ? 'Edit Database' : 'Add Database';
  document.getElementById('client-database-modal-submit').textContent = d ? 'Save Changes' : 'Add Database';
  fillDatabaseServerSelect(serverId);
  setDatabaseEnvironment(d ? d.environment : 'PRODUCTION');
  document.getElementById('cdb-name').value = d ? (d.name || '') : '';
  document.getElementById('cdb-engine').value = d ? (d.engine || '') : '';
  document.getElementById('cdb-version').value = d ? (d.version || '') : '';
  document.getElementById('cdb-port').value = d ? (d.port || '') : '';
  document.getElementById('cdb-username').value = d ? (d.username || '') : '';
  document.getElementById('cdb-password').value = d ? (d.password || '') : '';
  document.getElementById('cdb-connection').value = d ? (d.connectionString || '') : '';
  document.getElementById('cdb-notes').value = d ? (d.notes || '') : '';
  clearErrorsIn('#client-database-modal');
  document.getElementById('client-database-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById(serverId == null ? 'cdb-server' : 'cdb-name').focus(), 80);
}
function closeClientDatabaseModal() {
  document.getElementById('client-database-modal-overlay').classList.remove('open');
  clientDatabaseEditId = null;
}
function clientDatabaseOverlayClick(e) {
  if (e.target === document.getElementById('client-database-modal-overlay')) closeClientDatabaseModal();
}
async function submitClientDatabaseModal() {
  clearErrorsIn('#client-database-modal');
  const serverId = Number(document.getElementById('cdb-server').value) || null;
  const name = document.getElementById('cdb-name').value.trim();
  let bad = false;
  if (!serverId) { markError('cdb-server'); bad = true; }
  if (!name) { markError('cdb-name'); bad = true; }
  if (bad) return;
  const data = {
    serverId, name, environment: clientDatabaseEnvironment,
    engine:   document.getElementById('cdb-engine').value.trim(),
    version:  document.getElementById('cdb-version').value.trim(),
    port:     document.getElementById('cdb-port').value.trim(),
    username: document.getElementById('cdb-username').value.trim(),
    password: document.getElementById('cdb-password').value.trim(),
    connectionString: document.getElementById('cdb-connection').value.trim(),
    notes:    document.getElementById('cdb-notes').value.trim(),
  };
  if (clientDatabaseEditId != null) {
    const changes = diffClientFields(findClientDatabase(clientDatabaseEditId), data, DATABASE_CONFIRM_FIELDS);
    if (changes.length && !(await confirmClientFieldChanges(changes))) return;
  }
  let res;
  try {
    if (clientDatabaseEditId != null) res = await window.api.updateClientDatabase(clientDatabaseEditId, data);
    else res = await window.api.createClientDatabase(serverId, data);
  } catch { toast('Could not save database'); return; }
  if (!res || res.ok === false) { toast(res?.error || 'Could not save database'); return; }
  closeClientDatabaseModal();
  toast('Database saved');
  await reloadCurrentClient();
}
async function deleteClientDatabaseEntry(id) {
  const snapshot = findClientDatabase(id);
  try { await window.api.deleteClientDatabase(id); }
  catch { toast('Could not delete database'); renderClientDetail(currentClient); return; }
  await reloadCurrentClient();
  if (!snapshot) return;
  showGenericUndo('Database deleted', async () => {
    let res;
    try { res = await window.api.createClientDatabase(snapshot.serverId, clientDatabasePayload(snapshot)); }
    catch { toast('Could not restore database'); return; }
    // Its server can have been deleted during the undo window.
    if (!res || res.ok === false) { toast(res?.error || 'Could not restore database'); return; }
    await reloadCurrentClient();
  });
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
  document.getElementById('cv-notes').value = v ? (v.notes || '') : '';
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
  // Expiry date and credential location are no longer on the form; an existing
  // value rides along unchanged so saving never clears it.
  const before = clientVpnEditId != null
    ? (currentClient?.vpnConnections || []).find(v => v.id === clientVpnEditId) : null;
  const data = {
    connectionName,
    vpnType:  document.getElementById('cv-type').value.trim(),
    endpoint: document.getElementById('cv-endpoint').value.trim(),
    port:     document.getElementById('cv-port').value.trim(),
    username: document.getElementById('cv-username').value.trim(),
    password: document.getElementById('cv-password').value.trim(),
    expiryDate: before?.expiryDate || null,
    credentialLocation: before?.credentialLocation || '',
    notes:    document.getElementById('cv-notes').value.trim(),
  };
  if (clientVpnEditId != null) {
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

// The Environment select is a fixed Production/UAT/both set, so a legacy row
// carrying a nullN placeholder environment needs its value added back the same way.
function fillServerEnvSelect(s) {
  const sel = document.getElementById('cs-environment');
  sel.querySelectorAll('option[data-placeholder]').forEach(o => o.remove());
  const env = s ? (s.environment || '') : '';
  if (env && !srvEnvIsKnown(env)) {
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
    el.textContent = 'With the IP, these identify the server and must be unique for this client.';
    return;
  }
  // One text node per part, as on the card, so the translator sees
  // "Production" on its own rather than inside "X - Y - Production".
  const value = pjMk('span', 'cs-identity-value');
  [system, role, env].forEach((text, i) => {
    if (i) value.appendChild(document.createTextNode(' - '));
    value.appendChild(pjMk('span', null, text));
  });
  el.replaceChildren(document.createTextNode('Identity: '), value);
}

// Active / Not Active toggle (migration 076).
let clientServerStatus = 'ACTIVE';
function setServerStatus(status) {
  clientServerStatus = status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  [['cs-status-active', 'ACTIVE'], ['cs-status-inactive', 'INACTIVE']].forEach(([id, value]) => {
    const b = document.getElementById(id);
    const on = clientServerStatus === value;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
// A server list editor (migration 076): an add box plus one row per item,
// each with its own remove button. Enter or Add takes the box's text; pasting
// several lines adds each line as its own item. Repeats (any case) are skipped.
const SERVER_LIST_IDS = ['cs-linked-servers', 'cs-workloads', 'cs-external-parties'];
function serverListItems(id) {
  return [...document.querySelectorAll('#' + id + ' .cs-list-item-text')].map(el => el.textContent);
}
function addServerListItems(id, values) {
  const ul = document.querySelector('#' + id + ' .cs-list-items');
  const have = new Set(serverListItems(id).map(v => v.toLowerCase()));
  values.map(v => String(v ?? '').trim()).filter(Boolean).forEach(value => {
    if (have.has(value.toLowerCase())) return;
    have.add(value.toLowerCase());
    const li = pjMk('li', 'cs-list-item');
    const text = pjMk('span', 'cs-list-item-text', value);
    text.dataset.userContent = ''; text.dir = 'auto';
    li.appendChild(text);
    const remove = pjMk('button', 'cd-icon-btn danger');
    remove.type = 'button';
    remove.innerHTML = ic('x');
    remove.title = 'Remove';
    remove.setAttribute('aria-label', (window.ctI18n?.t?.('Remove') || 'Remove') + ' ' + value);
    remove.addEventListener('click', () => li.remove());
    li.appendChild(remove);
    ul.appendChild(li);
  });
  // A long list scrolls inside its box; keep the newest item in view.
  ul.scrollTop = ul.scrollHeight;
}
function takeServerListInput(id) {
  const input = document.getElementById(id + '-input');
  addServerListItems(id, input.value.split(/\r?\n/));
  input.value = '';
  input.focus();
}
function wireServerListEditors() {
  SERVER_LIST_IDS.forEach(id => {
    const box = document.getElementById(id);
    if (box.dataset.wired) return;
    box.dataset.wired = '1';
    const input = document.getElementById(id + '-input');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); takeServerListInput(id); }
    });
    input.addEventListener('paste', e => {
      const text = e.clipboardData?.getData('text') || '';
      if (!/\r?\n/.test(text.trim())) return;
      e.preventDefault();
      addServerListItems(id, text.split(/\r?\n/));
    });
    box.querySelector('.cs-list-add-btn').addEventListener('click', () => takeServerListInput(id));
  });
}
function fillServerListEditor(id, items) {
  document.querySelector('#' + id + ' .cs-list-items').replaceChildren();
  document.getElementById(id + '-input').value = '';
  addServerListItems(id, items || []);
}
// Text still sitting in the add box counts too, so nothing typed is lost on save.
function readServerListInput(id) {
  const pending = document.getElementById(id + '-input').value;
  if (pending.trim()) addServerListItems(id, [pending]);
  document.getElementById(id + '-input').value = '';
  return serverListItems(id);
}

// RDP / PAM toggle (migration 072). PAM hides the username/password row; the
// fields keep their values, so switching back loses nothing.
let clientServerAccessMethod = 'RDP';
function setServerAccessMethod(method) {
  clientServerAccessMethod = method === 'PAM' ? 'PAM' : 'RDP';
  [['cs-access-rdp', 'RDP'], ['cs-access-pam', 'PAM']].forEach(([id, value]) => {
    const b = document.getElementById(id);
    const on = clientServerAccessMethod === value;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.getElementById('cs-credentials-row').hidden = clientServerAccessMethod === 'PAM';
}

function openClientServerModal(s) {
  clientServerEditId = s ? s.id : null;
  document.getElementById('client-server-modal-title').textContent = s ? 'Edit Server' : 'Add Server';
  document.getElementById('client-server-modal-submit').textContent = s ? 'Save Changes' : 'Add Server';
  document.getElementById('cs-host').value = s ? (s.host || '') : '';
  fillIdentitySelect('cs-system', 'SYSTEM', 'label', s ? s.systemName : '', 'Select a system…', 'system');
  fillIdentitySelect('cs-role', 'SERVER_ROLE', 'code', s ? s.role : '', 'Select a role…', 'role');
  fillServerEnvSelect(s);
  setServerAccessMethod(s?.accessMethod === 'PAM' ? 'PAM' : 'RDP');
  setServerStatus(s?.status);
  wireServerListEditors();
  fillServerListEditor('cs-linked-servers', s?.linkedServers);
  fillServerListEditor('cs-workloads', s?.workloads);
  fillServerListEditor('cs-external-parties', s?.externalParties);
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
    accessMethod: clientServerAccessMethod,
    status: clientServerStatus,
    linkedServers:   readServerListInput('cs-linked-servers'),
    workloads:       readServerListInput('cs-workloads'),
    externalParties: readServerListInput('cs-external-parties'),
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
  // modal stays open with the identity parts and the IP flagged so the clash can be fixed.
  if (res && res.ok === false) {
    ['cs-system', 'cs-role', 'cs-environment', 'cs-host'].forEach(markError);
    const preview = document.getElementById('cs-identity-preview');
    preview.classList.add('bad');
    preview.textContent = res.error || 'That System / Role / Environment and IP is already taken.';
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
        accessMethod: snapshot.accessMethod, status: snapshot.status,
        linkedServers: snapshot.linkedServers, workloads: snapshot.workloads,
        externalParties: snapshot.externalParties,
      });
    } catch { toast('Could not restore server'); return; }
    // Its identity can have been taken by another server during the undo window.
    if (res && res.ok === false) { toast(res.error || 'Could not restore server'); return; }
    // The delete took its databases with it; bring them back under the new id.
    let lost = 0;
    for (const d of snapshot.databases || []) {
      try {
        const r = await window.api.createClientDatabase(res.id, clientDatabasePayload(d));
        if (!r || r.ok === false) lost++;
      } catch { lost++; }
    }
    if (lost) toast(window.ctI18n?.t?.('Server restored, but {n} database(s) could not be', { n: lost })
      || `Server restored, but ${lost} database(s) could not be`);
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
  if (s.url) main.appendChild(clMetaLine([clCopyField('URL:', s.url, 'URL')]));
  if (s.username || s.password || s.passwordUnreadable) {
    const cred = pjMk('div', 'cl-item-meta cl-item-cred');
    if (s.username) cred.appendChild(clCopyField('User:', s.username, 'Username'));
    if (s.password || s.passwordUnreadable) {
      cred.appendChild(buildClientSecretControl('Password', s.password, s.passwordUnreadable));
    }
    main.appendChild(cred);
  }
  if (s.companyCode || s.secretKey || s.secretKeyUnreadable) {
    const svcCred = pjMk('div', 'cl-item-meta cl-item-cred');
    if (s.companyCode) svcCred.appendChild(clCopyField('Company Code:', s.companyCode, 'Company Code'));
    if (s.secretKey || s.secretKeyUnreadable) {
      svcCred.appendChild(buildClientSecretControl('Secret Key', s.secretKey, s.secretKeyUnreadable));
    }
    main.appendChild(svcCred);
  }
  if (Array.isArray(s.subServices) && s.subServices.length) {
    const subList = pjMk('div', 'cl-subsvc-list');
    s.subServices.forEach(sub => {
      const row = pjMk('div', 'cl-subsvc-row-view');
      if (sub.label) row.appendChild(pjMk('span', 'cl-subsvc-label', sub.label + ':'));
      if (sub.url) row.appendChild(clCopyValue(sub.url, sub.label || 'Endpoint'));
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
