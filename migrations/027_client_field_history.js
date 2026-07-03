// Migration 027 — audit trail for edits to existing Clients-page records.
//
// Adds one new, purely additive table: `client_field_history`. A row is
// written for every field that actually changed on an UPDATE to any of the
// five client_* tables (client_vpn_connections/servers/databases/
// external_services/internal_systems) — never on create, never on delete
// (the delete-undo flow already re-creates the row from a snapshot, which is
// itself a "create", not an "edit"). `record_type` is a short discriminator
// ('vpn'|'server'|'database'|'external'|'internal') since one polymorphic
// table covers all five record kinds — there is deliberately no FK on
// record_id (which table it points into depends on record_type, so a single
// FK constraint isn't possible; existing lookup_codes-style patterns already
// treat category+id pairs this way elsewhere in this schema).
//
// `old_value`/`new_value` are the human-facing string a-value at the time of
// the edit; the password/secret_key fields are written as a fixed
// '(hidden)' placeholder rather than the real old/new text — the same
// change is still recorded (field name + timestamp), but a permanent,
// potentially-backed-up audit table does not also become a second store of
// every credential's full history the way a transient confirm dialog can be.
//
// Purely additive (one new table + index). Runs in the default migration
// transaction. Runs foreign_key_check after, per convention.
module.exports = {
  version: 27,
  name: 'client_field_history',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS client_field_history (
        id           INTEGER PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id),
        record_type  TEXT NOT NULL,
        record_id    INTEGER NOT NULL,
        field_name   TEXT NOT NULL,
        old_value    TEXT,
        new_value    TEXT,
        changed_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_client_field_history_record ON client_field_history(record_type, record_id, changed_at);
    `);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
