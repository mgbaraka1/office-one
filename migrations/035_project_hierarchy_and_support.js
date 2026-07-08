// Migration 035 — Project Hierarchy (Sub-Projects) + Annual Support (per year).
//
// Restructures how Change Requests and Annual Support attach to a Project, moving
// away from the flat migration-031 model (a project's own category_id +
// related_project_id "back-pointing" at the project it relates to, all shown side
// by side in one flat Projects grid) toward real nesting:
//
//   • Sub-Projects (for CRs): a project row can now point UP at a parent project
//     via the new `parent_project_id` (self-referencing FK, ON DELETE CASCADE — a
//     sub-project has no meaning without its parent, so it's removed with it; its
//     own linked tasks are only ever unlinked via tasks.project_id's existing
//     ON DELETE SET NULL, never deleted). A sub-project is otherwise an ordinary
//     `projects` row (own name/status/companies/systems/documents/tasks) — the
//     existing getProject/updateProject/document/task-link code paths work on it
//     unchanged. Nesting is capped at one level deep (enforced in db.js's
//     resolveParentProjectId, app-layer only, mirroring resolveRelatedProjectId) —
//     a sub-project can't itself have sub-projects.
//   • Annual Support: a brand-new child table, `project_support_years`, one row per
//     project+year (UNIQUE(project_id,year)) — NOT a `projects` row, since a
//     support-year has no company/system/status/documents of its own, only tasks
//     scoped to that year. ON DELETE CASCADE off `projects` (a support-year record
//     is meaningless without its parent project).
//   • tasks.support_year_id (nullable FK -> project_support_years, ON DELETE
//     SET NULL — mirrors project_id/department_id's SET NULL convention, so a
//     removed support-year never deletes the task itself) lets a task be linked to
//     one specific support year. Extends the existing project_id/department_id
//     mutual-exclusivity rule (db.js's assertTaskLinkExclusive) to a 3-way check —
//     a task is Project work, Internal (department) work, or one specific
//     Support Year, never more than one of the three.
//
// Deliberately does NOT touch any existing data: migration 031's category_id/
// related_project_id columns and every existing project row are left exactly as
// they are — every current project (including any already-flagged CR_EXISTING/
// ANNUAL_SUPPORT ones) keeps parent_project_id NULL and gets no
// project_support_years rows. Re-classifying old data onto the new structure is a
// deliberate future step, not part of this migration. Purely additive: one new
// column on `projects`, one new column on `tasks`, one new table + its indexes.
// Runs foreign_key_check.
module.exports = {
  version: 35,
  name: 'project_hierarchy_and_support',
  up(db) {
    const projectCols = new Set(db.prepare('PRAGMA table_info(projects)').all().map(c => c.name));
    if (!projectCols.has('parent_project_id')) {
      db.exec('ALTER TABLE projects ADD COLUMN parent_project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_project_id)');

    db.exec(`
      CREATE TABLE IF NOT EXISTS project_support_years (
        id         INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        year       INTEGER NOT NULL,
        notes      TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, year)
      );
      CREATE INDEX IF NOT EXISTS idx_support_years_project ON project_support_years(project_id);
    `);

    const taskCols = new Set(db.prepare('PRAGMA table_info(tasks)').all().map(c => c.name));
    if (!taskCols.has('support_year_id')) {
      db.exec('ALTER TABLE tasks ADD COLUMN support_year_id INTEGER REFERENCES project_support_years(id) ON DELETE SET NULL');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_support_year ON tasks(support_year_id)');

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
