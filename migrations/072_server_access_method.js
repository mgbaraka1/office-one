// Migration 072 — how a server is reached: directly (RDP) or only through PAM.
//
//   client_servers.access_method   'RDP' | 'PAM', default 'RDP'
//
// A PAM server's login lives in the PAM vault, so the app hides its username
// and password. Any already stored stay in place, untouched, so switching a
// server back to RDP brings them back.
//
// ADD COLUMN keeps the table's triggers and indexes. Every existing server
// starts as RDP, which is how they were all being used. Idempotent: column check.
module.exports = {
  version: 72,
  name: 'server_access_method',
  destructive: false,
  up(db) {
    const hasColumn = db.prepare('PRAGMA table_info(client_servers)').all().some(c => c.name === 'access_method');
    if (!hasColumn) {
      db.exec("ALTER TABLE client_servers ADD COLUMN access_method TEXT NOT NULL DEFAULT 'RDP' CHECK(access_method IN ('RDP', 'PAM'))");
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
