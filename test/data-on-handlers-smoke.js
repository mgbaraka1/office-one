'use strict';

// renderer/event-delegation.js is the CSP-safe replacement for inline event
// attributes: markup declares `data-onclick="someGlobal('arg')"` and the
// dispatcher looks the name up on `window`. Its failure mode is deliberately
// quiet — an unresolvable name or an argument outside the tiny grammar is
// console.error'd and *skipped*, so the button simply does nothing. Nothing
// throws, no test goes red, and the dead control is only found by clicking it.
//
// That is survivable while handler names are hand-written and stable. It is not
// survivable during a bulk rename: FINANCE_INTEGRATION_PLAN.md's Phase 1 renames
// 125 renderer globals and the 48 markup references that point at them, and a
// single missed pair is an invisible regression.
//
// This suite is the guard. It re-implements the dispatcher's own parsing rules
// (kept deliberately identical to event-delegation.js) and asserts that every
// data-on* expression in index.html would actually execute:
//   - the expression parses as one of the three accepted forms
//   - the called name is a real global defined by a loaded renderer script
//   - every argument token is one the grammar accepts
//
// Static analysis, no DOM: index.html's scripts are ordered classic scripts, so
// a top-level declaration in any of them *is* a global.
const fs = require('node:fs');
const path = require('node:path');

require('./test-bootstrap');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failed = false;
function check(name, pass, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failed = true;
}

// ── Mirrored from renderer/event-delegation.js ───────────────────────────────
// Kept byte-for-byte in step with the dispatcher: if the real grammar widens,
// this must widen with it or the suite starts rejecting valid markup.
const EVENT_TYPES = ['click', 'change', 'input', 'submit'];
const CALL_RE = /^([A-Za-z_$][\w$]*)\((.*)\)$/;
const DATASET_RE = /^this\.dataset\.([A-Za-z_$][\w$]*)$/;
const FOCUS_RE = /^document\.getElementById\((['"])([^'"]+)\1\)\.focus\(\)$/;

function splitDelimited(source, delimiter) {
  const text = String(source || '').trim();
  if (!text) return [];
  const parts = [];
  let quote = '';
  let escaped = false;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && quote) { escaped = true; continue; }
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === delimiter) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  if (quote) throw new Error('Unterminated delegated event argument');
  parts.push(text.slice(start).trim());
  return parts;
}

// Mirrors parseArg()'s accepted token set. Returns true if the dispatcher could
// resolve this token to a value instead of throwing.
function argIsSupported(token) {
  if (['event', 'this', 'true', 'false', 'null', 'undefined'].includes(token)) return true;
  if (/^-?\d+(?:\.\d+)?$/.test(token)) return true;
  if (DATASET_RE.test(token)) return true;
  if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) return true;
  return false;
}

// ── The globals every delegated handler is resolved against ──────────────────
// Only scripts index.html actually loads, in its own order. A path listed here
// that index.html does not load would make this suite pass on a function the
// browser never defines.
function loadedRendererScripts() {
  const srcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  return srcs.filter(src => src.startsWith('renderer/') && !src.includes('/vendor/'));
}

// A classic script's top-level declarations land on `window`, so column-0
// `function`/`const`/`let`/`var` counts as global. `window.x = …` is an explicit
// global at any indentation — renderer/i18n.js assigns chooseLoginLanguage that
// way from inside a function, and it is a real, reachable handler.
function collectGlobals(relPaths) {
  const globals = new Set();
  for (const rel of relPaths) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const line of src.split('\n')) {
      let m = line.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
      if (m) { globals.add(m[1]); continue; }
      m = line.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
      if (m) { globals.add(m[1]); continue; }
      m = line.match(/(?:^|\s)window\.([A-Za-z_$][\w$]*)\s*=/);
      if (m) globals.add(m[1]);
    }
  }
  return globals;
}

// Every data-on* expression in the markup, with where it came from.
function collectHandlerExpressions() {
  const found = [];
  for (const type of EVENT_TYPES) {
    const attrRe = new RegExp(`data-on${type}="([^"]*)"`, 'g');
    let m;
    while ((m = attrRe.exec(html))) {
      const line = html.slice(0, m.index).split('\n').length;
      let expressions;
      try {
        expressions = splitDelimited(m[1], ';').filter(Boolean);
      } catch (error) {
        found.push({ type, line, expression: m[1], unterminated: true });
        continue;
      }
      for (const expression of expressions) found.push({ type, line, expression });
    }
  }
  return found;
}

try {
  const scripts = loadedRendererScripts();
  check('index.html loads renderer scripts this suite can resolve against', scripts.length > 0,
    `${scripts.length} script(s)`);

  const globals = collectGlobals(scripts);
  const handlers = collectHandlerExpressions();
  check('index.html declares delegated event handlers', handlers.length > 0,
    `${handlers.length} expression(s), ${globals.size} globals in scope`);

  const unterminated = handlers.filter(h => h.unterminated);
  check('every data-on* attribute has balanced quotes', unterminated.length === 0,
    unterminated.map(h => `line ${h.line}: ${h.expression}`).join(' | '));

  const unparsable = [];
  const unresolved = [];
  const badArgs = [];

  for (const handler of handlers) {
    if (handler.unterminated) continue;
    const { expression, line } = handler;
    // The dispatcher's two special forms, handled before any name lookup.
    if (expression === 'event.stopPropagation()') continue;
    if (FOCUS_RE.test(expression)) continue;

    const call = expression.match(CALL_RE);
    if (!call) { unparsable.push(`line ${line}: ${expression}`); continue; }

    if (!globals.has(call[1])) unresolved.push(`line ${line}: ${call[1]}()`);

    for (const token of splitDelimited(call[2], ',').filter(Boolean)) {
      if (!argIsSupported(token)) badArgs.push(`line ${line}: ${call[1]}() argument \`${token}\``);
    }
  }

  check('every data-on* expression matches the delegated-event grammar', unparsable.length === 0,
    unparsable.join(' | '));
  check('every delegated handler resolves to a defined renderer global', unresolved.length === 0,
    unresolved.join(' | '));
  check('every delegated handler argument is one the dispatcher accepts', badArgs.length === 0,
    badArgs.join(' | '));

  const uniqueNames = new Set(
    handlers
      .filter(h => !h.unterminated && h.expression !== 'event.stopPropagation()' && !FOCUS_RE.test(h.expression))
      .map(h => h.expression.match(CALL_RE))
      .filter(Boolean)
      .map(m => m[1])
  );
  console.log(`\n${handlers.length} delegated expressions, ${uniqueNames.size} distinct handlers`
    + (failed ? ' — see failures above.' : ', all resolved.'));
} catch (error) {
  console.error(error);
  failed = true;
}

if (failed) process.exit(1);
