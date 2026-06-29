const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const db   = require('./db');
const auth = require('./auth');

// Wrap a data IPC handler so it fails closed when no one is logged in. Every
// handler that reads or writes user data goes through this — the renderer can
// never reach the data layer before authenticating.
function authed(handler) {
  return (event, ...args) => {
    if (!auth.isAuthenticated()) throw new Error('Not authenticated');
    return handler(event, ...args);
  };
}

let win;
let allowClose = false;       // set once the renderer has flushed pending saves
let closeFallback = null;     // safety timer for the close handshake

function createWindow() {
  const prefs = db.loadPrefs();
  win = new BrowserWindow({
    width:     prefs.width  || 1400,
    height:    prefs.height || 800,
    x:         prefs.x,
    y:         prefs.y,
    minWidth:  900,
    minHeight: 600,
    icon:      path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
    title: 'Cooperation Tools',
  });
  if (prefs.maximized) win.maximize();
  win.loadFile('index.html');

  // Defense in depth: the app is a single local page. Deny any attempt to open
  // new windows or navigate the top frame elsewhere. The one legitimate popup
  // is the print-preview window (about:blank, written via document.write); real
  // web links are handed to the OS browser (mirrors the openExternal allowlist).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === '' || url === 'about:blank') return { action: 'allow' };
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.href);
    } catch { /* not a valid URL — ignore */ }
    return { action: 'deny' };
  });
  // Block navigation *away* from the app (defense in depth), but allow a reload
  // of our own page — logout (doLogout → location.reload) relies on it, and a
  // reload fires will-navigate with the current URL as its target.
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  win.on('close', (e) => {
    // Persist window state on every close attempt. Use getNormalBounds() so the
    // restored (un-maximized) size is saved even while maximized.
    const b = win.getNormalBounds();
    db.savePrefs({ width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() });

    // First close attempt: give the renderer a chance to flush any debounced
    // (300 ms) auto-saves before the window tears down, so no edit is lost.
    if (!allowClose) {
      e.preventDefault();
      win.webContents.send('app:beforeClose');
      // Safety net: if the renderer never reports back, close anyway.
      closeFallback = setTimeout(() => {
        allowClose = true;
        if (win && !win.isDestroyed()) win.close();
      }, 1500);
    }
  });
}

// ── Authentication (ungated — these are the gate) ──
ipcMain.handle('auth:status',      ()                     => auth.status());
ipcMain.handle('auth:setup',       (_e, username, pass)   => auth.setup(username, pass));
ipcMain.handle('auth:login',       (_e, username, pass)   => auth.login(username, pass));
ipcMain.handle('auth:logout',      ()                     => auth.logout());
ipcMain.handle('auth:currentUser', ()                     => auth.currentUser());

// ── Days ── (userId always comes from the authenticated session, never the renderer)
ipcMain.handle('day:save',  authed((_e, dateStr, data) => db.saveDay(auth.requireUserId(), dateStr, data)));
ipcMain.handle('day:get',   authed((_e, dateStr)       => db.loadDay(auth.requireUserId(), dateStr)));
ipcMain.handle('days:list', authed(()                  => db.listDays(auth.requireUserId())));
ipcMain.handle('days:range', authed((_e, from, to)     => db.loadDaysRange(auth.requireUserId(), from, to)));

// ── Companies / Systems (read-only views over existing day_entries) ──
ipcMain.handle('companies:list',    authed(()         => db.listCompanies(auth.requireUserId())));
ipcMain.handle('companies:entries', authed((_e, name) => db.companyEntries(auth.requireUserId(), name)));
ipcMain.handle('systems:list',      authed(()         => db.listSystems(auth.requireUserId())));
ipcMain.handle('systems:entries',   authed((_e, name) => db.systemEntries(auth.requireUserId(), name)));

// ── Analytics (aggregation done in SQL, not in the renderer) ──
ipcMain.handle('analytics:summary',  authed((_e, from, to, spanFrom, spanTo) => db.getAnalytics(auth.requireUserId(), from, to, spanFrom, spanTo)));
ipcMain.handle('analytics:overview', authed((_e, today, monthStart)          => db.getOverviewStats(auth.requireUserId(), today, monthStart)));

// ── Lookups (normalized catalog — shared app config) ──
ipcMain.handle('lookups:get',         authed(()                              => db.loadLookups()));
ipcMain.handle('lookups:getByCategory', authed((_e, category, includeInactive) => db.getLookupsByCategory(category, includeInactive)));
ipcMain.handle('lookups:save',        authed((_e, data)                      => db.saveLookups(data)));

// ── Subscriptions ──
ipcMain.handle('subscriptions:list', authed(()         => db.loadSubscriptions(auth.requireUserId())));
ipcMain.handle('subscriptions:save', authed((_e, data) => db.saveSubscriptions(auth.requireUserId(), data)));

// ── Backlog ("Not Yet" pool) ──
ipcMain.handle('backlog:list', authed(()         => db.loadBacklog(auth.requireUserId())));
ipcMain.handle('backlog:save', authed((_e, data) => db.saveBacklog(auth.requireUserId(), data)));

// ── Projects (container for tasks + tracked documents) ──
ipcMain.handle('projects:create', authed((_e, data)     => db.createProject(auth.requireUserId(), data)));
ipcMain.handle('projects:list',   authed(()             => db.listProjects(auth.requireUserId())));
ipcMain.handle('projects:get',    authed((_e, id)       => db.getProject(auth.requireUserId(), id)));
ipcMain.handle('projects:update', authed((_e, id, data) => db.updateProject(auth.requireUserId(), id, data)));
ipcMain.handle('projects:delete', authed((_e, id)       => db.deleteProject(auth.requireUserId(), id)));
ipcMain.handle('projects:update-document-status', authed((_e, projectId, documentType, isAvailable) =>
  db.setProjectDocumentStatus(auth.requireUserId(), projectId, documentType, isAvailable)));
// Linking existing tasks (needed for the Phase 2 "link a task" picker) — extra
// channels beyond the six in the spec, since the spec's UI requires task linking.
ipcMain.handle('projects:link-task',   authed((_e, projectId, kind, taskId) => db.linkTask(auth.requireUserId(), projectId, kind, taskId)));
ipcMain.handle('projects:unlink-task', authed((_e, kind, taskId)           => db.unlinkTask(auth.requireUserId(), kind, taskId)));
ipcMain.handle('projects:linkable-tasks', authed(()                        => db.listLinkableTasks(auth.requireUserId())));

// ── Backup ──
ipcMain.handle('db:backup', authed(async () => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Back up database',
    defaultPath: `cooperation-tools-backup-${stamp}.db`,
    filters: [{ name: 'SQLite database', extensions: ['db'] }],
  });
  if (canceled || !filePath) return { ok: false };
  try { db.backup(filePath); return { ok: true, path: filePath }; }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
}));

// ── Export a report HTML document to a PDF file (native "Save as" dialog) ──
// Renders the supplied self-contained HTML in an offscreen window, prints it to
// PDF via Chromium, and writes the chosen file. Read-only; touches no app data.
ipcMain.handle('report:exportPDF', authed(async (_e, html, defaultName) => {
  let pdfWin;
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save report as PDF',
      defaultPath: defaultName || 'report.pdf',
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false };

    pdfWin = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // Give webfonts/layout a beat to settle before snapshotting.
    await new Promise(r => setTimeout(r, 350));
    const pdf = await pdfWin.webContents.printToPDF({ printBackground: true, margins: { marginType: 'default' } });
    fs.writeFileSync(filePath, pdf);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    if (pdfWin && !pdfWin.isDestroyed()) pdfWin.destroy();
  }
}));

// ── Close handshake ──
ipcMain.handle('app:flushComplete', () => {
  clearTimeout(closeFallback);
  allowClose = true;
  if (win && !win.isDestroyed()) win.close();
});

// ── Window controls ──
ipcMain.handle('window:setTitle',   (_e, title) => { if (win) win.setTitle(title); });
ipcMain.handle('shell:openExternal', (_e, url)  => {
  // Only ever hand off real web links to the OS — never file:, javascript:, etc.
  try {
    const u = new URL(String(url));
    if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.href);
  } catch { /* not a valid URL — ignore */ }
});

// Dev convenience: load KEY=VALUE pairs from a local .env into process.env.
// Only in development — packaged builds ignore it so a stray .env can't alter a
// shipped app. Existing environment variables always win.
function loadDotEnv() {
  try {
    if (app.isPackaged) return;
    const file = path.join(__dirname, '.env');
    if (!fs.existsSync(file)) return;
    const re = /^\s*(\w+)\s*=\s*(.*)\s*$/;
    for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
      const m = re.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* non-critical */ }
}

app.whenReady().then(() => {
  // Optional data-directory override (see .env.example). Lets the store live
  // somewhere other than the default userData folder — handy for testing or a
  // portable install. Must be set before any path is read.
  loadDotEnv();
  if (process.env.COOPERATION_TOOLS_DATA_DIR) {
    app.setPath('userData', process.env.COOPERATION_TOOLS_DATA_DIR);
  }

  // Boot the data layer in three explicit, sequential steps: open the embedded
  // SQLite connection, bring the schema to the latest version via the versioned
  // migration runner, then run best-effort maintenance (backup rotation).
  try {
    db.openConnection(app.getPath('userData'));
    db.applyMigrations();
    db.runMaintenance();
  } catch (err) {
    // A failed DB open (locked, corrupt, permissions) must not leave the user
    // with an invisible, windowless process — surface it and exit.
    dialog.showErrorBox(
      'Cooperation Tools — database error',
      'The data store could not be opened, so the app cannot start.\n\n' +
      String(err?.message || err) +
      '\n\nYour data folder:\n' + app.getPath('userData')
    );
    app.quit();
    return;
  }
  createWindow();
});
app.on('window-all-closed', () => {
  db.close();   // checkpoint WAL + close handle cleanly
  if (process.platform !== 'darwin') app.quit();
});