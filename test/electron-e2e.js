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
  child = spawn(electron, ['.'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...electronEnv,
      COOPERATION_TOOLS_DATA_DIR: root,
      COOPERATION_TOOLS_E2E_PORT: String(port),
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
        const companiesPanel = document.getElementById('tab-companies')?.textContent || '';
        const statusPanel = document.getElementById('tab-status');
        const openRow = [...(statusPanel?.querySelectorAll('.bilingual-lookup-item') || [])].find(row =>
          row.querySelector('input[dir="ltr"]')?.value === 'Open');
        const bilingualCatalog = !!openRow
          && openRow.querySelector('input[dir="rtl"]')?.value === 'مفتوحة'
          && statusPanel.textContent.includes('التسمية بالإنجليزية')
          && statusPanel.textContent.includes('التسمية بالعربية');
        const settingsLocalized = document.getElementById('settings-search')?.placeholder === 'البحث عن إعداد…'
          && companiesPanel.includes('رمز الشركة')
          && companiesPanel.includes('الاسم بالإنجليزية')
          && companiesPanel.includes('الاسم بالعربية')
          && document.getElementById('settings-save-btn')?.textContent === 'حفظ تغييرات الكتالوج';
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
          bilingualCatalog
        };
        chooseLoginLanguage('en');
        arabic.loginLanguageLocked = document.documentElement.lang === 'ar';
        arabic.noAuthenticatedLanguageControls = !document.getElementById('language-toggle')
          && !document.getElementById('setting-language-ctl');
        return arabic;
      })()
    };
  })()`);

  if (!result.hit) throw new Error('FTS result did not cross the preload bridge');
  if (!result.paletteVisible || !result.paletteText.includes('Electron E2E searchable handbook')) {
    throw new Error('Quick Find did not render the indexed result');
  }
  if (!result.rendererModules) throw new Error('Extracted renderer modules did not load in classic-script order');
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
  console.log('PASS  Quick Find rendered the FTS result');
  console.log('PASS  Client profile code and English/Arabic names flow into a linked task');
  console.log('PASS  Arabic login choice drives RTL, preserves user content, and localizes report/PDF output');
  console.log('PASS  Settings, including dynamic client-profile controls, are localized');
  console.log('PASS  Managed Settings catalogs expose and render English/Arabic labels');
  console.log('PASS  Runtime accessibility invariants cover names, unique ids, language/direction, and live regions');
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
