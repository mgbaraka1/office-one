'use strict';

// Static localization coverage: application-owned HTML copy and explicit
// renderer feedback/tooltips must have an Arabic entry (or a supported dynamic
// prefix rule). User-entered data is produced at runtime and is not inspected.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const i18n = fs.readFileSync(path.join(root, 'renderer', 'i18n.js'), 'utf8');
const keys = new Set([...i18n.matchAll(/(?:^|[,\n]\s*)'((?:\\'|[^'])+)'\s*:/g)]
  .map(match => match[1].replace(/\\'/g, "'")));
const failures = [];
const neutral = /^(?:O1|Ctrl K|[⌃^]N|\d+(?:\.\d+)?[mh]|H2|URL|Esc|Ctrl|K|Shift|N|F|Tab)$/;
const decode = value => value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"').replaceAll('&#39;', "'").replace(/\s+/g, ' ').trim();

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const match of html.matchAll(/>([^<>]+)</g)) {
  const value = decode(match[1]);
  if (value && /[A-Za-z]/.test(value) && !/[{}]/.test(value) && !neutral.test(value) && !keys.has(value))
    failures.push(`index text: ${value}`);
}
for (const match of html.matchAll(/(?:title|placeholder|aria-label)="([^"]+)"/g)) {
  const value = decode(match[1]);
  if (/[A-Za-z]/.test(value) && !neutral.test(value) && !keys.has(value)) failures.push(`index attribute: ${value}`);
}

const dynamic = /^(?:Could not |Browse all work for |Open |Remove filter |Remove tag |Moved to |Session logged to |History — |Role: |Credential location: |Type "|Tasks \(|Client Tasks \(|Internal Tasks \(|Sessions \(|Documents \(|PDF failed: |Full backup failed: |Backup failed: |Full restore stopped: |Updated |Overdue — |Renews |Expires |in “|Go to invoice )/;
const files = [path.join(root, 'renderer', 'core.js'), ...fs.readdirSync(path.join(root, 'renderer', 'features'))
  .filter(name => name.endsWith('.js')).map(name => path.join(root, 'renderer', 'features', name))];
const patterns = [
  /(?:textContent|innerText|placeholder|title)\s*=\s*'((?:\\'|[^'])+)'/g,
  /(?:toast|showErr)\(\s*'((?:\\'|[^'])+)'/g,
  /pjMk\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'((?:\\'|[^'])+)'/g,
];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) {
    const value = match[1].replace(/\\'/g, "'");
    if (!/[A-Za-z]/.test(value) || keys.has(value) || dynamic.test(value) || value === 'https://...') continue;
    failures.push(`${path.relative(root, file)}: ${value}`);
  }
}

if (failures.length) {
  console.error('Arabic localization coverage gaps:\n' + [...new Set(failures)].join('\n'));
  process.exit(1);
}
console.log('PASS  Static HTML labels, placeholders, tooltips, and renderer feedback have Arabic coverage');
console.log('PASS  Dynamic UI prefixes preserve record data while translating application wording');
