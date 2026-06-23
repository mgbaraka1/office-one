// Migration 004 — merge duplicate lookup codes (operator-requested cleanup).
//
// Migration 003 faithfully seeded EVERY distinct historical value, including a few
// ad-hoc duplicates / near-duplicates. This migration merges each duplicate into
// its canonical code: it repoints every row that references the source code (in
// day_entries + backlog) to the target code, then deletes the now-unreferenced
// source code. No timesheet data is lost — entries are preserved, only their
// category FK is moved; nothing but the redundant catalog row is removed.
//
// Merges (target ← sources):
//   COMPANY  ACME_GROUP ← ACME
//   PROJECT  BILLING            ← BILLING_WEB, BILLING_LEGACY
//   PROJECT  QA_2025 ← QA_PILOT
//   PROJECT  DR               ← SQL_DR
//   PROJECT  CLIENT_PORTAL    ← B2B_PORTAL
//   PROJECT  MANAGEMENT       ← MGMT_LEGACY
module.exports = {
  version: 4,
  name: 'merge_lookups',
  up(db) {
    // category → the FK columns that reference it, as [table, column].
    const FK_COLUMNS = {
      COMPANY: [['day_entries', 'company_id'], ['backlog', 'company_id']],
      PROJECT: [['day_entries', 'project_id'], ['backlog', 'project_id']],
    };

    // [category, targetCode, [...sourceCodes]]
    const MERGES = [
      ['COMPANY', 'ACME_GROUP', ['ACME']],
      ['PROJECT', 'BILLING',            ['BILLING_WEB', 'BILLING_LEGACY']],
      ['PROJECT', 'QA_2025', ['QA_PILOT']],
      ['PROJECT', 'DR',               ['SQL_DR']],
      ['PROJECT', 'CLIENT_PORTAL',    ['B2B_PORTAL']],
      ['PROJECT', 'MANAGEMENT',       ['MGMT_LEGACY']],
    ];

    const idOf = (category, code) => {
      const r = db.prepare('SELECT id FROM lookup_codes WHERE category = ? AND code = ?').get(category, code);
      return r ? r.id : null;
    };
    const delCode = db.prepare('DELETE FROM lookup_codes WHERE id = ?');

    for (const [category, targetCode, sourceCodes] of MERGES) {
      const targetId = idOf(category, targetCode);
      if (targetId == null) throw new Error(`004 merge: target ${category}/${targetCode} not found`);
      const cols = FK_COLUMNS[category];

      for (const srcCode of sourceCodes) {
        const srcId = idOf(category, srcCode);
        if (srcId == null) continue;                  // already merged / never existed — skip
        for (const [table, column] of cols) {
          db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(targetId, srcId);
        }
        delCode.run(srcId);                           // safe: no rows reference it anymore
      }
    }

    // Integrity: no FK should dangle after the repoint + delete.
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
