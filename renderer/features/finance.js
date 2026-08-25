// ══ Finance — a client's financial record-keeping ══════════════════════════
// Finance is NOT a page of its own. A contract, a change request and an
// invoice are all *client* records, so they render inside the Clients page —
// in the open client's Finance tab — and minutes of meeting render in that
// same client's Meetings tab. The finance_lookups catalog editor lives in
// Settings → Finance, next to every other catalog. See AGENTS.md's Finance
// section.
//
// What did NOT change: finance-db.js is still the only thing that writes
// these tables, finance_lookups is still Finance's own catalog (never
// lookup_codes), and every cross-entity invariant is still enforced
// server-side. Only the surfaces moved.
//
// There is no module state for "which finance client is open" beyond
// currentFinanceClient, which the Clients page sets when it opens a client.
let financeClients = [];
let financeClientsLoaded = false;
let currentFinanceClient = null;        // full client (finance:client-get)
let financeContracts = [];              // current client's contracts, each with nested versions[]/installments[]
let financeChangeRequests = [];         // current client's change requests
let financeInvoices = [];               // current client's invoices, each with nested links[]/payments[]
let financeSummary = null;              // current client's Overview stats (finance:summary)
let financeDetailTab = 'contracts';
let financeExpandedContracts = new Set();
let financeExpandedVersionHistory = new Set();
let financeExpandedInvoices = new Set();
let financeExpandedCrs = new Set();
let financeExpandedVersionFiles = new Set();
let financeLookups = null;              // { categories: {...} } — Finance's own catalog, cached
let financeLookupsDraft = null;         // Setup tab in-progress edits (local until Save)
let financeSetupDirty = false;

let financeClientEditId = null;
let financeContractEditId = null;
let financeVersionEditId = null;
let financeVersionModalContractId = null;
let financeInstallmentEditId = null;
let financeInstallmentModalContractId = null;
let financeCrEditId = null;
let financeInvoiceEditId = null;
let financeLinkModalInvoiceId = null;
let financePaymentEditId = null;
let financePaymentModalInvoiceId = null;
let financeReverseLinkKind = null;      // 'installment' | 'cr' — target picking an invoice to link to
let financeReverseLinkTargetId = null;

// Minutes of Meeting
let financeMeetings = [];               // current client's meetings, each with nested actions[]
let currentFinanceMeeting = null;       // full meeting (finance:meeting-get) shown in the Minutes detail pane
let financeMeetingEditId = null;
let financeMeetingActionEditId = null;
let financeMeetingActionModalMeetingId = null;
let financeMeetingQuill = null;         // separate Quill instance from Knowledge Hub's

// Attachments (shared across contract versions, CRs, invoices, meetings, clients)
let financeAttachmentsCache = new Map(); // `${entityType}:${entityId}` -> attachment[]

// Semantic (not literal-code) mapping so a status pill stays correctly
// colored even after a Setup-tab relabel — codes are immutable, labels aren't.
const GI_STATUS_PILL_WEIGHT = {
  DRAFT: 'muted', ACTIVE: 'good', EXPIRED: 'bad', TERMINATED: 'bad',
  SUBMITTED: 'warn', APPROVED: 'good', REJECTED: 'bad', DELIVERED: 'good',
  ISSUED: 'warn', PARTIALLY_PAID: 'warn', PAID: 'good', CANCELLED: 'bad',
};
function finStatusPillClass(code) { return 'fin-pill-' + (GI_STATUS_PILL_WEIGHT[code] || 'muted'); }

// The sub-tabs inside a client's Finance tab. Meeting Minutes left this strip
// when it became a client tab of its own (a meeting is not a finance record),
// and Setup left it for Settings → Finance. Overview left it too: the client's
// own Overview tab already carries the money strip, and the figures now sit
// permanently above these tabs rather than hiding behind one of them.
const FINANCE_DETAIL_TABS = [
  { key: 'contracts', label: 'Contracts' },
  { key: 'crs',       label: 'Change Requests' },
  { key: 'invoices',  label: 'Invoices' },
  { key: 'reports',   label: 'Reports' },
];
const FINANCE_SETUP_CATEGORY_LABELS = {
  CONTRACT_STATUS: 'Contract Status', CR_STATUS: 'Change Request Status', INVOICE_STATUS: 'Invoice Status',
  CURRENCY: 'Currency', PAYMENT_METHOD: 'Payment Method',
};

// Small DOM helper local to this module (uniquely named to avoid clashes),
// same convention as Projects' pjMk.
function finMk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function finLang() { return window.ctI18n?.getLanguage?.() === 'ar' ? 'ar' : 'en'; }
// For copy that never reaches the DOM (export payloads, editor placeholders),
// where the i18n MutationObserver has nothing to translate.
function finT(key, vars) { return window.ctI18n?.t?.(key, vars) || key; }
function finClientName(c) { return (finLang() === 'ar' && c?.nameAr) ? c.nameAr : (c?.name || ''); }
function finMinorToStr(minor) { return ((Number(minor) || 0) / 100).toFixed(2); }
function finStrToMinor(str) { const n = parseFloat(str); return Number.isFinite(n) ? Math.round(n * 100) : 0; }
function finMoney(minor, currencyCode) {
  const amt = finMinorToStr(minor);
  return currencyCode ? (currencyCode + ' ' + amt) : amt;
}
function finStatusLabel(row) {
  if (!row || !row.status) return '';
  return finLang() === 'ar' ? (row.statusLabelAr || row.statusLabelEn) : row.statusLabelEn;
}

// ── Roster cache ─────────────────────────────────────────────────────────────
// Finance has no client list of its own any more — the Clients page IS the
// roster (migration 056 made finance_clients a per-client finance profile
// keyed to a COMPANY lookup). This cache survives only because two callers
// still need to go the other way, from a finance client id back to a company:
// the Create Hub picker and the deep links in Quick Find / the Overview
// attention list.
async function ensureFinanceClientsCache(force) {
  if (financeClientsLoaded && !force) return financeClients;
  try {
    const list = await window.api.listFinanceClients();
    financeClients = Array.isArray(list) ? list : [];
    financeClientsLoaded = true;
  } catch { financeClients = []; }
  return financeClients;
}
function financeClientForCompany(companyId) {
  return financeClients.find(fc => fc.companyId === companyId) || null;
}
// The modals' status/currency/payment-method dropdowns read this catalog, and
// nothing loads it at boot any more now that Finance has no init step.
async function ensureFinanceLookups() {
  if (financeLookups) return financeLookups;
  try { financeLookups = await window.api.listFinanceLookups(); } catch { financeLookups = null; }
  return financeLookups;
}

// Every Finance surface is now mounted inside another page, so a mutation
// cannot simply re-render "the Finance module". Ask the Clients page to
// repaint the open client instead — it owns the tab strip, its counts, and
// the hosts these sections render into.
function refreshFinanceHostPage() {
  if (typeof renderClientDetailAfterFinanceChange === 'function') renderClientDetailAfterFinanceChange();
}

// ── Client detail (loaded by the Clients page) ───────────────────────────────
// Pulls one finance client and every record hanging off it into module state.
// Deliberately does NOT render: the Clients page decides where the Finance and
// Meetings tabs live and repaints them once the whole set has landed.
async function loadFinanceClientRecords(id) {
  let client;
  try { client = await window.api.getFinanceClient(id); }
  catch { return false; }
  if (!client) return false;
  currentFinanceClient = client;
  financeExpandedContracts = new Set();
  financeExpandedVersionHistory = new Set();
  financeExpandedInvoices = new Set();
  financeExpandedCrs = new Set();
  financeExpandedVersionFiles = new Set();
  financeExpandedMeetings = new Set();
  financeContracts = [];
  financeChangeRequests = [];
  financeInvoices = [];
  financeSummary = null;
  financeMeetings = [];
  currentFinanceMeeting = null;
  financeAttachmentsCache = new Map();
  await ensureFinanceLookups();
  await Promise.all([
    loadFinanceContractsForCurrentClient(),
    loadFinanceSummaryForCurrentClient(),
    loadFinanceCrsForCurrentClient(),
    loadFinanceInvoicesForCurrentClient(),
    loadFinanceMeetingsForCurrentClient(),
  ]);
  return true;
}
function clearFinanceClientRecords() {
  currentFinanceClient = null;
  financeContracts = [];
  financeChangeRequests = [];
  financeInvoices = [];
  financeMeetings = [];
  financeSummary = null;
  currentFinanceMeeting = null;
  financeAttachmentsCache = new Map();
}
// Creates the finance profile for a client that has never been invoiced. The
// company is already known, so there is nothing to ask for — the roster and
// the finance profile are the same client now.
async function enableFinanceForCompany(companyId) {
  let res;
  try { res = await window.api.createFinanceClient({ companyId }); }
  catch { toast('Could not set up Finance for this client'); return null; }
  if (!res.ok) { toast(res.error || 'Could not set up Finance for this client'); return null; }
  financeClientsLoaded = false;
  await ensureFinanceClientsCache(true);
  return res.client;
}
// The loaders never render — every caller already repaints afterwards, and on
// open loadFinanceClientRecords() runs all five in parallel and paints once.
async function loadFinanceContractsForCurrentClient() {
  if (!currentFinanceClient) return;
  try { financeContracts = await window.api.listFinanceContracts(currentFinanceClient.id); }
  catch { financeContracts = []; toast('Could not load contracts'); }
}
async function loadFinanceSummaryForCurrentClient() {
  if (!currentFinanceClient) return;
  try { financeSummary = await window.api.getFinanceClientSummary(currentFinanceClient.id); }
  catch { financeSummary = null; }
}
async function loadFinanceCrsForCurrentClient() {
  if (!currentFinanceClient) return;
  try { financeChangeRequests = await window.api.listFinanceChangeRequests(currentFinanceClient.id); }
  catch { financeChangeRequests = []; toast('Could not load change requests'); }
}
async function loadFinanceInvoicesForCurrentClient() {
  if (!currentFinanceClient) return;
  try { financeInvoices = await window.api.listFinanceInvoices(currentFinanceClient.id); }
  catch { financeInvoices = []; toast('Could not load invoices'); }
}
async function loadFinanceMeetingsForCurrentClient() {
  if (!currentFinanceClient) return;
  try { financeMeetings = await window.api.listFinanceMeetings(currentFinanceClient.id); }
  catch { financeMeetings = []; toast('Could not load meetings'); }
}

// ── The three mounted surfaces ───────────────────────────────────────────────
// Finance renders into hosts other pages own, so "re-render Finance" means
// "re-render whichever of its surfaces is on screen right now". Every mutation
// flow in this file already calls renderFinanceDetailSections(); keeping that
// name means none of them had to change when the module became three tabs.
//
//   #finance-detail-sections    the client's Finance tab (contracts/CRs/invoices/reports)
//   #finance-meetings-sections  the client's Meetings tab
//   #finance-setup-sections     Settings → Finance
function renderFinanceDetailSections() {
  const ws = document.getElementById('finance-detail-sections');
  if (ws && currentFinanceClient) {
    ws.innerHTML = '';
    if (financeDetailTab === 'crs') renderFinanceCrsSection(ws);
    else if (financeDetailTab === 'invoices') renderFinanceInvoicesSection(ws);
    else if (financeDetailTab === 'reports') renderFinanceReportsSection(ws);
    else renderFinanceContractsSection(ws);
    renderFinanceStatStrip();
  }
  const mt = document.getElementById('finance-meetings-sections');
  if (mt && currentFinanceClient) { mt.innerHTML = ''; renderFinanceMinutesSection(mt); }
  const su = document.getElementById('finance-setup-sections');
  if (su) { su.innerHTML = ''; renderFinanceSetupSection(su); }
}

// Renders a client's whole Finance workspace into the Clients page. `host` is
// the client detail's own section container, so everything below stays on the
// client's page — opening a contract never navigates anywhere.
function renderClientFinanceWorkspace(host) {
  if (!currentFinanceClient) return;
  const strip = finMk('div', 'fin-stat-grid');
  strip.id = 'finance-stat-strip';
  host.appendChild(strip);

  const toolbar = finMk('div', 'fin-detail-toolbar');
  const tabs = finMk('div', 'seg-ctl workspace-tabs');
  tabs.id = 'finance-workspace-tabs';
  tabs.setAttribute('aria-label', 'Finance workspace');
  FINANCE_DETAIL_TABS.forEach(t => {
    const btn = finMk('button', 'seg-btn' + (financeDetailTab === t.key ? ' active' : ''), t.label);
    btn.type = 'button';
    btn.dataset.finTab = t.key;
    btn.addEventListener('click', () => setFinanceDetailTab(t.key));
    tabs.appendChild(btn);
  });
  toolbar.appendChild(tabs);
  host.appendChild(toolbar);

  const sectionsHost = finMk('div', 'fin-detail-sections');
  sectionsHost.id = 'finance-detail-sections';
  host.appendChild(sectionsHost);

  renderFinanceDetailSections();
  renderFinanceBillingSection(host);
}

// The money figures sit above the sub-tabs, so they are repainted in place
// rather than rebuilt with the section below them.
function renderFinanceStatStrip() {
  const grid = document.getElementById('finance-stat-strip');
  if (!grid || !currentFinanceClient) return;
  grid.innerHTML = '';
  const s = financeSummaryOrFallback();
  const stat = (label, value) => {
    const box = finMk('div', 'fin-stat');
    box.appendChild(finMk('div', 'fin-stat-label', label));
    box.appendChild(finMk('div', 'fin-stat-value', value));
    grid.appendChild(box);
  };
  stat('Contracts', String(s.contractCount));
  stat('Active Contracts', String(s.activeContractCount));
  stat('Final Contract Value', finMinorToStr(s.finalContractValueMinor));
  stat('Invoiced', finMinorToStr(s.invoicedMinor));
  stat('Paid', finMinorToStr(s.paidMinor));
  stat('Outstanding', finMinorToStr(s.outstandingMinor));
  stat('Change Requests', String(s.changeRequestCount));
}
function financeSummaryOrFallback() {
  const c = currentFinanceClient;
  return financeSummary || {
    contractCount: c?.contractCount || 0, activeContractCount: 0, finalContractValueMinor: 0,
    invoicedMinor: 0, paidMinor: 0, outstandingMinor: c?.outstandingMinor || 0, changeRequestCount: 0,
  };
}

// Renders the client's Meetings tab. Minutes of meeting are a record of what
// was agreed with a client, not a financial document — they left the Finance
// tab for a tab of their own, and only the storage stayed in finance_meetings.
function renderClientMeetingsWorkspace(host) {
  if (!currentFinanceClient) return;
  const sectionsHost = finMk('div', 'fin-detail-sections');
  sectionsHost.id = 'finance-meetings-sections';
  host.appendChild(sectionsHost);
  renderFinanceDetailSections();
}

// Switching a sub-tab only swaps the section below the strip — rebuilding the
// whole workspace would throw away the client page's scroll position.
function setFinanceDetailTab(key) {
  if (!FINANCE_DETAIL_TABS.some(t => t.key === key)) key = FINANCE_DETAIL_TABS[0].key;
  financeDetailTab = key;
  document.querySelectorAll('#finance-workspace-tabs .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.finTab === key);
  });
  renderFinanceDetailSections();
}

// ── Billing details ───────────────────────────────────────────────────────────
// The client's billing identity and its finance-level attachments. Sits at the
// foot of the Finance tab rather than behind a sub-tab of its own, because it
// is context for every contract and invoice above it, not a fifth thing to
// browse. The money figures it used to carry are now the permanent strip at
// the top of the tab.
function renderFinanceBillingSection(host) {
  const c = currentFinanceClient;
  if (!c) return;
  const info = finMk('div', 'fin-section');
  const infoHead = finMk('div', 'pj-section-head');
  const infoTitle = finMk('div', 'pj-section-title');
  infoTitle.innerHTML = ic('file-text');
  infoTitle.appendChild(document.createTextNode('Billing Details'));
  infoHead.appendChild(infoTitle);
  const infoActions = finMk('div', 'pj-section-actions');
  const editBtn = finMk('button', 'btn');
  editBtn.type = 'button';
  editBtn.innerHTML = ic('pencil') + ' Edit Billing Details';
  editBtn.addEventListener('click', () => openFinanceClientModal(c));
  infoActions.appendChild(editBtn);
  infoHead.appendChild(infoActions);
  info.appendChild(infoHead);
  const rows = [
    ['Contact', c.contactName], ['Email', c.contactEmail], ['Phone', c.contactPhone],
    ['Address', c.address], ['Tax Number', c.taxNumber], ['Notes', c.notes],
  ].filter(([, v]) => v);
  if (rows.length === 0) {
    info.appendChild(finMk('div', 'fin-empty-sm', 'No additional contact details recorded.'));
  } else {
    rows.forEach(([label, value]) => {
      const row = finMk('div', 'fin-info-row');
      row.appendChild(finMk('span', 'fin-info-label', label));
      row.appendChild(finMk('span', 'fin-info-value', value));
      info.appendChild(row);
    });
  }
  host.appendChild(info);

  host.appendChild(buildFinanceAttachmentsWidget('client', c.id));
}

// ── Contracts tab ─────────────────────────────────────────────────────────────
function renderFinanceContractsSection(host) {
  const sec = finMk('div', 'pj-section');
  const secHead = finMk('div', 'pj-section-head');
  const title = finMk('div', 'pj-section-title');
  title.innerHTML = ic('file-text');
  title.appendChild(document.createTextNode('Contracts (' + financeContracts.length + ')'));
  secHead.appendChild(title);
  const actions = finMk('div', 'pj-section-actions');
  const addBtn = finMk('button', 'btn primary');
  addBtn.innerHTML = ic('plus') + ' New Contract';
  addBtn.addEventListener('click', () => openFinanceContractModal(null));
  actions.appendChild(addBtn);
  secHead.appendChild(actions);
  sec.appendChild(secHead);

  if (financeContracts.length === 0) {
    sec.appendChild(finMk('div', 'fin-empty', 'No contracts yet for this client.'));
  } else {
    const list = finMk('div', 'fin-contract-list');
    financeContracts.forEach(k => list.appendChild(buildFinanceContractCard(k)));
    sec.appendChild(list);
  }
  host.appendChild(sec);
}

function toggleFinanceContractExpanded(id) {
  if (financeExpandedContracts.has(id)) financeExpandedContracts.delete(id);
  else financeExpandedContracts.add(id);
  renderFinanceDetailSections();
}
function toggleFinanceVersionHistory(contractId) {
  if (financeExpandedVersionHistory.has(contractId)) financeExpandedVersionHistory.delete(contractId);
  else financeExpandedVersionHistory.add(contractId);
  renderFinanceDetailSections();
}

function buildFinanceContractCard(k) {
  const expanded = financeExpandedContracts.has(k.id);
  const card = finMk('div', 'fin-contract-card' + (expanded ? ' expanded' : ''));

  const head = finMk('div', 'fin-contract-head');
  head.addEventListener('click', () => toggleFinanceContractExpanded(k.id));
  const titleWrap = finMk('div', 'fin-contract-title-wrap');
  titleWrap.appendChild(finMk('div', 'fin-contract-title', k.title));
  const metaBits = [k.ref, finStatusLabel(k), k.currencyCode].filter(Boolean);
  titleWrap.appendChild(finMk('div', 'fin-contract-meta', metaBits.join(' · ')));
  head.appendChild(titleWrap);
  const chev = finMk('span', 'fin-contract-chevron');
  chev.innerHTML = ic(expanded ? 'chevron-up' : 'chevron-down');
  head.appendChild(chev);
  card.appendChild(head);

  const headActions = finMk('div', 'fin-contract-actions');
  const editBtn = finMk('button', 'fin-icon-btn'); editBtn.innerHTML = ic('pencil'); editBtn.title = 'Edit contract';
  editBtn.addEventListener('click', e => { e.stopPropagation(); openFinanceContractModal(k); });
  headActions.appendChild(editBtn);
  const delBtn = finMk('button', 'fin-icon-btn danger'); delBtn.innerHTML = ic('trash-2'); delBtn.title = 'Delete contract';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    showDeleteConfirm(headActions, () => deleteFinanceContractFlow(k.id), () => renderFinanceDetailSections());
  });
  headActions.appendChild(delBtn);
  card.appendChild(headActions);

  if (expanded) card.appendChild(buildFinanceContractBody(k));
  return card;
}

function buildFinanceContractBody(k) {
  const body = finMk('div', 'fin-contract-body');

  // Versions — the final version promoted and badged; earlier versions collapsed.
  const vSec = finMk('div', 'fin-subsection');
  const vHead = finMk('div', 'fin-subsection-head');
  vHead.appendChild(finMk('span', 'fin-subsection-title', 'Versions'));
  const vAdd = finMk('button', 'fin-mini-btn'); vAdd.innerHTML = ic('plus') + ' Add Version';
  vAdd.addEventListener('click', () => openFinanceVersionModal(k.id, null));
  vHead.appendChild(vAdd);
  vSec.appendChild(vHead);
  const finalV = k.versions.find(v => v.isFinal);
  const otherV = k.versions.filter(v => !v.isFinal);
  if (!k.versions.length) {
    vSec.appendChild(finMk('div', 'fin-empty-sm', 'No versions yet.'));
  } else {
    if (finalV) vSec.appendChild(buildFinanceVersionRow(finalV, k, true));
    if (otherV.length) {
      const historyOpen = !finalV || financeExpandedVersionHistory.has(k.id);
      if (finalV) {
        const toggleBtn = finMk('button', 'fin-mini-link',
          (historyOpen ? 'Hide' : 'Show') + ' ' + otherV.length + ' earlier version' + (otherV.length === 1 ? '' : 's'));
        toggleBtn.addEventListener('click', () => toggleFinanceVersionHistory(k.id));
        vSec.appendChild(toggleBtn);
      }
      if (historyOpen) otherV.forEach(v => vSec.appendChild(buildFinanceVersionRow(v, k, false)));
    }
  }
  body.appendChild(vSec);

  // Installments — schedule with a per-row invoiced/outstanding indicator.
  const iSec = finMk('div', 'fin-subsection');
  const iHead = finMk('div', 'fin-subsection-head');
  iHead.appendChild(finMk('span', 'fin-subsection-title', 'Installment Schedule'));
  const iAdd = finMk('button', 'fin-mini-btn'); iAdd.innerHTML = ic('plus') + ' Add Installment';
  iAdd.addEventListener('click', () => openFinanceInstallmentModal(k.id, null));
  iHead.appendChild(iAdd);
  iSec.appendChild(iHead);
  if (!k.installments.length) {
    iSec.appendChild(finMk('div', 'fin-empty-sm', 'No installments yet.'));
  } else {
    const table = document.createElement('table');
    table.className = 'fin-installment-table';
    table.innerHTML = '<thead><tr><th>#</th><th>Title</th><th>Due</th><th>Amount</th><th>Status</th><th></th></tr></thead>';
    const tbody = document.createElement('tbody');
    k.installments.forEach(inst => tbody.appendChild(buildFinanceInstallmentRow(inst, k)));
    table.appendChild(tbody);
    iSec.appendChild(table);
  }
  body.appendChild(iSec);

  return body;
}

function buildFinanceVersionRow(v, k, promoted) {
  const filesOpen = financeExpandedVersionFiles.has(v.id);
  const wrap = finMk('div', 'fin-version-wrap');
  const row = finMk('div', 'fin-version-row' + (promoted ? ' promoted' : ''));
  const main = finMk('div', 'fin-version-main');
  main.appendChild(finMk('span', 'fin-version-label', v.versionLabel));
  if (v.isFinal) main.appendChild(finMk('span', 'fin-final-badge', 'Final'));
  row.appendChild(main);
  row.appendChild(finMk('span', 'fin-version-value', finMoney(v.valueMinor, k.currencyCode)));
  row.appendChild(finMk('span', 'fin-version-dates', [v.signedDate, v.effectiveDate].filter(Boolean).join(' · ')));
  const actions = finMk('div', 'fin-version-actions');
  if (!v.isFinal) {
    const finalBtn = finMk('button', 'fin-mini-link', 'Mark Final');
    finalBtn.addEventListener('click', () => setFinanceVersionFinal(v.id));
    actions.appendChild(finalBtn);
  }
  const filesBtn = finMk('button', 'fin-icon-btn' + (filesOpen ? ' active' : '')); filesBtn.innerHTML = ic('file-text'); filesBtn.title = 'Files';
  filesBtn.addEventListener('click', () => {
    if (financeExpandedVersionFiles.has(v.id)) financeExpandedVersionFiles.delete(v.id);
    else financeExpandedVersionFiles.add(v.id);
    renderFinanceDetailSections();
  });
  actions.appendChild(filesBtn);
  const editBtn = finMk('button', 'fin-icon-btn'); editBtn.innerHTML = ic('pencil'); editBtn.title = 'Edit version';
  editBtn.addEventListener('click', () => openFinanceVersionModal(k.id, v));
  actions.appendChild(editBtn);
  const delBtn = finMk('button', 'fin-icon-btn danger'); delBtn.innerHTML = ic('trash-2'); delBtn.title = 'Delete version';
  delBtn.addEventListener('click', () =>
    showDeleteConfirm(actions, () => deleteFinanceVersionFlow(v.id, k.id), () => renderFinanceDetailSections()));
  actions.appendChild(delBtn);
  row.appendChild(actions);
  wrap.appendChild(row);
  if (filesOpen) wrap.appendChild(buildFinanceAttachmentsWidget('contract_version', v.id));
  return wrap;
}

function buildFinanceInstallmentRow(inst, k) {
  const tr = document.createElement('tr');
  const links = financeInvoicesLinkedTo('installment', inst.id);
  const tdSeq = document.createElement('td'); tdSeq.textContent = String(inst.seq); tr.appendChild(tdSeq);
  const tdTitle = document.createElement('td');
  tdTitle.appendChild(document.createTextNode(inst.title || '—'));
  if (inst.milestone) tdTitle.appendChild(finMk('div', 'fin-installment-milestone', inst.milestone));
  tr.appendChild(tdTitle);
  const tdDue = document.createElement('td'); tdDue.textContent = inst.dueDate || '—'; tr.appendChild(tdDue);
  const tdAmount = document.createElement('td'); tdAmount.textContent = finMoney(inst.amountMinor, k.currencyCode); tr.appendChild(tdAmount);
  const tdStatus = document.createElement('td');
  if (links.length) {
    const chips = finMk('div', 'fin-invoice-link-chips');
    links.forEach(({ invoice, link }) => chips.appendChild(buildFinanceInvoiceLinkChip(invoice, link)));
    tdStatus.appendChild(chips);
    if (inst.outstandingMinor > 0) tdStatus.appendChild(finMk('div', 'fin-inst-status fin-inst-status-partially-invoiced', 'Partially invoiced'));
  } else {
    tdStatus.appendChild(finMk('span', 'fin-inst-status fin-inst-status-not-invoiced', 'Not Invoiced'));
  }
  tr.appendChild(tdStatus);
  const tdActions = document.createElement('td');
  const actions = finMk('div', 'fin-row-actions');
  if (inst.outstandingMinor > 0) {
    const linkBtn = finMk('button', 'fin-icon-btn'); linkBtn.innerHTML = ic('plug'); linkBtn.title = 'Link to invoice';
    linkBtn.addEventListener('click', () => openFinanceReverseLinkModal('installment', inst.id));
    actions.appendChild(linkBtn);
  }
  const editBtn = finMk('button', 'fin-icon-btn'); editBtn.innerHTML = ic('pencil'); editBtn.title = 'Edit installment';
  editBtn.addEventListener('click', () => openFinanceInstallmentModal(k.id, inst));
  actions.appendChild(editBtn);
  const delBtn = finMk('button', 'fin-icon-btn danger'); delBtn.innerHTML = ic('trash-2'); delBtn.title = 'Delete installment';
  delBtn.addEventListener('click', () =>
    showDeleteConfirm(actions, () => deleteFinanceInstallmentFlow(inst.id, k.id), () => renderFinanceDetailSections()));
  actions.appendChild(delBtn);
  tdActions.appendChild(actions);
  tr.appendChild(tdActions);
  return tr;
}
// Reverse lookup for the linked-invoice chips on installment/CR rows —
// financeInvoices is already loaded with each invoice's links[] (installmentId/
// crId), so this is a client-side scan, not a new IPC round trip.
function financeInvoicesLinkedTo(kind, id) {
  const out = [];
  for (const inv of financeInvoices) {
    for (const l of (inv.links || [])) {
      if ((kind === 'installment' && l.installmentId === id) || (kind === 'cr' && l.crId === id)) out.push({ invoice: inv, link: l });
    }
  }
  return out;
}
function financeJumpToInvoice(invoiceId) {
  financeExpandedInvoices.add(invoiceId);
  setFinanceDetailTab('invoices');
}
function buildFinanceInvoiceLinkChip(invoice, link) {
  const chip = finMk('button', 'fin-invoice-link-chip', invoice.number + ' · ' + finMinorToStr(link.allocatedMinor));
  chip.type = 'button';
  chip.title = 'Go to invoice ' + invoice.number;
  chip.addEventListener('click', e => { e.stopPropagation(); financeJumpToInvoice(invoice.id); });
  return chip;
}

// ── Change Requests tab ────────────────────────────────────────────────────────
function financeContractLabel(contractId) {
  const k = financeContracts.find(c => c.id === contractId);
  return k ? (k.ref || k.title) : '';
}
function renderFinanceCrsSection(host) {
  const sec = finMk('div', 'pj-section');
  const secHead = finMk('div', 'pj-section-head');
  const title = finMk('div', 'pj-section-title');
  title.innerHTML = ic('file-text');
  title.appendChild(document.createTextNode('Change Requests (' + financeChangeRequests.length + ')'));
  secHead.appendChild(title);
  const actions = finMk('div', 'pj-section-actions');
  const addBtn = finMk('button', 'btn primary');
  addBtn.innerHTML = ic('plus') + ' New Change Request';
  addBtn.addEventListener('click', () => openFinanceCrModal(null));
  actions.appendChild(addBtn);
  secHead.appendChild(actions);
  sec.appendChild(secHead);

  if (financeChangeRequests.length === 0) {
    sec.appendChild(finMk('div', 'fin-empty', 'No change requests yet for this client.'));
  } else {
    const list = finMk('div', 'fin-cr-list');
    financeChangeRequests.forEach(cr => list.appendChild(buildFinanceCrRow(cr)));
    sec.appendChild(list);
  }
  host.appendChild(sec);
}
function buildFinanceCrRow(cr) {
  const expanded = financeExpandedCrs.has(cr.id);
  const wrap = finMk('div', 'fin-cr-row' + (expanded ? ' expanded' : ''));
  const head = finMk('div', 'fin-cr-head');
  head.addEventListener('click', () => {
    if (financeExpandedCrs.has(cr.id)) financeExpandedCrs.delete(cr.id); else financeExpandedCrs.add(cr.id);
    renderFinanceDetailSections();
  });
  const main = finMk('div', 'fin-cr-main');
  main.appendChild(finMk('span', 'fin-cr-title', cr.title));
  main.appendChild(finMk('span', 'fin-pill ' + finStatusPillClass(cr.status), finStatusLabel(cr) || '—'));
  head.appendChild(main);
  const metaBits = [cr.ref, cr.contractId ? financeContractLabel(cr.contractId) : ''].filter(Boolean);
  head.appendChild(finMk('span', 'fin-cr-meta', metaBits.join(' · ')));
  head.appendChild(finMk('span', 'fin-cr-value', finMoney(cr.amountMinor, cr.currencyCode)));
  const links = financeInvoicesLinkedTo('cr', cr.id);
  const linkWrap = finMk('div', 'fin-invoice-link-chips');
  if (links.length) links.forEach(({ invoice, link }) => linkWrap.appendChild(buildFinanceInvoiceLinkChip(invoice, link)));
  else linkWrap.appendChild(finMk('span', 'fin-inst-status fin-inst-status-not-invoiced', 'Not Invoiced'));
  head.appendChild(linkWrap);
  const actions = finMk('div', 'fin-cr-actions');
  if (cr.outstandingMinor > 0) {
    const linkBtn = finMk('button', 'fin-icon-btn'); linkBtn.innerHTML = ic('plug'); linkBtn.title = 'Link to invoice';
    linkBtn.addEventListener('click', e => { e.stopPropagation(); openFinanceReverseLinkModal('cr', cr.id); });
    actions.appendChild(linkBtn);
  }
  const editBtn = finMk('button', 'fin-icon-btn'); editBtn.innerHTML = ic('pencil'); editBtn.title = 'Edit change request';
  editBtn.addEventListener('click', e => { e.stopPropagation(); openFinanceCrModal(cr); });
  actions.appendChild(editBtn);
  const delBtn = finMk('button', 'fin-icon-btn danger'); delBtn.innerHTML = ic('trash-2'); delBtn.title = 'Delete change request';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    showDeleteConfirm(actions, () => deleteFinanceCrFlow(cr.id), () => renderFinanceDetailSections());
  });
  actions.appendChild(delBtn);
  head.appendChild(actions);
  wrap.appendChild(head);
  if (expanded) wrap.appendChild(buildFinanceAttachmentsWidget('cr', cr.id));
  return wrap;
}

// ── Invoices tab ──────────────────────────────────────────────────────────────
function renderFinanceInvoicesSection(host) {
  const sec = finMk('div', 'pj-section');
  const secHead = finMk('div', 'pj-section-head');
  const title = finMk('div', 'pj-section-title');
  title.innerHTML = ic('file-text');
  title.appendChild(document.createTextNode('Invoices (' + financeInvoices.length + ')'));
  secHead.appendChild(title);
  const actions = finMk('div', 'pj-section-actions');
  const addBtn = finMk('button', 'btn primary');
  addBtn.innerHTML = ic('plus') + ' New Invoice';
  addBtn.addEventListener('click', () => openFinanceInvoiceModal(null));
  actions.appendChild(addBtn);
  secHead.appendChild(actions);
  sec.appendChild(secHead);

  if (financeInvoices.length === 0) {
    sec.appendChild(finMk('div', 'fin-empty', 'No invoices yet for this client.'));
  } else {
    const list = finMk('div', 'fin-invoice-list');
    financeInvoices.forEach(inv => list.appendChild(buildFinanceInvoiceCard(inv)));
    sec.appendChild(list);
  }
  host.appendChild(sec);
}
function toggleFinanceInvoiceExpanded(id) {
  if (financeExpandedInvoices.has(id)) financeExpandedInvoices.delete(id);
  else financeExpandedInvoices.add(id);
  renderFinanceDetailSections();
}
function buildFinanceInvoiceCard(inv) {
  const expanded = financeExpandedInvoices.has(inv.id);
  const card = finMk('div', 'fin-invoice-card' + (expanded ? ' expanded' : ''));

  const head = finMk('div', 'fin-invoice-head');
  head.addEventListener('click', () => toggleFinanceInvoiceExpanded(inv.id));
  const titleWrap = finMk('div', 'fin-invoice-title-wrap');
  const titleRow = finMk('div', 'fin-invoice-title', inv.number + ' ');
  titleRow.appendChild(finMk('span', 'fin-pill ' + finStatusPillClass(inv.status), finStatusLabel(inv) || '—'));
  titleWrap.appendChild(titleRow);
  const metaBits = [
    finMoney(inv.totalMinor, inv.currencyCode) + ' total',
    'Paid ' + finMinorToStr(inv.paidMinor),
    inv.outstandingMinor > 0 ? 'Outstanding ' + finMinorToStr(inv.outstandingMinor) : 'Fully paid',
    inv.dueDate ? ('Due ' + inv.dueDate) : '',
  ].filter(Boolean);
  titleWrap.appendChild(finMk('div', 'fin-invoice-meta', metaBits.join(' · ')));
  head.appendChild(titleWrap);
  const chev = finMk('span', 'fin-invoice-chevron');
  chev.innerHTML = ic(expanded ? 'chevron-up' : 'chevron-down');
  head.appendChild(chev);
  card.appendChild(head);

  const headActions = finMk('div', 'fin-invoice-actions');
  const editBtn = finMk('button', 'fin-icon-btn'); editBtn.innerHTML = ic('pencil'); editBtn.title = 'Edit invoice';
  editBtn.addEventListener('click', e => { e.stopPropagation(); openFinanceInvoiceModal(inv); });
  headActions.appendChild(editBtn);
  const delBtn = finMk('button', 'fin-icon-btn danger'); delBtn.innerHTML = ic('trash-2'); delBtn.title = 'Delete invoice';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    showDeleteConfirm(headActions, () => deleteFinanceInvoiceFlow(inv.id), () => renderFinanceDetailSections());
  });
  headActions.appendChild(delBtn);
  card.appendChild(headActions);

  if (expanded) card.appendChild(buildFinanceInvoiceBody(inv));
  return card;
}
function financeLinkTargetLabel(link) {
  if (link.installmentId != null) {
    for (const k of financeContracts) {
      const inst = k.installments.find(i => i.id === link.installmentId);
      if (inst) return 'Installment #' + inst.seq + (inst.title ? ' — ' + inst.title : '') + ' (' + k.title + ')';
    }
    return 'Installment #' + link.installmentId;
  }
  const cr = financeChangeRequests.find(c => c.id === link.crId);
  return cr ? ('CR — ' + cr.title) : ('Change Request #' + link.crId);
}
function buildFinanceInvoiceBody(inv) {
  const body = finMk('div', 'fin-invoice-body');

  // Allocations — invoice-to-installment/CR links. Add-only from this tab;
  // removing one is the only "edit", via delete + undo.
  const lSec = finMk('div', 'fin-subsection');
  const lHead = finMk('div', 'fin-subsection-head');
  lHead.appendChild(finMk('span', 'fin-subsection-title', 'Allocations'));
  const lAdd = finMk('button', 'fin-mini-btn'); lAdd.innerHTML = ic('plus') + ' Add Allocation';
  lAdd.addEventListener('click', () => openFinanceLinkModal(inv.id));
  lHead.appendChild(lAdd);
  lSec.appendChild(lHead);
  if (!inv.links.length) {
    lSec.appendChild(finMk('div', 'fin-empty-sm', 'No allocations yet.'));
  } else {
    const table = document.createElement('table');
    table.className = 'fin-mini-table';
    table.innerHTML = '<thead><tr><th>Linked To</th><th>Allocated</th><th></th></tr></thead>';
    const tbody = document.createElement('tbody');
    inv.links.forEach(l => tbody.appendChild(buildFinanceLinkRow(l, inv)));
    table.appendChild(tbody);
    lSec.appendChild(table);
  }
  body.appendChild(lSec);

  // Payments
  const pSec = finMk('div', 'fin-subsection');
  const pHead = finMk('div', 'fin-subsection-head');
  pHead.appendChild(finMk('span', 'fin-subsection-title', 'Payments'));
  const pAdd = finMk('button', 'fin-mini-btn'); pAdd.innerHTML = ic('plus') + ' Add Payment';
  pAdd.addEventListener('click', () => openFinancePaymentModal(inv.id, null));
  pHead.appendChild(pAdd);
  pSec.appendChild(pHead);
  if (!inv.payments.length) {
    pSec.appendChild(finMk('div', 'fin-empty-sm', 'No payments recorded yet.'));
  } else {
    const table = document.createElement('table');
    table.className = 'fin-mini-table';
    table.innerHTML = '<thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th></th></tr></thead>';
    const tbody = document.createElement('tbody');
    inv.payments.forEach(p => tbody.appendChild(buildFinancePaymentRow(p, inv)));
    table.appendChild(tbody);
    pSec.appendChild(table);
  }
  body.appendChild(pSec);

  body.appendChild(buildFinanceAttachmentsWidget('invoice', inv.id));

  return body;
}
function buildFinanceLinkRow(l, inv) {
  const tr = document.createElement('tr');
  const tdTarget = document.createElement('td'); tdTarget.textContent = financeLinkTargetLabel(l); tr.appendChild(tdTarget);
  const tdAmt = document.createElement('td'); tdAmt.textContent = finMoney(l.allocatedMinor, inv.currencyCode); tr.appendChild(tdAmt);
  const tdActions = document.createElement('td');
  const actions = finMk('div', 'fin-row-actions');
  const delBtn = finMk('button', 'fin-icon-btn danger'); delBtn.innerHTML = ic('trash-2'); delBtn.title = 'Remove allocation';
  delBtn.addEventListener('click', () =>
    showDeleteConfirm(actions, () => deleteFinanceInvoiceLinkFlow(l.id, inv.id), () => renderFinanceDetailSections()));
  actions.appendChild(delBtn);
  tdActions.appendChild(actions);
  tr.appendChild(tdActions);
  return tr;
}
function buildFinancePaymentRow(p, inv) {
  const tr = document.createElement('tr');
  const tdDate = document.createElement('td'); tdDate.textContent = p.paidDate || '—'; tr.appendChild(tdDate);
  const tdAmt = document.createElement('td'); tdAmt.textContent = finMoney(p.amountMinor, inv.currencyCode); tr.appendChild(tdAmt);
  const tdMethod = document.createElement('td');
  tdMethod.textContent = (finLang() === 'ar' ? (p.methodLabelAr || p.methodLabelEn) : p.methodLabelEn) || '—';
  tr.appendChild(tdMethod);
  const tdRef = document.createElement('td'); tdRef.textContent = p.reference || '—'; tr.appendChild(tdRef);
  const tdActions = document.createElement('td');
  const actions = finMk('div', 'fin-row-actions');
  const editBtn = finMk('button', 'fin-icon-btn'); editBtn.innerHTML = ic('pencil'); editBtn.title = 'Edit payment';
  editBtn.addEventListener('click', () => openFinancePaymentModal(inv.id, p));
  actions.appendChild(editBtn);
  const delBtn = finMk('button', 'fin-icon-btn danger'); delBtn.innerHTML = ic('trash-2'); delBtn.title = 'Delete payment';
  delBtn.addEventListener('click', () =>
    showDeleteConfirm(actions, () => deleteFinancePaymentFlow(p.id, inv.id), () => renderFinanceDetailSections()));
  actions.appendChild(delBtn);
  tdActions.appendChild(actions);
  tr.appendChild(tdActions);
  return tr;
}

// ── Minutes tab ────────────────────────────────────────────────────────────
let financeExpandedMeetings = new Set();
function renderFinanceMinutesSection(host) {
  const sec = finMk('div', 'pj-section');
  const secHead = finMk('div', 'pj-section-head');
  const title = finMk('div', 'pj-section-title');
  title.innerHTML = ic('file-text');
  title.appendChild(document.createTextNode('Minutes of Meeting (' + financeMeetings.length + ')'));
  secHead.appendChild(title);
  const actions = finMk('div', 'pj-section-actions');
  const addBtn = finMk('button', 'btn primary');
  addBtn.innerHTML = ic('plus') + ' New Meeting';
  addBtn.addEventListener('click', () => openFinanceMeetingModal(null));
  actions.appendChild(addBtn);
  secHead.appendChild(actions);
  sec.appendChild(secHead);

  if (financeMeetings.length === 0) {
    sec.appendChild(finMk('div', 'fin-empty', 'No meetings recorded yet for this client.'));
  } else {
    const list = finMk('div', 'fin-meeting-list');
    financeMeetings.forEach(m => list.appendChild(buildFinanceMeetingCard(m)));
    sec.appendChild(list);
  }
  host.appendChild(sec);
}
function toggleFinanceMeetingExpanded(id) {
  if (financeExpandedMeetings.has(id)) financeExpandedMeetings.delete(id);
  else financeExpandedMeetings.add(id);
  renderFinanceDetailSections();
}
function buildFinanceMeetingCard(m) {
  const expanded = financeExpandedMeetings.has(m.id);
  const card = finMk('div', 'fin-meeting-card' + (expanded ? ' expanded' : ''));

  const head = finMk('div', 'fin-meeting-head');
  head.addEventListener('click', () => toggleFinanceMeetingExpanded(m.id));
  const titleWrap = finMk('div', 'fin-meeting-title-wrap');
  titleWrap.appendChild(finMk('div', 'fin-meeting-title', m.title));
  const metaBits = [m.meetingDate, m.location, m.contractId ? financeContractLabel(m.contractId) : ''].filter(Boolean);
  titleWrap.appendChild(finMk('div', 'fin-meeting-meta', metaBits.join(' · ')));
  head.appendChild(titleWrap);
  const chev = finMk('span', 'fin-meeting-chevron');
  chev.innerHTML = ic(expanded ? 'chevron-up' : 'chevron-down');
  head.appendChild(chev);
  card.appendChild(head);

  const headActions = finMk('div', 'fin-meeting-actions-bar');
  const editBtn = finMk('button', 'fin-icon-btn'); editBtn.innerHTML = ic('pencil'); editBtn.title = 'Edit meeting';
  editBtn.addEventListener('click', e => { e.stopPropagation(); openFinanceMeetingModal(m); });
  headActions.appendChild(editBtn);
  const delBtn = finMk('button', 'fin-icon-btn danger'); delBtn.innerHTML = ic('trash-2'); delBtn.title = 'Delete meeting';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    showDeleteConfirm(headActions, () => deleteFinanceMeetingFlow(m.id), () => renderFinanceDetailSections());
  });
  headActions.appendChild(delBtn);
  card.appendChild(headActions);

  if (expanded) card.appendChild(buildFinanceMeetingBody(m));
  return card;
}
function buildFinanceMeetingBody(m) {
  const body = finMk('div', 'fin-meeting-body');
  if (m.attendees) {
    const row = finMk('div', 'fin-info-row');
    row.appendChild(finMk('span', 'fin-info-label', 'Attendees'));
    row.appendChild(finMk('span', 'fin-info-value', m.attendees));
    body.appendChild(row);
  }
  if (m.agenda) {
    const row = finMk('div', 'fin-info-row');
    row.appendChild(finMk('span', 'fin-info-label', 'Agenda'));
    row.appendChild(finMk('span', 'fin-info-value', m.agenda));
    body.appendChild(row);
  }
  const contentHost = finMk('div', 'fin-meeting-content');
  const safeContent = (m.content || '').trim() ? sanitizeKnowledgeHtml(m.content) : '';
  if (safeContent) contentHost.innerHTML = safeContent;
  else contentHost.appendChild(finMk('div', 'fin-empty-sm', 'No minutes recorded yet.'));
  body.appendChild(contentHost);

  // Action items
  const aSec = finMk('div', 'fin-subsection');
  const aHead = finMk('div', 'fin-subsection-head');
  aHead.appendChild(finMk('span', 'fin-subsection-title', 'Action Items'));
  const aAdd = finMk('button', 'fin-mini-btn'); aAdd.innerHTML = ic('plus') + ' Add Action Item';
  aAdd.addEventListener('click', () => openFinanceMeetingActionModal(m.id, null));
  aHead.appendChild(aAdd);
  aSec.appendChild(aHead);
  if (!m.actions.length) {
    aSec.appendChild(finMk('div', 'fin-empty-sm', 'No action items yet.'));
  } else {
    const table = document.createElement('table');
    table.className = 'fin-mini-table';
    table.innerHTML = '<thead><tr><th></th><th>Description</th><th>Owner</th><th>Due</th><th></th></tr></thead>';
    const tbody = document.createElement('tbody');
    m.actions.forEach(a => tbody.appendChild(buildFinanceMeetingActionRow(a, m)));
    table.appendChild(tbody);
    aSec.appendChild(table);
  }
  body.appendChild(aSec);

  body.appendChild(buildFinanceAttachmentsWidget('meeting', m.id));
  return body;
}
function buildFinanceMeetingActionRow(a, m) {
  const tr = document.createElement('tr');
  tr.className = a.status === 'DONE' ? 'fin-action-done' : '';
  const tdStatus = document.createElement('td');
  const statusBtn = finMk('button', 'fin-icon-btn');
  statusBtn.innerHTML = ic(a.status === 'DONE' ? 'circle-check' : 'circle');
  statusBtn.title = a.status === 'DONE' ? 'Mark open' : 'Mark done';
  statusBtn.addEventListener('click', () => toggleFinanceMeetingActionFlow(a.id));
  tdStatus.appendChild(statusBtn);
  tr.appendChild(tdStatus);
  const tdDesc = document.createElement('td'); tdDesc.textContent = a.description; tr.appendChild(tdDesc);
  const tdOwner = document.createElement('td'); tdOwner.textContent = a.owner || '—'; tr.appendChild(tdOwner);
  const tdDue = document.createElement('td'); tdDue.textContent = a.dueDate || '—'; tr.appendChild(tdDue);
  const tdActions = document.createElement('td');
  const actions = finMk('div', 'fin-row-actions');
  const editBtn = finMk('button', 'fin-icon-btn'); editBtn.innerHTML = ic('pencil'); editBtn.title = 'Edit action item';
  editBtn.addEventListener('click', () => openFinanceMeetingActionModal(m.id, a));
  actions.appendChild(editBtn);
  const delBtn = finMk('button', 'fin-icon-btn danger'); delBtn.innerHTML = ic('trash-2'); delBtn.title = 'Delete action item';
  delBtn.addEventListener('click', () =>
    showDeleteConfirm(actions, () => deleteFinanceMeetingActionFlow(a.id, m.id), () => renderFinanceDetailSections()));
  actions.appendChild(delBtn);
  tdActions.appendChild(actions);
  tr.appendChild(tdActions);
  return tr;
}

// ── Reports tab ────────────────────────────────────────────────────────────
// A recap of the same Overview numbers plus an Excel export — row shaping
// happens here from state already loaded for the other tabs, exactly like
// renderer/features/reports.js shapes reportData for the Timesheet export;
// xlsx.js's createFinanceReportWorkbook only lays the cells out.
function renderFinanceReportsSection(host) {
  const sec = finMk('div', 'pj-section');
  const secHead = finMk('div', 'pj-section-head');
  const title = finMk('div', 'pj-section-title');
  title.innerHTML = ic('file-text');
  title.appendChild(document.createTextNode('Report'));
  secHead.appendChild(title);
  const actions = finMk('div', 'pj-section-actions');
  const exportBtn = finMk('button', 'btn primary');
  exportBtn.innerHTML = ic('download') + ' Export to Excel';
  exportBtn.addEventListener('click', () => exportFinanceReportFlow());
  actions.appendChild(exportBtn);
  secHead.appendChild(actions);
  sec.appendChild(secHead);

  // No stat grid here — the same figures are already pinned above the sub-tabs.
  sec.appendChild(finMk('p', 'fin-empty-sm',
    'Exports every contract, change request, and invoice currently loaded for this client into one Excel workbook.'));
  host.appendChild(sec);
}
function buildFinanceReportData() {
  const c = currentFinanceClient;
  const s = financeSummaryOrFallback();
  return {
    // These leave the DOM for the workbook, so the i18n observer never sees
    // them — resolve them through t() at build time instead.
    title: finT('Finance — {client} Report', { client: finClientName(c) || finT('Client') }),
    sheetName: finClientName(c) || finT('Finance Report'),
    clientName: finClientName(c) || '', generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    rtl: finLang() === 'ar',
    summary: s,
    contracts: financeContracts.map(k => ({
      ref: k.ref, title: k.title, status: finStatusLabel(k), currencyCode: k.currencyCode,
      finalValueMinor: (k.versions.find(v => v.isFinal) || {}).valueMinor || 0,
      startDate: k.startDate, endDate: k.endDate,
    })),
    changeRequests: financeChangeRequests.map(cr => ({
      ref: cr.ref, title: cr.title, status: finStatusLabel(cr), amountMinor: cr.amountMinor,
      currencyCode: cr.currencyCode, contractLabel: cr.contractId ? financeContractLabel(cr.contractId) : '',
    })),
    invoices: financeInvoices.map(inv => ({
      number: inv.number, status: finStatusLabel(inv), currencyCode: inv.currencyCode,
      totalMinor: inv.totalMinor, paidMinor: inv.paidMinor, outstandingMinor: inv.outstandingMinor,
      issueDate: inv.issueDate, dueDate: inv.dueDate,
    })),
  };
}
async function exportFinanceReportFlow() {
  const data = buildFinanceReportData();
  const safeName = (finClientName(currentFinanceClient) || 'finance-it-report').replace(/[\\/:*?"<>|]/g, ' ').trim();
  let res;
  try { res = await window.api.exportFinanceReportExcel(data, safeName + '.xlsx'); }
  catch { toast('Could not export report'); return; }
  if (!res.ok) { if (res.error) toast(res.error); return; }
  toast('Report exported');
}

// ── Attachments (shared widget: contract versions, CRs, invoices, meetings,
// clients) ────────────────────────────────────────────────────────────────
function finAttachKey(entityType, entityId) { return entityType + ':' + entityId; }
function finAttachmentSizeLabel(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}
async function loadFinanceAttachments(entityType, entityId) {
  const key = finAttachKey(entityType, entityId);
  let list;
  try { list = await window.api.listFinanceAttachments(entityType, entityId); }
  catch { list = []; }
  list = Array.isArray(list) ? list : [];
  financeAttachmentsCache.set(key, list);
  return list;
}
// Builds a self-contained "Attachments" subsection. Caches per entity so
// switching tabs/collapsing-and-reopening a card doesn't re-fetch every time;
// refreshFinanceAttachmentsWidget() re-renders every mounted copy of a given key
// (a version's files panel can be the only one showing, but the pattern stays
// generic for entities that might appear more than once in the DOM).
function buildFinanceAttachmentsWidget(entityType, entityId) {
  const key = finAttachKey(entityType, entityId);
  const wrap = finMk('div', 'fin-subsection fin-attachments');
  const head = finMk('div', 'fin-subsection-head');
  head.appendChild(finMk('span', 'fin-subsection-title', 'Attachments'));
  const addBtn = finMk('button', 'fin-mini-btn'); addBtn.innerHTML = ic('upload') + ' Attach File';
  addBtn.addEventListener('click', () => uploadFinanceAttachmentFlow(entityType, entityId));
  head.appendChild(addBtn);
  wrap.appendChild(head);

  const listHost = finMk('div', 'fin-attachment-list');
  listHost.dataset.financeAttachKey = key;
  wrap.appendChild(listHost);

  const cached = financeAttachmentsCache.get(key);
  if (cached) {
    renderFinanceAttachmentList(listHost, entityType, entityId, cached);
  } else {
    listHost.appendChild(finMk('div', 'fin-empty-sm', 'Loading…'));
    loadFinanceAttachments(entityType, entityId).then(list => {
      if (document.body.contains(listHost)) renderFinanceAttachmentList(listHost, entityType, entityId, list);
    });
  }
  return wrap;
}
function renderFinanceAttachmentList(host, entityType, entityId, list) {
  host.innerHTML = '';
  if (!list.length) { host.appendChild(finMk('div', 'fin-empty-sm', 'No files attached.')); return; }
  list.forEach(a => host.appendChild(buildFinanceAttachmentRow(a, entityType, entityId)));
}
function buildFinanceAttachmentRow(a, entityType, entityId) {
  const row = finMk('div', 'fin-attachment-row');
  const name = finMk('span', 'fin-attachment-name');
  name.innerHTML = ic('file-text');
  name.appendChild(document.createTextNode(' ' + a.originalName));
  row.appendChild(name);
  row.appendChild(finMk('span', 'fin-attachment-meta', finAttachmentSizeLabel(a.fileSize)));
  const actions = finMk('div', 'fin-row-actions');
  const openBtn = finMk('button', 'fin-icon-btn'); openBtn.innerHTML = ic('external-link'); openBtn.title = 'Open';
  openBtn.addEventListener('click', async () => {
    let r; try { r = await window.api.openFinanceAttachment(a.id); } catch { toast('Could not open file'); return; }
    if (!r.ok) toast(r.error || 'Could not open file');
  });
  actions.appendChild(openBtn);
  const dlBtn = finMk('button', 'fin-icon-btn'); dlBtn.innerHTML = ic('download'); dlBtn.title = 'Download';
  dlBtn.addEventListener('click', async () => {
    let r; try { r = await window.api.downloadFinanceAttachment(a.id); } catch { toast('Could not download file'); return; }
    if (!r.ok && !r.canceled) toast(r.error || 'Could not download file');
    else if (r.ok) toast('File saved');
  });
  actions.appendChild(dlBtn);
  const delBtn = finMk('button', 'fin-icon-btn danger'); delBtn.innerHTML = ic('trash-2'); delBtn.title = 'Delete';
  delBtn.addEventListener('click', () =>
    showDeleteConfirm(actions, () => deleteFinanceAttachmentFlow(a.id, entityType, entityId), () => refreshFinanceAttachmentsWidget(entityType, entityId)));
  actions.appendChild(delBtn);
  row.appendChild(actions);
  return row;
}
async function uploadFinanceAttachmentFlow(entityType, entityId) {
  let res;
  try { res = await window.api.uploadFinanceAttachment(entityType, entityId); }
  catch { toast('Could not upload file'); return; }
  if (res.canceled) return;
  if (!res.ok) { toast(res.error || 'Could not upload file'); return; }
  toast('File attached');
  await refreshFinanceAttachmentsWidget(entityType, entityId);
}
async function refreshFinanceAttachmentsWidget(entityType, entityId) {
  const key = finAttachKey(entityType, entityId);
  const list = await loadFinanceAttachments(entityType, entityId);
  document.querySelectorAll('.fin-attachment-list[data-finance-attach-key="' + CSS.escape(key) + '"]')
    .forEach(host => renderFinanceAttachmentList(host, entityType, entityId, list));
}
// The file itself stays on disk until the undo window lapses with no
// restore (onExpire purges it) — the same pattern company-documents.js uses
// for its own file-remove-with-undo flow.
async function deleteFinanceAttachmentFlow(id, entityType, entityId) {
  let res;
  try { res = await window.api.deleteFinanceAttachment(id); }
  catch { toast('Could not delete file'); return; }
  if (!res.ok) { toast(res.error || 'Could not delete file'); return; }
  await refreshFinanceAttachmentsWidget(entityType, entityId);
  const snapshot = res.snapshot;
  toast('File deleted', { actionLabel: 'Undo', duration: 5000,
    onAction: async () => {
      let restored;
      try { restored = await window.api.restoreFinanceAttachment(snapshot); }
      catch { toast('Could not restore file'); return; }
      toast(restored.ok ? 'File restored' : (restored.error || 'Could not restore file'));
      await refreshFinanceAttachmentsWidget(entityType, entityId);
    },
    onExpire: () => window.api.purgeFinanceAttachmentFile(snapshot.entityType, snapshot.entityId, snapshot.filePath).catch(() => {}),
  });
}

// ── Client modal ──────────────────────────────────────────────────────────────
// Identity is no longer typed here (migration 056): a Finance client IS a
// company from the shared roster. Creating one picks an existing company;
// editing one shows its name and code read-only, because a rename has to land
// in Settings -> Companies where every other client's name lives, or Finance
// would drift from the roster it is supposed to share.
async function openFinanceClientModal(c) {
  financeClientEditId = c ? c.id : null;
  document.getElementById('finance-client-modal-title').textContent = c ? 'Billing Details' : 'Add Client to Finance';
  document.getElementById('finance-client-modal-submit').textContent = c ? 'Save Changes' : 'Add Client';

  const picker = document.getElementById('fin-client-company-row');
  const identity = document.getElementById('fin-client-identity-row');
  if (c) {
    picker.hidden = true;
    identity.hidden = false;
    document.getElementById('fin-client-identity-name').textContent = c.name || '—';
    document.getElementById('fin-client-identity-code').textContent = c.code || '';
  } else {
    picker.hidden = false;
    identity.hidden = true;
    const select = document.getElementById('fin-client-company');
    select.innerHTML = '';
    let candidates = [];
    try { candidates = await window.api.listFinanceCandidateCompanies(); }
    catch { toast('Could not load the client list'); return; }
    if (!candidates.length) {
      const opt = document.createElement('option');
      opt.value = '';
      // Runtime <option>s are one of i18n.js's known blind spots, so this text
      // is registered in the dictionary rather than left to the DOM observer.
      opt.textContent = ctI18n?.t?.('Every client is already in Finance') || 'Every client is already in Finance';
      select.appendChild(opt);
    }
    candidates.forEach(co => {
      const opt = document.createElement('option');
      opt.value = String(co.id);
      opt.textContent = (finLang() === 'ar' && co.nameAr ? co.nameAr : co.name) + (co.code ? ' — ' + co.code : '');
      select.appendChild(opt);
    });
  }

  document.getElementById('fin-client-contact-name').value = c ? (c.contactName || '') : '';
  document.getElementById('fin-client-contact-email').value = c ? (c.contactEmail || '') : '';
  document.getElementById('fin-client-contact-phone').value = c ? (c.contactPhone || '') : '';
  document.getElementById('fin-client-address').value = c ? (c.address || '') : '';
  document.getElementById('fin-client-tax-number').value = c ? (c.taxNumber || '') : '';
  document.getElementById('fin-client-notes').value = c ? (c.notes || '') : '';
  clearErrorsIn('#finance-client-modal');
  document.getElementById('finance-client-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById(c ? 'fin-client-contact-name' : 'fin-client-company').focus(), 80);
}
function closeFinanceClientModal() {
  document.getElementById('finance-client-modal-overlay').classList.remove('open');
  financeClientEditId = null;
}
function financeClientOverlayClick(e) {
  if (e.target === document.getElementById('finance-client-modal-overlay')) closeFinanceClientModal();
}
async function submitFinanceClientModal() {
  clearErrorsIn('#finance-client-modal');
  const companyId = financeClientEditId != null ? null : document.getElementById('fin-client-company').value;
  if (financeClientEditId == null && !companyId) { markError('fin-client-company'); return; }
  const data = {
    companyId: companyId ? Number(companyId) : undefined,
    contactName: document.getElementById('fin-client-contact-name').value.trim(),
    contactEmail: document.getElementById('fin-client-contact-email').value.trim(),
    contactPhone: document.getElementById('fin-client-contact-phone').value.trim(),
    address: document.getElementById('fin-client-address').value.trim(),
    taxNumber: document.getElementById('fin-client-tax-number').value.trim(),
    notes: document.getElementById('fin-client-notes').value.trim(),
  };
  let res;
  try {
    res = financeClientEditId != null
      ? await window.api.updateFinanceClient(financeClientEditId, data)
      : await window.api.createFinanceClient(data);
  } catch { toast('Could not save client'); return; }
  if (!res.ok) { toast(res.error || 'Could not save client'); return; }
  const wasEdit = financeClientEditId != null;
  closeFinanceClientModal();
  toast(wasEdit ? 'Billing details saved' : 'Client added to Finance');
  if (currentFinanceClient && res.client.id === currentFinanceClient.id) currentFinanceClient = res.client;
  financeClientsLoaded = false;
  refreshFinanceHostPage();
}
// Removes the finance profile — never the client, which is a COMPANY lookup
// the Clients page owns. Only reachable when the client has no financial
// records left, exactly as before the two rosters merged.
async function deleteFinanceClientFlow(id) {
  let res;
  try { res = await window.api.deleteFinanceClient(id); }
  catch { toast('Could not delete client'); refreshFinanceHostPage(); return; }
  if (!res.ok) { toast(res.error || 'Could not delete client'); refreshFinanceHostPage(); return; }
  financeClients = financeClients.filter(c => c.id !== id);
  if (currentFinanceClient && currentFinanceClient.id === id) clearFinanceClientRecords();
  refreshFinanceHostPage();
  const snapshot = res.snapshot;
  showGenericUndo('Client deleted', async () => {
    try {
      // companyId is what createFinanceClient keys the profile to (migration
      // 056); name/code are derived from the company, so sending them without
      // it restored nothing at all.
      const restored = await window.api.createFinanceClient({
        companyId: snapshot.companyId, contactName: snapshot.contactName,
        contactEmail: snapshot.contactEmail, contactPhone: snapshot.contactPhone, address: snapshot.address,
        taxNumber: snapshot.taxNumber, notes: snapshot.notes,
      });
      if (!restored.ok) { toast(restored.error || 'Could not restore client'); return; }
      toast('Client restored');
    } catch { toast('Could not restore client'); }
    financeClientsLoaded = false;
    await ensureFinanceClientsCache(true);
    refreshFinanceHostPage();
  });
}

// ── Contract modal ────────────────────────────────────────────────────────────
function populateFinanceLookupSelect(selectId, category, currentVal, noneLabel) {
  const el = document.getElementById(selectId);
  el.innerHTML = '';
  const none = document.createElement('option'); none.value = ''; none.textContent = noneLabel;
  el.appendChild(none);
  const opts = (financeLookups?.categories[category] || []).filter(o => o.isActive || o.code === currentVal);
  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.code;
    opt.textContent = finLang() === 'ar' ? (o.labelAr || o.labelEn) : o.labelEn;
    if (o.code === currentVal) opt.selected = true;
    el.appendChild(opt);
  });
  if (!currentVal) none.selected = true;
}
// Currency comes from the app-wide CURRENCY catalog — the same list
// Subscriptions uses — rather than Finance's own parallel copy. Two currency
// lists in one app is exactly the kind of split this integration exists to
// remove (plan §8).
//
// No migration was needed: finance_* rows store `currency_code` as a STRING,
// not a lookup FK, so every existing value stays valid whichever catalog the
// dropdown is built from. Finance's own CURRENCY rows are left in
// finance_lookups untouched (nothing is deleted) and are still used as the
// fallback if the shared catalog has no currencies — which is the state a
// fresh install starts in, since migration 003 seeds CURRENCY from a hardcoded
// list but the Setup tab is where a Finance user would have added theirs.
function financeCurrencyOptions(currentVal) {
  const shared = (typeof lkOptions === 'function' ? lkOptions('CURRENCY') : [])
    .map(o => ({ code: o.code, labelEn: o.nameEn || o.label || o.code, labelAr: o.nameAr || '' }));
  if (shared.length) return shared;
  return (financeLookups?.categories.CURRENCY || [])
    .filter(o => o.isActive || o.code === currentVal)
    .map(o => ({ code: o.code, labelEn: o.labelEn, labelAr: o.labelAr }));
}

function populateFinanceCurrencySelect(selectId, currentVal) {
  const el = document.getElementById(selectId);
  el.innerHTML = '';
  const none = document.createElement('option'); none.value = ''; none.textContent = '— No currency —';
  el.appendChild(none);
  const opts = financeCurrencyOptions(currentVal);
  // A stored currency whose catalog row has since been retired must still be
  // selectable, or opening an old invoice would silently blank its currency.
  if (currentVal && !opts.some(o => o.code === currentVal)) {
    opts.push({ code: currentVal, labelEn: currentVal, labelAr: '' });
  }
  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.code;
    opt.textContent = o.code + ' — ' + (finLang() === 'ar' ? (o.labelAr || o.labelEn) : o.labelEn);
    if (o.code === currentVal) opt.selected = true;
    el.appendChild(opt);
  });
  if (!currentVal) none.selected = true;
}

function populateFinanceContractSelect(selectId, currentVal) {
  const el = document.getElementById(selectId);
  el.innerHTML = '';
  const none = document.createElement('option'); none.value = ''; none.textContent = '— No contract —';
  el.appendChild(none);
  financeContracts.forEach(k => {
    const opt = document.createElement('option');
    opt.value = String(k.id);
    opt.textContent = k.ref ? (k.ref + ' — ' + k.title) : k.title;
    if (currentVal != null && String(k.id) === String(currentVal)) opt.selected = true;
    el.appendChild(opt);
  });
  if (currentVal == null || currentVal === '') none.selected = true;
}

function openFinanceContractModal(k) {
  financeContractEditId = k ? k.id : null;
  document.getElementById('finance-contract-modal-title').textContent = k ? 'Edit Contract' : 'New Contract';
  document.getElementById('finance-contract-modal-submit').textContent = k ? 'Save Changes' : 'Add Contract';
  document.getElementById('fin-contract-title').value = k ? (k.title || '') : '';
  document.getElementById('fin-contract-ref').value = k ? (k.ref || '') : '';
  document.getElementById('fin-contract-description').value = k ? (k.description || '') : '';
  document.getElementById('fin-contract-start').value = k ? (k.startDate || '') : '';
  document.getElementById('fin-contract-end').value = k ? (k.endDate || '') : '';
  document.getElementById('fin-contract-notes').value = k ? (k.notes || '') : '';
  populateFinanceLookupSelect('fin-contract-status', 'CONTRACT_STATUS', k ? k.status : '', '— No status —');
  populateFinanceCurrencySelect('fin-contract-currency', k ? k.currencyCode : '');
  clearErrorsIn('#finance-contract-modal');
  document.getElementById('finance-contract-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('fin-contract-title').focus(), 80);
}
function closeFinanceContractModal() {
  document.getElementById('finance-contract-modal-overlay').classList.remove('open');
  financeContractEditId = null;
}
function financeContractOverlayClick(e) {
  if (e.target === document.getElementById('finance-contract-modal-overlay')) closeFinanceContractModal();
}
async function submitFinanceContractModal() {
  clearErrorsIn('#finance-contract-modal');
  const title = document.getElementById('fin-contract-title').value.trim();
  if (!title) { markError('fin-contract-title'); return; }
  const data = {
    title, ref: document.getElementById('fin-contract-ref').value.trim(),
    description: document.getElementById('fin-contract-description').value.trim(),
    status: document.getElementById('fin-contract-status').value,
    currencyCode: document.getElementById('fin-contract-currency').value,
    startDate: document.getElementById('fin-contract-start').value,
    endDate: document.getElementById('fin-contract-end').value,
    notes: document.getElementById('fin-contract-notes').value.trim(),
  };
  let res;
  try {
    res = financeContractEditId != null
      ? await window.api.updateFinanceContract(financeContractEditId, data)
      : await window.api.createFinanceContract(currentFinanceClient.id, data);
  } catch { toast('Could not save contract'); return; }
  if (!res.ok) { toast(res.error || 'Could not save contract'); return; }
  closeFinanceContractModal();
  toast(financeContractEditId != null ? 'Contract saved' : 'Contract created');
  financeClientsLoaded = false; // contract count / outstanding on the list card may have changed
  await loadFinanceContractsForCurrentClient();
  renderFinanceDetailSections();
}
async function deleteFinanceContractFlow(id) {
  let res;
  try { res = await window.api.deleteFinanceContract(id); }
  catch { toast('Could not delete contract'); return; }
  if (!res.ok) { toast(res.error || 'Could not delete contract'); return; }
  financeClientsLoaded = false;
  await loadFinanceContractsForCurrentClient();
  renderFinanceDetailSections();
  const snapshot = res.snapshot;
  const clientId = currentFinanceClient?.id;
  showGenericUndo('Contract deleted', async () => {
    try {
      const created = await window.api.createFinanceContract(clientId, {
        title: snapshot.title, ref: snapshot.ref, description: snapshot.description, status: snapshot.status,
        currencyCode: snapshot.currencyCode, startDate: snapshot.startDate, endDate: snapshot.endDate, notes: snapshot.notes,
      });
      if (!created.ok) { toast(created.error || 'Could not restore contract'); return; }
      const newContractId = created.contract.id;
      let finalLabel = null;
      for (const v of snapshot.versions) {
        const vr = await window.api.createFinanceContractVersion(newContractId, {
          versionLabel: v.versionLabel, valueMinor: v.valueMinor, signedDate: v.signedDate,
          effectiveDate: v.effectiveDate, notes: v.notes,
        });
        if (vr.ok && v.isFinal) finalLabel = v.versionLabel;
      }
      if (finalLabel) {
        const rebuilt = await window.api.getFinanceContract(newContractId);
        const match = rebuilt?.versions?.find(v => v.versionLabel === finalLabel);
        if (match) await window.api.setFinalFinanceContractVersion(match.id);
      }
      for (const inst of snapshot.installments) {
        await window.api.createFinanceInstallment(newContractId, {
          seq: inst.seq, title: inst.title, milestone: inst.milestone, dueDate: inst.dueDate,
          amountMinor: inst.amountMinor, notes: inst.notes,
        });
      }
      toast('Contract restored');
    } catch { toast('Could not restore contract'); }
    financeClientsLoaded = false;
    await loadFinanceContractsForCurrentClient();
    renderFinanceDetailSections();
  });
}

// ── Version modal ─────────────────────────────────────────────────────────────
function openFinanceVersionModal(contractId, v) {
  financeVersionModalContractId = contractId;
  financeVersionEditId = v ? v.id : null;
  document.getElementById('finance-version-modal-title').textContent = v ? 'Edit Version' : 'New Version';
  document.getElementById('finance-version-modal-submit').textContent = v ? 'Save Changes' : 'Add Version';
  document.getElementById('fin-version-label').value = v ? (v.versionLabel || '') : '';
  document.getElementById('fin-version-value').value = v ? finMinorToStr(v.valueMinor) : '';
  document.getElementById('fin-version-signed').value = v ? (v.signedDate || '') : '';
  document.getElementById('fin-version-effective').value = v ? (v.effectiveDate || '') : '';
  document.getElementById('fin-version-notes').value = v ? (v.notes || '') : '';
  // isFinal is only offered at creation — an existing version's final flag is
  // changed only through the dedicated "Mark Final" action.
  document.getElementById('fin-version-final-row').style.display = v ? 'none' : '';
  document.getElementById('fin-version-final').checked = false;
  clearErrorsIn('#finance-version-modal');
  document.getElementById('finance-version-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('fin-version-label').focus(), 80);
}
function closeFinanceVersionModal() {
  document.getElementById('finance-version-modal-overlay').classList.remove('open');
  financeVersionEditId = null; financeVersionModalContractId = null;
}
function financeVersionOverlayClick(e) {
  if (e.target === document.getElementById('finance-version-modal-overlay')) closeFinanceVersionModal();
}
async function submitFinanceVersionModal() {
  clearErrorsIn('#finance-version-modal');
  const versionLabel = document.getElementById('fin-version-label').value.trim();
  if (!versionLabel) { markError('fin-version-label'); return; }
  const data = {
    versionLabel, valueMinor: finStrToMinor(document.getElementById('fin-version-value').value),
    signedDate: document.getElementById('fin-version-signed').value,
    effectiveDate: document.getElementById('fin-version-effective').value,
    notes: document.getElementById('fin-version-notes').value.trim(),
    isFinal: document.getElementById('fin-version-final').checked,
  };
  let res;
  try {
    res = financeVersionEditId != null
      ? await window.api.updateFinanceContractVersion(financeVersionEditId, data)
      : await window.api.createFinanceContractVersion(financeVersionModalContractId, data);
  } catch { toast('Could not save version'); return; }
  if (!res.ok) { toast(res.error || 'Could not save version'); return; }
  closeFinanceVersionModal();
  toast(financeVersionEditId != null ? 'Version saved' : 'Version created');
  await loadFinanceContractsForCurrentClient();
  renderFinanceDetailSections();
}
async function setFinanceVersionFinal(id) {
  let res;
  try { res = await window.api.setFinalFinanceContractVersion(id); }
  catch { toast('Could not update final version'); return; }
  if (!res.ok) { toast(res.error || 'Could not update final version'); return; }
  toast('Final version updated');
  await loadFinanceContractsForCurrentClient();
  renderFinanceDetailSections();
}
async function deleteFinanceVersionFlow(id, contractId) {
  let res;
  try { res = await window.api.deleteFinanceContractVersion(id); }
  catch { toast('Could not delete version'); return; }
  if (!res.ok) { toast(res.error || 'Could not delete version'); return; }
  await loadFinanceContractsForCurrentClient();
  renderFinanceDetailSections();
  const snapshot = res.snapshot;
  showGenericUndo('Version deleted', async () => {
    try {
      const created = await window.api.createFinanceContractVersion(contractId, {
        versionLabel: snapshot.versionLabel, valueMinor: snapshot.valueMinor, signedDate: snapshot.signedDate,
        effectiveDate: snapshot.effectiveDate, notes: snapshot.notes, isFinal: snapshot.isFinal,
      });
      if (!created.ok) { toast(created.error || 'Could not restore version'); return; }
      toast('Version restored');
    } catch { toast('Could not restore version'); }
    await loadFinanceContractsForCurrentClient();
    renderFinanceDetailSections();
  });
}

// ── Installment modal ─────────────────────────────────────────────────────────
function openFinanceInstallmentModal(contractId, inst) {
  financeInstallmentModalContractId = contractId;
  financeInstallmentEditId = inst ? inst.id : null;
  document.getElementById('finance-installment-modal-title').textContent = inst ? 'Edit Installment' : 'New Installment';
  document.getElementById('finance-installment-modal-submit').textContent = inst ? 'Save Changes' : 'Add Installment';
  document.getElementById('fin-installment-seq').value = inst ? inst.seq : '';
  document.getElementById('fin-installment-title').value = inst ? (inst.title || '') : '';
  document.getElementById('fin-installment-milestone').value = inst ? (inst.milestone || '') : '';
  document.getElementById('fin-installment-due').value = inst ? (inst.dueDate || '') : '';
  document.getElementById('fin-installment-amount').value = inst ? finMinorToStr(inst.amountMinor) : '';
  document.getElementById('fin-installment-notes').value = inst ? (inst.notes || '') : '';
  clearErrorsIn('#finance-installment-modal');
  document.getElementById('finance-installment-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('fin-installment-title').focus(), 80);
}
function closeFinanceInstallmentModal() {
  document.getElementById('finance-installment-modal-overlay').classList.remove('open');
  financeInstallmentEditId = null; financeInstallmentModalContractId = null;
}
function financeInstallmentOverlayClick(e) {
  if (e.target === document.getElementById('finance-installment-modal-overlay')) closeFinanceInstallmentModal();
}
async function submitFinanceInstallmentModal() {
  clearErrorsIn('#finance-installment-modal');
  const seqVal = document.getElementById('fin-installment-seq').value.trim();
  if (financeInstallmentEditId != null && !seqVal) { markError('fin-installment-seq'); return; }
  const data = {
    seq: seqVal ? Number(seqVal) : undefined,
    title: document.getElementById('fin-installment-title').value.trim(),
    milestone: document.getElementById('fin-installment-milestone').value.trim(),
    dueDate: document.getElementById('fin-installment-due').value,
    amountMinor: finStrToMinor(document.getElementById('fin-installment-amount').value),
    notes: document.getElementById('fin-installment-notes').value.trim(),
  };
  let res;
  try {
    res = financeInstallmentEditId != null
      ? await window.api.updateFinanceInstallment(financeInstallmentEditId, data)
      : await window.api.createFinanceInstallment(financeInstallmentModalContractId, data);
  } catch { toast('Could not save installment'); return; }
  if (!res.ok) { toast(res.error || 'Could not save installment'); return; }
  closeFinanceInstallmentModal();
  toast(financeInstallmentEditId != null ? 'Installment saved' : 'Installment created');
  await loadFinanceContractsForCurrentClient();
  renderFinanceDetailSections();
}
async function deleteFinanceInstallmentFlow(id, contractId) {
  let res;
  try { res = await window.api.deleteFinanceInstallment(id); }
  catch { toast('Could not delete installment'); return; }
  if (!res.ok) { toast(res.error || 'Could not delete installment'); return; }
  await loadFinanceContractsForCurrentClient();
  renderFinanceDetailSections();
  const snapshot = res.snapshot;
  showGenericUndo('Installment deleted', async () => {
    try {
      const created = await window.api.createFinanceInstallment(contractId, {
        seq: snapshot.seq, title: snapshot.title, milestone: snapshot.milestone, dueDate: snapshot.dueDate,
        amountMinor: snapshot.amountMinor, notes: snapshot.notes,
      });
      if (!created.ok) { toast(created.error || 'Could not restore installment'); return; }
      toast('Installment restored');
    } catch { toast('Could not restore installment'); }
    await loadFinanceContractsForCurrentClient();
    renderFinanceDetailSections();
  });
}

// ── Change Request modal ──────────────────────────────────────────────────────
function openFinanceCrModal(cr) {
  financeCrEditId = cr ? cr.id : null;
  document.getElementById('finance-cr-modal-title').textContent = cr ? 'Edit Change Request' : 'New Change Request';
  document.getElementById('finance-cr-modal-submit').textContent = cr ? 'Save Changes' : 'Add Change Request';
  document.getElementById('fin-cr-title').value = cr ? (cr.title || '') : '';
  document.getElementById('fin-cr-ref').value = cr ? (cr.ref || '') : '';
  document.getElementById('fin-cr-amount').value = cr ? finMinorToStr(cr.amountMinor) : '';
  document.getElementById('fin-cr-requested').value = cr ? (cr.requestedDate || '') : '';
  document.getElementById('fin-cr-approved').value = cr ? (cr.approvedDate || '') : '';
  document.getElementById('fin-cr-description').value = cr ? (cr.description || '') : '';
  document.getElementById('fin-cr-notes').value = cr ? (cr.notes || '') : '';
  populateFinanceLookupSelect('fin-cr-status', 'CR_STATUS', cr ? cr.status : '', '— No status —');
  populateFinanceCurrencySelect('fin-cr-currency', cr ? cr.currencyCode : '');
  populateFinanceContractSelect('fin-cr-contract', cr ? cr.contractId : '');
  clearErrorsIn('#finance-cr-modal');
  document.getElementById('finance-cr-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('fin-cr-title').focus(), 80);
}
function closeFinanceCrModal() {
  document.getElementById('finance-cr-modal-overlay').classList.remove('open');
  financeCrEditId = null;
}
function financeCrOverlayClick(e) {
  if (e.target === document.getElementById('finance-cr-modal-overlay')) closeFinanceCrModal();
}
async function submitFinanceCrModal() {
  clearErrorsIn('#finance-cr-modal');
  const title = document.getElementById('fin-cr-title').value.trim();
  if (!title) { markError('fin-cr-title'); return; }
  const contractVal = document.getElementById('fin-cr-contract').value;
  const data = {
    title, ref: document.getElementById('fin-cr-ref').value.trim(),
    description: document.getElementById('fin-cr-description').value.trim(),
    status: document.getElementById('fin-cr-status').value,
    contractId: contractVal ? Number(contractVal) : null,
    amountMinor: finStrToMinor(document.getElementById('fin-cr-amount').value),
    currencyCode: document.getElementById('fin-cr-currency').value,
    requestedDate: document.getElementById('fin-cr-requested').value,
    approvedDate: document.getElementById('fin-cr-approved').value,
    notes: document.getElementById('fin-cr-notes').value.trim(),
  };
  let res;
  try {
    res = financeCrEditId != null
      ? await window.api.updateFinanceChangeRequest(financeCrEditId, data)
      : await window.api.createFinanceChangeRequest(currentFinanceClient.id, data);
  } catch { toast('Could not save change request'); return; }
  if (!res.ok) { toast(res.error || 'Could not save change request'); return; }
  closeFinanceCrModal();
  toast(financeCrEditId != null ? 'Change request saved' : 'Change request created');
  await loadFinanceCrsForCurrentClient();
  await loadFinanceSummaryForCurrentClient();
  renderFinanceDetailSections();
}
async function deleteFinanceCrFlow(id) {
  let res;
  try { res = await window.api.deleteFinanceChangeRequest(id); }
  catch { toast('Could not delete change request'); return; }
  if (!res.ok) { toast(res.error || 'Could not delete change request'); return; }
  await loadFinanceCrsForCurrentClient();
  await loadFinanceSummaryForCurrentClient();
  renderFinanceDetailSections();
  const snapshot = res.snapshot;
  const clientId = currentFinanceClient?.id;
  showGenericUndo('Change request deleted', async () => {
    try {
      const created = await window.api.createFinanceChangeRequest(clientId, {
        title: snapshot.title, ref: snapshot.ref, description: snapshot.description, status: snapshot.status,
        contractId: snapshot.contractId, amountMinor: snapshot.amountMinor, currencyCode: snapshot.currencyCode,
        requestedDate: snapshot.requestedDate, approvedDate: snapshot.approvedDate, notes: snapshot.notes,
      });
      if (!created.ok) { toast(created.error || 'Could not restore change request'); return; }
      toast('Change request restored');
    } catch { toast('Could not restore change request'); }
    await loadFinanceCrsForCurrentClient();
    await loadFinanceSummaryForCurrentClient();
    renderFinanceDetailSections();
  });
}

// ── Invoice modal ─────────────────────────────────────────────────────────────
function openFinanceInvoiceModal(inv) {
  financeInvoiceEditId = inv ? inv.id : null;
  document.getElementById('finance-invoice-modal-title').textContent = inv ? 'Edit Invoice' : 'New Invoice';
  document.getElementById('finance-invoice-modal-submit').textContent = inv ? 'Save Changes' : 'Add Invoice';
  document.getElementById('fin-invoice-number').value = inv ? (inv.number || '') : '';
  document.getElementById('fin-invoice-amount').value = inv ? finMinorToStr(inv.amountMinor) : '';
  document.getElementById('fin-invoice-tax').value = inv ? finMinorToStr(inv.taxMinor) : '';
  document.getElementById('fin-invoice-issue').value = inv ? (inv.issueDate || '') : '';
  document.getElementById('fin-invoice-due').value = inv ? (inv.dueDate || '') : '';
  document.getElementById('fin-invoice-notes').value = inv ? (inv.notes || '') : '';
  populateFinanceLookupSelect('fin-invoice-status', 'INVOICE_STATUS', inv ? inv.status : '', '— No status —');
  populateFinanceCurrencySelect('fin-invoice-currency', inv ? inv.currencyCode : '');
  clearErrorsIn('#finance-invoice-modal');
  document.getElementById('finance-invoice-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('fin-invoice-number').focus(), 80);
}
function closeFinanceInvoiceModal() {
  document.getElementById('finance-invoice-modal-overlay').classList.remove('open');
  financeInvoiceEditId = null;
}
function financeInvoiceOverlayClick(e) {
  if (e.target === document.getElementById('finance-invoice-modal-overlay')) closeFinanceInvoiceModal();
}
async function submitFinanceInvoiceModal() {
  clearErrorsIn('#finance-invoice-modal');
  const number = document.getElementById('fin-invoice-number').value.trim();
  if (!number) { markError('fin-invoice-number'); return; }
  const data = {
    number, amountMinor: finStrToMinor(document.getElementById('fin-invoice-amount').value),
    taxMinor: finStrToMinor(document.getElementById('fin-invoice-tax').value),
    currencyCode: document.getElementById('fin-invoice-currency').value,
    status: document.getElementById('fin-invoice-status').value,
    issueDate: document.getElementById('fin-invoice-issue').value,
    dueDate: document.getElementById('fin-invoice-due').value,
    notes: document.getElementById('fin-invoice-notes').value.trim(),
  };
  let res;
  try {
    res = financeInvoiceEditId != null
      ? await window.api.updateFinanceInvoice(financeInvoiceEditId, data)
      : await window.api.createFinanceInvoice(currentFinanceClient.id, data);
  } catch { toast('Could not save invoice'); return; }
  if (!res.ok) { toast(res.error || 'Could not save invoice'); return; }
  closeFinanceInvoiceModal();
  toast(financeInvoiceEditId != null ? 'Invoice saved' : 'Invoice created');
  financeClientsLoaded = false; // outstanding on the list card may have changed
  await loadFinanceInvoicesForCurrentClient();
  await loadFinanceSummaryForCurrentClient();
  renderFinanceDetailSections();
}
async function deleteFinanceInvoiceFlow(id) {
  let res;
  try { res = await window.api.deleteFinanceInvoice(id); }
  catch { toast('Could not delete invoice'); return; }
  if (!res.ok) { toast(res.error || 'Could not delete invoice'); return; }
  financeClientsLoaded = false;
  await refreshFinanceAfterInvoiceChange();
  const snapshot = res.snapshot;
  const clientId = currentFinanceClient?.id;
  showGenericUndo('Invoice deleted', async () => {
    try {
      const created = await window.api.createFinanceInvoice(clientId, {
        number: snapshot.number, amountMinor: snapshot.amountMinor, taxMinor: snapshot.taxMinor,
        currencyCode: snapshot.currencyCode, status: snapshot.status, issueDate: snapshot.issueDate,
        dueDate: snapshot.dueDate, notes: snapshot.notes,
      });
      if (!created.ok) { toast(created.error || 'Could not restore invoice'); return; }
      const newInvoiceId = created.invoice.id;
      for (const l of snapshot.links) {
        await window.api.createFinanceInvoiceLink(newInvoiceId, {
          installmentId: l.installmentId, crId: l.crId, allocatedMinor: l.allocatedMinor,
        });
      }
      for (const p of snapshot.payments) {
        await window.api.createFinancePayment(newInvoiceId, {
          paidDate: p.paidDate, amountMinor: p.amountMinor, method: p.method, reference: p.reference, notes: p.notes,
        });
      }
      toast('Invoice restored');
    } catch { toast('Could not restore invoice'); }
    financeClientsLoaded = false;
    await refreshFinanceAfterInvoiceChange();
  });
}
// Shared by every flow that can move an invoice allocation (create/delete
// invoice, create/delete a link): the installment/CR invoiced/outstanding
// indicators live on the Contracts/Change-Requests tabs, not just Invoices.
async function refreshFinanceAfterInvoiceChange() {
  await loadFinanceInvoicesForCurrentClient();
  await loadFinanceSummaryForCurrentClient();
  await loadFinanceContractsForCurrentClient();
  await loadFinanceCrsForCurrentClient();
  renderFinanceDetailSections();
}

// ── "Link to Invoice" modal — the mirror image of the Invoice tab's own "Add
// Allocation" flow. That one is invoice-first (pick an installment/CR from a
// fixed invoice); this is target-first (pick an invoice from a fixed
// installment/CR), reachable directly from the Contracts/Change Requests
// tabs so linking doesn't require already being inside an expanded invoice
// card. Both write through the same finance:invoice-link-create call.
function openFinanceReverseLinkModal(kind, id) {
  financeReverseLinkKind = kind;
  financeReverseLinkTargetId = id;
  let label = '', outstanding = 0;
  if (kind === 'installment') {
    for (const k of financeContracts) {
      const inst = k.installments.find(i => i.id === id);
      if (inst) { label = k.title + ' — #' + inst.seq + (inst.title ? ' ' + inst.title : ''); outstanding = inst.outstandingMinor; break; }
    }
  } else {
    const cr = financeChangeRequests.find(c => c.id === id);
    if (cr) { label = 'CR — ' + cr.title; outstanding = cr.outstandingMinor; }
  }
  document.getElementById('fin-reverse-link-target-label').textContent = label;
  document.getElementById('fin-reverse-link-amount').value = outstanding > 0 ? finMinorToStr(outstanding) : '';
  renderFinanceReverseLinkInvoiceOptions();
  clearErrorsIn('#finance-reverse-link-modal');
  document.getElementById('finance-reverse-link-modal-overlay').classList.add('open');
}
function closeFinanceReverseLinkModal() {
  document.getElementById('finance-reverse-link-modal-overlay').classList.remove('open');
  financeReverseLinkKind = null; financeReverseLinkTargetId = null;
}
function financeReverseLinkOverlayClick(e) {
  if (e.target === document.getElementById('finance-reverse-link-modal-overlay')) closeFinanceReverseLinkModal();
}
function renderFinanceReverseLinkInvoiceOptions() {
  const select = document.getElementById('fin-reverse-link-invoice');
  select.innerHTML = '';
  if (!financeInvoices.length) {
    const opt = document.createElement('option'); opt.value = ''; opt.textContent = 'No invoices for this client yet';
    select.appendChild(opt);
    return;
  }
  financeInvoices.forEach(inv => {
    const opt = document.createElement('option');
    opt.value = String(inv.id);
    opt.textContent = inv.number + (inv.currencyCode ? ' (' + inv.currencyCode + ')' : '') + ' — outstanding ' + finMinorToStr(inv.outstandingMinor);
    select.appendChild(opt);
  });
}
async function submitFinanceReverseLinkModal() {
  clearErrorsIn('#finance-reverse-link-modal');
  const invoiceId = Number(document.getElementById('fin-reverse-link-invoice').value);
  if (!invoiceId) { markError('fin-reverse-link-invoice'); return; }
  const amountMinor = finStrToMinor(document.getElementById('fin-reverse-link-amount').value);
  if (amountMinor <= 0) { markError('fin-reverse-link-amount'); return; }
  const data = { allocatedMinor: amountMinor };
  if (financeReverseLinkKind === 'installment') data.installmentId = financeReverseLinkTargetId; else data.crId = financeReverseLinkTargetId;
  let res;
  try { res = await window.api.createFinanceInvoiceLink(invoiceId, data); }
  catch { toast('Could not add allocation'); return; }
  if (!res.ok) { toast(res.error || 'Could not add allocation'); return; }
  closeFinanceReverseLinkModal();
  toast('Linked to invoice');
  await refreshFinanceAfterInvoiceChange();
}

// ── Invoice Link ("Add Allocation") modal ────────────────────────────────────
function openFinanceLinkModal(invoiceId) {
  financeLinkModalInvoiceId = invoiceId;
  document.getElementById('fin-link-type-installment').checked = true;
  document.getElementById('fin-link-amount').value = '';
  renderFinanceLinkTargetOptions();
  clearErrorsIn('#finance-link-modal');
  document.getElementById('finance-link-modal-overlay').classList.add('open');
}
function closeFinanceLinkModal() {
  document.getElementById('finance-link-modal-overlay').classList.remove('open');
  financeLinkModalInvoiceId = null;
}
function financeLinkOverlayClick(e) {
  if (e.target === document.getElementById('finance-link-modal-overlay')) closeFinanceLinkModal();
}
function renderFinanceLinkTargetOptions() {
  const isInstallment = document.getElementById('fin-link-type-installment').checked;
  const select = document.getElementById('fin-link-target');
  select.innerHTML = '';
  if (isInstallment) {
    const items = [];
    financeContracts.forEach(k => k.installments.forEach(i => { if (i.outstandingMinor > 0) items.push({ k, i }); }));
    if (!items.length) {
      const opt = document.createElement('option'); opt.value = ''; opt.textContent = 'No outstanding installments';
      select.appendChild(opt);
      return;
    }
    items.forEach(({ k, i }) => {
      const opt = document.createElement('option');
      opt.value = 'installment:' + i.id;
      opt.textContent = k.title + ' — #' + i.seq + (i.title ? ' ' + i.title : '') + ' (outstanding ' + finMinorToStr(i.outstandingMinor) + ')';
      select.appendChild(opt);
    });
  } else {
    const items = financeChangeRequests.filter(cr => cr.outstandingMinor > 0);
    if (!items.length) {
      const opt = document.createElement('option'); opt.value = ''; opt.textContent = 'No outstanding change requests';
      select.appendChild(opt);
      return;
    }
    items.forEach(cr => {
      const opt = document.createElement('option');
      opt.value = 'cr:' + cr.id;
      opt.textContent = cr.title + ' (outstanding ' + finMinorToStr(cr.outstandingMinor) + ')';
      select.appendChild(opt);
    });
  }
}
async function submitFinanceLinkModal() {
  clearErrorsIn('#finance-link-modal');
  const targetVal = document.getElementById('fin-link-target').value;
  if (!targetVal) { markError('fin-link-target'); return; }
  const [kind, idStr] = targetVal.split(':');
  const amountMinor = finStrToMinor(document.getElementById('fin-link-amount').value);
  if (amountMinor <= 0) { markError('fin-link-amount'); return; }
  const data = { allocatedMinor: amountMinor };
  if (kind === 'installment') data.installmentId = Number(idStr); else data.crId = Number(idStr);
  let res;
  try { res = await window.api.createFinanceInvoiceLink(financeLinkModalInvoiceId, data); }
  catch { toast('Could not add allocation'); return; }
  if (!res.ok) { toast(res.error || 'Could not add allocation'); return; }
  closeFinanceLinkModal();
  toast('Allocation added');
  await refreshFinanceAfterInvoiceChange();
}
async function deleteFinanceInvoiceLinkFlow(id, invoiceId) {
  let res;
  try { res = await window.api.deleteFinanceInvoiceLink(id); }
  catch { toast('Could not remove allocation'); return; }
  if (!res.ok) { toast(res.error || 'Could not remove allocation'); return; }
  await refreshFinanceAfterInvoiceChange();
  const snapshot = res.snapshot;
  showGenericUndo('Allocation removed', async () => {
    try {
      const data = { allocatedMinor: snapshot.allocatedMinor };
      if (snapshot.installmentId != null) data.installmentId = snapshot.installmentId; else data.crId = snapshot.crId;
      const created = await window.api.createFinanceInvoiceLink(invoiceId, data);
      if (!created.ok) { toast(created.error || 'Could not restore allocation'); return; }
      toast('Allocation restored');
    } catch { toast('Could not restore allocation'); }
    await refreshFinanceAfterInvoiceChange();
  });
}

// ── Payment modal ─────────────────────────────────────────────────────────────
function openFinancePaymentModal(invoiceId, p) {
  financePaymentModalInvoiceId = invoiceId;
  financePaymentEditId = p ? p.id : null;
  document.getElementById('finance-payment-modal-title').textContent = p ? 'Edit Payment' : 'New Payment';
  document.getElementById('finance-payment-modal-submit').textContent = p ? 'Save Changes' : 'Add Payment';
  document.getElementById('fin-payment-amount').value = p ? finMinorToStr(p.amountMinor) : '';
  document.getElementById('fin-payment-date').value = p ? (p.paidDate || '') : '';
  document.getElementById('fin-payment-reference').value = p ? (p.reference || '') : '';
  document.getElementById('fin-payment-notes').value = p ? (p.notes || '') : '';
  populateFinanceLookupSelect('fin-payment-method', 'PAYMENT_METHOD', p ? p.method : '', '— No method —');
  clearErrorsIn('#finance-payment-modal');
  document.getElementById('finance-payment-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('fin-payment-amount').focus(), 80);
}
function closeFinancePaymentModal() {
  document.getElementById('finance-payment-modal-overlay').classList.remove('open');
  financePaymentEditId = null; financePaymentModalInvoiceId = null;
}
function financePaymentOverlayClick(e) {
  if (e.target === document.getElementById('finance-payment-modal-overlay')) closeFinancePaymentModal();
}
async function submitFinancePaymentModal() {
  clearErrorsIn('#finance-payment-modal');
  const amountMinor = finStrToMinor(document.getElementById('fin-payment-amount').value);
  if (amountMinor <= 0) { markError('fin-payment-amount'); return; }
  const data = {
    amountMinor, paidDate: document.getElementById('fin-payment-date').value,
    method: document.getElementById('fin-payment-method').value,
    reference: document.getElementById('fin-payment-reference').value.trim(),
    notes: document.getElementById('fin-payment-notes').value.trim(),
  };
  let res;
  try {
    res = financePaymentEditId != null
      ? await window.api.updateFinancePayment(financePaymentEditId, data)
      : await window.api.createFinancePayment(financePaymentModalInvoiceId, data);
  } catch { toast('Could not save payment'); return; }
  if (!res.ok) { toast(res.error || 'Could not save payment'); return; }
  closeFinancePaymentModal();
  toast(financePaymentEditId != null ? 'Payment saved' : 'Payment recorded');
  await refreshFinanceAfterInvoiceChange();
}
async function deleteFinancePaymentFlow(id, invoiceId) {
  let res;
  try { res = await window.api.deleteFinancePayment(id); }
  catch { toast('Could not delete payment'); return; }
  if (!res.ok) { toast(res.error || 'Could not delete payment'); return; }
  await refreshFinanceAfterInvoiceChange();
  const snapshot = res.snapshot;
  showGenericUndo('Payment deleted', async () => {
    try {
      const created = await window.api.createFinancePayment(invoiceId, {
        amountMinor: snapshot.amountMinor, paidDate: snapshot.paidDate, method: snapshot.method,
        reference: snapshot.reference, notes: snapshot.notes,
      });
      if (!created.ok) { toast(created.error || 'Could not restore payment'); return; }
      toast('Payment restored');
    } catch { toast('Could not restore payment'); }
    await refreshFinanceAfterInvoiceChange();
  });
}

// ── Meeting modal ──────────────────────────────────────────────────────────
function populateFinanceCrSelect(selectId, currentVal) {
  const el = document.getElementById(selectId);
  el.innerHTML = '';
  const none = document.createElement('option'); none.value = ''; none.textContent = '— No change request —';
  el.appendChild(none);
  financeChangeRequests.forEach(cr => {
    const opt = document.createElement('option');
    opt.value = String(cr.id);
    opt.textContent = cr.ref ? (cr.ref + ' — ' + cr.title) : cr.title;
    if (currentVal != null && String(cr.id) === String(currentVal)) opt.selected = true;
    el.appendChild(opt);
  });
  if (currentVal == null || currentVal === '') none.selected = true;
}
// A separate Quill instance from Knowledge Hub's knowledgeQuill (renderer/
// features/knowledge.js) — same vendored library + sanitizeKnowledgeHtml(),
// its own DOM host so the two modules never share editor state.
function financeMeetingQuillPlaceholder() {
  return finT('Write meeting minutes…');
}
function ensureFinanceMeetingQuill() {
  if (financeMeetingQuill) return financeMeetingQuill;
  financeMeetingQuill = new Quill('#fin-meeting-content-editor', {
    theme: 'snow',
    placeholder: financeMeetingQuillPlaceholder(),
    modules: {
      toolbar: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['blockquote', 'code-block'],
        ['link'],
      ],
    },
  });
  document.addEventListener('ct:languagechange', () => financeMeetingQuill.root.setAttribute('data-placeholder', financeMeetingQuillPlaceholder()));
  return financeMeetingQuill;
}
function getFinanceMeetingEditorContent() {
  const quill = ensureFinanceMeetingQuill();
  return quill.getText().trim() ? sanitizeKnowledgeHtml(quill.getSemanticHTML()) : '';
}
function setFinanceMeetingEditorContent(html) {
  const quill = ensureFinanceMeetingQuill();
  quill.setContents(quill.clipboard.convert({ html: sanitizeKnowledgeHtml(html || '') }), 'silent');
}
function openFinanceMeetingModal(m) {
  financeMeetingEditId = m ? m.id : null;
  document.getElementById('finance-meeting-modal-title').textContent = m ? 'Edit Meeting' : 'New Meeting';
  document.getElementById('finance-meeting-modal-submit').textContent = m ? 'Save Changes' : 'Add Meeting';
  document.getElementById('fin-meeting-title').value = m ? (m.title || '') : '';
  document.getElementById('fin-meeting-date').value = m ? (m.meetingDate || '') : '';
  document.getElementById('fin-meeting-location').value = m ? (m.location || '') : '';
  document.getElementById('fin-meeting-attendees').value = m ? (m.attendees || '') : '';
  document.getElementById('fin-meeting-agenda').value = m ? (m.agenda || '') : '';
  populateFinanceContractSelect('fin-meeting-contract', m ? m.contractId : '');
  populateFinanceCrSelect('fin-meeting-cr', m ? m.crId : '');
  setFinanceMeetingEditorContent(m ? m.content : '');
  clearErrorsIn('#finance-meeting-modal');
  document.getElementById('finance-meeting-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('fin-meeting-title').focus(), 80);
}
function closeFinanceMeetingModal() {
  document.getElementById('finance-meeting-modal-overlay').classList.remove('open');
  financeMeetingEditId = null;
}
function financeMeetingOverlayClick(e) {
  if (e.target === document.getElementById('finance-meeting-modal-overlay')) closeFinanceMeetingModal();
}
async function submitFinanceMeetingModal() {
  clearErrorsIn('#finance-meeting-modal');
  const title = document.getElementById('fin-meeting-title').value.trim();
  if (!title) { markError('fin-meeting-title'); return; }
  const contractVal = document.getElementById('fin-meeting-contract').value;
  const crVal = document.getElementById('fin-meeting-cr').value;
  const data = {
    title, meetingDate: document.getElementById('fin-meeting-date').value,
    location: document.getElementById('fin-meeting-location').value.trim(),
    attendees: document.getElementById('fin-meeting-attendees').value.trim(),
    agenda: document.getElementById('fin-meeting-agenda').value.trim(),
    contractId: contractVal ? Number(contractVal) : null,
    crId: crVal ? Number(crVal) : null,
    content: getFinanceMeetingEditorContent(),
  };
  let res;
  try {
    res = financeMeetingEditId != null
      ? await window.api.updateFinanceMeeting(financeMeetingEditId, data)
      : await window.api.createFinanceMeeting(currentFinanceClient.id, data);
  } catch { toast('Could not save meeting'); return; }
  if (!res.ok) { toast(res.error || 'Could not save meeting'); return; }
  closeFinanceMeetingModal();
  toast(financeMeetingEditId != null ? 'Meeting saved' : 'Meeting created');
  await loadFinanceMeetingsForCurrentClient();
  renderFinanceDetailSections();
}
async function deleteFinanceMeetingFlow(id) {
  let res;
  try { res = await window.api.deleteFinanceMeeting(id); }
  catch { toast('Could not delete meeting'); return; }
  if (!res.ok) { toast(res.error || 'Could not delete meeting'); return; }
  financeExpandedMeetings.delete(id);
  await loadFinanceMeetingsForCurrentClient();
  renderFinanceDetailSections();
  const snapshot = res.snapshot;
  const clientId = currentFinanceClient?.id;
  // Attachments on this meeting were already purged server-side (see
  // finance-db.js's purgeFinanceAttachmentsForEntities) — restoring the meeting
  // row does not bring its files back, a deliberate scope limit.
  showGenericUndo('Meeting deleted', async () => {
    try {
      const created = await window.api.createFinanceMeeting(clientId, {
        title: snapshot.title, meetingDate: snapshot.meetingDate, location: snapshot.location,
        attendees: snapshot.attendees, agenda: snapshot.agenda, contractId: snapshot.contractId,
        crId: snapshot.crId, content: snapshot.content,
      });
      if (!created.ok) { toast(created.error || 'Could not restore meeting'); return; }
      const newMeetingId = created.meeting.id;
      for (const a of snapshot.actions) {
        await window.api.createFinanceMeetingAction(newMeetingId, { description: a.description, owner: a.owner, dueDate: a.dueDate });
      }
      toast('Meeting restored');
    } catch { toast('Could not restore meeting'); }
    await loadFinanceMeetingsForCurrentClient();
    renderFinanceDetailSections();
  });
}

// ── Meeting Action Item modal ─────────────────────────────────────────────
function openFinanceMeetingActionModal(meetingId, a) {
  financeMeetingActionModalMeetingId = meetingId;
  financeMeetingActionEditId = a ? a.id : null;
  document.getElementById('finance-meeting-action-modal-title').textContent = a ? 'Edit Action Item' : 'New Action Item';
  document.getElementById('finance-meeting-action-modal-submit').textContent = a ? 'Save Changes' : 'Add Action Item';
  document.getElementById('fin-action-description').value = a ? (a.description || '') : '';
  document.getElementById('fin-action-owner').value = a ? (a.owner || '') : '';
  document.getElementById('fin-action-due').value = a ? (a.dueDate || '') : '';
  clearErrorsIn('#finance-meeting-action-modal');
  document.getElementById('finance-meeting-action-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('fin-action-description').focus(), 80);
}
function closeFinanceMeetingActionModal() {
  document.getElementById('finance-meeting-action-modal-overlay').classList.remove('open');
  financeMeetingActionEditId = null; financeMeetingActionModalMeetingId = null;
}
function financeMeetingActionOverlayClick(e) {
  if (e.target === document.getElementById('finance-meeting-action-modal-overlay')) closeFinanceMeetingActionModal();
}
async function submitFinanceMeetingActionModal() {
  clearErrorsIn('#finance-meeting-action-modal');
  const description = document.getElementById('fin-action-description').value.trim();
  if (!description) { markError('fin-action-description'); return; }
  const data = {
    description, owner: document.getElementById('fin-action-owner').value.trim(),
    dueDate: document.getElementById('fin-action-due').value,
  };
  let res;
  try {
    res = financeMeetingActionEditId != null
      ? await window.api.updateFinanceMeetingAction(financeMeetingActionEditId, data)
      : await window.api.createFinanceMeetingAction(financeMeetingActionModalMeetingId, data);
  } catch { toast('Could not save action item'); return; }
  if (!res.ok) { toast(res.error || 'Could not save action item'); return; }
  closeFinanceMeetingActionModal();
  toast(financeMeetingActionEditId != null ? 'Action item saved' : 'Action item added');
  await loadFinanceMeetingsForCurrentClient();
  renderFinanceDetailSections();
}
async function toggleFinanceMeetingActionFlow(id) {
  let res;
  try { res = await window.api.toggleFinanceMeetingActionStatus(id); }
  catch { toast('Could not update action item'); return; }
  if (!res.ok) { toast(res.error || 'Could not update action item'); return; }
  await loadFinanceMeetingsForCurrentClient();
  renderFinanceDetailSections();
}
async function deleteFinanceMeetingActionFlow(id, meetingId) {
  let res;
  try { res = await window.api.deleteFinanceMeetingAction(id); }
  catch { toast('Could not delete action item'); return; }
  if (!res.ok) { toast(res.error || 'Could not delete action item'); return; }
  await loadFinanceMeetingsForCurrentClient();
  renderFinanceDetailSections();
  const snapshot = res.snapshot;
  showGenericUndo('Action item deleted', async () => {
    try {
      // Identify the just-restored row by set difference (before/after ids),
      // not by matching on description text — two action items can share the
      // same wording, and a text match would risk flipping the wrong one to
      // DONE (see test/finance-it-smoke.js's payment-id-diff pattern for the
      // same reasoning applied to payments).
      const before = await window.api.getFinanceMeeting(meetingId);
      const beforeIds = new Set((before?.actions || []).map(a => a.id));
      const created = await window.api.createFinanceMeetingAction(meetingId, {
        description: snapshot.description, owner: snapshot.owner, dueDate: snapshot.dueDate,
      });
      if (!created.ok) { toast(created.error || 'Could not restore action item'); return; }
      if (snapshot.status === 'DONE') {
        const match = created.meeting.actions.find(a => !beforeIds.has(a.id));
        if (match) await window.api.toggleFinanceMeetingActionStatus(match.id);
      }
      toast('Action item restored');
    } catch { toast('Could not restore action item'); }
    await loadFinanceMeetingsForCurrentClient();
    renderFinanceDetailSections();
  });
}

// ── Setup tab — Finance's own catalog editor (finance_lookups), separate from
// the app-wide Settings page ───────────────────────────────────────────────
function finMoveDraftEntry(arr, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
// ── Settings → Finance ───────────────────────────────────────────────────────
// Finance's catalog is finance_lookups, not lookup_codes, so this tab is
// hand-authored in index.html rather than generated from settings-registry.js
// — the same exception Backup Data is. It used to be a Setup tab inside the
// Finance module; app settings belong in app Settings.
async function renderFinanceSetupTab() {
  const panel = document.getElementById('finance-setup-host');
  if (!panel) return;
  panel.innerHTML = '';
  const sectionsHost = finMk('div', 'fin-setup-host');
  sectionsHost.id = 'finance-setup-sections';
  panel.appendChild(sectionsHost);
  financeLookupsDraft = null;
  financeSetupDirty = false;
  await ensureFinanceLookups();
  renderFinanceDetailSections();
}
function renderFinanceSetupSection(host) {
  if (!financeLookupsDraft) financeLookupsDraft = JSON.parse(JSON.stringify(financeLookups?.categories || {}));

  const wrap = finMk('div', 'fin-setup');
  wrap.appendChild(finMk('p', 'fin-setup-intro',
    'Finance’s own catalog, separate from the app’s shared lookups. Add, relabel, reorder, or disable values here.'));

  Object.keys(FINANCE_SETUP_CATEGORY_LABELS).forEach(cat => {
    const panel = finMk('div', 'fin-setup-panel');
    panel.appendChild(finMk('div', 'fin-setup-panel-title', FINANCE_SETUP_CATEGORY_LABELS[cat]));
    const list = finMk('div', 'fin-setup-list');
    const arr = financeLookupsDraft[cat] || (financeLookupsDraft[cat] = []);
    arr.forEach((opt, i) => list.appendChild(buildFinanceSetupRow(arr, i)));
    panel.appendChild(list);
    const addBtn = finMk('button', 'fin-mini-btn'); addBtn.innerHTML = ic('plus') + ' Add Entry';
    addBtn.addEventListener('click', () => {
      arr.push({ labelEn: '', labelAr: '', isActive: true, sortOrder: arr.length });
      financeSetupDirty = true;
      renderFinanceDetailSections();
    });
    panel.appendChild(addBtn);
    wrap.appendChild(panel);
  });

  const footer = finMk('div', 'fin-setup-footer');
  const saveBtn = finMk('button', 'btn primary', 'Save Catalog');
  saveBtn.id = 'finance-setup-save-btn';
  saveBtn.disabled = !financeSetupDirty;
  saveBtn.addEventListener('click', saveFinanceSetupCatalog);
  footer.appendChild(saveBtn);
  const unsavedLabel = finMk('span', 'fin-setup-unsaved', 'Unsaved changes');
  unsavedLabel.id = 'finance-setup-unsaved-label';
  unsavedLabel.hidden = !financeSetupDirty;
  footer.appendChild(unsavedLabel);
  wrap.appendChild(footer);

  host.appendChild(wrap);
}
// Typing in a label field marks the draft dirty without a full re-render (a
// full renderFinanceDetailSections() would rebuild every row and steal focus out
// from under the input mid-keystroke) — just flip the Save button + "Unsaved
// changes" label directly instead.
function finMarkFinanceSetupDirty() {
  financeSetupDirty = true;
  const saveBtn = document.getElementById('finance-setup-save-btn');
  if (saveBtn) saveBtn.disabled = false;
  const label = document.getElementById('finance-setup-unsaved-label');
  if (label) label.hidden = false;
}
function buildFinanceSetupRow(arr, i) {
  const opt = arr[i];
  const row = finMk('div', 'fin-setup-row' + (opt.isActive === false ? ' inactive' : ''));
  const enInput = document.createElement('input');
  enInput.type = 'text'; enInput.placeholder = 'English label'; enInput.value = opt.labelEn || ''; enInput.dir = 'ltr';
  enInput.addEventListener('input', e => { opt.labelEn = e.target.value; finMarkFinanceSetupDirty(); });
  row.appendChild(enInput);
  const arInput = document.createElement('input');
  arInput.type = 'text'; arInput.placeholder = 'التسمية بالعربية'; arInput.value = opt.labelAr || ''; arInput.dir = 'rtl';
  arInput.addEventListener('input', e => { opt.labelAr = e.target.value; finMarkFinanceSetupDirty(); });
  row.appendChild(arInput);
  // Same read-only code chip the shared Settings catalog shows, and the same
  // wording for a row that has not been saved a code yet.
  row.appendChild(finMk('span', 'fin-setup-code', opt.code || 'new entry'));

  const reorder = finMk('div', 'fin-setup-reorder');
  const up = finMk('button', 'fin-icon-btn'); up.type = 'button'; up.innerHTML = ic('chevron-up'); up.title = 'Move up'; up.disabled = i === 0;
  up.addEventListener('click', () => { finMoveDraftEntry(arr, i, -1); financeSetupDirty = true; renderFinanceDetailSections(); });
  const down = finMk('button', 'fin-icon-btn'); down.type = 'button'; down.innerHTML = ic('chevron-down'); down.title = 'Move down'; down.disabled = i === arr.length - 1;
  down.addEventListener('click', () => { finMoveDraftEntry(arr, i, 1); financeSetupDirty = true; renderFinanceDetailSections(); });
  reorder.appendChild(up); reorder.appendChild(down);
  row.appendChild(reorder);

  const toggleBtn = finMk('button', 'fin-icon-btn' + (opt.isActive === false ? '' : ' danger'));
  toggleBtn.type = 'button';
  toggleBtn.innerHTML = ic(opt.isActive === false ? 'circle-check' : 'ban');
  toggleBtn.title = opt.isActive === false ? 'Re-enable' : 'Disable (hide from dropdowns)';
  toggleBtn.addEventListener('click', () => {
    if (opt.id == null) arr.splice(i, 1); // never-saved new row — just drop it
    else opt.isActive = opt.isActive === false;
    financeSetupDirty = true;
    renderFinanceDetailSections();
  });
  row.appendChild(toggleBtn);
  return row;
}
async function saveFinanceSetupCatalog() {
  const categories = {};
  Object.entries(financeLookupsDraft).forEach(([cat, arr]) => {
    categories[cat] = arr.filter(o => (o.labelEn || '').trim()).map((o, i) => ({ ...o, sortOrder: i }));
  });
  let res;
  try { res = await window.api.saveFinanceLookups({ categories }); }
  catch { toast('Could not save catalog'); return; }
  if (!res.ok) { toast('Could not save catalog'); return; }
  toast('Catalog saved');
  financeSetupDirty = false;
  try { financeLookups = await window.api.listFinanceLookups(); } catch { /* keep prior cache */ }
  financeLookupsDraft = null;
  renderFinanceDetailSections();
}

// ── Create Hub entry points (Ctrl+Shift+N) ──────────────────────────────────
// The contract/invoice modals assume currentFinanceClient is already set,
// because normally you reach them from inside a client's Finance tab. The
// Create Hub can fire from anywhere, so these resolve a client first, walk to
// that client's page, and only then open the modal.
//
// One client: skip the question entirely and go straight there. Several: reuse
// the command palette's own picker rather than inventing a second one. None:
// say so, because "New Contract" with no client to hang it on is a dead end.
async function startFinanceCreation(kind) {
  await ensureFinanceClientsCache();

  if (!financeClients.length) {
    switchModule('clients');
    toast('Set Finance up on a client first');
    return;
  }

  const open = async (clientId) => {
    const fc = financeClients.find(c => c.id === clientId);
    if (!fc || fc.companyId == null) { toast('Could not open client'); return; }
    await openClientFinance(fc.companyId, kind === 'invoice' ? 'invoices' : 'contracts');
    if (kind === 'invoice') openFinanceInvoiceModal();
    else openFinanceContractModal();
  };

  if (financeClients.length === 1) { await open(financeClients[0].id); return; }
  openFinanceClientPicker(kind, open);
}

// The one way into a client's financial records from anywhere else in the app
// — the Create Hub, Quick Find, and the Overview attention list all land here.
// There is no Finance page to switch to: this walks to the client instead.
async function openClientFinance(companyId, subTab) {
  // A finance profile with no company link should not exist after migration
  // 056, but a half-migrated row would have nowhere to navigate to.
  if (companyId == null) { switchModule('clients'); return; }
  if (subTab && FINANCE_DETAIL_TABS.some(t => t.key === subTab)) financeDetailTab = subTab;
  switchModule('clients');
  await openClientDetail(companyId, '', subTab === 'meetings' ? 'meetings' : 'finance');
}
// Resolves a Finance client id (what a search hit or an attention item carries)
// to the company whose page now owns it.
async function openFinanceRecordByClientId(financeClientId, subTab) {
  await ensureFinanceClientsCache();
  const fc = financeClients.find(c => c.id === financeClientId);
  if (!fc || fc.companyId == null) { switchModule('clients'); return; }
  await openClientFinance(fc.companyId, subTab);
}

// Lightweight inline picker built on the shared modal shell, so it inherits the
// focus trap, Escape handling and initial focus from watchModalFocusTraps().
function openFinanceClientPicker(kind, onPick) {
  const overlay = document.getElementById('finance-picker-modal-overlay');
  const list = document.getElementById('finance-picker-list');
  document.getElementById('finance-picker-modal-title').textContent =
    kind === 'invoice' ? 'New Invoice — pick a client' : 'New Contract — pick a client';
  list.innerHTML = '';
  financeClients.forEach(c => {
    const btn = finMk('button', 'fin-picker-row', finClientName(c));
    btn.type = 'button';
    btn.addEventListener('click', () => { closeFinanceClientPicker(); onPick(c.id); });
    list.appendChild(btn);
  });
  overlay.classList.add('open');
}
function closeFinanceClientPicker() {
  document.getElementById('finance-picker-modal-overlay').classList.remove('open');
}
function financePickerOverlayClick(e) {
  if (e.target === document.getElementById('finance-picker-modal-overlay')) closeFinanceClientPicker();
}
