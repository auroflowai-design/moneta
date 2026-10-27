/* ==========================================================================
   Moneta — in-app Apple-style controls
   Native <select> and <input type="date"> elements stay in the form as the
   source of truth, but are never shown. A custom trigger opens either an
   anchored popover (desktop) or a cushioned bottom sheet (mobile), so Chrome's
   own menus and calendar never appear.
   ========================================================================== */
(function () {
  'use strict';

  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex="0"]';
  const SHEET_CLOSE_MS = 300;

  let layer = null;
  let scrim = null;
  let host = null;
  let activePanel = null;
  let closeTimer = 0;
  let observer = null;
  let refreshQueued = false;
  let uid = 0;

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function parseISO(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function isoFromDate(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function todayISO() {
    return isoFromDate(new Date());
  }

  function addDays(date, amount) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + amount);
    return next;
  }

  function addMonths(date, amount) {
    return new Date(date.getFullYear(), date.getMonth() + amount, 1);
  }

  function formatDisplayDate(iso) {
    const date = parseISO(iso);
    if (!date) return '';
    const format = document.documentElement.dataset.dateFormat || 'dd-mmm-yyyy';
    const day = pad2(date.getDate());
    const month = pad2(date.getMonth() + 1);
    const year = String(date.getFullYear());
    if (format === 'dd/mm/yyyy') return `${day}/${month}/${year}`;
    if (format === 'mm/dd/yyyy') return `${month}/${day}/${year}`;
    if (format === 'yyyy-mm-dd') return `${year}-${month}-${day}`;
    return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${year}`;
  }

  function isSheetMode() {
    return window.matchMedia('(max-width: 760px)').matches;
  }

  function chevronSvg() {
    return '<svg class="ac-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function calendarSvg() {
    return '<svg class="ac-cal-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="16" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 3v4M16 3v4M3.5 10h17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  }

  function arrowSvg(direction) {
    return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${direction === 'left' ? 'm12.5 4.5-5 5.5 5 5.5' : 'm7.5 4.5 5 5.5-5 5.5'}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function checkSvg() {
    return '<svg class="ac-check" viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.2 3.4 3.4 7.6-7.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function controlLabel(control) {
    const explicit = control.getAttribute('aria-label');
    if (explicit) return explicit.trim();
    const labels = control.labels ? Array.from(control.labels) : [];
    for (const label of labels) {
      const clone = label.cloneNode(true);
      clone.querySelectorAll('select, input, button, .ac-trigger, small').forEach((node) => node.remove());
      const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    const placeholder = control.getAttribute('placeholder');
    if (placeholder) return placeholder;
    return control.name || 'Choose';
  }

  function ensureLayer() {
    if (layer && layer.isConnected) return;
    layer = document.createElement('div');
    layer.className = 'ac-layer';
    layer.hidden = true;
    layer.innerHTML = '<div class="ac-scrim" data-ac-dismiss></div><div class="ac-host"></div>';
    document.body.appendChild(layer);
    scrim = layer.querySelector('.ac-scrim');
    host = layer.querySelector('.ac-host');
    scrim.addEventListener('click', () => closePanel());
  }

  function setExpanded(trigger, expanded) {
    if (trigger && trigger.isConnected) trigger.setAttribute('aria-expanded', String(expanded));
  }

  function positionPopover(panel, trigger) {
    if (!panel || !trigger || !trigger.isConnected) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const minimumWidth = panel.classList.contains('ac-calendar') ? 322 : 216;
    const desiredWidth = panel.classList.contains('ac-calendar')
      ? Math.max(minimumWidth, Math.min(354, rect.width))
      : Math.max(minimumWidth, rect.width);
    const width = Math.min(desiredWidth, viewportWidth - 24);
    panel.style.width = `${width}px`;
    panel.style.left = `${clamp(rect.left, 12, viewportWidth - width - 12)}px`;
    const height = panel.offsetHeight;
    const below = rect.bottom + 8;
    const above = rect.top - height - 8;
    const useAbove = below + height > viewportHeight - 12 && above >= 12;
    panel.classList.toggle('is-above', useAbove);
    panel.style.top = `${Math.round(useAbove ? above : Math.min(below, viewportHeight - height - 12))}px`;
  }

  function attachSheetDrag(panel) {
    if (!panel.classList.contains('ac-sheet')) return;
    const grab = panel.querySelector('.ac-grab');
    if (!grab) return;

    let drag = null;

    function detach() {
      if (!drag) return;
      const pointerId = drag.pointerId;
      drag = null;
      try {
        grab.releasePointerCapture(pointerId);
      } catch (error) {}
      grab.removeEventListener('pointermove', onPointerMove);
      grab.removeEventListener('pointerup', onPointerUp);
      grab.removeEventListener('pointercancel', onPointerCancel);
    }

    function onPointerMove(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const now = performance.now();
      const elapsed = now - drag.lastTime;
      const offset = Math.max(0, event.clientY - drag.startY);
      if (elapsed > 0) drag.velocity = (event.clientY - drag.lastY) / elapsed;
      drag.lastTime = now;
      drag.lastY = event.clientY;
      drag.offset = offset;
      panel.style.transform = `translate3d(0, ${offset}px, 0)`;
    }

    function onPointerUp(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const info = drag;
      detach();
      const limit = Math.min(150, Math.max(64, panel.offsetHeight * 0.24));
      const dismiss = info.offset > limit || (info.offset > 24 && info.velocity > 0.55);

      if (!dismiss) {
        panel.classList.remove('is-dragging');
        panel.style.transform = '';
        return;
      }
      if (!activePanel || activePanel.panel !== panel) return;
      // Re-enable the close transition, then send the sheet the rest of the
      // way down from wherever the finger left it.
      panel.classList.remove('is-dragging');
      panel.style.transform = 'translate3d(0, 100%, 0)';
      closePanel();
    }

    function onPointerCancel(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      detach();
      panel.classList.remove('is-dragging');
      panel.style.transform = '';
    }

    grab.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if (!activePanel || activePanel.panel !== panel) return;
      event.preventDefault();
      drag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        lastY: event.clientY,
        lastTime: performance.now(),
        offset: 0,
        velocity: 0
      };
      panel.classList.add('is-dragging');
      try {
        grab.setPointerCapture(event.pointerId);
      } catch (error) {}
      grab.addEventListener('pointermove', onPointerMove);
      grab.addEventListener('pointerup', onPointerUp);
      grab.addEventListener('pointercancel', onPointerCancel);
    });
  }

  function openPanel(options) {
    ensureLayer();
    window.clearTimeout(closeTimer);
    if (activePanel) {
      const previous = activePanel;
      activePanel = null;
      setExpanded(previous.trigger, false);
      host.replaceChildren();
    }
    const sheet = isSheetMode();
    const panel = options.panel;
    panel.id = panel.id || `ac-panel-${++uid}`;
    panel.tabIndex = -1;
    panel.classList.add('ac-panel');
    panel.classList.add(sheet ? 'ac-sheet' : 'ac-pop');
    if (options.kind) panel.classList.add(`ac-${options.kind}`);
    layer.classList.toggle('ac-sheet', sheet);
    layer.classList.remove('ac-pop');
    if (!sheet) layer.classList.add('ac-pop');
    layer.hidden = false;
    host.replaceChildren(panel);
    document.body.classList.add('ac-open');
    if (!sheet) positionPopover(panel, options.trigger);
    if (sheet) {
      if (!panel.querySelector('.ac-grab')) {
        const grab = document.createElement('span');
        grab.className = 'ac-grab';
        grab.setAttribute('aria-hidden', 'true');
        panel.prepend(grab);
      }
      attachSheetDrag(panel);
    }
    activePanel = {
      panel,
      trigger: options.trigger,
      kind: options.kind,
      sheet,
      focus: options.focus || null
    };
    if (options.trigger) {
      options.trigger.setAttribute('aria-expanded', 'true');
      options.trigger.setAttribute('aria-controls', panel.id);
    }
    window.requestAnimationFrame(() => {
      if (!activePanel || activePanel.panel !== panel) return;
      layer.classList.add('is-open');
      panel.classList.add('is-open');
      const focusTarget = options.focus && options.focus.isConnected ? options.focus : null;
      if (focusTarget) {
        focusTarget.focus({ preventScroll: true });
      } else {
        const first = panel.querySelector(FOCUSABLE);
        (first || panel).focus({ preventScroll: true });
      }
    });
  }

  function closePanel(options) {
    const opts = options || {};
    if (!activePanel) return;
    const current = activePanel;
    activePanel = null;
    setExpanded(current.trigger, false);
    if (current.panel.classList.contains('is-dragging')) {
      current.panel.classList.remove('is-dragging');
      void current.panel.offsetHeight;
      current.panel.style.transform = 'translate3d(0, 100%, 0)';
    }
    layer.classList.remove('is-open');
    current.panel.classList.remove('is-open');
    const finish = () => {
      if (activePanel) return;
      if (host) host.replaceChildren();
      if (layer) layer.hidden = true;
      document.body.classList.remove('ac-open');
      if (current.trigger && current.trigger.isConnected) current.trigger.focus({ preventScroll: true });
    };
    if (opts.immediate) {
      window.clearTimeout(closeTimer);
      current.panel.style.transform = '';
      finish();
      return;
    }
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(finish, SHEET_CLOSE_MS);
  }

  /* ---------------------------------------------------------------- select */

  function syncSelect(select) {
    const trigger = select._acTrigger;
    if (!trigger) return;
    const option = select.options[select.selectedIndex] || null;
    const text = option ? String(option.label || option.textContent || '').trim() : '';
    const valueHost = trigger.querySelector('.ac-value');
    if (valueHost) valueHost.textContent = text || select.getAttribute('placeholder') || 'Select';
    trigger.classList.toggle('is-placeholder', !text);
    trigger.disabled = Boolean(select.disabled);
    trigger.hidden = Boolean(select.hidden);
    trigger.setAttribute('aria-label', controlLabel(select));
    if (select.required) trigger.setAttribute('aria-required', 'true');
  }

  function openSelect(select) {
    const trigger = select._acTrigger;
    if (!trigger || select.disabled) return;
    const label = controlLabel(select);
    const options = Array.from(select.options);
    const sheet = isSheetMode();
    const selected = options.find((option) => option.selected) || null;
    const panel = document.createElement('div');
    panel.innerHTML = `
      ${sheet ? '<span class="ac-grab" aria-hidden="true"></span>' : ''}
      <div class="ac-head">
        <strong class="ac-title">${escapeHtml(label)}</strong>
        ${sheet ? '<button class="ac-done" type="button" data-ac-done>Done</button>' : ''}
      </div>
      <div class="ac-options" role="listbox" aria-label="${escapeHtml(label)}">
        ${options.map((option, index) => {
          const text = String(option.label || option.textContent || '').trim() || 'None';
          const checked = option.selected;
          return `<button class="ac-option${checked ? ' is-selected' : ''}" type="button" role="option" aria-selected="${checked}" data-ac-index="${index}"${option.disabled ? ' disabled' : ''}>
            <span class="ac-option-label">${escapeHtml(text)}</span>
            <span class="ac-option-check">${checkSvg()}</span>
          </button>`;
        }).join('')}
      </div>`;

    let selectedButton = null;
    panel.querySelectorAll('.ac-option').forEach((button) => {
      if (button.dataset.acIndex === String(select.selectedIndex)) selectedButton = button;
      button.addEventListener('click', () => {
        const index = Number(button.dataset.acIndex);
        const option = select.options[index];
        if (!option || option.disabled) return;
        const changed = select.value !== option.value;
        select.value = option.value;
        syncSelect(select);
        if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
        closePanel();
      });
    });

    const done = panel.querySelector('[data-ac-done]');
    if (done) done.addEventListener('click', () => closePanel());

    panel.addEventListener('keydown', (event) => {
      const buttons = Array.from(panel.querySelectorAll('.ac-option:not([disabled])'));
      if (!buttons.length) return;
      const current = document.activeElement;
      const at = buttons.indexOf(current);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = at < 0 ? 0 : (at + delta + buttons.length) % buttons.length;
        buttons[next].focus({ preventScroll: true });
        buttons[next].scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const target = event.key === 'Home' ? buttons[0] : buttons[buttons.length - 1];
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'nearest' });
      }
    });

    openPanel({
      panel,
      trigger,
      kind: 'select',
      focus: selectedButton || panel.querySelector('.ac-option')
    });
  }

  function enhanceSelect(select) {
    if (!select || select.dataset.acEnhanced === 'true') return;
    if (select.multiple || Number(select.size) > 1) return;
    if (select.closest('.ac-layer')) return;
    select.dataset.acEnhanced = 'true';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ac-trigger ac-trigger-select';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = `<span class="ac-value"></span>${chevronSvg()}`;

    select.classList.add('ac-native');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    select.insertAdjacentElement('afterend', trigger);
    select._acTrigger = trigger;

    try {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      Object.defineProperty(select, 'value', {
        configurable: true,
        enumerable: false,
        get() {
          return descriptor.get.call(this);
        },
        set(value) {
          descriptor.set.call(this, value);
          syncSelect(this);
        }
      });
    } catch (error) {
      /* Older engines simply refresh through the observer. */
    }

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSelect(select);
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openSelect(select);
      }
    });
    select.addEventListener('change', () => syncSelect(select));
    new MutationObserver(() => syncSelect(select)).observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'label']
    });
    syncSelect(select);
  }

  /* ------------------------------------------------------------------ date */

  function syncDate(input) {
    const trigger = input._acTrigger;
    if (!trigger) return;
    const text = formatDisplayDate(input.value);
    const valueHost = trigger.querySelector('.ac-value');
    if (valueHost) valueHost.textContent = text || input.getAttribute('placeholder') || 'Choose a date';
    trigger.classList.toggle('is-placeholder', !text);
    trigger.disabled = Boolean(input.disabled);
    trigger.hidden = Boolean(input.hidden);
    trigger.setAttribute('aria-label', controlLabel(input));
    if (input.required) trigger.setAttribute('aria-required', 'true');
  }

  function renderCalendarGrid(panel, view, selectedISO, minISO, maxISO) {
    const daysHost = panel.querySelector('.ac-days');
    const title = panel.querySelector('.ac-cal-title');
    if (!daysHost || !title) return;
    title.textContent = `${MONTHS_LONG[view.getMonth()]} ${view.getFullYear()}`;
    title.setAttribute('aria-label', `${MONTHS_LONG[view.getMonth()]} ${view.getFullYear()}. Switch month`);
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(view.getFullYear(), view.getMonth(), 1 - offset);
    const today = todayISO();
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const date = addDays(start, index);
      const iso = isoFromDate(date);
      const outside = date.getMonth() !== view.getMonth();
      const disabled = (minISO && iso < minISO) || (maxISO && iso > maxISO);
      const classes = [
        'ac-day',
        outside ? 'is-outside' : '',
        iso === selectedISO ? 'is-selected' : '',
        iso === today ? 'is-today' : ''
      ].filter(Boolean).join(' ');
      cells.push(`<button class="${classes}" type="button" data-ac-date="${iso}" tabindex="-1" role="gridcell" aria-label="${escapeHtml(WEEKDAYS_LONG[(date.getDay() + 6) % 7] + ' ' + date.getDate() + ' ' + MONTHS_LONG[date.getMonth()] + ' ' + date.getFullYear())}" aria-selected="${iso === selectedISO}"${disabled ? ' disabled' : ''}><span>${date.getDate()}</span></button>`);
    }
    daysHost.innerHTML = cells.join('');
    return daysHost.querySelector('.is-selected') || daysHost.querySelector('.ac-day:not(.is-outside):not([disabled])') || daysHost.querySelector('.ac-day:not([disabled])');
  }

  function openDatePicker(input) {
    const trigger = input._acTrigger;
    if (!trigger || input.disabled) return;
    const label = controlLabel(input);
    const minISO = input.min || '';
    const maxISO = input.max || '';
    let selectedISO = input.value || '';
    let view = parseISO(selectedISO) ? new Date(parseISO(selectedISO).getFullYear(), parseISO(selectedISO).getMonth(), 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const sheet = isSheetMode();

    const panel = document.createElement('div');
    panel.innerHTML = `
      ${sheet ? '<span class="ac-grab" aria-hidden="true"></span>' : ''}
      <div class="ac-cal-head">
        <button class="ac-cal-nav" type="button" data-ac-prev aria-label="Previous month">${arrowSvg('left')}</button>
        <div class="ac-cal-heading"><span class="ac-cal-kicker">${escapeHtml(label)}</span><button class="ac-cal-title" type="button" data-ac-title aria-live="polite"></button></div>
        <button class="ac-cal-nav" type="button" data-ac-next aria-label="Next month">${arrowSvg('right')}</button>
      </div>
      <div class="ac-weekdays" aria-hidden="true">${WEEKDAYS_SHORT.map((day) => `<span>${day.slice(0, 1)}</span>`).join('')}</div>
      <div class="ac-days" role="grid" aria-label="${escapeHtml(label)} calendar"></div>
      <div class="ac-cal-foot">
        <button class="ac-text-btn" type="button" data-ac-clear>Clear</button>
        <button class="ac-text-btn ac-text-btn-strong" type="button" data-ac-today>Today</button>
      </div>`;

    const grid = panel.querySelector('.ac-days');
    let focusTarget = renderCalendarGrid(panel, view, selectedISO, minISO, maxISO);

    const commit = (iso) => {
      const changed = input.value !== iso;
      input.value = iso;
      syncDate(input);
      if (changed) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      closePanel();
    };

    const rerender = (focusDay) => {
      const target = renderCalendarGrid(panel, view, selectedISO, minISO, maxISO);
      const day = focusDay ? grid.querySelector(`[data-ac-date="${focusDay}"]`) : target;
      if (day) day.focus({ preventScroll: true });
    };

    panel.querySelector('[data-ac-prev]').addEventListener('click', () => {
      view = addMonths(view, -1);
      rerender();
    });
    panel.querySelector('[data-ac-next]').addEventListener('click', () => {
      view = addMonths(view, 1);
      rerender();
    });
    panel.querySelector('[data-ac-title]').addEventListener('click', () => {
      /* A quick way back to the current month without a native wheel. */
      const selected = parseISO(selectedISO);
      view = selected
        ? new Date(selected.getFullYear(), selected.getMonth(), 1)
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      rerender(selected ? selectedISO : todayISO());
    });
    panel.querySelector('[data-ac-today]').addEventListener('click', () => commit(todayISO()));
    panel.querySelector('[data-ac-clear]').addEventListener('click', () => commit(''));

    grid.addEventListener('click', (event) => {
      const day = event.target.closest('.ac-day');
      if (!day || day.disabled) return;
      commit(day.dataset.acDate);
    });

    panel.addEventListener('keydown', (event) => {
      if (!grid.contains(document.activeElement) && document.activeElement !== grid) return;
      const current = document.activeElement.closest ? document.activeElement.closest('.ac-day') : null;
      let date = current ? parseISO(current.dataset.acDate) : parseISO(selectedISO) || new Date();
      let handled = true;
      if (event.key === 'ArrowLeft') date = addDays(date, -1);
      else if (event.key === 'ArrowRight') date = addDays(date, 1);
      else if (event.key === 'ArrowUp') date = addDays(date, -7);
      else if (event.key === 'ArrowDown') date = addDays(date, 7);
      else if (event.key === 'Home') date = addDays(date, -((date.getDay() + 6) % 7));
      else if (event.key === 'End') date = addDays(date, 6 - ((date.getDay() + 6) % 7));
      else if (event.key === 'PageUp') date = new Date(date.getFullYear(), date.getMonth() - 1, date.getDate());
      else if (event.key === 'PageDown') date = new Date(date.getFullYear(), date.getMonth() + 1, date.getDate());
      else handled = false;
      if (!handled) return;
      event.preventDefault();
      const iso = isoFromDate(date);
      if (date.getMonth() !== view.getMonth() || date.getFullYear() !== view.getFullYear()) {
        view = new Date(date.getFullYear(), date.getMonth(), 1);
      }
      const target = renderCalendarGrid(panel, view, selectedISO, minISO, maxISO);
      const wanted = grid.querySelector(`[data-ac-date="${iso}"]`) || target;
      if (wanted) wanted.focus({ preventScroll: true });
    });

    openPanel({ panel, trigger, kind: 'calendar', focus: focusTarget });
  }

  function enhanceDate(input) {
    if (!input || input.type !== 'date' || input.dataset.acEnhanced === 'true') return;
    if (input.closest('.ac-layer')) return;
    input.dataset.acEnhanced = 'true';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ac-trigger ac-trigger-date';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = `<span class="ac-value"></span>${calendarSvg()}`;

    input.classList.add('ac-native');
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    input.insertAdjacentElement('afterend', trigger);
    input._acTrigger = trigger;

    try {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      Object.defineProperty(input, 'value', {
        configurable: true,
        enumerable: false,
        get() {
          return descriptor.get.call(this);
        },
        set(value) {
          descriptor.set.call(this, value);
          syncDate(this);
        }
      });
    } catch (error) {
      /* Fall back to the observer. */
    }

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDatePicker(input);
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDatePicker(input);
      }
    });
    input.addEventListener('change', () => syncDate(input));
    input.addEventListener('input', () => syncDate(input));
    syncDate(input);
  }

  /* ---------------------------------------------------------------- shared */

  function refresh(root) {
    const scope = root && root.querySelectorAll ? root : document;
    if (scope.matches && scope.matches('select')) enhanceSelect(scope);
    if (scope.matches && scope.matches('input[type="date"]')) enhanceDate(scope);
    scope.querySelectorAll('select').forEach(enhanceSelect);
    scope.querySelectorAll('input[type="date"]').forEach(enhanceDate);
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    window.queueMicrotask(() => {
      refreshQueued = false;
      refresh(document);
    });
  }

  function onKeydown(event) {
    if (!activePanel) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = activePanel.panel;
    const focusable = Array.from(panel.querySelectorAll(FOCUSABLE)).filter((element) => !element.disabled && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onViewportChange() {
    if (!activePanel) return;
    if (activePanel.sheet || isSheetMode()) closePanel({ immediate: true });
    else positionPopover(activePanel.panel, activePanel.trigger);
  }

  function init() {
    ensureLayer();
    refresh(document);
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          if (mutation.target.matches('select')) syncSelect(mutation.target);
          else if (mutation.target.matches('input[type="date"]')) syncDate(mutation.target);
          continue;
        }
        if (mutation.type === 'childList' && mutation.target.matches && mutation.target.matches('select')) {
          syncSelect(mutation.target);
          continue;
        }
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if ((node.matches && (node.matches('select') || node.matches('input[type="date"]')))
            || (node.querySelector && node.querySelector('select, input[type="date"]'))) {
            queueRefresh();
            return;
          }
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden']
    });
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('click', (event) => {
      const label = event.target.closest ? event.target.closest('label') : null;
      if (!label) return;
      const control = label.querySelector('.ac-native');
      if (!control || !control._acTrigger) return;
      if (event.target.closest('.ac-trigger')) return;
      event.preventDefault();
      control._acTrigger.click();
    }, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', () => {
      if (activePanel && !activePanel.sheet) closePanel();
    }, true);
  }

  window.AppleControls = {
    refresh,
    sync(target) {
      const element = typeof target === 'string' ? document.querySelector(target) : target;
      if (!element) return;
      if (element.matches('select')) syncSelect(element);
      else if (element.matches('input[type="date"]')) syncDate(element);
    },
    close: closePanel,
    closeTopmost() {
      if (!activePanel) return false;
      closePanel();
      return true;
    },
    openSelect(selector) {
      const select = typeof selector === 'string' ? document.querySelector(selector) : selector;
      if (select) openSelect(select);
    },
    openDate(selector) {
      const input = typeof selector === 'string' ? document.querySelector(selector) : selector;
      if (input) openDatePicker(input);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
