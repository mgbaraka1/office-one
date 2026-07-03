// Migration 022 — Servers gain Hostname/Username/Password fields.
//
// `client_servers` only tracked host (IP), environment, and OS — no login
// credentials and no separate hostname (distinct from the IP). This adds
// three columns so a server record can carry its own login, mirroring what
// migration 018 did for `client_vpn_connections`.
//
// Stored as plain text, consistent with the rest of the DB (there is no
// encryption layer anywhere in this app).
//
// Purely additive (three nullable columns, no rewrite/rename/drop).
// Runs in the default migration transaction.
module.exports = {
  version: 22,
  name: 'client_server_credentials',
  up(db) {
    const existing = new Set(
      db.prepare('PRAGMA table_info(client_servers)').all().map(c => c.name)
    );
    const NEW_COLUMNS = [
      ['hostname', 'TEXT'],
      ['username', 'TEXT'],
      ['password', 'TEXT'],
    ];
    for (const [name, type] of NEW_COLUMNS) {
      if (!existing.has(name)) db.exec(`ALTER TABLE client_servers ADD COLUMN ${name} ${type}`);
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
