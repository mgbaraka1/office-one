'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Systems wheel (Clients → Systems wheel) — headless smoke test.
//
// Loads renderer/features/systems-wheel.js into a bare VM context and checks
// systemsWheelPlacement.
//
// Run:  node test/systems-wheel-smoke.js
//
// Covers: clients sit on the left half and systems on the right; each side
// runs top to bottom in the order given (so the web's crossing-minimised order
// carries over); every node gets its own angle; a small wheel still spaces
// nodes as if there were twelve.
// ─────────────────────────────────────────────────────────────────────────────
const fs   = require('node:fs');
const path = require('node:path');
const vm   = require('node:vm');

const results = [];
function record(flow, pass, details = '') { results.push({ flow, pass, details }); }

try {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'features', 'systems-wheel.js'), 'utf8'), ctx);
  const place = vm.runInContext('systemsWheelPlacement', ctx);

  const { step, clients, systems } = place([11, 12, 13, 14], [21, 22, 23]);
  const height = deg => Math.cos(deg * Math.PI / 180);   // 1 = top, -1 = bottom
  const side = deg => Math.sin(deg * Math.PI / 180);     // > 0 = right

  record('Clients are on the left half, systems on the right',
    clients.every(c => side(c.angle) < 0) && systems.every(s => side(s.angle) > 0),
    JSON.stringify({ clients, systems }));

  const descending = list => list.every((n, i) => i === 0 || height(n.angle) < height(list[i - 1].angle));
  record('Each side runs top to bottom in the order given', descending(clients) && descending(systems),
    JSON.stringify({ clients, systems }));

  record('Ids come back in the order given',
    clients.map(c => c.id).join() === '11,12,13,14' && systems.map(s => s.id).join() === '21,22,23');

  const angles = [...clients, ...systems].map(n => n.angle.toFixed(3));
  record('Every node has its own angle', new Set(angles).size === angles.length, angles.join(','));

  record('A small wheel spaces nodes as if there were twelve', Math.abs(step - 30) < 1e-9, String(step));

  const big = place(Array.from({ length: 20 }, (_, i) => i), Array.from({ length: 18 }, (_, i) => 100 + i));
  record('A larger wheel shares the circle between both sides', Math.abs(big.step - 360 / 40) < 1e-9, String(big.step));
} catch (err) {
  record('Unexpected error', false, err.stack || String(err));
}

let exitCode = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.flow}${r.pass ? '' : '\n      ' + r.details}`);
  if (!r.pass) exitCode = 1;
}
if (!results.length) exitCode = 1;
process.exit(exitCode);
