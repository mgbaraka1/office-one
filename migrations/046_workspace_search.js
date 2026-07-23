// Migration 046 — a user-scoped, trigger-maintained full-text workspace index.
//
// The command palette previously downloaded several complete domain indexes and
// searched them in the renderer. FTS5 keeps the index close to SQLite, returns a
// bounded result set, and remains fully offline. Credentials and file contents
// are deliberately excluded.
module.exports = {
  version: 46,
  name: 'workspace_search',
  destructive: false,
  up(db) {
    db.exec(`
      CREATE VIRTUAL TABLE workspace_search USING fts5(
        user_id UNINDEXED,
        kind UNINDEXED,
        entity_id UNINDEXED,
        title,
        subtitle,
        body,
        updated_at UNINDEXED,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT user_id, 'task', id, name, '',
             COALESCE(source, '') || ' ' ||
             COALESCE((SELECT group_concat(COALESCE(source_ref, '') || ' ' || COALESCE(source_url, ''), ' ')
                         FROM task_sources WHERE task_id = tasks.id), ''),
             updated_at
        FROM tasks;
      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT user_id, 'project', id, name, status, description, updated_at FROM projects;
      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT user_id, 'knowledge', id, title, status, COALESCE(summary, '') || ' ' || COALESCE(content, ''), updated_at
        FROM knowledge_items;
      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT user_id, 'company-document', id, name, COALESCE(category, ''), COALESCE(notes, ''), updated_at
        FROM company_documents;
      INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
      SELECT user_id, 'subscription', id, name, COALESCE(end_date, ''),
             COALESCE(renewal_date, '') || ' ' || COALESCE(CAST(cost AS TEXT), ''), updated_at
        FROM subscriptions;

      CREATE TRIGGER workspace_search_tasks_ai AFTER INSERT ON tasks BEGIN
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        VALUES(new.user_id, 'task', new.id, new.name, '', COALESCE(new.source, ''), new.updated_at);
      END;
      CREATE TRIGGER workspace_search_tasks_au AFTER UPDATE ON tasks BEGIN
        DELETE FROM workspace_search WHERE kind = 'task' AND entity_id = old.id;
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        SELECT new.user_id, 'task', new.id, new.name, '',
               COALESCE(new.source, '') || ' ' ||
               COALESCE((SELECT group_concat(COALESCE(source_ref, '') || ' ' || COALESCE(source_url, ''), ' ')
                           FROM task_sources WHERE task_id = new.id), ''),
               new.updated_at;
      END;
      CREATE TRIGGER workspace_search_tasks_ad AFTER DELETE ON tasks BEGIN
        DELETE FROM workspace_search WHERE kind = 'task' AND entity_id = old.id;
      END;

      CREATE TRIGGER workspace_search_task_sources_ai AFTER INSERT ON task_sources BEGIN
        UPDATE tasks SET updated_at = updated_at WHERE id = new.task_id;
      END;
      CREATE TRIGGER workspace_search_task_sources_au AFTER UPDATE ON task_sources BEGIN
        UPDATE tasks SET updated_at = updated_at WHERE id = new.task_id;
        UPDATE tasks SET updated_at = updated_at WHERE id = old.task_id AND old.task_id != new.task_id;
      END;
      CREATE TRIGGER workspace_search_task_sources_ad AFTER DELETE ON task_sources BEGIN
        UPDATE tasks SET updated_at = updated_at WHERE id = old.task_id;
      END;

      CREATE TRIGGER workspace_search_projects_ai AFTER INSERT ON projects BEGIN
        INSERT INTO workspace_search VALUES(new.user_id, 'project', new.id, new.name, new.status, new.description, new.updated_at);
      END;
      CREATE TRIGGER workspace_search_projects_au AFTER UPDATE ON projects BEGIN
        DELETE FROM workspace_search WHERE kind = 'project' AND entity_id = old.id;
        INSERT INTO workspace_search VALUES(new.user_id, 'project', new.id, new.name, new.status, new.description, new.updated_at);
      END;
      CREATE TRIGGER workspace_search_projects_ad AFTER DELETE ON projects BEGIN
        DELETE FROM workspace_search WHERE kind = 'project' AND entity_id = old.id;
      END;

      CREATE TRIGGER workspace_search_knowledge_ai AFTER INSERT ON knowledge_items BEGIN
        INSERT INTO workspace_search VALUES(new.user_id, 'knowledge', new.id, new.title, new.status,
          COALESCE(new.summary, '') || ' ' || COALESCE(new.content, ''), new.updated_at);
      END;
      CREATE TRIGGER workspace_search_knowledge_au AFTER UPDATE ON knowledge_items BEGIN
        DELETE FROM workspace_search WHERE kind = 'knowledge' AND entity_id = old.id;
        INSERT INTO workspace_search VALUES(new.user_id, 'knowledge', new.id, new.title, new.status,
          COALESCE(new.summary, '') || ' ' || COALESCE(new.content, ''), new.updated_at);
      END;
      CREATE TRIGGER workspace_search_knowledge_ad AFTER DELETE ON knowledge_items BEGIN
        DELETE FROM workspace_search WHERE kind = 'knowledge' AND entity_id = old.id;
      END;

      CREATE TRIGGER workspace_search_company_documents_ai AFTER INSERT ON company_documents BEGIN
        INSERT INTO workspace_search VALUES(new.user_id, 'company-document', new.id, new.name,
          COALESCE(new.category, ''), COALESCE(new.notes, ''), new.updated_at);
      END;
      CREATE TRIGGER workspace_search_company_documents_au AFTER UPDATE ON company_documents BEGIN
        DELETE FROM workspace_search WHERE kind = 'company-document' AND entity_id = old.id;
        INSERT INTO workspace_search VALUES(new.user_id, 'company-document', new.id, new.name,
          COALESCE(new.category, ''), COALESCE(new.notes, ''), new.updated_at);
      END;
      CREATE TRIGGER workspace_search_company_documents_ad AFTER DELETE ON company_documents BEGIN
        DELETE FROM workspace_search WHERE kind = 'company-document' AND entity_id = old.id;
      END;

      CREATE TRIGGER workspace_search_subscriptions_ai AFTER INSERT ON subscriptions BEGIN
        INSERT INTO workspace_search VALUES(new.user_id, 'subscription', new.id, new.name,
          COALESCE(new.end_date, ''), COALESCE(new.renewal_date, '') || ' ' || COALESCE(CAST(new.cost AS TEXT), ''), new.updated_at);
      END;
      CREATE TRIGGER workspace_search_subscriptions_au AFTER UPDATE ON subscriptions BEGIN
        DELETE FROM workspace_search WHERE kind = 'subscription' AND entity_id = old.id;
        INSERT INTO workspace_search VALUES(new.user_id, 'subscription', new.id, new.name,
          COALESCE(new.end_date, ''), COALESCE(new.renewal_date, '') || ' ' || COALESCE(CAST(new.cost AS TEXT), ''), new.updated_at);
      END;
      CREATE TRIGGER workspace_search_subscriptions_ad AFTER DELETE ON subscriptions BEGIN
        DELETE FROM workspace_search WHERE kind = 'subscription' AND entity_id = old.id;
      END;
    `);
  },
};
