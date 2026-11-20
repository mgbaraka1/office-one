// ══ COMMAND PALETTE (Ctrl+K) ════════════════════════════════════════════════
// One keyboard entry point to everything: navigate to a page, run a quick
// action, jump to a date (type it), open a project, or log a session on any
// task (opens the compact Session edit modal in create mode, task fixed).
let _palItems = [];      // flattened, currently-rendered items
let _palActive = 0;
let _palWorkspace = [];  // bounded FTS results from SQLite
let _palOpenSeq = 0;     // prevents an older search load from repainting a newer open
let _palSearchSeq = 0;
let _palSearchTimer = null;
// taskId -> departmentId != null, loaded once per palette-open (workspace_search's
// FTS rows carry no domain info, so a task result
// is badged from this side map instead of a trigger/schema change).
let _palTaskDomainMap = null;

const PAL_PAGES = [
  { icon: 'clock',            label: 'Timesheet',     go: 'timesheet' },
  { icon: 'layout-dashboard', label: 'Overview',      go: 'analytics' },
  { icon: 'file-text',        label: 'Reports',       go: 'reports' },
  { icon: 'building-2',       label: 'Browse — Companies', go: 'companies' },
  { icon: 'folder',           label: 'Browse — Systems',   go: 'systems' },
  { icon: 'tag',              label: 'Browse — Work Nature', go: 'natures' },
  { icon: 'list',             label: 'Client Tasks',   go: 'all-tasks' },
  { icon: 'building',         label: 'Internal Work',  go: 'internal-tasks' },
  { icon: 'layers',           label: 'Clients',       go: 'clients' },
  { icon: 'briefcase',        label: 'Project & Finance', go: 'pfm' },
  { icon: 'users',            label: 'Outsource',     go: 'outsource' },

  { icon: 'credit-card',      label: 'Subscriptions', go: 'subscriptions' },
  { icon: 'folder-check',     label: 'Company Documents', go: 'companydocs' },
  { icon: 'layout-template',  label: 'Templates',     go: 'templates' },
  { icon: 'book-open',        label: 'Knowledge Hub', go: 'knowledge' },
  { icon: 'settings',         label: 'Settings',      go: 'settings' },
];

// Settings tabs (Milestone 5 palette expansion) — the catalog entries are
// derived from settings-registry.js's SETTINGS_CATALOG_TABS (loaded before
// this file) so this list can't drift from the actual tab set the way it
// once did (it used to omit Maintenance, so the palette could not reach it —
// registry). Jumping calls the existing
// switchTab(btn) with that tab's real button element (not a fake one).
const PAL_SETTINGS_TABS = [
  { key: 'general', label: 'General' },
  { key: 'users', label: 'User Management' },
  // settingsTab: false entries have no panel to jump to (COMPANY is managed on
  // the Clients page), so the palette must not offer them.
  ...SETTINGS_CATALOG_TABS.filter(t => t.settingsTab !== false).map(t => ({ key: t.key, label: t.label, page: t.page })),
  { key: 'backup', label: 'Backup Data' },
  { key: 'maintenance', label: 'Maintenance' },
];

async function openPalette() {
  const openSeq = ++_palOpenSeq;
  document.getElementById('palette-overlay').classList.add('open');
  const inp = document.getElementById('palette-input');
  const listHost = document.getElementById('palette-list');
  const statusHost = document.getElementById('palette-status');
  inp.value = '';
  _palWorkspace = [];
  _palTaskDomainMap = null;
  listHost.setAttribute('aria-busy', 'true');
  statusHost.textContent = 'Searching your workspace…';
  renderPalette();
  setTimeout(() => inp.focus(), 40);
  // Fire-and-forget: loaded once per open, independent of the search request
  // below, so a slow task list never delays the palette's first paint.
  window.api.getTasksIndex().then(list => {
    if (openSeq !== _palOpenSeq) return;
    _palTaskDomainMap = new Map((list || []).map(t => [t.id, t.departmentId != null]));
    renderPalette();
  }).catch(() => { _palTaskDomainMap = new Map(); });
  await requestPaletteWorkspace('', openSeq);
}
function closePalette() {
  _palOpenSeq++;
  clearTimeout(_palSearchTimer);
  document.getElementById('palette-overlay').classList.remove('open');
  document.getElementById('palette-list').setAttribute('aria-busy', 'false');
}
function paletteIsOpen() { return document.getElementById('palette-overlay').classList.contains('open'); }
function paletteOverlayClick(e) { if (e.target === document.getElementById('palette-overlay')) closePalette(); }

function paletteInputChanged() {
  renderPalette();
  clearTimeout(_palSearchTimer);
  const openSeq = _palOpenSeq;
  _palSearchTimer = setTimeout(() => {
    if (paletteIsOpen()) requestPaletteWorkspace(document.getElementById('palette-input').value, openSeq);
  }, 100);
}

async function requestPaletteWorkspace(query, openSeq) {
  const searchSeq = ++_palSearchSeq;
  const listHost = document.getElementById('palette-list');
  const statusHost = document.getElementById('palette-status');
  listHost.setAttribute('aria-busy', 'true');
  statusHost.textContent = 'Searching your workspace…';
  try {
    const results = await window.api.searchWorkspace(String(query || '').trim(), 30);
    if (openSeq !== _palOpenSeq || searchSeq !== _palSearchSeq || !paletteIsOpen()) return;
    _palWorkspace = Array.isArray(results) ? results : [];
    renderPalette();
    statusHost.textContent = _palWorkspace.length
      ? _palWorkspace.length + ' workspace result' + (_palWorkspace.length === 1 ? '' : 's')
      : 'Pages and actions ready';
  } catch (error) {
    if (openSeq === _palOpenSeq && searchSeq === _palSearchSeq) {
      _palWorkspace = [];
      renderPalette();
      statusHost.textContent = 'Workspace search unavailable';
      console.error('Workspace search failed', error);
    }
  } finally {
    if (openSeq === _palOpenSeq && searchSeq === _palSearchSeq) listHost.setAttribute('aria-busy', 'false');
  }
}

// ── Keyboard shortcuts overlay ("?", Milestone 5) — static, read-only ──
function openShortcutsOverlay() { document.getElementById('shortcuts-overlay').classList.add('open'); }
function closeShortcutsOverlay() { document.getElementById('shortcuts-overlay').classList.remove('open'); }
function shortcutsOverlayClick(e) { if (e.target === document.getElementById('shortcuts-overlay')) closeShortcutsOverlay(); }

// "How This App Thinks" cheat-sheet (Milestone 10) — reachable from the "?"
// shortcuts overlay and Settings -> General.
function openHowThinksOverlay() { document.getElementById('howthinks-overlay').classList.add('open'); }
function closeHowThinksOverlay() { document.getElementById('howthinks-overlay').classList.remove('open'); }
function howThinksOverlayClick(e) { if (e.target === document.getElementById('howthinks-overlay')) closeHowThinksOverlay(); }
// ── Settings -> General: What's New ──
// The running version and its notes (only the latest change), from
// release-notes.json (committed, written with each version bump). Each entry
// has a title and notes in English and Arabic, shown in the app's language;
// an entry without Arabic (versions released before the file existed) falls
// back to English. `technical` lines (migrations, schema) are English only and
// fold behind their own toggle. All of it is a record, so it is marked as user
// content and the translator leaves it alone.
let _whatsNewLoaded = null;
async function renderWhatsNew() {
  const host = document.getElementById('whats-new');
  if (!host) return;
  if (!_whatsNewLoaded) {
    _whatsNewLoaded = Promise.all([
      window.api.appVersion().catch(() => ''),
      window.api.releaseNotes().catch(() => []),
    ]);
  }
  const [version, notes] = await _whatsNewLoaded;
  host.innerHTML = '';
  // Label and number as separate nodes, so the label translates on its own.
  const versionLine = pjMk('div', 'whats-new-version');
  versionLine.appendChild(pjMk('span', null, 'Installed version:'));
  versionLine.appendChild(document.createTextNode(' '));
  const versionValue = pjMk('span', null, version || '?');
  versionValue.dataset.userContent = '';
  versionLine.appendChild(versionValue);
  host.appendChild(versionLine);
  if (!notes.length) {
    host.appendChild(pjMk('p', 'general-hint', 'No release notes are bundled with this build.'));
    return;
  }
  const current = notes.find(n => n.version === version);
  // A build with no entry of its own shows the newest one instead, and says so.
  if (!current) host.appendChild(pjMk('p', 'general-hint', 'This build is newer than the last release. Latest release notes:'));
  // Only the latest change is shown; earlier entries stay in the file as a record.
  host.appendChild(buildReleaseNote(current || notes[0]));
}
// Switching language redraws the notes in the other one.
document.addEventListener('ct:languagechange', () => {
  if (document.getElementById('whats-new')?.childNodes.length) renderWhatsNew();
});

// { en, ar } in the app's language: Arabic when there is one, else English.
// The element's direction follows the text actually shown.
function releaseNoteText(el, text) {
  const ar = window.ctI18n?.getLanguage?.() === 'ar' && text?.ar;
  el.textContent = ar ? text.ar : (text?.en || '');
  el.dir = ar ? 'rtl' : 'ltr';
  el.dataset.userContent = '';
  return el;
}

// One version's card: version, kind, title and date, then its notes.
function buildReleaseNote(n) {
  const kind = n.kind === 'feat' || n.kind === 'fix' ? n.kind : 'other';
  const kindLabels = { feat: 'New feature', fix: 'Fix', other: 'Improvement' };

  const box = pjMk('div', 'whats-new-note is-current');
  const head = pjMk('div', 'whats-new-head');
  const tag = pjMk('span', 'whats-new-tag', n.version);   // "v" comes from CSS
  tag.dataset.userContent = '';
  head.appendChild(tag);
  head.appendChild(pjMk('span', 'whats-new-kind kind-' + kind, kindLabels[kind]));
  head.appendChild(releaseNoteText(pjMk('span', 'whats-new-title'), n.title));
  if (n.date) head.appendChild(pjMk('span', 'whats-new-date', n.date));
  box.appendChild(head);

  const notes = Array.isArray(n.notes) ? n.notes : [];
  if (notes.length) {
    const list = pjMk('ul', 'whats-new-body');
    notes.forEach(note => list.appendChild(releaseNoteText(pjMk('li', null), note)));
    box.appendChild(list);
  }
  const technical = Array.isArray(n.technical) ? n.technical : [];
  if (technical.length) {
    const tech = pjMk('details', 'whats-new-technical');
    tech.appendChild(pjMk('summary', null, 'Technical details'));
    const list = pjMk('ul', null);
    list.dir = 'ltr'; list.dataset.userContent = '';
    technical.forEach(line => list.appendChild(pjMk('li', null, line)));
    tech.appendChild(list);
    box.appendChild(tech);
  }
  return box;
}

// A "Where everything lives" tile: close the guide and open that page.
function openHowThinksModule(module) {
  closeHowThinksOverlay();
  switchModule(module);
}

// Parse a "jump to date" query: full YYYY-MM-DD, or the words today / yesterday.
function palParseDate(q) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  const t = new Date();
  if (q === 'today') return fmt(t);
  if (q === 'yesterday') { t.setDate(t.getDate() - 1); return fmt(t); }
  return null;
}

function renderPalette() {
  const q = document.getElementById('palette-input').value.toLowerCase().trim();
  const host = document.getElementById('palette-list');
  const groups = [];

  // Jump to a date (exact date syntax or today/yesterday)
  const dateQ = palParseDate(q);
  if (dateQ && !isPageHidden('timesheet')) {
    groups.push({ label: 'Jump to date', items: [{
      icon: 'calendar-check', label: 'Open ' + dateQ + ' in the Timesheet',
      run: () => { switchModule('timesheet'); switchDay(dateQ); },
    }]});
  }

  // Pages
  const pages = PAL_PAGES.filter(p => !isPageHidden(p.go) && (!q || p.label.toLowerCase().includes(q)))
    .map(p => ({ icon: p.icon, label: p.label, hint: 'Go to', run: () => switchModule(p.go) }));
  if (pages.length) groups.push({ label: 'Go to', items: pages });

  // Quick actions
  const acts = [
    { icon: 'eye',           label: 'Workspace view & comfort',     match: 'view comfort density calm focus motion eye appearance', run: openWorkspaceView },
    { icon: 'plus',          label: 'Add record — log work',      match: 'add record log work session new', page: 'timesheet', run: () => { switchModule('timesheet'); openModal(); } },
    { icon: 'list',          label: 'Create client task',         match: 'new client task create',          page: 'all-tasks', run: () => { switchModule('all-tasks'); openBacklogModal(); } },
    { icon: 'building',      label: 'Create internal task',       match: 'new internal task create department', page: 'internal-tasks', run: () => { switchModule('internal-tasks'); openInternalTaskModal(); } },
    { icon: 'clipboard-list',label: 'New project',                match: 'new project create',              page: 'clients', run: () => { switchModule('clients'); openProjectModal(); } },
    { icon: 'briefcase',     label: 'New offer',                  match: 'new offer create quotation proposal project finance', page: 'pfm', run: () => { switchModule('pfm'); openPfmNew('OFFER'); } },
    { icon: 'briefcase',     label: 'New CR',                     match: 'new cr change request create project finance', page: 'pfm', run: () => { switchModule('pfm'); openPfmNew('CR'); } },
    { icon: 'users',         label: 'New outsource resource',     match: 'new outsource resource freelancer contractor external person rate', page: 'outsource', run: () => { switchModule('outsource'); openOutsNew(); } },
    { icon: 'book-open',     label: 'New knowledge item',         match: 'new knowledge manual guide article create', page: 'knowledge', run: () => { switchModule('knowledge'); openKnowledgeEditor(); } },
    { icon: 'calendar-check',label: 'Go to today',                match: 'today now current day',           page: 'timesheet', run: () => { switchModule('timesheet'); goToday(); } },
    { icon: 'moon',          label: 'Toggle dark / light theme',  match: 'theme dark light mode toggle',    run: toggleTheme },
    { icon: 'compass',       label: 'How This App Thinks',        match: 'how this app thinks help model cheat sheet', run: openHowThinksOverlay },
    { icon: 'save',          label: 'Back up the database',       match: 'backup database save export',     run: backupDatabase },
    { icon: 'database',      label: 'Full backup to Desktop',     match: 'backup full desktop everything',  run: () => runFullBackup() },
  ].filter(a => !isPageHidden(a.page)).filter(a => !q || a.match.includes(q) || a.label.toLowerCase().includes(q))
   .map(a => ({ icon: a.icon, label: a.label, hint: 'Action', run: a.run }));
  if (acts.length) groups.push({ label: 'Actions', items: acts });

  // Settings tabs (jump straight to a lookup category editor)
  const settingsTabs = q ? PAL_SETTINGS_TABS
    .filter(t => !isPageHidden(t.page))
    .filter(t => t.label.toLowerCase().includes(q) || ('settings ' + t.label.toLowerCase()).includes(q))
    .map(t => ({
      icon: 'settings', label: 'Settings — ' + t.label, hint: 'Go to',
      run: () => { switchModule('settings'); const btn = document.querySelector('.stab[data-tab="' + t.key + '"]'); if (btn) switchTab(btn); },
    })) : [];
  if (settingsTabs.length) groups.push({ label: 'Settings', items: settingsTabs });

  // Client names are lookup catalog entries rather than standalone records, so
  // they remain a tiny in-memory facet alongside the SQLite FTS results.
  const clientHits = q && !isPageHidden('clients') ? lkOptions('COMPANY').filter(c =>
    [c.code, c.nameEn, c.nameAr, c.label].some(v => String(v || '').toLowerCase().includes(q)))
    .slice(0, 5)
    .map(c => ({ icon: 'layers', label: companyDisplayName(c), hint: 'Open client', run: () => { switchModule('clients'); openClientDetail(c.id); } })) : [];
  if (clientHits.length) groups.push({ label: 'Clients', items: clientHits });

  const kindInfo = {
    task: ['layers', 'Log a session'],
    project: ['clipboard-list', 'Open project'],
    knowledge: ['book-open', 'Open Knowledge Hub'],
    'company-document': ['folder-check', 'Open Company Docs'],
    template: ['layout-template', 'Open Templates'],
    subscription: ['credit-card', 'Open Subscriptions'],
    'client-auth': ['shield', 'Open client access'],
    'client-server': ['server', 'Open client server'],
    'client-database': ['database', 'Open client database'],
    'client-system': ['monitor', 'Open client system'],
    pfm: ['briefcase', 'Open offer / CR'],
    'outs-resource': ['users', 'Open resource'],
    'outs-project': ['folder', 'Open project'],
    'outs-entry': ['clock', 'Open entry'],
  };
  // The page each kind of result opens; a hidden page's results are left out.
  // A task result logs a session, which happens on Today.
  const kindPage = kind => kind === 'task' ? 'timesheet'
    : kind === 'project' || kind.startsWith('client-') ? 'clients'
      : kind === 'company-document' ? 'companydocs'
        : kind === 'subscription' ? 'subscriptions'
          : kind === 'template' ? 'templates'
            : kind.startsWith('outs-') ? 'outsource'
              : kind;   // 'knowledge', 'pfm'
  const workspaceItems = _palWorkspace.filter(result => !isPageHidden(kindPage(String(result.kind || '')))).map(result => {
    const [icon, fallbackHint] = kindInfo[result.kind] || ['search', 'Open'];
    // Client/Internal badge — only tasks have a
    // domain; _palTaskDomainMap is null until its own async load resolves, in
    // which case no badge renders for this pass (a re-render follows).
    const isInternal = result.kind === 'task' ? _palTaskDomainMap?.get(result.id) : undefined;
    const badge = isInternal === true ? 'Internal' : isInternal === false ? 'Client' : null;
    return {
      icon,
      label: result.title || '(untitled)',
      hint: result.subtitle || fallbackHint,
      badge,
      run: async () => {
        if (result.kind === 'task') {
          const task = await window.api.getTask(result.id);
          if (task) openSessionModal(null, { mode: 'create', task });
        } else if (result.kind === 'project') {
          openProjectById(result.id);
        } else if (result.kind === 'knowledge') {
          switchModule('knowledge');
          openKnowledgeDetail(result.id);
        } else if (result.kind === 'company-document') {
          switchModule('companydocs');
          scrollToAndHighlight('[data-doc-id="' + result.id + '"]');
        } else if (result.kind === 'template') {
          switchModule('templates');
          scrollToAndHighlight('[data-template-id="' + result.id + '"]');
        } else if (result.kind === 'subscription') {
          switchModule('subscriptions');
          scrollToAndHighlight('[data-sub-id="' + result.id + '"]');
        } else if (result.kind === 'pfm') {
          openPfmDetail(result.id);
        } else if (result.kind === 'outs-resource') {
          openOutsDetail(Number(result.id));
        } else if (result.kind === 'outs-project' || result.kind === 'outs-entry') {
          // 'resourceId:projectId' or 'resourceId:projectId:entryId' (migration 067).
          const [, projectId, entryId] = String(result.id).split(':');
          openOutsProject(Number(projectId), entryId ? { entryId: Number(entryId) } : {});
        } else if (result.kind.startsWith('client-')) {
          const companyId = Number(String(result.id).split(':', 1)[0]);
          if (Number.isInteger(companyId) && companyId > 0) {
            switchModule('clients');
            openClientDetail(companyId);
          }
        }
      },
    };
  });
  if (workspaceItems.length) groups.push({ label: q ? 'Workspace' : 'Recently updated', items: workspaceItems });

  _palItems = groups.flatMap(g => g.items);
  _palActive = 0;

  if (!_palItems.length) {
    host.innerHTML = '<div class="pal-empty">No matches — try a page name, task, project, or a date like 2026-07-01</div>';
    return;
  }
  host.innerHTML = groups.map(g =>
    '<div class="pal-group">' + esc(g.label) + '</div>' +
    g.items.map(it => {
      const idx = _palItems.indexOf(it);
      return '<button class="pal-item' + (idx === _palActive ? ' active' : '') + '" data-idx="' + idx + '">' +
        ic(it.icon) + '<span class="pal-item-label">' + esc(it.label) + '</span>' +
        (it.badge ? '<span class="pal-item-badge pal-item-badge-' + (it.badge === 'Internal' ? 'internal' : 'client') + '">' + esc(it.badge) + '</span>' : '') +
        (it.hint ? '<span class="pal-item-hint">' + esc(it.hint) + '</span>' : '') + '</button>';
    }).join('')
  ).join('');
  host.querySelectorAll('.pal-item').forEach(btn =>
    btn.addEventListener('click', () => runPaletteItem(Number(btn.dataset.idx))));
}

function runPaletteItem(idx) {
  const item = _palItems[idx];
  if (!item) return;
  closePalette();
  item.run();
}

function palMove(delta) {
  if (!_palItems.length) return;
  _palActive = (_palActive + delta + _palItems.length) % _palItems.length;
  const host = document.getElementById('palette-list');
  host.querySelectorAll('.pal-item').forEach(b =>
    b.classList.toggle('active', Number(b.dataset.idx) === _palActive));
  host.querySelector('.pal-item.active')?.scrollIntoView({ block: 'nearest' });
}

document.getElementById('palette-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palMove(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palMove(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(_palActive); }
});

// ── Flush pending saves before the window closes ──
// Saves are 300 ms-debounced; on close we cancel the timers and persist
// immediately so a just-made edit can't be lost. Only modules that have been
// loaded are saved (avoids overwriting an unloaded module with an empty array).
async function flushPending() {
  clearTimeout(_saveTimer);
  clearTimeout(_nameSaveTimer);
  clearTimeout(_dayNameTimer);
  clearTimeout(_subSaveTimer);
  clearTimeout(_uiStateSaveTimer);
  clearTimeout(_knowledgeDraftSaveTimer);
  const tasks = [];
  tasks.push(window.api.saveUiState(uiState));
  if (knowledgeDraftCache) tasks.push(window.api.saveKnowledgeDraft(knowledgeDraftCache));
  if (activeDate) {
    // Flush any pending granular work-log saves. persistTimesheet() reports a
    // failure by resolving false (it also toasts), so turn that into a rejection
    // here — otherwise close/logout would go ahead and drop the edits.
    tasks.push(persistTimesheet().then(ok => { if (!ok) throw new Error('Timesheet changes could not be saved'); }));
    tasks.push(window.api.setDayName(activeDate, document.getElementById('hName').value));
  }
  // Both report a failed save by resolving false (after their own toast);
  // a rejection is what makes close/logout stop and offer Retry.
  const mustSave = (promise, what) => promise.then(ok => { if (ok === false) throw new Error(what + ' could not be saved'); });
  if (_clientRenameTimer && currentClient) {   // a client name typed in the last 300 ms
    clearTimeout(_clientRenameTimer); _clientRenameTimer = null;
    tasks.push(saveClientNames(currentClient.id));
  }
  if (subsLoaded)     tasks.push(mustSave(saveSubscriptionsData(), 'Subscriptions'));
  tasks.push(mustSave(flushPfmPending(), 'Offer or CR changes'));
  const results = await Promise.allSettled(tasks);
  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length) {
    const messages = failures.map(r => String(r.reason?.message || r.reason || 'Save failed'));
    throw new Error(messages.join('\n'));
  }
}

async function flushPendingWithRecovery(action, cancelMessage) {
  while (true) {
    try {
      await flushPending();
      return true;
    } catch (error) {
      const choice = await window.api.confirmSaveFailure(String(error?.message || error), action);
      if (choice === 'retry') continue;
      if (choice === 'discard') return true;
      if (cancelMessage) toast(cancelMessage);
      return false;
    }
  }
}

// The Settings catalog draft is edited in memory and only persisted on an
// explicit Save — unlike the debounced saves flushPending() covers, so
// logout (location.reload()) and app close would otherwise silently drop it.
function confirmDiscardSettingsDraft() {
  if (!settingsDirty) return true;
  const msg = 'You have unsaved Settings catalog changes that will be lost. Continue anyway?';
  return confirm(window.ctI18n ? window.ctI18n.t(msg) : msg);
}

let _closeFlowRunning = false;
window.api.onBeforeClose(async () => {
  if (_closeFlowRunning) return;
  // Not signed in (login/setup screen, or the app never booted): there is
  // nothing to save, and every save channel is authed — flushing here used to
  // put up a bogus "Some changes could not be saved: Not authenticated".
  if (!_appBooted) { await window.api.flushComplete(); return; }
  _closeFlowRunning = true;
  try {
    if (!confirmDiscardSettingsDraft()) return;
    const proceed = await flushPendingWithRecovery('close', 'Close cancelled — your unsaved changes are still open.');
    if (proceed) {
      await window.api.flushComplete();
      return;
    }
    await window.api.cancelClose();
  } finally {
    // Always reset, so an unexpected throw can't leave the window unclosable.
    _closeFlowRunning = false;
  }
});

// ── Init ──
async function init() {
  const t = new Date();

  await loadUiStateFromMain();
  await loadKnowledgeDraftFromMain();
  await loadUserPreferencesFromMain();
  // Restore per-module filter state that's read directly off module-scoped
  // variables (Browse kind/slice) BEFORE anything renders them; All Tasks/
  // Clients/Internal Tasks restore inside their own init functions instead,
  // since those rebuild their filter UI from scratch.
  if (uiState.filters.browse && cpState[uiState.filters.browse.kind]) {
    browseKind = uiState.filters.browse.kind;
    if (uiState.filters.browse.selected) cpState[browseKind].selected = uiState.filters.browse.selected;
  }

  try {
    LK = await window.api.loadLookups();
    await refreshProjectIndex();   // names for the Timesheet/Project-task Project field + row pills
    await refreshDayList();
    const today = fmt(t);
    await switchDay(today);
  } catch (err) {
    // Data layer unreachable at startup — keep the shell usable rather than
    // leaving a blank window, and tell the user.
    if (!LK || !LK.categories) LK = { categories: {}, defaultName: '' };
    toast('Could not load data — some views may be empty');
  }

  applyThemeLabel();

  // The shared print/report preview overlay sits inside the Timesheet module in
  // markup. Lift it to <body> so it stays visible when opened from any module
  // (e.g. Reports) — a position:fixed node inside a display:none module renders 0×0.
  const _pov = document.getElementById('print-overlay');
  if (_pov && _pov.parentElement !== document.body) document.body.appendChild(_pov);

  // Milestone 11 — land back where the user left off (Settings -> General's
  // "Start on" toggle), falling back to Analytics if there's no valid saved
  // module (first run, or a module that no longer exists).
  // 'projects' is excluded even though `#module-projects` exists — it's the
  // internal-only single-project detail host (no sidebar entry, see
  // switchModule), never a valid landing page on its own.
  // The retired 'clients-projects' page is folded into 'clients', so a stale
  // saved value lands the returning user on the merged Clients page.
  if (uiState.lastModule === 'clients-projects') uiState.lastModule = 'clients';
  const landingModule = (uiState.startOnLastPage && uiState.lastModule && uiState.lastModule !== 'projects'
    && document.getElementById('module-' + uiState.lastModule) && !isPageHidden(uiState.lastModule))
    ? uiState.lastModule : 'analytics';
  switchModule(landingModule);
  // Clients/Internal Tasks show a list view by default (switching to them via
  // the sidebar always does, even mid-session — see switchModule's own
  // activeModule===name branch) — only the boot-time landing itself restores
  // a previously-open detail, so ordinary navigation isn't affected.
  if (landingModule === 'clients' && uiState.filters.clients && uiState.filters.clients.companyId != null) {
    openClientDetail(uiState.filters.clients.companyId);
  } else if (landingModule === 'internal-tasks' && uiState.filters.internalTasks && uiState.filters.internalTasks.deptId != null) {
    selectDept(uiState.filters.internalTasks.deptId);
  }
}

// ── Auth gate ──
// The app shell is rendered but covered by #auth-overlay until the user
// authenticates. On first run (no accounts yet) the overlay is a one-time setup
// form; otherwise it's a login form. init() (the real app boot, which talks to
// the now-gated data layer) only runs after a successful login/setup.
let _authMode  = 'login';   // 'login' | 'setup' | 'force-change'
let _appBooted = false;
let _currentUser = null;
// Held only long enough to satisfy the "confirm your current password" check
// when finishing a forced password change — never persisted, cleared as soon
// as the change succeeds or the field is reset.
let _pendingForceChangeUser = null;
let _pendingForceChangePassword = '';

async function bootAuth() {
  let status;
  try { status = await window.api.authStatus(); }
  catch { status = { hasUsers: true, authenticated: false }; }
  setAuthMode(status.hasUsers ? 'login' : 'setup');
  document.getElementById('auth-overlay').classList.add('active');
  // A remembered username goes straight in, so the cursor lands on the password.
  const userEl = document.getElementById('auth-username');
  const remembered = _authMode === 'login' ? authRemember.get() : '';
  if (remembered && !userEl.value) userEl.value = remembered;
  setTimeout(() => (userEl.value ? document.getElementById('auth-password') : userEl).focus(), 50);
}

// The last username that logged in, kept only when "Remember my username" is
// ticked. Machine-local (localStorage, like the theme), never the password.
// Every access is guarded: storage can be unavailable and the gate must work.
const authRemember = (() => {
  const KEY = 'ct-last-username';
  const box = document.getElementById('auth-remember');
  const read = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  if (!read()) { try { box.checked = localStorage.getItem(KEY + '-off') !== '1'; } catch { /* default on */ } }
  return {
    get: read,
    save(username) {
      try {
        if (box.checked) { localStorage.setItem(KEY, username); localStorage.removeItem(KEY + '-off'); }
        else { localStorage.removeItem(KEY); localStorage.setItem(KEY + '-off', '1'); }
      } catch { /* storage unavailable: nothing remembered */ }
    },
  };
})();

window.api.appVersion().then(v => {
  if (!v) return;
  // Label and number as separate nodes, so the label translates on its own.
  const el = document.getElementById('auth-version');
  el.replaceChildren(pjMk('span', null, 'Version'), document.createTextNode(' ' + v));
}).catch(() => {});

// Today on the brand side: a large clock, weekday and date, and the Hijri date,
// formatted by Intl in the login language (Western digits in Arabic too,
// matching the rest of the app). Re-rendered on the minute, so it rolls over
// at midnight, and on a language switch. Ticks are skipped while the overlay
// is hidden, so it costs nothing once the app is open.
const authToday = (() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (lang, cal, opts) => new Intl.DateTimeFormat(
    (lang === 'ar' ? 'ar' : 'en-GB') + '-u-ca-' + cal + '-nu-latn', opts);
  function greeting(hour) {
    return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  }
  function render() {
    const now = new Date();
    const lang = window.ctI18n?.getLanguage?.() || 'en';
    const parts = fmt(lang, 'gregory', { hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(now);
    const period = parts.find(p => p.type === 'dayPeriod');
    $('auth-today-time').textContent = parts.filter(p => p.type !== 'dayPeriod').map(p => p.value).join('').trim();
    $('auth-today-period').textContent = period ? period.value : '';
    $('auth-today-clock').dateTime = now.toISOString();
    $('auth-today-weekday').textContent = fmt(lang, 'gregory', { weekday: 'long' }).format(now);
    $('auth-today-date').textContent = fmt(lang, 'gregory', { day: 'numeric', month: 'long', year: 'numeric' }).format(now);
    $('auth-today-hijri').textContent = fmt(lang, 'islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(now);
    if (_authMode === 'login') $('auth-heading').textContent = greeting(now.getHours());
  }
  function tick() {
    if ($('auth-overlay').classList.contains('active')) render();
    setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
  }
  document.addEventListener('ct:languagechange', render);
  render();
  tick();
  return { render, greeting };
})();

// Field helpers: show/hide password, Caps Lock warning, the strength meter
// and the confirm-match tick (setup / forced change only), and Enter on the
// username moving on to the password. Both password fields share the reveal
// toggle, so the confirm field never disagrees with the first.
const authFields = (() => {
  const $ = (id) => document.getElementById(id);
  const reveal = $('auth-reveal');
  const caps = $('auth-caps');
  const pass = $('auth-password'), conf = $('auth-confirm');
  const strength = $('auth-strength'), strengthLabel = $('auth-strength-label');
  const match = $('auth-match');
  const fields = [pass, conf];

  function setRevealed(show) {
    fields.forEach(f => { f.type = show ? 'text' : 'password'; });
    const label = show ? 'Hide password' : 'Show password';
    reveal.setAttribute('aria-pressed', String(show));
    reveal.title = label;
    reveal.setAttribute('aria-label', label);
    reveal.innerHTML = ic(show ? 'eye-off' : 'eye');
  }
  reveal.addEventListener('click', () => { setRevealed(pass.type === 'password'); pass.focus(); });

  const checkCaps = (e) => { if (e.getModifierState) caps.hidden = !e.getModifierState('CapsLock'); };
  fields.forEach(f => {
    f.addEventListener('keydown', checkCaps);
    f.addEventListener('keyup', checkCaps);
    f.addEventListener('blur', () => { caps.hidden = true; });
  });

  // 0 empty · 1 too short · 2 fair · 3 good · 4 strong. Only length is
  // enforced (auth.js: 8+ chars); the rest is guidance.
  function score(v) {
    if (!v) return 0;
    if (v.length < 8) return 1;
    let s = 2;
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(re => re.test(v)).length;
    if (v.length >= 12) s++;
    if (kinds >= 3) s++;
    return Math.min(4, s);
  }
  const LABELS = ['At least 8 characters', 'Too short', 'Fair', 'Good', 'Strong'];
  function update() {
    if (_authMode === 'login') return;
    const level = score(pass.value);
    strength.dataset.level = String(level);
    strengthLabel.textContent = LABELS[level];
    match.hidden = !(conf.value && conf.value === pass.value);
  }
  pass.addEventListener('input', update);
  conf.addEventListener('input', update);
  [$('auth-username'), pass, conf].forEach(f => f.addEventListener('input', () => f.classList.remove('input-error')));

  $('auth-username').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && _authMode === 'login' && e.target.value.trim() && !pass.value) {
      e.preventDefault(); pass.focus();
    }
  });

  return {
    update,
    reset() { setRevealed(false); caps.hidden = true; match.hidden = true; strength.dataset.level = '0'; strengthLabel.textContent = LABELS[0]; },
  };
})();

// Throttle countdown: auth.js answers a locked-out login with "Too many
// attempts. Try again in N seconds." Count that down live and keep the button
// off until it reaches zero. The i18n observer translates each new message.
const authLockout = (() => {
  const RE = /^Too many attempts\. Try again in (\d+) seconds\.$/;
  let timer = 0;
  function stop() { clearInterval(timer); timer = 0; }
  return {
    stop,
    // Returns true when `msg` was a lockout and the countdown took it over.
    start(msg, showErr, btn) {
      const m = RE.exec(msg || '');
      if (!m) return false;
      stop();
      let left = Number(m[1]);
      const paint = () => showErr(`Too many attempts. Try again in ${left} seconds.`);
      btn.disabled = true; paint();
      timer = setInterval(() => {
        left--;
        if (left > 0) { paint(); return; }
        stop(); btn.disabled = false; showErr('');
        document.getElementById('auth-password').focus();
      }, 1000);
      return true;
    },
  };
})();

function setAuthMode(mode) {
  _authMode = mode;
  const setup = mode === 'setup';
  const forceChange = mode === 'force-change';
  const $ = (id) => document.getElementById(id);
  $('auth-heading').textContent = setup ? 'Create your account'
    : forceChange ? 'Choose a new password' : authToday.greeting(new Date().getHours());
  $('auth-sub').textContent = setup
    ? 'This is the first account on this device'
    : forceChange ? 'Your password was set by an administrator. Choose a new one to continue.'
    : 'Log in to continue';
  $('auth-submit-label').textContent = setup ? 'Create account' : forceChange ? 'Change password' : 'Log in';
  $('auth-username-field').style.display = forceChange ? 'none' : '';
  $('auth-confirm-field').style.display = (setup || forceChange) ? '' : 'none';
  $('auth-strength').hidden = !(setup || forceChange);
  $('auth-remember-row').hidden = forceChange;
  $('auth-password-label').textContent = forceChange ? 'New password' : 'Password';
  $('auth-password').setAttribute('autocomplete', (setup || forceChange) ? 'new-password' : 'current-password');
  $('auth-error').textContent = '';
  authFields.update();
}

async function submitAuth(e) {
  e.preventDefault();
  const $ = (id) => document.getElementById(id);
  const userEl = $('auth-username');
  const passEl = $('auth-password');
  const confEl = $('auth-confirm');
  const btn    = $('auth-submit');
  const card   = $('auth-form');
  const showErr = (m) => { $('auth-error').textContent = m || ''; };
  const refuse = () => { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); };
  if (btn.disabled) return;
  [userEl, passEl, confEl].forEach(el => el.classList.remove('input-error'));
  showErr('');

  const forceChange = _authMode === 'force-change';
  const settingPassword = _authMode === 'setup' || forceChange;
  const username = forceChange ? _pendingForceChangeUser.username : userEl.value.trim();
  const password = passEl.value;
  if (!forceChange && !username) { userEl.classList.add('input-error'); userEl.focus(); return; }
  if (!password) { passEl.classList.add('input-error'); passEl.focus(); return; }
  if (settingPassword && password !== confEl.value) {
    confEl.classList.add('input-error'); confEl.focus(); showErr('Passwords do not match.'); refuse(); return;
  }

  btn.disabled = true; btn.classList.add('busy'); btn.setAttribute('aria-busy', 'true');
  let res;
  try {
    if (forceChange) {
      res = await window.api.authUpdateUser(_pendingForceChangeUser.id, {
        username: _pendingForceChangeUser.username,
        password,
        currentPassword: _pendingForceChangePassword,
      });
    } else {
      res = _authMode === 'setup'
        ? await window.api.authSetup(username, password)
        : await window.api.authLogin(username, password);
    }
  } catch { res = { ok: false, error: 'Something went wrong. Please try again.' }; }
  btn.disabled = false; btn.classList.remove('busy'); btn.removeAttribute('aria-busy');

  if (!res || !res.ok) {
    const msg = res && res.error || (forceChange ? 'Could not change password.' : 'Login failed.');
    if (!authLockout.start(msg, showErr, btn)) showErr(msg);
    refuse();
    passEl.classList.add('input-error');
    passEl.select();
    return;
  }

  if (!forceChange) authRemember.save(username);

  if (!forceChange && res.user?.mustChangePassword) {
    _pendingForceChangeUser = res.user;
    _pendingForceChangePassword = password;
    passEl.value = ''; if (confEl) confEl.value = '';
    authFields.reset();
    setAuthMode('force-change');
    setTimeout(() => passEl.focus(), 50);
    return;
  }

  // A short fade before the app appears.
  const overlay = $('auth-overlay');
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    overlay.classList.add('leaving');
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  overlay.classList.remove('active', 'leaving');
  passEl.value = ''; if (confEl) confEl.value = '';
  authFields.reset();
  authLockout.stop();
  _pendingForceChangeUser = null; _pendingForceChangePassword = '';
  await startApp(res.user);
}

async function startApp(user) {
  _currentUser = user || null;
  const username = user?.username || '';
  const role = 'Account';
  const userCard = document.getElementById('sidebar-user');
  const usernameEl = document.getElementById('sidebar-username');
  if (usernameEl) { usernameEl.dataset.userContent = ''; usernameEl.textContent = username; usernameEl.title = username; }
  const avatarEl = document.getElementById('sidebar-user-avatar');
  if (avatarEl) avatarEl.textContent = Array.from(username.trim())[0]?.toUpperCase() || '?';
  const roleEl = document.getElementById('sidebar-role');
  if (roleEl) roleEl.textContent = role;
  if (userCard) {
    const localizedRole = window.ctI18n?.t?.(role) || role;
    userCard.title = username + ' — ' + localizedRole;
    userCard.setAttribute('aria-label',
      window.ctI18n?.t?.('Signed in as {username}, {role}', { username, role: localizedRole })
      || ('Signed in as ' + username + ', ' + role));
  }
  const versionEl = document.getElementById('app-version');
  if (versionEl) {
    try {
      const version = await window.api.appVersion();
      versionEl.textContent = version ? 'Office ONE\nversion ' + version : '';
    } catch { versionEl.textContent = ''; }
  }
  document.querySelectorAll('.admin-only').forEach(el => { el.hidden = false; });
  document.querySelectorAll('.settings-tabs .stab').forEach(el => {
    el.hidden = false;
  });
  if (_appBooted) return;
  _appBooted = true;
  await init();
}

// ── Sidebar account menu ──
// The account row opens a small menu (Settings, View & Comfort, Log Out, the
// version). It is positioned `fixed` from the row's own box, so it also works
// from the collapsed rail, where it opens beside the sidebar instead of above.
function toggleAccountMenu() {
  const menu = document.getElementById('sidebar-account-menu');
  if (!menu) return;
  if (!menu.hidden) { closeAccountMenu(); return; }
  const row = document.getElementById('sidebar-user');
  const box = row.getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl';
  const rail = box.width < 120;
  menu.style.left = menu.style.right = '';
  if (rail) {
    menu.style.bottom = (window.innerHeight - box.bottom) + 'px';
    menu.style.width = '220px';
    if (rtl) menu.style.right = (window.innerWidth - box.left + 8) + 'px';
    else menu.style.left = (box.right + 8) + 'px';
  } else {
    menu.style.bottom = (window.innerHeight - box.top + 6) + 'px';
    menu.style.width = box.width + 'px';
    menu.style.left = box.left + 'px';
  }
  menu.hidden = false;
  row.setAttribute('aria-expanded', 'true');
  menu.querySelector('[role="menuitem"]')?.focus();
}
function closeAccountMenu({ focusRow = false } = {}) {
  const menu = document.getElementById('sidebar-account-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  const row = document.getElementById('sidebar-user');
  row?.setAttribute('aria-expanded', 'false');
  if (focusRow) row?.focus();
}
document.addEventListener('click', e => {
  if (!e.target.closest?.('.sidebar-account')) closeAccountMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAccountMenu({ focusRow: true });
});
window.addEventListener('resize', () => closeAccountMenu());

async function doLogout() {
  if (!confirmDiscardSettingsDraft()) return;
  const proceed = await flushPendingWithRecovery('logout', 'Logout cancelled — your unsaved changes are still open.');
  if (!proceed) return;
  try {
    const result = await window.api.authLogout();
    if (!result?.ok) { toast(result?.error || 'Could not log out.'); return; }
  } catch {
    toast('Could not log out.');
    return;
  }
  location.reload();   // cleanest reset: re-runs the gate against the now-empty session
}

loadWorkspaceViewPrefs();
applyWorkspaceViewPreferences(); // restore renderer-only comfort preferences before app boot
applySidebarPreference(); // restore the user's navigation width before app boot
hydrateIcons();   // swap all static [data-ic] placeholders for inline Lucide SVG
watchAriaLabels(); // mirror every button's title onto aria-label, now and going forward
initSettingsTablistKeyboardNav(); // Arrow/Home/End navigation across the Settings tab strip
watchModalFocusTraps(); // Tab-cycle + initial focus inside every .modal-overlay (Milestone 5)
connectFormLabels(); // associate visible labels with their form controls
document.addEventListener('ct:languagechange', () => {
  if (!_appBooted) return;
  if (activeModule === 'clients') {
    if (currentClient) renderClientDetail(currentClient);
    else if (clientsLoaded) renderClientsList();
  } else if (activeModule === 'timesheet') {
    renderTable();
  } else if (activeModule === 'all-tasks') {
    renderAllTasksStatusChips();
    renderAllTasksCards();
  } else if (activeModule === 'analytics') {
    renderAnalytics();
  } else if (activeModule === 'settings') {
    initSettingsModule();
  }
});
bootAuth();
