/* Moneta UI — a journal ledger for one person and one device. */
(function () {
  'use strict';

  const C = window.MonetaCore;
  const DB = window.MonetaDB;

  const bootStarted = typeof window.__monetaBootAt === 'number' ? window.__monetaBootAt : performance.now();
  const BOOT_MIN_MS = 1250;
  let bootRevealed = false;

  if (!C || !DB) {
    showBootError('Moneta could not start. Reload the app.');
    return;
  }

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  function isNativeShell() {
    return Boolean(
      window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform()
    );
  }

  function notifyNativeTheme(mode, resolved) {
    const native = window.MonetaNative;
    if (!native || typeof native.setTheme !== 'function') return;
    try {
      native.setTheme(mode || 'system', resolved === 'light' ? 'light' : 'dark');
    } catch (error) {}
  }

  function notifyNativeReady() {
    const native = window.MonetaNative;
    if (!native || typeof native.ready !== 'function') return;
    try {
      native.ready();
    } catch (error) {}
  }

  const state = {
    ready: false,
    view: 'overview',
    transactions: [],
    imports: [],
    settings: { ...C.DEFAULT_SETTINGS },
    period: { preset: 'this-month', from: null, to: null },
    ledger: {
      search: '',
      side: 'all',
      category: 'all',
      sortKey: 'date',
      sortDir: 'desc',
      page: 1
    },
    importSession: null,
    installPrompt: null
  };

  let toastTimer = null;
  let activeDialog = null;
  let dialogGeneration = 0;
  let searchTimer = null;
  const systemTheme = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  /* ---------------------------------------------------------------- helpers */

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function icon(name) {
    return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function fmtMoney(value) {
    return C.formatMoney(value, { currency: state.settings.currency });
  }

  function fmtAmount(value) {
    return C.formatAmount(value, { currency: state.settings.currency });
  }

  function fmtDate(value) {
    return C.formatDate(value, state.settings.dateFormat);
  }

  function isNegativeMoney(value) {
    return C.moneyMinor(value) < 0n;
  }

  function openingSigned() {
    return C.accountBalance([], state.settings);
  }

  function accountBalanceNow() {
    return C.accountBalance(state.transactions, state.settings);
  }

  function signedAmountMarkup(value, prefix) {
    const negative = isNegativeMoney(value);
    const absolute = negative ? C.subtractMoney('0.00', value) : value;
    return `<span class="money ${negative ? 'is-negative' : ''}">${prefix === false ? '' : (negative ? '−' : '+')}${fmtMoney(absolute)}</span>`;
  }

  function categoryList() {
    return C.normalizeCategoryList(state.settings.categories);
  }

  function categoryNames() {
    return categoryList().map((category) => category.name);
  }

  function categoryOf(row) {
    return C.resolveCategory(row.category, row.particulars, state.settings.categories);
  }

  function todayLong() {
    return new Date().toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  function showToast(message, tone) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast show${tone ? ` toast-${tone}` : ''}`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.className = 'toast';
    }, 3400);
  }

  function columnLetter(index) {
    let value = Number(index);
    let out = '';
    while (value >= 0) {
      out = String.fromCharCode((value % 26) + 65) + out;
      value = Math.floor(value / 26) - 1;
    }
    return out;
  }

  function downloadBlob(filename, content, mime) {
    const blob = content instanceof Blob
      ? content
      : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function downloadText(filename, text, mime) {
    downloadBlob(filename, text, mime);
  }

  function todayStamp() {
    return C.todayISO();
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  /* ----------------------------------------------------------------- theme */

  function resolveTheme(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    return systemTheme && systemTheme.matches ? 'light' : 'dark';
  }

  function applyTheme(mode) {
    const resolved = resolveTheme(mode);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeMode = mode;
    try {
      localStorage.setItem('moneta-theme-mode', mode);
    } catch (error) {}
    notifyNativeTheme(mode, resolved);
    if (bootRevealed || isNativeShell()) syncSystemChrome(resolved);
    updateThemeControls();
  }

  function syncSystemChrome(theme) {
    const resolved = theme || resolveTheme(state.settings.theme || 'system');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'light' ? '#f4f4f2' : '#0b0d10');
    const systemBars = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SystemBars;
    if (systemBars && typeof systemBars.setStyle === 'function') {
      systemBars.setStyle({ style: resolved === 'dark' ? 'DARK' : 'LIGHT' }).catch(() => {});
    }
  }

  function showBootError(message) {
    notifyNativeReady();
    const loader = document.getElementById('appLoader');
    if (!loader) return;
    loader.classList.add('is-error');
    loader.innerHTML = `<div class="loader-stage">
      <div class="loader-mark" aria-hidden="true">!</div>
      <p class="loader-copy">${escapeHtml(message)}</p>
      <button class="btn btn-primary" type="button">Reload</button>
    </div>`;
    const reload = loader.querySelector('button');
    if (reload) reload.addEventListener('click', () => window.location.reload());
  }

  function updateThemeControls() {
    const mode = state.settings.theme || 'system';
    const resolved = resolveTheme(mode);
    const iconName = mode === 'system' ? 'monitor' : resolved === 'light' ? 'sun' : 'moon';
    $$('[data-theme-icon]').forEach((use) => {
      const useElement = use.tagName.toLowerCase() === 'use' ? use : use.querySelector('use');
      if (useElement) useElement.setAttribute('href', `#i-${iconName}`);
    });
    $$('[data-theme-label]').forEach((element) => {
      element.textContent = mode === 'system'
        ? 'System appearance'
        : `${resolved === 'light' ? 'Light' : 'Dark'} appearance`;
    });
    $$('[data-theme-choice]').forEach((button) => {
      const active = button.dataset.themeChoice === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $$('[data-action="theme"]').forEach((button) => {
      button.setAttribute('aria-label', `Change appearance. Currently ${mode === 'system' ? 'system' : resolved}.`);
    });
  }

  function toggleTheme() {
    const current = resolveTheme(state.settings.theme);
    const next = current === 'light' ? 'dark' : 'light';
    state.settings.theme = next;
    applyTheme(next);
    DB.saveSettings({ theme: next }).catch(() => showToast('Could not save the theme', 'error'));
    renderChrome();
  }

  /* ---------------------------------------------------------------- dialogs */

  function focusableElements(container) {
    return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', container)
      .filter((element) => element.offsetParent !== null);
  }

  function mountDialog(markup, options) {
    const opts = options || {};
    if (activeDialog) activeDialog.close('replaced');
    const generation = ++dialogGeneration;
    const root = $('#modalRoot');
    root.innerHTML = `<div class="modal-backdrop" data-dialog-backdrop>${markup}</div>`;
    const backdrop = $('[data-dialog-backdrop]', root);
    const card = $('.modal-card', backdrop);
    const previousFocus = document.activeElement;
    document.body.classList.add('modal-open');
    let closed = false;

    function close(reason) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeyDown);
      if (activeDialog && activeDialog.generation === generation) activeDialog = null;
      backdrop.classList.add('is-closing');
      window.setTimeout(() => {
        // A newer dialog may have mounted while this one was fading out.
        if (generation !== dialogGeneration) return;
        if (backdrop.parentElement === root) root.replaceChildren();
        document.body.classList.remove('modal-open');
        if (!activeDialog && previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) {
          previousFocus.focus({ preventScroll: true });
        }
      }, 220);
      if (opts.onClose) opts.onClose(reason || 'closed');
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close('escape');
        return;
      }
      if (event.key !== 'Tab' || !card) return;
      const items = focusableElements(card);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close('backdrop');
    });
    $$('[data-dialog-close]', backdrop).forEach((button) => {
      button.addEventListener('click', () => close('cancel'));
    });

    activeDialog = { close, card, backdrop, generation };
    window.setTimeout(() => {
      if (closed) return;
      let target = null;
      if (opts.initialFocus) target = typeof opts.initialFocus === 'string' ? $(opts.initialFocus, card) : opts.initialFocus;
      if (!target) target = focusableElements(card)[0];
      if (target) target.focus({ preventScroll: true });
    }, 40);
    return { close, card, backdrop };
  }

  // Android back (wired from MainActivity): dismiss the topmost surface first,
  // then let the native side finish the activity.
  window.MonetaBack = function () {
    if (window.AppleControls && typeof window.AppleControls.closeTopmost === 'function'
      && window.AppleControls.closeTopmost()) {
      return true;
    }
    if (activeDialog) {
      activeDialog.close('back');
      return true;
    }
    return false;
  };

  function confirmAction(options) {
    const opts = options || {};
    return new Promise((resolve) => {
      let settled = false;
      const titleId = `confirm-title-${Date.now()}`;
      const requireText = opts.requireText || null;
      const markup = `
        <section class="modal-card confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="${titleId}">
          <header class="confirm-head">
            <span class="confirm-mark ${opts.danger ? 'danger' : ''}">${icon(opts.danger ? 'alert' : 'check')}</span>
            <button class="icon-btn" type="button" data-dialog-close aria-label="Close">${icon('close')}</button>
          </header>
          <h2 id="${titleId}">${escapeHtml(opts.title || 'Are you sure?')}</h2>
          <p class="confirm-message">${escapeHtml(opts.message || '')}</p>
          ${opts.detailHtml || ''}
          ${requireText ? `
            <label class="field confirm-typing">
              <span>${escapeHtml(opts.requireLabel || `Type ${requireText} to confirm`)}</span>
              <input type="text" data-confirm-text autocomplete="off" autocapitalize="characters" placeholder="${escapeAttr(requireText)}">
            </label>` : ''}
          <div class="confirm-actions">
            <button class="btn btn-secondary" type="button" data-confirm-cancel>${escapeHtml(opts.cancelLabel || 'Cancel')}</button>
            <button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" type="button" data-confirm-ok ${requireText ? 'disabled' : ''}>${escapeHtml(opts.confirmLabel || 'Confirm')}</button>
          </div>
        </section>`;

      const dialog = mountDialog(markup, {
        onClose: () => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        }
      });
      const ok = $('[data-confirm-ok]', dialog.card);
      const cancel = $('[data-confirm-cancel]', dialog.card);
      const textInput = $('[data-confirm-text]', dialog.card);
      const finish = (value) => {
        if (settled) return;
        settled = true;
        dialog.close('confirmed');
        resolve(value);
      };
      ok.addEventListener('click', () => finish(true));
      cancel.addEventListener('click', () => finish(false));
      if (textInput) {
        textInput.addEventListener('input', () => {
          ok.disabled = textInput.value.trim().toUpperCase() !== String(requireText).toUpperCase();
        });
        window.setTimeout(() => textInput.focus(), 50);
      }
    });
  }

  function showAlert(options) {
    const opts = options || {};
    const titleId = `alert-title-${Date.now()}`;
    const dialog = mountDialog(`
      <section class="modal-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <header class="confirm-head">
          <span class="confirm-mark ${opts.danger ? 'danger' : ''}">${icon(opts.danger ? 'alert' : 'check')}</span>
          <button class="icon-btn" type="button" data-dialog-close aria-label="Close">${icon('close')}</button>
        </header>
        <h2 id="${titleId}">${escapeHtml(opts.title || 'Notice')}</h2>
        <p class="confirm-message">${escapeHtml(opts.message || '')}</p>
        ${opts.detailHtml || ''}
        <div class="confirm-actions"><button class="btn btn-primary" type="button" data-dialog-close>Close</button></div>
      </section>`);
    return dialog;
  }

  /* ------------------------------------------------------------ period state */

  function loadPeriodState() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('moneta-period') || 'null');
    } catch (error) {
      saved = null;
    }
    const validPreset = saved && C.PERIOD_OPTIONS.some((option) => option.value === saved.preset);
    if (validPreset && saved.preset === 'custom') {
      const from = C.isValidISODate(saved.from) ? saved.from : null;
      const to = C.isValidISODate(saved.to) ? saved.to : null;
      state.period = { preset: 'custom', from, to };
      return;
    }
    const preset = validPreset ? saved.preset : 'this-month';
    const range = C.computePeriodRange(preset, { today: C.todayISO() });
    state.period = { preset: range.preset, from: range.from, to: range.to };
  }

  function savePeriodState() {
    try {
      localStorage.setItem('moneta-period', JSON.stringify(state.period));
    } catch (error) {}
  }

  function periodRangeText() {
    const { from, to, preset } = state.period;
    if (preset === 'all') return 'All time';
    if (!from && !to) return 'All dates';
    return C.formatRangeLabel(from, to, state.settings.dateFormat);
  }

  function periodLongText() {
    const { from, to } = state.period;
    if (!from && !to) return 'All time';
    return C.formatRangeLabel(from, to, state.settings.dateFormat);
  }

  function setPeriodPreset(preset) {
    let from = null;
    let to = null;
    if (preset === 'custom') {
      from = state.period.from;
      to = state.period.to;
      if (!from) from = C.startOfMonthISO(C.todayISO());
      if (!to) to = C.todayISO();
    } else {
      const range = C.computePeriodRange(preset, { today: C.todayISO() });
      from = range.from;
      to = range.to;
    }
    state.period = { preset, from, to };
    state.ledger.page = 1;
    savePeriodState();
    syncPeriodControls();
    renderCurrentView();
  }

  function setCustomPeriod(from, to) {
    let start = C.isValidISODate(from) ? from : null;
    let end = C.isValidISODate(to) ? to : null;
    if (start && end && start > end) {
      const swap = start;
      start = end;
      end = swap;
    }
    state.period = { preset: 'custom', from: start, to: end };
    state.ledger.page = 1;
    savePeriodState();
    syncPeriodControls();
    renderCurrentView();
  }

  function syncPeriodControls() {
    $$('[data-period-preset], #ledgerPeriod').forEach((select) => {
      if (select.value !== state.period.preset) select.value = state.period.preset;
    });
    $$('[data-period-control]').forEach((control) => {
      const custom = $('[data-period-custom]', control);
      if (custom) custom.hidden = state.period.preset !== 'custom';
      const fromInput = $('[data-period-from]', control);
      const toInput = $('[data-period-to]', control);
      if (fromInput && fromInput.value !== (state.period.from || '')) fromInput.value = state.period.from || '';
      if (toInput && toInput.value !== (state.period.to || '')) toInput.value = state.period.to || '';
      const range = $('[data-period-range]', control);
      if (range) range.textContent = periodRangeText();
    });
    $$('[data-range-label]').forEach((element) => {
      element.textContent = periodLongText();
    });
    const ledgerFrom = $('#ledgerFrom');
    const ledgerTo = $('#ledgerTo');
    if (ledgerFrom && ledgerFrom.value !== (state.period.from || '')) ledgerFrom.value = state.period.from || '';
    if (ledgerTo && ledgerTo.value !== (state.period.to || '')) ledgerTo.value = state.period.to || '';
  }

  /* ----------------------------------------------------------- navigation */

  const VIEW_TITLES = {
    overview: 'Overview',
    ledger: 'Transactions',
    import: 'Import',
    reports: 'Analytics',
    goals: 'Goals & budgets',
    accounts: 'Accounts',
    data: 'Data',
    settings: 'Settings'
  };

  const DOCK_ORDER = ['overview', 'ledger', 'reports', 'goals', 'accounts'];

  function viewFromHash() {
    const value = String(location.hash || '').replace(/^#/, '');
    return VIEW_TITLES[value] ? value : null;
  }

  function activeDockView(view) {
    if (DOCK_ORDER.includes(view)) return view;
    if (view === 'import') return 'ledger';
    if (view === 'data') return 'accounts';
    return 'overview';
  }

  function navigate(view, options) {
    const opts = options || {};
    const next = VIEW_TITLES[view] ? view : 'overview';
    const previous = state.view;
    state.view = next;
    $$('.view').forEach((section) => {
      const active = section.dataset.viewPanel === next;
      section.classList.toggle('active', active);
      section.hidden = !active;
    });
    $$('.side-link').forEach((button) => {
      const active = button.dataset.view === next;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const dockActive = activeDockView(next);
    $$('.dock-tab').forEach((button) => {
      const active = button.dataset.view === dockActive;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    document.title = `${VIEW_TITLES[next]} · Moneta`;
    if (opts.push !== false && location.hash !== `#${next}`) {
      history.pushState({ view: next }, '', `#${next}`);
    }
    if (previous !== next) animateDock(previous, next);
    window.requestAnimationFrame(() => positionDockIndicator(previous !== next));
    syncPeriodControls();
    renderCurrentView();
    if (opts.scroll !== false) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /* ------------------------------------------------------- dock animation */

  function dockIndexForView(view) {
    return DOCK_ORDER.indexOf(activeDockView(view));
  }

  function positionDockIndicator(animated) {
    const indicator = $('#dockIndicator');
    const activeTab = $('.dock-tab.active');
    const surface = $('.dock-surface');
    if (!indicator || !activeTab || !surface) return;
    const tabRect = activeTab.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    const x = tabRect.left - surfaceRect.left + (tabRect.width - 42) / 2;
    if (!animated) {
      indicator.style.transition = 'none';
      indicator.style.transform = `translate3d(${x}px, 0, 0)`;
      void indicator.offsetWidth;
      indicator.style.transition = '';
      return;
    }
    indicator.style.transform = `translate3d(${x}px, 0, 0)`;
  }

  function animateDock(previousView, nextView) {
    if (window.innerWidth > 900) return;
    const dock = $('#mobileDock');
    if (!dock) return;
    if (dockIndexForView(previousView) !== dockIndexForView(nextView)) {
      positionDockIndicator(true);
    }
  }

  function pulseDockAt() {}

  /* -------------------------------------------------------------- settings */

  async function saveSettings(partial, options) {
    const opts = options || {};
    const result = C.normalizeSettings({ ...state.settings, ...partial });
    if (!result.ok) {
      showToast(result.errors[0] || 'That setting is not valid', 'error');
      return false;
    }
    state.settings = result.settings;
    if (partial.theme !== undefined) applyTheme(state.settings.theme);
    try {
      await DB.saveSettings(state.settings);
    } catch (error) {
      showToast('Could not save that setting', 'error');
      return false;
    }
    if (state.ledger.sortKey !== C.sortConfig(state.settings.defaultSort).key && opts.applySort) {
      const config = C.sortConfig(state.settings.defaultSort);
      state.ledger.sortKey = config.key;
      state.ledger.sortDir = config.dir;
    }
    renderChrome();
    if (opts.message) showToast(opts.message);
    return true;
  }

  function fillStaticOptions() {
    const periodOptions = C.PERIOD_OPTIONS.map((option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join('');
    $$('[data-period-preset]').forEach((select) => {
      select.innerHTML = periodOptions;
    });
    const ledgerPeriod = $('#ledgerPeriod');
    if (ledgerPeriod) ledgerPeriod.innerHTML = periodOptions;
    const sortOptions = C.SORT_OPTIONS.map((option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join('');
    ['#ledgerSort', '#settingsSort'].forEach((selector) => {
      const select = $(selector);
      if (select) select.innerHTML = sortOptions;
    });
    const currency = $('#settingsCurrency');
    if (currency) {
      currency.innerHTML = C.CURRENCIES.map((item) => `<option value="${item.code}">${item.label} · ${item.code} (${item.symbol})</option>`).join('');
    }
    const dateFormat = $('#settingsDateFormat');
    if (dateFormat) {
      dateFormat.innerHTML = C.DATE_FORMATS.map((item) => `<option value="${item.value}">${escapeHtml(item.label)}</option>`).join('');
    }
    $$('#settingsPageSize, #ledgerPageSize').forEach((select) => {
      select.innerHTML = C.PAGE_SIZES.map((size) => `<option value="${size}">${size} rows</option>`).join('');
    });
  }

  function renderChrome() {
    $$('[data-today-label]').forEach((element) => {
      element.textContent = todayLong();
    });
    const sidebarCount = $('#sidebarEntryCount');
    if (sidebarCount) sidebarCount.textContent = `${state.transactions.length} ${state.transactions.length === 1 ? 'entry' : 'entries'}`;
    updateThemeControls();
    const settingsBalance = $('#settingsCurrentBalance');
    if (settingsBalance) settingsBalance.textContent = fmtMoney(accountBalanceNow());
    const installButton = $('#installApp');
    if (installButton) installButton.hidden = !state.installPrompt;
    document.documentElement.dataset.dateFormat = state.settings.dateFormat;
    if (window.AppleControls) window.AppleControls.refresh();
  }

  function renderCurrentView() {
    if (!state.ready) return;
    syncPeriodControls();
    renderChrome();
    if (window.AppleControls) window.AppleControls.refresh();
    switch (state.view) {
      case 'ledger':
        renderLedger();
        break;
      case 'reports':
        renderReports();
        break;
      case 'goals':
        renderGoals();
        break;
      case 'accounts':
        renderAccounts();
        break;
      case 'import':
        renderImportUI();
        break;
      case 'data':
        renderData();
        break;
      case 'settings':
        renderSettings();
        break;
      case 'overview':
      default:
        renderOverview();
        break;
    }
  }

  /* --------------------------------------------------------------- overview */

  function renderChart(container, trend, emptyText) {
    if (!container) return;
    const buckets = trend && trend.buckets ? trend.buckets : [];
    const hasRows = buckets.some((bucket) => Number(bucket.count) > 0);
    container.classList.toggle('is-empty', !hasRows);
    if (!buckets.length || !hasRows) {
      container.innerHTML = `<div class="chart-empty"><span>${icon('reports')}</span><p>${escapeHtml(emptyText || 'No movement in this period.')}</p></div>`;
      container.setAttribute('aria-label', emptyText || 'No movement in this period');
      return;
    }
    let max = 0n;
    for (const bucket of buckets) {
      if (C.moneyMinor(bucket.debit) > max) max = C.moneyMinor(bucket.debit);
      if (C.moneyMinor(bucket.credit) > max) max = C.moneyMinor(bucket.credit);
    }
    const maxNumber = max > 0n ? Number(max) : 1;
    const granularity = trend.granularity;
    const bucketsMarkup = buckets.map((bucket) => {
      const debitHeight = Number(C.moneyMinor(bucket.debit)) / maxNumber * 100;
      const creditHeight = Number(C.moneyMinor(bucket.credit)) / maxNumber * 100;
      const title = `${bucket.title || bucket.label} · Debit ${fmtMoney(bucket.debit)} · Credit ${fmtMoney(bucket.credit)}`;
      return `<div class="bar-bucket" title="${escapeAttr(title)}">
        <div class="bars" aria-hidden="true">
          <span class="bar bar-debit" style="height:${Math.max(2, Math.round(debitHeight))}%"></span>
          <span class="bar bar-credit" style="height:${Math.max(2, Math.round(creditHeight))}%"></span>
        </div>
        <small>${escapeHtml(bucket.label)}</small>
      </div>`;
    }).join('');
    container.innerHTML = bucketsMarkup;
    container.dataset.granularity = granularity || '';
    const total = C.summarize(buckets);
    container.setAttribute('aria-label', `${granularity} movement chart. Debits ${fmtMoney(total.debit)}, credits ${fmtMoney(total.credit)}.`);
  }

  function renderDonut(donut, totalElement, legendElement, summary) {
    if (!donut) return;
    const debit = C.moneyMinor(summary.debit);
    const credit = C.moneyMinor(summary.credit);
    const total = debit + credit;
    if (total > 0n) {
      const debitShare = Number((debit * 1000n) / total) / 10;
      donut.style.background = `conic-gradient(var(--debit) 0 ${debitShare}%, var(--credit) ${debitShare}% 100%)`;
    } else {
      donut.style.background = 'var(--surface-3)';
    }
    if (totalElement) totalElement.textContent = fmtMoney(C.addMoney(summary.debit, summary.credit));
    if (legendElement) {
      legendElement.innerHTML = `
        <div class="split-legend-row"><span><i class="legend-debit"></i>Debits</span><strong class="money">${fmtMoney(summary.debit)}</strong><small>${C.percent(summary.debit, C.addMoney(summary.debit, summary.credit))}%</small></div>
        <div class="split-legend-row"><span><i class="legend-credit"></i>Credits</span><strong class="money">${fmtMoney(summary.credit)}</strong><small>${C.percent(summary.credit, C.addMoney(summary.debit, summary.credit))}%</small></div>
        <div class="split-legend-net"><span>Net movement</span><strong class="money ${isNegativeMoney(summary.net) ? 'is-negative' : 'is-positive'}">${fmtMoney(summary.net)}</strong></div>`;
    }
  }

  function currentPeriodRows() {
    return C.filterTransactions(state.transactions, {
      from: state.period.from,
      to: state.period.to,
      dateFormat: state.settings.dateFormat,
      currency: state.settings.currency
    });
  }

  function renderOverview() {
    const rows = currentPeriodRows();
    const periodSummary = C.summarize(rows);
    const allSummary = C.summarize(state.transactions);
    const balance = accountBalanceNow();
    const opening = openingSigned();

    const balanceElement = $('#overviewBalance');
    if (balanceElement) {
      balanceElement.textContent = fmtMoney(balance);
      balanceElement.classList.toggle('is-negative', isNegativeMoney(balance));
    }
    const openingCaption = $('#overviewOpeningCaption');
    if (openingCaption) openingCaption.textContent = `Opening ${fmtMoney(opening)}`;
    $('#overviewDebit').textContent = fmtMoney(periodSummary.debit);
    $('#overviewCredit').textContent = fmtMoney(periodSummary.credit);
    $('#overviewNet').textContent = fmtMoney(periodSummary.net);
    $('#overviewNet').classList.toggle('is-negative', isNegativeMoney(periodSummary.net));
    $('#overviewCount').textContent = periodSummary.count.toLocaleString('en-IN');
    $('#overviewOpening').textContent = fmtMoney(opening);
    $('#overviewAllDebit').textContent = fmtMoney(allSummary.debit);
    $('#overviewAllCredit').textContent = fmtMoney(allSummary.credit);
    $('#overviewAllNet').textContent = fmtMoney(allSummary.net);
    $('#overviewAllNet').classList.toggle('is-negative', isNegativeMoney(allSummary.net));

    const trend = C.buildTrend(state.transactions, { from: state.period.from, to: state.period.to }, state.settings.dateFormat);
    const caption = $('#overviewChartCaption');
    if (caption) {
      const granularityLabel = trend.granularity === 'daily' ? 'Daily' : trend.granularity === 'weekly' ? 'Weekly' : 'Monthly';
      caption.textContent = `${granularityLabel} debits and credits · ${periodLongText()}`;
    }
    renderChart($('#overviewChart'), trend, 'No journal movement in this period.');

    renderDonut($('#overviewDonut'), $('#overviewDonutTotal'), $('#overviewSplitLegend'), periodSummary);

    const recent = C.sortTransactions(state.transactions, 'date', 'desc').slice(0, 6);
    const recentList = $('#recentList');
    if (!recent.length) {
      recentList.innerHTML = `<div class="empty-state compact-empty">
        <span class="empty-mark">${icon('ledger')}</span>
        <h3>Your journal starts here</h3>
        <p>Add a line, or import the spreadsheet you already keep.</p>
        <div class="empty-actions">
          <button class="btn btn-primary" type="button" data-action="add">${icon('plus')}Add entry</button>
          <button class="btn btn-secondary" type="button" data-goto="import">Import spreadsheet</button>
        </div>
      </div>`;
    } else {
      recentList.innerHTML = recent.map((row) => {
        const parts = C.parseISODateParts(row.date);
        const side = C.moneyMinor(row.debit) > 0n ? 'debit' : 'credit';
        const amount = side === 'debit' ? row.debit : row.credit;
        const category = categoryOf(row);
        return `<div class="recent-row">
          <div class="recent-date"><strong>${parts ? String(parts.day).padStart(2, '0') : '--'}</strong><small>${parts ? C.MONTHS_SHORT[parts.month - 1] : ''}</small></div>
          <div class="recent-main">
            <strong>${escapeHtml(row.particulars)}</strong>
            <span class="category-chip">${escapeHtml(category)}</span>
          </div>
          <div class="recent-amount ${side}"><span class="money">${side === 'debit' ? '−' : '+'}${fmtMoney(amount)}</span><small>${side === 'debit' ? 'Debit' : 'Credit'}</small></div>
        </div>`;
      }).join('');
    }
  }

  /* ----------------------------------------------------------------- ledger */

  function ledgerBaseRows() {
    return C.filterTransactions(state.transactions, {
      from: state.period.from,
      to: state.period.to,
      search: state.ledger.search,
      side: state.ledger.side,
      category: state.ledger.category,
      dateFormat: state.settings.dateFormat,
      currency: state.settings.currency
    });
  }

  function ledgerSortedRows() {
    return C.sortTransactions(ledgerBaseRows(), state.ledger.sortKey, state.ledger.sortDir);
  }

  function populateCategoryFilter() {
    const select = $('#ledgerCategory');
    if (!select) return;
    const categories = categoryNames();
    if (state.ledger.category !== 'all' && !categories.includes(state.ledger.category)) {
      state.ledger.category = 'all';
    }
    select.innerHTML = '<option value="all">All categories</option>' + categories
      .map((category) => `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`)
      .join('');
    select.value = state.ledger.category;
    if (window.AppleControls && window.AppleControls.sync) window.AppleControls.sync(select);
  }

  function syncLedgerControls() {
    populateCategoryFilter();
    const search = $('#ledgerSearch');
    if (search && search.value !== state.ledger.search) search.value = state.ledger.search;
    const clearSearch = $('#clearSearch');
    if (clearSearch) clearSearch.hidden = !state.ledger.search;
    $$('#ledgerSide [data-side]').forEach((button) => {
      const active = button.dataset.side === state.ledger.side;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const sort = $('#ledgerSort');
    if (sort) sort.value = `${state.ledger.sortKey}-${state.ledger.sortDir}`;
    const pageSize = $('#ledgerPageSize');
    if (pageSize) pageSize.value = String(state.settings.pageSize);
    const periodSelect = $('#ledgerPeriod');
    if (periodSelect) periodSelect.value = state.period.preset;
  }

  function emptyAmount() {
    return '<span class="amount-empty" aria-label="No amount">—</span>';
  }

  function rowActionsMarkup(row) {
    const particulars = escapeAttr(row.particulars);
    return `<div class="row-actions">
      <button class="row-action" type="button" data-edit="${escapeAttr(row.id)}" title="Edit entry" aria-label="Edit ${particulars}">${icon('edit')}</button>
      <button class="row-action" type="button" data-duplicate="${escapeAttr(row.id)}" title="Duplicate entry" aria-label="Duplicate ${particulars}">${icon('copy')}</button>
      <button class="row-action row-action-danger" type="button" data-delete="${escapeAttr(row.id)}" title="Delete entry" aria-label="Delete ${particulars}">${icon('trash')}</button>
    </div>`;
  }

  function ledgerTableRow(row) {
    const category = categoryOf(row);
    const debit = C.moneyMinor(row.debit);
    const credit = C.moneyMinor(row.credit);
    const parts = C.parseISODateParts(row.date);
    const weekday = parts ? C.WEEKDAYS_SHORT[C.weekdayIndex(row.date)] : '';
    return `<tr data-id="${escapeAttr(row.id)}">
      <td class="cell-date"><span>${fmtDate(row.date)}</span><small>${weekday}</small></td>
      <td><div class="particulars-cell"><strong>${escapeHtml(row.particulars)}</strong><span class="category-chip">${escapeHtml(category)}</span></div></td>
      <td class="align-right amount-cell">${debit > 0n ? `<span class="money amount-debit">${fmtAmount(row.debit)}</span>` : emptyAmount()}</td>
      <td class="align-right amount-cell">${credit > 0n ? `<span class="money amount-credit">${fmtAmount(row.credit)}</span>` : emptyAmount()}</td>
      <td class="col-actions">${rowActionsMarkup(row)}</td>
    </tr>`;
  }

  function ledgerCard(row) {
    const category = categoryOf(row);
    const debit = C.moneyMinor(row.debit);
    const credit = C.moneyMinor(row.credit);
    return `<article class="ledger-card" data-id="${escapeAttr(row.id)}">
      <div class="ledger-card-head">
        <div class="ledger-card-date"><strong>${fmtDate(row.date)}</strong><span class="category-chip">${escapeHtml(category)}</span></div>
        ${rowActionsMarkup(row)}
      </div>
      <h3>${escapeHtml(row.particulars)}</h3>
      <div class="ledger-card-amounts">
        <div><span>Debit</span>${debit > 0n ? `<strong class="money amount-debit">${fmtMoney(row.debit)}</strong>` : '<strong class="amount-empty">—</strong>'}</div>
        <div><span>Credit</span>${credit > 0n ? `<strong class="money amount-credit">${fmtMoney(row.credit)}</strong>` : '<strong class="amount-empty">—</strong>'}</div>
      </div>
    </article>`;
  }

  function pageList(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
    const pages = [1];
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    if (start > 2) pages.push('…');
    for (let page = start; page <= end; page += 1) pages.push(page);
    if (end < total - 1) pages.push('…');
    pages.push(total);
    return [...new Set(pages)];
  }

  function renderPagination(pager) {
    const host = $('#ledgerPagination');
    if (!host) return;
    if (!pager.total) {
      host.innerHTML = '';
      return;
    }
    const pages = pageList(pager.page, pager.pageCount);
    host.innerHTML = `
      <button class="page-btn page-step" type="button" data-page="${pager.page - 1}" ${pager.page <= 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevron-left')}</button>
      <div class="page-numbers">
        ${pages.map((page) => page === '…'
          ? '<span class="page-ellipsis">…</span>'
          : `<button class="page-btn ${page === pager.page ? 'active' : ''}" type="button" data-page="${page}" ${page === pager.page ? 'aria-current="page"' : ''} aria-label="Page ${page}">${page}</button>`).join('')}
      </div>
      <button class="page-btn page-step" type="button" data-page="${pager.page + 1}" ${pager.page >= pager.pageCount ? 'disabled' : ''} aria-label="Next page">${icon('chevron-right')}</button>`;
  }

  function syncSortHeaders() {
    $$('#ledgerTable th[data-sort-th]').forEach((th) => {
      const key = th.dataset.sortTh;
      const active = key === state.ledger.sortKey;
      th.classList.toggle('is-sorted', active);
      th.setAttribute('aria-sort', active ? (state.ledger.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      const mark = $('.sort-mark', th);
      if (mark) mark.textContent = active ? (state.ledger.sortDir === 'asc' ? '↑' : '↓') : '';
    });
  }

  function renderLedger() {
    syncLedgerControls();
    syncSortHeaders();
    const rows = ledgerSortedRows();
    const pager = C.paginate(rows, state.ledger.page, state.settings.pageSize);
    state.ledger.page = pager.page;
    const summary = C.summarize(rows);
    const allSummary = C.summarize(state.transactions);
    const balance = accountBalanceNow();
    const opening = openingSigned();

    $('#ledgerCount').textContent = summary.count.toLocaleString('en-IN');
    $('#ledgerDebit').textContent = fmtMoney(summary.debit);
    $('#ledgerCredit').textContent = fmtMoney(summary.credit);
    $('#ledgerNet').textContent = fmtMoney(summary.net);
    $('#ledgerNet').classList.toggle('is-negative', isNegativeMoney(summary.net));
    $('#allTimeOpening').textContent = fmtMoney(opening);
    $('#allTimeDebit').textContent = fmtMoney(allSummary.debit);
    $('#allTimeCredit').textContent = fmtMoney(allSummary.credit);
    $('#allTimeNet').textContent = fmtMoney(allSummary.net);
    $('#allTimeBalance').textContent = fmtMoney(balance);
    $('#allTimeBalance').classList.toggle('is-negative', isNegativeMoney(balance));

    const showing = $('#ledgerShowing');
    if (showing) {
      showing.textContent = rows.length
        ? `Showing ${pager.start}–${pager.end} of ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} · ${periodLongText()}`
        : `No entries · ${periodLongText()}`;
    }

    const body = $('#ledgerTableBody');
    body.innerHTML = pager.rows.map(ledgerTableRow).join('');
    $('#ledgerCards').innerHTML = pager.rows.map(ledgerCard).join('');
    const tableShell = $('.table-shell');
    const cards = $('#ledgerCards');
    const footer = $('#ledgerFooter');
    const empty = $('#ledgerEmpty');
    const hasRows = rows.length > 0;
    tableShell.hidden = !hasRows;
    cards.hidden = !hasRows;
    footer.hidden = !hasRows;
    empty.hidden = hasRows;
    if (!hasRows) {
      const hasData = state.transactions.length > 0;
      $('#ledgerEmptyTitle').textContent = hasData ? 'No entries match these filters' : 'Your ledger is empty';
      $('#ledgerEmptyText').textContent = hasData
        ? 'Try a wider date range, another category, or reset the filters to see the whole journal.'
        : 'Add your first line, or bring in an existing journal.';
      const emptyActions = $('.empty-actions', empty);
      if (emptyActions) {
        emptyActions.innerHTML = hasData
          ? `<button class="btn btn-secondary" type="button" data-action="clear-filters">${icon('refresh')}Reset filters</button><button class="btn btn-primary" type="button" data-action="add">${icon('plus')}Add entry</button>`
          : `<button class="btn btn-primary" type="button" data-action="add">${icon('plus')}Add entry</button><button class="btn btn-secondary" type="button" data-goto="import">Import spreadsheet</button>`;
      }
    }

    $('#footerDebit').textContent = fmtMoney(summary.debit);
    $('#footerCredit').textContent = fmtMoney(summary.credit);
    $('#footerNet').textContent = fmtMoney(summary.net);
    $('#footerNet').classList.toggle('is-negative', isNegativeMoney(summary.net));
    renderPagination(pager);
    const exportButton = $('[data-action="export-filtered"]');
    if (exportButton) exportButton.disabled = !hasRows;
  }

  function resetLedgerFilters() {
    state.period = { preset: 'all', from: null, to: null };
    state.ledger = {
      search: '',
      side: 'all',
      category: 'all',
      sortKey: C.sortConfig(state.settings.defaultSort).key,
      sortDir: C.sortConfig(state.settings.defaultSort).dir,
      page: 1
    };
    savePeriodState();
    syncPeriodControls();
    renderCurrentView();
  }

  /* ---------------------------------------------------------------- reports */

  function rankListMarkup(items, side) {
    if (!items.length) {
      return `<div class="rank-empty"><span>${icon('reports')}</span><p>No ${side} lines in this period.</p></div>`;
    }
    return items.map((item, index) => `
      <div class="rank-row">
        <span class="rank-index">${String(index + 1).padStart(2, '0')}</span>
        <div class="rank-main">
          <div class="rank-line"><strong>${escapeHtml(item.particulars)}</strong><span class="money">${fmtMoney(item.amount)}</span></div>
          <div class="rank-track"><span class="${side === 'credit' ? 'is-credit' : 'is-debit'}" style="width:${Math.max(2, item.share)}%"></span></div>
        </div>
        <small class="rank-meta">${item.count} ${item.count === 1 ? 'line' : 'lines'} · ${item.share}%</small>
      </div>`).join('');
  }

  function categoryReportMarkup(items, side) {
    if (!items.length) {
      return `<div class="rank-empty"><span>${icon('reports')}</span><p>No categorised ${side}s in this period.</p></div>`;
    }
    return items.map((item, index) => `
      <div class="category-report-row">
        <span class="rank-index">${String(index + 1).padStart(2, '0')}</span>
        <div class="category-report-main">
          <div class="rank-line"><strong>${escapeHtml(item.category)}</strong><span class="money">${fmtMoney(item.amount)}</span></div>
          <div class="rank-track"><span class="${side === 'credit' ? 'is-credit' : 'is-debit'}" style="width:${Math.max(2, item.share)}%"></span></div>
        </div>
        <small class="rank-meta">${item.share}%</small>
      </div>`).join('');
  }

  function renderReports() {
    const rows = currentPeriodRows();
    const summary = C.summarize(rows);
    const debitRows = rows.filter((row) => C.moneyMinor(row.debit) > 0n);
    const creditRows = rows.filter((row) => C.moneyMinor(row.credit) > 0n);
    const balance = accountBalanceNow();

    $('#reportDebit').textContent = fmtMoney(summary.debit);
    $('#reportCredit').textContent = fmtMoney(summary.credit);
    $('#reportNet').textContent = fmtMoney(summary.net);
    $('#reportNet').classList.toggle('is-negative', isNegativeMoney(summary.net));
    $('#reportCount').textContent = summary.count.toLocaleString('en-IN');
    $('#reportDebitCaption').textContent = `${debitRows.length} debit ${debitRows.length === 1 ? 'line' : 'lines'}`;
    $('#reportCreditCaption').textContent = `${creditRows.length} credit ${creditRows.length === 1 ? 'line' : 'lines'}`;
    $('#reportNetCaption').textContent = `Balance ${fmtMoney(balance)}`;
    $('#reportRangeCaption').textContent = periodLongText();

    const trend = C.buildTrend(state.transactions, { from: state.period.from, to: state.period.to }, state.settings.dateFormat);
    const chartCaption = $('#reportChartCaption');
    if (chartCaption) {
      const granularityLabel = trend.granularity === 'daily' ? 'Daily' : trend.granularity === 'weekly' ? 'Weekly' : 'Monthly';
      chartCaption.textContent = `${granularityLabel} debits and credits · ${periodLongText()}`;
    }
    renderChart($('#reportChart'), trend, 'No journal movement in this period.');
    renderDonut($('#reportDonut'), $('#reportDonutTotal'), $('#reportSplitLegend'), summary);

    $('#topDebitList').innerHTML = rankListMarkup(C.topParticulars(rows, 'debit', 8), 'debit');
    $('#topCreditList').innerHTML = rankListMarkup(C.topParticulars(rows, 'credit', 8), 'credit');

    const categoryDebit = C.categoryBreakdown(rows, 'debit', 8);
    const categoryCredit = C.categoryBreakdown(rows, 'credit', 8);
    const categoryDebitHost = $('#categoryDebitList');
    const categoryCreditHost = $('#categoryCreditList');
    if (categoryDebitHost) categoryDebitHost.innerHTML = categoryReportMarkup(categoryDebit, 'debit');
    if (categoryCreditHost) categoryCreditHost.innerHTML = categoryReportMarkup(categoryCredit, 'credit');

    const weekdays = C.weekdayBreakdown(rows);
    const maxCount = weekdays.reduce((max, item) => Math.max(max, item.count), 0);
    $('#weekdayChart').innerHTML = weekdays.map((item) => {
      const height = maxCount ? Math.max(4, Math.round((item.count / maxCount) * 100)) : 4;
      return `<div class="weekday-bucket" title="${escapeAttr(`${item.label}: ${item.count} ${item.count === 1 ? 'entry' : 'entries'} · Debit ${fmtMoney(item.debit)} · Credit ${fmtMoney(item.credit)}`)}">
        <div class="weekday-bar"><span style="height:${height}%"></span></div>
        <strong>${item.count}</strong>
        <small>${item.label}</small>
      </div>`;
    }).join('');

    const largest = C.largestEntries(rows, 7);
    const largestHost = $('#largestEntries');
    if (!largest.length) {
      largestHost.innerHTML = `<div class="rank-empty"><span>${icon('ledger')}</span><p>No entries in this period.</p></div>`;
    } else {
      largestHost.innerHTML = largest.map((row) => {
        const side = C.moneyMinor(row.debit) >= C.moneyMinor(row.credit) ? 'debit' : 'credit';
        const amount = side === 'debit' ? row.debit : row.credit;
        return `<div class="largest-row">
          <div><strong>${escapeHtml(row.particulars)}</strong><small>${fmtDate(row.date)} · ${escapeHtml(categoryOf(row))}</small></div>
          <span class="money ${side}">${side === 'debit' ? '−' : '+'}${fmtMoney(amount)}</span>
        </div>`;
      }).join('');
    }

    const topCategory = categoryDebit[0];
    const topDebit = C.topParticulars(rows, 'debit', 1)[0];
    const narrative = summary.count
      ? `${periodLongText()}: ${summary.count} ${summary.count === 1 ? 'entry' : 'entries'} moved ${fmtMoney(C.addMoney(summary.debit, summary.credit))} in total. You debited ${fmtMoney(summary.debit)} and credited ${fmtMoney(summary.credit)}, a net movement of ${fmtMoney(summary.net)}. ${topCategory ? `${topCategory.category} led spending at ${fmtMoney(topCategory.amount)}.` : ''} ${topDebit ? `The largest single debit was ${topDebit.particulars} at ${fmtMoney(topDebit.amount)}.` : ''} Your account balance now stands at ${fmtMoney(balance)}.`
      : `No journal lines fall inside ${periodLongText().toLowerCase()}. Add an entry, widen the period, or import a spreadsheet to build this report.`;
    $('#reportNarrative').textContent = narrative;
  }

  /* ------------------------------------------------------ goals & accounts */

  function currentMonthRange() {
    return C.computePeriodRange('this-month', { today: C.todayISO() });
  }

  function progressPercent(part, total) {
    const value = C.moneyMinor(part);
    const limit = C.moneyMinor(total);
    if (limit <= 0n) return 0;
    return Math.min(100, Math.round(Number((value * 1000n) / limit)) / 10);
  }

  function renderGoals() {
    const balance = accountBalanceNow();
    const current = C.moneyMinor(balance) > 0n ? balance : '0.00';
    const target = state.settings.goalTarget || '0.00';
    const targetMinor = C.moneyMinor(target);
    const hasGoal = targetMinor > 0n;
    const progress = hasGoal ? progressPercent(current, target) : 0;
    const remaining = hasGoal && C.moneyMinor(target) > C.moneyMinor(current)
      ? C.subtractMoney(target, current)
      : '0.00';

    const name = state.settings.goalName || 'Rainy day fund';
    $('#goalHeroName').textContent = name;
    $('#goalCurrent').textContent = fmtMoney(current);
    $('#goalBalance').textContent = fmtMoney(balance);
    $('#goalRemaining').textContent = hasGoal ? fmtMoney(remaining) : '—';
    $('#goalTargetLabel').textContent = hasGoal ? `Target ${fmtMoney(target)}` : 'Target not set';
    $('#goalProgressPercent').textContent = hasGoal ? `${progress}%` : '—';
    const fill = $('#goalProgressFill');
    if (fill) fill.style.width = `${progress}%`;
    const progressHost = $('#goalProgress');
    if (progressHost) progressHost.setAttribute('aria-valuenow', String(progress));

    const status = $('#goalStatus');
    if (status) {
      const complete = hasGoal && C.moneyMinor(current) >= targetMinor;
      status.textContent = !hasGoal ? 'Not set' : complete ? 'Target reached' : 'In progress';
      status.classList.toggle('is-complete', complete);
    }
    const goalNote = $('#goalNote');
    if (goalNote) {
      goalNote.textContent = !hasGoal
        ? 'Set a target and watch this journal become it.'
        : C.moneyMinor(current) >= targetMinor
          ? 'The target is covered by your current journal balance.'
          : `${fmtMoney(remaining)} still to save. Progress follows your journal balance.`;
    }
    const goalButton = $('[data-action="edit-goal"]');
    if (goalButton) goalButton.innerHTML = `${icon('target')}${hasGoal ? 'Adjust goal' : 'Set goal'}`;

    const month = currentMonthRange();
    const monthRows = C.filterTransactions(state.transactions, {
      from: month.from,
      to: month.to,
      dateFormat: state.settings.dateFormat,
      currency: state.settings.currency
    });
    const spent = C.summarize(monthRows).debit;
    const limit = state.settings.monthlyBudget || '0.00';
    const limitMinor = C.moneyMinor(limit);
    const hasBudget = limitMinor > 0n;
    const used = hasBudget ? progressPercent(spent, limit) : 0;
    const budgetRemaining = hasBudget && limitMinor > C.moneyMinor(spent)
      ? C.subtractMoney(limit, spent)
      : '0.00';

    $('#budgetPeriodLabel').textContent = C.formatRangeLabel(month.from, month.to, state.settings.dateFormat);
    $('#budgetSpent').textContent = fmtMoney(spent);
    $('#budgetLimit').textContent = hasBudget ? fmtMoney(limit) : 'Not set';
    $('#budgetRemaining').textContent = hasBudget ? fmtMoney(budgetRemaining) : '—';
    const budgetFill = $('#budgetProgressFill');
    if (budgetFill) budgetFill.style.width = `${used}%`;
    const budgetHost = $('#budgetProgress');
    if (budgetHost) budgetHost.setAttribute('aria-valuenow', String(used));
    const over = hasBudget && C.moneyMinor(spent) > limitMinor;
    if (budgetHost) budgetHost.classList.toggle('is-over', over);
    $('#budgetPercent').textContent = hasBudget ? `${used}%` : '—';
    const ring = $('#budgetRing');
    if (ring) {
      ring.style.background = hasBudget
        ? `conic-gradient(${over ? 'var(--debit)' : 'var(--credit)'} 0 ${used}%, var(--surface-3) ${used}% 100%)`
        : 'conic-gradient(var(--surface-3) 0 100%)';
      ring.classList.toggle('is-over', over);
    }
    $('#budgetNote').textContent = !hasBudget
      ? 'Set a monthly limit to see how this month is tracking.'
      : over
        ? `Over by ${fmtMoney(C.subtractMoney(spent, limit))}. The limit is a guide, not a penalty.`
        : `${fmtMoney(budgetRemaining)} left in this month's limit.`;

    const categories = C.categoryBreakdown(monthRows, 'debit', 6);
    const categoryHost = $('#goalCategoryList');
    if (!categories.length) {
      categoryHost.innerHTML = `<div class="category-empty">
        <span class="category-empty-mark">${icon('chart')}</span>
        <div><strong>No spending this month</strong><p>Debit entries will be grouped here by category.</p></div>
        <button class="btn btn-quiet" type="button" data-action="add">${icon('plus')}Add entry</button>
      </div>`;
    } else {
      categoryHost.innerHTML = categories.map((item) => `
        <div class="category-spend-row">
          <div class="category-spend-main"><strong>${escapeHtml(item.category)}</strong><span class="money">${fmtMoney(item.amount)}</span></div>
          <small>${item.share}%</small>
          <div class="category-spend-track"><span style="width:${Math.max(2, item.share)}%"></span></div>
        </div>`).join('');
    }
  }

  function renderAccounts() {
    const summary = C.summarize(state.transactions);
    const balance = accountBalanceNow();
    const opening = openingSigned();

    $('#accountName').textContent = state.settings.accountName || 'Main journal account';
    $('#accountType').textContent = state.settings.accountType || 'Cash & bank';
    $('#accountBalance').textContent = fmtMoney(balance);
    $('#accountBalance').classList.toggle('is-negative', isNegativeMoney(balance));
    $('#accountOpening').textContent = fmtMoney(opening);
    $('#accountCredits').textContent = fmtMoney(summary.credit);
    $('#accountDebits').textContent = fmtMoney(summary.debit);
    $('#accountEntries').textContent = summary.count.toLocaleString('en-IN');

    const rows = C.sortTransactions(state.transactions, 'date', 'desc').slice(0, 6);
    const host = $('#accountActivity');
    if (!rows.length) {
      host.innerHTML = `<div class="account-empty">
        <span class="account-empty-mark">${icon('wallet')}</span>
        <div><strong>No account activity yet</strong><p>Add a transaction or import your journal to give this account a history.</p></div>
        <div class="account-empty-actions">
          <button class="btn btn-primary" type="button" data-action="add">${icon('plus')}Add transaction</button>
          <button class="btn btn-secondary" type="button" data-goto="import">Import journal</button>
        </div>
      </div>`;
    } else {
      host.innerHTML = rows.map((row) => {
        const parts = C.parseISODateParts(row.date);
        const side = C.moneyMinor(row.debit) > 0n ? 'debit' : 'credit';
        const amount = side === 'debit' ? row.debit : row.credit;
        return `<div class="account-activity-row">
          <span class="account-activity-date">${parts ? `<span>${String(parts.day).padStart(2, '0')} ${C.MONTHS_SHORT[parts.month - 1]}</span>` : '—'}</span>
          <div class="account-activity-main"><strong>${escapeHtml(row.particulars)}</strong><span>${escapeHtml(categoryOf(row))} · ${fmtDate(row.date)}</span></div>
          <div class="account-activity-amount"><strong class="money ${side === 'debit' ? 'debit-ink' : 'credit-ink'}">${side === 'debit' ? '−' : '+'}${fmtMoney(amount)}</strong><small>${side === 'debit' ? 'Debit' : 'Credit'}</small></div>
        </div>`;
      }).join('');
    }
  }

  function openGoalDialog() {
    const titleId = `goal-title-${Date.now()}`;
    const dialog = mountDialog(`
      <section class="modal-card planning-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <header class="entry-head">
          <div><p class="entry-kicker">Goals &amp; budgets</p><h2 id="${titleId}">Set a savings goal</h2></div>
          <button class="icon-btn" type="button" data-dialog-close aria-label="Close">${icon('close')}</button>
        </header>
        <form class="entry-form" novalidate>
          <label class="field"><span>Goal name</span>
            <input type="text" name="goalName" maxlength="60" autocomplete="off" required value="${escapeAttr(state.settings.goalName || 'Rainy day fund')}">
          </label>
          <label class="field"><span>Target amount</span>
            <div class="currency-input"><span data-currency-symbol>${escapeHtml(C.currencySymbol(state.settings.currency))}</span><input type="text" name="goalTarget" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${escapeAttr(state.settings.goalTarget || '0.00')}"></div>
            <small>Use 0 to clear the goal. Progress follows your real journal balance.</small>
          </label>
          <div class="entry-error" role="alert" hidden></div>
          <footer class="entry-actions">
            <button class="btn btn-secondary" type="button" data-dialog-close>Cancel</button>
            <button class="btn btn-primary" type="submit">Save goal</button>
          </footer>
        </form>
      </section>`);
    const form = $('form', dialog.card);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = $('.entry-error', form);
      const parsed = C.parseMoney(form.elements.goalTarget.value);
      if (!parsed.ok) {
        errorBox.textContent = parsed.error || 'Enter a valid target amount.';
        errorBox.hidden = false;
        return;
      }
      const name = form.elements.goalName.value.trim();
      if (!name) {
        errorBox.textContent = 'Give the goal a name.';
        errorBox.hidden = false;
        return;
      }
      const submit = $('button[type="submit"]', form);
      submit.disabled = true;
      submit.textContent = 'Saving…';
      const saved = await saveSettings({ goalName: name, goalTarget: parsed.value }, { message: parsed.minor > 0n ? 'Savings goal saved' : 'Savings goal cleared' });
      if (saved) {
        dialog.close('saved');
        renderGoals();
      } else {
        submit.disabled = false;
        submit.textContent = 'Save goal';
      }
    });
  }

  function openBudgetDialog() {
    const titleId = `budget-title-${Date.now()}`;
    const dialog = mountDialog(`
      <section class="modal-card planning-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <header class="entry-head">
          <div><p class="entry-kicker">Monthly limit</p><h2 id="${titleId}">Set a spending budget</h2></div>
          <button class="icon-btn" type="button" data-dialog-close aria-label="Close">${icon('close')}</button>
        </header>
        <form class="entry-form" novalidate>
          <label class="field"><span>Budget for this month</span>
            <div class="currency-input"><span data-currency-symbol>${escapeHtml(C.currencySymbol(state.settings.currency))}</span><input type="text" name="monthlyBudget" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${escapeAttr(state.settings.monthlyBudget || '0.00')}"></div>
            <small>Use 0 to clear the budget. Calculated from this month's debit entries.</small>
          </label>
          <div class="entry-error" role="alert" hidden></div>
          <footer class="entry-actions">
            <button class="btn btn-secondary" type="button" data-dialog-close>Cancel</button>
            <button class="btn btn-primary" type="submit">Save budget</button>
          </footer>
        </form>
      </section>`);
    const form = $('form', dialog.card);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = $('.entry-error', form);
      const parsed = C.parseMoney(form.elements.monthlyBudget.value);
      if (!parsed.ok) {
        errorBox.textContent = parsed.error || 'Enter a valid budget.';
        errorBox.hidden = false;
        return;
      }
      const submit = $('button[type="submit"]', form);
      submit.disabled = true;
      submit.textContent = 'Saving…';
      const saved = await saveSettings({ monthlyBudget: parsed.value }, { message: parsed.minor > 0n ? 'Monthly budget saved' : 'Monthly budget cleared' });
      if (saved) {
        dialog.close('saved');
        renderGoals();
      } else {
        submit.disabled = false;
        submit.textContent = 'Save budget';
      }
    });
  }

  function openAccountDialog() {
    const titleId = `account-title-${Date.now()}`;
    const dialog = mountDialog(`
      <section class="modal-card planning-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <header class="entry-head">
          <div><p class="entry-kicker">Tracked account</p><h2 id="${titleId}">Edit account</h2></div>
          <button class="icon-btn" type="button" data-dialog-close aria-label="Close">${icon('close')}</button>
        </header>
        <form class="entry-form" novalidate>
          <label class="field"><span>Account name</span>
            <input type="text" name="accountName" maxlength="60" autocomplete="off" required value="${escapeAttr(state.settings.accountName || 'Main journal account')}">
          </label>
          <label class="field"><span>Account type</span>
            <select name="accountType">${['Cash & bank', 'Cash', 'Bank', 'Savings', 'Card', 'Other'].map((type) => `<option value="${escapeAttr(type)}" ${state.settings.accountType === type ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}</select>
          </label>
          <p class="entry-hint">Moneta tracks this one account. Opening balance is edited in Settings.</p>
          <div class="entry-error" role="alert" hidden></div>
          <footer class="entry-actions">
            <button class="btn btn-secondary" type="button" data-dialog-close>Cancel</button>
            <button class="btn btn-primary" type="submit">Save account</button>
          </footer>
        </form>
      </section>`);
    if (window.AppleControls) window.AppleControls.refresh(dialog.card);
    const form = $('form', dialog.card);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = $('.entry-error', form);
      const name = form.elements.accountName.value.trim();
      if (!name) {
        errorBox.textContent = 'Give the account a name.';
        errorBox.hidden = false;
        return;
      }
      const submit = $('button[type="submit"]', form);
      submit.disabled = true;
      submit.textContent = 'Saving…';
      const saved = await saveSettings({ accountName: name, accountType: form.elements.accountType.value }, { message: 'Account updated' });
      if (saved) {
        dialog.close('saved');
        renderAccounts();
      } else {
        submit.disabled = false;
        submit.textContent = 'Save account';
      }
    });
  }

  /* ------------------------------------------------------- entry dialog */

  const DATE_PLACEHOLDER = 'yyyy-mm-dd';

  function openEntryDialog(row, mode) {
    const isEdit = mode === 'edit' && row;
    const isDuplicate = mode === 'duplicate' && row;
    const title = isEdit ? 'Edit entry' : isDuplicate ? 'Duplicate entry' : 'New entry';
    const titleId = `entry-title-${Date.now()}`;
    const value = row || {};
    const categories = categoryList();
    const selectedCategory = value.category
      ? C.resolveCategory(value.category, value.particulars, categories)
      : C.inferCategory(value.particulars, categories);
    const categoryOptions = categories.map((category) => `<option value="${escapeAttr(category.name)}"${category.name === selectedCategory ? ' selected' : ''}>${escapeHtml(category.name)}</option>`).join('');
    const dialog = mountDialog(`
      <section class="modal-card entry-card" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <header class="entry-head">
          <div>
            <p class="entry-kicker">Date · Particulars · Debit · Credit</p>
            <h2 id="${titleId}">${title}</h2>
          </div>
          <button class="icon-btn" type="button" data-dialog-close aria-label="Close">${icon('close')}</button>
        </header>
        <form class="entry-form" novalidate>
          <div class="entry-grid">
            <label class="field entry-date"><span>Date</span>
              <input type="date" name="date" min="1900-01-01" max="2100-12-31" required value="${escapeAttr(value.date || C.todayISO())}">
            </label>
            <label class="field entry-particulars"><span>Particulars</span>
              <input type="text" name="particulars" maxlength="240" autocomplete="off" placeholder="What was this for?" required value="${escapeAttr(value.particulars || '')}">
            </label>
            <label class="field entry-category"><span>Category</span>
              <select name="category" required>${categoryOptions}</select>
            </label>
          </div>
          <div class="entry-amounts">
            <label class="field amount-field amount-debit-field">
              <span>Debit <em>money out</em></span>
              <div class="currency-input"><span data-currency-symbol>${escapeHtml(C.currencySymbol(state.settings.currency))}</span><input type="text" name="debit" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${escapeAttr(isDuplicate || isEdit ? value.debit : '')}"></div>
            </label>
            <label class="field amount-field amount-credit-field">
              <span>Credit <em>money in</em></span>
              <div class="currency-input"><span data-currency-symbol>${escapeHtml(C.currencySymbol(state.settings.currency))}</span><input type="text" name="credit" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${escapeAttr(isDuplicate || isEdit ? value.credit : '')}"></div>
            </label>
          </div>
          <p class="entry-hint">Record one side of the entry. Leave the other empty — a line cannot be both a debit and a credit.</p>
          <div class="entry-error" role="alert" hidden></div>
          <footer class="entry-actions">
            <button class="btn btn-secondary" type="button" data-dialog-close>Cancel</button>
            <button class="btn btn-primary" type="submit">${isEdit ? 'Save changes' : 'Add entry'}</button>
          </footer>
        </form>
      </section>`);

    const form = $('.entry-form', dialog.card);
    const errorBox = $('.entry-error', form);
    const particularsInput = form.elements.particulars;
    const categorySelect = form.elements.category;
    const debitInput = form.elements.debit;
    const creditInput = form.elements.credit;
    const submitButton = $('button[type="submit"]', form);
    let categoryTouched = Boolean(value.category);

    function showError(message) {
      errorBox.textContent = message;
      errorBox.hidden = false;
      errorBox.classList.remove('is-shaking');
      void errorBox.offsetWidth;
      errorBox.classList.add('is-shaking');
    }

    function clearError() {
      errorBox.hidden = true;
      errorBox.textContent = '';
    }

    categorySelect.addEventListener('change', () => {
      categoryTouched = true;
    });

    particularsInput.addEventListener('blur', () => {
      if (categoryTouched) return;
      const inferred = C.inferCategory(particularsInput.value, state.settings.categories);
      if (inferred && inferred !== categorySelect.value) {
        categorySelect.value = inferred;
        categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
        categoryTouched = false;
      }
    });

    [debitInput, creditInput].forEach((input) => {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/[^\d.,\s]/g, '');
        clearError();
      });
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearError();
      const payload = {
        id: isEdit ? value.id : C.newId('tx'),
        date: form.elements.date.value,
        particulars: particularsInput.value,
        category: categorySelect.value,
        debit: debitInput.value,
        credit: creditInput.value,
        createdAt: isEdit ? value.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: isEdit ? value.source || 'manual' : 'manual'
      };
      if (isEdit && value.importBatchId) payload.importBatchId = value.importBatchId;
      if (isEdit && value.sourceFileName) payload.sourceFileName = value.sourceFileName;
      const result = C.normalizeTransaction(payload, { requireId: true, source: 'manual', categories: state.settings.categories });
      if (!result.ok) {
        const first = Object.values(result.errors)[0] || 'Check the entry and try again.';
        showError(first);
        return;
      }
      submitButton.disabled = true;
      try {
        await DB.saveTransaction(result.value);
        const index = state.transactions.findIndex((item) => item.id === result.value.id);
        if (index >= 0) state.transactions.splice(index, 1, result.value);
        else state.transactions.push(result.value);
        state.transactions.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
        state.ledger.page = 1;
        dialog.close('saved');
        renderCurrentView();
        showToast(isEdit ? 'Entry updated' : isDuplicate ? 'Entry duplicated' : 'Entry added');
      } catch (error) {
        submitButton.disabled = false;
        showError('The entry could not be saved on this device.');
      }
    });

    window.setTimeout(() => {
      if (isEdit || isDuplicate) submitButton.focus({ preventScroll: true });
      else particularsInput.focus({ preventScroll: true });
    }, 80);
  }

  async function deleteEntry(row) {
    const confirmed = await confirmAction({
      title: 'Delete this entry?',
      message: `${row.particulars} · ${fmtDate(row.date)}`,
      detailHtml: `<div class="confirm-amount">${C.moneyMinor(row.debit) > 0n ? `−${fmtMoney(row.debit)} debit` : `+${fmtMoney(row.credit)} credit`}</div>`,
      confirmLabel: 'Delete entry',
      danger: true
    });
    if (!confirmed) return;
    try {
      await DB.deleteTransaction(row.id);
      state.transactions = state.transactions.filter((item) => item.id !== row.id);
      renderCurrentView();
      showToast('Entry deleted');
    } catch (error) {
      showToast('Could not delete that entry', 'error');
    }
  }

  /* ----------------------------------------------------------------- import */

  const IMPORT_PREVIEW_LIMIT = 120;
  const IMPORT_MAX_BYTES = 15 * 1024 * 1024;

  function currentImportSheet() {
    const session = state.importSession;
    if (!session || !session.sheets.length) return null;
    return session.sheets[session.sheetIndex] || session.sheets[0];
  }

  function spreadsheetColumnCount(rows) {
    let width = 0;
    for (const row of rows || []) {
      if (Array.isArray(row) && row.length > width) width = row.length;
    }
    return Math.min(Math.max(width, 1), 60);
  }

  function importHeaderName(session, sheet, index) {
    const letter = columnLetter(index);
    if (!session || session.headerRow < 0) return `Column ${letter}`;
    const headerRow = sheet.rows[session.headerRow] || [];
    const label = C.normalizeText(headerRow[index]);
    return label ? `${letter} · ${label}` : `Column ${letter}`;
  }

  function guessHeaderlessMapping(sheet, dateMode) {
    const rows = (sheet.rows || []).slice(0, 60).filter((row) => Array.isArray(row) && row.some((cell) => C.normalizeText(cell)));
    const width = spreadsheetColumnCount(rows);
    const mapping = { date: null, particulars: null, debit: null, credit: null, category: null };
    if (!rows.length) return mapping;
    const columns = [];
    for (let index = 0; index < width; index += 1) {
      let dates = 0;
      let amounts = 0;
      let text = 0;
      let totalLength = 0;
      let filled = 0;
      for (const row of rows) {
        const cell = row[index];
        const value = C.normalizeText(cell);
        if (!value) continue;
        filled += 1;
        totalLength += value.length;
        if (C.parseImportDate(cell, dateMode).ok) dates += 1;
        if (C.parseImportAmount(cell).ok) amounts += 1;
        else text += 1;
      }
      columns.push({
        index,
        filled,
        dates,
        amounts,
        text,
        averageLength: filled ? totalLength / filled : 0
      });
    }
    const dateColumn = columns
      .filter((column) => column.dates >= Math.max(1, Math.ceil(column.filled * 0.5)))
      .sort((a, b) => b.dates - a.dates)[0];
    mapping.date = dateColumn ? dateColumn.index : 0;

    const amountColumns = columns
      .filter((column) => column.index !== mapping.date && column.filled > 0 && column.amounts >= Math.ceil(column.filled * 0.7))
      .map((column) => column.index);
    const textColumn = columns
      .filter((column) => column.index !== mapping.date && !amountColumns.includes(column.index) && column.text > 0)
      .sort((a, b) => b.averageLength - a.averageLength || a.index - b.index)[0];
    mapping.particulars = textColumn ? textColumn.index : Math.min(1, width - 1);
    if (amountColumns.length >= 2) {
      mapping.debit = amountColumns[0];
      mapping.credit = amountColumns[1];
    } else if (amountColumns.length === 1) {
      mapping.debit = amountColumns[0];
    } else {
      const after = columns.filter((column) => column.index > mapping.particulars).map((column) => column.index);
      mapping.debit = after[0] !== undefined ? after[0] : null;
      mapping.credit = after[1] !== undefined ? after[1] : null;
    }
    return mapping;
  }

  function refreshImportHeaderSelect() {
    const session = state.importSession;
    const sheet = currentImportSheet();
    const select = $('#importHeaderRow');
    if (!session || !sheet || !select) return;
    const limit = Math.min(sheet.rows.length, 40);
    const options = ['<option value="-1">No header row</option>'];
    for (let index = 0; index < limit; index += 1) {
      const row = sheet.rows[index] || [];
      const preview = row
        .filter((cell) => C.normalizeText(cell))
        .slice(0, 3)
        .map((cell) => C.normalizeText(cell))
        .join(' · ')
        .slice(0, 64);
      options.push(`<option value="${index}">Row ${index + 1}${preview ? ` — ${escapeHtml(preview)}` : ' — empty'}</option>`);
    }
    select.innerHTML = options.join('');
    select.value = String(session.headerRow);
  }

  function refreshImportMappingSelects() {
    const session = state.importSession;
    const sheet = currentImportSheet();
    if (!session || !sheet) return;
    const width = spreadsheetColumnCount(sheet.rows);
    const options = ['<option value="">Not mapped</option>'];
    for (let index = 0; index < width; index += 1) {
      options.push(`<option value="${index}">${escapeHtml(importHeaderName(session, sheet, index))}</option>`);
    }
    const markup = options.join('');
    $$('#importWorkspace [data-map]').forEach((select) => {
      select.innerHTML = markup;
      const field = select.dataset.map;
      const value = session.mapping[field];
      select.value = value === null || value === undefined ? '' : String(value);
    });
    const sheetMeta = $('#importSheetMeta');
    if (sheetMeta) {
      sheetMeta.textContent = `${sheet.name} · ${Math.max(0, sheet.rows.length - (session.headerRow + 1))} data rows · ${width} columns`;
    }
  }

  function refreshImportSheetSelect() {
    const session = state.importSession;
    const select = $('#importSheet');
    if (!session || !select) return;
    select.innerHTML = session.sheets
      .map((sheet, index) => `<option value="${index}">${escapeHtml(sheet.name)}</option>`)
      .join('');
    select.value = String(session.sheetIndex);
  }

  function readCsvRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"') {
          if (text[index + 1] === '"') {
            cell += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          cell += character;
        }
      } else if (character === '"') {
        quoted = true;
      } else if (character === ',') {
        row.push(cell);
        cell = '';
      } else if (character === '\n' || character === '\r') {
        if (character === '\r' && text[index + 1] === '\n') index += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += character;
      }
    }
    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }
    while (rows.length && rows[rows.length - 1].every((value) => !String(value).trim())) rows.pop();
    return rows;
  }

  async function readSpreadsheet(file) {
    const name = file.name || 'Spreadsheet';
    if (file.size > IMPORT_MAX_BYTES) {
      throw new Error('That file is larger than 15 MB. Split it into smaller statements.');
    }
    if (window.XLSX) {
      const buffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(buffer, { type: 'array', cellDates: true, raw: true });
      const sheets = workbook.SheetNames.map((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const rows = window.XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          raw: true,
          defval: '',
          blankrows: true
        });
        while (rows.length && (!Array.isArray(rows[rows.length - 1]) || rows[rows.length - 1].every((cell) => !C.normalizeText(cell)))) {
          rows.pop();
        }
        return { name: sheetName, rows };
      }).filter((sheet) => sheet.rows.length);
      if (!sheets.length) throw new Error('No readable rows were found in that workbook.');
      return sheets;
    }
    if (/\.csv$/i.test(name)) {
      const text = await file.text();
      const rows = readCsvRows(text);
      if (!rows.length) throw new Error('No readable rows were found in that CSV.');
      return [{ name: name.replace(/\.csv$/i, ''), rows }];
    }
    throw new Error('The Excel reader did not load. Reload the app, or import the file as CSV.');
  }

  async function startImportFile(file) {
    if (!file) return;
    const fileLabel = $('#importFileLabel');
    if (fileLabel) {
      fileLabel.hidden = false;
      fileLabel.textContent = `Reading ${file.name}…`;
    }
    try {
      const sheets = await readSpreadsheet(file);
      const first = sheets[0];
      const headerRow = C.detectHeaderRow(first.rows);
      const mapping = headerRow >= 0
        ? C.suggestMapping(first.rows[headerRow] || [])
        : guessHeaderlessMapping(first, 'dmy');
      state.importSession = {
        fileName: file.name || 'Spreadsheet',
        fileSize: file.size || 0,
        sheets,
        sheetIndex: 0,
        headerRow,
        mapping,
        dateMode: 'dmy',
        duplicateMode: 'skip',
        matchBalance: state.transactions.length === 0,
        analysis: null
      };
      renderImportUI();
      const workspace = $('#importWorkspace');
      if (workspace && typeof workspace.scrollIntoView === 'function') {
        workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      showToast(`${sheets.length} ${sheets.length === 1 ? 'worksheet' : 'worksheets'} read`);
    } catch (error) {
      showAlert({
        title: 'That file could not be read',
        message: error && error.message ? error.message : 'Choose an Excel or CSV spreadsheet and try again.',
        danger: true
      });
      if (fileLabel) fileLabel.hidden = true;
    } finally {
      const input = $('#importFile');
      if (input) input.value = '';
    }
  }

  function analyzeImportSession() {
    const session = state.importSession;
    const sheet = currentImportSheet();
    if (!session || !sheet) return null;
    const analysis = C.analyzeImportRows({
      rows: sheet.rows,
      headerRow: session.headerRow,
      mapping: session.mapping,
      dateMode: session.dateMode,
      duplicateMode: session.duplicateMode,
      categories: state.settings.categories,
      existingKeys: C.transactionKeyCounts(state.transactions)
    });
    session.analysis = analysis;
    return analysis;
  }

  function importReviewLabel(row) {
    if (row.errors.length) return row.errors[0];
    if (row.duplicate) return 'Already in journal';
    return 'Ready';
  }

  function importStatusClass(row) {
    if (row.errors.length) return 'is-error';
    if (row.duplicate) return 'is-duplicate';
    return 'is-ready';
  }

  function renderImportPreview(analysis) {
    const body = $('#importPreviewRows');
    const cards = $('#importPreviewCards');
    const caption = $('#importPreviewCaption');
    const limitNote = $('#importPreviewLimit');
    if (!body || !cards || !caption) return;
    if (!analysis || !analysis.rows.length) {
      body.innerHTML = `<tr><td colspan="6" class="preview-empty">No data rows found below the chosen header row.</td></tr>`;
      cards.innerHTML = `<div class="preview-empty">No data rows found below the chosen header row.</div>`;
      caption.textContent = 'Nothing to preview.';
      if (limitNote) limitNote.hidden = true;
      return;
    }
    const visible = analysis.rows.slice(0, IMPORT_PREVIEW_LIMIT);
    body.innerHTML = visible.map((row) => `
      <tr class="${importStatusClass(row)}">
        <td class="preview-row-number">${row.rowNumber}</td>
        <td>${row.date ? fmtDate(row.date) : '<span class="preview-missing">—</span>'}</td>
        <td><div class="preview-particulars"><strong>${escapeHtml(row.particulars || 'Missing particulars')}</strong>${row.category ? `<span class="category-chip">${escapeHtml(row.category)}</span>` : ''}</div></td>
        <td class="align-right">${C.moneyMinor(row.debit) > 0n ? `<span class="money amount-debit">${fmtAmount(row.debit)}</span>` : '<span class="preview-missing">—</span>'}</td>
        <td class="align-right">${C.moneyMinor(row.credit) > 0n ? `<span class="money amount-credit">${fmtAmount(row.credit)}</span>` : '<span class="preview-missing">—</span>'}</td>
        <td><span class="review-chip ${importStatusClass(row)}" title="${escapeAttr(row.errors.join('; '))}">${escapeHtml(importReviewLabel(row))}</span></td>
      </tr>`).join('');
    cards.innerHTML = visible.map((row) => `
      <article class="preview-card ${importStatusClass(row)}">
        <div class="preview-card-top"><span>Row ${row.rowNumber}</span><span class="review-chip ${importStatusClass(row)}">${escapeHtml(importReviewLabel(row))}</span></div>
        <h3>${escapeHtml(row.particulars || 'Missing particulars')}</h3>
        <p>${row.date ? fmtDate(row.date) : 'No date'}${row.category ? ` · ${escapeHtml(row.category)}` : ''}</p>
        <div class="preview-card-amounts">
          <span>Debit <strong class="money amount-debit">${C.moneyMinor(row.debit) > 0n ? fmtMoney(row.debit) : '—'}</strong></span>
          <span>Credit <strong class="money amount-credit">${C.moneyMinor(row.credit) > 0n ? fmtMoney(row.credit) : '—'}</strong></span>
        </div>
      </article>`).join('');
    caption.textContent = `${analysis.summary.accepted} of ${analysis.summary.total} rows will be imported.`;
    if (limitNote) {
      limitNote.hidden = visible.length >= analysis.rows.length;
      limitNote.textContent = `Showing the first ${visible.length} of ${analysis.rows.length} rows. Every row is still checked and imported.`;
    }
  }

  function renderImportSummary(analysis) {
    const host = $('#importSummary');
    if (!host) return;
    if (!analysis) {
      host.innerHTML = '';
      return;
    }
    const summary = analysis.summary;
    const stats = [
      { label: 'Ready to import', value: summary.accepted, tone: 'is-ready' },
      { label: 'Needs review', value: summary.invalid, tone: summary.invalid ? 'is-error' : '' },
      { label: 'Already in journal', value: summary.duplicates, tone: summary.duplicates ? 'is-duplicate' : '' }
    ];
    host.innerHTML = `
      <div class="import-summary-stats">
        ${stats.map((stat) => `<div class="import-stat ${stat.tone}"><span>${escapeHtml(stat.label)}</span><strong class="money">${stat.value.toLocaleString('en-IN')}</strong></div>`).join('')}
      </div>
      <div class="import-summary-totals">
        <span>Incoming debits <strong class="money amount-debit">${fmtMoney(summary.debit)}</strong></span>
        <span>Incoming credits <strong class="money amount-credit">${fmtMoney(summary.credit)}</strong></span>
        <span>Net <strong class="money">${fmtMoney(C.subtractMoney(summary.credit, summary.debit))}</strong></span>
      </div>
      ${summary.duplicates && state.importSession.duplicateMode === 'skip' ? '<p class="import-summary-note">Those lines already exist in your journal and will be skipped. Identical lines inside this file are kept as separate transactions.</p>' : ''}
      ${summary.invalid ? '<p class="import-summary-note is-warning">Rows that need review are left out. Download the error report to see exactly what to correct.</p>' : ''}`;

    const note = $('#importValidationNote');
    if (note) {
      const skipped = summary.total - summary.accepted;
      note.textContent = summary.accepted
        ? `${summary.accepted} ${summary.accepted === 1 ? 'entry is' : 'entries are'} ready.${skipped ? ` ${skipped} ${skipped === 1 ? 'row is' : 'rows are'} excluded.` : ''} Nothing is saved until you confirm.`
        : 'No rows are ready to import. Check the header row, column mapping, date order and amounts.';
    }
    const confirmButton = $('#confirmImport');
    if (confirmButton) {
      confirmButton.disabled = summary.accepted === 0;
      confirmButton.textContent = summary.accepted
        ? `Import ${summary.accepted.toLocaleString('en-IN')} ${summary.accepted === 1 ? 'entry' : 'entries'}`
        : 'Import valid rows';
    }
    const errorsButton = $('#downloadImportErrors');
    if (errorsButton) errorsButton.hidden = !summary.invalid && !summary.duplicates;
  }

  function signedSheetBalance(rec) {
    const amount = C.moneyMinor(rec && rec.sheetBalance);
    return {
      minor: rec && rec.sheetBalanceSide === 'debit' ? -amount : amount,
      text: rec && rec.sheetBalanceSide === 'debit'
        ? `−${fmtMoney(C.canonicalFromMinor(amount))}`
        : fmtMoney(C.canonicalFromMinor(amount))
    };
  }

  function importMatchOpening(analysis) {
    const rec = analysis && analysis.reconciliation;
    if (!rec || rec.sheetBalance === null || rec.sheetBalance === undefined) return null;
    const target = C.moneyMinor(rec.sheetBalance) * (rec.sheetBalanceSide === 'debit' ? -1n : 1n);
    const opening = target
      - C.moneyMinor(C.accountMovement(state.transactions))
      - C.moneyMinor(C.accountMovement(analysis.acceptedRows));
    return {
      openingBalance: C.canonicalFromMinor(opening < 0n ? -opening : opening),
      openingBalanceSide: opening < 0n ? 'debit' : 'credit'
    };
  }

  function renderImportReconciliation(analysis) {
    const panel = $('#importReconciliation');
    if (!panel) return;
    const session = state.importSession;
    const rec = analysis && analysis.reconciliation;
    if (!session || !rec || rec.sheetBalance === null || rec.sheetBalance === undefined) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;

    const sheet = signedSheetBalance(rec);
    const match = Boolean(session.matchBalance);
    const totalsMatch = rec.sheetDebit !== null || rec.sheetCredit !== null
      ? C.compareMoney(rec.sheetDebit || '0.00', rec.movementDebit) === 0
        && C.compareMoney(rec.sheetCredit || '0.00', rec.movementCredit) === 0
      : false;
    const movement = C.accountMovement(analysis.acceptedRows);
    const projectedMinor = match
      ? sheet.minor
      : C.moneyMinor(accountBalanceNow()) + C.moneyMinor(movement);
    const opening = importMatchOpening(analysis);

    const balanceHost = $('#importSheetBalance');
    if (balanceHost) {
      balanceHost.textContent = sheet.text;
      balanceHost.classList.toggle('is-negative', sheet.minor < 0n);
    }
    const projectedHost = $('#importProjectedBalance');
    if (projectedHost) {
      projectedHost.textContent = projectedMinor < 0n
        ? `−${fmtMoney(C.canonicalFromMinor(-projectedMinor))}`
        : fmtMoney(C.canonicalFromMinor(projectedMinor));
      projectedHost.classList.toggle('is-negative', projectedMinor < 0n);
    }
    const mark = $('#importReconcileMark');
    if (mark) {
      mark.classList.toggle('is-balanced', totalsMatch);
      mark.classList.toggle('is-off', !match);
    }
    const text = $('#importReconcileText');
    if (text) {
      if (match) {
        const openingText = opening
          ? (opening.openingBalanceSide === 'debit'
            ? `−${fmtMoney(opening.openingBalance)}`
            : fmtMoney(opening.openingBalance))
          : fmtMoney('0.00');
        text.textContent = totalsMatch
          ? `The sheet’s debit and credit totals agree with these rows. Moneta will set the opening balance to ${openingText} so the account lands exactly on this balance.`
          : `The sheet’s totals and its balance agree. Moneta will set the opening balance to ${openingText} so the account lands exactly on this balance.`;
      } else {
        text.textContent = 'Match balance is off. The opening balance in Settings is left unchanged, so the account balance may not equal the sheet.';
      }
    }
    const toggle = $('#importMatchBalance');
    if (toggle) toggle.checked = match;
    const switchRow = $('#importMatchRow');
    if (switchRow) switchRow.classList.toggle('is-on', match);
    const projection = $('#importReconcileProjection');
    if (projection) projection.classList.toggle('is-matching', match);
  }

  function renderImportHistory() {
    const panel = $('#importHistory');
    const host = $('#importHistoryRows');
    if (!panel || !host) return;
    const imports = state.imports || [];
    panel.hidden = !imports.length;
    if (!imports.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = imports.slice(0, 6).map((item) => `
      <div class="import-history-row">
        <span class="history-mark">${icon('file')}</span>
        <div class="history-main"><strong>${escapeHtml(item.fileName || 'Spreadsheet')}</strong><small>${escapeHtml(formatImportedAt(item.at))}</small></div>
        <span class="history-count"><strong class="money">${Number(item.imported) || 0}</strong><small>imported</small></span>
        ${Number(item.skipped) ? `<span class="history-count muted"><strong class="money">${Number(item.skipped)}</strong><small>skipped</small></span>` : ''}
      </div>`).join('');
  }

  function formatImportedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Recently';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      + ' · '
      + date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }

  function syncImportControls() {
    const session = state.importSession;
    if (!session) return;
    refreshImportSheetSelect();
    refreshImportHeaderSelect();
    refreshImportMappingSelects();
    const matchBalance = $('#importMatchBalance');
    if (matchBalance) {
      matchBalance.addEventListener('change', () => {
        if (!state.importSession) return;
        state.importSession.matchBalance = matchBalance.checked;
        renderImportUI();
      });
    }
    const dateFormat = $('#importDateFormat');
    if (dateFormat) dateFormat.value = session.dateMode;
    const duplicates = $('#importDuplicates');
    if (duplicates) duplicates.value = session.duplicateMode;
    const fileName = $('#importFileName');
    if (fileName) fileName.textContent = session.fileName;
    const fileMeta = $('#importFileMeta');
    if (fileMeta) {
      const size = session.fileSize ? `${Math.max(1, Math.round(session.fileSize / 1024))} KB` : 'Spreadsheet';
      fileMeta.textContent = `${size} · read on this device`;
    }
  }

  function renderImportUI() {
    const session = state.importSession;
    const workspace = $('#importWorkspace');
    const fileLabel = $('#importFileLabel');
    if (fileLabel) {
      fileLabel.hidden = !session;
      if (!session) fileLabel.textContent = '';
    }
    if (!workspace) return;
    workspace.hidden = !session;
    if (!session) {
      renderImportHistory();
      return;
    }
    syncImportControls();
    const analysis = analyzeImportSession();
    renderImportSummary(analysis);
    renderImportReconciliation(analysis);
    renderImportPreview(analysis);
    renderImportHistory();
  }

  function resetImportSession() {
    state.importSession = null;
    const input = $('#importFile');
    if (input) input.value = '';
    renderImportUI();
  }

  async function commitImport() {
    const session = state.importSession;
    const analysis = session && analyzeImportSession();
    if (!session || !analysis || !analysis.acceptedRows.length) return;
    const button = $('#confirmImport');
    if (button) {
      button.disabled = true;
      button.textContent = 'Importing…';
    }
    const batchId = C.newId('import');
    const now = new Date().toISOString();
    const records = analysis.acceptedRows.map((row) => ({
      id: C.newId('tx'),
      date: row.date,
      particulars: row.particulars,
      category: C.resolveCategory(row.category, row.particulars, state.settings.categories),
      debit: row.debit,
      credit: row.credit,
      createdAt: now,
      updatedAt: now,
      source: 'import',
      importBatchId: batchId,
      sourceRowNumber: row.rowNumber,
      sourceFileName: session.fileName.slice(0, 200)
    }));
    try {
      const matchedOpening = session.matchBalance ? importMatchOpening(analysis) : null;
      if (matchedOpening) {
        const result = C.normalizeSettings({ ...state.settings, ...matchedOpening });
        if (!result.ok) throw new Error(result.errors[0] || 'Opening balance is not valid');
        state.settings = result.settings;
        await DB.saveSettings(state.settings);
      }
      await DB.saveTransactions(records);
      await DB.addImport({
        id: batchId,
        fileName: session.fileName,
        at: now,
        imported: records.length,
        skipped: Math.max(0, analysis.summary.total - records.length),
        total: analysis.summary.total,
        invalid: analysis.summary.invalid,
        duplicates: analysis.summary.duplicates
      });
      state.transactions = await DB.getAllTransactions();
      state.imports = await DB.getImports();
      state.importSession = null;
      state.period = { preset: 'all', from: null, to: null };
      state.ledger.page = 1;
      savePeriodState();
      const input = $('#importFile');
      if (input) input.value = '';
      renderImportUI();
      navigate('ledger');
      showToast(`${records.length.toLocaleString('en-IN')} ${records.length === 1 ? 'entry' : 'entries'} imported`);
    } catch (error) {
      if (button) {
        button.disabled = false;
        button.textContent = `Import ${analysis.summary.accepted} entries`;
      }
      showAlert({ title: 'The import did not finish', message: 'Nothing was saved. Check that this device has free storage and try again.', danger: true });
    }
  }

  function downloadImportErrors() {
    const session = state.importSession;
    const analysis = session && (session.analysis || analyzeImportSession());
    if (!session || !analysis) return;
    const flagged = analysis.rows.filter((row) => row.errors.length || row.duplicate);
    if (!flagged.length) {
      showToast('There are no flagged rows to report');
      return;
    }
    const matrix = [
      ['Row', 'Date', 'Particulars', 'Category', 'Debit', 'Credit', 'Status'],
      ...flagged.map((row) => [
        row.rowNumber,
        row.date,
        row.particulars,
        row.category,
        row.debit,
        row.credit,
        row.errors.length ? row.errors.join('; ') : 'Already in journal'
      ])
    ];
    downloadText(`${fileStem(session.fileName)}-import-review.csv`, '\ufeff' + C.matrixToCSV(matrix), 'text/csv;charset=utf-8');
  }

  function fileStem(name) {
    return String(name || 'moneta')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'moneta';
  }

  function downloadImportTemplate() {
    const matrix = [
      ['Date', 'Particulars', 'Debit', 'Credit', 'Category'],
      [C.todayISO(), 'Sample — chai and snacks', '120.00', '', 'Food & Dining'],
      [C.todayISO(), 'Sample — salary credit', '', '50000.00', 'Salary']
    ];
    if (window.XLSX) {
      const sheet = window.XLSX.utils.aoa_to_sheet(matrix);
      sheet['!cols'] = [{ wch: 13 }, { wch: 38 }, { wch: 14 }, { wch: 14 }, { wch: 20 }];
      const book = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(book, sheet, 'Journal');
      window.XLSX.writeFile(book, 'moneta-import-template.xlsx');
    } else {
      downloadText('moneta-import-template.csv', '\ufeff' + C.matrixToCSV(matrix), 'text/csv;charset=utf-8');
    }
    showToast('Template downloaded');
  }

  /* --------------------------------------------------------------- exports */

  function exportRows(filtered) {
    const source = filtered ? ledgerBaseRows() : state.transactions;
    return C.sortTransactions(source, 'date', 'asc');
  }

  function exportXlsx(rows, fileName) {
    if (!window.XLSX) {
      showToast('Excel export did not load — downloading CSV instead', 'error');
      exportCsv(rows, fileName.replace(/\.xlsx$/, '.csv'));
      return;
    }
    const matrix = [['Date', 'Particulars', 'Debit', 'Credit']];
    for (const row of rows) {
      const debit = C.moneyMinor(row.debit);
      const credit = C.moneyMinor(row.credit);
      matrix.push([
        row.date,
        row.particulars,
        debit > 0n ? Number(C.parseMoney(row.debit).value) : null,
        credit > 0n ? Number(C.parseMoney(row.credit).value) : null
      ]);
    }
    const sheet = window.XLSX.utils.aoa_to_sheet(matrix);
    const range = window.XLSX.utils.decode_range(sheet['!ref']);
    for (let rowIndex = 1; rowIndex <= range.e.r; rowIndex += 1) {
      for (const columnIndex of [2, 3]) {
        const address = window.XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
        if (sheet[address] && typeof sheet[address].v === 'number') sheet[address].z = '0.00';
      }
    }
    sheet['!cols'] = [{ wch: 12 }, { wch: 48 }, { wch: 15 }, { wch: 15 }];
    sheet['!autofilter'] = { ref: sheet['!ref'] };
    const book = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(book, sheet, 'Journal');
    window.XLSX.writeFile(book, fileName);
  }

  function exportCsv(rows, fileName) {
    const csv = C.journalCSV(rows, { dateFormat: state.settings.dateFormat, isoDate: true });
    downloadText(fileName, '\ufeff' + csv, 'text/csv;charset=utf-8');
  }

  function exportJournal(format, filtered) {
    const rows = exportRows(filtered);
    if (!rows.length) {
      showToast('There are no entries to export', 'error');
      return;
    }
    const stem = filtered ? 'moneta-filtered' : 'moneta-journal';
    const fileName = `${stem}-${todayStamp()}.${format === 'xlsx' ? 'xlsx' : 'csv'}`;
    if (format === 'xlsx') exportXlsx(rows, fileName);
    else exportCsv(rows, fileName);
    showToast(`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} exported`);
  }

  function exportReport() {
    const csv = C.buildReportCsv(state.transactions, { from: state.period.from, to: state.period.to }, state.settings.dateFormat);
    downloadText(`moneta-report-${todayStamp()}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8');
    showToast('Period report exported');
  }

  function backupFileName() {
    return `moneta-backup-${todayStamp()}.json`;
  }

  function createAndDownloadBackup() {
    const backup = C.createBackup({
      transactions: state.transactions,
      settings: state.settings,
      imports: state.imports
    });
    downloadText(backupFileName(), JSON.stringify(backup, null, 2), 'application/json');
    try {
      localStorage.setItem('moneta-last-backup', new Date().toISOString());
    } catch (error) {}
    renderData();
    showToast(`Backup saved · ${state.transactions.length} entries`);
  }

  async function restoreBackupFile(file) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      showAlert({ title: 'That backup is too large', message: 'Moneta restores files up to 25 MB.', danger: true });
      return;
    }
    let result;
    try {
      const text = await file.text();
      result = C.validateBackup(text);
    } catch (error) {
      result = { ok: false, errors: ['The file could not be read.'] };
    }
    if (!result.ok) {
      showAlert({
        title: 'That backup cannot be restored',
        message: 'Nothing was changed. Fix the file or choose a different backup.',
        detailHtml: `<ul class="confirm-list">${result.errors.slice(0, 8).map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`,
        danger: true
      });
      return;
    }
    const summary = C.backupSummary(result.data);
    const confirmed = await confirmAction({
      title: 'Restore this backup?',
      message: 'This replaces every entry, preference and import record currently on this device.',
      detailHtml: `<div class="confirm-summary">
        <div><span>Entries</span><strong class="money">${summary.count.toLocaleString('en-IN')}</strong></div>
        <div><span>Debits</span><strong class="money">${fmtMoney(summary.debit)}</strong></div>
        <div><span>Credits</span><strong class="money">${fmtMoney(summary.credit)}</strong></div>
        <div><span>Backup date</span><strong>${result.data.exportedAt ? escapeHtml(formatImportedAt(result.data.exportedAt)) : 'Unknown'}</strong></div>
      </div>${result.warnings && result.warnings.length ? `<p class="confirm-warning">${escapeHtml(result.warnings.join(' '))}</p>` : ''}<p class="confirm-note">Your current data will be replaced only after you confirm.</p>`,
      confirmLabel: 'Replace with backup',
      danger: true
    });
    if (!confirmed) return;
    try {
      await DB.replaceAll({
        transactions: result.data.transactions,
        settings: result.data.settings,
        imports: result.data.imports
      });
      await reloadFromDb();
      applyTheme(state.settings.theme);
      state.period = { preset: 'all', from: null, to: null };
      savePeriodState();
      navigate('overview');
      showToast(`Backup restored · ${summary.count} entries`);
    } catch (error) {
      showAlert({ title: 'Restore failed', message: 'The backup was checked, but this device could not write it. Nothing was replaced.', danger: true });
    }
  }

  /* ------------------------------------------------------------------- data */

  function renderData() {
    const host = $('#dataSummary');
    if (!host) return;
    const summary = C.summarize(state.transactions);
    const balance = accountBalanceNow();
    const importCount = state.imports.length;
    host.innerHTML = `
      <article class="data-stat"><span>Entries</span><strong class="money">${summary.count.toLocaleString('en-IN')}</strong><small>Journal lines</small></article>
      <article class="data-stat"><span>Total debits</span><strong class="money debit-ink">${fmtMoney(summary.debit)}</strong><small>Money out</small></article>
      <article class="data-stat"><span>Total credits</span><strong class="money credit-ink">${fmtMoney(summary.credit)}</strong><small>Money in</small></article>
      <article class="data-stat data-stat-balance"><span>Account balance</span><strong class="money">${fmtMoney(balance)}</strong><small>Opening + movement</small></article>`;

    renderStoragePanel();
    const historyHost = $('#dataImportHistory');
    if (historyHost) {
      if (!state.imports.length) {
        historyHost.innerHTML = `<div class="data-empty"><span>${icon('upload')}</span><p>No imports yet. Bring in a spreadsheet from the Import screen.</p></div>`;
      } else {
        historyHost.innerHTML = state.imports.slice(0, 8).map((item) => `
          <div class="data-history-row">
            <span class="history-mark">${icon('file')}</span>
            <div><strong>${escapeHtml(item.fileName || 'Spreadsheet')}</strong><small>${escapeHtml(formatImportedAt(item.at))}</small></div>
            <span class="history-count"><strong class="money">${Number(item.imported) || 0}</strong><small>imported</small></span>
          </div>`).join('');
      }
    }
  }

  function renderStoragePanel() {
    const host = $('#storageBody');
    if (!host) return;
    let lastBackup = '';
    try {
      lastBackup = localStorage.getItem('moneta-last-backup') || '';
    } catch (error) {}
    host.innerHTML = `
      <div class="storage-row"><span>Database</span><strong>IndexedDB · schema v${C.SCHEMA_VERSION}</strong></div>
      <div class="storage-row"><span>Journal entries</span><strong class="money">${state.transactions.length.toLocaleString('en-IN')}</strong></div>
      <div class="storage-row"><span>Import records</span><strong class="money">${state.imports.length.toLocaleString('en-IN')}</strong></div>
      <div class="storage-row"><span>Last backup</span><strong>${lastBackup ? escapeHtml(formatImportedAt(lastBackup)) : 'Not yet backed up'}</strong></div>
      <div class="storage-row"><span>Local storage used</span><strong id="storageUsage">Checking…</strong></div>`;
    const fill = $('#storageFill');
    if (fill) fill.style.width = '0%';
    DB.storageEstimate().then((estimate) => {
      const usage = $('#storageUsage');
      if (!usage) return;
      if (!estimate || !estimate.quota) {
        usage.textContent = 'Unavailable in this browser';
        return;
      }
      const percentUsed = Math.min(100, Math.round((estimate.usage / estimate.quota) * 1000) / 10);
      usage.textContent = `${(estimate.usage / 1024 / 1024).toFixed(1)} MB of ${(estimate.quota / 1024 / 1024).toFixed(0)} MB`;
      if (fill) fill.style.width = `${Math.max(1, percentUsed)}%`;
    }).catch(() => {});
  }

  async function clearImportHistory() {
    if (!state.imports.length) {
      showToast('There is no import history to clear');
      return;
    }
    const confirmed = await confirmAction({
      title: 'Clear import history?',
      message: 'This removes the list of past imports. Journal entries are not affected.',
      confirmLabel: 'Clear history'
    });
    if (!confirmed) return;
    try {
      await DB.clearImports();
      state.imports = [];
      renderCurrentView();
      showToast('Import history cleared');
    } catch (error) {
      showToast('Could not clear import history', 'error');
    }
  }

  async function deleteAllEntries() {
    if (!state.transactions.length) {
      showToast('There are no entries to delete');
      return;
    }
    const summary = C.summarize(state.transactions);
    const confirmed = await confirmAction({
      title: 'Delete every entry?',
      message: 'Your settings, opening balance and import history stay. Every journal line is removed.',
      detailHtml: `<div class="confirm-summary">
        <div><span>Entries</span><strong class="money">${summary.count.toLocaleString('en-IN')}</strong></div>
        <div><span>Debits</span><strong class="money">${fmtMoney(summary.debit)}</strong></div>
        <div><span>Credits</span><strong class="money">${fmtMoney(summary.credit)}</strong></div>
      </div><p class="confirm-note">Download a backup first if you may need this journal again.</p>`,
      confirmLabel: 'Delete all entries',
      danger: true
    });
    if (!confirmed) return;
    try {
      await DB.clearTransactions();
      state.transactions = [];
      state.ledger.page = 1;
      state.period = { preset: 'all', from: null, to: null };
      savePeriodState();
      renderCurrentView();
      showToast('All entries deleted · settings kept');
    } catch (error) {
      showToast('Could not delete the entries', 'error');
    }
  }

  async function clearEverything() {
    const confirmed = await confirmAction({
      title: 'Clear the whole workspace?',
      message: 'Every entry, import record and preference on this device will be removed. This cannot be undone.',
      detailHtml: `<ul class="confirm-list"><li>${state.transactions.length.toLocaleString('en-IN')} journal entries</li><li>${state.imports.length.toLocaleString('en-IN')} import records</li><li>Currency, date format, theme and opening balance</li></ul><p class="confirm-note">Type CLEAR to enable the final button. A downloaded backup is the only way back.</p>`,
      confirmLabel: 'Clear everything',
      requireText: 'CLEAR',
      danger: true
    });
    if (!confirmed) return;
    try {
      state.settings = await DB.clearAll();
      state.transactions = [];
      state.imports = [];
      state.ledger.page = 1;
      state.period = { preset: 'this-month', from: null, to: null };
      const range = C.computePeriodRange('this-month', { today: C.todayISO() });
      state.period = { preset: range.preset, from: range.from, to: range.to };
      try {
        localStorage.removeItem('moneta-last-backup');
        localStorage.removeItem('moneta-theme-mode');
        localStorage.removeItem('moneta-theme');
        localStorage.removeItem('moneta-period');
      } catch (error) {}
      savePeriodState();
      applyTheme(state.settings.theme);
      navigate('overview');
      showToast('Everything cleared');
    } catch (error) {
      showToast('Could not clear the workspace', 'error');
    }
  }

  /* --------------------------------------------------------------- settings */

  function renderCategoryManager() {
    const host = $('#categoryManagerList');
    const count = $('#categoryManagerCount');
    const note = $('#categoryManagerNote');
    const add = $('[data-action="add-category"]');
    if (!host) return;
    const categories = categoryList();
    if (count) count.textContent = `${categories.length} of ${C.CATEGORY_LIMITS.max} categories`;
    if (add) {
      add.disabled = categories.length >= C.CATEGORY_LIMITS.max;
      add.title = add.disabled ? 'Remove a category before adding another' : 'Add a category';
    }
    if (note) {
      note.textContent = categories.length >= C.CATEGORY_LIMITS.max
        ? 'This register is full. Rename a category, or remove one to make room.'
        : 'Imports and new entries are folded into this list. Nothing is left uncategorised.';
    }
    host.innerHTML = categories.map((category, index) => {
      const used = state.transactions.reduce((total, row) => total + (categoryOf(row) === category.name ? 1 : 0), 0);
      return `<div class="category-manager-row">
        <span class="category-manager-index">${String(index + 1).padStart(2, '0')}</span>
        <div class="category-manager-name"><strong>${escapeHtml(category.name)}</strong><small>${used} ${used === 1 ? 'entry' : 'entries'}</small></div>
        <div class="category-manager-actions">
          <button class="icon-btn" type="button" data-category-edit="${escapeAttr(category.name)}" aria-label="Rename ${escapeAttr(category.name)}">${icon('edit')}</button>
          <button class="icon-btn category-remove" type="button" data-category-remove="${escapeAttr(category.name)}" aria-label="Remove ${escapeAttr(category.name)}" ${categories.length <= C.CATEGORY_LIMITS.min ? 'disabled' : ''}>${icon('trash')}</button>
        </div>
      </div>`;
    }).join('');
  }

  function openCategoryDialog(mode, currentName) {
    const categories = categoryList();
    const editing = mode === 'edit';
    if (!editing && categories.length >= C.CATEGORY_LIMITS.max) {
      showToast(`Keep the register to ${C.CATEGORY_LIMITS.max} categories`, 'error');
      return;
    }
    const title = editing ? 'Rename category' : 'Add category';
    const value = editing ? currentName : '';
    const dialog = mountDialog(`
      <section class="modal-card category-card" role="dialog" aria-modal="true" aria-labelledby="categoryDialogTitle">
        <header class="entry-head">
          <div><p class="entry-kicker">A short, honest register</p><h2 id="categoryDialogTitle">${title}</h2></div>
          <button class="icon-btn" type="button" data-dialog-close aria-label="Close">${icon('close')}</button>
        </header>
        <form class="category-form" novalidate>
          <label class="field"><span>Category name</span>
            <input type="text" name="categoryName" maxlength="40" autocomplete="off" required value="${escapeAttr(value)}" placeholder="e.g. Education">
            <small>${editing ? 'Every entry in this category will be renamed too.' : 'The register holds 5 to 7 categories.'}</small>
          </label>
          <div class="entry-error" role="alert" hidden></div>
          <footer class="entry-actions">
            <button class="btn btn-secondary" type="button" data-dialog-close>Cancel</button>
            <button class="btn btn-primary" type="submit">${editing ? 'Save name' : 'Add category'}</button>
          </footer>
        </form>
      </section>`);
    const form = $('.category-form', dialog.card);
    const input = form.elements.categoryName;
    const errorBox = $('.entry-error', form);
    const submit = $('button[type="submit"]', form);

    function showError(message) {
      errorBox.textContent = message;
      errorBox.hidden = false;
      errorBox.classList.remove('is-shaking');
      void errorBox.offsetWidth;
      errorBox.classList.add('is-shaking');
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = C.normalizeText(input.value).slice(0, 40);
      if (!name) return showError('Give this category a name');
      const duplicate = categories.some((category) => category.name.toLowerCase() === name.toLowerCase() && category.name !== currentName);
      if (duplicate) return showError('That category already exists');
      let next;
      if (editing) {
        next = categories.map((category) => category.name === currentName ? { ...category, name } : category);
      } else {
        const base = name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category';
        let id = base;
        let suffix = 2;
        while (categories.some((category) => category.id === id)) id = `${base}-${suffix++}`;
        next = [...categories, { id, name }];
      }
      submit.disabled = true;
      try {
        const renamed = editing && name !== currentName;
        const affected = renamed
          ? state.transactions.filter((row) => categoryOf(row) === currentName).map((row) => ({ ...row, category: name, updatedAt: new Date().toISOString() }))
          : [];
        if (affected.length) {
          await DB.saveTransactions(affected);
          const byId = new Map(affected.map((row) => [row.id, row]));
          state.transactions = state.transactions.map((row) => byId.get(row.id) || row);
        }
        const saved = await saveSettings({ categories: next }, { message: editing ? 'Category renamed' : 'Category added' });
        if (!saved) throw new Error('Could not save the category list');
        dialog.close('saved');
        renderCurrentView();
      } catch (error) {
        submit.disabled = false;
        showError('The category could not be saved. Try again.');
      }
    });

    window.setTimeout(() => input.focus({ preventScroll: true }), 80);
  }

  async function removeCategory(name) {
    const categories = categoryList();
    if (categories.length <= C.CATEGORY_LIMITS.min) {
      showToast(`Keep at least ${C.CATEGORY_LIMITS.min} categories`, 'error');
      return;
    }
    const remaining = categories.filter((category) => category.name !== name);
    const fallback = remaining.find((category) => category.id === 'other') || remaining[remaining.length - 1];
    const affected = state.transactions.filter((row) => categoryOf(row) === name);
    const confirmed = await confirmAction({
      title: 'Remove this category?',
      message: `“${name}” will leave the register.`,
      detailHtml: `<ul class="confirm-list"><li>${affected.length} ${affected.length === 1 ? 'entry moves' : 'entries move'} to ${escapeHtml(fallback.name)}</li><li>${remaining.length} categories stay in the register</li></ul><p class="confirm-note">You can add a new category afterwards.</p>`,
      confirmLabel: 'Remove category',
      danger: true
    });
    if (!confirmed) return;
    try {
      if (affected.length) {
        const now = new Date().toISOString();
        const updated = affected.map((row) => ({ ...row, category: fallback.name, updatedAt: now }));
        await DB.saveTransactions(updated);
        const byId = new Map(updated.map((row) => [row.id, row]));
        state.transactions = state.transactions.map((row) => byId.get(row.id) || row);
      }
      const saved = await saveSettings({ categories: remaining }, { message: 'Category removed' });
      if (!saved) throw new Error('Could not save the category list');
      renderCurrentView();
    } catch (error) {
      showToast('The category could not be removed', 'error');
    }
  }

  function renderSettings() {
    const currency = $('#settingsCurrency');
    if (currency) currency.value = state.settings.currency;
    const dateFormat = $('#settingsDateFormat');
    if (dateFormat) dateFormat.value = state.settings.dateFormat;
    const sort = $('#settingsSort');
    if (sort) sort.value = state.settings.defaultSort;
    const pageSize = $('#settingsPageSize');
    if (pageSize) pageSize.value = String(state.settings.pageSize);
    const opening = $('#settingsOpeningBalance');
    if (opening && document.activeElement !== opening) opening.value = state.settings.openingBalance;
    const openingSide = $('#settingsOpeningSide');
    if (openingSide) openingSide.value = state.settings.openingBalanceSide;
    const example = $('#dateFormatExample');
    if (example) example.textContent = `Example · ${fmtDate(C.todayISO())}`;
    $$('[data-currency-symbol]').forEach((element) => {
      element.textContent = C.currencySymbol(state.settings.currency);
    });
    $$('[data-theme-choice]').forEach((button) => {
      const active = button.dataset.themeChoice === state.settings.theme;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const balance = $('#settingsCurrentBalance');
    if (balance) {
      balance.textContent = fmtMoney(accountBalanceNow());
      balance.classList.toggle('is-negative', isNegativeMoney(accountBalanceNow()));
    }
    renderCategoryManager();
  }

  async function persistSetting(partial, options) {
    const saved = await saveSettings(partial, options);
    if (saved) renderCurrentView();
    return saved;
  }

  async function commitOpeningBalance() {
    const input = $('#settingsOpeningBalance');
    if (!input) return;
    const parsed = C.parseMoney(input.value);
    if (!parsed.ok) {
      showToast(parsed.error || 'Enter a valid opening balance', 'error');
      input.value = state.settings.openingBalance;
      return;
    }
    input.value = parsed.value;
    await persistSetting({ openingBalance: parsed.value }, { message: 'Opening balance saved' });
  }

  /* -------------------------------------------------------------------- init */

  async function reloadFromDb() {
    const [transactions, settings, imports] = await Promise.all([
      DB.getAllTransactions(),
      DB.getSettings(),
      DB.getImports()
    ]);
    state.transactions = transactions || [];
    state.settings = { ...C.DEFAULT_SETTINGS, ...(settings || {}) };
    state.settings.categories = C.normalizeCategoryList(state.settings.categories);
    state.imports = imports || [];
    const recategorised = state.transactions.filter((row) => {
      const next = categoryOf(row);
      if (next === row.category) return false;
      row.category = next;
      return true;
    });
    if (recategorised.length) {
      DB.saveTransactions(recategorised).catch(() => {});
    }
    const config = C.sortConfig(state.settings.defaultSort);
    state.ledger.sortKey = config.key;
    state.ledger.sortDir = config.dir;
    state.ledger.page = 1;
    applyTheme(state.settings.theme);
    updateThemeControls();
  }

  function bindEvents() {
    const isEditable = (target) => target && target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');

    document.addEventListener('contextmenu', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!isEditable(target)) event.preventDefault();
    });

    document.addEventListener('selectstart', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!isEditable(target)) event.preventDefault();
    });

    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const goto = target.closest('[data-goto]');
      if (goto) {
        event.preventDefault();
        navigate(goto.dataset.goto);
        return;
      }
      const viewButton = target.closest('.side-link[data-view], .dock-tab[data-view]');
      if (viewButton) {
        event.preventDefault();
        navigate(viewButton.dataset.view);
        return;
      }
      const sortButton = target.closest('[data-sort]');
      if (sortButton) {
        const config = C.nextSortConfig(state.ledger.sortKey, state.ledger.sortDir, sortButton.dataset.sort);
        state.ledger.sortKey = config.key;
        state.ledger.sortDir = config.dir;
        state.ledger.page = 1;
        renderLedger();
        return;
      }
      const pageButton = target.closest('[data-page]');
      if (pageButton) {
        if (pageButton.disabled) return;
        const page = Number(pageButton.dataset.page);
        if (!Number.isFinite(page)) return;
        state.ledger.page = page;
        renderLedger();
        const panel = $('.ledger-panel');
        if (panel && typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const editButton = target.closest('[data-edit]');
      if (editButton) {
        const row = state.transactions.find((item) => item.id === editButton.dataset.edit);
        if (row) openEntryDialog(row, 'edit');
        return;
      }
      const duplicateButton = target.closest('[data-duplicate]');
      if (duplicateButton) {
        const row = state.transactions.find((item) => item.id === duplicateButton.dataset.duplicate);
        if (row) openEntryDialog(row, 'duplicate');
        return;
      }
      const deleteButton = target.closest('[data-delete]');
      if (deleteButton) {
        const row = state.transactions.find((item) => item.id === deleteButton.dataset.delete);
        if (row) deleteEntry(row);
        return;
      }
      const categoryEdit = target.closest('[data-category-edit]');
      if (categoryEdit) {
        openCategoryDialog('edit', categoryEdit.dataset.categoryEdit);
        return;
      }
      const categoryRemove = target.closest('[data-category-remove]');
      if (categoryRemove) {
        removeCategory(categoryRemove.dataset.categoryRemove);
        return;
      }
      const actionButton = target.closest('[data-action]');
      if (actionButton) {
        const action = actionButton.dataset.action;
        if (action === 'add') openEntryDialog();
        else if (action === 'theme') toggleTheme();
        else if (action === 'backup') createAndDownloadBackup();
        else if (action === 'export-xlsx') exportJournal('xlsx', false);
        else if (action === 'export-csv') exportJournal('csv', false);
        else if (action === 'export-filtered') exportJournal('csv', true);
        else if (action === 'export-report') exportReport();
        else if (action === 'download-template') downloadImportTemplate();
        else if (action === 'clear-filters') resetLedgerFilters();
        else if (action === 'delete-all-entries') deleteAllEntries();
        else if (action === 'clear-all') clearEverything();
        else if (action === 'clear-import-history') clearImportHistory();
        else if (action === 'edit-goal') openGoalDialog();
        else if (action === 'edit-budget') openBudgetDialog();
        else if (action === 'edit-account') openAccountDialog();
        else if (action === 'add-category') openCategoryDialog('add');
        else if (action === 'edit-opening') navigate('settings');
        return;
      }
      const categoryChoice = target.closest('[data-theme-choice]');
      if (categoryChoice) {
        persistSetting({ theme: categoryChoice.dataset.themeChoice }, { message: 'Appearance updated' });
      }
    });

    const search = $('#ledgerSearch');
    if (search) {
      search.addEventListener('input', () => {
        state.ledger.search = search.value;
        state.ledger.page = 1;
        const clear = $('#clearSearch');
        if (clear) clear.hidden = !search.value;
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          if (state.view === 'ledger') renderLedger();
        }, 170);
      });
    }
    const clearSearch = $('#clearSearch');
    if (clearSearch) {
      clearSearch.addEventListener('click', () => {
        state.ledger.search = '';
        state.ledger.page = 1;
        renderLedger();
        const input = $('#ledgerSearch');
        if (input) input.focus();
      });
    }

    $$('#ledgerSide [data-side]').forEach((button) => {
      button.addEventListener('click', () => {
        state.ledger.side = button.dataset.side;
        state.ledger.page = 1;
        renderLedger();
      });
    });
    const category = $('#ledgerCategory');
    if (category) {
      category.addEventListener('change', () => {
        state.ledger.category = category.value;
        state.ledger.page = 1;
        renderLedger();
      });
    }
    const ledgerSort = $('#ledgerSort');
    if (ledgerSort) {
      ledgerSort.addEventListener('change', () => {
        const config = C.sortConfig(ledgerSort.value);
        state.ledger.sortKey = config.key;
        state.ledger.sortDir = config.dir;
        state.ledger.page = 1;
        renderLedger();
      });
    }
    const pageSize = $('#ledgerPageSize');
    if (pageSize) {
      pageSize.addEventListener('change', () => {
        persistSetting({ pageSize: Number(pageSize.value) });
      });
    }
    $$('[data-period-preset], #ledgerPeriod').forEach((select) => {
      select.addEventListener('change', () => setPeriodPreset(select.value));
    });
    $$('[data-period-control]').forEach((control) => {
      const from = $('[data-period-from]', control);
      const to = $('[data-period-to]', control);
      const onChange = () => setCustomPeriod(from ? from.value : null, to ? to.value : null);
      if (from) from.addEventListener('change', onChange);
      if (to) to.addEventListener('change', onChange);
    });
    const ledgerFrom = $('#ledgerFrom');
    const ledgerTo = $('#ledgerTo');
    if (ledgerFrom) ledgerFrom.addEventListener('change', () => setCustomPeriod(ledgerFrom.value, ledgerTo ? ledgerTo.value : null));
    if (ledgerTo) ledgerTo.addEventListener('change', () => setCustomPeriod(ledgerFrom ? ledgerFrom.value : null, ledgerTo.value));

    const currency = $('#settingsCurrency');
    if (currency) currency.addEventListener('change', () => persistSetting({ currency: currency.value }, { message: 'Currency updated' }));
    const dateFormat = $('#settingsDateFormat');
    if (dateFormat) dateFormat.addEventListener('change', () => persistSetting({ dateFormat: dateFormat.value }, { message: 'Date format updated' }));
    const defaultSort = $('#settingsSort');
    if (defaultSort) defaultSort.addEventListener('change', () => persistSetting({ defaultSort: defaultSort.value, applySort: true }, { message: 'Default sort updated', applySort: true }));
    const settingsPageSize = $('#settingsPageSize');
    if (settingsPageSize) settingsPageSize.addEventListener('change', () => persistSetting({ pageSize: Number(settingsPageSize.value) }, { message: 'Page size updated' }));
    const openingBalance = $('#settingsOpeningBalance');
    if (openingBalance) {
      openingBalance.addEventListener('blur', commitOpeningBalance);
      openingBalance.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          openingBalance.blur();
        }
      });
    }
    const openingSide = $('#settingsOpeningSide');
    if (openingSide) {
      openingSide.addEventListener('change', () => persistSetting({ openingBalanceSide: openingSide.value }, { message: 'Opening balance side updated' }));
    }

    const chooseImport = $('#chooseImport');
    if (chooseImport) chooseImport.addEventListener('click', () => $('#importFile').click());
    const changeImportFile = $('#changeImportFile');
    if (changeImportFile) changeImportFile.addEventListener('click', () => $('#importFile').click());
    const importFile = $('#importFile');
    if (importFile) importFile.addEventListener('change', () => startImportFile(importFile.files[0]));
    const importTemplate = $('#importTemplate');
    if (importTemplate) importTemplate.addEventListener('click', downloadImportTemplate);
    const importSheet = $('#importSheet');
    if (importSheet) {
      importSheet.addEventListener('change', () => {
        const session = state.importSession;
        if (!session) return;
        session.sheetIndex = Number(importSheet.value) || 0;
        const sheet = currentImportSheet();
        session.headerRow = sheet ? C.detectHeaderRow(sheet.rows) : -1;
        session.mapping = sheet && session.headerRow >= 0
          ? C.suggestMapping(sheet.rows[session.headerRow] || [])
          : guessHeaderlessMapping(sheet, session.dateMode);
        renderImportUI();
      });
    }
    const importHeaderRow = $('#importHeaderRow');
    if (importHeaderRow) {
      importHeaderRow.addEventListener('change', () => {
        const session = state.importSession;
        const sheet = currentImportSheet();
        if (!session || !sheet) return;
        session.headerRow = Number(importHeaderRow.value);
        session.mapping = session.headerRow >= 0
          ? C.suggestMapping(sheet.rows[session.headerRow] || [])
          : guessHeaderlessMapping(sheet, session.dateMode);
        renderImportUI();
      });
    }
    const importDateFormat = $('#importDateFormat');
    if (importDateFormat) {
      importDateFormat.addEventListener('change', () => {
        if (!state.importSession) return;
        state.importSession.dateMode = importDateFormat.value;
        if (state.importSession.headerRow < 0) {
          const sheet = currentImportSheet();
          state.importSession.mapping = guessHeaderlessMapping(sheet, state.importSession.dateMode);
        }
        renderImportUI();
      });
    }
    const importDuplicates = $('#importDuplicates');
    if (importDuplicates) {
      importDuplicates.addEventListener('change', () => {
        if (!state.importSession) return;
        state.importSession.duplicateMode = importDuplicates.value;
        renderImportUI();
      });
    }
    $$('#importWorkspace [data-map]').forEach((select) => {
      select.addEventListener('change', () => {
        if (!state.importSession) return;
        state.importSession.mapping[select.dataset.map] = select.value === '' ? null : Number(select.value);
        renderImportUI();
      });
    });
    const confirmImport = $('#confirmImport');
    if (confirmImport) confirmImport.addEventListener('click', commitImport);
    const cancelImport = $('#cancelImport');
    if (cancelImport) cancelImport.addEventListener('click', resetImportSession);
    const downloadErrors = $('#downloadImportErrors');
    if (downloadErrors) downloadErrors.addEventListener('click', downloadImportErrors);

    const drop = $('#importDrop');
    if (drop) {
      ['dragenter', 'dragover'].forEach((type) => {
        drop.addEventListener(type, (event) => {
          event.preventDefault();
          drop.classList.add('is-dragging');
        });
      });
      ['dragleave', 'dragend'].forEach((type) => {
        drop.addEventListener(type, () => drop.classList.remove('is-dragging'));
      });
      drop.addEventListener('drop', (event) => {
        event.preventDefault();
        drop.classList.remove('is-dragging');
        const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
        if (file) startImportFile(file);
      });
    }

    $$('#restoreFile, #settingsRestoreFile').forEach((input) => {
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        input.value = '';
        restoreBackupFile(file);
      });
    });

    const install = $('#installApp');
    if (install) {
      install.addEventListener('click', async () => {
        if (!state.installPrompt) return;
        state.installPrompt.prompt();
        try {
          await state.installPrompt.userChoice;
        } catch (error) {}
        state.installPrompt = null;
        renderChrome();
      });
    }

    window.addEventListener('hashchange', () => {
      const view = viewFromHash() || 'overview';
      if (view !== state.view) navigate(view, { push: false });
    });
    window.addEventListener('popstate', () => {
      const view = viewFromHash() || 'overview';
      if (view !== state.view) navigate(view, { push: false });
    });
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      state.installPrompt = event;
      renderChrome();
    });
    window.addEventListener('appinstalled', () => {
      state.installPrompt = null;
      renderChrome();
      showToast('Moneta installed');
    });
    if (systemTheme) {
      const onChange = () => {
        if (state.settings.theme === 'system') {
          applyTheme('system');
          renderCurrentView();
        }
      };
      if (systemTheme.addEventListener) systemTheme.addEventListener('change', onChange);
      else if (systemTheme.addListener) systemTheme.addListener(onChange);
    }
    window.addEventListener('resize', () => {
      window.requestAnimationFrame(() => positionDockIndicator(false));
    });
  }

  function registerServiceWorker() {
    if (isNativeShell() || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  async function init() {
    fillStaticOptions();
    loadPeriodState();
    bindEvents();
    try {
      await DB.openDatabase();
      await reloadFromDb();
      state.ready = true;
      const initialView = viewFromHash() || 'overview';
      navigate(initialView, { push: false, scroll: false });
      const loader = $('#appLoader');
      if (isNativeShell()) {
        // The native launch overlay owns the boot animation in the app shell.
        // Hand over without replaying the web loader underneath it.
        bootRevealed = true;
        document.body.classList.add('is-ready');
        if (loader && loader.parentNode) loader.remove();
        syncSystemChrome(resolveTheme(state.settings.theme));
        registerServiceWorker();
        notifyNativeReady();
        return;
      }
      const wait = Math.max(0, BOOT_MIN_MS - (performance.now() - bootStarted));
      window.setTimeout(() => {
        bootRevealed = true;
        document.body.classList.add('is-ready');
        window.setTimeout(() => syncSystemChrome(resolveTheme(state.settings.theme)), 420);
        window.setTimeout(() => {
          if (loader && loader.parentNode) loader.remove();
        }, 640);
      }, wait);
      registerServiceWorker();
    } catch (error) {
      showBootError(error && error.message ? error.message : 'Moneta could not open its local database.');
      showToast('Storage could not be opened', 'error');
    }
  }

  init();
})();

