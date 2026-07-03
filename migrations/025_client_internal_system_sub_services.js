// Migration 025 — Internal Systems gain a structured Sub-Services list.
//
// Some Internal Systems are really one logical service exposed as several
// sibling endpoints (e.g. a government API with Bookings/Reports/
// Admin* sub-services sharing one company code/secret key). This
// adds `sub_services`, a JSON array of `{label, url}` pairs, so those can be
// recorded as structured data on a single record instead of one record per
// endpoint or free text crammed into notes.
//
// Stored as a JSON TEXT column, consistent with `tasks.tags` elsewhere in
// this DB. NULL/empty parses to `[]` via `safeParse()` (never throws).
//
// Purely additive (one nullable column, no rewrite/rename/drop).
// Runs in the default migration transaction.
module.exports = {
  version: 25,
  name: 'client_internal_system_sub_services',
  up(db) {
    const existing = new Set(
      db.prepare('PRAGMA table_info(client_internal_systems)').all().map(c => c.name)
    );
    if (!existing.has('sub_services')) {
      db.exec(`ALTER TABLE client_internal_systems ADD COLUMN sub_services TEXT`);
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
