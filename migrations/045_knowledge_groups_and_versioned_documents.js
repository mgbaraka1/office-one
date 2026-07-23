// Migration 045 — simplify Knowledge Hub governance and add organization.
//
// Reference URLs and review dates are retired. Existing attachment rows are
// preserved and gain document metadata; each is treated as version 1.0. Groups
// are user-owned and many-to-many so one item can appear in several collections.
module.exports = {
  version: 45,
  name: 'knowledge_groups_and_versioned_documents',
  destructive: true,
  up(db) {
    db.exec(`
      DROP INDEX IF EXISTS idx_knowledge_items_review;
      DROP TABLE IF EXISTS knowledge_links;

      ALTER TABLE knowledge_items DROP COLUMN review_date;

      ALTER TABLE knowledge_attachments ADD COLUMN document_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE knowledge_attachments ADD COLUMN version_label TEXT NOT NULL DEFAULT '1.0';
      UPDATE knowledge_attachments
         SET document_name = CASE
           WHEN TRIM(document_name) = '' THEN original_name
           ELSE document_name
         END;

      CREATE TABLE IF NOT EXISTS knowledge_groups (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name        TEXT NOT NULL COLLATE NOCASE,
        description TEXT NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        UNIQUE(user_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_groups_user_sort
        ON knowledge_groups(user_id, sort_order, name);

      CREATE TABLE IF NOT EXISTS knowledge_group_items (
        group_id   INTEGER NOT NULL REFERENCES knowledge_groups(id) ON DELETE CASCADE,
        item_id    INTEGER NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(group_id, item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_group_items_item
        ON knowledge_group_items(item_id, group_id);
    `);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
