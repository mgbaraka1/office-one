// Migration 031 — Project Categories (New Project / CR on Existing Project /
// Project Annual Support).
//
// Seeds the PROJECT_CATEGORY lookup category and adds two nullable columns to
// `projects`: category_id (FK -> lookup_codes, mirroring company_id/system_id/
// department_id — round-tripped as its code since the UI branches on it, same
// convention as status) and related_project_id (a self-referencing FK -> projects,
// ON DELETE SET NULL, only meaningful for the CR/Annual-Support categories — the
// project this one is a change request against or provides annual support for).
// Every pre-existing project is backfilled to NEW_PROJECT, since that's the
// implicit meaning "project" already carried before this migration. Category is
// treated as required going forward, but enforced at the app layer only (no
// existing NOT NULL precedent on a lookup FK in this schema). Purely additive;
// no existing column touched. Runs foreign_key_check.
module.exports = {
  version: 31,
  name: 'project_categories',
  up(db) {
    const now = new Date().toISOString();
    const seedExists = db.prepare("SELECT 1 FROM lookup_codes WHERE category = 'PROJECT_CATEGORY' AND code = ?");
    const seedIns = db.prepare(
      `INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at)
       VALUES('PROJECT_CATEGORY', ?, ?, ?, 1, ?)`
    );
    const SEED = [
      ['NEW_PROJECT', 'New Project', 0],
      ['CR_EXISTING', 'CR on Existing Project', 1],
      ['ANNUAL_SUPPORT', 'Project Annual Support', 2],
    ];
    for (const [code, label, sort] of SEED) {
      if (!seedExists.get(code)) seedIns.run(code, label, sort, now);
    }

    const projectCols = new Set(db.prepare('PRAGMA table_info(projects)').all().map(c => c.name));
    if (!projectCols.has('category_id')) {
      db.exec('ALTER TABLE projects ADD COLUMN category_id INTEGER REFERENCES lookup_codes(id)');
    }
    if (!projectCols.has('related_project_id')) {
      db.exec('ALTER TABLE projects ADD COLUMN related_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_projects_related ON projects(related_project_id)');

    const newProjectId = db.prepare("SELECT id FROM lookup_codes WHERE category = 'PROJECT_CATEGORY' AND code = 'NEW_PROJECT'").get().id;
    db.prepare('UPDATE projects SET category_id = ? WHERE category_id IS NULL').run(newProjectId);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
