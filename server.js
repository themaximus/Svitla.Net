const express = require('express');
const https = require('https');
const path = require('path');
const { REGIONS_BY_ID, regionList, loadSchedule } = require('./schedules');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST; // unset = all interfaces; the desktop launcher passes 127.0.0.1

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 60_000;

// One entry per known region, so these cannot grow beyond the region list
const cache = new Map();    // region id -> { time, result }
const inFlight = new Map(); // region id -> Promise<result>

// Serve static files (index.html, style.css, main.js) from the current folder
app.use(express.static(path.join(__dirname)));

app.get('/api/regions', (_, res) => res.json(regionList()));

// { status: 'success', rawFact, today, update, source } | { status: 'protected' | 'error', message }
app.get('/api/schedule', async (req, res) => {
  const regionId = String(req.query.region || '');
  if (!REGIONS_BY_ID.has(regionId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid region' });
  }
  const result = await getSchedule(regionId);
  res.status(result.status === 'success' || result.status === 'protected' ? 200 : 502).json(result);
});

app.get('/api/health', (_, res) => res.json({ ok: true }));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/** Cached and de-duplicated: concurrent clients share one request to the sources. */
function getSchedule(regionId) {
  const cached = cache.get(regionId);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return Promise.resolve(cached.result);

  if (inFlight.has(regionId)) return inFlight.get(regionId);

  const promise = loadSchedule(regionId, fetchText)
    .then(loaded => {
      const result = loaded.status !== 'success' ? loaded : {
        status: 'success', rawFact: loaded.fact.data, today: loaded.fact.today, update: loaded.fact.update, source: loaded.source,
      };
      if (result.status === 'success') cache.set(regionId, { time: Date.now(), result });
      return result;
    })
    .finally(() => inFlight.delete(regionId));

  inFlight.set(regionId, promise);
  return promise;
}

/** GET over HTTPS; the body of any status, since bot protection pages come with 403/503. */
function fetchText(url, accept, redirectsLeft = MAX_REDIRECTS) {
  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': accept === 'application/json' ? 'application/json' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
        return resolve(fetchText(next.href, accept, redirectsLeft - 1));
      }
      if (accept === 'application/json' && statusCode >= 400) {
        response.resume();
        return reject(new Error(`HTTP ${statusCode}`));
      }

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
  console.log(`\n  ⚡ Світик Widget server running at http://${HOST || 'localhost'}:${PORT}\n`);
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `[server] port ${PORT} is already in use` : err);
  process.exit(1);
});
