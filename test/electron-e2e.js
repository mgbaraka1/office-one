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
  child = spawn(electron, ['.'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
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
      version: await window.api.appVersion()
    };
  })()`);

  if (!result.hit) throw new Error('FTS result did not cross the preload bridge');
  if (!result.paletteVisible || !result.paletteText.includes('Electron E2E searchable handbook')) {
    throw new Error('Quick Find did not render the indexed result');
  }
  if (!result.rendererModules) throw new Error('Extracted renderer modules did not load in classic-script order');
  if (!result.version) throw new Error('Application version IPC returned no value');

  console.log(`PASS  Electron launched with isolated data at ${root}`);
  console.log('PASS  First-run account setup completed through the real renderer');
  console.log('PASS  Context-isolated preload IPC created and searched a knowledge item');
  console.log('PASS  Quick Find rendered the FTS result');
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
