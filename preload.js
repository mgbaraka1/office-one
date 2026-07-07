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

  // ── Companies / Systems (read-only views over tasks + work_logs) ──
  /** @returns {Promise<import('./ipc-types').CategoryValue[]>} */
  listCompanies:  ()        => ipcRenderer.invoke('companies:list'),
  /** @returns {Promise<import('./ipc-types').CategoryEntry[]>} */
  companyEntries: (name)    => ipcRenderer.invoke('companies:entries', name),
  /** @returns {Promise<import('./ipc-types').CategoryValue[]>} */
  listSystems:    ()        => ipcRenderer.invoke('systems:list'),
  /** @returns {Promise<import('./ipc-types').CategoryEntry[]>} */
  systemEntries:  (name)    => ipcRenderer.invoke('systems:entries', name),
  /** Custom date-range report filters: {from,to,company,system,projectId}. @returns {Promise<import('./ipc-types').CategoryEntry[]>} */
  getFilteredWorkLogs: (filters) => ipcRenderer.invoke('reports:customRange', filters),

  // ── Analytics (aggregated in SQL) ──
  /** @returns {Promise<import('./ipc-types').AnalyticsSummary>} */
  loadAnalytics:  (from, to, spanFrom, spanTo) => ipcRenderer.invoke('analytics:summary', from, to, spanFrom, spanTo),
  /** @returns {Promise<import('./ipc-types').OverviewStats>} */
  loadOverviewStats: (today, monthStart)       => ipcRenderer.invoke('analytics:overview', today, monthStart),
  /** @returns {Promise<import('./ipc-types').AttentionItem[]>} */
  getAttentionItems: ()                        => ipcRenderer.invoke('attention:list'),

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

  // ── Tasks (two-level model — standalone, date-independent unit of work) ──
  // A task with zero work_logs is a "not yet started" task, created only through
  // Projects (which requires a project link) since there's no day-agnostic browse
  // page for it anymore.
  /** @returns {Promise<import('./ipc-types').Task[]>} */
  listTasks:      ()              => ipcRenderer.invoke('tasks:list'),
  /** Lightweight — no nested workLogs (Milestone 7). @returns {Promise<import('./ipc-types').Task[]>} */
  getTasksIndex:  ()              => ipcRenderer.invoke('tasks:index'),
  /** @returns {Promise<import('./ipc-types').Task|null>} */
  getTask:        (id)            => ipcRenderer.invoke('tasks:get', id),
  /** @returns {Promise<import('./ipc-types').Task>} */
  createTask:     (data)          => ipcRenderer.invoke('tasks:create', data),
  /** @returns {Promise<import('./ipc-types').Task|null>} */
  updateTask:     (id, data)      => ipcRenderer.invoke('tasks:update', id, data),
  deleteTask:     (id)            => ipcRenderer.invoke('tasks:delete', id),
  /** Move every session from sourceId onto targetId, then delete sourceId. @returns {Promise<import('./ipc-types').TaskMergeResult>} */
  mergeTasks:     (sourceId, targetId) => ipcRenderer.invoke('tasks:merge', sourceId, targetId),

  // ── Task Sources (structured source list — a task can carry any number) ──
  /** @returns {Promise<import('./ipc-types').TaskSource|null>} */
  createTaskSource: (taskId, data) => ipcRenderer.invoke('tasks:source-create', taskId, data),
  /** @returns {Promise<import('./ipc-types').TaskSource|null>} */
  updateTaskSource: (id, data)     => ipcRenderer.invoke('tasks:source-update', id, data),
  /** @returns {Promise<{ok: boolean}>} */
  deleteTaskSource: (id)           => ipcRenderer.invoke('tasks:source-delete', id),

  // ── Work logs (v2 — dated work sessions belonging to a task) ──
  /** @returns {Promise<import('./ipc-types').WorkLog[]>} */
  listWorkLogs:   (taskId)        => ipcRenderer.invoke('worklogs:byTask', taskId),
  /** @returns {Promise<import('./ipc-types').WorkLogOnDate[]>} */
  workLogsByDate: (date)          => ipcRenderer.invoke('worklogs:byDate', date),
  /** @returns {Promise<import('./ipc-types').WorkLogMutationResult>} */
  addWorkLog:     (taskId, data)  => ipcRenderer.invoke('worklogs:add', taskId, data),
  /** @returns {Promise<import('./ipc-types').WorkLogMutationResult>} */
  updateWorkLog:  (id, data)      => ipcRenderer.invoke('worklogs:update', id, data),
  /** Reassign a work log to a different task. @returns {Promise<import('./ipc-types').WorkLogMoveResult>} */
  moveWorkLog:    (id, taskId)    => ipcRenderer.invoke('worklogs:move', id, taskId),
  /** @returns {Promise<import('./ipc-types').WorkLogMutationResult>} */
  deleteWorkLog:  (id)            => ipcRenderer.invoke('worklogs:delete', id),
  /** Read-only, newest first. @returns {Promise<import('./ipc-types').WorkLogHistoryEntry[]>} */
  getWorkLogHistory: (id)         => ipcRenderer.invoke('worklogs:history', id),
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

  // ── Departments (Internal Tasks) — DEPARTMENT lookup category, no profile/CRUD ──
  /** @returns {Promise<import('./ipc-types').DepartmentListItem[]>} */
  listDepartments:  ()               => ipcRenderer.invoke('departments:list'),
  /** @returns {Promise<import('./ipc-types').Department|null>} */
  getDepartment:    (id)             => ipcRenderer.invoke('departments:get', id),
  linkDepartmentTask:   (taskId, deptId) => ipcRenderer.invoke('departments:link-task', taskId, deptId),
  unlinkDepartmentTask: (taskId)         => ipcRenderer.invoke('departments:unlink-task', taskId),
  /** @returns {Promise<import('./ipc-types').Task[]>} */
  listLinkableTasksForDept: ()       => ipcRenderer.invoke('departments:linkable-tasks'),

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

  // ── Company Documents (standalone card-per-document module) ──
  /** @returns {Promise<import('./ipc-types').CompanyDocument[]>} */
  listCompanyDocuments:  ()          => ipcRenderer.invoke('companydocs:list'),
  /** @returns {Promise<import('./ipc-types').CompanyDocument|null>} */
  getCompanyDocument:    (id)        => ipcRenderer.invoke('companydocs:get', id),
  /** @returns {Promise<import('./ipc-types').CompanyDocument>} */
  createCompanyDocument: (data)      => ipcRenderer.invoke('companydocs:create', data),
  /** @returns {Promise<import('./ipc-types').CompanyDocument|null>} */
  updateCompanyDocument: (id, data)  => ipcRenderer.invoke('companydocs:update', id, data),
  deleteCompanyDocument: (id)        => ipcRenderer.invoke('companydocs:delete', id),
  /** @returns {Promise<import('./ipc-types').CompanyDocFileResult>} */
  uploadCompanyDocument:   (id) => ipcRenderer.invoke('companydocs:upload-document', id),
  /** Replace = upload again; the prior file is removed server-side on conflict. */
  /** @returns {Promise<import('./ipc-types').CompanyDocFileResult>} */
  replaceCompanyDocument:  (id) => ipcRenderer.invoke('companydocs:upload-document', id),
  /** @returns {Promise<import('./ipc-types').FileResult>} */
  downloadCompanyDocument: (id) => ipcRenderer.invoke('companydocs:download-document', id),
  openCompanyDocument:     (id) => ipcRenderer.invoke('companydocs:open-document', id),
  /** @returns {Promise<import('./ipc-types').CompanyDocFileResult>} */
  removeCompanyDocument:   (id) => ipcRenderer.invoke('companydocs:remove-document', id),
  purgeCompanyDocumentFiles: (id)                    => ipcRenderer.invoke('companydocs:purge-files', id),
  restoreCompanyDocumentFile: (oldId, newId, fileMeta) => ipcRenderer.invoke('companydocs:restore-file', oldId, newId, fileMeta),

  // ── Clients (Auth + Server Information + Databases per COMPANY lookup) ──
  /** @returns {Promise<import('./ipc-types').ClientListItem[]>} */
  listClients: ()                     => ipcRenderer.invoke('clients:list'),
  /** @returns {Promise<import('./ipc-types').Client|null>} */
  getClient:   (companyId)            => ipcRenderer.invoke('clients:get', companyId),
  createClientVpn: (companyId, data)  => ipcRenderer.invoke('clients:vpn-create', companyId, data),
  updateClientVpn: (id, data)         => ipcRenderer.invoke('clients:vpn-update', id, data),
  deleteClientVpn: (id)               => ipcRenderer.invoke('clients:vpn-delete', id),
  createClientServer: (companyId, data) => ipcRenderer.invoke('clients:server-create', companyId, data),
  updateClientServer: (id, data)        => ipcRenderer.invoke('clients:server-update', id, data),
  deleteClientServer: (id)              => ipcRenderer.invoke('clients:server-delete', id),
  renameClientServerSystemGroup: (companyId, oldName, newName) => ipcRenderer.invoke('clients:server-rename-group', companyId, oldName, newName),
  assignClientServerGroup: (companyId, recordIds, groupName) => ipcRenderer.invoke('clients:server-assign-group', companyId, recordIds, groupName),
  createClientDatabase: (companyId, data) => ipcRenderer.invoke('clients:database-create', companyId, data),
  updateClientDatabase: (id, data)        => ipcRenderer.invoke('clients:database-update', id, data),
  deleteClientDatabase: (id)              => ipcRenderer.invoke('clients:database-delete', id),
  createClientExternalService: (companyId, data) => ipcRenderer.invoke('clients:external-create', companyId, data),
  updateClientExternalService: (id, data)        => ipcRenderer.invoke('clients:external-update', id, data),
  deleteClientExternalService: (id)              => ipcRenderer.invoke('clients:external-delete', id),
  createClientInternalSystem: (companyId, data) => ipcRenderer.invoke('clients:internal-create', companyId, data),
  updateClientInternalSystem: (id, data)        => ipcRenderer.invoke('clients:internal-update', id, data),
  deleteClientInternalSystem: (id)              => ipcRenderer.invoke('clients:internal-delete', id),
  renameClientInternalSystemGroup: (companyId, oldName, newName) => ipcRenderer.invoke('clients:internal-rename-group', companyId, oldName, newName),
  assignClientInternalGroup: (companyId, recordIds, groupName) => ipcRenderer.invoke('clients:internal-assign-group', companyId, recordIds, groupName),
  /** @returns {Promise<import('./ipc-types').ClientFieldHistoryEntry[]>} */
  getClientFieldHistory: (recordType, recordId) => ipcRenderer.invoke('clients:field-history', recordType, recordId),

  // ── UI state (Milestone 11) ──
  /** @returns {Promise<import('./ipc-types').UiState>} */
  getUiState:        ()           => ipcRenderer.invoke('ui:getState'),
  /** @returns {Promise<{ok: boolean}>} */
  saveUiState:       (state)      => ipcRenderer.invoke('ui:setState', state),

  // ── Backup / reports / window / shell ──
  /** @returns {Promise<import('./ipc-types').FileResult>} */
  backupDatabase:    ()           => ipcRenderer.invoke('db:backup'),
  /** @returns {Promise<import('./ipc-types').ProjectsBackupResult>} */
  backupProjects:    ()           => ipcRenderer.invoke('projects:backup'),
  /** @returns {Promise<import('./ipc-types').BackupFileInfo[]>} */
  listBackups:       ()           => ipcRenderer.invoke('maintenance:listBackups'),
  /** Restores the live DB from a backups/ file, then relaunches the app. @returns {Promise<{ok: boolean, error?: string}>} */
  restoreBackup:     (filename)   => ipcRenderer.invoke('maintenance:restoreBackup', filename),
  /** @returns {Promise<import('./ipc-types').IntegrityCheckResult>} */
  checkIntegrity:    ()           => ipcRenderer.invoke('maintenance:integrityCheck'),
  /** @returns {Promise<import('./ipc-types').LookupDuplicateGroup[]>} */
  getLookupDuplicates: ()         => ipcRenderer.invoke('maintenance:lookupDuplicates'),
  /** @returns {Promise<{ok: boolean, error?: string}>} */
  mergeLookups:      (category, targetId, sourceId) => ipcRenderer.invoke('maintenance:mergeLookups', category, targetId, sourceId),
  /** @returns {Promise<import('./ipc-types').OrphanSweepReport>} */
  getOrphanSweepReport: ()        => ipcRenderer.invoke('maintenance:orphanSweepReport'),
  /** @returns {Promise<import('./ipc-types').FullBackupResult>} */
  fullBackup:        ()           => ipcRenderer.invoke('maintenance:fullBackup'),
  /** @returns {Promise<{ok: boolean, error?: string}>} */
  openBackupFolder:  (folderPath) => ipcRenderer.invoke('maintenance:openBackupFolder', folderPath),
  /** @returns {Promise<import('./ipc-types').FileResult>} */
  exportPDF:         (html, name) => ipcRenderer.invoke('report:exportPDF', html, name),
  flushComplete:     ()           => ipcRenderer.invoke('app:flushComplete'),
  onBeforeClose:  (cb)            => ipcRenderer.on('app:beforeClose', () => cb()),
  setTitle:       (title)         => ipcRenderer.invoke('window:setTitle', title),
  openExternal:   (url)           => ipcRenderer.invoke('shell:openExternal', url),
  /** @returns {Promise<{available: boolean}>} */
  getCredentialEncryptionStatus: () => ipcRenderer.invoke('security:credentialEncryptionStatus'),
});
