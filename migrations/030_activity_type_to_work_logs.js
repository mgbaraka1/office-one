// Migration 030 — move Natural (activity type) to work_logs; drop tasks.tags.
//
// activity_type_id used to live on `tasks` (task-level), shared by every session
// under a task. The same task can reasonably span a meeting session, a plain
// task session, a ticket session, etc., so Natural moves to `work_logs` —
// exactly how time_type_id already works (per-session, not per-task).
// `tasks.tags` is dropped outright (unused, no replacement).
//
//   1. Add work_logs.activity_type_id (nullable FK -> lookup_codes).
//   2. Backfill every existing work_log from its parent task's current value.
//   3. Index the new column; drop the now-obsolete tasks(activity_type_id) index
//      first (SQLite refuses DROP COLUMN on an indexed column).
//   4. Drop tasks.activity_type_id and tasks.tags.
//
// All steps existence-guarded so a hypothetical re-run is a no-op, mirroring
// migrations/009_project_systems.js. Runs foreign_key_check.
module.exports = {
  version: 30,
  name: 'activity_type_to_work_logs',
  up(db) {
    const workLogCols = new Set(db.prepare('PRAGMA table_info(work_logs)').all().map(c => c.name));
    const hasWlActivity = workLogCols.has('activity_type_id');
    if (!hasWlActivity) {
      db.exec('ALTER TABLE work_logs ADD COLUMN activity_type_id INTEGER REFERENCES lookup_codes(id)');
    }

    const taskCols = new Set(db.prepare('PRAGMA table_info(tasks)').all().map(c => c.name));
    const hasTaskActivity = taskCols.has('activity_type_id');
    if (hasTaskActivity) {
      db.exec(
        `UPDATE work_logs SET activity_type_id = (
           SELECT t.activity_type_id FROM tasks t WHERE t.id = work_logs.task_id
         ) WHERE activity_type_id IS NULL`
      );
    }

    db.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_activity ON work_logs(activity_type_id)');

    // Drop the now-obsolete index before dropping the column it covers.
    db.exec('DROP INDEX IF EXISTS idx_tasks_activity');
    if (hasTaskActivity) {
      db.exec('ALTER TABLE tasks DROP COLUMN activity_type_id');
    }
    if (taskCols.has('tags')) {
      db.exec('ALTER TABLE tasks DROP COLUMN tags');
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
