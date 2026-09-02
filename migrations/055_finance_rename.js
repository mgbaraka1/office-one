// Migration 055 — retained version number, no longer does any work.
//
// This migration used to rename the Finance module's 12 tables and 21 indexes
// from an earlier prefix, repoint stored attachment paths, and move saved
// "last open module" state onto the new module id. Migration 054 now creates
// the final names directly, so there is nothing left for this one to rename.
//
// The version is kept rather than removed so the sequence stays contiguous and
// so every database that already recorded 055 continues to line up with the
// files on disk. Applying it is a no-op in every direction:
//
//   • a database that recorded 054 also recorded 055 — neither re-runs;
//   • a fresh install gets the final schema from 054, so there is nothing to
//     rename, no attachment rows to repoint, and no saved module state yet;
//   • a database restored from before 054 runs the new 054 and arrives at the
//     same schema by a shorter route.
//
// It is deliberately no longer marked `destructive` — it writes nothing, so a
// pre-migration snapshot would be pure cost.
module.exports = {
  version: 55,
  name: 'finance_rename_noop',
  up() {
    // Intentionally empty. See the note above before adding anything here:
    // this migration runs on databases that already have the final schema.
  },
};
