// ─────────────────────────────────────────────────────────────────────────────
// Authentication — runs entirely in the main process.
//
//   • Passwords are hashed with bcrypt (bcryptjs, a pure-JS implementation so the
//     app keeps its zero-native-modules property), saltRounds = 12. Plaintext is
//     never stored.
//   • The authenticated session (the current user's id + username) lives ONLY in
//     this module's memory in the main process — never in the renderer, never in
//     localStorage. The renderer learns who it is via IPC but cannot set it.
//   • No "remember me" / auto-login: the session starts empty every launch and a
//     user must log in explicitly. It is cleared on logout.
//
// IPC handlers in main.js call these functions; data handlers call
// `requireUserId()` to get the owner id for every query (never trusting a
// user_id sent from the renderer).
// ─────────────────────────────────────────────────────────────────────────────

const bcrypt = require('bcryptjs');
const db = require('./db');

const SALT_ROUNDS = 12;

// Validation rules (kept small + explicit so error messages can be precise).
const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const USERNAME_RE  = /^[A-Za-z0-9._-]+$/;
const PASSWORD_MIN = 8;
// bcrypt silently ignores bytes after the first 72. Enforce that exact UTF-8
// boundary before every hash/compare operation so two different strings can
// never become the same credential. This is a byte limit, not a JS character
// limit: non-ASCII characters may occupy more than one byte.
const PASSWORD_MAX_BYTES = 72;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MS = 30_000;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('invalid-login-placeholder', SALT_ROUNDS);

// Persisted in machine_prefs (this-machine-only, like window_prefs) so a
// lockout survives an app restart — restarting used to silently reset it.
function getLoginFailure(key) {
  return db.loadLoginFailures()[key];
}
function setLoginFailure(key, data) {
  const failures = db.loadLoginFailures();
  failures[key] = data;
  db.saveLoginFailures(failures);
}
function clearLoginFailure(key) {
  const failures = db.loadLoginFailures();
  if (!(key in failures)) return;
  delete failures[key];
  db.saveLoginFailures(failures);
}

// The single in-memory session for this process. null === not authenticated.
let session = null;   // { userId: number, username: string } | null

function validateUsername(username) {
  const u = String(username || '').trim();
  if (u.length < USERNAME_MIN || u.length > USERNAME_MAX) {
    return `Username must be ${USERNAME_MIN}–${USERNAME_MAX} characters.`;
  }
  if (!USERNAME_RE.test(u)) {
    return 'Username may only contain letters, numbers, and . _ -';
  }
  return null;
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters.`;
  }
  if (Buffer.byteLength(value, 'utf8') > PASSWORD_MAX_BYTES) {
    return `Password must be at most ${PASSWORD_MAX_BYTES} UTF-8 bytes.`;
  }
  return null;
}

// What the renderer needs to decide which gate to show on boot.
//   hasUsers      → false ⇒ show first-run setup; true ⇒ show login
//   authenticated → already logged in this session (always false on a fresh boot)
function status() {
  return {
    hasUsers: db.countUsers() > 0,
    authenticated: session !== null,
    username: session ? session.username : null,
  };
}

// First-run only: create the very first account and log into it. Refuses if any
// user already exists (the setup screen must never be a back-door to add users).
function setup(username, password) {
  if (db.countUsers() > 0) return { ok: false, error: 'An account already exists. Please log in.' };
  const uErr = validateUsername(username);
  if (uErr) return { ok: false, error: uErr };
  const pErr = validatePassword(password);
  if (pErr) return { ok: false, error: pErr };

  const uname = String(username).trim();
  const hash  = bcrypt.hashSync(String(password), SALT_ROUNDS);

  // If migration 002 left an inactive placeholder owning pre-existing data,
  // claim it in place so this first account inherits that data. Otherwise create
  // a brand-new account (fresh install).
  let id;
  try {
    const placeholder = db.getUnclaimedUser();
    if (placeholder) { db.claimUser(placeholder.id, uname, hash); id = placeholder.id; }
    else { id = db.createUser(uname, hash, true); }
  } catch { return { ok: false, error: 'That username is already taken.' }; }

  session = { userId: id, username: uname, isAdmin: true };
  return { ok: true, user: { id, username: uname, isAdmin: true, nameEn: '', nameAr: '' } };
}

// Verify credentials and start a session. Generic error on any failure so we
// don't reveal whether the username exists.
function login(username, password) {
  const uname = String(username || '').trim();
  const failureKey = uname.toLowerCase();
  const failure = getLoginFailure(failureKey);
  if (failure?.blockedUntil > Date.now()) {
    const seconds = Math.ceil((failure.blockedUntil - Date.now()) / 1000);
    return { ok: false, error: `Too many attempts. Try again in ${seconds} seconds.` };
  }
  const user = uname ? db.getUserByUsername(uname) : null;
  const suppliedPassword = String(password || '');
  const candidateHash = user?.is_active ? (user.password_hash || DUMMY_PASSWORD_HASH) : DUMMY_PASSWORD_HASH;
  const passwordWithinBcryptLimit = Buffer.byteLength(suppliedPassword, 'utf8') <= PASSWORD_MAX_BYTES;
  // Keep the dummy comparison for invalid/overlong input so the failure path
  // does not disclose whether the username exists or has a legacy long hash.
  const passwordMatches = bcrypt.compareSync(passwordWithinBcryptLimit ? suppliedPassword : '', candidateHash);
  const ok = !!(user?.is_active && passwordWithinBcryptLimit && passwordMatches);
  if (!ok) {
    const count = (failure?.count || 0) + 1;
    setLoginFailure(failureKey, {
      count,
      blockedUntil: count >= MAX_LOGIN_FAILURES ? Date.now() + LOGIN_LOCK_MS : 0,
    });
    return { ok: false, error: 'Incorrect username or password.' };
  }

  clearLoginFailure(failureKey);
  session = { userId: user.id, username: user.username, isAdmin: !!user.is_admin };
  const names = db.getUserDisplayName(user.id);
  return {
    ok: true,
    user: {
      id: user.id, username: user.username, isAdmin: !!user.is_admin,
      nameEn: names.nameEn, nameAr: names.nameAr,
      mustChangePassword: !!user.must_change_password,
    },
  };
}

function logout() {
  session = null;
  return { ok: true };
}

function currentUser() {
  if (!session) return null;
  const names = db.getUserDisplayName(session.userId);
  return { id: session.userId, username: session.username, isAdmin: !!session.isAdmin, nameEn: names.nameEn, nameAr: names.nameAr };
}

// The admin concept was removed: any authenticated account may perform any
// action, and changes are attributed rather than gated. `users.is_admin` is
// retained as an inert column (never deleted) and `session.isAdmin` still
// reflects it, but nothing reads either to decide whether an action is allowed.
//
// What replaced permission is attribution — see db.js's client_field_history
// and lookup_code_history, which record WHO made every shared-data change.

function userToApi(user) {
  if (!user) return null;
  const names = db.getUserDisplayName(Number(user.id));
  return {
    id: Number(user.id), username: user.username,
    nameEn: names.nameEn, nameAr: names.nameAr,
    isAdmin: !!(user.isAdmin ?? user.is_admin),
    isActive: !!(user.isActive ?? user.is_active),
    createdAt: user.createdAt ?? user.created_at ?? '',
    mustChangePassword: !!(user.mustChangePassword ?? user.must_change_password),
  };
}

// Every account, to every account. Previously a non-admin saw only itself.
function listUsers() {
  const userId = requireUserId();
  return db.listUsers().map(user => ({ ...userToApi(user), isCurrent: Number(user.id) === userId }));
}

function addUser(username, password, isAdmin = false, nameEn = '', nameAr = '') {
  requireUserId();
  const uErr = validateUsername(username);
  if (uErr) return { ok: false, error: uErr };
  const pErr = validatePassword(password);
  if (pErr) return { ok: false, error: pErr };
  const uname = String(username).trim();
  try {
    const adminRole = !!isAdmin;
    // An admin-created account starts with a password only the admin knows —
    // require the new owner to choose their own on first login.
    const id = db.createUser(uname, bcrypt.hashSync(String(password), SALT_ROUNDS), adminRole,
      String(nameEn || '').trim(), String(nameAr || '').trim(), true);
    return { ok: true, user: userToApi({ id, username: uname, isAdmin: adminRole, isActive: true, mustChangePassword: true }) };
  } catch { return { ok: false, error: 'That username is already taken.' }; }
}

function updateUser(id, data) {
  const actorId = requireUserId();
  const targetId = Number(id);
  const target = Number.isInteger(targetId) ? db.getUserById(targetId) : null;
  if (!target || target.username === '__unclaimed__') return { ok: false, error: 'Account not found.' };
  const isSelf = targetId === actorId;

  const username = String(data?.username ?? target.username).trim();
  const uErr = validateUsername(username);
  if (uErr) return { ok: false, error: uErr };

  const isAdmin = typeof data?.isAdmin === 'boolean' ? data.isAdmin : !!target.is_admin;
  const isActive = typeof data?.isActive === 'boolean' ? data.isActive : !!target.is_active;
  if (isSelf && !isActive) return { ok: false, error: 'You cannot deactivate your current account.' };
  // Integrity rule, not a permission check — see db.js's countActiveUsers().
  // There is no network password reset, so emptying the last active account
  // would lock everyone out of production with no in-app way back.
  if (target.is_active && !isActive && db.countActiveUsers() <= 1) {
    return { ok: false, error: 'At least one active account is required.' };
  }

  const password = String(data?.password || '');
  const rolePrivilegeChanged = isAdmin !== !!target.is_admin || isActive !== !!target.is_active;
  // Re-authentication, NOT a permission gate — deliberately kept, and now more
  // important than before: with the admin concept gone, *any* account can reset
  // another account's password or deactivate it. Proving it is really the owner
  // at the keyboard, rather than just an unlocked session someone walked up to,
  // is the control that replaces the role check that used to stand here.
  if (!isSelf && (password || rolePrivilegeChanged)) {
    const actor = db.getUserById(actorId);
    if (!actor || !bcrypt.compareSync(String(data?.actorPassword || ''), actor.password_hash)) {
      return { ok: false, error: 'Your current password is required to make this change.' };
    }
  }

  let passwordHash;
  let mustChangePassword;
  if (password) {
    const pErr = validatePassword(password);
    if (pErr) return { ok: false, error: pErr };
    if (isSelf) {
      if (!bcrypt.compareSync(String(data?.currentPassword || ''), target.password_hash)) {
        return { ok: false, error: 'Current password is incorrect.' };
      }
      // Chosen by its own owner — no further rotation required.
      mustChangePassword = false;
    } else {
      // A password assigned to someone else's account — same as at account
      // creation, its new owner must replace it on next login.
      mustChangePassword = true;
    }
    passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  }

  try {
    db.updateUserAccount(targetId, { username, isAdmin, isActive, passwordHash, mustChangePassword });
  } catch {
    return { ok: false, error: 'That username is already taken.' };
  }
  if (typeof data?.nameEn === 'string' || typeof data?.nameAr === 'string') {
    const current = db.getUserDisplayName(targetId);
    db.setUserDisplayName(
      targetId,
      typeof data.nameEn === 'string' ? data.nameEn : current.nameEn,
      typeof data.nameAr === 'string' ? data.nameAr : current.nameAr
    );
  }
  if (isSelf) session = { userId: actorId, username, isAdmin };
  return { ok: true, user: userToApi(db.getUserById(targetId)), currentUser: currentUser() };
}

// The id every data query must be scoped to. Throws when no one is logged in, so
// data IPC handlers fail closed rather than leaking/cross-writing data.
function requireUserId() {
  if (!session) throw new Error('Not authenticated');
  return session.userId;
}

function isAuthenticated() {
  return session !== null;
}

module.exports = {
  status, setup, login, logout, currentUser, listUsers, addUser, updateUser,
  requireUserId, isAuthenticated,
};
