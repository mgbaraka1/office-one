# Vendored: marked 18.0.14

- Source: https://registry.npmjs.org/marked/-/marked-18.0.14.tgz (npm `marked` package, `lib/marked.umd.js`)
- Tarball SHA-256: f74bd78902b6e83c4c488d6ea979c15619a11dbd0d8e21f4246bdd357c19c091
- Vendored: 2026-10-18
- License: MIT (see LICENSE)
- `marked.umd.js` is the npm package's `lib/marked.umd.js` as published, unmodified. UMD build, exposes `window.marked`. Its source map is not shipped.
- Turns Code Note Markdown into HTML — see `renderer/features/code-notes.js`. Its output is always passed through DOMPurify (`sanitizeCodeNoteHtml` in `renderer/features/knowledge-sanitize.js`) before it reaches the page.

To upgrade: download the new tarball, replace `marked.umd.js`, update this file.
