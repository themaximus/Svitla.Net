const express = require('express');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST; // unset = all interfaces; the desktop launcher passes 127.0.0.1

const DEFAULT_REGION = 'https://www.dtek-dnem.com.ua/ua/shutdowns';

// DTEK pages put their bot protection (Imperva) in front of the schedule, so a plain server request
// often gets a challenge page instead. The public outage-data-ua repository republishes the same
// DisconSchedule.fact data every few minutes; it is used when DTEK refuses. Donetsk is not mirrored.
const MIRROR_BASE = 'https://raw.githubusercontent.com/Baskerville42/outage-data-ua/main/data/';
const REGIONS = new Map([ // page -> mirror file
  ['https://www.dtek-dnem.com.ua/ua/shutdowns', 'dnipro.json'],
  ['https://www.dtek-kem.com.ua/ua/shutdowns',  'kyiv.json'],
  ['https://www.dtek-krem.com.ua/ua/shutdowns', 'kyiv-region.json'],
  ['https://www.dtek-oem.com.ua/ua/shutdowns',  'odesa.json'],
  ['https://www.dtek-dem.com.ua/ua/shutdowns',  null],
]);

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 60_000;
const PROTECTED_RETRY_MS = 15 * 60_000; // after a challenge page, go straight to the mirror for a while

// One entry per whitelisted region, so these cannot grow beyond REGIONS.size
const cache = new Map();          // region -> { time, result }
const inFlight = new Map();       // region -> Promise<result>
const protectedUntil = new Map(); // region -> timestamp

// Serve static files (index.html, style.css, main.js) from the current folder
app.use(express.static(path.join(__dirname)));

// DTEK API Endpoint
app.get('/api/dtek', async (req, res) => {
  const regionUrl = req.query.region || DEFAULT_REGION;

  if (!REGIONS.has(regionUrl)) {
    return res.status(400).json({ status: 'error', message: 'Invalid region' });
  }

  const result = await getSchedule(regionUrl);
  res.status(result.httpStatus || 200).json(result.body);
});

app.get('/api/health', (_, res) => res.json({ ok: true }));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/** Cached and de-duplicated: concurrent clients share one request to DTEK. */
function getSchedule(regionUrl) {
  const cached = cache.get(regionUrl);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return Promise.resolve(cached.result);

  if (inFlight.has(regionUrl)) return inFlight.get(regionUrl);

  const promise = fetchSchedule(regionUrl)
    .then(result => {
      if (result.body.status === 'success') cache.set(regionUrl, { time: Date.now(), result });
      return result;
    })
    .finally(() => inFlight.delete(regionUrl));

  inFlight.set(regionUrl, promise);
  return promise;
}

/** The DTEK page first; the mirror when DTEK is unreachable or answers with its bot protection. */
async function fetchSchedule(regionUrl) {
  let result = null;
  if (!(protectedUntil.get(regionUrl) > Date.now())) {
    result = await fetchUrl(regionUrl).then(parsePage, err => {
      console.error('[proxy] DTEK fetch error:', err.message);
      return { httpStatus: 502, body: { status: 'error', message: 'Connection to DTEK failed' } };
    });
    if (result.body.status === 'success') return result;
    if (result.body.status === 'protected') protectedUntil.set(regionUrl, Date.now() + PROTECTED_RETRY_MS);
  }

  const mirrorFile = REGIONS.get(regionUrl);
  if (!mirrorFile) {
    return result || { body: { status: 'protected', message: 'Bot protection active. Try again later.' } };
  }

  const mirrored = await fetchUrl(MIRROR_BASE + mirrorFile).then(parseMirror, err => {
    console.error('[proxy] mirror fetch error:', err.message);
    return { httpStatus: 502, body: { status: 'error', message: 'Connection to the schedule mirror failed' } };
  });
  // When both fail, DTEK's own answer (e.g. "protected") explains more than the mirror's
  return mirrored.body.status === 'success' || !result ? mirrored : result;
}

function parsePage(html) {
  const match = html.match(/DisconSchedule\.fact\s*=\s*(\{.*?\})\s*(?:;|<\/script>)/s);
  if (!match) {
    if (isBotProtection(html)) {
      return { body: { status: 'protected', message: 'Bot protection active. Try again later.' } };
    }
    return { body: { status: 'error', message: 'Schedule data not found on page' } };
  }
  return parseFact(match[1], 'dtek', fact => fact);
}

// The mirror file wraps the same object: { regionId, lastUpdated, fact, ... }
function parseMirror(json) {
  return parseFact(json, 'mirror', doc => doc.fact);
}

// fact = { data: { <day timestamp>: { GPV1.1: { 1..24: 'yes' | 'no' | 'first' | 'second' } } }, today, update }
function parseFact(json, source, pickFact) {
  let fact;
  try {
    fact = pickFact(JSON.parse(json));
  } catch (e) {
    return { body: { status: 'error', message: 'JSON parsing failed' } };
  }
  if (!fact?.data) return { body: { status: 'error', message: 'Invalid data structure' } };
  return {
    body: { status: 'success', rawFact: fact.data, today: fact.today ?? null, update: fact.update ?? null, source },
  };
}

function isBotProtection(html) {
  return html.includes('cf-turnstile') || html.includes('Just a moment')   // Cloudflare
      || html.includes('_Incapsula_Resource') || html.includes('Incapsula'); // Imperva
}

function fetchUrl(url, redirectsLeft = MAX_REDIRECTS) {
  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
    },
    timeout: REQUEST_TIMEOUT_MS,
  };

  return new Promise((resolve, reject) => {
    const request = https.get(url, options, (response) => {
      const { statusCode, headers } = response;

      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume(); // free the socket
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        const next = new URL(headers.location, url);
        if (next.protocol !== 'https:') return reject(new Error(`Insecure redirect to ${next.href}`));
        return resolve(fetchUrl(next.href, redirectsLeft - 1));
      }

      // Bot protection pages may come with 403/503, so keep the body of any response
      response.setEncoding('utf8'); // decode multi-byte characters split across chunks correctly
      let data = '';
      response.on('data', chunk => {
        data += chunk;
        if (data.length > MAX_BODY_BYTES) request.destroy(new Error('Response too large'));
      });
      response.on('end', () => resolve(data));
      response.on('error', reject);
    });

    request.on('timeout', () => request.destroy(new Error('Request timed out')));
    request.on('error', reject);
  });
}

const server = app.listen(PORT, HOST, () => {
  console.log(`\n  ⚡ DTEK Widget Server running at http://${HOST || 'localhost'}:${PORT}\n`);
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `[server] port ${PORT} is already in use` : err);
  process.exit(1);
});

