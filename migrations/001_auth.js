// Migration 001 — authentication.
//
// Introduces the `users` table. Each team member has exactly one account; all
// data tables gain a `user_id` owner in migration 002. Passwords are never
// stored in plaintext — only a bcrypt hash (see auth.js, saltRounds 12).
module.exports = {
  version: 1,
  name: 'auth',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        is_active     INTEGER NOT NULL DEFAULT 1
      );
    `);
  },
};
