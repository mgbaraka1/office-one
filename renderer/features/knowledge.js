// ══ KNOWLEDGE HUB ══════════════════════════════════════════════════════════
let knowledgeItems = [], knowledgeGroups = [], knowledgeLoaded = false;
let knowledgeFilters = new Set(), knowledgeFilterSections = {}, knowledgeFilterShowAll = {};
let knowledgeCurrentId = null, knowledgeCurrentItem = null, knowledgeEditId = null;
let knowledgeUndo = null, knowledgeUndoTimer = null, knowledgeEditorDirty = false;
let knowledgeGroupEditId = null, knowledgeDocumentItemId = null, knowledgeCreationMode = 'ARTICLE';
let knowledgeEditorTags = [], knowledgeEditorGroupIds = new Set(), knowledgePendingDraft = null;
let knowledgeUiRestored = false, knowledgeListFocus = null;

function knowledgeDocumentCount(item) { return Number(item.documentCount ?? item.documents?.length ?? 0); }
function knowledgeStatusLabel(status) { return status === 'PUBLISHED' ? 'Ready' : status === 'ARCHIVED' ? 'Archived' : 'Draft'; }
function initKnowledgeModule() {
  if (!knowledgeUiRestored) {
    const saved = uiState.filters?.knowledge || {};
    const restored = Array.isArray(saved.filters) ? saved.filters : saved.filter && saved.filter !== 'ALL'
      ? [saved.filter.startsWith('TYPE:') || saved.filter.startsWith('TAG:') || saved.filter.startsWith('GROUP:') ? saved.filter : 'STATUS:' + saved.filter]
      : [];
    knowledgeFilters = new Set(restored);
    knowledgeFilterSections = Object.assign({}, saved.sections || {});
    document.getElementById('kh-search').value = saved.query || '';
    document.getElementById('kh-sort').value = ['updated', 'title', 'documents', 'created'].includes(saved.sort) ? saved.sort : 'updated';
    knowledgeUiRestored = true;
  }
  showKnowledgeListView();
  knowledgeCurrentId = null;
  knowledgeCurrentItem = null;
  if (!knowledgeLoaded) loadKnowledgeItems(); else renderKnowledgeList();
}
function showKnowledgeListView() {
  document.getElementById('kh-list-view').hidden = false;
  document.getElementById('kh-detail-view').hidden = true;
}
function showKnowledgeDetailView() {
  document.getElementById('kh-list-view').hidden = true;
  document.getElementById('kh-detail-view').hidden = false;
}
async function loadKnowledgeItems(openId) {
  try {
    [knowledgeItems, knowledgeGroups] = await Promise.all([window.api.listKnowledgeItems(), window.api.listKnowledgeGroups()]);
    knowledgeItems ||= []; knowledgeGroups ||= []; knowledgeLoaded = true;
    [...knowledgeFilters].forEach(key => {
      if (key.startsWith('GROUP:') && !knowledgeGroups.some(group => group.id === Number(key.slice(6)))) knowledgeFilters.delete(key);
    });
  } catch { toast('Could not load Knowledge Hub'); return; }
  const targetId = openId != null ? openId : knowledgeCurrentId;
  if (targetId != null && knowledgeItems.some(item => item.id === Number(targetId))) await openKnowledgeDetail(targetId);
  else { showKnowledgeListView(); knowledgeCurrentId = null; knowledgeCurrentItem = null; renderKnowledgeList(); }
}
function toggleKnowledgeCreateMenu(force) {
  const menu = document.getElementById('kh-create-options'), button = document.getElementById('kh-create-btn');
  const open = force == null ? menu.hidden : !!force;
  menu.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  if (open) setTimeout(() => menu.querySelector('button')?.focus(), 0);
}
function startKnowledgeCreation(mode) {
  knowledgeCreationMode = mode === 'DOCUMENT' ? 'DOCUMENT' : 'ARTICLE';
  toggleKnowledgeCreateMenu(false);
  openKnowledgeEditor();
}
document.addEventListener('click', event => {
  const menu = document.querySelector('.kh-create-menu');
  if (menu && !menu.contains(event.target)) toggleKnowledgeCreateMenu(false);
});
function knowledgeFilterDimension(key) {
  return key.startsWith('TYPE:') ? 'TYPE' : key.startsWith('STATUS:') ? 'STATUS' : key.startsWith('GROUP:') ? 'GROUP' : 'TAG';
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
  if (id === 'groups' || id === 'tags') section.dataset.searchable = 'true';
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
function renderKnowledgeFilters() {
  const host = document.getElementById('kh-filters'); host.innerHTML = '';
  const browse = pjMk('div', 'kh-filter-section'), heading = pjMk('div', 'kh-filter-title', 'Browse');
  const all = pjMk('button', 'kh-filter-btn' + (!knowledgeFilters.size ? ' active' : ''));
  all.setAttribute('aria-pressed', String(!knowledgeFilters.size));
  all.append(document.createTextNode('All knowledge'), pjMk('span', '', String(knowledgeItems.filter(x => x.status !== 'ARCHIVED').length)));
  all.onclick = () => { knowledgeFilters.clear(); renderKnowledgeList(); };
  browse.append(heading, all);
  const facetSearch = document.createElement('input'); facetSearch.type = 'search'; facetSearch.className = 'mod-search';
  facetSearch.style.cssText = 'width:100%;min-width:0;margin-top:8px'; facetSearch.placeholder = 'Filter groups or tags…';
  facetSearch.setAttribute('aria-label', 'Filter Knowledge Hub groups and tags');
  facetSearch.oninput = () => filterKnowledgeFacetButtons(facetSearch.value);
  browse.appendChild(facetSearch); host.appendChild(browse);
  const types = lkOptions('KNOWLEDGE_TYPE').map(type => ({
    key: 'TYPE:' + type.code, label: lookupDisplayName(type),
    count: knowledgeItems.filter(x => x.type === type.code && x.status !== 'ARCHIVED').length,
  })).filter(type => type.count || knowledgeFilters.has(type.key));
  appendKnowledgeFilterSection(host, 'types', 'Types', types);
  const statuses = [['PUBLISHED', 'Ready'], ['DRAFT', 'Drafts'], ['ARCHIVED', 'Archived']]
    .map(([status, label]) => ({ key: 'STATUS:' + status, label, count: knowledgeItems.filter(x => x.status === status).length }))
    .filter(status => status.count || knowledgeFilters.has(status.key));
  appendKnowledgeFilterSection(host, 'status', 'Status', statuses);
  const groups = knowledgeGroups.map(group => ({
    key: 'GROUP:' + group.id, label: group.name,
    count: group.itemIds.filter(id => knowledgeItems.some(x => x.id === id && x.status !== 'ARCHIVED')).length,
  }));
  appendKnowledgeFilterSection(host, 'groups', 'Groups', groups);
  const selectedGroupKey = [...knowledgeFilters].find(key => key.startsWith('GROUP:'));
  if (selectedGroupKey) {
    const selectedGroup = knowledgeGroups.find(group => group.id === Number(selectedGroupKey.slice(6)));
    if (selectedGroup) {
      const edit = pjMk('button', 'kh-filter-btn', 'Edit selected group');
      edit.style.fontSize = '11px'; edit.onclick = () => openKnowledgeGroupEditor(selectedGroup); host.appendChild(edit);
    }
  }
  const tagCounts = new Map();
  knowledgeItems.filter(x => x.status !== 'ARCHIVED').forEach(item => (item.tags || []).forEach(tag => {
    const key = tag.toLowerCase(), current = tagCounts.get(key);
    tagCounts.set(key, { label: current?.label || tag, count: (current?.count || 0) + 1 });
  }));
  const tags = [...tagCounts.entries()].sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label))
    .map(([key, tag]) => ({ key: 'TAG:' + key, label: '#' + tag.label, count: tag.count }));
  appendKnowledgeFilterSection(host, 'tags', 'Tags', tags, 10);
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
function knowledgeMatches(item, q) {
  const tagQuery = String(q || '').replace(/^#/, '');
  return textMatch([item.title, item.summary, item.content, item.typeLabel, ...(item.tags || []),
    ...(item.groups || []).map(x => x.name), ...(item.documents || []).flatMap(x => [x.name, x.version, x.originalName])], q)
    || (!!tagQuery && (item.tags || []).some(tag => tag.toLowerCase().includes(tagQuery)));
}
function knowledgePassesFilters(item) {
  const status = [...knowledgeFilters].filter(x => x.startsWith('STATUS:')).map(x => x.slice(7));
  const types = [...knowledgeFilters].filter(x => x.startsWith('TYPE:')).map(x => x.slice(5));
  const groups = [...knowledgeFilters].filter(x => x.startsWith('GROUP:')).map(x => Number(x.slice(6)));
  const tags = [...knowledgeFilters].filter(x => x.startsWith('TAG:')).map(x => x.slice(4));
  if (!status.length && item.status === 'ARCHIVED') return false;
  if (status.length && !status.includes(item.status)) return false;
  if (types.length && !types.includes(item.type)) return false;
  if (groups.length && !groups.some(id => (item.groups || []).some(group => group.id === id))) return false;
  if (tags.length && !tags.every(tag => (item.tags || []).some(value => value.toLowerCase() === tag))) return false;
  return true;
}
function knowledgeRowSubtitle(item, q = '') {
  const content = String(item.content || ''), words = String(q || '').split(/\s+/).filter(Boolean);
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
    else if (key.startsWith('GROUP:')) label = knowledgeGroups.find(x => x.id === Number(key.slice(6)))?.name || 'Group';
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
    document.getElementById('kh-empty-copy').textContent = hasQuery ? 'Try fewer words, a document version, or a different tag.' : filtered ? 'Remove a filter to broaden this view.' : 'Create an item, then add written guidance or versioned documents.';
    document.getElementById('kh-empty-clear').hidden = !hasQuery && !filtered;
  }
  shown.forEach(item => {
    const row = pjMk('button', 'kh-row'); row.dataset.knowledgeId = item.id;
    const icon = pjMk('span', 'kh-row-icon'); icon.innerHTML = ic(item.type === 'TROUBLESHOOTING' ? 'wrench' : item.type === 'INTEGRATION_GUIDE' ? 'plug' : 'book-open');
    const copy = pjMk('div'), title = pjMk('div', 'kh-row-title'), summary = pjMk('div', 'kh-row-summary');
    appendHighlightedText(title, item.title, q); appendHighlightedText(summary, knowledgeRowSubtitle(item, q), q);
    copy.append(title, summary);
    const meta = pjMk('div', 'kh-meta');
    meta.appendChild(pjMk('span', 'kh-pill ' + item.status.toLowerCase(), knowledgeStatusLabel(item.status)));
    if (item.typeLabel || item.type) meta.appendChild(pjMk('span', 'kh-pill', lkLabel('KNOWLEDGE_TYPE', item.type) || item.typeLabel));
    (item.groups || []).slice(0, 2).forEach(group => meta.appendChild(pjMk('span', 'kh-pill', group.name)));
    if ((item.groups || []).length > 2) meta.appendChild(pjMk('span', 'kh-pill', '+' + (item.groups.length - 2) + ' groups'));
    (item.tags || []).slice(0, 3).forEach(tag => meta.appendChild(pjMk('span', 'kh-pill', '#' + tag)));
    if ((item.tags || []).length > 3) meta.appendChild(pjMk('span', 'kh-pill', '+' + (item.tags.length - 3) + ' tags'));
    if (knowledgeDocumentCount(item)) meta.appendChild(pjMk('span', 'kh-pill', knowledgeDocumentCount(item) + ' document' + (knowledgeDocumentCount(item) === 1 ? '' : 's')));
    copy.appendChild(meta);
    row.append(icon, copy, pjMk('span', 'kh-row-date', 'Updated ' + new Date(item.updatedAt).toLocaleDateString()));
    row.onclick = () => { knowledgeListFocus = row; openKnowledgeDetail(item.id); }; list.appendChild(row);
  });
  uiState.filters ||= {};
  uiState.filters.knowledge = { filters: [...knowledgeFilters], query: q, sort, sections: knowledgeFilterSections };
  saveUiStateDebounced();
}
function khButton(label, cls, fn) { const b = pjMk('button', 'btn' + (cls ? ' ' + cls : ''), label); b.onclick = fn; return b; }
function formatKnowledgeVersion(value) { const version = String(value || '1.0').trim(); return /^(v|rev(?:ision)?\b)/i.test(version) ? version : 'v' + version; }
function knowledgeVersionCompare(a, b) { return String(b.version || '').localeCompare(String(a.version || ''), undefined, { numeric: true, sensitivity: 'base' }) || String(b.uploadedAt).localeCompare(String(a.uploadedAt)); }
function buildKnowledgeOverflow(actions) {
  const wrap = pjMk('div', 'kh-overflow'), trigger = khButton('•••', 'small', () => {});
  trigger.title = 'More actions'; trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
  const menu = pjMk('div', 'kh-overflow-menu'); menu.setAttribute('role', 'menu'); menu.hidden = true;
  trigger.onclick = event => {
    event.stopPropagation();
    document.querySelectorAll('.kh-overflow-menu').forEach(other => { if (other !== menu) other.hidden = true; });
    menu.hidden = !menu.hidden; trigger.setAttribute('aria-expanded', String(!menu.hidden));
  };
  menu.onclick = event => event.stopPropagation();
  actions.forEach(action => { const button = pjMk('button', action.danger ? 'danger' : '', action.label); button.onclick = () => { menu.hidden = true; action.run(); }; menu.appendChild(button); });
  wrap.append(trigger, menu); return wrap;
}
document.addEventListener('click', () => document.querySelectorAll('.kh-overflow-menu').forEach(menu => {
  menu.hidden = true; menu.parentElement?.querySelector('[aria-haspopup="menu"]')?.setAttribute('aria-expanded', 'false');
}));
async function openKnowledgeDetail(id) {
  const listItem = knowledgeItems.find(x => x.id === Number(id)); if (!listItem) return;
  knowledgeCurrentId = listItem.id; showKnowledgeDetailView();
  const host = document.getElementById('kh-detail-view'); host.innerHTML = '';
  const loading = pjMk('div', 'kh-detail'); loading.appendChild(pjMk('div', 'kh-detail-summary', 'Loading knowledge item…')); host.appendChild(loading);
  let item;
  try { item = await window.api.getKnowledgeItem(listItem.id); } catch { toast('Could not load knowledge item'); closeKnowledgeDetail(); return; }
  if (!item || knowledgeCurrentId !== listItem.id) return;
  knowledgeCurrentItem = item; host.innerHTML = '';
  const page = pjMk('div', 'kh-detail'), back = pjMk('button', 'kh-breadcrumb', '← Knowledge Hub');
  back.onclick = closeKnowledgeDetail; page.appendChild(back);
  const head = pjMk('div', 'kh-detail-head'), copy = pjMk('div'), badges = pjMk('div', 'kh-meta');
  badges.appendChild(pjMk('span', 'kh-pill ' + item.status.toLowerCase(), knowledgeStatusLabel(item.status)));
  if (item.typeLabel || item.type) badges.appendChild(pjMk('span', 'kh-pill', lkLabel('KNOWLEDGE_TYPE', item.type) || item.typeLabel));
  copy.append(badges, pjMk('h1', '', item.title), pjMk('div', 'kh-detail-summary', item.summary || knowledgeRowSubtitle(item)), pjMk('div', 'kh-detail-updated', 'Updated ' + new Date(item.updatedAt).toLocaleString()));
  const actions = pjMk('div', 'kh-detail-actions');
  actions.append(khButton('Edit', 'primary', () => openKnowledgeEditor(item)), khButton('Add document', '', () => openKnowledgeDocumentModal(item.id)));
  actions.appendChild(buildKnowledgeOverflow([
    { label: 'Duplicate as draft', run: () => duplicateKnowledgeItem(item) },
    ...(item.status === 'DRAFT' ? [{ label: 'Mark as ready', run: () => setKnowledgeStatus(item, 'PUBLISHED') }]
      : item.status === 'PUBLISHED' ? [{ label: 'Move back to draft', run: () => setKnowledgeStatus(item, 'DRAFT') }] : []),
    { label: item.status === 'ARCHIVED' ? 'Restore as draft' : 'Archive', run: () => setKnowledgeStatus(item, item.status === 'ARCHIVED' ? 'DRAFT' : 'ARCHIVED') },
    { label: 'Delete item', danger: true, run: () => showDeleteConfirm(actions, () => deleteKnowledgeItem(item), () => openKnowledgeDetail(item.id)) },
  ]));
  head.append(copy, actions); page.appendChild(head);
  const files = pjMk('section', 'kh-section');
  files.appendChild(pjMk('h3', '', 'Documents (' + item.documents.length + ')'));
  if (!item.documents.length) files.appendChild(pjMk('div', 'kh-detail-summary', 'No documents yet — add the first versioned file.'));
  const families = new Map();
  item.documents.forEach(file => {
    const key = String(file.name || file.originalName || 'Document').trim().toLowerCase();
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(file);
  });
  [...families.values()].sort((a, b) => String(a[0].name).localeCompare(String(b[0].name))).forEach(family => files.appendChild(buildKnowledgeDocumentFamily(item, family)));
  page.appendChild(files);
  if (item.content) {
    const content = pjMk('section', 'kh-section'), rendered = pjMk('div', 'kh-content');
    content.append(pjMk('h3', '', 'Written guidance'), rendered); renderKnowledgeContent(rendered, item.content); page.appendChild(content);
  }
  const organization = pjMk('section', 'kh-section'), orgTitle = pjMk('div');
  orgTitle.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px';
  orgTitle.append(pjMk('h3', '', 'Organization'), khButton('Edit organization', 'small', () => openKnowledgeEditor(item)));
  organization.appendChild(orgTitle);
  const chips = pjMk('div', 'kh-meta');
  (item.groups || []).forEach(group => {
    const chip = pjMk('button', 'kh-pill', group.name); chip.onclick = () => { knowledgeFilters.add('GROUP:' + group.id); closeKnowledgeDetail(); }; chips.appendChild(chip);
  });
  (item.tags || []).forEach(tag => {
    const chip = pjMk('button', 'kh-pill', '#' + tag); chip.onclick = () => { knowledgeFilters.add('TAG:' + tag.toLowerCase()); closeKnowledgeDetail(); }; chips.appendChild(chip);
  });
  if (!chips.childElementCount) chips.appendChild(pjMk('span', 'kh-detail-summary', 'No groups or tags yet.'));
  organization.appendChild(chips); page.appendChild(organization);
  host.appendChild(page); back.focus();
}
function closeKnowledgeDetail() {
  knowledgeCurrentId = null; knowledgeCurrentItem = null; showKnowledgeListView(); renderKnowledgeList();
  setTimeout(() => { if (knowledgeListFocus?.isConnected) knowledgeListFocus.focus(); }, 0);
}
function buildKnowledgeDocumentFamily(item, files) {
  files.sort(knowledgeVersionCompare); const latest = files[0], family = pjMk('div', 'kh-document-family'), head = pjMk('div', 'kh-document-family-head');
  const icon = pjMk('span'); icon.innerHTML = ic(latest.exists ? 'file-text' : 'triangle-alert');
  const copy = pjMk('div', 'kh-resource-copy');
  copy.append(pjMk('b', '', latest.name || latest.originalName || '(document)'), pjMk('span', '', `Latest ${formatKnowledgeVersion(latest.version)} · ${latest.originalName} · ${fmtFileSize(latest.size)}${latest.exists ? '' : ' · Missing from disk'}`));
  head.append(icon, copy, pjMk('span', 'kh-version-pill', formatKnowledgeVersion(latest.version)), khButton('New version', 'small', () => openKnowledgeDocumentModal(item.id, latest.name)));
  if (latest.exists) head.appendChild(khButton('Open', 'small primary', () => openKnowledgeAttachment(latest.id)));
  head.appendChild(buildKnowledgeOverflow([
    ...(latest.exists ? [{ label: 'Download latest', run: () => downloadKnowledgeAttachment(latest.id) }] : []),
    { label: 'Remove latest version', danger: true, run: () => showDeleteConfirm(head, () => removeKnowledgeAttachment(item.id, latest.id), () => openKnowledgeDetail(item.id)) },
  ]));
  family.appendChild(head);
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
  copy.append(pjMk('b', '', formatKnowledgeVersion(file.version)), pjMk('span', '', `${file.originalName} · ${fmtFileSize(file.size)} · Added ${new Date(file.uploadedAt).toLocaleDateString()}${file.exists ? '' : ' · Missing from disk'}`));
  row.append(copy);
  if (file.exists) row.appendChild(khButton('Open', 'small', () => openKnowledgeAttachment(file.id)));
  row.appendChild(buildKnowledgeOverflow([
    ...(file.exists ? [{ label: 'Download', run: () => downloadKnowledgeAttachment(file.id) }] : []),
    { label: 'Remove version', danger: true, run: () => showDeleteConfirm(row, () => removeKnowledgeAttachment(item.id, file.id), () => openKnowledgeDetail(item.id)) },
  ]));
  return row;
}
function appendKnowledgeInline(parent, text) {
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/ig; let last = 0, match;
  while ((match = regex.exec(text))) {
    parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    const url = match[2], link = document.createElement('a'); link.href = '#'; link.textContent = match[1]; link.title = url;
    link.onclick = event => { event.preventDefault(); window.api.openExternal(url); };
    parent.appendChild(link); last = regex.lastIndex;
  }
  parent.appendChild(document.createTextNode(text.slice(last)));
}
function renderKnowledgeContent(host, value) {
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
function previewKnowledgeContent() { renderKnowledgeContent(document.getElementById('kh-content-preview'), document.getElementById('kh-content-input').value); }
function formatKnowledgeText(kind) {
  const input = document.getElementById('kh-content-input'), start = input.selectionStart, end = input.selectionEnd, selected = input.value.slice(start, end);
  const formats = {
    heading: ['## ', selected || 'Heading'], bullet: ['- ', selected || 'List item'], number: ['1. ', selected || 'List item'],
    code: ['```\n', (selected || 'code') + '\n```'], link: ['[', (selected || 'Link text') + '](https://example.com)'],
  };
  const [prefix, body] = formats[kind] || ['', selected]; input.setRangeText(prefix + body, start, end, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
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
function renderKnowledgeEditorGroups() {
  const host = document.getElementById('kh-editor-groups'), q = (document.getElementById('kh-editor-group-search').value || '').trim().toLowerCase();
  host.innerHTML = '';
  const shown = knowledgeGroups.filter(group => !q || group.name.toLowerCase().includes(q) || group.description.toLowerCase().includes(q));
  if (!shown.length) { host.appendChild(pjMk('div', 'kh-detail-summary', knowledgeGroups.length ? 'No groups match.' : 'No groups yet.')); return; }
  shown.forEach(group => {
    const label = pjMk('label', 'kh-group-choice'), input = document.createElement('input'); input.type = 'checkbox'; input.value = group.id;
    input.checked = knowledgeEditorGroupIds.has(group.id);
    input.onchange = () => { input.checked ? knowledgeEditorGroupIds.add(group.id) : knowledgeEditorGroupIds.delete(group.id); markKnowledgeEditorDirty(); };
    label.append(input, pjMk('span', '', group.name)); host.appendChild(label);
  });
}
function knowledgeEditorSnapshot() {
  return {
    itemId: knowledgeEditId, mode: knowledgeCreationMode, title: document.getElementById('kh-title-input').value,
    type: document.getElementById('kh-type-input').value, status: document.getElementById('kh-status-input').value,
    summary: document.getElementById('kh-summary-input').value, content: document.getElementById('kh-content-input').value,
    tags: [...knowledgeEditorTags], groupIds: [...knowledgeEditorGroupIds], savedAt: new Date().toISOString(),
  };
}
function markKnowledgeEditorDirty() {
  knowledgeEditorDirty = true; uiState.knowledgeDraft = knowledgeEditorSnapshot(); saveUiStateDebounced();
}
function applyKnowledgeEditorData(data) {
  document.getElementById('kh-title-input').value = data?.title || '';
  document.getElementById('kh-summary-input').value = data?.summary || '';
  document.getElementById('kh-content-input').value = data?.content || '';
  document.getElementById('kh-status-input').value = data?.status || 'DRAFT';
  document.getElementById('kh-type-input').value = data?.type || '';
  knowledgeEditorTags = [...(data?.tags || [])];
  knowledgeEditorGroupIds = new Set(data?.groupIds || data?.groups?.map(group => group.id) || []);
  renderKnowledgeEditorTags(); renderKnowledgeEditorGroups(); previewKnowledgeContent();
}
function recoverKnowledgeDraft() {
  if (!knowledgePendingDraft) return;
  knowledgeCreationMode = knowledgePendingDraft.mode || knowledgeCreationMode; applyKnowledgeEditorData(knowledgePendingDraft);
  knowledgePendingDraft = null; document.getElementById('kh-recovery').hidden = true; knowledgeEditorDirty = true; toast('Unsaved draft recovered');
}
function discardKnowledgeDraft() {
  knowledgePendingDraft = null; delete uiState.knowledgeDraft; saveUiStateDebounced();
  document.getElementById('kh-recovery').hidden = true;
}
function openKnowledgeEditor(item) {
  knowledgeEditId = item?.id || null; knowledgeEditorDirty = false;
  document.getElementById('kh-modal-title').textContent = item ? 'Edit Knowledge Item' : knowledgeCreationMode === 'DOCUMENT' ? 'New Document Item' : 'New Knowledge Item';
  document.getElementById('kh-save-btn').textContent = item ? 'Save Changes' : knowledgeCreationMode === 'DOCUMENT' ? 'Create & Choose File' : 'Create Item';
  const type = document.getElementById('kh-type-input'); type.innerHTML = '<option value="">No type</option>';
  lkOptions('KNOWLEDGE_TYPE').forEach(option => { const el = document.createElement('option'); el.dataset.userContent = ''; el.value = option.code; el.textContent = lookupDisplayName(option); type.appendChild(el); });
  document.getElementById('kh-editor-group-search').value = '';
  applyKnowledgeEditorData(item || { status: 'DRAFT', tags: [], groups: [] });
  const suggestions = document.getElementById('kh-tag-suggestions'); suggestions.innerHTML = '';
  [...new Set(knowledgeItems.flatMap(entry => entry.tags || []))].sort((a, b) => a.localeCompare(b)).forEach(tag => { const option = document.createElement('option'); option.value = tag; suggestions.appendChild(option); });
  setupKnowledgeTagInput(); clearErrorsIn('#knowledge-modal');
  const draft = uiState.knowledgeDraft;
  knowledgePendingDraft = draft && Number(draft.itemId || 0) === Number(knowledgeEditId || 0) ? draft : null;
  document.getElementById('kh-recovery').hidden = !knowledgePendingDraft;
  const overlay = document.getElementById('knowledge-modal-overlay'); overlay.classList.add('open');
  overlay.oninput = event => { if (event.target.id !== 'kh-editor-group-search' && event.target.id !== 'kh-tags-input') markKnowledgeEditorDirty(); };
  overlay.onchange = event => { if (!event.target.closest('#kh-editor-groups')) markKnowledgeEditorDirty(); };
  setTimeout(() => document.getElementById('kh-title-input').focus(), 60);
}
function closeKnowledgeEditor(force) {
  if (!force && knowledgeEditorDirty && !confirm('Close the editor? Your changes are saved as a recoverable draft.')) return;
  knowledgeEditorDirty = false; knowledgeEditId = null; knowledgePendingDraft = null;
  document.getElementById('knowledge-modal-overlay').classList.remove('open');
}
function knowledgeEditorOverlayClick(event) { if (event.target === document.getElementById('knowledge-modal-overlay')) closeKnowledgeEditor(); }
async function saveKnowledgeEditor() {
  const input = document.getElementById('kh-tags-input'); if (input.value.trim()) { addKnowledgeTag(input.value); input.value = ''; }
  clearErrorsIn('#knowledge-modal'); const title = document.getElementById('kh-title-input').value.trim();
  if (!title) { markError('kh-title-input'); return; }
  const editing = knowledgeEditId, mode = knowledgeCreationMode;
  const data = {
    title, type: document.getElementById('kh-type-input').value, status: document.getElementById('kh-status-input').value,
    summary: document.getElementById('kh-summary-input').value.trim(), content: document.getElementById('kh-content-input').value.trim(),
    tags: knowledgeEditorTags, groupIds: [...knowledgeEditorGroupIds],
  };
  try {
    const saved = editing ? await window.api.updateKnowledgeItem(editing, data) : await window.api.createKnowledgeItem(data);
    delete uiState.knowledgeDraft; saveUiStateDebounced(); knowledgeEditorDirty = false; closeKnowledgeEditor(true);
    toast(editing ? 'Knowledge item saved' : 'Knowledge item created'); await loadKnowledgeItems(saved.id);
    if (!editing && mode === 'DOCUMENT') openKnowledgeDocumentModal(saved.id);
    knowledgeCreationMode = 'ARTICLE';
  } catch (error) { toast(error?.message || 'Could not save knowledge item'); }
}
function nextKnowledgeCopyTitle(title) {
  const base = String(title || 'Knowledge Item').replace(/(?:\s+—\s+Copy(?:\s+\d+)?)+$/i, '').trim() || 'Knowledge Item';
  const used = new Set(knowledgeItems.map(item => item.title.toLowerCase())); let candidate = base + ' — Copy', n = 2;
  while (used.has(candidate.toLowerCase())) candidate = base + ' — Copy ' + n++; return candidate;
}
async function duplicateKnowledgeItem(item) {
  try {
    const copy = await window.api.createKnowledgeItem({ title: nextKnowledgeCopyTitle(item.title), type: item.type, status: 'DRAFT', summary: item.summary, content: item.content, tags: item.tags, groupIds: item.groups.map(group => group.id) });
    toast('Draft copy created with the same tags and groups'); await loadKnowledgeItems(copy.id);
  } catch { toast('Could not duplicate item'); }
}
async function setKnowledgeStatus(item, status) {
  try {
    const saved = await window.api.updateKnowledgeItem(item.id, { title: item.title, type: item.type, status, summary: item.summary, content: item.content, tags: item.tags });
    toast(status === 'ARCHIVED' ? 'Knowledge item archived' : status === 'PUBLISHED' ? 'Knowledge item marked ready' : 'Knowledge item moved to draft'); await loadKnowledgeItems(saved.id);
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
function openKnowledgeDocumentModal(itemId, documentName = '') {
  knowledgeDocumentItemId = itemId; const item = knowledgeCurrentItem?.id === Number(itemId) ? knowledgeCurrentItem : knowledgeItems.find(entry => entry.id === Number(itemId));
  const nameInput = document.getElementById('kh-document-name'), versionInput = document.getElementById('kh-document-version'), options = document.getElementById('kh-document-names'); options.innerHTML = '';
  [...new Set((item?.documents || []).map(document => document.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)).forEach(name => { const option = document.createElement('option'); option.value = name; options.appendChild(option); });
  nameInput.value = documentName || ''; versionInput.value = documentName ? '' : '1.0';
  document.getElementById('kh-document-modal-title').textContent = documentName ? 'Add New Version' : 'Add Document';
  clearErrorsIn('#knowledge-document-modal'); document.getElementById('knowledge-document-modal-overlay').classList.add('open');
  setTimeout(() => (documentName ? versionInput : nameInput).focus(), 50);
}
function closeKnowledgeDocumentModal() { knowledgeDocumentItemId = null; document.getElementById('knowledge-document-modal-overlay').classList.remove('open'); }
function knowledgeDocumentOverlayClick(event) { if (event.target === document.getElementById('knowledge-document-modal-overlay')) closeKnowledgeDocumentModal(); }
async function submitKnowledgeDocument() {
  const itemId = knowledgeDocumentItemId, name = document.getElementById('kh-document-name').value.trim(), version = document.getElementById('kh-document-version').value.trim();
  clearErrorsIn('#knowledge-document-modal'); if (!name) { markError('kh-document-name'); return; } if (!version) { markError('kh-document-version'); return; }
  let result; try { result = await window.api.uploadKnowledgeAttachment(itemId, { name, version }); } catch { toast('Could not add document'); return; }
  if (result?.canceled) return; if (!result?.ok) { toast(result?.error || 'Could not add document'); return; }
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
function openKnowledgeGroupEditor(group) {
  knowledgeGroupEditId = group?.id || null; document.getElementById('kh-group-modal-title').textContent = group ? 'Edit Group' : 'New Group';
  document.getElementById('kh-group-save').textContent = group ? 'Save Group' : 'Create Group';
  const deleteHost = document.getElementById('kh-group-delete-host'); deleteHost.innerHTML = ''; deleteHost.hidden = !group;
  if (group) deleteHost.appendChild(khButton('Delete Group', 'danger', confirmDeleteKnowledgeGroup));
  document.getElementById('kh-group-name').value = group?.name || ''; document.getElementById('kh-group-description').value = group?.description || '';
  document.getElementById('kh-group-item-search').value = '';
  const host = document.getElementById('kh-group-items'); host.innerHTML = '';
  if (!knowledgeItems.length) host.appendChild(pjMk('div', 'kh-detail-summary', 'Create knowledge items first, or create an empty group now.'));
  knowledgeItems.forEach(item => {
    const label = pjMk('label', 'kh-group-choice'), input = document.createElement('input'); input.type = 'checkbox'; input.value = item.id; input.checked = !!group?.itemIds?.includes(item.id);
    label.append(input, pjMk('span', '', item.title + (item.status === 'ARCHIVED' ? ' (Archived)' : ''))); host.appendChild(label);
  });
  clearErrorsIn('#knowledge-group-modal'); document.getElementById('knowledge-group-modal-overlay').classList.add('open'); setTimeout(() => document.getElementById('kh-group-name').focus(), 50);
}
function filterKnowledgeGroupItems() {
  const q = (document.getElementById('kh-group-item-search').value || '').trim().toLowerCase();
  document.querySelectorAll('#kh-group-items .kh-group-choice').forEach(label => { label.hidden = !!q && !label.textContent.toLowerCase().includes(q); });
}
function closeKnowledgeGroupEditor() { knowledgeGroupEditId = null; document.getElementById('knowledge-group-modal-overlay').classList.remove('open'); }
function knowledgeGroupOverlayClick(event) { if (event.target === document.getElementById('knowledge-group-modal-overlay')) closeKnowledgeGroupEditor(); }
async function saveKnowledgeGroup() {
  const name = document.getElementById('kh-group-name').value.trim(); if (!name) { markError('kh-group-name'); return; }
  const data = { name, description: document.getElementById('kh-group-description').value.trim(), itemIds: [...document.querySelectorAll('#kh-group-items input:checked')].map(x => Number(x.value)) };
  try {
    const editing = knowledgeGroupEditId, group = editing ? await window.api.updateKnowledgeGroup(editing, data) : await window.api.createKnowledgeGroup(data);
    closeKnowledgeGroupEditor(); toast(editing ? 'Group saved' : 'Group created'); knowledgeCurrentId = null; await loadKnowledgeItems();
    knowledgeFilters.add('GROUP:' + group.id); renderKnowledgeList();
  } catch (error) { toast(error?.message || 'Could not save group'); }
}
function confirmDeleteKnowledgeGroup() {
  const group = knowledgeGroups.find(x => x.id === knowledgeGroupEditId), host = document.getElementById('kh-group-delete-host');
  if (!group) return; showDeleteConfirm(host, () => deleteKnowledgeGroup(group), () => openKnowledgeGroupEditor(group), 'Delete group?');
}
async function deleteKnowledgeGroup(group) {
  let result; try { result = await window.api.deleteKnowledgeGroup(group.id); } catch { toast('Could not delete group'); return; }
  if (!result?.ok) { toast(result?.error || 'Could not delete group'); return; }
  closeKnowledgeGroupEditor(); knowledgeFilters.delete('GROUP:' + group.id); await loadKnowledgeItems();
  toast('Group deleted', { actionLabel: 'Undo', duration: 5000, onAction: async () => {
    try { const restored = await window.api.createKnowledgeGroup({ name: result.snapshot.name, description: result.snapshot.description, itemIds: result.snapshot.itemIds }); toast('Group restored'); await loadKnowledgeItems(); knowledgeFilters.add('GROUP:' + restored.id); renderKnowledgeList(); }
    catch { toast('Could not restore group'); }
  } });
}
