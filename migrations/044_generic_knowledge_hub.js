// Migration 044 — make Knowledge Hub fully generic and tag-centric.
//
// Migration 043 initially allowed optional links to Clients, Systems, and
// Projects. Real usage calls for a standalone library instead: tags are the
// only cross-cutting organization mechanism. Dropping these three junction
// tables removes that domain coupling while preserving every article, tag,
// link, attachment, and review field. Marked destructive so existing databases
// receive the standard pre-migration snapshot before relationship metadata is
// removed.
module.exports = {
  version: 44,
  name: 'generic_knowledge_hub',
  destructive: true,
  up(db) {
    db.exec(`
      DROP TABLE IF EXISTS knowledge_item_companies;
      DROP TABLE IF EXISTS knowledge_item_systems;
      DROP TABLE IF EXISTS knowledge_item_projects;
    `);
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
