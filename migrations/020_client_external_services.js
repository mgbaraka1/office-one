// Migration 020 — Clients page gains an External Services section.
//
// Adds `client_external_services`, a fourth per-client child table alongside
// `client_vpn_connections` (Auth), `client_servers` (Server Information), and
// `client_databases` (Databases). Holds third-party API integration details
// (e.g. a government/partner API endpoint) — shape differs from the others
// since these are keyed by URL/company-code/secret-key rather than
// host/port/username/password.
//
// Same conventions as its siblings: keyed to a COMPANY lookup row via
// `company_id`, carries `user_id`, plain-text fields only (no encryption
// layer anywhere in this app).
//
// Purely additive (one new table + index). Runs in the default migration
// transaction.
module.exports = {
  version: 20,
  name: 'client_external_services',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS client_external_services (
        id           INTEGER PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id),
        company_id   INTEGER NOT NULL REFERENCES lookup_codes(id),
        name         TEXT NOT NULL DEFAULT '',
        url          TEXT NOT NULL DEFAULT '',
        company_code TEXT NOT NULL DEFAULT '',
        secret_key   TEXT NOT NULL DEFAULT '',
        notes        TEXT NOT NULL DEFAULT '',
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_client_external_services_user_company ON client_external_services(user_id, company_id);
    `);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
