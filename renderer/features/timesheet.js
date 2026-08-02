// ── IPC ──
async function refreshDayList() {
  const days = await window.api.listDays();
  savedDays = new Set(days);
  // Days loaded lazily — only fetch data when a day is actually opened
}

// Persist just the default employee name (auto-saved when the Name field changes)
// without blocking the UI, surfacing a toast if the write fails.
function persistLookups() {
  Promise.resolve(window.api.saveLookups({ defaultName: LK.defaultName })).catch(() => toast('Could not save settings'));
}

// ── Calendar toggle ──
function toggleCalendar(e) {
  e.stopPropagation();
  document.getElementById('cal-trigger').classList.toggle('open');
}
document.addEventListener('click', () => {
  document.getElementById('cal-trigger')?.classList.remove('open');
});

// ── Calendar ──
function renderCalendar() {
  const label = new Date(calYear, calMonth, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  document.getElementById('cal-month-label').textContent = label;
  document.getElementById('cal-trigger-label').textContent = label;

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';
  ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-dow'; el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const todayStr = fmt(new Date());

  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div'); el.className = 'cal-day empty';
    grid.appendChild(el);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const el = document.createElement('div');
    el.className = 'cal-day';
    el.textContent = d;
    if (dateStr === todayStr)   el.classList.add('today');
    if (savedDays.has(dateStr)) el.classList.add('has-data');
    if (dateStr === activeDate) el.classList.add('selected');
    el.addEventListener('click', () => {
      document.getElementById('cal-trigger').classList.remove('open');
      switchDay(dateStr);
    });
    grid.appendChild(el);
  }
}

document.getElementById('cal-prev').addEventListener('click', (e) => {
  e.stopPropagation();
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', (e) => {
  e.stopPropagation();
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
});

// ── Switch day ──
async function switchDay(dateStr) {
  // Stop any running timer before leaving the day
  if (activeTimer.rowRef !== null) stopTimer();

  activeDate = dateStr;

  const list = await window.api.workLogsByDate(dateStr);
  rows = list.map(l => Object.assign({}, l, { eid: l.id }));
  _tsBaseline = new Set(rows.map(r => r.eid));

  document.getElementById('hName').value = (await window.api.getDayName(dateStr)) || LK.defaultName || '';
  document.getElementById('hDate').value = dateStr;

  window.api.setTitle('Cooperation Tools — Timesheet — ' + dateStr);

  renderTable();
  renderCalendar();
  updateTodayBtn();
  clearStatus();
}

// ── Table ──
// Single source of truth mapping an ENTRY_STATUS code to its display suffix
// ('done'/'progress'/'open'/'blocked'), shared by the badge class (status-badge
// container, 'status-' + suffix) and the status-dropdown option class (bare suffix).
// Unknown/legacy codes fall back to 'progress' rather than throwing.
function statusSuffix(code) {
  return { DONE: 'done', IN_PROGRESS: 'progress', OPEN: 'open', BLOCKED: 'blocked' }[code] || 'progress';
}
function statusClass(s) {
  return 'status-' + statusSuffix(s);
}

// ── Day view mode: sessions grouped under their task (default) or a flat list ──
let tsView = (localStorage.getItem('ct-ts-view') === 'flat') ? 'flat' : 'grouped';
const tsNarrow = () => window.innerWidth <= 1100;
function setTsView(v) {
  tsView = v === 'flat' ? 'flat' : 'grouped';
  try { localStorage.setItem('ct-ts-view', tsView); } catch (e) { /* private mode */ }
  renderTable();
}
function syncTsViewCtl() {
  const effective = tsNarrow() ? 'grouped' : tsView;
  document.querySelectorAll('#ts-view-ctl .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === effective);
    if (b.dataset.view === 'flat') {
      b.disabled = tsNarrow();
      b.title = tsNarrow() ? 'Grouped view is used automatically in compact windows' : '';
    }
  });
}
function renderTable() {
  syncTsViewCtl();
  const grouped = tsNarrow() || tsView === 'grouped';
  document.getElementById('ts-table').style.display  = grouped ? 'none' : '';
  document.getElementById('ts-groups').style.display = grouped ? 'flex' : 'none';
  if (grouped) renderTableGrouped();
  else renderTableFlat();
}
let _lastTsNarrow = tsNarrow();
window.addEventListener('resize', () => {
  const narrow = tsNarrow();
  if (narrow !== _lastTsNarrow) {
    _lastTsNarrow = narrow;
    if (activeModule === 'timesheet') renderTable();
  }
});

// Grouped view: one card per task, its sessions nested (mirrors the two-level model).
function renderTableGrouped() {
  const host = document.getElementById('ts-groups');
  host.innerHTML = '';

  const shown = rows.filter(rowMatchesFilter);
  const isFiltered = filterText || filterStatuses.size > 0;
  document.getElementById('filter-count').textContent = isFiltered ? `${shown.length} of ${rows.length} shown` : '';

  // Group sessions by task; a not-yet-saved row (no taskId) is its own group.
  const groups = new Map();
  shown.forEach(r => {
    const key = r.taskId != null ? 't' + r.taskId : r;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  // Done tasks first, then in-progress — same ordering as the flat view.
  const list = [...groups.values()].sort((a, b) =>
    (a[0].status === 'DONE' ? 0 : 1) - (b[0].status === 'DONE' ? 0 : 1));

  const origIdxOf = new Map(rows.map((r, i) => [r, i]));
  list.forEach(g => host.appendChild(buildTaskGroupCard(g, origIdxOf)));

  updateTotals();
  document.getElementById('empty-state').style.display = rows.length ? 'none' : 'flex';
  document.getElementById('row-count').textContent = rows.length || '0';
}

// One task card in the grouped day view: header (name · pills · status ·
// subtotal · add-session) + a mini table of its sessions with row actions.
function buildTaskGroupCard(g, origIdxOf) {
  const first = g[0];
  const card = document.createElement('div');
  card.className = 'tsg-card';

  // ── Header ──
  const head = document.createElement('div');
  head.className = 'tsg-head';

  const title = document.createElement('span');
  title.className = 'tsg-title';
  title.dataset.userContent = ''; title.textContent = first.taskName || first.description || '(untitled task)';
  title.title = 'Click to rename this task';
  title.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'min-inline-input'; inp.style.width = '260px'; inp.style.textAlign = 'left';
    inp.value = first.taskName || '';
    title.replaceWith(inp);
    inp.focus(); inp.select();
    const commit = () => {
      first.taskName = inp.value.trim();
      syncSiblingTasks(first);
      renderTable(); setUnsaved();
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter')  { ev.preventDefault(); inp.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault(); renderTable(); }
    });
  });
  head.appendChild(title);

  // Status badge — same dropdown as the flat view; status is task-level.
  const stBadgeWrap = document.createElement('span');
  stBadgeWrap.className = statusClass(first.status);
  const badge = document.createElement('span');
  badge.className = 'status-badge'; badge.textContent = lkLabel('ENTRY_STATUS', first.status);
  badge.title = 'Click to change status';
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelector('.status-dropdown')?.remove();
    const dropdown = document.createElement('div');
    dropdown.className = 'status-dropdown';
    lkOptions('ENTRY_STATUS').forEach(o => {
      const opt = document.createElement('div');
      opt.className = 'sd-opt ' + statusSuffix(o.code);
      opt.dataset.userContent = ''; opt.textContent = lookupDisplayName(o);
      opt.addEventListener('click', (ev) => {
        ev.stopPropagation();
        first.status = o.code;
        syncSiblingTasks(first);
        dropdown.remove();
        renderTable(); setUnsaved();
      });
      dropdown.appendChild(opt);
    });
    const rect = badge.getBoundingClientRect();
    dropdown.style.top  = (rect.bottom + 4) + 'px';
    dropdown.style.left = rect.left + 'px';
    document.body.appendChild(dropdown);
    const close = () => { dropdown.remove(); document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);
  });
  stBadgeWrap.appendChild(badge);
  head.appendChild(stBadgeWrap);

  // One-click Done (Milestone 10) — sets DONE without opening the status
  // dropdown, with the same undo-toast every other non-destructive-but-easy-
  // to-regret action in the app already uses. Hidden once already DONE.
  if (first.status !== 'DONE') {
    const doneBtn = document.createElement('button');
    doneBtn.className = 'row-btn done-btn'; doneBtn.innerHTML = ic('check');
    doneBtn.title = 'Mark done';
    doneBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const prevStatus = first.status;
      first.status = 'DONE';
      syncSiblingTasks(first);
      renderTable(); setUnsaved();
      showGenericUndo('Marked done', () => {
        first.status = prevStatus;
        syncSiblingTasks(first);
        renderTable(); setUnsaved();
      });
    });
    head.appendChild(doneBtn);
  }

  // View task detail (metadata + rollups + full session history).
  const viewBtn = document.createElement('button');
  viewBtn.className = 'row-btn'; viewBtn.innerHTML = ic('eye');
  viewBtn.title = 'View task details';
  if (first.taskId) viewBtn.addEventListener('click', () => openTaskDetail(first.taskId));
  else { viewBtn.disabled = true; viewBtn.style.opacity = '.45'; viewBtn.title = 'Saving… try again in a moment'; }
  head.appendChild(viewBtn);

  // Category pills (company / system) — both are cross-links. Natural is
  // per-session now, so it's shown per row in the sessions table, not here.
  const meta = document.createElement('span');
  meta.className = 'tsg-meta';
  const pill = (text, kind) => {
    if (!text) return;
    if (kind) {
      const b = document.createElement('button');
      b.className = 'tsg-pill cell-link';
      b.textContent = kind === 'companies' ? companyDisplayName(text) : lkLabel('SYSTEM', text);
      b.title = 'Browse all work for ' + b.textContent;
      b.addEventListener('click', () => openBrowseSlice(kind, text));
      meta.appendChild(b);
    } else {
      const s = document.createElement('span');
      s.className = 'tsg-pill'; s.textContent = text;
      meta.appendChild(s);
    }
  };
  pill(first.company, 'companies');
  pill(first.system, 'systems');
  const projTag = projectRowTag(first.projectId);
  if (projTag) meta.appendChild(projTag);
  const deptTag = departmentRowTag(first.departmentId);
  if (deptTag) meta.appendChild(deptTag);
  head.appendChild(meta);

  // Right side: per-task subtotal + add-session.
  const sub = document.createElement('span');
  sub.className = 'tsg-sub';
  const tMin = totalMins(g);
  const total = document.createElement('span');
  total.className = 'tsg-total';
  total.textContent = tMin ? (tMin + ' min · ' + (tMin / 60).toFixed(2) + ' h') : '—';
  sub.appendChild(total);
  const addBtn = document.createElement('button');
  addBtn.className = 'tsg-add';
  addBtn.innerHTML = ic('plus') + 'Session';
  addBtn.title = 'Log another session on this task';
  if (first.taskId) addBtn.addEventListener('click', () => openSessionModal(null, {
    mode: 'create', task: { id: first.taskId, name: first.taskName, status: first.status }, defaultDate: activeDate,
  }));
  else { addBtn.disabled = true; addBtn.style.opacity = '.45'; addBtn.title = 'Saving… try again in a moment'; }
  sub.appendChild(addBtn);
  head.appendChild(sub);
  card.appendChild(head);

  // ── Sessions table ──
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr>' +
    '<th style="width:90px">Time</th>' +
    '<th style="width:100px">Natural</th>' +
    '<th>Description</th>' +
    '<th style="width:80px;text-align:right">Minutes</th>' +
    '<th style="width:70px;text-align:right">Hours</th>' +
    '<th style="width:100px"></th></tr></thead>';
  const tb = document.createElement('tbody');

  g.forEach(row => {
    const origIdx = origIdxOf.get(row);
    const tr = document.createElement('tr');
    if (activeTimer.rowRef === row) tr.classList.add('timer-running');

    // Time type
    const timeSpan = document.createElement('span');
    timeSpan.textContent = lkLabel('TIME_TYPE', row.time) || '—';
    if (row.time === 'OVERTIME') timeSpan.style.color = 'var(--bad)';
    tr.appendChild(cellWrap(timeSpan, 'cell'));

    // Natural — per-session, so sessions on the same task can genuinely differ.
    tr.appendChild(textCell(lkLabel('ACTIVITY_TYPE', row.natural) || '—'));

    // Description
    const descTd = document.createElement('td');
    const descDiv = document.createElement('div'); descDiv.className = 'cell desc-cell';
    const descSpan = document.createElement('span');
    descSpan.className = 'desc-text'; descSpan.dataset.userContent = ''; descSpan.textContent = row.description;
    descDiv.appendChild(descSpan);
    descTd.appendChild(descDiv);
    tr.appendChild(descTd);

    // Minutes — click to edit inline (same behavior as the flat view)
    const minTd = document.createElement('td'); minTd.style.textAlign = 'right';
    const minCell = document.createElement('div'); minCell.className = 'cell cell-right';
    const minSpan = document.createElement('span');
    minSpan.textContent = row.minutes || '—';
    minSpan.style.cursor = 'pointer'; minSpan.title = 'Click to edit minutes';
    minSpan.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = 1; inp.max = 1440; inp.className = 'min-inline-input';
      inp.value = row.minutes || '';
      minCell.replaceChild(inp, minSpan);
      inp.focus(); inp.select();
      const commit = () => {
        const val = parseInt(inp.value, 10);
        if (!isNaN(val) && val >= 1 && val <= 1440) rows[origIdx].minutes = val;
        renderTable(); setUnsaved();
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); renderTable(); }
      });
    });
    minCell.appendChild(minSpan);
    minTd.appendChild(minCell);
    tr.appendChild(minTd);

    // Hours
    const m = parseFloat(row.minutes);
    const hrsSpan = document.createElement('span');
    hrsSpan.className = 'hours-val';
    hrsSpan.textContent = isNaN(m) ? '—' : (m / 60).toFixed(2);
    tr.appendChild(cellWrap(hrsSpan, 'cell cell-right'));

    // Actions: timer · edit · move · delete
    const acts = document.createElement('div'); acts.className = 'row-actions';
    const timerBtn = document.createElement('button');
    if (activeTimer.rowRef === row) {
      timerBtn.className = 'row-btn timer-stop'; timerBtn.innerHTML = ic('square');
      timerBtn.title = 'Stop timer';
      timerBtn.addEventListener('click', () => stopTimer());
    } else {
      timerBtn.className = 'row-btn timer-start'; timerBtn.innerHTML = ic('play');
      timerBtn.title = 'Start timer';
      timerBtn.addEventListener('click', () => startTimer(origIdx));
    }
    const editBtn = document.createElement('button');
    editBtn.className = 'row-btn'; editBtn.innerHTML = ic('pencil');
    editBtn.title = 'Edit'; editBtn.addEventListener('click', () => openModal(origIdx));
    const moveBtn = document.createElement('button');
    moveBtn.className = 'row-btn'; moveBtn.innerHTML = ic('calendar-clock');
    moveBtn.title = 'Move to another day';
    const delBtn = document.createElement('button');
    delBtn.className = 'row-btn del'; delBtn.innerHTML = ic('trash-2');
    delBtn.title = 'Delete';
    const restoreActs = () => {
      acts.innerHTML = '';
      acts.appendChild(timerBtn); acts.appendChild(editBtn); acts.appendChild(moveBtn); acts.appendChild(delBtn);
    };
    moveBtn.addEventListener('click', () => {
      acts.innerHTML = '';
      const conf = document.createElement('div'); conf.className = 'del-confirm move-confirm';
      const dateInp = document.createElement('input');
      dateInp.type = 'date'; dateInp.className = 'move-date-input'; dateInp.value = activeDate;
      const yes = document.createElement('button'); yes.className = 'row-btn move-yes'; yes.innerHTML = ic('check');
      yes.title = 'Move record to this day';
      yes.addEventListener('click', () => moveRowToDate(origIdx, dateInp.value));
      const no = document.createElement('button'); no.className = 'row-btn del-no'; no.innerHTML = ic('x');
      no.title = 'Cancel';
      no.addEventListener('click', restoreActs);
      dateInp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); moveRowToDate(origIdx, dateInp.value); }
        if (ev.key === 'Escape') { ev.preventDefault(); restoreActs(); }
      });
      conf.appendChild(dateInp); conf.appendChild(yes); conf.appendChild(no);
      acts.appendChild(conf);
      dateInp.focus();
    });
    delBtn.addEventListener('click', () => showDeleteConfirm(acts, () => {
      const removed = rows.splice(origIdx, 1)[0];
      showUndoToast(removed, origIdx);
      renderTable(); setUnsaved();
    }, restoreActs));
    restoreActs();
    tr.appendChild(cellWrap(acts, 'cell'));

    tb.appendChild(tr);
  });

  table.appendChild(tb);
  card.appendChild(table);
  return card;
}

// Icon shown in the row-group divider for each non-DONE status. Falls back to
// 'circle' for any status without a specific icon (keeps new lookup codes safe).
const STATUS_DIVIDER_ICON = { IN_PROGRESS: 'zap', OPEN: 'circle', BLOCKED: 'ban' };

function renderTableFlat() {
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';

  // Done rows are always surfaced first, unlabeled — a pre-existing, intentional
  // exception (completed work reviewed first) to the ENTRY_STATUS workflow order.
  // Every other status gets its own bucket + divider, in the lookup's sort_order
  // (currently Open → In Progress → Blocked), so new statuses need no code change.
  const doneRows = rows.filter(r => r.status === 'DONE' && rowMatchesFilter(r));
  const nonDoneCodes = lkOptions('ENTRY_STATUS').map(o => o.code).filter(c => c !== 'DONE');
  const buckets = nonDoneCodes.map(code => ({
    code, label: lkLabel('ENTRY_STATUS', code),
    rows: rows.filter(r => r.status === code && rowMatchesFilter(r)),
  }));
  // Defensive: a row with an unrecognized/legacy status still renders (grouped
  // at the end, no divider) instead of silently vanishing from the view.
  const known = new Set(['DONE', ...nonDoneCodes]);
  const unknownRows = rows.filter(r => !known.has(r.status) && rowMatchesFilter(r));
  const ordered = [...doneRows, ...buckets.flatMap(b => b.rows), ...unknownRows];

  const isFiltered = filterText || filterStatuses.size > 0;
  const countEl    = document.getElementById('filter-count');
  countEl.textContent = isFiltered ? `${ordered.length} of ${rows.length} shown` : '';

  // Map each row object → its index in `rows` once, so the per-row lookup below
  // is O(1) instead of rows.indexOf() (O(n)) inside the render loop.
  const origIdxOf = new Map(rows.map((r, i) => [r, i]));
  const getOrigIdx = (row) => origIdxOf.get(row);

  // Which `ordered` index starts each non-empty bucket (skip index 0 — the very
  // first visible row never needs a "new section" label).
  const dividerStarts = new Map();
  let cursor = doneRows.length;
  buckets.forEach(b => {
    if (b.rows.length > 0 && cursor > 0) dividerStarts.set(cursor, b);
    cursor += b.rows.length;
  });

  ordered.forEach((row, i) => {
    const origIdx = getOrigIdx(row);

    const startingBucket = dividerStarts.get(i);
    if (startingBucket) {
      const divTr = document.createElement('tr');
      divTr.className = 'inprogress-divider';
      const divTd = document.createElement('td');
      divTd.colSpan = 11;
      divTd.innerHTML = '<div class="inprogress-divider-inner"><span class="inprogress-divider-label">' +
        ic(STATUS_DIVIDER_ICON[startingBucket.code] || 'circle') + ' ' + esc(startingBucket.label) + '</span></div>';
      divTr.appendChild(divTd);
      tbody.appendChild(divTr);
    }

    const tr = document.createElement('tr');
    if (activeTimer.rowRef === row) tr.classList.add('timer-running');

    // #
    const numTd = document.createElement('td');
    const numCellDiv = document.createElement('div'); numCellDiv.className = 'cell cell-center';
    const numSpan = document.createElement('span');
    numSpan.className = 'cell-num'; numSpan.textContent = i + 1;
    numCellDiv.appendChild(numSpan); numTd.appendChild(numCellDiv);
    tr.appendChild(numTd);

    // Task name — the two-level entity this work session belongs to. Click to
    // rename inline (persists the task, distinct from the session's description).
    const taskTd = document.createElement('td');
    const taskCell = document.createElement('div'); taskCell.className = 'cell';
    const taskSpan = document.createElement('span');
    taskSpan.className = 'task-name-cell';
    taskSpan.dataset.userContent = ''; taskSpan.textContent = row.taskName || row.description || '—';
    taskSpan.title = 'Click to rename this task';
    taskSpan.style.cursor = 'pointer'; taskSpan.style.fontWeight = '600';
    taskSpan.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'min-inline-input'; inp.style.width = '100%';
      inp.value = row.taskName || '';
      taskCell.replaceChild(inp, taskSpan);
      inp.focus(); inp.select();
      const commit = () => {
        rows[origIdx].taskName = inp.value.trim();
        syncSiblingTasks(rows[origIdx]);   // task name is task-level
        renderTable(); setUnsaved();
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter')  { ev.preventDefault(); inp.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); renderTable(); }
      });
    });
    taskCell.appendChild(taskSpan); taskTd.appendChild(taskCell);
    tr.appendChild(taskTd);

    tr.appendChild(linkCell(row.company, 'companies'));
    tr.appendChild(linkCell(row.system, 'systems'));
    tr.appendChild(textCell(lkLabel('ACTIVITY_TYPE', row.natural)));
    const timeTd = document.createElement('td');
    const timeDiv = document.createElement('div'); timeDiv.className = 'cell';
    const timeSpan = document.createElement('span');
    timeSpan.textContent = lkLabel('TIME_TYPE', row.time);
    if (row.time === 'OVERTIME') timeSpan.style.color = 'var(--bad)';
    timeDiv.appendChild(timeSpan); timeTd.appendChild(timeDiv);
    tr.appendChild(timeTd);

    // Description
    const descTd = document.createElement('td');
    const descDiv = document.createElement('div');
    descDiv.className = 'cell desc-cell';
    const descSpan = document.createElement('span');
    descSpan.className = 'desc-text'; descSpan.dataset.userContent = ''; descSpan.textContent = row.description;
    descDiv.appendChild(descSpan);
    descTd.appendChild(descDiv);
    tr.appendChild(descTd);

    // Project / Department — cross-links into whichever container is linked
    tr.appendChild(projectCell(row.projectId, row.departmentId));

    // Minutes — click to edit inline
    const minTd = document.createElement('td');
    minTd.style.textAlign = 'right';
    const minCell = document.createElement('div');
    minCell.className = 'cell cell-right';
    const minSpan = document.createElement('span');
    minSpan.textContent = row.minutes || '—';
    minSpan.style.cursor = 'pointer';
    minSpan.title = 'Click to edit minutes';
    minSpan.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = 1; inp.max = 1440;
      inp.className = 'min-inline-input';
      inp.value = row.minutes || '';
      minCell.replaceChild(inp, minSpan);
      inp.focus(); inp.select();
      const commit = () => {
        const val = parseInt(inp.value, 10);
        if (!isNaN(val) && val >= 1 && val <= 1440) rows[origIdx].minutes = val;
        renderTable(); setUnsaved();
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); renderTable(); }
      });
    });
    minCell.appendChild(minSpan);
    minTd.appendChild(minCell);
    tr.appendChild(minTd);

    // Hours
    const m = parseFloat(row.minutes);
    const hrsSpan = document.createElement('span');
    hrsSpan.className = 'hours-val';
    hrsSpan.textContent = isNaN(m) ? '—' : (m/60).toFixed(2);
    tr.appendChild(cellWrap(hrsSpan, 'cell cell-right'));

    // Actions
    const actTd = document.createElement('td');
    const actDiv = document.createElement('div'); actDiv.className = 'cell';
    const acts = document.createElement('div'); acts.className = 'row-actions';

    // Timer button
    const timerBtn = document.createElement('button');
    if (activeTimer.rowRef === row) {
      timerBtn.className = 'row-btn timer-stop';
      timerBtn.innerHTML = ic('square');
      timerBtn.title = 'Stop timer';
      timerBtn.addEventListener('click', () => stopTimer());
    } else {
      timerBtn.className = 'row-btn timer-start';
      timerBtn.innerHTML = ic('play');
      timerBtn.title = 'Start timer';
      timerBtn.addEventListener('click', () => startTimer(origIdx));
    }

    const editBtn = document.createElement('button');
    editBtn.className = 'row-btn'; editBtn.innerHTML = ic('pencil');
    editBtn.title = 'Edit'; editBtn.addEventListener('click', () => openModal(origIdx));

    const viewBtn = document.createElement('button');
    viewBtn.className = 'row-btn'; viewBtn.innerHTML = ic('eye');
    viewBtn.title = 'View task details';
    if (row.taskId) viewBtn.addEventListener('click', () => openTaskDetail(row.taskId));
    else { viewBtn.disabled = true; viewBtn.style.opacity = '.45'; viewBtn.title = 'Saving… try again in a moment'; }

    // One-click Done (Milestone 10) — same behavior/undo as the grouped view's
    // status-badge counterpart; hidden once already DONE.
    const doneBtn = document.createElement('button');
    if (row.status !== 'DONE') {
      doneBtn.className = 'row-btn done-btn'; doneBtn.innerHTML = ic('check');
      doneBtn.title = 'Mark done';
      doneBtn.addEventListener('click', () => {
        const prevStatus = row.status;
        row.status = 'DONE';
        syncSiblingTasks(row);
        renderTable(); setUnsaved();
        showGenericUndo('Marked done', () => {
          row.status = prevStatus;
          syncSiblingTasks(row);
          renderTable(); setUnsaved();
        });
      });
    }

    // Add session — log another work session against THIS row's task (same or a
    // different day). The core two-level capability: one task, many work logs.
    const sessionBtn = document.createElement('button');
    sessionBtn.className = 'row-btn'; sessionBtn.innerHTML = ic('timer-reset') || ic('plus');
    sessionBtn.title = 'Add another session to this task';
    sessionBtn.addEventListener('click', () => openSessionModal(null, {
      mode: 'create', task: { id: row.taskId, name: row.taskName, status: row.status }, defaultDate: activeDate,
    }));

    const dupBtn = document.createElement('button');
    dupBtn.className = 'row-btn'; dupBtn.innerHTML = ic('copy');
    dupBtn.title = 'Duplicate as a new task';
    dupBtn.addEventListener('click', () => {
      // A new, independent task+session (strip ids so the save creates fresh rows).
      rows.splice(origIdx + 1, 0, Object.assign({}, rows[origIdx], { eid: undefined, taskId: undefined }));
      renderTable(); setUnsaved();
    });

    const moveBtn = document.createElement('button');
    moveBtn.className = 'row-btn'; moveBtn.innerHTML = ic('calendar-clock');
    moveBtn.title = 'Move to another day';
    const restoreActs = () => {
      acts.innerHTML = '';
      acts.appendChild(timerBtn); acts.appendChild(editBtn); acts.appendChild(viewBtn);
      if (row.status !== 'DONE') acts.appendChild(doneBtn);
      acts.appendChild(sessionBtn);
      acts.appendChild(dupBtn); acts.appendChild(moveBtn); acts.appendChild(delBtn);
    };
    moveBtn.addEventListener('click', () => {
      acts.innerHTML = '';
      const conf = document.createElement('div'); conf.className = 'del-confirm move-confirm';
      const dateInp = document.createElement('input');
      dateInp.type = 'date'; dateInp.className = 'move-date-input'; dateInp.value = activeDate;
      const yes = document.createElement('button'); yes.className = 'row-btn move-yes'; yes.innerHTML = ic('check');
      yes.title = 'Move record to this day';
      yes.addEventListener('click', () => moveRowToDate(origIdx, dateInp.value));
      const no = document.createElement('button'); no.className = 'row-btn del-no'; no.innerHTML = ic('x');
      no.title = 'Cancel';
      no.addEventListener('click', restoreActs);
      dateInp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); moveRowToDate(origIdx, dateInp.value); }
        if (ev.key === 'Escape') { ev.preventDefault(); restoreActs(); }
      });
      conf.appendChild(dateInp); conf.appendChild(yes); conf.appendChild(no);
      acts.appendChild(conf);
      dateInp.focus();
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'row-btn del'; delBtn.innerHTML = ic('trash-2');
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', () => showDeleteConfirm(acts, () => {
      const removed = rows.splice(origIdx, 1)[0];
      showUndoToast(removed, origIdx);
      renderTable(); setUnsaved();
    }, restoreActs));

    restoreActs();
    actDiv.appendChild(acts); actTd.appendChild(actDiv);
    tr.appendChild(actTd);

    tbody.appendChild(tr);
  });

  updateTotals();
  document.getElementById('empty-state').style.display = rows.length ? 'none' : 'flex';
  document.getElementById('row-count').textContent = rows.length || '0';
}

function cellWrap(el, cls) {
  const td = document.createElement('td');
  const div = document.createElement('div'); div.className = cls;
  div.appendChild(el); td.appendChild(div); return td;
}
function textCell(val) {
  const span = document.createElement('span'); span.textContent = val;
  return cellWrap(span, 'cell');
}
// A company/system cell that cross-links into the Browse slice for that value.
function linkCell(val, kind) {
  if (!val) return textCell(val);
  const btn = document.createElement('button');
  btn.className = 'cell-link';
  btn.textContent = kind === 'companies' ? companyDisplayName(val) : lkLabel('SYSTEM', val);
  btn.title = 'Browse all work for ' + btn.textContent;
  btn.addEventListener('click', () => openBrowseSlice(kind, val));
  return cellWrap(btn, 'cell');
}
// A task's linked-container cell — the same cross-linking pill used elsewhere
// (Description used to carry this inline; it now gets its own column). Shows
// whichever of Project/Department is set (Milestone 9: never both) or a dash
// for a task linked to neither.
function projectCell(projectId, departmentId) {
  const tag = projectRowTag(projectId) || departmentRowTag(departmentId);
  return tag ? cellWrap(tag, 'cell') : textCell('—');
}

// Shared inline "Delete?" confirm used by every module's row delete button.
// Replaces the action buttons in `actsEl` with a Delete?/Yes/No prompt;
// `onYes` performs the deletion, `restore` puts the original buttons back.
function showDeleteConfirm(actsEl, onYes, restore, label) {
  actsEl.innerHTML = '';
  const conf = document.createElement('div'); conf.className = 'del-confirm';
  const lbl  = document.createElement('span'); lbl.textContent = label || 'Delete?';
  const yes  = document.createElement('button'); yes.className = 'row-btn del-yes'; yes.textContent = 'Yes';
  yes.addEventListener('click', onYes);
  const no   = document.createElement('button'); no.className = 'row-btn del-no'; no.textContent = 'No';
  no.addEventListener('click', restore);
  conf.appendChild(lbl); conf.appendChild(yes); conf.appendChild(no);
  actsEl.appendChild(conf);
}

function updateTotals() {
  const t = totalMins(rows);
  document.getElementById('total-min').textContent = t;
  document.getElementById('total-hrs').textContent = (t/60).toFixed(2);
  const otMin = totalMins(rows.filter(r => r.time === 'OVERTIME'));
  document.getElementById('total-ot-min').textContent = otMin;
  document.getElementById('total-ot-hrs').textContent = (otMin/60).toFixed(2);
  document.querySelectorAll('.ot-chip').forEach(el => el.classList.toggle('has-value', otMin > 0));
}

// ── Live Timer ──
function startTimer(rowIdx) {
  if (activeTimer.rowRef !== null) stopTimer();
  activeTimer = {
    rowRef: rows[rowIdx],
    startMs: Date.now(),
    intervalId: setInterval(updateTimerDisplay, 1000),
    accumMs: 0,
    paused: false,
  };
  const chip = document.getElementById('timer-chip');
  chip.classList.add('running'); chip.classList.remove('paused');
  document.getElementById('timer-pause-btn').innerHTML = ic('pause');
  updateTimerDisplay();
  renderTable();
}

// Total elapsed ms = accumulated (paused) time + the current running stretch.
function timerElapsedMs() {
  const accum = activeTimer.accumMs || 0;
  const running = (!activeTimer.paused && activeTimer.startMs) ? (Date.now() - activeTimer.startMs) : 0;
  return accum + running;
}

// Pause/resume the live timer without committing minutes.
function togglePauseTimer() {
  if (activeTimer.rowRef === null) return;
  const chip = document.getElementById('timer-chip');
  const btn  = document.getElementById('timer-pause-btn');
  if (activeTimer.paused) {
    activeTimer.paused = false;
    activeTimer.startMs = Date.now();
    activeTimer.intervalId = setInterval(updateTimerDisplay, 1000);
    chip.classList.remove('paused');
    btn.innerHTML = ic('pause'); btn.title = 'Pause';
  } else {
    activeTimer.accumMs = timerElapsedMs();
    activeTimer.paused = true;
    clearInterval(activeTimer.intervalId);
    activeTimer.intervalId = null;
    chip.classList.add('paused');
    btn.innerHTML = ic('play'); btn.title = 'Resume';
  }
  updateTimerDisplay();
}

function stopTimer() {
  if (activeTimer.rowRef === null) return;
  clearInterval(activeTimer.intervalId);
  const elapsed = Math.max(1, Math.round(timerElapsedMs() / 60000));
  const rowRef = activeTimer.rowRef;
  activeTimer = { rowRef: null, startMs: null, intervalId: null, accumMs: 0, paused: false };
  const chip = document.getElementById('timer-chip');
  chip.classList.remove('running'); chip.classList.remove('paused');
  document.getElementById('timer-pause-btn').innerHTML = ic('pause');

  // Locate the row by reference — it may have shifted position (or be gone).
  const idx = rows.indexOf(rowRef);
  if (idx !== -1) {
    rows[idx].minutes = (parseInt(rows[idx].minutes, 10) || 0) + elapsed;   // keep minutes a Number
    renderTable();
    setUnsaved();
  }
}

function updateTimerDisplay() {
  if (activeTimer.rowRef === null) return;
  const total = Math.floor(timerElapsedMs() / 1000);
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  document.getElementById('timer-display').textContent = `${m}:${s}`;
}

// ── Undo (single row + generic bulk restore) ──
let _undoRestoreFn = null;
function showUndoToast(row, idx) {
  undoRecord = { row, idx };
  _undoRestoreFn = null;
  clearTimeout(_undoTimer);
  document.getElementById('undo-toast-label').textContent = 'Row deleted';
  document.getElementById('undo-toast').classList.add('visible');
  _undoTimer = setTimeout(hideUndoToast, 5000);
}

// Show an undo toast with a custom label whose Undo button runs `restoreFn`.
function showGenericUndo(label, restoreFn) {
  undoRecord = null;
  _undoRestoreFn = restoreFn;
  clearTimeout(_undoTimer);
  document.getElementById('undo-toast-label').textContent = label;
  document.getElementById('undo-toast').classList.add('visible');
  _undoTimer = setTimeout(hideUndoToast, 5000);
}

function hideUndoToast() {
  document.getElementById('undo-toast').classList.remove('visible');
  undoRecord = null;
  _undoRestoreFn = null;
}

function undoDelete() {
  if (_undoRestoreFn) {
    const fn = _undoRestoreFn;
    hideUndoToast();
    fn();
    renderTable();
    setUnsaved();
    return;
  }
  if (!undoRecord) return;
  const { row, idx } = undoRecord;
  // The deleted work_log is gone; strip its ids so the save recreates it fresh.
  rows.splice(Math.min(idx, rows.length), 0, Object.assign({}, row, { eid: undefined, taskId: undefined }));
  hideUndoToast();
  renderTable();
  setUnsaved();
}

// ── Persistence (two-level: tasks + work logs) ────────────────────────────────
// The Timesheet no longer saves a whole day through day:save. Each row is one
// work session (work_log) belonging to a task; edits persist granularly via the
// tasks:* / worklogs:* API. `setUnsaved()` funnels inline field edits + row
// add/delete through a debounced reconciler; structural ops (e.g. move-to-date)
// call the API directly and reload. `eid` = the work_log id; `taskId` = its task.

// Task-level fields of a row (shared across all of a task's sessions). Used
// both to update an existing task's metadata (via updateTaskMeta, which
// ignores projectId/department entirely) and to create a brand-new task (via
// createTask, e.g. from Duplicate/Undo-delete on a Department-linked row) —
// forwarding department here is the same "initial link on a genuinely new
// task is legitimate" reasoning projectId already followed, not a clobber.
function tsTaskPayload(row) {
  return {
    name: (row.taskName && row.taskName.trim()) || row.description || '',
    status: row.status, company: row.company, system: row.system,
    source: row.source || '',
    projectId: row.projectId ?? null,
    department: row.departmentId != null ? lkLabelById('DEPARTMENT', row.departmentId) : '',
  };
}
// Work-log-level fields of a row (this session only). Natural is per-session,
// same as time type — it does not propagate to sibling sessions.
function tsLogPayload(row) {
  return {
    date: row.date || activeDate,
    description: row.description || '',
    minutes: (row.minutes === '' || row.minutes == null) ? '' : row.minutes,
    time: row.time || '',
    natural: row.natural || '',
  };
}
// Propagate task-level fields from `row` onto sibling rows sharing its task, so a
// task with several sessions on-screen stays consistent before we persist it once.
// Natural is per-session and deliberately excluded — siblings may legitimately differ.
function syncSiblingTasks(row) {
  if (!row.taskId) return;
  rows.forEach(r => {
    if (r !== row && r.taskId === row.taskId) {
      r.taskName = row.taskName; r.status = row.status; r.company = row.company;
      r.system = row.system; r.source = row.source; r.projectId = row.projectId;
    }
  });
}
function flashSaved() {
  const el = document.getElementById('save-status');
  el.innerHTML = ic('check') + ' Saved'; el.className = 'saved';
  setTimeout(() => { if (el.className === 'saved') { el.textContent = ''; el.className = ''; } }, 1500);
}
async function refreshSavedDays() {
  try { savedDays = new Set(await window.api.listDays()); } catch { /* keep prior */ }
}
// Reload the active day's work sessions from the DB and re-render (used after
// structural changes). Resets the delete baseline to what's actually stored.
async function reloadTimesheet() {
  if (!activeDate) return;
  const list = await window.api.workLogsByDate(activeDate);
  rows = list.map(l => Object.assign({}, l, { eid: l.id }));
  _tsBaseline = new Set(rows.map(r => r.eid));
  renderTable();
  await refreshSavedDays();
  renderCalendar();
}

// Debounced granular save of the current in-memory rows.
let _saveTimer = null;
let _tsBaseline = new Set();   // work-log ids present at the last load/persist
function setUnsaved() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(persistTimesheet, 300);
}

// Reconcile in-memory rows against the DB: upsert each (create task+log for a new
// row, or update task + log for an existing one), then delete any work_log that
// was removed on-screen (dropping its task too when that was its last session).
async function persistTimesheet() {
  if (!activeDate) return;
  const seen = new Set();
  const taskDone = new Set();
  try {
    for (const row of rows) {
      if (row.eid) {
        seen.add(row.eid);
        if (row.taskId && !taskDone.has(row.taskId)) {
          taskDone.add(row.taskId);
          // Metadata-only — the Timesheet is a session surface and must never
          // write project_id/department_id/support_year_id (tsTaskPayload's
          // own projectId field is simply ignored by this call; see the Edit
          // Record modal's own explicit linkProjectTask/unlinkProjectTask
          // handling above for the one place this view legitimately changes
          // a project link).
          await window.api.updateTaskMeta(row.taskId, tsTaskPayload(row));
        }
        await window.api.updateWorkLog(row.eid, tsLogPayload(row));
      } else {
        let taskId = row.taskId;
        if (!taskId) { const c = await window.api.createTask(tsTaskPayload(row)); taskId = c.id; }
        const r = await window.api.addWorkLog(taskId, tsLogPayload(row));
        if (r && r.id) {
          row.eid = r.id; row.taskId = taskId; seen.add(r.id);
          // Milestone 10's autoAdvanceTaskStatus can change the task's status
          // as a side effect of this very call (OPEN -> IN_PROGRESS on its
          // first session) — sync the row's cached status from the response
          // so the next debounced persistTimesheet() save doesn't stomp the
          // DB back to the pre-advance value via its own updateTask() call.
          if (r.task) { row.status = r.task.status; syncSiblingTasks(row); }
        }
      }
    }
    for (const eid of _tsBaseline) {
      if (!seen.has(eid)) {
        const res = await window.api.deleteWorkLog(eid);
        if (res && res.task && res.task.logCount === 0) await window.api.deleteTask(res.task.id);
      }
    }
    _tsBaseline = seen;
    flashSaved();
    await refreshSavedDays();
    renderCalendar();
  } catch (err) {
    const el = document.getElementById('save-status');
    el.innerHTML = ic('triangle-alert') + ' Save failed'; el.className = 'save-error';
    toast('Could not save — your changes are still on screen. Retrying on next edit.');
  }
}

// Move a single session to another day — just re-date its work_log, then reload.
async function moveRowToDate(origIdx, targetDate) {
  if (!targetDate || targetDate === activeDate) { renderTable(); return; }
  const row = rows[origIdx];
  if (!row || !row.eid) { renderTable(); return; }
  await window.api.updateWorkLog(row.eid, Object.assign(tsLogPayload(row), { date: targetDate }));
  await reloadTimesheet();

  const el = document.getElementById('save-status');
  el.innerHTML = ic('check') + ' Moved to ' + esc(targetDate); el.className = 'saved';
  setTimeout(() => { el.textContent = ''; el.className = ''; }, 2000);
}

function clearStatus() { document.getElementById('save-status').textContent = ''; }

// ── Modal ──
// Add flow: pick an existing task (searchable picker), then fill in the session
// fields only (date, time type, natural, description, minutes) — tasks are
// created only via Projects, never here. Edit mode is unchanged: it opens the
// full task-field form so a record's task-level metadata can still be corrected
// in place.
let fExistingTaskPicker = null;
let recordMode = 'existing';   // Add mode only: 'existing' or 'new'.

// The task-level fields (prefilled + locked when logging against an existing
// task; hidden entirely on the existing path). Session-level fields (date,
// time, natural, description, minutes) stay editable — natural is per-session,
// same as time type, so it's never in this list.
const MODAL_TASK_FIELDS = ['f-taskname','f-company','f-system','f-status'];
// Ids of the currently-open Add/Edit modal's task's existing task_sources rows
// (fetched via getTask when opening Edit on a task with any), so submitModal()
// can tell which rows to update vs. delete when reconciling the sources list.
let _fSourceOriginalIds = [];

// (Re)build the searchable existing-task picker with `selectedId` preselected.
function rebuildExistingTaskPicker(selectedId) {
  fExistingTaskPicker = buildTaskSearchSelect(document.getElementById('f-existing-task'),
    modalTaskList, selectedId, 'Search your tasks…', applyExistingTaskSelection);
}

// Add mode's New Task / Existing Task toggle — switches the modal between
// logging against a picked task (task fields hidden, per .mode-existing) and
// the full task-creation form (.mode-new, existing-task picker hidden). Only
// shown for a genuine fresh Add Record (see openModal); Edit and Add Session
// never call this. Reuses applyExistingTaskSelection's lock/unlock logic so
// switching back to "Existing" re-locks onto whatever the picker still holds.
function setRecordMode(mode) {
  if (recordMode === mode) return;
  recordMode = mode;
  const modal = document.getElementById('modal');
  modal.classList.toggle('mode-existing', mode === 'existing');
  modal.classList.toggle('mode-new', mode === 'new');
  document.querySelectorAll('#f-mode-toggle .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  clearErrorsIn('#modal');
  if (mode === 'new') {
    applyExistingTaskSelection(null);
    setTimeout(() => document.getElementById('f-taskname').focus(), 60);
  } else {
    applyExistingTaskSelection(fExistingTaskPicker ? fExistingTaskPicker.getSelectedId() : null);
    setTimeout(() => document.querySelector('#f-existing-task .ss-input')?.focus(), 60);
  }
}

// Blank a select and prepend a "— select —" placeholder (the empty-new-task state).
function blankSelect(id) {
  const sel = document.getElementById(id);
  const blank = document.createElement('option');
  blank.value = ''; blank.textContent = '— select —';
  sel.insertBefore(blank, sel.firstChild);
  sel.value = '';
}

// React to the "existing task" picker: with a task chosen, prefill its task-level
// metadata (the hidden form still feeds the on-screen row) and show a compact
// summary; with none chosen, reset to a blank, editable "new task" state.
function applyExistingTaskSelection(taskId) {
  const task = taskId != null ? modalTaskList.find(t => t.id === taskId) : null;
  const summary = document.getElementById('f-task-summary');
  if (task) {
    document.getElementById('f-taskname').value = task.name || '';
    populateSelect('f-company', 'companies', task.company || '');
    populateSelect('f-system',  'systems',   task.system  || '');
    populateSelect('f-status',  'status',    task.status  || 'IN_PROGRESS');
    fProjectPicker = buildSearchSelect(document.getElementById('f-project'),
      projectFieldOptions(task.projectId ?? null), task.projectId ?? null, 'No project');
    // Read-only summary of what the session will be logged against. Natural is
    // not shown here — it's per-session, not part of the task being picked.
    const bits = [companyDisplayName(task.company), lkLabel('SYSTEM', task.system)].filter(Boolean).join(' · ');
    const projName = projectNameById(task.projectId);
    summary.innerHTML = '<b>' + esc(task.name || '(untitled task)') + '</b>'
      + (bits ? ' — ' + esc(bits) : '')
      + (projName ? ' · ' + ic('clipboard-list') + ' ' + esc(projName) : '');
    summary.classList.add('has-task');
  } else {
    document.getElementById('f-taskname').value = '';
    populateSelect('f-company', 'companies', ''); blankSelect('f-company');
    populateSelect('f-system',  'systems',   ''); blankSelect('f-system');
    populateSelect('f-status',  'status',    ''); blankSelect('f-status');
    document.getElementById('f-sources-list').innerHTML = ''; _fSourceOriginalIds = [];
    fProjectPicker = buildSearchSelect(document.getElementById('f-project'),
      projectFieldOptions(null), null, 'No project');
    summary.innerHTML = '';
    summary.classList.remove('has-task');
  }
  const locked = !!task;
  MODAL_TASK_FIELDS.forEach(id => { document.getElementById(id).disabled = locked; });
  const pInput = document.querySelector('#f-project .ss-input');
  if (pInput) pInput.disabled = locked;
  document.getElementById('f-lock-hint').hidden = !locked;
  if (locked) clearErrorsIn('#modal');   // drop any stale required-field flags now moot
}

async function openModal(idx = null, opts = {}) {
  editIdx = idx;
  const isEdit = idx !== null;
  const row = isEdit ? rows[idx] : (opts.prefill || null);
  const modal = document.getElementById('modal');
  const defaults = !isEdit ? uiState.sessionDefaults : {};

  document.getElementById('modal-title').textContent = isEdit ? 'Edit Record' : 'Add Record';
  document.querySelector('#modal .modal-footer .btn.primary').textContent = isEdit ? 'Save Changes' : 'Add Record';
  document.getElementById('f-session-heading').innerHTML = ic('clock') + (isEdit ? 'Session Details' : 'New Session Details');

  // Session-level fields (always editable) — natural is per-session, same as
  // time type, so it's populated here regardless of edit/add-session/lock state.
  populateSelect('f-time', 'timeType', row?.time || defaults.time || '');
  populateSelect('f-natural', 'natural', row?.natural || defaults.natural || '');
  document.getElementById('f-date').value        = (isEdit ? (row?.date || activeDate) : activeDate) || fmt(new Date());
  document.getElementById('f-description').value = row?.description || '';
  document.getElementById('f-minutes').value     = row?.minutes || '';
  syncDurationPresets('f-minutes');

  if (isEdit) {
    // Editing an existing record — the full task-field form, prefilled from the row.
    modal.classList.remove('mode-existing');
    modal.classList.remove('mode-new');
    modal.classList.add('mode-edit');
    document.getElementById('f-mode-toggle-row').style.display = 'none';
    fExistingTaskPicker = null;
    document.getElementById('f-task-summary').classList.remove('has-task');
    document.getElementById('f-sources-list').innerHTML = '';
    _fSourceOriginalIds = [];
  } else {
    // Add mode — defaults to logging a session against an existing task; the
    // New Task toggle switches to the full task-creation form instead.
    recordMode = 'existing';
    modal.classList.remove('mode-edit');
    modal.classList.add('mode-existing');
    modal.classList.remove('mode-new');
    document.getElementById('f-mode-toggle-row').style.display = '';
    document.querySelector('#modal .modal-more').open = false;   // reset closed for a fresh Add
    document.querySelectorAll('#f-mode-toggle .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'existing'));
    if (!defaults.time) blankSelect('f-time');
    if (!defaults.natural) blankSelect('f-natural');
    // Lightweight (Milestone 7) — this picker never renders sessions, just the
    // two-line rich option (name/company/system/status/last-worked/hours).
    try { modalTaskList = await window.api.getTasksIndex(); } catch { modalTaskList = []; }
    if (!Array.isArray(modalTaskList)) modalTaskList = [];
    rebuildExistingTaskPicker(null);
    applyExistingTaskSelection(null);
    setTimeout(() => document.querySelector('#f-existing-task .ss-input')?.focus(), 60);
  }

  clearErrorsIn('#modal');
  document.getElementById('modal-overlay').classList.add('open');
  if (isEdit) setTimeout(() => document.getElementById('f-description').focus(), 80);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  editIdx = null;
}

function overlayClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

async function submitModal() {
  clearErrorsIn('#modal');
  const isEdit = editIdx !== null;
  // Add mode's Existing Task path logs a session against the picked task (its
  // metadata is never modified here); its New Task path — and edit mode, which
  // always uses this same full task-field form — create/update the task itself.
  const onExistingPath = !isEdit && recordMode === 'existing';
  const existingTaskId = (onExistingPath && fExistingTaskPicker) ? fExistingTaskPicker.getSelectedId() : null;
  const loggingExisting = existingTaskId != null;
  if (onExistingPath && !loggingExisting) {
    // Existing path with no task picked — flag the picker itself.
    const pInp = document.querySelector('#f-existing-task .ss-input');
    if (pInp) {
      pInp.classList.add('field-error');
      pInp.addEventListener('focus', () => pInp.classList.remove('field-error'), { once: true });
      pInp.focus();
    }
    return;
  }

  // Session-level fields (including Natural, per-session like Time Type) are
  // always required; task-level fields only when creating a new task (when
  // locked, they are prefilled from the task and can't be edited).
  const required = [
    { id: 'f-date',        val: document.getElementById('f-date').value },
    { id: 'f-time',        val: document.getElementById('f-time').value },
    { id: 'f-natural',     val: document.getElementById('f-natural').value },
    { id: 'f-description', val: document.getElementById('f-description').value.trim() },
  ];
  if (!isEdit && !loggingExisting) {
    required.push(
      { id: 'f-company', val: document.getElementById('f-company').value },
      { id: 'f-system',  val: document.getElementById('f-system').value },
      { id: 'f-status',  val: document.getElementById('f-status').value },
    );
  }

  let valid = true;
  required.forEach(f => { if (!f.val) { markError(f.id); valid = false; } });

  // Validate minutes: optional but must be a positive integer ≤ 1440 if provided
  const minRaw = document.getElementById('f-minutes').value.trim();
  if (minRaw !== '') {
    const minVal = parseInt(minRaw, 10);
    if (isNaN(minVal) || minVal < 1 || minVal > 1440 || String(minVal) !== minRaw) {
      markError('f-minutes', 'Enter a whole number from 1 to 1440.'); valid = false;
    }
  }

  if (!valid) { focusFirstError('#modal'); return; }

  // The row pencil is deliberately a work-log-only operation. Task metadata,
  // links, and sources are neither read from this form nor written on save.
  if (isEdit) {
    const origRow = rows[editIdx];
    const merged = Object.assign({}, origRow, {
      date: document.getElementById('f-date').value,
      time: document.getElementById('f-time').value,
      natural: document.getElementById('f-natural').value,
      description: document.getElementById('f-description').value.trim(),
      minutes: minRaw === '' ? '' : parseInt(minRaw, 10),
    });
    rememberSessionDefaults(merged.time, merged.natural);
    try {
      if (merged.eid) await window.api.updateWorkLog(merged.eid, tsLogPayload(merged));
    } catch { toast('Could not save the record'); return; }
    if (activeTimer.rowRef === origRow) activeTimer.rowRef = merged;
    rows[editIdx] = merged;
    closeModal();
    if (merged.date !== activeDate) {
      await refreshSavedDays();
      await switchDay(merged.date);
      toast('Moved to ' + merged.date);
    } else if (!merged.eid) {
      renderTable();
      setUnsaved();
    } else {
      renderTable();
      flashSaved();
    }
    return;
  }

  const descVal   = document.getElementById('f-description').value.trim();
  const taskName  = document.getElementById('f-taskname').value.trim() || descVal;
  const dateVal   = document.getElementById('f-date').value;
  const record = {
    taskName:    taskName,
    company:     document.getElementById('f-company').value,
    system:      document.getElementById('f-system').value,
    natural:     document.getElementById('f-natural').value,
    time:        document.getElementById('f-time').value,
    description: descVal,
    status:      document.getElementById('f-status').value,
    minutes:     minRaw === '' ? '' : parseInt(minRaw, 10),   // Number when set, '' when blank
    projectId:   fProjectPicker ? fProjectPicker.getSelectedId() : null,
    date:        dateVal,
  };
  rememberSessionDefaults(record.time, record.natural);
  const sourceRows = readTaskSourceRows('f-sources-list');
  const targetDate = dateVal || activeDate;

  if (isEdit) {
    // Preserve the identity fields of the row being edited (task/work-log ids)
    // so the save reconciles it in place instead of inserting a duplicate.
    const origRow = rows[editIdx];
    const origProjectId = origRow?.projectId ?? null;
    record.eid    = origRow?.eid;
    record.taskId = origRow?.taskId;
    // Merge onto a copy of the original row instead of replacing it wholesale.
    // This form has no field for the legacy `source` text or a task's
    // Department link — a wholesale replace used to silently turn those into
    // `undefined` on the in-memory row, which the next autosave then wrote
    // back as a blanked `source` (real data loss) and which made the row's
    // Department pill vanish until the next reload (cosmetic, but confusing).
    const merged = Object.assign({}, origRow, record);
    // If a timer is running on the row being edited, keep it attached to the
    // new row object (we replace the object, not mutate it).
    if (activeTimer.rowRef === origRow) activeTimer.rowRef = merged;
    rows[editIdx] = merged;
    syncSiblingTasks(merged);          // task-level fields propagate to sessions
    closeModal();
    renderTable();
    if (merged.taskId) {
      try { await saveTaskSources(merged.taskId, sourceRows, _fSourceOriginalIds); }
      catch { toast('Could not save sources'); }
      // The project link is managed separately from the metadata-only save below
      // (the Timesheet reconciler never writes task link columns — see
      // persistTimesheet/updateTaskMeta) — only touch it when the picker's value
      // actually changed, and only through the real link/unlink API so
      // Project<->Department mutual exclusivity stays enforced server-side.
      if (merged.projectId !== origProjectId) {
        try {
          const r = (merged.projectId != null)
            ? await window.api.linkProjectTask(merged.projectId, merged.taskId)
            : await window.api.unlinkProjectTask(merged.taskId);
          if (r && r.ok === false) throw new Error(r.error || 'link failed');
        } catch (err) {
          toast(err?.message || 'Could not change the project link');
          merged.projectId = origProjectId;   // reflect the DB's actual, unchanged state
          syncSiblingTasks(merged);
          renderTable();
        }
      }
    }
    // Date changed to another day → persist, then follow the session to that day.
    if (targetDate !== activeDate) {
      await persistTimesheet();
      await refreshSavedDays();
      await switchDay(targetDate);
      toast('Moved to ' + targetDate);
    } else {
      setUnsaved();
    }
    return;
  }

  // Existing-task path logs against the picked task; New Task path (existingTaskId
  // null here) creates one below — same-day via the debounced reconciler (which
  // already creates a task for any row with no taskId), other-day inline.
  record.taskId = existingTaskId;

  // Sources live in their own table and need a real task id right away (unlike
  // the row's own simple fields, which the debounced reconciler below can
  // create a task for later) — eagerly create the task now, only when there's
  // actually a source to attach, so the common no-sources path is unaffected.
  if (!loggingExisting && sourceRows.length > 0) {
    try {
      const created = await window.api.createTask(tsTaskPayload(record));
      record.taskId = created.id;
      await saveTaskSources(record.taskId, sourceRows, []);
    } catch { toast('Could not save the task'); return; }
  }

  if (targetDate === activeDate) {
    rows.push(record);
    closeModal();
    renderTable();
    setUnsaved();
  } else {
    // A different day than the one on screen → persist directly and jump there so
    // the new session is visible (the current day's view is unaffected).
    closeModal();
    try {
      const taskId = record.taskId ?? (await window.api.createTask(tsTaskPayload(record))).id;
      await window.api.addWorkLog(taskId, tsLogPayload(record));
      await refreshSavedDays();
      await switchDay(targetDate);
      toast('Session logged to ' + targetDate);
    } catch { toast('Could not save the session'); }
  }
}

function repeatLastSession() {
  const source = [...rows].reverse().find(r => r.taskId != null);
  if (!source) { toast('No saved session is available to repeat on this day'); return; }
  openSessionModal(null, {
    mode: 'create',
    task: { id: source.taskId, name: source.taskName, status: source.status },
    defaultDate: activeDate,
    prefill: {
      time: source.time, natural: source.natural,
      description: source.description, minutes: source.minutes,
    },
  });
}

// Shared field-error helpers (used by every module's form validation).
function clearFieldError(el) {
  if (!el) return;
  el.classList.remove('field-error');
  el.removeAttribute('aria-invalid');
  const errorId = el.dataset.errorMessageId;
  if (errorId) {
    document.getElementById(errorId)?.remove();
    const described = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(x => x && x !== errorId);
    if (described.length) el.setAttribute('aria-describedby', described.join(' '));
    else el.removeAttribute('aria-describedby');
    delete el.dataset.errorMessageId;
  }
}
function markError(id, message = 'Please complete this field.') {
  const el = document.getElementById(id);
  if (!el) return;
  const errorScope = el.closest('.modal-box, form') || document.body;
  const hadError = !!errorScope.querySelector('.field-error');
  clearFieldError(el);
  el.classList.add('field-error');
  el.setAttribute('aria-invalid', 'true');
  const error = document.createElement('div');
  error.className = 'field-error-message';
  error.id = id + '-error-message';
  error.textContent = message;
  el.insertAdjacentElement('afterend', error);
  el.dataset.errorMessageId = error.id;
  const described = new Set((el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  described.add(error.id);
  el.setAttribute('aria-describedby', [...described].join(' '));
  el.addEventListener('input',  () => clearFieldError(el), { once: true });
  el.addEventListener('change', () => clearFieldError(el), { once: true });
  if (!hadError) setTimeout(() => el.focus(), 0);
}
function clearErrorsIn(scope) {
  document.querySelectorAll(scope + ' .field-error').forEach(clearFieldError);
}
function focusFirstError(scope) {
  document.querySelector(scope + ' .field-error')?.focus();
}

// ── Universal Create Hub ──
// This is orchestration only: every choice routes into an existing creation
// form, so validation, ownership scoping, confirmation, and undo behavior stay
// exactly where the mature application already enforces them.
function openCreateHub() {
  document.getElementById('create-hub-overlay').classList.add('open');
}
function closeCreateHub() {
  document.getElementById('create-hub-overlay').classList.remove('open');
}
function createHubOverlayClick(e) {
  if (e.target === document.getElementById('create-hub-overlay')) closeCreateHub();
}
function runCreateFlow(kind) {
  closeCreateHub();
  if (kind === 'quick-find') { openPalette(); return; }
  if (kind === 'session') {
    switchModule('timesheet'); openModal(); return;
  }
  if (kind === 'task') {
    switchModule('all-tasks'); openBacklogModal(); return;
  }
  if (kind === 'project') {
    switchModule('clients'); openProjectModal(); return;
  }
  if (kind === 'knowledge' || kind === 'knowledge-document') {
    switchModule('knowledge');
    startKnowledgeCreation(kind === 'knowledge-document' ? 'DOCUMENT' : 'ARTICLE');
    return;
  }
  if (kind === 'company-document') {
    switchModule('companydocs'); openCompanyDocModal(); return;
  }
  if (kind === 'subscription') {
    switchModule('subscriptions'); openSubModal();
  }
}

// ── Keyboard shortcuts ──
document.addEventListener('keydown', e => {
  const inputFocused = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
  // One selector covers current and future modal overlays. The former hand-kept
  // id list missed newer Session/History/Merge/help overlays, allowing Ctrl+N
  // to open a second dialog behind them.
  const anyOpen = !!document.querySelector(
    '.modal-overlay.open, #print-overlay.open, #palette-overlay.open, #shortcuts-overlay.open, #howthinks-overlay.open'
  );

  // Command palette — available everywhere, even while typing in a field.
  if (e.ctrlKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    if (paletteIsOpen()) closePalette();
    else openPalette();
    return;
  }

  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    toggleFocusMode();
    return;
  }

  if (e.key === 'Escape') {
    closeModal(); closePrint(); closeMonthView(); closeSubModal(); closeSubSettings(); closeBacklogModal();
    closeProjectModal(); closeLinkModal(); closePalette(); closeTaskDetail(); closeCompanyDocModal();
    closeClientVpnModal(); closeClientServerModal(); closeClientInternalModal(); closeClientGroupRenameModal(); closeClientNewGroupModal();
    closeClientRecordInfoModal(); cancelClientEditConfirm(); closeClientHistoryModal();
    closeSessionModal(); closeWlHistoryModal(); closeMergeModal(); closeShortcutsOverlay(); closeHowThinksOverlay();
    closeKnowledgeEditor(); closeKnowledgeGroupEditor(); closeKnowledgeDocumentModal(); toggleKnowledgeCreateMenu(false);
    closeCreateHub(); closeWorkspaceView();
    document.querySelectorAll('.top-menu.open').forEach(m => m.classList.remove('open'));
  }
  // "?" opens the keyboard-shortcuts overlay — only when not typing in a field
  // (so a literal "?" can still be typed into a search box or textarea).
  if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
    if (!typing) { e.preventDefault(); openShortcutsOverlay(); }
  }
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    if (document.getElementById('modal-overlay').classList.contains('open')) submitModal();
    if (document.getElementById('sub-modal-overlay').classList.contains('open')) submitSubModal();
    if (document.getElementById('backlog-modal-overlay').classList.contains('open')) submitBacklogModal();
    if (document.getElementById('project-modal-overlay').classList.contains('open')) submitProjectModal();
    if (document.getElementById('companydoc-modal-overlay').classList.contains('open')) submitCompanyDocModal();
    if (document.getElementById('knowledge-modal-overlay').classList.contains('open')) saveKnowledgeEditor();
    if (document.getElementById('knowledge-group-modal-overlay').classList.contains('open')) saveKnowledgeGroup();
    if (document.getElementById('knowledge-document-modal-overlay').classList.contains('open')) submitKnowledgeDocument();
    if (document.getElementById('client-vpn-modal-overlay').classList.contains('open')) submitClientVpnModal();
    if (document.getElementById('client-server-modal-overlay').classList.contains('open')) submitClientServerModal();
    if (document.getElementById('client-internal-modal-overlay').classList.contains('open')) submitClientInternalModal();
    if (document.getElementById('client-group-rename-modal-overlay').classList.contains('open')) submitClientGroupRename();
    if (document.getElementById('client-new-group-modal-overlay').classList.contains('open')) submitClientNewGroupModal();
  }
  if (!anyOpen && !inputFocused) {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      openCreateHub();
      return;
    }
    if (e.ctrlKey && !e.shiftKey && e.key === 'n') {
      e.preventDefault();
      if      (activeModule === 'subscriptions') openSubModal();
      else if (activeModule === 'timesheet')     openModal();
      else if (activeModule === 'clients' || activeModule === 'projects') openProjectModal();
      else if (activeModule === 'companydocs')   openCompanyDocModal();
      else if (activeModule === 'knowledge')     openKnowledgeEditor();
      else openCreateHub();
    }
    // Day navigation: Ctrl+Left = earlier day, Ctrl+Right = later day
    if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const sorted = [...savedDays].sort(); // ascending
      const idx = sorted.indexOf(activeDate);
      if (e.key === 'ArrowLeft' && idx > 0) {
        switchDay(sorted[idx - 1]);
      } else if (e.key === 'ArrowRight') {
        if (idx >= 0 && idx < sorted.length - 1) switchDay(sorted[idx + 1]);
        else switchDay(fmt(new Date()));
      }
    }
  }
});

// hDate change → switch day
document.getElementById('hDate').addEventListener('change', e => {
  switchDay(e.target.value);
});

// hName: persist the per-date employee name (days metadata) + the default name.
let _nameSaveTimer = null;
let _dayNameTimer  = null;
document.getElementById('hName').addEventListener('input', () => {
  clearTimeout(_dayNameTimer);
  _dayNameTimer = setTimeout(() => {
    if (activeDate) window.api.setDayName(activeDate, document.getElementById('hName').value);
  }, 300);
  clearTimeout(_nameSaveTimer);
  _nameSaveTimer = setTimeout(() => {
    const name = document.getElementById('hName').value.trim();
    if (name && name !== LK.defaultName) {
      LK.defaultName = name;
      persistLookups();
    }
  }, 300);
});

// ── Print ──
// Build the daily work report inner HTML for a given day's rows (shared by the
// Timesheet "Daily report" action and the Reports module's Daily Timesheet PDF).
// Shared bordered stat-card summary row for the printed reports (the polished
// look from the Daily report). `cards` = [{label, value, color?}]; `value` may
// contain trusted HTML, labels are escaped.
function rptLanguage() { return window.ctI18n?.getLanguage?.() === 'ar' ? 'ar' : 'en'; }
function rptLocale() { return rptLanguage() === 'ar' ? 'ar-SA' : 'en-US'; }
function rptText(key, vars) { return window.ctI18n?.t?.(key, vars) || key; }
function rptDirection() { return rptLanguage() === 'ar' ? 'rtl' : 'ltr'; }
function rptWrap(html) { return `<div class="rpt-report" lang="${rptLanguage()}" dir="${rptDirection()}">${html}</div>`; }
function rptRenewLabel(days) {
  if (rptLanguage() !== 'ar') return renewLabel(days);
  if (days === 0) return rptText('Today');
  if (days < 0) return rptText('Overdue by {days} days', { days: Math.abs(days) });
  return rptText('in {days} days', { days });
}

function rptSummaryCards(cards) {
  const cells = cards.map((c, i) => `
        <td style="padding:10px 14px;${i === cards.length - 1 ? '' : 'border-right:1px solid #ccc;'}background:#f5f5f5 !important">
          <div style="font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#888;margin-bottom:2px">${esc(rptText(c.label))}</div>
          <div style="font-size:18px;font-weight:800;color:${c.color || '#111'}">${c.value}</div>
        </td>`).join('');
  return `<table style="width:100%;margin-bottom:18px;font-size:11.5px;border-collapse:collapse;border:1.5px solid #111"><tr>${cells}</tr></table>`;
}

function buildDailyReportHTML(srcRows, date, name, sourcesByTaskId) {
  const [y,m,d] = date.split('-');
  const dt = new Date(+y, +m-1, +d);
  const dayName   = dt.toLocaleDateString(rptLocale(), { weekday:'long' });
  const dateLabel = dt.toLocaleDateString(rptLocale(), { year:'numeric', month:'long', day:'numeric' });

  const printRows  = srcRows;
  const totalMin   = totalMins(printRows);
  const totalHrs   = (totalMin / 60).toFixed(2);

  const byType = {};
  printRows.forEach(r => {
    if (!r.minutes) return;
    const k = r.time || 'OTHER';
    byType[k] = (byType[k] || 0) + (parseFloat(r.minutes) || 0);
  });

  const workMin  = byType['WORK_TIME'] || 0;
  const otMin    = byType['OVERTIME'] || 0;
  const otherMin = Math.max(0, totalMin - workMin - otMin);   // Training/Leave/Holiday/etc.
  const workHrs  = (workMin / 60).toFixed(2);
  const otHrs    = (otMin / 60).toFixed(2);
  const otherHrs = (otherMin / 60).toFixed(2);

  // Group the day's work sessions by their task (two-level model): a task header
  // row (company + system/project label + task title + subtotal) followed by each session's
  // time / description / minutes. Order = first appearance in the day.
  const groups = [];
  const byTask = new Map();
  printRows.forEach(r => {
    const key = (r.taskId != null) ? ('id:' + r.taskId) : ('nm:' + (r.taskName || r.description || ''));
    let g = byTask.get(key);
    if (!g) {
      g = { taskName: r.taskName || r.description || '(untitled task)',
            company: r.company, system: r.system, sessions: [], subtotal: 0,
            sources: (sourcesByTaskId && r.taskId != null && sourcesByTaskId.get(r.taskId)) || [] };
      byTask.set(key, g); groups.push(g);
    }
    g.sessions.push(r);
    g.subtotal += (parseFloat(r.minutes) || 0);
  });

  const rowsHTML = groups.length ? groups.map((g, gi) => {
    // Daily report task titles use COMPANY - PROJECT/SYSTEM - TASK. Historical
    // task names often already begin with the System value (for example,
    // "Payment Gateway - Check..."); strip that prefix so it is not printed twice.
    const companyTitle = companyDisplayName(g.company).trim();
    const projectTitle = String(lkLabel('SYSTEM', g.system) || '').trim().toUpperCase();
    let taskTitle = String(g.taskName || '(untitled task)').trim();
    const existingPrefix = String(g.system || '').trim();
    if (existingPrefix && taskTitle.toLocaleLowerCase().startsWith(existingPrefix.toLocaleLowerCase())) {
      const remainder = taskTitle.slice(existingPrefix.length).replace(/^\s*[-–—:]\s*/, '').trim();
      if (remainder) taskTitle = remainder;
    }
    const reportTaskTitle = [companyTitle, projectTitle, taskTitle].filter(Boolean).join(' - ');
    // Sources are task-level, so they're listed once per task group (below the
    // header) rather than repeated on every session row. A task not yet
    // re-saved since before migration 033 has no structured entries here —
    // its legacy plain-text `source` still renders per-session, below.
    const sourcesHTML = g.sources.length ? `
      <tr>
        <td colspan="4" style="padding:2px 8px 8px 8px;border-top:none">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#999;margin-bottom:2px">${esc(rptText('Sources'))}</div>
          ${g.sources.map(s => {
            const typeLabel = lkLabel('TASK_SOURCE_TYPE', s.type) || s.type || rptText('Source');
            const text = s.ref ? (typeLabel + ' · ' + s.ref) : typeLabel;
            return `<div style="font-size:10px;color:#666;line-height:1.5">&bull; ${esc(text)}${s.url ? ` — ${esc(s.url)}` : ''}</div>`;
          }).join('')}
        </td>
      </tr>` : '';
    const sessionsHTML = g.sessions.map(r => {
      const showTime = r.time === 'WORK_TIME' || r.time === 'OVERTIME';
      const timeCell = showTime
        ? `<span${r.time === 'OVERTIME' ? ' style="color:#b91c1c;font-weight:700"' : ''}>${esc(lkLabel('TIME_TYPE', r.time))}</span>`
        : '—';
      const legacySource = (!(r.sourceCount > 0) && r.source) ? r.source : '';
      return `
        <tr>
          <td>${timeCell}${r.natural ? `<div style="font-size:9px;color:#888;margin-top:2px">${esc(lkLabel('ACTIVITY_TYPE', r.natural))}</div>` : ''}</td>
          <td>${esc(r.description)}${legacySource ? `<div style="font-size:10px;color:#777;margin-top:3px">${esc(legacySource)}</div>` : ''}</td>
          <td style="text-align:right">${r.minutes || '—'}</td>
          <td style="text-align:right">${r.minutes ? (parseFloat(r.minutes) / 60).toFixed(2) : '—'}</td>
        </tr>`;
    }).join('');
    return `
      <tr>
        <td colspan="4" style="background:#f0f0f0 !important;font-weight:700;color:#111;padding:8px 8px">
          ${gi + 1}. ${esc(reportTaskTitle)}
          <span style="float:${rptLanguage() === 'ar' ? 'left' : 'right'};font-weight:800">${g.subtotal} ${esc(rptText('Min'))} · ${(g.subtotal / 60).toFixed(2)} ${esc(rptText('Hrs'))}</span>
        </td>
      </tr>
      ${sourcesHTML}
      ${sessionsHTML}`;
  }).join('') : `<tr><td colspan="4" style="text-align:center;color:#999;padding:18px">${esc(rptText('No work recorded on this day.'))}</td></tr>`;

  const printedOn = new Date().toLocaleDateString(rptLocale(), { year:'numeric', month:'long', day:'numeric' });

  return rptWrap(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
      <div>
        <div style="font-size:10px;font-weight:800;letter-spacing:3.5px;text-transform:uppercase;color:#111;line-height:1.6">MOS TA FA</div>
        <div style="font-size:10px;font-weight:800;letter-spacing:3.5px;text-transform:uppercase;color:#111">${esc(rptText('Cooperation Tools'))}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:14px;font-weight:700;color:#111">${esc(name)}</div>
        <div style="font-size:11px;color:#555;margin-top:2px">${dayName}, ${dateLabel}</div>
      </div>
    </div>
    <div style="font-size:14px;font-weight:700;color:#111;text-transform:uppercase;letter-spacing:.5px;padding-bottom:8px;border-bottom:2px solid #111;margin-bottom:16px">${esc(rptText('Daily Work Report'))}</div>
    ${rptSummaryCards([
      { label: 'Total Hours',   value: `${totalHrs}h` },
      { label: 'Total Minutes', value: totalMin },
      { label: 'Work Time',     value: `${workHrs}h` },
      { label: 'Over Time',     value: `${otHrs}h`, color: otMin > 0 ? '#b91c1c' : '#111' },
    ])}

    <table class="rpt-table">
      <thead>
        <tr>
          <th style="width:90px">${esc(rptText('Time'))}</th>
          <th>${esc(rptText('Description / Source'))} <span style="font-weight:500;text-transform:none;letter-spacing:0;color:#888">(${esc(rptText('sessions grouped by task'))})</span></th>
          <th style="width:45px;text-align:right">${esc(rptText('Min'))}</th>
          <th style="width:45px;text-align:right">${esc(rptText('Hrs'))}</th>
        </tr>
      </thead>
      <tbody>
      ${rowsHTML}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="text-align:right;font-size:10px;font-weight:700;color:#111;text-transform:uppercase;letter-spacing:.5px;padding:8px;border:1px solid #bbb;border-top:2px solid #111;background:#f0f0f0 !important">${esc(rptText('Total'))}</td>
          <td style="text-align:right;font-size:13px;font-weight:800;color:#111;padding:8px;border:1px solid #bbb;border-top:2px solid #111;background:#f0f0f0 !important">${totalMin}</td>
          <td style="text-align:right;font-size:13px;font-weight:800;color:#111;padding:8px;border:1px solid #bbb;border-top:2px solid #111;background:#f0f0f0 !important">${totalHrs}</td>
        </tr>
      </tfoot>
    </table>
    <div style="display:flex;justify-content:space-between;margin-top:14px;font-size:9px;color:#999;padding-top:8px;border-top:1px solid #ddd">
      <span>MOS TA FA · ${esc(rptText('Cooperation Tools'))}</span>
      <span>${esc(rptText('Printed {date}', { date: printedOn }))}</span>
    </div>`);
}

function closePrint() {
  document.getElementById('print-overlay').classList.remove('open');
}

function printOverlayClick(e) {
  if (e.target === document.getElementById('print-overlay')) closePrint();
}

// Build a self-contained report HTML document (used by both Print and Save-PDF).
function buildReportDoc(innerHTML, title) {
  const reportCSS = [...document.styleSheets].flatMap(s => {
    try { return [...s.cssRules].map(r => r.cssText); } catch { return []; }
  }).filter(r =>
    r.includes('.rpt-') || r.includes('@media print') || r.includes('box-sizing') || r.includes('.det-')
  ).join('\n');

  const lang = rptLanguage();
  const dir = rptDirection();
  return `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><head><meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src data:">
    <title>${esc(rptText(title || 'Report'))}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 13px; color: #111; padding: 48px 52px; background: #fff; direction:${dir}; text-align:${dir === 'rtl' ? 'right' : 'left'}; }
      table, td, th, tr, tbody, thead, tfoot { background: #fff; color: #111; }
      .rpt-table { width:100%; border-collapse:collapse; font-size:11.5px; border:1.5px solid #111; }
      .rpt-table thead th { padding:7px 8px; text-align:left; font-size:9px; font-weight:700; color:#111; background:#f0f0f0; text-transform:uppercase; letter-spacing:.5px; border:1px solid #bbb; border-bottom:1.5px solid #111; }
      html[dir="rtl"] .rpt-table thead th { text-align:right; }
      .rpt-table td { padding:6px 8px; vertical-align:top; font-size:11.5px; line-height:1.35; border:1px solid #ccc; }
      .rpt-totals td { padding:7px 8px; background:#f0f0f0; font-weight:700; border:1px solid #bbb; border-top:1.5px solid #111; }
      ${reportCSS}
    </style>
  </head><body>${innerHTML}</body></html>`;
}

async function triggerPrint() {
  const frame = document.getElementById('print-frame');
  let res;
  try { res = await window.api.printReport(buildReportDoc(frame.innerHTML, 'Report')); }
  catch { res = { ok: false, error: 'Printing failed' }; }
  if (!res?.ok) toast(res?.error || 'Printing failed');
}

// Save the currently-previewed report directly to a PDF file (Chromium printToPDF).
async function exportReportPDF() {
  const frame = document.getElementById('print-frame');
  let res;
  try { res = await window.api.exportPDF(buildReportDoc(frame.innerHTML, 'Report'), `${_reportFileBase || 'report'}.pdf`); }
  catch { res = { ok: false, error: 'failed' }; }
  if (res && res.ok) toast('PDF saved');
  else if (res && res.error) toast('PDF failed: ' + res.error);
}

function reportPreviewToCSV() {
  const quote = value => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  };
  return [...document.querySelectorAll('#print-frame .rpt-table')].map(table =>
    [...table.rows].map(row => [...row.cells].map(cell => quote(cell.textContent)).join(',')).join('\r\n')
  ).filter(Boolean).join('\r\n\r\n');
}

async function exportReportCSV() {
  const csv = reportPreviewToCSV();
  if (!csv) { toast('This report has no table data to export'); return; }
  let res;
  try { res = await window.api.exportCSV(csv, `${_reportFileBase || 'report'}.csv`); }
  catch { res = { ok: false, error: 'failed' }; }
  if (res?.ok) toast('CSV saved');
  else if (res?.error) toast('CSV failed: ' + res.error);
}

// ════════════════════════════════════════════════════════════════════════════
// REPORTS MODULE — landing page of one-click report actions.
// ════════════════════════════════════════════════════════════════════════════

// Fills a plain <select> with a leading blank/"All" option (value="") followed
async function initReportsModule() {
  const t = fmt(new Date());
  const dEl = document.getElementById('rmod-daily-date');
  const mEl = document.getElementById('rmod-ot-month');
  if (dEl && !dEl.value) dEl.value = activeDate || t;
  if (mEl && !mEl.value) mEl.value = t.slice(0, 7);
}

function flashFieldError(el) {
  if (!el) return;
  el.classList.add('field-error');
  setTimeout(() => el.classList.remove('field-error'), 1200);
}

// Fetches each task's full structured Source list (tasks:get returns the
// ordered `sources` array — the day-view/report queries only carry the
// lightweight sourceCount/firstSource* summary), keyed by task id, for the
// Daily Timesheet report's per-task "Sources" list.
async function fetchTaskSourcesMap(taskIds) {
  const uniqueIds = [...new Set(taskIds.filter(id => id != null))];
  const map = new Map();
  await Promise.all(uniqueIds.map(async id => {
    try {
      const t = await window.api.getTask(id);
      if (t) map.set(id, t.sources || []);
    } catch {}
  }));
  return map;
}

// Daily Timesheet PDF — same daily report, for any chosen day.
async function genDailyReport() {
  const input = document.getElementById('rmod-daily-date');
  const date = input.value;
  if (!date) { flashFieldError(input); return; }

  let dayRows;
  if (date === activeDate) {
    dayRows = rows;
  } else {
    const list = await window.api.workLogsByDate(date);
    dayRows = list.map(l => Object.assign({}, l, { eid: l.id }));
  }
  if (!dayRows.length) toast('No records on that day — showing an empty report');

  const sourcesByTaskId = await fetchTaskSourcesMap(dayRows.map(r => r.taskId));
  const name = document.getElementById('hName').value || LK.defaultName || 'N/A';
  _reportFileBase = `timesheet-${date}`;
  document.getElementById('print-frame').innerHTML = buildDailyReportHTML(dayRows, date, name, sourcesByTaskId);
  document.getElementById('print-overlay').classList.add('open');
}

// Monthly Over-Time PDF — lists every Over-Time entry in a month + total hours,
// framed as an Over-Time Request for management.
async function genOvertimeReport() {
  const input = document.getElementById('rmod-ot-month');
  const mv = input.value;
  if (!mv) { flashFieldError(input); return; }

  const [y, m] = mv.split('-').map(Number);
  const from = `${mv}-01`;
  const to   = `${mv}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const days = await window.api.loadDaysRange(from, to);
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString(rptLocale(), { month: 'long', year: 'numeric' });
  const name = document.getElementById('hName').value || LK.defaultName || 'N/A';

  _reportFileBase = `overtime-request-${mv}`;
  document.getElementById('print-frame').innerHTML = buildOvertimeReportHTML(days, monthLabel, name);
  document.getElementById('print-overlay').classList.add('open');
}

function buildOvertimeReportHTML(days, monthLabel, name) {
  const otRows = [];
  days.forEach(d => {
    (d.rows || []).forEach(r => {
      if (r.time === 'OVERTIME') otRows.push({ date: d.date, row: r });
    });
  });
  otRows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  let totalMin = 0;
  const daySet = new Set();
  const rowsHTML = otRows.map((o, i) => {
    const r = o.row;
    const mins = parseFloat(r.minutes) || 0;
    totalMin += mins;
    daySet.add(o.date);
    const dt = new Date(o.date + 'T00:00:00');
    const dLabel = dt.toLocaleDateString(rptLocale(), { weekday: 'short', month: 'short', day: 'numeric' });
    return `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${dLabel}</td>
        <td>${esc(companyDisplayName(r.company))}</td>
        <td>${esc(lkLabel('SYSTEM', r.system))}</td>
        <td>${esc(r.taskName || lkLabel('ACTIVITY_TYPE', r.natural) || '—')}</td>
        <td>${esc(r.description)}</td>
        <td style="text-align:right">${r.minutes || '—'}</td>
        <td style="text-align:right">${mins ? (mins / 60).toFixed(2) : '—'}</td>
      </tr>`;
  }).join('');

  const totalHrs = (totalMin / 60).toFixed(2);
  const dayCount = daySet.size;
  const printedOn = new Date().toLocaleDateString(rptLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
  const dayPhrase = rptLanguage() === 'ar' ? `${dayCount} يوم` : `${dayCount} day${dayCount === 1 ? '' : 's'}`;

  const body = otRows.length ? `
      ${rowsHTML}
      </tbody>
      <tfoot>
        <tr class="rpt-totals">
          <td colspan="6" style="text-align:right;font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.4px">${esc(rptText('Total Over-Time'))}</td>
          <td style="text-align:right;font-weight:700">${totalMin}</td>
          <td style="text-align:right;font-weight:700">${totalHrs}</td>
        </tr>
      </tfoot>` : `
      <tr><td colspan="8" style="text-align:center;color:#999;padding:18px">${esc(rptText('No Over-Time recorded in {month}.', { month: monthLabel }))}</td></tr>
      </tbody>`;

  return rptWrap(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
      <div>
        <div style="font-size:10px;font-weight:800;letter-spacing:3.5px;text-transform:uppercase;color:#111;line-height:1.6">MOS TA FA</div>
        <div style="font-size:10px;font-weight:800;letter-spacing:3.5px;text-transform:uppercase;color:#111">${esc(rptText('Cooperation Tools'))}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:14px;font-weight:700;color:#111">${esc(name)}</div>
        <div style="font-size:11px;color:#555;margin-top:2px">${esc(monthLabel)}</div>
      </div>
    </div>
    <div style="font-size:14px;font-weight:700;color:#111;text-transform:uppercase;letter-spacing:.5px;padding-bottom:8px;border-bottom:2px solid #111;margin-bottom:16px">${esc(rptText('Over-Time Request'))}</div>
    <p style="font-size:12px;color:#333;margin:0 0 14px;line-height:1.6">
      ${esc(rptText('Kindly find below the Over-Time hours logged during {month}, submitted for your review and approval.', { month: monthLabel }))}
      ${esc(rptText('The total Over-Time for the period is {hours} hours across {dayPhrase}.', { hours: totalHrs, dayPhrase }))}
    </p>
    ${rptSummaryCards([
      { label: 'Total Over-Time', value: `${totalHrs}h`, color: totalMin > 0 ? '#b91c1c' : '#111' },
      { label: 'Total Minutes',   value: totalMin },
      { label: 'Entries',         value: otRows.length },
      { label: 'Days',            value: dayCount },
    ])}

    <table class="rpt-table">
      <thead>
        <tr>
          <th style="width:28px;text-align:center">#</th>
          <th>${esc(rptText('Date'))}</th>
          <th>${esc(rptText('Company'))}</th>
          <th>${esc(rptText('System'))}</th>
          <th>${esc(rptText('Task'))}</th>
          <th>${esc(rptText('Description'))}</th>
          <th style="text-align:right">${esc(rptText('Min'))}</th>
          <th style="text-align:right">${esc(rptText('Hrs'))}</th>
        </tr>
      </thead>
      <tbody>
      ${body}
    </table>
    <div style="display:flex;justify-content:space-between;margin-top:42px;gap:40px">
      <div style="flex:1">
        <div style="border-top:1.5px solid #333;padding-top:6px;font-size:11px;color:#444">${esc(rptText('Employee'))}: ${esc(name)}</div>
      </div>
      <div style="flex:1">
        <div style="border-top:1.5px solid #333;padding-top:6px;font-size:11px;color:#444">${esc(rptText('Approved by'))}:</div>
      </div>
      <div style="flex:1">
        <div style="border-top:1.5px solid #333;padding-top:6px;font-size:11px;color:#444">${esc(rptText('Date'))}:</div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:16px;font-size:9px;color:#aaa;padding-top:8px;border-top:1px solid #ddd">
      <span>MOS TA FA · ${esc(rptText('Cooperation Tools'))}</span>
      <span>${esc(rptText('Printed {date}', { date: printedOn }))}</span>
    </div>`);
}

// Subscriptions PDF — the full list of recurring subscriptions, mirroring the
// columns of the Subscriptions module, plus monthly/yearly spend per currency.
async function genSubscriptionsReport() {
  let data;
  try { data = await window.api.loadSubscriptions(); }
  catch { toast('Could not load subscriptions'); return; }
  const subs = (data && Array.isArray(data.subscriptions)) ? data.subscriptions : [];
  const name = document.getElementById('hName').value || LK.defaultName || 'N/A';
  if (!subs.length) toast('No subscriptions yet — showing an empty report');
  _reportFileBase = `subscriptions-${fmt(new Date())}`;
  document.getElementById('print-frame').innerHTML = buildSubscriptionsReportHTML(subs, (data && data.defaultCurrency) || 'USD', name);
  document.getElementById('print-overlay').classList.add('open');
}

function buildSubscriptionsReportHTML(subs, defaultCurrency, name) {
  // Sort by soonest renewal first (no renewal date sorts last) — matches the module.
  const sorted = subs.slice().sort((a, b) => {
    const da = daysUntil(a.renewalDate), db = daysUntil(b.renewalDate);
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });

  // Monthly + yearly spend equivalents per currency (Monthly/Yearly/Custom).
  const cur = {};
  let dueSoon = 0, overdue = 0;
  sorted.forEach(s => {
    const d = daysUntil(s.renewalDate);
    if (d !== null && d < 0) overdue++;
    else if (d !== null && d <= 30) dueSoon++;
    const cost = parseFloat(String(s.cost).replace(/[^0-9.]/g, '')) || 0;
    if (!cost) return;
    const c = s.currency || defaultCurrency || 'USD';
    cur[c] = cur[c] || { monthly: 0, yearly: 0 };
    if (s.billingCycle === 'YEARLY')        { cur[c].yearly += cost;  cur[c].monthly += cost / 12; }
    else if (s.billingCycle === 'MONTHLY')  { cur[c].monthly += cost; cur[c].yearly  += cost * 12; }
    else                                    { cur[c].yearly += cost;  cur[c].monthly += cost / 12; }
  });

  const renewCell = (dateStr) => {
    const d = daysUntil(dateStr);
    if (d === null) return '<span style="color:#999">—</span>';
    const color = (d < 0 || d <= 7) ? '#dc2626' : (d <= 30 ? '#a16207' : '#16a34a');
    return `<span style="color:${color};font-weight:600">${esc(rptRenewLabel(d))}</span>`;
  };

  const rowsHTML = sorted.length ? sorted.map((s, i) => {
    const costNum = parseFloat(s.cost);
    const costText = isNaN(costNum) ? (s.cost || '—') : costNum.toFixed(2);
    return `
        <tr>
          <td style="text-align:center">${i + 1}</td>
          <td>${esc(s.name)}</td>
          <td>${esc((lkLabel('CURRENCY', s.currency || defaultCurrency || 'USD') || s.currency || defaultCurrency || 'USD') + ' ' + costText)}</td>
          <td>${esc(s.billingCycle ? lkLabel('BILLING_CYCLE', s.billingCycle) : '—')}</td>
          <td>${esc(s.endDate || '—')}</td>
          <td>${esc(s.renewalDate || '—')}</td>
          <td>${renewCell(s.renewalDate)}</td>
        </tr>`;
  }).join('') : `<tr><td colspan="7" style="text-align:center;color:#999;padding:18px">${esc(rptText('No subscriptions recorded.'))}</td></tr>`;

  const spendRows = Object.entries(cur).map(([c, v]) =>
    `<tr><td>${esc(lkLabel('CURRENCY', c) || c)}</td><td style="text-align:right;font-weight:700">${v.monthly.toFixed(0)}</td><td style="text-align:right;font-weight:700">${v.yearly.toFixed(0)}</td></tr>`
  ).join('') || `<tr><td colspan="3" style="text-align:center;color:#999">${esc(rptText('No subscription costs recorded.'))}</td></tr>`;

  const printedOn = new Date().toLocaleDateString(rptLocale(), { year: 'numeric', month: 'long', day: 'numeric' });

  return rptWrap(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
      <div>
        <div style="font-size:10px;font-weight:800;letter-spacing:3.5px;text-transform:uppercase;color:#111;line-height:1.6">MOS TA FA</div>
        <div style="font-size:10px;font-weight:800;letter-spacing:3.5px;text-transform:uppercase;color:#111">${esc(rptText('Cooperation Tools'))}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:14px;font-weight:700;color:#111">${esc(name)}</div>
        <div style="font-size:11px;color:#555;margin-top:2px">${printedOn}</div>
      </div>
    </div>
    <div style="font-size:14px;font-weight:700;color:#111;text-transform:uppercase;letter-spacing:.5px;padding-bottom:8px;border-bottom:2px solid #111;margin-bottom:16px">${esc(rptText('Subscriptions Report'))}</div>
    ${rptSummaryCards([
      { label: 'Subscriptions', value: sorted.length },
      { label: 'Renewing ≤30d', value: dueSoon, color: dueSoon > 0 ? '#a16207' : '#111' },
      { label: 'Overdue',       value: overdue, color: overdue > 0 ? '#b91c1c' : '#111' },
    ])}

    <table class="rpt-table">
      <thead>
        <tr>
          <th style="width:28px;text-align:center">#</th>
          <th>${esc(rptText('Name'))}</th>
          <th>${esc(rptText('Cost'))}</th>
          <th>${esc(rptText('Billing Cycle'))}</th>
          <th>${esc(rptText('End Date'))}</th>
          <th>${esc(rptText('Renewal Date'))}</th>
          <th>${esc(rptText('Renews In'))}</th>
        </tr>
      </thead>
      <tbody>
      ${rowsHTML}
      </tbody>
    </table>

    <div style="margin-top:22px;font-size:12px;font-weight:700;color:#111;text-transform:uppercase;letter-spacing:.3px;margin-bottom:8px">${esc(rptText('Recurring Spend by Currency'))}</div>
    <table class="rpt-table">
      <thead><tr><th>${esc(rptText('Currency'))}</th><th style="text-align:right">${esc(rptText('Monthly'))}</th><th style="text-align:right">${esc(rptText('Yearly'))}</th></tr></thead>
      <tbody>${spendRows}</tbody>
    </table>

    <div style="display:flex;justify-content:space-between;margin-top:16px;font-size:9px;color:#aaa;padding-top:8px;border-top:1px solid #ddd">
      <span>MOS TA FA · ${esc(rptText('Cooperation Tools'))}</span>
      <span>${esc(rptText('Printed {date}', { date: printedOn }))}</span>
    </div>`);
}

// ── Today button ──
function goToday() {
  switchDay(fmt(new Date()));
}

function updateTodayBtn() {
  const btn = document.getElementById('btn-today');
  btn.classList.toggle('is-today', activeDate === fmt(new Date()));
}

// ════════════════════════════════════════════════════════════════════════════
// PROJECT TASK MODAL — add a zero-log task to a project, or edit any project
// task's profile fields. Persists immediately (no debounced whole-list save).
// ════════════════════════════════════════════════════════════════════════════
// ── Project task modal (add a zero-log task, or edit any project task's profile) ──
// Used by Projects detail "New Task"/"Edit" and Internal Tasks' equivalents. opts:
//   task         → the task being edited (its own shape, from currentProject.tasks/currentDept.tasks) — omit to create
//   projectId    → preset + lock the Project field to that project
//   departmentId → preset + lock the Department field to that department
//   onSaved      → called after a successful save to refresh the caller's view
let _backlogCtx = { projectId: null, departmentId: null, onSaved: null };
// Ids of the currently-open New/Edit Task modal's task's existing task_sources
// rows (fetched via getTask when editing a task with any), for reconciliation.
let _bSourceOriginalIds = [];

// Milestone 9 — which container field is currently shown when neither is
// locked by context ('project' | 'department'). Only meaningful in that case;
// ignored (rows driven directly by lockedProject/lockedDept) otherwise.
let _backlogTaskType = 'project';
// Visual-only: shows the matching row + toggle state. Never touches field
// values — used both for the initial render (reflecting the task's existing
// link, so nothing is lost) and as the shared base for the click handler below.
function applyBacklogTaskTypeUI(type) {
  _backlogTaskType = type;
  document.querySelectorAll('#b-tasktype-ctl .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  document.getElementById('b-project-row').style.display = type === 'project' ? '' : 'none';
  document.getElementById('b-department-row').style.display = type === 'department' ? '' : 'none';
}
// Click handler for the Task Type toggle. Purely visual (just calls
// applyBacklogTaskTypeUI) — deliberately does NOT clear the now-hidden
// field's value. An earlier version cleared it here, which meant toggling
// project -> department -> project back again left the project picker
// silently emptied (the first toggle cleared it; the second toggle had
// nothing to restore), so saving without re-picking the project would
// silently unlink it. Project/Department exclusivity is instead enforced
// once, at submit time, in submitBacklogModal() — it reads only whichever
// field _backlogTaskType currently says is active and ignores the other
// entirely, so toggling back and forth is always non-destructive.
function setBacklogTaskType(type) {
  if (type === _backlogTaskType) return;
  applyBacklogTaskTypeUI(type);
}

async function openBacklogModal(id = null, opts = {}) {
  backlogEditId = id;
  _backlogCtx = { projectId: opts.projectId ?? null, departmentId: opts.departmentId ?? null, onSaved: opts.onSaved || null };
  const lockedProject = _backlogCtx.projectId != null;
  const lockedDept = _backlogCtx.departmentId != null;
  const task = opts.task || null;
  const isEdit = !!task;
  document.getElementById('backlog-modal-title').textContent =
    isEdit ? 'Edit Task' : (lockedProject ? 'New Project Task' : (lockedDept ? 'New Department Task' : 'Add Task'));
  document.querySelector('#backlog-modal .modal-footer .btn.primary').textContent = isEdit ? 'Save Changes' : 'Add Task';

  populateSelect('b-company', 'companies', task?.company || '');
  populateSelect('b-system',  'systems',   task?.system  || '');
  populateSelect('b-status',  'status',    task?.status  || 'IN_PROGRESS');

  if (!isEdit) {
    ['b-company','b-system'].forEach(selId => {
      const sel = document.getElementById(selId);
      const blank = document.createElement('option');
      blank.value = ''; blank.textContent = '— select —';
      sel.insertBefore(blank, sel.firstChild);
      sel.value = '';
    });
  }

  const initialProject = lockedProject ? _backlogCtx.projectId : (task?.projectId ?? null);
  bProjectPicker = buildSearchSelect(document.getElementById('b-project'),
    projectFieldOptions(initialProject), initialProject, 'No project');
  // In the Projects context the link is fixed — lock the picker to this project.
  const bpInput = document.querySelector('#b-project .ss-input');
  if (bpInput) bpInput.disabled = lockedProject;

  // Department is optional, same convention as Project — a plain lookup-driven
  // select (like Company/System) rather than a search-select, since there are
  // only a handful of departments.
  const initialDeptLabel = lockedDept
    ? (deptList.find(d => d.id === _backlogCtx.departmentId)?.label || currentDept?.label || '')
    : (task?.department || '');
  populateSelect('b-department', 'department', initialDeptLabel);
  const bDeptSel = document.getElementById('b-department');
  const blankDept = document.createElement('option');
  blankDept.value = ''; blankDept.textContent = 'No department';
  if (!initialDeptLabel) blankDept.selected = true;
  bDeptSel.insertBefore(blankDept, bDeptSel.firstChild);
  bDeptSel.disabled = lockedDept;

  // Milestone 9 — Project/Department are mutually exclusive. Opened from inside
  // a Project or a Department, the type is already fixed by that context: hide
  // the Task Type toggle and the other container's field entirely (not just
  // disabled). Opened with neither preset (only All Tasks' Edit today), show
  // the toggle and reveal whichever field matches the task's current link
  // (defaulting to Project work for a task with neither link yet).
  const tasktypeRow = document.getElementById('b-tasktype-row');
  if (lockedProject) {
    tasktypeRow.style.display = 'none';
    document.getElementById('b-department-row').style.display = 'none';
    document.getElementById('b-project-row').style.display = '';
  } else if (lockedDept) {
    tasktypeRow.style.display = 'none';
    document.getElementById('b-project-row').style.display = 'none';
    document.getElementById('b-department-row').style.display = '';
  } else {
    tasktypeRow.style.display = '';
    applyBacklogTaskTypeUI(task?.departmentId ? 'department' : 'project');
  }

  document.getElementById('b-description').value = task?.name   || '';
  document.getElementById('b-sources-list').innerHTML = '';
  let fetchedSources = [];
  if (isEdit && task?.id) {
    try { fetchedSources = (await window.api.getTask(task.id))?.sources || []; }
    catch { fetchedSources = []; }
  }
  _bSourceOriginalIds = fetchedSources.map(s => s.id);
  fetchedSources.forEach(s => addTaskSourceRow('b-sources-list', s));

  clearBacklogErrors();
  document.getElementById('backlog-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById((lockedProject || lockedDept) ? 'b-description' : 'b-company').focus(), 80);
}
function closeBacklogModal() {
  document.getElementById('backlog-modal-overlay').classList.remove('open');
  backlogEditId = null;
  _backlogCtx = { projectId: null, departmentId: null, onSaved: null };
}

// Create a new task already linked to the open project (Projects detail → New Task).
function openProjectNewTask() {
  if (!currentProject) return;
  openBacklogModal(null, { projectId: currentProject.id, onSaved: reloadCurrentProject });
}
// Edit an existing project task's profile fields (Projects detail → task card Edit).
function openProjectEditTask(taskId) {
  if (!currentProject) return;
  const task = (currentProject.tasks || []).find(t => t.id === taskId);
  if (!task) return;
  openBacklogModal(taskId, { task, projectId: task.projectId ?? currentProject.id, onSaved: reloadCurrentProject });
}
function backlogOverlayClick(e) {
  if (e.target === document.getElementById('backlog-modal-overlay')) closeBacklogModal();
}
function clearBacklogErrors() { clearErrorsIn('#backlog-modal'); }

async function submitBacklogModal() {
  clearBacklogErrors();
  const fields = [
    { id: 'b-company',     val: document.getElementById('b-company').value },
    { id: 'b-system',      val: document.getElementById('b-system').value },
    { id: 'b-description', val: document.getElementById('b-description').value.trim() },
  ];
  let valid = true;
  fields.forEach(f => { if (!f.val) { markError(f.id); valid = false; } });
  if (!valid) return;

  const isEdit = backlogEditId !== null;
  // Project/Department are mutually exclusive (Milestone 9) — only the field
  // matching the active type is ever sent, regardless of what the other
  // field's underlying picker/select still holds (setBacklogTaskType() no
  // longer clears it on toggle, so a round-trip toggle can't lose data, but
  // that means BOTH fields can carry a stale value at once; gating here,
  // once, at the single point the payload is built, is what actually
  // enforces the invariant). Locked-by-context (opened from a Project or a
  // Department) always wins over the toggle, which isn't even shown then.
  const activeLinkType = (_backlogCtx.projectId != null) ? 'project'
    : (_backlogCtx.departmentId != null) ? 'department'
    : _backlogTaskType;
  // A zero-log task's description is the task name; time type and natural are
  // both per-session, chosen when it's assigned to a day.
  const payload = {
    name:        document.getElementById('b-description').value.trim(),
    status:      document.getElementById('b-status').value,
    company:     document.getElementById('b-company').value,
    system:      document.getElementById('b-system').value,
    department:  activeLinkType === 'department' ? document.getElementById('b-department').value : '',
    projectId:   activeLinkType === 'project' ? (bProjectPicker ? bProjectPicker.getSelectedId() : null) : null,
  };
  const sourceRows = readTaskSourceRows('b-sources-list');

  try {
    let taskId = backlogEditId;
    if (isEdit) await window.api.updateTask(backlogEditId, payload);
    else        taskId = (await window.api.createTask(payload)).id;
    await saveTaskSources(taskId, sourceRows, _bSourceOriginalIds);
  } catch { toast('Could not save the task'); return; }

  const onSaved = _backlogCtx.onSaved;
  closeBacklogModal();
  if (onSaved) await onSaved();
  toast(isEdit ? 'Task updated' : 'Task created');
}

// ── Filter ──
let filterText = '';
let filterStatuses = new Set();

function applyFilter() {
  filterText = document.getElementById('filter-input').value.toLowerCase().trim();
  document.getElementById('filter-clear').style.display = filterText ? 'block' : 'none';
  renderTable();
}

function clearFilter() {
  filterText = '';
  document.getElementById('filter-input').value = '';
  document.getElementById('filter-clear').style.display = 'none';
  renderTable();
}

function toggleStatusFilter(btn) {
  const s = btn.dataset.status;
  if (filterStatuses.has(s)) { filterStatuses.delete(s); btn.classList.remove('active'); }
  else                        { filterStatuses.add(s);    btn.classList.add('active'); }
  renderTable();
}
// Populate the Timesheet filter chips from the ENTRY_STATUS lookup category —
// called once at boot after LK loads. Preserves any active selection across a
// Settings-triggered rebuild (relabel/add).
function renderFilterChips() {
  const wrap = document.getElementById('filter-chips');
  wrap.innerHTML = '';
  lkOptions('ENTRY_STATUS').forEach(o => {
    const btn = document.createElement('button');
    btn.className = 'filter-chip' + (filterStatuses.has(o.code) ? ' active' : '');
    btn.dataset.status = o.code;
    btn.dataset.userContent = ''; btn.textContent = lookupDisplayName(o);
    btn.addEventListener('click', () => toggleStatusFilter(btn));
    wrap.appendChild(btn);
  });
}

function rowMatchesFilter(row) {
  if (filterStatuses.size > 0 && !filterStatuses.has(row.status)) return false;
  if (!filterText) return true;
  // Search against the human labels of the code-valued fields (time / status).
  return [row.company, row.companyCode, row.companyNameEn, row.companyNameAr,
    row.system, row.natural, lkLabel('TIME_TYPE', row.time), row.description, row.source, lkLabel('ENTRY_STATUS', row.status)]
    .some(v => (v || '').toLowerCase().includes(filterText));
}

// Base filename for the Reports-module PDF / print preview (set by genDailyReport
// / genOvertimeReport / genSubscriptionsReport, read by exportReportPDF).
let _reportFileBase = 'report';

// ════════════════════════════════════════════════════════════════════════════
// TIMESHEET DEPTH — templates, month overview.
// ════════════════════════════════════════════════════════════════════════════

// ── Dropdown menu (e.g. the sidebar's Backup Data choice menu) ──
function toggleTopMenu(e, id) {
  e.stopPropagation();
  const menu = document.getElementById(id);
  const willOpen = !menu.classList.contains('open');
  document.querySelectorAll('.top-menu.open').forEach(m => m.classList.remove('open'));
  if (willOpen) menu.classList.add('open');
}
document.addEventListener('click', () => {
  document.querySelectorAll('.top-menu.open').forEach(m => m.classList.remove('open'));
});

// ── Month overview ──
let monthViewY = null, monthViewM = null;
function openMonthView() {
  const base = activeDate ? new Date(activeDate + 'T00:00:00') : new Date();
  monthViewY = base.getFullYear();
  monthViewM = base.getMonth();
  document.getElementById('month-overlay').classList.add('open');
  renderMonthView();
}
function closeMonthView() { document.getElementById('month-overlay').classList.remove('open'); }
function monthOverlayClick(e) { if (e.target === document.getElementById('month-overlay')) closeMonthView(); }
function monthViewStep(d) {
  monthViewM += d;
  if (monthViewM < 0)  { monthViewM = 11; monthViewY--; }
  if (monthViewM > 11) { monthViewM = 0;  monthViewY++; }
  renderMonthView();
}
async function renderMonthView() {
  const y = monthViewY, m = monthViewM;
  document.getElementById('month-title').textContent =
    new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const mm = String(m + 1).padStart(2, '0');
  const lastDay = new Date(y, m + 1, 0).getDate();
  const days = await window.api.loadDaysRange(`${y}-${mm}-01`, `${y}-${mm}-${String(lastDay).padStart(2, '0')}`);
  const map = {};
  days.forEach(d => { map[d.date] = d.rows || []; });

  const grid = document.getElementById('month-grid');
  grid.innerHTML = '';
  const firstDow = new Date(y, m, 1).getDay();
  const todayStr = fmt(new Date());
  let maxMin = 1;
  Object.values(map).forEach(rws => { maxMin = Math.max(maxMin, totalMins(rws)); });

  for (let i = 0; i < firstDow; i++) {
    const c = document.createElement('div'); c.className = 'month-cell empty'; grid.appendChild(c);
  }
  let monthMin = 0, activeDays = 0;
  for (let d = 1; d <= lastDay; d++) {
    const ds = `${y}-${mm}-${String(d).padStart(2, '0')}`;
    const rws = map[ds] || [];
    const mins = totalMins(rws);
    monthMin += mins;
    if (mins > 0) activeDays++;
    const cell = document.createElement('div');
    cell.className = 'month-cell' + (rws.length ? ' has' : '') + (ds === todayStr ? ' today' : '');
    cell.innerHTML = `
      <span class="mc-day ${ds === todayStr ? 'is-today' : ''}">${d}</span>
      ${mins ? `<span class="mc-hrs">${(mins / 60).toFixed(1)}h</span>` : ''}
      ${rws.length ? `<span class="mc-rec">${rws.length} rec</span>` : ''}
      ${mins ? `<div class="mc-bar" style="width:${Math.max(12, Math.round(mins / maxMin * 100))}%"></div>` : ''}`;
    if (rws.length) cell.addEventListener('click', () => { closeMonthView(); switchModule('timesheet'); switchDay(ds); });
    grid.appendChild(cell);
  }
  document.getElementById('month-summary').innerHTML =
    `<b>${(monthMin / 60).toFixed(1)}h</b> across ${activeDays} active day${activeDays === 1 ? '' : 's'}`;
}

// ── Module switching ──
function switchModule(name) {
  // The old Companies / Systems pages are now the two dimensions of Browse;
  // keep the old names working as aliases (cross-links, month view, etc.).
  if (name === 'companies' || name === 'systems') {
    const kind = name;
    if (activeModule === 'browse') { setBrowseKind(kind); return; }
    browseKind = kind;
    name = 'browse';
  }
  if (activeModule === name) {
    if (name === 'browse') setBrowseKind(browseKind);
    else if (name === 'clients') backToClientsList();
    return;
  }
  activeModule = name;
  // 'projects' is an internal-only pseudo-module (a single project's detail
  // page, reached only via the Clients page / openProjectById) — it has no
  // sidebar entry and is never a valid "Start on last page" landing target.
  if (name !== 'projects') {
    uiState.lastModule = name;
    saveUiStateDebounced();
  }

  document.querySelectorAll('.app-module').forEach(el => {
    el.classList.toggle('active', el.id === 'module-' + name);
  });
  document.querySelectorAll('.nav-item').forEach(el => {
    // Viewing a project's detail page keeps the Clients nav item highlighted,
    // since that's still the section the user is "inside" (Projects now live
    // inside each client's detail view).
    const ownedModules = (el.dataset.modules || el.dataset.module || '').split(/\s+/).filter(Boolean);
    el.classList.toggle('active', ownedModules.includes(name)
      || (name === 'projects' && el.dataset.module === 'clients'));
  });
  syncControlSemantics(document.getElementById('sidebar'));

  if (name === 'timesheet') {
    window.api.setTitle('Cooperation Tools — Timesheet — ' + activeDate);
  } else if (name === 'subscriptions') {
    window.api.setTitle('Cooperation Tools — Subscriptions');
    if (!subsLoaded) loadSubscriptionsData();
    else renderSubscriptions();
  } else if (name === 'analytics') {
    window.api.setTitle('Cooperation Tools — Overview');
    analyticsLoaded = true;
    renderAnalytics();
  } else if (name === 'reports') {
    window.api.setTitle('Cooperation Tools — Reports');
    initReportsModule();
  } else if (name === 'settings') {
    window.api.setTitle('Cooperation Tools — Settings');
    initSettingsModule();
  } else if (name === 'browse') {
    setBrowseKind(browseKind);
  } else if (name === 'all-tasks') {
    window.api.setTitle('Cooperation Tools — Tasks');
    initAllTasksModule();
  } else if (name === 'internal-tasks') {
    window.api.setTitle('Cooperation Tools — Internal Tasks');
    initInternalTasksModule();
  } else if (name === 'companydocs') {
    window.api.setTitle('Cooperation Tools — Company Documents');
    initCompanyDocsModule();
  } else if (name === 'knowledge') {
    window.api.setTitle('Cooperation Tools — Knowledge Hub');
    initKnowledgeModule();
  } else if (name === 'clients') {
    window.api.setTitle('Cooperation Tools — Clients');
    initClientsModule();
  }
}
