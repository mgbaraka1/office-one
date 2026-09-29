// Migration 069 — Quick Find reaches a document version's "what changed" note.
//
// 068 added knowledge_attachments.change_note; the Hub's own search already
// matches it. This puts it in the Quick Find body too:
//
//   workspace_search_knowledge_ai / _au      recreated, body gains every change_note
//   workspace_search_knowledge_attachments_au now also fires on UPDATE OF change_note
//
// Everything else 068 built is left as it is. The knowledge search rows are
// deleted and rebuilt from the new body. Idempotent: DROP TRIGGER IF EXISTS.
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
  COALESCE((SELECT group_concat(COALESCE(a.document_name, '') || ' ' || COALESCE(a.original_name, '') || ' ' || COALESCE(a.change_note, ''), ' ')
              FROM knowledge_attachments a WHERE a.item_id = ${k}.id), '') || ' ' ||
  COALESCE((SELECT lc.label || ' ' || lc.name_en || ' ' || lc.name_ar FROM lookup_codes lc WHERE lc.id = ${k}.type_id), ''),
  ${k}.updated_at`;
const TOUCH = id => `UPDATE knowledge_items SET updated_at = updated_at WHERE id = ${id};`;

module.exports = {
  version: 69,
  name: 'knowledge_change_note_search',
  destructive: false,
  up(db) {
    const hasSearch = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workspace_search'").get();
    const hasNote = db.prepare('PRAGMA table_info(knowledge_attachments)').all().some(c => c.name === 'change_note');
    if (!hasSearch || !hasNote) return;

    db.exec(`
      DROP TRIGGER IF EXISTS workspace_search_knowledge_ai;
      DROP TRIGGER IF EXISTS workspace_search_knowledge_au;
      DROP TRIGGER IF EXISTS workspace_search_knowledge_attachments_au;
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
      CREATE TRIGGER workspace_search_knowledge_attachments_au
      AFTER UPDATE OF document_name, original_name, change_note, item_id ON knowledge_attachments BEGIN
        ${TOUCH('new.item_id')}
        ${TOUCH('old.item_id')}
      END;
    `);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
