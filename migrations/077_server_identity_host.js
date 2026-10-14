// Migration 077 — two servers may share System + Role + Environment when their
// IPs differ.
//
//   idx_client_servers_identity   re-keyed onto (user, client, system, role,
//                                 environment, host), host case- and
//                                 space-insensitive like environment
//
// One client can run several servers of the same kind (five service servers
// of one system in Production, say), and the IP is what tells them apart. Servers
// with no IP still collide with each other on the triple alone, as before.
//
// Dropping and recreating an index is not data loss, and loosening a UNIQUE
// rule cannot fail on existing rows. Idempotent: DROP/CREATE IF (NOT) EXISTS,
// and the index is only rebuilt when it does not already key on host.
module.exports = {
  version: 77,
  name: 'server_identity_host',
  destructive: false,
  up(db) {
    const current = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_client_servers_identity'").get();
    if (!current || !/\bhost\b/.test(current.sql)) {
      db.exec('DROP INDEX IF EXISTS idx_client_servers_identity');
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_client_servers_identity
           ON client_servers(user_id, company_id, system_id, role_id, LOWER(TRIM(environment)), LOWER(TRIM(host)))`
      );
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
