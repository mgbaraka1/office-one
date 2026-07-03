// Migration 015 — expand ENTRY_STATUS with Open and Blocked.
//
// The task status set was a hardcoded binary (Done / In Progress) baked into the
// UI in several places (status badges, dropdowns, bulk actions, filter chips) even
// though ENTRY_STATUS is a normal lookup category. This migration only touches the
// lookup catalog — it seeds the two new codes and reorders all four into the
// approved workflow sequence: Open → In Progress → Blocked → Done. Existing rows
// (tasks/work_logs) are untouched; every task currently DONE or IN_PROGRESS keeps
// that exact status — only the two new codes are new and unreferenced until the
// UI (this same effort, separate commit-less edit) offers them.
//
// Idempotent: re-running finds the codes already present and just re-applies the
// same sort_order (a no-op).
module.exports = {
  version: 15,
  name: 'status_open_blocked',
  up(db) {
    const now = new Date().toISOString();

    const seedExists = db.prepare("SELECT 1 FROM lookup_codes WHERE category='ENTRY_STATUS' AND code=?");
    const seedIns = db.prepare(
      `INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at)
       VALUES('ENTRY_STATUS', ?, ?, ?, 1, ?)`
    );
    const NEW_CODES = [['OPEN', 'Open'], ['BLOCKED', 'Blocked']];
    for (const [code, label] of NEW_CODES) {
      if (!seedExists.get(code)) seedIns.run(code, label, 0, now);
    }

    // Reorder all four into the approved workflow sequence.
    const setSort = db.prepare("UPDATE lookup_codes SET sort_order=? WHERE category='ENTRY_STATUS' AND code=?");
    const ORDER = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE'];
    ORDER.forEach((code, i) => setSort.run(i, code));
  },
};
