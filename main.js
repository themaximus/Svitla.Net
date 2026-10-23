/**
 * main.js — Standalone web port of the DTEK outage schedule widget.
 */

// The page is served by server.js itself, so the API lives on the same origin and port
const API_URL = '/api/dtek';
const UPDATE_INTERVAL_MS = 300_000;
const DEFAULT_REGION = 'https://www.dtek-dnem.com.ua/ua/shutdowns';

// The Windows app opens the page as "/?desktop" in its own frameless, transparent window: only the
// widget is shown, and window actions (move, hide to tray, close) go to the app via WebView2 messages
const DESKTOP = new URLSearchParams(location.search).has('desktop');
if (DESKTOP) document.documentElement.classList.add('desktop');

function postToApp(message) {
  if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(message);
}

// Messages from the app: "autostart:on" / "autostart:off" (it reads the Windows setting itself)
if (DESKTOP && window.chrome && window.chrome.webview) {
  window.chrome.webview.addEventListener('message', e => {
    if (typeof e.data !== 'string' || !e.data.startsWith('autostart:')) return;
    state.autostart = e.data === 'autostart:on';
    const checkbox = document.getElementById('dw-chk-autostart');
    if (checkbox) checkbox.checked = state.autostart;
  });
}

const REGIONS = {
  'https://www.dtek-dnem.com.ua/ua/shutdowns': { ua: 'Дніпро та область', en: 'Dnipro & Region' },
  'https://www.dtek-kem.com.ua/ua/shutdowns':  { ua: 'Київ (місто)', en: 'Kyiv (City)' },
  'https://www.dtek-krem.com.ua/ua/shutdowns': { ua: 'Київська обл.', en: 'Kyiv Region' },
  'https://www.dtek-oem.com.ua/ua/shutdowns':  { ua: 'Одеська обл.', en: 'Odesa Region' },
  'https://www.dtek-dem.com.ua/ua/shutdowns':  { ua: 'Донецька обл.', en: 'Donetsk Region' },
};

const REGION_SHORT = {
  'https://www.dtek-dnem.com.ua/ua/shutdowns': { ua: 'Дніпро', en: 'Dnipro' },
  'https://www.dtek-kem.com.ua/ua/shutdowns':  { ua: 'Київ', en: 'Kyiv' },
  'https://www.dtek-krem.com.ua/ua/shutdowns': { ua: 'Київ обл.', en: 'Kyiv Reg.' },
  'https://www.dtek-oem.com.ua/ua/shutdowns':  { ua: 'Одеса', en: 'Odesa' },
  'https://www.dtek-dem.com.ua/ua/shutdowns':  { ua: 'Донецьк', en: 'Donetsk' },
};

// Used until a region's schedule has been loaded; Kyiv city, for one, has groups GPV1.1 ... GPV60.1
const QUEUES = [
  'GPV1.1','GPV1.2','GPV2.1','GPV2.2','GPV3.1','GPV3.2',
  'GPV4.1','GPV4.2','GPV5.1','GPV5.2','GPV6.1','GPV6.2',
];

// region -> groups found in its schedule; at most one entry per region in REGIONS
const groupsByRegion = {};

function rememberGroups(region, rawFact) {
  const firstDay = rawFact && Object.values(rawFact)[0];
  if (!firstDay) return;
  const groups = Object.keys(firstDay).filter(g => g.startsWith('GPV'));
  if (groups.length) groupsByRegion[region] = groups.sort((a, b) => parseFloat(a.slice(3)) - parseFloat(b.slice(3)));
}

function groupOptions(region, selected) {
  const groups = groupsByRegion[region] || QUEUES;
  // Keep a saved group selectable even if the list has not been loaded yet
  const list = selected && !groups.includes(selected) ? [selected, ...groups] : groups;
  return list.map(q =>
    `<option value="${q}" ${q === selected ? 'selected' : ''}>${q.replace('GPV', t('queueLabel'))}</option>`
  ).join('');
}

// Settings overlay: show the groups of the region picked there, loading them on demand
async function refreshGroupSelect(region) {
  const select = document.getElementById('dw-group-select');
  if (!select) return;
  const selected = select.value;
  select.innerHTML = groupOptions(region, selected);
  if (groupsByRegion[region]) return;

  try {
    const res  = await fetch(`${API_URL}?region=${encodeURIComponent(region)}`);
    const data = await res.json();
    if (data.status === 'success') rememberGroups(region, data.rawFact);
  } catch { return; }

  // The overlay may have been re-rendered or switched to another region meanwhile
  const current = document.getElementById('dw-group-select');
  if (current && groupsByRegion[region] && document.getElementById('dw-region-select').value === region) {
    const keep = current.value;
    current.innerHTML = groupOptions(region, groupsByRegion[region].includes(keep) ? keep : groupsByRegion[region][0]);
  }
}

const TRANSLATIONS = {
  ua: {
    regionCity: 'Регіон / Місто',
    outageQueue: 'Черга відключень',
    queueLabel: 'Черга ',
    save: 'ЗБЕРЕГТИ',
    cancel: 'СКАСУВАТИ',
    appearance: 'Вигляд',
    performanceImpact: 'Підвищить навантаження на систему',
    blurToggle: 'Прозорість / розмиття',
    pinPosition: 'Закріпити розташування',
    unpinPosition: 'Відкріпити',
    autostart: 'Запускати разом з Windows',
    autostartHint: 'Віджет відкриється після ввімкнення ПК',
    language: 'Мова',
    hideToTray: 'Сховати в трей',
    closeApp: 'Закрити',
    author: 'Автор: Максим',
    title: 'Графік ДТЕК',
    refresh: 'Оновити',
    settings: 'Налаштування',
    today: 'Сьогодні',
    tomorrow: 'Завтра',
    waiting: 'Очікування...',
    updating: 'Оновлення...',
    error: 'Помилка',
    noLight: 'Світла немає',
    hasLight: 'Світло є',
    scheduleFor: 'ГРАФІК НА',
    updatedAt: 'оновлено',
    notPublished: 'Графік ще не опубліковано',
    botProtection: '☁ Сайт ДТЕК увімкнув захист від ботів — спробуйте пізніше',
    proxyUnavailable: '⚠ Проксі-сервер недоступний — запустіть node server.js',
  },
  en: {
    regionCity: 'Region / City',
    outageQueue: 'Outage Group',
    queueLabel: 'Group ',
    save: 'SAVE',
    cancel: 'CANCEL',
    appearance: 'Appearance',
    performanceImpact: 'Increases system load',
    blurToggle: 'Transparency / Blur',
    pinPosition: 'Lock position',
    unpinPosition: 'Unlock position',
    autostart: 'Start with Windows',
    autostartHint: 'The widget opens when the PC starts',
    language: 'Language',
    hideToTray: 'Hide to tray',
    closeApp: 'Close',
    author: 'Author: Maksym',
    title: 'DTEK Schedule',
    refresh: 'Refresh',
    settings: 'Settings',
    today: 'Today',
    tomorrow: 'Tomorrow',
    waiting: 'Waiting...',
    updating: 'Updating...',
    error: 'Error',
    noLight: 'Power Off',
    hasLight: 'Power On',
    scheduleFor: 'SCHEDULE FOR',
    updatedAt: 'updated',
    notPublished: 'Schedule not published yet',
    botProtection: '☁ DTEK site bot protection is active — try again later',
    proxyUnavailable: '⚠ Proxy server offline — run node server.js',
  }
};

function t(key) {
  const lang = document.documentElement.lang || 'ua';
  return (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || TRANSLATIONS['ua'][key] || key;
}

function loadSettings() {
  try { return JSON.parse(localStorage.getItem('dtek-settings') || '{}'); } catch { return {}; }
}

const SETTINGS_VERSION = 2;

function saveSettings(patch) {
  const s = Object.assign(loadSettings(), patch, { v: SETTINGS_VERSION });
  localStorage.setItem('dtek-settings', JSON.stringify(s));
  saveToApp();
  return s;
}

// WebView2 writes localStorage to disk lazily, so a change made just before the app is closed could
// be lost. The app keeps its own copy in a file and puts it back into localStorage on every start.
function saveToApp() {
  postToApp('settings:' + JSON.stringify({ settings: loadSettings(), lang: localStorage.getItem('app-lang') || 'ua' }));
}

let state = {
  group:     null,
  region:    DEFAULT_REGION,
  useBlur:   false,
  pinned:    false, // desktop app: the widget cannot be dragged
  autostart: false, // desktop app: start with Windows; the app owns this setting and reports it
  selectedDay: 0,
  currentRawData: null,
  todayKey: null,
  updatedAt: null, // DTEK's own 'last update' text, e.g. '17.10.2026 16:27'
  loading: false,
};

let updateTimer = null;
let hourTimer = null;
let pendingRequest = null; // AbortController of the running fetch
let pendingRegion  = null;

// ── Language Toggle early init ──
function initLanguageSwitcher() {
  const savedLang = localStorage.getItem('app-lang') || 'ua';
  document.documentElement.setAttribute('lang', savedLang);

  postToApp('lang:' + savedLang); // the app translates its tray menu

  const checkbox = document.getElementById('lang-checkbox');
  if (checkbox) {
    checkbox.checked = (savedLang === 'en');
    checkbox.addEventListener('change', () => setLanguage(checkbox.checked ? 'en' : 'ua'));
  }
}

function setLanguage(lang) {
  localStorage.setItem('app-lang', lang);
  document.documentElement.setAttribute('lang', lang);
  postToApp('lang:' + lang);
  saveToApp();
  window.dispatchEvent(new CustomEvent('lang-changed', { detail: lang }));
}

// ── App Start ──
document.addEventListener('DOMContentLoaded', () => {
  initLanguageSwitcher();

  const root = document.getElementById('dtek-app-root');
  if (!root) return;

  restoreSavedSettings();

  renderShell(root);
  applyVisuals();

  if (!state.group) {
    openSettings();
  } else {
    startUpdate();
  }

  scheduleUpdates();

  // Do not poll DTEK while the page is hidden; catch up as soon as it is shown again.
  // The desktop app keeps polling while hidden: its tray icon still shows the power status.
  document.addEventListener('visibilitychange', () => {
    if (DESKTOP) return;
    if (document.hidden) {
      clearInterval(updateTimer);
      clearTimeout(hourTimer);
    } else {
      startUpdate();
      scheduleUpdates();
    }
  });

  window.addEventListener('lang-changed', () => {
    const rootEl = document.getElementById('dtek-app-root');
    if (rootEl && rootEl.querySelector('.dw-container')) {
      const overlayWasVisible = document.getElementById('dw-overlay')?.classList.contains('visible');
      renderShell(rootEl);
      applyVisuals();
      if (overlayWasVisible) {
        openSettings();
      }
      if (state.currentRawData) {
        updateInterface();
      } else {
        if (state.group && state.region) {
          startUpdate();
        }
      }
    }
  });
});

function restoreSavedSettings() {
  const saved = loadSettings();
  state.group     = saved.group  || null;
  state.region    = saved.region || DEFAULT_REGION;
  // The desktop widget starts transparent; it can be switched off in the settings.
  // Settings saved before version 2 stored the old "off" default rather than a choice, so it is ignored.
  const appearanceSaved = saved.v >= SETTINGS_VERSION;
  state.useBlur   = appearanceSaved ? saved.useBlur : DESKTOP;
  state.pinned    = saved.pinned    || false;
}

function scheduleUpdates() {
  clearInterval(updateTimer);
  updateTimer = setInterval(startUpdate, UPDATE_INTERVAL_MS);

  // Refresh exactly on the hour so the "now" row and the power status do not lag behind
  clearTimeout(hourTimer);
  const now = new Date();
  const msToNextHour = (60 - now.getMinutes()) * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();
  hourTimer = setTimeout(() => { startUpdate(); scheduleUpdates(); }, msToNextHour + 1000);
}

function renderShell(root) {
  const currentLang = document.documentElement.lang || 'ua';
  root.innerHTML = `
  <div class="dw-container" id="dw-container">
    <!-- Settings Overlay -->
    <div id="dw-overlay" class="dw-overlay">
      <div class="dw-overlay-title">${t('regionCity')}</div>
      <select id="dw-region-select" class="dw-form-select">
        ${Object.entries(REGIONS).map(([v, l]) =>
          `<option value="${v}" ${v === state.region ? 'selected' : ''}>${l[currentLang] || l.ua}</option>`
        ).join('')}
      </select>

      <div class="dw-overlay-title">${t('outageQueue')}</div>
      <select id="dw-group-select" class="dw-form-select">
        ${groupOptions(state.region, state.group)}
      </select>

      <button id="dw-save-btn" class="dw-btn-big dw-btn-save">${t('save')}</button>
      <button id="dw-cancel-btn" class="dw-btn-big dw-btn-cancel" style="display:none">${t('cancel')}</button>

      <hr class="dw-divider">

      <div class="dw-overlay-title">${t('appearance')}</div>

      <label class="dw-toggle-row">
        <div class="dw-toggle-label">
          ${t('blurToggle')}
          <small>${t('performanceImpact')}</small>
        </div>
        <div class="dw-toggle-switch">
          <input type="checkbox" id="dw-chk-blur" ${state.useBlur ? 'checked' : ''}>
          <div class="dw-toggle-track"></div>
          <div class="dw-toggle-thumb"></div>
        </div>
      </label>
${DESKTOP ? `
      <label class="dw-toggle-row">
        <div class="dw-toggle-label">
          ${t('autostart')}
          <small>${t('autostartHint')}</small>
        </div>
        <div class="dw-toggle-switch">
          <input type="checkbox" id="dw-chk-autostart" ${state.autostart ? 'checked' : ''}>
          <div class="dw-toggle-track"></div>
          <div class="dw-toggle-thumb"></div>
        </div>
      </label>

      <div class="dw-toggle-row">
        <div class="dw-toggle-label">${t('language')}</div>
        <label class="switch lang-switcher">
          <input type="checkbox" class="cb" id="dw-lang-checkbox" ${currentLang === 'en' ? 'checked' : ''}>
          <span class="toggle"><span class="left">UA</span><span class="right">ENG</span></span>
        </label>
      </div>` : ''}

      <div class="dw-author-info">
        ${t('author')} | <a href="https://t.me/etojemaximus" target="_blank" class="dw-author-link">@etojemaximus</a>
      </div>
    </div>

${DESKTOP ? `
    <div class="dw-window-actions">
      <div id="dw-pin-btn" class="dw-window-btn dw-pin-btn"></div>
      <div id="dw-hide-btn" class="dw-window-btn" title="${t('hideToTray')}">–</div>
      <div id="dw-close-btn" class="dw-window-btn dw-window-close" title="${t('closeApp')}">✕</div>
    </div>` : ''}

    <!-- Widget Body -->
    <div class="dw-header">
      <h2 class="dw-title">${t('title')}</h2>
      <div class="dw-header-actions">
        <div id="dw-refresh-btn" class="dw-icon-btn dw-refresh-btn" title="${t('refresh')}">↻</div>
        <div id="dw-settings-btn" class="dw-icon-btn" title="${t('settings')}">⚙</div>
        <div id="dw-group-tag" class="dw-group-badge">...</div>
      </div>
    </div>

    <div class="dw-day-toggle">
      <button class="dw-day-btn ${state.selectedDay === 0 ? 'active' : ''}" data-day="0">${t('today')}</button>
      <button class="dw-day-btn ${state.selectedDay === 1 ? 'active' : ''}" data-day="1">${t('tomorrow')}</button>
    </div>

    <div class="dw-status-section">
      <div class="dw-status-line">
        <div id="dw-dot" class="dw-status-dot"></div>
        <div id="dw-status-text" class="dw-status-text">${t('waiting')}</div>
      </div>
      <div id="dw-update-date" class="dw-schedule-date">...</div>
    </div>

    <div id="dw-grid-root" class="dw-schedule-grid"></div>
  </div>`;

  bindEvents();
}

function bindEvents() {
  document.getElementById('dw-refresh-btn') .addEventListener('click', startUpdate);
  document.getElementById('dw-settings-btn').addEventListener('click', openSettings);
  document.getElementById('dw-group-tag')   .addEventListener('click', openSettings);
  document.getElementById('dw-cancel-btn')  .addEventListener('click', cancelSettings);

  document.getElementById('dw-save-btn').addEventListener('click', () => {
    const region = document.getElementById('dw-region-select').value;
    if (region !== state.region) state.currentRawData = null; // never show one region's data under another's name
    state.group     = document.getElementById('dw-group-select').value;
    state.region    = region;
    state.useBlur   = document.getElementById('dw-chk-blur').checked;
    saveSettings({ group: state.group, region: state.region, useBlur: state.useBlur });
    const autostart = document.getElementById('dw-chk-autostart');
    if (autostart && autostart.checked !== state.autostart) {
      state.autostart = autostart.checked;
      postToApp('autostart:' + (state.autostart ? 'on' : 'off'));
    }
    applyVisuals();
    closeSettings();
    startUpdate();
  });

  document.getElementById('dw-region-select').addEventListener('change', e => refreshGroupSelect(e.target.value));

  if (DESKTOP) bindDesktopEvents();

  document.getElementById('dw-chk-blur')  .addEventListener('change', e => { state.useBlur   = e.target.checked; applyVisuals(); });

  document.querySelectorAll('.dw-day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedDay = parseInt(btn.dataset.day);
      document.querySelectorAll('.dw-day-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (state.currentRawData) updateInterface();
    });
  });
}

// Interactive parts of the widget; a press anywhere else moves the window (unless it is pinned)
const NOT_DRAGGABLE = 'button, select, input, label, a, .dw-icon-btn, .dw-group-badge, .dw-window-btn, .dw-overlay';

const PIN_ICON = `
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
       stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 3h6l-1 6 4 4H6l4-4z"/>
    <line x1="12" y1="13" x2="12" y2="21"/>
  </svg>`;

// The pin locks the widget in place; it is lit while the widget is pinned
function renderPinButton() {
  const btn = document.getElementById('dw-pin-btn');
  if (!btn) return;
  btn.innerHTML = PIN_ICON;
  btn.classList.toggle('active', state.pinned);
  btn.title = t(state.pinned ? 'unpinPosition' : 'pinPosition');
}

function bindDesktopEvents() {
  renderPinButton();
  document.getElementById('dw-pin-btn').addEventListener('click', () => {
    state.pinned = !state.pinned;
    saveSettings({ pinned: state.pinned });
    renderPinButton();
  });
  document.getElementById('dw-hide-btn') .addEventListener('click', () => postToApp('hide'));
  document.getElementById('dw-close-btn').addEventListener('click', () => postToApp('close'));
  document.getElementById('dw-lang-checkbox').addEventListener('change', e => setLanguage(e.target.checked ? 'en' : 'ua'));

  document.getElementById('dw-container').addEventListener('mousedown', e => {
    if (e.button === 0 && !state.pinned && !e.target.closest(NOT_DRAGGABLE)) {
      e.preventDefault();
      postToApp('drag');
    }
  });
}

function openSettings() {
  const overlay = document.getElementById('dw-overlay');
  if (!overlay) return;
  overlay.classList.add('visible');
  document.getElementById('dw-region-select').value   = state.region;
  document.getElementById('dw-group-select') .innerHTML = groupOptions(state.region, state.group || 'GPV1.1');
  refreshGroupSelect(state.region);
  document.getElementById('dw-chk-blur')    .checked = state.useBlur;
  const autostart = document.getElementById('dw-chk-autostart');
  if (autostart) autostart.checked = state.autostart;
  // Nothing to go back to until a group has been saved once
  document.getElementById('dw-cancel-btn').style.display = state.group ? 'block' : 'none';
}

function closeSettings() {
  const overlay = document.getElementById('dw-overlay');
  if (overlay) overlay.classList.remove('visible');
}

// The appearance toggles preview live, so undo the preview when the changes are not saved
function cancelSettings() {
  restoreSavedSettings();
  applyVisuals();
  closeSettings();
}

function applyVisuals() {
  const c = document.getElementById('dw-container');
  if (!c) return;
  c.classList.toggle('blur-on',    state.useBlur);
  c.classList.toggle('blur-off',   !state.useBlur);
}

async function startUpdate() {
  // Timers fire while the settings are still being filled in; they must not reopen the overlay
  if (!state.group || !state.region) return;
  // A request for the same region is already running; one for an old region is dropped
  if (state.loading && pendingRegion === state.region) return;
  if (pendingRequest) pendingRequest.abort();

  const controller = new AbortController();
  pendingRequest = controller;
  pendingRegion  = state.region;
  state.loading  = true;

  setRefreshSpinner(true);
  const statusEl = document.getElementById('dw-status-text');
  if (statusEl) statusEl.innerText = t('updating');

  try {
    const url = `${API_URL}?region=${encodeURIComponent(state.region)}`;
    const res  = await fetch(url, { signal: controller.signal });
    const data = await res.json();

    if (data.status === 'success') {
      state.currentRawData = data.rawFact;
      state.todayKey       = data.today != null ? String(data.today) : null;
      state.updatedAt      = data.update || null;
      rememberGroups(state.region, data.rawFact);
      updateInterface();
      postPowerTimeline();
    } else if (data.status === 'protected') {
      setError(t('botProtection'));
    } else {
      setError(data.message || t('error'));
    }
  } catch (e) {
    if (e.name !== 'AbortError') setError(t('proxyUnavailable'));
  } finally {
    // A newer request may have taken over while this one was being aborted
    if (pendingRequest === controller) {
      pendingRequest = null;
      pendingRegion  = null;
      state.loading  = false;
      setRefreshSpinner(false);
    }
  }
}

// Looked up on every call: a language switch re-renders the shell and replaces the button
function setRefreshSpinner(on) {
  const btn = document.getElementById('dw-refresh-btn');
  if (btn) btn.classList.toggle('loading', on);
}

// Desktop app: the tray shows whether there is power now and when that changes, with a countdown.
// The app gets the selected group's schedule as half-hour steps and keeps the countdown itself:
//   "status:<end ms>|<start ms>,<1 = off>;..."  (only the points where the state changes)
//   "status:0|"  DTEK lists no outages for the group;  "status:"  the schedule could not be loaded
// Tomorrow counts only once it is published, i.e. has at least one outage in it.
function postPowerTimeline(failed = false) {
  if (!DESKTOP) return;
  if (failed) { postToApp('status:'); return; }
  const points = [];
  let end = 0;
  const raw = state.currentRawData;
  if (raw && state.group) {
    const days = Object.keys(raw).sort((a, b) => Number(a) - Number(b));
    const first = Math.max(0, days.indexOf(state.todayKey));
    days.slice(first, first + 2).forEach((day, i) => {
      const hours = raw[day] && raw[day][state.group];
      if (!hours || end === 0 && i > 0) return;
      const values = Array.from({ length: 24 }, (_, h) => String(hours[h + 1] || '').toLowerCase());
      if (i > 0 && !values.some(v => v === 'no' || v.includes('first') || v.includes('second'))) return;
      const start = Number(day) * 1000;
      values.forEach((v, h) => {
        const halves = [v === 'no' || v.includes('first'), v === 'no' || v.includes('second')];
        halves.forEach((off, half) => {
          if (points.length && points[points.length - 1][1] === off) return;
          points.push([start + h * 3_600_000 + half * 1_800_000, off]);
        });
      });
      end = start + 24 * 3_600_000;
    });
  }
  postToApp('status:' + end + '|' + points.map(([time, off]) => time + ',' + (off ? 1 : 0)).join(';'));
}

function setError(msg) {
  // Do not let a language switch bring back a schedule that failed to refresh
  state.currentRawData = null;
  postPowerTimeline(true);
  const statusEl = document.getElementById('dw-status-text');
  if (statusEl) statusEl.innerText = t('error');
  const gridRoot = document.getElementById('dw-grid-root');
  if (gridRoot) {
    const box = document.createElement('div');
    box.className = 'dw-error-msg';
    box.textContent = msg;
    gridRoot.replaceChildren(box);
  }
}

function updateInterface() {
  const currentLang = document.documentElement.lang || 'ua';
  const regionShortMap = REGION_SHORT[state.region];
  const regionShort = regionShortMap ? (regionShortMap[currentLang] || regionShortMap.ua) : 'DTEK';
  const groupLabel  = state.group.replace('GPV', '');
  const groupTag    = document.getElementById('dw-group-tag');
  if (groupTag) groupTag.innerText = `${regionShort} · ${groupLabel}`;

  if (!state.currentRawData) return;
  // Keys are unix timestamps of the days; DTEK names "today" explicitly, the earliest day is the fallback
  const timestamps   = Object.keys(state.currentRawData).sort((a, b) => Number(a) - Number(b));
  const todayIndex   = Math.max(0, timestamps.indexOf(state.todayKey));
  const todayKey     = timestamps[todayIndex];
  const tomorrowKey  = timestamps[todayIndex + 1];
  const todayRaw     = todayKey    ? state.currentRawData[todayKey][state.group]    : null;
  const tomorrowRaw  = tomorrowKey ? state.currentRawData[tomorrowKey][state.group] : null;

  function convertToGrid(h) {
    const g = {};
    if (!h) return g;
    for (let i = 1; i <= 24; i++) {
      const v = String(h[i] || '').toLowerCase();
      if (v === 'no') g[i-1] = '1';
      else if (v.includes('first') || v.includes('second') || v.includes('maybe')) g[i-1] = '2';
      else g[i-1] = '0';
    }
    return g;
  }

  const todayGrid    = convertToGrid(todayRaw);
  const tomorrowGrid = convertToGrid(tomorrowRaw);
  const ag = state.selectedDay === 0 ? todayGrid : tomorrowGrid;

  const now = new Date(), ch = now.getHours();
  const dd  = new Date();
  if (state.selectedDay === 1) dd.setDate(now.getDate() + 1);
  const dateEl = document.getElementById('dw-update-date');
  if (dateEl) {
    // Only the time: the date is already in the line ('17.10.2026 16:27' -> '16:27')
    const updated = state.updatedAt ? ` · ${t('updatedAt')} ${state.updatedAt.trim().split(/\s+/).pop()}` : '';
    dateEl.innerText = `${t('scheduleFor')} ${dd.toLocaleDateString(currentLang === 'ua' ? 'uk-UA' : 'en-US')}${updated}`;
  }

  const outNow = Object.keys(todayGrid).length > 0 ? todayGrid[ch] === '1' : false;
  const statusEl = document.getElementById('dw-status-text');
  if (statusEl) statusEl.innerText = outNow ? t('noLight') : t('hasLight');
  const accent = outNow ? '#ff4444' : '#00ff88';
  const dot = document.getElementById('dw-dot');
  if (dot) {
    dot.style.backgroundColor = accent;
    dot.style.boxShadow = `0 0 15px ${accent}, 0 0 5px white`;
  }
  const container = document.getElementById('dw-container');
  if (container) {
    container.style.borderColor = outNow ? 'rgba(255,68,68,0.5)' : 'rgba(0,255,136,0.5)';
  }

  if (state.selectedDay === 1) {
    const agKeys  = Object.keys(ag);
    const allClear = agKeys.length > 0 && Object.values(ag).every(v => v === '0');
    const noData   = agKeys.length === 0;
    if (allClear || noData) {
      const gridRoot = document.getElementById('dw-grid-root');
      if (gridRoot) {
        gridRoot.innerHTML = `
          <div class="dw-no-data">
            <!-- An outage schedule table, crossed out corner to corner -->
            <svg width="90" height="90" viewBox="0 0 90 90" fill="none" stroke="white"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="8" y="12" width="74" height="64" rx="6"/>
              <line x1="8" y1="26" x2="82" y2="26"/>
              <g stroke-width="1.5" opacity="0.55">
                <line x1="30" y1="26" x2="30" y2="76"/>
                <line x1="8" y1="42.7" x2="82" y2="42.7"/>
                <line x1="8" y1="59.3" x2="82" y2="59.3"/>
              </g>
              <g stroke-width="2" opacity="0.75">
                <line x1="14" y1="34.5" x2="24" y2="34.5"/>
                <line x1="14" y1="51" x2="24" y2="51"/>
                <line x1="14" y1="67.5" x2="24" y2="67.5"/>
              </g>
              <g stroke-width="1.5" fill="white" fill-opacity="0.25">
                <rect x="36" y="30" width="18" height="9" rx="2"/>
                <rect x="58" y="47" width="18" height="8" rx="2"/>
                <rect x="40" y="63" width="26" height="9" rx="2"/>
              </g>
              <line x1="10" y1="14" x2="80" y2="74" stroke-width="3"/>
            </svg>
            <div>${t('notPublished')}</div>
          </div>`;
      }
      return;
    }
  }

  let l = '', r = '';
  for (let h = 0; h < 24; h++) {
    const s = ag[h] || '0';
    const indicatorCls = 'dw-indicator' + (s === '1' ? ' power-off' : s === '2' ? ' power-half' : '');
    const activeCls    = (state.selectedDay === 0 && h === ch) ? 'active' : '';
    const row = `<div class="dw-schedule-row ${activeCls}">
      <span class="dw-time">${String(h).padStart(2,'0')}-${String(h+1).padStart(2,'0')}</span>
      <div class="${indicatorCls}"></div>
    </div>`;
    if (h < 12) l += row; else r += row;
  }
  const gridRoot = document.getElementById('dw-grid-root');
  if (gridRoot) gridRoot.innerHTML = `<div class="dw-schedule-col">${l}</div><div class="dw-schedule-col">${r}</div>`;
}
