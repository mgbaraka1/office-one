// Migration 019 — Clients page gains a Databases section.
//
// Adds `client_databases`, a third per-client child table alongside
// `client_vpn_connections` (the "Auth" section) and `client_servers`. Same
// shape/conventions as those: keyed to a COMPANY lookup row via `company_id`,
// carries `user_id` (private per-user reference records), plain-text fields
// only (there is no encryption layer anywhere in this app).
//
// Purely additive (one new table + index). Runs in the default migration
// transaction.
module.exports = {
  version: 19,
  name: 'client_databases',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS client_databases (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id),
        company_id  INTEGER NOT NULL REFERENCES lookup_codes(id),
        name        TEXT NOT NULL DEFAULT '',
        engine      TEXT NOT NULL DEFAULT '',
        host        TEXT NOT NULL DEFAULT '',
        port        TEXT NOT NULL DEFAULT '',
        username    TEXT NOT NULL DEFAULT '',
        password    TEXT NOT NULL DEFAULT '',
        notes       TEXT NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_client_databases_user_company ON client_databases(user_id, company_id);
    `);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
