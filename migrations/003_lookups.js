// Migration 003 — normalized lookup catalog.
//
// Promotes every bounded "category / type / status / classification" text field
// into a single shared `lookup_codes` catalog (one row per allowed value, with a
// stable uppercase `code`, a human `label`, ordering, and a soft-disable flag),
// then replaces each raw text column with an INTEGER foreign key into it.
//
// Categories: ENTRY_STATUS, TIME_TYPE, ACTIVITY_TYPE, COMPANY, PROJECT (on
// day_entries + backlog) and CURRENCY, BILLING_CYCLE (on subscriptions).
//
// Seeding never loses data: the catalog for each category is the UNION of the
// values in the legacy `app_settings.lookups` blob (which preserves the user's
// preferred ordering) and every DISTINCT value actually stored in the data
// tables. Each stored value therefore maps cleanly to a code; nothing is dropped
// or merged. (Empty '' values map to a NULL FK — "unset".)
//
// Schema is changed only with ADD COLUMN / DROP COLUMN (SQLite 3.35+), so no
// table rebuild is needed and every existing row is preserved in place. The
// `default_employee_name` that used to live inside the lookups blob is moved to
// its own app_settings key, and the now-redundant `lookups` blob is removed.
module.exports = {
  version: 3,
  name: 'lookups',
  up(db) {
    const now = new Date().toISOString();
    const parse = (t, f) => { try { return JSON.parse(t); } catch { return f; } };

    // ── Explicit codes for the fixed enums; slug everything else ────────────────
    const CODE_MAP = {
      ENTRY_STATUS:  { 'Done': 'DONE', 'In Progress': 'IN_PROGRESS' },
      TIME_TYPE:     { 'Work Time': 'WORK_TIME', 'Over Time': 'OVERTIME', 'Training': 'TRAINING', 'Leave': 'LEAVE', 'Holiday': 'HOLIDAY' },
      ACTIVITY_TYPE: { 'Ticket': 'TICKET', 'Task': 'TASK', 'Meeting': 'MEETING', 'Call': 'CALL', 'Email': 'EMAIL' },
      CURRENCY:      { 'USD': 'USD', 'SAR': 'SAR', 'EUR': 'EUR' },
      BILLING_CYCLE: { 'Monthly': 'MONTHLY', 'Yearly': 'YEARLY', 'Custom': 'CUSTOM' },
    };
    const slug = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'NA';
    const codeFor = (cat, label) => (CODE_MAP[cat] && CODE_MAP[cat][label]) || slug(label);

    // ── Catalog table ───────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE lookup_codes (
        id         INTEGER PRIMARY KEY,
        category   TEXT    NOT NULL,
        code       TEXT    NOT NULL,
        label      TEXT    NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active  INTEGER NOT NULL DEFAULT 1,
        created_at TEXT    NOT NULL,
        UNIQUE(category, code)
      );
      CREATE INDEX idx_lookup_codes_cat ON lookup_codes(category, sort_order);
    `);

    const insCode = db.prepare(
      'INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at) VALUES(?,?,?,?,1,?)'
    );
    function seedCategory(category, labels) {
      const seen = new Set(), usedCodes = new Set();
      let order = 0;
      for (const raw of labels) {
        const label = (raw == null ? '' : String(raw)).trim();
        if (!label || seen.has(label)) continue;
        seen.add(label);
        let code = codeFor(category, label), base = code, i = 2;
        while (usedCodes.has(code)) code = base + '_' + (i++);
        usedCodes.add(code);
        insCode.run(category, code, label, order++, now);
      }
    }
    // Distinct values actually stored in a column (text columns still present here).
    const distinct = (sql) => db.prepare(sql).all().map(r => r.v).filter(v => v != null && v !== '');

    // Legacy lookups blob (preferred ordering) — may be absent on a fresh install.
    const blobRow = db.prepare("SELECT value FROM app_settings WHERE key = 'lookups'").get();
    const blob = blobRow ? parse(blobRow.value, {}) : {};
    const arr = (k) => Array.isArray(blob[k]) ? blob[k] : [];

    // category  ←  ordered blob values  ∪  distinct stored values
    seedCategory('COMPANY', [
      ...arr('companies'),
      ...distinct("SELECT DISTINCT company AS v FROM day_entries"),
      ...distinct("SELECT DISTINCT company AS v FROM backlog"),
    ]);
    seedCategory('PROJECT', [
      ...arr('projects'),
      ...distinct("SELECT DISTINCT project AS v FROM day_entries"),
      ...distinct("SELECT DISTINCT project AS v FROM backlog"),
    ]);
    seedCategory('ACTIVITY_TYPE', [
      ...arr('natural'),
      ...distinct("SELECT DISTINCT activity_type AS v FROM day_entries"),
      ...distinct("SELECT DISTINCT activity_type AS v FROM backlog"),
    ]);
    seedCategory('TIME_TYPE', [
      ...arr('timeType'),
      ...distinct("SELECT DISTINCT time_type AS v FROM day_entries"),
      ...distinct("SELECT DISTINCT time_type AS v FROM backlog"),
    ]);
    seedCategory('ENTRY_STATUS', [
      ...(arr('status').length ? arr('status') : ['Done', 'In Progress']),
      ...distinct("SELECT DISTINCT status AS v FROM day_entries"),
    ]);
    seedCategory('CURRENCY', [
      'USD', 'SAR', 'EUR',
      ...distinct("SELECT DISTINCT currency AS v FROM subscriptions"),
    ]);
    seedCategory('BILLING_CYCLE', [
      'Monthly', 'Yearly', 'Custom',
      ...distinct("SELECT DISTINCT billing_cycle AS v FROM subscriptions"),
    ]);

    // ── Add FK columns, populate from the text columns, drop the text columns ────
    // Resolve a stored label to its catalog id within a category (NULL when blank).
    const idFor = (category, label) => {
      if (label == null || label === '') return null;
      const r = db.prepare('SELECT id FROM lookup_codes WHERE category = ? AND label = ?').get(category, label);
      return r ? r.id : null;
    };

    // table → [ [newFkColumn, category, oldTextColumn], ... ]
    const plan = {
      day_entries: [
        ['status_id',        'ENTRY_STATUS',  'status'],
        ['time_type_id',     'TIME_TYPE',     'time_type'],
        ['activity_type_id', 'ACTIVITY_TYPE', 'activity_type'],
        ['company_id',       'COMPANY',       'company'],
        ['project_id',       'PROJECT',       'project'],
      ],
      backlog: [
        ['time_type_id',     'TIME_TYPE',     'time_type'],
        ['activity_type_id', 'ACTIVITY_TYPE', 'activity_type'],
        ['company_id',       'COMPANY',       'company'],
        ['project_id',       'PROJECT',       'project'],
      ],
      subscriptions: [
        ['currency_id',      'CURRENCY',      'currency'],
        ['billing_cycle_id', 'BILLING_CYCLE', 'billing_cycle'],
      ],
    };

    for (const [table, cols] of Object.entries(plan)) {
      for (const [fk] of cols) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${fk} INTEGER REFERENCES lookup_codes(id)`);
      }
      // Populate FK ids one row at a time (handles arbitrary text, incl. apostrophes).
      const ids = db.prepare(`SELECT rowid AS rid, ${cols.map(c => c[2]).join(', ')} FROM ${table}`).all();
      const setters = cols.map(([fk]) =>
        db.prepare(`UPDATE ${table} SET ${fk} = ? WHERE rowid = ?`)
      );
      for (const row of ids) {
        cols.forEach(([, category, oldCol], i) => {
          setters[i].run(idFor(category, row[oldCol]), row.rid);
        });
      }
      // Drop the now-redundant text columns.
      for (const [, , oldCol] of cols) {
        db.exec(`ALTER TABLE ${table} DROP COLUMN ${oldCol}`);
      }
    }

    // Helpful indexes for the analytics group-bys (join on these FKs).
    db.exec(`
      CREATE INDEX idx_day_entries_company  ON day_entries(company_id);
      CREATE INDEX idx_day_entries_project  ON day_entries(project_id);
      CREATE INDEX idx_day_entries_timetype ON day_entries(time_type_id);
      CREATE INDEX idx_day_entries_activity ON day_entries(activity_type_id);
    `);

    // ── Move default employee name out of the (now-removed) lookups blob ─────────
    const defaultName = (blob && typeof blob.defaultName === 'string') ? blob.defaultName : '';
    db.prepare(`INSERT INTO app_settings(key, value) VALUES('default_employee_name', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(defaultName);
    db.prepare("DELETE FROM app_settings WHERE key = 'lookups'").run();

    // Integrity: every new FK must point at a real catalog row (or be NULL).
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
