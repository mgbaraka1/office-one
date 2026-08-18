// Migration 054 — Finance.
//
// Finance is a standalone financial record-keeping module for Finance
// (clients, contracts with versions, change requests, invoices with payment
// tracking, minutes of meeting). It is deliberately ISOLATED from the rest of
// the app — see AGENTS.md's Finance section for the full rationale. In this
// schema that isolation means:
//   - its own client roster (finance_clients), never the shared COMPANY lookup
//     that backs the Clients/Projects/Browse/Analytics pages
//   - its own catalog table (finance_lookups), never lookup_codes — so it is
//     never gated by db.js's LOOKUP_CATEGORIES and never touches the shared
//     Settings page
//   - its own currency list (finance_lookups category CURRENCY), never the
//     app-wide CURRENCY lookup subscriptions.js uses
// Every table is prefixed finance_ and user_id-scoped, so the whole module can
// later be removed by dropping its own files plus one migration.
//
// Money is stored as INTEGER MINOR UNITS (halalas/cents) on every amount
// column here, NOT REAL. This deliberately differs from subscriptions.cost
// REAL: invoice-to-installment reconciliation (partial payments, allocation
// across several installments/CRs) needs exact integer arithmetic — a REAL
// column would risk float drift across many partial allocations.
//
// finance_lookups is user_id-scoped (UNIQUE(user_id, category, code)), unlike
// the shared, global lookup_codes table — each account manages its own FINANCE
// IT catalog. This migration seeds the five categories for every user that
// exists at the time it runs; finance-seed.js's seedLookupsIfMissing() (the same
// function this migration calls) also lazily seeds any user created later,
// the first time that user's Finance data is touched.
module.exports = {
  version: 54,
  name: 'finance_it',
  up(db) {
    const { seedLookupsIfMissing } = require('../finance-seed');

    db.exec(`
      CREATE TABLE finance_lookups (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category   TEXT NOT NULL,
        code       TEXT NOT NULL,
        label_en   TEXT NOT NULL,
        label_ar   TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active  INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, category, code)
      );
      CREATE INDEX idx_finance_lookups_user_cat ON finance_lookups(user_id, category, sort_order);

      CREATE TABLE finance_clients (
        id            INTEGER PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        name_ar       TEXT NOT NULL DEFAULT '',
        code          TEXT NOT NULL DEFAULT '',
        contact_name  TEXT NOT NULL DEFAULT '',
        contact_email TEXT NOT NULL DEFAULT '',
        contact_phone TEXT NOT NULL DEFAULT '',
        address       TEXT NOT NULL DEFAULT '',
        tax_number    TEXT NOT NULL DEFAULT '',
        notes         TEXT NOT NULL DEFAULT '',
        is_active     INTEGER NOT NULL DEFAULT 1,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_finance_clients_user ON finance_clients(user_id, sort_order);
      -- Only a non-empty code needs to be unique per user; several clients
      -- may legitimately have no code at all.
      CREATE UNIQUE INDEX idx_finance_clients_code ON finance_clients(user_id, code) WHERE code != '';

      CREATE TABLE finance_contracts (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id   INTEGER NOT NULL REFERENCES finance_clients(id) ON DELETE CASCADE,
        ref         TEXT NOT NULL DEFAULT '',
        title       TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status_id   INTEGER REFERENCES finance_lookups(id),
        currency_code TEXT NOT NULL DEFAULT '',
        start_date  TEXT,
        end_date    TEXT,
        notes       TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_finance_contracts_client ON finance_contracts(client_id, created_at);
      CREATE INDEX idx_finance_contracts_user ON finance_contracts(user_id);

      CREATE TABLE finance_contract_versions (
        id             INTEGER PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        contract_id    INTEGER NOT NULL REFERENCES finance_contracts(id) ON DELETE CASCADE,
        version_label  TEXT NOT NULL,
        value_minor    INTEGER NOT NULL DEFAULT 0,
        signed_date    TEXT,
        effective_date TEXT,
        is_final       INTEGER NOT NULL DEFAULT 0,
        notes          TEXT NOT NULL DEFAULT '',
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        UNIQUE(contract_id, version_label)
      );
      CREATE INDEX idx_finance_versions_contract ON finance_contract_versions(contract_id);
      -- Invariant 1: exactly one final version per contract, enforced in SQLite.
      CREATE UNIQUE INDEX idx_finance_contract_one_final ON finance_contract_versions(contract_id) WHERE is_final = 1;

      CREATE TABLE finance_contract_installments (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        contract_id INTEGER NOT NULL REFERENCES finance_contracts(id) ON DELETE CASCADE,
        seq         INTEGER NOT NULL,
        title       TEXT NOT NULL DEFAULT '',
        milestone   TEXT NOT NULL DEFAULT '',
        due_date    TEXT,
        amount_minor INTEGER NOT NULL DEFAULT 0,
        notes       TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        UNIQUE(contract_id, seq)
      );
      CREATE INDEX idx_finance_installments_contract ON finance_contract_installments(contract_id);

      CREATE TABLE finance_change_requests (
        id            INTEGER PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id     INTEGER NOT NULL REFERENCES finance_clients(id) ON DELETE CASCADE,
        contract_id   INTEGER REFERENCES finance_contracts(id) ON DELETE SET NULL,
        ref           TEXT NOT NULL DEFAULT '',
        title         TEXT NOT NULL,
        description   TEXT NOT NULL DEFAULT '',
        status_id     INTEGER REFERENCES finance_lookups(id),
        amount_minor  INTEGER NOT NULL DEFAULT 0,
        currency_code TEXT NOT NULL DEFAULT '',
        requested_date TEXT,
        approved_date  TEXT,
        notes         TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_finance_crs_client ON finance_change_requests(client_id, created_at);
      CREATE INDEX idx_finance_crs_contract ON finance_change_requests(contract_id);
      CREATE UNIQUE INDEX idx_finance_crs_ref ON finance_change_requests(user_id, ref) WHERE ref != '';

      CREATE TABLE finance_invoices (
        id            INTEGER PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id     INTEGER NOT NULL REFERENCES finance_clients(id) ON DELETE CASCADE,
        number        TEXT NOT NULL,
        issue_date    TEXT,
        due_date      TEXT,
        amount_minor  INTEGER NOT NULL DEFAULT 0,
        tax_minor     INTEGER NOT NULL DEFAULT 0,
        currency_code TEXT NOT NULL DEFAULT '',
        status_id     INTEGER REFERENCES finance_lookups(id),
        notes         TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        UNIQUE(user_id, number)
      );
      CREATE INDEX idx_finance_invoices_client ON finance_invoices(client_id, due_date);

      CREATE TABLE finance_invoice_links (
        id             INTEGER PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invoice_id     INTEGER NOT NULL REFERENCES finance_invoices(id) ON DELETE CASCADE,
        installment_id INTEGER REFERENCES finance_contract_installments(id) ON DELETE RESTRICT,
        cr_id          INTEGER REFERENCES finance_change_requests(id) ON DELETE RESTRICT,
        allocated_minor INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT NOT NULL,
        CHECK ((installment_id IS NOT NULL) + (cr_id IS NOT NULL) = 1)
      );
      CREATE INDEX idx_finance_invoice_links_invoice ON finance_invoice_links(invoice_id);
      CREATE INDEX idx_finance_invoice_links_installment ON finance_invoice_links(installment_id);
      CREATE INDEX idx_finance_invoice_links_cr ON finance_invoice_links(cr_id);
      CREATE UNIQUE INDEX idx_finance_invoice_links_inst_unique ON finance_invoice_links(invoice_id, installment_id);
      CREATE UNIQUE INDEX idx_finance_invoice_links_cr_unique ON finance_invoice_links(invoice_id, cr_id);

      CREATE TABLE finance_invoice_payments (
        id            INTEGER PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invoice_id    INTEGER NOT NULL REFERENCES finance_invoices(id) ON DELETE CASCADE,
        paid_date     TEXT,
        amount_minor  INTEGER NOT NULL DEFAULT 0,
        method_id     INTEGER REFERENCES finance_lookups(id),
        reference     TEXT NOT NULL DEFAULT '',
        notes         TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_finance_payments_invoice ON finance_invoice_payments(invoice_id);

      CREATE TABLE finance_meetings (
        id             INTEGER PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id      INTEGER NOT NULL REFERENCES finance_clients(id) ON DELETE CASCADE,
        contract_id    INTEGER REFERENCES finance_contracts(id) ON DELETE SET NULL,
        cr_id          INTEGER REFERENCES finance_change_requests(id) ON DELETE SET NULL,
        title          TEXT NOT NULL,
        meeting_date   TEXT,
        location       TEXT NOT NULL DEFAULT '',
        attendees      TEXT NOT NULL DEFAULT '',
        agenda         TEXT NOT NULL DEFAULT '',
        content        TEXT NOT NULL DEFAULT '',
        content_format TEXT NOT NULL DEFAULT 'html',
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX idx_finance_meetings_client ON finance_meetings(client_id, meeting_date);

      CREATE TABLE finance_meeting_actions (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        meeting_id  INTEGER NOT NULL REFERENCES finance_meetings(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        owner       TEXT NOT NULL DEFAULT '',
        due_date    TEXT,
        status      TEXT NOT NULL DEFAULT 'OPEN',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_finance_actions_meeting ON finance_meeting_actions(meeting_id, sort_order);

      CREATE TABLE finance_attachments (
        id            INTEGER PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entity_type   TEXT NOT NULL,
        entity_id     INTEGER NOT NULL,
        file_path     TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_size     INTEGER NOT NULL DEFAULT 0,
        mime_type     TEXT NOT NULL DEFAULT '',
        uploaded_at   TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_finance_attachments_entity ON finance_attachments(entity_type, entity_id);
    `);

    // Seed every existing user's own Finance catalog. A user created after
    // this migration has already run gets seeded lazily on first use — see
    // finance-seed.js's seedLookupsIfMissing(), which this calls directly so the
    // two code paths can never drift apart.
    const users = db.prepare('SELECT id FROM users').all();
    for (const u of users) seedLookupsIfMissing(db, u.id);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
