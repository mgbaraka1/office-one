// Migration 067 — Outsource projects: Person → Projects → Entries.
//
// 066 kept an entry's project as free text. The owner works the other way
// round: add a project inside a person, then write that project's entries.
// So a project becomes a record of its own.
//
//   outs_projects         one row per project of one resource (name unique per
//                         resource among live rows — checked in code, because
//                         a project in its undo window must not hold its name).
//   outs_entries          + project_id → outs_projects (ON DELETE CASCADE:
//                         purging a project purges its entries). The 066
//                         `project` text column stays, kept equal to the
//                         project's name, so nothing reading it breaks.
//   outs_statement_lines  + project_id, a plain snapshot column (no FK): an
//                         issued line must outlive anything it points at.
//   outs_history          rebuilt, only to widen its record_type CHECK with
//                         'project' (SQLite cannot alter a CHECK). It has no
//                         triggers; its one index is recreated.
//
// Backfill: every entry still without a project gets one — per resource, one
// project per folded project text (the most recent spelling wins), and
// "General" for entries that had none.
//
// Quick Find: projects join the index (kind 'outs-project', entity_id
// 'resourceId:projectId'); entry ids become 'resourceId:projectId:entryId' so a
// hit can open the right project. An entry is indexed only while it, its
// project and its resource are all live. The 066 entry triggers are dropped
// and recreated with the project join, and renaming, deleting or restoring a
// project (or a resource) re-indexes what hangs off it.
//
// Idempotent: IF NOT EXISTS / column checks everywhere, the history rebuild
// runs only while the old CHECK is in place, and the search rows for the
// Outsource kinds are deleted and rebuilt.
const RESOURCE_ROW = r => `
  ${r}.user_id, 'outs-resource', CAST(${r}.id AS TEXT),
  ${r}.name, 'Outsource',
  COALESCE(${r}.name, '') || ' ' || COALESCE(${r}.email, '') || ' ' || COALESCE(${r}.phone, ''),
  ${r}.updated_at`;
// `p` is the project, `r` its resource.
const PROJECT_ROW = (p, r) => `
  ${r}.user_id, 'outs-project', CAST(${p}.resource_id AS TEXT) || ':' || CAST(${p}.id AS TEXT),
  ${p}.name, ${r}.name,
  COALESCE(${p}.name, '') || ' ' || COALESCE(${r}.name, ''),
  ${p}.updated_at`;
// `e` is the entry, `p` its project, `r` its resource.
const ENTRY_ROW = (e, p, r) => `
  ${e}.user_id, 'outs-entry',
  CAST(${e}.resource_id AS TEXT) || ':' || CAST(${e}.project_id AS TEXT) || ':' || CAST(${e}.id AS TEXT),
  CASE WHEN ${e}.description <> '' THEN ${e}.description ELSE ${p}.name END,
  ${r}.name || ' · ' || ${p}.name || ' · ' || ${e}.work_date,
  COALESCE(${e}.description, '') || ' ' || COALESCE(${p}.name, '') || ' ' || COALESCE(${r}.name, ''),
  ${e}.updated_at`;
const ENTRY_ID = e => `CAST(${e}.resource_id AS TEXT) || ':' || CAST(${e}.project_id AS TEXT) || ':' || CAST(${e}.id AS TEXT)`;

module.exports = {
  version: 67,
  name: 'outsource_projects',
  destructive: false,
  up(db) {
    const hasTable = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
    if (!hasTable('outs_resources')) return;
    const columns = table => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));

    db.exec(`
      CREATE TABLE IF NOT EXISTS outs_projects (
        id          INTEGER PRIMARY KEY,
        resource_id INTEGER NOT NULL REFERENCES outs_resources(id) ON DELETE CASCADE,
        name        TEXT    NOT NULL,
        notes       TEXT    NOT NULL DEFAULT '',
        is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL,
        deleted_at  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_outs_projects_resource ON outs_projects(resource_id);
    `);
    if (!columns('outs_entries').has('project_id')) {
      db.exec('ALTER TABLE outs_entries ADD COLUMN project_id INTEGER REFERENCES outs_projects(id) ON DELETE CASCADE');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_outs_entries_project ON outs_entries(project_id)');
    if (!columns('outs_statement_lines').has('project_id')) {
      db.exec('ALTER TABLE outs_statement_lines ADD COLUMN project_id INTEGER');
    }

    // Widen outs_history.record_type. The rebuild runs only while the 066 CHECK
    // (without 'project') is still the table's definition.
    const historySql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'outs_history'").get()?.sql || '';
    if (historySql && !historySql.includes("'project'")) {
      db.exec(`
        CREATE TABLE outs_history_067 (
          id          INTEGER PRIMARY KEY,
          resource_id INTEGER NOT NULL,
          record_type TEXT    NOT NULL CHECK (record_type IN ('resource', 'project', 'rate', 'entry', 'statement')),
          record_id   INTEGER,
          field       TEXT    NOT NULL,
          old_value   TEXT    NOT NULL DEFAULT '',
          new_value   TEXT    NOT NULL DEFAULT '',
          user_id     INTEGER NOT NULL REFERENCES users(id),
          changed_at  TEXT    NOT NULL
        );
        INSERT INTO outs_history_067(id, resource_id, record_type, record_id, field, old_value, new_value, user_id, changed_at)
          SELECT id, resource_id, record_type, record_id, field, old_value, new_value, user_id, changed_at FROM outs_history;
        DROP TABLE outs_history;
        ALTER TABLE outs_history_067 RENAME TO outs_history;
      `);
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_outs_history_resource ON outs_history(resource_id, changed_at)');

    // Backfill projects for entries that predate them.
    const now = new Date().toISOString();
    const orphans = db.prepare(
      'SELECT id, resource_id, project FROM outs_entries WHERE project_id IS NULL ORDER BY updated_at DESC, id DESC'
    ).all();
    if (orphans.length) {
      const fold = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
      const insert = db.prepare(
        'INSERT INTO outs_projects(resource_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
      );
      const setProject = db.prepare('UPDATE outs_entries SET project_id = ?, project = ? WHERE id = ?');
      const made = new Map();   // resource|folded name → { id, name }
      for (const e of orphans) {
        const name = String(e.project ?? '').trim().replace(/\s+/g, ' ') || 'General';
        const key = e.resource_id + '|' + fold(name);
        if (!made.has(key)) {
          const existing = db.prepare('SELECT id, name FROM outs_projects WHERE resource_id = ? AND deleted_at IS NULL')
            .all(e.resource_id).find(p => fold(p.name) === fold(name));
          made.set(key, existing || { id: Number(insert.run(e.resource_id, name, now, now).lastInsertRowid), name });
        }
        const p = made.get(key);
        setProject.run(p.id, p.name, e.id);
      }
    }

    if (hasTable('workspace_search')) {
      db.exec(`
        DROP TRIGGER IF EXISTS workspace_search_outs_entries_ai;
        DROP TRIGGER IF EXISTS workspace_search_outs_entries_au;
        DROP TRIGGER IF EXISTS workspace_search_outs_entries_ad;
        DROP TRIGGER IF EXISTS workspace_search_outs_resources_au_entries;
        DELETE FROM workspace_search WHERE kind IN ('outs-resource', 'outs-project', 'outs-entry');

        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        SELECT ${RESOURCE_ROW('r')} FROM outs_resources r WHERE r.deleted_at IS NULL;
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        SELECT ${PROJECT_ROW('p', 'r')} FROM outs_projects p JOIN outs_resources r ON r.id = p.resource_id
         WHERE p.deleted_at IS NULL AND r.deleted_at IS NULL;
        INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
        SELECT ${ENTRY_ROW('e', 'p', 'r')} FROM outs_entries e
          JOIN outs_projects p ON p.id = e.project_id JOIN outs_resources r ON r.id = e.resource_id
         WHERE e.deleted_at IS NULL AND p.deleted_at IS NULL AND r.deleted_at IS NULL;

        -- Projects.
        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_projects_ai AFTER INSERT ON outs_projects
        WHEN new.deleted_at IS NULL BEGIN
          INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
          SELECT ${PROJECT_ROW('new', 'r')} FROM outs_resources r WHERE r.id = new.resource_id AND r.deleted_at IS NULL;
        END;
        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_projects_au AFTER UPDATE ON outs_projects BEGIN
          DELETE FROM workspace_search WHERE kind = 'outs-project'
             AND entity_id = CAST(old.resource_id AS TEXT) || ':' || CAST(old.id AS TEXT);
          INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
          SELECT ${PROJECT_ROW('new', 'r')} FROM outs_resources r
           WHERE r.id = new.resource_id AND r.deleted_at IS NULL AND new.deleted_at IS NULL;
        END;
        -- A rename, delete or restore changes every entry's row of that project.
        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_projects_au_entries
        AFTER UPDATE OF name, deleted_at ON outs_projects
        WHEN old.name IS NOT new.name OR old.deleted_at IS NOT new.deleted_at BEGIN
          DELETE FROM workspace_search WHERE kind = 'outs-entry'
             AND entity_id IN (SELECT ${ENTRY_ID('x')} FROM outs_entries x WHERE x.project_id = old.id);
          INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
          SELECT ${ENTRY_ROW('e', 'new', 'r')} FROM outs_entries e JOIN outs_resources r ON r.id = e.resource_id
           WHERE e.project_id = new.id AND e.deleted_at IS NULL AND new.deleted_at IS NULL AND r.deleted_at IS NULL;
        END;
        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_projects_ad AFTER DELETE ON outs_projects BEGIN
          DELETE FROM workspace_search WHERE kind = 'outs-project'
             AND entity_id = CAST(old.resource_id AS TEXT) || ':' || CAST(old.id AS TEXT);
        END;

        -- Resources: a rename, delete or restore re-indexes its projects and entries.
        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_resources_au_children
        AFTER UPDATE OF name, deleted_at ON outs_resources
        WHEN old.name IS NOT new.name OR old.deleted_at IS NOT new.deleted_at BEGIN
          DELETE FROM workspace_search WHERE kind = 'outs-project'
             AND entity_id IN (SELECT CAST(resource_id AS TEXT) || ':' || CAST(id AS TEXT) FROM outs_projects WHERE resource_id = old.id);
          DELETE FROM workspace_search WHERE kind = 'outs-entry'
             AND entity_id IN (SELECT ${ENTRY_ID('x')} FROM outs_entries x WHERE x.resource_id = old.id);
          INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
          SELECT ${PROJECT_ROW('p', 'new')} FROM outs_projects p
           WHERE p.resource_id = new.id AND p.deleted_at IS NULL AND new.deleted_at IS NULL;
          INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
          SELECT ${ENTRY_ROW('e', 'p', 'new')} FROM outs_entries e JOIN outs_projects p ON p.id = e.project_id
           WHERE e.resource_id = new.id AND e.deleted_at IS NULL AND p.deleted_at IS NULL AND new.deleted_at IS NULL;
        END;

        -- Entries.
        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_entries_ai AFTER INSERT ON outs_entries
        WHEN new.deleted_at IS NULL BEGIN
          INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
          SELECT ${ENTRY_ROW('new', 'p', 'r')} FROM outs_projects p JOIN outs_resources r ON r.id = new.resource_id
           WHERE p.id = new.project_id AND p.deleted_at IS NULL AND r.deleted_at IS NULL;
        END;
        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_entries_au AFTER UPDATE ON outs_entries BEGIN
          DELETE FROM workspace_search WHERE kind = 'outs-entry' AND entity_id = ${ENTRY_ID('old')};
          INSERT INTO workspace_search(user_id, kind, entity_id, title, subtitle, body, updated_at)
          SELECT ${ENTRY_ROW('new', 'p', 'r')} FROM outs_projects p JOIN outs_resources r ON r.id = new.resource_id
           WHERE p.id = new.project_id AND new.deleted_at IS NULL AND p.deleted_at IS NULL AND r.deleted_at IS NULL;
        END;
        CREATE TRIGGER IF NOT EXISTS workspace_search_outs_entries_ad AFTER DELETE ON outs_entries BEGIN
          DELETE FROM workspace_search WHERE kind = 'outs-entry' AND entity_id = ${ENTRY_ID('old')};
        END;
      `);
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
