// ══ PROJECT & FINANCE — Offers & CRs ═════════════════════════════════════════
// One list of Offers and Change Requests (private to this login), each with a
// user-typed Reference ID, a status that walks the PFM_STATUS catalog, and one
// who/when stage per status. The list loads once with archived rows included
// and filters client-side, so the status chips always show honest counts for
// whatever the other filters leave.
//
// Status logic compares CODES only (ACCEPTED / REJECTED are final); the order
// of the stage track is the catalog's own order, so a status the user adds in
// Settings (e.g. "On Hold") simply appears in it.
let pfmItems = [];
let pfmLoaded = false;
let pfmCurrent = null;            // the item open in the detail view, or null
let pfmMemberNames = [];
const pfmFilter = { status: '', kind: '', companyId: '', search: '', archived: false };
let pfmModalEditId = null;        // null = create mode
let pfmStageCtx = null;           // { mode: 'move' | 'edit', status }
let pfmVersionEditId = null;      // null = new version
let pfmFileErrors = new Map();    // versionId → [{ name, error }] from the last "Add files"
let _pfmSaveTimer = null;

const PFM_FINAL = new Set(['ACCEPTED', 'REJECTED']);

function initPfmModule() {
  showPfmListView();
  loadPfmList();
  loadPfmMemberNames();
}

// ── Small helpers ──
function pfmKindLabel(kind) { return kind === 'CR' ? 'CR' : 'Offer'; }
function pfmStatusOptions() { return lkOptions('PFM_STATUS'); }
function pfmStatusName(code) { return lkLabel('PFM_STATUS', code) || code || ''; }
function pfmStatusPill(code) {
  const pill = pjMk('span', 'pfm-status pfm-status-' + String(code || 'NONE').toLowerCase(), pfmStatusName(code));
  pill.dataset.userContent = '';
  return pill;
}
function pfmFmtDate(value) {
  if (!value) return '';
  const d = new Date(value.length === 10 ? value + 'T00:00:00' : value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}
function pfmFees(version) {
  if (!version || version.feesMinor == null) return '';
  const unit = version.currency ? (CURRENCY_SYMBOLS[version.currency] || lkLabel('CURRENCY', version.currency)) : '';
  return anMoney(version.feesMinor) + (unit ? ' ' + unit : '');
}
function pfmUserText(tag, cls, text) {
  const el = pjMk(tag, cls, text);
  el.dataset.userContent = '';
  return el;
}
function pfmLocalToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadPfmMemberNames() {
  try { pfmMemberNames = await window.api.listPfmMemberNames(); }
  catch { pfmMemberNames = []; }
  const list = document.getElementById('pfm-member-names');
  if (!list) return;
  list.innerHTML = '';
  (pfmMemberNames || []).forEach(name => {
    const o = document.createElement('option');
    o.value = name;
    list.appendChild(o);
  });
}

// ══ LIST VIEW ══
function showPfmListView() {
  pfmCurrent = null;
  document.getElementById('pfm-list-view').style.display = '';
  document.getElementById('pfm-detail-view').style.display = 'none';
  document.getElementById('pfm-topbar-actions').style.display = '';
}
function showPfmDetailView() {
  document.getElementById('pfm-list-view').style.display = 'none';
  document.getElementById('pfm-detail-view').style.display = '';
  document.getElementById('pfm-topbar-actions').style.display = 'none';
}

async function loadPfmList() {
  const body = document.getElementById('pfm-tbody');
  if (!pfmLoaded && body) showTableSkeleton(body, 8, 3);
  let list;
  try { list = await window.api.listPfmItems({ includeArchived: true }); }
  catch { toast('Could not load offers and CRs'); return; }
  pfmItems = Array.isArray(list) ? list : [];
  pfmLoaded = true;
  renderPfmList();
}

function applyPfmSearch() {
  pfmFilter.search = (document.getElementById('pfm-search').value || '').toLowerCase().trim();
  renderPfmList();
}
function setPfmKind(kind) {
  pfmFilter.kind = kind || '';
  document.querySelectorAll('#pfm-kind-ctl .seg-btn').forEach(b => {
    const active = (b.dataset.kind || '') === pfmFilter.kind;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderPfmList();
}
function setPfmClientFilter() {
  pfmFilter.companyId = document.getElementById('pfm-client-filter').value || '';
  renderPfmList();
}
function setPfmStatusFilter(code) {
  pfmFilter.status = pfmFilter.status === code ? '' : (code || '');
  renderPfmList();
}
function togglePfmArchived() {
  pfmFilter.archived = !pfmFilter.archived;
  const btn = document.getElementById('pfm-archived-btn');
  btn.classList.toggle('active', pfmFilter.archived);
  btn.setAttribute('aria-pressed', pfmFilter.archived ? 'true' : 'false');
  renderPfmList();
}

// Every filter except status — the chips count within this set.
function pfmBaseRows() {
  return pfmItems.filter(i =>
    (pfmFilter.archived || !i.archived)
    && (!pfmFilter.kind || i.kind === pfmFilter.kind)
    && (!pfmFilter.companyId || String(i.companyId) === pfmFilter.companyId)
    && textMatch([i.reference, i.title, lkLabelById('COMPANY', i.companyId) || i.company, i.contactName, i.currentMember],
      pfmFilter.search));
}

function renderPfmClientFilter() {
  const sel = document.getElementById('pfm-client-filter');
  const ids = [...new Set(pfmItems.map(i => i.companyId))];
  if (pfmFilter.companyId && !ids.includes(Number(pfmFilter.companyId))) pfmFilter.companyId = '';
  sel.innerHTML = '';
  const all = document.createElement('option');
  all.value = ''; all.textContent = 'All clients';
  sel.appendChild(all);
  ids.map(id => ({ id, name: lkLabelById('COMPANY', id) || pfmItems.find(i => i.companyId === id)?.company || '' }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(({ id, name }) => {
      const o = document.createElement('option');
      o.dataset.userContent = ''; o.value = String(id); o.textContent = name;
      sel.appendChild(o);
    });
  sel.value = pfmFilter.companyId;
}

function renderPfmStatusChips(base) {
  const host = document.getElementById('pfm-status-chips');
  host.innerHTML = '';
  const mkChip = (code, labelNode, n) => {
    const b = pjMk('button', 'pfm-chip' + (pfmFilter.status === code ? ' active' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', pfmFilter.status === code ? 'true' : 'false');
    b.appendChild(labelNode);
    b.appendChild(pjMk('span', 'pfm-chip-count', String(n)));
    b.addEventListener('click', () => setPfmStatusFilter(code));
    host.appendChild(b);
  };
  mkChip('', pjMk('span', '', 'All'), base.length);
  const codes = pfmStatusOptions().map(o => o.code);
  // A row can sit on a status that was later soft-disabled; it still gets a chip.
  base.forEach(i => { if (i.status && !codes.includes(i.status)) codes.push(i.status); });
  codes.forEach(code => mkChip(code, pfmUserText('span', '', pfmStatusName(code)), base.filter(i => i.status === code).length));
}

// Exactly the rows the table shows (every filter, status chip included).
function pfmVisibleRows(base = pfmBaseRows()) {
  return pfmFilter.status ? base.filter(i => i.status === pfmFilter.status) : base;
}

function renderPfmList() {
  if (!pfmLoaded) return;
  renderPfmClientFilter();
  const base = pfmBaseRows();
  renderPfmStatusChips(base);
  const rows = pfmVisibleRows(base);
  const exportBtn = document.getElementById('pfm-export-btn');
  if (exportBtn) exportBtn.disabled = !rows.length;

  const table = document.getElementById('pfm-table');
  const body = document.getElementById('pfm-tbody');
  const empty = document.getElementById('pfm-empty-state');
  body.innerHTML = '';
  if (!rows.length) {
    table.style.display = 'none';
    empty.hidden = false;
    const p = empty.querySelector('p');
    if (!pfmItems.length) p.innerHTML = 'No offers or CRs yet — click <strong>+ New Offer</strong> to add one';
    else p.textContent = 'Nothing matches these filters';
    return;
  }
  table.style.display = '';
  empty.hidden = true;
  rows.forEach(i => body.appendChild(buildPfmRow(i)));
}

function buildPfmRow(i) {
  const tr = pjMk('tr', 'pfm-row' + (i.archived ? ' archived' : ''));
  tr.tabIndex = 0;
  tr.dataset.pfmId = i.id;
  tr.addEventListener('click', () => openPfmDetail(i.id));
  tr.addEventListener('keydown', e => { if (e.key === 'Enter') openPfmDetail(i.id); });
  const td = child => { const cell = document.createElement('td'); if (child) cell.appendChild(child); tr.appendChild(cell); return cell; };

  const ref = td(pfmUserText('span', 'pfm-ref', i.reference));
  if (i.archived) ref.appendChild(pjMk('span', 'pfm-archived-tag', 'Archived'));
  td(pfmUserText('span', 'pfm-cell-title', i.title));
  td(pfmUserText('span', '', lkLabelById('COMPANY', i.companyId) || i.company));
  td(pjMk('span', 'pfm-kind pfm-kind-' + i.kind.toLowerCase(), pfmKindLabel(i.kind)));
  td(pfmStatusPill(i.status));
  td(pfmUserText('span', 'pfm-fees', pfmFees(i.currentVersion)));
  td(pfmUserText('span', '', i.currentMember || ''));
  td(pjMk('span', 'pfm-muted', pfmFmtDate(i.updatedAt)));
  return tr;
}

// ── Excel export of the current view (plan E8) ──
// Labels are translated here (rptText), because the workbook is built in the
// main process where the DOM translation pass never runs.
async function exportPfmExcel() {
  if (!pfmLoaded) return;
  const rows = pfmVisibleRows();
  if (!rows.length) { toast('Nothing to export'); return; }
  const tr = key => rptText(key);
  const filters = [];
  if (pfmFilter.kind) filters.push(tr(pfmFilter.kind === 'CR' ? 'CRs' : 'Offers'));
  if (pfmFilter.status) filters.push(pfmStatusName(pfmFilter.status));
  if (pfmFilter.companyId) filters.push(lkLabelById('COMPANY', Number(pfmFilter.companyId)) || '');
  if (pfmFilter.search) filters.push('"' + pfmFilter.search + '"');
  if (pfmFilter.archived) filters.push(tr('Including archived'));
  const data = {
    title: tr('Offers & CRs'),
    sheetName: tr('Offers & CRs'),
    filtersLabel: tr('Filters'),
    filters: filters.filter(Boolean).join(' · ') || tr('All'),
    rtl: rptDirection() === 'rtl',
    headers: {
      reference: tr('Reference'), kind: tr('Type'), title: tr('Title'), client: tr('Client'),
      status: tr('Status'), fees: tr('Fees'), currency: tr('Currency'), version: tr('Version'),
      person: tr('Person'), validUntil: tr('Valid until'), updated: tr('Updated'),
    },
    rows: rows.map(i => ({
      reference: i.reference, kind: tr(pfmKindLabel(i.kind)), title: i.title,
      client: lkLabelById('COMPANY', i.companyId) || i.company || '', status: pfmStatusName(i.status),
      fees: i.currentVersion?.feesMinor == null ? null : i.currentVersion.feesMinor / 100,
      currency: i.currentVersion?.currency || '', version: i.currentVersion?.label || '',
      person: i.currentMember || '', validUntil: i.validUntil || '', updated: String(i.updatedAt || '').slice(0, 10),
    })),
  };
  let res;
  try { res = await window.api.exportPfmExcel(data, 'offers-and-crs-' + pfmLocalToday() + '.xlsx'); }
  catch { res = { ok: false, error: 'failed' }; }
  if (res?.ok) toast('Excel saved');
  else if (res?.error) toast('Excel failed: ' + res.error);
}

// ══ CREATE / EDIT MODAL ══
function populatePfmCompanySelect(currentId) {
  const sel = document.getElementById('pfm-company');
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = ''; none.textContent = 'Choose a client…';
  sel.appendChild(none);
  const opts = lkOptions('COMPANY');
  // Keep an archived client selectable on an item that already points at it.
  if (currentId && !opts.some(o => Number(o.id) === Number(currentId))) {
    const kept = (LK.categories.COMPANY || []).find(o => Number(o.id) === Number(currentId));
    if (kept) opts.unshift(kept);
  }
  opts.forEach(opt => {
    const o = document.createElement('option');
    o.dataset.userContent = ''; o.value = String(opt.id); o.textContent = companyDisplayName(opt);
    sel.appendChild(o);
  });
  sel.value = currentId ? String(currentId) : '';
}

// `preset` on create: { kind, companyId } (the client tab passes its client).
function openPfmModal(item, preset = {}) {
  pfmModalEditId = item ? item.id : null;
  const kind = item ? item.kind : (preset.kind || 'OFFER');
  document.getElementById('pfm-modal-title').textContent = item ? 'Edit Offer / CR' : (kind === 'CR' ? 'New CR' : 'New Offer');
  document.getElementById('pfm-modal-submit').textContent = item ? 'Save Changes' : 'Create';
  document.getElementById('pfm-kind').value = kind;
  document.getElementById('pfm-reference').value = item ? item.reference : '';
  document.getElementById('pfm-title').value = item ? item.title : '';
  document.getElementById('pfm-valid-until').value = item ? (item.validUntil || '') : '';
  document.getElementById('pfm-first-member').value = '';
  document.getElementById('pfm-first-member-group').hidden = !!item;
  populatePfmCompanySelect(item ? item.companyId : preset.companyId);
  clearErrorsIn('#pfm-modal');
  document.getElementById('pfm-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('pfm-reference').focus(), 80);
}
// The header buttons (delegated handlers take plain arguments only).
function openPfmNew(kind) { openPfmModal(null, { kind }); }
function closePfmModal() {
  document.getElementById('pfm-modal-overlay').classList.remove('open');
  pfmModalEditId = null;
}
function pfmModalOverlayClick(e) {
  if (e.target === document.getElementById('pfm-modal-overlay')) closePfmModal();
}

async function submitPfmModal() {
  clearErrorsIn('#pfm-modal');
  const data = {
    kind: document.getElementById('pfm-kind').value,
    reference: document.getElementById('pfm-reference').value.trim(),
    title: document.getElementById('pfm-title').value.trim(),
    companyId: Number(document.getElementById('pfm-company').value) || null,
    validUntil: document.getElementById('pfm-valid-until').value || '',
  };
  let bad = false;
  if (!data.reference) { markError('pfm-reference'); bad = true; }
  if (!data.title) { markError('pfm-title'); bad = true; }
  if (!data.companyId) { markError('pfm-company'); bad = true; }
  if (bad) return;

  const editing = pfmModalEditId != null;
  if (!editing) data.memberName = document.getElementById('pfm-first-member').value.trim();
  else await pfmBeforeWrite();
  let res;
  try { res = editing ? await window.api.updatePfmItem(pfmModalEditId, data) : await window.api.createPfmItem(data); }
  catch { toast('Could not save the offer or CR'); return; }
  if (!res?.ok) {
    const msg = res?.error || 'Could not save the offer or CR';
    if (/Reference/i.test(msg)) markError('pfm-reference', msg);
    else if (/title/i.test(msg)) markError('pfm-title', msg);
    else if (/client/i.test(msg)) markError('pfm-company', msg);
    else if (/date/i.test(msg)) markError('pfm-valid-until', msg);
    else toast(msg);
    return;
  }
  closePfmModal();
  toast(editing ? 'Changes saved' : (res.item.kind === 'CR' ? 'CR created' : 'Offer created'));
  loadPfmMemberNames();
  pfmAfterWrite(res.item);
  if (!editing && activeModule === 'pfm') openPfmDetail(res.item.id);
}

// Keep the list, the open detail view and the client tab in step with a write.
function pfmAfterWrite(item) {
  pfmLoaded = false;
  clientPfmFor = null;
  if (item && pfmCurrent && pfmCurrent.id === item.id) { pfmCurrent = item; renderPfmDetail(); }
  if (activeModule === 'pfm' && !pfmCurrent) loadPfmList();
  if (activeModule === 'clients' && currentClient) loadClientPfmRows(currentClient.id);
}

// ══ CLIENT DETAIL TAB — "Offers & CRs" (plan D4) ══
// The client page's own getClient() payload doesn't carry these (they are
// private per login and live in their own module), so the tab fetches its
// rows once per client open and after every Project & Finance write.
let clientPfmRows = [];
let clientPfmFor = null;          // company id clientPfmRows belongs to, or null = stale

async function loadClientPfmRows(companyId) {
  let rows;
  try { rows = await window.api.listPfmItems({ companyId }); }
  catch { rows = []; }
  if (!currentClient || currentClient.id !== companyId) return;
  clientPfmRows = Array.isArray(rows) ? rows : [];
  clientPfmFor = companyId;
  updateClientDetailTabCounts();
  const overviewCount = document.querySelector('#client-detail-sections [data-overview-count="pfm"]');
  if (overviewCount) overviewCount.textContent = String(clientPfmRows.length);
  if (clientDetailTab === 'pfm' || clientDetailSearch) renderClientDetailSections(currentClient);
}
// Called by renderClientDetail: fetch when the rows are for another client or stale.
function ensureClientPfmRows(companyId) {
  if (clientPfmFor !== companyId) loadClientPfmRows(companyId);
}
function clientPfmCount(companyId) {
  return clientPfmFor === companyId ? clientPfmRows.length : 0;
}

function buildClientPfmSection(c, q) {
  const rows = clientPfmFor === c.id ? clientPfmRows : [];
  const section = pjMk('div', 'pj-section');
  const head = pjMk('div', 'pj-section-head');
  const title = pjMk('div', 'pj-section-title');
  title.innerHTML = ic('briefcase');
  title.appendChild(document.createTextNode('Offers & CRs (' + rows.length + ')'));
  head.appendChild(title);
  const acts = pjMk('div', 'pj-section-actions');
  [['CR', 'New CR', ''], ['OFFER', 'New Offer', 'primary']].forEach(([kind, label, emphasis]) => {
    const b = pjMk('button', 'btn' + (emphasis ? ' ' + emphasis : ''));
    b.type = 'button';
    b.innerHTML = ic('plus');
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', () => openPfmModal(null, { kind, companyId: c.id }));
    acts.appendChild(b);
  });
  head.appendChild(acts);
  section.appendChild(head);

  const shown = rows.filter(i => textMatch([i.reference, i.title, i.contactName, i.currentMember, pfmStatusName(i.status)], q));
  if (clientPfmFor !== c.id) {
    const loading = pjMk('div');
    section.appendChild(loading);
    showSkeleton(loading, 'text', 2);
    return section;
  }
  if (!rows.length) { section.appendChild(pjMk('div', 'cp-records-empty', 'No offers or CRs for this client yet.')); return section; }
  if (!shown.length) { section.appendChild(pjMk('div', 'cp-records-empty', 'No offers or CRs match your search.')); return section; }
  const wrap = pjMk('div', 'pfm-table-wrap');
  const table = pjMk('table', 'pfm-table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  ['Reference', 'Title', 'Client', 'Type', 'Status', 'Current Fees', 'Person', 'Updated']
    .forEach(label => hr.appendChild(pjMk('th', '', label)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const body = document.createElement('tbody');
  shown.forEach(i => body.appendChild(buildPfmRow(i)));
  table.appendChild(body);
  wrap.appendChild(table);
  section.appendChild(wrap);
  return section;
}

// ══ DETAIL VIEW ══
async function openPfmDetail(id) {
  let item;
  try { item = await window.api.getPfmItem(id); }
  catch { toast('Could not open this offer or CR'); return; }
  if (!item) { toast('This offer or CR no longer exists'); loadPfmList(); return; }
  if (activeModule !== 'pfm') switchModule('pfm');
  if (pfmCurrent?.id !== item.id) pfmFileErrors = new Map();
  pfmCurrent = item;
  showPfmDetailView();
  renderPfmDetail();
  document.getElementById('pfm-detail-view').scrollTop = 0;
}
function backToPfmList() {
  flushPfmPending();
  showPfmListView();
  loadPfmList();
}

// Statuses the "Move to" buttons offer: the next one in catalog order — or,
// when the next one is final, every final status after the current one
// (Sent → Accepted | Rejected). Nothing once the item is final.
function pfmNextStatuses(current) {
  const codes = pfmStatusOptions().map(o => o.code);
  if (PFM_FINAL.has(current)) return [];
  const after = codes.slice(codes.indexOf(current) + 1);
  if (!after.length) return [];
  return PFM_FINAL.has(after[0]) ? after.filter(c => PFM_FINAL.has(c)) : [after[0]];
}

function renderPfmDetail() {
  const item = pfmCurrent;
  const host = document.getElementById('pfm-detail-view');
  if (!item || !host) return;
  host.innerHTML = '';

  const crumbs = pjMk('div', 'pj-crumbs');
  const root = pjMk('button', 'pj-crumb-link', 'Project & Finance');
  root.addEventListener('click', backToPfmList);
  crumbs.appendChild(root);
  const sep = pjMk('span', 'pj-crumb-sep');
  sep.innerHTML = ic('chevron-right');
  crumbs.appendChild(sep);
  crumbs.appendChild(pfmUserText('span', 'pj-crumb-here', item.reference));
  host.appendChild(crumbs);

  // Header: reference, badges, title · client, and the actions.
  const head = pjMk('div', 'pj-detail-head');
  const ident = pjMk('div', 'pfm-ident');
  const titleRow = pjMk('div', 'pj-detail-title');
  titleRow.appendChild(pfmUserText('span', 'pfm-detail-ref', item.reference));
  titleRow.appendChild(pjMk('span', 'pfm-kind pfm-kind-' + item.kind.toLowerCase(), pfmKindLabel(item.kind)));
  titleRow.appendChild(pfmStatusPill(item.status));
  if (item.archived) titleRow.appendChild(pjMk('span', 'pfm-archived-tag', 'Archived'));
  ident.appendChild(titleRow);
  const sub = pjMk('div', 'pfm-detail-sub');
  sub.appendChild(pfmUserText('span', '', item.title));
  sub.appendChild(pjMk('span', 'pfm-dot', '·'));
  sub.appendChild(pfmUserText('span', '', lkLabelById('COMPANY', item.companyId) || item.company));
  const fees = pfmFees(item.currentVersion);
  if (fees) { sub.appendChild(pjMk('span', 'pfm-dot', '·')); sub.appendChild(pfmUserText('span', 'pfm-fees', fees)); }
  ident.appendChild(sub);
  head.appendChild(ident);

  const actions = pjMk('div', 'pj-detail-actions pfm-detail-actions');
  pfmNextStatuses(item.status).forEach(code => {
    const b = pjMk('button', 'btn primary pfm-move-btn');
    b.type = 'button';
    b.innerHTML = ic('arrow-right');
    b.appendChild(pjMk('span', '', 'Move to'));
    b.appendChild(pfmUserText('span', '', pfmStatusName(code)));
    b.addEventListener('click', () => openPfmStageModal('move', code));
    actions.appendChild(b);
  });
  const others = pfmStatusOptions().filter(o => o.code !== item.status && !pfmNextStatuses(item.status).includes(o.code));
  if (others.length) {
    const sel = document.createElement('select');
    sel.className = 'pfm-other-status';
    sel.setAttribute('aria-label', 'Change status');
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = 'Change status…';
    sel.appendChild(ph);
    others.forEach(o => {
      const opt = document.createElement('option');
      opt.dataset.userContent = ''; opt.value = o.code; opt.textContent = lookupDisplayName(o);
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => { if (sel.value) openPfmStageModal('move', sel.value); sel.value = ''; });
    actions.appendChild(sel);
  }
  const mkBtn = (iconName, label, fn, cls = '') => {
    const b = pjMk('button', 'btn' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.innerHTML = ic(iconName);
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', fn);
    actions.appendChild(b);
    return b;
  };
  mkBtn('pencil', 'Edit', () => openPfmModal(item));
  mkBtn(item.archived ? 'rotate-ccw' : 'folder', item.archived ? 'Unarchive' : 'Archive', () => setPfmArchivedUi(item.id, !item.archived));
  const delHost = pjMk('span', 'pfm-del-host');
  actions.appendChild(delHost);
  const renderDel = () => {
    delHost.innerHTML = '';
    const b = pjMk('button', 'btn del-action');
    b.type = 'button';
    b.innerHTML = ic('trash-2');
    b.appendChild(document.createTextNode('Delete'));
    b.addEventListener('click', () => showDeleteConfirm(delHost, () => deletePfmItemUi(item.id), renderDel));
    delHost.appendChild(b);
  };
  renderDel();
  head.appendChild(actions);
  host.appendChild(head);

  host.appendChild(buildPfmStageTrack(item));
  host.appendChild(buildPfmContactSection(item));
  host.appendChild(buildPfmVersionsSection(item));
  host.appendChild(buildPfmHistorySection(item));
}

// ── Stage track ──
function buildPfmStageTrack(item) {
  const section = pjMk('div', 'pj-section');
  const sh = pjMk('div', 'pj-section-head');
  const st = pjMk('div', 'pj-section-title');
  st.innerHTML = ic('flag');
  st.appendChild(document.createTextNode('Stages'));
  sh.appendChild(st);
  section.appendChild(sh);

  const byStatus = new Map((item.stages || []).map(s => [s.status, s]));
  const codes = pfmStatusOptions().map(o => o.code);
  (item.stages || []).forEach(s => { if (!codes.includes(s.status)) codes.push(s.status); });
  const currentIdx = codes.indexOf(item.status);

  const track = pjMk('ol', 'pfm-track');
  codes.forEach((code, idx) => {
    const stage = byStatus.get(code);
    let state = 'todo';
    if (code === item.status) state = 'current';
    else if (stage?.doneOn) state = 'done';
    else if (stage) state = 'planned';
    // A final status the item did not end on is an alternative, not a skipped step.
    const other = PFM_FINAL.has(code) && PFM_FINAL.has(item.status) && code !== item.status && !stage;
    const li = pjMk('li', 'pfm-step pfm-step-' + state + (other ? ' pfm-step-other' : '') + (idx < currentIdx ? ' pfm-step-before' : ''));
    const btn = pjMk('button', 'pfm-step-btn');
    btn.type = 'button';
    btn.title = 'Edit this stage';
    btn.addEventListener('click', () => openPfmStageModal('edit', code));
    btn.appendChild(pjMk('span', 'pfm-step-dot'));
    btn.appendChild(pfmUserText('span', 'pfm-step-name', pfmStatusName(code)));
    if (stage?.memberName) {
      const who = pjMk('span', 'pfm-step-who');
      if (!stage.doneOn) who.appendChild(pjMk('span', 'pfm-muted', 'Planned:'));
      who.appendChild(pfmUserText('span', '', stage.memberName));
      btn.appendChild(who);
    }
    if (stage?.doneOn) btn.appendChild(pjMk('span', 'pfm-step-date', pfmFmtDate(stage.doneOn)));
    if (stage?.note) btn.appendChild(pfmUserText('span', 'pfm-step-note', stage.note));
    li.appendChild(btn);
    track.appendChild(li);
  });
  section.appendChild(track);
  return section;
}

// ── Client contact + channel (auto-saved) ──
// The channel reference is the email title/subject for Email and the ticket
// URL for Jira — the same split Task Sources use.
const PFM_CHANNEL_REF = {
  EMAIL: { label: 'Email Title / Subject', type: 'text', placeholder: 'e.g. Renewal quote issue' },
  JIRA:  { label: 'Jira URL', type: 'url', placeholder: 'https://' },
};
function buildPfmContactSection(item) {
  const section = pjMk('div', 'pj-section');
  const sh = pjMk('div', 'pj-section-head');
  const st = pjMk('div', 'pj-section-title');
  st.innerHTML = ic('user-plus');
  st.appendChild(document.createTextNode('Client Contact'));
  sh.appendChild(st);
  section.appendChild(sh);

  const grid = pjMk('div', 'pfm-form-grid');
  const field = (id, label, value, type = 'text', full = false) => {
    const g = pjMk('div', 'form-group' + (full ? ' full' : ''));
    const l = pjMk('label', '', label);
    l.htmlFor = id;
    g.appendChild(l);
    const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type;
    input.id = id;
    input.value = value || '';
    input.addEventListener('input', savePfmDetailDebounced);
    g.appendChild(input);
    grid.appendChild(g);
  };
  field('pfm-contact-name', 'Name', item.contactName);

  const cg = pjMk('div', 'form-group');
  const cl = pjMk('label', '', 'Channel');
  cl.htmlFor = 'pfm-channel';
  cg.appendChild(cl);
  const channel = document.createElement('select');
  channel.id = 'pfm-channel';
  [['', '—'], ['EMAIL', 'Email'], ['JIRA', 'Jira']].forEach(([value, label]) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    channel.appendChild(o);
  });
  channel.value = item.channel || '';
  cg.appendChild(channel);
  grid.appendChild(cg);

  const rg = pjMk('div', 'form-group');
  const rl = pjMk('label', '');
  rl.htmlFor = 'pfm-channel-ref';
  rg.appendChild(rl);
  const refRow = pjMk('div', 'pfm-channel-ref-row');
  const ref = document.createElement('input');
  ref.id = 'pfm-channel-ref';
  ref.value = item.channelRef || '';
  ref.addEventListener('input', () => { syncOpen(); savePfmDetailDebounced(); });
  refRow.appendChild(ref);
  const open = pjMk('button', 'cd-icon-btn');
  open.type = 'button';
  open.title = 'Open link';
  open.setAttribute('aria-label', 'Open link');
  open.innerHTML = ic('external-link');
  open.addEventListener('click', () => window.api.openExternal(ref.value.trim()));
  refRow.appendChild(open);
  rg.appendChild(refRow);
  grid.appendChild(rg);

  const syncOpen = () => {
    open.hidden = channel.value !== 'JIRA' || !/^https?:\/\/\S+$/i.test(ref.value.trim());
  };
  const syncRef = () => {
    const cfg = PFM_CHANNEL_REF[channel.value];
    rg.hidden = !cfg;
    if (cfg) {
      rl.textContent = cfg.label;
      ref.type = cfg.type;
      ref.placeholder = cfg.placeholder;
    }
    syncOpen();
  };
  channel.addEventListener('change', () => {
    ref.value = '';          // a subject is not a URL, and vice versa
    syncRef();
    savePfmDetailDebounced();
  });
  syncRef();
  section.appendChild(grid);

  const meta = pjMk('div', 'pfm-meta');
  const metaItem = (label, value) => {
    if (!value) return;
    const m = pjMk('span', 'pfm-meta-item');
    m.appendChild(pjMk('span', 'pfm-muted', label));
    m.appendChild(pjMk('span', '', value));
    meta.appendChild(m);
  };
  metaItem('Valid until', pfmFmtDate(item.validUntil));
  metaItem('Created', pfmFmtDate(item.createdAt));
  metaItem('Updated', pfmFmtDate(item.updatedAt));
  section.appendChild(meta);
  return section;
}

function savePfmDetailDebounced() {
  clearTimeout(_pfmSaveTimer);
  _pfmSaveTimer = setTimeout(() => { _pfmSaveTimer = null; savePfmDetailFields(); }, 300);
}
// Sends only the fields that differ from the loaded item. Does not re-render,
// so the field being typed in keeps its focus and caret.
async function savePfmDetailFields() {
  const item = pfmCurrent;
  const read = id => document.getElementById(id)?.value;
  if (!item || read('pfm-contact-name') == null) return;
  const next = {
    contactName: read('pfm-contact-name').trim(), channel: read('pfm-channel'),
    channelRef: read('pfm-channel') ? read('pfm-channel-ref').trim() : '',
  };
  const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== (item[k] || '')));
  if (!Object.keys(changed).length) return;
  let res;
  try { res = await window.api.updatePfmItem(item.id, changed); }
  catch { toast('Could not save the offer or CR'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not save the offer or CR'); return; }
  if (pfmCurrent && pfmCurrent.id === res.item.id) pfmCurrent = res.item;
  pfmLoaded = false;
}
// Called by flushPending() on close/logout, and when leaving the detail view.
function flushPfmPending() {
  if (!_pfmSaveTimer) return Promise.resolve();
  clearTimeout(_pfmSaveTimer);
  _pfmSaveTimer = null;
  return savePfmDetailFields();
}

// A write re-renders the detail from the server's copy of the item, so any
// contact/channel edit still waiting on its debounce is saved first.
async function pfmBeforeWrite() { await flushPfmPending(); }

// ── Versions (newest first; the top one is "Current") + their files ──
function buildPfmVersionsSection(item) {
  const section = pjMk('div', 'pj-section pfm-versions');
  const sh = pjMk('div', 'pj-section-head');
  const st = pjMk('div', 'pj-section-title');
  st.innerHTML = ic('layers');
  st.appendChild(document.createTextNode('Versions'));
  sh.appendChild(st);
  const acts = pjMk('div', 'pj-section-actions');
  const add = pjMk('button', 'btn primary pfm-version-add');
  add.type = 'button';
  add.innerHTML = ic('plus');
  add.appendChild(document.createTextNode('New Version'));
  add.addEventListener('click', () => openPfmVersionModal(null));
  acts.appendChild(add);
  sh.appendChild(acts);
  section.appendChild(sh);

  const versions = item.versions || [];
  if (!versions.length) {
    section.appendChild(pjMk('div', 'cp-records-empty', 'No versions yet — add one to record the fees and files.'));
    return section;
  }
  const list = pjMk('div', 'pfm-version-list');
  versions.forEach((v, idx) => list.appendChild(buildPfmVersionCard(v, idx === 0, versions[idx + 1])));
  section.appendChild(list);
  return section;
}

// Plan E6: "−1,500.00 (−12.5%)" against the version just before this one —
// only when both have fees in the same currency; otherwise nothing.
function pfmFeeChange(v, prev) {
  if (!prev || v.feesMinor == null || prev.feesMinor == null || (v.currency || '') !== (prev.currency || '')) return null;
  const delta = v.feesMinor - prev.feesMinor;
  let sign = '±', dir = 'same';
  if (delta > 0) { sign = '+'; dir = 'up'; }
  if (delta < 0) { sign = '−'; dir = 'down'; }
  let text = sign + anMoney(Math.abs(delta));
  if (prev.feesMinor > 0) text += ' (' + sign + (Math.abs(delta) * 100 / prev.feesMinor).toFixed(1).replace(/\.0$/, '') + '%)';
  return { text, dir };
}

function buildPfmVersionCard(v, isCurrent, prev) {
  const card = pjMk('div', 'pfm-version' + (isCurrent ? ' current' : ''));
  card.dataset.versionId = v.id;

  const head = pjMk('div', 'pfm-version-head');
  const ident = pjMk('div', 'pfm-version-ident');
  ident.appendChild(pfmUserText('span', 'pfm-version-label', v.label));
  if (isCurrent) ident.appendChild(pjMk('span', 'pfm-current-tag', 'Current'));
  if (v.date) ident.appendChild(pjMk('span', 'pfm-muted', pfmFmtDate(v.date)));
  head.appendChild(ident);
  const fees = pfmFees(v);
  const change = pfmFeeChange(v, prev);
  if (change) {
    const c = pfmUserText('span', 'pfm-fee-change pfm-fee-' + change.dir, change.text);
    c.title = 'Change from ' + prev.label;
    head.appendChild(c);
  }
  head.appendChild(fees ? pfmUserText('span', 'pfm-version-fees pfm-fees', fees) : pjMk('span', 'pfm-muted', 'No fees'));

  const icons = pjMk('div', 'pfm-version-icons');
  const renderIcons = () => {
    icons.innerHTML = '';
    const edit = pjMk('button', 'cd-icon-btn');
    edit.type = 'button';
    edit.innerHTML = ic('pencil');
    edit.title = 'Edit version';
    edit.setAttribute('aria-label', 'Edit version');
    edit.addEventListener('click', () => openPfmVersionModal(v));
    icons.appendChild(edit);
    const del = pjMk('button', 'cd-icon-btn danger');
    del.type = 'button';
    del.innerHTML = ic('trash-2');
    del.title = 'Delete version';
    del.setAttribute('aria-label', 'Delete version');
    del.addEventListener('click', () => showDeleteConfirm(icons, () => deletePfmVersionUi(v.id), renderIcons));
    icons.appendChild(del);
  };
  renderIcons();
  head.appendChild(icons);
  card.appendChild(head);

  if (v.notes) card.appendChild(pfmUserText('div', 'pfm-version-notes', v.notes));

  const files = pjMk('div', 'pfm-files');
  (v.files || []).forEach(f => files.appendChild(buildPfmFileChip(f)));
  const addFiles = pjMk('button', 'pj-doc-btn pfm-add-files');
  addFiles.type = 'button';
  addFiles.innerHTML = ic('upload');
  addFiles.appendChild(document.createTextNode('Add files'));
  addFiles.addEventListener('click', () => addPfmFilesUi(v.id, addFiles));
  files.appendChild(addFiles);
  card.appendChild(files);

  const errors = pfmFileErrors.get(v.id);
  if (errors?.length) {
    const box = pjMk('div', 'pfm-file-errors');
    box.setAttribute('role', 'alert');
    errors.forEach(e => {
      const row = pjMk('div', 'pfm-file-error');
      row.innerHTML = ic('triangle-alert');
      row.appendChild(pfmUserText('span', 'pfm-file-error-name', e.name));
      row.appendChild(pjMk('span', '', e.error));
      box.appendChild(row);
    });
    card.appendChild(box);
  }
  return card;
}

// One file: click the name to open it; × asks inline, then removes with Undo.
function buildPfmFileChip(f) {
  const chip = pjMk('span', 'pfm-file' + (f.exists ? '' : ' missing'));
  const render = () => {
    chip.innerHTML = '';
    const open = pjMk('button', 'pfm-file-open');
    open.type = 'button';
    open.title = f.exists ? 'Open with default app' : 'File missing from disk';
    open.innerHTML = ic(f.exists ? 'file-text' : 'triangle-alert');
    open.appendChild(pfmUserText('span', 'pfm-file-name', f.originalName || '(file)'));
    open.appendChild(pjMk('span', 'pfm-file-size', fmtFileSize(f.size)));
    open.addEventListener('click', () => openPfmFileUi(f.id));
    chip.appendChild(open);
    const x = pjMk('button', 'pfm-file-x');
    x.type = 'button';
    x.innerHTML = ic('x');
    x.title = 'Remove file';
    x.setAttribute('aria-label', 'Remove file');
    x.addEventListener('click', () => showDeleteConfirm(chip, () => removePfmFileUi(f.id), render, 'Remove?'));
    chip.appendChild(x);
  };
  render();
  return chip;
}

async function openPfmFileUi(fileId) {
  let res;
  try { res = await window.api.openPfmFile(fileId); }
  catch { toast('Could not open file'); return; }
  if (!res?.ok) toast(res?.error || 'Could not open file');
}

// The multi-select dialog runs in the main process; each picked file is
// checked and saved on its own, and the ones that failed are listed on the card.
async function addPfmFilesUi(versionId, btn) {
  await pfmBeforeWrite();
  if (btn) btn.disabled = true;
  let res;
  try { res = await window.api.addPfmFiles(versionId); }
  catch { toast('Could not add files'); if (btn) btn.disabled = false; return; }
  if (btn) btn.disabled = false;
  if (res?.canceled) return;
  const results = res?.results || [];
  const failed = results.filter(r => !r.ok);
  const added = results.length - failed.length;
  if (failed.length) pfmFileErrors.set(versionId, failed.map(r => ({ name: r.name, error: r.error })));
  else pfmFileErrors.delete(versionId);
  if (!results.length) { toast(res?.error || 'Could not add files'); return; }
  if (added) toast(added === 1 ? '1 file added' : `${added} files added`);
  else toast('No files were added');
  if (res.item) pfmAfterWrite(res.item);
}

async function removePfmFileUi(fileId) {
  await pfmBeforeWrite();
  let res;
  try { res = await window.api.removePfmFile(fileId); }
  catch { toast('Could not remove file'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not remove file'); if (pfmCurrent) renderPfmDetail(); return; }
  pfmAfterWrite(res.item);
  toast('File removed', {
    actionLabel: 'Undo', duration: 5000,
    onAction: async () => {
      const restored = await window.api.restorePfmFile(fileId).catch(() => null);
      toast(restored?.ok ? 'File restored' : (restored?.error || 'Could not restore the file'));
      if (restored?.ok) pfmAfterWrite(restored.item);
    },
    onExpire: () => window.api.purgePfmFile(fileId).catch(() => {}),
  });
}

async function deletePfmVersionUi(versionId) {
  await pfmBeforeWrite();
  let res;
  try { res = await window.api.deletePfmVersion(versionId); }
  catch { toast('Could not delete the version'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not delete the version'); if (pfmCurrent) renderPfmDetail(); return; }
  pfmFileErrors.delete(versionId);
  pfmAfterWrite(res.item);
  toast('Version deleted', {
    actionLabel: 'Undo', duration: 5000,
    onAction: async () => {
      const restored = await window.api.restorePfmVersion(versionId).catch(() => null);
      toast(restored?.ok ? 'Version restored' : (restored?.error || 'Could not restore the version'));
      if (restored?.ok) pfmAfterWrite(restored.item);
    },
    onExpire: () => window.api.purgePfmVersion(versionId).catch(() => {}),
  });
}

// ══ VERSION MODAL ══
// "12,500.50", "12500" or Arabic-Indic "١٢٥٠٠٫٥" → minor units; '' → null
// (no fees yet). Returns undefined when the text is not an amount.
function pfmParseFees(text) {
  const s = String(text || '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/٫/g, '.').replace(/[,٬\s]/g, '');
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  return Math.round(Number(s) * 100);
}

function openPfmVersionModal(v) {
  const item = pfmCurrent;
  if (!item) return;
  pfmVersionEditId = v ? v.id : null;
  const count = (item.versions || []).length;
  document.getElementById('pfm-version-title').textContent = v ? 'Edit Version' : 'New Version';
  document.getElementById('pfm-version-submit').textContent = v ? 'Save Changes' : 'Add Version';
  document.getElementById('pfm-version-label').value = v ? v.label : 'v' + (count + 1);
  document.getElementById('pfm-version-date').value = v ? v.date : pfmLocalToday();
  document.getElementById('pfm-version-fees').value = v && v.feesMinor != null ? minorToStr(v.feesMinor) : '';
  // A new version starts in the current version's currency, else the catalog's first.
  const currency = v ? v.currency : (item.currentVersion?.currency || lkOptions('CURRENCY')[0]?.code || '');
  populateCurrencySelect('pfm-version-currency', currency);
  document.getElementById('pfm-version-notes').value = v ? v.notes : '';
  clearErrorsIn('#pfm-version-modal');
  document.getElementById('pfm-version-overlay').classList.add('open');
  setTimeout(() => {
    const label = document.getElementById('pfm-version-label');
    label.focus();
    label.select();
  }, 80);
}
function closePfmVersionModal() {
  document.getElementById('pfm-version-overlay').classList.remove('open');
  pfmVersionEditId = null;
}
function pfmVersionOverlayClick(e) {
  if (e.target === document.getElementById('pfm-version-overlay')) closePfmVersionModal();
}
async function submitPfmVersionModal() {
  const item = pfmCurrent;
  if (!item) return;
  clearErrorsIn('#pfm-version-modal');
  const label = document.getElementById('pfm-version-label').value.trim();
  const feesMinor = pfmParseFees(document.getElementById('pfm-version-fees').value);
  let bad = false;
  if (!label) { markError('pfm-version-label'); bad = true; }
  if (feesMinor === undefined) { markError('pfm-version-fees', 'Enter the fees as a number, e.g. 12500.00'); bad = true; }
  if (bad) return;
  const data = {
    label, feesMinor,
    currency: document.getElementById('pfm-version-currency').value || '',
    date: document.getElementById('pfm-version-date').value || '',
    notes: document.getElementById('pfm-version-notes').value.trim(),
  };
  await pfmBeforeWrite();
  const editing = pfmVersionEditId != null;
  let res;
  try { res = editing ? await window.api.updatePfmVersion(pfmVersionEditId, data) : await window.api.createPfmVersion(item.id, data); }
  catch { toast('Could not save the version'); return; }
  if (!res?.ok) {
    const msg = res?.error || 'Could not save the version';
    if (/version ID/i.test(msg)) markError('pfm-version-label', msg);
    else if (/fees/i.test(msg)) markError('pfm-version-fees', msg);
    else if (/currency/i.test(msg)) markError('pfm-version-currency', msg);
    else if (/date/i.test(msg)) markError('pfm-version-date', msg);
    else toast(msg);
    return;
  }
  closePfmVersionModal();
  toast(editing ? 'Version saved' : 'Version added');
  pfmAfterWrite(res.item);
}

// ── History (loaded when opened) ──
function buildPfmHistorySection(item) {
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
    try { rows = await window.api.getPfmHistory(item.id); }
    catch { list.innerHTML = ''; toast('Could not load the history'); return; }
    list.innerHTML = '';
    if (!rows?.length) { list.appendChild(pjMk('div', 'pfm-muted', 'No changes recorded yet')); return; }
    rows.forEach(h => {
      const row = pjMk('div', 'pfm-history-row');
      row.appendChild(pjMk('span', 'pfm-muted pfm-history-when', new Date(h.changedAt).toLocaleString()));
      row.appendChild(pfmUserText('span', 'pfm-history-field', h.field));
      const change = pjMk('span', 'pfm-history-change');
      if (h.oldValue) { change.appendChild(pfmUserText('span', 'pfm-history-old', h.oldValue)); change.appendChild(pjMk('span', 'pfm-muted', '→')); }
      change.appendChild(pfmUserText('span', '', h.newValue || '—'));
      row.appendChild(change);
      row.appendChild(pfmUserText('span', 'pfm-muted', h.changedBy || ''));
      list.appendChild(row);
    });
  });
  return details;
}

// ══ STAGE MODAL — "Move to" and "Edit stage" ══
function openPfmStageModal(mode, code) {
  const item = pfmCurrent;
  if (!item) return;
  pfmStageCtx = { mode, status: code };
  const stage = (item.stages || []).find(s => s.status === code);
  document.getElementById('pfm-stage-verb').textContent = mode === 'move' ? 'Move to' : 'Stage:';
  document.getElementById('pfm-stage-status').textContent = pfmStatusName(code);
  document.getElementById('pfm-stage-submit').textContent = mode === 'move' ? 'Move' : 'Save Stage';
  document.getElementById('pfm-stage-member').value = stage?.memberName || '';
  document.getElementById('pfm-stage-note').value = stage?.note || '';
  const planned = mode === 'edit' && !stage?.doneOn;
  document.getElementById('pfm-stage-planned').checked = planned;
  document.getElementById('pfm-stage-planned-group').hidden = mode === 'move';
  document.getElementById('pfm-stage-date').value = stage?.doneOn || pfmLocalToday();
  syncPfmStagePlanned();
  clearErrorsIn('#pfm-stage-modal');
  document.getElementById('pfm-stage-overlay').classList.add('open');
  setTimeout(() => document.getElementById('pfm-stage-member').focus(), 80);
}
function syncPfmStagePlanned() {
  document.getElementById('pfm-stage-date').disabled = document.getElementById('pfm-stage-planned').checked;
}
function closePfmStageModal() {
  document.getElementById('pfm-stage-overlay').classList.remove('open');
  pfmStageCtx = null;
}
function pfmStageOverlayClick(e) {
  if (e.target === document.getElementById('pfm-stage-overlay')) closePfmStageModal();
}
async function submitPfmStageModal() {
  const item = pfmCurrent;
  const ctx = pfmStageCtx;
  if (!item || !ctx) return;
  clearErrorsIn('#pfm-stage-modal');
  const planned = ctx.mode === 'edit' && document.getElementById('pfm-stage-planned').checked;
  const date = document.getElementById('pfm-stage-date').value;
  if (!planned && !date) { markError('pfm-stage-date'); return; }
  const memberName = document.getElementById('pfm-stage-member').value.trim();
  const note = document.getElementById('pfm-stage-note').value.trim();
  await pfmBeforeWrite();
  let res;
  try {
    res = ctx.mode === 'move'
      ? await window.api.setPfmStatus(item.id, { status: ctx.status, memberName, date, note })
      : await window.api.savePfmStage(item.id, { status: ctx.status, memberName, note, doneOn: planned ? '' : date });
  } catch { toast('Could not save the stage'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not save the stage'); return; }
  closePfmStageModal();
  toast(ctx.mode === 'move' ? 'Status changed' : 'Stage saved');
  loadPfmMemberNames();
  pfmAfterWrite(res.item);
}

// ══ ARCHIVE / DELETE ══
async function setPfmArchivedUi(id, archived) {
  await pfmBeforeWrite();
  let res;
  try { res = archived ? await window.api.archivePfmItem(id) : await window.api.unarchivePfmItem(id); }
  catch { toast('Could not update the offer or CR'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not update the offer or CR'); return; }
  toast(archived ? 'Archived' : 'Unarchived');
  pfmAfterWrite(res.item);
}

// Delete stamps the row; Undo within 5 s clears the stamp (same id, children
// intact), and only when the window lapses is it purged for real.
async function deletePfmItemUi(id) {
  let res;
  try { res = await window.api.deletePfmItem(id); }
  catch { toast('Could not delete the offer or CR'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not delete the offer or CR'); return; }
  if (pfmCurrent?.id === id) { clearTimeout(_pfmSaveTimer); _pfmSaveTimer = null; }
  if (activeModule === 'pfm') { showPfmListView(); }
  pfmAfterWrite(null);
  toast('Offer / CR deleted', {
    actionLabel: 'Undo', duration: 5000,
    onAction: async () => {
      const restored = await window.api.restorePfmItem(id).catch(() => null);
      toast(restored?.ok ? 'Restored' : (restored?.error || 'Could not restore the offer or CR'));
      if (restored?.ok) pfmAfterWrite(restored.item);
    },
    onExpire: () => window.api.purgePfmItem(id).catch(() => {}),
  });
}
