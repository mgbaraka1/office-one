'use strict';

// Knowledge Hub data/file/isolation smoke test. The shared runner redirects the
// profile to a disposable fixture; this test copies that DB again before writes.
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

const source = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one', 'cooperation-tools.db');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-smoke-'));
for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, path.join(workDir, 'cooperation-tools.db' + suffix));

let exitCode = 0;
try {
  db.openConnection(workDir); db.applyMigrations();
  const raw = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const user = raw.prepare('SELECT id FROM users WHERE is_active=1 ORDER BY id LIMIT 1').get();
  const head = raw.prepare('SELECT MAX(version) v FROM schema_migrations').get().v;
  const retiredTables = raw.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('knowledge_item_companies','knowledge_item_systems','knowledge_item_projects','knowledge_links')"
  ).all();
  const itemColumns = raw.prepare('PRAGMA table_info(knowledge_items)').all().map(x => x.name);
  const attachmentColumns = raw.prepare('PRAGMA table_info(knowledge_attachments)').all().map(x => x.name);
  raw.close();
  record('Knowledge Hub groups/documents migration 045 is applied', head >= 45, `head=${head}`);
  record('Knowledge Hub content_format migration 051 is applied', head >= 51 && itemColumns.includes('content_format'), `head=${head}`);
  record('Retired domain/link tables are absent', retiredTables.length === 0, JSON.stringify(retiredTables));
  record('Review date is retired and document version columns exist',
    !itemColumns.includes('review_date') && attachmentColumns.includes('document_name') && attachmentColumns.includes('version_label'));
  record('Knowledge types are seeded', db.getLookupsByCategory('KNOWLEDGE_TYPE').length >= 7);

  const created = db.createKnowledgeItem(user.id, {
    title:'Claims API Integration', type:'INTEGRATION_GUIDE', status:'PUBLISHED',
    summary:'How to connect to Claims API', content:'Prerequisites\n1. Request access\n2. Configure the client',
    tags:['API','Claims','api'],
  });
  record('Create persists article fields and normalizes duplicate tags', created.title === 'Claims API Integration' && created.type === 'INTEGRATION_GUIDE' && created.status === 'PUBLISHED' && created.tags.length === 2, JSON.stringify(created.tags));
  record('Knowledge item is generic and exposes no domain relationship fields',
    !Object.hasOwn(created, 'companies') && !Object.hasOwn(created, 'systems') && !Object.hasOwn(created, 'projects'));
  record('Reference links and review dates are absent from the API',
    !Object.hasOwn(created, 'links') && !Object.hasOwn(created, 'reviewDate'));
  record('Create without contentFormat defaults to legacy text', created.contentFormat === 'text');

  const htmlItem = db.createKnowledgeItem(user.id, {
    title:'Rich Text Article', status:'DRAFT', content:'<p>Hello <strong>world</strong></p>', contentFormat:'html',
  });
  record('Create with contentFormat html round-trips', htmlItem.contentFormat === 'html' && htmlItem.content.includes('<strong>world</strong>'));
  record('List index also reports contentFormat', db.listKnowledgeItems(user.id).find(item => item.id === htmlItem.id)?.contentFormat === 'html');
  const htmlItemStatusOnly = db.updateKnowledgeItem(user.id, htmlItem.id, { title: htmlItem.title, status: 'PUBLISHED', content: htmlItem.content, contentFormat: htmlItem.contentFormat });
  record('A status-only update that still passes contentFormat does not silently downgrade it to text', htmlItemStatusOnly.contentFormat === 'html');
  db.deleteKnowledgeItem(user.id, htmlItem.id);

  const updated = db.updateKnowledgeItem(user.id, created.id, { ...created, title:'Claims API Integration v2', status:'DRAFT', tags:['Deployment'] });
  record('Update replaces profile and tag collection', updated.title.endsWith('v2') && updated.status === 'DRAFT' && updated.tags.join() === 'Deployment');
  record('Update without contentFormat defaults to text (matches legacy plain-text save path)', updated.contentFormat === 'text');

  const group = db.createKnowledgeGroup(user.id, { name:'API Playbooks', description:'Reusable integration material', itemIds:[created.id] });
  record('Group creation includes selected items', group.name === 'API Playbooks' && group.itemIds.join() === String(created.id));
  record('Knowledge items expose their groups', db.getKnowledgeItem(user.id, created.id).groups[0]?.id === group.id);
  const secondaryGroup = db.createKnowledgeGroup(user.id, { name:'Release Readiness', description:'Ready-to-ship references', itemIds:[] });
  const movedByItemEditor = db.updateKnowledgeItem(user.id, created.id, {
    ...db.getKnowledgeItem(user.id, created.id), groupIds:[secondaryGroup.id],
  });
  record('Item update can replace group membership directly',
    movedByItemEditor.groups.length === 1 && movedByItemEditor.groups[0].id === secondaryGroup.id
      && !db.listKnowledgeGroups(user.id).find(x => x.id === group.id).itemIds.includes(created.id));
  db.updateKnowledgeItem(user.id, created.id, { ...movedByItemEditor, groupIds:[group.id] });

  const pdf = path.join(workDir, 'manual.pdf'); fs.writeFileSync(pdf, '%PDF-1.4\nKnowledge smoke file\n%%EOF');
  const uploaded = db.saveKnowledgeAttachment(user.id, created.id, pdf, { name:'Claims Integration Manual', version:'2.4' });
  const file = uploaded.item?.documents?.[0];
  record('Document upload records name and version with validated bytes',
    uploaded.ok && file?.name === 'Claims Integration Manual' && file?.version === '2.4' && file.exists && fs.existsSync(path.join(workDir, file.path)), JSON.stringify(file));
  const listIndexItem = db.listKnowledgeItems(user.id).find(item => item.id === created.id);
  record('Knowledge list uses a lightweight document index while preserving search metadata',
    listIndexItem.documentCount === 1 && listIndexItem.documents[0]?.name === 'Claims Integration Manual'
      && !Object.hasOwn(listIndexItem.documents[0], 'path') && listIndexItem.content.includes('Prerequisites'),
    JSON.stringify(listIndexItem.documents));
  const duplicateVersion = db.saveKnowledgeAttachment(user.id, created.id, pdf, { name:' claims integration manual ', version:'2.4' });
  record('Duplicate document name/version is rejected case-insensitively',
    duplicateVersion.ok === false && duplicateVersion.error.includes('already exists')
      && db.getKnowledgeItem(user.id, created.id).documents.length === 1,
    JSON.stringify(duplicateVersion));
  const resolved = db.resolveKnowledgeAttachment(user.id, file.id);
  record('Attachment resolve is owner-scoped and points to an existing file', resolved.ok && resolved.exists && resolved.absPath.startsWith(workDir));
  const removed = db.removeKnowledgeAttachment(user.id, file.id);
  record('Document removal keeps bytes available for undo', removed.ok && removed.item.documents.length === 0 && fs.existsSync(path.join(workDir, removed.removedFile.path)));
  const restoredAttachment = db.restoreKnowledgeAttachment(user.id, created.id, removed.removedFile);
  record('Document undo restores version metadata', restoredAttachment.ok && restoredAttachment.item.documents[0]?.version === '2.4');

  const otherId = db.createUser('knowledge-other-' + Date.now(), 'hash', false);
  record('Another user cannot enumerate or fetch the first user\'s knowledge', db.listKnowledgeItems(otherId).length === 0 && db.getKnowledgeItem(otherId, created.id) === null);
  record('Another user cannot resolve the document by guessed id', db.resolveKnowledgeAttachment(otherId, restoredAttachment.item.documents[0].id).ok === false);
  record('Another user cannot enumerate the first user\'s groups', db.listKnowledgeGroups(otherId).length === 0);

  const deleted = db.deleteKnowledgeItem(user.id, created.id);
  record('Delete removes the row but retains its file during undo window', deleted.ok && db.getKnowledgeItem(user.id, created.id) === null && fs.existsSync(path.join(workDir, deleted.snapshot.documents[0].path)));
  const restored = db.restoreKnowledgeItem(user.id, created.id, deleted.snapshot);
  record('Delete undo restores article, tags, group, and versioned document', restored.ok && restored.item.title.endsWith('v2') && restored.item.tags.join() === 'Deployment' && restored.item.groups[0]?.name === 'API Playbooks' && restored.item.documents[0]?.version === '2.4' && restored.item.documents[0].exists);

  const deletedAgain = db.deleteKnowledgeItem(user.id, restored.item.id);
  const purged = db.purgeKnowledgeFiles(user.id, restored.item.id);
  record('Expired undo purges the item file folder', deletedAgain.ok && purged.ok && !fs.existsSync(path.join(db.knowledgeRootDir(), String(restored.item.id))));

  fs.mkdirSync(path.join(db.knowledgeRootDir(), '999999'), { recursive:true });
  db.runMaintenance();
  record('Maintenance removes orphan Knowledge Hub folders', !fs.existsSync(path.join(db.knowledgeRootDir(), '999999')));
} catch (err) { exitCode = 2; console.error('FATAL:', err); }
finally { try { db.close(); } catch {} try { fs.rmSync(workDir, { recursive:true, force:true }); } catch {} }

for (const r of results) { console.log(`${r.pass?'PASS':'FAIL'}  ${r.name}${r.details?'  ('+r.details+')':''}`); if(!r.pass)exitCode=1; }
if (!exitCode) console.log('\nALL GREEN');
process.exit(exitCode);
