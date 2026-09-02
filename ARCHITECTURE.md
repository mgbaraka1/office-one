# Architecture

How Office ONE is put together, and why. **The code is the source of truth** —
where this file and the code disagree, the code wins; please fix this file.

For workflow, style and the rules CI enforces, see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 1. What it is

Office ONE is an offline, multi-user Electron desktop app covering:

- **Timesheets** — `tasks` → `work_logs`; a task is date-independent, each log is one dated session.
- **Client Tasks** and **Internal Work** — two separate task domains (project work vs. department work).
- **Clients** — bilingual client profiles plus VPN connections, servers and internal systems; client **Projects** with tracked documents and linked tasks live under each client.
- **Subscriptions** and **Company Documents** — recurring spend and renewal-tracked files.
- **Knowledge Hub** — WYSIWYG articles (Quill), groups, tags, attachments, versioned documents.
- **Finance** — contracts, change requests, invoices, payments, meeting minutes.
- **Overview / Reports** — read-only analytics, PDF/CSV/Excel export.

There is no server and no network access. All data lives in one embedded SQLite
file under the OS userData folder. Each account logs in separately and owns its
own data (every business table carries a `user_id`); the authenticated user's id
lives **only** in the main-process session and is never trusted from the renderer.

## 2. Tech stack

| Layer | Choice |
|---|---|
| Shell | Electron `^42.7.0` (Node 24 / Chromium) |
| Storage | `node:sqlite` `DatabaseSync` — built into Node 24, ships inside Electron |
| Hashing | `bcryptjs` (pure JS; the only runtime dependency) |
| Renderer | Vanilla HTML/CSS/classic-script JS, system fonts |
| Vendored 3rd-party JS | Quill + DOMPurify, Knowledge Hub only (`renderer/vendor/`) |
| Packaging | `electron-builder` → Windows NSIS + portable |

No bundler, no transpilation, no native addons. `engines.node` is `>=24` and CI
pins Node 24 — `node:sqlite` and the test harness both depend on it.

## 3. Layout

```
main.js              Electron lifecycle, IPC registration, trusted/authed gates,
                     dialogs, printing, single-instance lock, crash handling
auth.js              bcrypt, login throttling, account management, the in-memory session
db.js                SQLite connection, migration runner, maintenance/backups, all app
                     CRUD, validation, analytics, and the Finance section
                     (~6,700 lines — by far the largest file; see §10)
xlsx.js              Dependency-free OpenXML workbook writer
ipc-contracts.js     Executable, fail-closed argument contracts per channel
ipc-types.js         Documentation-only JSDoc shapes (NOT in build.files)
preload.js           The context-isolated window.api façade
index.html           All renderer markup; one <div class="app-module"> per page
renderer/
  bootstrap.js       Pre-paint theme application (avoids a theme flash)
  i18n.js            Arabic runtime: dictionary + DOM observer + regex rules + RTL
  event-delegation.js  CSP-safe data-on* handler parser (replaces inline onclick)
  settings-registry.js Single source of truth for the Settings catalog tabs
  core.js            Icons, shared state, modals/focus traps, toasts, lookups, pickers
  app.css            All application styling (design tokens in :root)
  finance.css        Finance styling
  features/          timesheet.js, tasks.js, workspace.js, clients.js, knowledge.js,
                     knowledge-sanitize.js, company-documents.js, finance.js, shell.js
  vendor/            quill/, dompurify/
migrations/          000_baseline.js … 060_unify_finance_catalog.js (append-only)
test/                40 *-smoke.js suites + run-all.js + electron-e2e.js
```

Renderer scripts are **ordered classic scripts**, not modules — load order in
`index.html` matters (`core.js` before every feature file; DOMPurify before
`knowledge-sanitize.js` before `knowledge.js`). Any new top-level path must be
added to `package.json` → `build.files` or it will be missing from packaged builds.

## 4. Database

One file: `cooperation-tools.db` in userData. Boot sequence in `db.js`:

1. `openConnection(dir)` — open/create the file, apply PRAGMAs (`journal_mode = WAL`, `busy_timeout = 5000`, `foreign_keys = ON`).
2. `applyMigrations()` — run every pending numbered migration once, in order, recording each in `schema_migrations`.
3. `runMaintenance()` — best-effort housekeeping: credential encryption catch-up, snapshot rotation, orphan-file sweeps. Never throws, never blocks boot.

`tx(fn)` is **reentrant** — a nested `tx()` joins the outermost transaction
(SQLite has no nested `BEGIN`) — and returns `fn()`'s value.

### 4.1 Tables

**Identity & config**: `users`, `app_settings` (shared config), `machine_prefs`
(this-machine-only), `user_settings` (per-user, UI prefs under a `pref_` prefix),
`user_ui_state`, `lookup_codes`, `lookup_code_user_access`, `lookup_code_history`,
`company_profiles`.

Two tables are deliberately **global** rather than user-scoped: `lookup_codes`
(the catalog is shared by design) and `company_profiles` (a registered address is
a fact about the organisation, not one account's note). For both, the safeguard
is attribution rather than permission — every write is recorded against the
acting account.

**Work**: `tasks`, `work_logs`, `task_sources`, `task_field_history`,
`work_log_history`, `days` (per-day metadata, **not** the entry store).

**Projects & documents**: `projects`, `project_documents`, `project_companies`,
`project_systems`, `company_documents`.

**Clients**: `client_vpn_connections`, `client_servers`, `client_internal_systems`
(each keyed to a `COMPANY` lookup id, holding encrypted `password`/`secret_key`),
and `client_field_history` — where `password`/`secret_key` are always written as
`'(hidden)'`. That is deliberate; do not "fix" it into storing real values.

**Knowledge Hub**: `knowledge_items`, `knowledge_groups`, `knowledge_group_items`,
`knowledge_tags`, `knowledge_item_tags`, `knowledge_attachments`.

**Subscriptions**: `subscriptions` (`cost` REAL, `currency_id`, `billing_cycle_id`, `renewal_date`).

**Search**: `workspace_search` — a user-scoped, trigger-maintained FTS5 index.
Credentials, file contents and financial *amounts* are deliberately excluded.
Client-infrastructure and Finance rows use a composite `entity_id` of
`ownerId:recordId` so a result can deep-link back to its parent.

**Finance**: `finance_clients`, `finance_contracts`, `finance_contract_versions`,
`finance_contract_installments`, `finance_change_requests`, `finance_invoices`,
`finance_invoice_links`, `finance_invoice_payments`, `finance_meetings`,
`finance_meeting_actions`, `finance_attachments`. See §5.

### 4.2 Lookups (`lookup_codes`)

Every bounded category/type/status field is normalized into `lookup_codes` under
one of the categories in `db.js`'s `LOOKUP_CATEGORIES`.

- **`LOOKUP_CATEGORIES` gates the whole catalog.** A category missing from that
  allowlist renders its dropdowns *silently empty*, and the headless tests stay
  green. Adding one means touching `db.js`'s list **and**
  `renderer/settings-registry.js`; `test/settings-registry-smoke.js` is the CI
  guard that keeps them in sync with the tabs in `index.html`.
- The table is **global**. `lookup_code_user_access` rows make a specific lookup
  private to listed users; a lookup with no access rows is a normal shared option.
- Compare on the stable `code`; render the `label`/localized name.
  **Soft-disable (`is_active = 0`), never delete a code in use.**
- **A `code` is write-once, for every category.** It is the identity every task,
  project, invoice and infrastructure row is filed under.
- `lookupLabelKey()` is the single definition of "same label" (trim + lowercase,
  deliberately a JS fold rather than SQL `COLLATE NOCASE`, which is ASCII-only).
- **`COMPANY` has no Settings tab** — the roster is managed on the Clients page
  (§7). Its registry entry must still exist, because `LK_CAT`/`LK_VALUE` and
  `LOOKUP_MERGE_CATEGORIES` derive from that same array. The four Finance
  categories work the same way, edited in Settings → Finance.

### 4.3 Migrations

Files are `migrations/NNN_name.js`, each exporting `{ version, name, up(db) }`
plus optional flags:

- `manualTransaction: true` — the migration owns its own transaction/PRAGMA
  sequencing (needed for table rebuilds where `PRAGMA foreign_keys` must toggle
  *outside* a transaction).
- `destructive: true` — a full snapshot is written to
  `<userData>/pre-migration-backup/` before it runs on an existing DB.

**Append-only.** Never edit an applied migration, never mutate schema ad hoc.
Migrations must be idempotent enough to survive a restore of an older backup.
`schema_migrations` records `(version, name, applied_at)` — a version number, not
a checksum — so a migration that has already run never runs again.

Landmarks worth knowing:

| # | What |
|---|---|
| 003 | the normalized lookup catalog |
| 012–014 | `day_entries` → `tasks` + `work_logs` (the core work-model restructure) |
| 032 | client credential encryption at rest |
| 035 | project hierarchy + Annual Support — **retired**, see §10 |
| 042 | Project Categories fully removed |
| 043–045, 051 | Knowledge Hub, groups, versioned documents, `content_format` |
| 046, 049, 057 | FTS5 workspace search, extended to client infrastructure and Finance |
| 047, 050 | bilingual client profiles and catalog labels |
| 048 | SQLite triggers enforcing lookup-category invariants (defense in depth) |
| 052 | forced password rotation |
| 053 | Client/Internal task domain separation — `department_id` is the single source of truth; there is deliberately **no** `tasks.kind` column |
| 054 | the Finance module's schema |
| 056 | Finance clients join the shared roster; the global `company_profiles` table |
| 058 | `lookup_code_history` — the shared catalog gains an audit trail |
| 059 | seeds `TIME_TYPE` and `ACTIVITY_TYPE` on a **fresh** database, guarded on the category being empty |
| 060 | Finance's catalog folds into `lookup_codes` (§5) |

**A guarded seed is the right shape for a fresh-install gap.** Migration 003
seeded some categories from "legacy blob ∪ values already in the data", both
empty on a new database, so those categories ended up with zero rows and a
first-run user saw empty dropdowns. Migration 059 fixes that by seeding only when
a category is empty — which makes it a verified no-op on any curated catalog.
Never fix that class of gap by editing 003.

`COMPANY` is still deliberately empty on a fresh install: the client roster is
yours to create, and a seeded fake company would be worse than none.

## 5. Finance

Contracts, contract versions, installments, change requests, invoices with
payment tracking, and meeting minutes.

Finance began as a deliberately isolated module — its own file, its own client
roster, its own catalog — so it could be removed by deleting a few files. That
isolation has been unwound on purpose:

- **Its clients ARE the shared roster** (migration 056). `finance_clients` is a
  per-user *finance profile* keyed to a global `COMPANY` lookup id. Identity
  (name, Arabic name, code) is read from the joined `COMPANY` row, so a rename
  flows straight through. The local `name`/`code` columns survive as the
  pre-merge audit trail and as the fallback for an unlinked row.
- **Its catalog IS the shared catalog** (migration 060). `CONTRACT_STATUS`,
  `CR_STATUS`, `INVOICE_STATUS` and `PAYMENT_METHOD` are ordinary `lookup_codes`
  categories, gated by `LOOKUP_CATEGORIES` and audited in `lookup_code_history`
  like any other catalog edit. They keep a dedicated editor in
  **Settings → Finance** rather than four more shared tabs, which is what their
  `settingsTab: false` registry entries mean. The old `finance_lookups` table is
  left in place, unread, as the pre-migration record.
- **Its code IS the shared data layer.** What was `finance-db.js` is now the
  Finance section of `db.js`.
- **Currency comes from the app-wide `CURRENCY` catalog.** `currency_code` stores
  a *string*, not an FK id.

**Money is stored as INTEGER MINOR UNITS** (halalas/cents) on every amount
column — deliberately unlike `subscriptions.cost` REAL. Invoice-to-installment
reconciliation (partial payments, allocation across installments/CRs) needs
exact integer arithmetic.

Every mutating function returns `{ ok, ... }` rather than throwing, so a refusal
is never a partial write. Six cross-entity invariants are enforced server-side:

1. Exactly one final version per contract (SQLite-enforced).
2. Link exclusivity — an invoice link points at exactly one of `installment_id` / `cr_id`.
3. Currency agreement across linked entities.
4. No over-allocation of an invoice.
5. No over-payment beyond an invoice's total.
6. An installment/CR carrying any invoice allocation cannot be deleted.

### Uploads

Files live under `<userData>/finance/{entityType}/{entityId}/`, and
`finance_attachments.file_path` stores that path **including the leading
directory**, built with `path.join` — so on Windows the stored separators are
**backslashes**. Any query against these paths must handle both forms.

### There is no Finance page

Finance is **not a module**. There is no `#module-finance`, and
`switchModule('finance')` is remapped to `clients`, so a remembered `lastModule`
or a stale deep link still lands somewhere real. A contract, a change request and
an invoice are *client* records, and they render on the client that owns them:

| Surface | Host id |
|---|---|
| Contracts / Change Requests / Invoices / Reports — the client's **Finance** tab | `#finance-detail-sections` |
| Meeting minutes — the client's **Meetings** tab | `#finance-meetings-sections` |
| The Finance catalog editor — **Settings → Finance** | `#finance-setup-sections` |

`renderFinanceDetailSections()` is the single repaint entry point and repaints
whichever of those three hosts is mounted. After a write, `finance.js` calls
`refreshFinanceHostPage()` → the Clients page's
`renderClientDetailAfterFinanceChange()`, which also refreshes the tab counts.

Reaching a finance record from elsewhere goes through
**`openClientFinance(companyId, subTab)`**, or
**`openFinanceRecordByClientId(financeClientId, subTab)`** when the caller only
has Finance's own id. `getFinanceAttentionItems()` therefore returns **both**
`clientId` and `companyId`.

A client with no `finance_clients` row shows a **Set Up Finance** button rather
than an error.

## 6. Security

### Process boundaries

`BrowserWindow` uses `contextIsolation: true`, `sandbox: true`,
`nodeIntegration: false`, and a preload-only bridge. Permission requests are
denied; renderer-created windows are denied (external `http(s)` URLs go to
`shell.openExternal`); `will-navigate` blocks navigation away from the app page
but allows a reload of the same URL (logout depends on it).

CSP: `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'none';
connect-src 'none'; img-src 'self' data:`.

### The IPC gate chain

Every `ipcMain.handle` registration passes through a wrapper installed at the top
of `main.js`:

```
validateIpcArgs(channel, args)   →  ipc-contracts.js — fail-closed argument contract
assertTrustedSender(event)       →  sender must be the one live window, at the app's own URL
authed(...)                      →  session required
db.fn(auth.requireUserId(), …)   →  ownership always from the session, never the renderer
```

**There is no admin tier.** Any authenticated account may perform any action —
including backup restore, catalog edits and account management. The safeguard is
**attribution, not permission**: shared-data changes are recorded against the
acting account in `client_field_history` and `lookup_code_history`.
`users.is_admin` survives as an inert column; nothing reads it to decide whether
an action is allowed, and `test/ui-ux-smoke.js` guards against a role check
quietly reappearing.

One rule survives as an **integrity** rule rather than a permission check: **the
last active account cannot be deactivated**. There is no network password reset,
so emptying it would mean editing `password_hash` by hand to get back in.
Re-authentication also survives and matters more without roles: acting on another
account's password or active status requires the actor's own password.

`trusted(...)` is the auth-exempt tier — only `auth:*`, `app:version`,
window/lifecycle and encryption-status channels. **A channel with no contract
fails closed**, and `test/ipc-contracts-smoke.js` verifies that `main.js`
handlers, `preload.js` invokes and the contract table all agree.

### Credential encryption at rest (migration 032)

- `db.js` **never imports `electron`** — it must stay requireable under plain Node
  for the smoke tests. It exposes `configureCredentialEncryption(safeStorageLike)`
  and friends; `main.js` is the *only* place that imports `safeStorage`, and calls
  `configureCredentialEncryption` once at boot, immediately before
  `openConnection()`. `safeStorage` is never exposed to the renderer.
- Marker convention: `enc:v1:` + base64 of `safeStorage.encryptString()`. Both
  directions are idempotent, so a mixed database is always readable.
- Transparent to callers: the `client*ToApi` mappers decrypt on read;
  `createClient*` encrypts before INSERT; `updateClient*` decrypts the *before*
  row first so history diffs compare plaintext-to-plaintext.
- **Not one-shot**: `encryptAllPendingCredentials()` runs from migration 032 *and*
  from `runMaintenance()` before every automatic snapshot, so it catches up
  whenever safeStorage becomes available.
- **Fails closed** when unavailable: new or changed non-empty credentials are
  blocked rather than written as plaintext. Headless tests must opt in via
  `allowPlaintextCredentialsForTests()`; production never calls it.

#### The key lives in the userData folder, and travels with it

`safeStorage` does not encrypt with DPAPI directly. It encrypts with an
AES-256-GCM key that Chromium keeps, DPAPI-wrapped, in **`Local State` inside the
userData folder**. That file is not a disposable cache — it is the only thing that
can open the `enc:v1:` credentials in the database beside it. Moving a database
without it makes every stored credential permanently unreadable while looking
perfectly intact. `db.USER_DATA_KEY_ENTRY` and the copy step in
`carryOverLegacyUserData()` exist because of that, and
`test/userdata-carryover-smoke.js` guards it. It is deliberately **not** in
`USER_DATA_ENTRIES` — it is Chromium's file, copied under its own
never-overwrite rule.

- **A failed decrypt is never the value.** `readCredential(stored)` returns
  `{ value, unreadable, reason }`. Everything that *displays* a credential uses
  it, and the mappers carry `passwordUnreadable` / `secretKeyUnreadable`.
  Returning the stored value on failure is what once made the Clients page reveal
  a raw `enc:v1:…` blob as though it were the password.
- **Unreadable is preserved, never overwritten.** `nextCredentialValue(storedRaw,
  incoming)` leaves an *unreadable* stored value alone when the incoming value is
  empty, because the API hands the renderer `''` for one and an unrelated edit
  would otherwise destroy ciphertext that is still good elsewhere. Clearing a
  credential you *can* read still works.

#### Portable credentials (`enc:p1:`)

A Full Backup taken **with a passphrase** re-wraps every credential in the
bundle's copy from the machine key to a passphrase-derived one (`scrypt` N=2^15 →
AES-256-GCM), so it restores anywhere. Restore converts them straight back to
`enc:v1:` under the receiving machine's key.

- The portable form exists **only inside a bundle**, never in a live database.
- The rewrite happens on the already-copied file **before** the manifest's
  checksums are computed, so the manifest describes what actually ships.
- The manifest's `credentialEnvelope` holds the KDF params, salt and a
  **verifier** — never the passphrase, never the key. Restore checks the verifier
  *before staging anything*, so a wrong passphrase costs nothing.
- Export **refuses** rather than half-converting when a credential can't be read
  on the exporting machine.

### Authentication

bcrypt cost 12; passwords bounded to exactly 72 UTF-8 bytes (bcrypt silently
ignores bytes past that); a dummy hash is compared on unknown usernames so timing
doesn't leak existence. Failure counts and lockouts (5 attempts → 30 s) persist in
`machine_prefs`, so restarting the app is not a bypass. The session lives only in
`auth.js`'s module memory — no "remember me", no auto-login, nothing in
localStorage. Lockout recovery is manual and local.

### Files

Uploads are ownership-checked, path-contained through `resolveInside()`, capped at
`MAX_DOCUMENT_BYTES` (100 MB), and validated by both extension allowlist and
magic-byte header. Project docs allow PDF/DOC/DOCX/PNG/JPG/GIF/WEBP; Knowledge
Hub adds XLS/XLSX/TXT.

### Backups & restore

Rotating snapshots keep the newest five in `<userData>/backups/`. Restore accepts
only a *listed* snapshot name, resolved to a basename against the real directory,
and validates integrity, foreign keys, required tables and schema head. Full
Backup writes a timestamped Desktop folder containing the DB, the upload trees,
`backups/` and a SHA-256 manifest. Full Restore validates the manifest, checksums
and every DB-referenced attachment, creates its own recovery point, and stages all
replacement files before closing SQLite.

## 7. Pages & navigation

Sidebar (`switchModule(name)` toggles `#module-<name>`). `analytics` leads the
list ungrouped — it is the landing page everything else reports into:

| Group | Module | Page |
|---|---|---|
| *(ungrouped, first)* | `analytics` | **Overview** (default landing page) |
| Track | `timesheet` | **Today** — the daily timesheet |
| | `all-tasks` | **Client Tasks** |
| Internal | `internal-tasks` | **Internal Work** (by department) |
| Clients & Assets | `clients` | **Clients** |
| | `subscriptions` | **Subscriptions** |
| | `companydocs` | **Company Docs** |
| | `knowledge` | **Knowledge Hub** |
| Review | `reports` | **Reports** |

Above `.sidebar-nav` sit the brand row — the app icon inlined as SVG in
`.brand-mark`, the same artwork as `build/icon.svg`, so the two must be kept in
step — and **Quick Find**. There is deliberately no universal "Create New" hub: a
record is created on the page that owns it, and `test/ui-ux-smoke.js` guards
against the hub coming back.

Two modules have **no sidebar entry** and are reached only by deep link:
`projects` (a single project's detail page) and `browse` (read-only
Companies/Systems roll-ups). `PAL_PAGES` in `shell.js` still lists Browse — the
command palette is a search surface, not the main menu. **Finance is not in
`PAL_PAGES`**; individual finance records still surface in Quick Find.

**Client detail tabs** (`CLIENT_DETAIL_TYPES` in `renderer/features/clients.js`):
Overview / Projects / **Finance** / **Meetings** / Access / Servers / Systems.

- The **Finance** tab is not a window into anything — it *is* Finance (§5).
- **Meetings** is its own tab because minutes are a record of what was agreed with
  a client, not a financial document. Only their storage stayed put.
- Both tabs need data Finance loads asynchronously, so their `(N)` counts are
  written by `updateClientDetailTabCounts()` **in place** rather than by
  rebuilding the toolbar — which would steal focus out of the search box beside it.
- Under an active detail search both fall back to a flat list of matching records.
- Finance's attention count folds into the **Clients** nav badge.

**The Clients page owns the client roster.** The roster *is* the `COMPANY` lookup
catalog, so this is the only place it is managed: **+ New Client** (the one place
a company code is ever set), **Show archived**, **Arrange**, inline English/Arabic
name editing on a 300 ms debounce, and **Archive / Restore**. **Company Code** is
rendered read-only with a lock glyph — never an input, anywhere. Duplicate-company
merging lives in Settings → Maintenance.

**Settings tabs** come from `renderer/settings-registry.js` (minus
`settingsTab: false` entries) plus the hand-authored General, User Management,
**Finance**, **Backup Data** and Maintenance tabs. Every tab is visible to every
account. **Backup Data is a Settings page, not a sidebar button**; Maintenance
keeps only the read-only audits and repairs.

**Light/dark lives inside View & Comfort**, as the *Appearance* choice group. The
theme is **not** in `workspaceViewPrefs` — it lives on `documentElement[data-theme]`.

**Global shortcuts** (handler in `renderer/features/timesheet.js`):

| Keys | Action |
|---|---|
| `Ctrl+K` | Quick Find / command palette (works even while typing) |
| `Ctrl+N` | context-aware "new" for the active module |
| `Ctrl+Shift+F` | Focus Mode |
| `Ctrl+Enter` | submit the open modal (or save Settings when dirty) |
| `Ctrl+←` / `Ctrl+→` | previous / next saved day |
| `Escape` | close everything open |
| `?` | keyboard-shortcuts overlay (only when not typing) |

## 8. IPC

204 channels, named `domain:action`. Domains: `auth`, `app`, `days`, `companies`,
`systems`, `analytics`, `attention`, `activity`, `lookups`, `subscriptions`,
`tasks`, `search`, `worklogs`, `day`, `projects`, `departments`, `internal`,
`companydocs`, `knowledge`, `clients`, `finance`, `ui`, `preferences`, `db`,
`maintenance`, `report`, `security`, `window`, `shell`.

**Adding an IPC handler — all four steps or it fails closed:**

1. `main.js` — `ipcMain.handle('domain:action', authed((_e, …) => db.fn(auth.requireUserId(), …)))`.
2. `ipc-contracts.js` — add the channel to `NO_ARGS` or `SIGNATURES`. Without this, the call throws.
3. `preload.js` — add the `window.api` façade method.
4. `ipc-types.js` — document the request/response shape.

## 9. Conventions

- **All persistence goes through `db.js` ↔ `window.api`.** The renderer never
  touches the filesystem.
- **Schema changes only via a new numbered migration.**
- **Categories live in `lookup_codes`, never as hardcoded arrays or magic strings.**
- **A lookup `code` is write-once, and the client roster is managed on the Clients
  page.** Never re-introduce a code-editing path.
- **A task is client work or internal work, never both.** `department_id` is the
  single source of truth; write paths guarantee `company_id`/`system_id`/
  `project_id` are NULL exactly when `department_id` is set, and migration 053
  backstops it in SQLite.
- **No destructive action without recovery** — inline confirm plus a 5-second undo toast.
- **Auto-save is a 300 ms debounce** in every module; never block the UI on a write.
- **Reuse the shared helpers.** In `core.js`: `esc()` (escape *all* user content
  into HTML), `toast()`, `textMatch()`, `buildSearchSelect()`, `hydrateIcons()`,
  `ic()`. In `features/timesheet.js`: `showDeleteConfirm()`, `switchModule()`. In
  `db.js`: `tx()`, `safeParse()`, `resolveInside()`, the `lk*` lookup helpers.
- **No inline event attributes.** Markup uses `data-onclick` / `data-onchange` /
  `data-oninput` / `data-onsubmit`, parsed by `renderer/event-delegation.js`. It
  accepts only a named global function plus a tiny argument grammar — no `eval`,
  no `new Function`. Keep expressions trivial and put the logic in the function.
- **Every modal gets a focus trap and initial focus for free** via
  `watchModalFocusTraps()`. Similarly `watchAriaLabels()` / `syncControlSemantics()`
  give dynamically created controls their names/roles/state automatically.
- **Design tokens only.** Colors, radii, spacing, shadows and transitions come from
  `:root` custom properties. The one deliberate exception: the Reports/Overview PDF
  template builders render into an isolated print document with no access to the
  page's custom properties.

### i18n

English is the source language; `renderer/i18n.js` owns Arabic via a dictionary, a
`MutationObserver` over feature renderers, regex rules, and full RTL. Mark
user-owned dynamic text with `data-user-content` so it is never translated.

**Four known blind spots** that have leaked English before, and which
`test/i18n-coverage-smoke.js` cannot see — green does **not** mean complete:

1. strings built inside template literals,
2. `<option>` elements created at runtime,
3. `::before`/`::after` content in vendored CSS,
4. **a duplicate dictionary key with a different meaning.** The dictionary is one
   flat object assembled from several `Object.assign(ar, …)` blocks, so a later
   block silently overrides an earlier one. One English string can only carry one
   Arabic meaning — when two features need the same word differently, **rename the
   English**, never add a second entry. ESLint's `no-dupe-keys` now catches the
   duplicate itself; it cannot catch a wrong *meaning*.

**The dictionary must also cover main-process copy.** `auth.js`, `db.js` and
`main.js` return `{ ok: false, error }` strings that the renderer drops straight
into the DOM. Internal guard rails that only fire on a tampered or corrupt call
are deliberately left English — they are diagnostics, not user copy.

Copy that never reaches the DOM — export payloads, `setTitle`, editor
placeholders — has no observer to translate it and must go through `t()`
explicitly. A string composed by concatenation lands as **one** text node, so it
needs a `dynamicArabicRules` entry, not a dictionary key; order matters, and the
**last** rule is a deliberate catch-all for the `"<label> (N)"` shape. Keep it last.

`app.commandLine.appendSwitch('lang', 'en-US')` in `main.js` is deliberate and
must stay: Chromium's native date pickers otherwise render Arabic-Indic digits
from the OS region.

## 10. Things that look wrong but are not

- **`db.js` is ~6,700 lines.** It is sectioned by domain rather than split,
  because it owns the single SQLite connection and keeping every query beside the
  schema it depends on is what makes the invariants checkable in one place.
- **Retired surfaces.** Some features were withdrawn while their tables and
  columns stayed, because migrations are append-only. See "Retired surfaces" in
  [CONTRIBUTING.md](CONTRIBUTING.md): migration 035's Sub-Projects / Annual
  Support (whose `support_year_id` is still named by migration 048's live
  triggers, so the task write paths must keep passing it), Project Categories,
  and `client_databases` / `client_external_services` (kept only so the
  credential-encryption sweep still catches a legacy plaintext value).
- **The DB filename `cooperation-tools.db` stays**, along with the legacy backup
  prefix acceptance — every existing install, snapshot and manifest already names
  them. It is reached through `db.DB_FILENAME`, not a literal.
- **"Timesheet" is a page, not the old brand.** The `timesheet` module,
  `#module-timesheet` and `renderer/features/timesheet.js` name the daily-timesheet
  surface and are correct as they stand.
- **`ipc-types.js` is intentionally absent from `build.files`** — it contains no
  runtime code.
- **`package.json` `name` is `office-one`, and it may not change casually.**
  Electron derives the production userData folder from it, so `name` *is* the data
  path. Renaming it without an equivalent carry-over orphans every install; two
  assertions in `test/static-quality-smoke.js` pin the name and the carry-over
  together.
- **The app icon is generated, not hand-edited.** `build/icon.svg` is the source;
  `icon.ico` and `icon.png` are rebuilt from it with `npx electron build/gen-icon.js`.
  Two traps: the generator needs `ELECTRON_RUN_AS_NODE` **unset**, and the SVG must
  be valid XML — a comment containing `--` makes the document unparseable and the
  generator will silently capture the browser's broken-image glyph and write *that*
  as the app icon. Always open the resulting PNG before committing.

## 11. Dev, build, and test

```bash
npm start          # electron .
npm run lint       # eslint
npm test           # test/run-all.js — 40 headless smoke suites
npm run test:e2e   # test/electron-e2e.js — real Electron over CDP
npm run build:win  # NSIS + portable
npm run pack       # unpacked dir (fast packaging sanity check)
```

`OFFICE_ONE_DATA_DIR` (see `.env.example`) redirects the data directory in
development; packaged builds ignore `.env`. `main.js` resolves it *before*
requesting the single-instance lock, so an isolated dev/E2E run doesn't collide
with a live instance. Setting it also **disables** the legacy-folder carry-over.

`test/run-all.js` points `HOME`/`USERPROFILE` at a generated fixture profile and
loads `test/test-bootstrap.js` via `NODE_OPTIONS --require`, so production data is
never read or copied. Individual suites also `require` the bootstrap directly, as
a safety net for standalone runs — which is why files must require it **before**
computing any `os.homedir()`-based path.

⚠️ **`run-all.js` stops at the first failure**, so a single green run can hide a
second bug behind the first fix.

`npm test` alone does not prove the Knowledge Hub sanitizer works; run
`npm run test:e2e` for that.

CI (`ci.yml`, windows-latest, Node 24) runs `npm ci` → `npm audit --omit=dev
--audit-level=high` → `npm run lint` → `npm test` → `npm run test:e2e` →
`npm run pack`. `release.yml` on `v*` tags requires Windows signing credentials
and fails without them, generates a CycloneDX SBOM, verifies every Authenticode
signature, and writes `SHA256SUMS.txt`.
