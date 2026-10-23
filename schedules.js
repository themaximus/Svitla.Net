/**
 * schedules.js — outage schedules of every region the widget supports, from several sources.
 *
 * Every source is turned into the format of the DTEK page's DisconSchedule.fact, which the widget renders:
 *   { data: { <unix s of Kyiv midnight>: { 'GPV1.1': { 1..24: 'yes' | 'no' | 'first' | 'second' | 'maybe' } } },
 *     today: <unix s of today's Kyiv midnight>, update: 'dd.mm.yyyy HH:MM' | null }
 * 'first' / 'second': no power in the first / second half of the hour; 'maybe': an outage is possible.
 * Only today and tomorrow (Kyiv time) are kept: a source that stopped updating must not show an old day as today.
 *
 * Each region lists its sources in order; the first one that answers wins.
 *   dtekPage  - the DTEK region's own page (often behind its bot protection for a server)
 *   yasno     - YASNO's public API (DTEK group, Kyiv and Dnipro incl. ЦЕК)
 *   factFile  - a public mirror file in the outage-data-ua format:
 *               Baskerville42/outage-data-ua (DTEK regions), yaroslav2901/OE_OUTAGE_DATA (oblenergos)
 *   mykolaiv  - Mykolaivoblenergo's public API
 * Regions whose operator publishes schedules only as pictures, in Telegram or not at all
 * (Vinnytsia, Volyn, Sumy, Kirovohrad, Chernivtsi, Kherson, Luhansk) are not listed.
 */

const DTEK = id => `https://www.dtek-${id}.com.ua/ua/shutdowns`;
const OUTAGE_DATA_UA = 'https://raw.githubusercontent.com/Baskerville42/outage-data-ua/main/data/';
const OE_OUTAGE_DATA = 'https://raw.githubusercontent.com/yaroslav2901/OE_OUTAGE_DATA/main/data/';
const YASNO = (region, dso) =>
  `https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/${region}/dsos/${dso}/planned-outages`;
const MYKOLAIV_API = 'https://off.energy.mk.ua/api';

// The DTEK Dnipro page and its mirror also carry ЦЕК's groups, as GPV1001.1 ... GPV1006.2
const CEK_GROUP = /^GPV100(\d+\.\d+)$/;
const dniproOnly = group => (CEK_GROUP.test(group) ? null : group);
const cekOnly = group => { const m = group.match(CEK_GROUP); return m ? 'GPV' + m[1] : null; };

/** lookup: the DTEK page whose address form finds the group of an address (desktop app only). */
const REGIONS = [
  region('kem', 'Київ (місто)', 'Kyiv (City)', 'Київ', 'Kyiv', {
    lookup: DTEK('kem'),
    sources: [dtekPage(DTEK('kem')), yasno(25, 902), factFile(OUTAGE_DATA_UA + 'kyiv.json')],
  }),
  region('krem', 'Київська обл.', 'Kyiv Oblast', 'Київ обл.', 'Kyiv Obl.', {
    lookup: DTEK('krem'),
    sources: [dtekPage(DTEK('krem')), factFile(OUTAGE_DATA_UA + 'kyiv-region.json')],
  }),
  region('dnem', 'Дніпропетровська обл. (ДТЕК)', 'Dnipropetrovsk Obl. (DTEK)', 'Дніпро', 'Dnipro', {
    lookup: DTEK('dnem'),
    sources: [dtekPage(DTEK('dnem'), dniproOnly), yasno(3, 301), factFile(OUTAGE_DATA_UA + 'dnipro.json', dniproOnly)],
  }),
  region('cek', 'Дніпропетровська обл. (ЦЕК)', 'Dnipropetrovsk Obl. (CEC)', 'ЦЕК', 'CEC', {
    lookup: DTEK('dnem'),
    sources: [yasno(3, 303), dtekPage(DTEK('dnem'), cekOnly), factFile(OUTAGE_DATA_UA + 'dnipro.json', cekOnly)],
  }),
  region('oem', 'Одеська обл.', 'Odesa Oblast', 'Одеса', 'Odesa', {
    lookup: DTEK('oem'),
    sources: [dtekPage(DTEK('oem')), factFile(OUTAGE_DATA_UA + 'odesa.json')],
  }),
  region('dem', 'Донецька обл.', 'Donetsk Oblast', 'Донецьк', 'Donetsk', {
    lookup: DTEK('dem'),
    sources: [dtekPage(DTEK('dem'))],
  }),
  region('mykolaiv', 'Миколаївська обл.', 'Mykolaiv Oblast', 'Миколаїв', 'Mykolaiv', { sources: [mykolaiv()] }),
  ...[
    ['zhytomyr', 'Житомирська обл.', 'Zhytomyr Oblast', 'Житомир', 'Zhytomyr', 'Zhytomyroblenergo'],
    ['zakarpattia', 'Закарпатська обл.', 'Zakarpattia Oblast', 'Ужгород', 'Uzhhorod', 'Zakarpattiaoblenerho'],
    ['zaporizhzhia', 'Запорізька обл.', 'Zaporizhzhia Oblast', 'Запоріжжя', 'Zaporizhzhia', 'Zaporizhzhiaoblenergo'],
    ['ivano-frankivsk', 'Івано-Франківська обл.', 'Ivano-Frankivsk Oblast', 'Франківськ', 'Ivano-Frankivsk', 'Prykarpattiaoblenerho'],
    ['lviv', 'Львівська обл.', 'Lviv Oblast', 'Львів', 'Lviv', 'Lvivoblenerho'],
    ['poltava', 'Полтавська обл.', 'Poltava Oblast', 'Полтава', 'Poltava', 'Poltavaoblenergo'],
    ['rivne', 'Рівненська обл.', 'Rivne Oblast', 'Рівне', 'Rivne', 'Rivneoblenergo'],
    ['ternopil', 'Тернопільська обл.', 'Ternopil Oblast', 'Тернопіль', 'Ternopil', 'Ternopiloblenerho'],
    ['kharkiv', 'Харківська обл.', 'Kharkiv Oblast', 'Харків', 'Kharkiv', 'Kharkivoblenerho'],
    ['khmelnytskyi', 'Хмельницька обл.', 'Khmelnytskyi Oblast', 'Хмельницький', 'Khmelnytskyi', 'Khmelnytskoblenerho'],
    ['cherkasy', 'Черкаська обл.', 'Cherkasy Oblast', 'Черкаси', 'Cherkasy', 'Cherkasyoblenergo'],
    ['chernihiv', 'Чернігівська обл.', 'Chernihiv Oblast', 'Чернігів', 'Chernihiv', 'Chernihivoblenergo'],
  ].map(([id, ua, en, shortUa, shortEn, file]) =>
    region(id, ua, en, shortUa, shortEn, { sources: [factFile(OE_OUTAGE_DATA + file + '.json')] })),
];

const REGIONS_BY_ID = new Map(REGIONS.map(r => [r.id, r]));

function region(id, ua, en, shortUa, shortEn, { lookup = null, sources }) {
  return { id, name: { ua, en }, short: { ua: shortUa, en: shortEn }, lookup, sources };
}

/** What the widget needs to list the regions: Kyiv city first, then the oblasts alphabetically. */
function regionList() {
  const order = r => (r.id === 'kem' ? '0' : '1' + r.name.ua);
  return REGIONS.map(({ id, name, short, lookup }) => ({ id, name, short, lookup }))
    .sort((a, b) => order(a).localeCompare(order(b), 'uk'));
}

/**
 * The region's schedule from its first source that answers:
 *   { status: 'success', fact, source } | { status: 'protected' | 'error', message }
 * fetchText(url, accept) is the HTTP client of the server.
 */
async function loadSchedule(regionId, fetchText) {
  const entry = REGIONS_BY_ID.get(regionId);
  if (!entry) return { status: 'error', message: 'Invalid region' };
  let failure = { status: 'error', message: 'No source answered' };
  let withoutToday = null; // a source that answered but has nothing for today; a later one may have it
  for (const source of entry.sources) {
    try {
      const fact = keepTodayAndTomorrow(await source.load(fetchText), source.groups);
      const result = { status: 'success', fact, source: source.name };
      if (fact.data[fact.today]) return result;
      withoutToday = withoutToday || result;
    } catch (err) {
      console.error(`[schedule] ${regionId} ${source.name}: ${err.message}`);
      // DTEK's bot protection explains more to the user than a later source's failure
      if (failure.status !== 'protected') {
        failure = err.protected ? { status: 'protected', message: err.message } : { status: 'error', message: err.message };
      }
    }
  }
  return withoutToday || failure;
}

// ── Sources: each has load(fetchText) -> fact (any days, any group names) and an optional groups mapper ──

// After the DTEK page answered with its bot protection, it is skipped for a while
const PROTECTED_RETRY_MS = 15 * 60_000;
const protectedUntil = new Map(); // page url -> time; at most one entry per DTEK page

function dtekPage(url, groups = null) {
  return {
    name: 'dtek', groups,
    async load(fetchText) {
      if (protectedUntil.get(url) > Date.now()) throw botProtection();
      const html = await fetchText(url, 'text/html');
      const match = html.match(/DisconSchedule\.fact\s*=\s*(\{.*?\})\s*(?:;|<\/script>)/s);
      if (!match) {
        if (isBotProtection(html)) {
          protectedUntil.set(url, Date.now() + PROTECTED_RETRY_MS);
          throw botProtection();
        }
        throw new Error('Schedule data not found on page');
      }
      return factOf(JSON.parse(match[1]));
    },
  };
}

// Mirror files wrap the fact: { regionId, lastUpdated, fact, ... }
function factFile(url, groups = null) {
  return {
    name: 'mirror', groups,
    async load(fetchText) {
      return factOf(JSON.parse(await fetchText(url, 'application/json')).fact);
    },
  };
}

/**
 * { '1.1': { today: { slots: [{ start: 0, end: 210, type: 'Definite' | 'NotPlanned' }], date, status },
 *            tomorrow: {...}, updatedOn } }  — minutes since midnight; status 'WaitingForSchedule' = not out yet.
 */
function yasno(regionId, dsoId) {
  return {
    name: 'yasno', groups: null,
    async load(fetchText) {
      const answer = JSON.parse(await fetchText(YASNO(regionId, dsoId), 'application/json'));
      const data = {};
      let updated = 0;
      for (const [name, group] of Object.entries(answer)) {
        if (!/^\d+\.\d+$/.test(name) || !group) continue;
        updated = Math.max(updated, Date.parse(group.updatedOn) || 0);
        for (const day of [group.today, group.tomorrow]) {
          if (!day || !day.date || day.status === 'WaitingForSchedule') continue;
          const key = kyivMidnight(day.date.slice(0, 10));
          const halves = Array.from({ length: 48 }, (_, i) => slotTypeAt(day.slots, i * 30 + 15));
          (data[key] = data[key] || {})['GPV' + name] = hoursFromHalves(halves.map(t => (t === 'Definite' ? 'off' : t && t !== 'NotPlanned' ? 'maybe' : 'on')));
        }
      }
      return { data, update: updated ? formatKyiv(updated) : null };
    },
  };
}

function slotTypeAt(slots, minute) {
  const slot = (slots || []).find(s => s.start <= minute && minute < s.end);
  return slot ? slot.type : null;
}

/**
 * GET /outage-queue/by-type/3  -> [{ id, name: '1.1' }]
 * GET /schedule/time-series    -> [{ id, start: '00:00:00', end: '00:30:00' }]
 * GET /v2/schedule/active      -> [{ from: <Kyiv midnight, UTC ISO>, series: [{ time_series_id, outage_queue_id,
 *                                   type: 'OFF' | 'SURE_OFF' | 'PROBABLY_OFF' | 'ENABLE' }] }]
 * (format as described by the MIT-licensed fastiuk/ukraine-energy-monitor)
 */
function mykolaiv() {
  return {
    name: 'mykolaiv', groups: null,
    async load(fetchText) {
      const get = async path => JSON.parse(await fetchText(MYKOLAIV_API + path, 'application/json'));
      const [queues, series, active] = await Promise.all([
        get('/outage-queue/by-type/3'), get('/schedule/time-series'), get('/v2/schedule/active'),
      ]);
      const groups = new Map(queues.filter(q => /^\d\.\d$/.test(q.name)).map(q => [q.id, 'GPV' + q.name]));
      const halvesOf = new Map(series.map(s => [s.id, halfHoursBetween(s.start, s.end)]));
      const data = {};
      for (const day of active) {
        const key = kyivMidnight(kyivDate(Date.parse(day.from) + 6 * 3_600_000));
        const states = {};
        for (const group of groups.values()) states[group] = Array(48).fill('on');
        for (const cell of day.series || []) {
          const group = groups.get(cell.outage_queue_id);
          const state = cell.type === 'PROBABLY_OFF' ? 'maybe' : cell.type === 'OFF' || cell.type === 'SURE_OFF' ? 'off' : null;
          if (!group || !state) continue;
          for (const half of halvesOf.get(cell.time_series_id) || []) states[group][half] = state;
        }
        data[key] = Object.fromEntries(Object.entries(states).map(([g, halves]) => [g, hoursFromHalves(halves)]));
      }
      return { data, update: null };
    },
  };
}

function halfHoursBetween(start, end) {
  const minutes = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const from = minutes(start), to = minutes(end) || 24 * 60; // '00:00:00' as an end is midnight
  const halves = [];
  for (let m = from; m < to; m += 30) halves.push(Math.floor(m / 30));
  return halves;
}

// 48 half-hours ('on' | 'off' | 'maybe') -> { 1..24: 'yes' | 'no' | 'first' | 'second' | 'maybe' }
function hoursFromHalves(halves) {
  const hours = {};
  for (let h = 0; h < 24; h++) {
    const [a, b] = [halves[h * 2], halves[h * 2 + 1]];
    hours[h + 1] = a === 'off' && b === 'off' ? 'no'
      : a === 'off' ? 'first' : b === 'off' ? 'second'
      : a === 'maybe' || b === 'maybe' ? 'maybe' : 'yes';
  }
  return hours;
}

function factOf(fact) {
  if (!fact || typeof fact.data !== 'object') throw new Error('Invalid data structure');
  return { data: fact.data, update: fact.update ?? null };
}

function botProtection() {
  const err = new Error('Bot protection active. Try again later.');
  err.protected = true;
  return err;
}

function isBotProtection(html) {
  return html.includes('cf-turnstile') || html.includes('Just a moment')   // Cloudflare
      || html.includes('_Incapsula_Resource') || html.includes('Incapsula'); // Imperva
}

// ── Days and groups ──

// Day keys are unix seconds of the day's start (some sources use UTC midnight, so the day is read
// a few hours later); only today and tomorrow are kept, keyed by Kyiv midnight
function keepTodayAndTomorrow(fact, groups) {
  const today = kyivDate(Date.now());
  const tomorrow = kyivDate(Date.now() + 26 * 3_600_000 - msSinceKyivMidnight());
  const data = {};
  for (const [key, dayGroups] of Object.entries(fact.data || {})) {
    if (!dayGroups || typeof dayGroups !== 'object') continue;
    const day = kyivDate(Number(key) * 1000 + 6 * 3_600_000);
    if (day !== today && day !== tomorrow) continue;
    const renamed = {};
    for (const [group, hours] of Object.entries(dayGroups)) {
      const name = groups ? groups(group) : group;
      if (name) renamed[name] = hours;
    }
    data[kyivMidnight(day)] = renamed;
  }
  return { data, today: kyivMidnight(today), update: fact.update };
}

// ── Kyiv time ──

const KYIV = 'Europe/Kyiv';
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: KYIV, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: KYIV, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** 'YYYY-MM-DD' of the moment in Kyiv. */
function kyivDate(ms) { return dateFormat.format(ms); }

function msSinceKyivMidnight() {
  const [h, m] = timeFormat.format(Date.now()).split(':').map(Number);
  return (h * 60 + m) * 60_000;
}

/** Unix seconds of 00:00 Kyiv time on 'YYYY-MM-DD' (Kyiv is UTC+2 in winter, UTC+3 in summer). */
function kyivMidnight(day) {
  const [y, m, d] = day.split('-').map(Number);
  for (const offsetHours of [3, 2]) {
    const ms = Date.UTC(y, m - 1, d) - offsetHours * 3_600_000;
    if (kyivDate(ms) === day && timeFormat.format(ms) === '00:00') return ms / 1000;
  }
  return Date.UTC(y, m - 1, d) / 1000 - 3 * 3600;
}

/** 'dd.mm.yyyy HH:MM' in Kyiv, as DTEK writes its update time. */
function formatKyiv(ms) {
  const [y, m, d] = kyivDate(ms).split('-');
  return `${d}.${m}.${y} ${timeFormat.format(ms)}`;
}

module.exports = { REGIONS_BY_ID, regionList, loadSchedule };
