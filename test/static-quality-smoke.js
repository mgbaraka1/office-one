'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const pkg = JSON.parse(read('package.json'));
const html = read('index.html');
const mainJs = read('main.js');
const coreJs = read(path.join('renderer', 'core.js'));
const workspaceJs = read(path.join('renderer', 'features', 'workspace.js'));
const timesheetJs = read(path.join('renderer', 'features', 'timesheet.js'));
const appCss = read(path.join('renderer', 'app.css'));
const renderer = [html, ...fs.readdirSync(path.join(root, 'renderer', 'features'))
  .filter(name => name.endsWith('.js'))
  .map(name => read(path.join('renderer', 'features', name)))].join('\n');

// `name` is what Electron derives the per-user data folder from, so it defines
// where the production database lives. The 2026-08 rebrand moved it from
// `timesheet` to `office-one`; the pair below is the guard that the rename can
// never happen again WITHOUT the one-time carry-over that follows the data
// across — changing one without the other silently orphans every install.
assert.equal(pkg.name, 'office-one', 'package name determines the production data path');
assert.match(mainJs, /LEGACY_USER_DATA_DIRNAME = 'timesheet'/, 'the pre-rebrand data folder must still be found');
assert.match(mainJs, /migrateLegacyUserDataDir\(\);\s*\n\s*db\.openConnection\(/, 'the legacy data carry-over must run before the DB opens');
assert.match(pkg.engines?.node || '', />=24/, 'development runtime must match node:sqlite/CI');
assert.doesNotMatch(html, /script-src[^;]*'unsafe-inline'/, 'renderer scripts must not allow inline execution');
assert.doesNotMatch(renderer, /\son(?:click|change|input|submit)=/, 'inline event handlers must stay removed');
assert.match(html, /renderer\/event-delegation\.js/, 'CSP-safe event delegation must be loaded');

const release = read(path.join('.github', 'workflows', 'release.yml'));
// Signing is optional so an unsigned release can still be cut, but whenever
// credentials are present the signature must still be verified before publish.
assert.match(release, /steps\.signing\.outputs\.configured/);
assert.match(release, /Get-AuthenticodeSignature/);
assert.match(release, /SHA256SUMS\.txt/);
assert.match(release, /sbom\.cdx\.json/);

const ci = read(path.join('.github', 'workflows', 'ci.yml'));
assert.match(ci, /npm audit --omit=dev --audit-level=high/, 'CI must fail on a high/critical dependency CVE');

// A crash in either process must not fail silently with no window and no
// message (main) or with no user-visible feedback at all (renderer).
assert.match(mainJs, /process\.on\(['"]uncaughtException['"]/, 'main process must handle uncaughtException instead of dying silently');
assert.match(mainJs, /process\.on\(['"]unhandledRejection['"]/, 'main process must handle unhandledRejection instead of dying silently');
assert.match(mainJs, /webContents\.on\(['"]render-process-gone['"]/, 'the main window must recover from a crashed renderer process');
assert.match(mainJs, /win\.on\(['"]unresponsive['"]/, 'the main window must offer recovery when the renderer hangs');
assert.match(coreJs, /window\.addEventListener\(['"]error['"]/, 'the renderer must surface uncaught errors instead of failing silently');
assert.match(coreJs, /window\.addEventListener\(['"]unhandledrejection['"]/, 'the renderer must surface unhandled promise rejections instead of failing silently');

// Two processes must never be able to open the same live cooperation-tools.db
// at once.
assert.match(mainJs, /app\.requestSingleInstanceLock\(\)/, 'the app must take a single-instance lock so two processes cannot share one database');
assert.match(mainJs, /app\.on\(['"]second-instance['"]/, 'a second launch attempt must focus the existing window instead of silently doing nothing');

// Any smoke test that resolves a "production-looking" os.homedir()-based path
// must guard against being run directly (bypassing run-all.js's HOME/
// USERPROFILE redirect) with test-bootstrap.js's standalone fallback — see
// that file and build-fixture-home.js. A new smoke test that reads
// os.homedir() without this guard would read/copy the real production DB the
// moment a developer runs it standalone, exactly as their own header comments
// invite them to.
const testDir = path.join(root, 'test');
for (const name of fs.readdirSync(testDir).filter(f => f.endsWith('-smoke.js'))) {
  if (name === 'static-quality-smoke.js') continue; // this file itself, inspecting the literal string below, isn't a data-layer test
  const src = fs.readFileSync(path.join(testDir, name), 'utf8');
  if (!src.includes('os.homedir()')) continue;
  assert.match(src, /require\(['"]\.\/test-bootstrap['"]\)/,
    `${name} resolves a path via os.homedir() but never requires ./test-bootstrap — it would read/copy the real production DB if run directly`);
}

// A raw node:sqlite handle opened inside the expression that reads from it is
// never named, so nothing can close it. On Windows it then locks the database
// file for the rest of the process and the test's own temp-directory cleanup
// fails with EPERM — silently, because every caller treats a leftover temp
// directory as not-a-failure. That is what filled %TEMP% with fixture
// databases. raw-db.js's readRow() does the same read and closes the handle.
for (const name of fs.readdirSync(testDir).filter(f => f.endsWith('-smoke.js'))) {
  if (name === 'static-quality-smoke.js') continue; // this file's own literal below is not such a read
  const src = fs.readFileSync(path.join(testDir, name), 'utf8');
  assert.doesNotMatch(src, /new DatabaseSync\(.*\)\s*\.prepare\(/,
    `${name} opens a node:sqlite handle it can never close — use readRow() from ./raw-db`);
}

// The runner points every child's os.tmpdir() at one disposable root and drops
// it after the children exit, which is the only cleanup that cannot lose the
// race against a file handle the OS has not released yet.
const runAll = read(path.join('test', 'run-all.js'));
assert.match(runAll, /TEMP = tempRoot/, 'run-all.js must give the run its own temp root');
assert.match(runAll, /removeTree\(tempRoot\)/, 'run-all.js must remove that temp root after the run');

// The offscreen report/print window disables javascript at the webPreferences
// level (main.js), but the generated HTML it loads should carry its own CSP
// too, as defense in depth independent of that setting.
assert.match(workspaceJs, /http-equiv="Content-Security-Policy"/, 'the Analytics PDF export template must carry its own CSP meta tag');
assert.match(timesheetJs, /http-equiv="Content-Security-Policy"/, 'the Timesheet report/print template must carry its own CSP meta tag');

// The Analytics Time Type chart palette must be a themeable token system, not
// a mix of var() references and one-off hex literals.
for (let i = 1; i <= 6; i++) {
  assert.match(appCss, new RegExp(`--chart-${i}:`), `app.css must define --chart-${i}`);
  assert.match(workspaceJs, new RegExp(String.raw`var\(--chart-${i}\)`), `workspace.js's AN_TYPE_COLORS must use var(--chart-${i})`);
}

// Timesheet/Subscriptions/Company Docs/Clients' empty states must use the
// shared rich .empty-state pattern (promoted from Knowledge Hub's .kh-empty),
// not the old bare icon+line markup.
for (const id of ['empty-state', 'sub-empty-state', 'companydocs-empty-state', 'clients-empty-state']) {
  assert.match(html, new RegExp(`id="${id}" class="empty-state"`), `#${id} must use the shared .empty-state pattern`);
}

// Browse's Companies/Systems/Departments list-panel searches must use the
// shared .mod-search component (previously a near-duplicate .cp-search).
assert.doesNotMatch(renderer, /class="cp-search"/, 'Browse search inputs must use .mod-search, not the retired .cp-search');
for (const id of ['companies-search', 'systems-search', 'dept-search']) {
  assert.match(html, new RegExp(`id="${id}" class="mod-search"`), `#${id} must use the shared .mod-search component`);
}

console.log('PASS  runtime requirement matches CI and built-in SQLite');
console.log('PASS  CSP blocks inline script execution and markup uses delegated events');
console.log('PASS  tagged releases require valid signatures and publish checksums plus an SBOM');
console.log('PASS  CI fails on a high/critical dependency CVE');
console.log('PASS  main process and renderer both handle crashes instead of failing silently');
console.log('PASS  a single-instance lock stops two processes sharing one database');
console.log('PASS  every os.homedir()-resolving smoke test guards against a direct standalone run');
console.log('PASS  no smoke test opens an unclosable SQLite handle, and the runner cleans its own temp root');
console.log('PASS  offscreen report/print templates carry their own CSP meta tag');
console.log('PASS  Analytics chart palette uses --chart-1…--chart-6 tokens, not hardcoded hex');
console.log('PASS  Timesheet/Subscriptions/Company Docs/Clients share the promoted rich empty-state pattern');
console.log('PASS  Browse list-panel searches share the .mod-search component');
