// Migration 057 — put Finance into the user-scoped workspace FTS index.
//
// Contracts, change requests, invoices and meeting minutes were invisible to
// Quick Find: workspace_search covered tasks, projects, knowledge, subscriptions,
// company documents and client infrastructure, but nothing financial. See
// FINANCE_INTEGRATION_PLAN.md §7.
//
// entity_id is 'clientId:recordId', the composite-key convention migration 049
// established for client infrastructure — the renderer needs the owning client
// to deep-link into Finance's detail view, and workspace_search has no room for
// a second id column.
//
// Amounts are deliberately NOT indexed. They are meaningless as free text
// (integer minor units), they would match unrelated numeric queries, and the
// index is a navigation aid rather than a financial report.
module.exports = {
  version: 57,
  name: 'finance_workspace_search',
  destructive: false,
  up(db) {
    const hasTable = name => !!db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(name);
    if (!hasTable('finance_contracts') || !hasTable('workspace_search')) return;

    // Idempotent: a Full Restore of an older backup replays this, and the FTS
    // rows may already be present from the live database's own triggers.
    db.exec(`DELETE FROM workspace_search WHERE kind IN
               ('finance-contract', 'finance-cr', 'finance-invoice', 'finance-meeting')`);

    db.exec(`
      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT k.user_id, 'finance-contract',
             CAST(k.client_id AS TEXT) || ':' || CAST(k.id AS TEXT),
             COALESCE(NULLIF(k.title, ''), 'Contract'),
             COALESCE((SELECT code FROM finance_lookups WHERE id = k.status_id), ''),
             COALESCE(k.ref, '') || ' ' || COALESCE(k.description, '') || ' ' || COALESCE(k.notes, ''),
             k.updated_at
        FROM finance_contracts k;

      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT c.user_id, 'finance-cr',
             CAST(c.client_id AS TEXT) || ':' || CAST(c.id AS TEXT),
             COALESCE(NULLIF(c.title, ''), 'Change request'),
             COALESCE((SELECT code FROM finance_lookups WHERE id = c.status_id), ''),
             COALESCE(c.ref, '') || ' ' || COALESCE(c.description, '') || ' ' || COALESCE(c.notes, ''),
             c.updated_at
        FROM finance_change_requests c;

      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT i.user_id, 'finance-invoice',
             CAST(i.client_id AS TEXT) || ':' || CAST(i.id AS TEXT),
             COALESCE(NULLIF(i.number, ''), 'Invoice'),
             COALESCE((SELECT code FROM finance_lookups WHERE id = i.status_id), ''),
             COALESCE(i.notes, ''),
             i.updated_at
        FROM finance_invoices i;

      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT m.user_id, 'finance-meeting',
             CAST(m.client_id AS TEXT) || ':' || CAST(m.id AS TEXT),
             COALESCE(NULLIF(m.title, ''), 'Meeting'),
             COALESCE(m.meeting_date, ''),
             COALESCE(m.agenda, '') || ' ' || COALESCE(m.attendees, '') || ' ' ||
             COALESCE(m.location, '') || ' ' || COALESCE(m.content, ''),
             m.updated_at
        FROM finance_meetings m;

      CREATE TRIGGER IF NOT EXISTS workspace_search_finance_contracts_ai AFTER INSERT ON finance_contracts BEGIN
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'finance-contract',
               CAST(new.client_id AS TEXT) || ':' || CAST(new.id AS TEXT),
               COALESCE(NULLIF(new.title, ''), 'Contract'),
               COALESCE((SELECT code FROM finance_lookups WHERE id = new.status_id), ''),
               COALESCE(new.ref, '') || ' ' || COALESCE(new.description, '') || ' ' || COALESCE(new.notes, ''),
               new.updated_at);
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_finance_contracts_au AFTER UPDATE ON finance_contracts BEGIN
        DELETE FROM workspace_search WHERE kind = 'finance-contract'
          AND entity_id = CAST(old.client_id AS TEXT) || ':' || CAST(old.id AS TEXT);
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'finance-contract',
               CAST(new.client_id AS TEXT) || ':' || CAST(new.id AS TEXT),
               COALESCE(NULLIF(new.title, ''), 'Contract'),
               COALESCE((SELECT code FROM finance_lookups WHERE id = new.status_id), ''),
               COALESCE(new.ref, '') || ' ' || COALESCE(new.description, '') || ' ' || COALESCE(new.notes, ''),
               new.updated_at);
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_finance_contracts_ad AFTER DELETE ON finance_contracts BEGIN
        DELETE FROM workspace_search WHERE kind = 'finance-contract'
          AND entity_id = CAST(old.client_id AS TEXT) || ':' || CAST(old.id AS TEXT);
      END;

      CREATE TRIGGER IF NOT EXISTS workspace_search_finance_crs_ai AFTER INSERT ON finance_change_requests BEGIN
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'finance-cr',
               CAST(new.client_id AS TEXT) || ':' || CAST(new.id AS TEXT),
               COALESCE(NULLIF(new.title, ''), 'Change request'),
               COALESCE((SELECT code FROM finance_lookups WHERE id = new.status_id), ''),
               COALESCE(new.ref, '') || ' ' || COALESCE(new.description, '') || ' ' || COALESCE(new.notes, ''),
               new.updated_at);
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_finance_crs_au AFTER UPDATE ON finance_change_requests BEGIN
        DELETE FROM workspace_search WHERE kind = 'finance-cr'
          AND entity_id = CAST(old.client_id AS TEXT) || ':' || CAST(old.id AS TEXT);
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'finance-cr',
               CAST(new.client_id AS TEXT) || ':' || CAST(new.id AS TEXT),
               COALESCE(NULLIF(new.title, ''), 'Change request'),
               COALESCE((SELECT code FROM finance_lookups WHERE id = new.status_id), ''),
               COALESCE(new.ref, '') || ' ' || COALESCE(new.description, '') || ' ' || COALESCE(new.notes, ''),
               new.updated_at);
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_finance_crs_ad AFTER DELETE ON finance_change_requests BEGIN
        DELETE FROM workspace_search WHERE kind = 'finance-cr'
          AND entity_id = CAST(old.client_id AS TEXT) || ':' || CAST(old.id AS TEXT);
      END;

      CREATE TRIGGER IF NOT EXISTS workspace_search_finance_invoices_ai AFTER INSERT ON finance_invoices BEGIN
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'finance-invoice',
               CAST(new.client_id AS TEXT) || ':' || CAST(new.id AS TEXT),
               COALESCE(NULLIF(new.number, ''), 'Invoice'),
               COALESCE((SELECT code FROM finance_lookups WHERE id = new.status_id), ''),
               COALESCE(new.notes, ''), new.updated_at);
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_finance_invoices_au AFTER UPDATE ON finance_invoices BEGIN
        DELETE FROM workspace_search WHERE kind = 'finance-invoice'
          AND entity_id = CAST(old.client_id AS TEXT) || ':' || CAST(old.id AS TEXT);
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'finance-invoice',
               CAST(new.client_id AS TEXT) || ':' || CAST(new.id AS TEXT),
               COALESCE(NULLIF(new.number, ''), 'Invoice'),
               COALESCE((SELECT code FROM finance_lookups WHERE id = new.status_id), ''),
               COALESCE(new.notes, ''), new.updated_at);
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_finance_invoices_ad AFTER DELETE ON finance_invoices BEGIN
        DELETE FROM workspace_search WHERE kind = 'finance-invoice'
          AND entity_id = CAST(old.client_id AS TEXT) || ':' || CAST(old.id AS TEXT);
      END;

      CREATE TRIGGER IF NOT EXISTS workspace_search_finance_meetings_ai AFTER INSERT ON finance_meetings BEGIN
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'finance-meeting',
               CAST(new.client_id AS TEXT) || ':' || CAST(new.id AS TEXT),
               COALESCE(NULLIF(new.title, ''), 'Meeting'),
               COALESCE(new.meeting_date, ''),
               COALESCE(new.agenda, '') || ' ' || COALESCE(new.attendees, '') || ' ' ||
               COALESCE(new.location, '') || ' ' || COALESCE(new.content, ''),
               new.updated_at);
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_finance_meetings_au AFTER UPDATE ON finance_meetings BEGIN
        DELETE FROM workspace_search WHERE kind = 'finance-meeting'
          AND entity_id = CAST(old.client_id AS TEXT) || ':' || CAST(old.id AS TEXT);
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'finance-meeting',
               CAST(new.client_id AS TEXT) || ':' || CAST(new.id AS TEXT),
               COALESCE(NULLIF(new.title, ''), 'Meeting'),
               COALESCE(new.meeting_date, ''),
               COALESCE(new.agenda, '') || ' ' || COALESCE(new.attendees, '') || ' ' ||
               COALESCE(new.location, '') || ' ' || COALESCE(new.content, ''),
               new.updated_at);
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_finance_meetings_ad AFTER DELETE ON finance_meetings BEGIN
        DELETE FROM workspace_search WHERE kind = 'finance-meeting'
          AND entity_id = CAST(old.client_id AS TEXT) || ':' || CAST(old.id AS TEXT);
      END;
    `);
  },
};
