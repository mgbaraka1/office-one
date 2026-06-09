# Cooperation Tools

A lightweight **offline desktop app** for tracking day-to-day operational records — built with [Electron](https://www.electronjs.org/). It bundles four independent modules behind a single sidebar:

| Module | What it tracks |
| --- | --- |
| 🕐 **Timesheet** | Daily work records (company, project, task, time type, minutes) with a live timer, totals, filtering, carry-over of unfinished items, CSV export, and a print-ready daily report. |
| 💳 **Subscriptions** | Recurring subscriptions with cost, billing cycle, and colour-coded renewal alerts. |
| 📜 **Licenses** | Licenses / registrations / governmental documents, with dual **Hijri + Gregorian** dates and Arabic (RTL) support. |
| 🛡️ **Insurance** | Car & medical insurance policies (provider, policy number, expiry alerts). |

There is **no server and no database** — every record is a plain JSON file on your machine. The app works fully offline (the only network request is the Quicksand web font, and it degrades gracefully to a system font without it).

---

## Prerequisites

- **[Node.js](https://nodejs.org/) 18 or newer** (includes `npm`). Check with:
  ```bash
  node -v
  npm -v
  ```

That's the only prerequisite. There is no build step, no database to provision, and no environment variables or API keys to configure.

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

> First launch creates the data folder automatically and seeds the **Licenses** module with a few example records. Nothing else is pre-populated.

---

## Where your data lives

All data is stored as JSON under your OS user-data directory — **outside this repo**, so it is never committed and survives reinstalls/updates:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\timesheet\` |
| macOS | `~/Library/Application Support/timesheet/` |
| Linux | `~/.config/timesheet/` |

```
timesheet/
├── days/
│   ├── 2026-06-09.json        # one file per day
│   └── 2026-06-09.json.bak    # rolling backup of last good save
├── lookups.json               # dropdown options + default name
├── prefs.json                 # window size/position
├── subscriptions.json
├── licenses.json
└── insurance.json
```

Writes are **atomic** (write to `.tmp` → rename) and every save keeps a `.bak` copy, which is restored automatically if a file is ever corrupted. To **back up** your data, copy the whole `timesheet` folder. To **migrate** to another machine, copy it into the same location there.

> ⚠️ The on-disk folder is named `timesheet` because Electron derives it from the `"name"` field in `package.json`. **Do not rename that field** — doing so points the app at a brand-new empty folder and your history will appear to vanish (it's still on disk under the old name).

---

## Tech stack

- **Electron 42** — desktop shell (Node.js main process + Chromium renderer)
- **Vanilla HTML / CSS / JS** — no frameworks, no bundler
- **Storage** — local JSON files (no database)
- **Font** — Quicksand (Google Fonts)

### Project layout

```
main.js       — Electron main process: window + IPC file handlers
preload.js    — context bridge exposing window.api to the renderer
index.html    — the entire UI (styles + markup + logic in one file)
package.json  — metadata & the `npm start` script
```

The renderer never touches the filesystem directly; it calls typed IPC methods on `window.api` (see `preload.js`), and the main process performs the atomic reads/writes.

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
