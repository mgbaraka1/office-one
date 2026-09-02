'use strict';

// The Settings catalog tab set
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
        && (entry.editor === 'lookup' || entry.editor === 'external'));
  }

  // `settingsTab: false` = the category has no Settings panel because it is
  // managed elsewhere in the app. The registry entry still has to exist (LK_CAT
  // and LOOKUP_MERGE_CATEGORIES both derive from this array), so the tab/panel
  // check below skips it — but nothing else about the entry may go missing.
  const externallyManaged = registry.filter(t => t.settingsTab === false);
  check('every externally-managed entry declares editor: "external"',
    externallyManaged.every(t => t.editor === 'external'),
    `keys=${JSON.stringify(externallyManaged.map(t => t.key))}`);
  // Two groups are externally managed today, and each needs its registry entry
  // for a different reason:
  //   • COMPANY  — the roster IS this catalog and it is managed on the Clients
  //     page, but it is still a real lookup category and still merge-eligible
  //     from Maintenance. Both are why the entry could not simply be deleted.
  //   • The four Finance categories — folded into lookup_codes by migration 060,
  //     but edited in Settings → Finance rather than gaining four shared tabs.
  // Anything else appearing here is a drift worth failing on.
  const EXPECTED_EXTERNAL = ['COMPANY', 'CONTRACT_STATUS', 'CR_STATUS', 'INVOICE_STATUS', 'PAYMENT_METHOD'];
  check('exactly the known categories are externally managed',
    JSON.stringify(externallyManaged.map(t => t.category).sort()) === JSON.stringify([...EXPECTED_EXTERNAL].sort()),
    `externallyManaged=${JSON.stringify(externallyManaged.map(t => t.category))}`);
  check('COMPANY is externally managed (the Clients page owns the roster)',
    externallyManaged.some(t => t.category === 'COMPANY'),
    `externallyManaged=${JSON.stringify(externallyManaged.map(t => t.category))}`);
  check('COMPANY is still a db.js lookup category', dbCategories.has('COMPANY'));
  check('COMPANY is still merge-eligible from Maintenance', dbMergeable.has('COMPANY'));

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const entry of registry) {
    const hasButton = html.includes(`data-tab="${entry.key}"`);
    const hasPanel = html.includes(`id="tab-${entry.key}"`);
    if (entry.settingsTab === false) {
      check(`index.html has NO tab button or panel for externally-managed "${entry.key}"`,
        !hasButton && !hasPanel, `button=${hasButton} panel=${hasPanel}`);
      continue;
    }
    check(`index.html has a tab button and panel for "${entry.key}"`, hasButton && hasPanel,
      `button=${hasButton} panel=${hasPanel}`);
  }

  const shellSource = fs.readFileSync(path.join(root, 'renderer', 'features', 'shell.js'), 'utf8');
  check('the command palette derives its catalog entries from the registry (not a hand-copied list)',
    shellSource.includes(".filter(t => t.settingsTab !== false).map(t => ({ key: t.key, label: t.label }))"));
  check('the command palette can reach Maintenance', shellSource.includes("{ key: 'maintenance', label: 'Maintenance' }"));
  const coreSource = fs.readFileSync(path.join(root, 'renderer', 'core.js'), 'utf8');
  check('SETTINGS_TABS omits externally-managed categories',
    coreSource.includes('SETTINGS_CATALOG_TABS.filter(t => t.settingsTab !== false).map(t => t.key)'));
} catch (error) {
  console.error(error);
  failed = true;
}

if (failed) process.exit(1);
