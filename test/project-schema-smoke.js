'use strict';

// Final-state regression gates for migration 042 and project CRUD.
// SAFETY: the shared test runner points HOME/USERPROFILE at a disposable fixture;
// standalone execution copies that fixture database into a temporary directory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db');

const results = [];
function record(name, pass, details = '') { results.push({ name, pass: !!pass, details }); }

// Guards against reading/copying the REAL production DB when this file is
// run directly (node test/<this file>) instead of via run-all.js — see
// test-bootstrap.js.
require('./test-bootstrap');

const sourceDir = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one');
const sourceDb = path.join(sourceDir, 'cooperation-tools.db');
if (!fs.existsSync(sourceDb)) {
  console.error('FATAL: fixture DB not found at ' + sourceDb);
  process.exit(2);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-schema-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = sourceDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}

// Recreate the immediately-pre-042 shape inside the disposable copy so this
// test exercises the migration itself even when the shared fixture is at head.
let beforeCounts;
{
  const prep = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  beforeCounts = Object.fromEntries(['projects', 'tasks', 'project_companies', 'project_systems', 'project_documents']
    .map(table => [table, prep.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
  const columns = new Set(prep.prepare('PRAGMA table_info(projects)').all().map(c => c.name));
  if (!columns.has('category_id')) prep.exec('ALTER TABLE projects ADD COLUMN category_id INTEGER REFERENCES lookup_codes(id)');
  if (!columns.has('related_project_id')) prep.exec('ALTER TABLE projects ADD COLUMN related_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
  prep.exec('CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category_id)');
  prep.exec('CREATE INDEX IF NOT EXISTS idx_projects_related ON projects(related_project_id)');
  const now = new Date().toISOString();
  prep.prepare(
    `INSERT OR IGNORE INTO lookup_codes(category, code, label, sort_order, is_active, created_at)
     VALUES('PROJECT_CATEGORY', ?, ?, ?, 1, ?)`
  ).run('NEW_PROJECT', 'New Project', 0, now);
  // Rewind only 042. Later Knowledge Hub migrations are already reflected in
  // this copied schema (045 removes review_date), so replaying historical 043
  // against that newer shape would incorrectly recreate its retired index.
  prep.prepare('DELETE FROM schema_migrations WHERE version = 42').run();
  prep.close();
}

let exitCode = 0;
try {
  db.openConnection(workDir);
  db.applyMigrations();

  const raw = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const columns = raw.prepare('PRAGMA table_info(projects)').all().map(c => c.name);
  const retiredLookups = raw.prepare("SELECT COUNT(*) AS n FROM lookup_codes WHERE category = 'PROJECT_CATEGORY'").get().n;
  const head = raw.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version;
  const user = raw.prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  const afterCounts = Object.fromEntries(Object.keys(beforeCounts)
    .map(table => [table, raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
  const fkViolations = raw.prepare('PRAGMA foreign_key_check').all();
  raw.close();

  record('Migration head includes project schema cleanup', head >= 42, `head=${head}`);
  const migrationBackups = fs.existsSync(path.join(workDir, 'pre-migration-backup'))
    ? fs.readdirSync(path.join(workDir, 'pre-migration-backup')).filter(n => n.includes('PRE-MIGRATION-42-'))
    : [];
  record('Destructive migration creates a pre-migration snapshot', migrationBackups.length === 1,
    `backups=${migrationBackups.length}`);
  if (migrationBackups.length === 1) {
    const snapshot = new DatabaseSync(path.join(workDir, 'pre-migration-backup', migrationBackups[0]), { readOnly: true });
    const snapshotColumns = snapshot.prepare('PRAGMA table_info(projects)').all().map(c => c.name);
    const snapshotHead = snapshot.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version;
    const snapshotHas42 = !!snapshot.prepare('SELECT 1 FROM schema_migrations WHERE version = 42').get();
    const snapshotIntegrity = snapshot.prepare('PRAGMA integrity_check').get().integrity_check;
    snapshot.close();
    record('Pre-migration snapshot is intact and restorable', !snapshotHas42
      && snapshotColumns.includes('category_id') && snapshotColumns.includes('related_project_id')
      && snapshotIntegrity === 'ok',
    `head=${snapshotHead} integrity=${snapshotIntegrity}`);
  }
  record('Retired project columns are absent',
    !columns.includes('category_id') && !columns.includes('related_project_id'),
    `columns=${columns.join(',')}`);
  record('Retired project lookup rows are deleted', retiredLookups === 0, `rows=${retiredLookups}`);
  record('Migration preserves projects and every dependent row',
    JSON.stringify(afterCounts) === JSON.stringify(beforeCounts),
    `before=${JSON.stringify(beforeCounts)} after=${JSON.stringify(afterCounts)}`);
  record('Migrated schema is foreign-key clean', fkViolations.length === 0,
    `violations=${fkViolations.length}`);

  if (!user) throw new Error('no active fixture user');
  const created = db.createProject(user.id, {
    name: 'Project schema smoke', description: 'plain project', status: 'ACTIVE',
    companyIds: [], systemIds: [],
  });
  const listed = db.listProjects(user.id).find(p => p.id === created.id);
  const fetched = db.getProject(user.id, created.id);
  record('Project create/list/get work without retired fields', !!created && !!listed && !!fetched
    && !Object.hasOwn(created, 'category') && !Object.hasOwn(created, 'relatedProjectId')
    && !Object.hasOwn(listed, 'category') && !Object.hasOwn(fetched, 'relatedProjectId'));

  const updated = db.updateProject(user.id, created.id, {
    name: 'Project schema smoke updated', description: 'updated', status: 'COMPLETED',
    companyIds: [], systemIds: [],
  });
  record('Project update works with the reduced schema',
    updated?.name === 'Project schema smoke updated' && updated?.status === 'COMPLETED');
} catch (err) {
  exitCode = 1;
  console.error('FATAL:', err);
} finally {
  try { db.close(); } catch { /* best effort */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.details ? ` (${r.details})` : ''}`);
  if (!r.pass) exitCode = 1;
}
if (!exitCode) console.log('\nALL GREEN');
process.exit(exitCode);
