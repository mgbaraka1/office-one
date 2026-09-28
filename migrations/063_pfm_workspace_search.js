// Migration 063 — put Project & Finance Offers / CRs into Quick Find.
//
// Same shape as migration 057 (Finance, since dropped): rows live in the
// user-scoped workspace_search FTS index and are kept current by triggers, so
// no code path can forget to update it. Offers and CRs are private per login
// (PROJECT_FINANCE_PLAN.md D1), which is exactly the index's own scoping.
//
// entity_id is the item id as TEXT (the triggers delete by it, and an FTS5
// column has no type affinity, so the stored type and the compared type must
// match). searchWorkspace() turns an all-digit id back into a number.
//
// Indexed: reference + title (the title column, so both rank high) and the
// client contact name. Fees are NOT indexed, for the reason 057 gave: minor
// units are meaningless as free text. A row inside its delete-undo window
// (deleted_at set) is kept out of the index; undo puts it back.
const ROW = alias => `
  ${alias}.user_id, 'pfm', CAST(${alias}.id AS TEXT),
  ${alias}.reference || ' · ' || ${alias}.title,
  CASE ${alias}.kind WHEN 'CR' THEN 'CR' ELSE 'Offer' END,
  COALESCE(${alias}.reference, '') || ' ' || COALESCE(${alias}.title, '') || ' ' ||
  COALESCE(${alias}.client_contact_name, ''),
  ${alias}.updated_at`;

module.exports = {
  version: 63,
  name: 'pfm_workspace_search',
  destructive: false,
  up(db) {
    const hasTable = name => !!db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(name);
    if (!hasTable('pfm_items') || !hasTable('workspace_search')) return;

    // Idempotent: a Full Restore of an older backup replays this, and the FTS
    // rows may already be present from the live database's own triggers.
    db.exec("DELETE FROM workspace_search WHERE kind = 'pfm'");

    db.exec(`
      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT ${ROW('i')} FROM pfm_items i WHERE i.deleted_at IS NULL;

      CREATE TRIGGER IF NOT EXISTS workspace_search_pfm_items_ai AFTER INSERT ON pfm_items
      WHEN new.deleted_at IS NULL BEGIN
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(${ROW('new')});
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_pfm_items_au AFTER UPDATE ON pfm_items BEGIN
        DELETE FROM workspace_search WHERE kind = 'pfm' AND entity_id = CAST(old.id AS TEXT);
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        SELECT ${ROW('new')} WHERE new.deleted_at IS NULL;
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_pfm_items_ad AFTER DELETE ON pfm_items BEGIN
        DELETE FROM workspace_search WHERE kind = 'pfm' AND entity_id = CAST(old.id AS TEXT);
      END;
    `);
  },
};
