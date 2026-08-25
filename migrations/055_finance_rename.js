// Migration 055 — Finance becomes Finance (rename only, no semantic change).
//
// See FINANCE_INTEGRATION_PLAN.md §4. This migration renames the module's 12
// tables and 21 indexes, repoints stored attachment paths at the new upload
// directory, and moves any saved "last open module" state onto the new module
// id. It deliberately changes NO data semantics — every row keeps its meaning,
// its id, and its relationships.
//
// Why a plain (transactional) migration and not manualTransaction: the table
// rebuilds that force manual PRAGMA sequencing elsewhere in this project are
// not needed here. Since SQLite 3.25 `ALTER TABLE ... RENAME TO` rewrites the
// foreign keys that point AT the renamed table, so no table is rebuilt, no FK
// is retargeted by hand, and the whole thing is safe inside one transaction.
// Verified against SQLite 3.53.1, the version node:sqlite ships in Electron 42.
//
// Files are NOT moved here. <userData>/finance_it/ -> <userData>/finance/ happens
// in db.js's runMaintenance() as a resumable catch-up pass, so a crash halfway
// through is a resume rather than a half-migrated tree, and no automatic
// snapshot can capture one. This migration only rewrites the stored paths.
const TABLES = [
  'lookups', 'clients', 'contracts', 'contract_versions', 'contract_installments',
  'change_requests', 'invoices', 'invoice_links', 'invoice_payments',
  'meetings', 'meeting_actions', 'attachments',
];

// Recreated verbatim from migration 054 with idx_finance_ -> idx_finance_ and the
// new table names. SQLite carries a table's indexes across a rename but cannot
// rename an index, so each one is dropped and recreated. The partial WHERE
// clauses are load-bearing invariants, not optimisations — one final version
// per contract, uniqueness only for non-empty codes/refs — and are reproduced
// exactly.
const INDEXES = [
  ['idx_finance_lookups_user_cat', 'CREATE INDEX idx_finance_lookups_user_cat ON finance_lookups(user_id, category, sort_order)'],
  ['idx_finance_clients_user', 'CREATE INDEX idx_finance_clients_user ON finance_clients(user_id, sort_order)'],
  ['idx_finance_clients_code', "CREATE UNIQUE INDEX idx_finance_clients_code ON finance_clients(user_id, code) WHERE code != ''"],
  ['idx_finance_contracts_client', 'CREATE INDEX idx_finance_contracts_client ON finance_contracts(client_id, created_at)'],
  ['idx_finance_contracts_user', 'CREATE INDEX idx_finance_contracts_user ON finance_contracts(user_id)'],
  ['idx_finance_versions_contract', 'CREATE INDEX idx_finance_versions_contract ON finance_contract_versions(contract_id)'],
  ['idx_finance_contract_one_final', 'CREATE UNIQUE INDEX idx_finance_contract_one_final ON finance_contract_versions(contract_id) WHERE is_final = 1'],
  ['idx_finance_installments_contract', 'CREATE INDEX idx_finance_installments_contract ON finance_contract_installments(contract_id)'],
  ['idx_finance_crs_client', 'CREATE INDEX idx_finance_crs_client ON finance_change_requests(client_id, created_at)'],
  ['idx_finance_crs_contract', 'CREATE INDEX idx_finance_crs_contract ON finance_change_requests(contract_id)'],
  ['idx_finance_crs_ref', "CREATE UNIQUE INDEX idx_finance_crs_ref ON finance_change_requests(user_id, ref) WHERE ref != ''"],
  ['idx_finance_invoices_client', 'CREATE INDEX idx_finance_invoices_client ON finance_invoices(client_id, due_date)'],
  ['idx_finance_invoice_links_invoice', 'CREATE INDEX idx_finance_invoice_links_invoice ON finance_invoice_links(invoice_id)'],
  ['idx_finance_invoice_links_installment', 'CREATE INDEX idx_finance_invoice_links_installment ON finance_invoice_links(installment_id)'],
  ['idx_finance_invoice_links_cr', 'CREATE INDEX idx_finance_invoice_links_cr ON finance_invoice_links(cr_id)'],
  ['idx_finance_invoice_links_inst_unique', 'CREATE UNIQUE INDEX idx_finance_invoice_links_inst_unique ON finance_invoice_links(invoice_id, installment_id)'],
  ['idx_finance_invoice_links_cr_unique', 'CREATE UNIQUE INDEX idx_finance_invoice_links_cr_unique ON finance_invoice_links(invoice_id, cr_id)'],
  ['idx_finance_payments_invoice', 'CREATE INDEX idx_finance_payments_invoice ON finance_invoice_payments(invoice_id)'],
  ['idx_finance_meetings_client', 'CREATE INDEX idx_finance_meetings_client ON finance_meetings(client_id, meeting_date)'],
  ['idx_finance_actions_meeting', 'CREATE INDEX idx_finance_actions_meeting ON finance_meeting_actions(meeting_id, sort_order)'],
  ['idx_finance_attachments_entity', 'CREATE INDEX idx_finance_attachments_entity ON finance_attachments(entity_type, entity_id)'],
];

module.exports = {
  version: 55,
  name: 'finance_rename',
  destructive: true,
  up(db) {
    const has = name => !!db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(name);

    // Guarded so this is a no-op on a database that already carries the new
    // names — a Full Restore of an older backup replays 054 (creating finance_*)
    // and then this, which is the intended path; replaying it a second time
    // must not throw.
    if (!has('finance_clients')) return;

    for (const suffix of TABLES) {
      if (has('finance_' + suffix) && !has('finance_' + suffix)) {
        db.exec(`ALTER TABLE finance_${suffix} RENAME TO finance_${suffix}`);
      }
    }

    for (const [oldName, createSql] of INDEXES) {
      db.exec(`DROP INDEX IF EXISTS ${oldName}`);
      db.exec(createSql);
    }

    // Stored paths are relative to userData and include the directory name, so
    // the rename has to reach into them. They are written with path.join, which
    // means they are BACKSLASH-separated on Windows — matching only 'finance_it/%'
    // would silently miss every row (all four rows in the live database are
    // backslash form). Replacing just the first 7 characters preserves whichever
    // separator follows, so both shapes are handled by one statement.
    db.exec(`
      UPDATE finance_attachments
         SET file_path = 'finance' || substr(file_path, 8)
       WHERE substr(file_path, 1, 7) = 'finance_it'
         AND substr(file_path, 8, 1) IN ('/', '\\')
    `);

    // "Where was I" state. user_ui_state stores one JSON blob per user in a
    // `value` column rather than a column per field, so this is a JSON edit,
    // not a column update. switchModule() also keeps a permanent finance-it ->
    // finance alias, so a row this misses still lands correctly.
    db.exec(`
      UPDATE user_ui_state
         SET value = json_set(value, '$.lastModule', 'finance')
       WHERE json_valid(value)
         AND json_extract(value, '$.lastModule') = 'finance-it'
    `);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
