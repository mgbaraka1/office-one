// Migration 051 — track whether a Knowledge Hub article's `content` is the
// legacy plain-text/Markdown-lite format or Quill-authored sanitized HTML.
//
// Existing rows keep rendering through the original Markdown-lite renderer
// (content_format = 'text', the default). Only articles saved through the new
// rich-text editor are written as 'html'. No bulk conversion of existing
// content is performed.
module.exports = {
  version: 51,
  name: 'knowledge_content_format',
  up(db) {
    db.exec(`
      ALTER TABLE knowledge_items ADD COLUMN content_format TEXT NOT NULL DEFAULT 'text';
    `);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
