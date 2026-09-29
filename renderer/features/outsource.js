// ══ OUTSOURCE — external resources: hours & fees ═════════════════════════════
// A standalone module (docs/OUTSOURCE_PLAN.md): it links to no client, project
// or task. One resource = one person being paid, private to this login, with
// an hourly rate history. Fees are never typed — the server prices each entry
// by the rate in force on its date — so this page only ever shows amounts the
// server computed.
//
// The list loads once with inactive resources included and filters
// client-side, like Project & Finance.
let outsResources = [];
let outsLoaded = false;
let outsCurrent = null;           // the resource open in the detail view, or null
const outsFilter = { search: '', inactive: false };
let outsModalEditId = null;       // null = create mode
let outsRateEditId = null;        // null = new rate

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

// ══ LIST VIEW ══
function showOutsListView() {
  outsCurrent = null;
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
  const td = child => { const cell = document.createElement('td'); if (child) cell.appendChild(child); tr.appendChild(cell); return cell; };

  const name = td(outsUserText('span', 'pfm-ref', r.name));
  if (!r.isActive) name.appendChild(pjMk('span', 'pfm-archived-tag', 'Inactive'));
  td(r.currentRateMinor == null
    ? pjMk('span', 'pfm-muted', 'No rate')
    : outsUserText('span', 'pfm-fees', outsMoney(r.currentRateMinor, r.currency)));
  td(outsUserText('span', 'pfm-fees', outsHours(r.monthMinutes)));
  td(outsUserText('span', 'pfm-fees', outsHours(r.unbilledMinutes)));
  const unpaid = td(outsUserText('span', 'pfm-fees', outsMoney(r.unpaidMinor, r.currency)));
  if (r.unbilledMissingRate) {
    const warn = pjMk('span', 'outs-warn-ic');
    warn.innerHTML = ic('triangle-alert');
    warn.title = 'Some entries have no rate yet';
    unpaid.appendChild(warn);
  }
  td(pjMk('span', 'pfm-muted', pfmFmtDate(r.lastEntryDate)));
  return tr;
}

// ══ CREATE / EDIT MODAL ══
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
  // exists, so say so and let the Rates section take it from there.
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

// Keep the list and the open detail view in step with a write.
function outsAfterWrite(resource) {
  outsLoaded = false;
  if (resource && outsCurrent && outsCurrent.id === resource.id) { outsCurrent = resource; renderOutsDetail(); }
  if (activeModule === 'outsource' && !outsCurrent) loadOutsList();
}

// ══ DETAIL VIEW ══
async function openOutsDetail(id) {
  let resource;
  try { resource = await window.api.getOutsResource(id); }
  catch { toast('Could not open this resource'); return; }
  if (!resource) { toast('This resource no longer exists'); loadOutsList(); return; }
  if (activeModule !== 'outsource') switchModule('outsource');
  outsCurrent = resource;
  showOutsDetailView();
  renderOutsDetail();
  document.getElementById('outs-detail-view').scrollTop = 0;
}
function backToOutsList() {
  showOutsListView();
  loadOutsList();
}

function renderOutsDetail() {
  const r = outsCurrent;
  const host = document.getElementById('outs-detail-view');
  if (!r || !host) return;
  host.innerHTML = '';

  const crumbs = pjMk('div', 'pj-crumbs');
  const root = pjMk('button', 'pj-crumb-link', 'Outsource');
  root.addEventListener('click', backToOutsList);
  crumbs.appendChild(root);
  const sep = pjMk('span', 'pj-crumb-sep');
  sep.innerHTML = ic('chevron-right');
  crumbs.appendChild(sep);
  crumbs.appendChild(outsUserText('span', 'pj-crumb-here', r.name));
  host.appendChild(crumbs);

  const head = pjMk('div', 'pj-detail-head');
  const ident = pjMk('div', 'pfm-ident');
  const titleRow = pjMk('div', 'pj-detail-title');
  titleRow.appendChild(outsUserText('span', 'pfm-detail-ref', r.name));
  if (!r.isActive) titleRow.appendChild(pjMk('span', 'pfm-archived-tag', 'Inactive'));
  ident.appendChild(titleRow);
  const sub = pjMk('div', 'pfm-detail-sub');
  const bits = [r.currency, r.email, r.phone].filter(Boolean);
  bits.forEach((bit, i) => {
    if (i) sub.appendChild(pjMk('span', 'pfm-dot', '·'));
    sub.appendChild(outsUserText('span', '', bit));
  });
  ident.appendChild(sub);
  head.appendChild(ident);

  const actions = pjMk('div', 'pj-detail-actions pfm-detail-actions');
  const mkBtn = (iconName, label, fn) => {
    const b = pjMk('button', 'btn');
    b.type = 'button';
    b.innerHTML = ic(iconName);
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', fn);
    actions.appendChild(b);
    return b;
  };
  mkBtn('pencil', 'Edit', () => openOutsModal(r));
  mkBtn(r.isActive ? 'ban' : 'rotate-ccw', r.isActive ? 'Deactivate' : 'Activate', () => setOutsActiveUi(r.id, !r.isActive));
  const delHost = pjMk('span', 'pfm-del-host');
  actions.appendChild(delHost);
  const renderDel = () => {
    delHost.innerHTML = '';
    const b = pjMk('button', 'btn del-action');
    b.type = 'button';
    b.innerHTML = ic('trash-2');
    b.appendChild(document.createTextNode('Delete'));
    b.addEventListener('click', () => showDeleteConfirm(delHost, () => deleteOutsResourceUi(r.id), renderDel));
    delHost.appendChild(b);
  };
  renderDel();
  head.appendChild(actions);
  host.appendChild(head);

  host.appendChild(buildOutsTiles(r));
  host.appendChild(buildOutsRatesSection(r));
  if (r.notes) {
    const notes = pjMk('div', 'pj-section');
    const nh = pjMk('div', 'pj-section-head');
    const nt = pjMk('div', 'pj-section-title');
    nt.innerHTML = ic('file-text');
    nt.appendChild(document.createTextNode('Notes'));
    nh.appendChild(nt);
    notes.appendChild(nh);
    notes.appendChild(outsUserText('div', 'outs-notes', r.notes));
    host.appendChild(notes);
  }
  host.appendChild(buildOutsHistorySection(r));
}

// ── Summary tiles ──
function buildOutsTiles(r) {
  const tiles = pjMk('div', 'outs-tiles');
  const tile = (label, value, sub, warn) => {
    const t = pjMk('div', 'outs-tile' + (warn ? ' warn' : ''));
    t.appendChild(pjMk('div', 'outs-tile-label', label));
    t.appendChild(value);
    if (sub) t.appendChild(sub);
    tiles.appendChild(t);
  };
  tile('Current Rate', r.currentRateMinor == null
    ? pjMk('div', 'outs-tile-value pfm-muted', 'No rate')
    : outsUserText('div', 'outs-tile-value', outsMoney(r.currentRateMinor, r.currency)));
  tile('Hours This Month', outsUserText('div', 'outs-tile-value', outsHours(r.monthMinutes)));
  tile('Unbilled Hours', outsUserText('div', 'outs-tile-value', outsHours(r.unbilledMinutes)),
    outsUserText('div', 'outs-tile-sub', outsMoney(r.unbilledMinor, r.currency)));
  tile('Unpaid', outsUserText('div', 'outs-tile-value', outsMoney(r.unpaidMinor, r.currency)),
    r.unbilledMissingRate ? pjMk('div', 'outs-tile-sub', 'Some entries have no rate yet') : null,
    r.unbilledMissingRate > 0);
  return tiles;
}

// ── Hourly rates (newest first) ──
function buildOutsRatesSection(r) {
  const section = pjMk('div', 'pj-section outs-rates');
  const sh = pjMk('div', 'pj-section-head');
  const st = pjMk('div', 'pj-section-title');
  st.innerHTML = ic('tag');
  st.appendChild(document.createTextNode('Hourly Rates'));
  sh.appendChild(st);
  const acts = pjMk('div', 'pj-section-actions');
  const add = pjMk('button', 'btn primary outs-rate-add');
  add.type = 'button';
  add.innerHTML = ic('plus');
  add.appendChild(document.createTextNode('Add Rate'));
  add.addEventListener('click', () => openOutsRateModal(null));
  acts.appendChild(add);
  sh.appendChild(acts);
  section.appendChild(sh);

  const rates = r.rates || [];
  if (!rates.length) {
    section.appendChild(pjMk('div', 'cp-records-empty', 'No rate yet — add one so the hours can be priced.'));
    return section;
  }
  const today = pfmLocalToday();
  const current = outsCurrentRate(rates);
  const wrap = pjMk('div', 'pfm-table-wrap');
  const table = pjMk('table', 'pfm-table outs-rate-table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  ['Effective From', 'Rate / Hour', '', ''].forEach(label => hr.appendChild(pjMk('th', '', label)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const body = document.createElement('tbody');
  rates.forEach(rate => {
    const tr = pjMk('tr', 'pfm-row outs-rate-row');
    tr.dataset.rateId = rate.id;
    const td = child => { const cell = document.createElement('td'); if (child) cell.appendChild(child); tr.appendChild(cell); return cell; };
    td(pjMk('span', '', pfmFmtDate(rate.effectiveFrom)));
    td(outsUserText('span', 'pfm-fees', outsMoney(rate.rateMinor, r.currency)));
    const tag = td();
    if (current && rate.id === current.id) tag.appendChild(pjMk('span', 'pfm-current-tag', 'Current'));
    else if (rate.effectiveFrom > today) tag.appendChild(pjMk('span', 'pfm-archived-tag', 'Upcoming'));
    const icons = pjMk('div', 'outs-rate-icons');
    const renderIcons = () => {
      icons.innerHTML = '';
      const edit = pjMk('button', 'cd-icon-btn');
      edit.type = 'button';
      edit.innerHTML = ic('pencil');
      edit.title = 'Edit rate';
      edit.setAttribute('aria-label', 'Edit rate');
      edit.addEventListener('click', () => openOutsRateModal(rate));
      icons.appendChild(edit);
      const del = pjMk('button', 'cd-icon-btn danger');
      del.type = 'button';
      del.innerHTML = ic('trash-2');
      del.title = 'Delete rate';
      del.setAttribute('aria-label', 'Delete rate');
      del.addEventListener('click', () => showDeleteConfirm(icons, () => deleteOutsRateUi(rate.id), renderIcons));
      icons.appendChild(del);
    };
    renderIcons();
    td(icons);
    body.appendChild(tr);
  });
  table.appendChild(body);
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
  toast(editing ? 'Rate saved' : 'Rate added');
  outsAfterWrite(res.resource);
}

async function deleteOutsRateUi(rateId) {
  let res;
  try { res = await window.api.deleteOutsRate(rateId); }
  catch { toast('Could not delete the rate'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not delete the rate'); if (outsCurrent) renderOutsDetail(); return; }
  outsAfterWrite(res.resource);
  toast('Rate deleted', {
    actionLabel: 'Undo', duration: 5000,
    onAction: async () => {
      const restored = await window.api.restoreOutsRate(rateId).catch(() => null);
      toast(restored?.ok ? 'Rate restored' : (restored?.error || 'Could not restore the rate'));
      if (restored?.ok) outsAfterWrite(restored.resource);
    },
    onExpire: () => window.api.purgeOutsRate(rateId).catch(() => {}),
  });
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

// Delete stamps the row; Undo within 5 s clears the stamp (same id, rates and
// entries intact), and only when the window lapses is it purged for real. The
// server refuses a resource with issued statements — deactivate it instead.
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
