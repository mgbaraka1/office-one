// ══ KNOWLEDGE HUB ══════════════════════════════════════════════════════════
let knowledgeItems = [], knowledgeLoaded = false;
let knowledgeFilters = new Set(), knowledgeFilterSections = {}, knowledgeFilterShowAll = {};
let knowledgeCurrentId = null, knowledgeCurrentItem = null, knowledgeEditId = null;
let knowledgeUndo = null, knowledgeUndoTimer = null, knowledgeEditorDirty = false;
let knowledgeDocumentItemId = null, knowledgeEditorFile = null, knowledgeDocumentFile = null, knowledgeFileTarget = 'editor';
let knowledgeEditorTags = [], knowledgePendingDraft = null, knowledgeEditorStatus = 'PUBLISHED';
let khCompaniesPicker = null, khSystemsPicker = null;
let knowledgeUiRestored = false, knowledgeListFocus = null, knowledgeDropReady = false, knowledgeDragDepth = 0;

function knowledgeDocumentCount(item) { return Number(item.documentCount ?? item.documents?.length ?? 0); }
function knowledgeStatusLabel(status) { return status === 'PUBLISHED' ? 'Ready' : status === 'ARCHIVED' ? 'Archived' : 'Draft'; }
// Items link to clients (the COMPANY lookup) and systems (SYSTEM) — how documents are looked up.
function knowledgeLinkName(kind, link) { return kind === 'companies' ? companyDisplayName(link, false) : lookupDisplayName(link); }
function knowledgeLinkPill(kind, link, tag = 'span') {
  const pill = pjMk(tag, 'kh-pill kh-pill-' + (kind === 'companies' ? 'client' : 'system'), knowledgeLinkName(kind, link));
  pill.dataset.userContent = ''; return pill;
}
function initKnowledgeModule() {
  if (!knowledgeUiRestored) {
    const saved = uiState.filters?.knowledge || {};
    // Groups and the Draft/Ready facets are retired; only Archived survives as a status filter.
    const restored = (Array.isArray(saved.filters) ? saved.filters : [])
      .filter(key => /^(TYPE|CLIENT|SYSTEM|TAG):/.test(key) || key === 'STATUS:ARCHIVED');
    knowledgeFilters = new Set(restored);
    knowledgeFilterSections = Object.assign({}, saved.sections || {});
    document.getElementById('kh-search').value = saved.query || '';
    document.getElementById('kh-sort').value = ['updated', 'title', 'documents', 'created'].includes(saved.sort) ? saved.sort : 'updated';
    knowledgeUiRestored = true;
  }
  setupKnowledgeFileDrop();
  showKnowledgeListView();
  knowledgeCurrentId = null;
  knowledgeCurrentItem = null;
  if (!knowledgeLoaded) loadKnowledgeItems(); else renderKnowledgeList();
}
// The item opens in a side panel next to the list, so the list stays in view.
function showKnowledgeListView() {
  const panel = document.getElementById('kh-detail-view');
  panel.hidden = true; panel.innerHTML = '';
  document.getElementById('kh-list-view').classList.remove('has-panel');
  document.querySelectorAll('#kh-list .kh-row.active').forEach(row => row.classList.remove('active'));
}
function showKnowledgeDetailView() {
  document.getElementById('kh-detail-view').hidden = false;
  document.getElementById('kh-list-view').classList.add('has-panel');
}
async function loadKnowledgeItems(openId) {
  try { knowledgeItems = (await window.api.listKnowledgeItems()) || []; knowledgeLoaded = true; }
  catch { toast('Could not load Knowledge Hub'); return; }
  const targetId = openId != null ? openId : knowledgeCurrentId;
  renderKnowledgeList();
  if (targetId != null && knowledgeItems.some(item => item.id === Number(targetId))) await openKnowledgeDetail(targetId);
  else { showKnowledgeListView(); knowledgeCurrentId = null; knowledgeCurrentItem = null; }
}
// ── Files: names, families, versions ──
// "ACME_Mapping_v2.3.xlsx" → { base: 'ACME_Mapping', version: '2.3' }. A
// Windows copy marker like " (2)" is dropped and never read as a version.
function knowledgeParseFileName(fileName, hasExtension = true) {
  let stem = String(fileName || '').trim();
  if (hasExtension) stem = stem.replace(/\.[a-z0-9]{1,8}$/i, '');
  stem = stem.replace(/\s*\(\d+\)$/, '').trim();
  const numeric = stem.match(/[\s_.-]+(?:v|ver|version|rev)[\s_.-]*(\d+(?:[._]\d+)*)$/i);
  const letter = !numeric && stem.match(/[\s_.-]+rev[\s_.-]*([a-z])$/i);
  const match = numeric || letter;
  const base = (match ? stem.slice(0, match.index) : stem).trim() || stem;
  return { base, version: numeric ? numeric[1].replace(/_/g, '.') : letter ? 'Rev ' + letter[1].toUpperCase() : '' };
}
function knowledgeTitleFromFile(fileName) { return knowledgeParseFileName(fileName).base.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim(); }
// Match key: case, separators and a version suffix don't matter.
function knowledgeDocKey(value, hasExtension = false) {
  return knowledgeParseFileName(value, hasExtension).base.toLowerCase().replace(/[\s_.-]+/g, ' ').trim();
}
// Versions of one document share a name; each family is sorted newest first.
function knowledgeDocumentFamilies(documents) {
  const families = new Map();
  (documents || []).forEach(file => {
    const key = String(file.name || file.originalName || 'Document').trim().toLowerCase();
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(file);
  });
  return [...families.values()].map(family => family.sort(knowledgeVersionCompare))
    .sort((a, b) => String(a[0].name).localeCompare(String(b[0].name)));
}
function knowledgeFindFamily(documents, fileName, hasExtension = true) {
  const key = knowledgeDocKey(fileName, hasExtension); if (!key) return null;
  return knowledgeDocumentFamilies(documents).find(family => family.some(file =>
    knowledgeDocKey(file.name) === key || knowledgeDocKey(file.originalName, true) === key)) || null;
}
// The next free version after `latest`: 1.0 → 1.1, 2 → 3, 2026.07 → 2026.08, Rev B → Rev C.
function knowledgeNextVersion(latest, used = []) {
  const taken = new Set(used.map(value => String(value).trim().toLowerCase()));
  const bump = value => {
    const numeric = value.match(/^(.*?)(\d+)(\D*)$/);
    if (numeric) return numeric[1] + String(Number(numeric[2]) + 1).padStart(numeric[2].length, '0') + numeric[3];
    const letter = value.match(/^(.*?)([A-Ya-y])$/);
    return letter ? letter[1] + String.fromCharCode(letter[2].charCodeAt(0) + 1) : '';
  };
  let current = String(latest || '').trim();
  for (let i = 0; i < 100; i++) {
    current = bump(current);
    if (!current || !taken.has(current.toLowerCase())) return current;
  }
  return '';
}
function knowledgeSuggestVersion(family, fileName) {
  if (!family) return knowledgeParseFileName(fileName).version || '1.0';
  const used = family.map(file => file.version), fromName = knowledgeParseFileName(fileName).version;
  if (fromName && !used.some(value => String(value).toLowerCase() === fromName.toLowerCase())) return fromName;
  return knowledgeNextVersion(family[0].version, used);
}
// A dropped file whose name matches a document already on the shelf becomes
// that document's next version; the most recently updated item wins a tie.
function knowledgeFindItemForFile(fileName) {
  for (const item of knowledgeItems.filter(entry => entry.status !== 'ARCHIVED')) {
    const family = knowledgeFindFamily(item.documents, fileName);
    if (family) return { item, family };
  }
  return null;
}
// ── Drag and drop ──
function knowledgeDragHasFiles(event) { return [...(event.dataTransfer?.types || [])].includes('Files'); }
function knowledgeDroppedFile(event) {
  const files = event.dataTransfer?.files || [];
  if (files.length > 1) toast('Added the first file. Drop the others one at a time.');
  return files[0] || null;
}
function setupKnowledgeFileDrop() {
  if (knowledgeDropReady) return;
  knowledgeDropReady = true;
  const input = document.getElementById('kh-file-input');
  input.onchange = () => {
    const file = input.files?.[0]; if (!file) return;
    if (knowledgeFileTarget === 'document') applyKnowledgeDocumentFile(file); else setKnowledgeEditorFile(file);
  };
  [['kh-editor-drop', file => setKnowledgeEditorFile(file)], ['kh-document-drop', file => applyKnowledgeDocumentFile(file)]].forEach(([id, apply]) => {
    const zone = document.getElementById(id);
    zone.addEventListener('dragover', event => { if (!knowledgeDragHasFiles(event)) return; event.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', event => {
      event.preventDefault(); zone.classList.remove('over');
      const file = knowledgeDroppedFile(event); if (file) apply(file);
    });
  });
  // Dropping anywhere on the shelf: onto the open panel adds to that item;
  // elsewhere it finds the matching document, or starts a new item.
  const shell = document.getElementById('kh-list-view'), hint = document.getElementById('kh-drop-hint'), panel = document.getElementById('kh-detail-view');
  const onPanel = target => !!(knowledgeCurrentItem && target?.closest?.('#kh-detail-view'));
  const setHint = target => {
    panel.classList.toggle('kh-drop-over', onPanel(target));
    document.getElementById('kh-drop-hint-text').textContent = onPanel(target) ? 'Drop to add this file to the open item' : 'Drop to add this file';
  };
  const clear = () => { knowledgeDragDepth = 0; hint.hidden = true; shell.classList.remove('kh-dragging'); panel.classList.remove('kh-drop-over'); };
  shell.addEventListener('dragenter', event => {
    if (!knowledgeDragHasFiles(event)) return;
    knowledgeDragDepth++; hint.hidden = false; shell.classList.add('kh-dragging'); setHint(event.target);
  });
  shell.addEventListener('dragover', event => {
    if (!knowledgeDragHasFiles(event)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setHint(event.target);
  });
  shell.addEventListener('dragleave', event => { if (knowledgeDragHasFiles(event) && --knowledgeDragDepth <= 0) clear(); });
  shell.addEventListener('drop', event => {
    if (!knowledgeDragHasFiles(event)) return;
    event.preventDefault();
    const toPanel = onPanel(event.target); clear();
    const file = knowledgeDroppedFile(event); if (file) handleKnowledgeDrop(file, toPanel);
  });
}
async function handleKnowledgeDrop(file, toPanel) {
  if (toPanel && knowledgeCurrentItem) { openKnowledgeDocumentModal(knowledgeCurrentItem.id, '', file); return; }
  const match = knowledgeFindItemForFile(file.name);
  if (match) {
    await openKnowledgeDetail(match.item.id);
    openKnowledgeDocumentModal(match.item.id, match.family[0].name, file);
    return;
  }
  openKnowledgeEditor(null, file);
}
function chooseKnowledgeFile(target) {
  knowledgeFileTarget = target === 'document' ? 'document' : 'editor';
  const input = document.getElementById('kh-file-input'); input.value = ''; input.click();
}
function setKnowledgeFileLabel(id, file) {
  const label = document.getElementById(id);
  if (file) { label.textContent = file.name + ' · ' + fmtFileSize(file.size); label.dataset.userContent = ''; }
  else { delete label.dataset.userContent; label.textContent = 'Drop a file here, or'; }
  label.closest('.kh-dropzone').classList.toggle('has-file', !!file);
}
function knowledgeFilterDimension(key) {
  return key.startsWith('TYPE:') ? 'TYPE' : key.startsWith('STATUS:') ? 'STATUS'
    : key.startsWith('CLIENT:') ? 'CLIENT' : key.startsWith('SYSTEM:') ? 'SYSTEM' : 'TAG';
}
function toggleKnowledgeFilter(key) {
  const dimension = knowledgeFilterDimension(key);
  if (knowledgeFilters.has(key)) knowledgeFilters.delete(key);
  else {
    if (dimension !== 'TAG') [...knowledgeFilters].forEach(current => {
      if (knowledgeFilterDimension(current) === dimension) knowledgeFilters.delete(current);
    });
    knowledgeFilters.add(key);
  }
  renderKnowledgeList();
}
function appendKnowledgeFilterSection(host, id, title, entries, limit = 8) {
  if (!entries.length) return;
  const section = pjMk('div', 'kh-filter-section' + (knowledgeFilterSections[id] ? ' collapsed' : ''));
  section.dataset.filterId = id;
  if (id === 'clients' || id === 'systems' || id === 'tags') section.dataset.searchable = 'true';
  const heading = pjMk('div', 'kh-filter-title'), label = pjMk('span', '', title);
  const toggle = pjMk('button', 'kh-filter-toggle', knowledgeFilterSections[id] ? '▸' : '▾');
  toggle.title = (knowledgeFilterSections[id] ? 'Expand ' : 'Collapse ') + title;
  toggle.setAttribute('aria-expanded', String(!knowledgeFilterSections[id]));
  toggle.onclick = () => { knowledgeFilterSections[id] = !knowledgeFilterSections[id]; renderKnowledgeList(); };
  heading.append(label, toggle); section.appendChild(heading);
  const items = pjMk('div', 'kh-filter-items');
  entries.forEach((entry, index) => {
    const active = knowledgeFilters.has(entry.key);
    const b = pjMk('button', 'kh-filter-btn' + (active ? ' active' : ''));
    b.setAttribute('aria-pressed', String(active));
    b.dataset.filterLabel = entry.label.toLowerCase();
    b.dataset.overflow = String(index >= limit);
    b.hidden = index >= limit && !knowledgeFilterShowAll[id];
    b.append(document.createTextNode(entry.label), pjMk('span', '', String(entry.count)));
    b.onclick = () => toggleKnowledgeFilter(entry.key);
    items.appendChild(b);
  });
  if (entries.length > limit) {
    const moreLabel = knowledgeFilterShowAll[id]
      ? (window.ctI18n?.t?.('Show fewer') || 'Show fewer')
      : (window.ctI18n?.t?.('Show all {n}', { n: entries.length }) || `Show all ${entries.length}`);
    const more = pjMk('button', 'kh-filter-more', moreLabel);
    more.onclick = () => { knowledgeFilterShowAll[id] = !knowledgeFilterShowAll[id]; renderKnowledgeList(); };
    items.appendChild(more);
  }
  section.appendChild(items); host.appendChild(section);
}
// One facet entry per client / system linked to a non-archived item, A→Z.
function knowledgeLinkFacet(kind, prefix) {
  const counts = new Map();
  knowledgeItems.filter(x => x.status !== 'ARCHIVED').forEach(item => (item[kind] || []).forEach(link => {
    const current = counts.get(link.id);
    counts.set(link.id, { label: current?.label || knowledgeLinkName(kind, link), count: (current?.count || 0) + 1 });
  }));
  return [...counts.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label))
    .map(([id, entry]) => ({ key: prefix + id, label: entry.label, count: entry.count }));
}
function renderKnowledgeFilters() {
  const host = document.getElementById('kh-filters'); host.innerHTML = '';
  const browse = pjMk('div', 'kh-filter-section'), heading = pjMk('div', 'kh-filter-title', 'Browse');
  const all = pjMk('button', 'kh-filter-btn' + (!knowledgeFilters.size ? ' active' : ''));
  all.setAttribute('aria-pressed', String(!knowledgeFilters.size));
  all.append(document.createTextNode('All knowledge'), pjMk('span', '', String(knowledgeItems.filter(x => x.status !== 'ARCHIVED').length)));
  all.onclick = () => { knowledgeFilters.clear(); renderKnowledgeList(); };
  browse.append(heading, all);
  const facetSearch = document.createElement('input'); facetSearch.type = 'search'; facetSearch.className = 'mod-search';
  facetSearch.style.cssText = 'width:100%;min-width:0;margin-top:8px'; facetSearch.placeholder = 'Filter clients, systems, or tags…';
  facetSearch.setAttribute('aria-label', 'Filter Knowledge Hub clients, systems, and tags');
  facetSearch.oninput = () => filterKnowledgeFacetButtons(facetSearch.value);
  browse.appendChild(facetSearch); host.appendChild(browse);
  appendKnowledgeFilterSection(host, 'clients', 'Clients', knowledgeLinkFacet('companies', 'CLIENT:'));
  appendKnowledgeFilterSection(host, 'systems', 'Systems', knowledgeLinkFacet('systems', 'SYSTEM:'));
  const types = lkOptions('KNOWLEDGE_TYPE').map(type => ({
    key: 'TYPE:' + type.code, label: lookupDisplayName(type),
    count: knowledgeItems.filter(x => x.type === type.code && x.status !== 'ARCHIVED').length,
  })).filter(type => type.count || knowledgeFilters.has(type.key));
  appendKnowledgeFilterSection(host, 'types', 'Document kind', types);
  const tagCounts = new Map();
  knowledgeItems.filter(x => x.status !== 'ARCHIVED').forEach(item => (item.tags || []).forEach(tag => {
    const key = tag.toLowerCase(), current = tagCounts.get(key);
    tagCounts.set(key, { label: current?.label || tag, count: (current?.count || 0) + 1 });
  }));
  const tags = [...tagCounts.entries()].sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label))
    .map(([key, tag]) => ({ key: 'TAG:' + key, label: '#' + tag.label, count: tag.count }));
  appendKnowledgeFilterSection(host, 'tags', 'Tags', tags, 10);
  const archived = knowledgeItems.filter(x => x.status === 'ARCHIVED').length;
  if (archived || knowledgeFilters.has('STATUS:ARCHIVED'))
    appendKnowledgeFilterSection(host, 'status', 'Archived items', [{ key: 'STATUS:ARCHIVED', label: 'Archived', count: archived }]);
}
function filterKnowledgeFacetButtons(value) {
  const q = String(value || '').trim().toLowerCase();
  document.querySelectorAll('#kh-filters .kh-filter-section[data-searchable] .kh-filter-btn').forEach(button => {
    button.hidden = q ? !String(button.dataset.filterLabel || '').includes(q)
      : button.dataset.overflow === 'true' && !knowledgeFilterShowAll[button.closest('.kh-filter-section')?.dataset.filterId];
  });
  document.querySelectorAll('#kh-filters .kh-filter-section[data-searchable]').forEach(section => {
    section.classList.toggle('collapsed', !q && !!knowledgeFilterSections[section.dataset.filterId]);
  });
}
function knowledgeContentPlainText(item) {
  const raw = String(item?.content || '');
  if (item?.contentFormat !== 'html' || !raw) return raw;
  const scratch = document.createElement('div');
  scratch.innerHTML = sanitizeKnowledgeHtml(raw);
  return scratch.textContent.replace(/\s+/g, ' ').trim();
}
function knowledgeMatches(item, q) {
  const tagQuery = String(q || '').replace(/^#/, '');
  return textMatch([item.title, item.summary, knowledgeContentPlainText(item), item.typeLabel, ...(item.tags || []),
    ...['companies', 'systems'].flatMap(kind => (item[kind] || []).flatMap(x => [x.code, x.label, x.nameEn, x.nameAr])),
    ...(item.documents || []).flatMap(x => [x.name, x.version, x.originalName, x.changeNote])], q)
    || (!!tagQuery && (item.tags || []).some(tag => tag.toLowerCase().includes(tagQuery)));
}
function knowledgePassesFilters(item) {
  const status = [...knowledgeFilters].filter(x => x.startsWith('STATUS:')).map(x => x.slice(7));
  const types = [...knowledgeFilters].filter(x => x.startsWith('TYPE:')).map(x => x.slice(5));
  const clients = [...knowledgeFilters].filter(x => x.startsWith('CLIENT:')).map(x => Number(x.slice(7)));
  const systems = [...knowledgeFilters].filter(x => x.startsWith('SYSTEM:')).map(x => Number(x.slice(7)));
  const tags = [...knowledgeFilters].filter(x => x.startsWith('TAG:')).map(x => x.slice(4));
  if (!status.length && item.status === 'ARCHIVED') return false;
  if (status.length && !status.includes(item.status)) return false;
  if (types.length && !types.includes(item.type)) return false;
  if (clients.length && !clients.some(id => (item.companies || []).some(link => link.id === id))) return false;
  if (systems.length && !systems.some(id => (item.systems || []).some(link => link.id === id))) return false;
  if (tags.length && !tags.every(tag => (item.tags || []).some(value => value.toLowerCase() === tag))) return false;
  return true;
}
function knowledgeRowSubtitle(item, q = '') {
  const content = knowledgeContentPlainText(item), words = String(q || '').split(/\s+/).filter(Boolean);
  const hit = words.map(word => content.toLowerCase().indexOf(word.toLowerCase())).find(index => index >= 0);
  if (hit != null) {
    const start = Math.max(0, hit - 55), snippet = content.slice(start, start + 170).replace(/\s+/g, ' ').trim();
    return (start ? '…' : '') + snippet + (start + 170 < content.length ? '…' : '');
  }
  if (item.summary) return item.summary;
  const docs = item.documents || [];
  if (docs.length) {
    const names = [...new Set(docs.map(document => document.name).filter(Boolean))];
    return knowledgeDocumentCount(item) + ' document' + (knowledgeDocumentCount(item) === 1 ? '' : 's') + (names.length ? ' · ' + names.slice(0, 2).join(' · ') : '');
  }
  if (content) return content.split(/\r?\n/).find(line => line.trim())?.trim() || 'Written knowledge item';
  return 'No documents or written content yet';
}
function appendHighlightedText(host, text, q) {
  const words = [...new Set(String(q || '').split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!words.length) { host.textContent = text; return; }
  const escaped = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp('(' + escaped.join('|') + ')', 'ig');
  String(text || '').split(regex).forEach(part => {
    if (words.some(word => word.toLowerCase() === part.toLowerCase())) host.appendChild(pjMk('mark', 'kh-hit', part));
    else host.appendChild(document.createTextNode(part));
  });
}
function renderKnowledgeActiveFilters() {
  const host = document.getElementById('kh-active-filters'); host.innerHTML = '';
  [...knowledgeFilters].forEach(key => {
    let label = key;
    if (key.startsWith('TYPE:')) label = lookupDisplayName(lkOptions('KNOWLEDGE_TYPE').find(x => x.code === key.slice(5))) || key.slice(5);
    else if (key.startsWith('STATUS:')) label = knowledgeStatusLabel(key.slice(7));
    else if (key.startsWith('CLIENT:')) label = lkLabelById('COMPANY', key.slice(7)) || 'Client';
    else if (key.startsWith('SYSTEM:')) label = lkLabelById('SYSTEM', key.slice(7)) || 'System';
    else if (key.startsWith('TAG:')) label = '#' + key.slice(4);
    const chip = pjMk('button', 'kh-filter-chip', label + ' ×'); chip.title = 'Remove filter ' + label;
    chip.onclick = () => toggleKnowledgeFilter(key); host.appendChild(chip);
  });
}
function resetKnowledgeFilters() {
  knowledgeFilters.clear(); document.getElementById('kh-search').value = ''; renderKnowledgeList();
}
function renderKnowledgeList() {
  if (!knowledgeLoaded) return;
  renderKnowledgeFilters(); renderKnowledgeActiveFilters();
  const q = (document.getElementById('kh-search').value || '').trim().toLowerCase();
  let shown = knowledgeItems.filter(item => knowledgePassesFilters(item) && (!q || knowledgeMatches(item, q)));
  const sort = document.getElementById('kh-sort').value;
  shown.sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title)
    : sort === 'documents' ? knowledgeDocumentCount(b) - knowledgeDocumentCount(a) || a.title.localeCompare(b.title)
    : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
  const documentCount = shown.reduce((sum, item) => sum + knowledgeDocumentCount(item), 0);
  document.getElementById('kh-result-count').textContent = shown.length + ' item' + (shown.length === 1 ? '' : 's') + ' · ' + documentCount + ' document' + (documentCount === 1 ? '' : 's');
  const list = document.getElementById('kh-list'), empty = document.getElementById('kh-empty');
  list.innerHTML = ''; empty.hidden = shown.length > 0;
  if (!shown.length) {
    const hasQuery = !!q, filtered = knowledgeFilters.size > 0;
    document.getElementById('kh-empty-title').textContent = hasQuery ? 'No search results' : filtered ? 'Nothing in this view' : 'No knowledge yet';
    document.getElementById('kh-empty-copy').textContent = hasQuery ? 'Try fewer words, a document version, or a different tag.' : filtered ? 'Remove a filter to broaden this view.' : 'Drop a file here, or click New item.';
    document.getElementById('kh-empty-clear').hidden = !hasQuery && !filtered;
  }
  shown.forEach(item => {
    const row = pjMk('div', 'kh-row' + (item.id === knowledgeCurrentId ? ' active' : '')); row.dataset.knowledgeId = item.id;
    const main = pjMk('button', 'kh-row-main'); main.type = 'button';
    const icon = pjMk('span', 'kh-row-icon'); icon.innerHTML = ic(item.type === 'TROUBLESHOOTING' ? 'wrench' : item.type === 'INTEGRATION_GUIDE' ? 'plug' : 'book-open');
    const copy = pjMk('div'), title = pjMk('div', 'kh-row-title');
    appendHighlightedText(title, item.title, q); copy.appendChild(title);
    const subtitle = q ? knowledgeRowSubtitle(item, q) : item.summary;
    if (subtitle) { const summary = pjMk('div', 'kh-row-summary'); appendHighlightedText(summary, subtitle, q); copy.appendChild(summary); }
    const meta = pjMk('div', 'kh-meta'), families = knowledgeDocumentFamilies(item.documents);
    if (item.status !== 'PUBLISHED') meta.appendChild(pjMk('span', 'kh-pill ' + item.status.toLowerCase(), knowledgeStatusLabel(item.status)));
    ['companies', 'systems'].forEach(kind => (item[kind] || []).forEach(link => meta.appendChild(knowledgeLinkPill(kind, link))));
    if (item.typeLabel || item.type) meta.appendChild(pjMk('span', 'kh-pill', lkLabel('KNOWLEDGE_TYPE', item.type) || item.typeLabel));
    if (families.length === 1) meta.appendChild(pjMk('span', 'kh-version-pill', formatKnowledgeVersion(families[0][0].version)));
    else if (families.length > 1) meta.appendChild(pjMk('span', 'kh-pill', families.length + ' documents'));
    copy.appendChild(meta);
    main.append(icon, copy, pjMk('span', 'kh-row-date', 'Updated ' + new Date(item.updatedAt).toLocaleDateString()));
    main.onclick = () => { knowledgeListFocus = main; openKnowledgeDetail(item.id); };
    row.appendChild(main);
    const open = buildKnowledgeRowOpen(families);
    if (open) { const cell = pjMk('div', 'kh-row-actions'); cell.appendChild(open); row.appendChild(cell); }
    list.appendChild(row);
  });
  uiState.filters ||= {};
  uiState.filters.knowledge = { filters: [...knowledgeFilters], query: q, sort, sections: knowledgeFilterSections };
  saveUiStateDebounced();
}
function khButton(label, cls, fn) { const b = pjMk('button', 'btn' + (cls ? ' ' + cls : ''), label); b.onclick = fn; return b; }
function formatKnowledgeVersion(value) { const version = String(value || '1.0').trim(); return /^(v|rev(?:ision)?\b)/i.test(version) ? version : 'v' + version; }
function knowledgeVersionCompare(a, b) { return String(b.version || '').localeCompare(String(a.version || ''), undefined, { numeric: true, sensitivity: 'base' }) || String(b.uploadedAt).localeCompare(String(a.uploadedAt)); }
// One click opens the latest version; with several documents it lists them.
function buildKnowledgeRowOpen(families) {
  if (!families.length) return null;
  if (families.length === 1) return khButton('Open file', 'small', () => openKnowledgeAttachment(families[0][0].id));
  return buildKnowledgeOverflow(families.map(family => ({
    label: (family[0].name || family[0].originalName) + ' · ' + formatKnowledgeVersion(family[0].version),
    userContent: true, run: () => openKnowledgeAttachment(family[0].id),
  })), 'Open file ▾');
}
function buildKnowledgeOverflow(actions, triggerLabel) {
  const wrap = pjMk('div', 'kh-overflow'), trigger = khButton(triggerLabel || '•••', 'small', () => {});
  if (!triggerLabel) trigger.title = 'More actions';
  trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
  const menu = pjMk('div', 'kh-overflow-menu'); menu.setAttribute('role', 'menu'); menu.hidden = true;
  trigger.onclick = event => {
    event.stopPropagation();
    document.querySelectorAll('.kh-overflow-menu').forEach(other => { if (other !== menu) other.hidden = true; });
    menu.hidden = !menu.hidden; trigger.setAttribute('aria-expanded', String(!menu.hidden));
  };
  menu.onclick = event => event.stopPropagation();
  actions.forEach(action => {
    const button = pjMk('button', action.danger ? 'danger' : '', action.label);
    if (action.userContent) button.dataset.userContent = '';
    button.onclick = () => { menu.hidden = true; action.run(); }; menu.appendChild(button);
  });
  wrap.append(trigger, menu); return wrap;
}
document.addEventListener('click', () => document.querySelectorAll('.kh-overflow-menu').forEach(menu => {
  menu.hidden = true; menu.parentElement?.querySelector('[aria-haspopup="menu"]')?.setAttribute('aria-expanded', 'false');
}));
async function openKnowledgeDetail(id) {
  if (!knowledgeLoaded) { await loadKnowledgeItems(id); return; }
  const listItem = knowledgeItems.find(x => x.id === Number(id)); if (!listItem) return;
  knowledgeCurrentId = listItem.id; showKnowledgeDetailView();
  document.querySelectorAll('#kh-list .kh-row').forEach(row => row.classList.toggle('active', Number(row.dataset.knowledgeId) === listItem.id));
  const host = document.getElementById('kh-detail-view'); host.innerHTML = '';
  const loading = pjMk('div', 'kh-detail'); loading.appendChild(pjMk('div', 'kh-detail-summary', 'Loading knowledge item…')); host.appendChild(loading);
  let item;
  try { item = await window.api.getKnowledgeItem(listItem.id); } catch { toast('Could not load knowledge item'); closeKnowledgeDetail(); return; }
  if (!item || knowledgeCurrentId !== listItem.id) return;
  knowledgeCurrentItem = item; host.innerHTML = '';
  const page = pjMk('div', 'kh-detail'), bar = pjMk('div', 'kh-panel-bar'), back = pjMk('button', 'kh-panel-close');
  back.type = 'button'; back.title = 'Close'; back.innerHTML = ic('x');
  back.onclick = closeKnowledgeDetail; bar.appendChild(back); page.appendChild(bar);
  const head = pjMk('div', 'kh-detail-head'), copy = pjMk('div'), badges = pjMk('div', 'kh-meta');
  if (item.status !== 'PUBLISHED') badges.appendChild(pjMk('span', 'kh-pill ' + item.status.toLowerCase(), knowledgeStatusLabel(item.status)));
  if (item.typeLabel || item.type) badges.appendChild(pjMk('span', 'kh-pill', lkLabel('KNOWLEDGE_TYPE', item.type) || item.typeLabel));
  // Client / system chips jump back to the list filtered by that client or system.
  const links = pjMk('div', 'kh-meta kh-detail-links');
  [['companies', 'CLIENT:'], ['systems', 'SYSTEM:']].forEach(([kind, prefix]) => (item[kind] || []).forEach(link => {
    const chip = knowledgeLinkPill(kind, link, 'button');
    chip.title = 'Show everything for ' + knowledgeLinkName(kind, link);
    chip.onclick = () => {
      [...knowledgeFilters].filter(key => key.startsWith(prefix)).forEach(key => knowledgeFilters.delete(key));
      knowledgeFilters.add(prefix + link.id); renderKnowledgeList();
    };
    links.appendChild(chip);
  }));
  copy.append(badges, pjMk('h1', '', item.title));
  if (links.childElementCount) copy.appendChild(links);
  if (item.summary) copy.appendChild(pjMk('div', 'kh-detail-summary', item.summary));
  copy.appendChild(pjMk('div', 'kh-detail-updated', 'Updated ' + new Date(item.updatedAt).toLocaleString()));
  const actions = pjMk('div', 'kh-detail-actions');
  actions.append(khButton('Edit', 'primary', () => openKnowledgeEditor(item)), khButton('Add document', '', () => openKnowledgeDocumentModal(item.id)));
  actions.appendChild(buildKnowledgeOverflow([
    { label: 'Duplicate', run: () => duplicateKnowledgeItem(item) },
    ...(item.status === 'DRAFT' ? [{ label: 'Mark as ready', run: () => setKnowledgeStatus(item, 'PUBLISHED') }] : []),
    { label: item.status === 'ARCHIVED' ? 'Restore from archive' : 'Archive', run: () => setKnowledgeStatus(item, item.status === 'ARCHIVED' ? 'PUBLISHED' : 'ARCHIVED') },
    { label: 'Delete item', danger: true, run: () => showDeleteConfirm(actions, () => deleteKnowledgeItem(item), () => openKnowledgeDetail(item.id)) },
  ]));
  head.append(copy, actions); page.appendChild(head);
  const files = pjMk('section', 'kh-section');
  files.appendChild(pjMk('h3', '', 'Documents (' + item.documents.length + ')'));
  knowledgeDocumentFamilies(item.documents).forEach(family => files.appendChild(buildKnowledgeDocumentFamily(item, family)));
  files.appendChild(pjMk('div', 'kh-drop-tip', item.documents.length
    ? 'Drop a file on this panel to add it. A matching name becomes the next version.'
    : 'No documents yet. Drop a file on this panel, or use Add document.'));
  page.appendChild(files);
  if (item.content) {
    const content = pjMk('section', 'kh-section'), rendered = pjMk('div', 'kh-content');
    content.append(pjMk('h3', '', 'Notes'), rendered); renderKnowledgeContent(rendered, item.content, item.contentFormat); page.appendChild(content);
  }
  if ((item.tags || []).length) {
    const tagSection = pjMk('section', 'kh-section'), chips = pjMk('div', 'kh-meta');
    tagSection.appendChild(pjMk('h3', '', 'Tags'));
    item.tags.forEach(tag => {
      const chip = pjMk('button', 'kh-pill', '#' + tag); chip.onclick = () => { knowledgeFilters.add('TAG:' + tag.toLowerCase()); renderKnowledgeList(); }; chips.appendChild(chip);
    });
    tagSection.appendChild(chips); page.appendChild(tagSection);
  }
  host.appendChild(page); back.focus();
}
function closeKnowledgeDetail() {
  knowledgeCurrentId = null; knowledgeCurrentItem = null; showKnowledgeListView(); renderKnowledgeList();
  setTimeout(() => { if (knowledgeListFocus?.isConnected) knowledgeListFocus.focus(); }, 0);
}
function buildKnowledgeDocumentFamily(item, files) {
  const latest = files[0], family = pjMk('div', 'kh-document-family'), head = pjMk('div', 'kh-document-family-head');
  const icon = pjMk('span'); icon.innerHTML = ic(latest.exists ? 'file-text' : 'triangle-alert');
  const copy = pjMk('div', 'kh-resource-copy');
  copy.append(pjMk('b', '', latest.name || latest.originalName || '(document)'), pjMk('span', '', `Latest ${formatKnowledgeVersion(latest.version)} · ${latest.originalName} · ${fmtFileSize(latest.size)}${latest.exists ? '' : ' · Missing from disk'}`));
  head.append(icon, copy, pjMk('span', 'kh-version-pill', formatKnowledgeVersion(latest.version)), khButton('New version', 'small', () => openKnowledgeDocumentModal(item.id, latest.name)));
  if (latest.exists) head.appendChild(khButton('Open file', 'small primary', () => openKnowledgeAttachment(latest.id)));
  head.appendChild(buildKnowledgeOverflow([
    ...(latest.exists ? [{ label: 'Download latest', run: () => downloadKnowledgeAttachment(latest.id) }] : []),
    { label: latest.changeNote ? 'Edit note' : 'Add note', run: () => editKnowledgeChangeNote(family, latest) },
    { label: 'Remove latest version', danger: true, run: () => showDeleteConfirm(head, () => removeKnowledgeAttachment(item.id, latest.id), () => openKnowledgeDetail(item.id)) },
  ]));
  family.appendChild(head);
  family.appendChild(buildKnowledgeChangeNote(latest));
  if (files.length > 1) {
    const toggle = pjMk('button', 'kh-document-history-toggle', `Show ${files.length - 1} previous version${files.length === 2 ? '' : 's'}`);
    const history = pjMk('div', 'kh-document-history'); history.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.onclick = () => { history.hidden = !history.hidden; toggle.setAttribute('aria-expanded', String(!history.hidden)); toggle.textContent = history.hidden ? `Show ${files.length - 1} previous version${files.length === 2 ? '' : 's'}` : 'Hide previous versions'; };
    files.slice(1).forEach(file => history.appendChild(buildKnowledgeAttachmentHistoryRow(item, file)));
    family.append(toggle, history);
  }
  return family;
}
function buildKnowledgeAttachmentHistoryRow(item, file) {
  const row = pjMk('div', 'kh-resource'), copy = pjMk('div', 'kh-resource-copy');
  copy.append(pjMk('b', '', formatKnowledgeVersion(file.version)), pjMk('span', '', `${file.originalName} · ${fmtFileSize(file.size)} · Added ${new Date(file.uploadedAt).toLocaleDateString()}${file.exists ? '' : ' · Missing from disk'}`),
    buildKnowledgeChangeNote(file));
  row.append(copy);
  if (file.exists) row.appendChild(khButton('Open file', 'small', () => openKnowledgeAttachment(file.id)));
  row.appendChild(buildKnowledgeOverflow([
    ...(file.exists ? [{ label: 'Download', run: () => downloadKnowledgeAttachment(file.id) }] : []),
    { label: file.changeNote ? 'Edit note' : 'Add note', run: () => editKnowledgeChangeNote(copy, file) },
    { label: 'Remove version', danger: true, run: () => showDeleteConfirm(row, () => removeKnowledgeAttachment(item.id, file.id), () => openKnowledgeDetail(item.id)) },
  ]));
  return row;
}
// A version's "what changed" note, shown under it. Empty notes render nothing
// but keep a placeholder so editing has a place to open.
function buildKnowledgeChangeNote(file) {
  const note = pjMk('div', 'kh-change-note'); note.dataset.attachmentId = file.id; note.hidden = !file.changeNote;
  if (file.changeNote) { note.dataset.userContent = ''; appendKnowledgeInline(note, file.changeNote); }
  return note;
}
function editKnowledgeChangeNote(host, file) {
  const note = host.querySelector(`.kh-change-note[data-attachment-id="${file.id}"]`); if (!note || note.querySelector('textarea')) return;
  const input = pjMk('textarea', 'kh-change-note-input'); input.maxLength = 1000; input.rows = 3; input.value = file.changeNote || '';
  input.placeholder = 'What changed in this version?'; input.setAttribute('aria-label', 'What changed');
  const actions = pjMk('div', 'kh-change-note-actions'), save = khButton('Save', 'small primary', async () => {
    let result; try { result = await window.api.updateKnowledgeAttachmentNote(file.id, input.value); } catch { result = null; }
    if (!result?.ok) { toast(result?.error || 'Could not save note'); return; }
    toast('Note saved'); await loadKnowledgeItems(knowledgeCurrentId);
  });
  const cancel = khButton('Cancel', 'small', () => openKnowledgeDetail(knowledgeCurrentId));
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel.click(); }
    else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); save.click(); }
  });
  actions.append(save, cancel); note.replaceChildren(input, actions); note.hidden = false; delete note.dataset.userContent;
  input.focus();
}
// [label](https://…) and bare https:// links both open in the browser.
function appendKnowledgeInline(parent, text) {
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')\]]+)/ig; let last = 0, match;
  while ((match = regex.exec(text))) {
    parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    const url = match[2] || match[3], link = document.createElement('a'); link.href = '#'; link.textContent = match[1] || url; link.title = url;
    link.onclick = event => { event.preventDefault(); window.api.openExternal(url); };
    parent.appendChild(link); last = regex.lastIndex;
  }
  parent.appendChild(document.createTextNode(text.slice(last)));
}
function renderKnowledgeContent(host, value, format) {
  if (format === 'html') renderKnowledgeContentHtml(host, value);
  else renderKnowledgeContentText(host, value);
}
function renderKnowledgeContentHtml(host, value) {
  host.classList.remove('kh-content-text'); host.classList.add('kh-content-html');
  host.innerHTML = sanitizeKnowledgeHtml(value) || '';
  if (!host.childElementCount) host.appendChild(pjMk('p', 'kh-detail-summary', 'Your formatted preview will appear here.'));
  host.querySelectorAll('a[href]').forEach(link => {
    const url = link.getAttribute('href') || '';
    link.title = url;
    link.addEventListener('click', event => {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) window.api.openExternal(url);
    });
  });
}
function renderKnowledgeContentText(host, value) {
  host.classList.remove('kh-content-html'); host.classList.add('kh-content-text');
  host.innerHTML = ''; const lines = String(value || '').split(/\r?\n/); let code = null, list = null, listType = '';
  const closeList = () => { list = null; listType = ''; };
  lines.forEach(line => {
    if (line.trim().startsWith('```')) {
      closeList();
      if (code) code = null;
      else { code = document.createElement('pre'); host.appendChild(code); }
      return;
    }
    if (code) { code.textContent += (code.textContent ? '\n' : '') + line; return; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/), bullet = line.match(/^\s*[-*]\s+(.+)$/), number = line.match(/^\s*\d+\.\s+(.+)$/);
    if (heading) {
      closeList(); const h = document.createElement('h' + heading[1].length); appendKnowledgeInline(h, heading[2]); host.appendChild(h);
    } else if (bullet || number) {
      const wanted = bullet ? 'ul' : 'ol';
      if (!list || listType !== wanted) { list = document.createElement(wanted); listType = wanted; host.appendChild(list); }
      const li = document.createElement('li'); appendKnowledgeInline(li, (bullet || number)[1]); list.appendChild(li);
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList(); const p = document.createElement('p'); appendKnowledgeInline(p, line); host.appendChild(p);
    }
  });
  if (!host.childElementCount) host.appendChild(pjMk('p', 'kh-detail-summary', 'Your formatted preview will appear here.'));
}
// Notes are plain text (contentFormat 'text'). Older rich-text notes are turned
// into plain lines the first time they are edited.
function knowledgeNotesFromItem(data) {
  const raw = String(data?.content || '');
  if (data?.contentFormat !== 'html' || !raw) return raw;
  const scratch = document.createElement('div');
  scratch.innerHTML = sanitizeKnowledgeHtml(raw);
  scratch.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  scratch.querySelectorAll('li').forEach(li => li.prepend('- '));
  scratch.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href) && link.textContent.trim() !== href) link.append(' (' + href + ')');
  });
  scratch.querySelectorAll('p, h1, h2, h3, li, pre, blockquote').forEach(block => block.append('\n'));
  return scratch.textContent.replace(/\n{3,}/g, '\n\n').trim();
}
function normalizeKnowledgeTag(value) { return String(value || '').trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 60); }
function addKnowledgeTag(value) {
  const tag = normalizeKnowledgeTag(value); if (!tag || knowledgeEditorTags.length >= 30 || knowledgeEditorTags.some(x => x.toLowerCase() === tag.toLowerCase())) return;
  knowledgeEditorTags.push(tag); renderKnowledgeEditorTags(); markKnowledgeEditorDirty();
}
function renderKnowledgeEditorTags() {
  const host = document.getElementById('kh-tag-tokens'); host.innerHTML = '';
  knowledgeEditorTags.forEach((tag, index) => {
    const token = pjMk('span', 'kh-token'); token.appendChild(document.createTextNode('#' + tag));
    const remove = pjMk('button', '', '×'); remove.type = 'button'; remove.title = 'Remove tag ' + tag;
    remove.onclick = event => { event.stopPropagation(); knowledgeEditorTags.splice(index, 1); renderKnowledgeEditorTags(); markKnowledgeEditorDirty(); };
    token.appendChild(remove); host.appendChild(token);
  });
  document.getElementById('kh-tag-count').textContent = String(knowledgeEditorTags.length);
}
function setupKnowledgeTagInput() {
  const input = document.getElementById('kh-tags-input');
  input.onkeydown = event => {
    if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addKnowledgeTag(input.value); input.value = ''; }
    else if (event.key === 'Backspace' && !input.value && knowledgeEditorTags.length) { knowledgeEditorTags.pop(); renderKnowledgeEditorTags(); markKnowledgeEditorDirty(); }
  };
  input.onblur = () => { if (input.value.trim()) { addKnowledgeTag(input.value); input.value = ''; } };
}
// Clients / systems pickers. A link to a since-disabled code stays selectable so
// saving the editor never drops it silently.
function buildKnowledgeLinkPicker(hostId, category, selectedIds, placeholder) {
  const options = lkOptions(category, true).filter(o => o.isActive || selectedIds.includes(o.id))
    .map(o => ({ id: o.id, label: category === 'COMPANY' ? companyDisplayName(o) : lookupDisplayName(o) }));
  return buildTagPicker(document.getElementById(hostId), options, selectedIds, placeholder, markKnowledgeEditorDirty, { autoSelectSingle: false });
}
function knowledgeEditorSnapshot() {
  return {
    itemId: knowledgeEditId, title: document.getElementById('kh-title-input').value,
    type: document.getElementById('kh-type-input').value, status: knowledgeEditorStatus,
    summary: document.getElementById('kh-summary-input').value, content: document.getElementById('kh-notes-input').value, contentFormat: 'text',
    companyIds: khCompaniesPicker?.getSelectedIds() || [], systemIds: khSystemsPicker?.getSelectedIds() || [],
    tags: [...knowledgeEditorTags], savedAt: new Date().toISOString(),
  };
}
function markKnowledgeEditorDirty() {
  knowledgeEditorDirty = true; knowledgeDraftCache = knowledgeEditorSnapshot(); saveKnowledgeDraftDebounced();
}
function applyKnowledgeEditorData(data) {
  document.getElementById('kh-title-input').value = data?.title || '';
  document.getElementById('kh-summary-input').value = data?.summary || '';
  knowledgeEditorStatus = data?.status || 'PUBLISHED';
  document.getElementById('kh-type-input').value = data?.type || '';
  khCompaniesPicker = buildKnowledgeLinkPicker('kh-companies', 'COMPANY', data?.companyIds || (data?.companies || []).map(x => x.id), 'Search clients…');
  khSystemsPicker = buildKnowledgeLinkPicker('kh-systems', 'SYSTEM', data?.systemIds || (data?.systems || []).map(x => x.id), 'Search systems…');
  document.getElementById('kh-notes-input').value = knowledgeNotesFromItem(data);
  knowledgeEditorTags = [...(data?.tags || [])];
  renderKnowledgeEditorTags();
  document.getElementById('kh-more').open = knowledgeEditorTags.length > 0 || !!String(data?.summary || '').trim();
}
function recoverKnowledgeDraft() {
  if (!knowledgePendingDraft) return;
  applyKnowledgeEditorData(knowledgePendingDraft);
  knowledgePendingDraft = null; document.getElementById('kh-recovery').hidden = true; knowledgeEditorDirty = true; toast('Unsaved draft recovered');
}
function discardKnowledgeDraft() {
  knowledgePendingDraft = null; knowledgeDraftCache = null;
  clearTimeout(_knowledgeDraftSaveTimer);
  window.api.clearKnowledgeDraft().catch(() => {});
  document.getElementById('kh-recovery').hidden = true;
}
// One short form: title, clients, systems, kind, file, notes. The file field is
// for a new item only; an existing item takes files from its panel.
function setKnowledgeEditorFile(file) {
  knowledgeEditorFile = file || null;
  setKnowledgeFileLabel('kh-editor-file-label', knowledgeEditorFile);
  document.getElementById('kh-editor-file-clear').hidden = !knowledgeEditorFile;
  const title = document.getElementById('kh-title-input');
  if (knowledgeEditorFile && !title.value.trim()) { title.value = knowledgeTitleFromFile(knowledgeEditorFile.name); clearFieldError(title); }
}
function openKnowledgeEditor(item, file) {
  knowledgeEditId = item?.id || null; knowledgeEditorDirty = false;
  document.getElementById('kh-modal-title').textContent = item ? 'Edit item' : 'New item';
  document.getElementById('kh-editor-file-row').hidden = !!item;
  const type = document.getElementById('kh-type-input'); type.innerHTML = '<option value="">No kind</option>';
  lkOptions('KNOWLEDGE_TYPE').forEach(option => { const el = document.createElement('option'); el.dataset.userContent = ''; el.value = option.code; el.textContent = lookupDisplayName(option); type.appendChild(el); });
  applyKnowledgeEditorData(item || { status: 'PUBLISHED', tags: [] });
  const suggestions = document.getElementById('kh-tag-suggestions'); suggestions.innerHTML = '';
  [...new Set(knowledgeItems.flatMap(entry => entry.tags || []))].sort((a, b) => a.localeCompare(b)).forEach(tag => { const option = document.createElement('option'); option.value = tag; suggestions.appendChild(option); });
  setupKnowledgeTagInput(); clearErrorsIn('#knowledge-modal'); setKnowledgeEditorFile(item ? null : file);
  const draft = knowledgeDraftCache;
  knowledgePendingDraft = draft && Number(draft.itemId || 0) === Number(knowledgeEditId || 0) ? draft : null;
  document.getElementById('kh-recovery').hidden = !knowledgePendingDraft;
  const overlay = document.getElementById('knowledge-modal-overlay'); overlay.classList.add('open');
  overlay.oninput = event => {
    if (event.target.id === 'kh-tags-input' || event.target.closest('.tag-picker')) return;
    markKnowledgeEditorDirty();
  };
  overlay.onchange = event => { if (!event.target.closest('.tag-picker')) markKnowledgeEditorDirty(); };
  setTimeout(() => document.getElementById('kh-title-input').focus(), 60);
}
function closeKnowledgeEditor(force) {
  const closeConfirmMsg = 'Close the editor? Your changes are saved as a recoverable draft.';
  if (!force && knowledgeEditorDirty && !confirm(window.ctI18n ? window.ctI18n.t(closeConfirmMsg) : closeConfirmMsg)) return;
  knowledgeEditorDirty = false; knowledgeEditId = null; knowledgePendingDraft = null; knowledgeEditorFile = null;
  document.getElementById('knowledge-modal-overlay').classList.remove('open');
}
function knowledgeEditorOverlayClick(event) { if (event.target === document.getElementById('knowledge-modal-overlay')) closeKnowledgeEditor(); }
async function saveKnowledgeEditor() {
  const input = document.getElementById('kh-tags-input'); if (input.value.trim()) { addKnowledgeTag(input.value); input.value = ''; }
  clearErrorsIn('#knowledge-modal'); const title = document.getElementById('kh-title-input').value.trim();
  if (!title) { markError('kh-title-input'); return; }
  const editing = knowledgeEditId, file = editing ? null : knowledgeEditorFile;
  const data = {
    title, type: document.getElementById('kh-type-input').value, status: knowledgeEditorStatus,
    summary: document.getElementById('kh-summary-input').value.trim(), content: document.getElementById('kh-notes-input').value.replace(/\s+$/, ''), contentFormat: 'text',
    companyIds: khCompaniesPicker.getSelectedIds(), systemIds: khSystemsPicker.getSelectedIds(), tags: knowledgeEditorTags,
  };
  try {
    const saved = editing ? await window.api.updateKnowledgeItem(editing, data) : await window.api.createKnowledgeItem(data);
    knowledgeDraftCache = null; clearTimeout(_knowledgeDraftSaveTimer); window.api.clearKnowledgeDraft().catch(() => {});
    knowledgeEditorDirty = false; closeKnowledgeEditor(true);
    let uploaded = null;
    if (file) {
      const meta = { name: knowledgeTitleFromFile(file.name) || title, version: knowledgeParseFileName(file.name).version || '1.0' };
      try { uploaded = await window.api.uploadKnowledgeFile(saved.id, file, meta); } catch { uploaded = { ok: false }; }
    }
    if (file && !uploaded?.ok) toast(uploaded?.error || 'The item was saved, but the file could not be added');
    else toast(editing ? 'Knowledge item saved' : 'Knowledge item created');
    await loadKnowledgeItems(saved.id);
  } catch (error) { toast(error?.message || 'Could not save knowledge item'); }
}
function nextKnowledgeCopyTitle(title) {
  const base = String(title || 'Knowledge Item').replace(/(?:\s+—\s+Copy(?:\s+\d+)?)+$/i, '').trim() || 'Knowledge Item';
  const used = new Set(knowledgeItems.map(item => item.title.toLowerCase())); let candidate = base + ' — Copy', n = 2;
  while (used.has(candidate.toLowerCase())) candidate = base + ' — Copy ' + n++; return candidate;
}
async function duplicateKnowledgeItem(item) {
  try {
    const copy = await window.api.createKnowledgeItem({
      title: nextKnowledgeCopyTitle(item.title), type: item.type, status: item.status === 'ARCHIVED' ? 'PUBLISHED' : item.status,
      summary: item.summary, content: item.content, contentFormat: item.contentFormat, tags: item.tags,
      companyIds: (item.companies || []).map(x => x.id), systemIds: (item.systems || []).map(x => x.id),
    });
    toast('Copy created with the same clients, systems, and tags'); await loadKnowledgeItems(copy.id);
  } catch { toast('Could not duplicate item'); }
}
async function setKnowledgeStatus(item, status) {
  try {
    const saved = await window.api.updateKnowledgeItem(item.id, { title: item.title, type: item.type, status, summary: item.summary, content: item.content, contentFormat: item.contentFormat, tags: item.tags });
    toast(status === 'ARCHIVED' ? 'Knowledge item archived' : item.status === 'ARCHIVED' ? 'Knowledge item restored' : 'Knowledge item marked ready'); await loadKnowledgeItems(saved.id);
  } catch { toast('Could not update knowledge status'); }
}
async function deleteKnowledgeItem(item) {
  let result; try { result = await window.api.deleteKnowledgeItem(item.id); } catch { toast('Could not delete item'); return; }
  if (!result?.ok) { toast(result?.error || 'Could not delete item'); return; }
  const previous = knowledgeUndo; if (previous) window.api.purgeKnowledgeFiles(previous.oldId).catch(() => {});
  clearTimeout(knowledgeUndoTimer); knowledgeUndo = { oldId: item.id, snapshot: result.snapshot };
  knowledgeItems = knowledgeItems.filter(x => x.id !== item.id); closeKnowledgeDetail();
  const bar = document.getElementById('knowledge-undo-toast'); bar.classList.add('visible');
  knowledgeUndoTimer = setTimeout(() => { const pending = knowledgeUndo; knowledgeUndo = null; bar.classList.remove('visible'); if (pending) window.api.purgeKnowledgeFiles(pending.oldId).catch(() => {}); }, 5000);
}
async function undoDeleteKnowledgeItem() {
  if (!knowledgeUndo) return; const pending = knowledgeUndo; knowledgeUndo = null; clearTimeout(knowledgeUndoTimer);
  document.getElementById('knowledge-undo-toast').classList.remove('visible');
  try { const result = await window.api.restoreKnowledgeItem(pending.oldId, pending.snapshot); if (!result?.ok) throw new Error(); toast('Knowledge item restored'); await loadKnowledgeItems(result.item.id); }
  catch { toast('Could not restore knowledge item'); }
}
function knowledgeDocumentItem() {
  const id = Number(knowledgeDocumentItemId);
  return knowledgeCurrentItem?.id === id ? knowledgeCurrentItem : knowledgeItems.find(entry => entry.id === id);
}
// Name and version fill themselves in until the user types in them: a name that
// matches an existing document suggests that document's next version.
function refreshKnowledgeDocumentSuggestion() {
  const nameInput = document.getElementById('kh-document-name'), versionInput = document.getElementById('kh-document-version');
  const hint = document.getElementById('kh-document-match'), file = knowledgeDocumentFile, documents = knowledgeDocumentItem()?.documents;
  let family = nameInput.value.trim() ? knowledgeFindFamily(documents, nameInput.value, false) : null;
  if (!nameInput.dataset.touched && file) {
    family = knowledgeFindFamily(documents, file.name);
    nameInput.value = family ? family[0].name : knowledgeTitleFromFile(file.name);
  }
  if (!versionInput.dataset.touched) {
    versionInput.value = file ? knowledgeSuggestVersion(family, file.name)
      : family ? knowledgeNextVersion(family[0].version, family.map(x => x.version)) : '1.0';
  }
  hint.hidden = !family;
  if (family) { hint.textContent = 'New version of ' + family[0].name + ' (latest ' + formatKnowledgeVersion(family[0].version) + ')'; }
  document.getElementById('kh-document-modal-title').textContent = family ? 'Add New Version' : 'Add Document';
  document.getElementById('kh-document-note-label').textContent = family ? 'What changed' : 'Note';
}
function applyKnowledgeDocumentFile(file) {
  knowledgeDocumentFile = file || null;
  setKnowledgeFileLabel('kh-document-file-label', knowledgeDocumentFile);
  clearFieldError(document.getElementById('kh-document-drop'));
  refreshKnowledgeDocumentSuggestion();
}
function openKnowledgeDocumentModal(itemId, documentName = '', file = null) {
  knowledgeDocumentItemId = itemId; const item = knowledgeDocumentItem();
  const nameInput = document.getElementById('kh-document-name'), versionInput = document.getElementById('kh-document-version'), options = document.getElementById('kh-document-names'); options.innerHTML = '';
  [...new Set((item?.documents || []).map(document => document.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)).forEach(name => { const option = document.createElement('option'); option.value = name; options.appendChild(option); });
  nameInput.value = documentName || ''; versionInput.value = ''; document.getElementById('kh-document-note').value = '';
  delete versionInput.dataset.touched;
  if (documentName) nameInput.dataset.touched = '1'; else delete nameInput.dataset.touched;
  nameInput.oninput = () => {
    if (nameInput.value.trim()) nameInput.dataset.touched = '1'; else delete nameInput.dataset.touched;
    refreshKnowledgeDocumentSuggestion();
  };
  versionInput.oninput = () => { versionInput.dataset.touched = '1'; };
  clearErrorsIn('#knowledge-document-modal'); applyKnowledgeDocumentFile(file);
  document.getElementById('knowledge-document-modal-overlay').classList.add('open');
  const focusTarget = file ? document.getElementById('kh-document-submit') : documentName ? versionInput : nameInput;
  setTimeout(() => focusTarget.focus(), 50);
}
function closeKnowledgeDocumentModal() { knowledgeDocumentItemId = null; knowledgeDocumentFile = null; document.getElementById('knowledge-document-modal-overlay').classList.remove('open'); }
function knowledgeDocumentOverlayClick(event) { if (event.target === document.getElementById('knowledge-document-modal-overlay')) closeKnowledgeDocumentModal(); }
async function submitKnowledgeDocument() {
  const itemId = knowledgeDocumentItemId, name = document.getElementById('kh-document-name').value.trim(), version = document.getElementById('kh-document-version').value.trim();
  clearErrorsIn('#knowledge-document-modal');
  if (!knowledgeDocumentFile) { markError('kh-document-drop', 'Drop or choose a file.'); return; }
  if (!name) { markError('kh-document-name'); return; } if (!version) { markError('kh-document-version'); return; }
  const changeNote = document.getElementById('kh-document-note').value.trim();
  let result; try { result = await window.api.uploadKnowledgeFile(itemId, knowledgeDocumentFile, { name, version, changeNote }); } catch { toast('Could not add document'); return; }
  if (!result?.ok) { toast(result?.error || 'Could not add document'); return; }
  closeKnowledgeDocumentModal(); toast('Document added'); await loadKnowledgeItems(itemId);
}
async function openKnowledgeAttachment(id) { const result = await window.api.openKnowledgeAttachment(id); if (!result?.ok) toast(result?.error || 'Could not open attachment'); }
async function downloadKnowledgeAttachment(id) { const result = await window.api.downloadKnowledgeAttachment(id); if (result && !result.ok && !result.canceled) toast(result.error || 'Could not save attachment'); else if (result?.ok) toast('Attachment saved'); }
async function removeKnowledgeAttachment(itemId, attachmentId) {
  let result; try { result = await window.api.removeKnowledgeAttachment(attachmentId); } catch { toast('Could not remove document'); return; }
  if (!result?.ok) { toast(result?.error || 'Could not remove document'); return; }
  await loadKnowledgeItems(itemId);
  toast('Document removed', { actionLabel: 'Undo', duration: 5000, onAction: async () => { const restored = await window.api.restoreKnowledgeAttachment(itemId, result.removedFile); if (restored?.ok) await loadKnowledgeItems(itemId); toast(restored?.ok ? 'Document restored' : 'Could not restore document'); }, onExpire: () => window.api.purgeKnowledgeAttachment(itemId, result.removedFile.path).catch(() => {}) });
}
