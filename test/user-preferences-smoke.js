'use strict';

// Per-user preferences: theme/density/canvas/motion/
// sidebar/timesheet view used to live only in localStorage, which is
// machine-wide — on a shared PC, a second account inherited whatever the
// first account last chose. db.getUserPreferences/setUserPreference store
// these per-account instead (in the existing user_settings table). This
// suite proves isolation between two accounts and that new accounts get
// sane defaults, not another account's values.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const db = require('../db');
const auth = require('../auth');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-preferences-smoke-'));
const results = [];
const record = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
let exitCode = 0;

try {
  db.openConnection(workDir);
  db.applyMigrations();

  const admin = auth.setup('prefs-admin', 'primary-password');
  const standard = auth.addUser('prefs-standard', 'standard-password', false);

  const freshDefaults = db.getUserPreferences(standard.user.id);
  record('a new account gets sane defaults, not another account\'s values',
    freshDefaults.theme === 'light' && freshDefaults.density === 'balanced'
      && freshDefaults.canvas === 'calm' && freshDefaults.motion === 'reduced'
      && freshDefaults.sidebar === 'expanded' && freshDefaults.timesheetView === 'grouped',
    JSON.stringify(freshDefaults));

  db.setUserPreference(admin.user.id, 'theme', 'dark');
  db.setUserPreference(admin.user.id, 'sidebar', 'compact');
  db.setUserPreference(admin.user.id, 'timesheetView', 'flat');
  const adminPrefs = db.getUserPreferences(admin.user.id);
  const standardPrefsAfter = db.getUserPreferences(standard.user.id);
  record('one account\'s preference changes persist',
    adminPrefs.theme === 'dark' && adminPrefs.sidebar === 'compact' && adminPrefs.timesheetView === 'flat',
    JSON.stringify(adminPrefs));
  record('a second account on the same machine is unaffected by the first account\'s changes',
    standardPrefsAfter.theme === 'light' && standardPrefsAfter.sidebar === 'expanded' && standardPrefsAfter.timesheetView === 'grouped',
    JSON.stringify(standardPrefsAfter));

  let threwOnBadKey = false;
  try { db.setUserPreference(admin.user.id, 'notARealPreference', 'x'); } catch { threwOnBadKey = true; }
  let threwOnBadValue = false;
  try { db.setUserPreference(admin.user.id, 'theme', 'ultraviolet'); } catch { threwOnBadValue = true; }
  record('an unknown preference key is rejected', threwOnBadKey);
  record('a value outside the allowlist is rejected', threwOnBadValue);
  const adminPrefsAfterRejections = db.getUserPreferences(admin.user.id);
  record('a rejected write leaves prior preferences untouched',
    adminPrefsAfterRejections.theme === 'dark', JSON.stringify(adminPrefsAfterRejections));

  // Settings → Pages: the pages an account switched off.
  record('a new account shows every page', freshDefaults.hiddenPages === '', JSON.stringify(freshDefaults.hiddenPages));
  db.setUserPreference(admin.user.id, 'hiddenPages', ' outsource,all-tasks,outsource ');
  record('hidden pages are stored in menu order with no repeats',
    db.getUserPreferences(admin.user.id).hiddenPages === 'all-tasks,outsource',
    db.getUserPreferences(admin.user.id).hiddenPages);
  record('one account hiding pages leaves another account\'s menu alone',
    db.getUserPreferences(standard.user.id).hiddenPages === '');
  let threwOnUnknownPage = false;
  try { db.setUserPreference(admin.user.id, 'hiddenPages', 'pfm,settings'); } catch { threwOnUnknownPage = true; }
  let threwOnOverview = false;
  try { db.setUserPreference(admin.user.id, 'hiddenPages', 'analytics'); } catch { threwOnOverview = true; }
  record('Settings and Overview cannot be hidden, nor a page that does not exist',
    threwOnUnknownPage && threwOnOverview && db.getUserPreferences(admin.user.id).hiddenPages === 'all-tasks,outsource');
  db.setUserPreference(admin.user.id, 'hiddenPages', '');
  record('showing every page again clears the list', db.getUserPreferences(admin.user.id).hiddenPages === '');
} catch (error) {
  console.error(error.stack || error);
  exitCode = 2;
} finally {
  try { auth.logout(); } catch {}
  try { db.close(); } catch {}
  fs.rmSync(workDir, { recursive: true, force: true });
}

for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` (${result.detail})` : ''}`);
if (results.some(result => !result.pass)) exitCode = 1;
process.exit(exitCode);
