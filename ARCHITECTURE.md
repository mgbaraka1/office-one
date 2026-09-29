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
- **Project & Finance** — Offers and Change Requests (CRs): a status stage trail, fee-bearing versions with uploaded files, follow-up/expiry reminders and Excel export.
- **Outsource** — external resources paid by the hour: an hourly rate history per person (being built in phases, see docs/OUTSOURCE_PLAN.md).
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
                     CRUD, validation, and analytics
                     (~5,200 lines — by far the largest file; see §10)
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
  features/          timesheet.js, tasks.js, workspace.js, clients.js, knowledge.js,
                     knowledge-sanitize.js, company-documents.js, pfm.js, outsource.js,
                     shell.js
  vendor/            quill/, dompurify/
migrations/          000_baseline.js … 066_outsource.js (append-only)
test/                40 *-smoke.js suites + run-all.js + electron-e2e.js + helpers
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

**Project & Finance** (migration 062, `pfm_` prefix — shares nothing with the
retired Finance tables, §5): `pfm_items` (one row per Offer or CR), `pfm_stages`
(who/when per status), `pfm_versions`, `pfm_version_files`, `pfm_history`.

- Rows are **private per login** (`user_id`), like tasks.
- `reference` is typed by the user; its folded `reference_key` is unique per
  login across Offers **and** CRs together. Per login, not install-wide, so one
  login cannot probe for another's hidden references.
- The stage person is **free text** (the UI offers a datalist of names already
  used), not a lookup. Status is the `PFM_STATUS` lookup; stage order is its
  `sort_order`, and `ACCEPTED`/`REJECTED` are final.
- The client contact is a name plus a **channel**: `EMAIL` (reference = title/subject) or
  `JIRA` (reference = an http(s) URL), the Task Sources split (064).
- Fees are **integer minor units** (never REAL) plus a `CURRENCY` lookup.
- Items, versions and files are soft-deleted via `deleted_at` — that stamp *is*
  the undo window; purge (or the next boot's maintenance) removes the row and
  the bytes. Ids stay stable across an undo.
- `pfm_history.item_id` is deliberately **not** a foreign key: like
  `lookup_code_history`, the audit outlives the record.

**Outsource** (migration 066, `outs_` prefix — a standalone module: no foreign
key to projects, `COMPANY`, `pfm_*`, tasks or work logs; only `CURRENCY` is shared):
`outs_resources` (one per external person paid), `outs_rates`, `outs_entries`,
`outs_statements`, `outs_statement_lines`, `outs_history`.

- Rows are **private per login** (`user_id`). An entry's project is **free text**.
- Rates are integer minor units **per hour** with an `effective_from` date; an
  entry is priced by the rate in force on its date, never stored. Fees are
  rounded half-up once per statement line (project × rate).
- An entry is **locked** while `statement_id` is set, which only issuing a
  statement does; issuing snapshots the lines so a later rate change cannot alter it.
- Soft delete via `deleted_at`, purged at the next boot, as in Project & Finance.

**Search**: `workspace_search` — a user-scoped, trigger-maintained FTS5 index.
Credentials and file contents are deliberately excluded. Client-infrastructure
rows use a composite `entity_id` of `ownerId:recordId` so a result can deep-link
back to its parent. Offers/CRs are kind `pfm` (reference + title + contact name),
indexed only while not deleted.

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
  `LOOKUP_MERGE_CATEGORIES` derive from that same array.

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
| 046, 049 | FTS5 workspace search, extended to client infrastructure |
| 047, 050 | bilingual client profiles and catalog labels |
| 048 | SQLite triggers enforcing lookup-category invariants (defense in depth) |
| 052 | forced password rotation |
| 053 | Client/Internal task domain separation — `department_id` is the single source of truth; there is deliberately **no** `tasks.kind` column |
| 054, 057, 060 | the Finance module — built, integrated, then fully retired by 061 |
| 056 | the global `company_profiles` table (survives Finance's removal — see §4.1) |
| 058 | `lookup_code_history` — the shared catalog gains an audit trail |
| 059 | seeds `TIME_TYPE` and `ACTIVITY_TYPE` on a **fresh** database, guarded on the category being empty |
| 061 | Finance removed entirely — every `finance_*` table dropped, its four catalog categories removed from `lookup_codes` (see §5) |
| 062 | Project & Finance (Offers & CRs) — the five `pfm_*` tables, additive only; seeds `PFM_STATUS` behind the 059-style empty-category guard |
| 063 | Offers & CRs join `workspace_search` — backfill plus three `workspace_search_pfm_items_*` triggers |
| 064 | `pfm_items.client_channel` (EMAIL/JIRA) + `client_channel_ref` (email subject or Jira URL) via ADD COLUMN; the contact email/phone and notes columns stay but are no longer shown |
| 065 | Repair: an Offer/CR whose status lags its furthest dated stage moves forward to it (history row per move); `savePfmStage` now does this on save |
| 066 | Outsource — the six `outs_*` tables (resources, rate history, time entries, statements + their line snapshots, history), additive only; resources and entries join `workspace_search` (kinds `outs-resource` / `outs-entry`) |

**A guarded seed is the right shape for a fresh-install gap.** Migration 003
seeded some categories from "legacy blob ∪ values already in the data", both
empty on a new database, so those categories ended up with zero rows and a
first-run user saw empty dropdowns. Migration 059 fixes that by seeding only when
a category is empty — which makes it a verified no-op on any curated catalog.
Never fix that class of gap by editing 003.

`COMPANY` is still deliberately empty on a fresh install: the client roster is
yours to create, and a seeded fake company would be worse than none.

## 5. Finance (retired)

Office ONE had a Finance module — contracts with versions and installments,
change requests, invoices with payment tracking and allocation, and minutes of
meeting, rendered on the client that owned them (Clients page **Finance** and
**Meetings** tabs, plus a catalog editor at Settings → Finance). It was removed
in full — code, schema, and catalog — by migration 061, at the owner's request,
to be redesigned from scratch rather than extended in place.

**What's actually gone**: `renderer/features/finance.js`, `renderer/finance.css`,
the `finance:*` IPC channels (`main.js`/`preload.js`/`ipc-contracts.js`), the
Finance section of `db.js`, every `finance_*` table (dropped by migration 061),
and the four catalog categories it contributed to `lookup_codes`
(`CONTRACT_STATUS`, `CR_STATUS`, `INVOICE_STATUS`, `PAYMENT_METHOD`).

**What deliberately survived** because migrations 056/058 had already promoted
it into shared, Finance-independent territory:
- `company_profiles` (§4.1) — the shared contact/address/tax-number record per
  company, now owned outright by the Clients page.
- The `COMPANY` and `CURRENCY` `lookup_codes` categories — Finance only ever
  read these, never owned them.
- `lookup_code_history` rows recorded against the four removed categories —
  per migration 058's own rule, an audit trail must survive the thing it
  describes disappearing, not cascade away with it.
- The old, already-dormant `finance_lookups` table from before migration 060 —
  left in place by that migration as a pre-migration record, and migration 061
  left it exactly as dormant.

A user's `<userData>/finance/{entityType}/{entityId}/` attachment files are not
touched by the migration (a schema change, not a filesystem one); they are
orphaned on disk unless cleaned up separately.

If you're reading this while planning the rebuild: don't restore the deleted
code as a starting point. The whole point of the removal was a clean-slate
redesign, not a revert.

**The rebuild is Project & Finance** (`pfm`, migrations 062–065,
`renderer/features/pfm.js`) — a new, narrower design for Offers and CRs only,
written from scratch (tables in §4.1, page in §7). It has no link to Projects,
and no contracts, invoices or payments. Its files live under
`<userData>/project_finance/`, never the old `finance/` folder.

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
Hub adds XLS/XLSX/TXT, and Project & Finance version files use the Knowledge Hub
list.

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
| | `pfm` | **Project & Finance** — Offers & CRs |
| | `outsource` | **Outsource** — external resources and their hourly rates |
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
command palette is a search surface, not the main menu.

**Client detail tabs** (`CLIENT_DETAIL_TYPES` in `renderer/features/clients.js`):
Overview / Projects / **Offers & CRs** / Access / Servers / Systems. The Offers &
CRs tab reuses the Project & Finance list rows, and its New buttons preset the
client.

**Project & Finance reminders** feed the Overview's Attention list (and the
sidebar badge) from `pfmAttentionItems()` in `db.js`: an item still **Sent** 7
days after its Sent date (`PFM_FOLLOW_UP_DAYS`), and a non-final item within 3
days of its *valid until* date or past it (`PFM_EXPIRY_WARN_DAYS`). Archived and
deleted items never appear.

- `(N)` counts are written by `updateClientDetailTabCounts()` **in place**
  rather than by rebuilding the toolbar — which would steal focus out of the
  search box beside it.
- Under an active detail search, sections fall back to a flat list of matching
  records.

**The Clients page owns the client roster.** The roster *is* the `COMPANY` lookup
catalog, so this is the only place it is managed: **+ New Client** (the one place
a company code is ever set), **Show archived**, **Arrange**, inline English/Arabic
name editing on a 300 ms debounce, and **Archive / Restore**. **Company Code** is
rendered read-only with a lock glyph — never an input, anywhere. Duplicate-company
merging lives in Settings → Maintenance.

**Settings tabs** come from `renderer/settings-registry.js` (minus
`settingsTab: false` entries) plus the hand-authored General, User Management,
**Backup Data** and Maintenance tabs. Every tab is visible to every
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

174 channels, named `domain:action`. Domains: `auth`, `app`, `days`, `companies`,
`systems`, `analytics`, `attention`, `activity`, `lookups`, `subscriptions`,
`tasks`, `search`, `worklogs`, `day`, `projects`, `departments`, `internal`,
`companydocs`, `knowledge`, `pfm` (24 channels), `clients`, `ui`, `preferences`, `db`,
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
npm test           # test/run-all.js — 41 headless smoke suites
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

It also gives the run its own temp root and points every child's `os.tmpdir()`
at it, then deletes that root once the children have exited. Each suite still
removes its own work directory, but on Windows that in-process attempt loses the
race against any file handle the OS has not released yet, and every caller
treats a leftover temp directory as not-a-failure — so the parent's delete is
what actually guarantees nothing accumulates. Read a row straight off a database
file with `readRow()` from `test/raw-db.js` rather than an inline
`new DatabaseSync(...).prepare(...)`: that form never names its handle, so
nothing closes it and the file stays locked for the rest of the process.
`static-quality-smoke.js` enforces both.

⚠️ **`run-all.js` stops at the first failure**, so a single green run can hide a
second bug behind the first fix.

`npm test` alone does not prove the Knowledge Hub sanitizer works; run
`npm run test:e2e` for that.

CI (`ci.yml`, windows-latest, Node 24) runs `npm ci` → `npm run lint` →
`npm test` → `npm run test:e2e` → `npm run pack` → `npm audit --omit=dev
--audit-level=high`.

The audit runs **last on purpose**: it is the only step that depends on a
service outside GitHub, so it is the one most likely to fail for reasons that
have nothing to do with the commit. Running it earlier means an npm outage
skips everything after it and the run reports nothing about the code. It also
retries a registry that does not answer, and reads its verdict out of the
audit's own JSON rather than an exit code — a reachable registry reporting a
high or critical advisory fails immediately and is never retried, while an
audit that could not be performed still fails the build rather than passing by
default.

Both workflows run that gate from one file, `scripts/audit-production-deps.ps1`,
so a release can never apply a weaker check than CI. In `release.yml` it sits
after the tests but **before** `build:win`, so nothing is packaged, signed or
published on an uncleared dependency tree. `release.yml` on `v*` tags signs the installers when Windows
signing credentials are configured — building unsigned with a warning when they
are not — generates a CycloneDX SBOM, verifies every Authenticode signature when
the build was signed, and writes `SHA256SUMS.txt`.
