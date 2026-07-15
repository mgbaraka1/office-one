// Migration 038 — Server identity: System - Role - Environment.
//
// A client's server is now identified by the triple (System, Role, Environment):
// all three are required, and the triple must be unique within a client. Three
// changes make that possible on existing data:
//
//   1. Role stops being free text and becomes a lookup category (SERVER_ROLE,
//      seeded Applications / Databases / Services, plus RabbitMQ and
//      Application + Database so every role text already in the data maps onto a
//      real code rather than being guessed at or dropped). A new nullable
//      client_servers.role_id FK -> lookup_codes holds it, the same shape
//      company_id/system_id/department_id already use. The legacy free-text
//      `role` column is left exactly as-is and never written again — permanently
//      inert plumbing, the same convention as tasks.source.
//
//   2. Every row missing any of the three gets a `nullN` placeholder (one global
//      sequence, ordered by row id, filling system -> role -> environment) so the
//      user can find and fix them by hand. Placeholder roles need a lookup row to
//      point at, so they're minted as soft-disabled SERVER_ROLE codes: never
//      offered in a dropdown, but still rendered as the current value of the row
//      that carries one. Distinct placeholders are what make the triples unique —
//      a single shared "unassigned" role would collide on every group.
//
//   3. One genuine pre-existing collision is resolved: two fully-filled rows in
//      the first client both read Webshop / Application Server / Production. The
//      second is "Approval Portal - Application Server" — an Webshop-mistagged
//      Approval Portal box — so its System becomes "Approval Portal". Guarded
//      by a name+system match, so it's a no-op on any other database.
//
// Then a case-insensitive UNIQUE index locks the triple in. Runs foreign_key_check.
module.exports = {
  version: 38,
  name: 'server_role_and_identity',
  up(db) {
    const now = new Date().toISOString();

    // ── 1. SERVER_ROLE lookup category ──
    const roleExists = db.prepare("SELECT id FROM lookup_codes WHERE category = 'SERVER_ROLE' AND code = ?");
    const roleIns = db.prepare(
      `INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at)
       VALUES('SERVER_ROLE', ?, ?, ?, ?, ?)`
    );
    // The three the spec asked for, then the two that only exist so pre-existing
    // free text ("RabbitMQ Server", "Application Server; Database Server") maps
    // onto a real code instead of a guess. All manageable from Settings.
    const SEED = [
      ['APPLICATIONS', 'Applications', 0],
      ['DATABASES', 'Databases', 1],
      ['SERVICES', 'Services', 2],
      ['RABBITMQ', 'RabbitMQ', 3],
      ['APPLICATION_DATABASE', 'Application + Database', 4],
    ];
    const roleIdByCode = {};
    for (const [code, label, sort] of SEED) {
      const found = roleExists.get(code);
      roleIdByCode[code] = found
        ? found.id
        : Number(roleIns.run(code, label, sort, 1, now).lastInsertRowid);
    }

    // ── 2. client_servers.role_id ──
    const cols = new Set(db.prepare('PRAGMA table_info(client_servers)').all().map(c => c.name));
    if (!cols.has('role_id')) {
      db.exec('ALTER TABLE client_servers ADD COLUMN role_id INTEGER REFERENCES lookup_codes(id)');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_client_servers_role ON client_servers(role_id)');

    // ── 3. Resolve the one genuine fully-filled collision ──
    // Guarded on the exact shape it has in the data this was written against; a
    // no-op anywhere else, so a hypothetical re-run/fresh install skips it.
    db.prepare(
      `UPDATE client_servers SET system_name = 'Approval Portal', updated_at = ?
        WHERE TRIM(server_name) LIKE 'Approval Portal%'
          AND LOWER(TRIM(COALESCE(system_name, ''))) = 'webshop'
          AND LOWER(TRIM(COALESCE(role, ''))) = 'application server'`
    ).run(now);

    // ── 4. Map existing free-text roles onto the seeded codes ──
    // Only for rows that haven't been mapped yet, so a re-run can't undo a role
    // the user has since re-picked by hand.
    const ROLE_TEXT_MAP = {
      'application server': 'APPLICATIONS',
      'sql database': 'DATABASES',
      'database server': 'DATABASES',
      'services server': 'SERVICES',
      'rabbitmq server': 'RABBITMQ',
      'application server; database server': 'APPLICATION_DATABASE',
    };
    const setRole = db.prepare('UPDATE client_servers SET role_id = ?, updated_at = ? WHERE id = ?');
    const unmapped = db.prepare(
      `SELECT id, role FROM client_servers
        WHERE role_id IS NULL AND TRIM(COALESCE(role, '')) <> ''`
    ).all();
    for (const r of unmapped) {
      const code = ROLE_TEXT_MAP[String(r.role).trim().toLowerCase()];
      if (code) setRole.run(roleIdByCode[code], now, r.id);
    }

    // ── 5. nullN placeholders for everything still missing ──
    // One global counter across all three fields, ordered by row id, so every
    // placeholder is unique and the triples below can't collide on emptiness.
    const rows = db.prepare(
      'SELECT id, system_name, role_id, environment FROM client_servers ORDER BY id'
    ).all();
    const blank = v => !String(v ?? '').trim();
    const nextPlaceholder = (() => {
      // Resume past any placeholder a previous partial run already minted.
      const used = db.prepare(
        "SELECT label FROM lookup_codes WHERE category = 'SERVER_ROLE' AND code LIKE 'NULL%'"
      ).all().map(r => Number(String(r.label).replace(/^null/i, '')) || 0);
      const fromServers = db.prepare(
        `SELECT system_name AS v FROM client_servers WHERE system_name LIKE 'null%'
         UNION ALL SELECT environment AS v FROM client_servers WHERE environment LIKE 'null%'`
      ).all().map(r => Number(String(r.v).replace(/^null/i, '')) || 0);
      let n = Math.max(0, ...used, ...fromServers);
      return () => 'null' + (++n);
    })();

    const setSystem = db.prepare('UPDATE client_servers SET system_name = ?, updated_at = ? WHERE id = ?');
    const setEnv = db.prepare('UPDATE client_servers SET environment = ?, updated_at = ? WHERE id = ?');
    let placeholderSort = 100;   // placeholders always sort after the real roles
    for (const r of rows) {
      if (blank(r.system_name)) setSystem.run(nextPlaceholder(), now, r.id);
      if (r.role_id == null) {
        const label = nextPlaceholder();
        // is_active = 0: a placeholder is never an offerable choice, it's only
        // ever the current value of a row waiting to be fixed by hand.
        const id = Number(roleIns.run(label.toUpperCase(), label, placeholderSort++, 0, now).lastInsertRowid);
        setRole.run(id, now, r.id);
      }
      if (blank(r.environment)) setEnv.run(nextPlaceholder(), now, r.id);
    }

    // ── 6. Lock the triple in ──
    // Case-insensitive on the two free-text parts, matching db.js's own conflict
    // check. Scoped per user + client: the same triple under two clients is fine.
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_client_servers_identity
         ON client_servers(user_id, company_id, LOWER(TRIM(system_name)), role_id, LOWER(TRIM(environment)))`
    );

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
