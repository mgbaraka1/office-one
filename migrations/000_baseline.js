// Migration 000 — baseline schema.
//
// This is the schema as it existed before the versioned-migration system was
// introduced. It uses CREATE TABLE IF NOT EXISTS so that:
//   • on a FRESH database it creates the original four tables, and
//   • on an EXISTING production database (which already has these tables) it is
//     a complete no-op — nothing is altered, no data is touched.
// Either way, recording version 0 as "applied" lets later migrations (auth,
// normalization, …) run on a known baseline.
module.exports = {
  version: 0,
  name: 'baseline',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS days (
        date TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        rows TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id           TEXT PRIMARY KEY,
        name         TEXT, cost TEXT, currency TEXT,
        billingCycle TEXT, endDate TEXT, renewalDate TEXT,
        sort_order   INTEGER
      );

      CREATE TABLE IF NOT EXISTS backlog (
        id          TEXT PRIMARY KEY,
        company     TEXT, project TEXT, natural TEXT, time TEXT,
        description TEXT, source TEXT,
        tags        TEXT,
        sort_order  INTEGER
      );

      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  },
};
