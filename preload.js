// Renderer-facing API façade. Each `window.api.*` method invokes a scoped IPC
// channel (`domain:action`) handled in main.js. The façade method names are kept
// stable (JS identifiers); the wire-level channel strings are the scoped names.
// Request/response shapes are documented in ipc-types.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── Authentication ──
  /** @returns {Promise<import('./ipc-types').AuthStatus>} */
  authStatus:      ()                 => ipcRenderer.invoke('auth:status'),
  /** @returns {Promise<import('./ipc-types').AuthResult>} */
  authSetup:       (username, pass)   => ipcRenderer.invoke('auth:setup', username, pass),
  /** @returns {Promise<import('./ipc-types').AuthResult>} */
  authLogin:       (username, pass)   => ipcRenderer.invoke('auth:login', username, pass),
  authLogout:      ()                 => ipcRenderer.invoke('auth:logout'),
  /** @returns {Promise<import('./ipc-types').AuthUser|null>} */
  authCurrentUser: ()                 => ipcRenderer.invoke('auth:currentUser'),

  // ── Days + entries ──
  /** @returns {Promise<import('./ipc-types').SaveDayResult>} */
  saveDay:        (dateStr, data) => ipcRenderer.invoke('day:save', dateStr, data),
  /** @returns {Promise<import('./ipc-types').DayData|null>} */
  loadDay:        (dateStr)       => ipcRenderer.invoke('day:get', dateStr),
  /** @returns {Promise<string[]>} */
  listDays:       ()              => ipcRenderer.invoke('days:list'),
  /** @returns {Promise<import('./ipc-types').DayInRange[]>} */
  loadDaysRange:  (from, to)      => ipcRenderer.invoke('days:range', from, to),

  // ── Companies / Systems (read-only views over day_entries) ──
  /** @returns {Promise<import('./ipc-types').CategoryValue[]>} */
  listCompanies:  ()        => ipcRenderer.invoke('companies:list'),
  /** @returns {Promise<import('./ipc-types').CategoryEntry[]>} */
  companyEntries: (name)    => ipcRenderer.invoke('companies:entries', name),
  /** @returns {Promise<import('./ipc-types').CategoryValue[]>} */
  listSystems:    ()        => ipcRenderer.invoke('systems:list'),
  /** @returns {Promise<import('./ipc-types').CategoryEntry[]>} */
  systemEntries:  (name)    => ipcRenderer.invoke('systems:entries', name),

  // ── Analytics (aggregated in SQL) ──
  /** @returns {Promise<import('./ipc-types').AnalyticsSummary>} */
  loadAnalytics:  (from, to, spanFrom, spanTo) => ipcRenderer.invoke('analytics:summary', from, to, spanFrom, spanTo),
  /** @returns {Promise<import('./ipc-types').OverviewStats>} */
  loadOverviewStats: (today, monthStart)       => ipcRenderer.invoke('analytics:overview', today, monthStart),

  // ── Lookups (normalized catalog — shared app config) ──
  /** @returns {Promise<import('./ipc-types').Lookups>} */
  loadLookups:    ()              => ipcRenderer.invoke('lookups:get'),
  /** @returns {Promise<import('./ipc-types').LookupOption[]>} */
  getLookupsByCategory: (category, includeInactive) => ipcRenderer.invoke('lookups:getByCategory', category, includeInactive),
  saveLookups:    (data)          => ipcRenderer.invoke('lookups:save', data),

  // ── Subscriptions ──
  /** @returns {Promise<import('./ipc-types').SubscriptionsPayload>} */
  loadSubscriptions: ()           => ipcRenderer.invoke('subscriptions:list'),
  saveSubscriptions: (data)       => ipcRenderer.invoke('subscriptions:save', data),

  // ── Backlog ("Not Yet" pool) ──
  /** @returns {Promise<import('./ipc-types').BacklogPayload>} */
  loadBacklog:    ()              => ipcRenderer.invoke('backlog:list'),
  saveBacklog:    (data)          => ipcRenderer.invoke('backlog:save', data),

  // ── Projects (container for tasks + tracked documents) ──
  /** @returns {Promise<import('./ipc-types').Project>} */
  createProject:  (data)          => ipcRenderer.invoke('projects:create', data),
  /** @returns {Promise<import('./ipc-types').ProjectListItem[]>} */
  listProjects:   ()              => ipcRenderer.invoke('projects:list'),
  /** @returns {Promise<import('./ipc-types').Project|null>} */
  getProject:     (id)            => ipcRenderer.invoke('projects:get', id),
  /** @returns {Promise<import('./ipc-types').Project|null>} */
  updateProject:  (id, data)      => ipcRenderer.invoke('projects:update', id, data),
  deleteProject:  (id)            => ipcRenderer.invoke('projects:delete', id),
  linkProjectTask:   (projectId, kind, taskId) => ipcRenderer.invoke('projects:link-task', projectId, kind, taskId),
  unlinkProjectTask: (kind, taskId)            => ipcRenderer.invoke('projects:unlink-task', kind, taskId),
  /** @returns {Promise<import('./ipc-types').LinkableTasks>} */
  listLinkableTasks: ()           => ipcRenderer.invoke('projects:linkable-tasks'),

  // ── Project document files (bytes on disk under userData) ──
  /** @returns {Promise<import('./ipc-types').DocFileResult>} */
  uploadProjectDocument:   (projectId, documentType) => ipcRenderer.invoke('projects:upload-document', projectId, documentType),
  /** Replace = upload again; the prior file is removed server-side on conflict. */
  /** @returns {Promise<import('./ipc-types').DocFileResult>} */
  replaceProjectDocument:  (projectId, documentType) => ipcRenderer.invoke('projects:upload-document', projectId, documentType),
  /** @returns {Promise<import('./ipc-types').FileResult>} */
  downloadProjectDocument: (projectId, documentType) => ipcRenderer.invoke('projects:download-document', projectId, documentType),
  openProjectDocument:     (projectId, documentType) => ipcRenderer.invoke('projects:open-document', projectId, documentType),
  /** @returns {Promise<import('./ipc-types').DocFileResult>} */
  removeProjectDocument:   (projectId, documentType) => ipcRenderer.invoke('projects:remove-document', projectId, documentType),
  purgeProjectFiles:       (projectId)               => ipcRenderer.invoke('projects:purge-files', projectId),
  restoreProjectFiles:     (oldId, newId, docs)      => ipcRenderer.invoke('projects:restore-files', oldId, newId, docs),

  // ── Backup / reports / window / shell ──
  /** @returns {Promise<import('./ipc-types').FileResult>} */
  backupDatabase:    ()           => ipcRenderer.invoke('db:backup'),
  /** @returns {Promise<import('./ipc-types').ProjectsBackupResult>} */
  backupProjects:    ()           => ipcRenderer.invoke('projects:backup'),
  /** @returns {Promise<import('./ipc-types').FileResult>} */
  exportPDF:         (html, name) => ipcRenderer.invoke('report:exportPDF', html, name),
  flushComplete:     ()           => ipcRenderer.invoke('app:flushComplete'),
  onBeforeClose:  (cb)            => ipcRenderer.on('app:beforeClose', () => cb()),
  setTitle:       (title)         => ipcRenderer.invoke('window:setTitle', title),
  openExternal:   (url)           => ipcRenderer.invoke('shell:openExternal', url),
});
