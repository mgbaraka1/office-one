// ══ COMPANY DOCUMENTS — standalone card-per-document module ════════════════
// Independent of Projects: each card IS the entity (name/category/renewal
// date/notes + at most one file), not a slot in a per-project catalog. Delete
// removes the card itself; the file/undo dance mirrors the Projects
// delete/restore pattern (showProjectUndoToast et al.) one level simpler
// (no linked tasks to re-attach).
let companyDocs = [];
let companyDocsLoaded = false;
let companyDocFilter = '';
let companyDocStatusFilter = '';  // '' | 'overdue' | 'soon' | 'nodate'
let companyDocCatFilter = '';     // '' or a COMPANY_DOCUMENT_CATEGORY code
let companyDocEditId = null;     // null = create mode in the modal
let undoCompanyDoc = null;
let _undoCompanyDocTimer = null;

function initCompanyDocsModule() {
  if (!companyDocsLoaded) loadCompanyDocsList();
  else renderCompanyDocsList();
}

async function loadCompanyDocsList() {
  const grid = document.getElementById('companydocs-grid');
  if (!grid.childElementCount) { grid.style.display = ''; showSkeleton(grid, 'cards', 3); }
  let list;
  try { list = await window.api.listCompanyDocuments(); }
  catch { toast('Could not load company documents'); return; }
  companyDocs = Array.isArray(list) ? list : [];
  companyDocsLoaded = true;
  renderCompanyDocsList();
}

function applyCompanyDocFilter() {
  companyDocFilter = (document.getElementById('companydocs-filter').value || '').toLowerCase().trim();
  renderCompanyDocsList();
}

function renderCompanyDocsList() {
  const grid  = document.getElementById('companydocs-grid');
  const empty = document.getElementById('companydocs-empty-state');
  grid.innerHTML = '';
  renderCompanyDocToolbar();

  if (companyDocs.length === 0) {
    grid.style.display = 'none';
    empty.hidden = false;
    empty.querySelector('p').innerHTML = 'No company documents yet — click <strong>+ New Document</strong> to add one';
    return;
  }

  const shown = companyDocs
    .filter(d => !companyDocCatFilter || d.category === companyDocCatFilter)
    .filter(d => !companyDocStatusFilter || cdRenewalInfo(d.renewalDate).status === companyDocStatusFilter)
    .filter(d => textMatch(
      [d.name, d.docNumber, lkLabel('COMPANY_DOCUMENT_CATEGORY', d.category), d.notes, d.file && d.file.originalName],
      companyDocFilter))
    .sort(cdCompareByRenewal);

  if (shown.length === 0) {
    grid.style.display = 'none';
    empty.hidden = false;
    empty.querySelector('p').textContent = companyDocFilter ? 'No documents match your search' : 'No documents match this filter';
    return;
  }
  grid.style.display = '';
  empty.hidden = true;
  shown.forEach(d => grid.appendChild(buildCompanyDocCard(d)));
}

// Most urgent first: expired, renewing soon, later renewals by date, then
// documents with no renewal date (kept newest first, as listed).
const CD_STATUS_RANK = { overdue: 0, soon: 1, ok: 2, nodate: 3 };
function cdCompareByRenewal(a, b) {
  const ra = CD_STATUS_RANK[cdRenewalInfo(a.renewalDate).status];
  const rb = CD_STATUS_RANK[cdRenewalInfo(b.renewalDate).status];
  if (ra !== rb) return ra - rb;
  if (a.renewalDate && b.renewalDate && a.renewalDate !== b.renewalDate) return a.renewalDate < b.renewalDate ? -1 : 1;
  return 0;
}

// Status chips (with counts) and, when there is more than one category,
// category chips. Both filter the grid; clicking the active chip clears it.
function renderCompanyDocToolbar() {
  const bar = document.getElementById('companydocs-toolbar');
  const statusEl = document.getElementById('companydocs-status');
  const catsEl = document.getElementById('companydocs-cats');
  statusEl.innerHTML = ''; catsEl.innerHTML = '';
  bar.hidden = companyDocs.length === 0;
  if (bar.hidden) return;

  const counts = { overdue: 0, soon: 0, ok: 0, nodate: 0 };
  companyDocs.forEach(d => { counts[cdRenewalInfo(d.renewalDate).status]++; });
  const mkChip = (label, count, active, cls, onClick, userContent) => {
    const b = pjMk('button', 'cd-chip' + (cls ? ' ' + cls : '') + (active ? ' active' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
    const text = pjMk('span', 'cd-chip-label', label);
    if (userContent) text.dataset.userContent = '';
    b.appendChild(text);
    if (count != null) b.appendChild(pjMk('span', 'cd-chip-count', String(count)));
    b.addEventListener('click', onClick);
    return b;
  };
  const setStatus = v => { companyDocStatusFilter = companyDocStatusFilter === v ? '' : v; renderCompanyDocsList(); };
  statusEl.appendChild(mkChip('All', companyDocs.length, !companyDocStatusFilter, '', () => setStatus('')));
  [['overdue', 'Expired', 'bad'], ['soon', 'Renews soon', 'warn'], ['nodate', 'No renewal date', 'muted']]
    .forEach(([key, label, cls]) => {
      if (counts[key] || companyDocStatusFilter === key) {
        statusEl.appendChild(mkChip(label, counts[key], companyDocStatusFilter === key, cls, () => setStatus(key)));
      }
    });

  const cats = [...new Set(companyDocs.map(d => d.category).filter(Boolean))];
  if (cats.length > 1 || companyDocCatFilter) {
    const setCat = v => { companyDocCatFilter = companyDocCatFilter === v ? '' : v; renderCompanyDocsList(); };
    catsEl.appendChild(mkChip('All categories', null, !companyDocCatFilter, '', () => setCat('')));
    cats.forEach(code => catsEl.appendChild(
      mkChip(lkLabel('COMPANY_DOCUMENT_CATEGORY', code), null, companyDocCatFilter === code, '', () => setCat(code), true)));
  }
  catsEl.hidden = !catsEl.childElementCount;
}

// Overdue / due-soon (<=30 days) classification for the renewal-date row.
// Display only — no reminders/notifications, per the Phase 5 scope. The
// client Auth and internal-system rows (clients.js) use it too.
function cdRenewalStatus(dateStr) {
  const s = cdRenewalInfo(dateStr).status;
  return s === 'overdue' || s === 'soon' ? s : null;
}
// { status: 'overdue'|'soon'|'ok'|'nodate', days } — days until the renewal
// date (negative once it has passed).
function cdRenewalInfo(dateStr) {
  if (!dateStr) return { status: 'nodate', days: null };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return { status: 'nodate', days: null };
  const days = Math.round((d - today) / 86400000);
  return { status: days < 0 ? 'overdue' : days <= 30 ? 'soon' : 'ok', days };
}
function cdDaysText(days) {
  if (days === 0) return 'today';
  if (days > 0) return 'in ' + days + (days === 1 ? ' day' : ' days');
  return -days + (days === -1 ? ' day ago' : ' days ago');
}
function cdSameName(a, b) {
  const norm = v => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return !!norm(a) && norm(a) === norm(b);
}

// One card: header (status icon + name + category pill + edit/delete),
// renewal row, optional number with copy, optional notes, the file chip and
// one row of file actions. A file dropped on the card uploads or replaces.
function buildCompanyDocCard(doc) {
  const f = doc.file;
  const present = !!(f && f.exists);
  const missing = !!(f && !f.exists);
  const renewal = cdRenewalInfo(doc.renewalDate);
  const card = pjMk('div', 'cd-card status-' + renewal.status + (present ? ' available' : '') + (missing ? ' missing' : ''));
  card.dataset.docId = doc.id;   // Milestone 11 — palette deep-link scroll+highlight target

  const head = pjMk('div', 'cd-card-head');
  // The icon shows what most needs attention: a missing file, then renewal.
  const icon = pjMk('div', 'cd-card-icon');
  const iconName = missing ? 'triangle-alert'
    : renewal.status === 'overdue' ? 'clock-alert'
    : renewal.status === 'soon' ? 'calendar-clock'
    : renewal.status === 'ok' ? 'circle-check' : 'file-text';
  icon.innerHTML = ic(iconName);
  icon.title = missing ? 'File missing from disk'
    : renewal.status === 'overdue' ? 'Expired'
    : renewal.status === 'soon' ? 'Renews soon'
    : renewal.status === 'ok' ? 'Valid' : 'No renewal date';
  head.appendChild(icon);

  const titleWrap = pjMk('div', 'cd-card-title');
  const nameEl = pjMk('div', 'cd-card-name', doc.name || 'Untitled document');
  if (doc.name) { nameEl.title = doc.name; nameEl.dataset.userContent = ''; }
  titleWrap.appendChild(nameEl);
  if (doc.category) titleWrap.appendChild(pjMk('span', 'cd-card-cat', lkLabel('COMPANY_DOCUMENT_CATEGORY', doc.category)));
  head.appendChild(titleWrap);

  const headIcons = pjMk('div', 'cd-card-icons');
  const editBtn = pjMk('button', 'cd-icon-btn');
  editBtn.type = 'button';
  editBtn.innerHTML = ic('pencil');
  editBtn.title = 'Edit';
  editBtn.setAttribute('aria-label', 'Edit');
  editBtn.addEventListener('click', () => openCompanyDocModal(doc));
  headIcons.appendChild(editBtn);
  const delBtn = pjMk('button', 'cd-icon-btn danger');
  delBtn.type = 'button';
  delBtn.innerHTML = ic('trash-2');
  delBtn.title = 'Delete document';
  delBtn.setAttribute('aria-label', 'Delete document');
  delBtn.addEventListener('click', () =>
    showDeleteConfirm(headIcons, () => deleteCompanyDoc(doc.id), () => renderCompanyDocsList()));
  headIcons.appendChild(delBtn);
  head.appendChild(headIcons);
  card.appendChild(head);

  // Renewal row: always shown, so a document without a date asks for one.
  if (renewal.status === 'nodate') {
    const add = pjMk('button', 'cd-renewal cd-renewal-add');
    add.type = 'button';
    add.innerHTML = ic('calendar-plus');
    add.appendChild(document.createTextNode('Add renewal date'));
    add.addEventListener('click', () => openCompanyDocModal(doc, 'cd-renewal'));
    card.appendChild(add);
  } else {
    const row = pjMk('div', 'cd-renewal ' + renewal.status);
    row.innerHTML = ic('calendar-clock');
    const dateText = new Date(doc.renewalDate + 'T00:00:00').toLocaleDateString('en-GB');
    const prefix = renewal.status === 'overdue' ? 'Expired — ' : renewal.status === 'soon' ? 'Renews soon — ' : 'Renews ';
    row.appendChild(pjMk('span', 'cd-renewal-date', prefix + dateText));
    row.appendChild(pjMk('span', 'cd-renewal-days', cdDaysText(renewal.days)));
    card.appendChild(row);
  }

  if (doc.docNumber) {
    const num = pjMk('div', 'cd-number');
    const hash = pjMk('span', 'cd-number-ic');
    hash.innerHTML = ic('hash');
    num.appendChild(hash);
    const val = pjMk('span', 'cd-number-val', doc.docNumber);
    val.dataset.userContent = '';
    val.dir = 'ltr';
    num.appendChild(val);
    const copy = pjMk('button', 'cd-icon-btn cd-number-copy');
    copy.type = 'button';
    copy.innerHTML = ic('copy');
    copy.title = 'Copy number';
    copy.setAttribute('aria-label', 'Copy number');
    copy.addEventListener('click', () => copyCompanyDocNumber(doc.docNumber));
    num.appendChild(copy);
    card.appendChild(num);
  }

  if (doc.notes) card.appendChild(pjMk('div', 'cd-notes', doc.notes));

  // The file as one chip: a type badge, the name without its extension (left
  // out when it only repeats the card's title), and size + upload date.
  // Clicking a present file opens it.
  const fileRow = pjMk(present ? 'button' : 'div', 'cd-file' + (f ? '' : ' is-empty') + (missing ? ' is-missing' : ''));
  if (!f) {
    fileRow.appendChild(pjMk('span', 'cd-file-badge', '—'));
    fileRow.appendChild(pjMk('span', 'cd-file-name', 'No file — drop one here'));
  } else {
    const full = f.originalName || '(file)';
    const dot = full.lastIndexOf('.');
    const ext = dot > 0 ? full.slice(dot + 1).toUpperCase().slice(0, 4) : 'FILE';
    const base = dot > 0 ? full.slice(0, dot) : full;
    fileRow.appendChild(pjMk('span', 'cd-file-badge', ext));
    const text = pjMk('span', 'cd-file-text');
    if (!cdSameName(base, doc.name)) {
      const fname = pjMk('span', 'cd-file-name', base);
      fname.dataset.userContent = '';
      text.appendChild(fname);
    }
    text.appendChild(pjMk('span', 'cd-file-meta', missing ? 'File missing from disk'
      : fmtFileSize(f.size) + (f.uploadedAt ? ' · ' + new Date(f.uploadedAt).toLocaleDateString('en-GB') : '')));
    fileRow.appendChild(text);
    fileRow.title = present ? 'Open with default app' : full;
    if (present) { fileRow.type = 'button'; fileRow.addEventListener('click', () => openCompanyDocFile(doc.id)); }
  }
  card.appendChild(fileRow);

  // One row: the main action with a label, the rest as icon buttons.
  const actions = pjMk('div', 'cd-actions');
  const mkBtn = (cls, iconName, label, title, fn) => {
    const b = pjMk('button', 'pj-doc-btn' + (cls ? ' ' + cls : '') + (label ? '' : ' cd-act-icon'));
    b.type = 'button';
    b.innerHTML = ic(iconName);
    if (label) b.appendChild(document.createTextNode(label));
    else b.setAttribute('aria-label', title);
    b.title = title;
    b.addEventListener('click', fn);
    return b;
  };
  if (!f) {
    actions.appendChild(mkBtn('primary', 'upload', 'Upload', 'Upload a file', () => uploadCompanyDocFile(doc.id)));
  } else {
    if (present) actions.appendChild(mkBtn('primary', 'external-link', 'Open file', 'Open with default app', () => openCompanyDocFile(doc.id)));
    else actions.appendChild(mkBtn('primary', 'upload', 'Replace', 'Replace with another file', () => uploadCompanyDocFile(doc.id)));
    actions.appendChild(pjMk('span', 'cd-actions-gap'));
    if (present) {
      actions.appendChild(mkBtn('', 'download', '', 'Save a copy', () => downloadCompanyDocFile(doc.id)));
      actions.appendChild(mkBtn('', 'upload', '', 'Replace with another file', () => uploadCompanyDocFile(doc.id)));
    }
    actions.appendChild(mkBtn('danger', 'file-x', '', 'Remove the file (keeps the document)', () =>
      showDeleteConfirm(actions, () => removeCompanyDocFile(doc.id), () => renderCompanyDocsList())));
  }
  card.appendChild(actions);

  // Drop a file onto the card to upload it, or to replace the current one.
  const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');
  card.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    card.classList.add('drop-target');
  });
  card.addEventListener('dragleave', e => {
    if (!card.contains(e.relatedTarget)) card.classList.remove('drop-target');
  });
  card.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    card.classList.remove('drop-target');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    if (e.dataTransfer.files.length > 1) toast('Only the first file was added — a document holds one file');
    uploadCompanyDocFile(doc.id, file);
  });
  return card;
}

async function copyCompanyDocNumber(value) {
  const text = String(value || '');
  if (!text) return;
  try { await navigator.clipboard.writeText(text); }
  catch { toast('Could not copy to clipboard'); return; }
  toast('Number copied');
}

// A leading "no category" option, since category is optional (unlike the
// required, defaulted lookup selects populateSelect() is built for).
function populateCompanyDocCategorySelect(currentVal) {
  const el = document.getElementById('cd-category');
  el.innerHTML = '';
  const none = document.createElement('option');
  none.value = ''; none.textContent = '— No category —';
  el.appendChild(none);
  lkOptions('COMPANY_DOCUMENT_CATEGORY').forEach(opt => {
    const o = document.createElement('option');
    o.dataset.userContent = ''; o.value = opt.code; o.textContent = lookupDisplayName(opt);
    if (opt.code === currentVal) o.selected = true;
    el.appendChild(o);
  });
  if (!currentVal) none.selected = true;
}

function openCompanyDocModal(doc, focusId) {
  companyDocEditId = doc ? doc.id : null;
  document.getElementById('companydoc-modal-title').textContent = doc ? 'Edit Document' : 'New Document';
  document.getElementById('companydoc-modal-submit').textContent = doc ? 'Save Changes' : 'Add Document';
  document.getElementById('cd-name').value = doc ? (doc.name || '') : '';
  document.getElementById('cd-renewal').value = doc ? (doc.renewalDate || '') : '';
  document.getElementById('cd-number').value = doc ? (doc.docNumber || '') : '';
  document.getElementById('cd-notes').value = doc ? (doc.notes || '') : '';
  populateCompanyDocCategorySelect(doc ? doc.category : '');

  clearErrorsIn('#companydoc-modal');
  document.getElementById('companydoc-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById(focusId || 'cd-name').focus(), 80);
}
function closeCompanyDocModal() {
  document.getElementById('companydoc-modal-overlay').classList.remove('open');
  companyDocEditId = null;
}
function companyDocOverlayClick(e) {
  if (e.target === document.getElementById('companydoc-modal-overlay')) closeCompanyDocModal();
}

async function submitCompanyDocModal() {
  clearErrorsIn('#companydoc-modal');
  const name = document.getElementById('cd-name').value.trim();
  if (!name) { markError('cd-name'); return; }
  const data = {
    name,
    category:    document.getElementById('cd-category').value || '',
    renewalDate: document.getElementById('cd-renewal').value || '',
    docNumber:   document.getElementById('cd-number').value.trim(),
    notes:       document.getElementById('cd-notes').value.trim(),
  };
  try {
    if (companyDocEditId != null) {
      await window.api.updateCompanyDocument(companyDocEditId, data);
      closeCompanyDocModal();
      toast('Document saved');
    } else {
      await window.api.createCompanyDocument(data);
      closeCompanyDocModal();
      toast('Document created');
    }
  } catch { toast('Could not save document'); return; }
  await loadCompanyDocsList();
}

// Apply a CompanyDocFileResult ({ ok, document, error, canceled }) to the grid.
function applyCompanyDocFileResult(res, failMsg) {
  if (!res || res.canceled) return false;
  if (!res.ok || !res.document) { toast(res?.error || failMsg); return false; }
  companyDocs = companyDocs.map(d => d.id === res.document.id ? res.document : d);
  renderCompanyDocsList();
  return true;
}
// No file: the open dialog. A dropped File: uploaded as it is.
async function uploadCompanyDocFile(id, file) {
  let res;
  try { res = await (file ? window.api.uploadCompanyDocumentFile(id, file) : window.api.uploadCompanyDocument(id)); }
  catch { toast('Could not upload file'); return; }
  if (!applyCompanyDocFileResult(res, 'Could not upload file')) return;
  if (res.replacedFile) {
    toast('File replaced', { actionLabel: 'Undo', duration: 5000, onAction: async () => {
      const restored = await window.api.restoreRemovedCompanyDocument(id, res.replacedFile);
      if (restored?.ok && restored.replacedFile?.path) await window.api.purgeCompanyDocumentFile(id, restored.replacedFile.path);
      if (restored?.ok) applyCompanyDocFileResult(restored, 'Could not restore the previous file');
      toast(restored?.ok ? 'Previous file restored' : (restored?.error || 'Could not restore the previous file'));
    }, onExpire: () => window.api.purgeCompanyDocumentFile(id, res.replacedFile.path).catch(() => {}) });
  } else toast('File saved');
}
async function removeCompanyDocFile(id) {
  let res;
  try { res = await window.api.removeCompanyDocument(id); }
  catch { toast('Could not remove file'); return; }
  if (!applyCompanyDocFileResult(res, 'Could not remove file')) return;
  if (!res.removedFile) { toast('File removed'); return; }
  toast('File removed', { actionLabel: 'Undo', duration: 5000, onAction: async () => {
    const restored = await window.api.restoreRemovedCompanyDocument(id, res.removedFile);
    if (restored?.ok) applyCompanyDocFileResult(restored, 'Could not restore the file');
    toast(restored?.ok ? 'File restored' : (restored?.error || 'Could not restore the file'));
  }, onExpire: () => window.api.purgeCompanyDocumentFile(id, res.removedFile.path).catch(() => {}) });
}
async function downloadCompanyDocFile(id) {
  let res;
  try { res = await window.api.downloadCompanyDocument(id); }
  catch { toast('Could not download file'); return; }
  if (!res || res.canceled) return;
  toast(res.ok ? 'File saved' : (res.error || 'Could not download file'));
}
async function openCompanyDocFile(id) {
  let res;
  try { res = await window.api.openCompanyDocument(id); }
  catch { toast('Could not open file'); return; }
  if (!res.ok) toast(res.error || 'Could not open file');
}

// ── Delete + undo (re-creates the card on undo: no hard loss) ──
async function deleteCompanyDoc(id) {
  const snapshot = companyDocs.find(d => d.id === id);
  if (!snapshot) return;
  try { await window.api.deleteCompanyDocument(id); }
  catch { toast('Could not delete document'); renderCompanyDocsList(); return; }
  companyDocs = companyDocs.filter(d => d.id !== id);
  renderCompanyDocsList();
  showCompanyDocUndoToast(snapshot);
}
function showCompanyDocUndoToast(snapshot) {
  undoCompanyDoc = snapshot;
  clearTimeout(_undoCompanyDocTimer);
  document.getElementById('companydoc-undo-toast').classList.add('visible');
  _undoCompanyDocTimer = setTimeout(hideCompanyDocUndoToast, 5000);
}
function hideCompanyDocUndoToast() {
  document.getElementById('companydoc-undo-toast').classList.remove('visible');
  // Undo window lapsed without an undo → the deletion is final; purge the
  // card's file folder (best-effort; the boot orphan-sweep is backup).
  if (undoCompanyDoc) window.api.purgeCompanyDocumentFiles(undoCompanyDoc.id).catch(() => {});
  undoCompanyDoc = null;
}
async function undoDeleteCompanyDoc() {
  if (!undoCompanyDoc) return;
  const snap = undoCompanyDoc;
  undoCompanyDoc = null;
  clearTimeout(_undoCompanyDocTimer);
  document.getElementById('companydoc-undo-toast').classList.remove('visible');
  try {
    const created = await window.api.createCompanyDocument({
      name: snap.name, category: snap.category, renewalDate: snap.renewalDate, docNumber: snap.docNumber, notes: snap.notes,
    });
    // Move the still-on-disk file (if any) onto the re-created card and re-record
    // its metadata (the row was hard-deleted; the bytes survived the undo window).
    if (snap.file) await window.api.restoreCompanyDocumentFile(snap.id, created.id, snap.file);
    toast('Document restored');
  } catch { toast('Could not restore document'); }
  await loadCompanyDocsList();
}
