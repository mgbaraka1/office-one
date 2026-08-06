'use strict';

// Headless Node has no Electron safeStorage. This opt-in is loaded only by the
// isolated smoke-test runner; production secret writes remain fail-closed.
require('../db').allowPlaintextCredentialsForTests();

// Safety net for a smoke test run directly (`node test/some-smoke.js` — the
// exact command each affected file's own header comment tells a developer to
// use), which bypasses run-all.js entirely. Many smoke tests resolve a
// "production-looking" path via os.homedir() + 'AppData/Roaming/timesheet' to
// make a private copy of real data to test against; without run-all.js's
// HOME/USERPROFILE redirect, that resolves to the developer's REAL profile —
// so those files require this module first (before computing any
// os.homedir()-based path) specifically so this guard runs in time.
//
// run-all.js already redirects HOME/USERPROFILE for every test it spawns and
// marks that with COOPERATION_TOOLS_TEST_HOME; if that marker is present, its
// fixture is already the safe target and this does nothing. Otherwise this
// module stands up an equivalent disposable fixture profile itself.
if (!process.env.COOPERATION_TOOLS_TEST_HOME) {
  const { fakeHome } = require('./build-fixture-home')('cooperation-tools-standalone-test-home-');
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  process.env.COOPERATION_TOOLS_TEST_HOME = fakeHome;
}
