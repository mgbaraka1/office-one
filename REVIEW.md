# Code Quality Review — Cooperation Tools (Electron Timesheet)

**Date:** 2026-06-15
**Scope:** `main.js`, `db.js`, `preload.js`, `index.html`, `package.json`, build config
**Phase:** 1 (audit only — no code changed)

The codebase is in good shape overall: clean IPC contract, secure Electron defaults
(`contextIsolation: true`, no `nodeIntegration`, no `remote`), consistent `esc()` XSS
escaping, atomic SQLite transactions, and a thoughtful close-handshake. Findings below
are mostly **Moderate/Minor**; there are no data-loss-class Critical bugs in normal use.
Severity legend: **Critical** (data loss / crash / security hole), **Moderate** (real bug
or risk under realistic conditions), **Minor** (edge case, polish, consistency).

---

## 1. Bugs / Functional Issues

### 1.1 — `build/` icons are git-ignored but required by the build  ·  **Moderate**
- **Files:** [.gitignore](.gitignore) (`build/`), [package.json:42-43](package.json#L42-L43), [main.js:19](main.js#L19)
- `.gitignore` ignores `build/`, but that directory holds `icon.ico` / `icon.png`, which
  `electron-builder` (`build.files`, `win.icon`) and the `BrowserWindow` icon path depend on.
  `git ls-files build` returns nothing — the icons are **not tracked**. A fresh clone will
  fail `npm run build:win` (missing icon) and run without a window icon. The recent commit
  "add application icons for Windows build" did not actually commit them.
- **Fix:** Un-ignore the asset files, e.g. add to `.gitignore`:
  ```
  build/
  !build/icon.ico
  !build/icon.png
  !build/icon.svg
  !build/gen-icon.js
  ```
  then `git add -f build/icon.* build/gen-icon.js build/icon.svg` and commit.

### 1.2 — Carry-over Dismiss / Move-to-Today leave the sidebar task badge stale  ·  **Minor**
- **Files:** [index.html:3597-3605](index.html#L3597-L3605) (dismiss), [index.html:3626-3638](index.html#L3626-L3638) (`moveToToday`)
- These two carry-over actions mutate stored days but never call `updateTaskBadge()`, so the
  `📌`/open-tasks count in the sidebar can be wrong until the next save or Open-Tasks visit.
  (The Open-Tasks module's own actions do refresh it via `renderOpenTasks`.)
- **Fix:** Add `updateTaskBadge();` after the `renderCarryOver()` calls in both handlers.

### 1.3 — Carry-over edit save is fire-and-forget / no calendar refresh  ·  **Minor**
- **File:** [index.html:3086-3095](index.html#L3086-L3095) (`submitModal` carry-over branch)
- The foreign-day save (`window.api.saveDay(foreignDate, …)`) is not awaited and not
  `catch`-ed, and `savedDays`/`renderCalendar()`/`updateTaskBadge()` are not updated. A
  failed write is silently lost, and a day that gained/lost its only row won't update the
  calendar dot.
- **Fix:** `await` the save inside a `try/catch`, and refresh calendar + task badge after.

### 1.4 — `minutes` stored with inconsistent types (string vs number)  ·  **Minor**
- **Files:** modal [index.html:3073](index.html#L3073) (`minutes: minRaw` → string), inline edit [index.html:2685](index.html#L2685) (`= val` → number), timer [index.html:2876](index.html#L2876) (`String(...)` → string)
- Three code paths write `minutes` as different types. Everything downstream uses
  `parseFloat`/`parseInt`, so it works, but it's a latent footgun (e.g. strict equality,
  JSON diffs).
- **Fix:** Normalize to one type on write (recommend store as `Number`, or always `String`).
  Low priority — flag as optional.

### 1.5 — `db.init()` failure crashes startup with no window / no feedback  ·  **Moderate**
- **File:** [main.js:135-140](main.js#L135-L140)
- `db.init()` runs un-guarded inside `app.whenReady().then(...)`. If the DB can't be opened
  (locked, corrupt, permissions), the promise rejects, `createWindow()` never runs, and the
  user sees nothing (process may linger). No `dialog.showErrorBox`.
- **Fix:** Wrap `db.init()` in `try/catch`; on failure show `dialog.showErrorBox(...)` and
  `app.quit()`. See also §2.1.

---

## 2. Error Handling

### 2.1 — Renderer load/save IPC calls lack try/catch (silent failures, unhandled rejections)  ·  **Moderate**
- **Files:** e.g. [index.html:2942](index.html#L2942) (`saveDay`), [index.html:4216](index.html#L4216) (`loadSubscriptionsData`), [index.html:5120](index.html#L5120) (`loadLicensesData`), [index.html:5387](index.html#L5387) (`loadInsuranceData`), [index.html:5671](index.html#L5671) (`init` → `loadLookups`)
- `ipcMain.handle` propagates any `db.js` throw back as a rejected promise. Most renderer
  `await window.api.load*/save*` calls have no `catch`, producing **unhandled promise
  rejections** and silent data-not-saved with no user signal. `init()` itself has no guard,
  so a load failure leaves the app blank.
- **Fix:** Add `try/catch` to the data-layer wrappers (`saveDay`, `loadSubscriptionsData`,
  etc.) and surface a `toast('Save failed')` on error. Wrap `init()` in try/catch with a
  visible error. Optionally add a `process.on('unhandledRejection')` log in main.

### 2.2 — Fire-and-forget `saveLookups` writes  ·  **Minor**
- **Files:** [index.html:3170](index.html#L3170) (name default), [index.html:4091](index.html#L4091) (`saveAsTemplate`), [index.html:4109](index.html#L4109) (`deleteTemplate`)
- These `window.api.saveLookups(...)` calls are intentionally not awaited but also not
  `catch`-ed; a failed template/default-name save is lost without notice.
- **Fix:** `.catch(() => toast('Could not save'))` on each, or route through a small helper.

### 2.3 — `main.js` handlers are synchronous pass-throughs that can throw  ·  **Minor**
- **File:** [main.js:50-69](main.js#L50-L69)
- `db.*` calls inside `ipcMain.handle` are synchronous and can throw (e.g. `SQLITE_BUSY`
  after the 5 s timeout, disk full). They reject correctly, but combined with §2.1 the
  renderer never recovers gracefully. The `backupDatabase`/`exportPDF` handlers already
  model the right pattern (`try/catch` → `{ ok:false, error }`).
- **Fix:** Consider the same `{ok,error}` envelope (or central error logging) for the
  save/load handlers, or rely on §2.1 renderer-side guards. Optional.

---

## 3. Dead Code & Duplication

### 3.1 — `dayLabel()` is unused  ·  **Minor (dead code)**
- **File:** [index.html:2274-2277](index.html#L2274-L2277) — defined, never called.
- **Fix:** Delete it.

### 3.2 — `setAlwaysOnTop` IPC is fully unwired  ·  **Minor (dead code)**
- **Files:** [preload.js:22](preload.js#L22), [main.js:126](main.js#L126) — exposed/handled but no
  caller in `index.html` (the Pin button was removed; CLAUDE.md documents this).
- **Fix:** Optional — remove both ends, or keep intentionally (it's documented). Flagging as
  dead weight, not a bug.

### 3.3 — Trivial error-helper wrappers duplicate `markError`  ·  **Minor (duplication)**
- **Files:** [index.html:5106](index.html#L5106) `markSubError`, [index.html:5375](index.html#L5375) `markLicError`, [index.html:5639](index.html#L5639) `markInsError` — each is just `markError(id)`.
- **Fix:** Optional — call `markError` directly and drop the three wrappers. Cosmetic.

### 3.4 — `onEndDateChange` and `onCycleChange` are identical  ·  **Minor (duplication)**
- **File:** [index.html:5045-5061](index.html#L5045-L5061) — same body.
- **Fix:** Optional — collapse to one `suggestRenewal()` called from both `oninput`/`onchange`.

### 3.5 — `addLicExtraRow` / `addInsExtraRow` are near-identical  ·  **Minor (duplication)**
- **Files:** [index.html:5305-5325](index.html#L5305-L5325) and [index.html:5571-5591](index.html#L5571-L5591) — differ only by target list id.
- **Fix:** Optional — parameterize one `addExtraRow(listId, label, value)`. The undo-toast
  trios (sub/lic/ins) are similarly parallel; consolidating is a larger refactor — leave as-is
  unless touched.

### 3.6 — Legacy JSON migration code (`migrateFromJson`, `readJson`)  ·  **Not dead — keep**
- **File:** [db.js:125-167](db.js#L125-L167)
- Only runs on a brand-new DB (fresh clone) and is the seeding path for `DEFAULT_LICENSES`.
  CLAUDE.md confirms it must stay even though no JSON remains on this machine. **No action.**

---

## 4. Code Organization & Consistency

### 4.1 — Entire app (markup + CSS + ~3,500 lines JS) in one 5,693-line `index.html`  ·  **Moderate (maintainability)**
- **File:** [index.html](index.html)
- The single-file approach is a deliberate project convention (CLAUDE.md), and CSP currently
  *requires* inline script/style. But the file is large enough that navigation and review are
  costly, and it forces `script-src 'unsafe-inline'` (see §5.2).
- **Fix:** **Optional/nice-to-have.** If ever revisited: extract the `<script>` block into a
  bundled `renderer.js` referenced with `<script src>` (allowing removal of `'unsafe-inline'`
  from `script-src`). Not recommended as part of this pass — large, unsolicited restructure.

### 4.2 — Mixed `null`-as-"no edit" sentinels across modules  ·  **Minor (consistency)**
- `editIdx` uses `null`; module edit ids use `subEditId/licEditId/insEditId` with `!== null`
  checks but ids are strings. Works, but the `idx !== null` vs `!!record` patterns vary.
  Cosmetic — no fix needed.

### 4.3 — `setUnsaved()` is a one-line alias of `autoSave()`  ·  **Minor**
- **File:** [index.html:2985](index.html#L2985) — harmless indirection; leave or inline. Cosmetic.

---

## 5. Electron-Specific Concerns

### 5.1 — Security baseline is correct  ·  **(Good — no action)**
- `contextIsolation: true` ([main.js:22](main.js#L22)), preload via `contextBridge` only,
  no `nodeIntegration`, no `enableRemoteModule`, no `webSecurity:false`. `openExternal` is
  scheme-allowlisted to http/https ([main.js:127-133](main.js#L127-L133)). The offscreen PDF
  window uses Electron defaults (isolated). This is the right posture for a desktop app.

### 5.2 — CSP allows `'unsafe-inline'` for scripts  ·  **Moderate (defense-in-depth)**
- **File:** [index.html:5](index.html#L5)
- `script-src 'self' 'unsafe-inline'` is required because all JS is inline, but it removes
  CSP's XSS protection. Mitigated in practice by consistent `esc()` use on all interpolated
  user content (I did not find an unescaped `innerHTML` sink). Still, RTL/Arabic free-text
  fields flowing into report HTML rely entirely on `esc()`.
- **Fix:** **Optional** and tied to §4.1 — only removable by externalizing the script to a
  file. Until then, keep `esc()` discipline. No change recommended now.

### 5.3 — No `setWindowOpenHandler` / `will-navigate` guard  ·  **Minor**
- **File:** [main.js:10-47](main.js#L10-L47), and `triggerPrint` uses `window.open` ([index.html:3334](index.html#L3334))
- The main window has no handler denying/controlling new-window or navigation requests. Risk
  is low (offline app, trusted local HTML, links go through `openExternal`), but a defensive
  `webContents.setWindowOpenHandler` (deny by default; the print path uses `window.open('')`
  which would need allowing or refactoring to a hidden print window) would harden it.
- **Fix:** Optional hardening; verify the print flow still works if added.

### 5.4 — `app.quit()` only on non-darwin; `db.close()` runs before quit  ·  **Minor**
- **File:** [main.js:141-144](main.js#L141-L144)
- On macOS `window-all-closed` closes the DB but does not quit; reopening a window later would
  hit a closed `db`. The app is Windows-only in practice (build targets win), so low impact.
- **Fix:** Optional — re-init DB on `activate`, or quit on all platforms. Not needed for Windows.

---

## 6. Dependencies

### 6.1 — Lean, current dependency set  ·  **(Good)**
- **File:** [package.json:29-32](package.json#L29-L32)
- Only two devDependencies (`electron ^42.3.3`, `electron-builder ^25.1.8`), **zero runtime
  deps** — storage is built-in `node:sqlite`. Nothing deprecated or unused detected.

### 6.2 — `node:sqlite` is an experimental Node API  ·  **Minor (awareness)**
- Running emits `ExperimentalWarning: SQLite is an experimental feature and might change at
  any time` (confirmed locally). Pinned safely because Electron bundles a fixed Node version,
  but a future Electron major could change the API surface.
- **Fix:** No action; note it before any Electron major upgrade and pin `electron` carefully.

---

## 7. Performance

### 7.1 — Full cross-day table scan on **every** save (via `updateTaskBadge`)  ·  **Moderate**
- **Files:** [index.html:2949](index.html#L2949) (`saveDay` → `updateTaskBadge()`), [index.html:4710-4713](index.html#L4710-L4713) (`updateTaskBadge` → `getOpenItems`), [db.js:238-257](db.js#L238-L257) (`scanRows`)
- Each `saveDay()` (fired on a 300 ms debounce after typing) calls `updateTaskBadge()` with no
  argument, which runs `getOpenItems()` → `scanRows()` → **loads and JSON-parses every day row
  in the database**. Cost grows linearly with total history on every edit. Today it's fine;
  over years of daily use it becomes a noticeable hitch on each save.
- **Fix:** Cheapest win — have `saveDay()` compute the badge delta from the in-memory `rows`
  it just saved instead of re-scanning, or debounce/throttle `updateTaskBadge`, or maintain a
  cached open-item count invalidated on write. (`getOpenItems`/`getCarryOver` themselves are
  reasonable as one-shot scans; the issue is calling it per-save.)

### 7.2 — `renderTable` is O(n²) via `rows.indexOf(row)` per row  ·  **Minor**
- **File:** [index.html:2528](index.html#L2528) (`getOrigIdx`) called inside `ordered.forEach`
- For a day's record count this is negligible; only flag if a day ever holds hundreds of rows.
- **Fix:** Optional — build an index `Map(row → i)` once before the loop.

### 7.3 — No indexes on `license_extras` / `insurance_extras` child tables  ·  **Minor**
- **File:** [db.js:74-86](db.js#L74-L86)
- `loadLicenses`/`loadInsurance` read all extras and join in JS; with the current tiny row
  counts this is fine. `days.date` and the `id` PKs are already indexed (PRIMARY KEY).
- **Fix:** Optional — `CREATE INDEX` on `license_id` / `insurance_id` only if these tables grow.

### 7.4 — `PRAGMA foreign_keys = ON` with no FK constraints declared  ·  **Minor (no-op)**
- **File:** [db.js:74-86](db.js#L74-L86), [db.js:181](db.js#L181)
- The extras tables have no `FOREIGN KEY ... REFERENCES`, so the pragma has no effect; orphan
  cleanup is handled manually by the "DELETE all then re-insert" save pattern (correct, just
  not enforced by the engine).
- **Fix:** Optional — either add real FKs with `ON DELETE CASCADE`, or drop the misleading
  pragma. Cosmetic.

---

## Suggested Fix Order (for Phase 2, by severity)

**Moderate (recommend fixing):**
1. §1.1 — commit the `build/` icons / fix `.gitignore` (build is currently broken on clone).
2. §2.1 — add try/catch + user feedback around renderer load/save IPC; guard `init()`.
3. §1.5 — guard `db.init()` in main with an error dialog.
4. §7.1 — stop full-scanning on every save (badge from in-memory data or throttle).

**Minor (quick, low-risk):**
5. §1.2 / §1.3 — refresh task badge + calendar after carry-over actions; await/catch that save.
6. §2.2 — `.catch` the fire-and-forget `saveLookups` calls.
7. §3.1 — delete unused `dayLabel()`.

**Optional / nice-to-have (do NOT auto-apply — flag only):**
- §1.4 minutes type normalization; §3.2 remove `setAlwaysOnTop`; §3.3–§3.5 de-dup helpers;
  §4.x organization; §5.2 CSP hardening (needs script externalization); §5.3 window-open guard;
  §7.2–§7.4 micro-optimizations / schema cosmetics.

**No action (verified intentional / correct):** §3.6 (migration), §5.1 (security baseline),
§6.1 (deps).

---

*End of Phase 1 audit.*

---

## Phase 2 — Resolution Log

Branch: `feat/reports-module`. All changes boot-tested (app launches clean) and
syntax-checked (`node --check`). REVIEW.md not committed; no push performed.

### Fixed
| Finding | Commit | Note |
|---|---|---|
| §1.1 build icons git-ignored | `8a3b608` | `.gitignore` now keeps `build/icon.*` + `gen-icon.js`; output still ignored |
| §2.1 / §1.5 / §2.2 silent IPC/DB failures | `0ef2866` | try/catch + toast on save/load; `db.init()` + `init()` guarded; `persistLookups()` helper; `.save-error` style |
| §7.1 full scan per save | `69ec9eb` | open-task badge refresh coalesced via `scheduleTaskBadge()` (1s debounce) |
| §1.2 carry-over badge stale | `69ec9eb` | Dismiss refreshes badge + catches save error |
| §1.3 carry-over edit save unguarded | `69ec9eb` | `submitModal` awaits/catches, refreshes calendar+badge |
| §3.1 dead `dayLabel()` | `69ec9eb` | removed |
| §3.2 unwired `setAlwaysOnTop` | `2420d33` | removed from preload+main; CLAUDE.md updated |
| §3.3 `markX` passthroughs | `2420d33` | call `markError` directly |
| §3.4 `onEndDateChange`/`onCycleChange` dup | `2420d33` | shared `suggestSubRenewal()` |
| §3.5 `addLicExtraRow`/`addInsExtraRow` dup | `2420d33` | shared `addExtraRow(listId, …)` |
| §1.4 `minutes` mixed types | `951f73b` | normalized to Number (or '' when blank) on all write paths |
| §7.2 `renderTable` O(n²) | `951f73b` | row→index Map |
| §5.3 no window-open/navigation guard | `45cc97b` | `setWindowOpenHandler` + `will-navigate` deny-by-default; print popup + http(s) links still work |

### Deliberately NOT changed (with reasoning)
- **§7.3 child-table indexes** — the actual queries (`SELECT … FROM license_extras
  ORDER BY seq`, no `WHERE`) would not use a `license_id` index, so adding one is
  cargo-cult. Revisit only if a `WHERE license_id = ?` access pattern is introduced.
- **§7.4 declare real FKs** — `CREATE TABLE IF NOT EXISTS` means FK constraints would
  apply to fresh clones only, diverging from the existing production DB; the
  delete-then-reinsert save pattern already prevents orphans. Left the `foreign_keys`
  pragma on (harmless, future-proof) rather than introducing that divergence.
- **§5.2 remove `'unsafe-inline'` from `script-src`** — blocked by the app's pervasive
  inline `onclick=`/`onchange=` HTML attributes, which CSP classifies as inline script.
  Removing it would break every inline handler; the fix requires converting them all to
  `addEventListener` (a large, risky change). Mitigated today by consistent `esc()`.
- **§4.1 split the single-file app** — large unsolicited restructure; out of scope for a
  cleanup pass (and a prerequisite for §5.2). Left as-is per project convention.
