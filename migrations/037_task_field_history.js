// Migration 037 — audit trail for tasks edits (task_field_history).
//
// Added alongside a fix for a real data-loss bug: the Timesheet save
// reconciler was calling the full-row `updateTask` on every task with a
// session on the viewed day, using a payload with no project/department
// fields — so every autosave silently NULLed out `tasks.project_id`/
// `department_id` for any task that had one set. The fix itself (a new
// metadata-only `updateTaskMeta` that never touches the link columns) lives
// in db.js; this migration only adds the audit trail so a regression like it
// is visible/recoverable next time, mirroring `work_log_history` (028) and
// `client_field_history` (027) exactly: one row per field that actually
// changed on a genuine UPDATE to an existing row, never on create/delete.
//
// No FK on task_id — same reasoning as work_log_history/client_field_history:
// the audit trail must survive the task it describes being deleted later, and
// an ON DELETE CASCADE would erase the very history a deletion should leave
// behind.
//
// Purely additive: one new table + index. Runs foreign_key_check after.
module.exports = {
  version: 37,
  name: 'task_field_history',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_field_history (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id),
        task_id     INTEGER NOT NULL,
        field_name  TEXT NOT NULL,
        old_value   TEXT,
        new_value   TEXT,
        changed_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_field_history_record ON task_field_history(task_id, changed_at);
    `);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
