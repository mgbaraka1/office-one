// Migration 061 — remove the Finance module entirely.
//
// Finance (contracts, change requests, invoices with payment tracking, and
// minutes of meeting) is being retired so it can be rebuilt from a clean
// design rather than extended in place. This is a deliberate, requested
// teardown, not a bug fix — every finance_* table and its data are dropped,
// and the four catalog categories Finance owned (folded into the shared
// lookup_codes by migration 060) are removed from that catalog too.
//
// WHAT DOES NOT MOVE / STAYS BEHIND
//   • `company_profiles` (migration 056) is NOT touched — it was promoted out
//     of finance_clients into a shared, Finance-independent table that Clients
//     now owns outright.
//   • The shared `COMPANY` and `CURRENCY` lookup_codes categories are NOT
//     touched — Finance only ever read them, never owned them.
//   • `lookup_code_history` rows for the four removed categories are left in
//     place on purpose (see migration 058: history must survive the row it
//     describes disappearing, not cascade away with it).
//   • Uploaded attachment files under <userData>/finance/ are a filesystem
//     concern, not a schema one, and are cleaned up separately — a migration
//     only touches the database.
//
// destructive: true, so applyMigrations() snapshots the whole database to
// pre-migration-backup/ before this runs, on top of whatever backup the
// operator already took by hand.
const FINANCE_TABLES = [
  'finance_attachments',
  'finance_meeting_actions',
  'finance_meetings',
  'finance_invoice_payments',
  'finance_invoice_links',
  'finance_invoices',
  'finance_change_requests',
  'finance_contract_installments',
  'finance_contract_versions',
  'finance_contracts',
  'finance_clients',
  'finance_lookups',
];

const FINANCE_CATALOG_CATEGORIES = ['CONTRACT_STATUS', 'CR_STATUS', 'INVOICE_STATUS', 'PAYMENT_METHOD'];

module.exports = {
  version: 61,
  name: 'drop_finance',
  destructive: true,
  up(db) {
    const hasTable = name => !!db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(name);
    // Nothing to do on a database that never had the Finance tables (or one
    // this migration already ran on).
    if (!hasTable('finance_contracts')) return;

    // Quick Find's FTS index carries rows for finance records that are about
    // to disappear; DROP TABLE removes the triggers that kept them in sync but
    // not the rows already written.
    if (hasTable('workspace_search')) {
      db.exec(`DELETE FROM workspace_search WHERE kind IN
                 ('finance-contract', 'finance-cr', 'finance-invoice', 'finance-meeting')`);
    }

    for (const table of FINANCE_TABLES) {
      if (hasTable(table)) db.exec(`DROP TABLE ${table}`);
    }

    db.prepare(
      `DELETE FROM lookup_codes WHERE category IN (${FINANCE_CATALOG_CATEGORIES.map(() => '?').join(', ')})`
    ).run(...FINANCE_CATALOG_CATEGORIES);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
