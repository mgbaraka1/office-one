# Cooperation Tools

An offline, multi-user Electron desktop app for timesheets, tasks, client projects, internal work, subscriptions, company documents, analytics, and PDF reports.

All operational data stays on the device in an embedded SQLite database. There is no application server or cloud sync. Every business-data query is scoped to the account held in the main-process session; the renderer never supplies a trusted `user_id`.

## Main features

- Timesheet sessions grouped under date-independent tasks, including a live timer and per-session activity/time type.
- Client projects with linked tasks and tracked uploaded documents.
- Internal tasks organized by department, plus an all-tasks view and task detail/history data.
- Client reference records for authentication connections, servers, and internal systems.
- Recurring subscriptions and renewal-tracked company documents.
- SQL-aggregated analytics, attention items, browse/report filters, and main-process-owned PDF printing.
- Multi-user accounts: the first account is the administrator; administrators can add users, and each user can change their password.
- Rotating database snapshots, validated restore, integrity checks, and full Desktop backups containing the DB and uploaded-file trees.

## Security model

- Passwords are hashed with `bcryptjs` at cost 12 and never stored in plaintext.
- Client passwords and secret keys are encrypted with Electron `safeStorage` (Windows DPAPI). Secret writes fail closed if secure storage is unavailable.
- Renderer isolation uses `contextIsolation`, Chromium sandboxing, disabled Node integration, a narrow preload bridge, trusted-sender IPC checks, denied permission requests, and denied renderer-created windows.
- Uploaded files are ownership-checked, path-contained, limited to 100 MB, and validated by extension and file signature.
- Backup restore accepts only a listed snapshot and validates SQLite integrity, foreign keys, required tables, and schema compatibility before replacing the live DB.

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
```

`npm test` creates a synthetic user profile and fixture database under the OS temporary directory. It never reads or copies `%APPDATA%\timesheet\`.

Build commands:

```bash
npm run build
npm run build:win
npm run pack
```

Production releases should be code-signed through the Windows signing configuration/environment used by `electron-builder`.

## Data and backups

| Data | Windows location |
|---|---|
| Database | `%APPDATA%\timesheet\cooperation-tools.db` (`-wal`/`-shm` while open) |
| Project files | `%APPDATA%\timesheet\projects\` |
| Company-document files | `%APPDATA%\timesheet\company_documents\` |
| Rotating snapshots | `%APPDATA%\timesheet\backups\` (newest five) |

The package name must remain `timesheet`; Electron derives the production data-folder name from it. Development can override the data location with `COOPERATION_TOOLS_DATA_DIR` as shown in `.env.example`.

Full backups are written outside the live data directory to a timestamped Desktop folder and include the DB, uploaded files, snapshots, and a manifest. Deleting or replacing uploaded documents offers a five-second Undo action.

## Architecture

- `main.js` — Electron lifecycle, trusted/authenticated/admin IPC boundaries, dialogs, printing, and OS integration.
- `auth.js` — bcrypt validation, login throttling, account administration, and the in-memory session.
- `db.js` — SQLite connection, migrations, maintenance/backups, ownership-scoped CRUD, validation, and analytics.
- `migrations/` — append-only migrations `000` through `040`; migration `040` adds administrators and per-user settings/UI state.
- `preload.js` — the context-isolated `window.api` bridge.
- `index.html` — the renderer UI.
- `test/` — standalone smoke tests orchestrated by `test/run-all.js` against generated fixtures.

The work model is `tasks` → `work_logs`: a task is date-independent and each log is one dated session. A task can optionally belong to one project or one department, never both.

See `AGENTS.md` for the detailed developer and data-safety reference.

## License

ISC © Moustafa Baraka
