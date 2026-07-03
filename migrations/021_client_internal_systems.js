// Migration 021 — Clients page gains an Internal Systems section.
//
// Adds `client_internal_systems`, a fifth per-client child table alongside
// `client_vpn_connections` (Auth), `client_servers` (Server Information),
// `client_databases` (Databases), and `client_external_services` (External
// Services). Holds internal web tools/portals reached by URL (e.g. an
// internal RabbitMQ management console) — a plain name/url/username/password
// login record, simpler than External Services (no company code / API key).
//
// Same conventions as its siblings: keyed to a COMPANY lookup row via
// `company_id`, carries `user_id`, plain-text fields only (no encryption
// layer anywhere in this app).
//
// Purely additive (one new table + index). Runs in the default migration
// transaction.
module.exports = {
  version: 21,
  name: 'client_internal_systems',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS client_internal_systems (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id),
        company_id  INTEGER NOT NULL REFERENCES lookup_codes(id),
        name        TEXT NOT NULL DEFAULT '',
        url         TEXT NOT NULL DEFAULT '',
        username    TEXT NOT NULL DEFAULT '',
        password    TEXT NOT NULL DEFAULT '',
        notes       TEXT NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_client_internal_systems_user_company ON client_internal_systems(user_id, company_id);
    `);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
