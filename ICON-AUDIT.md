# Icon Audit — Cooperation Tools (TimeSheet)

_Phase 0, read-only. No code changed. No git commands run._

## 1. Current icon approach

**There is no icon library.** Every icon in the app is an **emoji / Unicode glyph** typed directly as text — either inline in markup (`<span class="nav-icon">📊</span>`) or assigned in JS via `el.textContent = '🗑️'`.

- **No** Font Awesome / Lucide / Feather / Bootstrap / Heroicons / Phosphor / Material — confirmed by grep across the repo.
- **No** icon image assets in the app UI. The only SVGs in `index.html` (lines 4630, 4696) are hand-rolled **chart** graphics (donut, trend line), not icons. `build/icon.svg` is the app/installer icon, out of scope.
- **No** CSS pseudo-element icons. The four `content: ''` rules (lines 138, 220, 411, 1066) are decorative bars/shimmers, not glyphs.
- Loaded via: nothing — they're literal characters in the single-file UI. Fonts loaded are Inter + JetBrains Mono (text only), consistent with the strict-CSP / offline constraint.

### Why this is a problem
1. **Color emoji are OS-rendered and not theme-aware.** 📊💳🗑️ paint with the platform's color glyph font; they ignore `--text`, `--muted`, `--primary`, and look different on Windows vs. print/PDF.
2. **Two visually different families are mixed**: full-color emoji (📊 🕐 💳 🗑️ 📅) sit next to monochrome line glyphs (⚙ ⏱ ▾ ■ ✕ ✓ →). No single stroke weight or visual language.
3. **Inconsistent variation selectors**: some glyphs carry emoji-presentation VS16 (✏️, 🗑️, ☀️, ⚠️, ✅) while siblings don't (⚙, ⏱, ✏ on line 2648 vs ✏️ on 4928), so even identical-meaning icons render differently across contexts.
4. **Sizing drift**: `.nav-icon` is set to `15px` but an emoji renders to its own metrics, so nav glyphs overflow the `19px` box differently than the intended size.

## 2. Full inventory

### Sidebar navigation (`.nav-icon`, 15px) — `index.html:1379–1412`
| Glyph | Where | Represents |
|---|---|---|
| 📊 | Analytics nav | Analytics / overview |
| 🕐 | Timesheet nav | Timesheet |
| 📌 | Not Yet nav | Backlog |
| 📄 | Reports nav | Reports |
| 💳 | Subscriptions nav | Subscriptions |
| 🏢 | Companies nav | Companies |
| 📁 | Projects nav | Projects |
| ⚙ | Settings nav | Settings |
| 🌙 / ☀️ | Theme toggle (`#theme-icon`, line 1405 / set at 4342) | Dark / light mode |
| 💾 | Backup Data | Backup |
| 🚪 | Log Out | Sign out |

### Page / section titles
| Glyph | Where | Represents |
|---|---|---|
| 📊 | `.an-title` Analytics (1420), analytics PDF header (4824) | Analytics |
| 📈 | `.an-section-title` Time Tracking (1447) | Time tracking section |
| 🔥 | `.an-section-title` Activity (1488) | Activity / streak section |
| 🔔 | `.an-section-title` Needs Attention (1510) | Alerts section |
| 📄 | `.reports-title` (1529) | Reports |
| 🕐 | `.topbar-title` Timesheet (1585) | Timesheet |
| 💳 | `.sub-title` Subscriptions (1811) | Subscriptions |
| 📌 | `.backlog-title` Not Yet (1844) | Backlog |
| 🏢 | `.cp-title` Companies (1878) | Companies |
| 📁 | `.cp-title` Projects (1894) | Projects |
| ⚙ | `.settings-mod-title` Settings (1910), Sub settings modal (2063) | Settings |

### Reports module cards (`.rmod-card-icon`, 44px tile, 22px glyph) — 1538–1568
| Glyph | Where | Represents |
|---|---|---|
| 🗓 | Daily Timesheet card | Daily report |
| ⏱ | Monthly Over-Time card | Over-time report |
| 💳 | Subscriptions card | Subscriptions report |

### Timesheet topbar / timer — 1585–1614
| Glyph | Where | Represents |
|---|---|---|
| 📅 | `.cal-icon` calendar trigger (1588) | Date picker |
| ▾ | calendar caret (1590), `Set Status ▾` (1789) | Dropdown caret |
| ⏱ | `#timer-icon` (1603), timer-start row btn, reset at 2642 | Timer (idle) |
| ⏸ | timer pause btn (1605, 2755, 2777, 2797) | Pause |
| ▶ | timer resume (2784) | Resume |
| ■ | timer Stop (1606), running row btn (2637) | Stop |
| 📍 | Today button (1611) | Jump to today |
| ⚙ | Settings button (1612) | Settings |
| 🗓 | Month button (1613), Month modal title (1768) | Month overview |
| ⌃N | `<kbd>` Add Record (1614) | Shortcut hint (keep as text/kbd) |

### Table row actions (`.row-btn`, ~28px btn) — timesheet 2637–2688, backlog 3638–3657, cp 4928–4932
| Glyph | Where | Represents |
|---|---|---|
| ⏱ / ■ | Timer start / stop per row | Start / stop timer |
| ✏️ | Edit row (2648, 3642, 4928) | Edit |
| 📅 | Move row to date (2660) | Move / reschedule |
| 🗑️ | Delete row (2688, 3646, 4932) | Delete |
| ✓ | Confirm move / assign (2672, 3655) | Confirm |
| ✕ | Cancel inline action (2675, 3657) | Cancel |
| → Day | Backlog assign (3638) | Assign to a day |

### Filters / search / bulk bar
| Glyph | Where | Represents |
|---|---|---|
| 🔍 | `.filter-icon` (1652) + placeholder text in sub/backlog/companies/projects searches (1813, 1846, 1883, 1899) | Search |
| ✕ | filter clear (1654) | Clear filter |
| ✕ Clear filters | cp filter reset (4177) | Clear |
| 📅 | bulk Move… (1795) | Move selected |
| 🗑 | bulk Delete (1796) | Delete selected |
| ✕ | bulk Clear (1797) | Clear selection |
| ✓ Move / ✕ | bulk move confirm/cancel (3935–3936) | Confirm / cancel |

### Modals / dialog actions
| Glyph | Where | Represents |
|---|---|---|
| ✕ | `.modal-close` ×6 (1705, 1769, 1956, 2016, 2064) + print Close (1694) | Close |
| ⬇ | Save PDF (print 1695, analytics PDF 1433), `⬇ PDF` | Download / save |
| 🖨 | Print (1696) | Print |

### Settings tabs (`.stab-icon`, 15px) — 1918–1937
| Glyph | Where | Represents |
|---|---|---|
| 🔧 | General tab | General settings |
| 🗂 | Lookups tab | Lookups |
| 🏢 | Companies lookup | Companies |
| 📁 | Projects lookup | Projects |
| 🏷 | Natural lookup | Activity type |
| ⏰ | Time Type lookup | Time type |
| 🔖 | Status lookup | Status |
| ↺ / × | Lookup option reactivate / delete (2311) | Restore / remove option |

### Status / badges / inline indicators
| Glyph | Where | Represents |
|---|---|---|
| ⚡ | In-Progress table divider (2481) | In-progress group |
| ✓ Saved / ✓ Moved | save status (2889, 2921) | Saved OK |
| ⚠ Save failed (2875), ⚠️ Backup failed (4840) | Error |
| ✅ | Backed-up confirmation (4839), "all clear" empty (4407) | Success |

### Empty-state / placeholder icons (larger, decorative)
| Glyph | Where | Size | Represents |
|---|---|---|---|
| 📋 | Timesheet empty (`.icon`, 1684) | large | No records |
| 💳 | Subscriptions empty (1835) | large | No subscriptions |
| 📌 | Backlog empty (1869) | large | Empty backlog |
| ✅ | Analytics "all clear" (`.de-icon`, 30px, 4407) | 30px | Nothing due |

### Overview / dash stat cards (label-prefixed emoji) — 4386–4394
| Glyph | Where | Represents |
|---|---|---|
| 💳 | attention list item icon (4386) | Subscription renewal |
| 🕐 | "Today" stat card label (4392) | Today hours |
| 📅 | "This Month" label (4393) | Month hours |
| 📌 | "Not Yet" label (4394) | Backlog count |

### Out of scope (intentionally icon-free / non-icon)
- **PDF report bodies** (Daily / Over-Time / Subscriptions) are deliberately plain & print-safe — no emoji except 📊 in the analytics-view PDF header (4824). The print constraint means report glyphs should stay minimal/monochrome.
- Arrows in **JS code comments** (2105, 2125, 2465, 2904, 3074, 3707, 4797) and the `→` range separator label (4479) are text, not icons.
- `⌃N` keyboard hint in `<kbd>` — a shortcut label, keep as text.

### Inconsistencies flagged
- **Two delete glyphs**: 🗑️ (row/bulk delete) vs `×`/✕ (lookup-option delete, line 2311) vs ✕ (close/cancel). Trash vs. close are conflated.
- **VS16 drift**: ✏ (2648) vs ✏️ (3642, 4928); ⚠ (2875) vs ⚠️ (4840); plain ⚙/⏱ vs emoji ✅/💳.
- **Caret `▾`** is a text glyph, not aligned with the line-icon family.
- Color emoji **cannot be recolored** to `--bad` on delete-hover etc., so the existing `.row-btn.del:hover { color: var(--bad) }` rules have no visible effect on the emoji.
- Nav 15px sizing vs. emoji intrinsic metrics → vertical-alignment wobble next to the label text.

## 3. Recommendation for Phase 2

**Adopt Lucide, inlined as local SVG (no CDN, no npm runtime dep).**

Rationale:
- **Stroke-based, single visual language** — replaces both the color-emoji and the random line-glyph families with one consistent 24×24, 2px-stroke set. Excellent coverage for every icon above (layout-dashboard, clock, pin, file-text, credit-card, building-2, folder, settings, moon/sun, save, log-out, search, trash-2, pencil, calendar, play/pause/square, printer, download, check, x, bell, flame, trending-up, zap, alert-triangle, check-circle, rotate-ccw, etc.).
- **`currentColor` strokes** → icons finally respect `--text`/`--muted`/`--primary`/`--bad` and hover states; theme-aware in light & dark with zero per-icon color code.
- **Fits the constraints**: offline + strict CSP. Lucide ships as static SVG path data; we can embed a tiny local sprite/helper in `index.html` (single-file UI preserved) with **no new npm dependency and no network** — I'll confirm the exact mechanism with you before adding anything.
- **Crisp in `printToPDF`** (vector), so report headers stay sharp and we can drop the lone 📊.

Phosphor/Heroicons are fine fallbacks, but nothing emoji-based is currently "in use" to stay compatible with, so Lucide's desktop-app fit + breadth wins.

### Open question for Phase 2 (will ask before guessing)
- Whether to keep **app/installer icon** (`build/icon.*`) untouched — assumed **yes** (out of scope).
- Whether **PDF report bodies** should also move to inline SVG or stay text-only for print safety — I'll confirm before touching reports.

---

## Phase 2 — Completed

**Library:** Lucide, inlined as local SVG. **No npm dependency added** to the project (sources were pulled once in a scratchpad and the path data embedded directly), **no CDN**, strict-CSP safe, single-file UI preserved.

**Mechanism (in `index.html`):**
- An `ICONS` map (43 icons) of Lucide inner-SVG path data near the top of the main `<script>`.
- `ic(name, cls)` → returns an inline `<svg class="lic">` with `stroke="currentColor"` so every icon inherits the theme tokens (`--text` / `--muted` / `--primary` / `--bad`) and hover states.
- `hydrateIcons()` swaps every static `[data-ic]` placeholder for its inline SVG at boot (called right before `bootAuth()`); dynamically-built rows/modals call `ic()` inline.
- A consolidated `.lic` CSS block sets consistent sizes per context (nav 18px, titles/section accents 18/14px, row/bulk buttons 14px, card tiles 22px, empty states 46px) and aligns icons to text.

**Coverage replaced:** sidebar nav (11) · all module/section/modal titles · report cards · timesheet topbar + live-timer cluster · all table row actions (timer/edit/duplicate/move/delete/confirm/cancel) across Timesheet, Backlog & Subscriptions · search & bulk bars · 6 modal close buttons · settings General/Lookups tabs + 5 lookup sub-tabs · lookup-option enable/disable toggle · status/save pills · in-progress divider · backup button · theme toggle (moon/sun) · empty states · dashboard stat-card labels + "needs attention" list.

**Notable semantic fixes:** delete is now consistently `trash-2` (was 🗑️ vs ×); close/cancel consistently `x`; duplicate `copy`; reschedule/move `calendar-clock`; backlog assign `calendar-plus`; in-progress divider `zap` tinted `--warn`.

**Deliberate non-icon decisions:** the four module-search placeholders had their lone 🔍 stripped (no wrapper to host an inline icon; the Timesheet filter keeps its proper leading `search` icon); the analytics-PDF header dropped its lone 📊 to stay print-safe (report bodies remain text-only by design); the `⌃N` keyboard hint and `→` typographic arrows in "Generate →" buttons are left as text.

**Verification:** main script passes `node --check`; all 43 referenced icon names resolve to a defined key (0 missing); the app boots in Electron with no JS errors.
