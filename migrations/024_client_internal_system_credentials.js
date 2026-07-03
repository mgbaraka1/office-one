// Migration 024 — Internal Systems gain Company Code/Secret Key fields.
//
// `client_internal_systems` only tracked a plain username/password login —
// no room for a third-party API integration's own client code / secret key
// (the shape `client_external_services` already has). This adds two columns
// so an External Services-style record (URL + companyCode + secretKey) can
// be represented as an Internal System too, e.g. when it belongs to a
// System group (migration 023) alongside servers/portals.
//
// Stored as plain text, consistent with the rest of the DB (there is no
// encryption layer anywhere in this app).
//
// Purely additive (two nullable columns, no rewrite/rename/drop).
// Runs in the default migration transaction.
module.exports = {
  version: 24,
  name: 'client_internal_system_credentials',
  up(db) {
    const existing = new Set(
      db.prepare('PRAGMA table_info(client_internal_systems)').all().map(c => c.name)
    );
    const NEW_COLUMNS = [
      ['company_code', 'TEXT'],
      ['secret_key', 'TEXT'],
    ];
    for (const [name, type] of NEW_COLUMNS) {
      if (!existing.has(name)) db.exec(`ALTER TABLE client_internal_systems ADD COLUMN ${name} ${type}`);
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
