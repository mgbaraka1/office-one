# Cooperation Tools

An offline, **multi-user** desktop app for tracking daily **timesheets**, a **"Not Yet"** task backlog, and recurring **subscriptions** — with read-only **analytics** and print-ready **PDF reports**.

Everything runs locally in an embedded SQLite database. No server, no network, no cloud. Each account's data is isolated, so a small team can share one machine (or each run their own copy from a clone) and only ever see their own data.

---

## Features

- **🕐 Timesheet** — a per-day view of your **work sessions**. Work is modeled in two levels: a **task** (a named, date-independent unit — company, system, activity, status, source, tags) owns one or more **work logs** (individual sessions — date, what was done, minutes, time type). A task can span several sessions across several days; add sessions inline and edit task name, minutes, and status right in the table, with a live timer, bulk actions, and a month overview.
- **📌 Not Yet** — the backlog: **tasks with no sessions logged yet**. Add them day-agnostically, then assign one to a date (which logs its first session and moves it into that day's timesheet).
- **📋 Projects** — a container for a client/system engagement: a profile, a configurable set of tracked documents (seeded Quotation, Quotation Approval, Invoice) shown as file cards, and links to existing tasks (each shown with its work sessions).
- **💳 Subscriptions** — recurring-cost manager with per-currency renewal tracking and "renews in" badges.
- **📊 Analytics** — the home overview: KPIs, hours by company/system, daily-hours trend, donuts, and a GitHub-style activity heatmap. All totals are aggregated in SQL.
- **📄 Reports** — one-click PDF reports (daily timesheet, monthly over-time request, subscriptions) via an in-app print/preview overlay.
- **🔐 Accounts** — each user has their own login; passwords are bcrypt-hashed; all data is owned per-user.

---

## Tech stack

| Layer | Choice |
|---|---|
| Desktop shell | **Electron** `^42` (bundles Node 24, Chromium) |
| Storage | Embedded **SQLite** via Node's built-in `node:sqlite` — no native build |
| Passwords | **bcryptjs** (pure JS, saltRounds 12 — keeps the zero-native-modules property) |
| UI | Vanilla HTML/CSS/JS in a single `index.html`; hand-rolled SVG charts; Quicksand font |
| Packaging | **electron-builder** (NSIS installer + portable, Windows) |

There is **no build/transpile step for development** and **no native modules to compile** — a fresh clone runs directly.

---

## Getting started

### Prerequisites
- [Node.js](https://nodejs.org/) 18+ (used to run `npm` / Electron; the app itself uses the Node bundled inside Electron)
- Windows is the primary target; the app is cross-platform but packaging is configured for Windows.

### Install & run
```bash
git clone <repo-url>
cd TimeSheet
npm install      # installs Electron + electron-builder + bcryptjs
npm start        # launches the app (electron .)
```

### First run — create your account
On first launch (an empty database) the app shows a **one-time setup screen**. Enter a username (3–32 chars) and a password (8+ chars) to create the first account — you're logged straight in.

On later launches you'll get a **login screen**: there is no "remember me" / auto-login, so you sign in each session. Use **🚪 Log Out** in the sidebar to end a session.

> Migrating an existing single-user database? The first account you create automatically **claims all pre-existing data**, so your history is right there after you log in.

### Build installers
```bash
npm run build      # electron-builder (current OS)
npm run build:win  # Windows NSIS installer + portable
npm run pack       # unpacked dir (no installer) for quick inspection
```

---

## Where your data lives

| | Path (Windows) |
|---|---|
| Database | `%APPDATA%\timesheet\cooperation-tools.db` (+ `-wal`/`-shm`) |
| Backups | `%APPDATA%\timesheet\backups\` (rotating, newest 5 + manual 💾 backups) |

On macOS the folder is `~/Library/Application Support/timesheet/`; on Linux `~/.config/timesheet/`. The store is created automatically on first launch. You can override the location for testing/portable use — see [`.env.example`](.env.example) (`COOPERATION_TOOLS_DATA_DIR`, development only).

> ⚠️ The on-disk folder is named `timesheet` because Electron derives it from `package.json`'s `"name"`. **Do not change that name** or the app will point at an empty folder and appear to "lose" all history.

---

## Architecture (short version)

- **`main.js`** — Electron main process: window lifecycle + thin, **authenticated** IPC handlers. Every data handler is scoped to the logged-in user's id taken from the main-process session (never trusted from the renderer).
- **`auth.js`** — bcryptjs hashing + the in-memory session.
- **`db.js`** — the data layer: connection, the versioned **migration runner** (`openConnection` → `applyMigrations` → `runMaintenance`), and all SQL (per-entry upserts, SQL-side analytics aggregation).
- **`migrations/`** — numbered, append-only schema migrations (`000_baseline`, `001_auth`, `002_normalize`, … up to `014_drop_backlog`) tracked in a `schema_migrations` table. Migration `012` introduced the two-level `tasks` + `work_logs` model (splitting the old `day_entries`); `013` merged the `backlog` pool into zero-session tasks, and `014` dropped the now-empty `backlog` table.
- **`preload.js`** — `contextBridge` exposing `window.api`; each method calls a scoped `domain:action` IPC channel.
- **`ipc-types.js`** — JSDoc type definitions for every IPC request/response shape.
- **`index.html`** — the entire renderer UI (auth gate + all modules).

Data is **normalized** around a two-level work model: a **`tasks`** row (date-independent) owns child **`work_logs`** (one per work session, carrying the date); a task with zero work_logs is a "Not Yet" backlog item. The `days` table is kept only as per-date metadata (the employee name for reports). `subscriptions` are owned per user; `projects` own their tracked `project_documents` and are linked from `tasks` via a nullable `project_id`; shared config lives in `app_settings`, machine-only state in `machine_prefs`.

See [`CLAUDE.md`](CLAUDE.md) for the full developer reference.

---

## License

ISC © Moustafa Baraka
