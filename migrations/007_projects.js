// Migration 007 — Projects module.
//
// Introduces a real container entity, a "Project" (a client/system engagement),
// which owns:
//   • a fixed set of tracked documents (Quotation, Quotation Approval, Invoice),
//     each with a per-project availability flag, in `project_documents`;
//   • links to existing tasks — both timesheet entries (`day_entries`) and the
//     day-agnostic "Not Yet" pool (`backlog`) — via a nullable `project_id` FK.
//
// The task link uses ON DELETE SET NULL so deleting a project only UNLINKS its
// tasks — it never deletes the underlying work records. `project_documents` use
// ON DELETE CASCADE so a deleted project takes its document rows with it. Both
// new tables carry `user_id`-style ownership through their FK chain (projects own
// user_id; documents/tasks reach the owner via the project / their own user_id).
//
// Schema is changed only with CREATE TABLE / ADD COLUMN, so every existing row is
// preserved in place. Runs in the default migration transaction.
module.exports = {
  version: 7,
  name: 'projects',
  up(db) {
    // ── Project container ───────────────────────────────────────────────────────
    // CREATE TABLE/INDEX guarded (IF NOT EXISTS) so a hypothetical re-run is a
    // no-op instead of throwing "table projects already exists".
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id),
        name        TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        client_name TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'active',
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, id);

      CREATE TABLE IF NOT EXISTS project_documents (
        id            INTEGER PRIMARY KEY,
        project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        document_type TEXT NOT NULL,
        is_available  INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id);
    `);

    // ── Link existing tasks to a project (nullable; existing rows unaffected) ────
    // ON DELETE SET NULL: deleting a project unlinks its tasks, never deletes them.
    // ADD COLUMN existence-guarded; CREATE INDEX already IF NOT EXISTS-safe on its own.
    const deCols = new Set(db.prepare('PRAGMA table_info(day_entries)').all().map(c => c.name));
    if (!deCols.has('project_id')) {
      db.exec('ALTER TABLE day_entries ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
    }
    const blCols = new Set(db.prepare('PRAGMA table_info(backlog)').all().map(c => c.name));
    if (!blCols.has('project_id')) {
      db.exec('ALTER TABLE backlog ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_day_entries_project_id ON day_entries(project_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_backlog_project_id     ON backlog(project_id)');

    // Integrity: every FK must still point at a real row (or be NULL).
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
