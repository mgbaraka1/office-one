// Migration 026 — additional reference fields across all 5 Clients tables.
//
// Chosen per-table based on what the existing shape was genuinely missing
// (Phase 2 of the Clients Visual Galaxy enhancement — see the per-table
// rationale in CLAUDE.md / the session's final report):
//   client_vpn_connections    + expiry_date, credential_location
//   client_servers            + role, port, credential_location
//   client_databases          + version, credential_location
//   client_external_services  + expiry_date, contact
//   client_internal_systems   + expiry_date, role
//
// All ten columns are nullable TEXT with no default — existing rows read
// back as NULL (the renderer already treats an absent field as "not set",
// same as every other optional field on these tables). Purely additive,
// idempotent (skips columns that already exist). Runs in the default
// migration transaction. Runs foreign_key_check after, per convention.
module.exports = {
  version: 26,
  name: 'client_extra_fields',
  up(db) {
    function addColumns(table, columns) {
      const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
      for (const name of columns) {
        if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT`);
      }
    }

    addColumns('client_vpn_connections', ['expiry_date', 'credential_location']);
    addColumns('client_servers', ['role', 'port', 'credential_location']);
    addColumns('client_databases', ['version', 'credential_location']);
    addColumns('client_external_services', ['expiry_date', 'contact']);
    addColumns('client_internal_systems', ['expiry_date', 'role']);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
