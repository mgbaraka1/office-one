// Migration 053 — Client/Internal task domain separation
// This migration completes the Client/Internal task domain separation.
//
// Internal (department) work belongs to the user's own organisation, never a
// client. Before this migration, internal tasks still carried a client
// Company/System — a pre-existing modelling gap where the employer's own
// organisation was misused as a COMPANY lookup row so the old New/Edit
// Task modal's required Company field could be satisfied. The app layer
// (db.js's internalTaskWriteFields/updateInternalTask/convertTaskToInternal,
// and updateTaskMeta's domain guard) now keeps every WRITE from
// (re)attaching a company/system/project to an internal task; this migration
// is the one-time data cleanup for rows that predate that guard, plus a
// SQLite-level backstop so the same shape can never happen again even via a
// bug. Every step is idempotent, so a second run (e.g. after a Full Restore
// of a pre-053 backup) is a safe no-op.
//
// Deliberately NOT added: a redundant tasks.kind column. The app already
// treats department_id as the single source of truth for a task's domain
// (`isInternalTaskRow` / `isInternalTaskApi`) — every
// write path already guarantees company/system/project are NULL exactly when
// department_id is set. A second, physically-stored discriminator would only
// be correct if every one of those write paths also learned to set it, which
// is exactly the "a payload forgets a field the write path still touches"
// bug shape this whole feature exists to eliminate — not something to
// reintroduce in the migration that closes it out.
module.exports = {
  version: 53,
  name: 'internal_task_domain_separation',
  destructive: true,
  up(db) {
    const now = new Date().toISOString();

    // 1. Archive Company/System into task_field_history before clearing them,
    // so a task's pre-migration classification stays visible in-app (Task
    // Detail's History), not only inside the pre-migration backup. Only
    // touches internal tasks that still carry one of these — a second run
    // finds nothing left to archive.
    const toClear = db.prepare(
      `SELECT t.id, t.user_id, c.label AS company_label, s.label AS system_label
         FROM tasks t
         LEFT JOIN lookup_codes c ON c.id = t.company_id
         LEFT JOIN lookup_codes s ON s.id = t.system_id
        WHERE t.department_id IS NOT NULL AND (t.company_id IS NOT NULL OR t.system_id IS NOT NULL)`
    ).all();
    const insertHistory = db.prepare(
      `INSERT INTO task_field_history(user_id, task_id, field_name, old_value, new_value, changed_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const row of toClear) {
      if (row.company_label) insertHistory.run(row.user_id, row.id, 'Company', row.company_label, '', now);
      if (row.system_label) insertHistory.run(row.user_id, row.id, 'System', row.system_label, '', now);
    }

    // 2. Clear company/system on every internal task. project_id is already
    // guaranteed NULL there by migration 048's link-exclusivity triggers.
    db.prepare(
      `UPDATE tasks SET company_id = NULL, system_id = NULL, updated_at = ?
        WHERE department_id IS NOT NULL AND (company_id IS NOT NULL OR system_id IS NOT NULL)`
    ).run(now);

    // 3. Backstop trigger: an internal task can never carry a company/system,
    // going forward, even via a future bug. (project_id alongside
    // department_id is already rejected by migration 048's
    // trg_tasks_link_exclusive_insert/update.)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_tasks_internal_no_client_fields_insert
      BEFORE INSERT ON tasks
      WHEN NEW.department_id IS NOT NULL AND (NEW.company_id IS NOT NULL OR NEW.system_id IS NOT NULL)
      BEGIN
        SELECT RAISE(ABORT, 'an internal (department) task cannot carry a client company or system');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_tasks_internal_no_client_fields_update
      BEFORE UPDATE ON tasks
      WHEN NEW.department_id IS NOT NULL AND (NEW.company_id IS NOT NULL OR NEW.system_id IS NOT NULL)
      BEGIN
        SELECT RAISE(ABORT, 'an internal (department) task cannot carry a client company or system');
      END;
    `);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
