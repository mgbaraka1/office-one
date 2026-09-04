'use strict';

// Shared best-effort removal of a disposable temp tree.
//
// Every smoke test works in its own directory under the OS temp folder and
// already tries to remove it in a `finally`. That single attempt is not enough
// on Windows: any still-open node:sqlite handle keeps the database file locked,
// so rmSync throws EPERM — and because a leftover temp directory is not a test
// failure, every caller swallows the error. A full run leaked sixteen fixture
// databases that way, which is how a machine ends up with a gigabyte of them.
//
// The durable fix is layered. run-all.js gives the whole run its own temp root
// and deletes it *after* the child processes exit, by which point the OS has
// released every handle they held, so that removal cannot lose the race. This
// module is the primitive that removal and test-bootstrap.js's standalone
// fallback share.
const fs = require('node:fs');

// rmSync does not retry by default. maxRetries/retryDelay make it back off
// synchronously, which matters because the callers here run from a
// `process.on('exit')` hook where nothing asynchronous can still be awaited.
// Never throws: failing to tidy up must not turn a passing run red.
function removeTree(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    console.warn(`WARN  left ${dir} in place (${error.code || error.message})`);
  }
}

module.exports = { removeTree };
