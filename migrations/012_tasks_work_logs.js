// Migration 012 — Tasks + Work Logs (two-level restructure).
//
// Reframes the primary unit of work from a date-bound `day_entries` row into a
// date-INDEPENDENT `tasks` entity with child `work_logs` (one work session each):
//
//   tasks       — the standalone task: name, status, company/system/activity,
//                 optional project link, source, tags. NOT owned by a day.
//   work_logs   — one work session on a task: date, what was done (description),
//                 duration (minutes), and the session's time type (Work/Over Time).
//
// The old `days` table is KEPT but demoted to per-date metadata (employee_name for
// reports); it no longer owns work. Every existing `day_entries` row is split 1:1
// into one task + one work_log (faithful, lossless — no heuristic grouping):
//
//   • task.name          ← entry.description        (rename later; kept for continuity)
//   • task.status_id     ← entry.status_id          (status is task-level)
//   • task.company/system/activity/project/source/tags ← entry's (task-level)
//   • work_log.date      ← parent days.date          (the session's date)
//   • work_log.description ← entry.description        (what was done that session)
//   • work_log.minutes   ← entry.minutes             (duration)
//   • work_log.time_type_id ← entry.time_type_id     (time type is per-session)
//
// The `backlog` ("Not Yet") table is intentionally left untouched here — merging it
// into `tasks` is deferred to the renderer-rework phase (its rows carry client-side
// string ids, unlike the integer task ids). After the split, `day_entries` is
// dropped. Runs in the default migration transaction; verified with foreign_key_check.
module.exports = {
  version: 12,
  name: 'tasks_work_logs',
  up(db) {
    const now = new Date().toISOString();

    // ── 1. New tables ──────────────────────────────────────────────────────────
    // tasks: date-independent. project_id keeps ON DELETE SET NULL so deleting a
    // project unlinks (never deletes) its tasks — the same contract day_entries had.
    db.exec(`
      CREATE TABLE tasks (
        id               INTEGER PRIMARY KEY,
        user_id          INTEGER NOT NULL REFERENCES users(id),
        name             TEXT NOT NULL DEFAULT '',
        status_id        INTEGER REFERENCES lookup_codes(id),
        company_id       INTEGER REFERENCES lookup_codes(id),
        system_id        INTEGER REFERENCES lookup_codes(id),
        activity_type_id INTEGER REFERENCES lookup_codes(id),
        project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        source           TEXT NOT NULL DEFAULT '',
        tags             TEXT NOT NULL DEFAULT '[]',
        sort_order       INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );

      CREATE TABLE work_logs (
        id           INTEGER PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id),
        task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        date         TEXT NOT NULL,
        description  TEXT NOT NULL DEFAULT '',
        minutes      INTEGER,
        time_type_id INTEGER REFERENCES lookup_codes(id),
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
    `);

    // ── 2. Split each day_entry (with its day's date) into a task + a work_log ──
    const insTask = db.prepare(`
      INSERT INTO tasks
        (user_id, name, status_id, company_id, system_id, activity_type_id,
         project_id, source, tags, sort_order, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insLog = db.prepare(`
      INSERT INTO work_logs
        (user_id, task_id, date, description, minutes, time_type_id, sort_order, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`);

    const entries = db.prepare(`
      SELECT e.id, e.user_id, e.company_id, e.system_id, e.activity_type_id,
             e.time_type_id, e.status_id, e.description, e.source, e.minutes,
             e.tags, e.project_id, e.sort_order, e.created_at, e.updated_at,
             d.date AS date
        FROM day_entries e
        JOIN days d ON d.id = e.day_id
       ORDER BY e.id`).all();

    for (const e of entries) {
      const created = e.created_at || now;
      const updated = e.updated_at || now;
      const taskId = Number(insTask.run(
        e.user_id, e.description || '', e.status_id,
        e.company_id, e.system_id, e.activity_type_id,
        e.project_id, e.source || '', e.tags || '[]',
        e.sort_order ?? 0, created, updated
      ).lastInsertRowid);
      insLog.run(
        e.user_id, taskId, e.date, e.description || '', e.minutes,
        e.time_type_id, e.sort_order ?? 0, created, updated
      );
    }

    // ── 3. Indexes (the access paths the runtime uses) ─────────────────────────
    db.exec(`
      CREATE INDEX idx_tasks_user_sort    ON tasks(user_id, sort_order);
      CREATE INDEX idx_tasks_company      ON tasks(company_id);
      CREATE INDEX idx_tasks_system       ON tasks(system_id);
      CREATE INDEX idx_tasks_activity     ON tasks(activity_type_id);
      CREATE INDEX idx_tasks_status       ON tasks(status_id);
      CREATE INDEX idx_tasks_project      ON tasks(project_id);
      CREATE INDEX idx_work_logs_task     ON work_logs(task_id);
      CREATE INDEX idx_work_logs_user_date ON work_logs(user_id, date);
      CREATE INDEX idx_work_logs_date     ON work_logs(date);
      CREATE INDEX idx_work_logs_time     ON work_logs(time_type_id);
    `);

    // ── 4. Drop the now-migrated day_entries table (nothing FK-references it) ───
    db.exec('DROP TABLE day_entries');

    // Integrity: every FK must still point at a real row (or be NULL).
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
