'use strict';

// Headless Node has no Electron safeStorage. This opt-in is loaded only by the
// isolated smoke-test runner; production secret writes remain fail-closed.
require('../db').allowPlaintextCredentialsForTests();
