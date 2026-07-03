// Migration 017 — Clients page (VPN connectivity + server information).
//
// Adds two small child tables holding per-client technical reference info,
// each keyed to an existing `COMPANY` lookup row (the app's one shared concept
// of "client" — see `project_companies`). There is deliberately NO new
// `clients` table: the client roster IS the active COMPANY lookup catalog
// (managed from Settings → Companies, same as everywhere else in the app).
// This keeps the model minimal and avoids a second, driftable client list.
//
// `client_vpn_connections` and `client_servers` both carry `user_id` (private
// per-user notes about a shared client, consistent with every other data
// table — company_documents/projects/tasks all follow this even though they
// reference the shared COMPANY catalog too). `environment` on client_servers
// is a plain hardcoded code ('PRODUCTION'/'TEST') — not lookup-driven, since
// this page is explicitly scoped to stay minimal and it's a small, stable,
// binary distinction (unlike e.g. project status, which many things filter/
// group by).
//
// Purely additive (two new tables + indexes). Runs in the default migration
// transaction.
module.exports = {
  version: 17,
  name: 'client_infra',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS client_vpn_connections (
        id              INTEGER PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        company_id      INTEGER NOT NULL REFERENCES lookup_codes(id),
        connection_name TEXT NOT NULL DEFAULT '',
        vpn_type        TEXT NOT NULL DEFAULT '',
        endpoint        TEXT NOT NULL DEFAULT '',
        notes           TEXT NOT NULL DEFAULT '',
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_client_vpn_user_company ON client_vpn_connections(user_id, company_id);

      CREATE TABLE IF NOT EXISTS client_servers (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id),
        company_id  INTEGER NOT NULL REFERENCES lookup_codes(id),
        server_name TEXT NOT NULL DEFAULT '',
        host        TEXT NOT NULL DEFAULT '',
        environment TEXT NOT NULL DEFAULT '',
        os          TEXT NOT NULL DEFAULT '',
        notes       TEXT NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_client_servers_user_company ON client_servers(user_id, company_id);
    `);

    // Integrity: every FK must still point at a real row (or be NULL).
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
