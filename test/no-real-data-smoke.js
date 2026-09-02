// ─────────────────────────────────────────────────────────────────────────────
// No real-world data in source.
//
// Client names, hostnames, internal IPs and live endpoints belong in the
// DATABASE, never in the code. This repository once shipped a real client's
// production URL inside a test fixture, plus real internal server addresses in
// UI placeholders — none of which any test could see.
//
// This suite is the guard. It is deliberately PATTERN-based rather than a list
// of forbidden names: a denylist of real client names would itself put those
// names in the repository, which is the very thing being prevented.
//
// If this fails, do not add your value to an allowlist because it is "fine".
// Use a documentation-reserved placeholder instead:
//   hosts  example.com / example.org / example.net / *.test  (RFC 2606)
//   IPv4   192.0.2.x / 198.51.100.x / 203.0.113.x            (RFC 5737)
//          or an obviously fake private address like 10.0.0.x
//   email  anything @example.com or @*.test
//
// Run:  node test/no-real-data-smoke.js
// ─────────────────────────────────────────────────────────────────────────────

require('./test-bootstrap');

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const results = [];
function check(name, pass, details) { results.push({ name, pass, details }); }

// Files git actually tracks, minus vendored code and generated lockfiles.
function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter(Boolean).filter((f) => {
    if (f.startsWith('renderer/vendor/')) return false;   // third-party, shipped verbatim
    if (f === 'package-lock.json') return false;          // npm-generated
    if (f === 'test/no-real-data-smoke.js') return false; // this file documents the patterns
    if (!/\.(js|html|css|json|md|yml|svg|txt)$/i.test(f)) return false;
    // ls-files still lists a tracked file that has been deleted but not yet
    // committed, so confirm it is actually on disk before reading it.
    return fs.existsSync(path.join(root, f));
  });
}

// Hosts that are documentation placeholders, standards bodies, or this project's
// own toolchain. Everything else in a URL is treated as suspicious.
const HOST_ALLOW = [
  /^(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$/i,
  /^(?:[a-z0-9-]+\.)*[a-z0-9-]+\.test$/i,
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /^(?:www\.)?w3\.org$/i,
  /^schemas\.openxmlformats\.org$/i,
  /^purl\.org$/i,
  /^(?:docs\.|www\.)?github\.com$/i,
  /^(?:www\.)?nodejs\.org$/i,
  /^(?:www\.)?electronjs\.org$/i,
  /^(?:www\.)?npmjs\.com$/i,
  /^(?:fonts\.googleapis\.com|fonts\.gstatic\.com)$/i,
  /^(?:www\.)?sqlite\.org$/i,
  /^cyclonedx\.org$/i,
  /^spdx\.org$/i,
  /^(?:www\.)?opensource\.org$/i,
];

// Obviously-fake private addresses used as UI placeholders and fixtures.
const IP_ALLOW = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,       // RFC 1918, used as fake examples here
  /^127\.0\.0\.1$/,
  /^0\.0\.0\.0$/,
  /^192\.0\.2\.\d{1,3}$/,                  // RFC 5737 TEST-NET-1
  /^198\.51\.100\.\d{1,3}$/,               // TEST-NET-2
  /^203\.0\.113\.\d{1,3}$/,                // TEST-NET-3
  /^255\.255\.255\.255$/,
];

const EMAIL_ALLOW = [
  /@(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$/i,
  /@(?:[a-z0-9-]+\.)*[a-z0-9-]+\.test$/i,
  /@users\.noreply\.github\.com$/i,
  /@anthropic\.com$/i,
];

const allowed = (value, list) => list.some((re) => re.test(value));

const files = trackedFiles();
check('found tracked source files to scan', files.length > 0, files.length + ' file(s)');

const badHosts = [], badIps = [], badEmails = [];

for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    const where = rel + ':' + (i + 1);

    for (const m of line.matchAll(/\bhttps?:\/\/([A-Za-z0-9._-]+)/g)) {
      const host = m[1];
      if (host === '...' || allowed(host, HOST_ALLOW) || allowed(host, IP_ALLOW)) continue;
      badHosts.push(where + '  ' + m[0]);
    }

    for (const m of line.matchAll(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g)) {
      const ip = m[1];
      // Not every dotted quad is an address — SVG path data and version strings
      // produce them too. Only judge things that are actually valid IPv4.
      if (ip.split('.').some((o) => Number(o) > 255 || /^0\d/.test(o))) continue;
      if (allowed(ip, IP_ALLOW)) continue;
      badIps.push(where + '  ' + ip);
    }

    for (const m of line.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g)) {
      if (allowed(m[0], EMAIL_ALLOW)) continue;
      badEmails.push(where + '  ' + m[0]);
    }
  });
}

check('no real hostnames in source — use example.com or *.test',
  badHosts.length === 0, badHosts.slice(0, 10).join(' | '));
check('no real IP addresses in source — use 10.x or an RFC 5737 range',
  badIps.length === 0, badIps.slice(0, 10).join(' | '));
check('no real email addresses in source — use *.test or example.com',
  badEmails.length === 0, badEmails.slice(0, 10).join(' | '));

let failed = 0;
for (const r of results) {
  console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.details ? '  (' + r.details + ')' : ''));
  if (!r.pass) failed++;
}
console.log('\n' + (results.length - failed) + '/' + results.length + ' real-data gates passed.');
process.exit(failed ? 1 : 0);
