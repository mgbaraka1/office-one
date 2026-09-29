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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-one-e2e-'));
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
  const xlsxPath = path.join(root, 'e2e-exported-office-one.xlsx');
  const pfmXlsxPath = path.join(root, 'e2e-exported-offers.xlsx');
  const outsXlsxPath = path.join(root, 'e2e-exported-statement.xlsx');
  // Project & Finance "Add files": two good files and one whose bytes do not
  // match its extension, handed to pfm:files-add in place of the open dialog.
  const pfmFiles = [
    ['e2e-offer.pdf', '%PDF-1.4\n% generic e2e offer\n%%EOF\n'],
    ['e2e-notes.txt', 'Generic e2e notes.\n'],
    ['e2e-fake.png', 'not really a png'],
  ].map(([name, body]) => { const p = path.join(root, name); fs.writeFileSync(p, body); return p; });
  child = spawn(electron, ['.'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...electronEnv,
      OFFICE_ONE_DATA_DIR: root,
      OFFICE_ONE_E2E_PORT: String(port),
      OFFICE_ONE_E2E_PDF_PATH: pdfPath,
      OFFICE_ONE_E2E_XLSX_PATH: xlsxPath,
      OFFICE_ONE_E2E_PFM_FILES: pfmFiles.join(path.delimiter),
      OFFICE_ONE_E2E_PFM_XLSX_PATH: pfmXlsxPath,
      OFFICE_ONE_E2E_OUTS_XLSX_PATH: outsXlsxPath,
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
    // Knowledge Hub is found by client (migration 068): link, search by the Arabic
    // client name, then filter the real list by that client.
    const linkedDoc = await window.api.createKnowledgeItem({ title: 'E2E client mapping sheet', status: 'PUBLISHED', companyIds: [profile.id] });
    const unlinkedDoc = await window.api.createKnowledgeItem({ title: 'E2E unrelated manual', status: 'PUBLISHED' });
    const clientHits = await window.api.searchWorkspace('عميل الاختبار', 10);
    switchModule('knowledge');
    await loadKnowledgeItems();
    knowledgeFilters.clear(); knowledgeFilters.add('CLIENT:' + profile.id); renderKnowledgeList();
    const listedIds = [...document.querySelectorAll('#kh-list [data-knowledge-id]')].map(row => Number(row.dataset.knowledgeId));
    const knowledgeClientFilter = {
      linked: linkedDoc.companies?.[0]?.id === profile.id,
      searched: clientHits.some(item => item.kind === 'knowledge' && item.id === linkedDoc.id),
      facet: !!document.querySelector('#kh-filters [data-filter-id="clients"]'),
      filtered: listedIds.includes(linkedDoc.id) && !listedIds.includes(unlinkedDoc.id),
    };
    knowledgeFilters.clear(); renderKnowledgeList();
    openKnowledgeEditor(knowledgeItems.find(item => item.id === linkedDoc.id));
    knowledgeClientFilter.editorPill = document.querySelector('#kh-companies .tp-pill')?.textContent.includes('E2E_CLIENT') || false;
    closeKnowledgeEditor(true);
    openPalette();
    document.getElementById('palette-input').value = 'searchable handbook';
    paletteInputChanged();
    await new Promise(resolve => setTimeout(resolve, 350));
    return {
      createdId: created.id,
      hit: hits.some(item => item.kind === 'knowledge' && item.id === created.id),
      knowledgeClientFilter,
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
      pfm: await (async () => {
        // Project & Finance, driven through the page's real DOM and handlers:
        // create an offer from the modal, move its status with the header
        // button + stage modal, refuse a duplicate reference, then delete and undo.
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        switchModule('pfm');
        await wait(200);
        const client = (await window.api.listClients())[0];
        const ref = 'E2E-OFF-' + Date.now();

        openPfmNew('OFFER');
        const modalOpen = document.getElementById('pfm-modal-overlay').classList.contains('open');
        document.getElementById('pfm-reference').value = ref;
        document.getElementById('pfm-title').value = 'E2E generic offer';
        document.getElementById('pfm-company').value = String(client.id);
        document.getElementById('pfm-first-member').value = 'E2E Person';
        await submitPfmModal();
        await wait(250);
        const created = pfmCurrent;
        const detailOpen = created?.reference === ref && document.getElementById('pfm-detail-view').style.display !== 'none';
        const startStatus = created?.status;
        const trackSteps = document.querySelectorAll('#pfm-detail-view .pfm-step').length;

        document.querySelector('#pfm-detail-view .pfm-detail-actions .btn.primary').click();
        const stageModalOpen = document.getElementById('pfm-stage-overlay').classList.contains('open');
        document.getElementById('pfm-stage-member').value = 'E2E Person Two';
        await submitPfmStageModal();
        await wait(250);
        const movedStatus = pfmCurrent?.status;
        const movedStage = (pfmCurrent?.stages || []).find(s => s.status === movedStatus);

        const contact = document.getElementById('pfm-contact-name');
        contact.value = 'E2E Contact';
        contact.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(600);
        const contactSaved = (await window.api.getPfmItem(created.id))?.contactName === 'E2E Contact';

        const channelSel = document.getElementById('pfm-channel');
        channelSel.value = 'JIRA';
        channelSel.dispatchEvent(new Event('change', { bubbles: true }));
        const channelRef = document.getElementById('pfm-channel-ref');
        channelRef.value = 'https://jira.example.test/browse/E2E-1';
        channelRef.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(600);
        const savedChannel = await window.api.getPfmItem(created.id);
        const channelSaved = savedChannel?.channel === 'JIRA'
          && savedChannel?.channelRef === 'https://jira.example.test/browse/E2E-1'
          && !document.getElementById('pfm-channel-ref').closest('.form-group').hidden;

        // Versions + files: v1 from the modal (label pre-filled), three files
        // of which one is refused, a bad fees value refused, then v2 on top.
        document.querySelector('#pfm-detail-view .pfm-version-add').click();
        const versionModalOpen = document.getElementById('pfm-version-overlay').classList.contains('open');
        const prefilledLabel = document.getElementById('pfm-version-label').value;
        document.getElementById('pfm-version-fees').value = '12,000';
        await submitPfmVersionModal();
        await wait(250);
        const v1 = pfmCurrent?.versions?.[0];
        await addPfmFilesUi(v1.id, document.querySelector('#pfm-detail-view .pfm-add-files'));
        await wait(250);
        const chipsAfterAdd = document.querySelectorAll('#pfm-detail-view .pfm-file').length;
        const fileErrorsShown = document.querySelectorAll('#pfm-detail-view .pfm-file-error').length;
        const storedFiles = (pfmCurrent?.versions?.[0]?.files || []).map(f => f.originalName).sort().join(',');

        document.querySelector('#pfm-detail-view .pfm-version-add').click();
        document.getElementById('pfm-version-fees').value = 'abc';
        await submitPfmVersionModal();
        const badFeesRefused = document.getElementById('pfm-version-fees').classList.contains('field-error')
          && document.getElementById('pfm-version-overlay').classList.contains('open');
        document.getElementById('pfm-version-fees').value = '10500.5';
        await submitPfmVersionModal();
        await wait(250);
        const versionLabels = (pfmCurrent?.versions || []).map(v => v.label).join(',');
        const currentCard = document.querySelector('#pfm-detail-view .pfm-version.current .pfm-version-label')?.textContent;
        const currentFees = pfmCurrent?.currentVersion?.feesMinor;

        // Remove a file: × → inline "Yes" → gone; Undo → back.
        document.querySelector('#pfm-detail-view .pfm-version:not(.current) .pfm-file-x').click();
        document.querySelector('#pfm-detail-view .pfm-file .del-yes').click();
        await wait(300);
        const filesAfterRemove = (await window.api.getPfmItem(created.id)).versions[1].files.length;
        document.querySelector('#app-toast .toast-action-btn').click();
        await wait(300);
        const filesAfterUndo = (await window.api.getPfmItem(created.id)).versions[1].files.length;

        // Delete the current version: trash → "Yes" → v1 is current again; Undo → v2 back.
        document.querySelector('#pfm-detail-view .pfm-version.current .cd-icon-btn.danger').click();
        document.querySelector('#pfm-detail-view .pfm-version.current .del-yes').click();
        await wait(300);
        const currentAfterVersionDelete = (await window.api.getPfmItem(created.id)).currentVersion?.label;
        document.querySelector('#app-toast .toast-action-btn').click();
        await wait(300);
        const currentAfterVersionUndo = (await window.api.getPfmItem(created.id)).currentVersion?.label;
        await wait(200);
        const feeChangeText = document.querySelector('#pfm-detail-view .pfm-version.current .pfm-fee-change')?.textContent;

        // Phase 5 — Quick Find opens the offer from its reference.
        backToPfmList();
        await wait(200);
        await openPalette();
        document.getElementById('palette-input').value = ref;
        paletteInputChanged();
        await wait(500);
        const palHit = [...document.querySelectorAll('#palette-list .pal-item')].find(b => b.textContent.includes(ref));
        palHit?.click();
        await wait(300);
        const quickFindOpened = !!palHit && activeModule === 'pfm' && pfmCurrent?.id === created.id;

        // Excel export of the list view (the save dialog is replaced in E2E runs).
        backToPfmList();
        await wait(250);
        await exportPfmExcel();

        // Ctrl+N on the page opens New Offer.
        document.activeElement?.blur();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }));
        const ctrlNOpened = document.getElementById('pfm-modal-overlay').classList.contains('open')
          && document.getElementById('pfm-kind').value === 'OFFER';
        closePfmModal();

        // The client's "Offers & CRs" tab lists it, counts it, and creates a CR for that client.
        switchModule('clients');
        await wait(200);
        await openClientDetail(client.id, '', 'pfm');
        await wait(500);
        const tabCount = Number((document.querySelector('#client-detail-tabs [data-client-tab="pfm"]')?.textContent || '').replace(/[^0-9]/g, ''));
        const clientTabRow = !!document.querySelector('#client-detail-sections tr[data-pfm-id="' + created.id + '"]');
        [...document.querySelectorAll('#client-detail-sections .pj-section-actions .btn')].find(b => !b.classList.contains('primary'))?.click();
        const presetClient = document.getElementById('pfm-company').value === String(client.id)
          && document.getElementById('pfm-kind').value === 'CR';
        document.getElementById('pfm-reference').value = ref + '-CR';
        document.getElementById('pfm-title').value = 'E2E client-tab CR';
        await submitPfmModal();
        await wait(500);
        const clientTabRowsAfterCreate = document.querySelectorAll('#client-detail-sections tr.pfm-row').length;
        const stayedOnClient = activeModule === 'clients';
        switchModule('pfm');
        await wait(200);

        openPfmNew('CR');
        document.getElementById('pfm-reference').value = ' ' + ref.toLowerCase() + ' ';
        document.getElementById('pfm-title').value = 'E2E duplicate';
        document.getElementById('pfm-company').value = String(client.id);
        await submitPfmModal();
        await wait(150);
        const duplicateRefused = document.getElementById('pfm-reference').classList.contains('field-error')
          && document.getElementById('pfm-modal-overlay').classList.contains('open');
        closePfmModal();

        backToPfmList();
        await wait(250);
        const rowListed = !!document.querySelector('#pfm-tbody tr[data-pfm-id="' + created.id + '"]');

        await deletePfmItemUi(created.id);
        const goneAfterDelete = !(await window.api.listPfmItems({})).some(i => i.id === created.id);
        document.querySelector('#app-toast .toast-action-btn').click();
        await wait(250);
        const backAfterUndo = (await window.api.listPfmItems({})).some(i => i.id === created.id);

        switchModule('analytics');
        return {
          modalOpen, detailOpen, startStatus, trackSteps, stageModalOpen, movedStatus,
          movedMember: movedStage?.memberName, contactSaved, channelSaved, duplicateRefused, rowListed,
          goneAfterDelete, backAfterUndo,
          versionModalOpen, prefilledLabel, v1Fees: v1?.feesMinor, chipsAfterAdd, fileErrorsShown, storedFiles,
          badFeesRefused, versionLabels, currentCard, currentFees, filesAfterRemove, filesAfterUndo,
          currentAfterVersionDelete, currentAfterVersionUndo,
          feeChangeText, quickFindOpened, ctrlNOpened, tabCount, clientTabRow, presetClient,
          clientTabRowsAfterCreate, stayedOnClient, ref,
        };
      })(),
      outsource: await (async () => {
        // Outsource, through the page's real DOM and handlers: a resource with
        // its first rate, a second rate, then Person → Project → Entries (typed
        // row by row with Enter), a statement drafted, issued (entries lock),
        // marked paid and exported to Excel, plus the delete/undo and Quick
        // Find paths.
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const confirmYes = async (selector) => {
          document.querySelector(selector).click();
          document.querySelector('#outs-detail-view .del-yes').click();
          await wait(400);
        };
        switchModule('outsource');
        await wait(200);
        const name = 'E2E Resource ' + Date.now();

        // ── Resource + rates ──
        document.activeElement?.blur();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }));
        const ctrlNOpened = document.getElementById('outs-modal-overlay').classList.contains('open');
        const currencyPreset = !!document.getElementById('outs-currency').value;
        document.getElementById('outs-name').value = name;
        document.getElementById('outs-first-rate').value = '200';
        document.getElementById('outs-first-rate-from').value = '2090-01-01';
        await submitOutsModal();
        await wait(400);
        const created = outsCurrent;
        const detailOpen = created?.name === name && outsView === 'resource' && outsDetailTab === 'projects';
        const firstRate = created?.rates?.[0]?.rateMinor;

        setOutsDetailTab('rates');
        await wait(100);
        document.querySelector('#outs-detail-view .outs-rate-add').click();
        const rateModalOpen = document.getElementById('outs-rate-overlay').classList.contains('open');
        document.getElementById('outs-rate-amount').value = 'abc';
        await submitOutsRateModal();
        const badRateRefused = document.getElementById('outs-rate-amount').classList.contains('field-error');
        document.getElementById('outs-rate-amount').value = '1,250.50';
        document.getElementById('outs-rate-from').value = '2090-07-01';
        await submitOutsRateModal();
        await wait(300);
        const rateFroms = (outsCurrent?.rates || []).map(r => r.effectiveFrom).join(',');
        const newestRate = outsCurrent?.rates?.[0]?.rateMinor;
        document.querySelector('#outs-detail-view .outs-rate-add').click();
        document.getElementById('outs-rate-amount').value = '1';
        document.getElementById('outs-rate-from').value = '2090-07-01';
        await submitOutsRateModal();
        await wait(150);
        const sameDateRefused = document.getElementById('outs-rate-from').classList.contains('field-error');
        closeOutsRateModal();
        await confirmYes('#outs-detail-view .outs-rate-row .cd-icon-btn.danger');
        const ratesAfterDelete = (await window.api.getOutsResource(created.id)).rates.length;
        document.querySelector('#app-toast .toast-action-btn').click();
        await wait(400);
        const ratesAfterUndo = (await window.api.getOutsResource(created.id)).rates.length;

        // ── Projects inside the person ──
        setOutsDetailTab('projects');
        await wait(300);
        document.activeElement?.blur();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }));
        const projectModalOpen = document.getElementById('outs-project-overlay').classList.contains('open');
        document.getElementById('outs-project-name').value = 'E2E Project';
        await submitOutsProjectModal();
        await wait(500);
        const projectPageOpen = outsView === 'project' && outsCurrentProject?.name === 'E2E Project'
          && document.activeElement?.id === 'outs-new-time';
        const projectId = outsCurrentProject?.id;

        // ── Entries, keyboard first ──
        const enter = id => document.getElementById(id).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        const typeRow = async (time, description) => {
          document.getElementById('outs-new-time').value = time;
          document.getElementById('outs-new-description').value = description;
          enter('outs-new-description');
          await wait(450);
        };
        document.getElementById('outs-new-date').value = '2090-07-02';
        await typeRow('abc', 'E2E refused');
        const badTimeRefused = document.getElementById('outs-new-time').classList.contains('field-error')
          && (await window.api.listOutsEntries(created.id, {})).entries.length === 0;
        await typeRow('1:30', 'E2E first task');
        const keptDate = document.getElementById('outs-new-date').value;
        const refocused = document.activeElement?.id === 'outs-new-time';
        await typeRow('45', 'E2E second task');
        const gridRows = document.querySelectorAll('#outs-detail-view .outs-entry-row').length;
        const listed = await window.api.listOutsEntries(created.id, {});
        const enteredMinutes = listed.entries.map(e => e.minutes).join(',');
        const inProject = listed.entries.every(e => e.projectId === projectId);
        const totalMinor = listed.summary.totalMinor;
        const footerMinutes = document.querySelector('#outs-detail-view .outs-total-row td:nth-child(2)')?.textContent;

        const firstId = listed.entries[0].id;
        document.querySelector('#outs-detail-view tr[data-entry-id="' + firstId + '"] .outs-entry-edit').click();
        await wait(100);
        document.getElementById('outs-edit-time').value = '2h';
        enter('outs-edit-time');
        await wait(450);
        const editedMinutes = (await window.api.listOutsEntries(created.id, {})).entries.find(e => e.id === firstId)?.minutes;

        const secondId = listed.entries[1].id;
        document.querySelector('#outs-detail-view tr[data-entry-id="' + secondId + '"] .outs-entry-delete').click();
        document.querySelector('#outs-detail-view tr[data-entry-id="' + secondId + '"] .del-yes').click();
        await wait(450);
        const entriesAfterDelete = (await window.api.listOutsEntries(created.id, {})).entries.length;
        document.querySelector('#app-toast .toast-action-btn').click();
        await wait(450);
        const entriesAfterUndo = (await window.api.listOutsEntries(created.id, {})).entries.length;

        // ── Project export as it stands: an entry before the first rate has
        // no rate, so its rate/amount and the total fee export empty. ──
        const unpriced = (await window.api.createOutsEntry(projectId, { date: '2089-12-01', minutes: 30, description: 'E2E unpriced' })).entry;
        await loadOutsEntries();
        await wait(200);
        const projectExportButtons = !!document.querySelector('#outs-detail-view .outs-excel-btn')
          && !!document.querySelector('#outs-detail-view .outs-pdf-btn');
        const projectDoc = await outsExportDoc();
        const projectHtml = buildOutsExportHtml(projectDoc);
        const projectExportOk = projectExportButtons && projectDoc.entries.length === 3 && projectDoc.totalMinor === null
          && projectHtml.includes('E2E unpriced') && projectHtml.includes('E2E Project')
          && projectDoc.lines.some(l => l.rateMinor == null) && !projectHtml.includes('—</td>');
        // The person page exports every project's entries the same way.
        backToOutsResource('projects');
        await wait(400);
        const personDoc = await outsExportDoc();
        const personExportOk = !!document.querySelector('#outs-detail-view .outs-excel-btn')
          && personDoc?.entries.length === 3 && personDoc.totalMinor === null && personDoc.title === name;
        await openOutsProject(projectId);
        await wait(400);
        await window.api.deleteOutsEntry(unpriced.id);
        await window.api.purgeOutsEntry(unpriced.id);

        // ── Statement: draft → issue (locks) → paid → Excel ──
        backToOutsResource('statements');
        await wait(400);
        document.querySelector('#outs-detail-view .outs-statement-add').click();
        await wait(300);
        const statementModalOpen = document.getElementById('outs-statement-overlay').classList.contains('open');
        const defaultFrom = document.getElementById('outs-statement-from').value;
        document.getElementById('outs-statement-to').value = '2090-07-31';
        await submitOutsStatementModal();
        await wait(500);
        const draft = outsCurrentStatement;
        const draftOpen = outsView === 'statement' && draft?.status === 'DRAFT' && /^ST-[0-9]{3}$/.test(draft?.reference || '')
          && draft.entries.length === 2 && draft.totalMinutes === 165
          && !!document.querySelector('#outs-detail-view .outs-excel-btn');
        document.querySelector('#outs-detail-view .outs-issue-btn').click();
        await wait(500);
        const issued = outsCurrentStatement;
        const issuedOk = issued?.status === 'ISSUED' && issued.totalMinor === draft.totalMinor && issued.lines.length === 1;
        const lockedAfterIssue = (await window.api.listOutsEntries(created.id, {})).entries.every(e => e.locked);
        const editRefused = !(await window.api.updateOutsEntry(firstId, { minutes: 5 })).ok;
        document.querySelector('#outs-detail-view .outs-paid-btn').click();
        document.getElementById('outs-paid-date').value = '2090-08-05';
        document.getElementById('outs-paid-note').value = 'E2E transfer';
        await submitOutsPaidModal();
        await wait(500);
        const paidOk = outsCurrentStatement?.status === 'PAID' && outsCurrentStatement?.paidAt === '2090-08-05';
        await exportOutsExcel();
        const pdfHtml = buildOutsExportHtml(await outsExportDoc());
        const pdfHasLines = pdfHtml.includes(outsCurrentStatement.reference) && pdfHtml.includes('E2E Project');

        // A project with billed entries can only be deactivated.
        await openOutsProject(projectId);
        await wait(400);
        const lockIcons = document.querySelectorAll('#outs-detail-view .outs-lock-ic').length;
        await confirmYes('#outs-detail-view .pfm-del-host .del-action');
        const billedProjectKept = !!(await window.api.getOutsProject(projectId));

        // ── Duplicate name, deactivate, Quick Find, delete/undo ──
        openOutsNew();
        document.getElementById('outs-name').value = ' ' + name.toUpperCase() + ' ';
        await submitOutsModal();
        await wait(150);
        const duplicateRefused = document.getElementById('outs-name').classList.contains('field-error');
        closeOutsModal();

        await openPalette();
        document.getElementById('palette-input').value = 'E2E second task';
        paletteInputChanged();
        await wait(500);
        const entryHit = [...document.querySelectorAll('#palette-list .pal-item')].find(b => b.textContent.includes('E2E second task'));
        entryHit?.click();
        await wait(700);
        const entryQuickFind = !!entryHit && outsView === 'project' && outsCurrentProject?.id === projectId
          && !!document.querySelector('#outs-detail-view tr[data-entry-id="' + secondId + '"]');

        await setOutsActiveUi(created.id, false);
        backToOutsList();
        await wait(300);
        const hiddenWhenInactive = !document.querySelector('#outs-tbody tr[data-outs-id="' + created.id + '"]');
        toggleOutsInactive();
        const shownWithInactive = !!document.querySelector('#outs-tbody tr[data-outs-id="' + created.id + '"]');
        toggleOutsInactive();
        await setOutsActiveUi(created.id, true);

        // A resource with a paid statement is refused; a fresh one deletes and undoes.
        const refusedDelete = !(await window.api.deleteOutsResource(created.id)).ok;
        const spare = (await window.api.createOutsResource({ name: name + ' spare', currency: created.currency })).resource;
        await deleteOutsResourceUi(spare.id);
        const goneAfterDelete = !(await window.api.listOutsResources({ includeInactive: true })).some(r => r.id === spare.id);
        document.querySelector('#app-toast .toast-action-btn').click();
        await wait(300);
        const backAfterUndo = (await window.api.listOutsResources({})).some(r => r.id === spare.id);

        // Everything above is billed and paid, so nothing is owed yet — one
        // unbilled hour makes the Overview tile appear.
        const nothingOwed = (await window.api.getOutsUnpaidSummary()).totals.every(t => t.unpaidMinor === 0);
        await window.api.createOutsEntry(projectId, { date: '2090-09-01', minutes: '1h', description: 'E2E unbilled' });
        switchModule('analytics');
        await wait(800);
        const owedTile = nothingOwed && !!document.querySelector('#dash-stats .outs-owed');

        return {
          ctrlNOpened, currencyPreset, detailOpen, firstRate, rateModalOpen, badRateRefused, rateFroms, newestRate,
          sameDateRefused, ratesAfterDelete, ratesAfterUndo, projectModalOpen, projectPageOpen, badTimeRefused, keptDate,
          refocused, gridRows, enteredMinutes, inProject, totalMinor, footerMinutes, editedMinutes, entriesAfterDelete,
          entriesAfterUndo, statementModalOpen, defaultFrom, draftOpen, issuedOk, lockedAfterIssue, editRefused, paidOk,
          pdfHasLines, projectExportOk, personExportOk, lockIcons, billedProjectKept, duplicateRefused, entryQuickFind, hiddenWhenInactive,
          shownWithInactive, refusedDelete, goneAfterDelete, backAfterUndo, owedTile,
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
  if (!Object.values(result.knowledgeClientFilter || {}).every(Boolean))
    throw new Error(`Knowledge Hub client link/search/filter failed: ${JSON.stringify(result.knowledgeClientFilter)}`);
  if (!result.paletteVisible || !result.paletteText.includes('Electron E2E searchable handbook')) {
    throw new Error('Quick Find did not render the indexed result');
  }
  if (!result.rendererModules) throw new Error('Extracted renderer modules did not load in classic-script order');
  const sanitize = result.knowledgeSanitize;
  if (!sanitize.stripsScript || !sanitize.stripsEventHandlers || !sanitize.stripsImg || !sanitize.stripsJsUrl ||
      !sanitize.stripsStyleAttr || !sanitize.keepsPlainText || !sanitize.allowsSafeMarkup) {
    throw new Error(`Knowledge Hub HTML sanitizer failed: ${JSON.stringify(sanitize)}`);
  }

  // Knowledge Hub shelf (Phase 2): a real file goes in through <input type=file>
  // (set over CDP, so it carries a disk path) and reaches main via preload's
  // webUtils; a second file with a matching name becomes the next version.
  const shelfFiles = [['E2E_Field_Mapping_v1.0.txt', 'Generic mapping, first cut.\n'], ['E2E-Field-Mapping.txt', 'Generic mapping, revised.\n']]
    .map(([name, body]) => { const p = path.join(root, name); fs.writeFileSync(p, body); return p; });
  const setKnowledgeInputFile = async filePath => {
    const { root: doc } = await command('DOM.getDocument', { depth: 1 });
    const { nodeId } = await command('DOM.querySelector', { nodeId: doc.nodeId, selector: '#kh-file-input' });
    await command('DOM.setFileInputFiles', { nodeId, files: [filePath] });
  };
  await evaluate(`(async () => { closePalette(); switchModule('knowledge'); await loadKnowledgeItems(); return true; })()`);
  await setKnowledgeInputFile(shelfFiles[0]);
  const shelfFirst = await evaluate(`(async () => {
    const file = document.getElementById('kh-file-input').files[0];
    const forged = await window.api.uploadKnowledgeFile(knowledgeItems[0].id, new File(['x'], 'forged.txt'), { name: 'Forged', version: '1.0' });
    openKnowledgeEditor(null, file);
    const title = document.getElementById('kh-title-input').value;
    document.getElementById('kh-notes-input').value = 'Ask the vendor first. https://example.com/mapping';
    await saveKnowledgeEditor();
    const item = knowledgeItems.find(entry => entry.title === 'E2E Field Mapping');
    const row = document.querySelector('#kh-list [data-knowledge-id="' + item?.id + '"]');
    const link = document.querySelector('#kh-detail-view .kh-content a');
    return {
      forgedRejected: forged && forged.ok === false,
      titleFromFile: title === 'E2E Field Mapping',
      uploaded: item?.documents?.length === 1 && item.documents[0].version === '1.0' && item.documents[0].name === 'E2E Field Mapping',
      plainNotes: item?.contentFormat === 'text',
      // The e2e catalog has a single system; the picker must not link it on its own.
      noAutoLink: item?.systems?.length === 0 && item?.companies?.length === 0,
      bareLink: link?.title === 'https://example.com/mapping',
      panelBesideList: !document.getElementById('kh-detail-view').hidden
        && document.getElementById('kh-list-view').classList.contains('has-panel') && !!row && row.classList.contains('active'),
      rowOpen: !!row?.querySelector('.kh-row-actions button'),
    };
  })()`);
  await setKnowledgeInputFile(shelfFiles[1]);
  const shelfSecond = await evaluate(`(async () => {
    const file = document.getElementById('kh-file-input').files[0];
    closeKnowledgeDetail();
    await handleKnowledgeDrop(file, false);
    const suggested = {
      name: document.getElementById('kh-document-name').value,
      version: document.getElementById('kh-document-version').value,
      modalOpen: document.getElementById('knowledge-document-modal-overlay').classList.contains('open'),
      noteLabel: ['What changed', 'ما الذي تغيّر'].includes(document.getElementById('kh-document-note-label').textContent),
    };
    document.getElementById('kh-document-note').value = 'Added claim fields, see https://example.com/notes';
    await submitKnowledgeDocument();
    const item = knowledgeItems.find(entry => entry.title === 'E2E Field Mapping');
    await openKnowledgeDetail(item.id);
    const latestNote = document.querySelector('#kh-detail-view .kh-document-family > .kh-change-note');
    const noteShown = !!latestNote && !latestNote.hidden && latestNote.textContent.includes('Added claim fields')
      && latestNote.querySelector('a')?.textContent === 'https://example.com/notes';
    const latestDoc = knowledgeCurrentItem.documents.find(doc => doc.version === '1.1');
    editKnowledgeChangeNote(latestNote.closest('.kh-document-family'), latestDoc);
    const noteInput = latestNote.querySelector('textarea');
    noteInput.value = 'Mapped 12 new claim fields';
    latestNote.querySelector('.kh-change-note-actions .btn.primary').click();
    for (let i = 0; i < 40 && !knowledgeCurrentItem?.documents?.some(doc => doc.changeNote === 'Mapped 12 new claim fields'); i++) await new Promise(r => setTimeout(r, 50));
    const noteEdited = knowledgeCurrentItem.documents.find(doc => doc.version === '1.1')?.changeNote === 'Mapped 12 new claim fields'
      && !!document.querySelector('#kh-detail-view .kh-document-family > .kh-change-note')?.textContent.includes('Mapped 12 new claim fields');
    const noteSearch = knowledgeMatches(knowledgeItems.find(entry => entry.id === item.id), 'mapped 12 new');
    const legacy = knowledgeNotesFromItem({ contentFormat: 'html', content: '<p>Step one</p><ul><li>Check <a href="https://example.com/a">the sheet</a></li></ul>' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return {
      matchedName: suggested.name === 'E2E Field Mapping', nextVersion: suggested.version === '1.1', modalOpen: suggested.modalOpen,
      versioned: item?.documents?.length === 2 && item.documents.some(doc => doc.version === '1.1'),
      noteLabel: suggested.noteLabel, noteShown, noteEdited, noteSearch,
      panelFollowed: knowledgeCurrentId == null,
      legacyToPlain: legacy === 'Step one\\n- Check the sheet (https://example.com/a)',
      versionRules: knowledgeNextVersion('1.0') === '1.1' && knowledgeNextVersion('2026.07') === '2026.08'
        && knowledgeNextVersion('Rev B') === 'Rev C' && knowledgeNextVersion('1.0', ['1.1']) === '1.2',
      nameRules: knowledgeParseFileName('ACME_Mapping_v2.3.xlsx').version === '2.3'
        && knowledgeParseFileName('Guide (2).pdf').base === 'Guide' && knowledgeParseFileName('Guide (2).pdf').version === '',
    };
  })()`);
  const shelf = { ...shelfFirst, ...shelfSecond };
  if (!Object.values(shelf).every(Boolean)) throw new Error(`Knowledge Hub shelf / drop / versioning failed: ${JSON.stringify(shelf)}`);
  // Phase 4: the client page and a project page show the Hub items linked to them.
  const linkedPages = await evaluate(`(async () => {
    const until = async test => { for (let i = 0; i < 60 && !test(); i++) await new Promise(r => setTimeout(r, 50)); return !!test(); };
    const client = LK.categories.COMPANY.find(item => item.code === 'E2E_CLIENT');
    const titles = sel => [...document.querySelectorAll(sel + ' .kh-linked .kh-row-title')].map(n => n.textContent);
    switchModule('clients');
    await openClientDetail(client.id, '', 'knowledge');
    const clientListed = await until(() => titles('#client-detail-sections').includes('E2E client mapping sheet'));
    const clientOnlyLinked = !titles('#client-detail-sections').includes('E2E unrelated manual');
    const tabCount = /\\(1\\)$/.test(document.querySelector('#client-detail-tabs [data-client-tab="knowledge"]')?.textContent || '');
    const section = document.querySelector('#client-detail-sections .kh-linked');
    const dt = new DataTransfer(); dt.items.add(new File(['runbook'], 'E2E_Client_Runbook_v1.0.txt', { type: 'text/plain' }));
    section.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    const dropPreset = document.getElementById('knowledge-modal-overlay').classList.contains('open')
      && document.getElementById('kh-title-input').value === 'E2E Client Runbook'
      && !!document.querySelector('#kh-companies .tp-pill')?.textContent.includes('E2E_CLIENT');
    closeKnowledgeEditor(true);
    [...section.querySelectorAll('.pj-section-actions .btn.primary')].pop().click();
    document.getElementById('kh-title-input').value = 'E2E client runbook';
    await saveKnowledgeEditor();
    const savedHere = activeModule === 'clients'
      && await until(() => titles('#client-detail-sections').includes('E2E client runbook'))
      && knowledgeItems.find(item => item.title === 'E2E client runbook')?.companies?.[0]?.id === client.id;
    const project = await window.api.createProject({ name: 'E2E knowledge project', companyIds: [client.id] });
    openProjectById(project.id);
    const projectListed = await until(() => titles('#projects-detail-view').includes('E2E client mapping sheet'));
    const projectOnlyLinked = !titles('#projects-detail-view').includes('E2E unrelated manual');
    [...document.querySelectorAll('#projects-detail-view .kh-linked .kh-row-main')].find(n => n.textContent.includes('E2E client mapping sheet')).click();
    const openedInHub = await until(() => activeModule === 'knowledge' && knowledgeCurrentItem?.title === 'E2E client mapping sheet');
    closeKnowledgeDetail();
    return { clientListed, clientOnlyLinked, tabCount, dropPreset, savedHere, projectListed, projectOnlyLinked, openedInHub };
  })()`);
  if (!Object.values(linkedPages).every(Boolean)) throw new Error(`Knowledge Hub on client/project pages failed: ${JSON.stringify(linkedPages)}`);
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

  const pfm = result.pfm;
  if (!pfm.modalOpen || !pfm.detailOpen || pfm.startStatus !== 'PREPARE' || pfm.trackSteps !== 5) {
    throw new Error(`Creating an offer from the Project & Finance page failed: ${JSON.stringify(pfm)}`);
  }
  if (!pfm.stageModalOpen || pfm.movedStatus !== 'READY' || pfm.movedMember !== 'E2E Person Two') {
    throw new Error(`Moving an offer's status from its detail page failed: ${JSON.stringify(pfm)}`);
  }
  if (!pfm.contactSaved) throw new Error(`The client contact did not auto-save: ${JSON.stringify(pfm)}`);
  if (!pfm.channelSaved) throw new Error(`The client channel did not auto-save: ${JSON.stringify(pfm)}`);
  if (!pfm.duplicateRefused) throw new Error(`A duplicate Reference ID was not refused in the modal: ${JSON.stringify(pfm)}`);
  if (!pfm.rowListed) throw new Error(`The offer is missing from the Project & Finance list: ${JSON.stringify(pfm)}`);
  if (!pfm.goneAfterDelete || !pfm.backAfterUndo) {
    throw new Error(`Offer delete/undo round trip failed: ${JSON.stringify(pfm)}`);
  }
  if (!pfm.versionModalOpen || pfm.prefilledLabel !== 'v1' || pfm.v1Fees !== 1200000) {
    throw new Error(`Adding a version with fees from the detail page failed: ${JSON.stringify(pfm)}`);
  }
  if (pfm.chipsAfterAdd !== 2 || pfm.fileErrorsShown !== 1 || pfm.storedFiles !== 'e2e-notes.txt,e2e-offer.pdf') {
    throw new Error(`Adding several files to a version (one refused) failed: ${JSON.stringify(pfm)}`);
  }
  if (!pfm.badFeesRefused || pfm.versionLabels !== 'v2,v1' || pfm.currentCard !== 'v2' || pfm.currentFees !== 1050050) {
    throw new Error(`A second version did not become the current one: ${JSON.stringify(pfm)}`);
  }
  if (pfm.filesAfterRemove !== 1 || pfm.filesAfterUndo !== 2) {
    throw new Error(`Removing a version file with undo failed: ${JSON.stringify(pfm)}`);
  }
  if (pfm.currentAfterVersionDelete !== 'v1' || pfm.currentAfterVersionUndo !== 'v2') {
    throw new Error(`Deleting a version with undo failed: ${JSON.stringify(pfm)}`);
  }
  if (pfm.feeChangeText !== '−1,499.50 (−12.5%)') {
    throw new Error(`The fee change between versions is wrong or missing: ${JSON.stringify(pfm)}`);
  }
  if (!pfm.quickFindOpened) throw new Error(`Quick Find did not open the offer from its reference: ${JSON.stringify(pfm)}`);
  if (!pfm.ctrlNOpened) throw new Error(`Ctrl+N did not open New Offer on the Project & Finance page: ${JSON.stringify(pfm)}`);
  const pfmXlsx = fs.existsSync(pfmXlsxPath) ? fs.readFileSync(pfmXlsxPath) : Buffer.alloc(0);
  if (pfmXlsx.readUInt32LE(0) !== 0x04034B50 || !pfmXlsx.includes(pfm.ref)) {
    throw new Error(`The Project & Finance Excel export was not written with the listed offer (${pfmXlsx.length} bytes)`);
  }
  if (pfm.tabCount !== 1 || !pfm.clientTabRow || !pfm.presetClient || pfm.clientTabRowsAfterCreate !== 2 || !pfm.stayedOnClient) {
    throw new Error(`The client's Offers & CRs tab failed: ${JSON.stringify(pfm)}`);
  }

  const outs = result.outsource;
  const outsFail = what => { throw new Error(`${what}: ${JSON.stringify(outs)}`); };
  if (!outs.ctrlNOpened || !outs.currencyPreset || !outs.detailOpen || outs.firstRate !== 20000) outsFail('Creating an Outsource resource with its first rate failed');
  if (!outs.rateModalOpen || !outs.badRateRefused || outs.rateFroms !== '2090-07-01,2090-01-01' || outs.newestRate !== 125050
      || !outs.sameDateRefused || outs.ratesAfterDelete !== 1 || outs.ratesAfterUndo !== 2) outsFail('The Outsource Rates tab failed');
  if (!outs.projectModalOpen || !outs.projectPageOpen) outsFail('Adding a project inside the person did not open it ready for entries');
  // 90 + 45 min in July 2090 at 1,250.50/h → 135 × 125050 / 60 = 281362.5 → 281363.
  if (!outs.badTimeRefused || outs.keptDate !== '2090-07-02' || !outs.refocused || outs.gridRows !== 2
      || outs.enteredMinutes !== '90,45' || !outs.inProject || outs.footerMinutes !== '135' || outs.totalMinor !== 281363) {
    outsFail('Typing entries into the project grid failed');
  }
  if (outs.editedMinutes !== 120 || outs.entriesAfterDelete !== 1 || outs.entriesAfterUndo !== 2) outsFail('Editing / deleting an entry failed');
  if (!outs.statementModalOpen || outs.defaultFrom !== '2090-07-02' || !outs.draftOpen || !outs.issuedOk || !outs.lockedAfterIssue
      || !outs.editRefused || !outs.paidOk || !outs.pdfHasLines) outsFail('The statement draft → issue → paid flow failed');
  if (!outs.personExportOk) outsFail('Exporting from the person page failed');
  if (!outs.projectExportOk) outsFail('Exporting a project as it stands (an unpriced entry left empty) failed');
  if (outs.lockIcons !== 2 || !outs.billedProjectKept) outsFail('Issued entries are not shown locked, or a billed project was deleted');
  if (!outs.duplicateRefused || !outs.entryQuickFind || !outs.hiddenWhenInactive || !outs.shownWithInactive
      || !outs.refusedDelete || !outs.goneAfterDelete || !outs.backAfterUndo) outsFail('Outsource list, Quick Find or delete/undo failed');
  if (!outs.owedTile) outsFail('The Overview did not show what is owed to Outsource');
  const outsXlsx = fs.existsSync(outsXlsxPath) ? fs.readFileSync(outsXlsxPath) : Buffer.alloc(0);
  if (outsXlsx.readUInt32LE(0) !== 0x04034B50 || !outsXlsx.includes('E2E first task')) {
    throw new Error(`The Outsource statement Excel export was not written (${outsXlsx.length} bytes)`);
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

  const screenshotPath = process.env.OFFICE_ONE_E2E_SCREENSHOT;
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
  console.log('PASS  Knowledge Hub links an item to a client, finds it by the Arabic client name, and filters the list by client');
  console.log('PASS  Knowledge Hub HTML sanitizer strips scripts/handlers/img/js-urls/style while keeping the safe subset');
  console.log('PASS  Knowledge Hub adds a real picked file, refuses a page-made File, versions a matching drop as 1.1 with a "what changed" note, and edits that note');
  console.log('PASS  Knowledge Hub opens items in a side panel beside the list, with plain-text notes and one-click Open');
  console.log('PASS  Client and project pages list their Knowledge Hub items; a drop or New item there is pre-linked and stays on the page');
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
  console.log('PASS  An offer is created, moved to its next status and auto-saved from the Project & Finance page');
  console.log('PASS  A duplicate Reference ID is refused in the modal, and delete/undo keeps the offer');
  console.log('PASS  Versions with fees become current newest-first; files are added (bad ones listed), removed and restored');
  console.log('PASS  Project & Finance reaches the rest of the app: fee change, Quick Find, Ctrl+N, Excel export, client tab');
  console.log('PASS  Outsource: a resource with its first rate; the Rates tab adds, refuses a bad or clashing rate, and undoes a delete');
  console.log('PASS  Outsource: a project added inside the person opens its grid; entries typed with Enter, edited, deleted with undo');
  console.log('PASS  Outsource statements: draft preview → issue locks the entries → marked paid → Excel and PDF export');
  console.log('PASS  Outsource: a project, or the whole person, exports as it stands — an entry with no rate leaves its rate, amount and the total fee empty');
  console.log('PASS  Outsource: duplicate name refused, deactivate, Quick Find to an entry, delete/undo, Overview owed tile');
  console.log('PASS  An admin-created account is forced to replace its admin-assigned password on next login');
  console.log('PASS  Runtime accessibility invariants cover names, unique ids, language/direction, and live regions');
  console.log(`PASS  report:exportPDF produces a real PDF file (${pdfBytes.length} bytes)`);
  console.log(`PASS  report:exportExcel produces a real XLSX workbook (${xlsxBytes.length} bytes)`);
  console.log(`PASS  Extracted renderer modules loaded (app v${result.version})`);
}

// `root` reaches the app as OFFICE_ONE_DATA_DIR, which main.js feeds straight
// into app.setPath('userData'), so Chromium's GPUCache and network store sit in
// it alongside the database's -wal/-shm. kill() signals only Electron's main
// process; the GPU and renderer helpers hold those files open a little longer,
// and Windows refuses to delete a file that is still open.
async function stopElectron() {
  if (!child || child.exitCode != null) return;
  const exited = new Promise(resolve => child.once('exit', () => resolve(true)));
  const deadline = ms => new Promise(resolve => setTimeout(() => resolve(false), ms));
  child.kill();
  if (await Promise.race([exited, deadline(15_000)])) return;
  try { child.kill('SIGKILL'); } catch {}
  await Promise.race([exited, deadline(2_000)]);
}

// Retry, then give up quietly. rmSync does NOT retry by default (maxRetries is
// 0), so the single attempt this used to make raced the handles above and threw
// EPERM on the slower CI runner — turning a run where all 25 gates passed into a
// red build. A directory left behind under the OS temp folder is not a test
// failure, so it is reported and not thrown.
async function removeDataDir(dir) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      return;
    }
    catch (error) {
      if (attempt === 10) {
        console.warn(`WARN  left ${dir} in place (${error.code || error.message})`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
}

run().catch(error => {
  console.error('FAIL  Electron E2E smoke');
  console.error(error.stack || String(error));
  process.exitCode = 1;
}).finally(async () => {
  try { socket?.close(); } catch {}
  await stopElectron();
  await removeDataDir(root);
});
