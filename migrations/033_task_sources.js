// Migration 033 — Structured Task Sources.
//
// Replaces the free-text tasks.source column's role going forward with a real
// one-to-many child table: a task can now carry any number of source entries
// (e.g. 3 Jira tickets + 4 email threads), each typed via a new
// TASK_SOURCE_TYPE lookup category (Jira / Email / Teams-Chat / Meeting /
// Phone Call / Other-Manual — Teams-Chat and Other were soft-disabled by
// migration 034 shortly after this one shipped; see that migration's own
// note for why the codes themselves are kept here rather than edited out of
// this already-applied migration's seed list). A child table was chosen over
// adding more columns to `tasks` (as 029/031 did for department_id/category_id)
// because
// this is genuinely multi-valued, not 1:1 — mirrors work_logs/project_documents'
// shape (id, user_id, task_id FK CASCADE, ...), which scales correctly with
// many tasks × many sources × many users, unlike a JSON blob column.
//
// source_type_id is a nullable FK -> lookup_codes (TASK_SOURCE_TYPE category),
// same NULL-means-unset convention as every other lookup FK in this schema.
// source_ref holds the type's primary identifying value (ticket key / email
// subject / channel-or-person / meeting title / caller name / free text for
// Other); source_url an optional link; source_meta an optional JSON blob for
// the remaining per-type optional fields (sender, date), read via the
// existing safeParse() convention.
//
// Backfill: every task with a non-empty legacy `source` gets exactly one new
// task_sources row seeded as type=EMAIL with source_ref = that old text (the
// user's own call — historical `source` values are almost always an email
// subject line in practice, and re-classifying a handful of tasks later is
// easy; guessing per-row from free text would be lossy). The legacy
// `tasks.source` column itself is only ever READ here, never altered or
// dropped, and keeps working exactly as before for any code that still reads
// it directly. Guarded per-task (only backfills a task with zero existing
// task_sources rows) so a hypothetical re-run is a no-op.
//
// Purely additive: one new seeded lookup category, one new table + indexes,
// one data-only backfill INSERT. Runs foreign_key_check after, per convention.
module.exports = {
  version: 33,
  name: 'task_sources',
  up(db) {
    const now = new Date().toISOString();

    const seedExists = db.prepare("SELECT 1 FROM lookup_codes WHERE category = 'TASK_SOURCE_TYPE' AND code = ?");
    const seedIns = db.prepare(
      `INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at)
       VALUES('TASK_SOURCE_TYPE', ?, ?, ?, 1, ?)`
    );
    const SEED = [
      ['JIRA', 'Jira', 0],
      ['EMAIL', 'Email', 1],
      ['TEAMS_CHAT', 'Teams / Chat', 2],
      ['MEETING', 'Meeting', 3],
      ['PHONE_CALL', 'Phone Call', 4],
      ['OTHER', 'Other / Manual', 5],
    ];
    for (const [code, label, sort] of SEED) {
      if (!seedExists.get(code)) seedIns.run(code, label, sort, now);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS task_sources (
        id             INTEGER PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id),
        task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        source_type_id INTEGER REFERENCES lookup_codes(id),
        source_ref     TEXT NOT NULL DEFAULT '',
        source_url     TEXT NOT NULL DEFAULT '',
        source_meta    TEXT,
        sort_order     INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_sources_task ON task_sources(task_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_task_sources_user ON task_sources(user_id);
    `);

    const emailTypeId = db.prepare(
      "SELECT id FROM lookup_codes WHERE category = 'TASK_SOURCE_TYPE' AND code = 'EMAIL'"
    ).get().id;
    const tasksToBackfill = db.prepare(
      `SELECT id, user_id, source FROM tasks
       WHERE TRIM(COALESCE(source, '')) != ''
         AND id NOT IN (SELECT DISTINCT task_id FROM task_sources)`
    ).all();
    const insertSource = db.prepare(
      `INSERT INTO task_sources(user_id, task_id, source_type_id, source_ref, source_url, source_meta, sort_order, created_at, updated_at)
       VALUES(?, ?, ?, ?, '', NULL, 0, ?, ?)`
    );
    for (const t of tasksToBackfill) {
      insertSource.run(t.user_id, t.id, emailTypeId, t.source, now, now);
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
