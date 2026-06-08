/**
 * main.js — Standalone web port of the DTEK outage schedule widget.
 */

const PROXY_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin;

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

const QUEUES = [
  'GPV1.1','GPV1.2','GPV2.1','GPV2.2','GPV3.1','GPV3.2',
  'GPV4.1','GPV4.2','GPV5.1','GPV5.2','GPV6.1','GPV6.2',
];

const TRANSLATIONS = {
  ua: {
    regionCity: 'Регіон / Місто',
    outageQueue: 'Черга відключень',
    queueLabel: 'Черга ',
    save: 'ЗБЕРЕГТИ',
    cancel: 'СКАСУВАТИ',
    appearance: 'Вигляд',
    bgAnimation: 'Анімація фону',
    performanceImpact: 'Підвищить навантаження на систему',
    blurToggle: 'Прозорість / розмиття',
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
    notPublished: 'Графік ще не опубліковано',
    cfProtection: '☁ Cloudflare захист — спробуйте пізніше',
    proxyUnavailable: '⚠ Проксі-сервер недоступний — запустіть node server.js',
  },
  en: {
    regionCity: 'Region / City',
    outageQueue: 'Outage Group',
    queueLabel: 'Group ',
    save: 'SAVE',
    cancel: 'CANCEL',
    appearance: 'Appearance',
    bgAnimation: 'Background Animation',
    performanceImpact: 'Increases system load',
    blurToggle: 'Transparency / Blur',
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
    notPublished: 'Schedule not published yet',
    cfProtection: '☁ Cloudflare protection — try again later',
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

function saveSettings(patch) {
  const s = Object.assign(loadSettings(), patch);
  localStorage.setItem('dtek-settings', JSON.stringify(s));
  return s;
}

let state = {
  group:     null,
  region:    'https://www.dtek-dnem.com.ua/ua/shutdowns',
  useAurora: false,
  useBlur:   false,
  selectedDay: 0,
  currentRawData: null,
  loading: false,
};

// ── Language Toggle early init ──
function initLanguageSwitcher() {
  const savedLang = localStorage.getItem('app-lang') || 'ua';
  document.documentElement.setAttribute('lang', savedLang);

  const checkbox = document.getElementById('lang-checkbox');
  if (checkbox) {
    checkbox.checked = (savedLang === 'en');
    checkbox.addEventListener('change', () => {
      const targetLang = checkbox.checked ? 'en' : 'ua';
      localStorage.setItem('app-lang', targetLang);
      document.documentElement.setAttribute('lang', targetLang);
      window.dispatchEvent(new CustomEvent('lang-changed', { detail: targetLang }));
    });
  }
}

// ── App Start ──
document.addEventListener('DOMContentLoaded', () => {
  initLanguageSwitcher();

  const root = document.getElementById('dtek-app-root');
  if (!root) return;

  const saved = loadSettings();
  state.group     = saved.group  || null;
  state.region    = saved.region || 'https://www.dtek-dnem.com.ua/ua/shutdowns';
  state.useAurora = saved.useAurora || false;
  state.useBlur   = saved.useBlur   || false;

  renderShell(root);
  applyVisuals();

  if (!state.group || !state.region) {
    openSettings();
  } else {
    startUpdate();
  }

  setInterval(startUpdate, 300_000);

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
        ${QUEUES.map(q =>
          `<option value="${q}" ${q === state.group ? 'selected' : ''}>${q.replace('GPV', t('queueLabel'))}</option>`
        ).join('')}
      </select>

      <button id="dw-save-btn" class="dw-btn-big dw-btn-save">${t('save')}</button>
      <button id="dw-cancel-btn" class="dw-btn-big dw-btn-cancel" style="display:none">${t('cancel')}</button>

      <hr class="dw-divider">

      <div class="dw-overlay-title">${t('appearance')}</div>

      <label class="dw-toggle-row">
        <div class="dw-toggle-label">
          ${t('bgAnimation')}
          <small>${t('performanceImpact')}</small>
        </div>
        <div class="dw-toggle-switch">
          <input type="checkbox" id="dw-chk-aurora" ${state.useAurora ? 'checked' : ''}>
          <div class="dw-toggle-track"></div>
          <div class="dw-toggle-thumb"></div>
        </div>
      </label>

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

      <div class="dw-author-info">
        ${t('author')} | <a href="https://t.me/etojemaximus" target="_blank" class="dw-author-link">@etojemaximus</a>
      </div>
    </div>

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
  document.getElementById('dw-cancel-btn')  .addEventListener('click', closeSettings);

  document.getElementById('dw-save-btn').addEventListener('click', () => {
    state.group     = document.getElementById('dw-group-select').value;
    state.region    = document.getElementById('dw-region-select').value;
    state.useAurora = document.getElementById('dw-chk-aurora').checked;
    state.useBlur   = document.getElementById('dw-chk-blur').checked;
    saveSettings({ group: state.group, region: state.region, useAurora: state.useAurora, useBlur: state.useBlur });
    applyVisuals();
    closeSettings();
    startUpdate();
  });

  document.getElementById('dw-chk-aurora').addEventListener('change', e => { state.useAurora = e.target.checked; applyVisuals(); });
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

function openSettings() {
  const overlay = document.getElementById('dw-overlay');
  if (!overlay) return;
  overlay.classList.add('visible');
  document.getElementById('dw-group-select') .value   = state.group  || 'GPV1.1';
  document.getElementById('dw-region-select').value   = state.region;
  document.getElementById('dw-chk-aurora')  .checked = state.useAurora;
  document.getElementById('dw-chk-blur')    .checked = state.useBlur;
  if (state.group || state.region) {
    document.getElementById('dw-cancel-btn').style.display = 'block';
  }
}

function closeSettings() {
  const overlay = document.getElementById('dw-overlay');
  if (overlay) overlay.classList.remove('visible');
}

function applyVisuals() {
  const c = document.getElementById('dw-container');
  if (!c) return;
  c.classList.toggle('aurora-on',  state.useAurora);
  c.classList.toggle('aurora-off', !state.useAurora);
  c.classList.toggle('blur-on',    state.useBlur);
  c.classList.toggle('blur-off',   !state.useBlur);
}

async function startUpdate() {
  if (!state.group || !state.region) { openSettings(); return; }
  if (state.loading) return;
  state.loading = true;

  const btn = document.getElementById('dw-refresh-btn');
  if (btn) btn.classList.add('loading');
  const statusEl = document.getElementById('dw-status-text');
  if (statusEl) statusEl.innerText = t('updating');

  try {
    const url = `${PROXY_BASE}/api/dtek?region=${encodeURIComponent(state.region)}`;
    const res  = await fetch(url);
    const data = await res.json();

    if (data.status === 'success') {
      state.currentRawData = data.rawFact;
      updateInterface();
    } else if (data.status === 'cloudflare') {
      setError(t('cfProtection'));
    } else {
      setError(data.message || t('error'));
    }
  } catch (e) {
    setError(t('proxyUnavailable'));
  } finally {
    state.loading = false;
    if (btn) btn.classList.remove('loading');
  }
}

function setError(msg) {
  const statusEl = document.getElementById('dw-status-text');
  if (statusEl) statusEl.innerText = t('error');
  const gridRoot = document.getElementById('dw-grid-root');
  if (gridRoot) gridRoot.innerHTML = `<div class="dw-error-msg">${msg}</div>`;
}

function updateInterface() {
  const currentLang = document.documentElement.lang || 'ua';
  const regionShortMap = REGION_SHORT[state.region];
  const regionShort = regionShortMap ? (regionShortMap[currentLang] || regionShortMap.ua) : 'DTEK';
  const groupLabel  = state.group.replace('GPV', '');
  const groupTag    = document.getElementById('dw-group-tag');
  if (groupTag) groupTag.innerText = `${regionShort} · ${groupLabel}`;

  if (!state.currentRawData) return;
  const timestamps   = Object.keys(state.currentRawData).sort();
  const todayRaw     = timestamps[0] ? state.currentRawData[timestamps[0]][state.group] : null;
  const tomorrowRaw  = timestamps[1] ? state.currentRawData[timestamps[1]][state.group] : null;

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
  if (dateEl) dateEl.innerText = `${t('scheduleFor')} ${dd.toLocaleDateString(currentLang === 'ua' ? 'uk-UA' : 'en-US')}`;

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
            <svg width="90" height="90" viewBox="0 0 90 90" fill="none">
              <rect x="8" y="14" width="74" height="52" rx="4" fill="none" stroke="white" stroke-width="2.5"/>
              <path d="M22 14 L22 8 L30 8" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/>
              <path d="M68 14 L68 8 L60 8" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/>
              <line x1="45" y1="66" x2="45" y2="80" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
              <line x1="33" y1="80" x2="57" y2="80" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
              <text x="45" y="50" text-anchor="middle" font-size="28" font-family="Segoe UI,sans-serif" font-weight="700" fill="white" opacity="0.9">?</text>
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
