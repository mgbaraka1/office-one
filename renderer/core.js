// ── Icon system (Lucide, inlined offline SVG — no CDN, strict-CSP safe) ──
// Each entry is the inner markup of a 24×24 Lucide icon; strokes use currentColor
// so icons inherit the theme (--text / --muted / --primary / --bad) and hover states.
const ICONS = {
  "panel-left-close": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M9 3v18\" /><path d=\"m16 15-3-3 3-3\" />",
  "layout-dashboard": "<rect width=\"7\" height=\"9\" x=\"3\" y=\"3\" rx=\"1\" /><rect width=\"7\" height=\"5\" x=\"14\" y=\"3\" rx=\"1\" /><rect width=\"7\" height=\"9\" x=\"14\" y=\"12\" rx=\"1\" /><rect width=\"7\" height=\"5\" x=\"3\" y=\"16\" rx=\"1\" />",
  "clock": "<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M12 6v6l4 2\" />",
  "pin": "<path d=\"M12 17v5\" /><path d=\"M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z\" />",
  "file-text": "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /><path d=\"M14 2v5a1 1 0 0 0 1 1h5\" /><path d=\"M10 9H8\" /><path d=\"M16 13H8\" /><path d=\"M16 17H8\" />",
  "credit-card": "<rect width=\"20\" height=\"14\" x=\"2\" y=\"5\" rx=\"2\" /><line x1=\"2\" x2=\"22\" y1=\"10\" y2=\"10\" />",
  "building-2": "<path d=\"M10 12h4\" /><path d=\"M10 8h4\" /><path d=\"M14 21v-3a2 2 0 0 0-4 0v3\" /><path d=\"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2\" /><path d=\"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16\" />",
  "building": "<rect width=\"16\" height=\"20\" x=\"4\" y=\"2\" rx=\"2\" ry=\"2\" /><path d=\"M9 22v-4h6v4\" /><path d=\"M8 6h.01\" /><path d=\"M16 6h.01\" /><path d=\"M12 6h.01\" /><path d=\"M12 10h.01\" /><path d=\"M12 14h.01\" /><path d=\"M16 10h.01\" /><path d=\"M16 14h.01\" /><path d=\"M8 10h.01\" /><path d=\"M8 14h.01\" />",
  "folder": "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\" />",
  "book-open": "<path d=\"M12 7v14\" /><path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3Z\" /><path d=\"M21 18a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-5a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3Z\" />",
  "settings": "<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\" /><circle cx=\"12\" cy=\"12\" r=\"3\" />",
  "moon": "<path d=\"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401\" />",
  "sun": "<circle cx=\"12\" cy=\"12\" r=\"4\" /><path d=\"M12 2v2\" /><path d=\"M12 20v2\" /><path d=\"m4.93 4.93 1.41 1.41\" /><path d=\"m17.66 17.66 1.41 1.41\" /><path d=\"M2 12h2\" /><path d=\"M20 12h2\" /><path d=\"m6.34 17.66-1.41 1.41\" /><path d=\"m19.07 4.93-1.41 1.41\" />",
  "save": "<path d=\"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z\" /><path d=\"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7\" /><path d=\"M7 3v4a1 1 0 0 0 1 1h7\" />",
  "log-out": "<path d=\"m16 17 5-5-5-5\" /><path d=\"M21 12H9\" /><path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\" />",
  "trending-up": "<path d=\"M16 7h6v6\" /><path d=\"m22 7-8.5 8.5-5-5L2 17\" />",
  "flame": "<path d=\"M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4\" />",
  "bell": "<path d=\"M10.268 21a2 2 0 0 0 3.464 0\" /><path d=\"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326\" />",
  "calendar": "<path d=\"M8 2v4\" /><path d=\"M16 2v4\" /><rect width=\"18\" height=\"18\" x=\"3\" y=\"4\" rx=\"2\" /><path d=\"M3 10h18\" />",
  "chevron-down": "<path d=\"m6 9 6 6 6-6\" />",
  "chevron-up": "<path d=\"m18 15-6-6-6 6\" />",
  "chevron-right": "<path d=\"m9 18 6-6-6-6\" />",
  "timer": "<line x1=\"10\" x2=\"14\" y1=\"2\" y2=\"2\" /><line x1=\"12\" x2=\"15\" y1=\"14\" y2=\"11\" /><circle cx=\"12\" cy=\"14\" r=\"8\" />",
  "play": "<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\" />",
  "pause": "<rect x=\"14\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\" /><rect x=\"5\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\" />",
  "square": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />",
  "calendar-check": "<path d=\"M8 2v4\" /><path d=\"M16 2v4\" /><rect width=\"18\" height=\"18\" x=\"3\" y=\"4\" rx=\"2\" /><path d=\"M3 10h18\" /><path d=\"m9 16 2 2 4-4\" />",
  "calendar-days": "<path d=\"M8 2v4\" /><path d=\"M16 2v4\" /><rect width=\"18\" height=\"18\" x=\"3\" y=\"4\" rx=\"2\" /><path d=\"M3 10h18\" /><path d=\"M8 14h.01\" /><path d=\"M12 14h.01\" /><path d=\"M16 14h.01\" /><path d=\"M8 18h.01\" /><path d=\"M12 18h.01\" /><path d=\"M16 18h.01\" />",
  "pencil": "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\" /><path d=\"m15 5 4 4\" />",
  "calendar-clock": "<path d=\"M16 14v2.2l1.6 1\" /><path d=\"M16 2v4\" /><path d=\"M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5\" /><path d=\"M3 10h5\" /><path d=\"M8 2v4\" /><circle cx=\"16\" cy=\"16\" r=\"6\" />",
  "trash-2": "<path d=\"M10 11v6\" /><path d=\"M14 11v6\" /><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\" /><path d=\"M3 6h18\" /><path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\" />",
  "check": "<path d=\"M20 6 9 17l-5-5\" />",
  "x": "<path d=\"M18 6 6 18\" /><path d=\"m6 6 12 12\" />",
  "calendar-plus": "<path d=\"M16 19h6\" /><path d=\"M16 2v4\" /><path d=\"M19 16v6\" /><path d=\"M21 12.598V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8.5\" /><path d=\"M3 10h18\" /><path d=\"M8 2v4\" />",
  "search": "<path d=\"m21 21-4.34-4.34\" /><circle cx=\"11\" cy=\"11\" r=\"8\" />",
  "download": "<path d=\"M12 15V3\" /><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" /><path d=\"m7 10 5 5 5-5\" />",
  "printer": "<path d=\"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2\" /><path d=\"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6\" /><rect x=\"6\" y=\"14\" width=\"12\" height=\"8\" rx=\"1\" />",
  "sliders-horizontal": "<path d=\"M10 5H3\" /><path d=\"M12 19H3\" /><path d=\"M14 3v4\" /><path d=\"M16 17v4\" /><path d=\"M21 12h-9\" /><path d=\"M21 19h-5\" /><path d=\"M21 5h-7\" /><path d=\"M8 10v4\" /><path d=\"M8 12H3\" />",
  "list": "<path d=\"M3 5h.01\" /><path d=\"M3 12h.01\" /><path d=\"M3 19h.01\" /><path d=\"M8 5h13\" /><path d=\"M8 12h13\" /><path d=\"M8 19h13\" />",
  "tag": "<path d=\"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z\" /><circle cx=\"7.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\" />",
  "alarm-clock": "<circle cx=\"12\" cy=\"13\" r=\"8\" /><path d=\"M12 9v4l2 2\" /><path d=\"M5 3 2 6\" /><path d=\"m22 6-3-3\" /><path d=\"M6.38 18.7 4 21\" /><path d=\"M17.64 18.67 20 21\" />",
  "flag": "<path d=\"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528\" />",
  "shield-alert": "<path d=\"M20 13c0 5-3.5 7.5-7.35 8.95a1 1 0 0 1-1.3 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\" /><path d=\"M12 8v4\" /><path d=\"M12 16h.01\" />",
  "wrench": "<path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z\" />",
  "database": "<ellipse cx=\"12\" cy=\"5\" rx=\"9\" ry=\"3\" /><path d=\"M3 5V19A9 3 0 0 0 21 19V5\" /><path d=\"M3 12A9 3 0 0 0 21 12\" />",
  "server": "<rect width=\"20\" height=\"8\" x=\"2\" y=\"2\" rx=\"2\" ry=\"2\" /><rect width=\"20\" height=\"8\" x=\"2\" y=\"14\" rx=\"2\" ry=\"2\" /><line x1=\"6\" x2=\"6.01\" y1=\"6\" y2=\"6\" /><line x1=\"6\" x2=\"6.01\" y1=\"18\" y2=\"18\" />",
  "rotate-ccw": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\" /><path d=\"M3 3v5h5\" />",
  "zap": "<path d=\"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z\" />",
  "triangle-alert": "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\" /><path d=\"M12 9v4\" /><path d=\"M12 17h.01\" />",
  "circle-check": "<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"m9 12 2 2 4-4\" />",
  "clipboard-list": "<rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\" /><path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\" /><path d=\"M12 11h4\" /><path d=\"M12 16h4\" /><path d=\"M8 11h.01\" /><path d=\"M8 16h.01\" />",
  "copy": "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\" /><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\" />",
  "upload": "<path d=\"M12 3v12\" /><path d=\"m17 8-5-5-5 5\" /><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" />",
  "external-link": "<path d=\"M15 3h6v6\" /><path d=\"M10 14 21 3\" /><path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\" />",
  "plus": "<path d=\"M5 12h14\" /><path d=\"M12 5v14\" />",
  "timer-reset": "<path d=\"M10 2h4\" /><path d=\"M12 14v-4\" /><path d=\"M4 13a8 8 0 0 1 8-7 8 8 0 1 1-5.3 14L4 17.6\" /><path d=\"M9 17H4v5\" />",
  "compass": "<circle cx=\"12\" cy=\"12\" r=\"10\" /><polygon points=\"16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76\" />",
  "layers": "<path d=\"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z\" /><path d=\"m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65\" /><path d=\"m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65\" />",
  "rows-3": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M21 9H3\" /><path d=\"M21 15H3\" />",
  "command": "<path d=\"M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3\" />",
  "arrow-right": "<path d=\"M5 12h14\" /><path d=\"m12 5 7 7-7 7\" />",
  "eye": "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\" /><circle cx=\"12\" cy=\"12\" r=\"3\" />",
  "circle": "<circle cx=\"12\" cy=\"12\" r=\"10\" />",
  "ban": "<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"m4.9 4.9 14.2 14.2\" />",
  "briefcase": "<path d=\"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16\" /><rect width=\"20\" height=\"14\" x=\"2\" y=\"6\" rx=\"2\" />",
  "activity": "<path d=\"M22 12h-4l-3 9L9 3l-3 9H2\" />",
  "calendar-range": "<path d=\"M8 2v4\" /><path d=\"M16 2v4\" /><rect width=\"18\" height=\"18\" x=\"3\" y=\"4\" rx=\"2\" /><path d=\"M3 10h18\" /><path d=\"M17 14h-6\" /><path d=\"M13 18H7\" /><path d=\"M7 14h.01\" /><path d=\"M17 18h.01\" />",
  "folder-plus": "<path d=\"M12 10v6\" /><path d=\"M9 13h6\" /><path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\" />",
  "plug": "<path d=\"M12 22v-5\" /><path d=\"M9 8V2\" /><path d=\"M15 8V2\" /><path d=\"M18 8v5a6 6 0 0 1-12 0V8Z\" />",
  "table": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M3 9h18\" /><path d=\"M3 15h18\" /><path d=\"M9 9v12\" /><path d=\"M15 9v12\" />",
  "user-plus": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\" /><circle cx=\"9\" cy=\"7\" r=\"4\" /><path d=\"M19 8v6\" /><path d=\"M22 11h-6\" />"
};
// Build an inline SVG string for icon `name`. Optional extra class via `cls`.
function ic(name, cls) {
  const inner = ICONS[name] || '';
  return '<svg class="lic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
       + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
}
// Replace every static [data-ic] placeholder with its inline SVG (once).
function hydrateIcons(root) {
  (root || document).querySelectorAll('[data-ic]').forEach(el => {
    if (el.dataset.iced) return;
    el.innerHTML = ic(el.getAttribute('data-ic'));
    el.dataset.iced = '1';
  });
}

// Accessibility: every icon-only button across the app already sets a `title`
// tooltip; mirror it onto `aria-label` too so assistive tech gets a reliable
// accessible name (title alone isn't consistently exposed as one). Rather than
// touching every individual button-builder call site, this runs once at boot
// for the initial DOM, then a MutationObserver keeps it in sync forever after —
// any button created (or re-titled) anywhere in the app gets it automatically.
function syncAriaLabelFromTitle(el) {
  if (el.nodeType !== 1 || el.tagName !== 'BUTTON' || !el.title) return;
  if (!el.hasAttribute('aria-label') || el.dataset.autoAriaLabel === '1') {
    el.setAttribute('aria-label', el.title);
    el.dataset.autoAriaLabel = '1';
  }
}
function syncAriaLabelsFromTitle(root) {
  const scope = root || document;
  if (scope.matches?.('button[title]')) syncAriaLabelFromTitle(scope);
  scope.querySelectorAll?.('button[title]').forEach(syncAriaLabelFromTitle);
}

const KEYBOARD_CLICKABLE = '.cal-day:not(.empty),.status-badge,.dash-att-item,.an-bar-row.clickable,.month-cell.has,.cl-search-table tbody tr,.pj-card';
function makeKeyboardClickable(el) {
  if (!(el instanceof HTMLElement) || el.dataset.keyboardClickable === '1') return;
  el.dataset.keyboardClickable = '1';
  if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
  if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); el.click();
  });
}

function syncControlSemantics(root = document) {
  const scopes = [root, ...(root.querySelectorAll ? root.querySelectorAll('*') : [])];
  scopes.forEach(el => {
    if (!(el instanceof Element)) return;
    if (el.classList.contains('modal-close') && !el.title) el.title = 'Close dialog';
    if (el.matches(KEYBOARD_CLICKABLE)) makeKeyboardClickable(el);
    if (el.classList.contains('seg-btn')) el.setAttribute('aria-pressed', String(el.classList.contains('active')));
    if (el.matches('.nav-item[data-module]')) {
      if (!el.title) el.title = el.querySelector('.nav-label')?.textContent?.trim() || '';
      if (el.classList.contains('active')) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    }
    if (el.matches('#module-settings .stab')) el.setAttribute('aria-selected', String(el.classList.contains('active')));
  });
  root.querySelectorAll?.('.seg-ctl').forEach(ctl => {
    if (!ctl.hasAttribute('role')) ctl.setAttribute('role', 'group');
    ctl.querySelectorAll('.seg-btn').forEach(btn => btn.setAttribute('aria-pressed', String(btn.classList.contains('active'))));
  });
  root.querySelectorAll?.('.nav-item[data-module]').forEach(btn => {
    if (btn.classList.contains('active')) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  root.querySelectorAll?.('#module-settings .settings-tabs').forEach(el => {
    el.setAttribute('role', 'tablist');
    el.setAttribute('aria-orientation', 'vertical');
  });
  root.querySelectorAll?.('#module-settings .stab').forEach(btn => {
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(btn.classList.contains('active')));
    btn.setAttribute('aria-controls', 'tab-' + btn.dataset.tab);
    if (!btn.id) btn.id = 'stab-' + btn.dataset.tab;
    // Roving tabindex: only the active tab sits in the normal Tab order —
    // Arrow keys (wired once in initSettingsTablistKeyboardNav) move focus
    // between the rest, the standard tablist keyboard pattern.
    btn.tabIndex = btn.classList.contains('active') ? 0 : -1;
  });
  root.querySelectorAll?.('#module-settings .settings-panel').forEach(panel => {
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', 'stab-' + panel.id.replace(/^tab-/, ''));
  });
  syncAriaLabelsFromTitle(root);
}

function watchAriaLabels() {
  syncControlSemantics();
  new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === 'attributes') { syncControlSemantics(m.target); continue; }
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        syncControlSemantics(node);
        connectFormLabels(node);
      });
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'class'] });
}

// Standard tablist keyboard pattern (WAI-ARIA APG) for the Settings tab
// strip: Up/Down move focus among VISIBLE tabs (search can hide some — see
// filterSettingsTabs), Home/End jump to the first/last visible one. Wired
// once — syncControlSemantics() keeps aria-selected/tabIndex in sync as the
// active tab changes, this only needs to handle the keypress itself.
function initSettingsTablistKeyboardNav() {
  document.getElementById('module-settings')?.addEventListener('keydown', e => {
    const tab = e.target.closest('#module-settings .settings-tabs .stab');
    if (!tab) return;
    const visible = [...document.querySelectorAll('#module-settings .settings-tabs .stab')].filter(b => !b.hidden);
    const i = visible.indexOf(tab);
    if (i === -1) return;
    let next = null;
    if (e.key === 'ArrowDown') next = visible[(i + 1) % visible.length];
    else if (e.key === 'ArrowUp') next = visible[(i - 1 + visible.length) % visible.length];
    else if (e.key === 'Home') next = visible[0];
    else if (e.key === 'End') next = visible[visible.length - 1];
    if (!next) return;
    e.preventDefault();
    switchTab(next);
    next.focus();
  });
}

// ── Modal focus-trap + initial focus (Milestone 5) ──────────────────────────
// Escape-to-close and click-outside-to-close were already consistent across
// every `.modal-overlay` before this milestone (the global Escape handler
// below, and each modal's own `xOverlayClick(e)`); focus-trapping (Tab
// cycling within the modal) and initial focus were the real gaps, so this is
// applied generically via a per-element class-attribute observer rather than
// touching every individual open*/close* function.
function trapFocusIn(overlayEl) {
  const box = overlayEl.querySelector('.modal-box, #palette');
  if (!box) return;
  overlayEl._returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusable = () => [...box.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(el => el.offsetParent !== null);
  const keydown = (e) => {
    if (e.key !== 'Tab') return;
    const items = focusable();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  overlayEl.addEventListener('keydown', keydown);
  overlayEl._focusTrapKeydown = keydown;
  // Initial focus lands on the first focusable element, unless a modal's own
  // open*() already scheduled a more specific target (many do, via their own
  // shorter setTimeout(...).focus() calls) — this runs a little later so
  // those still win; if one already landed, this is a no-op.
  setTimeout(() => {
    if (!overlayEl.classList.contains('open')) return;
    if (overlayEl.contains(document.activeElement) && document.activeElement !== document.body) return;
    const items = focusable();
    if (items.length) items[0].focus();
  }, 90);
}
function releaseFocusTrap(overlayEl) {
  if (overlayEl._focusTrapKeydown) {
    overlayEl.removeEventListener('keydown', overlayEl._focusTrapKeydown);
    overlayEl._focusTrapKeydown = null;
  }
  if (overlayEl._returnFocus?.isConnected) overlayEl._returnFocus.focus();
  overlayEl._returnFocus = null;
}
function watchModalFocusTraps() {
  const obs = new MutationObserver(mutations => {
    mutations.forEach(m => {
      const el = m.target;
      if (!(el instanceof Element) || !el.classList.contains('modal-overlay')) return;
      if (el.classList.contains('open')) trapFocusIn(el); else releaseFocusTrap(el);
    });
  });
  document.querySelectorAll('.modal-overlay').forEach((el, index) => {
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    const heading = el.querySelector('h1,h2,h3,.modal-title');
    if (heading) {
      if (!heading.id) heading.id = `modal-title-${index + 1}`;
      el.setAttribute('aria-labelledby', heading.id);
    } else if (!el.hasAttribute('aria-label')) {
      el.setAttribute('aria-label', 'Dialog');
    }
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
}

let _connectedLabelSerial = 0;
function connectFormLabels(root = document) {
  root.querySelectorAll('label:not([for])').forEach(label => {
    const field = label.parentElement?.querySelector('input:not([type="hidden"]),select,textarea');
    if (!field) return;
    if (!field.id) field.id = `labelled-field-${++_connectedLabelSerial}`;
    label.htmlFor = field.id;
  });
}

// ── State ──
let savedDays  = new Set();
let dayCache   = {};
let activeDate = '';
let rows       = [];
let editIdx    = null;
let calYear, calMonth;

// ── Normalized lookup catalog ──
// Loaded once at boot from window.api.loadLookups(). `LK.categories` is keyed by
// the catalog category; each option is { id, code, label, sortOrder, isActive }.
// Display fields (company/system/natural) store their LABEL on the row; logic
// fields (time/status/currency/billingCycle) store their stable CODE — so the UI
// compares codes, never hardcoded display strings.
let LK = { categories: {}, defaultName: '' };
let lookupsDraft = {};          // working copy edited by the Settings catalog editor
// True while lookupsDraft holds edits not yet saved. While dirty,
// initSettingsModule() must NOT re-clone from LK — otherwise switching away
// from Settings and back (or a language change) silently wipes the draft.
let settingsDirty = false;

// UI dropdown key → catalog category, and which option field is the stored
// value ('label' = stored as display label; 'code' = stored as code). Derived
// from settings-registry.js (loaded before this file) so there is exactly one
// place that maps a UI key to its category — see that file's header comment.
const LK_CAT = Object.fromEntries(SETTINGS_CATALOG_TABS.map(t => [t.key, t.category]));
const LK_VALUE = Object.fromEntries(SETTINGS_CATALOG_TABS.map(t => [t.key, t.valueField]));

// Active options for a category, ordered for dropdowns.
function lkOptions(category, includeInactive = false) {
  return (LK.categories[category] || []).filter(o => includeInactive || o.isActive);
}
// Find the catalog option for a stored value (matches by code OR label).
function lkFind(category, value) {
  if (value == null || value === '') return null;
  return (LK.categories[category] || []).find(o =>
    o.code === value || o.label === value || o.nameEn === value || o.nameAr === value) || null;
}
function lookupDisplayName(option) {
  if (!option) return '';
  const arabic = window.ctI18n?.getLanguage?.() === 'ar';
  return (arabic ? option.nameAr : option.nameEn) || option.nameEn || option.label || option.nameAr || '';
}
// Stored value → human label (falls back to the raw value if unknown/legacy).
function lkLabel(category, value) {
  const o = lkFind(category, value);
  return o ? lookupDisplayName(o) : (value || '');
}
function companyProfileOption(value) {
  if (value == null || value === '') return null;
  return (LK.categories.COMPANY || []).find(o =>
    o.code === value || o.label === value || o.nameEn === value || o.nameAr === value) || null;
}
function companyDisplayName(company, includeCode = true) {
  const direct = typeof company === 'object' && company ? {
    ...company,
    code: company.code || company.companyCode,
    nameEn: company.nameEn || company.companyNameEn,
    nameAr: company.nameAr || company.companyNameAr,
    label: company.label || company.company,
  } : null;
  const o = direct || companyProfileOption(company);
  if (!o) return typeof company === 'string' ? company : '';
  const arabic = window.ctI18n?.getLanguage?.() === 'ar';
  const name = (arabic ? o.nameAr : o.nameEn) || o.nameEn || o.label || o.nameAr || '';
  return includeCode && o.code ? `${o.code} — ${name}` : name;
}
// Stored FK id (e.g. a task's departmentId) → human label, matched by the
// catalog's own numeric id — unlike lkFind/lkLabel above, which match a
// code or label, never a raw id.
function lkLabelById(category, id) {
  if (id == null) return '';
  const o = (LK.categories[category] || []).find(x => Number(x.id) === Number(id));
  return o ? (category === 'COMPANY' ? companyDisplayName(o, false) : lookupDisplayName(o)) : '';
}

// ── Timer state ──
// Track the timed row by object reference (rowRef), not by array index — the
// index drifts if a row above it is deleted/duplicated/moved while running.
let activeTimer = { rowRef: null, startMs: null, intervalId: null, accumMs: 0, paused: false };

// ── Undo state ──
let undoRecord   = null;  // { row, idx }
let _undoTimer   = null;

// ── Module state ──
// Starts null (not e.g. 'timesheet') so the very first switchModule() call
// during boot never hits its own "already on this module" early-return guard
// — otherwise landing on Timesheet by default (Milestone 11's "Start on:
// Last page") would silently skip syncing the sidebar highlight/window title,
// since the guard would see activeModule already (coincidentally) matching.
let activeModule = null;

// ── UI state (Milestone 11) — this-machine-only "where was I" state, loaded
// once at boot (loadUiStateFromMain) and debounce-saved (saveUiStateDebounced)
// whenever the active module or a tracked module's filters change. db.js
// stores this as an opaque JSON blob (machine_prefs key ui_state) — only the
// renderer interprets `filters`' per-module shape.
let uiState = { startOnLastPage: true, lastModule: 'analytics', filters: {}, sessionDefaults: {} };
async function loadUiStateFromMain() {
  try {
    const loaded = await window.api.getUiState();
    uiState = Object.assign({ startOnLastPage: true, lastModule: 'analytics', filters: {}, sessionDefaults: {} }, loaded || {});
  } catch { /* keep defaults */ }
  const loginLanguage = window.ctI18n?.getLoginLanguageChoice?.();
  if (!uiState.filters || typeof uiState.filters !== 'object') uiState.filters = {};
  if (!uiState.sessionDefaults || typeof uiState.sessionDefaults !== 'object') uiState.sessionDefaults = {};
  // Ignore/remove legacy per-user language state. The selected login-page
  // language already owns the document and cannot be changed after login.
  delete uiState.language;
  if (loginLanguage) saveUiStateDebounced();
}
let _uiStateSaveTimer = null;
function saveUiStateDebounced() {
  clearTimeout(_uiStateSaveTimer);
  _uiStateSaveTimer = setTimeout(() => { window.api.saveUiState(uiState).catch(() => {}); }, 300);
}

// Knowledge Hub editor recovery draft — its own row (see db.js), loaded once
// at boot alongside uiState. Deliberately NOT part of uiState: the editor
// snapshots on every keystroke (including the Quill HTML content), and that
// used to mean a large document rewrote the whole ui_state blob — filters,
// lastModule, everything — on every 300ms debounce tick.
let knowledgeDraftCache = null;
async function loadKnowledgeDraftFromMain() {
  try { knowledgeDraftCache = await window.api.getKnowledgeDraft(); } catch { knowledgeDraftCache = null; }
}
let _knowledgeDraftSaveTimer = null;
function saveKnowledgeDraftDebounced() {
  clearTimeout(_knowledgeDraftSaveTimer);
  _knowledgeDraftSaveTimer = setTimeout(() => { window.api.saveKnowledgeDraft(knowledgeDraftCache).catch(() => {}); }, 300);
}

// ── Per-account UI preferences ────────────────────────────────────────────────
// theme/density/canvas/motion/sidebar/timesheet view used to live only in
// localStorage, which is machine-wide: a second account on the same Windows
// login inherited whatever the first account last chose. Pre-login (theme
// only, to avoid a flash of the wrong theme — see renderer/bootstrap.js) and
// as an offline fallback, localStorage stays a mirror; once a user is known,
// their own DB-stored preferences are authoritative and override that guess.
async function loadUserPreferencesFromMain() {
  try {
    const prefs = await window.api.getPreferences();
    applyLoadedTheme(prefs.theme);
    workspaceViewPrefs.density = prefs.density;
    workspaceViewPrefs.canvas = prefs.canvas;
    workspaceViewPrefs.motion = prefs.motion;
    applyWorkspaceViewPreferences();
    applySidebarPreference(prefs.sidebar === 'compact');
    tsView = prefs.timesheetView === 'flat' ? 'flat' : 'grouped';
  } catch { /* keep the localStorage-derived pre-login guess */ }
}
function saveUserPreference(key, value) {
  window.api.setPreference(key, value).catch(() => {});
}

function rememberSessionDefaults(time, natural) {
  uiState.sessionDefaults = { time: time || '', natural: natural || '' };
  saveUiStateDebounced();
}
function setDurationPreset(inputId, minutes, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.value = String(minutes);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  syncDurationPresets(inputId, btn);
  input.focus();
}
function syncDurationPresets(inputId, selectedBtn = null) {
  const value = Number(document.getElementById(inputId)?.value || 0);
  document.querySelectorAll(`.duration-presets[data-duration-for="${inputId}"] .duration-preset`).forEach(btn => {
    const pressed = btn === selectedBtn || Number(btn.textContent.replace(/[^0-9.]/g, '')) * (btn.textContent.includes('h') ? 60 : 1) === value;
    btn.classList.toggle('active', pressed);
    btn.setAttribute('aria-pressed', String(pressed));
  });
}
document.addEventListener('input', e => {
  if (e.target?.id === 'f-minutes' || e.target?.id === 'sm-minutes') syncDurationPresets(e.target.id);
});

// ── Module search filters ──
let subFilter = '';

// ── Subscriptions state ──
let subscriptions = [];
let subPrefs      = { defaultCurrency: 'USD' };
let subEditId     = null;
let subsLoaded    = false;
let _subSaveTimer = null;
let undoSubscription = null; // { sub, idx }
let _undoSubTimer    = null;

// ── Project task modal state (add/edit a project's zero-log or logged task) ──
let backlogEditId    = null;

// ── Projects state ──
let projectsList     = [];       // [{id, name, companies[], systems[], status, taskCount, …}]
let projectsLoaded   = false;
let currentProject   = null;     // full project loaded in the detail view
let projectEditId    = null;     // modal mode: null = create, else project id
let undoProject      = null;     // snapshot of a just-deleted project (for undo)
let _undoProjectTimer = null;
let linkableTasks    = [];   // picker source: unlinked Task[]
let pCompaniesPicker = null;     // tag-picker handles for the project modal
let pSystemsPicker   = null;
let projectIndex     = [];       // lightweight [{id,name,status}] for the Timesheet/Project task Project field
let fProjectPicker   = null;     // search-select handle in the timesheet record modal
let bProjectPicker   = null;     // search-select handle in the project task modal
let modalTaskList    = [];       // full Task[] backing the Add Record "existing task" picker

// ── Analytics state ──
let analyticsLoaded = false;
let anPeriod        = 'month';   // week | month | year | custom

// ── Helpers ──
// Format a Date as a local YYYY-MM-DD string. Uses local calendar components
// (NOT toISOString, which is UTC and can roll "today" back a day in +tz zones).
function fmt(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function totalMins(rowArr) {
  return rowArr.reduce((s, r) => s + (parseFloat(r.minutes) || 0), 0);
}
let _toastTimer = null;
let _toastExpire = null;
// `opts.actionLabel`/`opts.onAction` add a click action button (e.g. "Open
// folder") alongside the message; `opts.duration` overrides the auto-dismiss.
function toast(msg, opts) {
  const el = document.getElementById('app-toast');
  if (!el) return;
  clearTimeout(_toastTimer);
  if (_toastExpire) { const expire = _toastExpire; _toastExpire = null; expire(); }
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);
  if (opts && opts.actionLabel && opts.onAction) {
    const btn = document.createElement('button');
    btn.className = 'toast-action-btn';
    btn.textContent = opts.actionLabel;
    btn.addEventListener('click', async () => {
      clearTimeout(_toastTimer);
      _toastExpire = null;
      await opts.onAction();
    });
    el.appendChild(btn);
  }
  el.classList.add('show');
  _toastExpire = opts?.onExpire || null;
  _toastTimer = setTimeout(() => {
    el.classList.remove('show');
    if (_toastExpire) { const expire = _toastExpire; _toastExpire = null; expire(); }
  }, (opts && opts.duration) || 2600);
}

// ── Crash safety net ──
// A programming error that reaches here would otherwise fail completely
// silently — no console the user can see, no indication their last action
// didn't save. Surface a toast; still log to console for diagnosis.
window.addEventListener('error', (event) => {
  console.error('[unhandled error]', event.error || event.message);
  toast('Something went wrong — your last action may not have saved.');
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandled rejection]', event.reason);
  toast('Something went wrong — your last action may not have saved.');
});

// ── Loading skeletons ──
// Fill `host` with shimmer placeholders while its async data loads; the next
// real render replaces them. `kind`: 'cards' (grid tiles) or 'text' (lines).
function showSkeleton(host, kind = 'text', count = 3) {
  const el = typeof host === 'string' ? document.getElementById(host) : host;
  if (!el) return;
  el.innerHTML = (kind === 'cards'
    ? '<div class="skeleton-card"></div>'.repeat(count)
    : '<div class="skeleton-text"></div>'.repeat(count));
}
// Skeleton rows for a <tbody> while its table data loads.
function showTableSkeleton(tbody, colSpan, rows = 3) {
  const el = typeof tbody === 'string' ? document.getElementById(tbody) : tbody;
  if (!el) return;
  el.innerHTML = `<tr><td colspan="${colSpan}" style="padding:10px 18px"><div class="skeleton-text"></div></td></tr>`.repeat(rows);
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function isURL(s) {
  return /^https?:\/\//i.test(s || '');
}

// ── Task Sources (structured, repeatable source list — shared by the Add
// Record modal and the New/Edit Task modal) ──────────────────────────────────
// Data-driven: adding a 5th type later means adding one entry here, not
// touching either modal's markup/JS. `ref` is shown unless hasRef is false
// (Jira is URL-only — the URL is a link's actual identifying value, no
// separate ticket-key field); `url` only when hasUrl; `meta` are optional
// per-type extras stored as JSON.
const TASK_SOURCE_FIELD_DEFS = {
  JIRA:       { hasRef: false, hasUrl: true, urlLabel: 'URL', meta: [] },
  EMAIL:      { refLabel: 'Email Title / Subject', refPlaceholder: 'e.g. Renewal quote issue', hasUrl: false, meta: [] },
  MEETING:    { refLabel: 'Meeting Title',         refPlaceholder: 'e.g. Sprint planning',     hasUrl: false, meta: [
                 { key: 'date', label: 'Date', type: 'date' },
               ] },
  PHONE_CALL: { refLabel: 'Caller Name',           refPlaceholder: 'e.g. John Smith',          hasUrl: false, meta: [
                 { key: 'date', label: 'Date', type: 'date' },
               ] },
};

// Renders one source-entry's dynamic fields (ref/url/meta) into `fieldsEl`
// based on the selected type code. `values` prefills from an existing entry,
// or (on a type switch) carries over whatever the ref field already held.
function renderTaskSourceFields(fieldsEl, type, values = {}) {
  const def = TASK_SOURCE_FIELD_DEFS[type];
  fieldsEl.innerHTML = '';
  if (!def) return;

  if (def.hasRef !== false) {
    const refWrap = document.createElement('div');
    refWrap.innerHTML = `<label>${esc(def.refLabel)}</label>`;
    const refInput = document.createElement('input');
    refInput.type = 'text'; refInput.className = 'ts-ref-input';
    refInput.placeholder = def.refPlaceholder || '';
    refInput.value = values.ref || '';
    refWrap.appendChild(refInput);
    fieldsEl.appendChild(refWrap);
  }

  if (def.hasUrl) {
    const urlWrap = document.createElement('div');
    urlWrap.innerHTML = `<label>${esc(def.urlLabel || 'URL')}</label>`;
    const urlInput = document.createElement('input');
    urlInput.type = 'text'; urlInput.className = 'ts-url-input';
    urlInput.placeholder = 'https://...';
    urlInput.value = values.url || '';
    urlWrap.appendChild(urlInput);
    fieldsEl.appendChild(urlWrap);
  }

  (def.meta || []).forEach(m => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label>${esc(m.label)}</label>`;
    const inp = document.createElement('input');
    inp.type = m.type || 'text';
    inp.className = 'ts-meta-input';
    inp.dataset.metaKey = m.key;
    inp.value = (values.meta && values.meta[m.key]) || '';
    wrap.appendChild(inp);
    fieldsEl.appendChild(wrap);
  });
}

// Appends one source-entry row to the list container `listId` (in either
// modal), optionally prefilled from an existing TaskSource (edit mode) —
// `data-existing-id` carries the row's real id so readTaskSourceRows()/
// saveTaskSources() can tell an edit from a brand-new entry apart.
function addTaskSourceRow(listId, source) {
  const list = document.getElementById(listId);
  const row = pjMk('div', 'ts-row');
  if (source && source.id != null) row.dataset.existingId = source.id;

  const head = pjMk('div', 'ts-row-head');
  const typeSelect = document.createElement('select');
  typeSelect.className = 'ts-type-select';
  const blankOpt = document.createElement('option');
  blankOpt.value = ''; blankOpt.textContent = 'Select type…';
  typeSelect.appendChild(blankOpt);
  lkOptions('TASK_SOURCE_TYPE').forEach(o => {
    const opt = document.createElement('option');
    opt.dataset.userContent = ''; opt.value = o.code; opt.textContent = lookupDisplayName(o);
    if (o.code === (source && source.type)) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  head.appendChild(typeSelect);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button'; removeBtn.className = 'row-btn';
  removeBtn.innerHTML = ic('trash-2'); removeBtn.title = 'Remove source';
  removeBtn.addEventListener('click', () => row.remove());
  head.appendChild(removeBtn);
  row.appendChild(head);

  const fieldsEl = pjMk('div', 'ts-row-fields');
  row.appendChild(fieldsEl);
  renderTaskSourceFields(fieldsEl, (source && source.type) || '', source ? { ref: source.ref, url: source.url, meta: source.meta } : {});

  typeSelect.addEventListener('change', () => {
    const carry = { ref: fieldsEl.querySelector('.ts-ref-input')?.value || '' };
    renderTaskSourceFields(fieldsEl, typeSelect.value, carry);
  });

  list.appendChild(row);
  return row;
}

// Reads every row currently in `listId` into a plain array of
// {id, type, ref, url, meta} (id null for a brand-new row). Rows with no type
// and no ref/url text are skipped (an untouched blank row isn't saved).
function readTaskSourceRows(listId) {
  return [...document.querySelectorAll('#' + listId + ' .ts-row')].map(row => {
    const type = row.querySelector('.ts-type-select')?.value || '';
    const ref = row.querySelector('.ts-ref-input')?.value.trim() || '';
    const url = row.querySelector('.ts-url-input')?.value.trim() || '';
    const meta = {};
    row.querySelectorAll('.ts-meta-input').forEach(inp => {
      const v = inp.value.trim();
      if (v) meta[inp.dataset.metaKey] = v;
    });
    const existingId = row.dataset.existingId ? Number(row.dataset.existingId) : null;
    return { id: existingId, type, ref, url, meta };
  }).filter(s => s.type || s.ref || s.url);
}

// Persists `rows` (from readTaskSourceRows) against `taskId`: creates rows with
// no id, updates rows with an id, deletes any id in `originalIds` no longer
// present in `rows`. Shared by the Add Record and New/Edit Task modals so a
// task's source list reconciles the same way in either place.
async function saveTaskSources(taskId, rows, originalIds = []) {
  const keptIds = new Set(rows.filter(r => r.id != null).map(r => r.id));
  const toDelete = originalIds.filter(id => !keptIds.has(id));
  await Promise.all([
    ...rows.map(r => r.id != null
      ? window.api.updateTaskSource(r.id, { type: r.type, ref: r.ref, url: r.url, meta: r.meta })
      : window.api.createTaskSource(taskId, { type: r.type, ref: r.ref, url: r.url, meta: r.meta })),
    ...toDelete.map(id => window.api.deleteTaskSource(id)),
  ]);
}

// A compact read-only summary badge for a source entry — "JIRA · ABC-123",
// clickable via openExternal when a url is present. Used by Task Detail (one
// per entry) and, in single-badge form, by dense list views.
function taskSourceBadge(s) {
  const typeLabel = lkLabel('TASK_SOURCE_TYPE', s.type) || s.type || 'Source';
  const text = s.ref ? (typeLabel + ' · ' + s.ref) : typeLabel;
  if (s.url && isURL(s.url)) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'ts-badge source-link';
    btn.textContent = text; btn.title = 'Open ' + s.url;
    btn.addEventListener('click', () => window.api.openExternal(s.url));
    return btn;
  }
  const span = document.createElement('span');
  span.className = 'ts-badge'; span.textContent = text;
  return span;
}

// Builds the "Source" table cell shared by Timesheet's flat/grouped views and
// Browse's row renderer: a compact summary from the row's structured-source
// fields (type · ref, "+N more" when there's more than one), clickable via
// openExternal when the first entry has a url — falling back to the legacy
// plain-text `source` for a row whose task hasn't been touched since before
// migration 033 (sourceCount 0, non-empty legacy text).
function buildSourceCell(row) {
  const srcTd = document.createElement('td');
  const srcDiv = document.createElement('div'); srcDiv.className = 'cell';
  const count = row.sourceCount || 0;
  if (count > 0) {
    const typeLabel = lkLabel('TASK_SOURCE_TYPE', row.firstSourceType) || row.firstSourceType || 'Source';
    const text = (row.firstSourceRef ? (typeLabel + ' · ' + row.firstSourceRef) : typeLabel)
      + (count > 1 ? ' +' + (count - 1) + ' more' : '');
    let node;
    if (row.firstSourceUrl && isURL(row.firstSourceUrl)) {
      node = document.createElement('button');
      node.className = 'source-link'; node.title = 'Open ' + row.firstSourceUrl;
      node.addEventListener('click', () => window.api.openExternal(row.firstSourceUrl));
    } else {
      node = document.createElement('span'); node.className = 'source-text';
    }
    node.textContent = text;
    srcDiv.appendChild(node);
  } else if (isURL(row.source)) {
    const link = document.createElement('button');
    link.className = 'source-link'; link.textContent = row.source; link.title = 'Open ' + row.source;
    link.addEventListener('click', () => window.api.openExternal(row.source));
    srcDiv.appendChild(link);
  } else {
    const s = document.createElement('span'); s.className = 'source-text'; s.textContent = row.source || '';
    srcDiv.appendChild(s);
  }
  srcTd.appendChild(srcDiv);
  return srcTd;
}

// True if `values` together satisfy the (already-lowercased) query `q`. Empty q matches all.
// `q` is split on whitespace into words; every word must appear as a substring somewhere
// across `values` (words can match different fields — e.g. "amana visa" matches a company
// field containing "amana" and a type field containing "visa").
function textMatch(values, q) {
  if (!q) return true;
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = values.map(v => String(v ?? '').toLowerCase()).join(' ');
  return words.every(w => hay.includes(w));
}

// ── Lookup helpers ──
// Fill a <select> from the normalized lookup catalog, ordered by sort_order. The
// option *value* is the stored form (label for display categories, code for logic
// categories); the visible text is always the label.
function populateSelect(id, key, currentVal) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  const category = LK_CAT[key];
  const valField = LK_VALUE[key] || 'label';
  const opts = lkOptions(category);
  const values = opts.map(o => o[valField]);
  // API task shapes retain the English COMPANY label for compatibility, while
  // new form writes use the business code. Normalize either shape to the option
  // value so an unchanged edit never appears as a removed catalog entry.
  const currentOption = lkFind(category, currentVal);
  const selectedValue = currentOption ? currentOption[valField] : currentVal;
  // Preserve a value no longer in the catalog (e.g. soft-disabled), so editing a
  // row doesn't silently rewrite it to the first option when saved.
  if (selectedValue && !values.includes(selectedValue)) {
    const o = document.createElement('option');
    o.value = selectedValue; o.textContent = lkLabel(category, currentVal) + ' (removed)';
    o.selected = true;
    el.appendChild(o);
  }
  opts.forEach(opt => {
    const o = document.createElement('option');
    o.dataset.userContent = ''; o.value = opt[valField];
    o.textContent = category === 'COMPANY' ? companyDisplayName(opt) : lookupDisplayName(opt);
    if (opt[valField] === selectedValue) o.selected = true;
    el.appendChild(o);
  });
}

// ── Tag-picker (reusable searchable multi-select) ──
// Builds a tag-picker into `host` (a container element). `options` is a list of
// { id, label }; `initialIds` the preselected ids. The user types to filter, then
// clicks / Enters an option to add it as a removable pill; already-selected options
// are excluded from results. The underlying value is always an array of ids,
// returned by the handle's getSelectedIds(). Used for the Projects modal's
// Companies and Systems fields (one shared component — never two copies).
// Special case: with exactly one option, it auto-selects it and shows a static
// pill (no search UI), since that is the only possible value.
function buildTagPicker(host, options, initialIds, placeholder) {
  host.innerHTML = '';
  host.className = 'tag-picker';
  const optById = new Map((options || []).map(o => [Number(o.id), o.label]));
  const selectedIds = [];
  (Array.isArray(initialIds) ? initialIds : (initialIds == null ? [] : [initialIds]))
    .forEach(id => { const n = Number(id); if (optById.has(n) && !selectedIds.includes(n)) selectedIds.push(n); });

  const handle = { getSelectedIds: () => selectedIds.slice() };

  // Single-option shortcut: auto-select and skip the interactive UI.
  if ((options || []).length === 1) {
    if (!selectedIds.length) selectedIds.push(Number(options[0].id));
    const pills = document.createElement('div'); pills.className = 'tp-pills';
    const pill = document.createElement('span'); pill.className = 'tp-pill tp-pill-static';
    pill.dataset.userContent = ''; pill.textContent = optById.get(selectedIds[0]) ?? options[0].label;
    pills.appendChild(pill);
    host.appendChild(pills);
    return handle;
  }

  const pills = document.createElement('div'); pills.className = 'tp-pills';
  const inputWrap = document.createElement('div'); inputWrap.className = 'tp-input-wrap';
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'tp-input'; input.placeholder = placeholder || 'Search…';
  const menu = document.createElement('div'); menu.className = 'tp-menu'; menu.style.display = 'none';
  inputWrap.appendChild(input); inputWrap.appendChild(menu);
  host.appendChild(pills); host.appendChild(inputWrap);

  let filtered = [], activeIdx = 0;

  const renderPills = () => {
    pills.innerHTML = '';
    selectedIds.forEach(id => {
      const pill = document.createElement('span'); pill.className = 'tp-pill';
      pill.appendChild(document.createTextNode(optById.get(id) ?? ('#' + id)));
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'tp-pill-x'; x.innerHTML = '&times;'; x.title = 'Remove';
      x.addEventListener('click', () => {
        const i = selectedIds.indexOf(id); if (i >= 0) selectedIds.splice(i, 1);
        renderPills(); renderMenu();
      });
      pill.appendChild(x);
      pills.appendChild(pill);
    });
    pills.style.display = selectedIds.length ? '' : 'none';
  };

  const renderMenu = () => {
    const q = input.value.toLowerCase().trim();
    filtered = (options || []).filter(o =>
      !selectedIds.includes(Number(o.id)) && (!q || o.label.toLowerCase().includes(q)));
    menu.innerHTML = '';
    if (!filtered.length) { menu.style.display = 'none'; return; }
    if (activeIdx < 0 || activeIdx >= filtered.length) activeIdx = 0;
    filtered.forEach((o, i) => {
      const item = document.createElement('div');
      item.className = 'tp-opt' + (i === activeIdx ? ' active' : '');
      item.dataset.userContent = ''; item.textContent = o.label;
      item.addEventListener('mousedown', (e) => { e.preventDefault(); pick(Number(o.id)); });
      menu.appendChild(item);
    });
    menu.style.display = '';
  };

  const pick = (id) => {
    if (!selectedIds.includes(id)) selectedIds.push(id);
    input.value = ''; activeIdx = 0;
    renderPills(); renderMenu(); input.focus();
  };

  input.addEventListener('focus', () => { activeIdx = 0; renderMenu(); });
  input.addEventListener('input', () => { activeIdx = 0; renderMenu(); });
  input.addEventListener('blur', () => { setTimeout(() => { menu.style.display = 'none'; }, 120); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (filtered.length) { activeIdx = (activeIdx + 1) % filtered.length; renderMenu(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (filtered.length) { activeIdx = (activeIdx - 1 + filtered.length) % filtered.length; renderMenu(); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[activeIdx]) pick(Number(filtered[activeIdx].id)); }
    else if (e.key === 'Backspace' && input.value === '' && selectedIds.length) { selectedIds.pop(); renderPills(); renderMenu(); }
  });

  renderPills(); renderMenu();
  return handle;
}

// ── Searchable single-select (reusable combobox) ──
// Builds a searchable single-value dropdown into `host`. `options` is a list of
// { id, label }; `initialId` the preselected id (or null). Typing filters; clicking
// or Entering an option selects it (showing its label in the field); a built-in
// "— None —" entry clears it. The handle's getSelectedId() returns the id or null.
// Used by the timesheet record and project task modals' Project field (single project per task).
//
// `rich` (optional 6th param) lets a caller layer richer behavior on top without
// forking the keyboard/menu mechanics (used by buildTaskSearchSelect below):
//   - matchFn(o, q)      custom filter predicate (default: label substring match)
//   - renderOption(o)    returns innerHTML for an option row (default: textContent = o.label)
//   - labelText(o)       returns the text shown in the closed input (default: o.label)
//   - getOptions()       returns the *live* option list each render (default: the options param;
//                        lets a caller swap the set live, e.g. a "show completed" toggle)
//   - groupFn(o)         returns a group-header string; a run of items sharing the same
//                        group gets one header inserted before it (only applied while the
//                        query is empty — a typed search always renders a flat list)
//   - extraControls()    returns a DOM node prepended to the menu on every render (e.g. a toggle
//                        button); never affects filtered/keyboard navigation
function buildSearchSelect(host, options, initialId, placeholder, onChange, rich) {
  rich = rich || {};
  host.innerHTML = '';
  host.className = 'search-select';
  const baseOptions = options || [];
  let selectedId = (initialId != null) ? Number(initialId) : null;

  const input = document.createElement('input');
  input.type = 'text'; input.className = 'ss-input'; input.placeholder = placeholder || 'Search…';
  input.readOnly = true;
  const menu = document.createElement('div'); menu.className = 'ss-menu'; menu.style.display = 'none';
  host.appendChild(input); host.appendChild(menu);

  let filtered = [], activeIdx = 0, open = false;

  const currentOptions = () => (rich.getOptions ? rich.getOptions() : baseOptions);
  const findOpt = (id) => currentOptions().find(o => Number(o.id) === Number(id))
    || baseOptions.find(o => Number(o.id) === Number(id));

  const showLabel = () => {
    if (selectedId == null) { input.value = ''; return; }
    const o = findOpt(selectedId);
    input.value = o ? (rich.labelText ? rich.labelText(o) : (o.label ?? '')) : '';
  };

  const renderMenu = () => {
    const q = input.readOnly ? '' : input.value.toLowerCase().trim();
    const match = rich.matchFn || ((o, qq) => (o.label || '').toLowerCase().includes(qq));
    const base = [{ id: null, label: '— None —' }, ...currentOptions()];
    filtered = base.filter(o => o.id == null || !q || match(o, q));
    menu.innerHTML = '';
    if (rich.extraControls) menu.appendChild(rich.extraControls());
    if (!filtered.length) { if (!menu.children.length) menu.style.display = 'none'; else menu.style.display = ''; return; }
    if (activeIdx < 0 || activeIdx >= filtered.length) activeIdx = 0;
    let lastGroup;
    filtered.forEach((o, i) => {
      if (rich.groupFn && !q && o.id != null) {
        const g = rich.groupFn(o);
        if (g !== lastGroup) {
          menu.appendChild(pjMk('div', 'ss-group-label', g));
          lastGroup = g;
        }
      }
      const item = document.createElement('div');
      item.className = 'ss-opt' + (rich.renderOption ? ' ss-opt-rich' : '') + (i === activeIdx ? ' active' : '') +
        ((o.id == null && selectedId == null) || Number(o.id) === selectedId ? ' selected' : '');
      if (rich.renderOption && o.id != null) item.innerHTML = rich.renderOption(o);
      else { item.dataset.userContent = ''; item.textContent = o.label; }
      item.addEventListener('mousedown', (e) => { e.preventDefault(); pick(o.id == null ? null : Number(o.id)); });
      menu.appendChild(item);
    });
    menu.style.display = '';
  };

  const openMenu = () => { open = true; input.readOnly = false; input.value = ''; activeIdx = 0; renderMenu(); };
  const closeMenu = () => { open = false; input.readOnly = true; menu.style.display = 'none'; showLabel(); };
  const pick = (id) => { const changed = id !== selectedId; selectedId = id; closeMenu(); if (changed && typeof onChange === 'function') onChange(selectedId); };

  input.addEventListener('focus', openMenu);
  input.addEventListener('click', () => { if (!open) openMenu(); });
  input.addEventListener('input', () => { activeIdx = 0; renderMenu(); });
  input.addEventListener('blur', () => { setTimeout(closeMenu, 120); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (filtered.length) { activeIdx = (activeIdx + 1) % filtered.length; renderMenu(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (filtered.length) { activeIdx = (activeIdx - 1 + filtered.length) % filtered.length; renderMenu(); } }
    else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[activeIdx]; if (o) pick(o.id == null ? null : Number(o.id)); }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); closeMenu(); }
  });

  showLabel();
  return { getSelectedId: () => selectedId, refresh: renderMenu };
}

// ── Task-aware search select — a buildSearchSelect wrapper for pickers over the
// full task list (Add Record's existing-task field, the Session edit modal's task
// reassignment field, the command palette's task results). Two-line options (name +
// status badge, then muted "Company · System · Project · last worked · sessions ·
// total time" meta), most-recently-worked first, a "Recent" group (worked in the
// last 14 days) shown above the rest while the query is empty, DONE tasks hidden
// behind a "Show completed" toggle (compares ENTRY_STATUS by code, never label),
// and search via the shared textMatch() helper over name/company/system/source.
const TASK_PICKER_RECENT_DAYS = 14;
function buildTaskSearchSelect(host, tasks, initialId, placeholder, onChange) {
  const list = Array.isArray(tasks) ? tasks : [];
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - TASK_PICKER_RECENT_DAYS);
  const cutoffStr = fmt(cutoff);
  const isRecent = (t) => !!t.lastDate && t.lastDate >= cutoffStr;
  const sorted = [...list].sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));

  let showCompleted = false;
  const visibleOptions = () => sorted
    .filter(t => showCompleted || t.status !== 'DONE')
    .map(t => ({ id: t.id, label: t.name || '(untitled task)', task: t }));

  const api = buildSearchSelect(host, visibleOptions(), initialId, placeholder || 'Search tasks…', onChange, {
    getOptions: visibleOptions,
    matchFn: (o, q) => textMatch([o.task.name, o.task.company, o.task.companyCode,
      o.task.companyNameEn, o.task.companyNameAr, o.task.system, o.task.source, o.task.firstSourceRef], q),
    labelText: (o) => o.label,
    groupFn: (o) => (isRecent(o.task) ? 'Recent' : 'All tasks'),
    renderOption: (o) => {
      const t = o.task;
      const meta = [companyDisplayName(t), lkLabel('SYSTEM', t.system),
        t.projectId != null ? projectNameById(t.projectId) : (t.departmentId != null ? lkLabelById('DEPARTMENT', t.departmentId) : null),
        t.lastDate ? (window.ctI18n?.t?.('worked {date}', { date: t.lastDate }) || ('worked ' + t.lastDate)) : null,
        t.logCount ? (window.ctI18n?.t?.(t.logCount === 1 ? '{n} session' : '{n} sessions', { n: t.logCount })
          || (t.logCount + ' session' + (t.logCount === 1 ? '' : 's'))) : null,
        t.totalMinutes ? (Math.round(t.totalMinutes / 60 * 10) / 10 + 'h') : null]
        .filter(Boolean).join(' · ');
      return '<div class="ss-opt-title-row"><span>' + esc(t.name || '(untitled task)') + '</span>' +
        '<span class="status-badge ' + esc(statusClass(t.status)) + '">' + esc(lkLabel('ENTRY_STATUS', t.status) || '—') + '</span></div>' +
        (meta ? '<div class="ss-opt-meta">' + esc(meta) + '</div>' : '');
    },
    extraControls: () => {
      const wrap = pjMk('div', 'ss-toggle-row');
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'ss-toggle-btn';
      btn.textContent = showCompleted ? 'Hide completed' : 'Show completed';
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        showCompleted = !showCompleted;
        api.refresh();
      });
      wrap.appendChild(btn);
      return wrap;
    },
  });
  return api;
}

// ── Settings (lookup catalog editor) ──
// The tabs edit a working copy of the catalog (lookupsDraft, keyed by category).
// Existing entries are relabeled / reordered / soft-disabled in place; new entries
// get a server-generated stable code on save. Codes are never edited or deleted.
const SETTINGS_TABS = SETTINGS_CATALOG_TABS.map(t => t.key);

// Settings is a nav page (not a modal): switchModule('settings') calls this to
// (re)load a working copy of the catalog and render the editors fresh each visit.
// While an edit is uncommitted (settingsDirty), the draft is NOT re-cloned —
// otherwise navigating away and back, or a language change, silently discards
// unsaved catalog edits (see markSettingsDirty / discardSettingsChanges).
async function initSettingsModule() {
  if (!settingsDirty) lookupsDraft = JSON.parse(JSON.stringify(LK.categories || {}));
  // Restore the last-used Settings tab for this account (S10 in
  // uiState is already per-account (see
  // loadUiStateFromMain), so this just needed a place to remember which tab.
  // Only applies when it actually differs from what's currently active, so
  // it never fights an explicit deep link (palette/search jump) that calls
  // its own switchTab() right after this function returns. Skips a tab
  // that's hidden for this account (e.g. a saved catalog tab for a standard
  // user, or a tab a permission/language change has since removed).
  const savedTab = uiState.filters.settings?.tab;
  const currentTab = document.querySelector('#module-settings .stab.active')?.dataset.tab;
  if (savedTab && savedTab !== currentTab) {
    const savedBtn = document.querySelector('#module-settings .stab[data-tab="' + savedTab + '"]');
    if (savedBtn && !savedBtn.hidden) switchTab(savedBtn);
  }
  if (_currentUser?.isAdmin) SETTINGS_TABS.forEach(renderLookupPanel);
  document.querySelectorAll('#setting-startonlastpage-ctl .seg-btn').forEach(b =>
    b.classList.toggle('active', (b.dataset.val === 'last') === !!uiState.startOnLastPage));
  const orgNameInput = document.getElementById('s-org-name');
  if (document.activeElement !== orgNameInput) orgNameInput.value = LK.orgName || '';
  const activeTab = document.querySelector('#module-settings .stab.active')?.dataset.tab || 'general';
  syncSettingsSaveButton(activeTab);
  if (activeTab === 'users') renderUserManagement();
  try {
    const status = await window.api.getCredentialEncryptionStatus();
    document.getElementById('credential-encryption-banner').style.display = status.available ? 'none' : '';
  } catch { /* non-critical — banner just stays hidden */ }
}

// Milestone 11 — persists immediately (like Maintenance's own actions), no
// relation to the Lookups tabs' "Save Changes" button.
function setStartOnLastPage(startOnLast) {
  uiState.startOnLastPage = startOnLast;
  document.querySelectorAll('#setting-startonlastpage-ctl .seg-btn').forEach(b =>
    b.classList.toggle('active', (b.dataset.val === 'last') === startOnLast));
  saveUiStateDebounced();
}

// Electron's IPC layer wraps a thrown main-process error message in a
// generic "Error invoking remote method '...': Error: <message>" envelope —
// strip that so the user sees db.js's actual reason (e.g. a company code
// collision) instead of a useless boilerplate string.
function unwrapIpcErrorMessage(err) {
  const raw = String(err?.message || err || '');
  const m = raw.match(/Error invoking remote method '[^']*':\s*(?:Error:\s*)?([\s\S]+)/);
  return (m ? m[1] : raw).trim();
}

const SKIP_REASON_LABEL = {
  'blank-label': 'missing an English label',
  'duplicate-label': 'duplicates another entry’s label',
  'no-access': 'could not be saved (not accessible)',
};

async function saveSettings() {
  const statusEl = document.getElementById('settings-save-status');
  const saveBtn = document.getElementById('settings-save-btn');
  if (statusEl) statusEl.textContent = 'Saving…';
  if (saveBtn) saveBtn.disabled = true;
  // Build the catalog payload (sort_order = position). Only a genuinely blank,
  // never-saved new row is dropped here — anything else (including a row
  // missing only its English label) is sent through so the server can report
  // it as skipped, rather than silently vanishing before the user finds out.
  const categories = {};
  for (const uiKey of SETTINGS_TABS) {
    const cat = LK_CAT[uiKey];
    categories[cat] = (lookupsDraft[cat] || [])
      .map((o, i) => ({
        id: o.id ?? null, code: o.code,
        label: String(o.label || o.nameEn || '').trim(),
        nameEn: String(o.nameEn || o.label || '').trim(),
        nameAr: String(o.nameAr || '').trim(),
        sortOrder: i, isActive: o.isActive !== false,
      }))
      .filter(o => o.label || o.nameAr || o.id != null);
  }
  const payload = {};
  if (_currentUser?.isAdmin) payload.categories = categories;
  let result;
  try {
    result = await window.api.saveLookups(payload);
  } catch (err) {
    const message = unwrapIpcErrorMessage(err) || 'Could not save settings';
    if (statusEl) statusEl.textContent = 'Not saved';
    if (saveBtn) saveBtn.disabled = false;
    toast(message); return;
  }
  const skipped = result?.skipped || [];
  try {
    LK = await window.api.loadLookups();   // refresh — new entries now have stable codes
  } catch {
    // The write already committed. Do not falsely tell the user it failed just
    // because the follow-up renderer refresh could not be loaded.
    if (statusEl) statusEl.textContent = 'Saved — reopen the app to refresh';
    if (saveBtn) saveBtn.disabled = false;
    toast('Settings saved; reopen the app to refresh catalogs'); return;
  }
  // The Clients roster is the active COMPANY catalog. Its renderer keeps a
  // lightweight cache, so catalog changes must invalidate that cache or a
  // newly added company will not appear as a client until the app restarts.
  invalidateClientsCatalog();
  settingsDirty = false;
  initSettingsModule();                     // re-sync the draft with server-assigned codes
  renderTable();                            // reflect any relabeled values immediately
  renderFilterChips();
  if (skipped.length) {
    const detail = skipped.map(s => `${s.label} (${SKIP_REASON_LABEL[s.reason] || s.reason})`).join('; ');
    if (statusEl) statusEl.textContent = `Saved — ${skipped.length} not saved`;
    toast(`Settings saved — ${skipped.length} entr${skipped.length === 1 ? 'y was' : 'ies were'} not saved: ${detail}`);
  } else {
    if (statusEl) statusEl.textContent = 'Saved';
    toast('Settings saved');
  }
  if (saveBtn) saveBtn.disabled = false;
}

let managedUsers = [];
let managedUserId = null; // null means create mode

async function renderUserManagement() {
  const host = document.getElementById('user-list');
  if (!host) return;
  host.innerHTML = '<div class="maint-empty">Loading users…</div>';
  try { managedUsers = await window.api.authListUsers(); }
  catch { managedUsers = []; host.innerHTML = '<div class="maint-empty">Could not load users.</div>'; return; }
  host.innerHTML = '';
  managedUsers.forEach(user => {
    const card = pjMk('div', 'user-card' + (user.isActive ? '' : ' inactive'));
    const displayName = (window.ctI18n?.getLanguage?.() === 'ar' ? (user.nameAr || user.nameEn) : user.nameEn) || user.username;
    card.appendChild(pjMk('div', 'user-card-avatar', Array.from(displayName || '?')[0]?.toUpperCase() || '?'));
    const main = pjMk('div', 'user-card-main');
    const name = pjMk('div', 'user-card-name', displayName + (user.isCurrent ? ' (you)' : ''));
    name.title = user.username;
    main.appendChild(name);
    const meta = pjMk('div', 'user-card-meta');
    meta.appendChild(pjMk('span', 'user-role-badge', user.isAdmin ? 'Administrator' : 'Standard User'));
    meta.appendChild(pjMk('span', 'user-status-badge' + (user.isActive ? '' : ' inactive'), user.isActive ? 'Active' : 'Inactive'));
    if (user.mustChangePassword) {
      meta.appendChild(pjMk('span', 'user-status-badge pending', 'Must change password'));
    }
    if (user.createdAt) {
      const createdDate = new Date(user.createdAt).toLocaleDateString();
      meta.appendChild(document.createTextNode(
        window.ctI18n?.t?.('Created {date}', { date: createdDate }) || ('Created ' + createdDate)));
    }
    main.appendChild(meta);
    card.appendChild(main);
    const edit = pjMk('button', 'btn', 'Edit');
    edit.type = 'button'; edit.addEventListener('click', () => openUserEditor(user.id));
    card.appendChild(edit);
    host.appendChild(card);
  });
  if (!managedUsers.length) host.innerHTML = '<div class="maint-empty">No users found.</div>';
  const addBtn = document.getElementById('user-add-btn');
  if (addBtn) addBtn.hidden = !_currentUser?.isAdmin;
}

function openUserEditor(id = null) {
  const user = id == null ? null : managedUsers.find(item => item.id === Number(id));
  if (id != null && !user) return;
  managedUserId = user?.id ?? null;
  const creating = !user;
  const isSelf = !!user?.isCurrent;
  document.getElementById('user-editor-title').textContent = creating ? 'Add User' : 'Edit User';
  document.getElementById('user-edit-username').value = user?.username || '';
  document.getElementById('user-edit-name-en').value = user?.nameEn || '';
  document.getElementById('user-edit-name-ar').value = user?.nameAr || '';
  document.getElementById('user-edit-role').value = user?.isAdmin ? 'admin' : 'standard';
  const active = document.getElementById('user-edit-active');
  active.checked = creating || !!user?.isActive;
  active.disabled = isSelf;
  document.querySelectorAll('#user-editor .user-admin-control').forEach(el => { el.hidden = !_currentUser?.isAdmin; });
  // An admin resetting someone ELSE's password or changing their role/status
  // must re-prove it's really them at the keyboard, not just that an admin
  // session happens to still be open — reuses this same field, relabeled.
  const showCurrentPassword = isSelf || (!creating && _currentUser?.isAdmin && !isSelf);
  document.getElementById('user-current-password-field').hidden = !showCurrentPassword;
  document.getElementById('user-current-password-label').textContent = isSelf ? 'Current password' : 'Your admin password';
  document.getElementById('user-current-password-hint').textContent = isSelf
    ? 'Required only when changing your own password.'
    : 'Required to reset this user’s password or change their role or status.';
  document.getElementById('user-edit-password-label').textContent = creating ? 'Temporary password' : 'New password (optional)';
  ['user-edit-current-password', 'user-edit-password', 'user-edit-confirm'].forEach(key => { document.getElementById(key).value = ''; });
  document.getElementById('user-form-status').textContent = '';
  document.getElementById('user-save-btn').textContent = creating ? 'Create User' : 'Save User';
  document.getElementById('user-editor').hidden = false;
  document.getElementById('user-edit-username').focus();
}

function closeUserEditor() {
  managedUserId = null;
  document.getElementById('user-editor').hidden = true;
  document.getElementById('user-form-status').textContent = '';
}

// Mirrors auth.js's validateUsername/validatePassword exactly (that module
// runs main-process-only and cannot be required from the renderer) so the
// user finds out about an invalid value before a round trip, not after one.
const USER_USERNAME_MIN = 3, USER_USERNAME_MAX = 32;
const USER_USERNAME_RE = /^[A-Za-z0-9._-]+$/;
const USER_PASSWORD_MIN = 8, USER_PASSWORD_MAX_BYTES = 72;
function validateUsernameClientSide(username) {
  if (username.length < USER_USERNAME_MIN || username.length > USER_USERNAME_MAX) {
    return `Username must be ${USER_USERNAME_MIN}–${USER_USERNAME_MAX} characters.`;
  }
  if (!USER_USERNAME_RE.test(username)) return 'Username may only contain letters, numbers, and . _ -';
  return null;
}
function validatePasswordClientSide(password) {
  if (password.length < USER_PASSWORD_MIN) return `Password must be at least ${USER_PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(password).length > USER_PASSWORD_MAX_BYTES) {
    return `Password must be at most ${USER_PASSWORD_MAX_BYTES} UTF-8 bytes.`;
  }
  return null;
}

async function saveManagedUser() {
  const status = document.getElementById('user-form-status');
  const saveBtn = document.getElementById('user-save-btn');
  const username = document.getElementById('user-edit-username').value.trim();
  const nameEn = document.getElementById('user-edit-name-en').value.trim();
  const nameAr = document.getElementById('user-edit-name-ar').value.trim();
  const password = document.getElementById('user-edit-password').value;
  const confirm = document.getElementById('user-edit-confirm').value;
  const creating = managedUserId == null;
  status.textContent = '';
  if (!username) { status.textContent = 'Username is required.'; document.getElementById('user-edit-username').focus(); return; }
  const usernameErr = validateUsernameClientSide(username);
  if (usernameErr) { status.textContent = usernameErr; document.getElementById('user-edit-username').focus(); return; }
  if (creating && !password) { status.textContent = 'A temporary password is required.'; document.getElementById('user-edit-password').focus(); return; }
  if (password) {
    const passwordErr = validatePasswordClientSide(password);
    if (passwordErr) { status.textContent = passwordErr; document.getElementById('user-edit-password').focus(); return; }
  }
  if (password !== confirm) { status.textContent = 'Passwords do not match.'; document.getElementById('user-edit-confirm').focus(); return; }
  saveBtn.disabled = true;
  let result;
  try {
    if (creating) {
      result = await window.api.authAddUser(username, password, document.getElementById('user-edit-role').value === 'admin', nameEn, nameAr);
    } else {
      result = await window.api.authUpdateUser(managedUserId, {
        username,
        nameEn,
        nameAr,
        isAdmin: document.getElementById('user-edit-role').value === 'admin',
        isActive: document.getElementById('user-edit-active').checked,
        // Same field, two meanings depending on who's being edited: the
        // acting user's own current password, whether confirming their own
        // change or re-proving their identity to change someone else's.
        currentPassword: document.getElementById('user-edit-current-password').value,
        actorPassword: document.getElementById('user-edit-current-password').value,
        password,
      });
    }
  } catch { result = { ok: false, error: 'Could not save the user.' }; }
  saveBtn.disabled = false;
  if (!result?.ok) { status.textContent = result?.error || 'Could not save the user.'; return; }
  if (result.currentUser) await startApp(result.currentUser);
  closeUserEditor();
  await renderUserManagement();
  toast(creating ? 'User created' : 'User updated');
}

// ══ MAINTENANCE TAB (Milestone 6) ═════════════════════════════════════════════
// Backup list + restore, integrity check, lookup-duplicate audit + merge, and
// the most recent boot's orphan-file sweep report — all previously invisible.
// Rendered fresh each time the tab is switched to (not cached), since backups/
// duplicates can change between visits.
function renderMaintenanceTab() {
  refreshMaintenanceBackups();
  document.getElementById('maint-integrity-result').innerHTML = '';
  document.getElementById('maint-diagnostics-result').innerHTML = '';
  document.getElementById('maint-duplicates-list').innerHTML = '';
  renderMaintenanceOrphanReport();
}

async function runSystemDiagnostics() {
  const host = document.getElementById('maint-diagnostics-result');
  host.innerHTML = '<div class="maint-empty">Auditing recovery readiness…</div>';
  let result;
  try { result = await window.api.getSystemDiagnostics(); }
  catch { host.innerHTML = '<div class="maint-result-bad">Could not run diagnostics.</div>'; return; }
  const healthy = result.integrity?.ok
    && result.missingFiles.length === 0
    && result.backups.invalid.length === 0
    && result.foreignKeysEnabled;
  const rows = [
    ['Status', healthy ? 'Ready' : 'Needs attention'],
    ['Application / schema', 'v' + result.appVersion + ' / migration ' + result.schemaHead],
    ['SQLite', result.sqliteVersion + ' · ' + String(result.journalMode || '').toUpperCase() + ' journal'],
    ['Database', fmtFileSize(result.databaseBytes) + (result.walBytes ? ' + ' + fmtFileSize(result.walBytes) + ' WAL' : '')],
    ['Disk free', result.freeBytes == null ? 'Unavailable' : fmtFileSize(result.freeBytes)],
    ['Accounts / search rows', result.users + ' / ' + result.workspaceSearchRows],
    ['Referenced files', result.referencedFiles + ' checked · ' + result.missingFiles.length + ' missing'],
    ['Rotating backups', result.backups.validCount + ' valid of ' + result.backups.count],
    ['Credential encryption', result.credentialEncryptionAvailable ? 'Available on this Windows account' : 'Unavailable'],
    ['Data folder', result.dataDirectory],
  ];
  host.innerHTML =
    '<div class="' + (healthy ? 'maint-result-ok' : 'maint-result-bad') + '">' +
      ic(healthy ? 'check' : 'shield-alert') + ' ' +
      (healthy ? 'Recovery checks passed.' : 'One or more recovery checks need attention.') +
    '</div>' +
    '<div class="maint-violation-list">' +
      rows.map(([label, value]) => '<strong>' + esc(label) + ':</strong> ' + esc(String(value))).join('<br>') +
      (result.backups.invalid.length
        ? '<br><strong>Invalid backups:</strong> ' + result.backups.invalid.map(item => esc(item.name + ' — ' + item.error)).join('; ')
        : '') +
      (result.missingFiles.length
        ? '<br><strong>Missing files:</strong> ' + result.missingFiles.slice(0, 10).map(item => esc(item.table + ' #' + item.id)).join(', ')
        : '') +
    '</div>';
}

async function refreshMaintenanceBackups() {
  const host = document.getElementById('maint-backups-list');
  host.innerHTML = '<div class="maint-empty">Loading…</div>';
  let backups;
  try { backups = await window.api.listBackups(); } catch { host.innerHTML = '<div class="maint-empty">Could not load backups.</div>'; return; }
  if (!Array.isArray(backups) || !backups.length) { host.innerHTML = '<div class="maint-empty">No backups yet — one is taken automatically on the next launch of an existing database.</div>'; return; }
  host.innerHTML = '';
  backups.forEach(b => {
    const row = pjMk('div', 'maint-row');
    const main = pjMk('div', 'maint-row-main');
    main.appendChild(pjMk('div', 'maint-row-title', b.name));
    main.appendChild(pjMk('div', 'maint-row-meta', new Date(b.mtime).toLocaleString() + ' · ' + fmtFileSize(b.size)));
    row.appendChild(main);
    const btn = pjMk('button', 'btn', 'Restore…');
    btn.addEventListener('click', () => openMaintenanceRestoreConfirm(row, b.name));
    row.appendChild(btn);
    host.appendChild(row);
  });
}

// Typed-confirmation restore flow — the single riskiest action in the app
// (replaces the live DB and restarts). Requires typing the EXACT backup
// filename shown (not just clicking, and not a generic "RESTORE" — forcing
// the user to actually read which file they're restoring) before the real
// restore button enables.
function openMaintenanceRestoreConfirm(row, filename) {
  if (row.querySelector('.maint-confirm')) return; // already open
  const confirmBox = pjMk('div', 'maint-confirm');
  const input = document.createElement('input');
  input.type = 'text'; input.placeholder = 'Type "' + filename + '" to confirm';
  const restoreBtn = pjMk('button', 'btn', 'Restore Now');
  restoreBtn.disabled = true;
  restoreBtn.style.cssText = 'background:var(--bad);color:#fff;border-color:var(--bad)';
  const cancelBtn = pjMk('button', 'btn', 'Cancel');
  input.addEventListener('input', () => { restoreBtn.disabled = input.value !== filename; });
  cancelBtn.addEventListener('click', () => confirmBox.remove());
  restoreBtn.addEventListener('click', async () => {
    restoreBtn.disabled = true; restoreBtn.textContent = 'Restoring…';
    let res;
    try {
      await flushPending();
      res = await window.api.restoreBackup(filename);
    }
    catch { toast('Restore failed'); restoreBtn.disabled = false; restoreBtn.textContent = 'Restore Now'; return; }
    if (res && res.ok === false) {
      toast(res.error || 'Restore failed'); restoreBtn.disabled = false; restoreBtn.textContent = 'Restore Now'; return;
    }
    // On success the app relaunches itself (main.js) — nothing more to do here.
    toast('Restoring and restarting…');
  });
  confirmBox.appendChild(input); confirmBox.appendChild(restoreBtn); confirmBox.appendChild(cancelBtn);
  row.appendChild(confirmBox);
  input.focus();
}

async function runMaintenanceIntegrityCheck() {
  const host = document.getElementById('maint-integrity-result');
  host.innerHTML = '<div class="maint-empty">Checking…</div>';
  let res;
  try { res = await window.api.checkIntegrity(); } catch { host.innerHTML = '<div class="maint-empty">Could not run the check.</div>'; return; }
  if (res.ok) { host.innerHTML = '<div class="maint-result-ok">' + ic('check') + ' OK — no corruption or dangling references found.</div>'; return; }
  const lines = [...(res.integrityMessages || []), ...(res.foreignKeyViolations || []).map(v => JSON.stringify(v))];
  host.innerHTML = '<div class="maint-result-bad">' + ic('x') + ' Problems found:</div>' +
    '<div class="maint-violation-list">' + lines.map(l => esc(l)).join('<br>') + '</div>';
}

async function runMaintenanceLookupScan() {
  const host = document.getElementById('maint-duplicates-list');
  host.innerHTML = '<div class="maint-empty">Scanning…</div>';
  let dupes;
  try { dupes = await window.api.getLookupDuplicates(); } catch { host.innerHTML = '<div class="maint-empty">Could not scan.</div>'; return; }
  if (!Array.isArray(dupes) || !dupes.length) { host.innerHTML = '<div class="maint-empty">No duplicates found.</div>'; return; }
  host.innerHTML = '';
  dupes.forEach(d => {
    const row = pjMk('div', 'maint-row');
    const main = pjMk('div', 'maint-row-main');
    main.appendChild(pjMk('div', 'maint-row-title', d.category + ': ' + d.codes.map(c =>
      lkLabelById(d.category, c.id) || c.label).join(' / ')));
    main.appendChild(pjMk('div', 'maint-row-meta', d.codes.length + ' colliding codes'));
    row.appendChild(main);
    const mergeable = !!LOOKUP_MERGE_CATEGORIES[d.category];
    if (mergeable) {
      const btn = pjMk('button', 'btn', 'Merge…');
      btn.addEventListener('click', () => openMaintenanceMergeConfirm(row, d));
      row.appendChild(btn);
    } else {
      row.appendChild(pjMk('span', 'maint-row-meta', 'Merge not supported for this category'));
    }
    host.appendChild(row);
  });
}
// Categories mergeLookupDuplicate() actually supports — derived from the
// registry's `mergeable` flag, which mirrors db.js's own LOOKUP_MERGE_TARGETS
// scoping (test/settings-registry-smoke.js checks the two stay in sync).
const LOOKUP_MERGE_CATEGORIES = Object.fromEntries(
  SETTINGS_CATALOG_TABS.filter(t => t.mergeable).map(t => [t.category, true])
);

function openMaintenanceMergeConfirm(row, dupeGroup) {
  if (row.querySelector('.maint-confirm')) return;
  const confirmBox = pjMk('div', 'maint-confirm');
  confirmBox.style.flexWrap = 'wrap';
  const label = pjMk('span', null, 'Keep:');
  const select = document.createElement('select');
  dupeGroup.codes.forEach(c => {
    const opt = document.createElement('option'); opt.dataset.userContent = ''; opt.value = c.id;
    opt.textContent = (lkLabelById(dupeGroup.category, c.id) || c.label) + ' (' + c.code + ')';
    select.appendChild(opt);
  });
  const mergeBtn = pjMk('button', 'btn primary', 'Merge Now');
  const cancelBtn = pjMk('button', 'btn', 'Cancel');
  cancelBtn.addEventListener('click', () => confirmBox.remove());
  mergeBtn.addEventListener('click', async () => {
    const targetId = Number(select.value);
    const sources = dupeGroup.codes.filter(c => c.id !== targetId);
    mergeBtn.disabled = true; mergeBtn.textContent = 'Merging…';
    try {
      for (const s of sources) {
        const res = await window.api.mergeLookups(dupeGroup.category, targetId, s.id);
        if (!res.ok) { toast(res.error || 'Merge failed'); mergeBtn.disabled = false; mergeBtn.textContent = 'Merge Now'; return; }
      }
    } catch { toast('Merge failed'); mergeBtn.disabled = false; mergeBtn.textContent = 'Merge Now'; return; }
    LK = await window.api.loadLookups(); // refresh the lookup cache client-side too
    toast('Merged');
    runMaintenanceLookupScan();
  });
  confirmBox.appendChild(label); confirmBox.appendChild(select); confirmBox.appendChild(mergeBtn); confirmBox.appendChild(cancelBtn);
  row.appendChild(confirmBox);
}

async function renderMaintenanceOrphanReport() {
  const host = document.getElementById('maint-orphan-report');
  host.innerHTML = '<div class="maint-empty">Loading…</div>';
  let report;
  try { report = await window.api.getOrphanSweepReport(); } catch { host.innerHTML = '<div class="maint-empty">Could not load the sweep report.</div>'; return; }
  const total = (report.projectIds || []).length + (report.companyDocumentIds || []).length + (report.knowledgeItemIds || []).length;
  if (!report.ranAt) { host.innerHTML = '<div class="maint-empty">No sweep has run yet this session.</div>'; return; }
  if (!total) {
    host.innerHTML = '<div class="maint-empty">Nothing to clean up as of the last launch (' + new Date(report.ranAt).toLocaleString() + ').</div>';
    return;
  }
  const parts = [];
  if (report.projectIds.length) parts.push(report.projectIds.length + ' orphaned project folder' + (report.projectIds.length === 1 ? '' : 's'));
  if (report.companyDocumentIds.length) parts.push(report.companyDocumentIds.length + ' orphaned company document folder' + (report.companyDocumentIds.length === 1 ? '' : 's'));
  if ((report.knowledgeItemIds || []).length) parts.push(report.knowledgeItemIds.length + ' orphaned Knowledge Hub folder' + (report.knowledgeItemIds.length === 1 ? '' : 's'));
  host.innerHTML = '<div class="maint-row-meta">Last launch (' + new Date(report.ranAt).toLocaleString() + ') removed ' + esc(parts.join(' and ')) + '.</div>';
}

// Settings list items (General + each lookup category) — one flat left-hand list.
function switchTab(btn) {
  document.querySelectorAll('#module-settings .stab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#module-settings .settings-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  syncSettingsSaveButton(btn.dataset.tab);
  syncControlSemantics(document.getElementById('module-settings'));
  if (btn.dataset.tab === 'maintenance') renderMaintenanceTab();
  if (btn.dataset.tab === 'users') renderUserManagement();
  uiState.filters.settings = { tab: btn.dataset.tab };
  saveUiStateDebounced();
}

function syncSettingsSaveButton(tab) {
  const btn = document.getElementById('settings-save-btn');
  if (!btn) return;
  btn.hidden = tab === 'maintenance' || tab === 'general' || tab === 'users';
  btn.textContent = 'Save Catalog Changes';
  document.getElementById('settings-save-status').textContent = '';
  const discardBtn = document.getElementById('settings-discard-btn');
  if (discardBtn) discardBtn.hidden = !settingsDirty;
}

// Marks the catalog draft as having unsaved edits so navigating away and back
// (or a language change) preserves it instead of silently discarding it —
// called by every catalog field/add/disable/delete handler.
function markSettingsDirty() {
  settingsDirty = true;
  const discardBtn = document.getElementById('settings-discard-btn');
  if (discardBtn) discardBtn.hidden = false;
}

// Reverts lookupsDraft to the last-loaded server state. Mirrors the
// native-confirm convention the Knowledge Hub editor already uses for the
// same "discard this dirty form" situation (closeKnowledgeEditor).
function discardSettingsChanges() {
  const msg = 'Discard your unsaved catalog changes?';
  if (!confirm(window.ctI18n ? window.ctI18n.t(msg) : msg)) return;
  settingsDirty = false;
  initSettingsModule();
  toast('Changes discarded');
}

// Settings search used to only match a tab's own name (S9 in
// Typing "backup", "password", or "integrity"
// found nothing even though all three exist inside a panel. Each entry names
// the tab it lives on, a selector to scroll to and highlight, and the search
// terms that should find it (in addition to whatever the tab's own label
// already matches via textContent).
const SETTINGS_SEARCH_INDEX = [
  { tab: 'general', selector: '#setting-startonlastpage-ctl', terms: 'start on last page landing analytics launch open' },
  { tab: 'general', selector: '#tab-general button[data-onclick="openHowThinksOverlay()"]', terms: 'how this app thinks help guide explainer onboarding' },
  { tab: 'users', selector: '#user-add-btn', terms: 'add user new user create account invite' },
  { tab: 'users', selector: '#user-list', terms: 'users accounts password permissions role administrator standard' },
  { tab: 'maintenance', selector: '#maint-fullbackup-btn', terms: 'backup full backup desktop everything export' },
  { tab: 'maintenance', selector: '#maint-fullrestore-btn', terms: 'restore recovery full restore import' },
  { tab: 'maintenance', selector: 'button[data-onclick="runSystemDiagnostics()"]', terms: 'diagnostics audit readiness recovery checks health' },
  { tab: 'maintenance', selector: 'button[data-onclick="refreshMaintenanceBackups()"]', terms: 'backups rotating snapshots refresh' },
  { tab: 'maintenance', selector: 'button[data-onclick="runMaintenanceIntegrityCheck()"]', terms: 'integrity check corruption database' },
  { tab: 'maintenance', selector: 'button[data-onclick="runMaintenanceLookupScan()"]', terms: 'duplicates merge lookup scan dedupe' },
  { tab: 'maintenance', selector: '#maint-orphan-report', terms: 'orphan file sweep cleanup leftover' },
];

function filterSettingsTabs() {
  const q = (document.getElementById('settings-search')?.value || '').trim().toLowerCase();
  const tabs = [...document.querySelectorAll('#module-settings .stab')];
  const controlMatches = q ? SETTINGS_SEARCH_INDEX.filter(entry => entry.terms.includes(q)) : [];
  const controlMatchTabs = new Set(controlMatches.map(entry => entry.tab));
  tabs.forEach(btn => {
    const permitted = _currentUser?.isAdmin || btn.dataset.tab === 'general' || btn.dataset.tab === 'users';
    const labelMatches = !q || btn.textContent.toLowerCase().includes(q);
    btn.hidden = !permitted || (!!q && !labelMatches && !controlMatchTabs.has(btn.dataset.tab));
  });
  // A group header hides while searching, but an admin-only header must stay
  // hidden for a standard user even once the search box is cleared — it must
  // never reappear over a section whose tabs are all permission-hidden.
  document.querySelectorAll('#module-settings .settings-group-label').forEach(label => {
    label.hidden = !!q || (label.classList.contains('admin-only') && !_currentUser?.isAdmin);
  });
  const active = document.querySelector('#module-settings .stab.active');
  if (active?.hidden) {
    const first = tabs.find(btn => !btn.hidden);
    if (first) switchTab(first);
  }
  // A query that only matched a control (not the active tab's own label)
  // means the user is hunting for something specific inside a panel — jump
  // there and flash it, the same deep-link convention palette hits use.
  if (controlMatches.length) {
    const target = controlMatches[0];
    const targetBtn = tabs.find(btn => btn.dataset.tab === target.tab);
    if (targetBtn && !targetBtn.classList.contains('active')) switchTab(targetBtn);
    scrollToAndHighlight(target.selector);
  }
}

// Swaps a draft entry with its neighbor — the only way to change sortOrder
// It was written on save but previously had no UI.
function moveDraftEntry(arr, index, delta, redraw) {
  const target = index + delta;
  if (target < 0 || target >= arr.length) return;
  [arr[index], arr[target]] = [arr[target], arr[index]];
  markSettingsDirty();
  redraw();
}
function buildReorderControls(arr, i, redraw) {
  const wrap = document.createElement('div');
  wrap.className = 'lookup-item-reorder';
  const up = document.createElement('button');
  up.type = 'button'; up.className = 'lookup-item-reorder-btn'; up.innerHTML = ic('chevron-up');
  up.title = 'Move up'; up.disabled = i === 0;
  up.addEventListener('click', () => moveDraftEntry(arr, i, -1, redraw));
  const down = document.createElement('button');
  down.type = 'button'; down.className = 'lookup-item-reorder-btn'; down.innerHTML = ic('chevron-down');
  down.title = 'Move down'; down.disabled = i === arr.length - 1;
  down.addEventListener('click', () => moveDraftEntry(arr, i, 1, redraw));
  wrap.appendChild(up); wrap.appendChild(down);
  return wrap;
}

function renderLookupPanel(uiKey) {
  const category = LK_CAT[uiKey];
  const panel = document.getElementById('tab-' + uiKey);
  panel.innerHTML = '';
  const arr = lookupsDraft[category] || (lookupsDraft[category] = []);
  if (category === 'COMPANY') { renderCompanyProfilePanel(panel, arr); return; }

  const intro = document.createElement('p');
  intro.className = 'general-hint lookup-bilingual-intro';
  intro.textContent = 'Enter both English and Arabic labels. The app displays the matching label for the selected interface language.';
  panel.appendChild(intro);

  const list = document.createElement('div');
  list.className = 'lookup-list bilingual-lookup-list';
  const redraw = () => renderLookupPanel(uiKey);

  arr.forEach((opt, i) => {
    const item = document.createElement('div');
    item.className = 'lookup-item bilingual-lookup-item' + (opt.isActive === false ? ' lookup-item-inactive' : '');

    const field = (label, value, placeholder, onInput, dir) => {
      const wrap = document.createElement('label'); wrap.className = 'client-profile-field';
      const caption = document.createElement('span'); caption.textContent = label; wrap.appendChild(caption);
      const input = document.createElement('input'); input.type = 'text'; input.value = value || ''; input.placeholder = placeholder;
      input.title = opt.code ? 'code: ' + opt.code : 'new entry';
      input.dir = dir;
      input.addEventListener('input', e => { onInput(e.target.value); markSettingsDirty(); }); wrap.appendChild(input);
      return wrap;
    };
    item.appendChild(field('English Label', opt.nameEn || opt.label, 'English label', value => {
      opt.nameEn = value; opt.label = value;
    }, 'ltr'));
    item.appendChild(field('Arabic Label', opt.nameAr, 'التسمية بالعربية', value => { opt.nameAr = value; }, 'rtl'));

    item.appendChild(buildReorderControls(arr, i, redraw));

    // Existing entries soft-disable (codes are immutable — historical rows point at
    // them); never-saved new entries are simply dropped.
    const del = document.createElement('button');
    del.className = 'lookup-item-del';
    del.innerHTML = opt.isActive === false ? ic('rotate-ccw') : ic('x');
    del.title = opt.id == null ? 'Remove' : (opt.isActive === false ? 'Re-enable' : 'Disable (hide from dropdowns)');
    del.addEventListener('click', () => {
      if (opt.id == null) arr.splice(i, 1);
      else opt.isActive = opt.isActive === false;
      markSettingsDirty();
      redraw();
    });

    item.appendChild(del);
    list.appendChild(item);
  });

  panel.appendChild(list);

  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'btn';
  addBtn.innerHTML = ic('plus') + ' Add Entry';
  addBtn.addEventListener('click', () => {
    arr.push({ id: null, code: null, label: '', nameEn: '', nameAr: '', sortOrder: arr.length, isActive: true });
    markSettingsDirty();
    redraw();
    panel.querySelector('.bilingual-lookup-item:last-child input')?.focus();
  });
  panel.appendChild(addBtn);
}

function renderCompanyProfilePanel(panel, arr) {
  const intro = document.createElement('p');
  intro.className = 'general-hint client-profile-intro';
  intro.textContent = 'Each client profile has a unique business code plus English and Arabic names. Tasks, projects, and infrastructure stay linked when these values change.';
  panel.appendChild(intro);

  const list = document.createElement('div');
  list.className = 'lookup-list client-profile-list';
  const redraw = () => renderLookupPanel('companies');
  arr.forEach((opt, i) => {
    const item = document.createElement('div');
    item.className = 'lookup-item client-profile-item' + (opt.isActive === false ? ' lookup-item-inactive' : '');
    const field = (label, value, placeholder, onInput, className = '') => {
      const wrap = document.createElement('label'); wrap.className = 'client-profile-field ' + className;
      const caption = document.createElement('span'); caption.textContent = label; wrap.appendChild(caption);
      const input = document.createElement('input'); input.type = 'text'; input.value = value || ''; input.placeholder = placeholder;
      input.addEventListener('input', e => { onInput(e.target.value); markSettingsDirty(); }); wrap.appendChild(input); return wrap;
    };
    item.appendChild(field('Company Code', opt.code, 'e.g. ACME or 105', v => { opt.code = v.toUpperCase().replace(/\s+/g, '_'); }, 'client-code-field'));
    item.appendChild(field('English Name', opt.nameEn || opt.label, 'English company name', v => { opt.nameEn = v; opt.label = v; }));
    const arField = field('Arabic Name', opt.nameAr, 'اسم الشركة بالعربية', v => { opt.nameAr = v; });
    arField.querySelector('input').dir = 'rtl'; item.appendChild(arField);

    item.appendChild(buildReorderControls(arr, i, redraw));

    const del = document.createElement('button'); del.type = 'button'; del.className = 'lookup-item-del';
    del.innerHTML = opt.isActive === false ? ic('rotate-ccw') : ic('x');
    del.title = opt.id == null ? 'Remove' : (opt.isActive === false ? 'Re-enable' : 'Disable (hide from dropdowns)');
    del.addEventListener('click', () => { if (opt.id == null) arr.splice(i, 1); else opt.isActive = opt.isActive === false; markSettingsDirty(); redraw(); });
    item.appendChild(del); list.appendChild(item);
  });
  panel.appendChild(list);

  const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'btn';
  addBtn.innerHTML = ic('plus') + ' Add Client Profile';
  addBtn.addEventListener('click', () => {
    arr.push({ id: null, code: '', label: '', nameEn: '', nameAr: '', sortOrder: arr.length, isActive: true });
    markSettingsDirty();
    redraw();
    panel.querySelector('.client-profile-item:last-child input')?.focus();
  });
  panel.appendChild(addBtn);
}
