// Migration 047 — promote COMPANY lookups into bilingual client profiles.
//
// Existing relationships remain untouched: tasks, projects and client
// infrastructure already reference lookup_codes.id. The existing COMPANY
// `code` is therefore the stable business code, while these two additive
// columns provide explicit English and Arabic profile names. Existing labels
// become the English name so no client is renamed or disconnected.
module.exports = {
  version: 47,
  name: 'client_profiles',
  destructive: false,
  up(db) {
    db.exec(`
      ALTER TABLE lookup_codes ADD COLUMN name_en TEXT NOT NULL DEFAULT '';
      ALTER TABLE lookup_codes ADD COLUMN name_ar TEXT NOT NULL DEFAULT '';

      UPDATE lookup_codes
         SET name_en = label
       WHERE category = 'COMPANY' AND name_en = '';

      CREATE INDEX idx_lookup_company_profile_names
        ON lookup_codes(category, name_en, name_ar)
        WHERE category = 'COMPANY';
    `);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
