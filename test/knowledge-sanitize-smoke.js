'use strict';

// Static guard on the Knowledge Hub HTML sanitizer's allowlists. The sanitizer
// itself (renderer/features/knowledge-sanitize.js) wraps vendored DOMPurify,
// which needs a real DOM to execute — that behavioral coverage (script/event
// handler/img/js-url/style stripping against actual DOMPurify) lives in
// test/electron-e2e.js's knowledgeSanitize and codeNotes checks, run via `npm
// run test:e2e` against the real Chromium renderer. This test instead guards
// the configs themselves so a future edit can't silently widen an allowlist
// (e.g. adding 'script', 'img', 'iframe', 'style', or 'on*' attributes) without
// a reviewer noticing here, independent of whether test:e2e is run locally.
//
// Two configs: the legacy rich-text notes, and Code Notes (Markdown rendered by
// marked). Both keep the same hard exclusions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'features', 'knowledge-sanitize.js'), 'utf8');

const list = text => text.split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
const configs = [...source.matchAll(/const (\w+_SANITIZE_CONFIG) = \{([\s\S]*?)\};/g)].map(match => {
  const tagsMatch = match[2].match(/ALLOWED_TAGS:\s*\[([^\]]+)\]/);
  const attrMatch = match[2].match(/ALLOWED_ATTR:\s*\[([^\]]+)\]/);
  assert.ok(tagsMatch && attrMatch, `${match[1]} must define ALLOWED_TAGS and ALLOWED_ATTR`);
  return { name: match[1], body: match[2], tags: list(tagsMatch[1]), attrs: list(attrMatch[1]) };
});
assert.deepEqual(configs.map(config => config.name), ['KNOWLEDGE_SANITIZE_CONFIG', 'CODE_NOTE_SANITIZE_CONFIG'],
  'knowledge-sanitize.js must define both sanitizer configs');

const forbiddenTags = ['script', 'img', 'iframe', 'style', 'object', 'embed', 'svg', 'form', 'input', 'video', 'audio'];
const forbiddenAttrs = ['style', 'onclick', 'onerror', 'onload', 'onmouseover', 'src', 'srcdoc', 'formaction'];

for (const { name, body, tags, attrs } of configs) {
  for (const tag of forbiddenTags) assert.ok(!tags.includes(tag), `${name}: ALLOWED_TAGS must never include <${tag}>`);
  for (const attr of forbiddenAttrs) assert.ok(!attrs.includes(attr), `${name}: ALLOWED_ATTR must never include ${attr}`);
  assert.ok(tags.includes('p') && tags.includes('a') && tags.includes('pre') && tags.includes('code'),
    `${name}: ALLOWED_TAGS must still cover the stored vocabulary (paragraphs, links, code blocks)`);
  assert.ok(attrs.includes('href'), `${name}: ALLOWED_ATTR must still allow href for links`);
  assert.match(body, /ALLOW_DATA_ATTR:\s*false/, `${name}: data-* attributes must stay disabled`);
}

console.log('PASS  Knowledge Hub sanitizer allowlists (rich text and Code Notes) exclude script/img/iframe/style and dangerous attributes');
console.log('PASS  Knowledge Hub sanitizer allowlists still cover the stored vocabulary');
console.log('PASS  Knowledge Hub sanitizer keeps data-* attributes disabled in both configs');
