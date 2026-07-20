// Migration 042 — remove the retired Project Categories data model.
//
// The renderer no longer exposes project categories or related-project links.
// This migration completes that retirement by dropping both columns and deleting
// the now-unreferenced PROJECT_CATEGORY lookup rows. It is intentionally marked
// destructive so db.applyMigrations() creates a pre-migration database snapshot
// outside the rotating backups directory before applying it to an existing DB.
module.exports = {
  version: 42,
  name: 'remove_project_categories',
  destructive: true,
  up(db) {
    const columns = new Set(db.prepare('PRAGMA table_info(projects)').all().map(c => c.name));

    db.exec('DROP INDEX IF EXISTS idx_projects_category');
    db.exec('DROP INDEX IF EXISTS idx_projects_related');
    if (columns.has('category_id')) db.exec('ALTER TABLE projects DROP COLUMN category_id');
    if (columns.has('related_project_id')) db.exec('ALTER TABLE projects DROP COLUMN related_project_id');

    db.prepare("DELETE FROM lookup_codes WHERE category = 'PROJECT_CATEGORY'").run();

    const remaining = new Set(db.prepare('PRAGMA table_info(projects)').all().map(c => c.name));
    if (remaining.has('category_id') || remaining.has('related_project_id')) {
      throw new Error('project category columns were not removed');
    }
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
