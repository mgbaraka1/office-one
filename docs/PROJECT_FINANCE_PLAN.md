# Plan — Project & Finance Management (Offers & CRs)

> **Status: DRAFT — waiting for approval.** Nothing below has been built.
> Claude Code: do not start until the owner has approved this file and filled in
> §1 (Decisions). Then work **one phase at a time** and stop after each one.

---

## TL;DR

- New page: **Project & Finance** (sidebar, under *External*).
- It tracks **Offers** and **CRs** (Change Requests), each with its own **Reference ID** that you type in.
- Every Offer/CR moves through **Prepare → Ready → Sent → Accepted / Rejected**.
- Each stage records **who on our side** did it, and **when**.
- Each Offer/CR has **versions** (you type the version ID + the **fees**).
- Each version holds **several files**.
- Built in **6 small phases**. Each one is tested and usable before the next starts.

---

## 0. Rules for Claude Code (read first)

1. Read `ARCHITECTURE.md`, `CONTRIBUTING.md` and `CLAUDE.md` before touching anything.
2. **Do not reuse or restore the old Finance code** (removed in `b4dd489`, migration 061).
   This is a clean-slate design. Don't `git show` old `finance.js` as a starting point.
3. **Do not use the `finance_` table prefix** — migration 061 dropped `finance_*`, and a
   dormant `finance_lookups` still exists. New tables use the **`pfm_`** prefix.
4. **The new migration is a production write.** Before leaving `migrations/062_*.js` on
   disk: copy the live DB into the scratchpad (open the original `{ readOnly: true }`),
   run the migration on the copy, and check row counts, `PRAGMA foreign_key_check`,
   `PRAGMA integrity_check`, **and that every pre-existing trigger is still in
   `sqlite_master`**. Run it twice to prove it's idempotent.
5. Check which migration the live DB is at first (it was 060 with 061 pending). 062 must
   apply cleanly **after** 061.
6. Every IPC channel = all 4 steps (`main.js`, `ipc-contracts.js`, `preload.js`, `ipc-types.js`).
7. Deletes: inline confirm + 5-second undo toast. Never a hard delete with no way back.
8. No real client names, IDs, amounts or files in tests, fixtures or docs. Generic only.
9. Commits: **no AI co-author trailer**. Only commit when the owner asks.
10. After each phase: `npm run lint`, then `npm test` **twice**, then `npm run test:e2e`
    for any phase that changes the UI. Report results honestly, then **stop**.

---

## 1. Decisions (all decided by the owner, 2026-09-28)

| # | Question | Options |
|---|---|---|
| D1 | Who sees the offers? | ✅ **DECIDED: private per login** (like tasks). Each login sees only its own Offers/CRs. |
| D2 | "Our" responsible people come from… | ✅ **DECIDED: free text** typed per stage (no Settings list). Input offers autocomplete from names already used. |
| D3 | "Client" responsible person is… | ✅ **DECIDED: typed, empty each time** — name / email / phone boxes on the offer, no pre-fill, all optional. |
| D4 | Where does it show? | ✅ **DECIDED: own sidebar page + "Offers & CRs" tab inside each client** |
| D5 | Can a CR belong to an Offer? | ✅ **DECIDED: no link** — CRs stand alone, tied only to the client. |
| D6 | Reference IDs unique… | ✅ **DECIDED: across Offers + CRs together** (one pool per login, capitals/spaces ignored) |

D1 note: fine today (one login). Stage people are free text (D2), so "sent by Bob" still works without Bob having a login.
D2 note: free text keeps it fast. To limit typo-duplicates ("Bob" vs "bob "), trim on save and suggest past names via a `<datalist>`.

---

## 2. How it works (plain words)

```
Client (existing COMPANY)
 └─ Offer  "OFF-2026-014"   status: Sent
     ├─ Stages:  Prepare → Alice (01 Sep)   Ready → Dana (03 Sep)   Sent → Bob (04 Sep)
     ├─ Client contact: name / email / phone
     ├─ Versions
     │    ├─ v1   12 000 SAR   [offer.pdf] [boq.xlsx]
     │    └─ v2   10 500 SAR   [offer-rev.pdf]          ← newest = "current"

Client (same)
 └─ CR  "CR-007"  … same shape: stages, versions, files (no link to an Offer — D5)
```

- **Status** = where the Offer/CR is right now.
- **Stage** = one row per status, holding *who* and *when*. You can assign a person
  to a stage *before* it happens (e.g. "Bob will send it") — the date fills in when
  the status actually moves there.
- **Current fees** = fees of the newest version.

---

## 3. Data model — migration `062_project_finance.js`

`destructive: false` (only creates things). All `CREATE … IF NOT EXISTS`.
Money is stored as **integer minor units** (`fees_minor` = amount × 100), matching
the existing `otIncomeMinor` / `anMoney()` pattern — never REAL.

### 3.1 New lookup categories (add to `LOOKUP_CATEGORIES` in `db.js` **and** `renderer/settings-registry.js`)

| Category | Settings tab | Seeded? |
|---|---|---|
| `PFM_STATUS` | "Offer Status" (`valueField: 'code'`) | ⭐ Yes, guarded seed (only if empty, like migration 059): `PREPARE` Prepare / قيد الإعداد · `READY` Ready / جاهز · `SENT` Sent / مُرسل · `ACCEPTED` Accepted / مقبول · `REJECTED` Rejected / مرفوض |

Code logic compares on **codes** only (`ACCEPTED`, `REJECTED` = final). Stage order =
the lookup `sort_order`, so a user-added status like "On Hold" just works.

### 3.2 Tables

**`pfm_items`** — one row per Offer or CR
| column | notes |
|---|---|
| `id` | PK |
| `kind` | `TEXT NOT NULL CHECK(kind IN ('OFFER','CR'))` — structural (drives the Offers/CRs toggle and the new-item form), so a CHECK not a lookup. Say so in a comment. |
| `reference` | user-entered ID, as typed |
| `reference_key` | `lookupLabelKey(reference)` (trim + lowercase, JS fold). `UNIQUE(user_id, reference_key)` — D6. Per login, because data is private (D1): an install-wide rule would reveal another login's hidden references. |
| `title` | NOT NULL |
| `company_id` | NOT NULL → `lookup_codes(id)` (COMPANY) |
| `status_id` | NOT NULL → `lookup_codes(id)` (PFM_STATUS) — current status |
| `client_contact_name` / `_email` / `_phone` | D3 — plain optional text, trimmed; no link to `company_profiles` |
| `valid_until` | date, optional (E3) |
| `notes` | text |
| `user_id` | NOT NULL → `users(id)` ON DELETE CASCADE — owner (D1). **Every** `pfm:*` query filters by the session user; never trust a user id from the renderer. |
| `created_by`, `updated_by` | → `users(id)` — attribution |
| `created_at`, `updated_at`, `archived_at` | `archived_at` = soft archive, not delete |

**`pfm_stages`** — who / when, per status (requirement 5)
| column | notes |
|---|---|
| `id` | PK |
| `item_id` | → `pfm_items` ON DELETE CASCADE |
| `status_id` | → PFM_STATUS |
| `member_name` | TEXT NULL — free text (D2), trimmed on save |
| `done_on` | date; NULL = planned, not happened yet |
| `note` | optional free text |
| `UNIQUE(item_id, status_id)` | |

**`pfm_versions`** — requirement 7
| column | notes |
|---|---|
| `id`, `item_id` (CASCADE) | |
| `version_label` | user-entered (e.g. "v2", "Rev B") |
| `version_key` | `UNIQUE(item_id, version_key)` — folded label |
| `fees_minor` | INTEGER, NULL allowed |
| `currency_id` | → CURRENCY lookup |
| `version_date` | date |
| `notes`, `sort_order`, `created_by`, `created_at`, `updated_at` | |

**`pfm_version_files`** — requirement 8 (many per version)
| column | notes |
|---|---|
| `id`, `version_id` (CASCADE) | |
| `file_path` (relative), `original_name`, `file_size`, `mime_type` | same shape as `knowledge_attachments` |
| `sort_order`, `uploaded_by`, `uploaded_at` | |

**`pfm_history`** — audit trail (who changed what)
`id, item_id, record_type ('item'|'stage'|'version'|'file'), record_id, field, old_value, new_value, user_id, changed_at`.
**No cascade** from `pfm_items` — same rule as `lookup_code_history`: the audit
survives what it describes.

### 3.3 Indexes & triggers
- Indexes: `pfm_items(company_id)`, `(status_id)`; `pfm_stages(item_id)`;
  `pfm_versions(item_id)`; `pfm_version_files(version_id)`; `pfm_history(item_id)`.
- Lookup-category triggers in the **same shape as migration 048**
  (`trg_<table>_<col>_<insert|update>_category`) for: `pfm_items.company_id` → COMPANY,
  `pfm_items.status_id` → PFM_STATUS, `pfm_stages.status_id` → PFM_STATUS,
  `pfm_versions.currency_id` → CURRENCY.
- Index `pfm_items(user_id)` (the `UNIQUE(user_id, reference_key)` index covers it).

### 3.4 Files on disk
`<userData>/project_finance/{itemId}/{versionId}/{timestamp}-{rand}.{ext}`
- Allowed types: reuse `KNOWLEDGE_DOC_TYPES` (PDF, DOC/DOCX, XLS/XLSX, PNG/JPG/GIF/WEBP, TXT)
  + magic-byte check via `knowledgeUploadHeaderMatches()`; `MAX_DOCUMENT_BYTES` (100 MB).
- Every path through `resolveStoredPath()` + `resolveInside(pfmItemDir(id), …)`.
- **Must be wired into every place the other upload trees are listed** (easy to miss):
  - [ ] `USER_DATA_ENTRIES` (`db.js` ~L195)
  - [ ] `FULL_BACKUP_DIRS` (~L3723) and the Full Backup `folders` loop (~L3679)
  - [ ] Full Restore reference check list (~L3815)
  - [ ] `getSystemDiagnostics()` missing-file refs (~L3548)
  - [ ] a new `sweepOrphanPfmFiles()` next to `sweepOrphanKnowledgeFiles()`, called from `runMaintenance()`
  - [ ] `test/full-backup-smoke.js` `expectedEntries` and `test/userdata-carryover-smoke.js`

---

## 4. Screens

### 4.1 List page (sidebar → **Project & Finance**, module key `pfm`)
- Top: **status chips with counts** — `All · Prepare 3 · Ready 1 · Sent 4 · Accepted 9 · Rejected 2`.
- Toggle: `All | Offers | CRs`. Client filter. Search box. "Show archived".
- Rows: **Reference** · Title · Client · Type · **Status pill** · Current fees · Next/last person · Updated.
- Button **+ New Offer** / **+ New CR**. `Ctrl+N` opens New Offer on this page.

### 4.2 Detail view (click a row)
1. **Header** — Reference (big), title, client, type badge, status pill,
   **"Move to → [next status]"** button (one click; asks for person + date, pre-filled with today).
2. **Stage track** — horizontal stepper Prepare → Ready → Sent → Accepted/Rejected;
   under each step: person + date (or "planned: Bob"). Click a step to edit.
3. **Client contact** card — name / email / phone.
4. **Versions** — newest on top, marked "Current". Each row: version ID, date,
   fees + currency symbol (`CURRENCY_SYMBOLS`), notes, **file chips** (click = open,
   × = remove with undo), **+ Add files** (multi-select dialog).
5. **History** — collapsed by default.

### 4.3 Client detail tab
Add `{ key: 'pfm', label: 'Offers & CRs' }` to `CLIENT_DETAIL_TYPES` in
`renderer/features/clients.js`; same list, pre-filtered to the client. Count via
`updateClientDetailTabCounts()` (update in place — don't rebuild the toolbar).

### 4.4 UI rules
- New file `renderer/features/pfm.js`; add its `<script>` **after** `core.js` in `index.html`.
- Styles in `app.css` under a `/* ── Project & Finance ── */` section, **design tokens only**.
- `data-onclick` etc. only — no inline handlers. `esc()` on all user text.
  Mark user text with `data-user-content`.
- Auto-save text fields on the 300 ms debounce, like every other module.
- i18n: every new English string gets an Arabic entry. Watch the 4 blind spots
  (template literals, runtime `<option>`s, CSS content, duplicate keys). Status names
  come from the lookup's `name_ar`, not the dictionary.
- Add the page to `PAL_PAGES` in `shell.js` (Quick Find).

---

## 5. IPC (domain `pfm`) — all 4 steps each

| Channel | Does |
|---|---|
| `pfm:list` (filters) | list rows for the list page / client tab |
| `pfm:get` (id) | full detail: item + stages + versions + files |
| `pfm:create` / `pfm:update` | item fields; rejects a duplicate reference with a clear message |
| `pfm:setStatus` (id, statusCode, memberName, date, note) | moves status + upserts that stage, in one `tx()` |
| `pfm:saveStage` | edit/plan a stage without changing current status |
| `pfm:archive` / `pfm:unarchive` | soft archive |
| `pfm:delete` / `pfm:restore` / `pfm:purge` | delete with 5 s undo (company-docs pattern: files kept until purge) |
| `pfm:versionCreate` / `pfm:versionUpdate` / `pfm:versionDelete` / `pfm:versionRestore` | versions |
| `pfm:filesAdd` (versionId) | `main.js` opens a **multi-select** `showOpenDialog`, then `db` validates + copies each file; returns per-file ok/error |
| `pfm:fileOpen` / `pfm:fileRemove` / `pfm:fileRestore` | open with `shell.openPath` after `resolveInside`; remove with undo |
| `pfm:history` (id) | audit rows |

Every write records `pfm_history` rows with the acting `auth.requireUserId()`.
Update ARCHITECTURE §8's channel count and domain list.

---

## 6. Phases (do in order — stop after each)

### Phase 1 — Database only (no UI)
- [x] `migrations/062_project_finance.js` (tables, indexes, triggers, guarded `PFM_STATUS` seed)
- [x] `LOOKUP_CATEGORIES` + `settings-registry.js` entries (+ Settings tab markup in `index.html`
      so `settings-registry-smoke.js` passes)
- [x] `db.js` section `// ── Project & Finance (Offers & CRs) ──`: CRUD, `setStatus`, stages,
      versions, history, reference/version uniqueness, validation, `*ToApi` mappers
- [x] New `test/pfm-smoke.js`: create/update, duplicate reference rejected (case/space-insensitive),
      status move writes stage, versions unique per item,
      fees stored as minor units, wrong-category lookup rejected by trigger, history written
- [x] **Verify migration on a copy of the live DB** (§0 rule 4)
- ✅ Done when: lint clean, `npm test` green twice, copy-DB check reported. **Done 2026-09-28.**
- Built differently from §3 (on purpose):
  - `user_id` → `users(id)` **without** CASCADE, matching every other table. Users are never
    deleted, and a cascade would silently wipe a login's offers.
  - `deleted_at` on items, versions and files for the undo window (delete stamps it, undo clears it,
    purge removes; boot maintenance purges leftovers). Ids survive an undo.
  - `pfm_items` added to the COMPANY duplicate-merge list, so merging two clients can't break.

### Phase 2 — Files + IPC
- [x] File save / open / remove / restore / orphan sweep
- [x] Wire the upload tree everywhere in §3.4 checklist
- [x] All `pfm:*` channels (4 steps each)
- [x] Extend `pfm-smoke.js`: bad extension, fake header, >100 MB, path escape blocked, orphan sweep
- ✅ Done when: `ipc-contracts-smoke`, `full-backup-smoke`, `userdata-carryover-smoke` green; `npm test` ×2. **Done 2026-09-28.**
- Built differently from §5 (on purpose): channel names are kebab-case like the rest of the app
  (`pfm:set-status`, `pfm:version-create`, `pfm:files-add`, `pfm:file-open` …). Added
  `pfm:member-names` (the person suggestions), `pfm:version-purge` and `pfm:file-purge` (end of the
  undo window). 23 channels in all.

### Phase 3 — List page + create/edit + status
- [x] Sidebar button, `#module-pfm`, `pfm.js`, styles, i18n
- [x] List with status chips, filters, search; New Offer/CR modal; detail header + stage track + "Move to"
- [x] Settings tab for Offer Status works
- ✅ Done when: `npm test` ×2 + `npm run test:e2e` green; owner clicks through it once.
  **Built and tested 2026-09-28 — waiting for the owner's click-through.**
- Notes from building it:
  - Detail also has the Client Contact + Notes card (auto-saved, 300 ms, flushed on close) and the
    collapsed History section, so they're not left for later.
  - "Move to" offers the next status; from Sent it offers both Accepted and Rejected. A "Change
    status…" dropdown reaches any other status. Clicking a step edits or plans it.
  - e2e now drives the page for real: create → move status → auto-save → duplicate refused →
    delete + undo.
  - Found with screenshots: a horizontally scrolling stage track stopped Chromium drawing the
    detail view. The track now wraps instead (comment in `app.css`).

### Phase 4 — Versions + files UI
- [x] Versions section, fees + currency, multi-file add, open, remove with undo
- ✅ Done when: e2e green; owner adds a 2-version offer with 3 files.
  **Built and tested 2026-09-28 — waiting for the owner's click-through.**
- Notes from building it:
  - New version pre-fills `v{n+1}`, today's date and the current version's currency. Fees accept
    `12,500.50` and Arabic digits; stored as minor units.
  - Files that fail a check are listed under the version (name + reason) instead of a toast.
  - Removing a file and deleting a version both use the inline confirm + 5 s Undo.
  - Any contact/notes edit still waiting to auto-save is saved before a write re-renders the page.
  - e2e drives the real "Add files" through `OFFICE_ONE_E2E_PFM_FILES` (E2E-only, like the PDF/XLSX
    export paths), since the native open dialog can't be clicked over CDP.

### Phase 5 — Connect to the rest of the app
- [x] Client detail "Offers & CRs" tab (D4)
- [x] Quick Find entry + `Ctrl+N`
- [x] Enhancements E2, E3, E6, E8, E10 (§7)
- ✅ Done when: `npm test` ×2 + e2e green. **Done 2026-09-28.**
- Notes from building it:
  - E10 is **migration 063** (`pfm_workspace_search`): FTS rows fed by triggers, the 057 pattern.
    Needed because the live DB had already applied 062. Verified on a copy: only its 3 triggers
    added (69 → 72), none removed; FK / integrity / FTS integrity clean; re-run is a no-op.
    Items in their delete-undo window are kept out of the index.
  - E2 / E3 are filtered in `db.js` (`pfmAttentionItems`), not by the Overview's 30-day window:
    follow-up 7 days after the Sent stage's date; validity from 3 days before `valid_until`.
    Archived and final items stay quiet. The sidebar gets a badge like Clients.
  - E6 colours direction only, not good/bad — a lower fee on our own offer isn't a win by itself.
  - E8 adds `pfm:export-xlsx` (24 channels now) and `createPfmWorkbook()` in `xlsx.js`, which now
    shares its package/styles code with the Timesheet workbook.
  - The client tab fetches its own rows (`getClient` doesn't carry them) and refreshes after any
    Project & Finance write. The client Overview also gets a count card and a "New Offer" button.
  - Also fixed on the way: the Attention badge's "in 3d" was never translated to Arabic.

### Phase 6 — Docs
- [x] `ARCHITECTURE.md`: §1 feature list, §3 layout, §4.1 tables, §4.3 landmark rows for 062
      and 063, §5 pointer to the rebuild, §6 file types, §7 page table + client tabs +
      reminders, §8 domains/count (174 channels, 24 `pfm`)
- [x] `README.md` feature list, Quick Find scope, suite count, data-folder table;
      `CLAUDE.md` "schema head" note (063 on disk, live at 062)
- [x] Moved this plan file to `docs/`.

---

## 7. Enhancements (owner's picks, 2026-09-28)

**Build these (Phase 5):**

| # | Idea | Notes | Cost |
|---|---|---|---|
| E2 | **Follow-up reminder**: "Sent" with no answer after N days (default 7) shows in the Overview **Attention** list (`getAttentionItems`) | Scoped to the logged-in user (D1). "No answer" = current status still SENT. | S |
| E3 | **Valid until** date (optional) → Attention item before it expires (e.g. 3 days) and once expired while not Accepted/Rejected | Column `valid_until` already in §3.2 | S |
| E6 | **Fee change** between consecutive versions of the same item: `−1 500 (−12.5 %)` | Only when both versions have fees **and the same currency**; otherwise show nothing | S |
| E8 | **Excel export** of the current list view via the existing `xlsx.js` | Export what the filters show; fees as numbers, not text | M |
| E10 | **Quick Find search** of reference + title (workspace FTS) | Rows are per-user (D1), so they fit the user-scoped FTS index. First check how `workspace_search` is fed today (triggers vs code) and follow that exactly; if triggers, verify they exist after migrating (CLAUDE.md warning) | S–M |

**Not chosen — don't build:** E1 money strip · E4 client total · E5 copy version ·
E7 required rejection reason (the stage `note` stays optional) · E9 link to Project ·
E11 client contacts list.

---

## 8. Out of scope (on purpose)
- Invoices, payments, installments, contracts, meeting minutes — the old Finance scope. Not now.
- Approval workflow / permissions — the app has no roles; attribution only.
- Emailing offers from the app — the app is offline by design.
