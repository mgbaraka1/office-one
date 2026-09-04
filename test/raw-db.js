'use strict';

// Reading one row straight off the database file, without going through db.js,
// is how several smoke tests prove what was actually *stored* rather than what
// the API returned. Written inline as
// `new DatabaseSync(file).prepare(sql).get()` that read never names its handle,
// so nothing can ever close it — and on Windows the open handle locks the file
// for the rest of the process, making the test's own temp-directory cleanup
// fail with EPERM. Silently, because a leftover temp directory is not a test
// failure. Use readRow() instead; it closes the handle before returning.
const { DatabaseSync } = require('node:sqlite');

function readRow(dbFile, sql, ...params) {
  const handle = new DatabaseSync(dbFile);
  try { return handle.prepare(sql).get(...params); }
  finally { handle.close(); }
}

module.exports = { readRow };
