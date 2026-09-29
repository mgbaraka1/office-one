// Migration 068 — Knowledge Hub: find a document by client or system.
//
// 044 dropped 043's client/system/project links to make the Hub tag-only. Real
// use turned out the other way: documents are looked up by the client or the
// system they belong to. So the two lookup junctions come back, same shape as
// 043 (and as project_companies / project_systems):
//
//   knowledge_item_companies   item ↔ COMPANY lookup (the Clients page list)
//   knowledge_item_systems     item ↔ SYSTEM lookup
//
// ON DELETE CASCADE from the item only; lookup codes are soft-disabled, never
// deleted (a merge repoints them — see LOOKUP_MERGE_TARGETS in db.js).
//
// Also:
//   knowledge_attachments.change_note   "what changed" in this version (Phase 3
//                                       of the redesign; added here so the
//                                       whole redesign needs one migration).
//   KNOWLEDGE_TYPE FIELD_MAPPING         a new document kind, seeded if absent.
//                                       Existing kinds are left as they are.
//
// Quick Find: the knowledge row's subtitle becomes its client and system names
// (it was the status), and the body gains every client/system spelling (code,
// label, English, Arabic), the document names and the kind. The three 046
// knowledge triggers are dropped and recreated with the joins, and links,
// documents or a renamed client/system/kind re-index the items they touch.
//
// Idempotent: IF NOT EXISTS / column checks, DROP TRIGGER IF EXISTS, and the
// knowledge search rows are deleted and rebuilt.
const NAMES = (table, column, k) => `
  SELECT COALESCE(NULLIF(lc.name_en, ''), lc.label) AS n, lc.sort_order AS s, lc.label AS l
    FROM ${table} x JOIN lookup_codes lc ON lc.id = x.${column}
   WHERE x.item_id = ${k}.id`;
const SPELLINGS = (table, column, k) => `
  COALESCE((SELECT group_concat(lc.code || ' ' || lc.label || ' ' || lc.name_en || ' ' || lc.name_ar, ' ')
              FROM ${table} x JOIN lookup_codes lc ON lc.id = x.${column}
             WHERE x.item_id = ${k}.id), '')`;
const ROW = k => `
  ${k}.user_id, 'knowledge', ${k}.id, ${k}.title,
  COALESCE((SELECT group_concat(n, ' · ') FROM (
    SELECT n FROM (${NAMES('knowledge_item_companies', 'company_id', k)} ORDER BY s, l)
    UNION ALL
    SELECT n FROM (${NAMES('knowledge_item_systems', 'system_id', k)} ORDER BY s, l)
  )), ''),
  COALESCE(${k}.summary, '') || ' ' || COALESCE(${k}.content, '') || ' ' ||
  ${SPELLINGS('knowledge_item_companies', 'company_id', k)} || ' ' ||
  ${SPELLINGS('knowledge_item_systems', 'system_id', k)} || ' ' ||
  COALESCE((SELECT group_concat(COALESCE(a.document_name, '') || ' ' || COALESCE(a.original_name, ''), ' ')
              FROM knowledge_attachments a WHERE a.item_id = ${k}.id), '') || ' ' ||
  COALESCE((SELECT lc.label || ' ' || lc.name_en || ' ' || lc.name_ar FROM lookup_codes lc WHERE lc.id = ${k}.type_id), ''),
  ${k}.updated_at`;
// Re-index an item by re-writing its own row; the knowledge _au trigger does the rest.
const TOUCH = id => `UPDATE knowledge_items SET updated_at = updated_at WHERE id = ${id};`;

module.exports = {
  version: 68,
  name: 'knowledge_clients_systems',
  destructive: false,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_item_companies (
        item_id    INTEGER NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
        company_id INTEGER NOT NULL REFERENCES lookup_codes(id),
        PRIMARY KEY(item_id, company_id)
      );
      CREATE TABLE IF NOT EXISTS knowledge_item_systems (
        item_id   INTEGER NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
        system_id INTEGER NOT NULL REFERENCES lookup_codes(id),
        PRIMARY KEY(item_id, system_id)
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_item_companies_company ON knowledge_item_companies(company_id, item_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_item_systems_system ON knowledge_item_systems(system_id, item_id);
    `);

    const hasColumn = db.prepare('PRAGMA table_info(knowledge_attachments)').all().some(c => c.name === 'change_note');
    if (!hasColumn) db.exec("ALTER TABLE knowledge_attachments ADD COLUMN change_note TEXT NOT NULL DEFAULT ''");

    db.prepare(
      `INSERT OR IGNORE INTO lookup_codes(category, code, label, name_en, name_ar, sort_order, is_active, created_at)
       VALUES('KNOWLEDGE_TYPE', 'FIELD_MAPPING', 'Field Mapping', 'Field Mapping', 'ربط الحقول', 1, 1, ?)`
    ).run(new Date().toISOString());

    const hasSearch = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workspace_search'").get();
    if (!hasSearch) return;

    db.exec(`
      DROP TRIGGER IF EXISTS workspace_search_knowledge_ai;
      DROP TRIGGER IF EXISTS workspace_search_knowledge_au;
      DROP TRIGGER IF EXISTS workspace_search_knowledge_ad;
      DELETE FROM workspace_search WHERE kind = 'knowledge';

      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT ${ROW('k')} FROM knowledge_items k;

      CREATE TRIGGER workspace_search_knowledge_ai AFTER INSERT ON knowledge_items BEGIN
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(${ROW('new')});
      END;
      CREATE TRIGGER workspace_search_knowledge_au AFTER UPDATE ON knowledge_items BEGIN
        DELETE FROM workspace_search WHERE kind = 'knowledge' AND entity_id = old.id;
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(${ROW('new')});
      END;
      CREATE TRIGGER workspace_search_knowledge_ad AFTER DELETE ON knowledge_items BEGIN
        DELETE FROM workspace_search WHERE kind = 'knowledge' AND entity_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS workspace_search_knowledge_companies_ai AFTER INSERT ON knowledge_item_companies BEGIN
        ${TOUCH('new.item_id')}
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_knowledge_companies_au AFTER UPDATE ON knowledge_item_companies BEGIN
        ${TOUCH('new.item_id')}
        ${TOUCH('old.item_id')}
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_knowledge_companies_ad AFTER DELETE ON knowledge_item_companies BEGIN
        ${TOUCH('old.item_id')}
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_knowledge_systems_ai AFTER INSERT ON knowledge_item_systems BEGIN
        ${TOUCH('new.item_id')}
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_knowledge_systems_au AFTER UPDATE ON knowledge_item_systems BEGIN
        ${TOUCH('new.item_id')}
        ${TOUCH('old.item_id')}
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_knowledge_systems_ad AFTER DELETE ON knowledge_item_systems BEGIN
        ${TOUCH('old.item_id')}
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_knowledge_attachments_ai AFTER INSERT ON knowledge_attachments BEGIN
        ${TOUCH('new.item_id')}
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_knowledge_attachments_au
      AFTER UPDATE OF document_name, original_name, item_id ON knowledge_attachments BEGIN
        ${TOUCH('new.item_id')}
        ${TOUCH('old.item_id')}
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_knowledge_attachments_ad AFTER DELETE ON knowledge_attachments BEGIN
        ${TOUCH('old.item_id')}
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_knowledge_lookup_au
      AFTER UPDATE OF code, label, name_en, name_ar ON lookup_codes
      WHEN new.category IN ('COMPANY', 'SYSTEM', 'KNOWLEDGE_TYPE') BEGIN
        UPDATE knowledge_items SET updated_at = updated_at
         WHERE type_id = new.id
            OR id IN (SELECT item_id FROM knowledge_item_companies WHERE company_id = new.id
                      UNION SELECT item_id FROM knowledge_item_systems WHERE system_id = new.id);
      END;
    `);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
