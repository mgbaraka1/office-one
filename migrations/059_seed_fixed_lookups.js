// Migration 059 — seed the fixed enums that migration 003 could not.
//
// Migration 003 built each category as the UNION of the legacy
// `app_settings.lookups` blob and the DISTINCT values already stored in the
// data tables. On an upgrade both sources are populated, so the catalog fills
// correctly. On a BRAND-NEW database both are empty — so TIME_TYPE and
// ACTIVITY_TYPE end up with zero rows, and a first-run user lands on the
// Timesheet with the "Time Type" and "Natural" dropdowns blank and no
// indication why. ENTRY_STATUS, CURRENCY and BILLING_CYCLE escaped this only
// because 003 gave them hardcoded fallback lists; these two never got one.
//
// TIME_TYPE is the sharp edge: it is a fixed enum (Work Time / Over Time /
// Training / Leave / Holiday), not user vocabulary, so nobody should have to
// invent it before they can log a session. ACTIVITY_TYPE is more genuinely
// user-defined, but shipping an empty dropdown as the app's first impression
// is worse than shipping a sensible starting set the user can soft-disable.
//
// Seeds ONLY when the category is completely empty. That is the entire safety
// property of this migration: an existing install has rows, so this is a
// verified no-op there and cannot reorder, relabel or duplicate a catalog
// somebody already curated. It only ever fires on a fresh database.
//
// The codes and Arabic labels are not invented here — they are the canonical
// vocabulary the app already declares in two places: migration 003's CODE_MAP
// (which maps these exact English labels to these exact codes) and migration
// 050's Arabic table (which already carries name_ar for every one of them).
// Keeping them identical means a fresh install and an upgraded install end up
// with the same catalog, so a code means the same thing in every database.
//
// name_en/name_ar are written explicitly because 050 has already run by this
// point and will not backfill rows inserted after it.
module.exports = {
  version: 59,
  name: 'seed_fixed_lookups',
  destructive: false,
  up(db) {
    const now = new Date().toISOString();

    // [code, label (== name_en), name_ar]
    const SEED = {
      TIME_TYPE: [
        ['WORK_TIME', 'Work Time', 'وقت العمل'],
        ['OVERTIME',  'Over Time', 'وقت إضافي'],
        ['TRAINING',  'Training',  'تدريب'],
        ['LEAVE',     'Leave',     'إجازة'],
        ['HOLIDAY',   'Holiday',   'عطلة'],
      ],
      ACTIVITY_TYPE: [
        ['TICKET',  'Ticket',  'تذكرة'],
        ['TASK',    'Task',    'مهمة'],
        ['MEETING', 'Meeting', 'اجتماع'],
        ['CALL',    'Call',    'مكالمة'],
        ['EMAIL',   'Email',   'بريد إلكتروني'],
      ],
    };

    const countIn = db.prepare('SELECT COUNT(*) AS n FROM lookup_codes WHERE category = ?');
    const insert = db.prepare(
      `INSERT INTO lookup_codes(category, code, label, name_en, name_ar, sort_order, is_active, created_at)
       VALUES(?, ?, ?, ?, ?, ?, 1, ?)`
    );

    for (const [category, rows] of Object.entries(SEED)) {
      // The guard. A curated catalog is never touched.
      if (countIn.get(category).n > 0) continue;
      rows.forEach(([code, label, nameAr], i) => {
        insert.run(category, code, label, label, nameAr, i, now);
      });
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
