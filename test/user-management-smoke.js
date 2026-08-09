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

  const disabledAdmin = auth.updateUser(secondAdmin.user.id, { username: 'second-admin', isAdmin: true, isActive: false, actorPassword: 'primary-password' });
  const lastAdminGuard = auth.updateUser(setup.user.id, { username: 'primary-admin', isAdmin: false, isActive: true });
  const selfDisableGuard = auth.updateUser(setup.user.id, { username: 'primary-admin', isAdmin: true, isActive: false });
  record('The final active administrator cannot be demoted', disabledAdmin.ok && !lastAdminGuard.ok && /one active administrator/i.test(lastAdminGuard.error));
  record('The signed-in account cannot deactivate itself', !selfDisableGuard.ok && /cannot deactivate/i.test(selfDisableGuard.error));

  auth.updateUser(secondAdmin.user.id, { username: 'second-admin', isAdmin: true, isActive: true, actorPassword: 'primary-password' });

  // Re-auth for privileged actions on ANOTHER account
  // Phase 5): resetting someone else's password or changing their role/active
  // status must re-prove it's really the acting admin, not just that an admin
  // session happens to still be open. Uses a throwaway account so it doesn't
  // disturb `standard`'s password for the assertions further down.
  const resetTarget = auth.addUser('reset-target', 'reset-target-password', false);
  const missingActorPassword = auth.updateUser(resetTarget.user.id, { username: 'reset-target', password: 'admin-reset-password' });
  const wrongActorPassword = auth.updateUser(resetTarget.user.id, { username: 'reset-target', password: 'admin-reset-password', actorPassword: 'not-the-real-password' });
  const correctActorPassword = auth.updateUser(resetTarget.user.id, { username: 'reset-target', password: 'admin-reset-password', actorPassword: 'primary-password' });
  record('An admin resetting someone else\'s password without their own password is refused',
    !missingActorPassword.ok && /current password is required/i.test(missingActorPassword.error));
  record('An admin resetting someone else\'s password with the WRONG own password is refused',
    !wrongActorPassword.ok && /current password is required/i.test(wrongActorPassword.error));
  record('An admin resetting someone else\'s password with their OWN correct password succeeds', correctActorPassword.ok);
  const nonPrivilegedEdit = auth.updateUser(resetTarget.user.id, { username: 'reset-target', nameEn: 'Renamed By Admin' });
  record('An admin editing someone else\'s non-privileged fields (e.g. display name) does not require re-auth', nonPrivilegedEdit.ok);
  record('the password reset actually took effect (re-auth guard did not just no-op)',
    auth.login('reset-target', 'admin-reset-password').ok === true);

  // Forced password rotation: an
  // admin-assigned password — at account creation or at reset — is not one the
  // new owner chose, so login must flag it and a self-chosen change must clear
  // the flag again. (The prior step's login-as-reset-target call switched the
  // active session, so re-establish the admin session first.)
  auth.login('primary-admin', 'primary-password');
  const freshAccount = auth.addUser('rotation-target', 'admin-issued-password', false);
  record('An admin-created account is flagged to change its password on next login', freshAccount.user.mustChangePassword === true);
  const freshLogin = auth.login('rotation-target', 'admin-issued-password');
  record('Login surfaces the must-change-password flag for an admin-created account', freshLogin.ok && freshLogin.user.mustChangePassword === true);
  const selfChange = auth.updateUser(freshAccount.user.id, {
    username: 'rotation-target', password: 'self-chosen-password', currentPassword: 'admin-issued-password',
  });
  record('Choosing your own password clears the must-change-password flag', selfChange.ok && selfChange.user.mustChangePassword === false);
  auth.logout();
  const clearedLogin = auth.login('rotation-target', 'self-chosen-password');
  record('A subsequent login no longer carries the flag', clearedLogin.ok && clearedLogin.user.mustChangePassword === false);

  auth.login('primary-admin', 'primary-password');
  const adminReset = auth.updateUser(freshAccount.user.id, {
    username: 'rotation-target', password: 'admin-reissued-password', actorPassword: 'primary-password',
  });
  record('An admin resetting someone else\'s password re-flags it for rotation', adminReset.ok && adminReset.user.mustChangePassword === true);
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
