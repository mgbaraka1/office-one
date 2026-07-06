// Migration 034 — Trim Task Source Types down to Jira / Email / Meeting / Phone Call.
//
// Migration 033 originally seeded six TASK_SOURCE_TYPE codes (Jira / Email /
// Teams-Chat / Meeting / Phone Call / Other-Manual). Shortly after shipping,
// the two least-needed types (Teams-Chat, Other-Manual) were dropped from the
// feature's scope entirely, and the two most-used types were narrowed to a
// single field each — Jira is now URL-only, Email is now title/subject-only
// (both a renderer-only change in index.html's TASK_SOURCE_FIELD_DEFS, no
// schema impact, not part of this migration).
//
// Since 033 had already applied to real data by the time this was decided,
// and an already-applied migration can never be edited to change its outcome
// for a DB that ran it (see "editing an already-applied migration" in
// CLAUDE.md), the two retired codes are soft-disabled here instead of being
// removed from 033's own seed list — the same universal "soft-disable
// (is_active=0), never hard-delete a lookup code" rule every other category
// in this schema follows, since a code could already be referenced by a real
// task_sources row (lkLabel/lkCode resolve by id regardless of is_active, so
// any existing row keeps displaying correctly). Existence-guarded (only
// updates a code that's still active) so a hypothetical re-run is a no-op.
//
// Purely additive in effect (no column/table change, no row deleted): two
// `UPDATE ... SET is_active = 0` calls. Runs foreign_key_check after, per
// convention.
module.exports = {
  version: 34,
  name: 'trim_task_source_types',
  up(db) {
    const disable = db.prepare(
      "UPDATE lookup_codes SET is_active = 0 WHERE category = 'TASK_SOURCE_TYPE' AND code = ? AND is_active = 1"
    );
    disable.run('TEAMS_CHAT');
    disable.run('OTHER');

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
