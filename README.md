# Office ONE

An offline, multi-user Electron desktop app for timesheets, tasks, client projects, internal work, subscriptions, company documents, analytics, and PDF reports.

All operational data stays on the device in an embedded SQLite database. There is no application server or cloud sync. Every business-data query is scoped to the account held in the main-process session; the renderer never supplies a trusted `user_id`.

## Main features

- Fast daily logging with grouped task sessions, Repeat Last, remembered session defaults, duration presets, a live timer, and per-session activity/time type.
- Client projects with linked tasks and tracked uploaded documents.
- Internal tasks organized by department, plus an all-tasks view and task detail/history data.
- Bilingual client profiles with a unique company code, English/Arabic names, linked projects/tasks, authentication connections, servers, and internal systems.
- Recurring subscriptions and renewal-tracked company documents.
- An accessible Overview with attention items first, period comparisons, chart data tables, browse/report filters, and main-process-owned PDF printing.
- A responsive, keyboard-friendly precision workspace with user-collapsible navigation,
  universal Create Hub, Quick Find, contextual workflow guidance, connected form errors,
  persistent density/canvas/motion comfort controls, reversible Focus Mode, focus
  management, coordinated high-contrast light/dark themes, and a switchable
  English/Arabic interface with login-page-only language selection, localized PDF
  reports, and a full right-to-left Arabic layout.
- Multi-user accounts with a dedicated User Management page: administrators can create accounts, assign Administrator or Standard User permissions, rename/deactivate users, and reset passwords; every user can edit their own username and password.
- Rotating database snapshots, validated restore, integrity checks, and checksum-verified full backup/restore bundles containing the DB and every uploaded-file tree.
- SQLite full-text Quick Find across tasks, projects, Knowledge Hub, company documents, and subscriptions, plus an account-scoped Recent Changes feed.
- Administrator Recovery Readiness diagnostics covering live integrity, every rotating snapshot, referenced files, disk headroom, search health, and Windows credential portability.

## Security model

- Passwords are hashed with `bcryptjs` at cost 12 and never stored in plaintext.
- Client passwords and secret keys are encrypted with Electron `safeStorage` (Windows DPAPI). Secret writes fail closed if secure storage is unavailable.
- Renderer isolation uses `contextIsolation`, Chromium sandboxing, disabled Node integration, a narrow preload bridge, trusted-sender IPC checks, denied permission requests, and denied renderer-created windows.
- Uploaded files are ownership-checked, path-contained, limited to 100 MB, and validated by extension and file signature.
- Database restore accepts only a listed snapshot and validates SQLite integrity, foreign keys, required tables, and schema compatibility. Full Restore validates its manifest, SHA-256 checksums, and every database-referenced attachment before changing live data.

## Tech stack

| Layer | Choice |
|---|---|
| Desktop shell | Electron `^42.7.0` (Node 24 / Chromium) |
| Storage | Node's built-in `node:sqlite` (`DatabaseSync`) |
| Password hashing | `bcryptjs` |
| UI | Vanilla HTML, CSS, and JavaScript using system fonts |
| Packaging | `electron-builder` (Windows NSIS + portable) |

There is no development transpilation or native addon build.

## Install, run, and test

```bash
npm install
npm start
npm test
npm run test:e2e
```

`npm test` creates a synthetic user profile and fixture database under the OS temporary directory. It never reads or copies `%APPDATA%\timesheet\`.

Build commands:

```bash
npm run build
npm run build:win
npm run pack
```

`npm run test:e2e` launches a hidden real Electron instance against a disposable profile. Windows CI runs the complete smoke suite, Electron E2E, and packaging. Tagged releases build NSIS and portable artifacts; configure `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` repository secrets for signed releases.

## Data and backups

| Data | Windows location |
|---|---|
| Database | `%APPDATA%\timesheet\cooperation-tools.db` (`-wal`/`-shm` while open) |
| Project files | `%APPDATA%\timesheet\projects\` |
| Company-document files | `%APPDATA%\timesheet\company_documents\` |
| Rotating snapshots | `%APPDATA%\timesheet\backups\` (newest five) |

The package name must remain `timesheet`; Electron derives the production data-folder name from it. Development can override the data location with `COOPERATION_TOOLS_DATA_DIR` as shown in `.env.example`.

Full backups are written outside the live data directory to a timestamped Desktop folder and include the DB, uploaded files, snapshots, and a SHA-256 file inventory. Settings → Maintenance can validate and restore the complete bundle; it first creates a separate full recovery point and stages all replacement files before closing SQLite. Ordinary data and files are portable, but DPAPI-encrypted client secrets require the same Windows account or must be re-entered. Deleting or replacing uploaded documents offers a five-second Undo action.

## Architecture

- `main.js` — Electron lifecycle, trusted/authenticated/admin IPC boundaries, dialogs, printing, and OS integration.
- `auth.js` — bcrypt validation, login throttling, account administration, and the in-memory session.
- `db.js` — SQLite connection, migrations, maintenance/backups, ownership-scoped CRUD, validation, and analytics.
- `migrations/` — append-only migrations `000` through `050`; migration `050` extends English/Arabic labels to every managed Settings catalog without changing lookup ids or relationships.
- `ipc-contracts.js` — executable, fail-closed validation contracts for every renderer-to-main channel.
- `preload.js` — the context-isolated `window.api` bridge.
- `index.html` — renderer markup and module containers.
- `renderer/` — shared CSS, bootstrap/core logic, and domain-focused classic-script feature modules.
- `test/` — synthetic smoke suites plus real Electron E2E.
- `.github/workflows/` — Windows verification and tagged-release automation.

The work model is `tasks` → `work_logs`: a task is date-independent and each log is one dated session. A task can optionally belong to one project or one department, never both.

See `AGENTS.md` for the detailed developer and data-safety reference.

## License

ISC © Moustafa Baraka
