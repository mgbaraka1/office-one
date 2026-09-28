# Vendored: Cairo (variable, weight axis only)

- Source: Google Fonts CSS2 API, `https://fonts.googleapis.com/css2?family=Cairo:wght@200..1000&display=swap`
  (upstream: https://github.com/google/fonts/tree/main/ofl/cairo — `Cairo[slnt,wght].ttf`)
- Vendored: 2026-09-27
- License: SIL Open Font License 1.1 (see OFL.txt) — free to bundle/embed in software, no per-device install required.
- Three `.woff2` files, one per Google Fonts subset (arabic / latin-ext / latin), each a single
  variable-weight face covering `font-weight: 200 1000` in one file — this app never needs the
  font's separate `slnt` (slant) axis, so the request omitted it and Google served the upright
  default instance. No static per-weight files vendored; `@font-face` declares the weight range
  once and the browser interpolates, so `font-weight: 650` (used by `.user-card-name`) renders
  as a real intermediate weight instead of a synthesized/faux bold.
- Not modified from what Google's CDN served.

To upgrade: repeat the same `curl` against the CSS2 API, diff the returned `url()`s against
`app.css`'s `@font-face` block, and replace the three files.
