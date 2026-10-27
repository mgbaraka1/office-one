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
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('knowledge_item_projects','knowledge_links')"
  ).all();
  const linkTables = raw.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('knowledge_item_companies','knowledge_item_systems')"
  ).all();
  const lookupOf = category => raw.prepare(
    "SELECT id, code, label FROM lookup_codes WHERE category = ? AND is_active = 1 AND id NOT IN (SELECT lookup_id FROM lookup_code_user_access) ORDER BY id LIMIT 2"
  ).all(category);
  const companies = lookupOf('COMPANY'), systems = lookupOf('SYSTEM');
  const itemColumns = raw.prepare('PRAGMA table_info(knowledge_items)').all().map(x => x.name);
  const attachmentColumns = raw.prepare('PRAGMA table_info(knowledge_attachments)').all().map(x => x.name);
  raw.close();
  record('Knowledge Hub groups/documents migration 045 is applied', head >= 45, `head=${head}`);
  record('Knowledge Hub content_format migration 051 is applied', head >= 51 && itemColumns.includes('content_format'), `head=${head}`);
  record('Retired project/link tables are absent', retiredTables.length === 0, JSON.stringify(retiredTables));
  record('Migration 068 brings back the client and system link tables', head >= 68 && linkTables.length === 2, JSON.stringify(linkTables));
  record('Migration 069 is applied', head >= 69, `head=${head}`);
  record('Migration 070 is applied (its is_active column is retired and unused)', head >= 70 && attachmentColumns.includes('is_active'), `head=${head}`);
  record('Document versions have a change note column', attachmentColumns.includes('change_note'));
  record('Field Mapping is a seeded document kind', db.getLookupsByCategory('KNOWLEDGE_TYPE').some(x => x.code === 'FIELD_MAPPING'));
  record('Review date is retired and document version columns exist',
    !itemColumns.includes('review_date') && attachmentColumns.includes('document_name') && attachmentColumns.includes('version_label'));
  record('Knowledge types are seeded', db.getLookupsByCategory('KNOWLEDGE_TYPE').length >= 7);

  const created = db.createKnowledgeItem(user.id, {
    title:'Claims API Integration', type:'INTEGRATION_GUIDE', status:'PUBLISHED',
    summary:'How to connect to Claims API', content:'Prerequisites\n1. Request access\n2. Configure the client',
    tags:['API','Claims','api'],
  });
  record('Create persists article fields and tags, folding a duplicate tag', created.title === 'Claims API Integration' && created.type === 'INTEGRATION_GUIDE' && created.status === 'PUBLISHED' && created.tags.join() === 'API,Claims', JSON.stringify(created.tags));

  // Tags are back (079): an item with no client or system must carry one.
  record('Migration 079 is applied', head >= 79, `head=${head}`);
  const before = db.listKnowledgeItems(user.id).length;
  let refused = null; try { db.createKnowledgeItem(user.id, { title: 'Homeless note', tags: ['  ', '#'] }); } catch (err) { refused = err; }
  record('An item with no client, system or tag is refused, and nothing is saved',
    /add a tag/.test(refused?.message || '') && db.listKnowledgeItems(user.id).length === before, String(refused?.message));
  const tagOnly = db.createKnowledgeItem(user.id, { title: 'Tag-only smoke note', content: 'grep -r', tags: ['#Gizmos', ' Shell   tools '] });
  record('A tag alone is enough; "#" and extra spaces are dropped', tagOnly.tags.join() === 'Gizmos,Shell tools', JSON.stringify(tagOnly.tags));
  const reused = db.createKnowledgeItem(user.id, { title: 'Second Gizmos note', tags: ['gizmos'] });
  record('A tag typed in another case reuses the first spelling', reused.tags.join() === 'Gizmos', JSON.stringify(reused.tags));
  record('The list index carries tags', db.listKnowledgeItems(user.id).find(item => item.id === tagOnly.id)?.tags.join() === 'Gizmos,Shell tools');
  const tagHit = db.searchWorkspace(user.id, 'Shell tools').find(hit => hit.kind === 'knowledge' && hit.id === tagOnly.id);
  record('Quick Find finds an item by its tag and shows its tags when it has no client or system',
    tagHit?.subtitle === '#Gizmos · #Shell tools', JSON.stringify(tagHit));
  let emptied = null; try { db.updateKnowledgeItem(user.id, tagOnly.id, { ...tagOnly, tags: [] }); } catch (err) { emptied = err; }
  record('Removing the last tag of an unlinked item is refused and keeps the tags',
    !!emptied && db.getKnowledgeItem(user.id, tagOnly.id).tags.length === 2);
  const archivedTagOnly = db.updateKnowledgeItem(user.id, tagOnly.id, { title: tagOnly.title, status: 'ARCHIVED' });
  record('An update that does not send tags keeps them', archivedTagOnly.status === 'ARCHIVED' && archivedTagOnly.tags.length === 2);
  const retagged = db.updateKnowledgeItem(user.id, tagOnly.id, { ...archivedTagOnly, tags: ['Gadgets'] });
  record('Changing tags re-indexes Quick Find',
    db.searchWorkspace(user.id, 'Gadgets').some(hit => hit.id === retagged.id) && !db.searchWorkspace(user.id, 'Shell tools').some(hit => hit.id === retagged.id));
  db.deleteKnowledgeItem(user.id, tagOnly.id); db.deleteKnowledgeItem(user.id, reused.id);
  record('Knowledge item exposes client and system links but no project links',
    Array.isArray(created.companies) && Array.isArray(created.systems) && !Object.hasOwn(created, 'projects'));

  // Clients / systems (migration 068).
  const linked = db.createKnowledgeItem(user.id, {
    title: 'Linked Mapping Sheet', type: 'FIELD_MAPPING', status: 'PUBLISHED',
    companyIds: [companies[0].id, companies[0].id, systems[0].id, 999999999], systemIds: [systems[0].id, companies[0].id],
  });
  record('Create links clients and systems, skipping duplicates and wrong-category ids',
    linked.companies.map(x => x.id).join() === String(companies[0].id) && linked.systems.map(x => x.id).join() === String(systems[0].id),
    JSON.stringify({ companies: linked.companies, systems: linked.systems }));
  const statusOnly = db.updateKnowledgeItem(user.id, linked.id, { title: linked.title, type: linked.type, status: 'ARCHIVED', tags: [] });
  record('An update that does not send links keeps them', statusOnly.companies.length === 1 && statusOnly.systems.length === 1);
  const listed = db.listKnowledgeItems(user.id).find(item => item.id === linked.id);
  record('The list index carries client and system links',
    listed.companies[0]?.id === companies[0].id && listed.systems[0]?.id === systems[0].id && typeof listed.companies[0].nameEn === 'string');
  const searchable = db.searchWorkspace(user.id, companies[0].code);
  record('Quick Find finds an item by its client code', searchable.some(hit => hit.kind === 'knowledge' && hit.id === linked.id),
    JSON.stringify(searchable.slice(0, 3)));
  record('The Quick Find subtitle names the client and system',
    searchable.find(hit => hit.kind === 'knowledge' && hit.id === linked.id)?.subtitle.includes(' · '));
  const cleared = db.updateKnowledgeItem(user.id, linked.id, { ...statusOnly, companyIds: [], systemIds: [systems[1]?.id].filter(Boolean), tags: ['Mapping'] });
  record('Sending links replaces them', cleared.companies.length === 0 && cleared.systems.length === (systems[1] ? 1 : 0));
  record('Unlinking a client drops it from Quick Find',
    !db.searchWorkspace(user.id, companies[0].code).some(hit => hit.kind === 'knowledge' && hit.id === linked.id));
  const relinked = db.updateKnowledgeItem(user.id, linked.id, { ...cleared, companyIds: [companies[0].id] });
  const linkedDeleted = db.deleteKnowledgeItem(user.id, linked.id);
  const linkedRestored = db.restoreKnowledgeItem(user.id, linked.id, linkedDeleted.snapshot);
  record('Delete undo restores client and system links',
    linkedRestored.ok && linkedRestored.item.companies[0]?.id === companies[0].id
      && linkedRestored.item.systems.map(x => x.id).join() === relinked.systems.map(x => x.id).join());

  // One optional project, only of a linked client (migration 081).
  const columns081 = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'), { readOnly: true });
  const has081Column = columns081.prepare('PRAGMA table_info(knowledge_items)').all().some(c => c.name === 'project_id');
  const projectDocsGone = !columns081.prepare("SELECT 1 FROM sqlite_master WHERE name = 'project_documents'").get();
  columns081.close();
  record('Migration 081 adds knowledge_items.project_id and drops the empty project_documents',
    head >= 81 && has081Column && projectDocsGone, `head=${head}`);
  const onClient = db.createProject(user.id, { name: 'KH smoke project', companyIds: [companies[0].id] });
  const offClient = db.createProject(user.id, { name: 'KH smoke bare project', companyIds: [] });
  const withProject = db.createKnowledgeItem(user.id, { title: 'KH project note', companyIds: [companies[0].id], projectId: onClient.id });
  record('An item links to a project of its client', withProject.projectId === onClient.id && withProject.projectName === 'KH smoke project');
  const listedProject = db.listKnowledgeItems(user.id).find(item => item.id === withProject.id);
  record('The list index carries the project', listedProject?.projectId === onClient.id && listedProject.projectName === 'KH smoke project');
  const countBefore = db.listKnowledgeItems(user.id).length;
  let offRefused = null; try { db.createKnowledgeItem(user.id, { title: 'KH off-client note', companyIds: [companies[0].id], projectId: offClient.id }); } catch (err) { offRefused = err; }
  let missingRefused = null; try { db.createKnowledgeItem(user.id, { title: 'KH missing project', companyIds: [companies[0].id], projectId: 999999999 }); } catch (err) { missingRefused = err; }
  let noClientRefused = null; try { db.createKnowledgeItem(user.id, { title: 'KH no client', tags: ['x'], projectId: onClient.id }); } catch (err) { noClientRefused = err; }
  record('A project off the clients, unknown, or with no client chosen is refused, and nothing is saved',
    /linked clients/.test(offRefused?.message || '') && /not found/.test(missingRefused?.message || '') && /linked clients/.test(noClientRefused?.message || '')
      && db.listKnowledgeItems(user.id).length === countBefore, String(offRefused?.message));
  let unlinkRefused = null; try { db.updateKnowledgeItem(user.id, withProject.id, { ...withProject, companyIds: [], tags: ['x'] }); } catch (err) { unlinkRefused = err; }
  record('Removing the project\'s client while keeping the project is refused',
    !!unlinkRefused && db.getKnowledgeItem(user.id, withProject.id).companies.length === 1);
  // A project has one client, fixed at creation: an update cannot change it.
  const projectEdited = db.updateProject(user.id, onClient.id, { name: 'KH smoke project', companyIds: [] });
  record('Editing a project keeps its one client', projectEdited.companies.map(c => c.id).join() === String(companies[0].id));
  if (companies[1]) {
    let twoRefused = null; try { db.createProject(user.id, { name: 'KH two clients', companyIds: [companies[0].id, companies[1].id] }); } catch (err) { twoRefused = err; }
    record('A project with two clients is refused', /one client/.test(twoRefused?.message || '')
      && !db.listProjects(user.id).some(p => p.name === 'KH two clients'));
  }
  const statusOnlyProject = db.updateKnowledgeItem(user.id, withProject.id, { title: withProject.title, status: 'ARCHIVED' });
  record('A status-only update keeps the project', statusOnlyProject.status === 'ARCHIVED' && statusOnlyProject.projectId === onClient.id);
  const itemDeleted = db.deleteKnowledgeItem(user.id, withProject.id);
  const itemRestored = db.restoreKnowledgeItem(user.id, withProject.id, itemDeleted.snapshot);
  record('Delete undo keeps the project', itemRestored.ok && itemRestored.item.projectId === onClient.id);
  const projectItemId = itemRestored.item.id;
  db.deleteProject(user.id, onClient.id);
  const afterProjectDelete = db.getKnowledgeItem(user.id, projectItemId);
  const recreated = db.createProject(user.id, { name: 'KH smoke project', companyIds: [companies[0].id] });
  const relinkedCount = db.relinkKnowledgeProject(user.id, recreated.id, [projectItemId]);
  db.restoreProjectFiles(user.id, onClient.id, recreated.id);
  record('Deleting the project unlinks the item; undo links it again',
    afterProjectDelete.projectId === null && relinkedCount.ok && relinkedCount.count === 1
      && db.getKnowledgeItem(user.id, projectItemId).projectId === recreated.id, JSON.stringify(relinkedCount));
  const projectCleared = db.updateKnowledgeItem(user.id, projectItemId, { ...db.getKnowledgeItem(user.id, projectItemId), companyIds: [companies[0].id], projectId: null });
  record('Sending no project clears it', projectCleared.projectId === null && projectCleared.projectName === '');
  db.deleteKnowledgeItem(user.id, projectItemId);
  db.deleteProject(user.id, recreated.id); db.deleteProject(user.id, offClient.id);

  if (companies[1]) {
    const merged = db.mergeLookupDuplicate('COMPANY', companies[1].id, companies[0].id);
    const afterMerge = db.getKnowledgeItem(user.id, linkedRestored.item.id);
    record('Merging a client repoints its knowledge links', merged.ok && afterMerge.companies.map(x => x.id).join() === String(companies[1].id),
      JSON.stringify({ merged, companies: afterMerge.companies }));
  }
  db.deleteKnowledgeItem(user.id, linkedRestored.item.id);
  record('Reference links and review dates are absent from the API',
    !Object.hasOwn(created, 'links') && !Object.hasOwn(created, 'reviewDate'));
  record('Create without contentFormat defaults to legacy text', created.contentFormat === 'text');

  const htmlItem = db.createKnowledgeItem(user.id, {
    title:'Rich Text Article', status:'DRAFT', content:'<p>Hello <strong>world</strong></p>', contentFormat:'html', tags:['Legacy'],
  });
  record('Create with contentFormat html round-trips', htmlItem.contentFormat === 'html' && htmlItem.content.includes('<strong>world</strong>'));
  record('List index also reports contentFormat', db.listKnowledgeItems(user.id).find(item => item.id === htmlItem.id)?.contentFormat === 'html');
  const htmlItemStatusOnly = db.updateKnowledgeItem(user.id, htmlItem.id, { title: htmlItem.title, status: 'PUBLISHED', content: htmlItem.content, contentFormat: htmlItem.contentFormat });
  record('A status-only update that still passes contentFormat does not silently downgrade it to text', htmlItemStatusOnly.contentFormat === 'html');
  db.deleteKnowledgeItem(user.id, htmlItem.id);

  const updated = db.updateKnowledgeItem(user.id, created.id, { ...created, title:'Claims API Integration v2', status:'DRAFT', tags:['Deployment'] });
  record('Update replaces the profile and the tags', updated.title.endsWith('v2') && updated.status === 'DRAFT' && updated.tags.join() === 'Deployment');
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
  const uploaded = db.saveKnowledgeAttachment(user.id, created.id, pdf, { name:'Claims Integration Manual', version:'2.4', changeNote:'  Added the claims fields\r\nfrom the vendor  ' });
  const file = uploaded.item?.documents?.[0];
  record('Upload keeps the "what changed" note, trimmed with line breaks normalised',
    file?.changeNote === 'Added the claims fields\nfrom the vendor', JSON.stringify(file?.changeNote));
  record('Document upload records name and version with validated bytes',
    uploaded.ok && file?.name === 'Claims Integration Manual' && file?.version === '2.4' && file.exists && fs.existsSync(path.join(workDir, file.path)), JSON.stringify(file));
  const listIndexItem = db.listKnowledgeItems(user.id).find(item => item.id === created.id);
  record('Knowledge list uses a lightweight document index while preserving search metadata',
    listIndexItem.documentCount === 1 && listIndexItem.documents[0]?.name === 'Claims Integration Manual'
      && !Object.hasOwn(listIndexItem.documents[0], 'path') && listIndexItem.content.includes('Prerequisites')
      && listIndexItem.documents[0].changeNote.includes('claims fields'),
    JSON.stringify(listIndexItem.documents));
  const duplicateVersion = db.saveKnowledgeAttachment(user.id, created.id, pdf, { name:' claims integration manual ', version:'2.4' });
  record('Duplicate document name/version is rejected case-insensitively',
    duplicateVersion.ok === false && duplicateVersion.error.includes('already exists')
      && db.getKnowledgeItem(user.id, created.id).documents.length === 1,
    JSON.stringify(duplicateVersion));
  const deck = path.join(workDir, 'status.pptx'); fs.writeFileSync(deck, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
  const fakeDeck = path.join(workDir, 'fake.pptx'); fs.writeFileSync(fakeDeck, 'not a zip');
  const deckItem = db.createKnowledgeItem(user.id, { title:'Status deck note', tags:['Decks'] });
  const deckRes = db.saveKnowledgeAttachment(user.id, deckItem.id, deck, { name:'Status deck', version:'1.0' });
  const fakeDeckRes = db.saveKnowledgeAttachment(user.id, deckItem.id, fakeDeck, { name:'Fake deck', version:'1.0' });
  record('Knowledge Hub takes a .pptx, and refuses one whose contents are not a .pptx',
    deckRes.ok && deckRes.item.documents[0]?.mimeType?.includes('presentation')
      && fakeDeckRes.ok === false && fakeDeckRes.error.includes('do not match'),
    JSON.stringify({ deck: deckRes.ok, fake: fakeDeckRes }));
  const resolved = db.resolveKnowledgeAttachment(user.id, file.id);
  record('Attachment resolve is owner-scoped and points to an existing file', resolved.ok && resolved.exists && resolved.absPath.startsWith(workDir));
  const removed = db.removeKnowledgeAttachment(user.id, file.id);
  record('Document removal keeps bytes available for undo', removed.ok && removed.item.documents.length === 0 && fs.existsSync(path.join(workDir, removed.removedFile.path)));
  const restoredAttachment = db.restoreKnowledgeAttachment(user.id, created.id, removed.removedFile);
  record('Document undo restores version metadata', restoredAttachment.ok && restoredAttachment.item.documents[0]?.version === '2.4'
    && restoredAttachment.item.documents[0]?.changeNote === 'Added the claims fields\nfrom the vendor');
  const restoredFileId = restoredAttachment.item.documents[0].id;
  const noteEdited = db.updateKnowledgeAttachmentNote(user.id, restoredFileId, 'Mapped 12 new fields');
  record('A version note can be edited later', noteEdited.ok && noteEdited.item.documents[0].changeNote === 'Mapped 12 new fields');
  record('Quick Find reaches an edited version note (migration 069)',
    db.searchWorkspace(user.id, 'Mapped 12 new fields').some(hit => hit.kind === 'knowledge' && hit.id === created.id));
  const noteCapped = db.updateKnowledgeAttachmentNote(user.id, restoredFileId, 'x'.repeat(5000));
  record('A version note is capped at 1000 characters', noteCapped.ok && noteCapped.item.documents[0].changeNote.length === 1000);
  db.updateKnowledgeAttachmentNote(user.id, restoredFileId, 'Mapped 12 new fields');

  const otherId = db.createUser('knowledge-other-' + Date.now(), 'hash', false);
  record('Another user cannot enumerate or fetch the first user\'s knowledge', db.listKnowledgeItems(otherId).length === 0 && db.getKnowledgeItem(otherId, created.id) === null);
  record('Another user cannot resolve the document by guessed id', db.resolveKnowledgeAttachment(otherId, restoredAttachment.item.documents[0].id).ok === false);
  record('Another user cannot enumerate the first user\'s groups', db.listKnowledgeGroups(otherId).length === 0);
  record('Another user cannot edit a version note',
    db.updateKnowledgeAttachmentNote(otherId, restoredFileId, 'hijack').ok === false
      && db.getKnowledgeItem(user.id, created.id).documents[0].changeNote === 'Mapped 12 new fields');

  const deleted = db.deleteKnowledgeItem(user.id, created.id);
  record('Delete removes the row but retains its file during undo window', deleted.ok && db.getKnowledgeItem(user.id, created.id) === null && fs.existsSync(path.join(workDir, deleted.snapshot.documents[0].path)));
  const restored = db.restoreKnowledgeItem(user.id, created.id, deleted.snapshot);
  record('Delete undo restores article, tags, group, and versioned document', restored.ok && restored.item.title.endsWith('v2') && restored.item.tags.join() === 'Deployment' && restored.item.groups[0]?.name === 'API Playbooks' && restored.item.documents[0]?.version === '2.4' && restored.item.documents[0].exists
    && restored.item.documents[0].changeNote === 'Mapped 12 new fields'
    && !Object.hasOwn(restored.item.documents[0], 'isActive'));

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
