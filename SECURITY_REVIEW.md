# Whole-Application Review — 2026-07-17

Scope: Electron main/preload/renderer boundaries, authentication and authorization, SQLite ownership and migrations, uploaded files, backups/restores, shutdown persistence, reports, dependency posture, UI/accessibility basics, tests, packaging, and developer documentation.

## Resolved in this review

- Added trusted sender/origin checks to every IPC handler; enabled Chromium sandboxing, denied permissions and renderer-created windows, and kept Node integration disabled.
- Added administrator accounts, admin-only global lookup/backup/restore controls, standard-account creation, self-service password changes, login throttling, and per-user defaults/UI state.
- Blocked cross-account subscription ID conflicts and retained session-derived ownership on all data operations.
- Made credential writes fail closed when DPAPI/safeStorage is unavailable; changed secret inputs to password controls.
- Contained every stored/upload path under its expected data root; restricted document-type codes; added a 100 MB limit and PDF/Office/image signature validation.
- Made document removal/replacement recoverable with inline confirmation and a five-second Undo action, followed by ownership-checked purge of unreferenced bytes.
- Validated restore candidates with SQLite integrity, foreign-key, required-table, and schema-head checks before replacing the live DB.
- Surfaced automatic backup failure instead of silently continuing; retained the existing pre-restore safety snapshot.
- Rejected invalid dates and non-integer/out-of-range work-log durations instead of silently changing them.
- Stopped shutdown when pending saves fail and added Retry, Cancel close, and explicit Close without saving choices.
- Moved report printing to a sandboxed, JavaScript-disabled main-process window; bounded report size and sanitized the suggested filename.
- Removed remote Google Fonts and tightened CSP network/frame/object directives.
- Added dialog semantics, focus return, label associations, and live-region semantics for status/undo messages.
- Replaced production-derived test inputs with a generated fixture profile and added dedicated security regression coverage.
- Updated Electron to 42.7.0; `npm audit` reports zero known vulnerabilities.

## Verification

- All JavaScript and both renderer scripts parse successfully.
- All 16 synthetic-fixture smoke suites pass.
- `npm audit --omit=dev` reports 0 vulnerabilities.
- `npm run pack` succeeds and the ASAR contains migration 040 and the expected app entry files.

## Residual risks / next structural work

1. **Code signing:** the Windows package is currently unsigned because no signing identity is configured. Obtain and protect a Windows code-signing certificate, configure electron-builder/CI signing secrets, and require signed artifacts in the release pipeline. This cannot be completed safely from source code alone.
2. **Inline CSP:** `script-src 'unsafe-inline'` and `style-src 'unsafe-inline'` remain because `index.html` contains inline application code, event attributes, and report styles. Remote assets and connections are now removed/blocked, and renderer isolation is stronger, but eliminating this directive requires extracting scripts/styles and converting inline handlers to registered listeners.
3. **Maintainability:** `index.html` and `db.js` remain very large. Split the renderer by feature and the data layer by domain behind the existing preload/API contracts, with characterization tests before each extraction.
4. **UI automation:** current tests are strong at the data layer but do not drive packaged Electron UI journeys. Add Playwright Electron tests for login/admin boundaries, close-save failure, file undo, restore confirmation, keyboard-only modal use, and report print/export.
5. **Platform limitation:** DPAPI protects secrets at rest from offline database inspection; code running as the same Windows user can still request decryption. OS account security and full-disk encryption remain part of the threat model.
