// Migration 075 — Templates, a sibling of Company Documents.
//
// A template is the same card as a company document (name, category, notes, at
// most one file) without a renewal date, so it shares the table, the file tree
// (company_documents/{id}/) and every backup, restore and integrity path that
// already covers it:
//
//   company_documents.kind   'DOCUMENT' | 'TEMPLATE', default 'DOCUMENT'
//   TEMPLATE_CATEGORY        a new lookup category, seeded with a starter set
//   workspace_search_company_documents_ai / _au / _ad
//                            recreated so a template indexes as kind 'template'
//
// ADD COLUMN keeps the table's indexes and triggers; only the three search
// triggers are replaced. Every existing row becomes a DOCUMENT, so its search
// row is already right and is not rebuilt. Idempotent: column check, seed
// check, DROP TRIGGER IF EXISTS.
const CATEGORY_SEED = [
  ['CONTRACT', 'Contract', 'عقد'],
  ['PROPOSAL', 'Proposal', 'عرض'],
  ['LETTER', 'Letter', 'خطاب'],
  ['FORM', 'Form', 'نموذج'],
  ['REPORT', 'Report', 'تقرير'],
  ['PRESENTATION', 'Presentation', 'عرض تقديمي'],
  ['OTHER', 'Other', 'أخرى'],
];

const SEARCH_KIND = k => `CASE ${k}.kind WHEN 'TEMPLATE' THEN 'template' ELSE 'company-document' END`;

module.exports = {
  version: 75,
  name: 'templates',
  destructive: false,
  up(db) {
    const hasKind = db.prepare('PRAGMA table_info(company_documents)').all().some(c => c.name === 'kind');
    if (!hasKind) {
      db.exec(`ALTER TABLE company_documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'DOCUMENT'
                 CHECK(kind IN ('DOCUMENT', 'TEMPLATE'))`);
    }

    const now = new Date().toISOString();
    const seedExists = db.prepare("SELECT 1 FROM lookup_codes WHERE category = 'TEMPLATE_CATEGORY' AND code = ?");
    const seedIns = db.prepare(
      `INSERT INTO lookup_codes(category, code, label, name_en, name_ar, sort_order, is_active, created_at)
       VALUES('TEMPLATE_CATEGORY', ?, ?, ?, ?, ?, 1, ?)`
    );
    CATEGORY_SEED.forEach(([code, en, ar], i) => { if (!seedExists.get(code)) seedIns.run(code, en, en, ar, i, now); });

    const hasSearch = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workspace_search'").get();
    if (hasSearch) {
      db.exec(`
        DROP TRIGGER IF EXISTS workspace_search_company_documents_ai;
        DROP TRIGGER IF EXISTS workspace_search_company_documents_au;
        DROP TRIGGER IF EXISTS workspace_search_company_documents_ad;

        CREATE TRIGGER workspace_search_company_documents_ai AFTER INSERT ON company_documents BEGIN
          INSERT INTO workspace_search VALUES(new.user_id, ${SEARCH_KIND('new')}, new.id, new.name,
            COALESCE(new.category, ''), COALESCE(new.notes, ''), new.updated_at);
        END;
        CREATE TRIGGER workspace_search_company_documents_au AFTER UPDATE ON company_documents BEGIN
          DELETE FROM workspace_search WHERE kind IN ('company-document', 'template') AND entity_id = old.id;
          INSERT INTO workspace_search VALUES(new.user_id, ${SEARCH_KIND('new')}, new.id, new.name,
            COALESCE(new.category, ''), COALESCE(new.notes, ''), new.updated_at);
        END;
        CREATE TRIGGER workspace_search_company_documents_ad AFTER DELETE ON company_documents BEGIN
          DELETE FROM workspace_search WHERE kind IN ('company-document', 'template') AND entity_id = old.id;
        END;
      `);
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
