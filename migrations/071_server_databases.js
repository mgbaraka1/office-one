// Migration 071 — databases recorded under the server that hosts them.
//
// A server record is the machine; a database on it is its own record with its
// own connection details. The retired `client_databases` table (migration 019,
// no UI or rows since the Databases section was removed) already has the right
// shape, so it comes back nested under a server rather than as a new table:
//
//   client_databases.server_id          FK -> client_servers(id), ON DELETE CASCADE
//   client_databases.connection_string  encrypted at rest like `password`, since
//                                       a connection string often carries one
//   idx_client_databases_server         (server_id)
//   workspace_search_client_databases_* Quick Find triggers, kind 'client-database'
//
// The search body is non-secret metadata only (name, engine, version, port,
// notes), the rule migration 049 set: never usernames, passwords or the
// connection string. A database is indexed under its own kind so its delete
// trigger can never remove the host server's row.
//
// ADD COLUMN keeps the table's index; the table had no triggers. Idempotent:
// column checks, IF NOT EXISTS.
module.exports = {
  version: 71,
  name: 'server_databases',
  destructive: false,
  up(db) {
    const columns = new Set(db.prepare('PRAGMA table_info(client_databases)').all().map(c => c.name));
    if (!columns.has('server_id')) {
      db.exec('ALTER TABLE client_databases ADD COLUMN server_id INTEGER REFERENCES client_servers(id) ON DELETE CASCADE');
    }
    if (!columns.has('connection_string')) {
      db.exec("ALTER TABLE client_databases ADD COLUMN connection_string TEXT NOT NULL DEFAULT ''");
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_client_databases_server ON client_databases(server_id)');

    const title = r => `COALESCE(NULLIF(${r}.name, ''), 'Database')`;
    const subtitle = r => `COALESCE((SELECT name_en FROM lookup_codes WHERE id = ${r}.company_id), 'Client database')`;
    const body = r => `COALESCE(${r}.name, '') || ' ' || COALESCE(${r}.engine, '') || ' ' ||
          COALESCE(${r}.version, '') || ' ' || COALESCE(${r}.port, '') || ' ' || COALESCE(${r}.notes, '')`;
    const entity = r => `CAST(${r}.company_id AS TEXT) || ':' || CAST(${r}.id AS TEXT)`;
    db.exec(`
      DELETE FROM workspace_search WHERE kind = 'client-database';
      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT d.user_id, 'client-database', ${entity('d')}, ${title('d')}, ${subtitle('d')}, ${body('d')}, d.updated_at
        FROM client_databases d;

      CREATE TRIGGER IF NOT EXISTS workspace_search_client_databases_ai AFTER INSERT ON client_databases BEGIN
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'client-database', ${entity('new')}, ${title('new')}, ${subtitle('new')}, ${body('new')}, new.updated_at);
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_client_databases_au AFTER UPDATE ON client_databases BEGIN
        DELETE FROM workspace_search WHERE kind = 'client-database' AND entity_id = ${entity('old')};
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'client-database', ${entity('new')}, ${title('new')}, ${subtitle('new')}, ${body('new')}, new.updated_at);
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_client_databases_ad AFTER DELETE ON client_databases BEGIN
        DELETE FROM workspace_search WHERE kind = 'client-database' AND entity_id = ${entity('old')};
      END;
    `);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
