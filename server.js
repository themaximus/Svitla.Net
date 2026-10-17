const express = require('express');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST; // unset = all interfaces; the desktop launcher passes 127.0.0.1

const DEFAULT_REGION = 'https://www.dtek-dnem.com.ua/ua/shutdowns';
const REGIONS = new Set([
  'https://www.dtek-dnem.com.ua/ua/shutdowns',
  'https://www.dtek-kem.com.ua/ua/shutdowns',
  'https://www.dtek-krem.com.ua/ua/shutdowns',
  'https://www.dtek-oem.com.ua/ua/shutdowns',
  'https://www.dtek-dem.com.ua/ua/shutdowns',
]);

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 60_000;

// One entry per whitelisted region, so the cache cannot grow beyond REGIONS.size
const cache = new Map();    // region -> { time, result }
const inFlight = new Map(); // region -> Promise<result>

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

  const promise = fetchUrl(regionUrl)
    .then(parseSchedule, err => {
      console.error('[proxy] fetch error:', err.message);
      return { httpStatus: 502, body: { status: 'error', message: 'Connection to DTEK failed' } };
    })
    .then(result => {
      if (result.body.status === 'success') cache.set(regionUrl, { time: Date.now(), result });
      return result;
    })
    .finally(() => inFlight.delete(regionUrl));

  inFlight.set(regionUrl, promise);
  return promise;
}

function parseSchedule(html) {
  const match = html.match(/DisconSchedule\.fact\s*=\s*(\{.*?\})\s*(?:;|<\/script>)/s);
  if (!match) {
    if (isBotProtection(html)) {
      return { body: { status: 'protected', message: 'Bot protection active. Try again later.' } };
    }
    return { body: { status: 'error', message: 'Schedule data not found on page' } };
  }

  try {
    const parsed = JSON.parse(match[1]);
    if (parsed?.data) {
      return { body: { status: 'success', rawFact: parsed.data, today: parsed.today ?? null } };
    }
    return { body: { status: 'error', message: 'Invalid data structure' } };
  } catch (e) {
    return { body: { status: 'error', message: 'JSON parsing failed' } };
  }
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

