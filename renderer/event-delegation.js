'use strict';

// CSP-safe replacement for the legacy inline event attributes. Markup keeps a
// small declarative expression in data-on*; only a named global function and a
// deliberately tiny argument grammar are accepted. No eval/new Function is
// used, and arbitrary JavaScript in markup cannot execute.
(function installDelegatedMarkupEvents() {
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

  const splitArgs = source => splitDelimited(source, ',');

  function parseArg(token, event, element) {
    if (token === 'event') return event;
    if (token === 'this') return element;
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (token === 'undefined') return undefined;
    if (/^-?\d+(?:\.\d+)?$/.test(token)) return Number(token);
    const dataset = token.match(DATASET_RE);
    if (dataset) return element.dataset[dataset[1]];
    if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
      return token.slice(1, -1).replace(/\\(['"\\])/g, '$1');
    }
    throw new Error(`Unsupported delegated event argument: ${token}`);
  }

  function execute(expression, event, element) {
    if (expression === 'event.stopPropagation()') {
      event.stopPropagation();
      return;
    }
    const focus = expression.match(FOCUS_RE);
    if (focus) {
      document.getElementById(focus[2])?.focus();
      return;
    }

    const call = expression.match(CALL_RE);
    if (!call || typeof window[call[1]] !== 'function') {
      console.error('[ui] Unsupported delegated event expression:', expression);
      return;
    }
    const args = splitArgs(call[2]).map(token => parseArg(token, event, element));
    window[call[1]](...args);
  }

  function dispatch(event) {
    const attribute = `data-on${event.type}`;
    const origin = event.target instanceof Element ? event.target : event.target?.parentElement;
    const element = origin?.closest?.(`[${attribute}]`);
    if (!element) return;
    const source = String(element.getAttribute(attribute) || '').trim();
    splitDelimited(source, ';').filter(Boolean).forEach(expression => execute(expression, event, element));
  }

  EVENT_TYPES.forEach(type => document.addEventListener(type, dispatch));
})();
