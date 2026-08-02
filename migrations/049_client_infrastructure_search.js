// Migration 049 — include non-secret client infrastructure metadata in the
// user-scoped workspace FTS index. Passwords, secret keys, usernames, and
// credential locations are deliberately excluded.
module.exports = {
  version: 49,
  name: 'client_infrastructure_search',
  destructive: false,
  up(db) {
    db.exec(`
      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT v.user_id, 'client-auth', CAST(v.company_id AS TEXT) || ':' || CAST(v.id AS TEXT),
             COALESCE(NULLIF(v.connection_name, ''), NULLIF(v.vpn_type, ''), 'Client access'),
             COALESCE((SELECT name_en FROM lookup_codes WHERE id = v.company_id), 'Client access'),
             COALESCE(v.vpn_type, '') || ' ' || COALESCE(v.endpoint, '') || ' ' ||
             COALESCE(v.port, '') || ' ' || COALESCE(v.notes, ''), v.updated_at
        FROM client_vpn_connections v;

      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT s.user_id, 'client-server', CAST(s.company_id AS TEXT) || ':' || CAST(s.id AS TEXT),
             COALESCE(NULLIF(s.hostname, ''), NULLIF(s.host, ''), 'Server'),
             COALESCE((SELECT name_en FROM lookup_codes WHERE id = s.company_id), 'Client server'),
             COALESCE(s.host, '') || ' ' || COALESCE(s.hostname, '') || ' ' || COALESCE(s.os, '') || ' ' ||
             COALESCE(s.environment, '') || ' ' ||
             COALESCE((SELECT label FROM lookup_codes WHERE id = s.system_id), '') || ' ' ||
             COALESCE((SELECT label FROM lookup_codes WHERE id = s.role_id), '') || ' ' || COALESCE(s.notes, ''),
             s.updated_at
        FROM client_servers s;

      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT i.user_id, 'client-system', CAST(i.company_id AS TEXT) || ':' || CAST(i.id AS TEXT),
             COALESCE(NULLIF(i.name, ''), 'Internal system'),
             COALESCE((SELECT name_en FROM lookup_codes WHERE id = i.company_id), 'Client system'),
             COALESCE(i.url, '') || ' ' || COALESCE(i.system_name, '') || ' ' ||
             COALESCE(i.environment, '') || ' ' || COALESCE(i.company_code, '') || ' ' ||
             COALESCE(i.role, '') || ' ' || COALESCE(i.notes, ''), i.updated_at
        FROM client_internal_systems i;

      CREATE TRIGGER workspace_search_client_vpn_ai AFTER INSERT ON client_vpn_connections BEGIN
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'client-auth', CAST(new.company_id AS TEXT) || ':' || CAST(new.id AS TEXT),
          COALESCE(NULLIF(new.connection_name, ''), NULLIF(new.vpn_type, ''), 'Client access'),
          COALESCE((SELECT name_en FROM lookup_codes WHERE id = new.company_id), 'Client access'),
          COALESCE(new.vpn_type, '') || ' ' || COALESCE(new.endpoint, '') || ' ' ||
          COALESCE(new.port, '') || ' ' || COALESCE(new.notes, ''), new.updated_at);
      END;
      CREATE TRIGGER workspace_search_client_vpn_au AFTER UPDATE ON client_vpn_connections BEGIN
        DELETE FROM workspace_search WHERE kind = 'client-auth'
          AND entity_id = CAST(old.company_id AS TEXT) || ':' || CAST(old.id AS TEXT);
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'client-auth', CAST(new.company_id AS TEXT) || ':' || CAST(new.id AS TEXT),
          COALESCE(NULLIF(new.connection_name, ''), NULLIF(new.vpn_type, ''), 'Client access'),
          COALESCE((SELECT name_en FROM lookup_codes WHERE id = new.company_id), 'Client access'),
          COALESCE(new.vpn_type, '') || ' ' || COALESCE(new.endpoint, '') || ' ' ||
          COALESCE(new.port, '') || ' ' || COALESCE(new.notes, ''), new.updated_at);
      END;
      CREATE TRIGGER workspace_search_client_vpn_ad AFTER DELETE ON client_vpn_connections BEGIN
        DELETE FROM workspace_search WHERE kind = 'client-auth'
          AND entity_id = CAST(old.company_id AS TEXT) || ':' || CAST(old.id AS TEXT);
      END;

      CREATE TRIGGER workspace_search_client_servers_ai AFTER INSERT ON client_servers BEGIN
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'client-server', CAST(new.company_id AS TEXT) || ':' || CAST(new.id AS TEXT),
          COALESCE(NULLIF(new.hostname, ''), NULLIF(new.host, ''), 'Server'),
          COALESCE((SELECT name_en FROM lookup_codes WHERE id = new.company_id), 'Client server'),
          COALESCE(new.host, '') || ' ' || COALESCE(new.hostname, '') || ' ' || COALESCE(new.os, '') || ' ' ||
          COALESCE(new.environment, '') || ' ' || COALESCE((SELECT label FROM lookup_codes WHERE id = new.system_id), '') || ' ' ||
          COALESCE((SELECT label FROM lookup_codes WHERE id = new.role_id), '') || ' ' || COALESCE(new.notes, ''), new.updated_at);
      END;
      CREATE TRIGGER workspace_search_client_servers_au AFTER UPDATE ON client_servers BEGIN
        DELETE FROM workspace_search WHERE kind = 'client-server'
          AND entity_id = CAST(old.company_id AS TEXT) || ':' || CAST(old.id AS TEXT);
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'client-server', CAST(new.company_id AS TEXT) || ':' || CAST(new.id AS TEXT),
          COALESCE(NULLIF(new.hostname, ''), NULLIF(new.host, ''), 'Server'),
          COALESCE((SELECT name_en FROM lookup_codes WHERE id = new.company_id), 'Client server'),
          COALESCE(new.host, '') || ' ' || COALESCE(new.hostname, '') || ' ' || COALESCE(new.os, '') || ' ' ||
          COALESCE(new.environment, '') || ' ' || COALESCE((SELECT label FROM lookup_codes WHERE id = new.system_id), '') || ' ' ||
          COALESCE((SELECT label FROM lookup_codes WHERE id = new.role_id), '') || ' ' || COALESCE(new.notes, ''), new.updated_at);
      END;
      CREATE TRIGGER workspace_search_client_servers_ad AFTER DELETE ON client_servers BEGIN
        DELETE FROM workspace_search WHERE kind = 'client-server'
          AND entity_id = CAST(old.company_id AS TEXT) || ':' || CAST(old.id AS TEXT);
      END;

      CREATE TRIGGER workspace_search_client_internal_ai AFTER INSERT ON client_internal_systems BEGIN
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'client-system', CAST(new.company_id AS TEXT) || ':' || CAST(new.id AS TEXT),
          COALESCE(NULLIF(new.name, ''), 'Internal system'),
          COALESCE((SELECT name_en FROM lookup_codes WHERE id = new.company_id), 'Client system'),
          COALESCE(new.url, '') || ' ' || COALESCE(new.system_name, '') || ' ' || COALESCE(new.environment, '') || ' ' ||
          COALESCE(new.company_code, '') || ' ' || COALESCE(new.role, '') || ' ' || COALESCE(new.notes, ''), new.updated_at);
      END;
      CREATE TRIGGER workspace_search_client_internal_au AFTER UPDATE ON client_internal_systems BEGIN
        DELETE FROM workspace_search WHERE kind = 'client-system'
          AND entity_id = CAST(old.company_id AS TEXT) || ':' || CAST(old.id AS TEXT);
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'client-system', CAST(new.company_id AS TEXT) || ':' || CAST(new.id AS TEXT),
          COALESCE(NULLIF(new.name, ''), 'Internal system'),
          COALESCE((SELECT name_en FROM lookup_codes WHERE id = new.company_id), 'Client system'),
          COALESCE(new.url, '') || ' ' || COALESCE(new.system_name, '') || ' ' || COALESCE(new.environment, '') || ' ' ||
          COALESCE(new.company_code, '') || ' ' || COALESCE(new.role, '') || ' ' || COALESCE(new.notes, ''), new.updated_at);
      END;
      CREATE TRIGGER workspace_search_client_internal_ad AFTER DELETE ON client_internal_systems BEGIN
        DELETE FROM workspace_search WHERE kind = 'client-system'
          AND entity_id = CAST(old.company_id AS TEXT) || ':' || CAST(old.id AS TEXT);
      END;
    `);
  },
};
