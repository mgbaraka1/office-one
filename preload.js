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
  /** @returns {Promise<import('./ipc-types').ManagedUser[]>} */
  authListUsers:   ()                 => ipcRenderer.invoke('auth:listUsers'),
  authAddUser:     (username, pass, isAdmin = false, nameEn = '', nameAr = '') => ipcRenderer.invoke('auth:addUser', username, pass, isAdmin, nameEn, nameAr),
  /** @returns {Promise<import('./ipc-types').AuthResult>} */
  authUpdateUser:  (id, data)         => ipcRenderer.invoke('auth:updateUser', id, data),

  // ── App metadata ──
  /** @returns {Promise<string>} */
  appVersion:      ()                 => ipcRenderer.invoke('app:version'),

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

  // ── Analytics (aggregated in SQL) ──
  /** @returns {Promise<import('./ipc-types').AnalyticsSummary>} */
  loadAnalytics:  (from, to, spanFrom, spanTo) => ipcRenderer.invoke('analytics:summary', from, to, spanFrom, spanTo),
  /** @returns {Promise<import('./ipc-types').OverviewStats>} */
  loadOverviewStats: (today, monthStart)       => ipcRenderer.invoke('analytics:overview', today, monthStart),
  /** @returns {Promise<import('./ipc-types').AttentionItem[]>} */
  getAttentionItems: ()                        => ipcRenderer.invoke('attention:list'),
  getRecentActivity: ()                        => ipcRenderer.invoke('activity:list'),

  // ── Lookups (normalized catalog — shared app config) ──
  /** @returns {Promise<import('./ipc-types').Lookups>} */
  loadLookups:    ()              => ipcRenderer.invoke('lookups:get'),
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
  searchWorkspace: (query, limit = 30) => ipcRenderer.invoke('search:workspace', query, limit),
  /** @returns {Promise<import('./ipc-types').Task|null>} */
  getTask:        (id)            => ipcRenderer.invoke('tasks:get', id),
  getTaskHistory: (id)            => ipcRenderer.invoke('tasks:history', id),
  /** @returns {Promise<import('./ipc-types').Task>} */
  createTask:     (data)          => ipcRenderer.invoke('tasks:create', data),
  /** @returns {Promise<import('./ipc-types').Task|null>} */
  updateTask:     (id, data)      => ipcRenderer.invoke('tasks:update', id, data),
  /** Metadata-only (name/status/company/system/source) — never touches project/department links. Use from the Timesheet instead of updateTask. @returns {Promise<import('./ipc-types').Task|null>} */
  updateTaskMeta: (id, data)      => ipcRenderer.invoke('tasks:update-meta', id, data),
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

  // ── Departments — DEPARTMENT lookup category, no profile/CRUD ──
  /** @returns {Promise<import('./ipc-types').DepartmentListItem[]>} */
  listDepartments:  ()               => ipcRenderer.invoke('departments:list'),
  /** @returns {Promise<import('./ipc-types').Department|null>} */
  getDepartment:    (id)             => ipcRenderer.invoke('departments:get', id),

  // ── Internal tasks (separate INTERNAL domain) ──
  // The internal-domain counterpart of the Tasks block above; a task moves
  // between domains only via the convert-* calls, never a link/unlink pair.
  /** @returns {Promise<import('./ipc-types').Task[]>} */
  listInternalTasks: ()              => ipcRenderer.invoke('internal:list'),
  /** @returns {Promise<import('./ipc-types').Task>} */
  createInternalTask: (data)         => ipcRenderer.invoke('internal:create', data),
  /** @returns {Promise<import('./ipc-types').Task|null>} */
  updateInternalTask: (id, data)     => ipcRenderer.invoke('internal:update', id, data),
  deleteInternalTask: (id)           => ipcRenderer.invoke('internal:delete', id),
  /** @returns {Promise<{ok: boolean, error?: string, task?: import('./ipc-types').Task}>} */
  convertTaskToInternal: (id, data)  => ipcRenderer.invoke('tasks:convert-to-internal', id, data),
  /** @returns {Promise<{ok: boolean, error?: string, task?: import('./ipc-types').Task}>} */
  convertTaskToClient:   (id, data)  => ipcRenderer.invoke('internal:convert-to-client', id, data),

  // ── Project document files (bytes on disk under userData) ──
  /** @returns {Promise<import('./ipc-types').DocFileResult>} */
  uploadProjectDocument:   (projectId, documentType) => ipcRenderer.invoke('projects:upload-document', projectId, documentType),
  /** @returns {Promise<import('./ipc-types').FileResult>} */
  downloadProjectDocument: (projectId, documentType) => ipcRenderer.invoke('projects:download-document', projectId, documentType),
  openProjectDocument:     (projectId, documentType) => ipcRenderer.invoke('projects:open-document', projectId, documentType),
  /** @returns {Promise<import('./ipc-types').DocFileResult>} */
  removeProjectDocument:   (projectId, documentType) => ipcRenderer.invoke('projects:remove-document', projectId, documentType),
  restoreProjectDocument:  (projectId, documentType, fileMeta) => ipcRenderer.invoke('projects:restore-document', projectId, documentType, fileMeta),
  purgeProjectDocumentFile: (projectId, relPath) => ipcRenderer.invoke('projects:purge-document-file', projectId, relPath),
  purgeProjectFiles:       (projectId)               => ipcRenderer.invoke('projects:purge-files', projectId),
  restoreProjectFiles:     (oldId, newId, docs)      => ipcRenderer.invoke('projects:restore-files', oldId, newId, docs),

  // ── Company Documents (standalone card-per-document module) ──
  /** @returns {Promise<import('./ipc-types').CompanyDocument[]>} */
  listCompanyDocuments:  ()          => ipcRenderer.invoke('companydocs:list'),
  /** @returns {Promise<import('./ipc-types').CompanyDocument>} */
  createCompanyDocument: (data)      => ipcRenderer.invoke('companydocs:create', data),
  /** @returns {Promise<import('./ipc-types').CompanyDocument|null>} */
  updateCompanyDocument: (id, data)  => ipcRenderer.invoke('companydocs:update', id, data),
  deleteCompanyDocument: (id)        => ipcRenderer.invoke('companydocs:delete', id),
  /** @returns {Promise<import('./ipc-types').CompanyDocFileResult>} */
  uploadCompanyDocument:   (id) => ipcRenderer.invoke('companydocs:upload-document', id),
  /** @returns {Promise<import('./ipc-types').FileResult>} */
  downloadCompanyDocument: (id) => ipcRenderer.invoke('companydocs:download-document', id),
  openCompanyDocument:     (id) => ipcRenderer.invoke('companydocs:open-document', id),
  /** @returns {Promise<import('./ipc-types').CompanyDocFileResult>} */
  removeCompanyDocument:   (id) => ipcRenderer.invoke('companydocs:remove-document', id),
  restoreRemovedCompanyDocument: (id, fileMeta) => ipcRenderer.invoke('companydocs:restore-document', id, fileMeta),
  purgeCompanyDocumentFile: (id, relPath) => ipcRenderer.invoke('companydocs:purge-document-file', id, relPath),
  purgeCompanyDocumentFiles: (id)                    => ipcRenderer.invoke('companydocs:purge-files', id),
  restoreCompanyDocumentFile: (oldId, newId, fileMeta) => ipcRenderer.invoke('companydocs:restore-file', oldId, newId, fileMeta),

  // ── Knowledge Hub ──
  listKnowledgeItems:   ()              => ipcRenderer.invoke('knowledge:list'),
  getKnowledgeItem:     (id)            => ipcRenderer.invoke('knowledge:get', id),
  createKnowledgeItem:  (data)          => ipcRenderer.invoke('knowledge:create', data),
  updateKnowledgeItem:  (id, data)      => ipcRenderer.invoke('knowledge:update', id, data),
  deleteKnowledgeItem:  (id)            => ipcRenderer.invoke('knowledge:delete', id),
  restoreKnowledgeItem: (oldId, snapshot) => ipcRenderer.invoke('knowledge:restore', oldId, snapshot),
  listKnowledgeGroups:         ()             => ipcRenderer.invoke('knowledge:groups-list'),
  createKnowledgeGroup:        (data)         => ipcRenderer.invoke('knowledge:group-create', data),
  updateKnowledgeGroup:        (id, data)     => ipcRenderer.invoke('knowledge:group-update', id, data),
  deleteKnowledgeGroup:        (id)           => ipcRenderer.invoke('knowledge:group-delete', id),
  uploadKnowledgeAttachment:   (itemId, meta) => ipcRenderer.invoke('knowledge:upload-attachment', itemId, meta),
  downloadKnowledgeAttachment: (attachmentId) => ipcRenderer.invoke('knowledge:download-attachment', attachmentId),
  openKnowledgeAttachment:     (attachmentId) => ipcRenderer.invoke('knowledge:open-attachment', attachmentId),
  removeKnowledgeAttachment:   (attachmentId) => ipcRenderer.invoke('knowledge:remove-attachment', attachmentId),
  restoreKnowledgeAttachment:  (itemId, fileMeta) => ipcRenderer.invoke('knowledge:restore-attachment', itemId, fileMeta),
  purgeKnowledgeAttachment:    (itemId, relPath) => ipcRenderer.invoke('knowledge:purge-attachment', itemId, relPath),
  purgeKnowledgeFiles:         (itemId) => ipcRenderer.invoke('knowledge:purge-files', itemId),

  // ── Clients (Auth + Server Information + Databases per COMPANY lookup) ──
  /** @returns {Promise<import('./ipc-types').ClientListItem[]>} */
  listClients: (includeArchived)      => ipcRenderer.invoke('clients:list', includeArchived),
  /** @returns {Promise<import('./ipc-types').Client|null>} */
  getClient:   (companyId)            => ipcRenderer.invoke('clients:get', companyId),
  // Roster CRUD. `createClient` is the only path that ever sets a company code;
  // `renameClient` deliberately takes names only, never a code.
  /** @returns {Promise<import('./ipc-types').ClientWriteResult>} */
  createClient: (data)                => ipcRenderer.invoke('clients:create', data),
  /** @returns {Promise<import('./ipc-types').ClientWriteResult>} */
  renameClient: (companyId, data)     => ipcRenderer.invoke('clients:rename', companyId, data),
  /** @returns {Promise<import('./ipc-types').ClientWriteResult>} */
  setClientActive: (companyId, isActive) => ipcRenderer.invoke('clients:set-active', companyId, isActive),
  /** @returns {Promise<{ok: boolean, error?: string}>} */
  reorderClients: (orderedIds)        => ipcRenderer.invoke('clients:reorder', orderedIds),
  createClientVpn: (companyId, data)  => ipcRenderer.invoke('clients:vpn-create', companyId, data),
  updateClientVpn: (id, data)         => ipcRenderer.invoke('clients:vpn-update', id, data),
  deleteClientVpn: (id)               => ipcRenderer.invoke('clients:vpn-delete', id),
  createClientServer: (companyId, data) => ipcRenderer.invoke('clients:server-create', companyId, data),
  updateClientServer: (id, data)        => ipcRenderer.invoke('clients:server-update', id, data),
  deleteClientServer: (id)              => ipcRenderer.invoke('clients:server-delete', id),
  renameClientServerSystemGroup: (companyId, oldName, newName) => ipcRenderer.invoke('clients:server-rename-group', companyId, oldName, newName),
  assignClientServerGroup: (companyId, recordIds, groupName) => ipcRenderer.invoke('clients:server-assign-group', companyId, recordIds, groupName),
  createClientInternalSystem: (companyId, data) => ipcRenderer.invoke('clients:internal-create', companyId, data),
  updateClientInternalSystem: (id, data)        => ipcRenderer.invoke('clients:internal-update', id, data),
  deleteClientInternalSystem: (id)              => ipcRenderer.invoke('clients:internal-delete', id),
  renameClientInternalSystemGroup: (companyId, oldName, newName) => ipcRenderer.invoke('clients:internal-rename-group', companyId, oldName, newName),
  assignClientInternalGroup: (companyId, recordIds, groupName) => ipcRenderer.invoke('clients:internal-assign-group', companyId, recordIds, groupName),
  /** @returns {Promise<import('./ipc-types').ClientFieldHistoryEntry[]>} */
  getClientFieldHistory: (recordType, recordId) => ipcRenderer.invoke('clients:field-history', recordType, recordId),
  getCompanyProfile: (companyId) => ipcRenderer.invoke('clients:profile-get', companyId),
  saveCompanyProfile: (companyId, data) => ipcRenderer.invoke('clients:profile-save', companyId, data),
  getCompanyProfileHistory: (companyId) => ipcRenderer.invoke('clients:profile-history', companyId),
  getLookupCodeHistory: (lookupId) => ipcRenderer.invoke('lookups:history', lookupId),
  listFinanceCandidateCompanies: () => ipcRenderer.invoke('finance:candidate-companies'),
  getFinanceOverview: () => ipcRenderer.invoke('finance:overview'),

  // ── Finance (standalone financial record-keeping module) ──
  listFinanceLookups: ()          => ipcRenderer.invoke('finance:lookups-list'),
  saveFinanceLookups: (data)      => ipcRenderer.invoke('finance:lookups-save', data),
  listFinanceClients: ()          => ipcRenderer.invoke('finance:clients-list'),
  getFinanceClient:   (id)        => ipcRenderer.invoke('finance:client-get', id),
  createFinanceClient: (data)     => ipcRenderer.invoke('finance:client-create', data),
  updateFinanceClient: (id, data) => ipcRenderer.invoke('finance:client-update', id, data),
  deleteFinanceClient: (id)       => ipcRenderer.invoke('finance:client-delete', id),
  listFinanceContracts: (clientId)       => ipcRenderer.invoke('finance:contracts-list', clientId),
  getFinanceContract:   (id)             => ipcRenderer.invoke('finance:contract-get', id),
  createFinanceContract: (clientId, data) => ipcRenderer.invoke('finance:contract-create', clientId, data),
  updateFinanceContract: (id, data)       => ipcRenderer.invoke('finance:contract-update', id, data),
  deleteFinanceContract: (id)             => ipcRenderer.invoke('finance:contract-delete', id),
  createFinanceContractVersion: (contractId, data) => ipcRenderer.invoke('finance:version-create', contractId, data),
  updateFinanceContractVersion: (id, data)         => ipcRenderer.invoke('finance:version-update', id, data),
  deleteFinanceContractVersion: (id)               => ipcRenderer.invoke('finance:version-delete', id),
  setFinalFinanceContractVersion: (id)             => ipcRenderer.invoke('finance:version-set-final', id),
  createFinanceInstallment: (contractId, data) => ipcRenderer.invoke('finance:installment-create', contractId, data),
  updateFinanceInstallment: (id, data)         => ipcRenderer.invoke('finance:installment-update', id, data),
  deleteFinanceInstallment: (id)               => ipcRenderer.invoke('finance:installment-delete', id),
  listFinanceChangeRequests: (clientId)      => ipcRenderer.invoke('finance:crs-list', clientId),
  getFinanceChangeRequest:   (id)            => ipcRenderer.invoke('finance:cr-get', id),
  createFinanceChangeRequest: (clientId, data) => ipcRenderer.invoke('finance:cr-create', clientId, data),
  updateFinanceChangeRequest: (id, data)       => ipcRenderer.invoke('finance:cr-update', id, data),
  deleteFinanceChangeRequest: (id)             => ipcRenderer.invoke('finance:cr-delete', id),
  listFinanceInvoices: (clientId)       => ipcRenderer.invoke('finance:invoices-list', clientId),
  getFinanceInvoice:   (id)             => ipcRenderer.invoke('finance:invoice-get', id),
  createFinanceInvoice: (clientId, data) => ipcRenderer.invoke('finance:invoice-create', clientId, data),
  updateFinanceInvoice: (id, data)       => ipcRenderer.invoke('finance:invoice-update', id, data),
  deleteFinanceInvoice: (id)             => ipcRenderer.invoke('finance:invoice-delete', id),
  createFinanceInvoiceLink: (invoiceId, data) => ipcRenderer.invoke('finance:invoice-link-create', invoiceId, data),
  deleteFinanceInvoiceLink: (id)              => ipcRenderer.invoke('finance:invoice-link-delete', id),
  createFinancePayment: (invoiceId, data) => ipcRenderer.invoke('finance:payment-create', invoiceId, data),
  updateFinancePayment: (id, data)        => ipcRenderer.invoke('finance:payment-update', id, data),
  deleteFinancePayment: (id)              => ipcRenderer.invoke('finance:payment-delete', id),
  getFinanceClientSummary: (clientId) => ipcRenderer.invoke('finance:summary', clientId),
  listFinanceAttachments: (entityType, entityId) => ipcRenderer.invoke('finance:attachments-list', entityType, entityId),
  uploadFinanceAttachment: (entityType, entityId) => ipcRenderer.invoke('finance:attachment-upload', entityType, entityId),
  downloadFinanceAttachment: (id) => ipcRenderer.invoke('finance:attachment-download', id),
  openFinanceAttachment: (id)     => ipcRenderer.invoke('finance:attachment-open', id),
  deleteFinanceAttachment: (id)          => ipcRenderer.invoke('finance:attachment-delete', id),
  restoreFinanceAttachment: (snapshot)   => ipcRenderer.invoke('finance:attachment-restore', snapshot),
  purgeFinanceAttachmentFile: (entityType, entityId, relPath)  => ipcRenderer.invoke('finance:attachment-purge', entityType, entityId, relPath),
  listFinanceMeetings: (clientId) => ipcRenderer.invoke('finance:meetings-list', clientId),
  getFinanceMeeting:   (id)       => ipcRenderer.invoke('finance:meeting-get', id),
  createFinanceMeeting: (clientId, data) => ipcRenderer.invoke('finance:meeting-create', clientId, data),
  updateFinanceMeeting: (id, data)       => ipcRenderer.invoke('finance:meeting-update', id, data),
  deleteFinanceMeeting: (id)             => ipcRenderer.invoke('finance:meeting-delete', id),
  createFinanceMeetingAction: (meetingId, data) => ipcRenderer.invoke('finance:action-create', meetingId, data),
  updateFinanceMeetingAction: (id, data)        => ipcRenderer.invoke('finance:action-update', id, data),
  toggleFinanceMeetingActionStatus: (id)        => ipcRenderer.invoke('finance:action-toggle', id),
  deleteFinanceMeetingAction: (id)              => ipcRenderer.invoke('finance:action-delete', id),
  exportFinanceReportExcel: (data, name) => ipcRenderer.invoke('finance:report-export-excel', data, name),

  // ── UI state (Milestone 11) ──
  /** @returns {Promise<import('./ipc-types').UiState>} */
  getUiState:        ()           => ipcRenderer.invoke('ui:getState'),
  /** @returns {Promise<{ok: boolean}>} */
  saveUiState:       (state)      => ipcRenderer.invoke('ui:setState', state),

  // ── Knowledge Hub editor recovery draft (kept out of ui_state — see db.js) ──
  getKnowledgeDraft:   ()      => ipcRenderer.invoke('ui:getKnowledgeDraft'),
  saveKnowledgeDraft:  (draft) => ipcRenderer.invoke('ui:saveKnowledgeDraft', draft),
  clearKnowledgeDraft: ()      => ipcRenderer.invoke('ui:clearKnowledgeDraft'),

  // ── Per-account UI preferences (theme/density/canvas/motion/sidebar/timesheet view) ──
  getPreferences:  ()          => ipcRenderer.invoke('preferences:get'),
  setPreference:   (key, val)  => ipcRenderer.invoke('preferences:set', key, val),

  // ── Backup / reports / window / shell ──
  /** @returns {Promise<import('./ipc-types').FileResult>} */
  backupDatabase:    ()           => ipcRenderer.invoke('db:backup'),
  /** @returns {Promise<import('./ipc-types').BackupFileInfo[]>} */
  listBackups:       ()           => ipcRenderer.invoke('maintenance:listBackups'),
  /** Restores the live DB from a backups/ file, then relaunches the app. @returns {Promise<{ok: boolean, error?: string}>} */
  restoreBackup:     (filename)   => ipcRenderer.invoke('maintenance:restoreBackup', filename),
  /** @returns {Promise<import('./ipc-types').IntegrityCheckResult>} */
  checkIntegrity:    ()           => ipcRenderer.invoke('maintenance:integrityCheck'),
  getSystemDiagnostics: ()        => ipcRenderer.invoke('maintenance:diagnostics'),
  /** @returns {Promise<import('./ipc-types').LookupDuplicateGroup[]>} */
  getLookupDuplicates: ()         => ipcRenderer.invoke('maintenance:lookupDuplicates'),
  /** @returns {Promise<{ok: boolean, error?: string}>} */
  mergeLookups:      (category, targetId, sourceId) => ipcRenderer.invoke('maintenance:mergeLookups', category, targetId, sourceId),
  /** @returns {Promise<import('./ipc-types').OrphanSweepReport>} */
  getOrphanSweepReport: ()        => ipcRenderer.invoke('maintenance:orphanSweepReport'),
  /** @returns {Promise<import('./ipc-types').FullBackupResult>} */
  fullBackup:        ()           => ipcRenderer.invoke('maintenance:fullBackup'),
  /** Opens a native folder picker and validates the selected full-backup bundle. */
  selectFullBackup:  ()           => ipcRenderer.invoke('maintenance:selectFullBackup'),
  /** Restores the last main-process-validated full-backup bundle, then relaunches the app. */
  restoreSelectedFullBackup: ()   => ipcRenderer.invoke('maintenance:restoreSelectedFullBackup'),
  /** @returns {Promise<{ok: boolean, error?: string}>} */
  openBackupFolder:  (folderPath) => ipcRenderer.invoke('maintenance:openBackupFolder', folderPath),
  /** @returns {Promise<import('./ipc-types').FileResult>} */
  exportPDF:         (html, name) => ipcRenderer.invoke('report:exportPDF', html, name),
  exportCSV:         (csv, name)  => ipcRenderer.invoke('report:exportCSV', csv, name),
  exportExcel:       (data, name) => ipcRenderer.invoke('report:exportExcel', data, name),
  printReport:       (html)       => ipcRenderer.invoke('report:print', html),
  flushComplete:     ()           => ipcRenderer.invoke('app:flushComplete'),
  cancelClose:       ()           => ipcRenderer.invoke('app:cancelClose'),
  confirmSaveFailure: (error, action) => ipcRenderer.invoke('app:confirmSaveFailure', error, action),
  onBeforeClose:  (cb)            => ipcRenderer.on('app:beforeClose', () => cb()),
  setTitle:       (title)         => ipcRenderer.invoke('window:setTitle', title),
  openExternal:   (url)           => ipcRenderer.invoke('shell:openExternal', url),
  /** @returns {Promise<{available: boolean}>} */
  getCredentialEncryptionStatus: () => ipcRenderer.invoke('security:credentialEncryptionStatus'),
  copySecret: (value) => ipcRenderer.invoke('security:copySecret', value),
});
