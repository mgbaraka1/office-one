// Migration 058 — audit trail for the shared catalog.
//
// FINANCE_INTEGRATION_PLAN.md §9.2. lookup_codes had no history of any kind:
// renaming a company, changing its business code, or soft-disabling a catalog
// value left no record of what changed or who changed it. That was survivable
// while the catalog editor was administrator-only. It is not survivable now
// that the admin concept has been removed and any authenticated account can
// edit it — and a company rename propagates to every task, project, report and
// invoice that references that company, which makes it the highest-impact edit
// in the app.
//
// Deliberately NOT user-scoped on read. lookup_codes is global, shared data;
// the entire point of this table is seeing who touched it, so every account
// can read the whole history. `user_id` records the actor, not an owner.
//
// Append-only, like task_field_history and work_log_history. Rows are written
// on UPDATE and INSERT (a new catalog value is itself an event worth seeing),
// never deleted — codes are soft-disabled rather than removed, so a delete row
// would have nothing to describe.
module.exports = {
  version: 58,
  name: 'lookup_code_history',
  destructive: false,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lookup_code_history (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        lookup_id  INTEGER NOT NULL,
        category   TEXT NOT NULL,
        field_name TEXT NOT NULL,
        old_value  TEXT NOT NULL DEFAULT '',
        new_value  TEXT NOT NULL DEFAULT '',
        changed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lookup_code_history_lookup
        ON lookup_code_history(lookup_id, changed_at);
      CREATE INDEX IF NOT EXISTS idx_lookup_code_history_category
        ON lookup_code_history(category, changed_at);
    `);
    // lookup_id is intentionally NOT a foreign key: rows are never deleted from
    // lookup_codes today, but if one ever were, its audit trail must survive it
    // rather than cascade away — the history exists precisely for the case
    // where something disappeared and nobody knows who did it.
  },
};
