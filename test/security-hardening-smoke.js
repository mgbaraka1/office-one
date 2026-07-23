'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const db = require('../db');
const auth = require('../auth');

const sourceDir = path.join(os.homedir(), 'AppData', 'Roaming', 'timesheet');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-hardening-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = path.join(sourceDir, 'cooperation-tools.db' + suffix);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}

const results = [];
const record = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
let exitCode = 0;
try {
  db.openConnection(workDir);
  db.applyMigrations();
  const user = db.getUserByUsername('fixture-user');
  const otherId = db.createUser('security-other', bcrypt.hashSync('other-password', 4), false);

  db.saveSubscriptions(user.id, { subscriptions: [{ id: 'owned-sub', name: 'Owned', cost: 1, currency: 'USD', billingCycle: 'MONTHLY' }] });
  let crossUserBlocked = false;
  try { db.saveSubscriptions(otherId, { subscriptions: [{ id: 'owned-sub', name: 'Stolen', cost: 9, currency: 'USD', billingCycle: 'MONTHLY' }] }); }
  catch { crossUserBlocked = true; }
  record('Subscription upsert cannot overwrite another user by id',
    crossUserBlocked && db.loadSubscriptions(user.id).subscriptions[0]?.name === 'Owned');

  const project = db.createProject(user.id, { name: 'Security project', status: 'ACTIVE', category: 'NEW_PROJECT' });
  const fakePdf = path.join(workDir, 'safe.pdf');
  fs.writeFileSync(fakePdf, '%PDF-1.7 security smoke');
  const traversal = db.saveProjectDocumentFile(user.id, project.id, '../outside', fakePdf);
  record('Project document type cannot traverse outside its directory', traversal.ok === false, traversal.error);

  const task = db.createTask(user.id, { name: 'Validation task', status: 'OPEN' });
  let invalidDateBlocked = false, invalidMinutesBlocked = false;
  try { db.addWorkLog(user.id, task.id, { date: 'not-a-date', minutes: 5 }); } catch { invalidDateBlocked = true; }
  try { db.addWorkLog(user.id, task.id, { date: '2099-01-01', minutes: 0 }); } catch { invalidMinutesBlocked = true; }
  record('Invalid work-log date is rejected instead of changed to today', invalidDateBlocked);
  record('Work-log minutes must be an integer from 1 to 1440', invalidMinutesBlocked);

  fs.mkdirSync(path.join(workDir, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(workDir, 'backups', 'cooperation-tools-invalid.db'), 'not sqlite');
  const invalidRestore = db.restoreBackup('cooperation-tools-invalid.db');
  const invalidRestoreBlocked = invalidRestore?.ok === false;
  record('Restore validates the candidate before replacing the live DB', invalidRestoreBlocked);

  db.configureCredentialEncryption(null);
  db.disallowPlaintextCredentialsForTests();
  let plaintextBlocked = false;
  const companyId = db.getLookupsByCategory('COMPANY').find(x => x.isActive)?.id;
  try { db.createClientVpn(user.id, companyId, { connectionName: 'Blocked secret', password: 'must-not-leak' }); }
  catch { plaintextBlocked = true; }
  record('Credential writes fail closed when secure storage is unavailable', plaintextBlocked);
  db.allowPlaintextCredentialsForTests();

  const login = auth.login('fixture-user', 'fixture-password');
  const add = auth.addUser('created-by-admin', 'secure-password');
  const changed = auth.changePassword('fixture-password', 'new-fixture-password');
  auth.logout();
  const relogin = auth.login('fixture-user', 'new-fixture-password');
  record('Admin can add an isolated account', login.ok && add.ok && add.user.isAdmin === false);
  record('A user can change and reuse their own password', changed.ok && relogin.ok);
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
