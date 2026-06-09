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
  { id: 'lic_seed_01', item: 'السجل التجاري',                                   type: 'Governmental',         extras: [], docNumber: '1010225881',         issueDateHijri: '07-11-1445', expiryDateHijri: '16-12-1448', issueDate: '2024-05-15', expiryDate: '2027-05-14', notes: '' },
  { id: 'lic_seed_02', item: 'غرفة السعودة ( شهادة التوطين )',                   type: 'Governmental',         extras: [], docNumber: '384801-10203570',     issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2025-05-15', expiryDate: '2025-08-13', notes: '' },
  { id: 'lic_seed_03', item: 'غرفة الرياض ( الغرفة التجارية )',                  type: 'Governmental',         extras: [], docNumber: '173342',              issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2006-12-11', expiryDate: '2027-05-22', notes: '' },
  { id: 'lic_seed_04', item: 'الهيئة العامة للذكاء والدخل ( هيئة الزكاة والضريبة والجمارك )', type: 'Governmental', extras: [], docNumber: '1026578259', issueDateHijri: '06-05-1447', expiryDateHijri: '29-04-1448', issueDate: '2025-10-19', expiryDate: '2026-10-10', notes: '' },
  { id: 'lic_seed_05', item: 'شهادة التأمينات الاجتماعية',                       type: 'Governmental',         extras: [], docNumber: '110309257',           issueDateHijri: '12-09-1447', expiryDateHijri: '13-10-1447', issueDate: '2026-03-01', expiryDate: '2026-04-01', notes: '' },
  { id: 'lic_seed_06', item: 'تأمين سيارة كامري 2020',                           type: 'Car Insurance',        extras: [{ label: 'Car Plate', value: 'د ل ر 8535' }], docNumber: '',          issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2026-05-20', expiryDate: '2027-05-19', notes: 'احمد جمال' },
  { id: 'lic_seed_07', item: 'فحص السيارة الكامري',                              type: 'Other',                extras: [], docNumber: '',                    issueDateHijri: '',           expiryDateHijri: '',           issueDate: '',           expiryDate: '',           notes: '' },
  { id: 'lic_seed_08', item: 'تأمين سيارة الكورولا',                             type: 'Car Insurance',        extras: [{ label: 'Car Plate', value: 'ر ب د 8860' }], docNumber: '',          issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2026-02-23', expiryDate: '2027-02-22', notes: 'إبراهيم صلاح' },
  { id: 'lic_seed_09', item: 'تأمين طبي المؤسسة',                                type: 'Medical Insurance',    extras: [], docNumber: '',                    issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2026-02-12', expiryDate: '',           notes: 'تاريخ الانتهاء غير معلوم' },
  { id: 'lic_seed_10', item: 'تجديد سيرفر اونلاين ( OVHcloud )',                 type: 'Service/Subscription', extras: [], docNumber: '',                    issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2026-05-01', expiryDate: '2026-06-01', notes: '' },
  { id: 'lic_seed_11', item: 'تجديد موقع المؤسسة',                               type: 'Service/Subscription', extras: [], docNumber: '',                    issueDateHijri: '',           expiryDateHijri: '',           issueDate: '',           expiryDate: '',           notes: '' },
  { id: 'lic_seed_12', item: 'تأمين الراف فور 2023',                             type: 'Car Insurance',        extras: [], docNumber: '',                    issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2023-05-18', expiryDate: '2024-05-17', notes: 'م. جمال عزب' },
  { id: 'lic_seed_13', item: 'تامين طبي م. جمال',                                type: 'Medical Insurance',    extras: [{ label: 'Provider', value: 'شركة امانة' }], docNumber: '6300334389',  issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2026-02-09', expiryDate: '2027-02-09', notes: '' },
  { id: 'lic_seed_14', item: 'تامين طبي السيد جمال',                             type: 'Medical Insurance',    extras: [{ label: 'Provider', value: 'شركة الدرع' }], docNumber: '5260014783',  issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2026-02-09', expiryDate: '2027-02-09', notes: '' },
  { id: 'lic_seed_15', item: 'تامين طبي اسامة جمال',                             type: 'Medical Insurance',    extras: [{ label: 'Provider', value: 'شركة الدرع' }], docNumber: '5260014787',  issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2026-02-09', expiryDate: '2027-02-09', notes: '' },
  { id: 'lic_seed_16', item: 'تامين طبي زوجة م. جمال',                           type: 'Medical Insurance',    extras: [{ label: 'Provider', value: 'شركة امانة' }], docNumber: '6300334419',  issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2026-02-09', expiryDate: '2027-02-09', notes: '' },
  { id: 'lic_seed_17', item: 'فاتورة جيرا support ( Atlassian )',                type: 'Service/Subscription', extras: [], docNumber: '',                    issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2026-05-26', expiryDate: '2026-06-25', notes: '' },
  { id: 'lic_seed_18', item: 'فاتورة جيرا مهام ( Atlassian )',                   type: 'Service/Subscription', extras: [], docNumber: '',                    issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2026-05-26', expiryDate: '2026-06-26', notes: '' },
  { id: 'lic_seed_19', item: 'ايجار المكتب',                                     type: 'Other',                extras: [], docNumber: '',                    issueDateHijri: '',           expiryDateHijri: '',           issueDate: '2025-08-01', expiryDate: '2026-07-31', notes: '' },
] };

const DEFAULT_LOOKUPS = {
  companies: ['Amana', 'Arabia', 'Liva', 'Maknanah', 'ACME', 'Elm Almaknanah', 'AJT', 'Saudi Enaya', 'Salama'],
  projects:  ['Visa', 'Online Platform', 'Data Hub', 'QA Test', 'Uploader', 'BILLING Visa', 'Payment Gateway', '-'],
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
