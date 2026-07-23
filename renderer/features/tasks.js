// ── Project index (lightweight {id,name,status} cache for the Project field) ──
// The timesheet and project task views let a task be linked to a project; both need the
// project names available even before the Projects module is first opened. This
// cache is loaded at boot (refreshProjectIndex) and kept in sync whenever the full
// list is (re)loaded (syncProjectIndex).
function syncProjectIndex() {
  projectIndex = projectsList.map(p => ({ id: p.id, name: p.name, status: p.status }));
}
async function refreshProjectIndex() {
  try {
    const list = await window.api.listProjects();
    projectIndex = Array.isArray(list) ? list.map(p => ({ id: p.id, name: p.name, status: p.status })) : [];
  } catch { /* keep whatever we had */ }
}
// A linked project's display name (''→ none / unknown).
function projectNameById(id) {
  if (id == null || id === '') return '';
  const p = projectIndex.find(x => x.id === Number(id));
  return p ? p.name : '';
}
// Options for a task's Project field: active projects, plus the currently-linked
// one if it is no longer active (so an existing link is never silently dropped).
function projectFieldOptions(currentId) {
  const opts = projectIndex.filter(p => p.status === 'ACTIVE').map(p => ({ id: p.id, label: p.name }));
  if (currentId != null && currentId !== '' && !opts.some(o => o.id === Number(currentId))) {
    const p = projectIndex.find(x => x.id === Number(currentId));
    if (p) opts.push({ id: p.id, label: p.name + ' (' + pjStatusLabel(p.status).toLowerCase() + ')' });
  }
  return opts;
}
// Build a compact pill naming the linked project (for a table row), or null.
// The pill cross-links into the project's detail view.
function projectRowTag(projectId) {
  const name = projectNameById(projectId);
  if (!name) return null;
  const tag = document.createElement('span');
  tag.className = 'row-project-tag clickable';
  tag.innerHTML = ic('clipboard-list');
  const textEl = document.createElement('span');
  textEl.className = 'row-tag-text';
  textEl.textContent = name;
  tag.appendChild(textEl);
  tag.title = 'Open project: ' + name;
  tag.addEventListener('click', (e) => { e.stopPropagation(); openProjectById(Number(projectId)); });
  return tag;
}
// Jump straight to a project's detail view from anywhere in the app.
function openProjectById(id) {
  switchModule('projects');
  openProjectDetail(id);
}

// Milestone 9 — the Internal-task counterpart to projectRowTag: a task is
// Project work, Internal (department) work, or neither, never both, so this
// and projectRowTag are never both non-null for the same task. Uses its own
// accent (teal, via the .row-department-tag class) so the two pills read as
// distinct species at a glance, not just different text.
function departmentRowTag(departmentId) {
  const name = lkLabelById('DEPARTMENT', departmentId);
  if (!name) return null;
  const tag = document.createElement('span');
  tag.className = 'row-department-tag clickable';
  tag.innerHTML = ic('building');
  const textEl = document.createElement('span');
  textEl.className = 'row-tag-text';
  textEl.textContent = name;
  tag.appendChild(textEl);
  tag.title = 'Open department: ' + name;
  tag.addEventListener('click', (e) => { e.stopPropagation(); openDepartmentById(Number(departmentId)); });
  return tag;
}
// Jump straight to a department's task panel from anywhere in the app.
function openDepartmentById(id) {
  switchModule('internal-tasks');
  selectDept(id);
}

// Milestone 11 — scroll to and briefly highlight a specific card/row after a
// deep link (palette hits and Attention-panel items alike) switches modules.
// Polls briefly rather than requiring every module's init function to expose
// a promise — switchModule() itself doesn't await its target module's own
// data load, so the element may not exist in the DOM yet on the first check.
function scrollToAndHighlight(selector, attemptsLeft = 20) {
  const el = document.querySelector(selector);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('deep-link-highlight');
    setTimeout(() => el.classList.remove('deep-link-highlight'), 1800);
    return;
  }
  if (attemptsLeft > 0) setTimeout(() => scrollToAndHighlight(selector, attemptsLeft - 1), 100);
}

// ── Task Detail modal — the task's session hub: metadata + rollups (read-only)
// plus every work_log session, newest first, reachable from Timesheet rows and
// every buildLinkedTaskCard (Projects/Internal Tasks/All Tasks). Each session
// row can be edited (pencil → Session edit modal), its date clicked through to
// that Timesheet day, its history viewed (clock → Session edit modal's history,
// worklogs:history), and deleted (trash, inline-confirm + undo — deleting a
// task's last session deletes the task too, same as the Timesheet reconciler).
// A "+ Add Session" button next to the section title opens the same modal in
// create mode with this task fixed. Sourced from tasks:get, which already
// returns the full task + its ordered workLogs, so no new IPC channel is
// needed for the task/session data itself (only worklogs:history is new).
async function openTaskDetail(taskId) {
  if (!taskId) return;
  let task;
  try { task = await window.api.getTask(taskId); }
  catch { toast('Could not load task'); return; }
  if (!task) { toast('Task not found'); return; }
  renderTaskDetail(task);
  document.getElementById('task-detail-overlay').classList.add('open');
}
function closeTaskDetail() {
  document.getElementById('task-detail-overlay').classList.remove('open');
}
function taskDetailOverlayClick(e) {
  if (e.target === document.getElementById('task-detail-overlay')) closeTaskDetail();
}

// ── Edit Session modal — edits one work_log's session-level fields (date,
// time, natural, description, minutes) from outside the Timesheet: the Task
// Detail modal and the Project/Internal Tasks task cards, which otherwise show
// sessions read-only. Persists immediately via worklogs:update (unlike
// Timesheet's #modal, which feeds the debounced rows/tasks:* reconciler), then
// reloads the Timesheet's in-memory day (if one is loaded) so a later debounced
// Timesheet save can't clobber this edit with stale data, before refreshing the
// caller's own view via opts.onSaved.
let _sessionModalCtx = { mode: 'edit', workLog: null, task: null, onSaved: null };
let smTaskPicker = null;
// `workLog` is the session to edit; pass null with opts.mode = 'create' and
// opts.task (the fixed parent Task) to log a brand-new session against a known
// task instead — the compact "Add Session" entry point used across Task Detail,
// the grouped/flat Timesheet row actions, and the palette (see submitSessionModal).
async function openSessionModal(workLog, opts = {}) {
  const mode = opts.mode === 'create' ? 'create' : 'edit';
  _sessionModalCtx = { mode, workLog, task: opts.task || null, onSaved: opts.onSaved || null };
  const prefill = opts.prefill || {};
  const defaults = uiState.sessionDefaults || {};

  document.getElementById('session-modal-title').textContent = mode === 'create' ? 'Add Session' : 'Edit Session';
  document.getElementById('session-modal-submit').textContent = mode === 'create' ? 'Add Session' : 'Save Changes';

  document.getElementById('sm-date').value = mode === 'create' ? (opts.defaultDate || fmt(new Date())) : (workLog.date || '');
  populateSelect('sm-time', 'timeType', mode === 'create' ? (prefill.time || defaults.time || '') : (workLog.time || ''));
  populateSelect('sm-natural', 'natural', mode === 'create' ? (prefill.natural || defaults.natural || '') : (workLog.natural || ''));
  document.getElementById('sm-description').value = mode === 'create' ? (prefill.description || '') : (workLog.description || '');
  document.getElementById('sm-minutes').value = mode === 'create' ? (prefill.minutes || '') :
    ((workLog.minutes === '' || workLog.minutes == null) ? '' : workLog.minutes);
  syncDurationPresets('sm-minutes');

  const pickerHost = document.getElementById('sm-task');
  const summaryHost = document.getElementById('sm-task-summary');
  if (mode === 'create') {
    // Fixed task — a read-only one-line summary instead of the reassignment picker.
    pickerHost.style.display = 'none';
    summaryHost.style.display = '';
    const t = opts.task || {};
    summaryHost.innerHTML = esc(t.name || '(untitled task)') +
      '<span class="status-badge ' + esc(statusClass(t.status)) + '">' + esc(lkLabel('ENTRY_STATUS', t.status) || '—') + '</span>';
    smTaskPicker = null;
  } else {
    pickerHost.style.display = '';
    summaryHost.style.display = 'none';
    // Task reassignment picker — searchable, preselected to this session's current
    // task; picking a different one moves the session there on save (worklogs:move).
    // Lightweight (Milestone 7) — no sessions rendered in this picker.
    let taskList = [];
    try { taskList = await window.api.getTasksIndex(); } catch { taskList = []; }
    if (!Array.isArray(taskList)) taskList = [];
    if (workLog.taskId != null && !taskList.some(t => t.id === workLog.taskId)) {
      taskList = taskList.concat([{ id: workLog.taskId, name: workLog.taskName || '(untitled task)' }]);
    }
    smTaskPicker = buildTaskSearchSelect(pickerHost, taskList, workLog.taskId ?? null, 'Search tasks…');
  }

  clearErrorsIn('#session-modal');
  document.getElementById('session-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('sm-description').focus(), 80);
}
function closeSessionModal() {
  document.getElementById('session-modal-overlay').classList.remove('open');
  _sessionModalCtx = { mode: 'edit', workLog: null, task: null, onSaved: null };
  smTaskPicker = null;
}
function sessionOverlayClick(e) {
  if (e.target === document.getElementById('session-modal-overlay')) closeSessionModal();
}
async function submitSessionModal() {
  clearErrorsIn('#session-modal');
  const required = [
    { id: 'sm-date',        val: document.getElementById('sm-date').value },
    { id: 'sm-time',        val: document.getElementById('sm-time').value },
    { id: 'sm-natural',     val: document.getElementById('sm-natural').value },
    { id: 'sm-description', val: document.getElementById('sm-description').value.trim() },
  ];
  let valid = true;
  required.forEach(f => { if (!f.val) { markError(f.id); valid = false; } });

  const minRaw = document.getElementById('sm-minutes').value.trim();
  if (minRaw !== '') {
    const minVal = parseInt(minRaw, 10);
    if (isNaN(minVal) || minVal < 1 || minVal > 1440 || String(minVal) !== minRaw) {
      markError('sm-minutes', 'Enter a whole number from 1 to 1440.'); valid = false;
    }
  }
  if (!valid) { focusFirstError('#session-modal'); return; }

  const payload = {
    date:        document.getElementById('sm-date').value,
    time:        document.getElementById('sm-time').value,
    natural:     document.getElementById('sm-natural').value,
    description: document.getElementById('sm-description').value.trim(),
    minutes:     minRaw === '' ? '' : parseInt(minRaw, 10),
  };
  rememberSessionDefaults(payload.time, payload.natural);

  const { mode, workLog, task, onSaved } = _sessionModalCtx;
  if (mode === 'create') {
    try { await window.api.addWorkLog(task.id, payload); }
    catch { toast('Could not add session'); return; }
    closeSessionModal();
    await reloadTimesheet();
    if (onSaved) await onSaved();
    toast('Session added');
    return;
  }

  // A session always belongs to some task — silently keep the current one if the
  // picker was cleared to "— None —" rather than surfacing a required-field error
  // for what's normally a one-click reassignment, not a create form.
  const pickedTaskId = smTaskPicker ? smTaskPicker.getSelectedId() : null;
  const targetTaskId = pickedTaskId != null ? pickedTaskId : workLog.taskId;
  try {
    await window.api.updateWorkLog(workLog.id, payload);
    if (targetTaskId !== workLog.taskId) await window.api.moveWorkLog(workLog.id, targetTaskId);
  }
  catch { toast('Could not save session'); return; }

  closeSessionModal();
  await reloadTimesheet();          // resync any loaded Timesheet day
  if (onSaved) await onSaved();
  toast(targetTaskId !== workLog.taskId ? 'Session moved to a different task' : 'Session updated');
}

// Read-only work-log edit history (worklogs:history → db.getWorkLogHistory) —
// recorded since migration 028 but never surfaced in the UI until now. Mirrors
// openClientHistoryModal's shape/CSS classes exactly, scoped to one session.
async function openWlHistoryModal(workLogId, title) {
  document.getElementById('wl-history-modal-title').textContent = 'History — ' + (title || 'session');
  const list = document.getElementById('wl-history-list');
  list.innerHTML = '<div class="cp-records-empty">Loading…</div>';
  document.getElementById('wl-history-overlay').classList.add('open');
  let rows;
  try { rows = await window.api.getWorkLogHistory(workLogId); }
  catch { list.innerHTML = '<div class="cp-records-empty">Could not load history.</div>'; return; }
  if (!Array.isArray(rows) || rows.length === 0) {
    list.innerHTML = '<div class="cp-records-empty">No changes recorded yet.</div>';
    return;
  }
  list.innerHTML = '';
  rows.forEach(r => {
    const row = pjMk('div', 'cl-history-row');
    const head = pjMk('div', 'cl-history-head');
    head.appendChild(pjMk('span', 'cl-history-field', r.fieldName));
    head.appendChild(pjMk('span', 'cl-history-when', new Date(r.changedAt).toLocaleString()));
    row.appendChild(head);
    const diff = pjMk('div', 'cl-history-diff');
    diff.appendChild(pjMk('span', 'cl-history-old', r.oldValue || '(empty)'));
    diff.appendChild(pjMk('span', 'cl-history-arrow', '→'));
    diff.appendChild(pjMk('span', 'cl-history-new', r.newValue || '(empty)'));
    row.appendChild(diff);
    list.appendChild(row);
  });
}
function closeWlHistoryModal() { document.getElementById('wl-history-overlay').classList.remove('open'); }
function wlHistoryOverlayClick(e) { if (e.target === document.getElementById('wl-history-overlay')) closeWlHistoryModal(); }

function renderTaskDetail(t) {
  document.getElementById('td-title').textContent = t.name || '(untitled task)';

  const body = document.getElementById('td-body');
  body.innerHTML = '';

  // Status badge under the title, plus a "Merge into another task…" link —
  // cleans up the duplicate single-session tasks migration 012 seeded (see
  // CLAUDE.md's task-merge-UI follow-up note) without needing a separate page.
  const statusWrap = pjMk('div', statusClass(t.status));
  statusWrap.style.cssText = 'margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;gap:10px';
  const badge = pjMk('span', 'status-badge', lkLabel('ENTRY_STATUS', t.status));
  statusWrap.appendChild(badge);
  const mergeLink = pjMk('button', 'td-merge-link', 'Merge into another task…');
  mergeLink.addEventListener('click', () => openMergeModal(t));
  statusWrap.appendChild(mergeLink);
  body.appendChild(statusWrap);

  // ── Metadata grid ──
  const grid = pjMk('div', 'pj-profile-grid');
  const field = (label, valueNode) => {
    const f = pjMk('div');
    f.appendChild(pjMk('div', 'pj-field-label', label));
    const val = pjMk('div', 'pj-field-val');
    if (valueNode instanceof Node) val.appendChild(valueNode); else val.textContent = valueNode || '—';
    f.appendChild(val);
    return f;
  };
  // Structured sources (migration 033) — one badge per entry, clickable when a
  // url is present. Falls back to the legacy free-text source for a task never
  // re-saved since before this feature (empty `sources`, non-empty `t.source`).
  const taskSources = Array.isArray(t.sources) ? t.sources : [];
  let sourcesNode = null;
  if (taskSources.length > 0) {
    sourcesNode = document.createElement('div');
    sourcesNode.className = 'ts-list-compact';
    taskSources.forEach(s => sourcesNode.appendChild(taskSourceBadge(s)));
  } else if (t.source) {
    sourcesNode = document.createElement('span');
    sourcesNode.className = 'ts-badge';
    sourcesNode.textContent = t.source;
  }
  const sourcesField = pjMk('div', 'td-sources-field');
  const sourcesHead = pjMk('div', 'td-sources-head');
  sourcesHead.appendChild(pjMk('div', 'pj-field-label', 'Sources'));
  const editSourcesBtn = pjMk('button', 'btn');
  editSourcesBtn.type = 'button';
  editSourcesBtn.innerHTML = ic('pencil') + ' Edit sources';
  editSourcesBtn.addEventListener('click', () => renderTaskDetailSourcesEditor(t, sourcesField));
  sourcesHead.appendChild(editSourcesBtn);
  sourcesField.appendChild(sourcesHead);
  const sourcesVal = pjMk('div', 'pj-field-val');
  if (sourcesNode) sourcesVal.appendChild(sourcesNode);
  else sourcesVal.appendChild(pjMk('span', 'ts-empty-hint', 'No sources added yet.'));
  sourcesField.appendChild(sourcesVal);
  grid.appendChild(sourcesField);
  grid.appendChild(field('Company', t.company));
  grid.appendChild(field('System', t.system));
  if (t.projectId != null) {
    const tag = projectRowTag(t.projectId);
    grid.appendChild(field('Project', tag || projectNameById(t.projectId)));
  } else if (t.departmentId != null) {
    const tag = departmentRowTag(t.departmentId);
    grid.appendChild(field('Department', tag || t.department));
  } else {
    grid.appendChild(field('Project', null));
  }
  grid.appendChild(field('Created', t.createdAt
    ? new Date(t.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null));
  body.appendChild(grid);

  // ── Analytics: total time, entry count, breakdown by time type ──
  const logs = Array.isArray(t.workLogs) ? t.workLogs : [];
  const totalMin = t.totalMinutes || 0;
  const byType = {};
  logs.forEach(w => {
    const key = w.time || '—';
    byType[key] = (byType[key] || 0) + (Number(w.minutes) || 0);
  });

  const stats = pjMk('div', 'td-stats');
  const chip = (label, value) => {
    const c = pjMk('div', 'total-chip');
    c.appendChild(pjMk('span', 'lbl', label));
    c.appendChild(pjMk('span', 'stat-value', value));
    return c;
  };
  stats.appendChild(chip('Total Minutes', String(totalMin)));
  stats.appendChild(chip('Total Hours', (totalMin / 60).toFixed(2)));
  stats.appendChild(chip('Entries', String(t.logCount || logs.length)));
  Object.keys(byType).forEach(code => {
    stats.appendChild(chip(lkLabel('TIME_TYPE', code) || code, String(byType[code]) + ' min'));
  });
  body.appendChild(stats);

  // ── Sessions (newest first) ──
  const sessHead = pjMk('div', 'pj-section-head');
  sessHead.style.marginTop = '18px';
  const sessTitle = pjMk('div', 'pj-section-title', 'Sessions (' + logs.length + ')');
  sessHead.appendChild(sessTitle);
  const sessActions = pjMk('div', 'pj-section-actions');
  const addSessBtn = pjMk('button', 'btn primary');
  addSessBtn.innerHTML = ic('plus') + ' Add Session';
  addSessBtn.title = 'Log a new session against this task';
  addSessBtn.addEventListener('click', () => openSessionModal(null, {
    mode: 'create', task: t, onSaved: () => openTaskDetail(t.id),
  }));
  sessActions.appendChild(addSessBtn);
  sessHead.appendChild(sessActions);
  body.appendChild(sessHead);

  const sorted = [...logs].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id - a.id));

  if (sorted.length === 0) {
    body.appendChild(pjMk('div', 'td-sessions-empty', 'No sessions yet — this task hasn\'t been worked on.'));
  } else {
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr>' +
      '<th style="width:110px">Date</th><th style="width:100px">Time</th>' +
      '<th style="width:100px">Natural</th>' +
      '<th style="width:70px;text-align:right">Min</th><th>What was done</th>' +
      '<th style="width:96px"></th></tr></thead><tbody></tbody>';
    const tb = table.querySelector('tbody');
    sorted.forEach(w => {
      const tr = document.createElement('tr');
      const dateSpan = pjMk('span', 'clickable', w.date || '—');
      if (w.date) {
        dateSpan.title = 'Open ' + w.date + ' in the Timesheet';
        dateSpan.addEventListener('click', () => {
          closeTaskDetail();
          switchModule('timesheet');
          switchDay(w.date);
        });
      }
      tr.appendChild(cellWrap(dateSpan, 'cell'));
      const timeSpan = pjMk('span', null, lkLabel('TIME_TYPE', w.time) || '—');
      if (w.time === 'OVERTIME') timeSpan.style.color = 'var(--bad)';
      tr.appendChild(cellWrap(timeSpan, 'cell'));
      tr.appendChild(textCell(w.natural || '—'));
      const minCell = cellWrap(pjMk('span', null, (w.minutes === '' || w.minutes == null) ? '—' : String(w.minutes)), 'cell cell-right');
      minCell.style.textAlign = 'right';
      tr.appendChild(minCell);
      tr.appendChild(textCell(w.description || '—'));

      const actsWrap = pjMk('div', 'row-actions');
      const restoreActs = () => {
        actsWrap.innerHTML = '';
        const histBtn = pjMk('button', 'row-btn');
        histBtn.innerHTML = ic('clock'); histBtn.title = 'View history';
        histBtn.addEventListener('click', () => openWlHistoryModal(w.id, t.name));
        actsWrap.appendChild(histBtn);
        const editBtn = pjMk('button', 'row-btn');
        editBtn.innerHTML = ic('pencil'); editBtn.title = 'Edit session';
        editBtn.addEventListener('click', () => openSessionModal(w, { onSaved: () => openTaskDetail(t.id) }));
        actsWrap.appendChild(editBtn);
        const delBtn = pjMk('button', 'row-btn del');
        delBtn.innerHTML = ic('trash-2'); delBtn.title = 'Delete session';
        const isLast = sorted.length === 1;
        delBtn.addEventListener('click', () => showDeleteConfirm(actsWrap, () => deleteSessionFromTaskDetail(t, w), restoreActs,
          isLast ? 'Delete last session? This also deletes the task.' : 'Delete?'));
        actsWrap.appendChild(delBtn);
      };
      restoreActs();
      tr.appendChild(cellWrap(actsWrap, 'cell'));
      tb.appendChild(tr);
    });
    body.appendChild(table);
  }
}

// Switches Task Detail's read-only source badges into the shared structured
// source editor. Saving touches task_sources only; task metadata and container
// links are deliberately left alone.
function renderTaskDetailSourcesEditor(task, host) {
  const originalIds = (task.sources || []).map(s => s.id);
  host.innerHTML = '';

  const head = pjMk('div', 'td-sources-head');
  head.appendChild(pjMk('div', 'pj-field-label', 'Sources'));
  host.appendChild(head);

  const editor = pjMk('div', 'td-sources-editor');
  const list = pjMk('div');
  list.id = 'td-sources-list';
  editor.appendChild(list);

  const actions = pjMk('div', 'td-sources-editor-actions');
  const addBtn = pjMk('button', 'btn');
  addBtn.type = 'button';
  addBtn.innerHTML = ic('plus') + ' Add Source';
  addBtn.addEventListener('click', () => addTaskSourceRow('td-sources-list'));
  actions.appendChild(addBtn);

  const saveActions = pjMk('div');
  const cancelBtn = pjMk('button', 'btn', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', () => renderTaskDetail(task));
  saveActions.appendChild(cancelBtn);
  const saveBtn = pjMk('button', 'btn primary', 'Save Sources');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      await saveTaskSources(task.id, readTaskSourceRows('td-sources-list'), originalIds);
      await reloadTimesheet();
      await openTaskDetail(task.id);
      toast('Sources updated');
    } catch {
      saveBtn.disabled = false;
      toast('Could not save sources');
    }
  });
  saveActions.appendChild(saveBtn);
  actions.appendChild(saveActions);
  editor.appendChild(actions);
  host.appendChild(editor);

  (task.sources || []).forEach(source => addTaskSourceRow('td-sources-list', source));
}

// Delete one session from the Task Detail modal. Mirrors the Timesheet
// reconciler's own rule: if that was the task's last session, the now-empty
// task is deleted too (a zero-log task created this way has no container to
// stay reachable from otherwise — see the All Tasks page notes in CLAUDE.md).
// Undo re-creates the task (if it was deleted) and the session together.
async function deleteSessionFromTaskDetail(task, workLog) {
  let res;
  try { res = await window.api.deleteWorkLog(workLog.id); }
  catch { toast('Could not delete session'); return; }
  const taskDeleted = res && res.task && res.task.logCount === 0;
  if (taskDeleted) {
    try { await window.api.deleteTask(task.id); }
    catch { toast('Could not delete task'); return; }
    closeTaskDetail();
  } else {
    await openTaskDetail(task.id);
  }
  await reloadTimesheet();
  showGenericUndo(taskDeleted ? 'Session deleted (task removed)' : 'Session deleted', async () => {
    try {
      const newTaskId = taskDeleted
        ? (await window.api.createTask({
            name: task.name, status: task.status, company: task.company, system: task.system,
            source: task.source, projectId: task.projectId, department: task.department,
          })).id
        : task.id;
      await window.api.addWorkLog(newTaskId, {
        date: workLog.date, description: workLog.description, minutes: workLog.minutes,
        time: workLog.time, natural: workLog.natural,
      });
    } catch { toast('Could not restore session'); return; }
    await reloadTimesheet();
    if (taskDeleted) toast('Task and session restored'); else await openTaskDetail(task.id);
  });
}

// ── Merge Task modal — Task Detail's "Merge into another task…" ─────────────
// Cleans up the duplicate single-session tasks migration 012 seeded (see
// CLAUDE.md's task-merge-UI follow-up note): pick a target with the same rich
// task picker used everywhere else, preview both tasks' names + session
// counts, then tasks:merge moves every session and deletes the source. Undo
// recreates an equivalent source task and moves the exact same work_logs back
// onto it (via worklogs:move), rather than recreating the rows — so their
// edit history survives the round trip.
let _mergeCtx = { sourceTask: null, target: null };
let mergeTargetPicker = null;
async function openMergeModal(sourceTask) {
  _mergeCtx = { sourceTask, target: null };
  document.getElementById('merge-source-name').textContent = sourceTask.name || '(untitled task)';
  const preview = document.getElementById('merge-preview');
  preview.style.display = 'none'; preview.innerHTML = '';
  document.getElementById('merge-modal-submit').disabled = true;

  // Lightweight (Milestone 7) — the merge target picker never renders sessions.
  let taskList = [];
  try { taskList = await window.api.getTasksIndex(); } catch { taskList = []; }
  taskList = (Array.isArray(taskList) ? taskList : []).filter(t => t.id !== sourceTask.id);

  mergeTargetPicker = buildTaskSearchSelect(document.getElementById('merge-target-picker'),
    taskList, null, 'Search tasks…', (targetId) => {
      const target = targetId != null ? taskList.find(t => t.id === targetId) : null;
      _mergeCtx.target = target || null;
      if (target) {
        const srcCount = sourceTask.logCount || 0;
        const tgtCount = target.logCount || 0;
        preview.innerHTML =
          '<div>' + esc(sourceTask.name || '(untitled task)') + ' (' + srcCount + ' session' + (srcCount === 1 ? '' : 's') + ')'
          + ' ' + ic('arrow-right') + ' ' + esc(target.name || '(untitled task)') + ' (' + tgtCount + ' session' + (tgtCount === 1 ? '' : 's') + ')</div>'
          + '<div class="merge-warn">' + esc(sourceTask.name || 'This task') + ' will be deleted once its sessions move.</div>';
        preview.style.display = '';
        document.getElementById('merge-modal-submit').disabled = false;
      } else {
        preview.style.display = 'none'; preview.innerHTML = '';
        document.getElementById('merge-modal-submit').disabled = true;
      }
    });

  document.getElementById('merge-modal-overlay').classList.add('open');
}
function closeMergeModal() {
  document.getElementById('merge-modal-overlay').classList.remove('open');
  _mergeCtx = { sourceTask: null, target: null };
  mergeTargetPicker = null;
}
function mergeOverlayClick(e) {
  if (e.target === document.getElementById('merge-modal-overlay')) closeMergeModal();
}
async function submitMergeModal() {
  const { sourceTask, target } = _mergeCtx;
  if (!sourceTask || !target) return;
  let res;
  try { res = await window.api.mergeTasks(sourceTask.id, target.id); }
  catch { toast('Could not merge task'); return; }
  if (!res || !res.ok) { toast((res && res.error) || 'Could not merge task'); return; }

  closeMergeModal();
  closeTaskDetail();
  await reloadTimesheet();
  const movedIds = res.movedWorkLogIds || [];
  showGenericUndo('Merged into ' + (target.name || '(untitled task)'), async () => {
    try {
      const restored = await window.api.createTask({
        name: sourceTask.name, status: sourceTask.status, company: sourceTask.company, system: sourceTask.system,
        projectId: sourceTask.projectId, department: sourceTask.department, source: sourceTask.source,
      });
      for (const logId of movedIds) await window.api.moveWorkLog(logId, restored.id);
      // The merged-away task's task_sources rows cascaded with it — recreate
      // them on the restored task (sourceTask.sources came from Task Detail's
      // own getTask() call, so the full list is already in memory here).
      for (const s of (sourceTask.sources || [])) {
        await window.api.createTaskSource(restored.id, { type: s.type, ref: s.ref, url: s.url, meta: s.meta });
      }
    } catch { toast('Could not undo merge'); return; }
    await reloadTimesheet();
    toast('Merge undone');
  });
  toast('Task merged');
}

function showProjectDetailView() {
  document.getElementById('projects-detail-view').style.display = '';
}

// Builds one project card, used by the Clients page's per-client Projects
// section. `onOpen(projectId)` is called on click — see openProjectById.
function buildProjectCard(p, onOpen) {
  const card = pjMk('div', 'pj-card pj-accent-' + (PJ_STATUS_CLASS[p.status] || 'active'));
  card.addEventListener('click', () => onOpen(p.id));

  // Head — name + status pill.
  const head = pjMk('div', 'pj-card-head');
  head.appendChild(pjMk('div', 'pj-card-name', p.name || 'Untitled project'));
  const badges = pjMk('div', 'pj-card-badges');
  badges.appendChild(pjMk('span', pjStatusClass(p.status), pjStatusLabel(p.status)));
  head.appendChild(badges);
  card.appendChild(head);

  // Meta — companies and systems as pill rows (capped, with a +N overflow)
  const companyNames = (p.companies || []).map(c => c.label).filter(Boolean);
  const systemNames  = (p.systems || []).map(s => s.label).filter(Boolean);
  if (companyNames.length) card.appendChild(pjCardMetaRow('building-2', companyNames));
  if (systemNames.length)  card.appendChild(pjCardMetaRow('folder', systemNames));

  if (p.description) card.appendChild(pjMk('div', 'pj-card-desc', p.description));

  // Footer — task-count chip + hover "Open" affordance
  const foot = pjMk('div', 'pj-card-foot');
  const count = pjMk('span', 'pj-card-count');
  count.innerHTML = ic('clipboard-list');
  count.appendChild(document.createTextNode((p.taskCount || 0) + ' task' + (p.taskCount === 1 ? '' : 's')));
  foot.appendChild(count);
  const open = pjMk('span', 'pj-card-open', 'Open');
  open.insertAdjacentHTML('beforeend', ic('chevron-right'));
  foot.appendChild(open);
  card.appendChild(foot);

  return card;
}

// One labeled meta row on a project card: an icon followed by up to `max` value
// pills, with a "+N" overflow pill when there are more.
function pjCardMetaRow(icon, names, max = 4) {
  const row = pjMk('div', 'pj-card-meta');
  const ico = pjMk('span', 'pj-card-meta-ic');
  ico.innerHTML = ic(icon);
  row.appendChild(ico);
  const tags = pjMk('div', 'pj-card-tags');
  names.slice(0, max).forEach(n => tags.appendChild(pjMk('span', 'pj-tag', n)));
  if (names.length > max) tags.appendChild(pjMk('span', 'pj-tag pj-tag-more', '+' + (names.length - max)));
  row.appendChild(tags);
  return row;
}

// ══ PROJECTS ↔ CLIENTS — projects are surfaced client-first, inside each
// client's detail view on the Clients page (the standalone Clients Projects
// page was merged into Clients). A project linked to ≥1 company is grouped
// under its FIRST linked company (companies[0] — already ordered by lookup
// sort_order/label, the same order its own pill row shows), so a multi-client
// project appears under exactly one client, never duplicated. The single
// project detail view (#module-projects, openProjectById) is unchanged; its
// breadcrumbs read back to the Clients page. ══

// A project's grouping client — its first linked company (see the note above
// for why "first" is the chosen rule for a multi-client project).
function cpjPrimaryCompany(p) {
  return (p.companies && p.companies.length) ? p.companies[0] : null;
}

// Return from a single-project detail view to the Clients page. If the project
// belongs to a client, land on that client's detail (where its Projects section
// now lives); otherwise fall back to the Clients list.
function backToClientsFromProject(project) {
  const co = project ? cpjPrimaryCompany(project) : null;
  switchModule('clients');
  if (co) openClientDetail(co.id);
}

async function openProjectDetail(id) {
  let project;
  try { project = await window.api.getProject(id); }
  catch { toast('Could not open project'); return; }
  if (!project) { toast('Project not found'); await loadProjectsList(); backToClientsFromProject(null); return; }
  currentProject = project;
  showProjectDetailView();
  renderProjectDetail(project);
}

async function reloadCurrentProject() {
  if (!currentProject) return;
  let project;
  try { project = await window.api.getProject(currentProject.id); }
  catch { return; }
  if (!project) { backToClientsFromProject(null); return; }
  currentProject = project;
  renderProjectDetail(project);
}

function renderProjectDetail(p) {
  const host = document.getElementById('projects-detail-view');
  host.innerHTML = '';
  window.api.setTitle('Cooperation Tools — ' + (p.name || 'Project'));

  // Breadcrumb trail: Clients / <client, if any> / <name>
  const crumbs = pjMk('div', 'pj-crumbs');
  const crumbRoot = pjMk('button', 'pj-crumb-link', 'Clients');
  crumbRoot.addEventListener('click', () => { switchModule('clients'); backToClientsList(); });
  crumbs.appendChild(crumbRoot);
  const primaryCompany = cpjPrimaryCompany(p);
  if (primaryCompany) {
    const clientSep = pjMk('span', 'pj-crumb-sep');
    clientSep.innerHTML = ic('chevron-right');
    crumbs.appendChild(clientSep);
    const crumbClient = pjMk('button', 'pj-crumb-link', primaryCompany.label);
    crumbClient.addEventListener('click', () => {
      switchModule('clients');
      openClientDetail(primaryCompany.id);
    });
    crumbs.appendChild(crumbClient);
  }
  const sep = pjMk('span', 'pj-crumb-sep');
  sep.innerHTML = ic('chevron-right');
  crumbs.appendChild(sep);
  crumbs.appendChild(pjMk('span', 'pj-crumb-here', p.name || 'Untitled project'));
  host.appendChild(crumbs);

  // Header: title + status + actions
  const head = pjMk('div', 'pj-detail-head');
  const titleWrap = pjMk('div');
  const title = pjMk('div', 'pj-detail-title');
  title.appendChild(document.createTextNode(p.name || 'Untitled project'));
  title.appendChild(pjMk('span', pjStatusClass(p.status), pjStatusLabel(p.status)));
  titleWrap.appendChild(title);
  head.appendChild(titleWrap);

  const actions = pjMk('div', 'pj-detail-actions');
  buildDetailActions(actions);
  head.appendChild(actions);
  host.appendChild(head);

  // ── Profile section ──
  const profile = pjMk('div', 'pj-section');
  const pHead = pjMk('div', 'pj-section-head');
  const pTitle = pjMk('div', 'pj-section-title');
  pTitle.innerHTML = ic('clipboard-list');
  pTitle.appendChild(document.createTextNode('Profile'));
  pHead.appendChild(pTitle);
  profile.appendChild(pHead);

  const grid = pjMk('div', 'pj-profile-grid');
  const field = (label, value) => {
    const f = pjMk('div');
    f.appendChild(pjMk('div', 'pj-field-label', label));
    f.appendChild(pjMk('div', 'pj-field-val', value || '—'));
    return f;
  };
  // Companies / Systems as pills — each cross-links into its Browse slice.
  const pillField = (label, items, kind) => {
    const f = pjMk('div');
    f.appendChild(pjMk('div', 'pj-field-label', label));
    if ((items || []).length) {
      const pills = pjMk('div', 'pj-pills');
      items.forEach(it => {
        const b = pjMk('button', 'pj-pill cell-link', it.label);
        b.title = 'Browse all work for ' + it.label;
        b.addEventListener('click', () => openBrowseSlice(kind, it.label));
        pills.appendChild(b);
      });
      f.appendChild(pills);
    } else {
      f.appendChild(pjMk('div', 'pj-field-val', '—'));
    }
    return f;
  };
  grid.appendChild(pillField('Companies', p.companies, 'companies'));
  grid.appendChild(pillField('Systems', p.systems, 'systems'));
  grid.appendChild(field('Status', pjStatusLabel(p.status)));
  const descField = pjMk('div'); descField.style.gridColumn = '1 / -1';
  descField.appendChild(pjMk('div', 'pj-field-label', 'Description'));
  descField.appendChild(pjMk('div', 'pj-field-val', p.description || '—'));
  grid.appendChild(descField);
  profile.appendChild(grid);
  host.appendChild(profile);

  // ── Time Tracking section — aggregated across every linked task's sessions.
  // No dedicated IPC: p.tasks[].workLogs already carries everything needed. ──
  const timeSec = pjMk('div', 'pj-section');
  const tmHead = pjMk('div', 'pj-section-head');
  const tmTitle = pjMk('div', 'pj-section-title');
  tmTitle.innerHTML = ic('clock');
  tmTitle.appendChild(document.createTextNode('Time Tracking'));
  tmHead.appendChild(tmTitle);
  timeSec.appendChild(tmHead);

  const projTasks = Array.isArray(p.tasks) ? p.tasks : [];
  const allLogs = projTasks.flatMap(t => Array.isArray(t.workLogs) ? t.workLogs : []);
  const projTotalMin = allLogs.reduce((s, w) => s + (Number(w.minutes) || 0), 0);
  const byType = {};
  allLogs.forEach(w => {
    const key = w.time || '—';
    byType[key] = (byType[key] || 0) + (Number(w.minutes) || 0);
  });

  const timeStats = pjMk('div', 'td-stats');
  const timeChip = (label, value) => {
    const c = pjMk('div', 'total-chip');
    c.appendChild(pjMk('span', 'lbl', label));
    c.appendChild(pjMk('span', 'stat-value', value));
    return c;
  };
  timeStats.appendChild(timeChip('Total Hours', (projTotalMin / 60).toFixed(2)));
  timeStats.appendChild(timeChip('Total Minutes', String(projTotalMin)));
  timeStats.appendChild(timeChip('Sessions', String(allLogs.length)));
  timeStats.appendChild(timeChip('Tasks', String(projTasks.length)));
  Object.keys(byType).forEach(code => {
    timeStats.appendChild(timeChip(lkLabel('TIME_TYPE', code) || code, (byType[code] / 60).toFixed(2) + 'h'));
  });
  timeSec.appendChild(timeStats);
  if (!allLogs.length) timeSec.appendChild(pjMk('div', 'cp-records-empty', 'No sessions logged on this project yet.'));
  host.appendChild(timeSec);

  // ── Documents section ──
  const docs = pjMk('div', 'pj-section');
  const dHead = pjMk('div', 'pj-section-head');
  const dTitle = pjMk('div', 'pj-section-title');
  dTitle.innerHTML = ic('file-text');
  dTitle.appendChild(document.createTextNode('Documents'));
  dHead.appendChild(dTitle);
  docs.appendChild(dHead);

  const docGrid = pjMk('div', 'pj-docs');
  if (!(p.documents || []).length) {
    docs.appendChild(pjMk('div', 'cp-records-empty', 'No document types configured — add them in Settings → Project Documents.'));
  }
  (p.documents || []).forEach(doc => docGrid.appendChild(buildDocCard(doc)));
  docs.appendChild(docGrid);
  host.appendChild(docs);

  // ── Tasks section (ProjectTasksV2: each task with its work sessions nested) ──
  const tasksSec = pjMk('div', 'pj-section');
  const tHead = pjMk('div', 'pj-section-head');
  const tTitle = pjMk('div', 'pj-section-title');
  tTitle.innerHTML = ic('list');
  const list = Array.isArray(p.tasks) ? p.tasks : [];
  tTitle.appendChild(document.createTextNode('Tasks (' + list.length + ')'));
  tHead.appendChild(tTitle);
  const tActions = pjMk('div', 'pj-section-actions');
  const newBtn = pjMk('button', 'btn primary');
  newBtn.innerHTML = ic('plus') + ' New Task';
  newBtn.title = 'Create a new task already linked to this project';
  newBtn.addEventListener('click', openProjectNewTask);
  const linkBtn = pjMk('button', 'btn');
  linkBtn.innerHTML = ic('calendar-plus') + ' Link Task';
  linkBtn.addEventListener('click', openLinkModal);
  tActions.appendChild(newBtn);
  tActions.appendChild(linkBtn);
  tHead.appendChild(tActions);
  tasksSec.appendChild(tHead);

  if (list.length === 0) {
    tasksSec.appendChild(pjMk('div', 'cp-records-empty', 'No tasks linked yet — use “Link Task” to attach existing work.'));
  } else {
    list.forEach(t => tasksSec.appendChild(buildLinkedTaskCard(t, {
      onEdit: () => openProjectEditTask(t.id),
      onUnlink: () => doUnlinkTask(t.id),
      onDelete: () => doDeleteProjectTask(t),
      onSessionSaved: reloadCurrentProject,
      unlinkTitle: 'Unlink from this project',
    })));
  }
  host.appendChild(tasksSec);
}

// One task linked to a container (a Project or a Department): its profile + the
// list of its work sessions (or a "No sessions yet" note). Zero-log tasks appear
// here too. `handlers` is `{ onEdit, onUnlink, onDelete, unlinkTitle }` — the only
// bits that differ between the Project and Department contexts; shared by both
// renderProjectDetail's Tasks section and Internal Tasks' department panel.
// Task ids whose sessions table is collapsed — ephemeral UI state (not
// persisted), shared across Projects and Internal Tasks since both rebuild
// their card list from scratch on every reload and would otherwise forget it.
const collapsedTaskCards = new Set();
function buildLinkedTaskCard(t, handlers) {
  const card = pjMk('div', 'pj-task-card');
  const logs = Array.isArray(t.workLogs) ? t.workLogs : [];

  const head = pjMk('div', 'pj-task-head');
  const title = pjMk('div', 'pj-task-title', t.name || '(untitled task)');
  head.appendChild(title);
  const statusPill = pjMk('span', 'status-badge ' + statusClass(t.status),
    lkLabel('ENTRY_STATUS', t.status) || '—');
  head.appendChild(statusPill);
  const spacer = pjMk('div'); spacer.style.flex = '1'; head.appendChild(spacer);

  // Collapse/expand the sessions table below — only offered when there's
  // something to collapse. `sessionsTable` is assigned once it's built further
  // down; the click handler closes over it (it always runs after the table exists).
  let sessionsTable = null;
  if (logs.length > 0) {
    const collapseBtn = pjMk('button', 'row-btn');
    const setChevron = (expanded) => {
      collapseBtn.innerHTML = ic('chevron-down');
      collapseBtn.querySelector('svg').style.transform = expanded ? 'rotate(180deg)' : '';
      collapseBtn.title = expanded ? 'Collapse sessions' : 'Expand sessions';
    };
    setChevron(!collapsedTaskCards.has(t.id));
    collapseBtn.addEventListener('click', () => {
      const collapsed = collapsedTaskCards.has(t.id);
      if (collapsed) collapsedTaskCards.delete(t.id); else collapsedTaskCards.add(t.id);
      if (sessionsTable) sessionsTable.style.display = collapsed ? '' : 'none';
      setChevron(collapsed);
    });
    head.appendChild(collapseBtn);
  }

  const viewBtn = pjMk('button', 'row-btn');
  viewBtn.innerHTML = ic('eye'); viewBtn.title = 'View task details';
  viewBtn.addEventListener('click', () => openTaskDetail(t.id));
  head.appendChild(viewBtn);
  const editBtn = pjMk('button', 'row-btn');
  editBtn.innerHTML = ic('pencil'); editBtn.title = 'Edit task';
  editBtn.addEventListener('click', handlers.onEdit);
  head.appendChild(editBtn);

  // One-click Done (Milestone 10) — persists immediately (like every other
  // edit on this card), unlike Timesheet's debounced in-memory rows. Carries
  // the same undo affordance as the Timesheet versions of this button (the
  // milestone's own spec: "sets status DONE ... with the existing undo
  // toast") — this card's copy originally shipped without it.
  if (t.status !== 'DONE') {
    const doneBtn = pjMk('button', 'row-btn done-btn');
    doneBtn.innerHTML = ic('check'); doneBtn.title = 'Mark done';
    const setStatus = async (status) => {
      await window.api.updateTask(t.id, {
        name: t.name, status, company: t.company, system: t.system,
        source: t.source, projectId: t.projectId, department: t.department,
      });
      if (handlers.onSessionSaved) await handlers.onSessionSaved();
    };
    doneBtn.addEventListener('click', async () => {
      const prevStatus = t.status;
      try { await setStatus('DONE'); }
      catch { toast('Could not mark task done'); return; }
      showGenericUndo('Marked done', async () => {
        try { await setStatus(prevStatus); }
        catch { toast('Could not undo'); }
      });
    });
    head.appendChild(doneBtn);
  }

  // A zero-log task has no other identity once it loses this container's link
  // (there's no day-agnostic pool to find it in anymore) — delete it outright
  // instead of offering an unlink that would silently orphan it. A task with
  // sessions stays reachable via Timesheet/Browse either way, so unlink remains
  // safe there.
  const hasLogs = (t.logCount || 0) > 0;
  const actsWrap = pjMk('div', 'row-actions');
  const restoreActs = () => {
    actsWrap.innerHTML = '';
    if (hasLogs) {
      // Unlink only makes sense when this card is shown inside a container (a
      // Project or Department) — omit handlers.onUnlink (e.g. the All Tasks
      // page, which isn't a container) to show no action here at all.
      if (handlers.onUnlink) {
        const unlinkBtn = pjMk('button', 'row-btn del');
        unlinkBtn.innerHTML = ic('x'); unlinkBtn.title = handlers.unlinkTitle || 'Unlink';
        unlinkBtn.addEventListener('click', handlers.onUnlink);
        actsWrap.appendChild(unlinkBtn);
      }
    } else {
      const delBtn = pjMk('button', 'row-btn del');
      delBtn.innerHTML = ic('trash-2'); delBtn.title = 'Delete task';
      delBtn.addEventListener('click', () => showDeleteConfirm(actsWrap, handlers.onDelete, restoreActs));
      actsWrap.appendChild(delBtn);
    }
  };
  restoreActs();
  head.appendChild(actsWrap);
  card.appendChild(head);

  const metaBits = [t.company, t.system].filter(Boolean).join(' · ');
  const mins = t.totalMinutes || 0;
  const logCount = t.logCount || 0;
  const summary = pjMk('div', 'pj-task-meta',
    (metaBits ? metaBits + '  ·  ' : '') + logCount + ' session' + (logCount === 1 ? '' : 's') +
    (mins ? '  ·  ' + mins + ' min (' + (mins / 60).toFixed(2) + ' h)' : ''));
  card.appendChild(summary);
  // Milestone 9 — only shown where the card doesn't already imply its own
  // container (see the All Tasks call site's showContainerTag flag).
  if (handlers.showContainerTag) {
    const containerTag = projectRowTag(t.projectId) || departmentRowTag(t.departmentId);
    if (containerTag) card.appendChild(containerTag);
  }

  if (logs.length === 0) {
    const empty = pjMk('div', 'pj-task-empty', 'No sessions yet');
    card.appendChild(empty);
  } else {
    const table = document.createElement('table');
    sessionsTable = table;
    table.style.cssText = 'width:100%;margin-top:8px' + (collapsedTaskCards.has(t.id) ? ';display:none' : '');
    table.innerHTML = '<thead><tr>' +
      '<th style="width:110px">Date</th><th style="width:100px">Time</th>' +
      '<th style="width:100px">Natural</th>' +
      '<th style="width:70px;text-align:right">Min</th><th>What was done</th>' +
      '<th style="width:44px"></th></tr></thead><tbody></tbody>';
    const tb = table.querySelector('tbody');
    logs.forEach(w => {
      const tr = document.createElement('tr');
      tr.appendChild(textCell(w.date || '—'));
      const timeSpan = pjMk('span', null, lkLabel('TIME_TYPE', w.time) || '—');
      if (w.time === 'OVERTIME') timeSpan.style.color = 'var(--bad)';
      tr.appendChild(cellWrap(timeSpan, 'cell'));
      tr.appendChild(textCell(w.natural || '—'));
      const minTd = document.createElement('td'); minTd.style.textAlign = 'right';
      const minDiv = pjMk('div', 'cell cell-right');
      minDiv.appendChild(document.createTextNode((w.minutes === '' || w.minutes == null) ? '—' : String(w.minutes)));
      minTd.appendChild(minDiv); tr.appendChild(minTd);
      tr.appendChild(textCell(w.description || '—'));
      const editBtn = pjMk('button', 'row-btn');
      editBtn.innerHTML = ic('pencil'); editBtn.title = 'Edit session';
      editBtn.addEventListener('click', () => openSessionModal(w, { onSaved: handlers.onSessionSaved }));
      tr.appendChild(cellWrap(editBtn, 'cell'));
      tb.appendChild(tr);
    });
    card.appendChild(table);
  }
  return card;
}

// (Re)build the Edit / Delete buttons in the detail header's action container.
function buildDetailActions(container) {
  container.innerHTML = '';
  const edit = pjMk('button', 'btn');
  edit.innerHTML = ic('pencil') + ' Edit';
  edit.addEventListener('click', () => openProjectModal(currentProject.id));
  const del = pjMk('button', 'btn del-action');
  del.innerHTML = ic('trash-2') + ' Delete';
  del.addEventListener('click', () => showDeleteConfirm(container,
    () => deleteCurrentProject(),
    () => buildDetailActions(container)));
  container.appendChild(edit);
  container.appendChild(del);
}

// Human-readable file size for the document cards.
function fmtFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (v >= 10 ? Math.round(v) : v.toFixed(1)) + ' ' + units[i];
}

// Build one document card. Three states drive the layout: no file (Upload),
// file present on disk (filename + meta + Download/Open/Replace/Remove), and
// file recorded but missing from disk (warning + Replace/Remove only).
function buildDocCard(doc) {
  const f = doc.file;
  const present = !!(f && f.exists);
  const missing = !!(f && !f.exists);
  const card = pjMk('div', 'pj-doc-card' + (present ? ' available' : '') + (missing ? ' missing' : ''));

  const icon = pjMk('div', 'pj-doc-icon');
  icon.innerHTML = ic(present ? 'circle-check' : (missing ? 'triangle-alert' : 'file-text'));
  card.appendChild(icon);
  card.appendChild(pjMk('div', 'pj-doc-name', doc.label || doc.documentType));

  if (!f) {
    card.appendChild(pjMk('div', 'pj-doc-state', 'Not uploaded'));
  } else {
    // Filename (with original-name tooltip) + size · upload date.
    const fname = pjMk('div', 'pj-doc-filename', f.originalName || '(file)');
    fname.title = f.originalName || '';
    card.appendChild(fname);
    const meta = [fmtFileSize(f.size)];
    if (f.uploadedAt) meta.push(new Date(f.uploadedAt).toLocaleDateString());
    card.appendChild(pjMk('div', 'pj-doc-meta', meta.join(' · ')));
    if (missing) card.appendChild(pjMk('div', 'pj-doc-state pj-doc-warn', 'File missing from disk'));
  }

  const actions = pjMk('div', 'pj-doc-actions');
  const mkBtn = (cls, iconName, label, title, fn) => {
    const b = pjMk('button', 'pj-doc-btn' + (cls ? ' ' + cls : ''));
    b.innerHTML = ic(iconName);
    b.appendChild(document.createTextNode(label));
    b.title = title;
    b.addEventListener('click', fn);
    return b;
  };
  if (!f) {
    actions.appendChild(mkBtn('primary', 'upload', 'Upload', 'Upload a file', () => uploadDoc(doc.documentType)));
  } else {
    if (present) {
      actions.appendChild(mkBtn('', 'download', 'Download', 'Save a copy', () => downloadDoc(doc.documentType)));
      actions.appendChild(mkBtn('', 'external-link', 'Open', 'Open with default app', () => openDoc(doc.documentType)));
    }
    actions.appendChild(mkBtn('', 'upload', 'Replace', 'Replace with another file', () => uploadDoc(doc.documentType)));
    // Remove uses inline confirm in place of the action row (no destructive action without recovery).
    actions.appendChild(mkBtn('danger', 'trash-2', 'Remove', 'Remove this file', () =>
      showDeleteConfirm(actions, () => removeDoc(doc.documentType), () => renderProjectDetail(currentProject))));
  }
  card.appendChild(actions);
  return card;
}

// Apply a DocFileResult ({ ok, project, error, canceled }) to the detail view.
function applyDocResult(res, failMsg) {
  if (!res || res.canceled) return false;
  if (!res.ok || !res.project) { toast(res?.error || failMsg); return false; }
  currentProject = res.project;
  renderProjectDetail(res.project);
  return true;
}

async function uploadDoc(documentType) {
  const projectId = currentProject.id;
  let res;
  try { res = await window.api.uploadProjectDocument(projectId, documentType); }
  catch { toast('Could not upload file'); return; }
  if (!applyDocResult(res, 'Could not upload file')) return;
  if (res.replacedFile) {
    toast('File replaced', { actionLabel: 'Undo', duration: 5000, onAction: async () => {
      const restored = await window.api.restoreProjectDocument(projectId, documentType, res.replacedFile);
      if (restored?.ok && restored.replacedFile?.path) await window.api.purgeProjectDocumentFile(projectId, restored.replacedFile.path);
      if (currentProject?.id === projectId) applyDocResult(restored, 'Could not restore the previous file');
      toast(restored?.ok ? 'Previous file restored' : (restored?.error || 'Could not restore the previous file'));
    }, onExpire: () => window.api.purgeProjectDocumentFile(projectId, res.replacedFile.path).catch(() => {}) });
  } else toast('File saved');
}
async function removeDoc(documentType) {
  const projectId = currentProject.id;
  let res;
  try { res = await window.api.removeProjectDocument(projectId, documentType); }
  catch { toast('Could not remove file'); return; }
  if (!applyDocResult(res, 'Could not remove file')) return;
  if (!res.removedFile) { toast('File removed'); return; }
  toast('File removed', { actionLabel: 'Undo', duration: 5000, onAction: async () => {
    const restored = await window.api.restoreProjectDocument(projectId, documentType, res.removedFile);
    if (currentProject?.id === projectId) applyDocResult(restored, 'Could not restore the file');
    toast(restored?.ok ? 'File restored' : (restored?.error || 'Could not restore the file'));
  }, onExpire: () => window.api.purgeProjectDocumentFile(projectId, res.removedFile.path).catch(() => {}) });
}
async function downloadDoc(documentType) {
  let res;
  try { res = await window.api.downloadProjectDocument(currentProject.id, documentType); }
  catch { toast('Could not download file'); return; }
  if (!res || res.canceled) return;
  toast(res.ok ? 'File saved' : (res.error || 'Could not download file'));
}
async function openDoc(documentType) {
  let res;
  try { res = await window.api.openProjectDocument(currentProject.id, documentType); }
  catch { toast('Could not open file'); return; }
  if (res && !res.ok) toast(res.error || 'Could not open file');
}

// ── Project add/edit modal ──
function openProjectModal(id = null) {
  projectEditId = id;
  const src = id != null ? (currentProject && currentProject.id === id ? currentProject
                            : projectsList.find(p => p.id === id)) : null;
  const isEdit = !!src;
  document.getElementById('project-modal-title').textContent = isEdit ? 'Edit Project' : 'New Project';
  document.querySelector('#project-modal .modal-footer .btn.primary').textContent = isEdit ? 'Save Changes' : 'Create Project';

  document.getElementById('p-name').value        = src?.name || '';
  pCompaniesPicker = buildTagPicker(document.getElementById('p-companies'),
    lkOptions('COMPANY').map(o => ({ id: o.id, label: o.label })),
    (src?.companies || []).map(c => c.id), 'Search companies…');
  pSystemsPicker = buildTagPicker(document.getElementById('p-systems'),
    lkOptions('SYSTEM').map(o => ({ id: o.id, label: o.label })),
    (src?.systems || []).map(s => s.id), 'Search systems…');
  populateSelect('p-status', 'projectStatus', src?.status || 'ACTIVE');
  document.getElementById('p-description').value  = src?.description || '';

  clearErrorsIn('#project-modal');
  document.getElementById('project-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('p-name').focus(), 80);
}
function closeProjectModal() {
  document.getElementById('project-modal-overlay').classList.remove('open');
  projectEditId = null;
}
function projectOverlayClick(e) {
  if (e.target === document.getElementById('project-modal-overlay')) closeProjectModal();
}

async function submitProjectModal() {
  clearErrorsIn('#project-modal');
  const name = document.getElementById('p-name').value.trim();
  if (!name) { markError('p-name'); return; }
  const data = {
    name,
    companyIds:  pCompaniesPicker ? pCompaniesPicker.getSelectedIds() : [],
    systemIds:   pSystemsPicker ? pSystemsPicker.getSelectedIds() : [],
    status:      document.getElementById('p-status').value || 'ACTIVE',
    description: document.getElementById('p-description').value.trim(),
  };

  try {
    if (projectEditId != null) {
      const updated = await window.api.updateProject(projectEditId, data);
      closeProjectModal();
      if (updated && currentProject && currentProject.id === updated.id) {
        currentProject = updated;
        renderProjectDetail(updated);
      }
      await loadProjectsList();
      toast('Project saved');
    } else {
      const created = await window.api.createProject(data);
      closeProjectModal();
      await loadProjectsList();
      if (created) openProjectDetail(created.id);
      toast('Project created');
    }
  } catch { toast('Could not save project'); }
}

// ── Delete + undo (re-creates the project on undo: no hard loss) ──
async function deleteCurrentProject() {
  if (!currentProject) return;
  const snapshot = currentProject;   // full object (profile + docs + tasks)
  try { await window.api.deleteProject(snapshot.id); }
  catch { toast('Could not delete project'); buildDetailActions(document.querySelector('.pj-detail-actions')); return; }
  showProjectUndoToast(snapshot);
  backToClientsFromProject(snapshot);
}
function showProjectUndoToast(snapshot) {
  undoProject = snapshot;
  clearTimeout(_undoProjectTimer);
  document.getElementById('project-undo-toast').classList.add('visible');
  _undoProjectTimer = setTimeout(hideProjectUndoToast, 5000);
}
function hideProjectUndoToast() {
  document.getElementById('project-undo-toast').classList.remove('visible');
  // Undo window lapsed without an undo → the deletion is final; purge the
  // project's entire file folder (best-effort; the boot orphan-sweep is backup).
  if (undoProject) {
    window.api.purgeProjectFiles(undoProject.id).catch(() => {});
    // Zero-log tasks have no other identity once their project is gone for good
    // (there's no day-agnostic pool to find them in) — clean them up so they don't
    // become permanently unreachable orphans. Tasks with sessions stay untouched;
    // they're already unlinked (SET NULL) and remain visible via Timesheet/Browse.
    (undoProject.tasks || []).filter(t => !t.logCount).forEach(t => window.api.deleteTask(t.id).catch(() => {}));
  }
  undoProject = null;
}
async function undoDeleteProject() {
  if (!undoProject) return;
  const snap = undoProject;
  undoProject = null;
  clearTimeout(_undoProjectTimer);
  document.getElementById('project-undo-toast').classList.remove('visible');
  try {
    const created = await window.api.createProject({
      name: snap.name, description: snap.description, status: snap.status,
      systemIds: (snap.systems || []).map(s => s.id), companyIds: (snap.companies || []).map(c => c.id),
    });
    // Move the still-on-disk files onto the re-created project and re-record their
    // metadata (the rows were CASCADE-deleted; the bytes survived the undo window).
    const fileDocs = (snap.documents || [])
      .filter(d => d.file)
      .map(d => ({ documentType: d.documentType, file: d.file }));
    if (fileDocs.length) await window.api.restoreProjectFiles(snap.id, created.id, fileDocs);
    // Milestone 9: a task can no longer be linked to a Project it's already
    // linked to a Department for (mutual exclusivity) — linkProjectTask
    // returns {ok:false} instead of throwing in that case, so a task
    // re-linked to a Department during the 5s undo window doesn't silently
    // report success here.
    const relinkFailures = [];
    for (const t of (snap.tasks || [])) {
      const res = await window.api.linkProjectTask(created.id, t.id);
      if (res && res.ok === false) relinkFailures.push(t.name || ('#' + t.id));
    }
    toast(relinkFailures.length
      ? `Project restored, but couldn't relink: ${relinkFailures.join(', ')}`
      : 'Project restored');
  } catch { toast('Could not restore project'); }
  await loadProjectsList();
}

// ── Link an existing task ──
// Which container the Link Task modal is currently linking into — 'project'
// (default, backward-compatible with the zero-arg Projects call site) or
// 'department' (Internal Tasks). Shared by renderLinkList/doLinkTask below.
let _linkCtx = { kind: 'project', containerId: null };

async function openLinkModal(kind = 'project', containerId = null) {
  _linkCtx = { kind, containerId: containerId ?? (kind === 'department' ? currentDept?.id : currentProject?.id) };
  try {
    linkableTasks = kind === 'department' ? await window.api.listLinkableTasksForDept()
      : await window.api.listLinkableTasks();
  }
  catch { toast('Could not load tasks'); return; }
  if (!Array.isArray(linkableTasks)) linkableTasks = [];
  document.getElementById('link-task-filter').value = '';
  renderLinkList();
  document.getElementById('link-task-overlay').classList.add('open');
}
function closeLinkModal() {
  document.getElementById('link-task-overlay').classList.remove('open');
}
function linkTaskOverlayClick(e) {
  if (e.target === document.getElementById('link-task-overlay')) closeLinkModal();
}
function renderLinkList() {
  const host = document.getElementById('link-task-list');
  const q = (document.getElementById('link-task-filter').value || '').toLowerCase().trim();
  host.innerHTML = '';

  const all = (linkableTasks || []).filter(t => textMatch(
    [t.name, t.company, t.system, t.source, t.firstSourceRef], q));

  if (all.length === 0) {
    host.appendChild(pjMk('div', 'cp-records-empty', 'No unlinked tasks available.'));
    return;
  }

  all.forEach(t => {
    const row = pjMk('div', 'pj-link-row');
    const info = pjMk('div', 'pj-link-info');
    const main = pjMk('div', 'pj-link-main', t.name || '(untitled task)');
    info.appendChild(main);
    const metaBits = [t.company, t.system].filter(Boolean).join(' · ');
    const logCount = t.logCount || 0;
    const sess = logCount + ' session' + (logCount === 1 ? '' : 's');
    const meta = pjMk('div', 'pj-link-meta', sess + (metaBits ? ' · ' + metaBits : ''));
    info.appendChild(meta);
    row.appendChild(info);

    const btn = pjMk('button', 'btn primary');
    btn.style.padding = '6px 14px';
    btn.textContent = 'Link';
    btn.addEventListener('click', () => doLinkTask(t.id));
    row.appendChild(btn);
    host.appendChild(row);
  });
}
async function doLinkTask(taskId) {
  let res;
  try {
    res = _linkCtx.kind === 'department' ? await window.api.linkDepartmentTask(taskId, _linkCtx.containerId)
      : await window.api.linkProjectTask(_linkCtx.containerId, taskId);
  }
  catch { toast('Could not link task'); return; }
  // Project/Department are mutually exclusive — the picker already excludes
  // the other kind, but check ok anyway rather than assuming success.
  if (res && res.ok === false) { toast(res.error || 'Could not link task'); return; }
  // Drop the just-linked task from the picker source, refresh both views.
  linkableTasks = (linkableTasks || []).filter(t => t.id !== taskId);
  renderLinkList();
  if (_linkCtx.kind === 'department') await reloadCurrentDept();
  else await reloadCurrentProject();
  toast('Task linked');
}
async function doUnlinkTask(taskId) {
  try { await window.api.unlinkProjectTask(taskId); }
  catch { toast('Could not unlink task'); return; }
  await reloadCurrentProject();
  toast('Task unlinked');
}
// Delete a zero-log project task outright (see buildProjectTaskCard for why: it
// has no other identity once unlinked). Undo re-creates an equivalent task.
async function doDeleteProjectTask(task) {
  try { await window.api.deleteTask(task.id); }
  catch { toast('Could not delete task'); return; }
  await reloadCurrentProject();
  showGenericUndo('Task deleted', async () => {
    try {
      await window.api.createTask({
        name: task.name, status: task.status, company: task.company, system: task.system,
        source: task.source, projectId: task.projectId,
      });
    } catch { toast('Could not restore task'); return; }
    await reloadCurrentProject();
  });
}

// ══ ALL TASKS — cross-cutting filterable view of every task ════════════════
// Unlike Projects/Internal Tasks (one container's tasks at a time), this page
// lists every task the user owns regardless of its Project/Department links,
// each with its full session history — the one place "which task is this
// session actually on?" can be answered without knowing where to look first.
// Milestone 7 note: All Tasks deliberately STAYS on tasks:list (full payload,
// nested workLogs), not the lightweight tasks:index — despite the original
// ROADMAP spec assuming its filter logic (atTaskMatchesFilters) was the only
// consumer. Its cards are built by buildLinkedTaskCard(t, handlers), the same
// renderer Projects/Internal Tasks use, which nests each task's sessions in a
// collapsible table — switching this list to tasks:index would silently make
// every card's sessions disappear. Only the picker call sites (Add Record,
// Session edit modal, Merge modal) and the palette actually never render
// sessions, so only those were switched.
let allTasksList = [];        // Task[] (with nested workLogs) from tasks:list — see note above
let atProjectsIdx = [];       // for the Project filter dropdown (all statuses, not just ACTIVE)
let atDepartmentsIdx = [];    // for the Department filter dropdown
let atStatuses = new Set();   // active ENTRY_STATUS filter chips
// Milestone 9 — top-level population split, now that Project/Department are
// mutually exclusive: '' (All) | 'project' | 'internal' | 'unassigned'.
let atTypeFilter = '';
// Milestone 11 — the IntersectionObserver an in-progress incremental render
// created, if any. Every call to renderAllTasksCards() disconnects this
// before building a new one, so a superseded render's observer (e.g. from
// fast typing in the search box, each keystroke re-rendering) is never left
// orphaned, still watching a sentinel that's no longer in the live DOM.
let atCardsObserver = null;
let atPresetFilter = null;    // one-shot filter applied on next render (e.g. {departmentId} from Analytics' chart click-through), then cleared
// Milestone 11 — a second one-shot, same apply-after-DOM-attachment mechanism
// as atPresetFilter above, but sourced from persisted uiState instead of an
// explicit click-through; uses the selects' own raw string values (not
// atPresetFilter's numeric-id convention), applied first so a genuine
// atPresetFilter (a just-taken, more specific action) can still override it.
let atRestoreFilter = null;

// Snapshot the filter bar's current values into uiState.filters.allTasks —
// called after every change so relaunching the app lands back on the same slice.
function persistAllTasksFilters() {
  uiState.filters.allTasks = {
    search: document.getElementById('at-search')?.value || '',
    company: document.getElementById('at-company')?.value || '',
    system: document.getElementById('at-system')?.value || '',
    project: document.getElementById('at-project')?.value || '',
    department: document.getElementById('at-department')?.value || '',
    statuses: Array.from(atStatuses),
    type: atTypeFilter,
  };
  saveUiStateDebounced();
}

async function initAllTasksModule() {
  try {
    [allTasksList, atProjectsIdx, atDepartmentsIdx] = await Promise.all([
      window.api.listTasks(), window.api.listProjects(), window.api.listDepartments(),
    ]);
  } catch { toast('Could not load tasks'); return; }
  if (!Array.isArray(allTasksList))     allTasksList = [];
  if (!Array.isArray(atProjectsIdx))    atProjectsIdx = [];
  if (!Array.isArray(atDepartmentsIdx)) atDepartmentsIdx = [];
  const savedFilters = uiState.filters.allTasks;
  if (savedFilters) {
    atStatuses = new Set(savedFilters.statuses || []);
    atTypeFilter = savedFilters.type || '';
    atRestoreFilter = savedFilters;
  }
  renderAllTasksPanel();
}

// Build the whole panel (filter bar + cards) once per load/reload; filter
// changes only re-render the cards container so the search input never loses
// focus mid-keystroke (same shell-vs-body split renderCatRecords uses).
function renderAllTasksPanel() {
  const host = document.getElementById('at-panel');
  host.innerHTML = '';

  // Milestone 9 — a top-level type split (All / Project tasks / Internal /
  // Unassigned), separate from the Project/Department dropdowns below (which
  // narrow to one specific container; this narrows to a whole population).
  const typeCtl = document.createElement('div'); typeCtl.className = 'seg-ctl'; typeCtl.id = 'at-type-ctl';
  typeCtl.style.marginBottom = 'var(--space-4)';
  [['', 'All'], ['project', 'Project tasks'], ['internal', 'Internal'], ['unassigned', 'Unassigned']].forEach(([val, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'seg-btn' + (atTypeFilter === val ? ' active' : ''); btn.dataset.type = val;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      atTypeFilter = val;
      typeCtl.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === val));
      renderAllTasksCards();
      persistAllTasksFilters();
    });
    typeCtl.appendChild(btn);
  });
  host.appendChild(typeCtl);

  const bar = document.createElement('div'); bar.className = 'cp-filter-bar';
  const mkField = (labelText, el) => {
    const f = document.createElement('div'); f.className = 'cp-filter-field';
    const l = document.createElement('label'); l.textContent = labelText;
    f.appendChild(l); f.appendChild(el); return f;
  };

  const searchInp = document.createElement('input');
  searchInp.type = 'text'; searchInp.id = 'at-search'; searchInp.placeholder = 'Search tasks…';
  searchInp.addEventListener('input', () => { renderAllTasksCards(); persistAllTasksFilters(); });
  bar.appendChild(mkField('Search', searchInp));

  const mkSelect = (id, allLabel, extraOpts, onChange) => {
    const sel = document.createElement('select'); sel.id = id;
    const allOpt = document.createElement('option'); allOpt.value = ''; allOpt.textContent = allLabel;
    sel.appendChild(allOpt);
    extraOpts.forEach(o => {
      const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => { (onChange || renderAllTasksCards)(); persistAllTasksFilters(); });
    return sel;
  };

  bar.appendChild(mkField('Company', mkSelect('at-company', 'All companies',
    lkOptions('COMPANY').map(o => ({ value: o.label, label: o.label })))));
  bar.appendChild(mkField('System', mkSelect('at-system', 'All systems',
    lkOptions('SYSTEM').map(o => ({ value: o.label, label: o.label })))));
  bar.appendChild(mkField('Project', mkSelect('at-project', 'All projects',
    [{ value: 'none', label: 'Unlinked' }, ...atProjectsIdx.map(p => ({ value: String(p.id), label: p.name }))])));
  bar.appendChild(mkField('Department', mkSelect('at-department', 'All departments',
    [{ value: 'none', label: 'No department' }, ...atDepartmentsIdx.map(d => ({ value: String(d.id), label: d.label }))])));

  const clearBtn = document.createElement('button'); clearBtn.className = 'cp-filter-clear';
  clearBtn.innerHTML = ic('x') + ' Clear filters';
  clearBtn.addEventListener('click', () => {
    atStatuses.clear();
    atTypeFilter = '';
    typeCtl.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === ''));
    searchInp.value = '';
    ['at-company', 'at-system', 'at-project', 'at-department'].forEach(id => { document.getElementById(id).value = ''; });
    renderAllTasksStatusChips();
    renderAllTasksCards();
    persistAllTasksFilters();
  });
  bar.appendChild(clearBtn);
  host.appendChild(bar);

  // Milestone 11 — apply persisted filters first (so relaunching lands on the
  // same slice), then a genuine one-shot atPresetFilter (Analytics' "Hours by
  // Department" bar click-through, see openAllTasksForDepartment) on top,
  // since that's a just-taken, more specific action that should win. Both
  // must run AFTER `bar` is attached to the live document (host.appendChild
  // above), since getElementById can't find an element that only exists in a
  // detached node.
  if (atRestoreFilter) {
    const r = atRestoreFilter; atRestoreFilter = null;
    if (r.search) searchInp.value = r.search;
    if (r.company) document.getElementById('at-company').value = r.company;
    if (r.system) document.getElementById('at-system').value = r.system;
    if (r.project) document.getElementById('at-project').value = r.project;
    if (r.department) document.getElementById('at-department').value = r.department;
  }
  if (atPresetFilter) {
    const preset = atPresetFilter; atPresetFilter = null;
    if (preset.company) document.getElementById('at-company').value = preset.company;
    if (preset.system) document.getElementById('at-system').value = preset.system;
    if (preset.projectId != null) document.getElementById('at-project').value = String(preset.projectId);
    if (preset.departmentId != null) document.getElementById('at-department').value = String(preset.departmentId);
  }

  const chipsField = document.createElement('div'); chipsField.className = 'cp-filter-field';
  const chipsLabel = document.createElement('label'); chipsLabel.textContent = 'Status';
  const chipsWrap = document.createElement('div'); chipsWrap.className = 'filter-chips'; chipsWrap.id = 'at-status-chips';
  chipsField.appendChild(chipsLabel); chipsField.appendChild(chipsWrap);
  host.appendChild(chipsField);
  renderAllTasksStatusChips();

  const cardsHost = document.createElement('div'); cardsHost.id = 'at-cards';
  cardsHost.style.marginTop = 'var(--space-5)';
  host.appendChild(cardsHost);
  renderAllTasksCards();
}

function renderAllTasksStatusChips() {
  const wrap = document.getElementById('at-status-chips');
  wrap.innerHTML = '';
  lkOptions('ENTRY_STATUS').forEach(o => {
    const btn = document.createElement('button');
    btn.className = 'filter-chip' + (atStatuses.has(o.code) ? ' active' : '');
    btn.textContent = o.label;
    btn.addEventListener('click', () => {
      if (atStatuses.has(o.code)) atStatuses.delete(o.code); else atStatuses.add(o.code);
      btn.classList.toggle('active');
      renderAllTasksCards();
      persistAllTasksFilters();
    });
    wrap.appendChild(btn);
  });
}

function atTaskMatchesFilters(t, q, company, system, projectSel, deptSel) {
  if (atTypeFilter === 'project' && t.projectId == null) return false;
  if (atTypeFilter === 'internal' && t.departmentId == null) return false;
  if (atTypeFilter === 'unassigned' && (t.projectId != null || t.departmentId != null)) return false;
  if (atStatuses.size && !atStatuses.has(t.status)) return false;
  if (company && t.company !== company) return false;
  if (system && t.system !== system) return false;
  if (projectSel === 'none') { if (t.projectId != null) return false; }
  else if (projectSel && String(t.projectId) !== projectSel) return false;
  if (deptSel === 'none') { if (t.departmentId != null) return false; }
  else if (deptSel && String(t.departmentId) !== deptSel) return false;
  if (q) {
    const hay = [t.name, t.company, t.system, t.department, t.source, t.firstSourceRef].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// Re-render just the card list against the current filter control values.
function renderAllTasksCards() {
  const host = document.getElementById('at-cards');
  if (!host) return;
  // Disconnect any observer from a superseded render before replacing the
  // DOM it was watching — otherwise a render still mid-chunk-loading (e.g.
  // one keystroke ago) leaks: its sentinel is detached but the observer
  // keeps a live reference to it, and its closure keeps that whole stale
  // render's cards/filtered list/host alive.
  if (atCardsObserver) { atCardsObserver.disconnect(); atCardsObserver = null; }
  host.innerHTML = '';

  const q = (document.getElementById('at-search').value || '').trim().toLowerCase();
  const company = document.getElementById('at-company').value;
  const system = document.getElementById('at-system').value;
  const projectSel = document.getElementById('at-project').value;
  const deptSel = document.getElementById('at-department').value;
  const filtered = allTasksList.filter(t => atTaskMatchesFilters(t, q, company, system, projectSel, deptSel));

  const head = document.createElement('div'); head.className = 'cp-records-head';
  const title = document.createElement('h2'); title.className = 'cp-records-title';
  title.textContent = 'Tasks (' + filtered.length +
    (filtered.length !== allTasksList.length ? ' of ' + allTasksList.length : '') + ')';
  head.appendChild(title);
  host.appendChild(head);

  if (!filtered.length) {
    host.appendChild(pjMk('div', 'cp-records-empty',
      allTasksList.length ? 'No tasks match these filters.' : 'No tasks yet.'));
    return;
  }

  // Milestone 11 — incremental rendering: measured ~177ms to build all 322
  // cards against the real production dataset (well above the ~100ms
  // interaction-latency budget from this milestone's own micro-jank pass),
  // so render the first AT_CHUNK_SIZE cards immediately and load the rest in
  // chunks as an IntersectionObserver sentinel scrolls into view. Browse and
  // Task Detail were measured too (63ms/26ms) and left as plain full renders —
  // no premature optimization beyond what the measurement actually showed.
  const AT_CHUNK_SIZE = 40;
  const cardOpts = (t) => ({
    onEdit: () => openAllTasksEditTask(t.id),
    onDelete: () => doDeleteAllTasksTask(t),
    onSessionSaved: reloadAllTasksModule,
    // All Tasks mixes both populations on one page (unlike Projects/Internal
    // Tasks' own detail views, where the container is already implied) — show
    // which one each card belongs to.
    showContainerTag: true,
  });

  const sentinel = document.createElement('div'); sentinel.className = 'at-load-sentinel';
  host.appendChild(sentinel);
  let renderedCount = 0;
  const renderChunk = () => {
    filtered.slice(renderedCount, renderedCount + AT_CHUNK_SIZE)
      .forEach(t => host.insertBefore(buildLinkedTaskCard(t, cardOpts(t)), sentinel));
    renderedCount = Math.min(renderedCount + AT_CHUNK_SIZE, filtered.length);
    if (renderedCount >= filtered.length) {
      if (atCardsObserver) { atCardsObserver.disconnect(); atCardsObserver = null; }
      sentinel.remove();
    }
  };
  renderChunk();
  if (renderedCount < filtered.length) {
    atCardsObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) renderChunk();
    }, { root: host.closest('.cp-records-panel'), rootMargin: '400px' });
    atCardsObserver.observe(sentinel);
  }
}

function openAllTasksEditTask(taskId) {
  const task = allTasksList.find(t => t.id === taskId);
  if (!task) return;
  openBacklogModal(taskId, { task, onSaved: reloadAllTasksModule });
}

// Delete a zero-log task outright (see buildLinkedTaskCard for why: unlinking
// isn't offered here since this page isn't a container). Undo re-creates an
// equivalent task, restoring both its Project and Department links if it had them.
async function doDeleteAllTasksTask(task) {
  try { await window.api.deleteTask(task.id); }
  catch { toast('Could not delete task'); return; }
  await reloadAllTasksModule();
  showGenericUndo('Task deleted', async () => {
    try {
      await window.api.createTask({
        name: task.name, status: task.status, company: task.company, system: task.system,
        source: task.source, projectId: task.projectId, department: task.department,
      });
    } catch { toast('Could not restore task'); return; }
    await reloadAllTasksModule();
  });
}

async function reloadAllTasksModule() {
  try { allTasksList = await window.api.listTasks(); } catch { return; }
  if (!Array.isArray(allTasksList)) allTasksList = [];
  renderAllTasksCards();
}

// ══ INTERNAL TASKS — DEPARTMENT lookup dimension ════════════════════════════
// Department is a plain lookup category (like Company/System), not a table — no
// profile/edit modal here. This page lists every active department on the left
// and, per department, manages its linked tasks on the right, reusing the exact
// same Tasks-section markup/card (buildLinkedTaskCard) and task modal
// (openBacklogModal) Projects already uses.
let deptList = [];
let currentDept = null;   // full department ({id, code, label, tasks}) loaded in the right panel

async function initInternalTasksModule() {
  try { deptList = await window.api.listDepartments(); }
  catch { toast('Could not load departments'); return; }
  if (!Array.isArray(deptList)) deptList = [];
  renderDeptList();
  if (currentDept) await selectDept(currentDept.id);
  else renderDeptTasksPanel(null);
}

function renderDeptList() {
  const q = (document.getElementById('dept-search').value || '').trim().toLowerCase();
  const wrap = document.getElementById('dept-list');
  wrap.innerHTML = '';
  const items = q ? deptList.filter(d => d.label.toLowerCase().includes(q)) : deptList;
  if (!items.length) {
    const empty = document.createElement('div'); empty.className = 'cp-list-empty';
    empty.textContent = deptList.length ? 'No matches' : 'No departments yet — add one from Settings';
    wrap.appendChild(empty);
    return;
  }
  items.forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'cp-list-item' + (currentDept && currentDept.id === d.id ? ' active' : '');
    const nm = document.createElement('span'); nm.className = 'cp-list-name';
    nm.textContent = d.label; nm.title = d.label;
    const ct = document.createElement('span'); ct.className = 'cp-list-count';
    ct.textContent = d.taskCount;
    btn.appendChild(nm); btn.appendChild(ct);
    btn.addEventListener('click', () => selectDept(d.id));
    wrap.appendChild(btn);
  });
}

async function selectDept(id) {
  let dept;
  try { dept = await window.api.getDepartment(id); }
  catch { toast('Could not load department'); return; }
  currentDept = dept;
  renderDeptList();
  renderDeptTasksPanel(dept);
  uiState.filters.internalTasks = { deptId: dept.id };
  saveUiStateDebounced();
}

async function reloadCurrentDept() {
  if (!currentDept) return;
  await selectDept(currentDept.id);
  // Task counts on the left list may have changed (new/deleted task).
  try { deptList = await window.api.listDepartments(); renderDeptList(); } catch {}
}

// (Re)build the right panel: a department placeholder, or its Tasks section —
// same header/New Task/Link Task/card layout as renderProjectDetail's Tasks
// section, just scoped to `dept` instead of `currentProject`.
function renderDeptTasksPanel(dept) {
  const host = document.getElementById('dept-tasks-panel');
  host.innerHTML = '';
  if (!dept) {
    const ph = document.createElement('div'); ph.className = 'cp-placeholder';
    ph.innerHTML = '<div class="icon">' + ic('building') + '</div><p>Select a department to view its tasks</p>';
    host.appendChild(ph);
    return;
  }

  const head = document.createElement('div'); head.className = 'cp-records-head';
  const title = document.createElement('h2'); title.className = 'cp-records-title';
  title.textContent = dept.label;
  head.appendChild(title);
  host.appendChild(head);

  const tasksSec = pjMk('div', 'pj-section');
  const tHead = pjMk('div', 'pj-section-head');
  const tTitle = pjMk('div', 'pj-section-title');
  tTitle.innerHTML = ic('list');
  const list = Array.isArray(dept.tasks) ? dept.tasks : [];
  tTitle.appendChild(document.createTextNode('Tasks (' + list.length + ')'));
  tHead.appendChild(tTitle);
  const tActions = pjMk('div', 'pj-section-actions');
  const newBtn = pjMk('button', 'btn primary');
  newBtn.innerHTML = ic('plus') + ' New Task';
  newBtn.title = 'Create a new task already linked to this department';
  newBtn.addEventListener('click', openDeptNewTask);
  const linkBtn = pjMk('button', 'btn');
  linkBtn.innerHTML = ic('calendar-plus') + ' Link Task';
  linkBtn.addEventListener('click', () => openLinkModal('department', dept.id));
  tActions.appendChild(newBtn);
  tActions.appendChild(linkBtn);
  tHead.appendChild(tActions);
  tasksSec.appendChild(tHead);

  if (list.length === 0) {
    tasksSec.appendChild(pjMk('div', 'cp-records-empty', 'No tasks linked yet — use “Link Task” to attach existing work.'));
  } else {
    list.forEach(t => tasksSec.appendChild(buildLinkedTaskCard(t, {
      onEdit: () => openDeptEditTask(t.id),
      onUnlink: () => doUnlinkDeptTask(t.id),
      onDelete: () => doDeleteDeptTask(t),
      onSessionSaved: reloadCurrentDept,
      unlinkTitle: 'Unlink from this department',
    })));
  }
  host.appendChild(tasksSec);
}

function openDeptNewTask() {
  if (!currentDept) return;
  openBacklogModal(null, { departmentId: currentDept.id, onSaved: reloadCurrentDept });
}
function openDeptEditTask(taskId) {
  if (!currentDept) return;
  const task = (currentDept.tasks || []).find(t => t.id === taskId);
  if (!task) return;
  openBacklogModal(taskId, { task, departmentId: task.departmentId ?? currentDept.id, onSaved: reloadCurrentDept });
}
async function doUnlinkDeptTask(taskId) {
  try { await window.api.unlinkDepartmentTask(taskId); }
  catch { toast('Could not unlink task'); return; }
  await reloadCurrentDept();
  toast('Task unlinked');
}
// Delete a zero-log department task outright (see buildLinkedTaskCard for why: it
// has no other identity once unlinked). Undo re-creates an equivalent task.
async function doDeleteDeptTask(task) {
  try { await window.api.deleteTask(task.id); }
  catch { toast('Could not delete task'); return; }
  await reloadCurrentDept();
  showGenericUndo('Task deleted', async () => {
    try {
      await window.api.createTask({
        name: task.name, status: task.status, company: task.company, system: task.system,
        source: task.source, department: task.department,
      });
    } catch { toast('Could not restore task'); return; }
    await reloadCurrentDept();
  });
}
