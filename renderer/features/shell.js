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
  { icon: 'clock',            label: 'Today — Timesheet', go: 'timesheet' },
  { icon: 'layout-dashboard', label: 'Overview',      go: 'analytics' },
  { icon: 'file-text',        label: 'Reports',       go: 'reports' },
  { icon: 'building-2',       label: 'Browse — Companies', go: 'companies' },
  { icon: 'folder',           label: 'Browse — Systems',   go: 'systems' },
  { icon: 'list',             label: 'Client Tasks',   go: 'all-tasks' },
  { icon: 'building',         label: 'Internal Work',  go: 'internal-tasks' },
  { icon: 'layers',           label: 'Clients',       go: 'clients' },
  { icon: 'credit-card',      label: 'Finance',       go: 'finance' },
  { icon: 'credit-card',      label: 'Subscriptions', go: 'subscriptions' },
  { icon: 'calendar-check',   label: 'Company Documents', go: 'companydocs' },
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
  ...SETTINGS_CATALOG_TABS.map(t => ({ key: t.key, label: t.label })),
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
  if (dateQ) {
    groups.push({ label: 'Jump to date', items: [{
      icon: 'calendar-check', label: 'Open ' + dateQ + ' in the Timesheet',
      run: () => { switchModule('timesheet'); switchDay(dateQ); },
    }]});
  }

  // Pages
  const pages = PAL_PAGES.filter(p => !q || p.label.toLowerCase().includes(q))
    .map(p => ({ icon: p.icon, label: p.label, hint: 'Go to', run: () => switchModule(p.go) }));
  if (pages.length) groups.push({ label: 'Go to', items: pages });

  // Quick actions
  const acts = [
    { icon: 'zap',           label: 'Create something…',            match: 'create new add start hub',              run: openCreateHub },
    { icon: 'eye',           label: 'Workspace view & comfort',     match: 'view comfort density calm focus motion eye appearance', run: openWorkspaceView },
    { icon: 'plus',          label: 'Add record — log work',      match: 'add record log work session new', run: () => { switchModule('timesheet'); openModal(); } },
    { icon: 'list',          label: 'Create client task',         match: 'new client task create',          run: () => runCreateFlow('task') },
    { icon: 'building',      label: 'Create internal task',       match: 'new internal task create department', run: () => runCreateFlow('internal-task') },
    { icon: 'clipboard-list',label: 'New project',                match: 'new project create',              run: () => { switchModule('clients'); openProjectModal(); } },
    { icon: 'book-open',     label: 'New knowledge item',         match: 'new knowledge manual guide article create', run: () => { switchModule('knowledge'); openKnowledgeEditor(); } },
    { icon: 'calendar-check',label: 'Go to today',                match: 'today now current day',           run: () => { switchModule('timesheet'); goToday(); } },
    { icon: 'moon',          label: 'Toggle dark / light theme',  match: 'theme dark light mode toggle',    run: toggleTheme },
    { icon: 'compass',       label: 'How This App Thinks',        match: 'how this app thinks help model cheat sheet', run: openHowThinksOverlay },
    { icon: 'save',          label: 'Back up the database',       match: 'backup database save export',     run: backupDatabase },
    { icon: 'database',      label: 'Full backup to Desktop',     match: 'backup full desktop everything',  run: () => runFullBackup() },
  ].filter(a => !q || a.match.includes(q) || a.label.toLowerCase().includes(q))
   .map(a => ({ icon: a.icon, label: a.label, hint: 'Action', run: a.run }));
  if (acts.length) groups.push({ label: 'Actions', items: acts });

  // Settings tabs (jump straight to a lookup category editor)
  const settingsTabs = q ? PAL_SETTINGS_TABS
    .filter(t => _currentUser?.isAdmin || t.key === 'general' || t.key === 'users')
    .filter(t => t.label.toLowerCase().includes(q) || ('settings ' + t.label.toLowerCase()).includes(q))
    .map(t => ({
      icon: 'settings', label: 'Settings — ' + t.label, hint: 'Go to',
      run: () => { switchModule('settings'); const btn = document.querySelector('.stab[data-tab="' + t.key + '"]'); if (btn) switchTab(btn); },
    })) : [];
  if (settingsTabs.length) groups.push({ label: 'Settings', items: settingsTabs });

  // Client names are lookup catalog entries rather than standalone records, so
  // they remain a tiny in-memory facet alongside the SQLite FTS results.
  const clientHits = q ? lkOptions('COMPANY').filter(c =>
    [c.code, c.nameEn, c.nameAr, c.label].some(v => String(v || '').toLowerCase().includes(q)))
    .slice(0, 5)
    .map(c => ({ icon: 'layers', label: companyDisplayName(c), hint: 'Open client', run: () => { switchModule('clients'); openClientDetail(c.id); } })) : [];
  if (clientHits.length) groups.push({ label: 'Clients', items: clientHits });

  const kindInfo = {
    task: ['layers', 'Log a session'],
    project: ['clipboard-list', 'Open project'],
    knowledge: ['book-open', 'Open Knowledge Hub'],
    'company-document': ['calendar-check', 'Open Company Docs'],
    subscription: ['credit-card', 'Open Subscriptions'],
    'client-auth': ['shield', 'Open client access'],
    'client-server': ['server', 'Open client server'],
    'client-system': ['monitor', 'Open client system'],
    'finance-contract': ['file-text', 'Open contract'],
    'finance-cr': ['file-text', 'Open change request'],
    'finance-invoice': ['credit-card', 'Open invoice'],
    'finance-meeting': ['book-open', 'Open meeting minutes'],
  };
  const workspaceItems = _palWorkspace.map(result => {
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
        } else if (result.kind === 'subscription') {
          switchModule('subscriptions');
          scrollToAndHighlight('[data-sub-id="' + result.id + '"]');
        } else if (result.kind.startsWith('client-')) {
          const companyId = Number(String(result.id).split(':', 1)[0]);
          if (Number.isInteger(companyId) && companyId > 0) {
            switchModule('clients');
            openClientDetail(companyId);
          }
        } else if (result.kind.startsWith('finance-')) {
          // Same composite entity_id convention as the client-* kinds
          // (migration 049), but the leading id is Finance's own client id,
          // not a COMPANY lookup id — the two id spaces are unrelated.
          const clientId = Number(String(result.id).split(':', 1)[0]);
          if (Number.isInteger(clientId) && clientId > 0) {
            switchModule('finance');
            await openFinanceClientDetail(clientId);
            const tab = { 'finance-contract': 'contracts', 'finance-cr': 'crs',
              'finance-invoice': 'invoices', 'finance-meeting': 'minutes' }[result.kind];
            if (tab) setFinanceDetailTab(tab);
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
    tasks.push(persistTimesheet());   // flush any pending granular work-log saves
    tasks.push(window.api.setDayName(activeDate, document.getElementById('hName').value));
  }
  if (subsLoaded)     tasks.push(saveSubscriptionsData());
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
  _closeFlowRunning = true;
  if (!confirmDiscardSettingsDraft()) { _closeFlowRunning = false; return; }
  const proceed = await flushPendingWithRecovery('close', 'Close cancelled — your unsaved changes are still open.');
  if (proceed) {
    await window.api.flushComplete();
    return;
  }
  await window.api.cancelClose();
  _closeFlowRunning = false;
});

// ── Init ──
async function init() {
  const t = new Date();
  calYear  = t.getFullYear();
  calMonth = t.getMonth();

  renderBackupChoiceMenu();
  await loadUiStateFromMain();
  await loadKnowledgeDraftFromMain();
  await loadUserPreferencesFromMain();
  // Restore per-module filter state that's read directly off module-scoped
  // variables (Browse kind/slice) BEFORE anything renders them; All Tasks/
  // Clients/Internal Tasks restore inside their own init functions instead,
  // since those rebuild their filter UI from scratch.
  if (uiState.filters.browse && uiState.filters.browse.kind) {
    browseKind = uiState.filters.browse.kind;
    if (uiState.filters.browse.selected) cpState[browseKind].selected = uiState.filters.browse.selected;
  }

  try {
    LK = await window.api.loadLookups();
    renderFilterChips();
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
  // Browse remains an advanced palette/deep-link destination, but is no longer
  // a primary sidebar page. Carry its last Company/System slice into Tasks so
  // an upgrade never opens on a page with no primary-navigation context.
  if (uiState.lastModule === 'browse') {
    const savedBrowse = uiState.filters.browse || {};
    uiState.filters.allTasks = Object.assign({}, uiState.filters.allTasks || {},
      savedBrowse.kind === 'systems' ? { system: savedBrowse.selected || '' } : { company: savedBrowse.selected || '' });
    uiState.lastModule = 'all-tasks';
  }
  const landingModule = (uiState.startOnLastPage && uiState.lastModule && uiState.lastModule !== 'projects'
    && document.getElementById('module-' + uiState.lastModule)) ? uiState.lastModule : 'analytics';
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
  setTimeout(() => document.getElementById('auth-username').focus(), 50);
}

function setAuthMode(mode) {
  _authMode = mode;
  const setup = mode === 'setup';
  const forceChange = mode === 'force-change';
  document.getElementById('auth-heading').textContent = setup ? 'Create your account'
    : forceChange ? 'Choose a new password' : 'Welcome back';
  document.getElementById('auth-sub').textContent = setup
    ? 'This is the first account on this device'
    : forceChange ? 'Your password was set by an administrator. Choose a new one to continue.'
    : 'Log in to continue';
  document.getElementById('auth-submit').textContent = setup ? 'Create account' : forceChange ? 'Change password' : 'Log in';
  document.getElementById('auth-username-field').style.display = forceChange ? 'none' : '';
  document.getElementById('auth-confirm-field').style.display = (setup || forceChange) ? '' : 'none';
  document.getElementById('auth-password-label').textContent = forceChange ? 'New password' : 'Password';
  document.getElementById('auth-password').setAttribute('autocomplete', (setup || forceChange) ? 'new-password' : 'current-password');
  document.getElementById('auth-error').textContent = '';
}

async function submitAuth(e) {
  e.preventDefault();
  const userEl = document.getElementById('auth-username');
  const passEl = document.getElementById('auth-password');
  const confEl = document.getElementById('auth-confirm');
  const errEl  = document.getElementById('auth-submit');
  const showErr = (m) => { document.getElementById('auth-error').textContent = m || ''; };
  [userEl, passEl, confEl].forEach(el => el.classList.remove('input-error'));
  showErr('');

  const forceChange = _authMode === 'force-change';
  const username = forceChange ? _pendingForceChangeUser.username : userEl.value.trim();
  const password = passEl.value;
  if (!forceChange && !username) { userEl.classList.add('input-error'); userEl.focus(); return; }
  if (!password) { passEl.classList.add('input-error'); passEl.focus(); return; }
  if ((_authMode === 'setup' || forceChange) && password !== confEl.value) {
    confEl.classList.add('input-error'); confEl.focus(); showErr('Passwords do not match.'); return;
  }

  errEl.disabled = true;
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
  errEl.disabled = false;

  if (!res || !res.ok) {
    showErr(res && res.error || (forceChange ? 'Could not change password.' : 'Login failed.'));
    passEl.select();
    return;
  }

  if (!forceChange && res.user?.mustChangePassword) {
    _pendingForceChangeUser = res.user;
    _pendingForceChangePassword = password;
    passEl.value = ''; if (confEl) confEl.value = '';
    setAuthMode('force-change');
    setTimeout(() => document.getElementById('auth-password').focus(), 50);
    return;
  }

  document.getElementById('auth-overlay').classList.remove('active');
  passEl.value = ''; if (confEl) confEl.value = '';
  _pendingForceChangeUser = null; _pendingForceChangePassword = '';
  await startApp(res.user);
}

async function startApp(user) {
  _currentUser = user || null;
  const username = user?.username || '';
  const role = user?.isAdmin ? 'Administrator' : 'Standard User';
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
  document.querySelectorAll('.admin-only').forEach(el => { el.hidden = !user?.isAdmin; });
  document.querySelectorAll('.settings-tabs .stab').forEach(el => {
    if (el.dataset.tab !== 'general' && el.dataset.tab !== 'users') el.hidden = !user?.isAdmin;
  });
  if (_appBooted) return;
  _appBooted = true;
  await init();
}

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
