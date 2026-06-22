# Cooperation Tools — Refactor Proposal

**Status:** Phase 1 — analysis only. **No code or schema has been changed.** This document is a proposal for review.

**Backup taken before analysis:** `%APPDATA%\timesheet\backups\bkb-db-before-refactor.db` (+ `-wal`/`-shm`)
- Integrity check: `ok` · Size: 98,304 bytes · SHA-256 `E6541EE4FCFF8128E45BA5EED9C3EDB21B06C8784DEB1E52B39597524D325EF1`
- Verified contents: `days` 22 · `meta` 4 · `subscriptions` 1 · `backlog` 0

**Goal:** make the app (a) distributable / multi-user-multi-machine capable, (b) scalable under large data volumes, (c) free of ambiguity in naming, relationships, and data contracts.

**Reality check up front.** This is today a deliberately offline, single-user, single-file SQLite desktop app — and that design is *correct* for its current job. "Distributable / multi-user / multi-machine" is a fundamental product shift (it requires identity, ownership, concurrency control, and a sync or server tier) — not a refactor of the existing store. This proposal therefore separates **(A) low-risk improvements that pay off immediately even if you stay single-user** from **(B) the structural work that genuinely unlocks multi-user/multi-machine.** You can adopt A without committing to B.

---

## Current state (as audited)

| Table | Columns | Notes |
|---|---|---|
| `days` | `date PK`, `name`, `rows` | `rows` is a **JSON array blob** of variable-shape row objects. `name` = employee name, duplicated on every day. |
| `subscriptions` | `id PK`, `name`, `cost`, `currency`, `billingCycle`, `endDate`, `renewalDate`, `sort_order` | every business column nullable; `cost` stored as **TEXT**; dates as TEXT. |
| `backlog` | `id PK`, `company`, `project`, `natural`, `time`, `description`, `source`, `tags`, `sort_order` | `tags` is a **JSON string**; `natural`/`time` are ambiguous names; all nullable. |
| `meta` | `key PK`, `value` | generic K/V holding **four unrelated domains**: `lookups` (JSON), `subscriptions_default_currency` (string), `window_prefs` (JSON), migration flags. |

Persistence contract: the renderer holds each collection fully in memory (`backlog[]`, `subscriptions[]`, `rows[]`, `dayCache{}`) and saves via **whole-collection replace** (`DELETE FROM …; re-INSERT all`) or **whole-day JSON rewrite**, on a 300 ms debounce. All filtering/search/analytics happens in renderer JS over fully-materialized data. `node:sqlite` `DatabaseSync` runs **synchronously on the main process**.

---

## 1. Database Schema Issues

### 1.1 Ambiguous / generic column names
- **`days.name`** — actually the *employee name*. Reads as a row label. → `employee_name` (or, once identity exists, a FK to `users`).
- **`backlog.natural`** — the "nature" of the task (Ticket/Task/Meeting/Call). Non-obvious and collides with the English word. → `activity_type`.
- **`backlog.time` / `subscriptions.billingCycle`** — `time` holds a *time-type category* ("Work Time"/"Over Time"…), not a timestamp. → `time_type`.
- **`meta.key` / `meta.value`** — `value` is overloaded across JSON configs, a scalar string, and boolean flags. No domain meaning at the column level. (See 1.3.)
- **Per-row JSON keys inside `days.rows`** (`company`, `project`, `natural`, `time`, `description`, `source`, `status`, `minutes`, `tags`) are invisible to SQL entirely — undocumented, unvalidated, and only enforced by renderer convention.
- **Risk:** Low to rename · **Type:** DB migration + code (every `db.js` query + renderer field reference).

### 1.2 Missing / implicit foreign-key relationships
- **No relationships exist at all.** There are zero FKs even though `foreign_keys=ON` is set.
- **Backlog → Day assignment loses its link**: `assignBacklogToDay()` *deletes* the backlog task and appends a copy into a day's JSON. There is no record that day-row X originated from backlog task Y — no provenance, no reversibility at the data layer.
- **Lookups are not referential**: `company`/`project`/`activity_type`/`time_type`/`status` are free-text strings repeated in every row and in `meta.lookups`. Renaming "Amana" → "Amana Co." cannot cascade; typos create silent new categories; you cannot ask "all rows for company 7".
- **Fix direction:** introduce reference tables (`companies`, `projects`, `activity_types`, `time_types`, `statuses`) and FK from a normalized `day_entries` table; keep the lookup *labels* but back them with stable IDs.
- **Risk:** Medium · **Type:** DB migration + code.

### 1.3 Tables that mix concerns
- **`meta`** is four tables in a trench coat: app config (`lookups`), a user setting (`subscriptions_default_currency`), machine/window state (`window_prefs`), and internal migration flags (`notyet_backlog_migrated`). These have different lifecycles, owners (user vs machine vs schema), and sync semantics (window bounds must *never* sync across machines; currency *should*).
- **`days`** mixes a per-day fact (employee name, date) with an unbounded collection (all entries for that day) in one JSON cell.
- **Fix direction:** split into `app_settings` (synced, typed), `machine_prefs` (never synced), and `schema_migrations` (version ledger). Promote `days.rows` into a real `day_entries` child table.
- **Risk:** Medium · **Type:** DB migration + code.

### 1.4 Absence of indexes
- Only the implicit PK indexes exist. `days.date` PK covers the range scans (fine today). But:
  - Subscriptions are sorted by computed renewal urgency in JS — no index, and `renewalDate` is TEXT so even a SQL `ORDER BY` would be string-sorted.
  - Once `day_entries` exists, you'll need indexes on `(day_date)`, `(company_id)`, `(status_id)`, `(time_type_id)` for the filters/analytics that today scan everything in JS.
- **Risk:** Low · **Type:** DB migration. (No-downside once the normalized tables exist.)

### 1.5 NULL overuse where NOT NULL + DEFAULT fits
- `subscriptions`: `name, cost, currency, billingCycle, endDate, renewalDate` are all nullable, yet the app treats name/cost/currency/renewal as required and coalesces `?? ''` everywhere on write. `sort_order` nullable.
- `backlog`: every business column nullable, all coalesced to `''` on read and write.
- This pushes validation entirely into JS and allows a half-formed row to reach disk. → `NOT NULL DEFAULT ''` for text the UI guarantees, `NOT NULL` (no default) for genuinely required fields, and a real numeric type for `cost`.
- **Risk:** Low–Medium (must backfill existing NULLs first) · **Type:** DB migration.

### 1.6 Multi-value fields in a single column
- **`days.rows`** — an entire array of entry objects in one TEXT cell. This is the single biggest structural issue: no per-entry query, no per-entry index, no partial update (one edit rewrites the whole day), no referential integrity, and analytics must parse every day's blob in JS.
- **`backlog.tags`** and the per-row `tags` inside `days.rows` — JSON arrays in a cell. Not searchable in SQL; renderer does substring matching. → a `tags` table + `entry_tags` / `backlog_tags` join (or, pragmatically, keep JSON for tags but normalize entries first — tags are low-value to query vs entries).
- **`subscriptions.cost` as TEXT** — a number stored as a string; cannot `SUM`/compare in SQL (the Analytics "recurring spend" rollups are done in JS for this reason).
- **Risk:** High (entries are the core data) · **Type:** DB migration + significant code.

### 1.7 Naming inconsistencies
- **Mixed case:** `sort_order` (snake) alongside `billingCycle`, `endDate`, `renewalDate` (camel) in the *same table*. SQL columns should be uniformly `snake_case`; map to camelCase at the JS boundary.
- **Plural vs singular:** tables are plural (`days`, `subscriptions`, `backlog`) — acceptable, just make it a documented rule and keep new tables consistent (`day_entries`, `companies`, …).
- **`backlog`** (singular collective) vs the rest — fine, but document that it's the "Not Yet" pool.
- **Risk:** Low · **Type:** DB migration + code (rename touches every query).

---

## 2. Scalability Limitations

### 2.1 Whole-collection-replace writes (the headline problem)
`saveBacklog()` and `saveSubscriptions()` do `DELETE FROM <table>; INSERT every row` **on every 300 ms-debounced save** ([db.js:281](db.js#L281), [db.js:312](db.js#L312)). Editing one of 5,000 backlog tasks rewrites all 5,000 rows. Cost grows O(n) per keystroke-batch. Same shape for **`days.rows`**: one minute-edit serializes and rewrites the entire day's JSON ([db.js:239](db.js#L239), renderer [index.html:2552](index.html#L2552)).
- **Fix:** granular CRUD — `addEntry`/`updateEntry`/`deleteEntry`, `upsertSubscription(id,…)`, `deleteSubscription(id)`. Write only what changed.
- **Risk:** Medium · **Type:** code + (depends on) the `day_entries` migration.

### 2.2 No SQL aggregation — everything materializes in the renderer
Analytics (`renderAnalytics`, [index.html:3970](index.html#L3970)) calls `loadDaysRange(from,to)`, ships **every day's full JSON** to the renderer, parses it, and computes KPIs/heatmaps/donuts/spend in JS. "This Year" already loads ~365 blobs; at multi-year scale this is the whole DB in memory each visit.
- **Fix:** push aggregation into SQL (`SELECT company_id, SUM(minutes) … GROUP BY`) against `day_entries` with indexes; return small result sets. Reports likewise.
- **Risk:** Medium · **Type:** code + migration.

### 2.3 No pagination anywhere
`listDays()` returns *all* dates ([db.js:253](db.js#L253)); `loadBacklog()`/`loadSubscriptions()` return entire tables. Fine at 22 days; not at thousands. Timesheet/Not-Yet tables render every row to DOM.
- **Fix:** `LIMIT`/`OFFSET` or keyset pagination + virtualized/long-list rendering for the big tables.
- **Risk:** Medium · **Type:** code (+ DB query support).

### 2.4 Synchronous SQLite on the main process
`DatabaseSync` blocks the Node event loop for the duration of each query ([db.js:19](db.js#L19)). Trivial today; with full-table rewrites over large tables it can stall IPC and the close-handshake. The full-DB `wal_checkpoint(TRUNCATE)` + file copy on **every launch** ([db.js:224](db.js#L224)) also grows with DB size.
- **Fix (incremental):** once writes are granular (2.1) the per-op cost drops sharply. Longer term, move DB work to a worker thread / `better-sqlite3` worker, or async driver, so the main process never blocks.
- **Risk:** Medium–High · **Type:** code (architecture).

### 2.5 Unbounded in-memory caches
`dayCache{}` ([index.html:1844](index.html#L1844)) accumulates every visited day for the session with no eviction; `backlog[]`/`subscriptions[]`/`rows[]` are full mirrors. Acceptable for a single user's data; unbounded as volume grows.
- **Fix:** LRU-cap `dayCache`; rely on paginated queries instead of full mirrors for the large collections.
- **Risk:** Low · **Type:** code.

> Note: queries already select explicit columns (no `SELECT *`), and `loadDaysRange` already collapses the old N-round-trip pattern into one query — those are good and should be preserved.

---

## 3. Distributability Blockers

### 3.1 No identity or ownership — the fundamental blocker
There is **no concept of a user** in the schema. `days.name` is a free-text label, not an account. Multi-user requires a `users` table and an `owner_id` (or `user_id`) FK on `days`/`day_entries`, `subscriptions`, `backlog`, plus auth. Until then "multi-user" is impossible regardless of where the file lives.
- **Risk:** High · **Type:** DB migration + code + product decision.

### 3.2 Single-file local SQLite assumes single-writer, single-machine
The store is one file in `userData` opened in WAL mode ([db.js:136](db.js#L136)). WAL gives one writer at a time and **no cross-machine concurrency or conflict resolution**. Sharing the file over a network drive is unsafe (SQLite + network FS = corruption risk). Real multi-machine needs either a server DB (Postgres/MySQL) behind an API, or a sync engine (e.g. Turso/libSQL, Litestream replication, or CRDT-based sync).
- **Risk:** High · **Type:** architecture (new tier) + migration.

### 3.3 Machine-specific state mixed into the data store
`window_prefs` (window bounds/maximized) live in `meta` *inside the synced database* ([db.js:327](db.js#L327)); theme lives in renderer `localStorage` (`ct-theme`) and is **never persisted to the DB at all**. If you ever sync the DB, window bounds would wrongly travel between machines, and theme wouldn't travel even though the user might want it to.
- **Fix:** separate `machine_prefs` (never synced: window bounds, last-open module) from `user_settings` (synced: theme, default currency, default name).
- **Risk:** Low–Medium · **Type:** DB migration + code.

### 3.4 Client-generated IDs
Backlog/subscription IDs are minted in the renderer/migration as `Date.now()+random` ([db.js:181](db.js#L181), renderer). Low collision risk single-user, but not globally unique under concurrent multi-machine inserts. → UUIDv4/v7 (v7 is time-sortable, good for `sort_order` replacement) generated consistently, ideally server- or db-side.
- **Risk:** Low · **Type:** code.

### 3.5 `app.getPath('userData')` path derived from `package.json` "name"
Documented landmine: the data folder is `timesheet` because the app name is `timesheet` ([main.js:142](main.js#L142), CLAUDE.md). This is fine and must be preserved single-user, but it's an implicit machine-local binding — any distributed deployment must take the DB location/connection from **config**, not a hard-coded derived path.
- **Risk:** Low (today) · **Type:** code (config layer) when distributing.

---

## 4. Ambiguity in App Architecture

### 4.1 IPC channels are coarse and overloaded
- `saveSubscriptions(data)` both **replaces the whole table** *and* writes `meta.subscriptions_default_currency` ([db.js:312](db.js#L312)) — two concerns, one channel. `loadSubscriptions()` returns `{subscriptions, defaultCurrency}` mixing collection + setting.
- `saveBacklog`/`saveSubscriptions` are "replace entire collection" verbs masquerading as saves — there is no `add/update/delete` vocabulary. The contract hides O(n) cost (see 2.1).
- **Fix:** granular, single-responsibility channels (`subscriptions:list/upsert/delete`, `settings:get/set`); namespace channel names (`day:*`, `backlog:*`, `report:*`).
- **Risk:** Medium · **Type:** code.

### 4.2 Functions spanning multiple concerns
- `db.init()` ([db.js:134](db.js#L134)) opens the DB, sets PRAGMAs, creates schema, runs **three** different one-time migrations, drops dead tables, **and** rotates backups — boot + schema + data-migration + maintenance in one function. → split into `open()`, `migrate()` (versioned), `maintenance()`.
- Renderer `index.html` is a single ~4,615-line file holding all styles, markup, and JS for five modules + the DB-shaped concerns. Module boundaries exist by convention only.
- **Risk:** Medium (init/migration) / High effort (renderer split) · **Type:** code.

### 4.3 Migration strategy is ad-hoc, not versioned
Each migration self-guards differently: `isNew` flag, a `meta` boolean (`notyet_backlog_migrated`), or `DROP IF EXISTS`. There's no `schema_version` / migrations ledger, so ordering and idempotency are reasoned about case-by-case — fragile as more accrue.
- **Fix:** a `schema_migrations` table + ordered, numbered migration runner. (Also the foundation Phase 2 needs.)
- **Risk:** Low–Medium · **Type:** DB + code.

### 4.4 Async patterns — mostly consistent, with fire-and-forget gaps
Main/preload/renderer are uniformly Promise/`async-await` (good). But `db.js` is fully synchronous, and a few renderer saves are fire-and-forget (`Promise.resolve(window.api.saveLookups(...)).catch(...)`, [index.html:2048](index.html#L2048)) — failures only toast, the user isn't blocked, and there's no retry. Acceptable as a choice, but it should be a *documented* policy, not incidental.
- **Risk:** Low · **Type:** code + docs.

### 4.5 Magic numbers / undocumented constants
Scattered literals with business meaning: `300` ms save debounce (×3 modules), `1500` ms close fallback ([main.js:58](main.js#L58)), `350` ms PDF font-settle ([main.js:110](main.js#L110)), `5` backups kept ([db.js:224](db.js#L224)), `5000` ms busy_timeout, `1440` minute cap, renewal thresholds `7`/`30` days, heatmap `26` weeks. → named constants in one config module, documented.
- **Risk:** Low · **Type:** code.

### 4.6 Business rules embedded implicitly
"In Progress vs Done" grouping, "Over Time" → red, renewal urgency buckets (`urgent`/`soon`/`ok`), and the entry/task/subscription **shapes** live only in renderer code and CLAUDE.md prose — there is no schema-level or shared-module definition of a valid record. → a single shared "data contract" module (field names, types, allowed values) imported by both validation and DB layers.
- **Risk:** Low–Medium · **Type:** code.

---

## 5. Proposed Refactor Plan

Two tracks. **Track A** is safe, high-value, and worthwhile even if the app stays single-user forever. **Track B** is the structural product shift to multi-user/multi-machine — larger, riskier, and a real product decision, not just engineering.

### Foundations (do first — everything else builds on these)

| # | Change | Why | Risk | Kind |
|---|---|---|---|---|
| F1 | Add `schema_migrations` table + a numbered, idempotent migration runner; refactor `db.init()` into `open()` / `migrate()` / `maintenance()`. | Replaces three ad-hoc guards; makes every later step safe, ordered, reversible. (§4.2, §4.3) | Low | DB + code |
| F2 | Extract a shared **data-contract / constants module** (field names, types, allowed values, the magic numbers from §4.5). | Single source of truth for record shapes and tunables before we touch the schema. (§4.5, §4.6) | Low | Code |

### Track A — single-user improvements (recommended regardless of distribution)

| # | Change | Why | Risk | Kind | Order |
|---|---|---|---|---|---|
| A1 | **Normalize `days.rows` → `day_entries`** child table (one row per entry, typed columns, `minutes` INTEGER, FK `day_date → days.date`). Keep `tags` as JSON on the entry for now. | Kills the biggest structural issue (§1.6): enables per-entry CRUD, indexes, and SQL analytics. | High | DB + code | 1 |
| A2 | **Granular writes**: replace whole-collection DELETE+INSERT and whole-day rewrites with `add/update/delete` for entries, backlog, subscriptions. | Removes O(n)-per-save (§2.1); the single biggest scalability win. | Medium | Code | 2 (needs A1) |
| A3 | **Type & constrain columns**: `subscriptions.cost` → NUMERIC; dates validated; `NOT NULL DEFAULT ''`/`NOT NULL` per §1.5; backfill existing NULLs in-migration. | Pushes validation to the schema; enables SQL `SUM`/sorting. (§1.5, §1.6) | Medium | DB + code | 3 |
| A4 | **Reference tables** for companies/projects/activity_types/time_types/statuses + FKs from `day_entries`/`backlog`; lookups become referential. | Real relationships, rename-safe categories, no typo-categories. (§1.2) | Medium | DB + code | 4 |
| A5 | **Indexes** on `day_entries(day_date)`, `(company_id)`, `(status_id)`, `(time_type_id)`; `subscriptions(renewal_date)`. | Supports A6 filters/aggregation at scale. (§1.4) | Low | DB | 5 |
| A6 | **SQL aggregation + pagination**: move Analytics/Reports rollups into `GROUP BY` queries; add `LIMIT`/keyset paging to list endpoints; LRU-cap `dayCache`. | Stops materializing the whole DB in the renderer. (§2.2, §2.3, §2.5) | Medium | Code | 6 |
| A7 | **Rename for clarity & consistency**: `days.name→employee_name`, `backlog.natural→activity_type`, `time→time_type`; all SQL columns `snake_case`, mapped to camelCase at the JS boundary. | Removes naming ambiguity/inconsistency. (§1.1, §1.7) | Low | DB + code | 7 |
| A8 | **Split `meta`** into `app_settings` (synced/typed), `machine_prefs` (window bounds, never synced), `schema_migrations` (from F1). | Untangles four lifecycles; prerequisite for clean sync later. (§1.3, §3.3) | Medium | DB + code | 8 |
| A9 | **Granular, namespaced IPC** (`day:*`, `backlog:*`, `subscriptions:*`, `settings:*`) replacing replace-whole-collection channels. | Single-responsibility contracts; hides no hidden O(n). (§4.1) | Medium | Code | 9 |
| A10 | **UUIDv7 IDs** for all entities (replaces `Date.now()+random` and doubles as sort key). | Global uniqueness + time-sortable; readies B. (§3.4) | Low | Code | 10 |

### Track B — distributability (multi-user / multi-machine) — requires explicit product decision

| # | Change | Why | Risk | Kind |
|---|---|---|---|---|
| B1 | **Identity**: `users` table + `owner_id` FK on `days`/`day_entries`/`subscriptions`/`backlog`; auth. Backfill existing data to a single default user. | No multi-user is possible without ownership. (§3.1) | High | DB + code |
| B2 | **Connection from config**, not derived path; abstract `db.js` behind a repository interface so the backend is swappable. | Removes the machine-local `userData` binding for distributed deploys. (§3.5) | Medium | Code |
| B3 | **Choose a distribution model** and implement it: (a) server DB (Postgres) + REST/IPC-over-network API, or (b) embedded-replica sync (libSQL/Turso, Litestream), or (c) CRDT/offline-first sync. Each needs conflict resolution. | Single-file WAL cannot do multi-machine safely. (§3.2) | High | Architecture + migration |
| B4 | **Move DB off the main thread** (worker thread / async driver) so network/server latency never blocks the UI. | Sync `DatabaseSync` on main is fine locally, not over a network tier. (§2.4) | Medium–High | Code |

### Suggested overall order
`F1 → F2 → A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8 → A9 → A10`, then — only if the product decision is made — `B1 → B2 → B3 → B4`.

Rationale: F1/F2 make every later step safe and versioned. A1 (normalize entries) is the keystone that unblocks granular writes (A2), SQL analytics + indexes (A5/A6), and real FKs (A4). Renames (A7) and the `meta` split (A8) are mechanical once the structure is right. Track B is deliberately last and gated — it changes the product, not just the code.

---

## Risk summary & guardrails for Phase 2

- **Production data is in daily use.** Every migration in Phase 2 will: (1) verify `bkb-db-before-refactor.db` still exists and is readable, (2) take a fresh timestamped snapshot, (3) run inside a single transaction, (4) be re-runnable (idempotent via `schema_migrations`), and (5) be followed by a boot + core-flow smoke test before the next step.
- **No destructive step without a recovery copy** — consistent with the app's existing confirm-+-undo discipline.
- **Highest-risk items**: A1 (`day_entries` normalization — touches the core data and the entire Timesheet renderer) and anything in Track B. These should be staged and verified independently.
- **Lowest-risk, high-value quick wins** if you want partial adoption: F1, F2, A5 (indexes), A7 (renames), A10 (UUIDs), and the magic-number extraction in A6/§4.5.

**Awaiting your review.** Tell me which track(s) and which numbered items to implement, and I'll proceed in dependency order per the Phase 2 guardrails.
