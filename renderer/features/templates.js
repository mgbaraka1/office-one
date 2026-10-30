// ══ TEMPLATES — Company Document cards of kind TEMPLATE ═══════════════════
// The same card as Company Documents (name/category/notes + at most one file,
// stored under company_documents/{id}/) with a TEMPLATE_CATEGORY and no
// renewal date. Listing, creating and the upload dialog have their own calls;
// every other card and file action goes through the companydocs ones by id.
// Reuses the cd-* card styles and the same delete/undo pattern.
let templates = [];
let templatesLoaded = false;
let templateFilter = '';
let templateCat = null;          // category chip: null = All, '' = no category
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

function setTemplateCategory(code) {
  templateCat = code;
  renderTemplatesList();
}

// Category chips, then one slim row per template grouped under its category
// (in the lookup's order, "No category" last).
function renderTemplatesList() {
  const grid  = document.getElementById('templates-grid');
  const chips = document.getElementById('templates-chips');
  const empty = document.getElementById('templates-empty-state');
  grid.innerHTML = '';
  chips.innerHTML = '';

  if (templates.length === 0) {
    grid.style.display = 'none';
    chips.hidden = true;
    empty.hidden = false;
    empty.querySelector('p').innerHTML = 'No templates yet — click <strong>+ New Template</strong> to add a template';
    return;
  }

  const searched = templates.filter(t => textMatch(
    [t.name, lkLabel('TEMPLATE_CATEGORY', t.category), t.notes, t.file && t.file.originalName],
    templateFilter));

  // Groups in lookup order; codes no longer in the lookup still get a group.
  const order = lkOptions('TEMPLATE_CATEGORY', true).map(o => o.code);
  const groups = new Map();
  searched.forEach(t => {
    const code = t.category || '';
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(t);
  });
  const rank = code => code === '' ? Infinity : (order.indexOf(code) + 1 || order.length + 1);
  const codes = [...groups.keys()].sort((a, b) => rank(a) - rank(b));
  const catName = code => code ? lkLabel('TEMPLATE_CATEGORY', code) : 'No category';
  if (templateCat !== null && !groups.has(templateCat)) templateCat = null;

  chips.hidden = codes.length < 2;
  const chip = (code, label, n) => {
    const b = pjMk('button', 'pfm-chip' + (templateCat === code ? ' active' : ''));
    b.type = 'button';
    b.appendChild(pjMk('span', '', label));
    b.appendChild(pjMk('span', 'pfm-chip-count', String(n)));
    b.addEventListener('click', () => setTemplateCategory(code));
    chips.appendChild(b);
  };
  chip(null, 'All', searched.length);
  codes.forEach(code => chip(code, catName(code), groups.get(code).length));

  if (searched.length === 0) {
    grid.style.display = 'none';
    empty.hidden = false;
    empty.querySelector('p').textContent = 'No templates match your search';
    return;
  }
  grid.style.display = '';
  empty.hidden = true;
  codes.filter(code => templateCat === null || code === templateCat).forEach(code => {
    const head = pjMk('div', 'tpl-group-head');
    head.appendChild(pjMk('span', '', catName(code)));
    head.appendChild(pjMk('span', 'tpl-group-count', String(groups.get(code).length)));
    grid.appendChild(head);
    const box = pjMk('div', 'tpl-group');
    groups.get(code)
      .slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true }))
      .forEach(t => box.appendChild(buildTemplateRow(t)));
    grid.appendChild(box);
  });
}

// One row: type badge, name (+ file name when it differs, size · date),
// Open + Save a copy, and a ⋯ menu for Edit / Replace / Remove file / Delete.
function buildTemplateRow(tpl) {
  const f = tpl.file;
  const present = !!(f && f.exists);
  const missing = !!(f && !f.exists);
  const row = pjMk('div', 'tpl-row' + (missing ? ' is-missing' : '') + (f ? '' : ' is-empty'));
  row.dataset.templateId = tpl.id;   // palette deep-link scroll+highlight target

  const full = f ? (f.originalName || '(file)') : '';
  const dot = full.lastIndexOf('.');
  const ext = !f ? '—' : (dot > 0 ? full.slice(dot + 1).toUpperCase().slice(0, 4) : 'FILE');
  const base = dot > 0 ? full.slice(0, dot) : full;
  row.appendChild(pjMk('span', 'cd-file-badge tpl-badge', ext));

  const main = pjMk(present ? 'button' : 'div', 'tpl-main');
  if (present) {
    main.type = 'button';
    main.title = 'Open with default app';
    main.addEventListener('click', () => openTemplateFile(tpl.id));
  }
  const nameEl = pjMk('span', 'tpl-name', tpl.name || 'Untitled template');
  if (tpl.name) nameEl.dataset.userContent = '';
  main.appendChild(nameEl);
  const sub = pjMk('span', 'tpl-sub');
  if (base && base.trim().toLowerCase() !== String(tpl.name || '').trim().toLowerCase()) {
    const fn = pjMk('span', 'tpl-file', base);
    fn.dataset.userContent = '';
    sub.appendChild(fn);
  }
  if (tpl.notes) {
    const notes = pjMk('span', 'tpl-notes', tpl.notes);
    notes.dataset.userContent = '';
    sub.appendChild(notes);
  }
  if (sub.childElementCount) main.appendChild(sub);
  row.appendChild(main);

  row.appendChild(pjMk('span', 'tpl-meta', !f ? 'No file uploaded' : missing ? 'File missing from disk'
    : fmtFileSize(f.size) + (f.uploadedAt ? ' · ' + new Date(f.uploadedAt).toLocaleDateString('en-GB') : '')));

  const actions = pjMk('div', 'tpl-actions');
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
  if (present) {
    actions.appendChild(mkBtn('primary', 'external-link', 'Open file', 'Open with default app', () => openTemplateFile(tpl.id)));
    actions.appendChild(mkBtn('', 'download', '', 'Save a copy', () => downloadTemplateFile(tpl.id)));
  } else {
    actions.appendChild(mkBtn('primary', 'upload', f ? 'Replace' : 'Upload', f ? 'Replace with another file' : 'Upload a file',
      () => uploadTemplateFile(tpl.id)));
  }
  const menu = [{ label: 'Edit', run: () => openTemplateModal(tpl) }];
  if (present) menu.push({ label: 'Replace file', run: () => uploadTemplateFile(tpl.id) });
  if (f) menu.push({ label: 'Remove file', danger: true, run: () =>
    showDeleteConfirm(actions, () => removeTemplateFile(tpl.id), () => renderTemplatesList(), 'Remove file?') });
  menu.push({ label: 'Delete', danger: true, run: () =>
    showDeleteConfirm(actions, () => deleteTemplate(tpl.id), () => renderTemplatesList()) });
  actions.appendChild(buildKnowledgeOverflow(menu));
  row.appendChild(actions);
  return row;
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
