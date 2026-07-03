// Migration 018 — VPN connections gain Port/Username/Password fields.
//
// The Clients page's "no credentials/secrets" scope (see 017) turned out to be
// too narrow for real usage: teams need to record the actual login for a
// client's VPN, not just reference notes. This adds three columns to
// `client_vpn_connections` so that information has real fields instead of
// being pasted into free-text `notes`.
//
// Stored as plain text, consistent with the rest of the DB (there is no
// encryption layer anywhere in this app — the whole file is protected only by
// OS-level file permissions on the single-user machine it lives on).
//
// Purely additive (three nullable columns, no rewrite/rename/drop).
// Runs in the default migration transaction.
module.exports = {
  version: 18,
  name: 'client_vpn_credentials',
  up(db) {
    const existing = new Set(
      db.prepare('PRAGMA table_info(client_vpn_connections)').all().map(c => c.name)
    );
    const NEW_COLUMNS = [
      ['port',     'TEXT'],
      ['username', 'TEXT'],
      ['password', 'TEXT'],
    ];
    for (const [name, type] of NEW_COLUMNS) {
      if (!existing.has(name)) db.exec(`ALTER TABLE client_vpn_connections ADD COLUMN ${name} ${type}`);
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
