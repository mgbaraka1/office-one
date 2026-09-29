# Vendored: DOMPurify 3.4.13

- Source: https://registry.npmjs.org/dompurify/-/dompurify-3.4.13.tgz (npm `dompurify` package, `dist/purify.min.js`)
- Vendored: 2026-08-06
- License: MPL-2.0 OR Apache-2.0 (see LICENSE)
- `purify.min.js` is the npm package's `dist/purify.min.js` as published, unmodified. UMD build, exposes `window.DOMPurify`.
- Used to sanitize Knowledge Hub notes stored as HTML (written with the rich editor that was removed in Phase 2) before they are rendered or converted to plain text — see `renderer/features/knowledge-sanitize.js`.

To upgrade: download the new tarball, replace `purify.min.js`, update this file.
