/**
 * schedules.js — outage schedules of the DTEK regions, from DTEK's own sources.
 *
 * Every source is turned into the format of the DTEK page's DisconSchedule.fact, which the widget renders:
 *   { data: { <unix s of Kyiv midnight>: { 'GPV1.1': { 1..24: 'yes' | 'no' | 'first' | 'second' | 'maybe' } } },
 *     today: <unix s of today's Kyiv midnight>, update: 'dd.mm.yyyy HH:MM' | null }
 * 'first' / 'second': no power in the first / second half of the hour; 'maybe': an outage is possible.
 * Only today and tomorrow (Kyiv time) are kept: a source that stopped updating must not show an old day as today.
 *
 * Each region lists its sources in order; the first one with today's schedule wins.
 *   dtekPage  - the DTEK region's own page (often behind its bot protection for a server)
 *   yasno     - YASNO's public API (DTEK's supplier for Kyiv and Dnipro, incl. ЦЕК)
 *   factFile  - Baskerville42/outage-data-ua: a copy of the same DisconSchedule.fact from the DTEK pages,
 *               used when DTEK does not let the server read its page
 */

const DTEK = id => `https://www.dtek-${id}.com.ua/ua/shutdowns`;
const OUTAGE_DATA_UA = 'https://raw.githubusercontent.com/Baskerville42/outage-data-ua/main/data/';
const YASNO = (region, dso) =>
  `https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/${region}/dsos/${dso}/planned-outages`;

// The DTEK Dnipro page and its copy also carry ЦЕК's groups, as GPV1001.1 ... GPV1006.2
const CEK_GROUP = /^GPV100(\d+\.\d+)$/;
const dniproOnly = group => (CEK_GROUP.test(group) ? null : group);
const cekOnly = group => { const m = group.match(CEK_GROUP); return m ? 'GPV' + m[1] : null; };

/** In the widget's order. lookup: the DTEK page whose address form finds the group of an address. */
const REGIONS = [
  region('dnem', 'Дніпро та область (ДТЕК)', 'Dnipro & Region (DTEK)', 'Дніпро', 'Dnipro', {
    lookup: DTEK('dnem'),
    sources: [dtekPage(DTEK('dnem'), dniproOnly), yasno(3, 301), factFile(OUTAGE_DATA_UA + 'dnipro.json', dniproOnly)],
  }),
  region('cek', 'Дніпро та область (ЦЕК)', 'Dnipro & Region (CEC)', 'ЦЕК', 'CEC', {
    lookup: DTEK('dnem'),
    sources: [yasno(3, 303), dtekPage(DTEK('dnem'), cekOnly), factFile(OUTAGE_DATA_UA + 'dnipro.json', cekOnly)],
  }),
  region('kem', 'Київ (місто, ДТЕК)', 'Kyiv (City, DTEK)', 'Київ', 'Kyiv', {
    lookup: DTEK('kem'),
    sources: [dtekPage(DTEK('kem')), yasno(25, 902), factFile(OUTAGE_DATA_UA + 'kyiv.json')],
  }),
  region('krem', 'Київська обл. (ДТЕК)', 'Kyiv Region (DTEK)', 'Київ обл.', 'Kyiv Reg.', {
    lookup: DTEK('krem'),
    sources: [dtekPage(DTEK('krem')), factFile(OUTAGE_DATA_UA + 'kyiv-region.json')],
  }),
  region('oem', 'Одеська обл. (ДТЕК)', 'Odesa Region (DTEK)', 'Одеса', 'Odesa', {
    lookup: DTEK('oem'),
    sources: [dtekPage(DTEK('oem')), factFile(OUTAGE_DATA_UA + 'odesa.json')],
  }),
  region('dem', 'Донецька обл. (ДТЕК)', 'Donetsk Region (DTEK)', 'Донецьк', 'Donetsk', {
    lookup: DTEK('dem'),
    sources: [dtekPage(DTEK('dem'))],
  }),
];

const REGIONS_BY_ID = new Map(REGIONS.map(r => [r.id, r]));

function region(id, ua, en, shortUa, shortEn, { lookup = null, sources }) {
  return { id, name: { ua, en }, short: { ua: shortUa, en: shortEn }, lookup, sources };
}

/** What the widget needs to list the regions. */
function regionList() {
  return REGIONS.map(({ id, name, short, lookup }) => ({ id, name, short, lookup }));
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
  let withToday = null; // the source that gives today; sources publish tomorrow at different times
  for (const source of entry.sources) {
    try {
      const fact = keepTodayAndTomorrow(await source.load(fetchText), source.groups);
      if (withToday) {
        if (!takeTomorrow(withToday.fact, fact)) continue;
        return withToday;
      }
      const result = { status: 'success', fact, source: source.name };
      if (fact.data[fact.today] || fact.emergency.today) {
        if (hasTomorrow(fact)) return result;
        withToday = result;
      } else {
        withoutToday = withoutToday || result;
      }
    } catch (err) {
      console.error(`[schedule] ${regionId} ${source.name}: ${err.message}`);
      // DTEK's bot protection explains more to the user than a later source's failure
      if (failure.status !== 'protected') {
        failure = err.protected ? { status: 'protected', message: err.message } : { status: 'error', message: err.message };
      }
    }
  }
  return withToday || withoutToday || failure;
}

function tomorrowKey() {
  return kyivMidnight(tomorrowDate());
}

// A source can list a day with none of the region's groups (the shared Dnipro files)
function hasTomorrow(fact) {
  return fact.emergency.tomorrow || Object.keys(fact.data[tomorrowKey()] || {}).length > 0;
}

/** Copies tomorrow from another source into the fact; false when that source has none either. */
function takeTomorrow(fact, other) {
  if (!hasTomorrow(other)) return false;
  fact.emergency.tomorrow = other.emergency.tomorrow;
  if (other.emergency.tomorrow) fact.emergency.message = fact.emergency.message || other.emergency.message;
  else fact.data[tomorrowKey()] = other.data[tomorrowKey()];
  return true;
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
      const fact = factOf(JSON.parse(match[1]));
      // During emergency outages the page keeps the last schedule and says in a pop-up that it does not apply
      const notice = emergencyNotice(html);
      if (notice) fact.emergency = { dates: [kyivDate(Date.now())], message: notice };
      return fact;
    },
  };
}

// The DTEK pages' pop-up (m-attention): 'За наказом НЕК Укренерго введені екстрені відключення ... Графіки ... не діють'
function emergencyNotice(html) {
  const match = html.match(/class="m-attention__text"[^>]*>([\s\S]*?)<\/div>/);
  if (!match) return null;
  const text = match[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return /екстрен/i.test(text) && /не\s+ді/i.test(text) ? text : null;
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
 *            tomorrow: {...}, updatedOn } }  — minutes since midnight; status 'WaitingForSchedule' = not out yet,
 * 'EmergencyShutdowns' = emergency outages ordered by Ukrenergo, the schedule does not apply (no slots).
 */
function yasno(regionId, dsoId) {
  return {
    name: 'yasno', groups: null,
    async load(fetchText) {
      const answer = JSON.parse(await fetchText(YASNO(regionId, dsoId), 'application/json'));
      const data = {};
      const emergencyDates = new Set();
      let updated = 0;
      for (const [name, group] of Object.entries(answer)) {
        if (!/^\d+\.\d+$/.test(name) || !group) continue;
        updated = Math.max(updated, Date.parse(group.updatedOn) || 0);
        for (const day of [group.today, group.tomorrow]) {
          if (!day || !day.date || day.status === 'WaitingForSchedule') continue;
          if (day.status === 'EmergencyShutdowns') { emergencyDates.add(day.date.slice(0, 10)); continue; }
          const key = kyivMidnight(day.date.slice(0, 10));
          const halves = Array.from({ length: 48 }, (_, i) => slotTypeAt(day.slots, i * 30 + 15));
          (data[key] = data[key] || {})['GPV' + name] = hoursFromHalves(halves.map(t => (t === 'Definite' ? 'off' : t && t !== 'NotPlanned' ? 'maybe' : 'on')));
        }
      }
      const emergency = emergencyDates.size ? { dates: [...emergencyDates], message: EMERGENCY_MESSAGE } : null;
      return { data, update: updated ? formatKyiv(updated) : null, emergency };
    },
  };
}

function slotTypeAt(slots, minute) {
  const slot = (slots || []).find(s => s.start <= minute && minute < s.end);
  return slot ? slot.type : null;
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

const EMERGENCY_MESSAGE = 'За наказом НЕК Укренерго застосовані екстрені відключення. Графіки відключень при цьому не діють.';

function factOf(fact) {
  if (!fact || typeof fact.data !== 'object') throw new Error('Invalid data structure');
  return { data: fact.data, update: fact.update ?? null, emergency: null };
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
// a few hours later); only today and tomorrow are kept, keyed by Kyiv midnight. A day of emergency
// outages has no schedule: whatever a source still lists for it does not apply.
function keepTodayAndTomorrow(fact, groups) {
  const today = kyivDate(Date.now());
  const tomorrow = tomorrowDate();
  const emergencyDates = fact.emergency ? fact.emergency.dates : [];
  const data = {};
  for (const [key, dayGroups] of Object.entries(fact.data || {})) {
    if (!dayGroups || typeof dayGroups !== 'object') continue;
    const day = kyivDate(Number(key) * 1000 + 6 * 3_600_000);
    if (day !== today && day !== tomorrow || emergencyDates.includes(day)) continue;
    const renamed = {};
    for (const [group, hours] of Object.entries(dayGroups)) {
      const name = groups ? groups(group) : group;
      if (name) renamed[name] = hours;
    }
    data[kyivMidnight(day)] = renamed;
  }
  const emergency = {
    today: emergencyDates.includes(today),
    tomorrow: emergencyDates.includes(tomorrow),
    message: fact.emergency ? fact.emergency.message : null,
  };
  return { data, today: kyivMidnight(today), update: fact.update, emergency };
}

// ── Kyiv time ──

const KYIV = 'Europe/Kyiv';
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: KYIV, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: KYIV, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** 'YYYY-MM-DD' of the moment in Kyiv. */
function kyivDate(ms) { return dateFormat.format(ms); }

/** 'YYYY-MM-DD' of the next day in Kyiv (26 h after midnight: days last 23 to 25 hours). */
function tomorrowDate() {
  return kyivDate(Date.now() + 26 * 3_600_000 - msSinceKyivMidnight());
}

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
