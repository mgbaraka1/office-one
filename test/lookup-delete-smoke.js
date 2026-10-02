'use strict';

// Permanent delete of a Settings catalog entry (saveLookups' `deleted` list).
// An entry may be hard-deleted only while nothing uses it; this suite proves
// each refusal — in use through a foreign key, in use through a text column or
// a setting, a client — leaves the row in place and is reported as
// skipped, and that an unused entry really goes and leaves an audit row behind.
//
// Standalone: node test/lookup-delete-smoke.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const db = require('../db');

// Must run before any os.homedir()-based path is computed — see test-bootstrap.js.
require('./test-bootstrap');

const source = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one', 'cooperation-tools.db');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lookup-delete-smoke-'));
fs.copyFileSync(source, path.join(workDir, 'cooperation-tools.db'));

let failed = false;
function check(name, pass, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failed = true;
}

try {
  db.openConnection(workDir);
  db.applyMigrations();
  const user = db.getUserByUsername('fixture-user') || db.listUsers()[0];
  if (!user) throw new Error('No fixture user');

  const rows = category => db.getLookupsByCategory(category, true);
  const flags = (category, id) => db.loadLookups(user.id).categories[category].find(o => o.id === id);
  const add = (category, label) => {
    db.saveLookups(user.id, { categories: { [category]: [
      ...rows(category).map(r => ({ ...r })),
      { id: null, code: null, label, nameEn: label, nameAr: '', isActive: true },
    ] } });
    return rows(category).find(r => r.nameEn === label);
  };
  const remove = id => db.saveLookups(user.id, { deleted: [id] });

  // 1. Unused → deleted for good, with an audit row that outlives it.
  const spare = add('KNOWLEDGE_TYPE', 'Delete Me Type');
  check('a new, unused entry is reported as not in use', flags('KNOWLEDGE_TYPE', spare.id)?.inUse === false);
  const gone = remove(spare.id);
  check('an unused entry is deleted and nothing is skipped',
    gone.skipped.length === 0 && !rows('KNOWLEDGE_TYPE').some(r => r.id === spare.id), JSON.stringify(gone.skipped));
  check('the delete is recorded in the catalog history',
    db.getLookupCodeHistory(spare.id).some(h => h.fieldName === 'Deleted' && h.oldValue.includes('Delete Me Type')));
  check('the freed label can be used again', !!add('KNOWLEDGE_TYPE', 'Delete Me Type'));

  // 2. In use through a foreign key → refused, row kept, flagged for the editor.
  const used = add('KNOWLEDGE_TYPE', 'Used Type');
  const item = db.createKnowledgeItem(user.id, { title: 'Lookup delete fixture', type: used.code });
  check('an entry a record points at is flagged in use', flags('KNOWLEDGE_TYPE', used.id)?.inUse === true);
  const refused = remove(used.id);
  check('deleting an in-use entry is skipped and the row survives',
    refused.skipped.some(s => s.reason === 'in-use') && rows('KNOWLEDGE_TYPE').some(r => r.id === used.id),
    JSON.stringify(refused.skipped));
  db.deleteKnowledgeItem(user.id, item.id);
  check('once the last record is gone the entry is deletable again',
    flags('KNOWLEDGE_TYPE', used.id)?.inUse === false && remove(used.id).skipped.length === 0
      && !rows('KNOWLEDGE_TYPE').some(r => r.id === used.id));

  // 3. In use through a TEXT column (projects.status stores the code, no FK).
  const stage = add('PROJECT_STATUS', 'Lookup Delete Stage');
  db.createProject(user.id, { name: 'Lookup delete project', status: stage.code });
  check('a code stored as text counts as in use',
    flags('PROJECT_STATUS', stage.id)?.inUse === true && remove(stage.id).skipped.some(s => s.reason === 'in-use')
      && rows('PROJECT_STATUS').some(r => r.id === stage.id));

  // 4. In use by a setting (the subscriptions default currency).
  const coin = add('CURRENCY', 'Lookup Delete Coin');
  db.saveSubscriptions(user.id, { subscriptions: db.loadSubscriptions(user.id).subscriptions, defaultCurrency: coin.code });
  check('a code a setting points at counts as in use',
    flags('CURRENCY', coin.id)?.inUse === true && remove(coin.id).skipped.some(s => s.reason === 'in-use'));

  // 5. Unused is the only condition — a seeded code the app's logic names is
  //    kept while a row uses it and deletable like any other once none does.
  const seeded = rows('ENTRY_STATUS').map(r => flags('ENTRY_STATUS', r.id));
  const seededUsed = seeded.find(r => r.inUse);
  const seededFree = seeded.find(r => !r.inUse);
  check('a seeded code in use is refused', !seededUsed
    || (remove(seededUsed.id).skipped.some(s => s.reason === 'in-use') && rows('ENTRY_STATUS').some(r => r.id === seededUsed.id)),
    seededUsed ? seededUsed.code : 'skipped — fixture has no status in use');
  check('a seeded code nothing uses is deleted', !seededFree
    || (remove(seededFree.id).skipped.length === 0 && !rows('ENTRY_STATUS').some(r => r.id === seededFree.id)),
    seededFree ? seededFree.code : 'skipped — fixture uses every status');

  // 6. Clients are archived from the Clients page, never deleted through here.
  const client = rows('COMPANY')[0];
  check('a client cannot be deleted through the catalog',
    remove(client.id).skipped.some(s => s.reason === 'not-deletable') && rows('COMPANY').some(r => r.id === client.id));

  // 7. Junk in the list is ignored rather than thrown on.
  check('an unknown id is ignored', remove(987654321).skipped.length === 0 && db.saveLookups(user.id, { deleted: ['x', null] }).ok);

  const fk = db.getConnection().prepare('PRAGMA foreign_key_check').all();
  const integrity = db.getConnection().prepare('PRAGMA integrity_check').all();
  check('the database is foreign-key clean and intact afterwards',
    fk.length === 0 && integrity.length === 1 && integrity[0].integrity_check === 'ok', JSON.stringify(fk));

  db.close();
} catch (error) {
  console.error(error);
  failed = true;
  try { db.close(); } catch (_) {}
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
