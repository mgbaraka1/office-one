// Migration 079 — Knowledge Hub tags come back, and Quick Find reaches them.
//
// 043's knowledge_tags / knowledge_item_tags never left the schema; tags were
// only switched off in the app (2026-09-30). They return as the way to file an
// item that belongs to no client and no system (Obsidian notes on Gizmos,
// Gadgets…). No table changes. The search index learns about them:
//
//   workspace_search_knowledge_ai / _au   recreated: the body gains every tag
//                                        name, and an item with no client or
//                                        system shows its tags as the subtitle
//   workspace_search_knowledge_tags_ai / _ad   new: tagging re-indexes the item
//   workspace_search_knowledge_tag_au          new: a renamed tag re-indexes its items
//
// Everything else 068 / 069 built is left as it is. The knowledge search rows
// are deleted and rebuilt from the new body. Idempotent: DROP TRIGGER IF EXISTS.
const NAMES = (table, column, k) => `
  SELECT COALESCE(NULLIF(lc.name_en, ''), lc.label) AS n, lc.sort_order AS s, lc.label AS l
    FROM ${table} x JOIN lookup_codes lc ON lc.id = x.${column}
   WHERE x.item_id = ${k}.id`;
const SPELLINGS = (table, column, k) => `
  COALESCE((SELECT group_concat(lc.code || ' ' || lc.label || ' ' || lc.name_en || ' ' || lc.name_ar, ' ')
              FROM ${table} x JOIN lookup_codes lc ON lc.id = x.${column}
             WHERE x.item_id = ${k}.id), '')`;
const TAGS = (k, separator, prefix) => `
  COALESCE((SELECT group_concat(n, '${separator}') FROM (
    SELECT '${prefix}' || t.name AS n FROM knowledge_item_tags x JOIN knowledge_tags t ON t.id = x.tag_id
     WHERE x.item_id = ${k}.id ORDER BY t.name COLLATE NOCASE
  )), '')`;
const ROW = k => `
  ${k}.user_id, 'knowledge', ${k}.id, ${k}.title,
  COALESCE(NULLIF((SELECT group_concat(n, ' · ') FROM (
    SELECT n FROM (${NAMES('knowledge_item_companies', 'company_id', k)} ORDER BY s, l)
    UNION ALL
    SELECT n FROM (${NAMES('knowledge_item_systems', 'system_id', k)} ORDER BY s, l)
  )), ''), ${TAGS(k, ' · ', '#')}),
  COALESCE(${k}.summary, '') || ' ' || COALESCE(${k}.content, '') || ' ' ||
  ${SPELLINGS('knowledge_item_companies', 'company_id', k)} || ' ' ||
  ${SPELLINGS('knowledge_item_systems', 'system_id', k)} || ' ' ||
  ${TAGS(k, ' ', '')} || ' ' ||
  COALESCE((SELECT group_concat(COALESCE(a.document_name, '') || ' ' || COALESCE(a.original_name, '') || ' ' || COALESCE(a.change_note, ''), ' ')
              FROM knowledge_attachments a WHERE a.item_id = ${k}.id), '') || ' ' ||
  COALESCE((SELECT lc.label || ' ' || lc.name_en || ' ' || lc.name_ar FROM lookup_codes lc WHERE lc.id = ${k}.type_id), ''),
  ${k}.updated_at`;
const TOUCH = id => `UPDATE knowledge_items SET updated_at = updated_at WHERE id = ${id};`;

module.exports = {
  version: 79,
  name: 'knowledge_tags_search',
  destructive: false,
  up(db) {
    const has = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
    if (!has('workspace_search') || !has('knowledge_tags') || !has('knowledge_item_tags')) return;

    db.exec(`
      DROP TRIGGER IF EXISTS workspace_search_knowledge_ai;
      DROP TRIGGER IF EXISTS workspace_search_knowledge_au;
      DROP TRIGGER IF EXISTS workspace_search_knowledge_tags_ai;
      DROP TRIGGER IF EXISTS workspace_search_knowledge_tags_ad;
      DROP TRIGGER IF EXISTS workspace_search_knowledge_tag_au;
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
      CREATE TRIGGER workspace_search_knowledge_tags_ai AFTER INSERT ON knowledge_item_tags BEGIN
        ${TOUCH('new.item_id')}
      END;
      CREATE TRIGGER workspace_search_knowledge_tags_ad AFTER DELETE ON knowledge_item_tags BEGIN
        ${TOUCH('old.item_id')}
      END;
      CREATE TRIGGER workspace_search_knowledge_tag_au AFTER UPDATE OF name ON knowledge_tags BEGIN
        UPDATE knowledge_items SET updated_at = updated_at
         WHERE id IN (SELECT item_id FROM knowledge_item_tags WHERE tag_id = new.id);
      END;
    `);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
