// Migration 010 — Project documents become a configurable lookup category.
//
// The three tracked per-project documents used to be hardcoded text values
// ('Quotation' / 'Quotation Approval' / 'Invoice') auto-created on project
// insert. This promotes them into the shared lookup catalog as a new
// `PROJECT_DOCUMENT` category, manageable from Settings → Project Documents like
// any other lookup (relabel / reorder / soft-disable / add). The document types a
// project tracks are now driven by the active catalog rows, not a code constant.
//
// Changes:
//   1. Seed the `PROJECT_DOCUMENT` category with the three existing types, each
//      with a stable UPPERCASE code (the immutable identity rows point at).
//   2. Rewrite existing `project_documents.document_type` values from their old
//      display label to the matching stable code (consistent with the app's other
//      code-keyed columns).
//   3. Add a UNIQUE index on (project_id, document_type) so availability can be
//      persisted with an UPSERT keyed by the document code (rows are now created
//      lazily on first toggle rather than eagerly on project insert).
//
// Purely additive to the schema (seed rows + an index + an in-place value rewrite);
// no columns dropped. Runs in the default migration transaction.
module.exports = {
  version: 10,
  name: 'project_document_lookups',
  up(db) {
    // ── 1. Seed the PROJECT_DOCUMENT lookup category ─────────────────────────────
    const now = new Date().toISOString();
    const seedExists = db.prepare("SELECT 1 FROM lookup_codes WHERE category = 'PROJECT_DOCUMENT' AND code = ?");
    const seedIns = db.prepare(
      `INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at)
       VALUES('PROJECT_DOCUMENT', ?, ?, ?, 1, ?)`
    );
    const DOC_SEED = [
      ['QUOTATION', 'Quotation', 0],
      ['QUOTATION_APPROVAL', 'Quotation Approval', 1],
      ['INVOICE', 'Invoice', 2],
    ];
    for (const [code, label, sort] of DOC_SEED) {
      if (!seedExists.get(code)) seedIns.run(code, label, sort, now);
    }

    // ── 2. Rewrite existing document_type labels → stable codes ──────────────────
    const upd = db.prepare('UPDATE project_documents SET document_type = ? WHERE document_type = ?');
    for (const [code, label] of DOC_SEED) upd.run(code, label);

    // ── 3. Unique (project_id, document_type) — the UPSERT conflict target ────────
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_project_documents_unique ON project_documents(project_id, document_type)');

    // Integrity: every FK must still point at a real row (or be NULL).
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
