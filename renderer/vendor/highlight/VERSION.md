# Vendored: highlight.js 11.12.0

- Source: https://registry.npmjs.org/@highlightjs/cdn-assets/-/cdn-assets-11.12.0.tgz (npm `@highlightjs/cdn-assets` package)
- Tarball SHA-256: b8a006d30f45afe783072569f3d69c5b60c0e7b9ca28cd474e12f2584e2a3bd9
- Vendored: 2026-10-18
- License: BSD-3-Clause (see LICENSE)
- `highlight.min.js` is the package's prebuilt common bundle (SQL, Bash, JavaScript, Python, JSON, XML and the other "common" grammars) and `powershell.min.js` is its `languages/powershell.min.js`, both as published, unmodified. Classic scripts; expose `window.hljs`.
- No theme stylesheet is vendored: token colours are app tokens in `renderer/app.css` (`.hljs-*`), so they follow light and dark mode.
- Colours the code blocks of Code Notes — see `renderer/features/code-notes.js`. Highlighting runs on a block's plain text and its output is escaped by highlight.js itself.

To upgrade: download the new tarball, replace both files, update this file.
