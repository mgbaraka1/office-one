const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  saveDay:        (dateStr, data) => ipcRenderer.invoke('saveDay', dateStr, data),
  loadDay:        (dateStr)       => ipcRenderer.invoke('loadDay', dateStr),
  listDays:       ()              => ipcRenderer.invoke('listDays'),
  loadDaysRange:  (from, to)      => ipcRenderer.invoke('loadDaysRange', from, to),
  getCarryOver:   (excludeDate)   => ipcRenderer.invoke('getCarryOver', excludeDate),
  loadLookups:    ()              => ipcRenderer.invoke('loadLookups'),
  saveLookups:    (data)          => ipcRenderer.invoke('saveLookups', data),
  loadSubscriptions: ()           => ipcRenderer.invoke('loadSubscriptions'),
  saveSubscriptions: (data)       => ipcRenderer.invoke('saveSubscriptions', data),
  backupDatabase:    ()           => ipcRenderer.invoke('backupDatabase'),
  exportPDF:         (html, name) => ipcRenderer.invoke('exportPDF', html, name),
  flushComplete:     ()           => ipcRenderer.invoke('flushComplete'),
  onBeforeClose:  (cb)            => ipcRenderer.on('before-close', () => cb()),
  setTitle:       (title)         => ipcRenderer.invoke('setTitle', title),
  openExternal:   (url)           => ipcRenderer.invoke('openExternal', url),
});
