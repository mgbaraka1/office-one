// Migration 041 — preserve ownership for SYSTEM labels minted from server data.
//
// lookup_codes is intentionally a shared application catalog. Migration 039,
// however, also inserted previously user-owned client_servers.system_name text
// into that global catalog. That made one account's infrastructure labels
// enumerable by every other account. A row in lookup_code_user_access makes a
// lookup private to the listed users; a lookup with no access rows remains a
// normal global catalog option.
//
// Migration 039 used one timestamp for both newly inserted lookup rows and the
// server rows it mapped. That exact equality lets us identify only lookups
// minted by 039 without guessing from labels or touching pre-existing catalog
// entries. Multiple users sharing the same migrated label each receive access.
module.exports = {
  version: 41,
  name: 'private_server_system_lookups',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lookup_code_user_access (
        lookup_id  INTEGER NOT NULL REFERENCES lookup_codes(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL,
        PRIMARY KEY(lookup_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_lookup_code_user_access_user
        ON lookup_code_user_access(user_id, lookup_id);
    `);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO lookup_code_user_access(lookup_id, user_id, created_at)
       WITH migrated AS (
         SELECT DISTINCT lc.id
           FROM lookup_codes lc
           JOIN client_servers s ON s.system_id = lc.id
          WHERE lc.category = 'SYSTEM'
            AND s.updated_at = lc.created_at
       ), permitted AS (
         SELECT s.system_id AS lookup_id, s.user_id
           FROM client_servers s JOIN migrated m ON m.id = s.system_id
         UNION
         SELECT t.system_id, t.user_id
           FROM tasks t JOIN migrated m ON m.id = t.system_id
         UNION
         SELECT ps.system_id, p.user_id
           FROM project_systems ps
           JOIN projects p ON p.id = ps.project_id
           JOIN migrated m ON m.id = ps.system_id
       )
       SELECT lookup_id, user_id, ? FROM permitted`
    ).run(now);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
