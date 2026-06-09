# Cooperation Tools

A lightweight **offline desktop app** for tracking day-to-day operational records — built with [Electron](https://www.electronjs.org/). It bundles four independent modules behind a single sidebar:

| Module | What it tracks |
| --- | --- |
| 🕐 **Timesheet** | Daily work records (company, project, task, time type, minutes) with a live timer, totals, filtering, carry-over of unfinished items, CSV export, and a print-ready daily report. |
| 💳 **Subscriptions** | Recurring subscriptions with cost, billing cycle, and colour-coded renewal alerts. |
| 📜 **Licenses** | Licenses / registrations / governmental documents, with dual **Hijri + Gregorian** dates and Arabic (RTL) support. |
| 🛡️ **Insurance** | Car & medical insurance policies (provider, policy number, expiry alerts). |

There is **no server to run and nothing to install or configure** — all data lives in a single self-contained **SQLite database file** that the app creates automatically on first launch. The app works fully offline (the only network request is the Quicksand web font, and it degrades gracefully to a system font without it).

---

## Prerequisites

- **[Node.js](https://nodejs.org/) 18 or newer** (includes `npm`). Check with:
  ```bash
  node -v
  npm -v
  ```

That's the only prerequisite. There is **no build step, no database engine to install, no migrations or seed commands to run, and no environment variables or API keys to configure.** The database is an embedded SQLite file created and initialised entirely in code at startup — clone, `npm install`, `npm start`, done.

---

## Quick start

```bash
# 1. Clone the repository
git clone <repo-url>
cd TimeSheet

# 2. Install dependencies (downloads Electron)
npm install

# 3. Launch the app
npm start
```

The app opens into the **Timesheet** module for today's date. Start adding records with **+ Add Record** (or `Ctrl+N`).

> First launch creates the SQLite database automatically, applies the schema, and seeds the **Licenses** module with a few example records. Nothing else is pre-populated. (If you're upgrading from an older JSON-file version of the app, your existing data is imported into the database automatically on that first launch — see below.)

---

## Where your data lives

All data is stored in a single SQLite database file under your OS user-data directory — **outside this repo**, so it is never committed and survives reinstalls/updates:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\timesheet\` |
| macOS | `~/Library/Application Support/timesheet/` |
| Linux | `~/.config/timesheet/` |

```
timesheet/
├── cooperation-tools.db        # the embedded SQLite database (all your data)
├── cooperation-tools.db-wal    # write-ahead log (SQLite working files —
├── cooperation-tools.db-shm    #   created/managed automatically)
└── …                           # legacy *.json files from older versions, if any
```

The app uses **Node's built-in `node:sqlite`** (which ships inside Electron — there is no native module to compile and nothing extra to `npm install`). Writes run in transactions with SQLite's write-ahead log enabled, so a save is atomic and crash-safe. To **back up** your data, copy `cooperation-tools.db` (or the whole `timesheet` folder). To **migrate** to another machine, copy it into the same location there.

> **Upgrading from the old JSON-file version?** On the first launch after the upgrade, the app detects your existing `days/*.json`, `lookups.json`, `subscriptions.json`, `licenses.json`, `insurance.json`, and `prefs.json` files and imports them into the new database automatically. **The original JSON files are left completely untouched** as a safety backup — nothing is moved or deleted.

> ⚠️ The on-disk folder is named `timesheet` because Electron derives it from the `"name"` field in `package.json`. **Do not rename that field** — doing so points the app at a brand-new empty folder and your history will appear to vanish (it's still on disk under the old name).

---

## Tech stack

- **Electron 42** — desktop shell (Node.js main process + Chromium renderer)
- **Vanilla HTML / CSS / JS** — no frameworks, no bundler
- **Storage** — embedded **SQLite** via Node's built-in `node:sqlite` (no server, no external engine, no native module to build)
- **Font** — Quicksand (Google Fonts)

### Project layout

```
main.js       — Electron main process: window + IPC handlers (thin pass-through to db.js)
db.js         — data layer: opens/creates the SQLite DB, schema, seed + first-run JSON import
preload.js    — context bridge exposing window.api to the renderer
index.html    — the entire UI (styles + markup + logic in one file)
package.json  — metadata & the `npm start` script
```

The renderer never touches the database directly; it calls typed IPC methods on `window.api` (see `preload.js`). The main process forwards those to `db.js`, which runs the actual SQLite queries. The database connection is opened, the schema created, and seed/migration applied automatically in `db.init()` at startup.

---

## Usage notes

- **Auto-save** — every change is saved automatically (300 ms debounce); no Save button.
- **Keyboard** — `Ctrl+N` add record · `Ctrl+Enter` submit modal · `Esc` close modal · `Ctrl+←/→` move between saved days.
- **Calendar** — days with data are highlighted green; click any day to open it.
- **Carry-over** — unfinished ("Not Yet") items from past days surface on today's view so nothing is lost.
- **Export** — per-day CSV, a date-range CSV, or a print/PDF daily report.
- **Undo** — deletes show a 5-second undo toast; there are no hard, unrecoverable deletes.

---

## Building a standalone installer (optional)

`npm start` is all you need for day-to-day use. To produce a distributable `.exe` / `.dmg` / `.AppImage`, add a packager such as [electron-builder](https://www.electron.build/):

```bash
npm install --save-dev electron-builder
npx electron-builder
```

(No packaging config is committed — the app is intended to be run from source.)

---

## License

ISC © Moustafa Baraka
