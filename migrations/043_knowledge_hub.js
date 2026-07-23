// Migration 043 — Knowledge Hub.
//
// A knowledge item is a user-owned article with reusable written content,
// optional review governance, many attachments/links/tags, and optional links
// to any number of clients, systems, and projects. All additions are additive.
module.exports = {
  version: 43,
  name: 'knowledge_hub',
  up(db) {
    const now = new Date().toISOString();
    const seedExists = db.prepare("SELECT 1 FROM lookup_codes WHERE category = 'KNOWLEDGE_TYPE' AND code = ?");
    const seed = db.prepare(
      `INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at)
       VALUES('KNOWLEDGE_TYPE', ?, ?, ?, 1, ?)`
    );
    [
      ['USER_MANUAL', 'User Manual'],
      ['INTEGRATION_GUIDE', 'Integration Guide'],
      ['SOP', 'Procedure / SOP'],
      ['TROUBLESHOOTING', 'Troubleshooting'],
      ['TECHNICAL_REFERENCE', 'Technical Reference'],
      ['TEMPLATE', 'Template / Checklist'],
      ['OTHER', 'Other'],
    ].forEach(([code, label], sortOrder) => {
      if (!seedExists.get(code)) seed.run(code, label, sortOrder, now);
    });

    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_items (
        id           INTEGER PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title        TEXT NOT NULL,
        type_id      INTEGER REFERENCES lookup_codes(id),
        status       TEXT NOT NULL DEFAULT 'DRAFT',
        summary      TEXT NOT NULL DEFAULT '',
        content      TEXT NOT NULL DEFAULT '',
        review_date  TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_user_updated ON knowledge_items(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_user_status ON knowledge_items(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_review ON knowledge_items(user_id, review_date);

      CREATE TABLE IF NOT EXISTS knowledge_attachments (
        id            INTEGER PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id       INTEGER NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
        file_path     TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_size     INTEGER NOT NULL DEFAULT 0,
        mime_type     TEXT NOT NULL DEFAULT '',
        sort_order    INTEGER NOT NULL DEFAULT 0,
        uploaded_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_attachments_item ON knowledge_attachments(item_id, sort_order, id);

      CREATE TABLE IF NOT EXISTS knowledge_links (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id     INTEGER NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
        label       TEXT NOT NULL,
        url         TEXT NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_links_item ON knowledge_links(item_id, sort_order, id);

      CREATE TABLE IF NOT EXISTS knowledge_tags (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name        TEXT NOT NULL COLLATE NOCASE,
        created_at  TEXT NOT NULL,
        UNIQUE(user_id, name)
      );
      CREATE TABLE IF NOT EXISTS knowledge_item_tags (
        item_id INTEGER NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
        tag_id  INTEGER NOT NULL REFERENCES knowledge_tags(id) ON DELETE CASCADE,
        PRIMARY KEY(item_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS knowledge_item_companies (
        item_id    INTEGER NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
        company_id INTEGER NOT NULL REFERENCES lookup_codes(id),
        PRIMARY KEY(item_id, company_id)
      );
      CREATE TABLE IF NOT EXISTS knowledge_item_systems (
        item_id   INTEGER NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
        system_id INTEGER NOT NULL REFERENCES lookup_codes(id),
        PRIMARY KEY(item_id, system_id)
      );
      CREATE TABLE IF NOT EXISTS knowledge_item_projects (
        item_id    INTEGER NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        PRIMARY KEY(item_id, project_id)
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_item_companies_company ON knowledge_item_companies(company_id, item_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_item_systems_system ON knowledge_item_systems(system_id, item_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_item_projects_project ON knowledge_item_projects(project_id, item_id);
    `);
  },
};
