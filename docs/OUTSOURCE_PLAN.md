# Plan — Outsource (external resources: hours & fees)

> **Status: DONE — all six phases built (2026-09-29).** One change on the way (D10): projects are records inside a
> person (migration 067), not free text. Sections below keep the original plan; D10 records what changed. Pulled forward from Phase 6 because they cost a line each: Ctrl+N, the Quick Find routing, the palette entries.
> Claude Code: work **one phase at a time** and stop after each one.

---

## TL;DR

- New page: **Outsource** — a **standalone** module. It links to nothing else in the app
  (no Clients, no Projects, no PFM, no tasks).
- It replaces the per-person Excel timesheet: **one resource = one person you pay**.
- Each resource logs **time entries**: date · time · description · project (free text).
- Each resource has **one hourly rate** (with history). Fees are **calculated, never typed**.
- You close a date range into a **statement**, then mark it **Paid**.
- Export a statement to **Excel** (today's layout) and **PDF**.
- Built in **6 small phases**. Each one is tested and usable before the next starts.

### What the Excel sheet gets wrong today (and the module fixes)

| Today (Excel) | In the module |
|---|---|
| Totals summed by hand, `/60` by hand | Minutes → hours → fee, automatic |
| Mixed date formats | One date picker |
| Weekday typed by hand (can be wrong) | Weekday derived from the date |
| Rows with no date | Date required |
| One sheet per person, per period | One list, filter by person / project / period |
| No record of what was already paid | Statements lock entries once paid |

---

## 0. Rules for Claude Code (read first)

1. Read `ARCHITECTURE.md`, `CONTRIBUTING.md` and `CLAUDE.md` before touching anything.
2. New tables use the **`outs_`** prefix. **No foreign keys to** `projects`, `lookup_codes`
   `COMPANY`, `pfm_*`, `tasks` or `work_logs` — the module is standalone. (The only
   shared lookup is `CURRENCY`.)
3. **The new migration is a production write.** Before leaving `migrations/066_*.js` on
   disk: copy the live DB into the scratchpad (open the original `{ readOnly: true }`),
   run it on the copy, check row counts, `PRAGMA foreign_key_check`,
   `PRAGMA integrity_check`, **and that every pre-existing trigger is still in
   `sqlite_master`**. Run it twice to prove it's idempotent.
4. Check the live DB head first (last confirmed 063; 064–065 pending). 066 must apply
   cleanly **after** 065.
5. Every IPC channel = all 4 steps (`main.js`, `ipc-contracts.js`, `preload.js`, `ipc-types.js`).
6. Deletes: inline confirm + 5-second undo toast. Never a hard delete with no way back.
7. **No real data anywhere** — the owner's sample sheet is a format reference only. Never
   seed, import, test with, or document its names, projects or numbers. The owner enters
   real data through the UI.
8. Money is **integer minor units** (never REAL), like `pfm_versions.fees`.
9. Commits: **no AI co-author trailer**. Only commit when the owner asks.
10. After each phase: `npm run lint`, then `npm test` **twice**, then `npm run test:e2e`
    for any phase that changes the UI. Report results honestly, then **stop**.

---

## 1. Decisions (owner, 2026-09-29)

| # | Question | Decision |
|---|---|---|
| D1 | Who sees the data? | ✅ **Private per login** (like tasks/PFM) |
| D2 | "Project" on an entry | ✅ **Free text.** Standalone module, not linked to Clients/Projects. Input suggests names already used (`<datalist>`), trimmed on save |
| D3 | Rate model | ✅ **One hourly rate per resource** (no per-project override) |
| D4 | Entry date | ✅ **Required**, one date per entry |
| D5 | Rate changes | ✅ **Keep history** — each rate has an "effective from" date; issued statements never change |
| D6 | Payment tracking | ✅ **Statements + Paid** (no partial payments) |
| D7 | Time input | ✅ **Minutes or hours** — `90`, `1:30`, `1.5h` all save as 90 minutes |
| D8 | Export | ✅ **Excel + PDF** |
| D9 | Resource logins | ✅ **None** — a resource is a record, not a user |
| D10 | Projects (changed after Phase 3) | ✅ **Person → Projects → Entries.** Add a project inside a person, then write that project's entries inside it. Replaces D2's free text (migration 067 backfills any older entries into projects) |

---

## 2. How it works (plain words)

```
Resource  "Consultant A"   rate 200 SAR/h from 2026-01-01
 │                          rate 250 SAR/h from 2026-07-01
 ├─ Entries
 │    2026-06-28 (Sun)   60 min   Design review         Project Alpha   → 200/h
 │    2026-07-02 (Thu)   90 min   Migration dry-run     Project Beta    → 250/h
 │    …
 └─ Statements
      ST-001   2026-06-01 → 2026-07-31   2.50 h   575.00 SAR   ✅ Paid 2026-08-05
      ST-002   2026-08-01 → …            (draft)
```

- **Entry** = one row of today's sheet. Weekday is shown, never stored.
- **Rate for an entry** = the resource's rate whose `effective_from` ≤ the entry date.
  An entry dated before the first rate is flagged "no rate" and blocks issuing.
- **Statement** = a closed date range for one resource:
  `DRAFT → ISSUED → PAID`, or `CANCELLED`.
  - *Issue* snapshots each line's rate and amount, and **locks** those entries
    (no edit/delete). A later rate change can't alter it.
  - *Cancel* unlocks the entries. *Paid* records the date + an optional note.
  - An entry can be in only one non-cancelled statement.
- **Rounding**: minutes summed exactly; money rounded half-up to the minor unit once per
  statement line (per project × rate). Hours shown to 2 decimals.

---

## 3. Data model (migration 066, additive only)

```
outs_resources    id, user_id, name, email, phone, notes,
                  currency_id → lookup_codes (CURRENCY),
                  is_active, created_at, updated_at, deleted_at
outs_rates        id, resource_id → outs_resources, rate_minor INTEGER ≥ 0,
                  effective_from TEXT (YYYY-MM-DD), created_at
                  UNIQUE (resource_id, effective_from)
outs_entries      id, user_id, resource_id, work_date TEXT NOT NULL,
                  minutes INTEGER > 0, description, project TEXT (free),
                  statement_id NULL → outs_statements,
                  created_at, updated_at, deleted_at
outs_statements   id, user_id, resource_id, reference, period_from, period_to,
                  status (DRAFT/ISSUED/PAID/CANCELLED), total_minutes, total_minor,
                  currency_id, issued_at, paid_at, paid_note, created_at, deleted_at
outs_statement_lines  id, statement_id, project, minutes, rate_minor, amount_minor
outs_history      audit trail (like pfm_history; record id NOT a foreign key)
```

- Indexes: `(user_id, resource_id, work_date)`, `(statement_id)`, `(resource_id, effective_from)`.
- Statement `reference` auto-generated per resource (`ST-001`…), editable, unique per login.
- Soft delete via `deleted_at` + undo toast; purge on next boot's maintenance.
- A resource with issued/paid statements can be **deactivated**, not deleted.
- `workspace_search`: resources (name) and entries (description + project), kinds
  `outs-resource` and `outs-entry` (entity id `resourceId:entryId`),
  new triggers. Capture every existing trigger before/after (rule 3).

---

## 4. Screens

1. **Outsource list** — table of resources: name, current rate, hours this month,
   **unpaid amount**, last entry date. Filter: active / all.
2. **Resource detail**, three tabs:
   - **Entries** — spreadsheet-like grid, same columns as today:
     Day · Date · Time · Description · Project. Keyboard-first: Enter saves and opens the
     next row; date defaults to the last one used. Footer: minutes / hours / fee.
     Filters: period, project, "not in a statement". Locked rows show a 🔒.
   - **Rates** — rate history (amount + effective from). Add/edit/delete, with a
     warning if a change would affect entries in a draft statement.
   - **Statements** — New (pick date range → preview lines per project) → Issue →
     Mark Paid / Cancel. Export Excel / Print PDF from any statement.
3. Arabic/RTL: every new string through `i18n.js`; watch the four blind spots in
   `CLAUDE.md` (template literals, runtime `<option>`s especially).

---

## 5. Phases

| # | Phase | Delivers | Tests |
|---|---|---|---|
| 1 | **Schema + data layer** | Migration 066 (verified on a copy), `db.js` CRUD for resources/rates/entries, rate resolution, time parser | `test/outsource-smoke.js`: CRUD, per-login isolation, rate-by-date, `90`/`1:30`/`1.5h`, soft delete/undo |
| 2 | **Resources UI** | Sidebar page, list, add/edit/deactivate/delete, Rates tab | e2e: create resource, add two rates |
| 3 | **Entries grid** | Fast entry grid, totals footer, filters, project datalist | e2e: add/edit/delete entry with undo |
| 4 | **Statements** | Preview → Issue (snapshot + lock) → Paid / Cancel | smoke: locking, snapshot survives a rate change, cancel unlocks, no double-billing |
| 5 | **Export** | Excel statement (today's column layout + per-project subtotals + rate + fee), PDF via the existing print path | `xlsx-export-smoke.js` additions |
| 6 | **Finish** | Quick Find, Overview "unpaid to outsource" tile, full-backup coverage, Ctrl+N on the page, ARCHITECTURE/README | full `npm test` ×2 + e2e |

Rough size (PFM was ~3,900 lines): expect **~2,500 lines** incl. tests.

---

## 6. Out of scope (for now)

- Importing old Excel sheets (the owner enters data through the UI).
- Links to Clients / Projects / PFM / tasks.
- Per-project rates, daily or monthly rates.
- Partial payments, tax/VAT, currency conversion.
- Logins for resources.
