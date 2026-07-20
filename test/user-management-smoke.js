'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const db = require('../db');
const auth = require('../auth');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-management-smoke-'));
const results = [];
const record = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
let exitCode = 0;

try {
  db.openConnection(workDir);
  db.applyMigrations();

  const setup = auth.setup('primary-admin', 'primary-password');
  const standard = auth.addUser('standard-user', 'standard-password', false);
  const secondAdmin = auth.addUser('second-admin', 'second-password', true);
  const adminList = auth.listUsers();
  record('Administrator can create both Standard User and Administrator accounts',
    setup.ok && standard.ok && !standard.user.isAdmin && secondAdmin.ok && secondAdmin.user.isAdmin);
  record('Administrator sees every managed account without password hashes',
    adminList.length === 3 && adminList.every(user => !('password_hash' in user) && !('passwordHash' in user)));

  const disabledAdmin = auth.updateUser(secondAdmin.user.id, { username: 'second-admin', isAdmin: true, isActive: false });
  const lastAdminGuard = auth.updateUser(setup.user.id, { username: 'primary-admin', isAdmin: false, isActive: true });
  const selfDisableGuard = auth.updateUser(setup.user.id, { username: 'primary-admin', isAdmin: true, isActive: false });
  record('The final active administrator cannot be demoted', disabledAdmin.ok && !lastAdminGuard.ok && /one active administrator/i.test(lastAdminGuard.error));
  record('The signed-in account cannot deactivate itself', !selfDisableGuard.ok && /cannot deactivate/i.test(selfDisableGuard.error));

  auth.updateUser(secondAdmin.user.id, { username: 'second-admin', isAdmin: true, isActive: true });
  auth.logout();
  auth.login('standard-user', 'standard-password');
  const standardList = auth.listUsers();
  const crossEdit = auth.updateUser(secondAdmin.user.id, { username: 'hijacked' });
  const noCurrentPassword = auth.updateUser(standard.user.id, {
    username: 'standard-user', password: 'replacement-password', currentPassword: 'wrong-password',
  });
  const ownEdit = auth.updateUser(standard.user.id, {
    username: 'renamed-user', password: 'replacement-password', currentPassword: 'standard-password',
    isAdmin: true, isActive: false,
  });
  record('Standard users see and edit only their own account',
    standardList.length === 1 && standardList[0].isCurrent && !crossEdit.ok);
  record('Changing your own password requires the current password', !noCurrentPassword.ok && /incorrect/i.test(noCurrentPassword.error));
  record('A standard user can rename their account and change its password without elevating permissions',
    ownEdit.ok && ownEdit.user.username === 'renamed-user' && !ownEdit.user.isAdmin && ownEdit.user.isActive);
  auth.logout();
  record('The edited credentials authenticate and the old username no longer does',
    auth.login('standard-user', 'replacement-password').ok === false
      && auth.login('renamed-user', 'replacement-password').ok === true);
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
