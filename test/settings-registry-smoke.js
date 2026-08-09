'use strict';

// Phase 2 of SETTINGS_REFACTOR_PLAN.md (S1/S2): the Settings catalog tab set
// used to be hand-maintained independently in five places and had already
// drifted — CURRENCY/BILLING_CYCLE had no editor, and the command palette
// could not reach Maintenance. renderer/settings-registry.js is now the one
// place the renderer defines that set; LK_CAT/LK_VALUE/SETTINGS_TABS/
// LOOKUP_MERGE_CATEGORIES/PAL_SETTINGS_TABS all derive from it. This test is
// the guard against it drifting again: from db.js's own category/merge lists
// (which the registry can't see — different process) and from the
// hand-authored tab buttons/panels in index.html (which aren't generated).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const db = require('../db');

require('./test-bootstrap');

const root = path.join(__dirname, '..');
// A `const` declared inside a vm-run script doesn't attach to the context
// object (only `var`/functions do) — so the script's completion value (its
// last expression) is used to hand the array back out instead.
const registrySource = fs.readFileSync(path.join(root, 'renderer', 'settings-registry.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
const registry = vm.runInContext(registrySource + '\n;SETTINGS_CATALOG_TABS;', sandbox);

let failed = false;
function check(name, pass, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failed = true;
}

try {
  check('the registry loads and is a non-empty array', Array.isArray(registry) && registry.length > 0);

  const registryCategories = new Set(registry.map(t => t.category));
  const dbCategories = new Set(db.LOOKUP_CATEGORIES);
  const missingFromRegistry = [...dbCategories].filter(c => !registryCategories.has(c));
  const extraInRegistry = [...registryCategories].filter(c => !dbCategories.has(c));
  check('every db.js LOOKUP_CATEGORIES entry has a registry entry',
    missingFromRegistry.length === 0, `missing=${JSON.stringify(missingFromRegistry)}`);
  check('the registry has no category db.js does not recognize',
    extraInRegistry.length === 0, `extra=${JSON.stringify(extraInRegistry)}`);

  const registryMergeable = new Set(registry.filter(t => t.mergeable).map(t => t.category));
  const dbMergeable = new Set(Object.keys(db.LOOKUP_MERGE_TARGETS));
  const mergeableMatches = registryMergeable.size === dbMergeable.size
    && [...registryMergeable].every(c => dbMergeable.has(c));
  check('the registry\'s mergeable categories match db.js LOOKUP_MERGE_TARGETS', mergeableMatches,
    `registry=${JSON.stringify([...registryMergeable])} db=${JSON.stringify([...dbMergeable])}`);

  const keys = new Set();
  for (const entry of registry) {
    check(`registry entry for ${entry.category} has a unique key`, !keys.has(entry.key), entry.key);
    keys.add(entry.key);
    check(`registry entry for ${entry.category} has all required fields`,
      typeof entry.key === 'string' && typeof entry.label === 'string'
        && (entry.valueField === 'code' || entry.valueField === 'label')
        && (entry.editor === 'lookup' || entry.editor === 'company'));
  }

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const entry of registry) {
    const hasButton = html.includes(`data-tab="${entry.key}"`);
    const hasPanel = html.includes(`id="tab-${entry.key}"`);
    check(`index.html has a tab button and panel for "${entry.key}"`, hasButton && hasPanel,
      `button=${hasButton} panel=${hasPanel}`);
  }

  const shellSource = fs.readFileSync(path.join(root, 'renderer', 'features', 'shell.js'), 'utf8');
  check('the command palette derives its catalog entries from the registry (not a hand-copied list)',
    shellSource.includes('...SETTINGS_CATALOG_TABS.map(t => ({ key: t.key, label: t.label }))'));
  check('the command palette can reach Maintenance', shellSource.includes("{ key: 'maintenance', label: 'Maintenance' }"));
} catch (error) {
  console.error(error);
  failed = true;
}

if (failed) process.exit(1);
