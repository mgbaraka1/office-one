'use strict';

// Real Electron smoke: launches the app against a disposable data directory,
// drives the isolated renderer over the Chromium DevTools protocol, completes
// first-run setup, crosses preload IPC, and exercises the FTS-backed palette.
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const electron = require('electron');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cooperation-tools-e2e-'));
let child;
let socket;
let nextId = 0;
const pending = new Map();

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForTarget(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      const page = targets.find(target => target.type === 'page' && target.url.startsWith('file:'));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Electron renderer did not expose a DevTools target');
}

function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result?.value;
}

async function waitUntil(expression, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function run() {
  const port = await freePort();
  const electronEnv = { ...process.env };
  // Codex/CI hosts may run Node tooling through Electron and export this flag
  // globally. Passing it to the child makes electron.exe behave like Node, so
  // no BrowserWindow or DevTools target can ever appear.
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  const pdfPath = path.join(root, 'e2e-exported-report.pdf');
  const xlsxPath = path.join(root, 'e2e-exported-timesheet.xlsx');
  child = spawn(electron, ['.'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...electronEnv,
      COOPERATION_TOOLS_DATA_DIR: root,
      COOPERATION_TOOLS_E2E_PORT: String(port),
      COOPERATION_TOOLS_E2E_PDF_PATH: pdfPath,
      COOPERATION_TOOLS_E2E_XLSX_PATH: xlsxPath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.once('exit', code => {
    if (code && pending.size) {
      for (const { reject } of pending.values()) reject(new Error(`Electron exited ${code}\n${output}`));
      pending.clear();
    }
  });

  const target = await waitForTarget(port);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  await command('Runtime.enable');

  await waitUntil(
    `document.readyState === 'complete' && document.getElementById('auth-overlay')?.classList.contains('active')`,
    'First-run authentication screen did not appear',
  );
  const mode = await evaluate(`_authMode`);
  if (mode !== 'setup') throw new Error(`Expected first-run setup, got ${mode}`);

  const loginLanguage = await evaluate(`(() => {
    chooseLoginLanguage('ar');
    return {
      language: document.documentElement.lang,
      direction: document.documentElement.dir,
      heading: document.getElementById('auth-heading').textContent,
      usernameLabel: document.querySelector('label[for="auth-username"]').textContent,
      selected: document.querySelector('.auth-language [data-language="ar"]').classList.contains('active')
    };
  })()`);
  if (loginLanguage.language !== 'ar' || loginLanguage.direction !== 'rtl' ||
      loginLanguage.heading !== 'أنشئ حسابك' || loginLanguage.usernameLabel !== 'اسم المستخدم' ||
      !loginLanguage.selected) {
    throw new Error(`Login language selector failed: ${JSON.stringify(loginLanguage)}`);
  }

  await evaluate(`(() => {
    document.getElementById('auth-username').value = 'e2e-admin';
    document.getElementById('auth-password').value = 'StrongPass123!';
    document.getElementById('auth-confirm').value = 'StrongPass123!';
    document.getElementById('auth-form').requestSubmit();
    return true;
  })()`);
  await waitUntil(
    `document.getElementById('sidebar-username')?.textContent === 'e2e-admin' && !document.getElementById('auth-overlay').classList.contains('active')`,
    'First-run setup did not enter the application',
  );

  const result = await evaluate(`(async () => {
    const catalog = await window.api.loadLookups();
    await window.api.saveLookups({ categories: { COMPANY: [
      ...(catalog.categories.COMPANY || []),
      { code: 'E2E_CLIENT', label: 'E2E Client', nameEn: 'E2E Client', nameAr: 'عميل الاختبار', isActive: true }
    ] } });
    LK = await window.api.loadLookups();
    const profile = LK.categories.COMPANY.find(item => item.code === 'E2E_CLIENT');
    const linkedTask = await window.api.createTask({
      name: 'E2E bilingual client task', status: 'IN_PROGRESS', company: 'E2E_CLIENT', system: '', source: ''
    });
    const created = await window.api.createKnowledgeItem({
      title: 'Electron E2E searchable handbook',
      status: 'PUBLISHED',
      summary: 'Chromium bridge verification'
    });
    const hits = await window.api.searchWorkspace('searchable handbook', 10);
    openPalette();
    document.getElementById('palette-input').value = 'searchable handbook';
    paletteInputChanged();
    await new Promise(resolve => setTimeout(resolve, 350));
    return {
      createdId: created.id,
      hit: hits.some(item => item.kind === 'knowledge' && item.id === created.id),
      paletteVisible: document.getElementById('palette-overlay').classList.contains('open'),
      paletteText: document.getElementById('palette-list').textContent,
      rendererModules: typeof openKnowledgeDetail === 'function' && typeof renderTable === 'function',
      knowledgeSanitize: (() => {
        const dangerous = sanitizeKnowledgeHtml(
          '<script>alert(1)</script><p onclick="alert(2)">hi</p><img src="x" onerror="alert(3)">' +
          '<a href="javascript:alert(4)">bad link</a><span style="color:red">styled</span>'
        );
        const safe = sanitizeKnowledgeHtml('<h1>Title</h1><p>Hello <strong>world</strong></p><a href="https://example.com">link</a><ul><li>item</li></ul>');
        return {
          stripsScript: !dangerous.includes('<script'),
          stripsEventHandlers: !dangerous.includes('onclick') && !dangerous.includes('onerror'),
          stripsImg: !dangerous.includes('<img'),
          stripsJsUrl: !dangerous.includes('javascript:'),
          stripsStyleAttr: !dangerous.includes('style='),
          keepsPlainText: dangerous.includes('hi') && dangerous.includes('styled'),
          allowsSafeMarkup: safe.includes('<h1>Title</h1>') && safe.includes('<strong>world</strong>')
            && safe.includes('<a href="https://example.com">link</a>') && safe.includes('<li>item</li>'),
        };
      })(),
      version: await window.api.appVersion(),
      accessibility: (() => {
        const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
        const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
        const unnamedButtons = [...document.querySelectorAll('button')].filter(button =>
          !String(button.getAttribute('aria-label') || button.title || button.textContent || '').trim());
        return {
          duplicateIds: [...new Set(duplicates)],
          unnamedButtons: unnamedButtons.map(button => button.id || button.className || '(anonymous)'),
          language: document.documentElement.lang,
          direction: document.documentElement.dir,
          liveRegions: document.querySelectorAll('[aria-live], [role="status"]').length,
        };
      })(),
      clientProfile: {
        code: profile?.code, nameEn: profile?.nameEn, nameAr: profile?.nameAr,
        visible: companyDisplayName(profile), taskCode: linkedTask?.companyCode,
        taskNameAr: linkedTask?.companyNameAr
      },
      localization: await (async () => {
        await window.api.saveUiState(uiState);
        const saved = await window.api.getUiState();
        const dailyReport = buildDailyReportHTML([], '2026-08-02', 'e2e-admin', new Map());
        const overtimeReport = buildOvertimeReportHTML([], 'أغسطس ٢٠٢٦', 'e2e-admin');
        const subscriptionsReport = buildSubscriptionsReportHTML([], 'SAR', 'e2e-admin');
        const reportDocument = buildReportDoc(dailyReport, 'Report');
        switchModule('settings');
        await new Promise(resolve => setTimeout(resolve, 100));
        const statusPanel = document.getElementById('tab-status');
        const openRow = [...(statusPanel?.querySelectorAll('.bilingual-lookup-item') || [])].find(row =>
          row.querySelector('input[dir="ltr"]')?.value === 'Open');
        const bilingualCatalog = !!openRow
          && openRow.querySelector('input[dir="rtl"]')?.value === 'مفتوحة'
          && statusPanel.textContent.includes('التسمية بالإنجليزية')
          && statusPanel.textContent.includes('التسمية بالعربية');
        const settingsLocalized = document.getElementById('settings-search')?.placeholder === 'البحث عن إعداد…'
          && document.getElementById('settings-save-btn')?.textContent === 'حفظ تغييرات الكتالوج';
        // Settings has no Companies tab — the client roster IS the COMPANY
        // catalog and is managed on the Clients page instead, so neither the
        // tab button nor its panel may exist, and the palette must not offer it.
        const noCompaniesSettingsTab = !document.querySelector('.stab[data-tab="companies"]')
          && !document.getElementById('tab-companies')
          && !PAL_SETTINGS_TABS.some(t => t.key === 'companies');
        // Reordering (Phase 4, S6): the up/down buttons swap two catalog rows'
        // positions in the draft, which is otherwise invisible until a full
        // save+reload — read the ordered English-label inputs before/after
        // clicking "Open"'s move-down button.
        const reorderBefore = [...statusPanel.querySelectorAll('.bilingual-lookup-item input[dir="ltr"]')].map(i => i.value);
        // buildReorderControls() always appends [up, down] in that order —
        // not selected by title, which the i18n observer translates at
        // runtime (this whole block runs while the UI language is Arabic).
        const openRowDown = openRow?.querySelectorAll('.lookup-item-reorder-btn')[1];
        openRowDown?.click();
        const reorderAfter = [...statusPanel.querySelectorAll('.bilingual-lookup-item input[dir="ltr"]')].map(i => i.value);
        const openIndexBefore = reorderBefore.indexOf('Open');
        const reorderWorks = openIndexBefore >= 0 && openIndexBefore < reorderBefore.length - 1
          && reorderAfter[openIndexBefore] === reorderBefore[openIndexBefore + 1]
          && reorderAfter[openIndexBefore + 1] === 'Open';
        // Settings search (Phase 4, S9): a term that only matches a control
        // inside another tab (not any tab's own name) should jump there and
        // flash the matched button — not just silently filter the tab list.
        // "integrity" is a Maintenance-only control term; "backup" would now
        // also match the Backup Data tab's own label, which is a different path.
        const searchInput = document.getElementById('settings-search');
        searchInput.value = 'integrity';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        const searchJumpWorks = document.querySelector('.stab[data-tab="maintenance"]')?.classList.contains('active')
          && document.querySelector('#tab-maintenance button[data-onclick="runMaintenanceIntegrityCheck()"]')?.classList.contains('deep-link-highlight');
        searchInput.value = ''; searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        // Tablist keyboard navigation (Phase 5, S8): ArrowDown from a focused
        // tab moves focus to AND activates the next visible tab — the
        // standard WAI-ARIA tablist pattern.
        const generalTab = document.querySelector('.stab[data-tab="general"]');
        switchTab(generalTab);
        generalTab.focus();
        generalTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        const usersTab = document.querySelector('.stab[data-tab="users"]');
        const arrowNavWorks = document.activeElement === usersTab
          && usersTab.classList.contains('active')
          && usersTab.getAttribute('aria-selected') === 'true'
          && generalTab.getAttribute('aria-selected') === 'false'
          && generalTab.tabIndex === -1 && usersTab.tabIndex === 0;
        // Remembering the last-used Settings tab (Phase 5, S10): switching
        // tabs persists through the same per-account uiState save/load path
        // other module filters already use — no new IPC surface, so this
        // proves the round trip actually reaches the DB and back.
        const systemsTab = document.querySelector('.stab[data-tab="systems"]');
        switchTab(systemsTab);
        await new Promise(resolve => setTimeout(resolve, 400)); // clear saveUiStateDebounced()'s 300ms timer
        const reloadedUiState = await window.api.getUiState();
        const rememberedTabWorks = reloadedUiState?.filters?.settings?.tab === 'systems';
        const arabic = {
          language: document.documentElement.lang,
          direction: document.documentElement.dir,
          overview: document.querySelector('[data-module="analytics"] .nav-label')?.textContent,
          userContentPreserved: document.getElementById('palette-list').textContent.includes('Electron E2E searchable handbook'),
          legacyPreferenceRemoved: saved.language == null,
          reportsLocalized: dailyReport.includes('تقرير العمل اليومي') &&
            overtimeReport.includes('طلب وقت إضافي') && subscriptionsReport.includes('تقرير الاشتراكات'),
          reportDocumentRtl: reportDocument.includes('<html lang="ar" dir="rtl">'),
          settingsLocalized,
          bilingualCatalog,
          reorderWorks,
          searchJumpWorks,
          arrowNavWorks,
          rememberedTabWorks,
          noCompaniesSettingsTab
        };
        chooseLoginLanguage('en');
        arabic.loginLanguageLocked = document.documentElement.lang === 'ar';
        arabic.noAuthenticatedLanguageControls = !document.getElementById('language-toggle')
          && !document.getElementById('setting-language-ctl');
        return arabic;
      })(),
      clientRoster: await (async () => {
        // The Clients page owns the COMPANY catalog now, so the create /
        // rename / archive flow is driven through the page's real DOM and its
        // real handler functions — not by calling window.api directly, which
        // would prove only that the IPC works and nothing about the UI.
        switchModule('clients');
        await new Promise(resolve => setTimeout(resolve, 150));

        const code = 'E2E_ROSTER_' + Date.now();
        openClientCreateModal();
        const modalOpen = document.getElementById('client-create-modal-overlay').classList.contains('open');
        // Type into the code field through its real input handler, so the
        // upper-case/space-stripping normalization is exercised too.
        const codeInput = document.getElementById('cl-new-code');
        codeInput.value = code.toLowerCase() + ' x';
        normalizeClientCodeInput(codeInput);
        const codeNormalized = codeInput.value === code + '_X';
        codeInput.value = code;
        document.getElementById('cl-new-name-en').value = 'E2E Roster Client';
        document.getElementById('cl-new-name-ar').value = 'عميل الاختبار الآلي';
        await submitClientCreateModal();
        await new Promise(resolve => setTimeout(resolve, 250));

        const created = (await window.api.listClients()).find(c => c.code === code);
        const detailOpen = currentClient?.id === created?.id;

        // The identity editor: names are inputs, the code is not — and it is
        // shown in Arabic, since this whole block runs with the UI in Arabic.
        const identity = document.querySelector('#clients-detail-view .client-profile-summary');
        const identityLocalized = !!identity && identity.textContent.includes('رمز الشركة')
          && identity.textContent.includes('الاسم بالإنجليزية')
          && identity.textContent.includes('الاسم بالعربية');
        const codeIsNotEditable = !!document.querySelector('#clients-detail-view .cl-identity-locked b')
          && document.querySelectorAll('#clients-detail-view input.cl-identity-input').length === 2
          && ![...document.querySelectorAll('#clients-detail-view input')]
            .some(input => input.value === code);

        // Rename through the real debounced input handler.
        const enInput = document.getElementById('cl-identity-name-en');
        enInput.value = 'E2E Roster Renamed';
        enInput.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 500)); // 300ms debounce + the write
        const afterRename = (await window.api.listClients()).find(c => c.id === created?.id);

        // Archive, then restore, through the page's own handler.
        await setClientArchived(created.id, false, { silent: true });
        const goneFromRoster = !(await window.api.listClients()).some(c => c.id === created.id);
        const visibleWhenArchivedShown = (await window.api.listClients(true))
          .some(c => c.id === created.id && c.isActive === false);
        await setClientArchived(created.id, true, { silent: true });
        const backInRoster = (await window.api.listClients()).some(c => c.id === created.id);

        switchModule('analytics');
        return {
          modalOpen, codeNormalized, detailOpen, identityLocalized, codeIsNotEditable,
          createdCode: created?.code,
          renamedTo: afterRename?.nameEn, codeAfterRename: afterRename?.code,
          goneFromRoster, visibleWhenArchivedShown, backInRoster,
        };
      })(),
      passwordRotation: await (async () => {
        // Forced password rotation: an
        // admin-created account carries an admin-assigned password, so login
        // must force its owner to replace it before the app becomes usable.
        // Drives the real IPC bridge AND the actual login-overlay DOM/function
        // the real form uses (not a re-implementation of it), then restores
        // the e2e-admin session the rest of this script assumes.
        const created = await window.api.authAddUser('e2e-rotate', 'TempPass123!', false);
        const ipcFlagsCreation = created.ok && created.user.mustChangePassword === true;
        const loginResult = await window.api.authLogin('e2e-rotate', 'TempPass123!');
        const ipcFlagsLogin = loginResult.ok && loginResult.user.mustChangePassword === true;

        _pendingForceChangeUser = loginResult.user;
        _pendingForceChangePassword = 'TempPass123!';
        setAuthMode('force-change');
        const domState = {
          usernameFieldHidden: document.getElementById('auth-username-field').style.display === 'none',
          confirmFieldVisible: document.getElementById('auth-confirm-field').style.display !== 'none',
          passwordLabel: document.getElementById('auth-password-label').textContent,
          submitLabel: document.getElementById('auth-submit').textContent,
        };
        document.getElementById('auth-password').value = 'MyOwnChoice456!';
        document.getElementById('auth-confirm').value = 'MyOwnChoice456!';
        await submitAuth({ preventDefault() {} });
        const clearedAfterChange = _pendingForceChangeUser === null;

        await window.api.authLogout();
        const reLogin = await window.api.authLogin('e2e-rotate', 'MyOwnChoice456!');
        const flagClearedServerSide = reLogin.ok && reLogin.user.mustChangePassword === false;

        await window.api.authLogout();
        const restored = await window.api.authLogin('e2e-admin', 'StrongPass123!');
        setAuthMode('login');
        await startApp(restored.user); // re-sync sidebar/admin-only DOM back to e2e-admin
        return {
          ipcFlagsCreation, ipcFlagsLogin, domState, clearedAfterChange,
          flagClearedServerSide, restoredAdminSession: restored.ok && _currentUser?.username === 'e2e-admin',
        };
      })()
    };
  })()`);

  if (!result.hit) throw new Error('FTS result did not cross the preload bridge');
  if (!result.paletteVisible || !result.paletteText.includes('Electron E2E searchable handbook')) {
    throw new Error('Quick Find did not render the indexed result');
  }
  if (!result.rendererModules) throw new Error('Extracted renderer modules did not load in classic-script order');
  const sanitize = result.knowledgeSanitize;
  if (!sanitize.stripsScript || !sanitize.stripsEventHandlers || !sanitize.stripsImg || !sanitize.stripsJsUrl ||
      !sanitize.stripsStyleAttr || !sanitize.keepsPlainText || !sanitize.allowsSafeMarkup) {
    throw new Error(`Knowledge Hub HTML sanitizer failed: ${JSON.stringify(sanitize)}`);
  }
  if (!result.version) throw new Error('Application version IPC returned no value');
  if (result.accessibility.duplicateIds.length || result.accessibility.unnamedButtons.length ||
      !result.accessibility.language || !result.accessibility.direction || result.accessibility.liveRegions < 1) {
    throw new Error(`Runtime accessibility invariants failed: ${JSON.stringify(result.accessibility)}`);
  }
  if (result.clientProfile.code !== 'E2E_CLIENT' || result.clientProfile.nameEn !== 'E2E Client' ||
      result.clientProfile.nameAr !== 'عميل الاختبار' || !result.clientProfile.visible.includes('عميل الاختبار') ||
      result.clientProfile.taskCode !== 'E2E_CLIENT' || result.clientProfile.taskNameAr !== 'عميل الاختبار') {
    throw new Error(`Bilingual client profile failed: ${JSON.stringify(result.clientProfile)}`);
  }
  if (result.localization.language !== 'ar' || result.localization.direction !== 'rtl' ||
      result.localization.overview !== 'نظرة عامة' || !result.localization.legacyPreferenceRemoved ||
      !result.localization.userContentPreserved || !result.localization.reportsLocalized ||
      !result.localization.reportDocumentRtl || !result.localization.settingsLocalized || !result.localization.bilingualCatalog ||
      !result.localization.loginLanguageLocked || !result.localization.noAuthenticatedLanguageControls) {
    throw new Error(`Arabic localization failed: ${JSON.stringify(result.localization)}`);
  }
  if (!result.localization.reorderWorks) throw new Error('Settings catalog reorder (move down) did not swap rows');
  if (!result.localization.searchJumpWorks) throw new Error('Settings search did not jump to and highlight a matched control');
  if (!result.localization.arrowNavWorks) throw new Error('Settings tablist ArrowDown did not move focus and activate the next tab');
  if (!result.localization.rememberedTabWorks) throw new Error('The last-used Settings tab was not persisted to the per-account ui_state');
  if (!result.localization.noCompaniesSettingsTab) {
    throw new Error('Settings still exposes a Companies tab — the Clients page owns the client roster');
  }

  // The Clients page owns the COMPANY catalog: create, rename, archive and
  // restore all have to work from that page, and the company code has to be
  // unreachable once set.
  const roster = result.clientRoster;
  if (!roster.modalOpen) throw new Error('New Client modal did not open');
  if (!roster.codeNormalized) throw new Error(`Company code input did not normalize: ${JSON.stringify(roster)}`);
  if (!roster.createdCode) throw new Error(`New Client was not created: ${JSON.stringify(roster)}`);
  if (!roster.detailOpen) throw new Error('Creating a client did not open its detail page');
  if (!roster.identityLocalized) throw new Error('The client identity editor is not localized into Arabic');
  if (!roster.codeIsNotEditable) {
    throw new Error(`The company code is editable on the Clients page: ${JSON.stringify(roster)}`);
  }
  if (roster.renamedTo !== 'E2E Roster Renamed') {
    throw new Error(`Inline client rename did not persist: ${JSON.stringify(roster)}`);
  }
  if (roster.codeAfterRename !== roster.createdCode) {
    throw new Error(`A rename changed the company code: ${JSON.stringify(roster)}`);
  }
  if (!roster.goneFromRoster || !roster.visibleWhenArchivedShown || !roster.backInRoster) {
    throw new Error(`Client archive/restore round trip failed: ${JSON.stringify(roster)}`);
  }

  const rotation = result.passwordRotation;
  if (!rotation.ipcFlagsCreation) throw new Error('An admin-created account was not flagged to change its password on next login');
  if (!rotation.ipcFlagsLogin) throw new Error('Login did not surface the must-change-password flag over the real IPC bridge');
  if (!rotation.domState.usernameFieldHidden || !rotation.domState.confirmFieldVisible ||
      rotation.domState.passwordLabel !== 'New password' || rotation.domState.submitLabel !== 'Change password') {
    throw new Error(`Forced password-change screen did not render correctly: ${JSON.stringify(rotation.domState)}`);
  }
  if (!rotation.clearedAfterChange) throw new Error('The forced-change screen did not clear its pending state after a successful change');
  if (!rotation.flagClearedServerSide) throw new Error('Choosing a new password did not clear must_change_password server-side');
  if (!rotation.restoredAdminSession) throw new Error('Could not restore the e2e-admin session after the rotation check');

  // PDF export (Finding 20, full-app audit) — report:exportPDF is otherwise
  // only checked by string-presence tests; this drives the real IPC path
  // (offscreen BrowserWindow -> Chromium printToPDF -> fs.writeFileSync) and
  // verifies actual output bytes, not just that the handler was called.
  const pdfExport = await evaluate(`(async () => {
    const html = buildReportDoc(buildDailyReportHTML([], '2026-08-02', 'e2e-admin', new Map()), 'Report');
    return await window.api.exportPDF(html, 'e2e-test.pdf');
  })()`);
  if (!pdfExport?.ok) throw new Error(`report:exportPDF did not report success: ${JSON.stringify(pdfExport)}`);
  const pdfBytes = fs.readFileSync(pdfPath);
  if (pdfBytes.length < 1000) throw new Error(`Exported PDF is suspiciously small (${pdfBytes.length} bytes)`);
  if (pdfBytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error(`Exported file does not start with the %PDF- magic bytes: ${pdfBytes.subarray(0, 8)}`);
  }

  const excelExport = await evaluate(`window.api.exportExcel({
    title: 'Weekly Work Report', employee: 'e2e-admin', period: '3–9 August 2026', activeDays: 1,
    rows: [{ date: '2026-08-03', company: 'E2E Client', container: 'E2E System', task: 'E2E Task',
      time: 'Work Time', timeCode: 'WORK_TIME', activity: 'Task', description: 'E2E session',
      minutes: 60, hours: 1, sources: '' }]
  }, 'e2e-test.xlsx')`);
  if (!excelExport?.ok) throw new Error(`report:exportExcel did not report success: ${JSON.stringify(excelExport)}`);
  const xlsxBytes = fs.readFileSync(xlsxPath);
  if (xlsxBytes.length < 5000 || xlsxBytes.readUInt32LE(0) !== 0x04034B50) {
    throw new Error(`Exported Excel workbook is invalid or suspiciously small (${xlsxBytes.length} bytes)`);
  }

  const screenshotPath = process.env.COOPERATION_TOOLS_E2E_SCREENSHOT;
  if (screenshotPath) {
    await evaluate(`closePalette(); true`);
    await command('Page.enable');
    const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.resolve(screenshotPath), Buffer.from(capture.data, 'base64'));
  }

  console.log(`PASS  Electron launched with isolated data at ${root}`);
  console.log('PASS  First-run account setup completed through the real renderer');
  console.log('PASS  Login language selector controls the setup and authenticated session language');
  console.log('PASS  Authenticated pages expose no language switch and cannot override the login choice');
  console.log('PASS  Context-isolated preload IPC created and searched a knowledge item');
  console.log('PASS  Knowledge Hub HTML sanitizer strips scripts/handlers/img/js-urls/style while keeping the safe subset');
  console.log('PASS  Quick Find rendered the FTS result');
  console.log('PASS  Client profile code and English/Arabic names flow into a linked task');
  console.log('PASS  Arabic login choice drives RTL, preserves user content, and localizes report/PDF output');
  console.log('PASS  Settings chrome and its dynamically built catalog controls are localized');
  console.log('PASS  Managed Settings catalogs expose and render English/Arabic labels');
  console.log('PASS  Settings catalog rows can be reordered with the move up/down controls');
  console.log('PASS  Settings search jumps to and highlights a matched control outside the active tab');
  console.log('PASS  Settings tab strip supports standard tablist arrow-key navigation');
  console.log('PASS  The last-used Settings tab is remembered per account across a reload');
  console.log('PASS  Settings exposes no Companies tab — the Clients page owns the roster');
  console.log('PASS  A client is created from the Clients page, with a normalized company code');
  console.log('PASS  The client identity editor is localized and keeps the company code read-only');
  console.log('PASS  An inline client rename persists without touching the company code');
  console.log('PASS  A client survives an archive/restore round trip from the Clients page');
  console.log('PASS  An admin-created account is forced to replace its admin-assigned password on next login');
  console.log('PASS  Runtime accessibility invariants cover names, unique ids, language/direction, and live regions');
  console.log(`PASS  report:exportPDF produces a real PDF file (${pdfBytes.length} bytes)`);
  console.log(`PASS  report:exportExcel produces a real XLSX workbook (${xlsxBytes.length} bytes)`);
  console.log(`PASS  Extracted renderer modules loaded (app v${result.version})`);
}

run().catch(error => {
  console.error('FAIL  Electron E2E smoke');
  console.error(error.stack || String(error));
  process.exitCode = 1;
}).finally(async () => {
  try { socket?.close(); } catch {}
  if (child && child.exitCode == null) {
    child.kill();
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
  }
  fs.rmSync(root, { recursive: true, force: true });
});
