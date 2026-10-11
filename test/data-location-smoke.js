'use strict';

// data-location.js decides, before the app is ready, which folder holds the
// user's data — and whether a database may be created there. Get it wrong and
// a missing drive boots into an empty store that looks like every record has
// vanished, so each startup branch is pinned here.
//
// Run standalone with: node test/data-location-smoke.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('./test-bootstrap');

const { removeTree } = require('./temp-dir');
const loc = require('../data-location');

const results = [];
function check(name, pass, details = '') {
  results.push({ name, pass, details });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${details ? '  (' + details + ')' : ''}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-location-smoke-'));
process.on('exit', () => removeTree(root));

const file = path.join(root, 'office-one-location.json');
const withDb = path.join(root, 'with-db');
const empty = path.join(root, 'empty');
const busy = path.join(root, 'busy');
const gone = path.join(root, 'gone');
fs.mkdirSync(withDb); fs.writeFileSync(path.join(withDb, loc.DB_FILENAME), '');
fs.mkdirSync(empty);
fs.mkdirSync(busy); fs.writeFileSync(path.join(busy, 'notes.txt'), 'x');

// classifyFolder
check('a folder with the database is existing', loc.classifyFolder(withDb).kind === 'existing');
check('a database without Local State is flagged', loc.classifyFolder(withDb).hasKey === false);
fs.writeFileSync(path.join(withDb, loc.KEY_FILENAME), '{}');
check('a database with Local State has its key', loc.classifyFolder(withDb).hasKey === true);
check('an empty folder is empty', loc.classifyFolder(empty).kind === 'empty');
check('a folder with other files is not-empty', loc.classifyFolder(busy).kind === 'not-empty');
check('a missing folder is missing', loc.classifyFolder(gone).kind === 'missing');
check('a file is not a folder', loc.classifyFolder(path.join(busy, 'notes.txt')).kind === 'missing');

// readLocation / writeLocation
check('no file reads as first launch', loc.readLocation(file).reason === 'none');
loc.writeLocation(file, { dataDir: withDb });
const read = loc.readLocation(file);
check('a written location reads back', read.ok && read.location.dataDir === withDb && read.location.createNew === false);
check('no temp file is left behind', !fs.existsSync(file + '.tmp'));
let threw = false;
try { loc.writeLocation(file, { dataDir: 'relative\\dir' }); } catch { threw = true; }
check('a relative dataDir is refused', threw && loc.readLocation(file).location.dataDir === withDb);
fs.writeFileSync(file, '\uFEFF' + JSON.stringify({ dataDir: withDb }));
check('a hand-edited file with a UTF-8 BOM still reads', loc.readLocation(file).ok === true);
fs.writeFileSync(file, '{ not json');
check('garbage reads as corrupt', loc.readLocation(file).reason === 'corrupt');
fs.writeFileSync(file, JSON.stringify({ dataDir: 'relative' }));
check('a relative dataDir on disk reads as corrupt', loc.readLocation(file).reason === 'corrupt');

// resolveStartup
const resolve = (location) => {
  if (location === null) fs.rmSync(file, { force: true });
  else loc.writeLocation(file, location);
  return loc.resolveStartup({ override: '', locationFile: file });
};
const ov = loc.resolveStartup({ override: empty, locationFile: path.join(root, 'never-read.json') });
check('an override wins and may be empty', ov.mode === 'override' && ov.dataDir === empty);
const first = resolve(null);
check('first launch goes to setup with no problem', first.mode === 'setup' && first.problem === null);
const saved = resolve({ dataDir: withDb });
check('a saved folder with a database is used', saved.mode === 'saved' && saved.dataDir === withDb);
const fresh = resolve({ dataDir: empty, createNew: true });
check('a just-picked empty folder may create a database', fresh.mode === 'saved' && fresh.createNew === true);
const half = resolve({ dataDir: busy, createNew: true });
check('a new install whose first boot failed half way may retry', half.mode === 'saved' && half.createNew === true);
const emptied = resolve({ dataDir: empty, createNew: false });
check('a saved folder that lost its database is a problem, not a fresh start',
  emptied.mode === 'setup' && emptied.problem === 'no-database' && emptied.savedDir === empty);
const missing = resolve({ dataDir: gone });
check('a saved folder that is gone is a problem', missing.mode === 'setup' && missing.problem === 'missing');
const missingNew = resolve({ dataDir: gone, createNew: true });
check('createNew never resurrects a folder that is gone', missingNew.mode === 'setup' && missingNew.problem === 'missing');
check('resolving never creates the saved folder', !fs.existsSync(gone));
fs.writeFileSync(file, '{ not json');
const corrupt = loc.resolveStartup({ override: '', locationFile: file });
check('a corrupt setting is a problem, never a silent first launch', corrupt.mode === 'setup' && corrupt.problem === 'corrupt');

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} data-location checks passed.`);
if (failed.length) process.exit(1);
