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
const PASSWORD_MAX = 1024;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MS = 30_000;
const loginFailures = new Map();
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('invalid-login-placeholder', SALT_ROUNDS);

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
  const length = String(password || '').length;
  if (length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters.`;
  }
  if (length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
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
  return { ok: true, user: { id, username: uname, isAdmin: true } };
}

// Verify credentials and start a session. Generic error on any failure so we
// don't reveal whether the username exists.
function login(username, password) {
  const uname = String(username || '').trim();
  const failureKey = uname.toLowerCase();
  const failure = loginFailures.get(failureKey);
  if (failure?.blockedUntil > Date.now()) {
    const seconds = Math.ceil((failure.blockedUntil - Date.now()) / 1000);
    return { ok: false, error: `Too many attempts. Try again in ${seconds} seconds.` };
  }
  const user = uname ? db.getUserByUsername(uname) : null;
  const suppliedPassword = String(password || '').slice(0, PASSWORD_MAX + 1);
  const candidateHash = user?.is_active ? (user.password_hash || DUMMY_PASSWORD_HASH) : DUMMY_PASSWORD_HASH;
  const passwordMatches = bcrypt.compareSync(suppliedPassword.slice(0, PASSWORD_MAX), candidateHash);
  const ok = !!(user?.is_active && suppliedPassword.length <= PASSWORD_MAX && passwordMatches);
  if (!ok) {
    const count = (failure?.count || 0) + 1;
    loginFailures.set(failureKey, {
      count,
      blockedUntil: count >= MAX_LOGIN_FAILURES ? Date.now() + LOGIN_LOCK_MS : 0,
    });
    return { ok: false, error: 'Incorrect username or password.' };
  }

  loginFailures.delete(failureKey);
  session = { userId: user.id, username: user.username, isAdmin: !!user.is_admin };
  return { ok: true, user: { id: user.id, username: user.username, isAdmin: !!user.is_admin } };
}

function logout() {
  session = null;
  return { ok: true };
}

function currentUser() {
  return session ? { id: session.userId, username: session.username, isAdmin: !!session.isAdmin } : null;
}

function requireAdmin() {
  if (!session) throw new Error('Not authenticated');
  if (!session.isAdmin) throw new Error('Administrator access required');
  return session.userId;
}

function addUser(username, password) {
  requireAdmin();
  const uErr = validateUsername(username);
  if (uErr) return { ok: false, error: uErr };
  const pErr = validatePassword(password);
  if (pErr) return { ok: false, error: pErr };
  const uname = String(username).trim();
  try {
    const id = db.createUser(uname, bcrypt.hashSync(String(password), SALT_ROUNDS), false);
    return { ok: true, user: { id, username: uname, isAdmin: false } };
  } catch { return { ok: false, error: 'That username is already taken.' }; }
}

function changePassword(currentPassword, newPassword) {
  const userId = requireUserId();
  const pErr = validatePassword(newPassword);
  if (pErr) return { ok: false, error: pErr };
  const user = db.getUserById(userId);
  if (!user || !bcrypt.compareSync(String(currentPassword || ''), user.password_hash)) {
    return { ok: false, error: 'Current password is incorrect.' };
  }
  db.updateUserPassword(userId, bcrypt.hashSync(String(newPassword), SALT_ROUNDS));
  return { ok: true };
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
  status, setup, login, logout, currentUser, addUser, changePassword,
  requireUserId, requireAdmin, isAuthenticated,
};
