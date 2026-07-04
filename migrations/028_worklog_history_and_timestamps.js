// Migration 028 — audit trail for work_logs edits, + updated_at on projects and
// subscriptions.
//
// Two purely additive changes, bundled because both close the same Phase 0 gap:
// the tables that hold this app's actual business value (billable time, project
// status, subscription cost) had the least change-tracking of anything in the
// schema, while the Clients page's credentials had a full audit trail.
//
// 1. `work_log_history` — the exact same append-only, field-level-diff pattern
//    migration 027 built for the Clients page (client_field_history), scoped to
//    work_logs instead of the five client_* tables. A row is written for every
//    field that actually changed on an UPDATE to an existing work_log — never on
//    create, never on delete, matching the Clients convention exactly. No FK on
//    work_log_id: an audit trail has to survive the row it describes being
//    edited again, or its parent task later being deleted — an ON DELETE CASCADE
//    would otherwise erase the very history a deletion should leave behind (same
//    reasoning 027 already documents for why client_field_history has no FK).
//
// 2. `projects.updated_at` / `subscriptions.updated_at` — neither table had a
//    last-modified timestamp of any kind. Added as nullable TEXT, no default
//    (same convention every additive-column migration in this app uses, e.g.
//    011/026), then backfilled once so existing rows aren't left NULL forever:
//    `projects.updated_at` from its own `created_at` (exactly correct if the row
//    was never edited before this migration; the best available approximation
//    otherwise). `subscriptions` has no `created_at` to borrow from at all, so
//    its existing rows are stamped with this migration's own run time instead.
//
// Purely additive: one new table + index, two new nullable columns on existing
// tables. Column-existence guarded (idempotent re-run-safe, matching migration
// 011's style). Runs in the default migration transaction. Runs
// foreign_key_check after, per convention.
module.exports = {
  version: 28,
  name: 'worklog_history_and_timestamps',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS work_log_history (
        id           INTEGER PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id),
        work_log_id  INTEGER NOT NULL,
        field_name   TEXT NOT NULL,
        old_value    TEXT,
        new_value    TEXT,
        changed_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_work_log_history_record ON work_log_history(work_log_id, changed_at);
    `);

    const projectCols = new Set(db.prepare('PRAGMA table_info(projects)').all().map(c => c.name));
    if (!projectCols.has('updated_at')) {
      db.exec('ALTER TABLE projects ADD COLUMN updated_at TEXT');
      db.exec('UPDATE projects SET updated_at = created_at WHERE updated_at IS NULL');
    }

    const subCols = new Set(db.prepare('PRAGMA table_info(subscriptions)').all().map(c => c.name));
    if (!subCols.has('updated_at')) {
      db.exec('ALTER TABLE subscriptions ADD COLUMN updated_at TEXT');
      db.prepare('UPDATE subscriptions SET updated_at = ? WHERE updated_at IS NULL').run(new Date().toISOString());
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
