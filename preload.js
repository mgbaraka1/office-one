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

  // ── Backup / reports / window / shell ──
  /** @returns {Promise<import('./ipc-types').FileResult>} */
  backupDatabase:    ()           => ipcRenderer.invoke('db:backup'),
  /** @returns {Promise<import('./ipc-types').FileResult>} */
  exportPDF:         (html, name) => ipcRenderer.invoke('report:exportPDF', html, name),
  flushComplete:     ()           => ipcRenderer.invoke('app:flushComplete'),
  onBeforeClose:  (cb)            => ipcRenderer.on('app:beforeClose', () => cb()),
  setTitle:       (title)         => ipcRenderer.invoke('window:setTitle', title),
  openExternal:   (url)           => ipcRenderer.invoke('shell:openExternal', url),
});
