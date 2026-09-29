'use strict';

// Static renderer regression gates for the UI/UX consolidation program.
// This test never opens Electron or a database; it verifies that the shared
// accessibility, responsive, navigation, and fast-entry affordances remain in
// the shipped renderer file.
const fs = require('node:fs');
const path = require('node:path');

const html = [
  fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', 'renderer', 'bootstrap.js'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.css'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core.js'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', 'renderer', 'settings-registry.js'), 'utf8'),
  ...['timesheet', 'workspace', 'tasks', 'knowledge', 'company-documents', 'clients', 'shell']
    .map(name => fs.readFileSync(path.join(__dirname, '..', 'renderer', 'features', name + '.js'), 'utf8')),
].join('\n');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const auth = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'i18n.js'), 'utf8');
const results = [];
function gate(name, pass) { results.push({ name, pass: !!pass }); }
function count(pattern) { return (html.match(pattern) || []).length; }

const totals = html.match(/<div id="totals-bar">([\s\S]*?)<\/div>\s*\n\s*<!-- Filter bar -->/)?.[1] || '';
const workspaceViewCode = html.match(/const WORKSPACE_VIEW_DEFAULTS([\s\S]*?)function applySidebarPreference/)?.[1] || '';
gate('compact daily summary has exactly three visible stat cards', (totals.match(/class="total-chip/g) || []).length === 3);
gate('responsive Timesheet forces grouped mode at narrow widths', html.includes('const tsNarrow = () => window.innerWidth <= 1100') && html.includes("const grouped = tsNarrow() || tsView === 'grouped'"));
gate('session defaults are persisted in per-user UI state', html.includes('sessionDefaults: {}') && html.includes('rememberSessionDefaults(payload.time, payload.natural)'));
gate('both session forms expose quick duration presets', count(/data-duration-for="(?:f|sm)-minutes"/g) === 2 && count(/class="duration-preset"/g) === 10);
gate('Repeat Last is available from the Timesheet top bar', html.includes('id="btn-repeat-last"') && html.includes('function repeatLastSession()'));
gate('Task Detail can add, edit, and remove structured sources inline',
  html.includes('function renderTaskDetailSourcesEditor(task, host)')
  && html.includes("addTaskSourceRow('td-sources-list')")
  && html.includes("saveTaskSources(task.id, readTaskSourceRows('td-sources-list'), originalIds)"));
gate('Task Detail surfaces its metadata audit history',
  html.includes('function openTaskHistoryModal(taskId, title)')
  && html.includes('getTaskHistory(taskId)')
  && html.includes('View task history'));
gate('client credentials use timed reveal and clipboard auto-clear',
  html.includes('function buildClientSecretControl(label, value, unreadable)')
  && html.includes('clipboard clears in 30 seconds')
  && main.includes("ipcMain.handle('security:copySecret'")
  && preload.includes('copySecret: (value)'));
gate('Edit Record is session-only and writes the work log directly',
  html.includes('#modal.mode-edit .modal-taskfields { display: none !important; }')
  && html.includes("modal.classList.add('mode-edit')")
  && html.includes('if (merged.eid) await window.api.updateWorkLog(merged.eid, tsLogPayload(merged));'));
gate('Daily Work Report titles tasks as COMPANY - PROJECT/SYSTEM - TASK without a duplicate prefix',
  html.includes("const reportTaskTitle = [companyTitle, projectTitle, taskTitle].filter(Boolean).join(' - ')")
  && html.includes('taskTitle.slice(existingPrefix.length)'));
gate('report previews export accessible CSV data as well as PDF',
  html.includes('function reportPreviewToCSV()')
  && html.includes('function exportReportCSV()')
  && main.includes("ipcMain.handle('report:exportCSV'")
  && preload.includes('exportCSV:'));

gate('primary action color meets the high-contrast workspace token', html.includes('--primary: #C96442;'));
gate('modal close buttons receive a generated accessible name', html.includes("el.classList.contains('modal-close') && !el.title") && html.includes("el.title = 'Close dialog'"));
gate('segmented controls and navigation expose state', html.includes("setAttribute('aria-pressed'") && html.includes("setAttribute('aria-current', 'page')"));
gate('field validation exposes aria-invalid and readable messages', html.includes("setAttribute('aria-invalid', 'true')") && html.includes('field-error-message'));
gate('shortcut suppression covers all current modal overlays', html.includes("'.modal-overlay.open, #print-overlay.open, #palette-overlay.open, #shortcuts-overlay.open, #howthinks-overlay.open'"));

gate('sidebar exposes Tasks and Departments as separate destinations',
  html.includes('data-module="all-tasks" data-onclick="switchModule(\'all-tasks\')"')
  && html.includes('data-module="internal-tasks" data-onclick="switchModule(\'internal-tasks\')"'));
gate('sidebar shows the signed-in identity and runtime app version',
  html.includes('id="sidebar-user-avatar"')
  && html.includes('await window.api.appVersion()')
  && html.includes('id="app-version"'));
gate('Quick Find is visible, shortcut-labelled, and uses bounded SQLite full-text search',
  html.includes('class="sidebar-quickfind"')
  && html.includes('aria-keyshortcuts="Control+K"')
  && html.includes('id="palette-overlay" class="modal-overlay" aria-label="Quick Find"')
  && html.includes('window.api.searchWorkspace')
  && html.includes('requestPaletteWorkspace')
  && html.includes("listHost.setAttribute('aria-busy', 'true')")
  && html.includes("overlayEl.querySelector('.modal-box, #palette')"));
gate('precision workspace shell has a persistent user-controlled navigation rail',
  html.includes('id="sidebar-collapse"')
  && html.includes('function toggleSidebar()')
  && html.includes("localStorage.setItem('ct-sidebar-compact'")
  && html.includes('body.sidebar-collapsed #sidebar')
  && html.includes('VISION 2026 — PRECISION WORKSPACE')
  && html.includes(`data-module="clients" data-onclick="switchModule('clients')" title="Clients"`));
// The universal Create Hub was removed: creation starts on the page that owns
// the record. Ctrl+N stays the context-aware "new" for the active module, so
// every module that can create something must still name its own opener here
// rather than falling back to a shared launcher.
gate('creation starts on its own page, with no universal Create Hub',
  !html.includes('create-hub')
  && !html.includes('openCreateHub')
  && !html.includes('runCreateFlow')
  && !html.includes(`class="sidebar-create"`)
  && !html.includes("e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n'")
  && html.includes("else if (activeModule === 'all-tasks')     openBacklogModal();")
  && html.includes("else if (activeModule === 'internal-tasks') openInternalTaskModal();"));
gate('primary workspace headers use concise direct titles',
  html.includes('<span class="page-title"><span class="ti-ic" data-ic="clock"></span>Timesheet</span>')
  && html.includes('<span class="page-title"><span class="ti-ic" data-ic="layers"></span>Clients</span>')
  && html.includes('.page-title::after { display: none; }'));
gate('desktop header titles no longer reserve empty subtitle space',
  html.includes('.page-title {')
  && html.includes('min-width: auto;')
  && html.includes('padding-bottom: 0;'));
gate('page headers keep dropdowns above backdrop-filtered workspace cards',
  html.includes('position: relative; z-index: 50;')
  && html.includes('#cal-dropdown')
  && html.includes('z-index: 500;'));
gate('Overview is an active workflow launchpad, not only a reporting surface',
  html.includes('class="dash-launchpad" aria-label="Start a workflow"')
  && html.includes(`class="dash-launch primary" data-onclick="startWorkLogEntry()"`)
  && html.includes(`class="dash-launch" data-onclick="openPalette()"`));
gate('Calm Workspace exposes persistent eye-comfort controls without data APIs',
  html.includes('id="workspace-view-overlay"')
  && html.includes('id="workspace-view-btn"')
  && html.includes("localStorage.setItem('ct-workspace-view'")
  && ['density:compact', 'density:balanced', 'density:spacious', 'canvas:calm', 'canvas:structured', 'motion:gentle', 'motion:reduced']
    .every(choice => html.includes(`data-workspace-choice="${choice}"`))
  && !workspaceViewCode.includes('window.api.'));
gate('workspace preferences validate stored values and default to a calm balanced static view',
  html.includes("Object.freeze({ density: 'balanced', canvas: 'calm', motion: 'reduced' })")
  && html.includes("['compact','balanced','spacious'].includes(stored.density)")
  && html.includes("['calm','structured'].includes(stored.canvas)")
  && html.includes("['gentle','reduced'].includes(stored.motion)"));
gate('direct workspace removes decorative depth and keeps record actions visible',
  html.includes('DIRECT WORKSPACE')
  && html.includes('#main::before { display: none; }')
  && html.includes('.page-title::after { display: none; }')
  && html.includes('.row-actions,')
  && html.includes('No decorative movement')
  && html.includes('Quick actions')
  && html.includes('<span class="brand-full">Office ONE</span>'));
gate('Focus Mode is reversible, session-only, and keyboard accessible',
  html.includes('body.focus-mode #sidebar')
  && html.includes('id="focus-exit"')
  && html.includes('aria-keyshortcuts="Control+Shift+F"')
  && html.includes("e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f'")
  && html.includes("document.body.classList.toggle('focus-mode', enter)")
  && !workspaceViewCode.includes("localStorage.setItem('focus-mode'"));
gate('density and motion modes cover major work surfaces',
  html.includes('body[data-density="compact"] .page-header')
  && html.includes('body[data-density="spacious"] .page-header')
  && html.includes('body[data-density="compact"] .kh-row')
  && html.includes('body[data-density="spacious"] .cd-card')
  && html.includes('body.workspace-reduced-motion *'));
gate('hover-revealed actions remain visible to keyboard and touch users',
  html.includes('tbody tr:focus-within td .row-actions')
  && html.includes('.pj-card:focus .pj-card-open')
  && html.includes('@media (hover: none), (pointer: coarse)'));
gate('advanced Browse destinations remain available in the command palette', html.includes("label: 'Browse — Companies'") && html.includes("label: 'Browse — Systems'"));
gate('Client detail has Overview, Projects, Access, Servers, and Systems tabs', ['overview', 'projects', 'auth', 'servers', 'internal'].every(key => html.includes(`{ key: '${key}'`)) && html.includes('function renderClientOverview('));
gate('saving a new company invalidates the Clients roster so it appears automatically',
  html.includes('invalidateClientsCatalog();')
  && html.includes('function invalidateClientsCatalog()')
  && html.includes('clientsLoaded = false;'));
gate('a post-save catalog refresh failure does not falsely report that settings were not saved',
  html.includes('Saved — reopen the app to refresh')
  && html.includes('Settings saved; reopen the app to refresh catalogs'));
gate('Settings has search and context-specific save actions', html.includes('id="settings-search"') && html.includes('function syncSettingsSaveButton('));
gate('language can only be selected on the login page',
  count(/class="auth-language"/g) === 1
  && !html.includes('id="language-toggle"')
  && !html.includes('id="setting-language-ctl"')
  && !i18n.includes('window.setAppLanguage')
  && i18n.includes("if (typeof _appBooted !== 'undefined' && _appBooted) return;"));
gate('account controls live on a dedicated User Management page',
  html.includes('data-tab="users"')
  && html.includes('id="user-list"')
  && html.includes('id="user-edit-active"')
  && html.includes('function renderUserManagement()')
  && !html.includes('id="setting-default-name"')
  && !html.includes('<h3>Account Security</h3>')
  && !html.includes('<h3>Add Account</h3>'));
gate('Analytics offers accessible data tables and labelled SVG charts', html.includes('class="an-data-details"') && html.includes('role="img" aria-label="Daily hours trend'));

gate('there is no Finance page to navigate to',
  !html.includes('id="module-finance"')
  && !html.includes('id="finance-list-view"')
  && !html.includes('id="finance-clients-grid"')
  && !html.includes('id="finance-setup-host"')
  && !fs.existsSync(path.join(__dirname, '..', 'renderer', 'features', 'finance.js')));
// The admin/role concept was removed (FINANCE_INTEGRATION_PLAN.md §9): any
// authenticated account may perform any action, and shared-data changes are
// attributed rather than gated. This gate is what stops a role check quietly
// reappearing — the renderer must not branch on isAdmin anywhere, the role
// selector must stay gone, and auth.js must expose no requireAdmin().
// Matches property ACCESS (`.isAdmin`), not the bare word — the codebase still
// explains in comments why the role concept was removed, and a prose mention
// must not fail a gate about behaviour.
gate('the admin/role concept is retired from the renderer',
  !/[.?]isAdmin/.test(html)
  && !html.includes('id="user-edit-role"')
  && !html.includes("'Administrator'"));
gate('no IPC handler is gated on an administrator role',
  !main.includes('requireAdmin')
  && !/\badmin\(/.test(main)
  && !auth.includes('function requireAdmin'));
// users.is_admin stays as an inert column rather than being dropped — the
// never-delete rule applies to columns too.
gate('users.is_admin survives as an inert column',
  auth.includes('is_admin') && !auth.includes('session.isAdmin ?'));

gate('Project Categories UI is retired', !html.includes('id="p-category"')
  && !html.includes('Project Category</button>')
  && !html.includes('Hours by Project Category'));
gate('Knowledge Hub is a first-class searchable module with safe undo',
  html.includes('data-module="knowledge"')
  && html.includes('"book-open": "<path')
  && html.includes('id="module-knowledge"')
  && html.includes('function renderKnowledgeList()')
  && html.includes('function openKnowledgeDetail(id)')
  && html.includes('id="knowledge-undo-toast"')
  && html.includes("label: 'Knowledge Hub'"));
gate('HTML hidden state cannot be overridden by component display rules',
  html.includes('[hidden] { display: none !important; }')
  && html.includes('function showKnowledgeListView()')
  && html.includes('function showKnowledgeDetailView()'));
gate('Knowledge Hub is found by client and system, with tags kept as a secondary facet',
  html.includes("appendKnowledgeFilterSection(host, 'clients', 'Clients'")
  && html.includes("appendKnowledgeFilterSection(host, 'systems', 'Systems'")
  && html.includes('id="kh-companies"') && html.includes('id="kh-systems"')
  && html.includes('id="kh-more"')
  && html.includes("appendKnowledgeFilterSection(host, 'tags', 'Tags'")
  && html.includes("x.startsWith('TAG:')")
  && html.includes('id="kh-tag-tokens"')
  && !html.includes('id="kh-company-checks"')
  && !html.includes('id="kh-system-checks"')
  && !html.includes('id="kh-project-checks"'));
gate('Knowledge Hub groups and the Draft/Ready status are retired from the UI (Archive stays)',
  !html.includes('id="knowledge-group-modal-overlay"')
  && !html.includes('openKnowledgeGroupEditor')
  && !html.includes("x.startsWith('GROUP:')")
  && !html.includes('id="kh-status-input"')
  && html.includes("key === 'STATUS:ARCHIVED'")
  && html.includes("label: item.status === 'ARCHIVED' ? 'Restore from archive' : 'Archive'"));
gate('Knowledge editor keeps a link to a since-disabled client or system',
  html.includes('function buildKnowledgeLinkPicker(hostId, category, selectedIds, placeholder)')
  && html.includes('lkOptions(category, true).filter(o => o.isActive || selectedIds.includes(o.id))'));
gate('Knowledge Hub documents require a name and version',
  html.includes('id="knowledge-document-modal-overlay"')
  && html.includes('id="kh-document-version"')
  && html.includes('id="kh-document-names"')
  && html.includes('function submitKnowledgeDocument()')
  && html.includes('formatKnowledgeVersion(file.version)'));
gate('Knowledge Hub list reflects document-library usage',
  html.includes('<option value="documents">Most documents</option>')
  && html.includes('function knowledgeRowSubtitle(item, q')
  && html.includes('function knowledgeDocumentCount(item)')
  && html.includes("documentCount + ' document'"));
gate('Knowledge Hub keeps navigation and empty states focused',
  html.includes('filter(type => type.count || knowledgeFilters.has(type.key))')
  && html.includes('id="kh-empty-title"')
  && html.includes('id="kh-empty-clear"')
  && html.includes('function resetKnowledgeFilters()'));
gate('Knowledge detail is document-first and supports adding a new version',
  html.indexOf("const files = pjMk('section', 'kh-section')") < html.indexOf("if (item.content)")
  && html.includes('function buildKnowledgeDocumentFamily(item, files)')
  && html.includes("khButton('New version'")
  && html.includes('function openKnowledgeDocumentModal(itemId, documentName'));
gate('Knowledge item duplication creates stable numbered copy titles',
  html.includes('function nextKnowledgeCopyTitle(title)')
  && html.includes('while (used.has(candidate.toLowerCase()))'));
gate('Knowledge item delete replaces an older undo safely',
  html.includes('const previous = knowledgeUndo')
  && html.includes('purgeKnowledgeFiles(previous.oldId)'));
gate('Knowledge Hub notes are plain text (no rich editor), with safe links and recoverable drafts',
  html.includes('id="kh-notes-input"')
  && !html.includes('id="kh-content-editor"') && !html.includes('vendor/quill/')
  && html.includes("contentFormat: 'text'")
  && html.includes('function knowledgeNotesFromItem(data)')
  && html.includes('function renderKnowledgeContent(host, value, format)')
  && html.includes('knowledgeDraftCache = knowledgeEditorSnapshot()')
  && html.includes('function recoverKnowledgeDraft()'));
gate('Knowledge Hub supports combined accessible filters and highlighted search snippets',
  html.includes('let knowledgeFilters = new Set()')
  && html.includes('aria-label="Active filters"')
  && html.includes("b.setAttribute('aria-pressed'")
  && html.includes('function appendHighlightedText(host, text, q)'));
gate('Knowledge Hub keyboard shortcuts cover both dialogs',
  html.includes('closeKnowledgeEditor(); closeKnowledgeDocumentModal()')
  && html.includes("contains('open')) saveKnowledgeEditor()")
  && html.includes("contains('open')) submitKnowledgeDocument()"));
gate('Knowledge Hub creates items from one short form with an optional file',
  !html.includes('startKnowledgeCreation(')
  && html.includes('data-onclick="openKnowledgeEditor()"')
  && html.includes('id="kh-editor-drop"') && html.includes('id="kh-file-input"')
  && html.includes('function openKnowledgeEditor(item, file, preset)')
  && html.includes('window.api.uploadKnowledgeFile(saved.id, file, meta)'));
gate('Knowledge Hub takes dropped files: a matching name becomes the next version',
  html.includes('function setupKnowledgeFileDrop()')
  && html.includes('function handleKnowledgeDrop(file, toPanel)')
  && html.includes('function knowledgeFindItemForFile(fileName)')
  && html.includes('function knowledgeNextVersion(latest, used = [])')
  && html.includes('knowledgeSuggestVersion(family, file.name)'));
gate('Knowledge item detail opens as a side panel beside the list, with one-click Open on rows',
  html.includes('<section id="kh-detail-view" class="kh-panel"')
  && html.includes(".kh-shell.has-panel { grid-template-columns:")
  && html.includes('function buildKnowledgeRowOpen(families)')
  && html.includes("if (!anyOpen && activeModule === 'knowledge' && knowledgeCurrentId != null) closeKnowledgeDetail()"));
gate('A dropped or picked file reaches main only as a File, never as a page-supplied path',
  preload.includes('webUtils.getPathForFile(file)')
  && preload.includes("ipcRenderer.invoke('knowledge:upload-file', itemId, filePath, meta)")
  && main.includes("ipcMain.handle('knowledge:upload-file'")
  && !main.includes("'knowledge:upload-attachment'") && !preload.includes("'knowledge:upload-attachment'"));
gate('Each document version carries a "what changed" note, set on upload and editable later',
  html.includes('id="kh-document-note"')
  && html.includes('{ name, version, changeNote }')
  && html.includes('function buildKnowledgeChangeNote(file)')
  && html.includes('function editKnowledgeChangeNote(host, file)')
  && html.includes('x.originalName, x.changeNote]')
  && preload.includes("ipcRenderer.invoke('knowledge:update-attachment-note', attachmentId, note)")
  && main.includes("ipcMain.handle('knowledge:update-attachment-note'"));
gate('Client and project pages show their Knowledge Hub items, with a drop target and a pre-linked New item',
  html.includes("{ key: 'knowledge', label: 'Knowledge Hub' }")
  && html.includes("buildKnowledgeLinkedSection({ companyIds: [c.id], q,")
  && html.includes('systemIds: (p.systems || []).map(x => x.id)')
  && html.includes('function knowledgeItemsLinkedTo(companyIds = [], systemIds = [])')
  && html.includes('function handleKnowledgeLinkedDrop(file, opts)')
  && html.includes("openKnowledgeEditor(null, null, { companyIds, systemIds })")
  && html.includes('refreshKnowledgeLinkedSections();'));
gate('Knowledge Hub has no reference URL or review-date UI',
  !html.includes('id="kh-review-input"')
  && !html.includes('id="kh-link-editor"')
  && !html.includes('Reference links')
  && !html.includes('NEEDS_REVIEW'));
gate('Knowledge types are administrator-managed in Settings',
  html.includes('data-tab="knowledgeType"') && html.includes("category: 'KNOWLEDGE_TYPE'"));
gate('logout uses the same explicit save-failure recovery flow as window closing',
  html.includes("flushPendingWithRecovery('logout'")
  && html.includes("confirmSaveFailure(String(error?.message || error), action)")
  && !html.includes("try { await flushPending(); } catch { /* best effort */ }"));
gate('Maintenance exposes validated full-bundle restore with typed confirmation',
  html.includes('id="maint-fullrestore-btn"')
  && html.includes('function chooseFullBackupForRestore(btnId)')
  && html.includes('window.api.selectFullBackup()')
  && html.includes('window.api.restoreSelectedFullBackup(')
  && html.includes("input.value !== selected.name"));
// A backup whose credentials are sealed to one machine is not a backup of those
// credentials at all — restoring it elsewhere yields records that are intact and
// permanently unopenable. Both halves of the passphrase path must stay wired:
// the dialog that offers one on the way out, and the field that accepts one on
// the way back in.
gate('Full Backup can be made portable with a passphrase, and restore can unlock it',
  html.includes('id="backup-passphrase-overlay"')
  && html.includes('id="backup-passphrase-confirm"')
  && html.includes('function confirmBackupPassphrase()')
  && html.includes('window.api.fullBackup(passphrase')
  && html.includes('selected.credentialsPortable'));
// The regression that started all of this: a failed decrypt used to be rendered
// as the password. The reveal control must refuse to show anything at all when
// the value could not be read.
gate('an unreadable credential is reported, never rendered as the secret',
  html.includes('function buildClientSecretControl(label, value, unreadable)')
  && html.includes("if (unreadable) {")
  && html.includes('Cannot be read on this device')
  && html.includes('v.passwordUnreadable'));
gate('Maintenance exposes recovery readiness and Windows credential portability guidance',
  html.includes('id="maint-diagnostics-result"')
  && html.includes('window.api.getSystemDiagnostics()')
  && html.includes('Windows DPAPI'));

const ids = ['dash-attention', 'an-spend', 'total-min', 'total-ot-min', 'settings-save-btn', 'settings-search'];
gate('key UI hosts remain unique', ids.every(id => count(new RegExp(`id="${id}"`, 'g')) === 1));
gate('exactly one <main> landmark wraps every module, and a skip link targets it',
  count(/<main[ >]/g) === 1 && html.includes('<main id="main-content">')
  && html.includes('<a href="#main-content" class="skip-link">'));

let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} UI/UX gates passed.`);
if (failed) process.exit(1);
