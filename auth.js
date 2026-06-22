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
  if (String(password || '').length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters.`;
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
    else { id = db.createUser(uname, hash); }
  } catch { return { ok: false, error: 'That username is already taken.' }; }

  session = { userId: id, username: uname };
  return { ok: true, user: { id, username: uname } };
}

// Verify credentials and start a session. Generic error on any failure so we
// don't reveal whether the username exists.
function login(username, password) {
  const uname = String(username || '').trim();
  const user = uname ? db.getUserByUsername(uname) : null;
  const ok = user && user.is_active && bcrypt.compareSync(String(password || ''), user.password_hash);
  if (!ok) return { ok: false, error: 'Incorrect username or password.' };

  session = { userId: user.id, username: user.username };
  return { ok: true, user: { id: user.id, username: user.username } };
}

function logout() {
  session = null;
  return { ok: true };
}

function currentUser() {
  return session ? { id: session.userId, username: session.username } : null;
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
  status, setup, login, logout, currentUser,
  requireUserId, isAuthenticated,
};
