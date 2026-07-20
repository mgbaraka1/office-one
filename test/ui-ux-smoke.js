'use strict';

// Static renderer regression gates for the UI/UX consolidation program.
// This test never opens Electron or a database; it verifies that the shared
// accessibility, responsive, navigation, and fast-entry affordances remain in
// the shipped renderer file.
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const results = [];
function gate(name, pass) { results.push({ name, pass: !!pass }); }
function count(pattern) { return (html.match(pattern) || []).length; }

const totals = html.match(/<div id="totals-bar">([\s\S]*?)<\/div>\s*\n\s*<!-- Filter bar -->/)?.[1] || '';
gate('compact daily summary has exactly three visible stat cards', (totals.match(/class="total-chip/g) || []).length === 3);
gate('responsive Timesheet forces grouped mode at narrow widths', html.includes('const tsNarrow = () => window.innerWidth <= 1100') && html.includes("const grouped = tsNarrow() || tsView === 'grouped'"));
gate('session defaults are persisted in per-user UI state', html.includes('sessionDefaults: {}') && html.includes('rememberSessionDefaults(payload.time, payload.natural)'));
gate('both session forms expose quick duration presets', count(/data-duration-for="(?:f|sm)-minutes"/g) === 2 && count(/class="duration-preset"/g) === 10);
gate('Repeat Last is available from the Timesheet top bar', html.includes('id="btn-repeat-last"') && html.includes('function repeatLastSession()'));
gate('Task Detail can add, edit, and remove structured sources inline',
  html.includes('function renderTaskDetailSourcesEditor(task, host)')
  && html.includes("addTaskSourceRow('td-sources-list')")
  && html.includes("saveTaskSources(task.id, readTaskSourceRows('td-sources-list'), originalIds)"));
gate('Edit Record is session-only and writes the work log directly',
  html.includes('#modal.mode-edit .modal-taskfields { display: none !important; }')
  && html.includes("modal.classList.add('mode-edit')")
  && html.includes('if (merged.eid) await window.api.updateWorkLog(merged.eid, tsLogPayload(merged));'));
gate('Daily Work Report titles tasks as COMPANY - PROJECT/SYSTEM - TASK without a duplicate prefix',
  html.includes("const reportTaskTitle = [companyTitle, projectTitle, taskTitle].filter(Boolean).join(' - ')")
  && html.includes('taskTitle.slice(existingPrefix.length)'));

gate('primary action teal meets the intended high-contrast token', html.includes('--primary: #0f766e;'));
gate('modal close buttons receive a generated accessible name', html.includes("el.classList.contains('modal-close') && !el.title") && html.includes("el.title = 'Close dialog'"));
gate('segmented controls and navigation expose state', html.includes("setAttribute('aria-pressed'") && html.includes("setAttribute('aria-current', 'page')"));
gate('field validation exposes aria-invalid and readable messages', html.includes("setAttribute('aria-invalid', 'true')") && html.includes('field-error-message'));
gate('shortcut suppression covers all current modal overlays', html.includes("'.modal-overlay.open, #print-overlay.open, #palette-overlay.open, #shortcuts-overlay.open, #howthinks-overlay.open'"));

gate('sidebar consolidates All and Department tasks under one destination', html.includes('data-modules="all-tasks internal-tasks"'));
gate('sidebar shows the signed-in identity, explicit role, and runtime app version',
  html.includes('id="sidebar-user-avatar"')
  && html.includes("user?.isAdmin ? 'Administrator' : 'Standard User'")
  && html.includes('await window.api.appVersion()')
  && html.includes('id="app-version"'));
gate('advanced Browse destinations remain available in the command palette', html.includes("label: 'Browse — Companies'") && html.includes("label: 'Browse — Systems'"));
gate('Client detail has Overview, Projects, Access, Servers, and Systems tabs', ['overview', 'projects', 'auth', 'servers', 'internal'].every(key => html.includes(`{ key: '${key}'`)) && html.includes('function renderClientOverview('));
gate('Settings has search and context-specific save actions', html.includes('id="settings-search"') && html.includes('function syncSettingsSaveButton('));
gate('account controls live on a dedicated User Management page',
  html.includes('data-tab="users"')
  && html.includes('id="user-list"')
  && html.includes('id="user-edit-role"')
  && html.includes('function renderUserManagement()')
  && !html.includes('id="setting-default-name"')
  && !html.includes('<h3>Account Security</h3>')
  && !html.includes('<h3>Add Account</h3>'));
gate('Analytics offers accessible data tables and labelled SVG charts', html.includes('class="an-data-details"') && html.includes('role="img" aria-label="Daily hours trend'));
gate('Project Categories UI is retired', !html.includes('id="p-category"')
  && !html.includes('Project Category</button>')
  && !html.includes('Hours by Project Category'));

const ids = ['dash-attention', 'an-spend', 'total-min', 'total-ot-min', 'settings-save-btn', 'settings-search'];
gate('key UI hosts remain unique', ids.every(id => count(new RegExp(`id="${id}"`, 'g')) === 1));

let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} UI/UX gates passed.`);
if (failed) process.exit(1);
