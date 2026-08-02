'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const pkg = JSON.parse(read('package.json'));
const html = read('index.html');
const renderer = [html, ...fs.readdirSync(path.join(root, 'renderer', 'features'))
  .filter(name => name.endsWith('.js'))
  .map(name => read(path.join('renderer', 'features', name)))].join('\n');

assert.equal(pkg.name, 'timesheet', 'package name protects the production data path');
assert.match(pkg.engines?.node || '', />=24/, 'development runtime must match node:sqlite/CI');
assert.doesNotMatch(html, /script-src[^;]*'unsafe-inline'/, 'renderer scripts must not allow inline execution');
assert.doesNotMatch(renderer, /\son(?:click|change|input|submit)=/, 'inline event handlers must stay removed');
assert.match(html, /renderer\/event-delegation\.js/, 'CSP-safe event delegation must be loaded');

const release = read(path.join('.github', 'workflows', 'release.yml'));
assert.match(release, /Signed releases are mandatory/);
assert.match(release, /Get-AuthenticodeSignature/);
assert.match(release, /SHA256SUMS\.txt/);
assert.match(release, /sbom\.cdx\.json/);

console.log('PASS  runtime requirement matches CI and built-in SQLite');
console.log('PASS  CSP blocks inline script execution and markup uses delegated events');
console.log('PASS  tagged releases require valid signatures and publish checksums plus an SBOM');
