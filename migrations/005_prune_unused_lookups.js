// Migration 005 — prune unused COMPANY / PROJECT lookup codes.
//
// The free-form display categories (COMPANY, PROJECT) were seeded in 003 from the
// union of the old lookups blob + the data, so a few values that lived only in the
// blob (never used by any entry) carried over as dead dropdown clutter. This
// removes any COMPANY/PROJECT code with ZERO references in day_entries + backlog.
//
// Scope is deliberately limited to those two growing display categories: the fixed
// enums (ENTRY_STATUS, TIME_TYPE, CURRENCY, BILLING_CYCLE) intentionally keep
// zero-reference options (e.g. "In Progress", "EUR", "Monthly") because they are
// valid selectable choices, not clutter. A zero-reference code is safe to hard
// delete — nothing points at it, so no FK can dangle.
//
// On the live DB this removes exactly one code: COMPANY/ARABIAN_SHIELD.
module.exports = {
  version: 5,
  name: 'prune_unused_lookups',
  up(db) {
    const PRUNE = [
      ['COMPANY', 'company_id'],
      ['PROJECT', 'project_id'],
    ];

    const del = db.prepare('DELETE FROM lookup_codes WHERE id = ?');
    for (const [category, fk] of PRUNE) {
      const unused = db.prepare(
        `SELECT lc.id, lc.code FROM lookup_codes lc
         WHERE lc.category = ?
           AND NOT EXISTS (SELECT 1 FROM day_entries e WHERE e.${fk} = lc.id)
           AND NOT EXISTS (SELECT 1 FROM backlog     b WHERE b.${fk} = lc.id)`
      ).all(category);
      for (const row of unused) del.run(row.id);
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
