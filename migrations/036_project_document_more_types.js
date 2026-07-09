// Migration 036 — Two more Project Document types.
//
// Adds 'Production Approved' (between Quotation Approval and Invoice) and
// 'Invoice Payment' (after Invoice) to the PROJECT_DOCUMENT lookup category
// seeded by migration 010. Existing rows keep their stable codes/sort_order
// for Quotation/Quotation Approval; Invoice's sort_order is bumped to make
// room for Production Approved ahead of it. Purely additive: two seeded
// lookup_codes rows + one sort_order update on an existing row. Runs
// foreign_key_check.
module.exports = {
  version: 36,
  name: 'project_document_more_types',
  up(db) {
    const now = new Date().toISOString();

    // Invoice moves from sort_order 2 -> 3 to make room for Production Approved.
    db.prepare(
      "UPDATE lookup_codes SET sort_order = 3 WHERE category = 'PROJECT_DOCUMENT' AND code = 'INVOICE' AND sort_order = 2"
    ).run();

    const seedExists = db.prepare("SELECT 1 FROM lookup_codes WHERE category = 'PROJECT_DOCUMENT' AND code = ?");
    const seedIns = db.prepare(
      `INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at)
       VALUES('PROJECT_DOCUMENT', ?, ?, ?, 1, ?)`
    );
    const SEED = [
      ['PRODUCTION_APPROVED', 'Production Approved', 2],
      ['INVOICE_PAYMENT', 'Invoice Payment', 4],
    ];
    for (const [code, label, sort] of SEED) {
      if (!seedExists.get(code)) seedIns.run(code, label, sort, now);
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
