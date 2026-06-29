// Migration 009 — Project systems (single → many).
//
// A project used to reference a single SYSTEM lookup via the `projects.system_id`
// column. Some engagements span multiple systems, so this migration promotes that
// one-to-one column into a many-to-many `project_systems` junction (mirroring the
// `project_companies` junction added in 008):
//
//   1. Create `project_systems` (project_id ↔ SYSTEM lookup, many-to-many).
//      ON DELETE CASCADE: deleting a project drops its system links. system_id
//      points at lookup_codes (SYSTEM); codes are soft-disabled, never hard-deleted.
//   2. Migrate every existing non-null `projects.system_id` into the junction.
//   3. Drop the now-migrated `projects.system_id` column.
//
// All schema changes use CREATE TABLE / DROP COLUMN so unrelated data is preserved
// in place. Runs in the default migration transaction.
module.exports = {
  version: 9,
  name: 'project_systems',
  up(db) {
    // ── 1. project_systems junction (project ↔ SYSTEM lookup, many-to-many) ──
    db.exec(`
      CREATE TABLE project_systems (
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        system_id  INTEGER NOT NULL REFERENCES lookup_codes(id),
        PRIMARY KEY (project_id, system_id)
      );
      CREATE INDEX idx_project_systems_system ON project_systems(system_id);
    `);

    // ── 2. Migrate existing single system_id values into the junction ──
    const link = db.prepare('INSERT OR IGNORE INTO project_systems(project_id, system_id) VALUES(?, ?)');
    for (const p of db.prepare('SELECT id, system_id FROM projects WHERE system_id IS NOT NULL').all()) {
      link.run(p.id, p.system_id);
    }

    // ── 3. Drop the now-migrated single-system column ──
    db.exec('ALTER TABLE projects DROP COLUMN system_id');

    // Integrity: every FK must still point at a real row (or be NULL).
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
