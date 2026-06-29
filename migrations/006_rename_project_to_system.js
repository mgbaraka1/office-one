// Migration 006 — rename the "Project" concept to "System".
//
// The app's second classification dimension was originally called "Project".
// It is now called "System" everywhere. This migration renames the persisted
// identity of that concept so existing data keeps flowing through unchanged:
//   • the lookup catalog category   PROJECT   → SYSTEM
//   • the FK column on day_entries   project_id → system_id
//   • the FK column on backlog       project_id → system_id
//   • the supporting index           idx_day_entries_project → idx_day_entries_system
//
// No data is moved or dropped: lookup rows keep their stable codes/labels and
// every entry keeps pointing at the same catalog row — only the column/category
// *names* change. RENAME COLUMN (SQLite 3.25+) edits the schema in place and
// rewrites the index reference automatically; we still recreate the index so its
// name matches the new column. Runs in the default migration transaction.
module.exports = {
  version: 6,
  name: 'rename_project_to_system',
  up(db) {
    // 1. Relabel the lookup category (codes/labels/ids all unchanged).
    db.prepare("UPDATE lookup_codes SET category = 'SYSTEM' WHERE category = 'PROJECT'").run();

    // 2. Rename the FK columns; existing values are preserved in place.
    db.exec('ALTER TABLE day_entries RENAME COLUMN project_id TO system_id');
    db.exec('ALTER TABLE backlog     RENAME COLUMN project_id TO system_id');

    // 3. Recreate the analytics index under the new column name.
    db.exec('DROP INDEX IF EXISTS idx_day_entries_project');
    db.exec('CREATE INDEX IF NOT EXISTS idx_day_entries_system ON day_entries(system_id)');

    // Integrity: every FK must still point at a real catalog row (or be NULL).
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
