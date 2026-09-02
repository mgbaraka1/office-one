// Migration 056 — Finance clients join the shared client roster.
//
// See FINANCE_INTEGRATION_PLAN.md §6. Until now Finance kept its own client
// list (finance_clients) with no relationship to the COMPANY lookup catalog
// that backs Clients / Projects / Browse / Analytics / task dropdowns, so the
// same organisation existed twice with no link between the two records.
//
// This migration links them. finance_clients stops being a roster and becomes
// a *finance profile* of a company — exactly the shape client_vpn_connections
// already has: a per-user child record keyed to a global COMPANY lookup id.
//
// Nothing is deleted. finance_clients keeps every column it had; the local
// name/code/contact fields stay as the pre-merge audit trail, and remain the
// fallback for any row that somehow ends up unlinked.
//
// Backfill is deliberately deterministic — no fuzzy name matching. Either the
// finance client's code matches an existing COMPANY code exactly, or a COMPANY
// row is created from it. Guessing that "Acme" and "ACME Corp" are the same
// organisation is not something a migration should do silently to production
// data; a wrong link is far more expensive than a duplicate the user merges by
// hand in Settings -> Maintenance.
module.exports = {
  version: 56,
  name: 'finance_client_company_link',
  destructive: true,
  up(db) {
    const hasTable = name => !!db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(name);
    // Migration 054 creates the Finance tables; if that has not happened
    // there is nothing here to link yet.
    if (!hasTable('finance_clients')) return;

    const columns = db.prepare('PRAGMA table_info(finance_clients)').all().map(c => c.name);
    if (!columns.includes('company_id')) {
      db.exec('ALTER TABLE finance_clients ADD COLUMN company_id INTEGER REFERENCES lookup_codes(id)');
    }
    // One finance profile per company per user. Partial, because rows that are
    // not linked yet legitimately share a NULL company_id.
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_clients_company
               ON finance_clients(user_id, company_id) WHERE company_id IS NOT NULL`);

    // Shared company detail promoted out of finance_clients. GLOBAL — no
    // user_id — because a tax number and a registered address are facts about
    // the company, not one user's private note about it. That makes this a
    // deliberate exception to "every business table carries a user_id", of the
    // same class as lookup_codes itself, and it is documented as one in
    // CLAUDE.md §4.1.
    db.exec(`
      CREATE TABLE IF NOT EXISTS company_profiles (
        id            INTEGER PRIMARY KEY,
        company_id    INTEGER NOT NULL UNIQUE REFERENCES lookup_codes(id) ON DELETE CASCADE,
        contact_name  TEXT NOT NULL DEFAULT '',
        contact_email TEXT NOT NULL DEFAULT '',
        contact_phone TEXT NOT NULL DEFAULT '',
        address       TEXT NOT NULL DEFAULT '',
        tax_number    TEXT NOT NULL DEFAULT '',
        notes         TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
    `);

    const now = new Date().toISOString();
    const decisions = [];

    // ── Step 1: link on an exact company-code match ──────────────────────────
    const unlinked = db.prepare(
      `SELECT id, user_id, name, name_ar, code FROM finance_clients
        WHERE company_id IS NULL ORDER BY user_id, id`
    ).all();

    const findByCode = db.prepare(
      "SELECT id FROM lookup_codes WHERE category = 'COMPANY' AND code = ? COLLATE NOCASE"
    );
    const companyTaken = db.prepare(
      'SELECT 1 FROM finance_clients WHERE user_id = ? AND company_id = ? AND id != ?'
    );
    const link = db.prepare('UPDATE finance_clients SET company_id = ?, updated_at = ? WHERE id = ?');
    const insertCompany = db.prepare(
      `INSERT INTO lookup_codes(category, code, label, name_en, name_ar, sort_order, is_active, created_at)
       VALUES('COMPANY', ?, ?, ?, ?, ?, 1, ?)`
    );
    const codeExists = db.prepare(
      "SELECT 1 FROM lookup_codes WHERE category = 'COMPANY' AND code = ? COLLATE NOCASE"
    );

    // Mirrors db.js's slugCode(): uppercase, non-alphanumerics collapsed to _.
    // An all-Arabic name legitimately reduces to nothing, hence the NA default
    // and the uniquifying suffix below.
    const slugCode = (s) => {
      const normalized = String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      return normalized.replace(/^_/, '').replace(/_$/, '') || 'NA';
    };
    const uniqueCode = (base) => {
      let code = base;
      let i = 2;
      while (codeExists.get(code)) code = base + '_' + (i++);
      return code;
    };

    for (const row of unlinked) {
      const code = String(row.code || '').trim();
      let companyId = null;

      if (code) {
        const match = findByCode.get(code);
        if (match && !companyTaken.get(row.user_id, match.id, row.id)) {
          companyId = match.id;
          decisions.push(`finance_client ${row.id} -> existing COMPANY ${companyId} (code ${code})`);
        }
      }

      if (companyId == null) {
        // ── Step 2: create the COMPANY row from the finance client ──────────
        // Faithful, not clever: whatever the finance record called this client
        // is what the company is called. If `name` holds Arabic text (as
        // SARWA's does), name_en will too — correcting that is a five-second
        // edit in Settings -> Companies, and is not a migration's business.
        const nameEn = String(row.name || '').trim() || 'Untitled';
        const nameAr = String(row.name_ar || '').trim();
        const baseCode = code && /^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(code.toUpperCase())
          ? code.toUpperCase()
          : slugCode(nameEn);
        const finalCode = uniqueCode(baseCode);
        const maxSort = db.prepare(
          "SELECT COALESCE(MAX(sort_order), -1) AS m FROM lookup_codes WHERE category = 'COMPANY'"
        ).get().m;
        companyId = Number(
          insertCompany.run(finalCode, nameEn, nameEn, nameAr, maxSort + 1, now).lastInsertRowid
        );
        decisions.push(`finance_client ${row.id} -> NEW COMPANY ${companyId} (code ${finalCode})`);
      }

      link.run(companyId, now, row.id);
    }

    // ── Step 3: promote the shared profile fields ───────────────────────────
    // First non-empty value wins, in a deterministic order (lowest user_id,
    // then lowest id). Where two users disagree the loser is NOT destroyed —
    // it stays in that user's finance_clients row, which this migration never
    // clears.
    const profileRows = db.prepare(
      `SELECT company_id, contact_name, contact_email, contact_phone, address, tax_number, notes
         FROM finance_clients
        WHERE company_id IS NOT NULL
        ORDER BY user_id, id`
    ).all();

    const FIELDS = ['contact_name', 'contact_email', 'contact_phone', 'address', 'tax_number', 'notes'];
    const merged = new Map();
    for (const row of profileRows) {
      if (!merged.has(row.company_id)) {
        merged.set(row.company_id, Object.fromEntries(FIELDS.map(f => [f, ''])));
      }
      const target = merged.get(row.company_id);
      for (const field of FIELDS) {
        if (!target[field] && String(row[field] || '').trim()) target[field] = String(row[field]).trim();
      }
    }

    const upsertProfile = db.prepare(
      `INSERT INTO company_profiles(company_id, contact_name, contact_email, contact_phone,
                                    address, tax_number, notes, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(company_id) DO NOTHING`
    );
    for (const [companyId, values] of merged) {
      // Skip companies with nothing worth recording — an empty profile row adds
      // no information and the reader treats missing and blank identically.
      if (!FIELDS.some(f => values[f])) continue;
      upsertProfile.run(companyId, values.contact_name, values.contact_email, values.contact_phone,
        values.address, values.tax_number, values.notes, now, now);
    }

    if (decisions.length) {
      console.log('[migration 056] linked ' + decisions.length + ' finance client(s):');
      for (const d of decisions) console.log('  ' + d);
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
