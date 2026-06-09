const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

const DATA_DIR     = path.join(app.getPath('userData'), 'days');
const LOOKUPS_FILE = path.join(app.getPath('userData'), 'lookups.json');
const PREFS_FILE   = path.join(app.getPath('userData'), 'prefs.json');
const SUBS_FILE    = path.join(app.getPath('userData'), 'subscriptions.json');
const LICENSES_FILE = path.join(app.getPath('userData'), 'licenses.json');
const INSURANCE_FILE = path.join(app.getPath('userData'), 'insurance.json');

const DEFAULT_INSURANCE = { insurance: [] };

const DEFAULT_SUBSCRIPTIONS = { subscriptions: [] };

// Seed data transcribed from the user's existing tracking spreadsheet — written to
// disk only the first time (when licenses.json doesn't exist yet), never overwrites.
const DEFAULT_LICENSES = { licenses: [
] };

const DEFAULT_LOOKUPS = {
  companies: ['Acme', 'Contoso', 'Fabrikam', 'Globex', 'ACME', 'Example Holding', 'Initech', 'Umbrella Care', 'Tailspin'],
  projects:  ['Travel', 'Online Platform', 'Data Hub', 'QA Test', 'Uploader', 'BILLING Travel', 'Payment Gateway', '-'],
  natural:   ['Ticket', 'Task', 'Meeting', 'Call', '-'],
  timeType:  ['Work Time', 'Over Time', 'Training', 'Leave', 'Holiday'],
  status:    ['Done', 'In Progress', 'Not Yet'],
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function dayFile(dateStr) {
  return path.join(DATA_DIR, `${dateStr}.json`);
}

// Write to .tmp then rename — atomic, preserves .bak on each successful write
function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  const bak = filePath + '.bak';
  fs.writeFileSync(tmp, content, 'utf-8');
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, bak);
  fs.renameSync(tmp, filePath);
}

function loadPrefs() {
  if (!fs.existsSync(PREFS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8')); }
  catch { return {}; }
}

function savePrefs(prefs) {
  try { fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf-8'); }
  catch { /* non-critical */ }
}

let win;

function createWindow() {
  const prefs = loadPrefs();
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
    savePrefs({ width: b.width, height: b.height, x: b.x, y: b.y });
  });
}

// ── Days ──
ipcMain.handle('saveDay', (_e, dateStr, data) => {
  ensureDir();
  atomicWrite(dayFile(dateStr), JSON.stringify(data, null, 2));
});

ipcMain.handle('loadDay', (_e, dateStr) => {
  const f = dayFile(dateStr);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')); }
  catch {
    // Attempt recovery from backup
    const bak = f + '.bak';
    if (fs.existsSync(bak)) {
      try { return JSON.parse(fs.readFileSync(bak, 'utf-8')); }
      catch { return null; }
    }
    return null;
  }
});

ipcMain.handle('listDays', () => {
  ensureDir();
  return fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => f.replace('.json', ''))
    .sort((a, b) => b.localeCompare(a));
});

// ── Lookups ──
ipcMain.handle('loadLookups', () => {
  if (!fs.existsSync(LOOKUPS_FILE)) return DEFAULT_LOOKUPS;
  try { return JSON.parse(fs.readFileSync(LOOKUPS_FILE, 'utf-8')); }
  catch { return DEFAULT_LOOKUPS; }
});

ipcMain.handle('saveLookups', (_e, data) => {
  atomicWrite(LOOKUPS_FILE, JSON.stringify(data, null, 2));
});

// ── Subscriptions ──
ipcMain.handle('loadSubscriptions', () => {
  if (!fs.existsSync(SUBS_FILE)) return DEFAULT_SUBSCRIPTIONS;
  try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf-8')); }
  catch {
    const bak = SUBS_FILE + '.bak';
    if (fs.existsSync(bak)) {
      try { return JSON.parse(fs.readFileSync(bak, 'utf-8')); }
      catch { return DEFAULT_SUBSCRIPTIONS; }
    }
    return DEFAULT_SUBSCRIPTIONS;
  }
});

ipcMain.handle('saveSubscriptions', (_e, data) => {
  atomicWrite(SUBS_FILE, JSON.stringify(data, null, 2));
});

// ── Licenses ──
ipcMain.handle('loadLicenses', () => {
  if (!fs.existsSync(LICENSES_FILE)) {
    // First run: seed from the user's existing tracking sheet, then persist it.
    atomicWrite(LICENSES_FILE, JSON.stringify(DEFAULT_LICENSES, null, 2));
    return DEFAULT_LICENSES;
  }
  try { return JSON.parse(fs.readFileSync(LICENSES_FILE, 'utf-8')); }
  catch {
    const bak = LICENSES_FILE + '.bak';
    if (fs.existsSync(bak)) {
      try { return JSON.parse(fs.readFileSync(bak, 'utf-8')); }
      catch { return DEFAULT_LICENSES; }
    }
    return DEFAULT_LICENSES;
  }
});

ipcMain.handle('saveLicenses', (_e, data) => {
  atomicWrite(LICENSES_FILE, JSON.stringify(data, null, 2));
});

// ── Insurance ──
ipcMain.handle('loadInsurance', () => {
  if (!fs.existsSync(INSURANCE_FILE)) return DEFAULT_INSURANCE;
  try { return JSON.parse(fs.readFileSync(INSURANCE_FILE, 'utf-8')); }
  catch {
    const bak = INSURANCE_FILE + '.bak';
    if (fs.existsSync(bak)) {
      try { return JSON.parse(fs.readFileSync(bak, 'utf-8')); }
      catch { return DEFAULT_INSURANCE; }
    }
    return DEFAULT_INSURANCE;
  }
});

ipcMain.handle('saveInsurance', (_e, data) => {
  atomicWrite(INSURANCE_FILE, JSON.stringify(data, null, 2));
});

// ── Window controls ──
ipcMain.handle('setTitle',       (_e, title) => { if (win) win.setTitle(title); });
ipcMain.handle('setAlwaysOnTop', (_e, flag)  => { if (win) win.setAlwaysOnTop(flag); });
ipcMain.handle('openExternal',   (_e, url)   => { shell.openExternal(url); });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
