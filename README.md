# Office ONE

An offline, multi-user Electron desktop app for timesheets, client tasks, internal/department work, client projects and infrastructure, subscriptions, company documents, a WYSIWYG Knowledge Hub, financial record-keeping, analytics, and exportable reports.

Everything runs on the device. There is no application server, no cloud sync, and no network calls — one embedded SQLite database holds all data, and the renderer's Content-Security-Policy sets `connect-src 'none'`. Each account logs in separately and owns its own data; every business query is scoped in the main process to the session's user id, and the renderer can never supply a trusted `user_id`.

---

## Features

**Time tracking**
- A `tasks` → `work_logs` model: a task is date-independent, each work log is one dated session with its own minutes, description, activity type and time type.
- Today (Timesheet) page with grouped or flat views, Repeat Last, remembered session defaults, duration presets, a live timer, and per-day employee/day naming.
- Client Tasks and Internal Work as separate domains — a task belongs to one client project **or** one department, never both.
- Per-task detail view with a full field-change history, task merging, and structured, searchable task source references.

**Clients & assets**
- Clients page: bilingual client profiles (business code, English/Arabic names) with VPN connections, servers (system / role / environment identity), internal systems and their sub-services — credentials encrypted at rest.
- Client projects with tracked uploaded documents and linked tasks, reached from the client's profile.
- Recurring subscriptions and renewal-tracked company documents.

**Knowledge & records**
- Knowledge Hub with a real WYSIWYG editor (vendored Quill), groups, tags, attachments, versioned documents, and a strict HTML sanitizer allowlist.
- Finance: contracts with versions and installments, change requests, invoices with allocation and payment tracking, and minutes of meeting — all rendered on the client that owns them, under the Clients page's Finance and Meetings tabs. Money is stored in integer minor units, and six cross-entity invariants are enforced server-side.

**Review & output**
- Overview dashboard leading with attention items, period comparisons, and accessible chart data tables.
- Reports with PDF export (rendered by a main-process-owned sandboxed window), CSV, and a dependency-free Excel writer.
- Browse views over companies and systems, plus an account-scoped recent-changes feed.

**Platform**
- SQLite FTS5 Quick Find (`Ctrl+K`) across tasks, projects, Knowledge Hub, company documents and subscriptions.
- Multi-user accounts with a User Management page and forced password rotation for assigned passwords. There is no administrator tier: any authenticated account may act, and shared-data changes are recorded against the acting account instead.
- Full English/Arabic interface with a complete right-to-left layout and localized PDF reports.
- Per-account comfort preferences (theme, density, canvas, motion, sidebar, timesheet view) stored per user, not per machine.
- Rotating database snapshots, validated restore, integrity checks, and checksum-verified full backup/restore bundles covering the database and every uploaded-file tree.

---

## Tech stack

| Layer | Choice |
|---|---|
| Desktop shell | Electron `^42.7.0` (Node 24 / Chromium) |
| Storage | Node's built-in `node:sqlite` (`DatabaseSync`) |
| Password hashing | `bcryptjs` (pure JS — no native modules) |
| UI | Vanilla HTML, CSS, and classic-script JavaScript; system fonts |
| Third-party renderer JS | Vendored Quill + DOMPurify (Knowledge Hub only) |
| Packaging | `electron-builder` (Windows NSIS + portable) |

`bcryptjs` is the only runtime dependency. There is no bundler, no transpilation step, and no native addon to compile — a fresh clone installs and runs.

---

## Install, run, and test

```bash
npm install
npm start        # launch the app
npm test         # 39 headless smoke suites
npm run test:e2e # real Electron end-to-end run
```

`npm test` builds a synthetic user profile and fixture database under the OS temporary directory; it never reads or copies real data from `%APPDATA%\office-one\`. `npm run test:e2e` launches a hidden real Electron instance against a disposable data directory and drives the renderer over the Chromium DevTools protocol.

Build:

```bash
npm run build      # electron-builder, current platform
npm run build:win  # Windows NSIS installer + portable
npm run pack       # unpacked directory only (fast packaging check)
```

Windows CI runs `npm audit --omit=dev --audit-level=high`, the full smoke suite, the E2E run, and `npm run pack` on every push and pull request. Tagged `v*` releases require Windows signing credentials (`WINDOWS_CSC_LINK`, `WINDOWS_CSC_KEY_PASSWORD`), verify the Authenticode signature, and publish the installers with a CycloneDX SBOM and `SHA256SUMS.txt`. Before tagging, also check the current Electron version against [Electron's published security advisories](https://github.com/electron/electron/security/advisories) — a fresh Electron-specific advisory can land between npm audit-database updates.

---

## Data and backups

| Data | Windows location |
|---|---|
| Database | `%APPDATA%\office-one\cooperation-tools.db` (plus `-wal`/`-shm` while open) |
| Project files | `%APPDATA%\office-one\projects\` |
| Company-document files | `%APPDATA%\office-one\company_documents\` |
| Knowledge Hub attachments | `%APPDATA%\office-one\knowledge_hub\` |
| Finance attachments | `%APPDATA%\office-one\finance\` |
| Rotating snapshots | `%APPDATA%\office-one\backups\` (newest five) |

Electron derives that folder name from `package.json`'s `name`, so changing `name` moves where the app looks for its data. The rebrand from `timesheet` to `office-one` therefore ships with a one-time carry-over in `main.js` (`migrateLegacyUserDataDir`): on first launch it **copies** the database, uploads and snapshots out of a pre-rebrand `%APPDATA%\timesheet\` and leaves the original in place as a recovery point. It also carries across Chromium's `Local State`, which is emphatically not a disposable cache: it holds the key `safeStorage` encrypts every stored credential with, so a database that moves without it arrives intact and permanently unopenable. Two static-quality assertions keep the package name and that carry-over from ever drifting apart. The database filename itself stays `cooperation-tools.db` — it is the name every existing install, rotating snapshot and full-backup manifest already records.

For development or a portable install, override the location with `OFFICE_ONE_DATA_DIR` (see [.env.example](.env.example)); the former `COOPERATION_TOOLS_DATA_DIR` is still honoured. Packaged builds ignore `.env`.

Full backups are written **outside** the live data directory, to a timestamped Desktop folder, and include the database, every uploaded-file tree, the rotating snapshots, and a SHA-256 file inventory. Settings → Backup Data validates and restores a complete bundle: it first creates a separate full recovery point, then stages every replacement file before closing SQLite. Deleting or replacing an uploaded document offers a five-second Undo.

### Moving a backup to another computer

Client passwords and secret keys are encrypted with a key belonging to one Windows account on one machine, so a plain backup restores them only where it was made — everywhere else they are intact and unopenable.

Give the backup a **passphrase** and they become portable: every credential in the bundle's copy of the database is re-wrapped under a key derived from the passphrase (scrypt, then AES-256-GCM), and the restore converts them straight back to the receiving machine's own key. The portable form exists only inside the bundle, never in a live database, and the live database is never touched while a backup is taken.

- The passphrase is never stored, logged, or written into the bundle. The manifest carries only the KDF parameters, the salt, and a verifier blob.
- A wrong passphrase is rejected against that verifier **before** anything is staged or replaced, so a typo costs nothing and can simply be retried.
- A portable bundle restored *without* its passphrase still restores everything else; the credentials stay locked and the app says so.
- A backup will not be written at all if some credential cannot be read on the machine taking it — better to refuse than to hand someone a bundle quietly missing the passwords they believe are in it.

A credential this machine holds no key for is shown as *"Cannot be read on this device"*, never as a value, and an unrelated edit to the same record leaves it untouched rather than overwriting it.

---

## Security model

- Passwords are hashed with `bcryptjs` at cost 12 and never stored in plaintext. Passwords are bounded to the exact 72-byte bcrypt boundary so two different strings can never collapse into the same credential.
- Login failures are rate-limited (five wrong attempts → 30-second lockout) and the lockout is persisted, so restarting the app is not a way around it.
- Client passwords and secret keys are encrypted at rest with Electron `safeStorage` (Windows DPAPI), transparently to every caller. Secret writes **fail closed** if secure storage is unavailable rather than falling back to plaintext.
- Renderer isolation: `contextIsolation`, Chromium `sandbox`, no Node integration, a narrow preload bridge, and a strict CSP with `script-src 'self'` and `connect-src 'none'`. Markup carries no inline handlers — a tiny delegated-event parser accepts only a named global function and a fixed argument grammar (no `eval`, no `new Function`).
- Every IPC channel passes an executable, fail-closed argument contract before its authentication wrapper runs, then a trusted-sender/origin check, then `authed` gating. A channel added without a contract fails closed and is caught by CI.
- Permission requests are denied, renderer-created windows are denied, and navigation away from the app page is blocked.
- Uploaded files are ownership-checked, path-contained inside the data directory, capped at 100 MB, and validated by both extension and file-signature magic bytes.
- Database restore accepts only a listed snapshot and validates SQLite integrity, foreign keys, required tables and schema compatibility. Full Restore additionally validates its manifest, SHA-256 checksums, and every database-referenced attachment before touching live data.
- Knowledge Hub article HTML is sanitized through a fixed DOMPurify allowlist both before persisting and before rendering.
- There is deliberately **no** email or token password-reset flow — the app has no network layer. If the last active account forgets its password, recovery is a manual local procedure: generate a bcrypt hash with the app's own `bcryptjs` dependency and write it into `users.password_hash` directly via `node:sqlite`. This is also why the last active account can never be deactivated.

---

## Architecture

| Path | Role |
|---|---|
| `main.js` | Electron lifecycle, window, IPC registration and the trusted/authed boundaries, native dialogs, printing, OS integration |
| `auth.js` | bcrypt validation, login throttling, account administration, the in-memory session |
| `db.js` | SQLite connection, migration runner, maintenance/backups, ownership-scoped CRUD, validation, analytics |
| `finance-db.js` | Finance's own data layer — shares the connection, owns all of its own SQL |
| `xlsx.js` | Dependency-free OpenXML workbook writer for Excel exports |
| `ipc-contracts.js` | Executable, fail-closed argument contracts for every renderer→main channel |
| `ipc-types.js` | Documentation-only JSDoc shapes for the IPC boundary |
| `preload.js` | The context-isolated `window.api` façade |
| `index.html` | All renderer markup and module containers |
| `renderer/` | Shared CSS, boot/core logic, i18n runtime, and per-domain feature modules |
| `migrations/` | Append-only numbered migrations `000` … `059` |
| `test/` | Headless smoke suites plus the real Electron E2E harness |
| `.github/workflows/` | Windows verification and signed-release automation |

Developer and data-safety reference: [CLAUDE.md](CLAUDE.md).

---

## License

ISC © Moustafa Baraka
