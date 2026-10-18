// Migration 078 — Code Notes: a Knowledge Hub kind for Markdown notes.
//
// A code note is an ordinary knowledge item whose `content` is Markdown
// (`content_format = 'markdown'`, a value the column has accepted since 051 —
// it carries no CHECK). Its scripts and queries live in fenced code blocks
// inside that text, so the item's existing search triggers already index them
// and nothing about the table changes. All this migration does is seed the
// kind:
//
//   KNOWLEDGE_TYPE CODE_NOTE   'Code Note' / 'ملاحظة برمجية', sorted last
//
// Existing kinds and items are left as they are. Idempotent: INSERT OR IGNORE
// on the (category, code) unique key.
module.exports = {
  version: 78,
  name: 'code_notes',
  destructive: false,
  up(db) {
    const next = db.prepare(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM lookup_codes WHERE category = 'KNOWLEDGE_TYPE'"
    ).get().n;
    db.prepare(
      `INSERT OR IGNORE INTO lookup_codes(category, code, label, name_en, name_ar, sort_order, is_active, created_at)
       VALUES('KNOWLEDGE_TYPE', 'CODE_NOTE', 'Code Note', 'Code Note', 'ملاحظة برمجية', ?, 1, ?)`
    ).run(next, new Date().toISOString());

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
