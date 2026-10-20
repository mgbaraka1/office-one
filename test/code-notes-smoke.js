'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Code Notes (Knowledge Hub kind CODE_NOTE, migration 078) — smoke test.
//
// Run:  node test/code-notes-smoke.js
//
// Data layer, on a disposable copy of the fixture DB: the kind is seeded, a
// Markdown note keeps its format and is found by Quick Find through the code
// inside it, a batch import creates and replaces notes, its undo removes the
// new ones and gives replaced notes their old text back (documents added since
// the import go too), the undo token belongs to its user, and blank
// suggestions come from the linked client's servers and databases only.
//
// Renderer helpers, in a bare VM with the vendored marked and highlight.js:
// blanks and their defaults, filling them in, embeds, languages, and the
// Markdown parser's wiki links and spaced fences. The DOM pass and the
// sanitizer run in the real renderer under `npm run test:e2e`.
//
// Every note, client, server and database here is made up.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
require('./test-bootstrap');
const db = require('../db');

const results = [];
function record(name, pass, details = '') { results.push({ name, pass: !!pass, details }); }

const source = path.join(os.homedir(), 'AppData', 'Roaming', 'office-one', 'cooperation-tools.db');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-notes-smoke-'));
for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, path.join(workDir, 'cooperation-tools.db' + suffix));

let exitCode = 0;
try {
  // ── Renderer helpers ──
  const ctx = vm.createContext({
    window: {
      marked: require('../renderer/vendor/marked/marked.umd.js'),
      hljs: require('../renderer/vendor/highlight/highlight.min.js'),
    },
    esc: s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  });
  // The PowerShell grammar registers itself on the page's global hljs, as in index.html.
  ctx.hljs = ctx.window.hljs;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'vendor', 'highlight', 'powershell.min.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'features', 'code-notes.js'), 'utf8'), ctx);
  const run = code => vm.runInContext(code, ctx);

  const blanks = run("codeNoteBlanks('SELECT * FROM {{db}}.dbo.Users WHERE UserName = {{ user }} AND Days > {{days:30}} -- {{db}} again')");
  record('Blanks are listed once each, in order, with their defaults',
    JSON.stringify(blanks) === JSON.stringify([{ name: 'db', fallback: '' }, { name: 'user', fallback: '' }, { name: 'days', fallback: '30' }]),
    JSON.stringify(blanks));
  const filled = run("fillCodeNoteBlanks('USE {{db}}; SELECT {{days:30}}, {{db}}, {{left}}', { db: 'Northwind_Test', days: '' })");
  record('Filling replaces every use, falls back to a default, and leaves an unknown blank alone',
    filled === 'USE Northwind_Test; SELECT 30, Northwind_Test, {{left}}', filled);
  const embeds = run("codeNoteEmbeds('See ![[Contoso Checklist.xlsx]] and ![[folder/Plan v2.pdf|plan]], not ![[Other note]] or ![[Two.md]]. ![[contoso checklist.XLSX]]')");
  record('Embeds are files only (not other notes), by base name, once each',
    JSON.stringify(embeds) === JSON.stringify(['Contoso Checklist.xlsx', 'Plan v2.pdf']), JSON.stringify(embeds));
  const langs = run("[codeNoteLanguage('sql'), codeNoteLanguage(' tsql '), codeNoteLanguage('ps1'), codeNoteLanguage('powershell'), codeNoteLanguage('nonsense'), codeNoteLanguage('')]");
  record('Languages resolve aliases, include PowerShell, and fall back to plain text',
    JSON.stringify(langs) === JSON.stringify(['sql', 'sql', 'powershell', 'powershell', '', '']), JSON.stringify(langs));
  const html = run("codeNoteParser().parse('**Set DB offline**\\n``` sql\\nALTER DATABASE {{db}} SET OFFLINE\\n```\\nSee [[Backup Steps]] and [[Indexes|the index note]], file ![[Acme Sheet.xlsx]].')");
  record('A spaced ``` sql fence is still SQL', html.includes('<code class="language-sql">'), html);
  record('[[Note]] and [[Note|label]] become note links, ![[file]] a file link',
    html.includes('<a class="cn-wikilink" href="#kh-note:Backup%20Steps">Backup Steps</a>')
    && html.includes('<a class="cn-wikilink" href="#kh-note:Indexes">the index note</a>')
    && html.includes('<a class="cn-embed" href="#kh-file:Acme%20Sheet.xlsx">Acme Sheet.xlsx</a>'), html);
  const inCode = run("codeNoteParser().parse('```\\nSELECT [[x]] FROM t\\n```')");
  record('Wiki-link syntax inside a code block stays code', !inCode.includes('cn-wikilink') && inCode.includes('[[x]]'), inCode);
  const kinds = run("[codeNoteSuggestionKind('Database_Name'), codeNoteSuggestionKind('db'), codeNoteSuggestionKind('server'), codeNoteSuggestionKind('Host_IP'), codeNoteSuggestionKind('days')]");
  record('Blank names pick database or server suggestions', JSON.stringify(kinds) === JSON.stringify(['databases', 'databases', 'servers', 'servers', '']), JSON.stringify(kinds));

  // The import asks for a tag only when a note would end up with no client, system or tag.
  const needsTag = state => run(`codeNoteImport = ${JSON.stringify(state)}; codeNoteImportNeedsTag()`);
  const newRow = { include: true, problem: '', existing: null, action: 'skip' };
  const replaceRow = existing => ({ include: true, problem: '', existing, action: 'replace' });
  record('Import needs a tag for a new note with no link, and not once it has one',
    needsTag({ tags: [], rows: [newRow] }) === true && needsTag({ tags: ['Gizmos'], rows: [newRow] }) === false);
  record('Replacing a note that already has a tag or system needs no new tag; one with none does',
    needsTag({ tags: [], rows: [replaceRow({ tags: ['Gadgets'] })] }) === false
    && needsTag({ tags: [], rows: [replaceRow({ systems: [{ id: 1 }] })] }) === false
    && needsTag({ tags: [], rows: [replaceRow({ tags: [], companies: [], systems: [] })] }) === true);
  run('codeNoteImport = null');

  // ── Data layer ──
  db.openConnection(workDir); db.applyMigrations();
  const raw = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const head = raw.prepare('SELECT MAX(version) v FROM schema_migrations').get().v;
  const user = raw.prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  raw.close();
  record('Migration 078 is applied and seeds the Code Note kind',
    head >= 78 && db.getLookupsByCategory('KNOWLEDGE_TYPE').some(x => x.code === 'CODE_NOTE' && x.nameAr === 'ملاحظة برمجية'), `head=${head}`);

  const markdown = '# Backup steps\n\n**Full backup**\n```sql\nBACKUP DATABASE {{db}} TO DISK = N\'D:\\\\Backups\\\\{{db}}.bak\'\n```\n';
  const note = db.createKnowledgeItem(user.id, { title: 'Fabrikam backup steps', type: 'CODE_NOTE', status: 'PUBLISHED', content: markdown, contentFormat: 'markdown', tags: ['SQL'] });
  record('A Code Note keeps its Markdown and its format', note.type === 'CODE_NOTE' && note.contentFormat === 'markdown' && note.content === markdown,
    JSON.stringify({ type: note.type, format: note.contentFormat }));
  const plain = db.createKnowledgeItem(user.id, { title: 'Plain smoke note', content: 'x', contentFormat: 'rtf', tags: ['Smoke'] });
  record('An unknown format is still stored as plain text', plain.contentFormat === 'text');
  record('Quick Find reaches the code inside a note', db.searchWorkspace(user.id, 'BACKUP DATABASE').some(hit => hit.kind === 'knowledge' && hit.id === note.id));

  // Import: two new notes, one replacing the note above.
  const imported = db.importCodeNotes(user.id, [
    { title: 'Contoso index check', content: '```sql\r\nSELECT 1\r\n```', replaceId: null, tags: ['SQL'] },
    { title: 'Northwind log size', content: '```sql\nDBCC SQLPERF(LOGSPACE)\n```', tags: ['SQL'] },
    { title: 'Fabrikam backup steps', content: '```sql\nSELECT 2\n```', replaceId: note.id, tags: ['SQL'] },
  ]);
  const listed = db.listKnowledgeItems(user.id);
  const first = listed.find(item => item.id === imported.ids?.[0]), replaced = db.getKnowledgeItem(user.id, note.id);
  record('Import returns one id per entry and an undo token', imported.ok && imported.ids.length === 3 && typeof imported.token === 'string' && imported.ids[2] === note.id,
    JSON.stringify(imported));
  record('Imported notes are ready Code Notes in Markdown, line endings normalised',
    first?.type === 'CODE_NOTE' && first.contentFormat === 'markdown' && first.status === 'PUBLISHED' && first.content === '```sql\nSELECT 1\n```');
  record('Replace keeps the item (title, id) and swaps its note', replaced.title === 'Fabrikam backup steps' && replaced.content === '```sql\nSELECT 2\n```');

  // A document attached to the replaced note after the import is part of the import.
  const sheet = path.join(workDir, 'Fabrikam sheet.txt'); fs.writeFileSync(sheet, 'made-up checklist');
  const upload = db.saveKnowledgeAttachment(user.id, note.id, sheet, { name: 'Fabrikam sheet', version: '1.0' });
  const uploadedPath = upload.item?.documents?.[0]?.path;
  record('An embedded file attaches to its note', upload.ok && upload.item.documents.length === 1, JSON.stringify(upload.error || ''));

  const otherId = db.createUser('code-notes-other-' + Date.now(), 'hash', false);
  const foreign = db.undoCodeNoteImport(otherId, imported.token);
  record("Another account cannot undo someone else's import", !foreign.ok && db.getKnowledgeItem(user.id, imported.ids[0]) !== null);

  const undone = db.undoCodeNoteImport(user.id, imported.token);
  const back = db.getKnowledgeItem(user.id, note.id);
  record('Undo removes the new notes', undone.ok && undone.removed === 2 && db.getKnowledgeItem(user.id, imported.ids[0]) === null && db.getKnowledgeItem(user.id, imported.ids[1]) === null,
    JSON.stringify(undone));
  record('Undo gives a replaced note its old text, kind and date back', back.content === markdown && back.type === 'CODE_NOTE' && back.updatedAt === note.updatedAt
    && back.contentFormat === 'markdown', JSON.stringify({ updatedAt: [back.updatedAt, note.updatedAt] }));
  record('Undo removes documents added since the import, file included',
    back.documents.length === 0 && uploadedPath && !fs.existsSync(path.join(workDir, uploadedPath)));
  record('The search index follows the undo', !db.searchWorkspace(user.id, 'LOGSPACE').some(hit => hit.kind === 'knowledge')
    && db.searchWorkspace(user.id, 'BACKUP DATABASE').some(hit => hit.id === note.id));
  record('An undo works once', !db.undoCodeNoteImport(user.id, imported.token).ok);

  const kept = db.importCodeNotes(user.id, [{ title: 'Kept smoke note', content: 'a', tags: ['Smoke'] }]);
  const before = db.listKnowledgeItems(user.id).length;
  const homeless = db.importCodeNotes(user.id, [{ title: 'Homeless import', content: 'a' }, { title: 'Tagged import', content: 'b', tags: ['Gizmos'] }]);
  record('Import refuses a note with no client, system or tag, and saves none of the batch',
    !homeless.ok && /add a tag/.test(homeless.error) && db.listKnowledgeItems(user.id).length === before, JSON.stringify(homeless));
  db.forgetCodeNoteImport(user.id, kept.token);
  record('Once its toast closes, an import stays', !db.undoCodeNoteImport(user.id, kept.token).ok && db.getKnowledgeItem(user.id, kept.ids[0]) !== null);
  record('Import refuses an entry with no title, and a replace target that is gone',
    !db.importCodeNotes(user.id, [{ title: '  ', content: 'x' }]).ok
    && !db.importCodeNotes(user.id, [{ title: 'Ghost', content: 'x', replaceId: 999999999 }]).ok
    && !db.listKnowledgeItems(user.id).some(item => item.title === 'Ghost'));
  record("Import cannot replace another account's note", !db.importCodeNotes(otherId, [{ title: 'Takeover', content: 'x', replaceId: note.id }]).ok
    && db.getKnowledgeItem(user.id, note.id).content === markdown);

  // Suggestions: the servers and databases of the note's linked client.
  const stamp = Date.now().toString(36).toUpperCase();
  const client = db.createClient(user.id, { code: 'CN_' + stamp, nameEn: 'Tailspin Toys ' + stamp }).client;
  const system = db.getLookupsByCategory('SYSTEM')[0];
  const server = db.createClientServer(user.id, client.id, {
    host: '10.0.0.71', hostname: 'tailspin-sql-01', environment: 'TEST', systemName: system.label, role: 'DATABASES',
  });
  const database = server?.id && db.createClientDatabase(user.id, server.id, { name: 'Tailspin_Test' });
  const linkedNote = db.createKnowledgeItem(user.id, { title: 'Tailspin queries', type: 'CODE_NOTE', content: '{{db}}', contentFormat: 'markdown', companyIds: [client.id] });
  const suggestions = db.codeNoteSuggestions(user.id, linkedNote.id);
  record('Suggestions list the linked client\'s servers and databases',
    !!database && suggestions.servers.includes('tailspin-sql-01') && suggestions.servers.includes('10.0.0.71') && suggestions.databases.includes('Tailspin_Test'),
    JSON.stringify({ server: server?.error, suggestions }));
  const unlinked = db.codeNoteSuggestions(user.id, note.id);
  record('A note with no linked client gets no suggestions', unlinked.servers.length === 0 && unlinked.databases.length === 0);
  const leak = db.codeNoteSuggestions(otherId, linkedNote.id);
  record("Another account gets nothing for someone else's note", leak.servers.length === 0 && leak.databases.length === 0);

  // Import links every note to the chosen clients and systems; undo takes back only what it added.
  const otherSystem = db.getLookupsByCategory('SYSTEM')[1];
  const preLinked = db.createKnowledgeItem(user.id, { title: 'Tailspin restore', content: 'old', systemIds: [system.id] });
  const linkedImport = db.importCodeNotes(user.id, [
    { title: 'Tailspin jobs', content: 'a', companyIds: [client.id], systemIds: [system.id, 'x', 999999999] },
    { title: 'Tailspin restore', content: 'new', replaceId: preLinked.id, companyIds: [client.id], systemIds: [system.id, otherSystem.id] },
  ]);
  const newLinked = db.getKnowledgeItem(user.id, linkedImport.ids?.[0]), replacedLinked = db.getKnowledgeItem(user.id, preLinked.id);
  const linkIds = item => JSON.stringify([(item?.companies || []).map(x => x.id), (item?.systems || []).map(x => x.id).sort()]);
  record('Import links each note to the chosen clients and systems, ignoring bad ids',
    linkedImport.ok && linkIds(newLinked) === JSON.stringify([[client.id], [system.id]])
    && linkIds(replacedLinked) === JSON.stringify([[client.id], [system.id, otherSystem.id].sort()]), linkIds(newLinked) + ' ' + linkIds(replacedLinked));
  db.undoCodeNoteImport(user.id, linkedImport.token);
  record('Undo removes the links it added and keeps the ones a note already had',
    linkIds(db.getKnowledgeItem(user.id, preLinked.id)) === JSON.stringify([[], [system.id]]), linkIds(db.getKnowledgeItem(user.id, preLinked.id)));

  // Import tags every note; a replaced note keeps its own tags, and undo takes back only the added ones.
  const preTagged = db.createKnowledgeItem(user.id, { title: 'Gadgets cleanup', content: 'old', tags: ['Gadgets'] });
  const taggedImport = db.importCodeNotes(user.id, [
    { title: 'Gadgets ps', content: 'gadgets ps', tags: ['#Gizmos', 'gadgets'] },
    { title: 'Gadgets cleanup', content: 'new', replaceId: preTagged.id, tags: ['Gizmos'] },
  ]);
  const tagsOf = id => (db.getKnowledgeItem(user.id, id)?.tags || []).join();
  record('Import tags each note, reusing an existing tag\'s spelling',
    taggedImport.ok && tagsOf(taggedImport.ids[0]) === 'Gadgets,Gizmos' && tagsOf(preTagged.id) === 'Gadgets,Gizmos',
    tagsOf(taggedImport.ids?.[0]) + ' / ' + tagsOf(preTagged.id));
  db.undoCodeNoteImport(user.id, taggedImport.token);
  record('Undo removes the tags it added and keeps the ones a note already had',
    tagsOf(preTagged.id) === 'Gadgets' && db.getKnowledgeItem(user.id, taggedImport.ids[0]) === null, tagsOf(preTagged.id));
} catch (err) { exitCode = 2; console.error('FATAL:', err); }
finally { try { db.close(); } catch {} try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} }

for (const r of results) { console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.details && !r.pass ? '  (' + r.details + ')' : ''}`); if (!r.pass) exitCode = exitCode || 1; }
console.log(`\n${results.filter(r => r.pass).length}/${results.length} Code Notes gates passed.`);
process.exit(exitCode);
