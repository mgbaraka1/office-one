// Migration 013 — Backlog → Tasks merge (data-only, schema preserved).
//
// The "Not Yet" pool is now expressed as tasks with zero work_logs (a task you
// haven't logged any session against yet), unifying it with the two-level model.
// This migration moves every existing `backlog` row into a standalone `tasks` row:
//
//   • task.name          ← backlog.description   (the thing to do)
//   • company/system/activity/source/tags/project ← backlog's
//   • status             ← IN_PROGRESS           (a pending task)
//   • backlog.time_type  → DROPPED               (time type is per-session now;
//                                                  chosen when you assign to a day)
//
// No work_logs are created (a Not-Yet task has none). The `backlog` TABLE is kept
// intact (structure unchanged → DBeaver-safe); only its rows are cleared after the
// move. Purely data-level: no ALTER/DROP, rollback-safe. Idempotent in practice
// (runs once via the migration ledger); a re-run would find an empty backlog.
module.exports = {
  version: 13,
  name: 'backlog_to_tasks',
  up(db) {
    const now = new Date().toISOString();
    const ip = db.prepare("SELECT id FROM lookup_codes WHERE category='ENTRY_STATUS' AND code='IN_PROGRESS'").get();
    const statusId = ip ? ip.id : null;

    const insTask = db.prepare(`
      INSERT INTO tasks
        (user_id, name, status_id, company_id, system_id, activity_type_id,
         project_id, source, tags, sort_order, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);

    let moved = 0;
    for (const b of db.prepare('SELECT * FROM backlog').all()) {
      insTask.run(
        b.user_id, b.description || '', statusId,
        b.company_id, b.system_id, b.activity_type_id,
        b.project_id, b.source || '', b.tags || '[]',
        b.sort_order ?? 0, b.created_at || now, b.updated_at || now
      );
      moved++;
    }

    // Data-only: clear the migrated rows but KEEP the table (structure preserved).
    if (moved) db.exec('DELETE FROM backlog');

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
