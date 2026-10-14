// ══ TEMPLATES — Company Document cards of kind TEMPLATE ═══════════════════
// The same card as Company Documents (name/category/notes + at most one file,
// stored under company_documents/{id}/) with a TEMPLATE_CATEGORY and no
// renewal date. Listing, creating and the upload dialog have their own calls;
// every other card and file action goes through the companydocs ones by id.
// Reuses the cd-* card styles and the same delete/undo pattern.
let templates = [];
let templatesLoaded = false;
let templateFilter = '';
let templateEditId = null;       // null = create mode in the modal
let undoTemplate = null;
let _undoTemplateTimer = null;

function initTemplatesModule() {
  if (!templatesLoaded) loadTemplatesList();
  else renderTemplatesList();
}

async function loadTemplatesList() {
  const grid = document.getElementById('templates-grid');
  if (!grid.childElementCount) { grid.style.display = ''; showSkeleton(grid, 'cards', 3); }
  let list;
  try { list = await window.api.listTemplates(); }
  catch { toast('Could not load templates'); return; }
  templates = Array.isArray(list) ? list : [];
  templatesLoaded = true;
  renderTemplatesList();
}

function applyTemplateFilter() {
  templateFilter = (document.getElementById('templates-filter').value || '').toLowerCase().trim();
  renderTemplatesList();
}

function renderTemplatesList() {
  const grid  = document.getElementById('templates-grid');
  const empty = document.getElementById('templates-empty-state');
  grid.innerHTML = '';

  if (templates.length === 0) {
    grid.style.display = 'none';
    empty.hidden = false;
    empty.querySelector('p').innerHTML = 'No templates yet — click <strong>+ New Template</strong> to add a template';
    return;
  }

  const shown = templates.filter(t => textMatch(
    [t.name, lkLabel('TEMPLATE_CATEGORY', t.category), t.notes, t.file && t.file.originalName],
    templateFilter));

  if (shown.length === 0) {
    grid.style.display = 'none';
    empty.hidden = false;
    empty.querySelector('p').textContent = 'No templates match your search';
    return;
  }
  grid.style.display = '';
  empty.hidden = true;
  shown.forEach(t => grid.appendChild(buildTemplateCard(t)));
}

// One card: header (icon + name + category pill + edit/delete), optional
// notes, the file chip, file action buttons.
function buildTemplateCard(tpl) {
  const f = tpl.file;
  const present = !!(f && f.exists);
  const missing = !!(f && !f.exists);
  const card = pjMk('div', 'cd-card' + (present ? ' available' : '') + (missing ? ' missing' : ''));
  card.dataset.templateId = tpl.id;   // palette deep-link scroll+highlight target

  const head = pjMk('div', 'cd-card-head');
  const icon = pjMk('div', 'cd-card-icon');
  icon.innerHTML = ic(present ? 'circle-check' : (missing ? 'triangle-alert' : 'layout-template'));
  head.appendChild(icon);

  const titleWrap = pjMk('div', 'cd-card-title');
  const nameEl = pjMk('div', 'cd-card-name', tpl.name || 'Untitled template');
  if (tpl.name) { nameEl.title = tpl.name; nameEl.dataset.userContent = ''; }
  titleWrap.appendChild(nameEl);
  if (tpl.category) titleWrap.appendChild(pjMk('span', 'cd-card-cat', lkLabel('TEMPLATE_CATEGORY', tpl.category)));
  head.appendChild(titleWrap);

  const headIcons = pjMk('div', 'cd-card-icons');
  const editBtn = pjMk('button', 'cd-icon-btn');
  editBtn.innerHTML = ic('pencil');
  editBtn.title = 'Edit';
  editBtn.addEventListener('click', () => openTemplateModal(tpl));
  headIcons.appendChild(editBtn);
  const delBtn = pjMk('button', 'cd-icon-btn danger');
  delBtn.innerHTML = ic('trash-2');
  delBtn.title = 'Delete';
  delBtn.addEventListener('click', () =>
    showDeleteConfirm(headIcons, () => deleteTemplate(tpl.id), () => renderTemplatesList()));
  headIcons.appendChild(delBtn);
  head.appendChild(headIcons);
  card.appendChild(head);

  if (tpl.notes) card.appendChild(pjMk('div', 'cd-notes', tpl.notes));

  // The file as one chip: a type badge, the name without its extension, and
  // size + upload date under it. Clicking a present file opens it.
  const fileRow = pjMk(present ? 'button' : 'div', 'cd-file' + (f ? '' : ' is-empty') + (missing ? ' is-missing' : ''));
  if (!f) {
    fileRow.appendChild(pjMk('span', 'cd-file-badge', '—'));
    fileRow.appendChild(pjMk('span', 'cd-file-name', 'No file uploaded'));
  } else {
    const full = f.originalName || '(file)';
    const dot = full.lastIndexOf('.');
    const ext = dot > 0 ? full.slice(dot + 1).toUpperCase().slice(0, 4) : 'FILE';
    const base = dot > 0 ? full.slice(0, dot) : full;
    fileRow.appendChild(pjMk('span', 'cd-file-badge', ext));
    const text = pjMk('span', 'cd-file-text');
    const fname = pjMk('span', 'cd-file-name', base);
    fname.dataset.userContent = '';
    text.appendChild(fname);
    text.appendChild(pjMk('span', 'cd-file-meta', missing ? 'File missing from disk'
      : fmtFileSize(f.size) + (f.uploadedAt ? ' · ' + new Date(f.uploadedAt).toLocaleDateString('en-GB') : '')));
    fileRow.appendChild(text);
    fileRow.title = present ? 'Open with default app' : full;
    if (present) { fileRow.type = 'button'; fileRow.addEventListener('click', () => openTemplateFile(tpl.id)); }
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
    actions.appendChild(mkBtn('primary', 'upload', 'Upload', 'Upload a file', () => uploadTemplateFile(tpl.id)));
  } else {
    if (present) actions.appendChild(mkBtn('primary', 'external-link', 'Open file', 'Open with default app', () => openTemplateFile(tpl.id)));
    else actions.appendChild(mkBtn('primary', 'upload', 'Replace', 'Replace with another file', () => uploadTemplateFile(tpl.id)));
    actions.appendChild(pjMk('span', 'cd-actions-gap'));
    if (present) {
      actions.appendChild(mkBtn('', 'download', '', 'Save a copy', () => downloadTemplateFile(tpl.id)));
      actions.appendChild(mkBtn('', 'upload', '', 'Replace with another file', () => uploadTemplateFile(tpl.id)));
    }
    actions.appendChild(mkBtn('danger', 'trash-2', '', 'Remove this file', () =>
      showDeleteConfirm(actions, () => removeTemplateFile(tpl.id), () => renderTemplatesList())));
  }
  card.appendChild(actions);
  return card;
}

// A leading "no category" option, since category is optional.
function populateTemplateCategorySelect(currentVal) {
  const el = document.getElementById('tpl-category');
  el.innerHTML = '';
  const none = document.createElement('option');
  none.value = ''; none.textContent = '— No category —';
  el.appendChild(none);
  lkOptions('TEMPLATE_CATEGORY').forEach(opt => {
    const o = document.createElement('option');
    o.dataset.userContent = ''; o.value = opt.code; o.textContent = lookupDisplayName(opt);
    if (opt.code === currentVal) o.selected = true;
    el.appendChild(o);
  });
  if (!currentVal) none.selected = true;
}

function openTemplateModal(tpl) {
  templateEditId = tpl ? tpl.id : null;
  document.getElementById('template-modal-title').textContent = tpl ? 'Edit Template' : 'New Template';
  document.getElementById('template-modal-submit').textContent = tpl ? 'Save Changes' : 'Add Template';
  document.getElementById('tpl-name').value = tpl ? (tpl.name || '') : '';
  document.getElementById('tpl-notes').value = tpl ? (tpl.notes || '') : '';
  populateTemplateCategorySelect(tpl ? tpl.category : '');

  clearErrorsIn('#template-modal');
  document.getElementById('template-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('tpl-name').focus(), 80);
}
function closeTemplateModal() {
  document.getElementById('template-modal-overlay').classList.remove('open');
  templateEditId = null;
}
function templateOverlayClick(e) {
  if (e.target === document.getElementById('template-modal-overlay')) closeTemplateModal();
}

async function submitTemplateModal() {
  clearErrorsIn('#template-modal');
  const name = document.getElementById('tpl-name').value.trim();
  if (!name) { markError('tpl-name'); return; }
  const data = {
    name,
    category: document.getElementById('tpl-category').value || '',
    notes:    document.getElementById('tpl-notes').value.trim(),
  };
  try {
    if (templateEditId != null) {
      await window.api.updateCompanyDocument(templateEditId, data);
      closeTemplateModal();
      toast('Template saved');
    } else {
      await window.api.createTemplate(data);
      closeTemplateModal();
      toast('Template created');
    }
  } catch { toast('Could not save template'); return; }
  await loadTemplatesList();
}

// Apply a CompanyDocFileResult ({ ok, document, error, canceled }) to the grid.
function applyTemplateFileResult(res, failMsg) {
  if (!res || res.canceled) return false;
  if (!res.ok || !res.document) { toast(res?.error || failMsg); return false; }
  templates = templates.map(t => t.id === res.document.id ? res.document : t);
  renderTemplatesList();
  return true;
}
async function uploadTemplateFile(id) {
  let res;
  try { res = await window.api.uploadTemplate(id); }
  catch { toast('Could not upload file'); return; }
  if (!applyTemplateFileResult(res, 'Could not upload file')) return;
  if (res.replacedFile) {
    toast('File replaced', { actionLabel: 'Undo', duration: 5000, onAction: async () => {
      const restored = await window.api.restoreRemovedCompanyDocument(id, res.replacedFile);
      if (restored?.ok && restored.replacedFile?.path) await window.api.purgeCompanyDocumentFile(id, restored.replacedFile.path);
      if (restored?.ok) applyTemplateFileResult(restored, 'Could not restore the previous file');
      toast(restored?.ok ? 'Previous file restored' : (restored?.error || 'Could not restore the previous file'));
    }, onExpire: () => window.api.purgeCompanyDocumentFile(id, res.replacedFile.path).catch(() => {}) });
  } else toast('File saved');
}
async function removeTemplateFile(id) {
  let res;
  try { res = await window.api.removeCompanyDocument(id); }
  catch { toast('Could not remove file'); return; }
  if (!applyTemplateFileResult(res, 'Could not remove file')) return;
  if (!res.removedFile) { toast('File removed'); return; }
  toast('File removed', { actionLabel: 'Undo', duration: 5000, onAction: async () => {
    const restored = await window.api.restoreRemovedCompanyDocument(id, res.removedFile);
    if (restored?.ok) applyTemplateFileResult(restored, 'Could not restore the file');
    toast(restored?.ok ? 'File restored' : (restored?.error || 'Could not restore the file'));
  }, onExpire: () => window.api.purgeCompanyDocumentFile(id, res.removedFile.path).catch(() => {}) });
}
async function downloadTemplateFile(id) {
  let res;
  try { res = await window.api.downloadCompanyDocument(id); }
  catch { toast('Could not download file'); return; }
  if (!res || res.canceled) return;
  toast(res.ok ? 'File saved' : (res.error || 'Could not download file'));
}
async function openTemplateFile(id) {
  let res;
  try { res = await window.api.openCompanyDocument(id); }
  catch { toast('Could not open file'); return; }
  if (!res.ok) toast(res.error || 'Could not open file');
}

// ── Delete + undo (re-creates the card on undo: no hard loss) ──
async function deleteTemplate(id) {
  const snapshot = templates.find(t => t.id === id);
  if (!snapshot) return;
  try { await window.api.deleteCompanyDocument(id); }
  catch { toast('Could not delete template'); renderTemplatesList(); return; }
  templates = templates.filter(t => t.id !== id);
  renderTemplatesList();
  showTemplateUndoToast(snapshot);
}
function showTemplateUndoToast(snapshot) {
  // A second delete inside the window makes the first one final.
  if (undoTemplate) window.api.purgeCompanyDocumentFiles(undoTemplate.id).catch(() => {});
  undoTemplate = snapshot;
  clearTimeout(_undoTemplateTimer);
  document.getElementById('template-undo-toast').classList.add('visible');
  _undoTemplateTimer = setTimeout(hideTemplateUndoToast, 5000);
}
function hideTemplateUndoToast() {
  document.getElementById('template-undo-toast').classList.remove('visible');
  // Undo window lapsed without an undo → the deletion is final; purge the
  // card's file folder (best-effort; the boot orphan-sweep is backup).
  if (undoTemplate) window.api.purgeCompanyDocumentFiles(undoTemplate.id).catch(() => {});
  undoTemplate = null;
}
async function undoDeleteTemplate() {
  if (!undoTemplate) return;
  const snap = undoTemplate;
  undoTemplate = null;
  clearTimeout(_undoTemplateTimer);
  document.getElementById('template-undo-toast').classList.remove('visible');
  try {
    const created = await window.api.createTemplate({ name: snap.name, category: snap.category, notes: snap.notes });
    // Move the still-on-disk file (if any) onto the re-created card and re-record
    // its metadata (the row was hard-deleted; the bytes survived the undo window).
    if (snap.file) await window.api.restoreCompanyDocumentFile(snap.id, created.id, snap.file);
    toast('Template restored');
  } catch { toast('Could not restore template'); }
  await loadTemplatesList();
}
