const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const db   = require('./db');

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
    title: 'Cooperation Tools',
  });
  if (prefs.maximized) win.maximize();
  win.loadFile('index.html');

  win.on('close', (e) => {
    // Persist window state on every close attempt. Use getNormalBounds() so the
    // restored (un-maximized) size is saved even while maximized.
    const b = win.getNormalBounds();
    db.savePrefs({ width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() });

    // First close attempt: give the renderer a chance to flush any debounced
    // (300 ms) auto-saves before the window tears down, so no edit is lost.
    if (!allowClose) {
      e.preventDefault();
      win.webContents.send('before-close');
      // Safety net: if the renderer never reports back, close anyway.
      closeFallback = setTimeout(() => {
        allowClose = true;
        if (win && !win.isDestroyed()) win.close();
      }, 1500);
    }
  });
}

// ── Days ──
ipcMain.handle('saveDay',  (_e, dateStr, data) => db.saveDay(dateStr, data));
ipcMain.handle('loadDay',  (_e, dateStr)       => db.loadDay(dateStr));
ipcMain.handle('listDays', ()                  => db.listDays());

// ── Lookups ──
ipcMain.handle('loadLookups', ()         => db.loadLookups());
ipcMain.handle('saveLookups', (_e, data) => db.saveLookups(data));

// ── Subscriptions ──
ipcMain.handle('loadSubscriptions', ()         => db.loadSubscriptions());
ipcMain.handle('saveSubscriptions', (_e, data) => db.saveSubscriptions(data));

// ── Licenses ──
ipcMain.handle('loadLicenses', ()         => db.loadLicenses());
ipcMain.handle('saveLicenses', (_e, data) => db.saveLicenses(data));

// ── Insurance ──
ipcMain.handle('loadInsurance', ()         => db.loadInsurance());
ipcMain.handle('saveInsurance', (_e, data) => db.saveInsurance(data));

// ── Backup ──
ipcMain.handle('backupDatabase', async () => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Back up database',
    defaultPath: `cooperation-tools-backup-${stamp}.db`,
    filters: [{ name: 'SQLite database', extensions: ['db'] }],
  });
  if (canceled || !filePath) return { ok: false };
  try { db.backup(filePath); return { ok: true, path: filePath }; }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
});

// ── Close handshake ──
ipcMain.handle('flushComplete', () => {
  clearTimeout(closeFallback);
  allowClose = true;
  if (win && !win.isDestroyed()) win.close();
});

// ── Carry-over (all "Not Yet" rows across days, except the active day) ──
ipcMain.handle('getCarryOver', (_e, excludeDate) => db.getCarryOver(excludeDate));

// ── Window controls ──
ipcMain.handle('setTitle',       (_e, title) => { if (win) win.setTitle(title); });
ipcMain.handle('setAlwaysOnTop', (_e, flag)  => { if (win) win.setAlwaysOnTop(flag); });
ipcMain.handle('openExternal',   (_e, url)   => {
  // Only ever hand off real web links to the OS — never file:, javascript:, etc.
  try {
    const u = new URL(String(url));
    if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.href);
  } catch { /* not a valid URL — ignore */ }
});

app.whenReady().then(() => {
  // Open/create the embedded SQLite database, apply the schema, and (on first
  // run) import any pre-existing JSON data — all automatically, no setup needed.
  db.init(app.getPath('userData'));
  createWindow();
});
app.on('window-all-closed', () => {
  db.close();   // checkpoint WAL + close handle cleanly
  if (process.platform !== 'darwin') app.quit();
});