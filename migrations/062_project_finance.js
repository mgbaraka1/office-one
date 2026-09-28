// Migration 062 — Project & Finance Management (Offers & CRs).
//
// A clean-slate module; it shares nothing with the Finance module migration
// 061 dropped, and uses the `pfm_` prefix so it can never be confused with a
// leftover `finance_*` table.
//
//   pfm_items         one row per Offer or CR. Private per login (user_id),
//                     like tasks. `reference` is typed by the user; its folded
//                     `reference_key` is unique per login across Offers AND CRs
//                     together. Per login rather than install-wide because the
//                     rows are private: an install-wide rule would let one
//                     login probe for another login's hidden references.
//   pfm_stages        who / when for each status an item passes through. The
//                     person is free text (no Settings list), and a NULL
//                     done_on means "planned, not happened yet".
//   pfm_versions      user-labelled versions, each with its fees in integer
//                     minor units (never REAL) and a CURRENCY lookup.
//   pfm_version_files many uploaded files per version (bytes on disk under
//                     <userData>/project_finance/, metadata here).
//   pfm_history       append-only audit trail. item_id is deliberately NOT a
//                     foreign key — like lookup_code_history (migration 058),
//                     the audit must survive the record it describes.
//
// `deleted_at` on items, versions and files is the undo window: a delete only
// stamps it, undo clears it, and the purge (after the window, or at the next
// boot's maintenance pass) removes the row for real. Ids stay stable across an
// undo, which a delete-and-recreate from a snapshot could not promise for a
// record with children.
//
// PFM_STATUS is seeded only when the category is empty (the migration 059
// guard), so a curated catalog is never touched. Code compares on codes only;
// the stage order is the lookup's sort_order.
//
// Additive only: every statement is CREATE ... IF NOT EXISTS.
module.exports = {
  version: 62,
  name: 'project_finance',
  destructive: false,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pfm_items (
        id                  INTEGER PRIMARY KEY,
        user_id             INTEGER NOT NULL REFERENCES users(id),
        -- Structural, not vocabulary: it decides which form and which list
        -- toggle a row belongs to, so it is a CHECK rather than a lookup.
        kind                TEXT    NOT NULL CHECK (kind IN ('OFFER', 'CR')),
        reference           TEXT    NOT NULL,
        reference_key       TEXT    NOT NULL,
        title               TEXT    NOT NULL,
        company_id          INTEGER NOT NULL REFERENCES lookup_codes(id),
        status_id           INTEGER NOT NULL REFERENCES lookup_codes(id),
        client_contact_name  TEXT   NOT NULL DEFAULT '',
        client_contact_email TEXT   NOT NULL DEFAULT '',
        client_contact_phone TEXT   NOT NULL DEFAULT '',
        valid_until         TEXT,
        notes               TEXT    NOT NULL DEFAULT '',
        created_by          INTEGER REFERENCES users(id),
        updated_by          INTEGER REFERENCES users(id),
        created_at          TEXT    NOT NULL,
        updated_at          TEXT    NOT NULL,
        archived_at         TEXT,
        deleted_at          TEXT,
        UNIQUE (user_id, reference_key)
      );
      CREATE INDEX IF NOT EXISTS idx_pfm_items_company ON pfm_items(company_id);
      CREATE INDEX IF NOT EXISTS idx_pfm_items_status  ON pfm_items(status_id);

      CREATE TABLE IF NOT EXISTS pfm_stages (
        id          INTEGER PRIMARY KEY,
        item_id     INTEGER NOT NULL REFERENCES pfm_items(id) ON DELETE CASCADE,
        status_id   INTEGER NOT NULL REFERENCES lookup_codes(id),
        member_name TEXT    NOT NULL DEFAULT '',
        done_on     TEXT,
        note        TEXT    NOT NULL DEFAULT '',
        updated_at  TEXT    NOT NULL,
        UNIQUE (item_id, status_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pfm_stages_item ON pfm_stages(item_id);

      CREATE TABLE IF NOT EXISTS pfm_versions (
        id            INTEGER PRIMARY KEY,
        item_id       INTEGER NOT NULL REFERENCES pfm_items(id) ON DELETE CASCADE,
        version_label TEXT    NOT NULL,
        version_key   TEXT    NOT NULL,
        fees_minor    INTEGER,
        currency_id   INTEGER REFERENCES lookup_codes(id),
        version_date  TEXT,
        notes         TEXT    NOT NULL DEFAULT '',
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_by    INTEGER REFERENCES users(id),
        created_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL,
        deleted_at    TEXT,
        UNIQUE (item_id, version_key)
      );
      CREATE INDEX IF NOT EXISTS idx_pfm_versions_item ON pfm_versions(item_id);

      CREATE TABLE IF NOT EXISTS pfm_version_files (
        id            INTEGER PRIMARY KEY,
        version_id    INTEGER NOT NULL REFERENCES pfm_versions(id) ON DELETE CASCADE,
        file_path     TEXT    NOT NULL,
        original_name TEXT    NOT NULL DEFAULT '',
        file_size     INTEGER NOT NULL DEFAULT 0,
        mime_type     TEXT    NOT NULL DEFAULT '',
        sort_order    INTEGER NOT NULL DEFAULT 0,
        uploaded_by   INTEGER REFERENCES users(id),
        uploaded_at   TEXT    NOT NULL,
        deleted_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pfm_version_files_version ON pfm_version_files(version_id);

      CREATE TABLE IF NOT EXISTS pfm_history (
        id          INTEGER PRIMARY KEY,
        item_id     INTEGER NOT NULL,
        record_type TEXT    NOT NULL CHECK (record_type IN ('item', 'stage', 'version', 'file')),
        record_id   INTEGER,
        field       TEXT    NOT NULL,
        old_value   TEXT    NOT NULL DEFAULT '',
        new_value   TEXT    NOT NULL DEFAULT '',
        user_id     INTEGER NOT NULL REFERENCES users(id),
        changed_at  TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pfm_history_item ON pfm_history(item_id, changed_at);
    `);

    // Lookup-category guards, in exactly migration 048's shape.
    const RULES = [
      ['pfm_items', 'company_id', 'COMPANY'],
      ['pfm_items', 'status_id', 'PFM_STATUS'],
      ['pfm_stages', 'status_id', 'PFM_STATUS'],
      ['pfm_versions', 'currency_id', 'CURRENCY'],
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

    // Guarded seed (migration 059's rule): only an empty category is filled.
    const now = new Date().toISOString();
    const SEED = [
      ['PREPARE',  'Prepare',  'قيد الإعداد'],
      ['READY',    'Ready',    'جاهز'],
      ['SENT',     'Sent',     'مُرسل'],
      ['ACCEPTED', 'Accepted', 'مقبول'],
      ['REJECTED', 'Rejected', 'مرفوض'],
    ];
    const empty = db.prepare("SELECT COUNT(*) AS n FROM lookup_codes WHERE category = 'PFM_STATUS'").get().n === 0;
    if (empty) {
      const insert = db.prepare(
        `INSERT INTO lookup_codes(category, code, label, name_en, name_ar, sort_order, is_active, created_at)
         VALUES('PFM_STATUS', ?, ?, ?, ?, ?, 1, ?)`
      );
      SEED.forEach(([code, label, nameAr], i) => insert.run(code, label, label, nameAr, i, now));
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
