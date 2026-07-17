// Adds the minimum account-management role model and moves renderer-facing
// preferences out of the machine/global key-value stores. Lookup rows remain a
// shared catalog, but only administrators may mutate them (enforced in main.js).

module.exports = {
  version: 40,
  name: 'accounts_and_user_preferences',
  up(db) {
    const userCols = new Set(db.prepare('PRAGMA table_info(users)').all().map(r => r.name));
    if (!userCols.has('is_admin')) {
      db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
    }

    // Preserve the existing installation owner as the administrator. On a fresh
    // database setup() explicitly creates the first account as an administrator.
    const first = db.prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
    if (first) db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(first.id);

    db.exec(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key     TEXT NOT NULL,
        value   TEXT NOT NULL,
        PRIMARY KEY(user_id, key)
      );

      CREATE TABLE IF NOT EXISTS user_ui_state (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        value   TEXT NOT NULL
      );
    `);

    // Existing global values belonged to the original account. Copy rather than
    // delete them so rollback/recovery with an older build remains possible.
    if (first) {
      const copySetting = db.prepare(`
        INSERT OR IGNORE INTO user_settings(user_id, key, value)
        SELECT ?, ?, value FROM app_settings WHERE key = ?
      `);
      copySetting.run(first.id, 'default_employee_name', 'default_employee_name');
      copySetting.run(first.id, 'subscriptions_default_currency', 'subscriptions_default_currency');
      db.prepare(`
        INSERT OR IGNORE INTO user_ui_state(user_id, value)
        SELECT ?, value FROM machine_prefs WHERE key = 'ui_state'
      `).run(first.id);
    }
  },
};
