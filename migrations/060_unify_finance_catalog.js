// Migration 060 — Finance's catalog joins the shared lookup_codes catalog.
//
// Finance shipped with its own catalog table (`finance_lookups`, user_id-scoped)
// holding CONTRACT_STATUS, CR_STATUS, INVOICE_STATUS, PAYMENT_METHOD and its own
// CURRENCY list. That made Finance the only part of the app with a second,
// parallel category system: never gated by db.js's LOOKUP_CATEGORIES, never
// visible to the shared Settings catalog editor, and never covered by the
// lookup_code_history audit trail. This migration folds it into `lookup_codes`
// so there is one catalog for the whole app.
//
// WHAT MOVES
//   • The four status/method categories become ordinary `lookup_codes` rows.
//   • The four columns that referenced finance_lookups(id) are repointed at the
//     matching lookup_codes row and their FKs retargeted.
//   • Finance's CURRENCY list is NOT copied as a category — CURRENCY already
//     exists app-wide and `currency_code` stores a string, not an id. Any code
//     Finance knew but the shared list did not is appended to the shared list
//     instead, so no currency disappears from a picker.
//
// WHAT DOES NOT MOVE
//   `finance_lookups` itself is left in place, untouched, as the pre-migration
//   record — the same choice migration 056 made when it kept finance_clients'
//   local name/code columns after linking to the shared roster. Nothing reads it
//   after this migration. Dropping it is a separate decision with no upside here.
//
// PER-USER → GLOBAL. finance_lookups was user_id-scoped; lookup_codes is global
// (with lookup_code_user_access for privacy). Rows are merged on (category,
// code), and where two accounts disagreed on a label the lowest user_id wins —
// deterministic rather than whichever row SQLite reached first. No access rows
// are created: these are workflow statuses, not private infrastructure, and the
// catalog they are joining is the one every account already shares.
//
// Rebuilds four tables to retarget a foreign key, so it owns its own
// transaction with foreign_keys OFF (the same shape migration 002 uses) and is
// marked destructive so a full snapshot is taken first.
const MOVED_CATEGORIES = ['CONTRACT_STATUS', 'CR_STATUS', 'INVOICE_STATUS', 'PAYMENT_METHOD'];

// [table, column] pairs whose FK points at finance_lookups(id).
const FK_COLUMNS = [
  ['finance_contracts', 'status_id'],
  ['finance_change_requests', 'status_id'],
  ['finance_invoices', 'status_id'],
  ['finance_invoice_payments', 'method_id'],
];

module.exports = {
  version: 60,
  name: 'unify_finance_catalog',
  manualTransaction: true,
  destructive: true,
  up(db) {
    // Nothing to do on a database that never had the Finance tables.
    const hasFinanceLookups = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'finance_lookups'"
    ).get();
    if (!hasFinanceLookups) return;

    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      const now = new Date().toISOString();

      // ── 1. Copy the four categories into lookup_codes ────────────────────
      // Merged on (category, code). Lowest user_id wins a label disagreement,
      // so the result does not depend on row order.
      const source = db.prepare(
        `SELECT category, code,
                MIN(user_id)  AS owner,
                MIN(sort_order) AS sort_order,
                MAX(is_active)  AS is_active
           FROM finance_lookups
          WHERE category IN (${MOVED_CATEGORIES.map(() => '?').join(', ')})
          GROUP BY category, code`
      ).all(...MOVED_CATEGORIES);

      const labelOf = db.prepare(
        'SELECT label_en, label_ar FROM finance_lookups WHERE category = ? AND code = ? AND user_id = ?'
      );
      const existing = db.prepare('SELECT id FROM lookup_codes WHERE category = ? AND code = ?');
      const insertLookup = db.prepare(
        `INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at, name_en, name_ar)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const row of source) {
        if (existing.get(row.category, row.code)) continue;  // already there — leave it alone
        const label = labelOf.get(row.category, row.code, row.owner) || { label_en: row.code, label_ar: '' };
        insertLookup.run(
          row.category, row.code, label.label_en,
          row.sort_order ?? 0, row.is_active ?? 1, now,
          label.label_en, label.label_ar || ''
        );
      }

      // ── 2. Repoint every referencing column ──────────────────────────────
      // old finance_lookups.id -> new lookup_codes.id, matched on category+code.
      const idMap = new Map();
      for (const r of db.prepare(
        `SELECT fl.id AS oldId, lc.id AS newId
           FROM finance_lookups fl
           JOIN lookup_codes lc ON lc.category = fl.category AND lc.code = fl.code
          WHERE fl.category IN (${MOVED_CATEGORIES.map(() => '?').join(', ')})`
      ).all(...MOVED_CATEGORIES)) idMap.set(r.oldId, r.newId);

      for (const [table, column] of FK_COLUMNS) {
        const upd = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`);
        for (const [oldId, newId] of idMap) if (oldId !== newId) upd.run(newId, oldId);
        // Any id that survived without a mapping pointed at a row that no longer
        // resolves; null it rather than leave a dangling reference behind.
        db.prepare(
          `UPDATE ${table} SET ${column} = NULL
            WHERE ${column} IS NOT NULL
              AND ${column} NOT IN (SELECT id FROM lookup_codes)`
        ).run();
      }

      // ── 3. Retarget the foreign keys ─────────────────────────────────────
      // The replacement DDL is derived from sqlite_master rather than written
      // out by hand, so a column or constraint cannot be dropped by mistake.
      for (const [table] of FK_COLUMNS) {
        const row = db.prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
        ).get(table);
        if (!row || !row.sql) throw new Error('060: no DDL found for ' + table);

        // DROP TABLE takes the table's indexes AND its triggers with it. The
        // workspace_search FTS triggers (migration 057) live on three of these
        // four tables, and losing them would silently stop Quick Find from
        // indexing contracts, change requests and invoices — a regression that
        // both foreign_key_check and integrity_check pass straight over. Capture
        // both and put them back after the rename.
        const indexes = db.prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL"
        ).all(table).map((i) => i.sql);
        const triggers = db.prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND sql IS NOT NULL"
        ).all(table).map((t) => t.sql);

        // SQLite may store the name quoted, depending on how the table was made.
        const quoted = new RegExp('CREATE TABLE\\s+"?' + table + '"?', 'i');
        if (!quoted.test(row.sql)) throw new Error('060: unexpected DDL shape for ' + table);
        let ddl = row.sql.replace(quoted, 'CREATE TABLE ' + table + '_new');
        const before = ddl;
        ddl = ddl.replace(/"?finance_lookups"?\s*\(\s*id\s*\)/gi, 'lookup_codes(id)');
        if (ddl === before) throw new Error('060: no finance_lookups FK found in ' + table);

        db.exec(ddl);
        db.exec(`INSERT INTO ${table}_new SELECT * FROM ${table}`);
        db.exec(`DROP TABLE ${table}`);
        db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
        // Recreate both verbatim, indexes first so a trigger that touches one
        // finds it in place.
        for (const sql of indexes) db.exec(sql);
        for (const sql of triggers) db.exec(sql);
      }

      // ── 4. Any currency Finance knew that the shared list does not ───────
      const sharedCurrency = new Set(
        db.prepare("SELECT code FROM lookup_codes WHERE category = 'CURRENCY'").all().map((r) => r.code)
      );
      let nextSort = Number(db.prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM lookup_codes WHERE category = 'CURRENCY'"
      ).get().n);
      for (const r of db.prepare(
        "SELECT code, label_en, label_ar FROM finance_lookups WHERE category = 'CURRENCY' ORDER BY sort_order, id"
      ).all()) {
        if (sharedCurrency.has(r.code)) continue;
        insertLookup.run('CURRENCY', r.code, r.code, nextSort++, 1, now, r.code, r.label_ar || '');
        sharedCurrency.add(r.code);
      }

      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  },
};
