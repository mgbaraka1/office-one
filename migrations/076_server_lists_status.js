// Migration 076 — what a server is linked to, what runs on it, who it talks
// to, and whether it is still in use. All optional.
//
//   client_servers.linked_servers     JSON array of IPs or hostnames, default '[]'
//   client_servers.workloads          JSON array of workload names, default '[]'
//   client_servers.external_parties   JSON array of party names, default '[]'
//   client_servers.status             'ACTIVE' | 'INACTIVE', default 'ACTIVE'
//
// Each list is plain strings with no details, so a JSON column is enough; no
// child table. ADD COLUMN keeps the table's triggers and indexes. Every
// existing server starts ACTIVE with three empty lists.
//
// The client-server Quick Find triggers (049) are recreated so the three lists
// are searched too: finding a party's name finds the server that calls it. The body
// is otherwise unchanged, and the server search rows are rebuilt from it.
// Idempotent: column checks and DROP TRIGGER IF EXISTS.
const ROW = k => `
  ${k}.user_id, 'client-server', CAST(${k}.company_id AS TEXT) || ':' || CAST(${k}.id AS TEXT),
  COALESCE(NULLIF(${k}.hostname, ''), NULLIF(${k}.host, ''), 'Server'),
  COALESCE((SELECT name_en FROM lookup_codes WHERE id = ${k}.company_id), 'Client server'),
  COALESCE(${k}.host, '') || ' ' || COALESCE(${k}.hostname, '') || ' ' || COALESCE(${k}.os, '') || ' ' ||
  COALESCE(${k}.environment, '') || ' ' || COALESCE((SELECT label FROM lookup_codes WHERE id = ${k}.system_id), '') || ' ' ||
  COALESCE((SELECT label FROM lookup_codes WHERE id = ${k}.role_id), '') || ' ' || COALESCE(${k}.notes, '') || ' ' ||
  COALESCE(${k}.linked_servers, '') || ' ' || COALESCE(${k}.workloads, '') || ' ' || COALESCE(${k}.external_parties, ''),
  ${k}.updated_at`;

module.exports = {
  version: 76,
  name: 'server_lists_status',
  destructive: false,
  up(db) {
    const cols = new Set(db.prepare('PRAGMA table_info(client_servers)').all().map(c => c.name));
    for (const name of ['linked_servers', 'workloads', 'external_parties']) {
      if (!cols.has(name)) db.exec(`ALTER TABLE client_servers ADD COLUMN ${name} TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!cols.has('status')) {
      db.exec("ALTER TABLE client_servers ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE'))");
    }

    const hasSearch = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workspace_search'").get();
    if (hasSearch) {
      db.exec(`
        DROP TRIGGER IF EXISTS workspace_search_client_servers_ai;
        DROP TRIGGER IF EXISTS workspace_search_client_servers_au;
        DELETE FROM workspace_search WHERE kind = 'client-server';

        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        SELECT ${ROW('s')} FROM client_servers s;

        CREATE TRIGGER workspace_search_client_servers_ai AFTER INSERT ON client_servers BEGIN
          INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
          VALUES(${ROW('new')});
        END;
        CREATE TRIGGER workspace_search_client_servers_au AFTER UPDATE ON client_servers BEGIN
          DELETE FROM workspace_search WHERE kind = 'client-server'
            AND entity_id = CAST(old.company_id AS TEXT) || ':' || CAST(old.id AS TEXT);
          INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
          VALUES(${ROW('new')});
        END;
      `);
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
