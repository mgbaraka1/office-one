# Vendored: Quill 2.0.3

- Source: https://registry.npmjs.org/quill/-/quill-2.0.3.tgz (npm `quill` package, `dist/quill.js` + `dist/quill.snow.css`)
- Vendored: 2026-08-06
- License: BSD-3-Clause (see LICENSE)
- `quill.min.js` is the npm package's `dist/quill.js` as published (already minified by their build, no `.min` suffix upstream — renamed here for clarity). Full build (includes default themes/formats/modules), UMD, exposes `window.Quill`. No changes made to the file contents.
- `quill.snow.css` is the npm package's `dist/quill.snow.css`, unmodified. Verified no `@font-face` or remote `url()` references — icons are inline SVG data URIs, not an icon font, so it satisfies this app's CSP (`script-src 'self'`, no CDN/font requests).
- Not vendored: `quill.core.js`/`quill.core.css` (bare core, would need manual module registration), `quill.bubble.css` (alternate theme, unused).

To upgrade: repeat the same download/inspection process (check for new remote references before replacing) and update this file.
