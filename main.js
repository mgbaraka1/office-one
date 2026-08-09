const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const db     = require('./db');
const auth   = require('./auth');
const { validateIpcArgs } = require('./ipc-contracts');

const e2ePort = !app.isPackaged ? Number(process.env.COOPERATION_TOOLS_E2E_PORT) : 0;
const isE2ERun = Number.isInteger(e2ePort) && e2ePort > 0 && e2ePort <= 65535;
if (isE2ERun) app.commandLine.appendSwitch('remote-debugging-port', String(e2ePort));

// Chromium's native <input type="date/month"> pickers render their calendar
// and digits from the OS's regional format (Windows "use native digits"),
// not from the page's <html lang> or even a per-element lang attribute —
// neither is enough to stop Arabic-Indic numerals leaking into the English
// UI on an Arabic-region Windows install. This is the one override Chromium
// does honor, and it has to be a startup switch (can't change mid-session),
// so it can't track the in-app EN/AR toggle — 'en-US' matches the app's own
// default language and keeps dates/numbers in a consistent Latin/Gregorian
// format even for Arabic-mode users, rather than following the OS silently.
app.commandLine.appendSwitch('lang', 'en-US');

// Resolve any dev/portable data-directory override (see .env.example) BEFORE
// requesting the single-instance lock below, so the lock is scoped to the
// actual data directory this process will use rather than always the OS
// default — a deliberately isolated run (the E2E harness, a dev override)
// doesn't collide with a real production instance's lock, while two
// processes aimed at the SAME data directory (including two production
// launches) still correctly collide. Moved here from inside
// app.whenReady() for exactly this reason; nothing reads app.getPath()
// before this runs.
loadDotEnv();
if (process.env.COOPERATION_TOOLS_DATA_DIR) {
  app.setPath('userData', process.env.COOPERATION_TOOLS_DATA_DIR);
}

// Stop a second process from ever opening the same live cooperation-tools.db
// concurrently. The first instance to reach this line keeps running and gets
// focused on a second launch attempt; every later instance quits immediately,
// before it ever touches the database.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Neither Node nor Electron surfaces a crash to the user by default — an
// uncaught main-process error otherwise dies silently (no window, no message,
// just a vanished process). Log it and tell the user instead of disappearing.
function reportFatalMainProcessError(title, err) {
  console.error('[' + title + ']', err);
  try {
    dialog.showErrorBox(
      'Office ONE — unexpected error',
      'An unexpected error occurred.\n\n' + String(err?.stack || err?.message || err)
    );
  } catch { /* dialog itself unavailable (e.g. before app.whenReady) — logging above is the fallback */ }
}
process.on('uncaughtException', (err) => reportFatalMainProcessError('uncaughtException', err));
process.on('unhandledRejection', (reason) => reportFatalMainProcessError('unhandledRejection', reason));

let copiedSecret = '';
let copiedSecretTimer = null;
function clearCopiedSecret() {
  clearTimeout(copiedSecretTimer);
  copiedSecretTimer = null;
  if (copiedSecret && clipboard.readText() === copiedSecret) clipboard.clear();
  copiedSecret = '';
}

// Every invoke crosses this one executable contract boundary before its
// authentication/authorization wrapper or handler runs. Adding a channel
// without adding a contract fails closed and is caught by the contract smoke
// test, so payload validation cannot silently drift behind the preload bridge.
const registerIpcHandler = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => registerIpcHandler(channel, (event, ...args) => {
  validateIpcArgs(channel, args);
  return listener(event, ...args);
});

// Wrap a data IPC handler so it fails closed when no one is logged in. Every
// handler that reads or writes user data goes through this — the renderer can
// never reach the data layer before authenticating.
function authed(handler) {
  return (event, ...args) => {
    assertTrustedSender(event);
    if (!auth.isAuthenticated()) throw new Error('Not authenticated');
    return handler(event, ...args);
  };
}

function trusted(handler) {
  return (event, ...args) => {
    assertTrustedSender(event);
    return handler(event, ...args);
  };
}

function admin(handler) {
  return authed((event, ...args) => {
    auth.requireAdmin();
    return handler(event, ...args);
  });
}

function assertTrustedSender(event) {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) throw new Error('Untrusted IPC sender');
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (senderUrl !== win.webContents.getURL()) throw new Error('Untrusted IPC origin');
}

let win;
let allowClose = false;       // set once the renderer has flushed pending saves
let selectedFullBackup = null; // main-process-only path chosen through the native folder dialog

function createWindow() {
  const prefs = db.loadPrefs();
  win = new BrowserWindow({
    show:      !isE2ERun,
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
      sandbox: true,
      nodeIntegration: false,
    },
    title: 'Office ONE',
  });
  if (prefs.maximized) win.maximize();
  win.loadFile('index.html');
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  // Defense in depth: the app is a single local page. Deny every renderer-created
  // window; printing uses a main-process-owned, sandboxed window below.
  win.webContents.setWindowOpenHandler(({ url }) => {
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

  // A crashed or hung renderer would otherwise leave a blank/frozen window with
  // no way back in short of force-quitting the whole app from Task Manager.
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[render-process-gone]', details);
    const choice = dialog.showMessageBoxSync(win, {
      type: 'error',
      title: 'Office ONE — window crashed',
      message: 'The app\'s window stopped working and needs to reload.',
      detail: 'Reason: ' + details.reason,
      buttons: ['Reload', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0) win.reload(); else app.quit();
  });
  win.on('unresponsive', () => {
    console.error('[renderer unresponsive]');
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      title: 'Office ONE — not responding',
      message: 'The app is not responding.',
      detail: 'You can keep waiting for it to recover, or reload the window.',
      buttons: ['Wait', 'Reload'],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) win.reload();
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
    }
  });
}

// ── Authentication (ungated — these are the gate) ──
ipcMain.handle('auth:status',      trusted(()                     => auth.status()));
ipcMain.handle('auth:setup',       trusted((_e, username, pass)   => auth.setup(username, pass)));
ipcMain.handle('auth:login',       trusted((_e, username, pass)   => auth.login(username, pass)));
ipcMain.handle('auth:logout', trusted(() => {
  clearCopiedSecret();
  return auth.logout();
}));
ipcMain.handle('auth:listUsers',   authed(()                            => auth.listUsers()));
ipcMain.handle('auth:addUser',     admin((_e, username, pass, isAdmin, nameEn, nameAr) => auth.addUser(username, pass, isAdmin, nameEn, nameAr)));
ipcMain.handle('auth:updateUser',  authed((_e, id, data)               => auth.updateUser(id, data)));

// ── App metadata (read-only) ──
// Resolve this from Electron/package.json at runtime so the renderer never has
// a second, manually-maintained version string that can drift during releases.
ipcMain.handle('app:version', trusted(() => app.getVersion()));

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

// ── Analytics (aggregation done in SQL, not in the renderer) ──
ipcMain.handle('analytics:summary',  authed((_e, from, to, spanFrom, spanTo) => db.getAnalytics(auth.requireUserId(), from, to, spanFrom, spanTo)));
ipcMain.handle('analytics:overview', authed((_e, today, monthStart)          => db.getOverviewStats(auth.requireUserId(), today, monthStart)));
ipcMain.handle('attention:list', authed(() => db.getAttentionItems(auth.requireUserId())));
ipcMain.handle('activity:list', authed(() => db.getRecentActivity(auth.requireUserId())));

// ── Lookups (normalized catalog — shared app config) ──
ipcMain.handle('lookups:get',         authed(()                              => db.loadLookups(auth.requireUserId())));
ipcMain.handle('lookups:save', authed((_e, data) => {
  const user = auth.currentUser();
  if (data?.categories && !user?.isAdmin) throw new Error('Administrator access required');
  return db.saveLookups(auth.requireUserId(), data);
}));

// ── Subscriptions ──
ipcMain.handle('subscriptions:list', authed(()         => db.loadSubscriptions(auth.requireUserId())));
ipcMain.handle('subscriptions:save', authed((_e, data) => db.saveSubscriptions(auth.requireUserId(), data)));

// ── Tasks (two-level model — standalone, date-independent unit of work) ──
// A task with zero work_logs is a "not yet started" task, created only through
// Projects (which requires a project link) since there's no day-agnostic browse
// page for it anymore.
ipcMain.handle('tasks:list',   authed(()             => db.listTasks(auth.requireUserId())));
ipcMain.handle('tasks:index',  authed(()             => db.getTasksIndex(auth.requireUserId())));
ipcMain.handle('search:workspace', authed((_e, query, limit) => db.searchWorkspace(auth.requireUserId(), query, limit)));
ipcMain.handle('tasks:get',    authed((_e, id)       => db.getTask(auth.requireUserId(), id)));
ipcMain.handle('tasks:history', authed((_e, id)      => db.getTaskFieldHistory(auth.requireUserId(), id)));
ipcMain.handle('tasks:create', authed((_e, data)     => db.createTask(auth.requireUserId(), data)));
ipcMain.handle('tasks:update', authed((_e, id, data) => db.updateTask(auth.requireUserId(), id, data)));
// Metadata-only update (name/status/company/system/source) — never touches
// project_id/department_id/support_year_id. The Timesheet reconciler/Edit
// Record modal use this instead of tasks:update, which is reserved for the
// actual link editors (openBacklogModal, Projects/Internal Tasks/All Tasks).
ipcMain.handle('tasks:update-meta', authed((_e, id, data) => db.updateTaskMeta(auth.requireUserId(), id, data)));
ipcMain.handle('tasks:delete', authed((_e, id)       => db.deleteTask(auth.requireUserId(), id)));
ipcMain.handle('tasks:merge',  authed((_e, sourceId, targetId) => db.mergeTasks(auth.requireUserId(), sourceId, targetId)));

// ── Task Sources (structured source list — migration 033) ──
ipcMain.handle('tasks:source-create', authed((_e, taskId, data) => db.createTaskSource(auth.requireUserId(), taskId, data)));
ipcMain.handle('tasks:source-update', authed((_e, id, data)     => db.updateTaskSource(auth.requireUserId(), id, data)));
ipcMain.handle('tasks:source-delete', authed((_e, id)           => db.deleteTaskSource(auth.requireUserId(), id)));

// ── Work logs (v2 — dated work sessions belonging to a task) ──
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

// ── Departments (Internal Work) — DEPARTMENT is a plain lookup category, not a
// table; there is no departments:create/update/delete, only listing. Task CRUD
// for the internal domain lives under internal:* below, not here — see
// Client and Internal are separate domains: a
// task cannot be cross-linked between them, only explicitly converted").
ipcMain.handle('departments:list', authed(() => db.listDepartments(auth.requireUserId())));
ipcMain.handle('departments:get',  authed((_e, id) => db.getDepartment(auth.requireUserId(), id)));

// ── Internal tasks (INTERNAL domain — department-classified, never a client) ──
// The internal-domain counterpart of the tasks:* channels above, which are now
// CLIENT-domain only. A task moves between the two domains only through the
// explicit convert-* channels, never through a link/unlink pair.
ipcMain.handle('internal:list',   authed(()             => db.listInternalTasks(auth.requireUserId())));
ipcMain.handle('internal:create', authed((_e, data)     => db.createInternalTask(auth.requireUserId(), data)));
ipcMain.handle('internal:update', authed((_e, id, data) => db.updateInternalTask(auth.requireUserId(), id, data)));
ipcMain.handle('internal:delete', authed((_e, id)       => db.deleteTask(auth.requireUserId(), id)));
ipcMain.handle('internal:convert-to-client',   authed((_e, id, data) => db.convertTaskToClient(auth.requireUserId(), id, data)));
ipcMain.handle('tasks:convert-to-internal',    authed((_e, id, data) => db.convertTaskToInternal(auth.requireUserId(), id, data)));

// ── Project document files (Option A: bytes on disk under userData) ──
// Allowlist mirrors db.PROJECT_DOC_TYPES; the native dialog also filters by it so
// the user only sees permitted types (the db layer re-validates regardless).
const DOC_UPLOAD_EXTENSIONS = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'gif', 'webp'];
const KNOWLEDGE_UPLOAD_EXTENSIONS = [...DOC_UPLOAD_EXTENSIONS, 'xls', 'xlsx', 'txt'];
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
ipcMain.handle('projects:restore-document', authed((_e, projectId, documentType, fileMeta) =>
  db.restoreProjectDocumentFile(auth.requireUserId(), projectId, documentType, fileMeta)));
ipcMain.handle('projects:purge-document-file', authed((_e, projectId, relPath) =>
  db.purgeUnreferencedProjectDocumentFile(auth.requireUserId(), projectId, relPath)));
// Delete-undo file handling: purge the whole folder when the undo window lapses,
// or move it onto the re-created project's new id when the user undoes.
ipcMain.handle('projects:purge-files',  authed((_e, projectId)            => db.purgeProjectFiles(auth.requireUserId(), projectId)));
ipcMain.handle('projects:restore-files', authed((_e, oldId, newId, docs)  => db.restoreProjectFiles(auth.requireUserId(), oldId, newId, docs)));

// ── Company Documents (standalone card-per-document module) ──
ipcMain.handle('companydocs:list',   authed(()             => db.listCompanyDocuments(auth.requireUserId())));
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
ipcMain.handle('companydocs:restore-document', authed((_e, id, fileMeta) =>
  db.restoreRemovedCompanyDocumentFile(auth.requireUserId(), id, fileMeta)));
ipcMain.handle('companydocs:purge-document-file', authed((_e, id, relPath) =>
  db.purgeUnreferencedCompanyDocumentFile(auth.requireUserId(), id, relPath)));
// Delete-undo file handling: purge the card's folder when the undo window
// lapses, or move it onto the re-created card's new id when the user undoes.
ipcMain.handle('companydocs:purge-files',   authed((_e, id)                     => db.purgeCompanyDocumentFiles(auth.requireUserId(), id)));
ipcMain.handle('companydocs:restore-file',  authed((_e, oldId, newId, fileMeta) => db.restoreCompanyDocumentFile(auth.requireUserId(), oldId, newId, fileMeta)));

// ── Knowledge Hub ──
ipcMain.handle('knowledge:list',    authed(()             => db.listKnowledgeItems(auth.requireUserId())));
ipcMain.handle('knowledge:get',     authed((_e, id)       => db.getKnowledgeItem(auth.requireUserId(), id)));
ipcMain.handle('knowledge:create',  authed((_e, data)     => db.createKnowledgeItem(auth.requireUserId(), data)));
ipcMain.handle('knowledge:update',  authed((_e, id, data) => db.updateKnowledgeItem(auth.requireUserId(), id, data)));
ipcMain.handle('knowledge:delete',  authed((_e, id)       => db.deleteKnowledgeItem(auth.requireUserId(), id)));
ipcMain.handle('knowledge:restore', authed((_e, oldId, snapshot) => db.restoreKnowledgeItem(auth.requireUserId(), oldId, snapshot)));
ipcMain.handle('knowledge:groups-list', authed(() => db.listKnowledgeGroups(auth.requireUserId())));
ipcMain.handle('knowledge:group-create', authed((_e, data) => db.createKnowledgeGroup(auth.requireUserId(), data)));
ipcMain.handle('knowledge:group-update', authed((_e, id, data) => db.updateKnowledgeGroup(auth.requireUserId(), id, data)));
ipcMain.handle('knowledge:group-delete', authed((_e, id) => db.deleteKnowledgeGroup(auth.requireUserId(), id)));
ipcMain.handle('knowledge:upload-attachment', authed(async (_e, itemId, documentMeta) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose document file', properties: ['openFile'],
    filters: [
      { name: 'Knowledge files', extensions: KNOWLEDGE_UPLOAD_EXTENSIONS },
      { name: 'PDF', extensions: ['pdf'] }, { name: 'Word', extensions: ['doc', 'docx'] },
      { name: 'Excel', extensions: ['xls', 'xlsx'] }, { name: 'Text', extensions: ['txt'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
    ],
  });
  if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
  return db.saveKnowledgeAttachment(auth.requireUserId(), itemId, filePaths[0], documentMeta);
}));
ipcMain.handle('knowledge:download-attachment', authed(async (_e, attachmentId) => {
  const r = db.resolveKnowledgeAttachment(auth.requireUserId(), attachmentId);
  if (!r.ok) return r;
  if (!r.exists) return { ok: false, error: 'The attachment is missing from disk' };
  const { canceled, filePath } = await dialog.showSaveDialog(win, { title: 'Save attachment as', defaultPath: r.originalName });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try { fs.copyFileSync(r.absPath, filePath); return { ok: true, path: filePath }; }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
}));
ipcMain.handle('knowledge:open-attachment', authed(async (_e, attachmentId) => {
  const r = db.resolveKnowledgeAttachment(auth.requireUserId(), attachmentId);
  if (!r.ok) return r;
  if (!r.exists) return { ok: false, error: 'The attachment is missing from disk' };
  const error = await shell.openPath(r.absPath);
  return error ? { ok: false, error } : { ok: true };
}));
ipcMain.handle('knowledge:remove-attachment', authed((_e, attachmentId) => db.removeKnowledgeAttachment(auth.requireUserId(), attachmentId)));
ipcMain.handle('knowledge:restore-attachment', authed((_e, itemId, fileMeta) => db.restoreKnowledgeAttachment(auth.requireUserId(), itemId, fileMeta)));
ipcMain.handle('knowledge:purge-attachment', authed((_e, itemId, relPath) => db.purgeKnowledgeAttachment(auth.requireUserId(), itemId, relPath)));
ipcMain.handle('knowledge:purge-files', authed((_e, itemId) => db.purgeKnowledgeFiles(auth.requireUserId(), itemId)));

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
ipcMain.handle('clients:internal-create', authed((_e, companyId, data) => db.createClientInternalSystem(auth.requireUserId(), companyId, data)));
ipcMain.handle('clients:internal-update', authed((_e, id, data)        => db.updateClientInternalSystem(auth.requireUserId(), id, data)));
ipcMain.handle('clients:internal-delete', authed((_e, id)              => db.deleteClientInternalSystem(auth.requireUserId(), id)));
ipcMain.handle('clients:internal-rename-group', authed((_e, companyId, oldName, newName) => db.renameClientInternalSystemGroup(auth.requireUserId(), companyId, oldName, newName)));
ipcMain.handle('clients:internal-assign-group', authed((_e, companyId, recordIds, groupName) => db.assignClientInternalGroup(auth.requireUserId(), companyId, recordIds, groupName)));
ipcMain.handle('clients:field-history', authed((_e, recordType, recordId) => db.getClientFieldHistory(auth.requireUserId(), recordType, recordId)));

// ── UI state (Milestone 11 — this-machine-only, like window prefs, but the
// renderer needs read/write access since only it knows which module/filter
// UI is active) ──
ipcMain.handle('ui:getState', authed(() => db.loadUiState(auth.requireUserId())));
ipcMain.handle('ui:setState', authed((_e, state) => { db.saveUiState(auth.requireUserId(), state); return { ok: true }; }));
ipcMain.handle('ui:getKnowledgeDraft', authed(() => db.loadKnowledgeDraft(auth.requireUserId())));
ipcMain.handle('ui:saveKnowledgeDraft', authed((_e, draft) => { db.saveKnowledgeDraft(auth.requireUserId(), draft); return { ok: true }; }));
ipcMain.handle('ui:clearKnowledgeDraft', authed(() => { db.saveKnowledgeDraft(auth.requireUserId(), null); return { ok: true }; }));

// ── Per-account UI preferences (theme/density/canvas/motion/sidebar/timesheet
// view) — see db.js's USER_PREFERENCES for the allowlisted keys/values. ──
ipcMain.handle('preferences:get', authed(() => db.getUserPreferences(auth.requireUserId())));
ipcMain.handle('preferences:set', authed((_e, key, value) => db.setUserPreference(auth.requireUserId(), key, value)));

// ── Backup ──
ipcMain.handle('db:backup', admin(async () => {
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

// ── Maintenance panel (Milestone 6) ──
ipcMain.handle('maintenance:listBackups', admin(() => db.listBackups()));
// The single riskiest handler in the app: replaces the live DB file, then
// relaunches. db.restoreBackup() already validates the filename against the
// real backups/ listing and takes a forced pre-restore backup before touching
// anything; if it reports ok, the app MUST restart for a fresh
// db.openConnection() to pick up the restored file — there is no safe way to
// keep running against the connection that was just closed out from under it.
ipcMain.handle('maintenance:restoreBackup', admin((_e, filename) => {
  const res = db.restoreBackup(filename);
  if (res.ok) { app.relaunch(); app.exit(0); }
  return res;
}));
ipcMain.handle('maintenance:integrityCheck', admin(() => db.checkIntegrity()));
ipcMain.handle('maintenance:diagnostics', admin(() => db.getSystemDiagnostics()));
ipcMain.handle('maintenance:lookupDuplicates', admin(() => db.findLookupDuplicates()));
ipcMain.handle('maintenance:mergeLookups', admin((_e, category, targetId, sourceId) => db.mergeLookupDuplicate(category, targetId, sourceId)));
ipcMain.handle('maintenance:orphanSweepReport', admin(() => db.getOrphanSweepReport()));

// One-click Full Backup (Milestone 8) — captures the DB, projects/ and
// company_documents/ and knowledge_hub/ file trees, and the rotating backups/ snapshots into a
// single new timestamped folder on the Desktop. db.fullBackup() never imports
// electron, so it's handed the resolved Desktop path here (same separation
// configureCredentialEncryption() already established).
ipcMain.handle('maintenance:fullBackup', admin(() => {
  try { return db.fullBackup(app.getPath('desktop')); }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
}));
ipcMain.handle('maintenance:selectFullBackup', admin(async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose a Office ONE full backup folder',
    properties: ['openDirectory'],
  });
  if (canceled || !filePaths[0]) return { ok: false, canceled: true };
  const inspection = db.inspectFullBackup(filePaths[0]);
  selectedFullBackup = inspection.ok ? inspection.path : null;
  return inspection;
}));
ipcMain.handle('maintenance:restoreSelectedFullBackup', admin(() => {
  if (!selectedFullBackup) return { ok: false, error: 'No validated full backup is selected' };
  const selected = selectedFullBackup;
  selectedFullBackup = null;
  const res = db.restoreFullBackup(selected);
  if (res.ok) { app.relaunch(); app.exit(0); }
  return res;
}));
// Opens the folder a just-completed full backup was written to. Never trusts
// an arbitrary path from the renderer: only a direct child of the Desktop
// whose name matches one of the prefixes db.fullBackup()/db.inspectFullBackup()
// themselves recognize (db.FULL_BACKUP_PREFIXES) is allowed through to
// shell.openPath.
ipcMain.handle('maintenance:openBackupFolder', admin((_e, folderPath) => {
  const desktop = app.getPath('desktop');
  const resolved = path.resolve(String(folderPath || ''));
  const base = path.basename(resolved);
  if (path.dirname(resolved) !== desktop || !db.FULL_BACKUP_PREFIXES.some(prefix => base.startsWith(prefix))) {
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
    const reportHtml = String(html || '');
    if (!reportHtml || Buffer.byteLength(reportHtml, 'utf8') > 10 * 1024 * 1024) {
      return { ok: false, error: 'Report content is empty or too large' };
    }
    const safeDefaultName = path.basename(String(defaultName || 'report.pdf')).slice(0, 180) || 'report.pdf';
    // E2E-only: the native save dialog can't be driven over CDP, so the
    // Electron E2E harness (isE2ERun, never true in a packaged build) may
    // point this at a disposable path instead of showing a real dialog.
    const e2ePdfPath = isE2ERun ? process.env.COOPERATION_TOOLS_E2E_PDF_PATH : null;
    const { canceled, filePath } = e2ePdfPath
      ? { canceled: false, filePath: e2ePdfPath }
      : await dialog.showSaveDialog(win, {
          title: 'Save report as PDF',
          defaultPath: safeDefaultName,
          filters: [{ name: 'PDF document', extensions: ['pdf'] }],
        });
    if (canceled || !filePath) return { ok: false };

    pdfWin = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    });
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(reportHtml));
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

ipcMain.handle('report:exportCSV', authed(async (_e, csv, defaultName) => {
  try {
    const content = String(csv || '');
    if (!content || Buffer.byteLength(content, 'utf8') > 10 * 1024 * 1024) {
      return { ok: false, error: 'CSV content is empty or too large' };
    }
    const safeDefaultName = path.basename(String(defaultName || 'report.csv')).slice(0, 180) || 'report.csv';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save report data as CSV',
      defaultPath: safeDefaultName,
      filters: [{ name: 'CSV spreadsheet', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { ok: false };
    fs.writeFileSync(filePath, '\uFEFF' + content, 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}));

ipcMain.handle('report:print', authed(async (_e, html) => {
  let printWin;
  try {
    const reportHtml = String(html || '');
    if (!reportHtml || Buffer.byteLength(reportHtml, 'utf8') > 10 * 1024 * 1024) {
      return { ok: false, error: 'Report content is empty or too large' };
    }
    printWin = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    });
    await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(reportHtml));
    await new Promise(r => setTimeout(r, 350));
    return await new Promise(resolve => {
      printWin.webContents.print({ printBackground: true }, (success, failureReason) => {
        resolve(success ? { ok: true } : { ok: false, error: failureReason || 'Printing failed' });
      });
    });
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    if (printWin && !printWin.isDestroyed()) printWin.destroy();
  }
}));

// ── Close handshake ──
ipcMain.handle('app:flushComplete', trusted(() => {
  allowClose = true;
  if (win && !win.isDestroyed()) win.close();
}));
ipcMain.handle('app:cancelClose', trusted(() => {
  return { ok: true };
}));
ipcMain.handle('app:confirmSaveFailure', trusted(async (_e, error, action = 'close') => {
  const loggingOut = action === 'logout';
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Unsaved changes',
    message: 'Some changes could not be saved.',
    detail: String(error || 'Unknown save error'),
    buttons: ['Retry', loggingOut ? 'Cancel logout' : 'Cancel close', loggingOut ? 'Log out without saving' : 'Close without saving'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return ['retry', 'cancel', 'discard'][result.response] || 'cancel';
}));

// ── Security status (read-only, not user-scoped — no authed() needed) ──
// Whether client credentials (Clients page) are actually being encrypted at
// rest this run — surfaced as a Settings banner when false (safeStorage
// unavailable, e.g. a locked-down environment with no OS keychain).
ipcMain.handle('security:credentialEncryptionStatus', trusted(() => ({ available: db.isCredentialEncryptionAvailable() })));
ipcMain.handle('security:copySecret', authed((_e, value) => {
  const secret = String(value || '');
  if (!secret || Buffer.byteLength(secret, 'utf8') > 16 * 1024) throw new Error('Invalid secret value');
  clearCopiedSecret();
  clipboard.writeText(secret);
  copiedSecret = secret;
  copiedSecretTimer = setTimeout(clearCopiedSecret, 30_000);
  return { ok: true, clearsInSeconds: 30 };
}));

// ── Window controls ──
ipcMain.handle('window:setTitle', trusted((_e, title) => { if (win) win.setTitle(String(title || '').slice(0, 200)); }));
ipcMain.handle('shell:openExternal', authed((_e, url)  => {
  // Only ever hand off real web links to the OS — never file:, javascript:, etc.
  try {
    const u = new URL(String(url));
    if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.href);
  } catch { /* not a valid URL — ignore */ }
}));

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
  // The optional data-directory override (see .env.example) is resolved
  // earlier now, before the single-instance lock request above — see that
  // block's comment for why.

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
      console.warn('[security] safeStorage unavailable — saving client passwords and secret keys is blocked.');
    }
    db.openConnection(app.getPath('userData'));
    // Path verification (Phase 1): confirm the project-files root shares the same
    // userData root as the live DB BEFORE any file is ever written. Logged once at
    // boot so the resolved locations can be eyeballed against the real data folder.
    console.log('[paths] userData dir     :', app.getPath('userData'));
    console.log('[paths] database file    :', db.dbPath());
    console.log('[paths] project files root:', db.projectsRootDir());
    db.applyMigrations();
    const maintenance = db.runMaintenance();
    createWindow();
    if (maintenance?.backup?.ok === false) {
      dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Automatic backup failed',
        message: 'The app opened, but its launch backup could not be created.',
        detail: maintenance.backup.error || 'Check the data-folder permissions and available disk space.',
      });
    }
  } catch (err) {
    // A failed DB open (locked, corrupt, permissions) must not leave the user
    // with an invisible, windowless process — surface it and exit.
    dialog.showErrorBox(
      'Office ONE — database error',
      'The data store could not be opened, so the app cannot start.\n\n' +
      String(err?.message || err) +
      '\n\nYour data folder:\n' + app.getPath('userData')
    );
    app.quit();
    return;
  }
});
app.on('window-all-closed', () => {
  clearCopiedSecret();
  db.close();   // checkpoint WAL + close handle cleanly
  if (process.platform !== 'darwin') app.quit();
});
