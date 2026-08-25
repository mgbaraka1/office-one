'use strict';

// Runs all standalone smoke tests against a generated fixture database. Child
// tests retain their historic copy-to-temp setup, but HOME/USERPROFILE points
// at a synthetic profile, so production data is never read or copied.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const buildFixtureHome = require('./build-fixture-home');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('-smoke.js')).sort();
if (!files.length) {
  console.error('No smoke tests found in ' + dir);
  process.exit(1);
}

console.log(`Running ${files.length} test file(s): ${files.join(', ')}\n`);
const { fakeHome } = buildFixtureHome();

const bootstrap = path.join(dir, 'test-bootstrap.js');
const bootstrapOption = bootstrap.replaceAll('\\', '/');
const childEnv = {
  ...process.env,
  HOME: fakeHome,
  USERPROFILE: fakeHome,
  // Tells test-bootstrap.js (loaded below via NODE_OPTIONS, and also
  // required directly by individual smoke tests as a standalone-run safety
  // net) that HOME/USERPROFILE are already pointed at a fixture profile, so
  // it doesn't build a second, different one out from under this one.
  OFFICE_ONE_TEST_HOME: fakeHome,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${bootstrapOption}`.trim(),
};

let failed = 0;
try {
  for (const file of files) {
    console.log(`\nRunning ${file}`);
    const result = spawnSync(process.execPath, [path.join(dir, file)], { stdio: 'inherit', env: childEnv });
    if (result.status !== 0) {
      console.error(`\nFAILED: ${file} (exit code ${result.status})`);
      failed = result.status || 1;
      break;
    }
  }
} finally {
  fs.rmSync(fakeHome, { recursive: true, force: true });
}

if (failed) process.exit(failed);
console.log(`\nAll ${files.length} test file(s) passed.`);
