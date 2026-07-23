'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { hasContract, validateIpcArgs, validDate } = require('../ipc-contracts');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const mainChannels = [...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(match => match[1]);
const preloadChannels = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match => match[1]);

const results = [];
function gate(name, pass, detail = '') {
  results.push({ name, pass, detail });
}
function rejects(name, fn) {
  let rejected = false;
  try { fn(); } catch { rejected = true; }
  gate(name, rejected);
}

gate('Every main-process IPC channel has an executable argument contract',
  mainChannels.length > 100 && mainChannels.every(hasContract),
  mainChannels.filter(channel => !hasContract(channel)).join(', '));
gate('Preload and main process expose the same invoke channel set',
  mainChannels.length === preloadChannels.length
    && mainChannels.every(channel => preloadChannels.includes(channel)),
  `main=${mainChannels.length} preload=${preloadChannels.length}`);
gate('No-argument contracts accept an empty argument list',
  validateIpcArgs('tasks:index', []) === true);
rejects('No-argument contracts reject unexpected values',
  () => validateIpcArgs('tasks:index', [1]));
gate('Typed contracts accept a representative valid write',
  validateIpcArgs('worklogs:add', [1, { date: '2026-07-23', minutes: 30 }]) === true);
rejects('Typed contracts reject invalid identifiers',
  () => validateIpcArgs('worklogs:add', [0, {}]));
rejects('Typed contracts reject impossible calendar dates',
  () => validateIpcArgs('worklogs:byDate', ['2026-02-30']));
gate('Date validation accepts a real leap day and rejects a fake one',
  validDate('2024-02-29') && !validDate('2025-02-29'));
rejects('Contracts reject prototype-shaped unsafe fields',
  () => validateIpcArgs('tasks:create', [{ constructor: { polluted: true } }]));
rejects('Contracts reject unregistered channels',
  () => validateIpcArgs('unknown:channel', []));
rejects('Reports are bounded to 10 MB',
  () => validateIpcArgs('report:print', ['x'.repeat(10 * 1024 * 1024 + 1)]));

let failed = 0;
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` (${result.detail})` : ''}`);
  if (!result.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} IPC contract gates passed.`);
if (failed) process.exit(1);
