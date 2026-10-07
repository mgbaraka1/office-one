// Migration 073 — a database's own environment: Production or UAT.
//
//   client_databases.environment   'PRODUCTION' | 'TEST', default 'PRODUCTION'
//
// Same codes as client_servers.environment ('TEST' reads "UAT"). It is the
// database's own fact, not its server's: a production database can sit on a
// server recorded as UAT. Existing rows start from their server's environment,
// the best guess there is; a server still on a nullN placeholder gives
// PRODUCTION, the column default.
//
// ADD COLUMN keeps the table's triggers and indexes. The backfill UPDATE fires
// the workspace_search _au trigger, which only re-indexes the same row.
// Idempotent: column check, and the backfill runs only when the column is new.
module.exports = {
  version: 73,
  name: 'database_environment',
  destructive: false,
  up(db) {
    const hasColumn = db.prepare('PRAGMA table_info(client_databases)').all().some(c => c.name === 'environment');
    if (!hasColumn) {
      db.exec(`ALTER TABLE client_databases ADD COLUMN environment TEXT NOT NULL DEFAULT 'PRODUCTION'
                 CHECK(environment IN ('PRODUCTION', 'TEST'))`);
      db.exec(`UPDATE client_databases SET environment = 'TEST'
                WHERE server_id IN (SELECT id FROM client_servers WHERE environment = 'TEST')`);
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
