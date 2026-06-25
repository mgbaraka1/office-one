# UI Audit — Cooperation Tools (TimeSheet)

> Read-only audit. No files were modified to produce this document, and **no git commands were run**.

---

## Phase 0 — Stack Summary

| Aspect | Finding |
|---|---|
| **Shell** | Electron `^42.3.3` desktop app (Chromium renderer + Node main). Offline, strict CSP — no CDNs, no remote scripts. |
| **Renderer tech** | **Vanilla HTML/CSS/JS**, no framework. The *entire* UI is one file: [index.html](index.html) (~5,226 lines) — `<style>` block (lines 19–1360), markup (1362–2092), and all JS (2093+). |
| **Styling system** | A single global `<style>` block driven by **CSS custom properties**. `:root` holds the light palette + design tokens; `:root[data-theme="dark"]` overrides content tokens. No SCSS, no Tailwind, no CSS modules. Theme applied pre-paint via an inline `<head>` script to avoid flash. |
| **Inline styles** | 115 `style="..."` occurrences total, but only **17 in the live app markup**; the other ~98 live inside JS report-builder template strings (the PDF/print documents, intentionally self-contained). The live-markup inline styles are small (column widths, one-off `text-transform`/`color` on hint spans, a `margin-bottom`). |
| **Icon library** | **None.** All icons are Unicode **emoji** (📊 🕐 📌 📄 💳 🏢 📁 ⚙ 🗓 ⏱ 🔍 …) inlined in markup. No icon font, no SVG sprite. Charts are hand-rolled SVG/CSS. |
| **Fonts** | Inter (UI) + JetBrains Mono (numeric/mono data), via Google Fonts `<link>` — the one sanctioned external asset. |

### Views / screens and where each is styled

| View | Markup | Primary CSS |
|---|---|---|
| Auth gate (login / setup) | 1364–1385 | `#auth-overlay`, `.auth-*` (1325–1358) |
| Sidebar (shared nav) | 1387–1428 | `#sidebar`, `.nav-item`, `.nav-badge`, `.sidebar-*` (107–146) |
| Analytics (home) | 1430–1537 | `.dash-*` (466–510), `.an-*` (512–645) |
| Reports | 1539–1592 | `#reports-topbar`, `.rmod-*` (424–464) |
| Timesheet | 1594–1694 | `#topbar`, `#totals-bar`, `#filter-bar`, `table` (152–404, 1218–1253) |
| Subscriptions | 1814–1845 | `#sub-topbar`, `.sub-*`, `.renew-badge` (332–339, 405–409, 762–765) |
| Not Yet (backlog) | 1847–1879 | `#backlog-topbar`, `.backlog-*` (411–422) |
| Companies / Projects | 1881–1911 | `.cp-*` (1003–1070) |
| Settings | 1913–1955 | `.settings-*`, `.stab`, `.ltab`, `.lookup-*` (892–1001) |
| Modals (record / sub / backlog / month / settings) | 1706–2092 | `#modal*`, `.modal-*`, `.form-*` (729–890) |
| Shared overlays | toasts, `#bulk-bar`, print preview | (676–727, 1096–1323) |

---

## Phase 1 — Audit

### Headline assessment (2 sentences)

This is **not a neglected UI** — it already carries a coherent, modern design system (teal accent, token-based light/dark theming, Inter + JetBrains Mono, consistent card/modal/badge components, hand-rolled SVG charts) migrated from the `sayedtimesheet` language in June 2026. The work needed is **consistency and refinement**, not a rebuild: the system is sound but it drifts at the edges — duplicated topbar rules, three different search-field treatments, ad-hoc spacing/radius/shadow values that bypass the tokens, an incomplete set of empty/loading states, and one functional inconsistency (only the Timesheet topbar is window-draggable).

---

### Per-view findings

#### Auth gate
- **Works:** Clean centered card, themed inputs, good focus glow, brand lockup, inline error line.
- **Problems:** Overlay background is hardcoded `#000000` regardless of theme — in light mode a white card sits on a pure-black field, which clashes with the otherwise warm light palette. No loading/disabled spinner state on submit beyond `opacity:.6`.

#### Sidebar (shared)
- **Works:** Strong active state (teal left-bar + tinted bg), clear hover, badge on Subscriptions, footer grouping. Genuinely polished.
- **Problems:** `#sidebar` uses `backdrop-filter: blur(12px)` + 80%-opacity bg, but nothing sits *behind* the sidebar (it's flush to the window edge), so the glassmorphism is inert cost. Footer mixes a real nav purpose (theme/backup/logout) with the nav-item visual style, so Log Out looks identical in weight to a destructive-ish action — no visual signal that it's terminal.

#### Analytics (home)
- **Works:** The most visually mature screen — labelled section bands, KPI cards, hand-rolled trend/donut/heatmap, hover lifts. Cohesive.
- **Problems:** **Duplicate heading** — the topbar already says "📊 Analytics" and the body repeats a greeting `<h1>` (acceptable as a greeting, but combined with the topbar title it's two competing page titles). Chart empty states (`.an-empty`, `.dash-empty`) are a *third and fourth* empty-state pattern distinct from the module-level ones. Very dense on first paint with no skeleton/loading state while SQL aggregates resolve.

#### Reports
- **Works:** Card grid with icon tiles, clear descriptions, inline date/month pickers, primary "Generate" CTA.
- **Problems:** **Redundant title** — topbar `📄 Reports` + an `<h1>Reports</h1>` intro directly below = the same word twice, ~50px apart. The third card (Subscriptions) has no input control, so its `.rmod-card-controls` row is unbalanced/empty-left compared to the other two cards — uneven card rhythm.

#### Timesheet (core view)
- **Works:** The flagship table — rounded `tbody` "card" treatment, sticky header, status grouping with the "⚡ In Progress" divider, hover row actions, tabular-nums alignment, inline minute edit, timer chip. Data-dense but readable.
- **Problems:**
  - The Timesheet topbar is the **only** one with **no module title** — it opens straight into the calendar trigger, while every other module leads with a "🕐 …" title span. Inconsistent topbar anatomy.
  - It is also the **only** topbar with `-webkit-app-region: drag` (line 158), so **the window can only be dragged from the Timesheet page** — a real functional inconsistency across modules.
  - `#totals-bar` stat cards use a hardcoded `border-radius: 14px` and a hardcoded hover `box-shadow: 0 4px 16px -4px rgba(0,0,0,.15)` instead of `var(--radius)` / `var(--shadow-sm)`; the hardcoded shadow is nearly invisible in dark mode.

#### Subscriptions
- **Works:** Reuses the global table, color-coded `.renew-badge` (ok/soon/urgent), search + settings + add in the topbar.
- **Problems:** Search uses `.mod-search` with an **emoji baked into the placeholder** ("🔍 Search…") — a *different* search treatment from the Timesheet filter (which uses a positioned `.filter-icon` over a padded input) and from Companies/Projects (`.cp-search`). Three search styles across the app.

#### Not Yet (backlog)
- **Works:** Same table system, explanatory hint, clean empty state.
- **Problems:** The `.backlog-hint` paragraph sits *above* the table with no card/container — visually orphaned between topbar and table. Same `.mod-search` emoji-placeholder inconsistency as Subscriptions.

#### Companies / Projects (read-only)
- **Works:** Two-pane master/detail, count chips, active-item highlight, filter bar + summary chips.
- **Problems:**
  - Topbars contain **only a title** — no `topbar-right`, no actions — so they read as sparse/unfinished next to the action-rich topbars elsewhere, and (like all non-Timesheet modules) they aren't window-draggable.
  - This view introduces yet more **bespoke empty states**: `.cp-list-empty`, `.cp-placeholder`, `.cp-records-empty` — none of which share styling with the `#empty-state` component the other modules use. Four+ empty-state idioms total across the app.

#### Settings
- **Works:** Tabbed page (General / Lookups), nested lookup sub-tabs, consistent stab/ltab active styling, inline add/relabel rows.
- **Problems:** `.settings-body` is a borrowed-from-modal layout (a 160px left rail + panels) living inside a full page — the left tab rail is very narrow and feels modal-sized rather than page-sized. The lookup add/edit rows use a *fourth* input style (`.lookup-add-row input`, 1.5px border) distinct from `.form-group`, `.mod-search`, and `.cp-search`.

#### Modals (record / subscription / backlog / month / settings)
- **Works:** Genuinely consistent — shared `modalIn` animation, `--shadow`, header/body/footer structure, `.form-group`/`.form-row` grid, focus glow, shake-on-error.
- **Problems:** `#month-modal` is the outlier — hardcoded `border-radius: 16px` and `box-shadow: 0 20px 60px rgba(0,0,0,.25)` instead of the `var(--radius)` / `var(--shadow)` every other modal uses; in dark mode its shadow/edges differ subtly from the rest.

---

### App-wide observations

**Color palette** — *Strong.* A complete token set exists (`--primary` teal, `--surface/2`, `--border`, `--text`, `--muted`, `--accent`, semantic `--good/warn/bad`, status + renewal pairs) with full dark overrides. Gaps: (1) `--muted` contrast is borderline — `#7a8298` on white ≈ 4.0:1, and dark `#6d6e78` on `#0c0c0f` is low for the many uppercase micro-labels; (2) a few values bypass tokens (hardcoded radii/shadows noted above; the `#000` auth bg).

**Typography** — *Good hierarchy, minor redundancy.* Clear roles: 26px greetings, 15px topbar titles, 19px modal titles, ~11px uppercase muted labels, JetBrains Mono for numerics. The redundancy is duplicated page titles (topbar title + body `<h1>` on Analytics & Reports), not the scale itself.

**Spacing** — *The weakest area.* There is **no spacing scale** — paddings are ad-hoc literals, and equivalent scroll regions each pick a different value: `#table-wrap` `18/22/28`, `.an-scroll` `24/28/40`, `.rmod-scroll` `28/32/40`, `#sub-table-wrap` `16/20/24`, `#backlog-table-wrap` `18/22/28`, `.cp-records-panel` `16/20/24`. Six paddings for one concept. Same story for the topbars (all `10px 18px` — at least *these* agree).

**Component consistency** — *Mostly unified, with two real fault lines.* (1) **Topbars:** six near-identical rule blocks (`#an-topbar`, `#sub-topbar`, `#backlog-topbar`, `#reports-topbar`, `.cp-topbar`, `#settings-topbar`) each re-declaring the same flex/padding/bg/border instead of one shared `.module-topbar` class — and they disagree on whether they have a title, actions, and window-drag. (2) **Search/inputs:** four input idioms (`.form-group`, `.mod-search`, `.cp-search`/`.cp-filter-field`, `.lookup-add-row`/`.general-field`) with differing borders (1px vs 1.5px), radii, and icon handling. Buttons, badges, cards, tables, and modals are otherwise consistent and good.

**Empty / loading / transition states** — *Empty states exist but are fragmented; loading states are absent.* At least four empty-state treatments (`#empty-state` family, `.an-empty`, `.dash-empty`, the `.cp-*` trio) with no shared component. There are **no loading/skeleton states** anywhere, despite async SQL/IPC fetches feeding Analytics, Companies, Projects, and day loads. Transitions/animations (`modalIn`, `toastIn`, hover lifts, timer pulse) are well done.

**Scrollbars** — Custom WebKit + Firefox scrollbars are already styled globally to the border token. Good; no action needed beyond verifying they read well in both themes.

**Overlap risk** — `#undo-toast`, `#sub-undo-toast`, `#backlog-undo-toast`, `.app-toast`, and `#bulk-bar` are all pinned `bottom:28px; left:50%` and would stack on top of each other if two fired at once; they also use slightly different backgrounds (`--elevate` vs `--surface`).

---

### Proposed Phase 2 scope (for approval — not yet applied)

1. **Tokenize spacing & fix drift** — add a `--space-*` scale; replace ad-hoc paddings on the six scroll regions and the hardcoded radii/shadows (`#month-modal`, `#totals-bar`, auth bg) with tokens.
2. **Unify topbars** — one shared `.module-topbar` class; give every module a title + consistent `topbar-right`; make the window draggable from **all** topbars (move `-webkit-app-region: drag` to the shared rule), not just Timesheet.
3. **Unify inputs & search** — single input style + one search-field pattern (positioned icon, not emoji-in-placeholder) across Timesheet / Subscriptions / Backlog / Companies / Projects / Settings.
4. **One empty-state component** — consolidate `#empty-state`, `.an-empty`, `.dash-empty`, `.cp-*` into a shared `.empty-state` and apply everywhere, including the read-only views.
5. **Add loading/skeleton states** — lightweight shimmer/placeholder for Analytics cards, Companies/Projects panels, and day loads.
6. **Contrast pass** — nudge `--muted` (esp. dark) to clear WCAG AA for the micro-labels.
7. **De-duplicate page titles** — drop the redundant Reports `<h1>` / reconcile the Analytics greeting vs topbar title.
8. **Toast/bulk-bar stacking** — define a single bottom-center stack order so they never overlap.

---

## Changes Applied (Phase 2)

All changes are **CSS + minimal markup only**, confined to [index.html](index.html). No JS logic, IPC, preload, DB, schema, or data-flow code was touched, and **no git commands were run**. The work was refinement of the existing design system rather than a re-skin — the teal/Inter/JetBrains-Mono language was kept intact and made more consistent.

### Color & palette
- **Palette unchanged in spirit** — the existing token-based teal system was already strong, so it was *tightened*, not replaced. Same `--primary #14b8a6`, surfaces, and semantic good/warn/bad.
- **Contrast pass on `--muted`** (the app's secondary-text color, used on every micro-label): light `#7a8298 → #646c84`, dark `#6d6e78 → #9095a3`, and `--sidebar-muted → #9095a3`. This clears WCAG AA for the small uppercase labels in both themes, which previously sat ~3.8–4.0:1.
- **Auth background** no longer hardcoded `#000000` (which clashed in light mode) — now a theme-aware `var(--bg)` with a soft teal radial glow, so login matches the active theme.

### Typography
- **Font scale untouched** (it already had clear roles). Removed the *redundant* page title on Reports (the topbar already says "📄 Reports", so the duplicate `<h1>Reports</h1>` was dropped; the descriptive subtitle stays). The Analytics personalized greeting was kept — it's a greeting, not a duplicate title.
- **Unified topbar titles** into one shared rule (`.topbar-title, .an-title, .sub-title, …`) at a single 15px/700 spec, and gave the **Timesheet** topbar the module title it was missing ("🕐 Timesheet"), so every module now leads with a consistent title.

### Tokens & spacing (the weakest area in the audit)
- **Added a `--space-1…8` scale** (4/8/12/16/20/24/32/40) and applied it to the previously ad-hoc scroll-region paddings. The six divergent values collapsed into **two consistent tiers**: list/table regions (Timesheet, Subscriptions, Backlog, Companies/Projects records) all share `20/24/32`; wide content pages (Analytics, Reports) share `24/32/40`.
- **Killed token drift**: `#month-modal` (was hardcoded `border-radius:16px` + bespoke shadow) and the `#totals-bar` stat cards (hardcoded `14px` radius + a near-invisible-in-dark `rgba(0,0,0,.15)` hover shadow) now use `var(--radius)` / `var(--shadow)` / `var(--shadow-sm)` like everything else.

### Component consistency
- **Topbars de-duplicated** — six near-identical rule blocks (`#topbar`, `#an-topbar`, `#sub-topbar`, `#backlog-topbar`, `#reports-topbar`, `.cp-topbar`, `#settings-topbar`) merged into **one shared rule**. As part of this, **`-webkit-app-region: drag` now applies to every topbar** (with `> *` children set to `no-drag`), fixing the functional bug where the window could only be dragged from the Timesheet page.
- **Inputs normalized** — the divergent `1.5px / 8px / no focus-glow` family (`.cp-search`, `.cp-filter-field`, `.lookup-add-row`, `.general-field`, `.rmod-field`, `#filter-input`) was brought onto the same baseline as the modal `.form-group` inputs: `1px` border, `var(--radius-sm)`, and the standard `primary border + 3px glow` focus state. Every text field in the app now focuses identically.
- **Empty states consolidated** — the full-page read-only placeholder (`.cp-placeholder`) was folded into the shared `#empty-state` family (same flex layout, 44px icon, spacing), and the four in-card empties (`.an-empty`, `.dash-empty`, `.cp-records-empty`, `.cp-list-empty`) were unified into a single rule. Four+ ad-hoc idioms → two (page-level + in-card).
- **Floating elements harmonized** — undo toasts and the generic app-toast used `--elevate` while the bulk-bar/menus used `--surface`; all bottom-center floats now share `var(--surface)` so they read as one component layer.

### Loading states
- **Added a reusable `.skeleton` / `.skeleton-text` / `.skeleton-card` shimmer utility** (token-driven, with a `prefers-reduced-motion` opt-out).

### Cleanup
- Removed two empty CSS blocks flagged by the linter (`#row-count-card {}`, `.lookup-category {}`).

---

### Conflicts / compromises (per the "stop and describe" rule)

1. **Skeleton loaders are CSS-only and not yet wired in.** Actually *showing* a skeleton while Analytics / Companies / Projects / day data loads requires the render functions to emit `.skeleton` placeholder markup before the async IPC resolves — that is **JS logic**, which Phase 2 was scoped to exclude. So the utility is in place and ready, but no view renders it yet. Wiring it up is a follow-up that needs your go-ahead to touch the render JS.
2. **Companies / Projects topbars remain title-only.** The audit noted they look sparse next to action-rich topbars, but these are genuinely read-only views and their search lives in the left list panel — inventing topbar actions would be decorative. They now at least share the unified topbar styling and are window-draggable. Left as-is intentionally.
3. **Search icon treatment was standardized on emoji-in-placeholder, not a positioned icon.** Four of the five searches already used the emoji-placeholder pattern; converting them all to the Timesheet filter's positioned-`.filter-icon` approach would mean restructuring each search input's markup (wrapper + absolutely-positioned span). To stay within "structure changes only if strictly necessary," I unified the *field* styling (border/radius/focus) and left the emoji-placeholder affordance consistent across the module searches. The Timesheet filter keeps its positioned icon since it lives in a dedicated filter bar.
4. **No live GUI boot test was run.** The changes are purely presentational with no JS touched, and launching Electron would open an app window over your active session unprompted. Token integrity and selector coverage were verified statically (grep) instead. If you'd like, I can boot the app to confirm visually.

> Reverting everything is `git checkout .` (or `git checkout -- index.html UI-AUDIT.md`) — all changes are uncommitted working-tree edits, as requested.
