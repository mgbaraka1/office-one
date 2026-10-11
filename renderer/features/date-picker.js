'use strict';

// App-styled calendar for every <input type="date"> and <input type="month">.
// Chromium's own picker popup cannot be styled, so this one takes its place:
// the native input stays the value holder (code keeps reading .value and
// listening for input/change), and only the popup is ours. Inputs added later
// are covered too, since everything hangs off document-level listeners.
// English labels here are translated by i18n.js's DOM observer.
(function installDatePicker() {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const pad = n => String(n).padStart(2, '0');
  const isPickerInput = el => el instanceof HTMLInputElement && (el.type === 'date' || el.type === 'month');
  const isRtl = () => document.documentElement.dir === 'rtl';

  let pop = null;        // the open popup element
  let input = null;      // the input it belongs to
  let mode = 'date';     // 'date' | 'month' — what the grid currently shows
  let viewY = 0, viewM = 0;   // the month (date mode) or year (month mode) on screen
  let active = '';       // the keyboard-focused cell's value
  let closedAt = 0, closedFor = null;

  const outOfRange = value => (input.min && value < input.min.slice(0, value.length))
    || (input.max && value > input.max.slice(0, value.length));
  const todayValue = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };

  function mkButton(cls, html, label, fn) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.innerHTML = html;
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    return b;
  }

  function open(target) {
    if (pop && input === target) return;
    close(false);
    input = target;
    mode = input.type;
    const now = new Date();
    const v = input.value;
    const y = Number(v.slice(0, 4)) || now.getFullYear();
    const m = v ? Number(v.slice(5, 7)) - 1 : now.getMonth();
    viewY = y; viewM = m;
    active = v || (mode === 'month' ? todayValue().slice(0, 7) : todayValue());
    pop = document.createElement('div');
    pop.className = 'dp-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', mode === 'month' ? 'Choose a month' : 'Choose a date');
    pop.addEventListener('keydown', onPopKey);
    pop.addEventListener('mousedown', e => e.preventDefault());   // keep focus where it is
    document.body.appendChild(pop);
    render();
    place();
  }

  function close(refocus) {
    if (!pop) return;
    pop.remove();
    pop = null;
    closedAt = Date.now(); closedFor = input;
    if (refocus && input?.isConnected) input.focus();
    input = null;
  }

  function commit(value) {
    const target = input;
    close(true);
    if (target.value === value) return;
    target.value = value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Month view in a date input: picking a month drills back down to its days.
  function render() {
    pop.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'dp-head';
    const yearView = mode === 'month';
    const title = mkButton('dp-title', '', 'Choose a month', () => {
      if (input.type === 'date' && mode === 'date') { mode = 'month'; active = viewY + '-' + pad(viewM + 1); render(); }
    });
    title.textContent = yearView ? String(viewY) : MONTHS[viewM] + ' ' + viewY;
    if (input.type === 'month' || yearView) title.disabled = true;
    const step = dir => () => {
      if (yearView) viewY += dir;
      else { viewM += dir; if (viewM < 0) { viewM = 11; viewY--; } if (viewM > 11) { viewM = 0; viewY++; } }
      render();
    };
    head.append(
      mkButton('dp-nav dp-prev', ic('chevron-right'), yearView ? 'Previous year' : 'Previous month', step(-1)),
      title,
      mkButton('dp-nav', ic('chevron-right'), yearView ? 'Next year' : 'Next month', step(1)));
    pop.appendChild(head);

    const grid = document.createElement('div');
    grid.className = yearView ? 'dp-grid dp-months' : 'dp-grid dp-days';
    grid.setAttribute('role', 'grid');
    const selected = input.value;
    const today = todayValue();
    const cell = (value, text, extra) => {
      const b = mkButton('dp-cell' + (extra || ''), '', '', () => pick(value));
      b.textContent = text;
      b.dataset.value = value;
      b.tabIndex = value === active ? 0 : -1;
      if (value === selected.slice(0, value.length)) { b.classList.add('selected'); b.setAttribute('aria-selected', 'true'); }
      if (value === today.slice(0, value.length)) b.classList.add('today');
      if (outOfRange(value)) b.disabled = true;
      return b;
    };
    if (yearView) {
      MONTHS_SHORT.forEach((name, i) => grid.appendChild(cell(viewY + '-' + pad(i + 1), name)));
    } else {
      WEEKDAYS.forEach(d => { const w = document.createElement('div'); w.className = 'dp-dow'; w.textContent = d; grid.appendChild(w); });
      const first = new Date(viewY, viewM, 1);
      const start = new Date(viewY, viewM, 1 - first.getDay());
      for (let i = 0; i < 42; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        grid.appendChild(cell(value, String(d.getDate()), d.getMonth() === viewM ? '' : ' outside'));
      }
    }
    pop.appendChild(grid);

    const foot = document.createElement('div');
    foot.className = 'dp-foot';
    if (!input.required) {
      const clear = mkButton('dp-link', '', '', () => commit(''));
      clear.textContent = 'Clear';
      foot.appendChild(clear);
    }
    const nowValue = input.type === 'month' ? today.slice(0, 7) : today;
    const now = mkButton('dp-link dp-now', '', '', () => commit(nowValue));
    now.textContent = input.type === 'month' ? 'This month' : 'Today';
    now.disabled = !!outOfRange(nowValue);
    foot.appendChild(now);
    pop.appendChild(foot);
  }

  function pick(value) {
    if (input.type === 'date' && mode === 'month') {
      mode = 'date'; viewM = Number(value.slice(5, 7)) - 1;
      active = (input.value && input.value.startsWith(value)) ? input.value : value + '-01';
      render(); focusActive(); return;
    }
    commit(value);
  }

  function focusActive() {
    pop?.querySelector('.dp-cell[tabindex="0"]')?.focus();
  }

  // Arrow keys walk the grid (mirrored in RTL), PageUp/PageDown flip the
  // page, Enter picks, Escape closes back to the input.
  function onPopKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === 'Tab') return;
    const cellKey = e.target.classList?.contains('dp-cell');
    if (!cellKey) return;
    const months = mode === 'month';
    const flip = isRtl() ? -1 : 1;
    const moves = months
      ? { ArrowLeft: -flip, ArrowRight: flip, ArrowUp: -4, ArrowDown: 4, PageUp: -12, PageDown: 12 }
      : { ArrowLeft: -flip, ArrowRight: flip, ArrowUp: -7, ArrowDown: 7 };
    let next = null;
    if (months && moves[e.key]) {
      const [y, m] = active.split('-').map(Number);
      const d = new Date(y, m - 1 + moves[e.key], 1);
      next = d.getFullYear() + '-' + pad(d.getMonth() + 1);
      viewY = d.getFullYear();
    } else if (!months && (moves[e.key] || e.key === 'PageUp' || e.key === 'PageDown')) {
      const [y, m, day] = active.split('-').map(Number);
      const d = e.key === 'PageUp' || e.key === 'PageDown'
        ? new Date(y, m - 1 + (e.key === 'PageUp' ? -1 : 1), Math.min(day, 28))
        : new Date(y, m - 1, day + moves[e.key]);
      next = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      viewY = d.getFullYear(); viewM = d.getMonth();
    }
    if (!next) return;
    e.preventDefault();
    active = next;
    render(); focusActive();
  }

  // Below the input, aligned to its start edge; above it when there's no room.
  function place() {
    if (!pop) return;
    if (!input.isConnected) { close(false); return; }
    const r = input.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let left = isRtl() ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  // A press on the field opens our popup instead of Chromium's; typing into
  // the field's segments still works once it has focus.
  document.addEventListener('mousedown', e => {
    const target = e.target;
    if (pop && !pop.contains(target) && target !== input) close(false);
    if (!isPickerInput(target) || target.disabled || target.readOnly || e.button !== 0) return;
    e.preventDefault();
    if (pop && input === target) { close(true); return; }
    target.focus();
    open(target);
  }, true);
  // Chromium opens its own popup on the click, not the press, so the click's
  // default is blocked too.
  document.addEventListener('click', e => { if (isPickerInput(e.target)) e.preventDefault(); }, true);
  document.addEventListener('keydown', e => {
    if (!isPickerInput(e.target)) return;
    if ((e.altKey && e.key === 'ArrowDown') || e.key === 'F4') {
      e.preventDefault();
      open(e.target); focusActive();
    } else if (e.key === 'Escape' && pop) {
      e.preventDefault(); e.stopPropagation(); close(true);
    } else if (pop && e.key === 'Tab') close(false);
  }, true);
  // Typing in the field moves the open calendar along with it.
  document.addEventListener('input', e => {
    if (!pop || e.target !== input || !input.value) return;
    viewY = Number(input.value.slice(0, 4)); viewM = Number(input.value.slice(5, 7)) - 1;
    active = input.value; render();
  }, true);
  window.addEventListener('resize', () => close(false));
  window.addEventListener('blur', () => close(false));
  document.addEventListener('scroll', e => { if (pop && !pop.contains(e.target)) place(); }, true);
  document.addEventListener('ct:languagechange', () => { if (pop) { render(); place(); } });

  // Code that calls showPicker() (e.g. the Analytics month range) gets ours.
  // A press that just closed the popup is followed by that click's call, so
  // that one is ignored rather than reopening it.
  const nativeShowPicker = HTMLInputElement.prototype.showPicker;
  HTMLInputElement.prototype.showPicker = function showPicker() {
    if (!isPickerInput(this)) return nativeShowPicker.call(this);
    if (closedFor === this && Date.now() - closedAt < 400) return;
    open(this);
  };
})();
