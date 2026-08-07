'use strict';

// Static guard on the Knowledge Hub HTML sanitizer's allowlist. The sanitizer
// itself (renderer/features/knowledge-sanitize.js) wraps vendored DOMPurify,
// which needs a real DOM to execute — that behavioral coverage (script/event
// handler/img/js-url/style stripping against actual DOMPurify) lives in
// test/electron-e2e.js's knowledgeSanitize checks, run via `npm run test:e2e`
// against the real Chromium renderer. This test instead guards the config
// itself so a future edit can't silently widen the allowlist (e.g. adding
// 'script', 'img', 'iframe', 'style', or 'on*' attributes) without a reviewer
// noticing here, independent of whether test:e2e is run locally.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'features', 'knowledge-sanitize.js'), 'utf8');

const tagsMatch = source.match(/ALLOWED_TAGS:\s*\[([^\]]+)\]/);
const attrMatch = source.match(/ALLOWED_ATTR:\s*\[([^\]]+)\]/);
assert.ok(tagsMatch && attrMatch, 'KNOWLEDGE_SANITIZE_CONFIG must define ALLOWED_TAGS and ALLOWED_ATTR');

const tags = tagsMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
const attrs = attrMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

const forbiddenTags = ['script', 'img', 'iframe', 'style', 'object', 'embed', 'svg', 'form', 'input', 'video', 'audio'];
const forbiddenAttrs = ['style', 'onclick', 'onerror', 'onload', 'onmouseover', 'src', 'srcdoc', 'formaction'];

for (const tag of forbiddenTags) assert.ok(!tags.includes(tag), `ALLOWED_TAGS must never include <${tag}>`);
for (const attr of forbiddenAttrs) assert.ok(!attrs.includes(attr), `ALLOWED_ATTR must never include ${attr}`);
assert.ok(tags.includes('p') && tags.includes('a') && tags.includes('pre') && tags.includes('code'),
  'ALLOWED_TAGS must still cover the Quill toolbar vocabulary (paragraphs, links, code blocks)');
assert.ok(attrs.includes('href'), 'ALLOWED_ATTR must still allow href for links');
assert.match(source, /ALLOW_DATA_ATTR:\s*false/, 'data-* attributes must stay disabled');

console.log('PASS  Knowledge Hub sanitizer allowlist excludes script/img/iframe/style and dangerous attributes');
console.log('PASS  Knowledge Hub sanitizer allowlist still covers the Quill toolbar vocabulary');
console.log('PASS  Knowledge Hub sanitizer keeps data-* attributes disabled');
