// Migration 014 — Drop the retired `backlog` table.
//
// The "Not Yet" pool became `tasks` with zero `work_logs` in the two-level model;
// migration 013 already moved every `backlog` row into a task and cleared the
// table, and the app no longer reads or writes it (the `backlog:*` channels and
// their db.js helpers are gone). This drops the now-empty, unreferenced table.
//
// Nothing FK-references `backlog`, so the drop is clean. `IF EXISTS` keeps it a
// no-op on any DB where the table was already removed (idempotent / rollback-safe).
// A `foreign_key_check` afterwards confirms no dangling references remain.
module.exports = {
  version: 14,
  name: 'drop_backlog',
  up(db) {
    db.exec('DROP TABLE IF EXISTS backlog');

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
