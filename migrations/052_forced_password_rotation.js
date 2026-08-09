// Migration 052 — forced password rotation.
//
// Until now an admin creating an account, or resetting someone else's
// password, had no way to make sure the person actually changes that
// admin-assigned password — the "Temporary password" label on the create-user
// form was a promise nothing enforced. This adds a flag the login flow checks:
// when set, the user must choose their own new password before the app boots.
module.exports = {
  version: 52,
  name: 'forced_password_rotation',
  up(db) {
    db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  },
};
