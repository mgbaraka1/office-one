// Migration 064 — Offers / CRs record the client's channel instead of an
// email address and phone number.
//
// The contact section is now Name + Channel (EMAIL or JIRA) + one reference:
// the email title/subject for EMAIL, the ticket URL for JIRA — the same split
// Task Sources use (migration 034). Two plain columns added with ADD COLUMN,
// so no table rebuild: pfm_items keeps its indexes and its workspace_search
// triggers (063) untouched.
//
// client_contact_email / client_contact_phone / notes stay in the table (no
// data is dropped); the app simply stops showing or writing them.
module.exports = {
  version: 64,
  name: 'pfm_client_channel',
  destructive: false,
  up(db) {
    const table = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pfm_items'"
    ).get();
    if (!table) return;
    const cols = new Set(db.prepare('PRAGMA table_info(pfm_items)').all().map(c => c.name));
    if (!cols.has('client_channel')) {
      db.exec("ALTER TABLE pfm_items ADD COLUMN client_channel TEXT NOT NULL DEFAULT ''");
    }
    if (!cols.has('client_channel_ref')) {
      db.exec("ALTER TABLE pfm_items ADD COLUMN client_channel_ref TEXT NOT NULL DEFAULT ''");
    }
  },
};
