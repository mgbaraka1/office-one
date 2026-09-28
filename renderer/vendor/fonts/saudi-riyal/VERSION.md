# Saudi Riyal symbol glyph (U+20C1)

- **Source:** https://github.com/emran-alhaddad/Saudi-Riyal-Font (regular + bold,
  `fonts/regular/saudi_riyal.woff2` and `fonts/bold/saudi_riyal.woff2`, vendored
  unmodified on 2026-09-27).
- **License:** SIL Open Font License 1.1 — see `LICENSE` in this folder.
- **Why a separate font instead of adding this to Cairo:** Cairo (Google Fonts)
  doesn't have a glyph for U+20C1 yet — it's brand new (added to the Unicode
  standard in version 17.0, September 2025; King Salman approved the symbol
  itself in February 2025). No mainstream font ships it yet.
- **How it's wired in:** declared as two more `@font-face` rules under the
  `'Cairo'` family name in `renderer/app.css` (and again, base64-embedded, in
  `renderer/vendor/fonts/cairo/cairo-print-embed.js` for PDF/print exports),
  each restricted to `unicode-range: U+20C1`. Because it shares the `Cairo`
  family name, every existing `font-family: 'Cairo', ...` declaration in the
  app already picks it up automatically for that one character — no call site
  needed to change its font stack. `core.js`'s `CURRENCY_SYMBOLS` map is what
  actually emits the `⃁` character for `SAR` (and `$` for `USD`) in place
  of the currency code text.
- The font also maps the symbol to `U+E900` (a private-use codepoint, for apps
  that predate the standard's Sept 2025 assignment) — unused here, since we
  control both the font and the text that references it, so only U+20C1 is
  referenced.
- To verify glyph coverage after an update: open a page with `<span
  style="font-family:'Cairo'">&#x20C1;</span>` and confirm it renders the
  symbol, not a fallback box.
- **Metric mismatch, fixed via `size-adjust`/`*-override`:** this font is a
  completely different build from Cairo (2048 units/em vs Cairo's 1000; the
  U+20C1 glyph's own bbox is `[50,6 : 1174,1262]`, i.e. it reaches ~0.616em —
  noticeably shorter than Cairo's digits, which reach ~0.66em). Left alone,
  the symbol rendered visibly smaller than the digits next to it. Both
  `@font-face` rules (in `app.css` and `cairo-print-embed.js`) now carry
  `size-adjust: 108%` (0.66 / 0.616) to match Cairo's digit height, plus
  `ascent-override: 130.3%` / `descent-override: 57.1%` / `line-gap-override:
  0%` copied from Cairo's own hhea/OS2 values (both 1303/-571/0 at 1000
  units/em) so this face can't distort line-box height if it's ever the
  tallest glyph on a line. Measured with `fontTools` (`pip install fonttools`,
  then `TTFont(...).getBestCmap()` + glyph bbox / `head.unitsPerEm`). Re-derive
  these numbers the same way if either font file is ever swapped for a new
  version — they're specific to these exact files, not a general formula.
