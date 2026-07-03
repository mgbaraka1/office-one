// Migration 016 — Company Documents.
//
// Adds a standalone module for tracking company-level documents that need
// periodic renewal (e.g. VAT Certificate, Trade License) — independent of the
// Projects module. Unlike `project_documents` (a fixed per-project catalog slot
// that survives file removal), each `company_documents` row IS a user-created
// card: it owns its own name/category/renewal date/notes and at most one
// uploaded file. Deleting a card deletes the row (file-on-disk handling mirrors
// the Projects delete/undo dance, added in db.js, not here).
//
// Changes (purely additive):
//   1. Seeds a new `COMPANY_DOCUMENT_CATEGORY` lookup category (Settings-managed,
//      like every other bounded classification in this app) with a starter set
//      of common document categories.
//   2. Creates `company_documents` with inline file-metadata columns (the same
//      shape `project_documents` grew into after migration 011), so a card's
//      file lives at <userData>/company_documents/{id}/{timestamp}.{ext} with
//      only its relative path + metadata stored here.
//
// Runs in the default migration transaction.
module.exports = {
  version: 16,
  name: 'company_documents',
  up(db) {
    // ── 1. Seed the COMPANY_DOCUMENT_CATEGORY lookup category ────────────────────
    const now = new Date().toISOString();
    const seedExists = db.prepare("SELECT 1 FROM lookup_codes WHERE category = 'COMPANY_DOCUMENT_CATEGORY' AND code = ?");
    const seedIns = db.prepare(
      `INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at)
       VALUES('COMPANY_DOCUMENT_CATEGORY', ?, ?, ?, 1, ?)`
    );
    const CATEGORY_SEED = [
      ['LEGAL', 'Legal', 0],
      ['TAX', 'Tax', 1],
      ['CERTIFICATION', 'Certification', 2],
      ['REGISTRATION', 'Registration', 3],
      ['INSURANCE', 'Insurance', 4],
      ['CORPORATE', 'Corporate', 5],
      ['OTHER', 'Other', 6],
    ];
    for (const [code, label, sort] of CATEGORY_SEED) {
      if (!seedExists.get(code)) seedIns.run(code, label, sort, now);
    }

    // ── 2. Company Documents table ────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS company_documents (
        id            INTEGER PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id),
        name          TEXT NOT NULL DEFAULT '',
        category      TEXT,
        renewal_date  TEXT,
        notes         TEXT NOT NULL DEFAULT '',
        file_path     TEXT,
        original_name TEXT,
        file_size     INTEGER,
        mime_type     TEXT,
        uploaded_at   TEXT,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_company_documents_user ON company_documents(user_id, sort_order);
    `);

    // Integrity: every FK must still point at a real row (or be NULL).
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
