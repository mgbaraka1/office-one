// ══ PROJECT & FINANCE — Offers & CRs ═════════════════════════════════════════
// One list of Offers and Change Requests (private to this login), each with a
// user-typed Reference ID, a status that walks the PFM_STATUS catalog, and one
// who/when stage per status. The list loads once with archived rows included
// and filters client-side, so the status chips always show honest counts for
// whatever the other filters leave.
//
// Status logic compares CODES only. The flow (migration 074) runs Prepare →
// Ready → Sent → Accepted → UAT Approved → Production Approved → Invoiced →
// Invoice Paid; Rejected is the other way out of Sent (never after Accepted).
// Invoice Paid and Rejected are final. The track follows the catalog's own
// order, so a status the user adds in Settings (e.g. "On Hold") appears in it.
let pfmItems = [];
let pfmLoaded = false;
let pfmCurrent = null;            // the item open in the detail view, or null
let pfmMemberNames = [];
const pfmFilter = { statuses: [], kind: '', companyId: '', search: '', archived: false };
const pfmSort = { key: '', dir: 1 };   // key '' = the server's order (newest update first)
let pfmView = 'table';            // 'table' | 'pipeline'
const PFM_STALE_DAYS = 30;        // an open item untouched this long is flagged in the pipeline
let pfmDragItem = null;           // the pipeline card being dragged, or null
let pfmModalEditId = null;        // null = create mode
let pfmStageCtx = null;           // { mode: 'move' | 'edit', status }
let pfmVersionEditId = null;      // null = new version
let pfmFileErrors = new Map();    // versionId → [{ name, error }] from the last "Add files"
let _pfmSaveTimer = null;

const PFM_FINAL = new Set(['PAID', 'REJECTED']);
let pfmStageFileErrors = new Map(); // status code → [{ name, error }] from the last stage "Add files"

function initPfmModule() {
  showPfmListView();
  loadPfmList();
  loadPfmMemberNames();
}

// ── Small helpers ──
function pfmKindLabel(kind) { return kind === 'CR' ? 'CR' : 'Offer'; }
function pfmStatusOptions() { return lkOptions('PFM_STATUS'); }
function pfmStatusName(code) { return lkLabel('PFM_STATUS', code) || code || ''; }
// Accepted or any stage after it — Rejected included, since it sorts last.
// What is not decided yet is the open pipeline.
function pfmIsDecided(code) {
  const codes = pfmStatusOptions().map(o => o.code);
  const accepted = codes.indexOf('ACCEPTED');
  return accepted >= 0 && codes.indexOf(code) >= accepted;
}
// The step a list row shows: the one waiting on someone (first not-done stage
// with a person or note), else the current status. Status chips still count
// by the real current status.
function pfmRowStep(i) {
  const next = i.nextStep;
  return next
    ? { status: next.status, done: false, person: next.memberName, note: next.note }
    : { status: i.status, done: !!i.currentDone, person: i.currentMember || '', note: i.currentNote || '' };
}
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
// Status chips are multi-select: each click toggles one status in or out;
// "All" clears the set.
function setPfmStatusFilter(code) {
  if (!code) pfmFilter.statuses = [];
  else if (pfmFilter.statuses.includes(code)) pfmFilter.statuses = pfmFilter.statuses.filter(c => c !== code);
  else pfmFilter.statuses = [...pfmFilter.statuses, code];
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
    && textMatch([i.reference, i.title, lkLabelById('COMPANY', i.companyId) || i.company, i.contactName, i.currentMember, i.currentNote, i.nextStep?.memberName, i.nextStep?.note],
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
    const on = code ? pfmFilter.statuses.includes(code) : !pfmFilter.statuses.length;
    const b = pjMk('button', 'pfm-chip' + (on ? ' active' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
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

// Column header click: ascending → descending → back to the default order.
function setPfmSort(key) {
  if (pfmSort.key !== key) { pfmSort.key = key; pfmSort.dir = 1; }
  else if (pfmSort.dir === 1) pfmSort.dir = -1;
  else pfmSort.key = '';
  renderPfmList();
}
function renderPfmSortHeaders() {
  document.querySelectorAll('#pfm-table th[data-pfm-sort]').forEach(th => {
    const on = th.dataset.pfmSort === pfmSort.key;
    if (on) th.setAttribute('aria-sort', pfmSort.dir === 1 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });
}
// The value each column sorts by — what the row shows, not the raw field.
// Status follows the catalog's own order, so it reads as the stage track does.
function pfmSortValue(i, key) {
  switch (key) {
    case 'reference': return i.reference || '';
    case 'title': return i.title || '';
    case 'client': return lkLabelById('COMPANY', i.companyId) || i.company || '';
    case 'kind': return pfmKindLabel(i.kind);
    case 'status': {
      const codes = pfmStatusOptions().map(o => o.code);
      const at = codes.indexOf(pfmRowStep(i).status);
      return at < 0 ? codes.length : at;
    }
    case 'fees': return i.currentVersion?.feesMinor ?? null;
    case 'person': return pfmRowStep(i).person || '';
    case 'updated': return i.updatedAt || '';
    default: return '';
  }
}
function pfmSortRows(rows) {
  if (!pfmSort.key) return rows;
  const key = pfmSort.key, dir = pfmSort.dir;
  return rows
    .map(i => ({ i, v: pfmSortValue(i, key) }))
    .sort((a, b) => {
      // Blanks always sink to the bottom, whichever way the column runs.
      const ae = a.v === '' || a.v == null, be = b.v === '' || b.v == null;
      if (ae || be) return ae === be ? 0 : ae ? 1 : -1;
      const c = typeof a.v === 'number' && typeof b.v === 'number'
        ? a.v - b.v
        : String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: 'base' });
      return c * dir;
    })
    .map(x => x.i);
}

// Exactly the rows the table shows, in the order it shows them (every filter,
// status chip included) — the Excel export follows the same order.
function pfmVisibleRows(base = pfmBaseRows()) {
  const picked = pfmFilter.statuses;
  return pfmSortRows(picked.length ? base.filter(i => picked.includes(i.status)) : base);
}

function renderPfmList() {
  if (!pfmLoaded) return;
  renderPfmClientFilter();
  const base = pfmBaseRows();
  renderPfmStatusChips(base);
  const rows = pfmVisibleRows(base);
  renderPfmExportMenu(rows.length);
  renderPfmSortHeaders();

  const table = document.getElementById('pfm-table');
  const body = document.getElementById('pfm-tbody');
  const empty = document.getElementById('pfm-empty-state');
  const pipeline = document.getElementById('pfm-pipeline');
  // The pipeline's columns are the status breakdown, so it has no chips.
  document.getElementById('pfm-status-chips').hidden = pfmView === 'pipeline';
  body.innerHTML = '';
  pipeline.hidden = true;
  if (!rows.length) {
    table.style.display = 'none';
    empty.hidden = false;
    const p = empty.querySelector('p');
    if (!pfmItems.length) p.innerHTML = 'No offers or CRs yet — click <strong>+ New Offer</strong> to add one';
    else p.textContent = 'Nothing matches these filters';
    return;
  }
  empty.hidden = true;
  if (pfmView === 'pipeline') {
    table.style.display = 'none';
    pipeline.hidden = false;
    renderPfmPipeline(pipeline, rows);
    return;
  }
  table.style.display = '';
  rows.forEach(i => body.appendChild(buildPfmRow(i)));
}

// ── Pipeline: one column per status, with the money in each ──
// Table ↔ Pipeline. The pipeline shows every status, so a status chip picked
// in the table is dropped rather than left filtering out of sight (the Excel
// export follows what is shown).
function setPfmView(view) {
  pfmView = view === 'pipeline' ? 'pipeline' : 'table';
  if (pfmView === 'pipeline') pfmFilter.statuses = [];
  document.querySelectorAll('#pfm-view-ctl .seg-btn').forEach(b => {
    const active = b.dataset.view === pfmView;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  renderPfmList();
}

// Sums an item list's current fees per currency, largest first. Items with no
// fees yet are counted apart rather than read as zero.
function pfmTotalsByCurrency(items) {
  const totals = new Map();
  let unpriced = 0;
  items.forEach(i => {
    const v = i.currentVersion;
    if (!v || v.feesMinor == null) { unpriced++; return; }
    const cur = v.currency || '';
    totals.set(cur, (totals.get(cur) || 0) + v.feesMinor);
  });
  return { list: [...totals].map(([currency, minor]) => ({ currency, minor })).sort((a, b) => b.minor - a.minor), unpriced };
}
function pfmMoney(minor, currency) { return pfmFees({ feesMinor: minor, currency }); }
function pfmDaysSince(value) {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? 0 : Math.floor((Date.now() - t) / 86_400_000);
}
// Stage colour: the seeded statuses use their pill's colour; one added in
// Settings has no colour of its own and stays neutral.
function pfmStageClass(code) {
  return ['READY', 'SENT', 'ACCEPTED', 'UAT_APPROVED', 'PRODUCTION_APPROVED', 'INVOICED', 'PAID', 'REJECTED'].includes(code)
    ? 'pfm-stage-' + code.toLowerCase() : 'pfm-stage-other';
}

function renderPfmPipeline(host, rows) {
  host.innerHTML = '';
  const codes = pfmStatusOptions().map(o => o.code);
  rows.forEach(i => { if (i.status && !codes.includes(i.status)) codes.push(i.status); });
  const byStatus = new Map(codes.map(code => [code, rows.filter(i => i.status === code)]));
  host.appendChild(buildPfmValueSummary(codes, byStatus, rows));

  // Each card's bar is its fees against the largest one in the same currency.
  const maxByCurrency = new Map();
  rows.forEach(i => {
    const v = i.currentVersion;
    if (v && v.feesMinor != null) maxByCurrency.set(v.currency || '', Math.max(maxByCurrency.get(v.currency || '') || 0, v.feesMinor));
  });

  // A card can be dropped on any active status but its own; a status
  // soft-disabled in Settings keeps its column but takes no moves.
  const movable = new Set(pfmStatusOptions().map(o => o.code));
  const cols = pjMk('div', 'pfm-pipe-cols');
  codes.forEach(code => {
    const items = byStatus.get(code);
    const col = pjMk('section', 'pfm-pipe-col ' + pfmStageClass(code));
    col.setAttribute('aria-label', pfmStatusName(code));
    const accepts = () => pfmDragItem && pfmDragItem.status !== code && movable.has(code);
    col.addEventListener('dragover', e => {
      if (!accepts()) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('is-drop-target');
    });
    col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('is-drop-target'); });
    col.addEventListener('drop', e => {
      col.classList.remove('is-drop-target');
      if (!accepts()) return;
      e.preventDefault();
      const item = pfmDragItem;
      pfmDragItem = null;
      pfmDropOnStage(item.id, code);
    });
    const head = pjMk('div', 'pfm-pipe-head');
    const top = pjMk('div', 'pfm-pipe-head-top');
    top.append(pfmStatusPill(code), pjMk('span', 'pfm-chip-count', String(items.length)));
    head.appendChild(top);
    const { list, unpriced } = pfmTotalsByCurrency(items);
    list.forEach(t => head.appendChild(pfmUserText('div', 'pfm-pipe-total', pfmMoney(t.minor, t.currency))));
    if (unpriced) {
      head.appendChild(pjMk('div', 'pfm-pipe-unpriced',
        window.ctI18n?.t?.('{n} without fees', { n: unpriced }) || `${unpriced} without fees`));
    }
    col.appendChild(head);
    const cards = pjMk('div', 'pfm-pipe-cards');
    if (!items.length) cards.appendChild(pjMk('div', 'pfm-pipe-empty', 'Nothing here'));
    items.forEach(i => cards.appendChild(buildPfmPipeCard(i, maxByCurrency)));
    col.appendChild(cards);
    cols.appendChild(col);
  });
  host.appendChild(cols);
}

// "Value by stage": one bar per currency, split by status. Open value (every
// status before Accepted — not yet won or rejected) is the headline, since that is what is still
// in play. Each segment names its status and amount on hover.
function buildPfmValueSummary(codes, byStatus, rows) {
  const box = pjMk('div', 'pfm-pipe-summary');
  const open = pfmTotalsByCurrency(rows.filter(i => !pfmIsDecided(i.status))).list;
  const headline = pjMk('div', 'pfm-pipe-headline');
  headline.appendChild(pjMk('span', 'pfm-pipe-headline-label', 'Open value'));
  if (!open.length) headline.appendChild(pjMk('span', 'pfm-pipe-headline-value', '—'));
  open.forEach(t => headline.appendChild(pfmUserText('span', 'pfm-pipe-headline-value', pfmMoney(t.minor, t.currency))));
  box.appendChild(headline);

  pfmTotalsByCurrency(rows).list.forEach(({ currency, minor: total }) => {
    if (!total) return;
    const bar = pjMk('div', 'pfm-pipe-bar');
    bar.setAttribute('role', 'img');
    const parts = [];
    codes.forEach(code => {
      const amount = byStatus.get(code)
        .filter(i => i.currentVersion?.feesMinor != null && (i.currentVersion.currency || '') === currency)
        .reduce((sum, i) => sum + i.currentVersion.feesMinor, 0);
      if (!amount) return;
      const seg = pjMk('span', 'pfm-pipe-seg ' + pfmStageClass(code));
      seg.style.flexGrow = String(amount);
      const label = pfmStatusName(code) + ': ' + pfmMoney(amount, currency) + ' (' + Math.round(amount / total * 100) + '%)';
      seg.title = label;
      seg.dataset.userContent = '';
      parts.push(label);
      bar.appendChild(seg);
    });
    bar.setAttribute('aria-label', parts.join(', '));
    // Each currency's bar is named by its total, so two bars never read as one scale.
    const row = pjMk('div', 'pfm-pipe-bar-row');
    row.append(pfmUserText('span', 'pfm-pipe-bar-total', pfmMoney(total, currency)), bar);
    box.appendChild(row);
  });

  const legend = pjMk('div', 'pfm-pipe-legend');
  codes.forEach(code => {
    const key = pjMk('span', 'pfm-pipe-key ' + pfmStageClass(code));
    key.appendChild(pjMk('i'));
    key.appendChild(pfmUserText('span', '', pfmStatusName(code)));
    legend.appendChild(key);
  });
  box.appendChild(legend);
  return box;
}

// A drop opens the same "Move to" window as the detail page, for the full
// record (the list row carries no stages to prefill from). Nothing moves
// until it is confirmed there; Cancel leaves the card where it was.
async function pfmDropOnStage(id, code) {
  let item;
  try { item = await window.api.getPfmItem(id); }
  catch { toast('Could not open this offer or CR'); return; }
  if (!item) { toast('This offer or CR no longer exists'); loadPfmList(); return; }
  openPfmStageModal('move', code, item);
}

function buildPfmPipeCard(i, maxByCurrency) {
  const card = pjMk('button', 'pfm-pipe-card' + (i.archived ? ' archived' : ''));
  card.type = 'button';
  card.dataset.pfmId = i.id;
  card.addEventListener('click', () => openPfmDetail(i.id));
  card.draggable = true;
  card.title = 'Drag to another stage to move it';
  card.addEventListener('dragstart', e => {
    pfmDragItem = i;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i.id));
    card.classList.add('is-dragging');
    document.getElementById('pfm-pipeline').classList.add('is-dragging');
  });
  card.addEventListener('dragend', () => {
    pfmDragItem = null;
    card.classList.remove('is-dragging');
    const host = document.getElementById('pfm-pipeline');
    host.classList.remove('is-dragging');
    host.querySelectorAll('.is-drop-target').forEach(c => c.classList.remove('is-drop-target'));
  });

  const top = pjMk('div', 'pfm-pipe-card-top');
  top.appendChild(pfmUserText('span', 'pfm-ref', i.reference));
  top.appendChild(pjMk('span', 'pfm-kind pfm-kind-' + i.kind.toLowerCase(), pfmKindLabel(i.kind)));
  if (i.archived) top.appendChild(pjMk('span', 'pfm-archived-tag', 'Archived'));
  card.appendChild(top);
  card.appendChild(pfmUserText('div', 'pfm-pipe-title', i.title));
  const client = lkLabelById('COMPANY', i.companyId) || i.company;
  if (client) card.appendChild(pfmUserText('div', 'pfm-pipe-client', client));

  const v = i.currentVersion;
  if (v && v.feesMinor != null) {
    card.appendChild(pfmUserText('div', 'pfm-pipe-fees pfm-fees', pfmFees(v)));
    const max = maxByCurrency.get(v.currency || '') || 0;
    const track = pjMk('div', 'pfm-pipe-track');
    const fill = pjMk('span', 'pfm-pipe-fill');
    fill.style.width = (max ? Math.max(2, v.feesMinor / max * 100) : 0) + '%';
    track.appendChild(fill);
    card.appendChild(track);
  }

  const step = pfmRowStep(i);
  const foot = pjMk('div', 'pfm-pipe-foot');
  if (step.person) foot.appendChild(pfmUserText('span', '', step.person));
  foot.appendChild(pjMk('span', 'pfm-muted', pfmFmtDate(i.updatedAt)));
  card.appendChild(foot);

  const idle = pfmDaysSince(i.updatedAt);
  if (!PFM_FINAL.has(i.status) && !i.archived && idle >= PFM_STALE_DAYS) {
    const stale = pjMk('div', 'pfm-pipe-stale');
    stale.innerHTML = ic('clock');
    stale.appendChild(document.createTextNode(
      window.ctI18n?.t?.('No update for {n} days', { n: idle }) || `No update for ${idle} days`));
    card.appendChild(stale);
  }
  return card;
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
  const step = pfmRowStep(i);
  const titleCell = td(pfmUserText('span', 'pfm-cell-title', i.title));
  // The step's note, one line; full text on hover.
  if (step.note) {
    const note = pfmUserText('span', 'pfm-cell-note', step.note);
    note.title = step.note;
    titleCell.appendChild(note);
  }
  td(pfmUserText('span', '', lkLabelById('COMPANY', i.companyId) || i.company));
  td(pjMk('span', 'pfm-kind pfm-kind-' + i.kind.toLowerCase(), pfmKindLabel(i.kind)));
  const statusStack = pjMk('div', 'pfm-status-stack');
  statusStack.append(pfmStatusPill(step.status),
    pjMk('span', 'pfm-step-state ' + (step.done ? 'is-done' : 'is-pending'), step.done ? '✓ Done' : 'Not done yet'));
  td(statusStack);
  td(pfmUserText('span', 'pfm-fees', pfmFees(i.currentVersion)));
  td(pfmUserText('span', '', step.person));
  td(pjMk('span', 'pfm-muted', pfmFmtDate(i.updatedAt)));
  return tr;
}

// "Export ▾": the Excel alone, or a ZIP with the Excel plus the newest
// version's files of every row, in one folder per client.
function renderPfmExportMenu(rowCount) {
  const slot = document.getElementById('pfm-export-slot'); if (!slot) return;
  if (!slot.firstChild) {
    const menu = buildKnowledgeOverflow([
      { label: 'Excel only', run: () => exportPfmExcel(false) },
      { label: 'Excel + latest files (ZIP)', run: () => exportPfmExcel(true) },
    ], 'Export ▾');
    const trigger = menu.querySelector('button');
    trigger.id = 'pfm-export-btn';
    trigger.classList.remove('small');
    trigger.title = 'Export what the filters show';
    trigger.insertAdjacentHTML('afterbegin', ic('download'));
    slot.appendChild(menu);
  }
  document.getElementById('pfm-export-btn').disabled = !rowCount;
}

// ── Excel export of the current view (plan E8) ──
// Labels are translated here (rptText), because the workbook is built in the
// main process where the DOM translation pass never runs.
async function exportPfmExcel(withFiles) {
  if (!pfmLoaded) return;
  const rows = pfmVisibleRows();
  if (!rows.length) { toast('Nothing to export'); return; }
  const tr = key => rptText(key);
  const filters = [];
  if (pfmFilter.kind) filters.push(tr(pfmFilter.kind === 'CR' ? 'CRs' : 'Offers'));
  if (pfmFilter.statuses.length) filters.push(pfmFilter.statuses.map(pfmStatusName).join(', '));
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
      status: tr('Status'), done: tr('Done?'), person: tr('Person'), note: tr('Notes'),
      fees: tr('Fees'), currency: tr('Currency'), version: tr('Version'), validUntil: tr('Valid until'), updated: tr('Updated'),
    },
    rows: rows.map(i => {
      const step = pfmRowStep(i);
      return {
        reference: i.reference, kind: tr(pfmKindLabel(i.kind)), title: i.title,
        client: lkLabelById('COMPANY', i.companyId) || i.company || '', status: pfmStatusName(step.status),
        done: tr(step.done ? '✓ Done' : 'Not done yet'), person: step.person, note: step.note,
        fees: i.currentVersion?.feesMinor == null ? null : i.currentVersion.feesMinor / 100,
        currency: i.currentVersion?.currency || '', version: i.currentVersion?.label || '',
        validUntil: i.validUntil || '', updated: String(i.updatedAt || '').slice(0, 10),
      };
    }),
  };
  let res;
  // File name reads "Offers and CRs dd-MM-yyyy" — pfmLocalToday() is yyyy-MM-dd.
  const stamp = pfmLocalToday().split('-').reverse().join('-');
  if (withFiles) {
    // Folder and file names follow the app language, like the Excel.
    const base = rptLanguage() === 'ar' ? tr('Offers & CRs') : 'Offers and CRs';
    const items = rows.map(i => ({ id: i.id, client: lkLabelById('COMPANY', i.companyId) || i.company || '' }));
    try { res = await window.api.exportPfmZip(data, items, base + ' ' + stamp + '.zip'); }
    catch { res = { ok: false, error: 'failed' }; }
    if (res?.ok) toast(res.skipped ? `Saved Excel + ${res.count} files · ${res.skipped} missing skipped` : `Saved Excel + ${res.count} files`);
    else if (!res?.canceled) toast('ZIP export failed: ' + (res?.error || 'failed'));
    return;
  }
  try { res = await window.api.exportPfmExcel(data, 'Offers and CRs ' + stamp + '.xlsx'); }
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

// The optional Project: this login's projects that the chosen client is on.
// Loaded once per modal open; a client change re-filters and drops a project
// that is not on the new client.
let pfmProjectChoices = [];
async function loadPfmProjectChoices() {
  try { pfmProjectChoices = (await window.api.listProjects()) || []; }
  catch { pfmProjectChoices = []; }
}
function populatePfmProjectSelect(companyId, currentId) {
  const sel = document.getElementById('pfm-project');
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = ''; none.textContent = 'No project';
  sel.appendChild(none);
  const mine = pfmProjectChoices.filter(p => (p.companies || []).some(c => Number(c.id) === Number(companyId)));
  mine.forEach(p => {
    const o = document.createElement('option');
    o.dataset.userContent = ''; o.value = String(p.id); o.textContent = p.name;
    sel.appendChild(o);
  });
  sel.value = mine.some(p => Number(p.id) === Number(currentId)) ? String(currentId) : '';
  sel.disabled = !companyId;
}
function pfmCompanyChanged() {
  populatePfmProjectSelect(Number(document.getElementById('pfm-company').value) || null,
    Number(document.getElementById('pfm-project').value) || null);
}

// `preset` on create: { kind, companyId, projectId } (the client tab passes
// its client, the project page its client and itself).
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
  // The modal opens at once; the project list fills in when it has loaded,
  // for whichever client is chosen by then.
  const wantedProject = item ? item.projectId : preset.projectId;
  populatePfmProjectSelect(item ? item.companyId : preset.companyId, wantedProject);
  loadPfmProjectChoices().then(() => {
    const sel = document.getElementById('pfm-project');
    populatePfmProjectSelect(Number(document.getElementById('pfm-company').value) || null,
      Number(sel.value) || wantedProject);
  });
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
    projectId: Number(document.getElementById('pfm-project').value) || null,
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
    else if (/project/i.test(msg)) markError('pfm-project', msg);
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
  projectPfmFor = null;
  if (item && pfmCurrent && pfmCurrent.id === item.id) { pfmCurrent = item; renderPfmDetail(); }
  if (activeModule === 'pfm' && !pfmCurrent) loadPfmList();
  if (activeModule === 'clients' && currentClient) loadClientPfmRows(currentClient.id);
  if (activeModule === 'projects' && currentProject) loadProjectPfmRows(currentProject.id);
}

// ══ PROJECT PAGE — "Offers & CRs" (migration 074) ══
// The Offers and CRs linked to the open project, with their stage and
// documents a click away. Fetched per project open, like the client tab.
let projectPfmRows = [];
let projectPfmFor = null;         // project id projectPfmRows belongs to, or null = stale
let projectPfmHost = null;        // the section element to refill
async function loadProjectPfmRows(projectId) {
  let rows;
  try { rows = await window.api.listPfmItems({ projectId, includeArchived: true }); }
  catch { rows = []; }
  if (!currentProject || currentProject.id !== projectId) return;
  projectPfmRows = Array.isArray(rows) ? rows : [];
  projectPfmFor = projectId;
  if (projectPfmHost?.isConnected) projectPfmHost.replaceWith(buildProjectPfmSection(currentProject));
}
function buildProjectPfmSection(p) {
  const rows = projectPfmFor === p.id ? projectPfmRows : [];
  const section = pjMk('div', 'pj-section');
  projectPfmHost = section;
  const head = pjMk('div', 'pj-section-head');
  const title = pjMk('div', 'pj-section-title');
  title.innerHTML = ic('briefcase');
  title.appendChild(document.createTextNode('Offers & CRs (' + rows.length + ')'));
  head.appendChild(title);
  const acts = pjMk('div', 'pj-section-actions');
  const companyId = (p.companies || [])[0]?.id ?? null;
  [['CR', 'New CR', ''], ['OFFER', 'New Offer', 'primary']].forEach(([kind, label, emphasis]) => {
    const b = pjMk('button', 'btn' + (emphasis ? ' ' + emphasis : ''));
    b.type = 'button';
    b.innerHTML = ic('plus');
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', () => openPfmModal(null, { kind, companyId, projectId: p.id }));
    acts.appendChild(b);
  });
  head.appendChild(acts);
  section.appendChild(head);

  if (projectPfmFor !== p.id) {
    const loading = pjMk('div');
    section.appendChild(loading);
    showSkeleton(loading, 'text', 2);
    loadProjectPfmRows(p.id);
    return section;
  }
  if (!rows.length) {
    section.appendChild(pjMk('div', 'cp-records-empty', 'No offers or CRs linked to this project yet.'));
    return section;
  }
  const wrap = pjMk('div', 'pfm-table-wrap');
  const table = pjMk('table', 'pfm-table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  ['Reference', 'Title', 'Client', 'Type', 'Status', 'Current Fees', 'Person', 'Updated']
    .forEach(label => hr.appendChild(pjMk('th', '', label)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const body = document.createElement('tbody');
  rows.forEach(i => body.appendChild(buildPfmRow(i)));
  table.appendChild(body);
  wrap.appendChild(table);
  section.appendChild(wrap);
  return section;
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
  refreshClientOverviewBody();
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

  const shown = rows.filter(i => textMatch([i.reference, i.title, i.contactName, i.currentMember, i.currentNote, i.nextStep?.memberName, i.nextStep?.note, pfmStatusName(i.status)], q));
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
  if (pfmCurrent?.id !== item.id) { pfmFileErrors = new Map(); pfmStageFileErrors = new Map(); }
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

// Statuses the "Move to" buttons offer: the next one in catalog order,
// skipping Rejected — plus Rejected beside Accepted when Accepted is next
// (Sent → Accepted | Rejected). Nothing once the item is final.
function pfmNextStatuses(current) {
  const codes = pfmStatusOptions().map(o => o.code);
  if (PFM_FINAL.has(current)) return [];
  const next = codes.slice(codes.indexOf(current) + 1).find(c => c !== 'REJECTED');
  if (!next) return [];
  return next === 'ACCEPTED' && codes.includes('REJECTED') ? [next, 'REJECTED'] : [next];
}
// "Change status…" never offers Rejected once the item is Accepted or further.
function pfmCanMoveTo(item, code) {
  return !(code === 'REJECTED' && pfmIsDecided(item.status) && item.status !== 'REJECTED');
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
  if (item.projectId) {
    sub.appendChild(pjMk('span', 'pfm-dot', '·'));
    const proj = pjMk('button', 'pfm-project-link cell-link');
    proj.type = 'button';
    proj.innerHTML = ic('clipboard-list');
    proj.appendChild(pfmUserText('span', '', item.projectName));
    proj.title = 'Open project';
    proj.addEventListener('click', () => { flushPfmPending(); openProjectById(item.projectId); });
    sub.appendChild(proj);
  }
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
  const others = pfmStatusOptions().filter(o => o.code !== item.status && !pfmNextStatuses(item.status).includes(o.code)
    && pfmCanMoveTo(item, o.code));
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
  host.appendChild(buildPfmDocumentsSection(item));
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
  const filesBy = new Map();
  (item.stageFiles || []).forEach(f => { if (!filesBy.has(f.status)) filesBy.set(f.status, []); filesBy.get(f.status).push(f); });
  const all = pfmStatusOptions().map(o => o.code);
  [...byStatus.keys(), ...filesBy.keys()].forEach(code => { if (!all.includes(code)) all.push(code); });
  // Rejected is the other way out of Sent: it shows only on an item that took
  // it (or holds a record on it), and a rejected item hides the delivery
  // stages it never reached.
  const rejected = item.status === 'REJECTED';
  const holds = code => byStatus.has(code) || filesBy.has(code);
  const codes = all.filter(code => {
    if (code === 'REJECTED') return rejected || holds(code);
    return !(rejected && pfmIsDecided(code)) || holds(code);
  });
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
    // The current status can still be only planned (no date yet); its dot says so.
    const currentPlanned = state === 'current' && stage && !stage.doneOn;
    const li = pjMk('li', 'pfm-step pfm-step-' + state + (currentPlanned ? ' pfm-step-current-planned' : '') + (other ? ' pfm-step-other' : '') + (idx < currentIdx ? ' pfm-step-before' : ''));
    const btn = pjMk('button', 'pfm-step-btn');
    btn.type = 'button';
    btn.title = 'Edit this stage';
    btn.addEventListener('click', () => openPfmStageModal('edit', code));
    btn.appendChild(pjMk('span', 'pfm-step-dot'));
    btn.appendChild(pfmUserText('span', 'pfm-step-name', pfmStatusName(code)));
    // Every stage with a record says outright whether it is done.
    if (stage) btn.appendChild(pjMk('span', 'pfm-step-state ' + (stage.doneOn ? 'is-done' : 'is-pending'), stage.doneOn ? '✓ Done' : 'Not done yet'));
    if (stage?.memberName) {
      const who = pjMk('span', 'pfm-step-who');
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

// One stage's files in the Documents table: chips (open / remove with Undo),
// an "Add files" button, and the failures from the last add.
function buildPfmStageFiles(item, code, files) {
  const box = pjMk('div', 'pfm-step-files');
  files.forEach(f => box.appendChild(buildPfmFileChip(f, {
    open: () => openPfmStageFileUi(f.id), remove: () => removePfmStageFileUi(f.id),
  })));
  const add = pjMk('button', 'pj-doc-btn pfm-add-files');
  add.type = 'button';
  add.innerHTML = ic('upload');
  add.appendChild(document.createTextNode('Add files'));
  add.title = 'Add files to this stage';
  add.addEventListener('click', () => addPfmStageFilesUi(item.id, code, add));
  box.appendChild(add);
  const errors = pfmStageFileErrors.get(code);
  if (errors?.length) {
    const list = pjMk('div', 'pfm-file-errors');
    list.setAttribute('role', 'alert');
    errors.forEach(e => {
      const row = pjMk('div', 'pfm-file-error');
      row.innerHTML = ic('triangle-alert');
      row.appendChild(pfmUserText('span', 'pfm-file-error-name', e.name));
      row.appendChild(pjMk('span', '', e.error));
      list.appendChild(row);
    });
    box.appendChild(list);
  }
  return box;
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
// ── Documents: one row per step of the flow ──
// The Offer row holds the versions (fees + the offer's files); each row after
// it is a delivery stage with its own files: PO / Approval (the Accepted
// stage), UAT, Production, Invoice, Invoice Paid. Every row always shows, so
// the next document due is plain; a status added in Settings that holds files
// gets a row too.
function pfmDocumentStages(item) {
  const codes = pfmStatusOptions().map(o => o.code).filter(c => pfmIsDecided(c) && c !== 'REJECTED');
  (item.stageFiles || []).forEach(f => { if (!codes.includes(f.status)) codes.push(f.status); });
  return codes;
}
// The Accepted row is named for its document; the rest use their status name.
const pfmDocumentLabel = code => (code === 'ACCEPTED' ? { text: 'PO / Approval', ui: true } : { text: pfmStatusName(code), ui: false });
// `label` is { text, ui }: UI wording goes through the dictionary, a status
// name (already in the app language, from the catalog) is left as it is.
function buildPfmDocRow(label, date, content, cls = '') {
  const row = pjMk('div', 'pfm-doc-row' + (cls ? ' ' + cls : ''));
  const head = pjMk('div', 'pfm-doc-step');
  head.appendChild(label.ui ? pjMk('span', 'pfm-doc-step-name', label.text) : pfmUserText('span', 'pfm-doc-step-name', label.text));
  if (date) head.appendChild(pjMk('span', 'pfm-muted pfm-doc-step-date', pfmFmtDate(date)));
  row.append(head, content);
  return row;
}
function buildPfmDocumentsSection(item) {
  const section = pjMk('div', 'pj-section pfm-versions pfm-documents');
  const sh = pjMk('div', 'pj-section-head');
  const st = pjMk('div', 'pj-section-title');
  st.innerHTML = ic('file-text');
  st.appendChild(document.createTextNode('Documents'));
  sh.appendChild(st);
  section.appendChild(sh);

  // The Offer row: its versions as flat lines (newest = current on top), and
  // "New Version" inside the row it belongs to.
  const rows = pjMk('div', 'pfm-doc-rows');
  const versions = item.versions || [];
  const offer = pjMk('div', 'pfm-offer-versions');
  const list = pjMk('div', 'pfm-version-list');
  if (!versions.length) list.appendChild(pjMk('div', 'pfm-muted pfm-version-empty', 'No versions yet — add one to record the fees and files.'));
  versions.forEach((v, idx) => list.appendChild(buildPfmVersionCard(v, idx === 0, versions[idx + 1])));
  offer.appendChild(list);
  const add = pjMk('button', 'pj-doc-btn pfm-version-add');
  add.type = 'button';
  add.innerHTML = ic('plus');
  add.appendChild(document.createTextNode('New Version'));
  add.addEventListener('click', () => openPfmVersionModal(null));
  offer.appendChild(add);
  rows.appendChild(buildPfmDocRow({ text: pfmKindLabel(item.kind), ui: true }, versions[0]?.date || '', offer, 'pfm-doc-row-offer'));

  const byStatus = new Map((item.stages || []).map(s => [s.status, s]));
  const filesBy = new Map();
  (item.stageFiles || []).forEach(f => { if (!filesBy.has(f.status)) filesBy.set(f.status, []); filesBy.get(f.status).push(f); });
  pfmDocumentStages(item).forEach(code => {
    rows.appendChild(buildPfmDocRow(pfmDocumentLabel(code), byStatus.get(code)?.doneOn || '',
      buildPfmStageFiles(item, code, filesBy.get(code) || [])));
  });
  section.appendChild(rows);
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
// `actions` swaps in the stage-file calls; a version file uses the defaults.
function buildPfmFileChip(f, actions = { open: () => openPfmFileUi(f.id), remove: () => removePfmFileUi(f.id) }) {
  const chip = pjMk('span', 'pfm-file' + (f.exists ? '' : ' missing'));
  const render = () => {
    chip.innerHTML = '';
    const open = pjMk('button', 'pfm-file-open');
    open.type = 'button';
    open.title = f.exists ? 'Open with default app' : 'File missing from disk';
    open.innerHTML = ic(f.exists ? 'file-text' : 'triangle-alert');
    open.appendChild(pfmUserText('span', 'pfm-file-name', f.originalName || '(file)'));
    open.appendChild(pjMk('span', 'pfm-file-size', fmtFileSize(f.size)));
    open.addEventListener('click', actions.open);
    chip.appendChild(open);
    const x = pjMk('button', 'pfm-file-x');
    x.type = 'button';
    x.innerHTML = ic('x');
    x.title = 'Remove file';
    x.setAttribute('aria-label', 'Remove file');
    x.addEventListener('click', () => showDeleteConfirm(chip, actions.remove, render, 'Remove?'));
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

// ── Stage files: same flow as version files, keyed by the stage's status ──
async function openPfmStageFileUi(fileId) {
  let res;
  try { res = await window.api.openPfmStageFile(fileId); }
  catch { toast('Could not open file'); return; }
  if (!res?.ok) toast(res?.error || 'Could not open file');
}
async function addPfmStageFilesUi(itemId, code, btn) {
  await pfmBeforeWrite();
  if (btn) btn.disabled = true;
  let res;
  try { res = await window.api.addPfmStageFiles(itemId, code); }
  catch { toast('Could not add files'); if (btn) btn.disabled = false; return; }
  if (btn) btn.disabled = false;
  if (res?.canceled) return;
  const results = res?.results || [];
  const failed = results.filter(r => !r.ok);
  const added = results.length - failed.length;
  if (failed.length) pfmStageFileErrors.set(code, failed.map(r => ({ name: r.name, error: r.error })));
  else pfmStageFileErrors.delete(code);
  if (!results.length) { toast(res?.error || 'Could not add files'); return; }
  if (added) toast(added === 1 ? '1 file added' : `${added} files added`);
  else toast('No files were added');
  if (res.item) pfmAfterWrite(res.item);
  else if (pfmCurrent) renderPfmDetail();
}
async function removePfmStageFileUi(fileId) {
  await pfmBeforeWrite();
  let res;
  try { res = await window.api.removePfmStageFile(fileId); }
  catch { toast('Could not remove file'); return; }
  if (!res?.ok) { toast(res?.error || 'Could not remove file'); if (pfmCurrent) renderPfmDetail(); return; }
  pfmAfterWrite(res.item);
  toast('File removed', {
    actionLabel: 'Undo', duration: 5000,
    onAction: async () => {
      const restored = await window.api.restorePfmStageFile(fileId).catch(() => null);
      toast(restored?.ok ? 'File restored' : (restored?.error || 'Could not restore the file'));
      if (restored?.ok) pfmAfterWrite(restored.item);
    },
    onExpire: () => window.api.purgePfmStageFile(fileId).catch(() => {}),
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
// `item` is the open offer by default; the pipeline passes the card it dropped.
function openPfmStageModal(mode, code, item = pfmCurrent) {
  if (!item) return;
  pfmStageCtx = { mode, status: code, item };
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
// "✓ Done" / "Not done yet" toggle; the date only shows (and counts) when done.
function setPfmStageDone(done) {
  document.getElementById('pfm-stage-planned').checked = !done;
  syncPfmStagePlanned();
}
function syncPfmStagePlanned() {
  const planned = document.getElementById('pfm-stage-planned').checked;
  document.getElementById('pfm-stage-date').disabled = planned;
  document.getElementById('pfm-stage-date-group').hidden = planned;
  [['pfm-stage-done-btn', !planned], ['pfm-stage-pending-btn', planned]].forEach(([id, on]) => {
    const b = document.getElementById(id);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
function closePfmStageModal() {
  document.getElementById('pfm-stage-overlay').classList.remove('open');
  pfmStageCtx = null;
}
function pfmStageOverlayClick(e) {
  if (e.target === document.getElementById('pfm-stage-overlay')) closePfmStageModal();
}
async function submitPfmStageModal() {
  const ctx = pfmStageCtx;
  const item = ctx?.item;
  if (!item) return;
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
