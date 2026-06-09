const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const db   = require('./db');

let win;

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
  win.loadFile('index.html');

  win.on('close', () => {
    const b = win.getBounds();
    db.savePrefs({ width: b.width, height: b.height, x: b.x, y: b.y });
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

// ── Window controls ──
ipcMain.handle('setTitle',       (_e, title) => { if (win) win.setTitle(title); });
ipcMain.handle('setAlwaysOnTop', (_e, flag)  => { if (win) win.setAlwaysOnTop(flag); });
ipcMain.handle('openExternal',   (_e, url)   => { shell.openExternal(url); });

app.whenReady().then(() => {
  // Open/create the embedded SQLite database, apply the schema, and (on first
  // run) import any pre-existing JSON data — all automatically, no setup needed.
  db.init(app.getPath('userData'));
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
