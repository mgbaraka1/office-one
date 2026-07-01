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

  // ── Days ──
  // NB: day:save / day:get were retired in Phase C2 — the Timesheet now persists
  // work sessions granularly through tasks:* / worklogs:*. listDays/loadDaysRange
  // remain (calendar marks + range reads).
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

  // ── "Not Yet" pool ──
  // backlog:list / backlog:save retired in Phase C3 — a Not-Yet item is a task with
  // zero work_logs. List via tasks:notyet; mutate via createTask/updateTask/
  // deleteTask; "assign to day" adds a work_log.
  /** @returns {Promise<import('./ipc-types').NotYetTask[]>} */
  listNotYet:     ()              => ipcRenderer.invoke('tasks:notyet'),

  // ── Tasks (v2 two-level model — standalone, date-independent unit of work) ──
  /** @returns {Promise<import('./ipc-types').Task[]>} */
  listTasks:      ()              => ipcRenderer.invoke('tasks:list'),
  /** @returns {Promise<import('./ipc-types').Task|null>} */
  getTask:        (id)            => ipcRenderer.invoke('tasks:get', id),
  /** @returns {Promise<import('./ipc-types').Task>} */
  createTask:     (data)          => ipcRenderer.invoke('tasks:create', data),
  /** @returns {Promise<import('./ipc-types').Task|null>} */
  updateTask:     (id, data)      => ipcRenderer.invoke('tasks:update', id, data),
  deleteTask:     (id)            => ipcRenderer.invoke('tasks:delete', id),

  // ── Work logs (v2 — dated work sessions belonging to a task) ──
  /** @returns {Promise<import('./ipc-types').WorkLog[]>} */
  listWorkLogs:   (taskId)        => ipcRenderer.invoke('worklogs:byTask', taskId),
  /** @returns {Promise<import('./ipc-types').WorkLogOnDate[]>} */
  workLogsByDate: (date)          => ipcRenderer.invoke('worklogs:byDate', date),
  /** @returns {Promise<import('./ipc-types').WorkLogMutationResult>} */
  addWorkLog:     (taskId, data)  => ipcRenderer.invoke('worklogs:add', taskId, data),
  /** @returns {Promise<import('./ipc-types').WorkLogMutationResult>} */
  updateWorkLog:  (id, data)      => ipcRenderer.invoke('worklogs:update', id, data),
  /** @returns {Promise<import('./ipc-types').WorkLogMutationResult>} */
  deleteWorkLog:  (id)            => ipcRenderer.invoke('worklogs:delete', id),
  /** Per-date employee name (days metadata) — non-destructive; no work sessions touched. */
  setDayName:     (date, name)    => ipcRenderer.invoke('day:setName', date, name),
  /** @returns {Promise<string>} */
  getDayName:     (date)          => ipcRenderer.invoke('day:getName', date),

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
  linkProjectTask:   (projectId, taskId) => ipcRenderer.invoke('projects:link-task', projectId, taskId),
  unlinkProjectTask: (taskId)            => ipcRenderer.invoke('projects:unlink-task', taskId),
  /** @returns {Promise<import('./ipc-types').Task[]>} */
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
