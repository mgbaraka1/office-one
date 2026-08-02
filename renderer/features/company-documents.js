// ══ COMPANY DOCUMENTS — standalone card-per-document module ════════════════
// Independent of Projects: each card IS the entity (name/category/renewal
// date/notes + at most one file), not a slot in a per-project catalog. Delete
// removes the card itself; the file/undo dance mirrors the Projects
// delete/restore pattern (showProjectUndoToast et al.) one level simpler
// (no linked tasks to re-attach).
let companyDocs = [];
let companyDocsLoaded = false;
let companyDocFilter = '';
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

  if (companyDocs.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'flex';
    empty.querySelector('p').innerHTML = 'No company documents yet — click <strong>+ New Document</strong> to add one';
    return;
  }

  const shown = companyDocs.filter(d => textMatch(
    [d.name, lkLabel('COMPANY_DOCUMENT_CATEGORY', d.category), d.notes, d.file && d.file.originalName],
    companyDocFilter));

  if (shown.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = 'No documents match your search';
    return;
  }
  grid.style.display = '';
  empty.style.display = 'none';
  shown.forEach(d => grid.appendChild(buildCompanyDocCard(d)));
}

// Overdue / due-soon (<=30 days) classification for the renewal-date row.
// Display only — no reminders/notifications, per the Phase 5 scope.
function cdRenewalStatus(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  const diffDays = Math.round((d - today) / 86400000);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 30) return 'soon';
  return null;
}

// One card: header (icon + name + category pill + edit/delete), optional
// renewal-date row, optional notes, file status line, file action buttons.
function buildCompanyDocCard(doc) {
  const f = doc.file;
  const present = !!(f && f.exists);
  const missing = !!(f && !f.exists);
  const card = pjMk('div', 'cd-card' + (present ? ' available' : '') + (missing ? ' missing' : ''));
  card.dataset.docId = doc.id;   // Milestone 11 — palette deep-link scroll+highlight target

  const head = pjMk('div', 'cd-card-head');
  const icon = pjMk('div', 'cd-card-icon');
  icon.innerHTML = ic(present ? 'circle-check' : (missing ? 'triangle-alert' : 'file-text'));
  head.appendChild(icon);

  const titleWrap = pjMk('div', 'cd-card-title');
  titleWrap.appendChild(pjMk('div', 'cd-card-name', doc.name || 'Untitled document'));
  if (doc.category) titleWrap.appendChild(pjMk('span', 'cd-card-cat', lkLabel('COMPANY_DOCUMENT_CATEGORY', doc.category)));
  head.appendChild(titleWrap);

  const headIcons = pjMk('div', 'cd-card-icons');
  const editBtn = pjMk('button', 'cd-icon-btn');
  editBtn.innerHTML = ic('pencil');
  editBtn.title = 'Edit';
  editBtn.addEventListener('click', () => openCompanyDocModal(doc));
  headIcons.appendChild(editBtn);
  const delBtn = pjMk('button', 'cd-icon-btn danger');
  delBtn.innerHTML = ic('trash-2');
  delBtn.title = 'Delete';
  delBtn.addEventListener('click', () =>
    showDeleteConfirm(headIcons, () => deleteCompanyDoc(doc.id), () => renderCompanyDocsList()));
  headIcons.appendChild(delBtn);
  head.appendChild(headIcons);
  card.appendChild(head);

  if (doc.renewalDate) {
    const status = cdRenewalStatus(doc.renewalDate);
    const row = pjMk('div', 'cd-renewal' + (status ? ' ' + status : ''));
    row.innerHTML = ic('calendar-clock');
    const prefix = status === 'overdue' ? 'Overdue — ' : status === 'soon' ? 'Renews soon — ' : 'Renews ';
    row.appendChild(document.createTextNode(prefix + new Date(doc.renewalDate + 'T00:00:00').toLocaleDateString()));
    card.appendChild(row);
  }

  if (doc.notes) card.appendChild(pjMk('div', 'cd-notes', doc.notes));

  const fileRow = pjMk('div', 'cd-file-row');
  if (!f) {
    fileRow.textContent = 'No file uploaded';
  } else {
    fileRow.appendChild(pjMk('span', 'fname', f.originalName || '(file)'));
    fileRow.appendChild(document.createTextNode(
      ' · ' + fmtFileSize(f.size) + (f.uploadedAt ? ' · ' + new Date(f.uploadedAt).toLocaleDateString() : '')));
  }
  card.appendChild(fileRow);
  if (missing) card.appendChild(pjMk('div', 'cd-file-warn', 'File missing from disk'));

  const actions = pjMk('div', 'cd-actions');
  const mkBtn = (cls, iconName, label, title, fn) => {
    const b = pjMk('button', 'pj-doc-btn' + (cls ? ' ' + cls : ''));
    b.innerHTML = ic(iconName);
    b.appendChild(document.createTextNode(label));
    b.title = title;
    b.addEventListener('click', fn);
    return b;
  };
  if (!f) {
    actions.appendChild(mkBtn('primary', 'upload', 'Upload', 'Upload a file', () => uploadCompanyDocFile(doc.id)));
  } else {
    if (present) {
      actions.appendChild(mkBtn('', 'download', 'Download', 'Save a copy', () => downloadCompanyDocFile(doc.id)));
      actions.appendChild(mkBtn('', 'external-link', 'Open', 'Open with default app', () => openCompanyDocFile(doc.id)));
    }
    actions.appendChild(mkBtn('', 'upload', 'Replace', 'Replace with another file', () => uploadCompanyDocFile(doc.id)));
    actions.appendChild(mkBtn('danger', 'trash-2', 'Remove file', 'Remove this file', () =>
      showDeleteConfirm(actions, () => removeCompanyDocFile(doc.id), () => renderCompanyDocsList())));
  }
  card.appendChild(actions);
  return card;
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
    o.dataset.userContent = ''; o.value = opt.code; o.textContent = opt.label;
    if (opt.code === currentVal) o.selected = true;
    el.appendChild(o);
  });
  if (!currentVal) none.selected = true;
}

function openCompanyDocModal(doc) {
  companyDocEditId = doc ? doc.id : null;
  document.getElementById('companydoc-modal-title').textContent = doc ? 'Edit Document' : 'New Document';
  document.getElementById('companydoc-modal-submit').textContent = doc ? 'Save Changes' : 'Add Document';
  document.getElementById('cd-name').value = doc ? (doc.name || '') : '';
  document.getElementById('cd-renewal').value = doc ? (doc.renewalDate || '') : '';
  document.getElementById('cd-notes').value = doc ? (doc.notes || '') : '';
  populateCompanyDocCategorySelect(doc ? doc.category : '');

  clearErrorsIn('#companydoc-modal');
  document.getElementById('companydoc-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('cd-name').focus(), 80);
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
async function uploadCompanyDocFile(id) {
  let res;
  try { res = await window.api.uploadCompanyDocument(id); }
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
      name: snap.name, category: snap.category, renewalDate: snap.renewalDate, notes: snap.notes,
    });
    // Move the still-on-disk file (if any) onto the re-created card and re-record
    // its metadata (the row was hard-deleted; the bytes survived the undo window).
    if (snap.file) await window.api.restoreCompanyDocumentFile(snap.id, created.id, snap.file);
    toast('Document restored');
  } catch { toast('Could not restore document'); }
  await loadCompanyDocsList();
}
