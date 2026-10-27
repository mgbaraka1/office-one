// Migration 081 — a Knowledge Hub item can link to one project, and the
// retired project documents table goes.
//
//   1. knowledge_items.project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL
//      Optional, at most one project. The app only accepts a project that is
//      on one of the item's clients (setKnowledgeChildren checks it). Existing
//      items stay unlinked. ADD COLUMN keeps the table's indexes and triggers
//      (the workspace_search_knowledge_* triggers do not read the new column).
//      Index idx_knowledge_items_project.
//   2. project_documents is dropped, with its two indexes, ONLY when it is
//      empty: migration 074 moved its rows onto Offers, and the app no longer
//      reads it. A table that still holds rows (a custom document type, or a
//      project with no client, which 074 skipped) is left exactly as it is.
//      When dropped, the PROJECT_DOCUMENT lookup rows go too; nothing else
//      references them (only CASCADE per-user access rows).
//      Files under projects/{id}/documents/ are not touched: they are 074's
//      recovery point.
//
// Destructive because of the DROP TABLE (the runner snapshots first). Idempotent:
// column check, IF NOT EXISTS, table-exists check.
module.exports = {
  version: 81,
  name: 'knowledge_project_link',
  destructive: true,
  up(db) {
    const hasProject = db.prepare('PRAGMA table_info(knowledge_items)').all().some(c => c.name === 'project_id');
    if (!hasProject) {
      db.exec('ALTER TABLE knowledge_items ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_items_project ON knowledge_items(project_id)');

    const hasDocs = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_documents'").get();
    if (hasDocs && db.prepare('SELECT COUNT(*) AS n FROM project_documents').get().n === 0) {
      db.exec('DROP TABLE project_documents');
      db.prepare("DELETE FROM lookup_codes WHERE category = 'PROJECT_DOCUMENT'").run();
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
