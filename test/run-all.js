// ─────────────────────────────────────────────────────────────────────────────
// Runs every headless smoke test in this directory, in sequence, and stops at
// the first failure (nonzero exit code). Each test/*.js file is standalone
// (boots db.js directly, copies the live DB into a throwaway temp dir — see
// each file's own header comment) and safe to run against production data.
//
// Run:  node test/run-all.js   (wired up as `npm test`)
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.js') && f !== path.basename(__filename))
  .sort();

if (!files.length) {
  console.error('No test files found in ' + dir);
  process.exit(1);
}

console.log(`Running ${files.length} test file(s): ${files.join(', ')}\n`);

for (const file of files) {
  const full = path.join(dir, file);
  console.log(`\n─── ${file} ───────────────────────────────────────────────`);
  const res = spawnSync(process.execPath, [full], { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`\nFAILED: ${file} (exit code ${res.status})`);
    process.exit(res.status || 1);
  }
}

console.log(`\nAll ${files.length} test file(s) passed.`);
