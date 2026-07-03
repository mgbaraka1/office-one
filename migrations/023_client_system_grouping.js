// Migration 023 — Clients page gains System grouping (e.g. "RabbitMQ").
//
// A Server and an Internal System (portal) that belong to the same logical
// system previously had no link between them — "RabbitMQ - Production" (a
// server) and "RabbitMQ Portal - Production" (an internal system) were just
// two unrelated free-text names. This adds:
//   client_servers.system_name          — free text, e.g. 'RabbitMQ'
//   client_internal_systems.system_name — free text, matched against the above
//   client_internal_systems.environment — 'PRODUCTION' | 'TEST' | '' (same
//                                          hardcoded codes client_servers uses),
//                                          so a portal can be paired with the
//                                          server sharing its system_name AND
//                                          environment.
//
// A record with an empty system_name is unaffected — it keeps rendering in
// the flat Servers/Internal Systems lists exactly as before. Only records
// that share a non-empty system_name (case-insensitively) get pulled into a
// grouped "Systems" view, split into one page per environment.
//
// Purely additive (three nullable columns across two tables, no rewrite/
// rename/drop). Runs in the default migration transaction.
module.exports = {
  version: 23,
  name: 'client_system_grouping',
  up(db) {
    const srvCols = new Set(db.prepare('PRAGMA table_info(client_servers)').all().map(c => c.name));
    if (!srvCols.has('system_name')) db.exec(`ALTER TABLE client_servers ADD COLUMN system_name TEXT`);

    const intCols = new Set(db.prepare('PRAGMA table_info(client_internal_systems)').all().map(c => c.name));
    if (!intCols.has('system_name')) db.exec(`ALTER TABLE client_internal_systems ADD COLUMN system_name TEXT`);
    if (!intCols.has('environment')) db.exec(`ALTER TABLE client_internal_systems ADD COLUMN environment TEXT`);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
