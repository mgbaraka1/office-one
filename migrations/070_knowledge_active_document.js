// Migration 070 — one active document per Knowledge Hub item.
//
// The list's "Open file" opens the item's active document. An item has at most
// one: a partial unique index enforces it. Every existing document starts
// inactive; the user picks the active one.
//
//   knowledge_attachments.is_active          0/1, default 0
//   idx_knowledge_attachments_one_active     UNIQUE(item_id) WHERE is_active = 1
//
// ADD COLUMN keeps the table's triggers and indexes. Idempotent: column check,
// IF NOT EXISTS.
module.exports = {
  version: 70,
  name: 'knowledge_active_document',
  destructive: false,
  up(db) {
    const hasColumn = db.prepare('PRAGMA table_info(knowledge_attachments)').all().some(c => c.name === 'is_active');
    if (!hasColumn) {
      db.exec('ALTER TABLE knowledge_attachments ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1))');
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_attachments_one_active
               ON knowledge_attachments(item_id) WHERE is_active = 1`);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
