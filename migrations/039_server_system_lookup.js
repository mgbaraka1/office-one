// Migration 039 — a server's System becomes a SYSTEM lookup, not free text.
//
// Migration 038 made a server's identity the (System, Role, Environment) triple
// and turned Role into a lookup. System stayed free text, which let the same
// system be spelled several ways and drift from the SYSTEM catalog the rest of
// the app (tasks, projects, Browse, Analytics) already uses. This adds
// client_servers.system_id -> lookup_codes(SYSTEM) and maps every existing value
// onto it; the free-text `system_name` column becomes inert legacy plumbing,
// read-only and never written again (same convention as `role` and tasks.source).
//
// The mapping is NOT guessed — each ambiguous case was confirmed with the user
// against the real data, because SYSTEM is shared with the rest of the app and a
// wrong merge would silently re-label their infrastructure records:
//   Webshop (14)                 -> Online Platform   (their name for it)
//   Agggregators (5)             -> Aggregators       (typo, 3 g's)
//   PayGate (2)                  -> Payment Gateway
//   Travel Cover (2)             -> Travel
//   Travel Cover Servers (4)     -> Travel            ("Servers" is not a system)
//   Uploader / Billing / Travel  -> the identical existing codes
//   Approval Portal (1)          -> created (no equivalent existed)
// Consolidating systems can collide the identity triple, so this was dry-run
// first (none collide — distinct nullN roles keep the merged Travel rows apart)
// and is re-asserted below, so the migration can never commit a broken state.
//
// nullN system placeholders (migration 038's, for rows that never had a system)
// are minted as soft-disabled SYSTEM codes: never offered in a dropdown, still
// shown as the current value of the row waiting to be fixed. Runs foreign_key_check.
module.exports = {
  version: 39,
  name: 'server_system_lookup',
  up(db) {
    const now = new Date().toISOString();

    // ── column ──
    const cols = new Set(db.prepare('PRAGMA table_info(client_servers)').all().map(c => c.name));
    if (!cols.has('system_id')) {
      db.exec('ALTER TABLE client_servers ADD COLUMN system_id INTEGER REFERENCES lookup_codes(id)');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_client_servers_system ON client_servers(system_id)');

    // ── lookup helpers (db.js's own lk* cache isn't available inside a migration) ──
    const findByLabel = db.prepare("SELECT id FROM lookup_codes WHERE category = 'SYSTEM' AND LOWER(TRIM(label)) = LOWER(TRIM(?))");
    const findByCode = db.prepare("SELECT id FROM lookup_codes WHERE category = 'SYSTEM' AND code = ?");
    const insLookup = db.prepare(
      `INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at)
       VALUES('SYSTEM', ?, ?, ?, ?, ?)`
    );
    const maxSort = () => (db.prepare("SELECT COALESCE(MAX(sort_order), -1) m FROM lookup_codes WHERE category = 'SYSTEM'").get().m) + 1;
    const slug = s => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'NA';
    const uniqueCode = base => {
      let code = base, i = 2;
      while (findByCode.get(code)) code = base + '_' + (i++);
      return code;
    };
    const ensure = (label, active) => {
      const hit = findByLabel.get(label);
      if (hit) return hit.id;
      return Number(insLookup.run(uniqueCode(slug(label)), label, maxSort(), active ? 1 : 0, now).lastInsertRowid);
    };

    // ── the confirmed mapping (lowercased free text -> target SYSTEM label) ──
    const MAP = {
      'webshop': 'Online Platform',
      'agggregators': 'Aggregators',
      'paygate': 'Payment Gateway',
      'travel cover': 'Travel',
      'travel cover servers': 'Travel',
    };
    ensure('Approval Portal', true);   // no equivalent existed; a real system

    const setSystem = db.prepare('UPDATE client_servers SET system_id = ?, updated_at = ? WHERE id = ?');
    // Guarded to system_id IS NULL so a re-run can't undo a system the user has
    // since re-picked by hand.
    const rows = db.prepare('SELECT id, system_name FROM client_servers WHERE system_id IS NULL').all();
    for (const r of rows) {
      const raw = String(r.system_name || '').trim();
      const key = raw.toLowerCase();
      let id;
      if (/^null\d+$/i.test(raw)) {
        id = ensure(raw, false);          // soft-disabled placeholder: never offerable
      } else if (MAP[key]) {
        id = ensure(MAP[key], true);      // confirmed consolidation
      } else if (raw) {
        id = ensure(raw, true);           // exact catalog match, or an unseen name -> create as-is
      } else {
        continue;                         // no system at all: 038 should have placeholdered it
      }
      setSystem.run(id, now, r.id);
    }

    // ── re-key the identity index onto system_id ──
    // 038's index keyed the free-text column; the triple is now (system_id,
    // role_id, environment). Dropping an index is not data loss.
    db.exec('DROP INDEX IF EXISTS idx_client_servers_identity');
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_client_servers_identity
         ON client_servers(user_id, company_id, system_id, role_id, LOWER(TRIM(environment)))`
    );

    // ── safety: the consolidation must not have collided any triple ──
    // Throwing here rolls the whole migration back rather than committing a
    // half-mapped table (the dry-run said none collide; this proves it).
    const dupes = db.prepare(
      `SELECT COUNT(*) c FROM (
         SELECT user_id, company_id, system_id, role_id, LOWER(TRIM(environment))
           FROM client_servers GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1)`
    ).get().c;
    if (dupes) throw new Error('server identity collision after system consolidation: ' + dupes + ' duplicate triple(s)');

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
