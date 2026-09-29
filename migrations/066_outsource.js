// Migration 066 — Outsource: external resources, their hours and their fees.
//
// A standalone module (docs/OUTSOURCE_PLAN.md). It links to nothing else in the
// app — no projects, no COMPANY lookup, no pfm_*, no tasks or work_logs. The
// only shared vocabulary is the CURRENCY lookup.
//
//   outs_resources        one row per person being paid. Private per login
//                         (user_id), like tasks and pfm_items.
//   outs_rates            hourly rate history, in integer minor units (never
//                         REAL). The rate for an entry is the one whose
//                         effective_from is the latest on or before its date.
//   outs_entries          one row of the old timesheet: date, minutes,
//                         description and a free-text project.
//                         statement_id is set only when a statement is ISSUED,
//                         which is what locks the row; cancelling clears it.
//   outs_statements       a closed date range for one resource:
//                         DRAFT → ISSUED → PAID, or CANCELLED.
//   outs_statement_lines  the snapshot taken at issue (per project × rate), so
//                         a later rate change never alters an issued statement.
//   outs_history          append-only audit trail. resource_id is deliberately
//                         NOT a foreign key — like pfm_history, the audit must
//                         survive the record it describes.
//
// `deleted_at` is the undo window, as in 062: a delete only stamps it, undo
// clears it, and the purge (after the window, or at the next boot's
// maintenance pass) removes the row for real. A rate's "one per date" rule is a
// partial unique index, so a rate in its undo window does not block re-adding
// the same date.
//
// Quick Find: resources (kind 'outs-resource', entity_id = resource id) and
// entries (kind 'outs-entry', entity_id = 'resourceId:entryId') join the
// user-scoped workspace_search index, kept current by triggers as in 063. An
// entry is indexed only while it and its resource are both live; renaming,
// deleting or restoring a resource re-indexes its entries. Money is not indexed.
//
// Additive only: CREATE ... IF NOT EXISTS, and the search backfill deletes its
// own kinds first, so a Full Restore replaying this is harmless.
const RESOURCE_ROW = r => `
  ${r}.user_id, 'outs-resource', CAST(${r}.id AS TEXT),
  ${r}.name, 'Outsource',
  COALESCE(${r}.name, '') || ' ' || COALESCE(${r}.email, '') || ' ' || COALESCE(${r}.phone, ''),
  ${r}.updated_at`;
// `e` is the entry, `r` its resource.
const ENTRY_ROW = (e, r) => `
  ${e}.user_id, 'outs-entry', CAST(${e}.resource_id AS TEXT) || ':' || CAST(${e}.id AS TEXT),
  CASE WHEN ${e}.description <> '' THEN ${e}.description ELSE ${e}.project END,
  ${r}.name || ' · ' || ${e}.work_date || CASE WHEN ${e}.project <> '' THEN ' · ' || ${e}.project ELSE '' END,
  COALESCE(${e}.description, '') || ' ' || COALESCE(${e}.project, '') || ' ' || COALESCE(${r}.name, ''),
  ${e}.updated_at`;

module.exports = {
  version: 66,
  name: 'outsource',
  destructive: false,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS outs_resources (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id),
        name        TEXT    NOT NULL,
        email       TEXT    NOT NULL DEFAULT '',
        phone       TEXT    NOT NULL DEFAULT '',
        notes       TEXT    NOT NULL DEFAULT '',
        currency_id INTEGER NOT NULL REFERENCES lookup_codes(id),
        is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL,
        deleted_at  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_outs_resources_user ON outs_resources(user_id);

      CREATE TABLE IF NOT EXISTS outs_rates (
        id             INTEGER PRIMARY KEY,
        resource_id    INTEGER NOT NULL REFERENCES outs_resources(id) ON DELETE CASCADE,
        rate_minor     INTEGER NOT NULL CHECK (rate_minor >= 0),
        effective_from TEXT    NOT NULL,
        created_at     TEXT    NOT NULL,
        updated_at     TEXT    NOT NULL,
        deleted_at     TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_outs_rates_resource_from
        ON outs_rates(resource_id, effective_from) WHERE deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS outs_statements (
        id            INTEGER PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id),
        resource_id   INTEGER NOT NULL REFERENCES outs_resources(id) ON DELETE CASCADE,
        reference     TEXT    NOT NULL,
        reference_key TEXT    NOT NULL,
        period_from   TEXT    NOT NULL,
        period_to     TEXT    NOT NULL,
        -- Structural, not vocabulary: it decides locking, so a CHECK not a lookup.
        status        TEXT    NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'CANCELLED')),
        total_minutes INTEGER NOT NULL DEFAULT 0,
        total_minor   INTEGER NOT NULL DEFAULT 0,
        currency_id   INTEGER REFERENCES lookup_codes(id),
        notes         TEXT    NOT NULL DEFAULT '',
        issued_at     TEXT,
        paid_at       TEXT,
        paid_note     TEXT    NOT NULL DEFAULT '',
        cancelled_at  TEXT,
        created_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL,
        deleted_at    TEXT,
        CHECK (period_from <= period_to),
        UNIQUE (user_id, reference_key)
      );
      CREATE INDEX IF NOT EXISTS idx_outs_statements_resource ON outs_statements(resource_id);

      CREATE TABLE IF NOT EXISTS outs_statement_lines (
        id           INTEGER PRIMARY KEY,
        statement_id INTEGER NOT NULL REFERENCES outs_statements(id) ON DELETE CASCADE,
        project      TEXT    NOT NULL DEFAULT '',
        minutes      INTEGER NOT NULL CHECK (minutes >= 0),
        rate_minor   INTEGER NOT NULL CHECK (rate_minor >= 0),
        amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
        sort_order   INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_outs_statement_lines_statement ON outs_statement_lines(statement_id);

      CREATE TABLE IF NOT EXISTS outs_entries (
        id           INTEGER PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id),
        resource_id  INTEGER NOT NULL REFERENCES outs_resources(id) ON DELETE CASCADE,
        work_date    TEXT    NOT NULL,
        minutes      INTEGER NOT NULL CHECK (minutes > 0),
        description  TEXT    NOT NULL DEFAULT '',
        project      TEXT    NOT NULL DEFAULT '',
        statement_id INTEGER REFERENCES outs_statements(id) ON DELETE SET NULL,
        created_at   TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL,
        deleted_at   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_outs_entries_resource_date ON outs_entries(user_id, resource_id, work_date);
      CREATE INDEX IF NOT EXISTS idx_outs_entries_statement ON outs_entries(statement_id);

      CREATE TABLE IF NOT EXISTS outs_history (
        id          INTEGER PRIMARY KEY,
        resource_id INTEGER NOT NULL,
        record_type TEXT    NOT NULL CHECK (record_type IN ('resource', 'rate', 'entry', 'statement')),
        record_id   INTEGER,
        field       TEXT    NOT NULL,
        old_value   TEXT    NOT NULL DEFAULT '',
        new_value   TEXT    NOT NULL DEFAULT '',
        user_id     INTEGER NOT NULL REFERENCES users(id),
        changed_at  TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_outs_history_resource ON outs_history(resource_id, changed_at);
    `);

    // Lookup-category guards, in exactly migration 048's shape.
    const RULES = [
      ['outs_resources', 'currency_id', 'CURRENCY'],
      ['outs_statements', 'currency_id', 'CURRENCY'],
    ];
    for (const [table, column, category] of RULES) {
      for (const operation of ['INSERT', 'UPDATE']) {
        const suffix = operation.toLowerCase();
        const updateOf = operation === 'UPDATE' ? ` OF ${column}` : '';
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_${table}_${column}_${suffix}_category
          BEFORE ${operation}${updateOf} ON ${table}
          WHEN NEW.${column} IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM lookup_codes
              WHERE id = NEW.${column} AND category = '${category}'
           )
          BEGIN
            SELECT RAISE(ABORT, '${table}.${column} has the wrong lookup category');
          END;
        `);
      }
    }

    const hasSearch = !!db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workspace_search'"
    ).get();
    if (hasSearch) {
      db.exec("DELETE FROM workspace_search WHERE kind IN ('outs-resource', 'outs-entry')");
      db.exec(`
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        SELECT ${RESOURCE_ROW('r')} FROM outs_resources r WHERE r.deleted_at IS NULL;
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        SELECT ${ENTRY_ROW('e', 'r')} FROM outs_entries e JOIN outs_resources r ON r.id = e.resource_id
         WHERE e.deleted_at IS NULL AND r.deleted_at IS NULL;

        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_resources_ai AFTER INSERT ON outs_resources
        WHEN new.deleted_at IS NULL BEGIN
          INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
          VALUES(${RESOURCE_ROW('new')});
        END;
        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_resources_au AFTER UPDATE ON outs_resources BEGIN
          DELETE FROM workspace_search WHERE kind = 'outs-resource' AND entity_id = CAST(old.id AS TEXT);
          INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
          SELECT ${RESOURCE_ROW('new')} WHERE new.deleted_at IS NULL;
        END;
        -- A rename, delete or restore changes every entry's row (subtitle and
        -- visibility), so rebuild that resource's entries.
        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_resources_au_entries
        AFTER UPDATE OF name, deleted_at ON outs_resources
        WHEN old.name IS NOT new.name OR old.deleted_at IS NOT new.deleted_at BEGIN
          DELETE FROM workspace_search WHERE kind = 'outs-entry'
             AND entity_id IN (SELECT CAST(resource_id AS TEXT) || ':' || CAST(id AS TEXT)
                                 FROM outs_entries WHERE resource_id = old.id);
          INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
          SELECT ${ENTRY_ROW('e', 'new')} FROM outs_entries e
           WHERE e.resource_id = new.id AND e.deleted_at IS NULL AND new.deleted_at IS NULL;
        END;
        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_resources_ad AFTER DELETE ON outs_resources BEGIN
          DELETE FROM workspace_search WHERE kind = 'outs-resource' AND entity_id = CAST(old.id AS TEXT);
        END;

        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_entries_ai AFTER INSERT ON outs_entries
        WHEN new.deleted_at IS NULL BEGIN
          INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
          SELECT ${ENTRY_ROW('new', 'r')} FROM outs_resources r
           WHERE r.id = new.resource_id AND r.deleted_at IS NULL;
        END;
        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_entries_au AFTER UPDATE ON outs_entries BEGIN
          DELETE FROM workspace_search WHERE kind = 'outs-entry'
             AND entity_id = CAST(old.resource_id AS TEXT) || ':' || CAST(old.id AS TEXT);
          INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
          SELECT ${ENTRY_ROW('new', 'r')} FROM outs_resources r
           WHERE r.id = new.resource_id AND r.deleted_at IS NULL AND new.deleted_at IS NULL;
        END;
        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_entries_ad AFTER DELETE ON outs_entries BEGIN
          DELETE FROM workspace_search WHERE kind = 'outs-entry'
             AND entity_id = CAST(old.resource_id AS TEXT) || ':' || CAST(old.id AS TEXT);
        END;
      `);
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
