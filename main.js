const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const db     = require('./db');
const auth   = require('./auth');
const backup = require('./backup');

// Wrap a data IPC handler so it fails closed when no one is logged in. Every
// handler that reads or writes user data goes through this — the renderer can
// never reach the data layer before authenticating.
function authed(handler) {
  return (event, ...args) => {
    if (!auth.isAuthenticated()) throw new Error('Not authenticated');
    return handler(event, ...args);
  };
}

let win;
let allowClose = false;       // set once the renderer has flushed pending saves
let closeFallback = null;     // safety timer for the close handshake

function createWindow() {
  const prefs = db.loadPrefs();
  win = new BrowserWindow({
    width:     prefs.width  || 1400,
    height:    prefs.height || 800,
    x:         prefs.x,
    y:         prefs.y,
    minWidth:  900,
    minHeight: 600,
    icon:      path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
    title: 'Cooperation Tools',
  });
  if (prefs.maximized) win.maximize();
  win.loadFile('index.html');

  // Defense in depth: the app is a single local page. Deny any attempt to open
  // new windows or navigate the top frame elsewhere. The one legitimate popup
  // is the print-preview window (about:blank, written via document.write); real
  // web links are handed to the OS browser (mirrors the openExternal allowlist).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === '' || url === 'about:blank') return { action: 'allow' };
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.href);
    } catch { /* not a valid URL — ignore */ }
    return { action: 'deny' };
  });
  // Block navigation *away* from the app (defense in depth), but allow a reload
  // of our own page — logout (doLogout → location.reload) relies on it, and a
  // reload fires will-navigate with the current URL as its target.
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  win.on('close', (e) => {
    // Persist window state on every close attempt. Use getNormalBounds() so the
    // restored (un-maximized) size is saved even while maximized.
    const b = win.getNormalBounds();
    db.savePrefs({ width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() });

    // First close attempt: give the renderer a chance to flush any debounced
    // (300 ms) auto-saves before the window tears down, so no edit is lost.
    if (!allowClose) {
      e.preventDefault();
      win.webContents.send('app:beforeClose');
      // Safety net: if the renderer never reports back, close anyway.
      closeFallback = setTimeout(() => {
        allowClose = true;
        if (win && !win.isDestroyed()) win.close();
      }, 1500);
    }
  });
}

// ── Authentication (ungated — these are the gate) ──
ipcMain.handle('auth:status',      ()                     => auth.status());
ipcMain.handle('auth:setup',       (_e, username, pass)   => auth.setup(username, pass));
ipcMain.handle('auth:login',       (_e, username, pass)   => auth.login(username, pass));
ipcMain.handle('auth:logout',      ()                     => auth.logout());
ipcMain.handle('auth:currentUser', ()                     => auth.currentUser());

// ── Days ── (userId always comes from the authenticated session, never the renderer)
// day:save / day:get retired in Phase C2 — the Timesheet persists work sessions
// granularly via tasks:* / worklogs:*. days:list / days:range remain (calendar
// marks + range reads), now driven by work_logs.
ipcMain.handle('days:list', authed(()                  => db.listDays(auth.requireUserId())));
ipcMain.handle('days:range', authed((_e, from, to)     => db.loadDaysRange(auth.requireUserId(), from, to)));

// ── Companies / Systems (read-only views over tasks + work_logs) ──
ipcMain.handle('companies:list',    authed(()         => db.listCompanies(auth.requireUserId())));
ipcMain.handle('companies:entries', authed((_e, name) => db.companyEntries(auth.requireUserId(), name)));
ipcMain.handle('systems:list',      authed(()         => db.listSystems(auth.requireUserId())));
ipcMain.handle('systems:entries',   authed((_e, name) => db.systemEntries(auth.requireUserId(), name)));
ipcMain.handle('reports:customRange', authed((_e, filters) => db.getFilteredWorkLogs(auth.requireUserId(), filters)));

// ── Analytics (aggregation done in SQL, not in the renderer) ──
ipcMain.handle('analytics:summary',  authed((_e, from, to, spanFrom, spanTo) => db.getAnalytics(auth.requireUserId(), from, to, spanFrom, spanTo)));
ipcMain.handle('analytics:overview', authed((_e, today, monthStart)          => db.getOverviewStats(auth.requireUserId(), today, monthStart)));
ipcMain.handle('attention:list', authed(() => db.getAttentionItems(auth.requireUserId())));

// ── Lookups (normalized catalog — shared app config) ──
ipcMain.handle('lookups:get',         authed(()                              => db.loadLookups()));
ipcMain.handle('lookups:getByCategory', authed((_e, category, includeInactive) => db.getLookupsByCategory(category, includeInactive)));
ipcMain.handle('lookups:save',        authed((_e, data)                      => db.saveLookups(data)));

// ── Subscriptions ──
ipcMain.handle('subscriptions:list', authed(()         => db.loadSubscriptions(auth.requireUserId())));
ipcMain.handle('subscriptions:save', authed((_e, data) => db.saveSubscriptions(auth.requireUserId(), data)));

// ── Tasks (two-level model — standalone, date-independent unit of work) ──
// A task with zero work_logs is a "not yet started" task, created only through
// Projects (which requires a project link) since there's no day-agnostic browse
// page for it anymore.
ipcMain.handle('tasks:list',   authed(()             => db.listTasks(auth.requireUserId())));
ipcMain.handle('tasks:index',  authed(()             => db.getTasksIndex(auth.requireUserId())));
ipcMain.handle('tasks:get',    authed((_e, id)       => db.getTask(auth.requireUserId(), id)));
ipcMain.handle('tasks:create', authed((_e, data)     => db.createTask(auth.requireUserId(), data)));
ipcMain.handle('tasks:update', authed((_e, id, data) => db.updateTask(auth.requireUserId(), id, data)));
ipcMain.handle('tasks:delete', authed((_e, id)       => db.deleteTask(auth.requireUserId(), id)));
ipcMain.handle('tasks:merge',  authed((_e, sourceId, targetId) => db.mergeTasks(auth.requireUserId(), sourceId, targetId)));

// ── Task Sources (structured source list — migration 033) ──
ipcMain.handle('tasks:source-create', authed((_e, taskId, data) => db.createTaskSource(auth.requireUserId(), taskId, data)));
ipcMain.handle('tasks:source-update', authed((_e, id, data)     => db.updateTaskSource(auth.requireUserId(), id, data)));
ipcMain.handle('tasks:source-delete', authed((_e, id)           => db.deleteTaskSource(auth.requireUserId(), id)));

// ── Work logs (v2 — dated work sessions belonging to a task) ──
ipcMain.handle('worklogs:byTask', authed((_e, taskId)      => db.listWorkLogs(auth.requireUserId(), taskId)));
ipcMain.handle('worklogs:byDate', authed((_e, date)        => db.logsForDate(auth.requireUserId(), date)));
ipcMain.handle('worklogs:add',    authed((_e, taskId, data) => db.addWorkLog(auth.requireUserId(), taskId, data)));
ipcMain.handle('worklogs:update', authed((_e, id, data)    => db.updateWorkLog(auth.requireUserId(), id, data)));
ipcMain.handle('worklogs:move',   authed((_e, id, taskId)  => db.moveWorkLog(auth.requireUserId(), id, taskId)));
ipcMain.handle('worklogs:delete', authed((_e, id)          => db.deleteWorkLog(auth.requireUserId(), id)));
ipcMain.handle('worklogs:history', authed((_e, id)          => db.getWorkLogHistory(auth.requireUserId(), id)));

// Per-date employee name (metadata on the `days` row), for the reworked Timesheet
// which persists work sessions granularly instead of through day:save.
ipcMain.handle('day:setName', authed((_e, date, name) => db.setDayName(auth.requireUserId(), date, name)));
ipcMain.handle('day:getName', authed((_e, date)       => db.getDayName(auth.requireUserId(), date)));

// ── Projects (container for tasks + tracked documents) ──
ipcMain.handle('projects:create', authed((_e, data)     => db.createProject(auth.requireUserId(), data)));
ipcMain.handle('projects:list',   authed(()             => db.listProjects(auth.requireUserId())));
ipcMain.handle('projects:get',    authed((_e, id)       => db.getProject(auth.requireUserId(), id)));
ipcMain.handle('projects:update', authed((_e, id, data) => db.updateProject(auth.requireUserId(), id, data)));
ipcMain.handle('projects:delete', authed((_e, id)       => db.deleteProject(auth.requireUserId(), id)));
// Linking existing tasks to a project — addressed by task id (two-level model).
ipcMain.handle('projects:link-task',   authed((_e, projectId, taskId) => db.linkTask(auth.requireUserId(), projectId, taskId)));
ipcMain.handle('projects:unlink-task', authed((_e, taskId)            => db.unlinkTask(auth.requireUserId(), taskId)));
ipcMain.handle('projects:linkable-tasks', authed(()                   => db.listLinkableTasks(auth.requireUserId())));

// ── Annual Support (migration 035) — project_support_years is a real table (a
// support-year has no company/system/status/documents of its own), so unlike
// Departments this DOES get its own create/delete, scoped to a parent project.
ipcMain.handle('projects:support-years',        authed((_e, projectId)          => db.listSupportYears(auth.requireUserId(), projectId)));
ipcMain.handle('projects:support-year-create',  authed((_e, projectId, year)    => db.createSupportYear(auth.requireUserId(), projectId, year)));
ipcMain.handle('support-years:get',              authed((_e, id)                 => db.getSupportYear(auth.requireUserId(), id)));
ipcMain.handle('support-years:delete',           authed((_e, id)                 => db.deleteSupportYear(auth.requireUserId(), id)));
ipcMain.handle('support-years:link-task',        authed((_e, taskId, syId)       => db.linkSupportYearTask(auth.requireUserId(), taskId, syId)));
ipcMain.handle('support-years:unlink-task',      authed((_e, taskId)             => db.unlinkSupportYearTask(auth.requireUserId(), taskId)));
ipcMain.handle('support-years:linkable-tasks',   authed(()                       => db.listLinkableTasksForSupportYear(auth.requireUserId())));

// ── Departments (Internal Tasks) — DEPARTMENT is a plain lookup category, not a
// table; there is no departments:create/update/delete, only listing + linking
// tasks to one, mirroring the projects:link-task/unlink-task/linkable-tasks shape.
ipcMain.handle('departments:list',           authed(()                  => db.listDepartments(auth.requireUserId())));
ipcMain.handle('departments:get',            authed((_e, id)            => db.getDepartment(auth.requireUserId(), id)));
ipcMain.handle('departments:link-task',      authed((_e, taskId, deptId) => db.linkDepartmentTask(auth.requireUserId(), taskId, deptId)));
ipcMain.handle('departments:unlink-task',    authed((_e, taskId)        => db.unlinkDepartmentTask(auth.requireUserId(), taskId)));
ipcMain.handle('departments:linkable-tasks', authed(()                  => db.listLinkableTasksForDepartment(auth.requireUserId())));

// ── Project document files (Option A: bytes on disk under userData) ──
// Allowlist mirrors db.PROJECT_DOC_TYPES; the native dialog also filters by it so
// the user only sees permitted types (the db layer re-validates regardless).
const DOC_UPLOAD_EXTENSIONS = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'gif', 'webp'];
// Upload (and replace — db.saveProjectDocumentFile deletes the prior file on conflict).
ipcMain.handle('projects:upload-document', authed(async (_e, projectId, documentType) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose a document to upload',
    properties: ['openFile'],
    filters: [
      { name: 'Documents & images', extensions: DOC_UPLOAD_EXTENSIONS },
      { name: 'PDF',    extensions: ['pdf'] },
      { name: 'Word',   extensions: ['doc', 'docx'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
    ],
  });
  if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
  return db.saveProjectDocumentFile(auth.requireUserId(), projectId, documentType, filePaths[0]);
}));
// Download — copy the stored file out to a user-chosen location.
ipcMain.handle('projects:download-document', authed(async (_e, projectId, documentType) => {
  const r = db.resolveProjectDocumentFile(auth.requireUserId(), projectId, documentType);
  if (!r.ok) return r;
  if (!r.exists) return { ok: false, error: 'The file is missing from disk' };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save document as', defaultPath: r.originalName,
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try { fs.copyFileSync(r.absPath, filePath); return { ok: true, path: filePath }; }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
}));
// Open with the OS default application.
ipcMain.handle('projects:open-document', authed(async (_e, projectId, documentType) => {
  const r = db.resolveProjectDocumentFile(auth.requireUserId(), projectId, documentType);
  if (!r.ok) return r;
  if (!r.exists) return { ok: false, error: 'The file is missing from disk' };
  const errMsg = await shell.openPath(r.absPath);   // '' on success
  return errMsg ? { ok: false, error: errMsg } : { ok: true };
}));
// Remove — delete the file from disk and clear its metadata.
ipcMain.handle('projects:remove-document', authed((_e, projectId, documentType) =>
  db.removeProjectDocumentFile(auth.requireUserId(), projectId, documentType)));
// Delete-undo file handling: purge the whole folder when the undo window lapses,
// or move it onto the re-created project's new id when the user undoes.
ipcMain.handle('projects:purge-files',  authed((_e, projectId)            => db.purgeProjectFiles(auth.requireUserId(), projectId)));
ipcMain.handle('projects:restore-files', authed((_e, oldId, newId, docs)  => db.restoreProjectFiles(auth.requireUserId(), oldId, newId, docs)));

// ── Company Documents (standalone card-per-document module) ──
ipcMain.handle('companydocs:list',   authed(()             => db.listCompanyDocuments(auth.requireUserId())));
ipcMain.handle('companydocs:get',    authed((_e, id)       => db.getCompanyDocument(auth.requireUserId(), id)));
ipcMain.handle('companydocs:create', authed((_e, data)     => db.createCompanyDocument(auth.requireUserId(), data)));
ipcMain.handle('companydocs:update', authed((_e, id, data) => db.updateCompanyDocument(auth.requireUserId(), id, data)));
ipcMain.handle('companydocs:delete', authed((_e, id)       => db.deleteCompanyDocument(auth.requireUserId(), id)));
// Upload (and replace — db.saveCompanyDocumentFile deletes the prior file on conflict).
ipcMain.handle('companydocs:upload-document', authed(async (_e, id) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose a document to upload',
    properties: ['openFile'],
    filters: [
      { name: 'Documents & images', extensions: DOC_UPLOAD_EXTENSIONS },
      { name: 'PDF',    extensions: ['pdf'] },
      { name: 'Word',   extensions: ['doc', 'docx'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
    ],
  });
  if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
  return db.saveCompanyDocumentFile(auth.requireUserId(), id, filePaths[0]);
}));
// Download — copy the stored file out to a user-chosen location.
ipcMain.handle('companydocs:download-document', authed(async (_e, id) => {
  const r = db.resolveCompanyDocumentFile(auth.requireUserId(), id);
  if (!r.ok) return r;
  if (!r.exists) return { ok: false, error: 'The file is missing from disk' };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save document as', defaultPath: r.originalName,
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try { fs.copyFileSync(r.absPath, filePath); return { ok: true, path: filePath }; }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
}));
// Open with the OS default application.
ipcMain.handle('companydocs:open-document', authed(async (_e, id) => {
  const r = db.resolveCompanyDocumentFile(auth.requireUserId(), id);
  if (!r.ok) return r;
  if (!r.exists) return { ok: false, error: 'The file is missing from disk' };
  const errMsg = await shell.openPath(r.absPath);   // '' on success
  return errMsg ? { ok: false, error: errMsg } : { ok: true };
}));
// Remove — delete the file from disk and clear its metadata (keeps the card).
ipcMain.handle('companydocs:remove-document', authed((_e, id) => db.removeCompanyDocumentFile(auth.requireUserId(), id)));
// Delete-undo file handling: purge the card's folder when the undo window
// lapses, or move it onto the re-created card's new id when the user undoes.
ipcMain.handle('companydocs:purge-files',   authed((_e, id)                     => db.purgeCompanyDocumentFiles(auth.requireUserId(), id)));
ipcMain.handle('companydocs:restore-file',  authed((_e, oldId, newId, fileMeta) => db.restoreCompanyDocumentFile(auth.requireUserId(), oldId, newId, fileMeta)));

// ── Clients (Auth + Server Information + Databases per COMPANY lookup) ──
ipcMain.handle('clients:list', authed(()               => db.listClients(auth.requireUserId())));
ipcMain.handle('clients:get',  authed((_e, companyId)  => db.getClient(auth.requireUserId(), companyId)));
ipcMain.handle('clients:vpn-create', authed((_e, companyId, data) => db.createClientVpn(auth.requireUserId(), companyId, data)));
ipcMain.handle('clients:vpn-update', authed((_e, id, data)        => db.updateClientVpn(auth.requireUserId(), id, data)));
ipcMain.handle('clients:vpn-delete', authed((_e, id)              => db.deleteClientVpn(auth.requireUserId(), id)));
ipcMain.handle('clients:server-create', authed((_e, companyId, data) => db.createClientServer(auth.requireUserId(), companyId, data)));
ipcMain.handle('clients:server-update', authed((_e, id, data)        => db.updateClientServer(auth.requireUserId(), id, data)));
ipcMain.handle('clients:server-delete', authed((_e, id)              => db.deleteClientServer(auth.requireUserId(), id)));
ipcMain.handle('clients:server-rename-group', authed((_e, companyId, oldName, newName) => db.renameClientServerSystemGroup(auth.requireUserId(), companyId, oldName, newName)));
ipcMain.handle('clients:server-assign-group', authed((_e, companyId, recordIds, groupName) => db.assignClientServerGroup(auth.requireUserId(), companyId, recordIds, groupName)));
ipcMain.handle('clients:database-create', authed((_e, companyId, data) => db.createClientDatabase(auth.requireUserId(), companyId, data)));
ipcMain.handle('clients:database-update', authed((_e, id, data)        => db.updateClientDatabase(auth.requireUserId(), id, data)));
ipcMain.handle('clients:database-delete', authed((_e, id)              => db.deleteClientDatabase(auth.requireUserId(), id)));
ipcMain.handle('clients:external-create', authed((_e, companyId, data) => db.createClientExternalService(auth.requireUserId(), companyId, data)));
ipcMain.handle('clients:external-update', authed((_e, id, data)        => db.updateClientExternalService(auth.requireUserId(), id, data)));
ipcMain.handle('clients:external-delete', authed((_e, id)              => db.deleteClientExternalService(auth.requireUserId(), id)));
ipcMain.handle('clients:internal-create', authed((_e, companyId, data) => db.createClientInternalSystem(auth.requireUserId(), companyId, data)));
ipcMain.handle('clients:internal-update', authed((_e, id, data)        => db.updateClientInternalSystem(auth.requireUserId(), id, data)));
ipcMain.handle('clients:internal-delete', authed((_e, id)              => db.deleteClientInternalSystem(auth.requireUserId(), id)));
ipcMain.handle('clients:internal-rename-group', authed((_e, companyId, oldName, newName) => db.renameClientInternalSystemGroup(auth.requireUserId(), companyId, oldName, newName)));
ipcMain.handle('clients:internal-assign-group', authed((_e, companyId, recordIds, groupName) => db.assignClientInternalGroup(auth.requireUserId(), companyId, recordIds, groupName)));
ipcMain.handle('clients:field-history', authed((_e, recordType, recordId) => db.getClientFieldHistory(auth.requireUserId(), recordType, recordId)));

// ── UI state (Milestone 11 — this-machine-only, like window prefs, but the
// renderer needs read/write access since only it knows which module/filter
// UI is active) ──
ipcMain.handle('ui:getState', authed(() => db.loadUiState()));
ipcMain.handle('ui:setState', authed((_e, state) => { db.saveUiState(state); return { ok: true }; }));

// ── Backup ──
ipcMain.handle('db:backup', authed(async () => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Back up database',
    defaultPath: `cooperation-tools-backup-${stamp}.db`,
    filters: [{ name: 'SQLite database', extensions: ['db'] }],
  });
  if (canceled || !filePath) return { ok: false };
  try { db.backup(filePath); return { ok: true, path: filePath }; }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
}));

// On-demand backup of the entire project files tree (<userData>/projects/) into
// a single .zip the user chooses. Independent of the launch DB-backup rotation —
// this is a user-triggered export of uploaded project documents only. An empty
// or missing projects/ folder still yields a valid (empty) zip; fileCount lets
// the renderer message that case. Pure-JS zip, no native dependency (backup.js).
ipcMain.handle('projects:backup', authed(async () => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Back up project files',
    defaultPath: path.join(app.getPath('documents'), `timesheet-projects-backup-${stamp}.zip`),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }],
  });
  if (canceled || !filePath) return { ok: false };
  try {
    const { fileCount, byteCount } = backup.zipDirectory(db.projectsRootDir(), filePath);
    return { ok: true, path: filePath, fileCount, byteCount };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}));

// ── Maintenance panel (Milestone 6) ──
ipcMain.handle('maintenance:listBackups', authed(() => db.listBackups()));
// The single riskiest handler in the app: replaces the live DB file, then
// relaunches. db.restoreBackup() already validates the filename against the
// real backups/ listing and takes a forced pre-restore backup before touching
// anything; if it reports ok, the app MUST restart for a fresh
// db.openConnection() to pick up the restored file — there is no safe way to
// keep running against the connection that was just closed out from under it.
ipcMain.handle('maintenance:restoreBackup', authed((_e, filename) => {
  const res = db.restoreBackup(filename);
  if (res.ok) { app.relaunch(); app.exit(0); }
  return res;
}));
ipcMain.handle('maintenance:integrityCheck', authed(() => db.checkIntegrity()));
ipcMain.handle('maintenance:lookupDuplicates', authed(() => db.findLookupDuplicates()));
ipcMain.handle('maintenance:mergeLookups', authed((_e, category, targetId, sourceId) => db.mergeLookupDuplicate(category, targetId, sourceId)));
ipcMain.handle('maintenance:orphanSweepReport', authed(() => db.getOrphanSweepReport()));

// One-click Full Backup (Milestone 8) — captures the DB, projects/ and
// company_documents/ file trees, and the rotating backups/ snapshots into a
// single new timestamped folder on the Desktop. db.fullBackup() never imports
// electron, so it's handed the resolved Desktop path here (same separation
// configureCredentialEncryption() already established).
ipcMain.handle('maintenance:fullBackup', authed(() => {
  try { return db.fullBackup(app.getPath('desktop')); }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
}));
// Opens the folder a just-completed full backup was written to. Never trusts
// an arbitrary path from the renderer: only a direct child of the Desktop
// whose name matches the fixed prefix db.fullBackup() itself generates is
// allowed through to shell.openPath.
ipcMain.handle('maintenance:openBackupFolder', authed((_e, folderPath) => {
  const desktop = app.getPath('desktop');
  const resolved = path.resolve(String(folderPath || ''));
  if (path.dirname(resolved) !== desktop || !path.basename(resolved).startsWith('CooperationTools-Backup-')) {
    return { ok: false, error: 'invalid path' };
  }
  shell.openPath(resolved);
  return { ok: true };
}));

// ── Export a report HTML document to a PDF file (native "Save as" dialog) ──
// Renders the supplied self-contained HTML in an offscreen window, prints it to
// PDF via Chromium, and writes the chosen file. Read-only; touches no app data.
ipcMain.handle('report:exportPDF', authed(async (_e, html, defaultName) => {
  let pdfWin;
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save report as PDF',
      defaultPath: defaultName || 'report.pdf',
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false };

    pdfWin = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // Give webfonts/layout a beat to settle before snapshotting.
    await new Promise(r => setTimeout(r, 350));
    const pdf = await pdfWin.webContents.printToPDF({ printBackground: true, margins: { marginType: 'default' } });
    fs.writeFileSync(filePath, pdf);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    if (pdfWin && !pdfWin.isDestroyed()) pdfWin.destroy();
  }
}));

// ── Close handshake ──
ipcMain.handle('app:flushComplete', () => {
  clearTimeout(closeFallback);
  allowClose = true;
  if (win && !win.isDestroyed()) win.close();
});

// ── Security status (read-only, not user-scoped — no authed() needed) ──
// Whether client credentials (Clients page) are actually being encrypted at
// rest this run — surfaced as a Settings banner when false (safeStorage
// unavailable, e.g. a locked-down environment with no OS keychain).
ipcMain.handle('security:credentialEncryptionStatus', () => ({ available: db.isCredentialEncryptionAvailable() }));

// ── Window controls ──
ipcMain.handle('window:setTitle',   (_e, title) => { if (win) win.setTitle(title); });
ipcMain.handle('shell:openExternal', (_e, url)  => {
  // Only ever hand off real web links to the OS — never file:, javascript:, etc.
  try {
    const u = new URL(String(url));
    if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.href);
  } catch { /* not a valid URL — ignore */ }
});

// Dev convenience: load KEY=VALUE pairs from a local .env into process.env.
// Only in development — packaged builds ignore it so a stray .env can't alter a
// shipped app. Existing environment variables always win.
function loadDotEnv() {
  try {
    if (app.isPackaged) return;
    const file = path.join(__dirname, '.env');
    if (!fs.existsSync(file)) return;
    const re = /^\s*(\w+)\s*=\s*(.*)\s*$/;
    for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
      const m = re.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* non-critical */ }
}

app.whenReady().then(() => {
  // Optional data-directory override (see .env.example). Lets the store live
  // somewhere other than the default userData folder — handy for testing or a
  // portable install. Must be set before any path is read.
  loadDotEnv();
  if (process.env.COOPERATION_TOOLS_DATA_DIR) {
    app.setPath('userData', process.env.COOPERATION_TOOLS_DATA_DIR);
  }

  // Boot the data layer in three explicit, sequential steps: open the embedded
  // SQLite connection, bring the schema to the latest version via the versioned
  // migration runner, then run best-effort maintenance (backup rotation).
  try {
    // Wire up client-credential encryption (Milestone 2) BEFORE the DB opens/
    // migrates: migration 032's one-time encrypt pass needs the cipher already
    // configured. db.js never touches `electron` itself (it must stay
    // requireable under plain Node for the test/*.js smoke tests), so this is
    // the one and only place `safeStorage` is used — never exposed to the
    // renderer via preload.
    db.configureCredentialEncryption(safeStorage);
    if (!db.isCredentialEncryptionAvailable()) {
      console.warn('[security] safeStorage unavailable — client credentials will be stored in plain text this run.');
    }
    db.openConnection(app.getPath('userData'));
    // Path verification (Phase 1): confirm the project-files root shares the same
    // userData root as the live DB BEFORE any file is ever written. Logged once at
    // boot so the resolved locations can be eyeballed against the real data folder.
    console.log('[paths] userData dir     :', app.getPath('userData'));
    console.log('[paths] database file    :', db.dbPath());
    console.log('[paths] project files root:', db.projectsRootDir());
    db.applyMigrations();
    db.runMaintenance();
  } catch (err) {
    // A failed DB open (locked, corrupt, permissions) must not leave the user
    // with an invisible, windowless process — surface it and exit.
    dialog.showErrorBox(
      'Cooperation Tools — database error',
      'The data store could not be opened, so the app cannot start.\n\n' +
      String(err?.message || err) +
      '\n\nYour data folder:\n' + app.getPath('userData')
    );
    app.quit();
    return;
  }
  createWindow();
});
app.on('window-all-closed', () => {
  db.close();   // checkpoint WAL + close handle cleanly
  if (process.platform !== 'darwin') app.quit();
});