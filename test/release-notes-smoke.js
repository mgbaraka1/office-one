// ─────────────────────────────────────────────────────────────────────────────
// release-notes.json — the in-app "What's New" (Settings -> General).
//
// The notes are written by hand with each version bump, in English and Arabic.
// This suite keeps that habit honest: the version in package.json must have an
// entry, so a release can never ship with the previous version's notes; every
// entry must be well-formed; and an entry that has started an Arabic text must
// finish it, so the Arabic view never shows half a release in English.
//
// Entries for versions released before the file existed are English only
// (no `ar` anywhere) and are allowed to stay that way.
//
// Run:  node test/release-notes-smoke.js
// ─────────────────────────────────────────────────────────────────────────────

require('./test-bootstrap');

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const results = [];
function check(name, pass, details) { results.push({ name, pass, details }); }

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
let notes = null;
try { notes = JSON.parse(fs.readFileSync(path.join(root, 'release-notes.json'), 'utf8')); }
catch (err) { check('release-notes.json parses', false, err.message); }

if (notes) {
  check('release-notes.json is a non-empty list', Array.isArray(notes) && notes.length > 0, typeof notes);
  check('release-notes.json is packaged with the app',
    (pkg.build?.files || []).includes('release-notes.json'), JSON.stringify(pkg.build?.files));

  const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
  const cmp = (a, b) => {
    const x = a.match(SEMVER).slice(1).map(Number), y = b.match(SEMVER).slice(1).map(Number);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  };
  const text = t => t && typeof t.en === 'string' && t.en.trim() !== '';

  const malformed = notes.filter(n => !SEMVER.test(n.version || '') || !/^\d{4}-\d{2}-\d{2}$/.test(n.date || '')
    || !['feat', 'fix', 'other'].includes(n.kind) || !text(n.title)
    || !Array.isArray(n.notes) || !n.notes.every(text)
    || !Array.isArray(n.technical) || !n.technical.every(t => typeof t === 'string' && t.trim()));
  check('every entry has version, date, kind, an English title, and well-formed notes',
    malformed.length === 0, malformed.map(n => n.version).join(', '));

  const versions = notes.map(n => n.version).filter(v => SEMVER.test(v || ''));
  check('versions are unique', new Set(versions).size === versions.length, '');
  check('entries run newest first',
    versions.every((v, i) => i === 0 || cmp(versions[i - 1], v) > 0), '');

  check(`package.json's version (${pkg.version}) has an entry`, versions.includes(pkg.version),
    'add it to the top of release-notes.json in the same commit as the bump');

  // Bilingual entries: once any Arabic is present, all of it must be.
  const hasAr = t => t && typeof t.ar === 'string' && t.ar.trim() !== '';
  const half = notes.filter(n => {
    const parts = [n.title, ...(n.notes || [])];
    return parts.some(hasAr) && !parts.every(hasAr);
  });
  check('a bilingual entry has Arabic for its title and every note', half.length === 0,
    half.map(n => n.version).join(', '));
  const top = notes.find(n => n.version === pkg.version);
  check('the current version\'s entry is bilingual',
    !!top && hasAr(top.title) && top.notes.every(hasAr), top ? '' : 'no entry');
}

let failed = 0;
for (const r of results) {
  console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.details && !r.pass ? '  (' + r.details + ')' : ''));
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} release-notes gates passed.`);
process.exit(failed ? 1 : 0);
