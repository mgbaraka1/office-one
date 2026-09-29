// ══ OUTSOURCE — external resources: hours & fees ═════════════════════════════
// A standalone module (docs/OUTSOURCE_PLAN.md): it links to no client, project
// or task of the rest of the app. Person → Projects → Entries: one resource is
// one person being paid (private to this login) with an hourly rate history;
// projects are added inside the person, and hours are written inside a
// project. Fees are never typed — the server prices each entry by the rate in
// force on its date — so this page only ever shows amounts the server computed.
//
// Three pages share #outs-detail-view: a resource (tabs Projects · Statements ·
// Rates), a project (its entries grid), and a statement (draft preview or the
// issued snapshot). The resource list loads once and filters client-side.
let outsResources = [];
let outsLoaded = false;
let outsCurrent = null;           // the resource open in the detail view, or null
let outsView = 'resource';        // 'resource' | 'project' | 'statement' — which detail page
let outsCurrentProject = null;    // the project page's project
let outsCurrentStatement = null;  // the statement page's statement
const outsFilter = { search: '', inactive: false };
let outsModalEditId = null;       // null = create mode
let outsRateEditId = null;        // null = new rate
let outsProjectEditId = null;     // null = new project
let outsStatementEditId = null;   // null = new statement
let outsDetailTab = 'projects';   // 'projects' | 'statements' | 'rates'
let outsProjectRows = null;       // { resourceId, rows } for the Projects tab
let outsShowInactiveProjects = false;
let outsStatementRows = null;     // { resourceId, rows } for the Statements tab
let outsEntryData = null;         // { projectId, entries, summary, currency } for the project page
const outsEntryFilter = { period: 'all', from: '', to: '', unbilled: false };
let outsEditEntryId = null;       // the entry row being edited inline, or null
let outsLastDate = '';            // date of the last entry saved — the new row starts on it

function initOutsModule() {
  showOutsListView();
  loadOutsList();
}

// ── Small helpers ──
function outsUserText(tag, cls, text) {
  const el = pjMk(tag, cls, text);
  el.dataset.userContent = '';
  return el;
}
function outsMoney(minor, currency) {
  if (minor == null) return '';
  const unit = currency ? (CURRENCY_SYMBOLS[currency] || currency) : '';
  return anMoney(minor) + (unit ? ' ' + unit : '');
}
function outsHours(minutes) { return ((Number(minutes) || 0) / 60).toFixed(2); }
// The rate in force today, from a newest-first rate list.
function outsCurrentRate(rates) {
  const today = pfmLocalToday();
  return (rates || []).find(r => r.effectiveFrom <= today) || null;
}
function outsIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function outsWeekday(date) {
  const d = new Date(date + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'long' });
}
function outsBtn(iconName, label, fn, cls = '') {
  const b = pjMk('button', 'btn' + (cls ? ' ' + cls : ''));
  b.type = 'button';
  b.innerHTML = ic(iconName);
  b.appendChild(document.createTextNode(label));
  b.addEventListener('click', fn);
  return b;
}
function outsIconBtn(iconName, label, fn, cls = '') {
  const b = pjMk('button', 'cd-icon-btn' + (cls ? ' ' + cls : ''));
  b.type = 'button';
  b.innerHTML = ic(iconName);
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', fn);
  return b;
}
function outsSectionHead(iconName, title, actions = []) {
  const sh = pjMk('div', 'pj-section-head');
  const st = pjMk('div', 'pj-section-title');
  st.innerHTML = ic(iconName);
  st.appendChild(document.createTextNode(title));
  sh.appendChild(st);
  if (actions.length) {
    const acts = pjMk('div', 'pj-section-actions');
    actions.forEach(a => acts.appendChild(a));
    sh.appendChild(acts);
  }
  return sh;
}
function outsTable(cls, headers) {
  const table = pjMk('table', 'pfm-table ' + cls);
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  headers.forEach(label => hr.appendChild(pjMk('th', '', label)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const body = document.createElement('tbody');
  table.appendChild(body);
  return { table, body };
}
function outsCell(tr, child, cls) {
  const cell = document.createElement('td');
  if (cls) cell.className = cls;
  if (child) cell.appendChild(child);
  tr.appendChild(cell);
  return cell;
}
// Breadcrumbs: Outsource › person [› page]. Each earlier crumb is a link.
function outsCrumbs(parts) {
  const crumbs = pjMk('div', 'pj-crumbs');
  const root = pjMk('button', 'pj-crumb-link', 'Outsource');
  root.addEventListener('click', backToOutsList);
  crumbs.appendChild(root);
  parts.forEach(([label, fn]) => {
    const sep = pjMk('span', 'pj-crumb-sep');
    sep.innerHTML = ic('chevron-right');
    crumbs.appendChild(sep);
    if (fn) {
      const link = outsUserText('button', 'pj-crumb-link', label);
      link.addEventListener('click', fn);
      crumbs.appendChild(link);
    } else {
      crumbs.appendChild(outsUserText('span', 'pj-crumb-here', label));
    }
  });
  return crumbs;
}
const OUTS_STATUS_LABEL = { DRAFT: 'Draft', ISSUED: 'Issued', PAID: 'Paid', CANCELLED: 'Cancelled' };
function outsStatusPill(status) {
  return pjMk('span', 'pfm-status outs-st-' + String(status || '').toLowerCase(), OUTS_STATUS_LABEL[status] || status);
}
function outsPeriodText(s) { return pfmFmtDate(s.periodFrom) + ' – ' + pfmFmtDate(s.periodTo); }

// ══ LIST VIEW ══
function showOutsListView() {
  outsCurrent = null;
  outsCurrentProject = null;
  outsCurrentStatement = null;
  document.getElementById('outs-list-view').style.display = '';
  document.getElementById('outs-detail-view').style.display = 'none';
  document.getElementById('outs-topbar-actions').style.display = '';
}
function showOutsDetailView() {
  document.getElementById('outs-list-view').style.display = 'none';
  document.getElementById('outs-detail-view').style.display = '';
  document.getElementById('outs-topbar-actions').style.display = 'none';
}

async function loadOutsList() {
  const body = document.getElementById('outs-tbody');
  if (!outsLoaded && body) showTableSkeleton(body, 6, 3);
  let list;
  try { list = await window.api.listOutsResources({ includeInactive: true }); }
  catch { toast('Could not load resources'); return; }
  outsResources = Array.isArray(list) ? list : [];
  outsLoaded = true;
  renderOutsList();
}

function applyOutsSearch() {
  outsFilter.search = (document.getElementById('outs-search').value || '').toLowerCase().trim();
  renderOutsList();
}
function toggleOutsInactive() {
  outsFilter.inactive = !outsFilter.inactive;
  const btn = document.getElementById('outs-inactive-btn');
  btn.classList.toggle('active', outsFilter.inactive);
  btn.setAttribute('aria-pressed', outsFilter.inactive ? 'true' : 'false');
  renderOutsList();
}

function renderOutsList() {
  if (!outsLoaded) return;
  const rows = outsResources.filter(r =>
    (outsFilter.inactive || r.isActive) && textMatch([r.name, r.email, r.phone], outsFilter.search));
  const table = document.getElementById('outs-table');
  const body = document.getElementById('outs-tbody');
  const empty = document.getElementById('outs-empty-state');
  body.innerHTML = '';
  if (!rows.length) {
    table.style.display = 'none';
    empty.hidden = false;
    const p = empty.querySelector('p');
    if (!outsResources.length) p.innerHTML = 'No resources yet. Click <strong>+ New Resource</strong> to add the first one.';
    else if (!outsFilter.search && !outsFilter.inactive) p.textContent = 'Every resource is inactive — click Show inactive to see them';
    else p.textContent = 'Nothing matches these filters';
    return;
  }
  table.style.display = '';
  empty.hidden = true;
  rows.forEach(r => body.appendChild(buildOutsRow(r)));
}

function buildOutsRow(r) {
  const tr = pjMk('tr', 'pfm-row' + (r.isActive ? '' : ' archived'));
  tr.tabIndex = 0;
  tr.dataset.outsId = r.id;
  tr.addEventListener('click', () => openOutsDetail(r.id));
  tr.addEventListener('keydown', e => { if (e.key === 'Enter') openOutsDetail(r.id); });
  const name = outsCell(tr, outsUserText('span', 'pfm-ref', r.name));
  if (!r.isActive) name.appendChild(pjMk('span', 'pfm-archived-tag', 'Inactive'));
  outsCell(tr, r.currentRateMinor == null
    ? pjMk('span', 'pfm-muted', 'No rate')
    : outsUserText('span', 'pfm-fees', outsMoney(r.currentRateMinor, r.currency)));
  outsCell(tr, outsUserText('span', 'pfm-fees', outsHours(r.monthMinutes)));
  outsCell(tr, outsUserText('span', 'pfm-fees', outsHours(r.unbilledMinutes)));
  const unpaid = outsCell(tr, outsUserText('span', 'pfm-fees', outsMoney(r.unpaidMinor, r.currency)));
  if (r.unbilledMissingRate) {
    const warn = pjMk('span', 'outs-warn-ic');
    warn.innerHTML = ic('triangle-alert');
    warn.title = 'Some entries have no rate yet';
    unpaid.appendChild(warn);
  }
  outsCell(tr, pjMk('span', 'pfm-muted', pfmFmtDate(r.lastEntryDate)));
  return tr;
}

// ══ RESOURCE CREATE / EDIT MODAL ══
// Currency is required, so the "no currency" choice the shared helper adds is removed.
function populateOutsCurrencySelect(current) {
  populateCurrencySelect('outs-currency', current);
  document.querySelector('#outs-currency option[value=""]')?.remove();
  const sel = document.getElementById('outs-currency');
  if (!current && sel.options.length) sel.selectedIndex = 0;
}

function openOutsModal(resource) {
  outsModalEditId = resource ? resource.id : null;
  document.getElementById('outs-modal-title').textContent = resource ? 'Edit Resource' : 'New Resource';
  document.getElementById('outs-modal-submit').textContent = resource ? 'Save Changes' : 'Create';
  document.getElementById('outs-name').value = resource ? resource.name : '';
  document.getElementById('outs-email').value = resource ? resource.email : '';
  document.getElementById('outs-phone').value = resource ? resource.phone : '';
  document.getElementById('outs-notes').value = resource ? resource.notes : '';
  // A new resource starts in the currency of the one added last, else the catalog's first.
  const newest = [...outsResources].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  populateOutsCurrencySelect(resource ? resource.currency : (newest?.currency || ''));
  document.getElementById('outs-first-rate-group').hidden = !!resource;
  document.getElementById('outs-first-rate').value = '';
  document.getElementById('outs-first-rate-from').value = pfmLocalToday();
  clearErrorsIn('#outs-modal');
  document.getElementById('outs-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('outs-name').focus(), 80);
}
// The header button (delegated handlers take plain arguments only).
function openOutsNew() { openOutsModal(null); }
function closeOutsModal() {
  document.getElementById('outs-modal-overlay').classList.remove('open');
  outsModalEditId = null;
}
function outsModalOverlayClick(e) {
  if (e.target === document.getElementById('outs-modal-overlay')) closeOutsModal();
}

async function submitOutsModal() {
  clearErrorsIn('#outs-modal');
  const editing = outsModalEditId != null;
  const data = {
    name: document.getElementById('outs-name').value.trim(),
    currency: document.getElementById('outs-currency').value || '',
    email: document.getElementById('outs-email').value.trim(),
    phone: document.getElementById('outs-phone').value.trim(),
    notes: document.getElementById('outs-notes').value.trim(),
  };
  // Same parser as the Project & Finance fees field: "250", "1,250.50", Arabic digits.
  const rateMinor = editing ? null : pfmParseFees(document.getElementById('outs-first-rate').value);
  const rateFrom = document.getElementById('outs-first-rate-from').value;
  let bad = false;
  if (!data.name) { markError('outs-name'); bad = true; }
  if (!data.currency) { markError('outs-currency'); bad = true; }
  if (rateMinor === undefined) { markError('outs-first-rate', 'Enter the rate as a number, e.g. 250.00'); bad = true; }
  if (rateMinor != null && !rateFrom) { markError('outs-first-rate-from'); bad = true; }
  if (bad) return;

  let res;
  try { res = editing ? await window.api.updateOutsResource(outsModalEditId, data) : await window.api.createOutsResource(data); }
  catch { toast('Could not save the resource'); return; }
  if (!res?.ok) {
    const msg = res?.error || 'Could not save the resource';
    if (/name/i.test(msg)) markError('outs-name', msg);
    else if (/currency/i.test(msg)) markError('outs-currency', msg);
    else if (/email/i.test(msg)) markError('outs-email', msg);
    else if (/phone/i.test(msg)) markError('outs-phone', msg);
    else if (/notes/i.test(msg)) markError('outs-notes', msg);
    else toast(msg);
    return;
  }
  let resource = res.resource;
  // The first rate is a second write; if it is refused the resource still
  // exists, so say so and let the Rates tab take it from there.
  if (!editing && rateMinor != null) {
    const rate = await window.api.addOutsRate(resource.id, { rateMinor, effectiveFrom: rateFrom }).catch(() => null);
    if (rate?.ok) resource = rate.resource;
    else toast('Resource created, but the rate was not saved: ' + (rate?.error || 'unknown error'));
  }
  closeOutsModal();
  if (editing || rateMinor == null) toast(editing ? 'Changes saved' : 'Resource created');
  outsAfterWrite(resource);
  if (!editing && activeModule === 'outsource') openOutsDetail(resource.id);
}

// Keep the list and the open page in step with a resource or rate write.
function outsAfterWrite(resource) {
  outsLoaded = false;
  if (resource && outsCurrent && outsCurrent.id === resource.id) {
    outsCurrent = resource;
    if (outsView === 'resource') { renderOutsDetail(); loadOutsTabData(); }
  }
  if (activeModule === 'outsource' && !outsCurrent) loadOutsList();
}

// ══ RESOURCE PAGE ══
// opts.tab opens a given tab.
async function openOutsDetail(id, opts = {}) {
  let resource;
  try { resource = await window.api.getOutsResource(id); }
  catch { toast('Could not open this resource'); return; }
  if (!resource) { toast('This resource no longer exists'); loadOutsList(); return; }
  if (activeModule !== 'outsource') switchModule('outsource');
  if (outsCurrent?.id !== resource.id) { outsProjectRows = null; outsStatementRows = null; }
  if (opts.tab) outsDetailTab = opts.tab;
  outsCurrent = resource;
  outsView = 'resource';
  outsCurrentProject = null;
  outsCurrentStatement = null;
  showOutsDetailView();
  renderOutsDetail();
  document.getElementById('outs-detail-view').scrollTop = 0;
  await loadOutsTabData();
}
function backToOutsList() {
  showOutsListView();
  loadOutsList();
}
function backToOutsResource(tab) {
  if (outsCurrent) openOutsDetail(outsCurrent.id, { tab });
  else backToOutsList();
}

function renderOutsDetail() {
  const r = outsCurrent;
  const host = document.getElementById('outs-detail-view');
  if (!r || !host) return;
  host.innerHTML = '';
  host.appendChild(outsCrumbs([[r.name]]));

  const head = pjMk('div', 'pj-detail-head');
  const ident = pjMk('div', 'pfm-ident');
  const titleRow = pjMk('div', 'pj-detail-title');
  titleRow.appendChild(outsUserText('span', 'pfm-detail-ref', r.name));
  if (!r.isActive) titleRow.appendChild(pjMk('span', 'pfm-archived-tag', 'Inactive'));
  ident.appendChild(titleRow);
  const sub = pjMk('div', 'pfm-detail-sub');
  [r.currency, r.email, r.phone].filter(Boolean).forEach((bit, i) => {
    if (i) sub.appendChild(pjMk('span', 'pfm-dot', '·'));
    sub.appendChild(outsUserText('span', '', bit));
  });
  ident.appendChild(sub);
  head.appendChild(ident);

  const actions = pjMk('div', 'pj-detail-actions pfm-detail-actions');
  // Exports every project's entries, as they stand.
  actions.appendChild(outsBtn('download', 'Excel', () => exportOutsExcel(), 'outs-excel-btn'));
  actions.appendChild(outsBtn('printer', 'PDF', () => exportOutsPdf(), 'outs-pdf-btn'));
  actions.appendChild(outsBtn('pencil', 'Edit', () => openOutsModal(r)));
  actions.appendChild(outsBtn(r.isActive ? 'ban' : 'rotate-ccw', r.isActive ? 'Deactivate' : 'Activate', () => setOutsActiveUi(r.id, !r.isActive)));
  const delHost = pjMk('span', 'pfm-del-host');
  actions.appendChild(delHost);
  const renderDel = () => {
    delHost.innerHTML = '';
    delHost.appendChild(outsBtn('trash-2', 'Delete', () => showDeleteConfirm(delHost, () => deleteOutsResourceUi(r.id), renderDel), 'del-action'));
  };
  renderDel();
  head.appendChild(actions);
  host.appendChild(head);

  host.appendChild(buildOutsTiles(r));

  const tabs = pjMk('div', 'seg-ctl workspace-tabs outs-tabs');
  tabs.id = 'outs-detail-tabs';
  tabs.setAttribute('aria-label', 'Resource sections');
  [['projects', 'Projects'], ['statements', 'Statements'], ['rates', 'Rates']].forEach(([key, label]) => {
    const b = pjMk('button', 'seg-btn' + (outsDetailTab === key ? ' active' : ''), label);
    b.type = 'button';
    b.dataset.outsTab = key;
    b.setAttribute('aria-pressed', outsDetailTab === key ? 'true' : 'false');
    b.addEventListener('click', () => setOutsDetailTab(key));
    tabs.appendChild(b);
  });
  host.appendChild(tabs);
  const body = pjMk('div', 'outs-tab-body');
  body.id = 'outs-tab-body';
  host.appendChild(body);
  renderOutsTabBody();

  if (r.notes) {
    const notes = pjMk('div', 'pj-section');
    notes.appendChild(outsSectionHead('file-text', 'Notes'));
    notes.appendChild(outsUserText('div', 'outs-notes', r.notes));
    host.appendChild(notes);
  }
  host.appendChild(buildOutsHistorySection(r));
}

// ── Summary tiles ──
function buildOutsTileRow(tilesData) {
  const tiles = pjMk('div', 'outs-tiles');
  tiles.id = 'outs-tiles';
  tilesData.forEach(([label, value, sub, warn]) => {
    const t = pjMk('div', 'outs-tile' + (warn ? ' warn' : ''));
    t.appendChild(pjMk('div', 'outs-tile-label', label));
    t.appendChild(value);
    if (sub) t.appendChild(sub);
    tiles.appendChild(t);
  });
  return tiles;
}
function buildOutsTiles(r) {
  return buildOutsTileRow([
    ['Current Rate', r.currentRateMinor == null
      ? pjMk('div', 'outs-tile-value pfm-muted', 'No rate')
      : outsUserText('div', 'outs-tile-value', outsMoney(r.currentRateMinor, r.currency))],
    ['Hours This Month', outsUserText('div', 'outs-tile-value', outsHours(r.monthMinutes))],
    ['Unbilled Hours', outsUserText('div', 'outs-tile-value', outsHours(r.unbilledMinutes)),
      outsUserText('div', 'outs-tile-sub', outsMoney(r.unbilledMinor, r.currency))],
    ['Unpaid', outsUserText('div', 'outs-tile-value', outsMoney(r.unpaidMinor, r.currency)),
      r.unbilledMissingRate ? pjMk('div', 'outs-tile-sub', 'Some entries have no rate yet') : null,
      r.unbilledMissingRate > 0],
  ]);
}

// ══ TABS ══
function setOutsDetailTab(key) {
  if (outsDetailTab === key) return;
  outsDetailTab = key;
  document.querySelectorAll('#outs-detail-tabs .seg-btn').forEach(b => {
    const active = b.dataset.outsTab === key;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderOutsTabBody();
  loadOutsTabData();
}
function renderOutsTabBody() {
  const body = document.getElementById('outs-tab-body');
  if (!body || !outsCurrent || outsView !== 'resource') return;
  body.innerHTML = '';
  if (outsDetailTab === 'rates') body.appendChild(buildOutsRatesSection(outsCurrent));
  else if (outsDetailTab === 'statements') body.appendChild(buildOutsStatementsSection());
  else body.appendChild(buildOutsProjectsSection());
}
async function loadOutsTabData() {
  const r = outsCurrent;
  if (!r || outsView !== 'resource') return;
  if (outsDetailTab === 'projects') {
    const rows = await window.api.listOutsProjects(r.id, { includeInactive: true }).catch(() => null);
    if (!rows) { toast('Could not load projects'); return; }
    if (outsCurrent?.id !== r.id) return;
    outsProjectRows = { resourceId: r.id, rows };
  } else if (outsDetailTab === 'statements') {
    const rows = await window.api.listOutsStatements(r.id).catch(() => null);
    if (!rows) { toast('Could not load statements'); return; }
    if (outsCurrent?.id !== r.id) return;
    outsStatementRows = { resourceId: r.id, rows };
  } else {
    return;
  }
  renderOutsTabBody();
}

// ── Projects tab ──
function buildOutsProjectsSection() {
  const section = pjMk('div', 'pj-section outs-projects');
  const inactiveBtn = outsBtn('eye', 'Show inactive', () => {
    outsShowInactiveProjects = !outsShowInactiveProjects;
    renderOutsTabBody();
  }, outsShowInactiveProjects ? 'active' : '');
  inactiveBtn.setAttribute('aria-pressed', outsShowInactiveProjects ? 'true' : 'false');
  const add = outsBtn('plus', 'Add Project', () => openOutsProjectModal(null), 'primary outs-project-add');
  section.appendChild(outsSectionHead('folder', 'Projects', [inactiveBtn, add]));
  const data = outsProjectRows?.resourceId === outsCurrent.id ? outsProjectRows : null;
  if (!data) {
    const loading = pjMk('div');
    section.appendChild(loading);
    showSkeleton(loading, 'text', 3);
    return section;
  }
  const rows = data.rows.filter(p => outsShowInactiveProjects || p.isActive);
  if (!rows.length) {
    section.appendChild(pjMk('div', 'cp-records-empty', data.rows.length
      ? 'Every project is inactive — click Show inactive to see them.'
      : 'No projects yet — add one, then write its hours inside it.'));
    return section;
  }
  const wrap = pjMk('div', 'pfm-table-wrap');
  const { table, body } = outsTable('outs-project-table', ['Project', 'Hours This Month', 'Unbilled Hours', 'Unbilled Fee', 'Total Hours', 'Last Entry']);
  rows.forEach(p => {
    const tr = pjMk('tr', 'pfm-row outs-project-row' + (p.isActive ? '' : ' archived'));
    tr.tabIndex = 0;
    tr.dataset.projectId = p.id;
    tr.addEventListener('click', () => openOutsProject(p.id));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') openOutsProject(p.id); });
    const name = outsCell(tr, outsUserText('span', 'pfm-ref', p.name));
    if (!p.isActive) name.appendChild(pjMk('span', 'pfm-archived-tag', 'Inactive'));
    outsCell(tr, outsUserText('span', 'pfm-fees', outsHours(p.monthMinutes)));
    outsCell(tr, outsUserText('span', 'pfm-fees', outsHours(p.unbilledMinutes)));
    const fee = outsCell(tr, outsUserText('span', 'pfm-fees', outsMoney(p.unbilledMinor, outsCurrent.currency)));
    if (p.unbilledMissingRate) {
      const warn = pjMk('span', 'outs-warn-ic');
      warn.innerHTML = ic('triangle-alert');
      warn.title = 'Some entries have no rate yet';
      fee.appendChild(warn);
    }
    outsCell(tr, outsUserText('span', 'pfm-fees pfm-muted', outsHours(p.totalMinutes)));
    outsCell(tr, pjMk('span', 'pfm-muted', pfmFmtDate(p.lastEntryDate)));
    body.appendChild(tr);
  });
  wrap.appendChild(table);
  section.appendChild(wrap);
  return section;
}

// ── Statements tab ──
function buildOutsStatementsSection() {
  const section = pjMk('div', 'pj-section outs-statements');
  section.appendChild(outsSectionHead('file-text', 'Statements',
    [outsBtn('plus', 'New Statement', () => openOutsStatementModal(null), 'primary outs-statement-add')]));
  const data = outsStatementRows?.resourceId === outsCurrent.id ? outsStatementRows : null;
  if (!data) {
    const loading = pjMk('div');
    section.appendChild(loading);
    showSkeleton(loading, 'text', 3);
    return section;
  }
  if (!data.rows.length) {
    section.appendChild(pjMk('div', 'cp-records-empty', 'No statements yet — create one for a period to see what is owed, then issue it.'));
    return section;
  }
  const wrap = pjMk('div', 'pfm-table-wrap');
  const { table, body } = outsTable('outs-statement-table', ['Number', 'Period', 'Status', 'Hours', 'Amount', 'Paid On']);
  data.rows.forEach(s => {
    const tr = pjMk('tr', 'pfm-row outs-statement-row' + (s.status === 'CANCELLED' ? ' archived' : ''));
    tr.tabIndex = 0;
    tr.dataset.statementId = s.id;
    tr.addEventListener('click', () => openOutsStatement(s.id));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') openOutsStatement(s.id); });
    outsCell(tr, outsUserText('span', 'pfm-ref', s.reference));
    outsCell(tr, pjMk('span', '', outsPeriodText(s)));
    const st = outsCell(tr, outsStatusPill(s.status));
    if (s.status === 'DRAFT' && s.missingRate) {
      const warn = pjMk('span', 'outs-warn-ic');
      warn.innerHTML = ic('triangle-alert');
      warn.title = 'Some entries have no rate yet';
      st.appendChild(warn);
    }
    outsCell(tr, outsUserText('span', 'pfm-fees', outsHours(s.totalMinutes)));
    outsCell(tr, outsUserText('span', 'pfm-fees', outsMoney(s.totalMinor, s.currency)));
    outsCell(tr, pjMk('span', 'pfm-muted', pfmFmtDate(s.paidAt)));
    body.appendChild(tr);
  });
  wrap.appendChild(table);
  section.appendChild(wrap);
  return section;
}

// ── Hourly rates (newest first) ──
function buildOutsRatesSection(r) {
  const section = pjMk('div', 'pj-section outs-rates');
  section.appendChild(outsSectionHead('tag', 'Hourly Rates',
    [outsBtn('plus', 'Add Rate', () => openOutsRateModal(null), 'primary outs-rate-add')]));
  const rates = r.rates || [];
  if (!rates.length) {
    section.appendChild(pjMk('div', 'cp-records-empty', 'No rate yet — add one so the hours can be priced.'));
    return section;
  }
  const today = pfmLocalToday();
  const current = outsCurrentRate(rates);
  const wrap = pjMk('div', 'pfm-table-wrap');
  const { table, body } = outsTable('outs-rate-table', ['Effective From', 'Rate / Hour', '', '']);
  rates.forEach(rate => {
    const tr = pjMk('tr', 'pfm-row outs-rate-row');
    tr.dataset.rateId = rate.id;
    outsCell(tr, pjMk('span', '', pfmFmtDate(rate.effectiveFrom)));
    outsCell(tr, outsUserText('span', 'pfm-fees', outsMoney(rate.rateMinor, r.currency)));
    const tag = outsCell(tr);
    if (current && rate.id === current.id) tag.appendChild(pjMk('span', 'pfm-current-tag', 'Current'));
    else if (rate.effectiveFrom > today) tag.appendChild(pjMk('span', 'pfm-archived-tag', 'Upcoming'));
    const icons = pjMk('div', 'outs-rate-icons');
    const renderIcons = () => {
      icons.innerHTML = '';
      icons.appendChild(outsIconBtn('pencil', 'Edit rate', () => openOutsRateModal(rate)));
      icons.appendChild(outsIconBtn('trash-2', 'Delete rate',
        () => showDeleteConfirm(icons, () => deleteOutsRateUi(rate.id), renderIcons), 'danger'));
    };
    renderIcons();
    outsCell(tr, icons);
    body.appendChild(tr);
  });
  wrap.appendChild(table);
  section.appendChild(wrap);
  return section;
}

// ══ RATE MODAL ══
function openOutsRateModal(rate) {
  if (!outsCurrent) return;
  outsRateEditId = rate ? rate.id : null;
  document.getElementById('outs-rate-title').textContent = rate ? 'Edit Rate' : 'New Rate';
  document.getElementById('outs-rate-submit').textContent = rate ? 'Save Changes' : 'Add Rate';
  document.getElementById('outs-rate-amount').value = rate ? minorToStr(rate.rateMinor) : '';
  document.getElementById('outs-rate-from').value = rate ? rate.effectiveFrom : pfmLocalToday();
  clearErrorsIn('#outs-rate-modal');
  document.getElementById('outs-rate-overlay').classList.add('open');
  setTimeout(() => document.getElementById('outs-rate-amount').focus(), 80);
}
function closeOutsRateModal() {
  document.getElementById('outs-rate-overlay').classList.remove('open');
  outsRateEditId = null;
}
function outsRateOverlayClick(e) {
  if (e.target === document.getElementById('outs-rate-overlay')) closeOutsRateModal();
}
// A rate write reports how many draft statements reach its date; those drafts
// will now issue at the new rate, which is worth a word.
function outsRateToast(done, res) {
  toast(res?.draftsAffected ? done + ' — open draft statements will use it' : done);
}
async function submitOutsRateModal() {
  const r = outsCurrent;
  if (!r) return;
  clearErrorsIn('#outs-rate-modal');
  const rateMinor = pfmParseFees(document.getElementById('outs-rate-amount').value);
  const effectiveFrom = document.getElementById('outs-rate-from').value;
  let bad = false;
  if (rateMinor == null) { markError('outs-rate-amount', rateMinor === undefined ? 'Enter the rate as a number, e.g. 250.00' : undefined); bad = true; }
  if (!effectiveFrom) { markError('outs-rate-from'); bad = true; }
  if (bad) return;
  const editing = outsRateEditId != null;
  const data = { rateMinor, effectiveFrom };
  let res;
  try { res = editing ? await window.api.updateOutsRate(outsRateEditId, data) : await window.api.addOutsRate(r.id, data); }
  catch { toast('Could not save the rate'); return; }
  if (!res?.ok) {
    const msg = res?.error || 'Could not save the rate';
    if (/date|effective/i.test(msg)) markError('outs-rate-from', msg);
    else if (/rate/i.test(msg)) markError('outs-rate-amount', msg);
    else toast(msg);
    return;
  }
  closeOutsRateModal();
  outsRateToast(editing ? 'Rate saved' : 'Rate added', res);
  outsAfterWrite(res.resource);
}

async function deleteOutsRateUi(rateId) {
  let res;
  try { res = await window.api.deleteOutsRate(rateId); }
  catch { toast('Could not delete the rate'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not delete the rate'); renderOutsTabBody(); return; }
  outsAfterWrite(res.resource);
  toast(res.draftsAffected ? 'Rate deleted — open draft statements will use it' : 'Rate deleted', {
    actionLabel: 'Undo', duration: 5000,
    onAction: async () => {
      const restored = await window.api.restoreOutsRate(rateId).catch(() => null);
      toast(restored?.ok ? 'Rate restored' : (restored?.error || 'Could not restore the rate'));
      if (restored?.ok) outsAfterWrite(restored.resource);
    },
    onExpire: () => window.api.purgeOutsRate(rateId).catch(() => {}),
  });
}

// ══ PROJECT MODAL ══
function openOutsProjectModal(project) {
  if (!outsCurrent) return;
  outsProjectEditId = project ? project.id : null;
  document.getElementById('outs-project-title').textContent = project ? 'Edit Project' : 'New Project';
  document.getElementById('outs-project-submit').textContent = project ? 'Save Changes' : 'Add Project';
  document.getElementById('outs-project-name').value = project ? project.name : '';
  document.getElementById('outs-project-notes').value = project ? project.notes : '';
  clearErrorsIn('#outs-project-modal');
  document.getElementById('outs-project-overlay').classList.add('open');
  setTimeout(() => document.getElementById('outs-project-name').focus(), 80);
}
function closeOutsProjectModal() {
  document.getElementById('outs-project-overlay').classList.remove('open');
  outsProjectEditId = null;
}
function outsProjectOverlayClick(e) {
  if (e.target === document.getElementById('outs-project-overlay')) closeOutsProjectModal();
}
async function submitOutsProjectModal() {
  const r = outsCurrent;
  if (!r) return;
  clearErrorsIn('#outs-project-modal');
  const data = {
    name: document.getElementById('outs-project-name').value.trim(),
    notes: document.getElementById('outs-project-notes').value.trim(),
  };
  if (!data.name) { markError('outs-project-name'); return; }
  const editing = outsProjectEditId != null;
  let res;
  try { res = editing ? await window.api.updateOutsProject(outsProjectEditId, data) : await window.api.createOutsProject(r.id, data); }
  catch { toast('Could not save the project'); return; }
  if (!res?.ok) {
    const msg = res?.error || 'Could not save the project';
    if (/name/i.test(msg)) markError('outs-project-name', msg);
    else if (/notes/i.test(msg)) markError('outs-project-notes', msg);
    else toast(msg);
    return;
  }
  closeOutsProjectModal();
  toast(editing ? 'Project saved' : 'Project added');
  outsLoaded = false;
  if (editing && outsView === 'project' && outsCurrentProject?.id === res.project.id) {
    outsCurrentProject = res.project;
    renderOutsProjectPage();
  } else {
    // A new project opens straight away, ready for its first entry.
    openOutsProject(res.project.id);
  }
}

// ══ PROJECT PAGE — the entries grid ══
// Oldest first, like the sheet. The last row is always an empty one: type the
// time and description, press Enter, and the next empty row opens on the same
// date. Minutes / hours / fee in the footer, and — when the rate changed
// within the period — the per-rate lines a statement will show.
// opts.entryId (Quick Find): highlight that row.
async function openOutsProject(projectId, opts = {}) {
  let project;
  try { project = await window.api.getOutsProject(projectId); }
  catch { toast('Could not open this project'); return; }
  if (!project) { toast('This project no longer exists'); return; }
  if (outsCurrent?.id !== project.resourceId) {
    const resource = await window.api.getOutsResource(project.resourceId).catch(() => null);
    if (!resource) { toast('This resource no longer exists'); return; }
    outsCurrent = resource;
    outsProjectRows = null;
    outsStatementRows = null;
  }
  if (activeModule !== 'outsource') switchModule('outsource');
  if (outsCurrentProject?.id !== project.id) { outsEditEntryId = null; outsEntryData = null; }
  if (opts.entryId) { outsEntryFilter.period = 'all'; outsEntryFilter.unbilled = false; }
  outsView = 'project';
  outsCurrentProject = project;
  outsCurrentStatement = null;
  outsDetailTab = 'projects';
  showOutsDetailView();
  renderOutsProjectPage();
  document.getElementById('outs-detail-view').scrollTop = 0;
  await loadOutsEntries();
  if (opts.entryId) scrollToAndHighlight('#outs-detail-view tr[data-entry-id="' + Number(opts.entryId) + '"]');
  else focusOutsNewEntry();
}

function buildOutsProjectTiles(p) {
  const currency = outsCurrent?.currency;
  return buildOutsTileRow([
    ['Hours This Month', outsUserText('div', 'outs-tile-value', outsHours(p.monthMinutes))],
    ['Unbilled Hours', outsUserText('div', 'outs-tile-value', outsHours(p.unbilledMinutes))],
    ['Unbilled Fee', outsUserText('div', 'outs-tile-value', outsMoney(p.unbilledMinor, currency)),
      p.unbilledMissingRate ? pjMk('div', 'outs-tile-sub', 'Some entries have no rate yet') : null, p.unbilledMissingRate > 0],
    ['Total Hours', outsUserText('div', 'outs-tile-value', outsHours(p.totalMinutes))],
  ]);
}

function renderOutsProjectPage() {
  const p = outsCurrentProject;
  const r = outsCurrent;
  const host = document.getElementById('outs-detail-view');
  if (!p || !r || !host) return;
  host.innerHTML = '';
  host.appendChild(outsCrumbs([[r.name, () => backToOutsResource('projects')], [p.name]]));

  const head = pjMk('div', 'pj-detail-head');
  const ident = pjMk('div', 'pfm-ident');
  const titleRow = pjMk('div', 'pj-detail-title');
  titleRow.appendChild(outsUserText('span', 'pfm-detail-ref', p.name));
  if (!p.isActive) titleRow.appendChild(pjMk('span', 'pfm-archived-tag', 'Inactive'));
  ident.appendChild(titleRow);
  const sub = pjMk('div', 'pfm-detail-sub');
  sub.appendChild(outsUserText('span', '', r.name));
  sub.appendChild(pjMk('span', 'pfm-dot', '·'));
  const rate = outsCurrentRate(r.rates);
  sub.appendChild(rate ? outsUserText('span', 'pfm-fees', outsMoney(rate.rateMinor, r.currency)) : pjMk('span', '', 'No rate'));
  ident.appendChild(sub);
  head.appendChild(ident);
  const actions = pjMk('div', 'pj-detail-actions pfm-detail-actions');
  // Exports the entries under the current filter, as they stand.
  actions.appendChild(outsBtn('download', 'Excel', () => exportOutsExcel(), 'outs-excel-btn'));
  actions.appendChild(outsBtn('printer', 'PDF', () => exportOutsPdf(), 'outs-pdf-btn'));
  actions.appendChild(outsBtn('pencil', 'Edit', () => openOutsProjectModal(p)));
  actions.appendChild(outsBtn(p.isActive ? 'ban' : 'rotate-ccw', p.isActive ? 'Deactivate' : 'Activate', () => setOutsProjectActiveUi(p.id, !p.isActive)));
  const delHost = pjMk('span', 'pfm-del-host');
  actions.appendChild(delHost);
  const renderDel = () => {
    delHost.innerHTML = '';
    delHost.appendChild(outsBtn('trash-2', 'Delete', () => showDeleteConfirm(delHost, () => deleteOutsProjectUi(p.id), renderDel), 'del-action'));
  };
  renderDel();
  head.appendChild(actions);
  host.appendChild(head);
  host.appendChild(buildOutsProjectTiles(p));

  const body = pjMk('div', 'outs-tab-body');
  body.id = 'outs-tab-body';
  host.appendChild(body);
  renderOutsEntriesBody();
  if (p.notes) {
    const notes = pjMk('div', 'pj-section');
    notes.appendChild(outsSectionHead('file-text', 'Notes'));
    notes.appendChild(outsUserText('div', 'outs-notes', p.notes));
    host.appendChild(notes);
  }
}
function renderOutsEntriesBody() {
  const body = document.getElementById('outs-tab-body');
  if (!body || outsView !== 'project') return;
  body.innerHTML = '';
  body.appendChild(buildOutsEntriesSection());
}

// { from, to } for the period filter ('' = open-ended).
function outsPeriodRange() {
  const f = outsEntryFilter;
  const now = new Date();
  if (f.period === 'this-month' || f.period === 'last-month') {
    const back = f.period === 'last-month' ? 1 : 0;
    return {
      from: outsIsoDate(new Date(now.getFullYear(), now.getMonth() - back, 1)),
      to: outsIsoDate(new Date(now.getFullYear(), now.getMonth() - back + 1, 0)),
    };
  }
  if (f.period === 'custom') return { from: f.from || '', to: f.to || '' };
  return { from: '', to: '' };
}

async function loadOutsEntries() {
  const p = outsCurrentProject;
  if (!p || outsView !== 'project') return;
  const { from, to } = outsPeriodRange();
  let res;
  try { res = await window.api.listOutsEntries(p.resourceId, { projectId: p.id, from, to, unbilled: outsEntryFilter.unbilled }); }
  catch { toast('Could not load entries'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not load entries'); return; }
  if (outsCurrentProject?.id !== p.id) return;   // another project was opened meanwhile
  outsEntryData = { projectId: p.id, ...res };
  renderOutsEntriesBody();
}

// After an entry write: the project tiles and the grid change; the resource
// totals and the list page are stale too.
async function outsRefreshAfterEntry() {
  const p = outsCurrentProject;
  if (!p) return;
  const [fresh, resource] = await Promise.all([
    window.api.getOutsProject(p.id).catch(() => null),
    window.api.getOutsResource(p.resourceId).catch(() => null),
  ]);
  if (resource && outsCurrent?.id === resource.id) outsCurrent = resource;
  if (fresh && outsCurrentProject?.id === fresh.id) {
    outsCurrentProject = fresh;
    document.getElementById('outs-tiles')?.replaceWith(buildOutsProjectTiles(fresh));
  }
  outsLoaded = false;
  outsProjectRows = null;
  outsStatementRows = null;
  await loadOutsEntries();
}

function buildOutsEntriesSection() {
  const section = pjMk('div', 'pj-section outs-entries');
  section.appendChild(buildOutsEntryFilters());
  const data = outsEntryData && outsEntryData.projectId === outsCurrentProject.id ? outsEntryData : null;
  if (!data) {
    const loading = pjMk('div');
    section.appendChild(loading);
    showSkeleton(loading, 'text', 3);
    return section;
  }
  if (data.summary.missingRate) {
    const warn = pjMk('div', 'outs-banner');
    warn.innerHTML = ic('triangle-alert');
    warn.appendChild(pjMk('span', '', 'Some entries are dated before the first rate — they stay unpriced until a rate covers their date.'));
    section.appendChild(warn);
  }
  const filtered = outsEntryFilter.period !== 'all' || outsEntryFilter.unbilled;
  if (!data.entries.length) {
    section.appendChild(pjMk('div', 'cp-records-empty', filtered
      ? 'No entries match these filters yet.'
      : 'No entries yet — type the first one in the row below.'));
  }
  const wrap = pjMk('div', 'pfm-table-wrap');
  const { table, body } = outsTable('outs-grid', ['Day', 'Date', 'Minutes', 'Hours', 'Description', '']);
  data.entries.forEach(e => body.appendChild(e.id === outsEditEntryId ? buildOutsEntryEditRow(e) : buildOutsEntryRow(e)));
  if (outsCurrentProject.isActive) body.appendChild(buildOutsEntryEditRow(null));

  const foot = document.createElement('tfoot');
  const fr = pjMk('tr', 'outs-total-row');
  const total = pjMk('td', 'outs-total-label', 'Total');
  total.colSpan = 2;
  fr.appendChild(total);
  fr.appendChild(outsUserText('td', 'pfm-fees', String(data.summary.totalMinutes)));
  fr.appendChild(outsUserText('td', 'pfm-fees', outsHours(data.summary.totalMinutes)));
  const fee = pjMk('td', 'outs-total-fee');
  fee.colSpan = 2;
  fee.appendChild(pjMk('span', 'pfm-muted', 'Fee'));
  fee.appendChild(outsUserText('span', 'pfm-fees', outsMoney(data.summary.totalMinor, data.currency)));
  fr.appendChild(fee);
  foot.appendChild(fr);
  table.appendChild(foot);
  wrap.appendChild(table);
  section.appendChild(wrap);
  section.appendChild(pjMk('div', 'outs-hint', outsCurrentProject.isActive
    ? 'Time: 90, 1:30 or 1.5h. Enter saves and opens the next row; Esc clears it.'
    : 'This project is inactive — activate it to add hours.'));
  if (data.summary.lines.length > 1) section.appendChild(buildOutsLines(data.summary.lines, data.currency, 'By Rate'));
  return section;
}

function buildOutsEntryFilters() {
  const bar = pjMk('div', 'pfm-toolbar outs-entry-filters');
  const seg = pjMk('div', 'seg-ctl');
  seg.id = 'outs-period-ctl';
  seg.setAttribute('aria-label', 'Period');
  [['all', 'All Dates'], ['this-month', 'This Month'], ['last-month', 'Last Month'], ['custom', 'Custom']].forEach(([key, label]) => {
    const b = pjMk('button', 'seg-btn' + (outsEntryFilter.period === key ? ' active' : ''), label);
    b.type = 'button';
    b.dataset.period = key;
    b.setAttribute('aria-pressed', outsEntryFilter.period === key ? 'true' : 'false');
    b.addEventListener('click', () => { outsEntryFilter.period = key; outsEditEntryId = null; renderOutsEntriesBody(); loadOutsEntries(); });
    seg.appendChild(b);
  });
  bar.appendChild(seg);
  if (outsEntryFilter.period === 'custom') {
    [['from', 'From'], ['to', 'To']].forEach(([key, label]) => {
      const l = pjMk('label', 'outs-range', label);
      const input = document.createElement('input');
      input.type = 'date';
      input.id = 'outs-filter-' + key;
      input.value = outsEntryFilter[key];
      input.addEventListener('change', () => { outsEntryFilter[key] = input.value; loadOutsEntries(); });
      l.appendChild(input);
      bar.appendChild(l);
    });
  }
  const unbilled = outsBtn('lock', 'Not on a statement', () => {
    outsEntryFilter.unbilled = !outsEntryFilter.unbilled;
    renderOutsEntriesBody();
    loadOutsEntries();
  }, outsEntryFilter.unbilled ? 'active' : '');
  unbilled.id = 'outs-unbilled-btn';
  unbilled.setAttribute('aria-pressed', outsEntryFilter.unbilled ? 'true' : 'false');
  bar.appendChild(unbilled);
  return bar;
}

function buildOutsEntryRow(e) {
  const tr = pjMk('tr', 'pfm-row outs-entry-row' + (e.locked ? ' locked' : ''));
  tr.dataset.entryId = e.id;
  outsCell(tr, pjMk('span', 'pfm-muted', outsWeekday(e.date)));
  outsCell(tr, pjMk('span', 'outs-date', pfmFmtDate(e.date)));
  outsCell(tr, outsUserText('span', 'pfm-fees', String(e.minutes)));
  outsCell(tr, outsUserText('span', 'pfm-fees pfm-muted', outsHours(e.minutes)));
  outsCell(tr, outsUserText('span', 'outs-desc', e.description));
  const acts = pjMk('div', 'outs-row-icons');
  const renderIcons = () => {
    acts.innerHTML = '';
    if (e.rateMinor == null) {
      const warn = pjMk('span', 'outs-warn-ic');
      warn.innerHTML = ic('triangle-alert');
      warn.title = 'No rate for this date';
      acts.appendChild(warn);
    }
    if (e.locked) {
      const lock = pjMk('span', 'outs-lock-ic');
      lock.innerHTML = ic('lock');
      lock.title = 'On an issued statement — locked';
      acts.appendChild(lock);
      return;
    }
    acts.appendChild(outsIconBtn('pencil', 'Edit entry', () => startOutsEntryEdit(e.id), 'outs-entry-edit'));
    acts.appendChild(outsIconBtn('trash-2', 'Delete entry',
      () => showDeleteConfirm(acts, () => deleteOutsEntryUi(e.id), renderIcons), 'danger outs-entry-delete'));
  };
  renderIcons();
  outsCell(tr, acts);
  if (!e.locked) tr.addEventListener('dblclick', () => startOutsEntryEdit(e.id));
  return tr;
}

// The same input row serves the empty "next line" (entry = null, ids
// outs-new-*) and an inline edit of an existing entry (ids outs-edit-*).
function buildOutsEntryEditRow(entry) {
  const prefix = entry ? 'outs-edit-' : 'outs-new-';
  const tr = pjMk('tr', 'pfm-row outs-input-row' + (entry ? ' editing' : ' outs-new-row'));
  if (entry) tr.dataset.entryId = entry.id;
  const day = pjMk('span', 'pfm-muted');
  outsCell(tr, day);
  const input = (id, type, value, placeholder, label) => {
    const el = document.createElement('input');
    el.type = type;
    el.id = prefix + id;
    el.className = 'outs-cell-input';
    el.value = value || '';
    if (placeholder) el.placeholder = placeholder;
    el.setAttribute('aria-label', label);
    el.autocomplete = 'off';
    el.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); saveOutsEntryRow(entry); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancelOutsEntryRow(entry); }
    });
    return el;
  };
  const date = input('date', 'date', entry ? entry.date : (outsLastDate || pfmLocalToday()), '', 'Date');
  const syncDay = () => { day.textContent = date.value ? outsWeekday(date.value) : ''; };
  date.addEventListener('input', syncDay);
  syncDay();
  outsCell(tr, date);
  const time = input('time', 'text', entry ? String(entry.minutes) : '', '90 · 1:30 · 1.5h', 'Time');
  time.inputMode = 'decimal';
  outsCell(tr, time).colSpan = 2;
  outsCell(tr, input('description', 'text', entry ? entry.description : '', 'What was done?', 'Description'));
  const acts = pjMk('div', 'outs-row-icons');
  acts.appendChild(outsIconBtn(entry ? 'check' : 'plus', entry ? 'Save entry' : 'Add entry', () => saveOutsEntryRow(entry), 'outs-entry-save'));
  if (entry) acts.appendChild(outsIconBtn('x', 'Cancel edit', () => cancelOutsEntryRow(entry), 'outs-entry-cancel'));
  outsCell(tr, acts);
  return tr;
}

function startOutsEntryEdit(id) {
  outsEditEntryId = id;
  renderOutsEntriesBody();
  setTimeout(() => document.getElementById('outs-edit-time')?.focus(), 0);
}
function cancelOutsEntryRow(entry) {
  if (entry) { outsEditEntryId = null; renderOutsEntriesBody(); return; }
  ['time', 'description'].forEach(k => { const el = document.getElementById('outs-new-' + k); if (el) el.value = ''; });
  clearErrorsIn('#outs-tab-body');
}
function focusOutsNewEntry() {
  const el = document.getElementById('outs-new-time');
  if (!el) return false;
  el.scrollIntoView({ block: 'nearest' });
  el.focus();
  return true;
}
// Ctrl+N does the obvious "new" for the page you are on.
function outsCtrlN() {
  if (outsView === 'project' && outsCurrentProject && focusOutsNewEntry()) return;
  if (outsCurrent && outsView === 'resource') {
    if (outsDetailTab === 'projects') { openOutsProjectModal(null); return; }
    if (outsDetailTab === 'statements') { openOutsStatementModal(null); return; }
    if (outsDetailTab === 'rates') { openOutsRateModal(null); return; }
  }
  openOutsNew();
}

function outsEntryErrorField(prefix, msg) {
  if (/date/i.test(msg)) return prefix + 'date';
  if (/time|minutes|hours/i.test(msg)) return prefix + 'time';
  if (/description/i.test(msg)) return prefix + 'description';
  return null;
}

let outsEntrySaving = false;      // Enter held down must not add the row twice
async function saveOutsEntryRow(entry) {
  if (outsEntrySaving || !outsCurrentProject) return;
  const prefix = entry ? 'outs-edit-' : 'outs-new-';
  const read = k => document.getElementById(prefix + k)?.value ?? '';
  clearErrorsIn('#outs-tab-body');
  const next = { date: read('date'), minutes: read('time').trim(), description: read('description').trim() };
  let bad = false;
  if (!next.date) { markError(prefix + 'date'); bad = true; }
  if (!next.minutes) { markError(prefix + 'time', 'Enter the time, e.g. 90, 1:30 or 1.5h'); bad = true; }
  if (bad) return;

  let data = next;
  if (entry) {
    // Send only what changed; the time counts as unchanged while it still reads as the stored minutes.
    const was = { date: entry.date, minutes: String(entry.minutes), description: entry.description };
    data = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== was[k]));
    if (!Object.keys(data).length) { outsEditEntryId = null; renderOutsEntriesBody(); return; }
  }
  outsEntrySaving = true;
  let res;
  try { res = entry ? await window.api.updateOutsEntry(entry.id, data) : await window.api.createOutsEntry(outsCurrentProject.id, data); }
  catch { res = { ok: false, error: 'Could not save the entry' }; }
  finally { outsEntrySaving = false; }
  if (!res?.ok) {
    const msg = res?.error || 'Could not save the entry';
    const field = outsEntryErrorField(prefix, msg);
    if (field) markError(field, msg); else toast(msg);
    return;
  }
  outsLastDate = res.entry.date;
  if (entry) outsEditEntryId = null;
  await outsRefreshAfterEntry();
  const shown = outsEntryData?.entries?.some(x => x.id === res.entry.id);
  if (!shown) toast('Saved — the current filters hide it');
  else if (entry) toast('Entry saved');
  if (!entry) focusOutsNewEntry();
}

async function deleteOutsEntryUi(id) {
  let res;
  try { res = await window.api.deleteOutsEntry(id); }
  catch { toast('Could not delete the entry'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not delete the entry'); renderOutsEntriesBody(); return; }
  if (outsEditEntryId === id) outsEditEntryId = null;
  await outsRefreshAfterEntry();
  toast('Entry deleted', {
    actionLabel: 'Undo', duration: 5000,
    onAction: async () => {
      const restored = await window.api.restoreOutsEntry(id).catch(() => null);
      toast(restored?.ok ? 'Entry restored' : (restored?.error || 'Could not restore the entry'));
      if (restored?.ok) await outsRefreshAfterEntry();
    },
    onExpire: () => window.api.purgeOutsEntry(id).catch(() => {}),
  });
}

// Lines per project × rate — the table a statement carries. `title` names it.
function buildOutsLines(lines, currency, title) {
  const box = pjMk('div', 'outs-lines');
  const head = pjMk('div', 'pj-section-title');
  head.innerHTML = ic('layers');
  head.appendChild(document.createTextNode(title));
  box.appendChild(head);
  const wrap = pjMk('div', 'pfm-table-wrap');
  const { table, body } = outsTable('outs-lines-table', ['Project', 'Hours', 'Rate / Hour', 'Amount']);
  lines.forEach(l => {
    const tr = pjMk('tr', 'pfm-row outs-line-row');
    outsCell(tr, outsUserText('span', '', l.project));
    outsCell(tr, outsUserText('span', 'pfm-fees', outsHours(l.minutes)));
    outsCell(tr, l.rateMinor == null ? pjMk('span', 'outs-no-rate', 'No rate') : outsUserText('span', 'pfm-fees', outsMoney(l.rateMinor, currency)));
    outsCell(tr, l.amountMinor == null ? pjMk('span', 'pfm-muted', '—') : outsUserText('span', 'pfm-fees', outsMoney(l.amountMinor, currency)));
    body.appendChild(tr);
  });
  wrap.appendChild(table);
  box.appendChild(wrap);
  return box;
}

async function setOutsProjectActiveUi(id, active) {
  let res;
  try { res = await window.api.setOutsProjectActive(id, active); }
  catch { toast('Could not update the project'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not update the project'); return; }
  toast(active ? 'Project activated' : 'Project deactivated');
  outsCurrentProject = res.project;
  outsLoaded = false;
  outsProjectRows = null;
  renderOutsProjectPage();
}

// A project with entries on an issued statement can be deactivated, not deleted.
async function deleteOutsProjectUi(id) {
  let res;
  try { res = await window.api.deleteOutsProject(id); }
  catch { toast('Could not delete the project'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not delete the project'); renderOutsProjectPage(); return; }
  outsLoaded = false;
  backToOutsResource('projects');
  toast('Project deleted', {
    actionLabel: 'Undo', duration: 5000,
    onAction: async () => {
      const restored = await window.api.restoreOutsProject(id).catch(() => null);
      toast(restored?.ok ? 'Project restored' : (restored?.error || 'Could not restore the project'));
      if (restored?.ok && outsCurrent && outsView === 'resource') { outsProjectRows = null; loadOutsTabData(); }
    },
    onExpire: () => window.api.purgeOutsProject(id).catch(() => {}),
  });
}

// ══ STATEMENT MODAL (new + edit) ══
// A new statement's period starts at the oldest unbilled entry (or the 1st of
// this month) and ends today (or at the newest unbilled entry, if later).
async function openOutsStatementModal(statement) {
  const r = outsCurrent;
  if (!r) return;
  outsStatementEditId = statement ? statement.id : null;
  document.getElementById('outs-statement-title').textContent = statement ? 'Edit Statement' : 'New Statement';
  document.getElementById('outs-statement-submit').textContent = statement ? 'Save Changes' : 'Create Draft';
  document.getElementById('outs-statement-ref').value = statement ? statement.reference : '';
  document.getElementById('outs-statement-notes').value = statement ? statement.notes : '';
  const from = document.getElementById('outs-statement-from');
  const to = document.getElementById('outs-statement-to');
  const periodLocked = !!statement && statement.status !== 'DRAFT';
  from.disabled = periodLocked;
  to.disabled = periodLocked;
  document.getElementById('outs-statement-period-note').hidden = !periodLocked;
  if (statement) {
    from.value = statement.periodFrom;
    to.value = statement.periodTo;
  } else {
    const today = pfmLocalToday();
    from.value = today.slice(0, 8) + '01';
    to.value = today;
    const res = await window.api.listOutsEntries(r.id, { unbilled: true }).catch(() => null);
    const dates = (res?.entries || []).map(e => e.date);
    if (dates.length) {
      from.value = dates[0];
      if (dates[dates.length - 1] > today) to.value = dates[dates.length - 1];
    }
  }
  clearErrorsIn('#outs-statement-modal');
  document.getElementById('outs-statement-overlay').classList.add('open');
  setTimeout(() => (periodLocked ? document.getElementById('outs-statement-ref') : from).focus(), 80);
}
function closeOutsStatementModal() {
  document.getElementById('outs-statement-overlay').classList.remove('open');
  outsStatementEditId = null;
}
function outsStatementOverlayClick(e) {
  if (e.target === document.getElementById('outs-statement-overlay')) closeOutsStatementModal();
}
async function submitOutsStatementModal() {
  const r = outsCurrent;
  if (!r) return;
  clearErrorsIn('#outs-statement-modal');
  const editing = outsStatementEditId != null;
  const from = document.getElementById('outs-statement-from');
  const data = {
    reference: document.getElementById('outs-statement-ref').value.trim(),
    notes: document.getElementById('outs-statement-notes').value.trim(),
  };
  if (!from.disabled) {
    data.periodFrom = from.value;
    data.periodTo = document.getElementById('outs-statement-to').value;
    let bad = false;
    if (!data.periodFrom) { markError('outs-statement-from'); bad = true; }
    if (!data.periodTo) { markError('outs-statement-to'); bad = true; }
    if (bad) return;
  }
  if (editing && !data.reference) { markError('outs-statement-ref'); return; }
  let res;
  try { res = editing ? await window.api.updateOutsStatement(outsStatementEditId, data) : await window.api.createOutsStatement(r.id, data); }
  catch { toast('Could not save the statement'); return; }
  if (!res?.ok) {
    const msg = res?.error || 'Could not save the statement';
    if (/number/i.test(msg)) markError('outs-statement-ref', msg);
    else if (/start|period/i.test(msg)) markError('outs-statement-from', msg);
    else if (/end/i.test(msg)) markError('outs-statement-to', msg);
    else if (/notes/i.test(msg)) markError('outs-statement-notes', msg);
    else toast(msg);
    return;
  }
  closeOutsStatementModal();
  toast(editing ? 'Statement saved' : 'Draft statement created');
  outsStatementRows = null;
  openOutsStatement(res.statement.id);
}

// ══ STATEMENT PAGE ══
async function openOutsStatement(statementId) {
  let s;
  try { s = await window.api.getOutsStatement(statementId); }
  catch { toast('Could not open this statement'); return; }
  if (!s) { toast('This statement no longer exists'); return; }
  if (outsCurrent?.id !== s.resourceId) {
    const resource = await window.api.getOutsResource(s.resourceId).catch(() => null);
    if (!resource) { toast('This resource no longer exists'); return; }
    outsCurrent = resource;
    outsProjectRows = null;
    outsStatementRows = null;
  }
  if (activeModule !== 'outsource') switchModule('outsource');
  outsView = 'statement';
  outsCurrentStatement = s;
  outsCurrentProject = null;
  outsDetailTab = 'statements';
  showOutsDetailView();
  renderOutsStatementPage();
  document.getElementById('outs-detail-view').scrollTop = 0;
}
function outsAfterStatementWrite(statement) {
  outsLoaded = false;
  outsStatementRows = null;
  outsProjectRows = null;
  window.api.getOutsResource(statement.resourceId).then(r => { if (r && outsCurrent?.id === r.id) outsCurrent = r; }).catch(() => {});
  if (outsView === 'statement' && outsCurrentStatement?.id === statement.id) {
    outsCurrentStatement = statement;
    renderOutsStatementPage();
  }
}

function renderOutsStatementPage() {
  const s = outsCurrentStatement;
  const r = outsCurrent;
  const host = document.getElementById('outs-detail-view');
  if (!s || !r || !host) return;
  host.innerHTML = '';
  host.appendChild(outsCrumbs([[r.name, () => backToOutsResource('statements')], [s.reference]]));

  const head = pjMk('div', 'pj-detail-head');
  const ident = pjMk('div', 'pfm-ident');
  const titleRow = pjMk('div', 'pj-detail-title');
  titleRow.appendChild(outsUserText('span', 'pfm-detail-ref', s.reference));
  titleRow.appendChild(outsStatusPill(s.status));
  ident.appendChild(titleRow);
  const sub = pjMk('div', 'pfm-detail-sub');
  sub.appendChild(outsUserText('span', '', r.name));
  sub.appendChild(pjMk('span', 'pfm-dot', '·'));
  sub.appendChild(pjMk('span', '', outsPeriodText(s)));
  ident.appendChild(sub);
  head.appendChild(ident);

  const actions = pjMk('div', 'pj-detail-actions pfm-detail-actions');
  const confirmHost = (iconName, label, fn, confirmLabel, cls = '') => {
    const hostEl = pjMk('span', 'pfm-del-host');
    const render = () => {
      hostEl.innerHTML = '';
      hostEl.appendChild(outsBtn(iconName, label, () => showDeleteConfirm(hostEl, fn, render, confirmLabel), cls));
    };
    render();
    actions.appendChild(hostEl);
  };
  const issuable = s.status === 'DRAFT' && s.entries.length && !s.missingRate;
  if (s.status === 'DRAFT') {
    const issue = outsBtn('check', 'Issue', () => issueOutsStatementUi(s.id), 'primary outs-issue-btn');
    issue.disabled = !issuable;
    if (!s.entries.length) issue.title = 'There are no unbilled entries in this period';
    else if (s.missingRate) issue.title = 'Some entries in this period have no rate — add a rate that covers them first';
    actions.appendChild(issue);
  }
  if (s.status === 'ISSUED') actions.appendChild(outsBtn('credit-card', 'Mark Paid', () => openOutsPaidModal(), 'primary outs-paid-btn'));
  actions.appendChild(outsBtn('download', 'Excel', () => exportOutsExcel(), 'outs-excel-btn'));
  actions.appendChild(outsBtn('printer', 'PDF', () => exportOutsPdf(), 'outs-pdf-btn'));
  actions.appendChild(outsBtn('pencil', 'Edit', () => openOutsStatementModal(s)));
  if (s.status === 'PAID') confirmHost('rotate-ccw', 'Mark Unpaid', () => setOutsStatementUnpaidUi(s.id), 'Mark unpaid?', 'outs-unpaid-btn');
  if (s.status === 'ISSUED') confirmHost('ban', 'Cancel Statement', () => cancelOutsStatementUi(s.id), 'Cancel it?', 'del-action outs-cancel-btn');
  if (s.status === 'DRAFT' || s.status === 'CANCELLED') {
    confirmHost('trash-2', 'Delete', () => deleteOutsStatementUi(s.id), 'Delete?', 'del-action outs-statement-delete');
  }
  head.appendChild(actions);
  host.appendChild(head);

  host.appendChild(buildOutsTileRow([
    ['Hours', outsUserText('div', 'outs-tile-value', outsHours(s.totalMinutes))],
    ['Amount', outsUserText('div', 'outs-tile-value', outsMoney(s.totalMinor, s.currency))],
    ['Issued On', pjMk('div', 'outs-tile-value' + (s.issuedAt ? '' : ' pfm-muted'), s.issuedAt ? pfmFmtDate(s.issuedAt) : '—')],
    ['Paid On', pjMk('div', 'outs-tile-value' + (s.paidAt ? '' : ' pfm-muted'), s.paidAt ? pfmFmtDate(s.paidAt) : '—'),
      s.paidNote ? outsUserText('div', 'outs-tile-sub', s.paidNote) : null],
  ]));

  const section = pjMk('div', 'pj-section');
  if (s.status === 'DRAFT') {
    const note = pjMk('div', 'outs-hint outs-draft-note',
      'A draft is a live preview: it shows the unbilled hours in this period at today\'s rates. Issuing locks those entries and keeps these numbers.');
    section.appendChild(note);
    if (s.missingRate) {
      const warn = pjMk('div', 'outs-banner');
      warn.innerHTML = ic('triangle-alert');
      warn.appendChild(pjMk('span', '', 'Some entries in this period have no rate — add a rate that covers them first'));
      section.appendChild(warn);
    }
    if (s.earlierUnbilled) {
      const early = pjMk('div', 'outs-banner info');
      early.innerHTML = ic('flag');
      early.appendChild(pjMk('span', '', 'There are unbilled entries dated before this period — widen the period to include them.'));
      section.appendChild(early);
    }
  }
  if (s.status === 'CANCELLED') {
    section.appendChild(pjMk('div', 'outs-hint', 'This statement was cancelled; its entries are free again. The lines below are what had been issued.'));
  }
  if (s.lines.length) {
    section.appendChild(buildOutsLines(s.lines, s.currency, s.status === 'DRAFT' ? 'Preview by Project & Rate' : 'By Project & Rate'));
  } else {
    section.appendChild(pjMk('div', 'cp-records-empty', 'There are no unbilled entries in this period'));
  }
  if (s.entries.length) section.appendChild(buildOutsStatementEntries(s));
  host.appendChild(section);
  if (s.notes) {
    const notes = pjMk('div', 'pj-section');
    notes.appendChild(outsSectionHead('file-text', 'Notes'));
    notes.appendChild(outsUserText('div', 'outs-notes', s.notes));
    host.appendChild(notes);
  }
}
function outsGroupByProject(entries) {
  const groups = new Map();
  entries.forEach(e => {
    const key = e.projectId ?? e.project;
    if (!groups.has(key)) groups.set(key, { project: e.project, entries: [] });
    groups.get(key).entries.push(e);
  });
  return [...groups.values()].sort((a, b) => a.project.localeCompare(b.project));
}
function buildOutsStatementEntries(s) {
  const box = pjMk('div', 'outs-lines');
  const head = pjMk('div', 'pj-section-title');
  head.innerHTML = ic('list');
  head.appendChild(document.createTextNode('Entries'));
  box.appendChild(head);
  const wrap = pjMk('div', 'pfm-table-wrap');
  const { table, body } = outsTable('outs-grid outs-statement-entries', ['Day', 'Date', 'Minutes', 'Hours', 'Description']);
  outsGroupByProject(s.entries).forEach(g => {
    const gh = pjMk('tr', 'outs-group-row');
    const cell = outsCell(gh, outsUserText('span', '', g.project));
    cell.colSpan = 5;
    body.appendChild(gh);
    g.entries.forEach(e => {
      const tr = pjMk('tr', 'pfm-row outs-entry-row');
      tr.dataset.entryId = e.id;
      outsCell(tr, pjMk('span', 'pfm-muted', outsWeekday(e.date)));
      outsCell(tr, pjMk('span', '', pfmFmtDate(e.date)));
      outsCell(tr, outsUserText('span', 'pfm-fees', String(e.minutes)));
      outsCell(tr, outsUserText('span', 'pfm-fees pfm-muted', outsHours(e.minutes)));
      outsCell(tr, outsUserText('span', 'outs-desc', e.description));
      body.appendChild(tr);
    });
  });
  wrap.appendChild(table);
  box.appendChild(wrap);
  return box;
}

async function issueOutsStatementUi(id) {
  let res;
  try { res = await window.api.issueOutsStatement(id); }
  catch { toast('Could not issue the statement'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not issue the statement'); return; }
  toast('Statement issued — its entries are now locked');
  outsAfterStatementWrite(res.statement);
}
async function setOutsStatementUnpaidUi(id) {
  let res;
  try { res = await window.api.markOutsStatementUnpaid(id); }
  catch { toast('Could not update the statement'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not update the statement'); renderOutsStatementPage(); return; }
  toast('Marked unpaid');
  outsAfterStatementWrite(res.statement);
}
async function cancelOutsStatementUi(id) {
  let res;
  try { res = await window.api.cancelOutsStatement(id); }
  catch { toast('Could not cancel the statement'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not cancel the statement'); renderOutsStatementPage(); return; }
  toast('Statement cancelled — its entries are unlocked');
  outsAfterStatementWrite(res.statement);
}
async function deleteOutsStatementUi(id) {
  let res;
  try { res = await window.api.deleteOutsStatement(id); }
  catch { toast('Could not delete the statement'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not delete the statement'); renderOutsStatementPage(); return; }
  outsStatementRows = null;
  backToOutsResource('statements');
  toast('Statement deleted', {
    actionLabel: 'Undo', duration: 5000,
    onAction: async () => {
      const restored = await window.api.restoreOutsStatement(id).catch(() => null);
      toast(restored?.ok ? 'Statement restored' : (restored?.error || 'Could not restore the statement'));
      if (restored?.ok && outsView === 'resource') { outsStatementRows = null; loadOutsTabData(); }
    },
    onExpire: () => window.api.purgeOutsStatement(id).catch(() => {}),
  });
}

// ── Paid modal ──
function openOutsPaidModal() {
  if (!outsCurrentStatement) return;
  document.getElementById('outs-paid-date').value = pfmLocalToday();
  document.getElementById('outs-paid-note').value = '';
  clearErrorsIn('#outs-paid-modal');
  document.getElementById('outs-paid-overlay').classList.add('open');
  setTimeout(() => document.getElementById('outs-paid-date').focus(), 80);
}
function closeOutsPaidModal() { document.getElementById('outs-paid-overlay').classList.remove('open'); }
function outsPaidOverlayClick(e) {
  if (e.target === document.getElementById('outs-paid-overlay')) closeOutsPaidModal();
}
async function submitOutsPaidModal() {
  const s = outsCurrentStatement;
  if (!s) return;
  clearErrorsIn('#outs-paid-modal');
  const paidOn = document.getElementById('outs-paid-date').value;
  if (!paidOn) { markError('outs-paid-date'); return; }
  let res;
  try { res = await window.api.markOutsStatementPaid(s.id, { paidOn, note: document.getElementById('outs-paid-note').value.trim() }); }
  catch { toast('Could not update the statement'); return; }
  if (!res?.ok) {
    const msg = res?.error || 'Could not update the statement';
    if (/date/i.test(msg)) markError('outs-paid-date', msg); else toast(msg);
    return;
  }
  closeOutsPaidModal();
  toast('Marked paid');
  outsAfterStatementWrite(res.statement);
}

// ══ EXPORT (Phase 5) ══
// Whatever is on screen exports as it stands: a statement in any status, or a
// project's entries under the current filter. A missing value — an entry with
// no rate yet — stays an empty cell, and so does the total fee while any line
// is unpriced (a partial sum would read as the full fee). Labels are
// translated here (rptText), because the workbook and the PDF are built
// outside the DOM translation pass.
function outsFileName(...parts) {
  return parts.map(p => String(p || '').replace(/[\\/:*?"<>|]+/g, ' ').trim()).filter(Boolean).join(' ').replace(/\s+/g, '-');
}
async function outsExportDoc() {
  const tr = key => rptText(key);
  const person = outsCurrent?.name || '';
  // The person page: every entry of every project, all dates.
  if (outsView === 'resource' && outsCurrent) {
    let data;
    try { data = await window.api.listOutsEntries(outsCurrent.id, {}); }
    catch { data = null; }
    if (!data?.ok) { toast(data?.error || 'Could not load entries'); return null; }
    const dates = data.entries.map(e => e.date).sort();
    return {
      title: person, sheetName: person, fileBase: outsFileName(person),
      currency: data.currency, entries: data.entries, lines: data.summary.lines, totalMinutes: data.summary.totalMinutes,
      totalMinor: data.summary.missingRate ? null : data.summary.totalMinor,
      info: [
        [tr('Resource'), person],
        [tr('Period'), dates.length ? dates[0] + ' → ' + dates[dates.length - 1] : ''],
      ],
    };
  }
  if (outsView === 'statement' && outsCurrentStatement) {
    const s = outsCurrentStatement;
    return {
      title: tr('Statement') + ' ' + s.reference, sheetName: s.reference, fileBase: outsFileName(s.reference, person),
      currency: s.currency, entries: s.entries, lines: s.lines, totalMinutes: s.totalMinutes,
      totalMinor: s.lines.some(l => l.amountMinor == null) ? null : s.totalMinor,
      info: [
        [tr('Resource'), person],
        [tr('Period'), s.periodFrom + ' → ' + s.periodTo],
        [tr('Status'), tr(OUTS_STATUS_LABEL[s.status] || s.status)],
      ].concat(s.issuedAt ? [[tr('Issued On'), s.issuedAt.slice(0, 10)]] : [])
        .concat(s.paidAt ? [[tr('Paid On'), s.paidAt + (s.paidNote ? ' · ' + s.paidNote : '')]] : []),
    };
  }
  const p = outsCurrentProject;
  const data = outsEntryData;
  if (outsView !== 'project' || !p || !data || data.projectId !== p.id) return null;
  const { from, to } = outsPeriodRange();
  const dates = data.entries.map(e => e.date).sort();
  const period = (from || dates[0] || '') + ' → ' + (to || dates[dates.length - 1] || '');
  return {
    title: p.name, sheetName: p.name, fileBase: outsFileName(p.name, person),
    currency: data.currency, entries: data.entries, lines: data.summary.lines, totalMinutes: data.summary.totalMinutes,
    totalMinor: data.summary.missingRate ? null : data.summary.totalMinor,
    info: [
      [tr('Resource'), person],
      [tr('Project'), p.name],
      [tr('Period'), dates.length || from || to ? period : ''],
    ].concat(outsEntryFilter.unbilled ? [[tr('Filters'), tr('Not on a statement')]] : []),
  };
}
async function exportOutsExcel() {
  const d = await outsExportDoc();
  if (!d) return;
  const tr = key => rptText(key);
  const data = {
    title: d.title, sheetName: d.sheetName, rtl: rptDirection() === 'rtl', currency: d.currency,
    info: d.info.concat([[tr('Currency'), d.currency]]),
    headers: { day: tr('Day'), date: tr('Date'), minutes: tr('Minutes'), hours: tr('Hours'), description: tr('Description'), project: tr('Project') },
    groups: outsGroupByProject(d.entries).map(g => ({
      project: g.project,
      subtotalLabel: tr('Subtotal') + ' — ' + g.project,
      rows: g.entries.map(e => ({ day: tr(outsWeekday(e.date)), date: e.date, minutes: e.minutes, description: e.description })),
    })),
    totalLabel: tr('Total'),
    lineHeaders: { project: tr('Project'), hours: tr('Hours'), rate: tr('Rate / Hour'), amount: tr('Amount') },
    lines: d.lines.map(l => ({
      project: l.project, hours: Number(outsHours(l.minutes)),
      rate: l.rateMinor == null ? null : l.rateMinor / 100, amount: l.amountMinor == null ? null : l.amountMinor / 100,
    })),
    amountLabel: tr('Total Fee'),
    totalAmount: d.totalMinor == null ? null : d.totalMinor / 100,
  };
  let res;
  try { res = await window.api.exportOutsStatementExcel(data, d.fileBase + '.xlsx'); }
  catch { res = { ok: false, error: 'failed' }; }
  if (res?.ok) toast('Excel saved');
  else if (res?.error) toast('Excel failed: ' + res.error);
}

function buildOutsExportHtml(d) {
  const tr = key => esc(rptText(key));
  const money = minor => (minor == null ? '' : esc(outsMoney(minor, d.currency)));
  const rows = outsGroupByProject(d.entries).map(g => {
    const minutes = g.entries.reduce((n, e) => n + e.minutes, 0);
    return `<tr class="ost-group"><td colspan="5">${esc(g.project)}</td></tr>`
      + g.entries.map(e => `<tr><td>${tr(outsWeekday(e.date))}</td><td>${esc(e.date)}</td><td class="num">${e.minutes}</td>`
        + `<td class="num">${outsHours(e.minutes)}</td><td>${esc(e.description)}</td></tr>`).join('')
      + `<tr class="ost-sub"><td colspan="2">${tr('Subtotal')} — ${esc(g.project)}</td><td class="num">${minutes}</td>`
      + `<td class="num">${outsHours(minutes)}</td><td></td></tr>`;
  }).join('');
  const lines = d.lines.map(l => `<tr><td>${esc(l.project)}</td><td class="num">${outsHours(l.minutes)}</td>`
    + `<td class="num">${money(l.rateMinor)}</td><td class="num">${money(l.amountMinor)}</td></tr>`).join('');
  const meta = d.info.map(([k, v]) => [esc(k), esc(v)]);
  return `<style>
      .ost-head { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #111; padding-bottom:10px; margin-bottom:18px; }
      .ost-title { font-size:22px; font-weight:800; }
      .ost-meta { font-size:11.5px; line-height:1.6; }
      .ost-meta b { display:inline-block; min-width:80px; }
      .ost-h2 { font-size:13px; font-weight:800; margin:20px 0 8px; }
      .rpt-table td.num { text-align:end; font-variant-numeric:tabular-nums; white-space:nowrap; }
      .ost-group td { background:#f6f6f6; font-weight:700; }
      .ost-sub td { font-weight:700; border-top:1.5px solid #111; }
      .ost-total { margin-top:14px; text-align:end; font-size:15px; font-weight:800; }
      html[dir="rtl"] .rpt-table td.num, html[dir="rtl"] .ost-total { text-align:right; }
      .rpt-table td.num { direction:ltr; unicode-bidi:isolate; }
    </style>
    <div class="ost-head"><div class="ost-title">${esc(d.title)}</div>
      <div class="ost-meta">${meta.map(([k, v]) => `<div><b>${k}</b> ${v}</div>`).join('')}</div></div>
    <div class="ost-h2">${tr('By Project & Rate')}</div>
    <table class="rpt-table"><thead><tr><th>${tr('Project')}</th><th>${tr('Hours')}</th><th>${tr('Rate / Hour')}</th><th>${tr('Amount')}</th></tr></thead>
      <tbody>${lines}</tbody>
      <tfoot><tr class="rpt-totals"><td>${tr('Total')}</td><td class="num">${outsHours(d.totalMinutes)}</td><td></td><td class="num">${money(d.totalMinor)}</td></tr></tfoot></table>
    <div class="ost-h2">${tr('Entries')}</div>
    <table class="rpt-table"><thead><tr><th>${tr('Day')}</th><th>${tr('Date')}</th><th>${tr('Minutes')}</th><th>${tr('Hours')}</th><th>${tr('Description')}</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="ost-total">${tr('Total Fee')}: ${money(d.totalMinor)}</div>`;
}
async function exportOutsPdf() {
  const d = await outsExportDoc();
  if (!d) return;
  let res;
  try { res = await window.api.exportPDF(buildReportDoc(buildOutsExportHtml(d), d.title), d.fileBase + '.pdf'); }
  catch { res = { ok: false, error: 'failed' }; }
  if (res?.ok) toast('PDF saved');
  else if (res?.error) toast('PDF failed: ' + res.error);
}

// ── History (loaded when opened) ──
function buildOutsHistorySection(r) {
  const details = document.createElement('details');
  details.className = 'pj-section pfm-history';
  const summary = document.createElement('summary');
  summary.className = 'pj-section-title';
  summary.innerHTML = ic('rotate-ccw');
  summary.appendChild(document.createTextNode('History'));
  details.appendChild(summary);
  const list = pjMk('div', 'pfm-history-list');
  details.appendChild(list);
  details.addEventListener('toggle', async () => {
    if (!details.open) return;
    showSkeleton(list, 'text', 3);
    let rows;
    try { rows = await window.api.getOutsHistory(r.id); }
    catch { list.innerHTML = ''; toast('Could not load the history'); return; }
    list.innerHTML = '';
    if (!rows?.length) { list.appendChild(pjMk('div', 'pfm-muted', 'No changes recorded yet')); return; }
    rows.forEach(h => {
      const row = pjMk('div', 'pfm-history-row');
      row.appendChild(pjMk('span', 'pfm-muted pfm-history-when', new Date(h.changedAt).toLocaleString()));
      row.appendChild(outsUserText('span', 'pfm-history-field', h.field));
      const change = pjMk('span', 'pfm-history-change');
      if (h.oldValue) { change.appendChild(outsUserText('span', 'pfm-history-old', h.oldValue)); change.appendChild(pjMk('span', 'pfm-muted', '→')); }
      change.appendChild(outsUserText('span', '', h.newValue || '—'));
      row.appendChild(change);
      row.appendChild(outsUserText('span', 'pfm-muted', h.changedBy || ''));
      list.appendChild(row);
    });
  });
  return details;
}

// ══ ACTIVE / DELETE ══
async function setOutsActiveUi(id, active) {
  let res;
  try { res = await window.api.setOutsResourceActive(id, active); }
  catch { toast('Could not update the resource'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not update the resource'); return; }
  toast(active ? 'Resource activated' : 'Resource deactivated');
  outsAfterWrite(res.resource);
}

// Delete stamps the row; Undo within 5 s clears the stamp (same id, projects,
// rates and entries intact), and only when the window lapses is it purged for
// real. The server refuses a resource with issued statements — deactivate it.
async function deleteOutsResourceUi(id) {
  let res;
  try { res = await window.api.deleteOutsResource(id); }
  catch { toast('Could not delete the resource'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not delete the resource'); if (outsCurrent) renderOutsDetail(); return; }
  if (activeModule === 'outsource') showOutsListView();
  outsAfterWrite(null);
  toast('Resource deleted', {
    actionLabel: 'Undo', duration: 5000,
    onAction: async () => {
      const restored = await window.api.restoreOutsResource(id).catch(() => null);
      toast(restored?.ok ? 'Restored' : (restored?.error || 'Could not restore the resource'));
      if (restored?.ok) outsAfterWrite(restored.resource);
    },
    onExpire: () => window.api.purgeOutsResource(id).catch(() => {}),
  });
}
