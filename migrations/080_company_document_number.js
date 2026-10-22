// Migration 080 — a reference number on each company document.
//
// The number people copy most from these documents (a commercial
// registration, VAT or national-address number) gets its own field:
//
//   company_documents.doc_number   TEXT NOT NULL DEFAULT ''
//   workspace_search_company_documents_ai / _au
//                                  recreated so Quick Find also matches the
//                                  number (appended to the search body)
//
// Templates share the table and always keep ''. ADD COLUMN keeps the table's
// indexes and triggers; only the two search triggers are replaced (_ad does not
// read the new column and is left as it is). Every existing row has an empty
// number, so its search row is already right and is not rebuilt. Idempotent:
// column check, DROP TRIGGER IF EXISTS.
const SEARCH_KIND = k => `CASE ${k}.kind WHEN 'TEMPLATE' THEN 'template' ELSE 'company-document' END`;
const SEARCH_BODY = k => `TRIM(COALESCE(${k}.notes, '') || ' ' || COALESCE(${k}.doc_number, ''))`;

module.exports = {
  version: 80,
  name: 'company_document_number',
  destructive: false,
  up(db) {
    const hasNumber = db.prepare('PRAGMA table_info(company_documents)').all().some(c => c.name === 'doc_number');
    if (!hasNumber) db.exec("ALTER TABLE company_documents ADD COLUMN doc_number TEXT NOT NULL DEFAULT ''");

    const hasSearch = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workspace_search'").get();
    if (hasSearch) {
      db.exec(`
        DROP TRIGGER IF EXISTS workspace_search_company_documents_ai;
        DROP TRIGGER IF EXISTS workspace_search_company_documents_au;

        CREATE TRIGGER workspace_search_company_documents_ai AFTER INSERT ON company_documents BEGIN
          INSERT INTO workspace_search VALUES(new.user_id, ${SEARCH_KIND('new')}, new.id, new.name,
            COALESCE(new.category, ''), ${SEARCH_BODY('new')}, new.updated_at);
        END;
        CREATE TRIGGER workspace_search_company_documents_au AFTER UPDATE ON company_documents BEGIN
          DELETE FROM workspace_search WHERE kind IN ('company-document', 'template') AND entity_id = old.id;
          INSERT INTO workspace_search VALUES(new.user_id, ${SEARCH_KIND('new')}, new.id, new.name,
            COALESCE(new.category, ''), ${SEARCH_BODY('new')}, new.updated_at);
        END;
      `);
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
