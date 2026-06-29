// Migration 008 — Projects corrections.
//
// Three targeted corrections to the Projects feature (migration 007):
//
//   1. Client → Companies (many-to-many). The free-text `projects.client_name`
//      column is replaced by a `project_companies` junction table linking a
//      project to one or more COMPANY lookup codes. Existing client_name values
//      that resolve to a COMPANY code/label are migrated into the junction; the
//      column is then dropped.
//   2. System on a project. A nullable `projects.system_id` FK → lookup_codes
//      (a single SYSTEM lookup), added in place (existing rows → NULL).
//   3. Status → lookup. A new `PROJECT_STATUS` lookup category is seeded with
//      ACTIVE / ON_HOLD / COMPLETED, and the existing free-text `projects.status`
//      values are rewritten to the matching lookup `code` (kept as a TEXT column
//      storing the code, consistent with the app's other status fields).
//
// All schema changes use CREATE TABLE / ADD COLUMN / DROP COLUMN so unrelated
// data is preserved in place. Runs in the default migration transaction.
module.exports = {
  version: 8,
  name: 'projects_corrections',
  up(db) {
    // ── 1. project_companies junction (project ↔ COMPANY lookup, many-to-many) ──
    // ON DELETE CASCADE: deleting a project drops its company links. company_id
    // points at lookup_codes (COMPANY); codes are soft-disabled, never hard-deleted.
    db.exec(`
      CREATE TABLE project_companies (
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id INTEGER NOT NULL REFERENCES lookup_codes(id),
        PRIMARY KEY (project_id, company_id)
      );
      CREATE INDEX idx_project_companies_company ON project_companies(company_id);
    `);

    // ── 2. system_id on projects (nullable FK → lookup_codes; existing rows NULL) ──
    db.exec('ALTER TABLE projects ADD COLUMN system_id INTEGER REFERENCES lookup_codes(id)');

    // ── 3. PROJECT_STATUS lookup category + seed ─────────────────────────────────
    const now = new Date().toISOString();
    const seedExists = db.prepare("SELECT 1 FROM lookup_codes WHERE category = 'PROJECT_STATUS' AND code = ?");
    const seedIns = db.prepare(
      `INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at)
       VALUES('PROJECT_STATUS', ?, ?, ?, 1, ?)`
    );
    const STATUS_SEED = [['ACTIVE', 'Active', 0], ['ON_HOLD', 'On Hold', 1], ['COMPLETED', 'Completed', 2]];
    for (const [code, label, sort] of STATUS_SEED) {
      if (!seedExists.get(code)) seedIns.run(code, label, sort, now);
    }

    // ── Migrate existing projects: status free-text → code; client_name → junction ─
    const STATUS_MAP = { 'active': 'ACTIVE', 'on-hold': 'ON_HOLD', 'completed': 'COMPLETED' };
    const updStatus  = db.prepare('UPDATE projects SET status = ? WHERE id = ?');
    const findCompany = db.prepare(
      "SELECT id FROM lookup_codes WHERE category = 'COMPANY' AND (label = ? OR code = ?) LIMIT 1"
    );
    const linkCompany = db.prepare('INSERT OR IGNORE INTO project_companies(project_id, company_id) VALUES(?, ?)');
    for (const p of db.prepare('SELECT id, status, client_name FROM projects').all()) {
      updStatus.run(STATUS_MAP[String(p.status || '').toLowerCase()] || 'ACTIVE', p.id);
      const cn = String(p.client_name || '').trim();
      if (cn) {
        const co = findCompany.get(cn, cn);
        if (co) linkCompany.run(p.id, co.id);
      }
    }

    // ── 4. Drop the now-migrated free-text client column ─────────────────────────
    db.exec('ALTER TABLE projects DROP COLUMN client_name');

    // Integrity: every FK must still point at a real row (or be NULL).
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
