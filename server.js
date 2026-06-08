const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Allow CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  next();
});

// Serve static files (index.html, style.css, main.js) from the current folder
app.use(express.static(path.join(__dirname)));

// DTEK API Endpoint
app.get('/api/dtek', async (req, res) => {
  const regionUrl = req.query.region || 'https://www.dtek-dnem.com.ua/ua/shutdowns';

  if (!/^https:\/\/www\.dtek-[a-z]+\.com\.ua\//.test(regionUrl)) {
    return res.status(400).json({ status: 'error', message: 'Invalid region' });
  }

  fetchUrl(regionUrl, (err, html) => {
    if (err) {
      console.error('[proxy] fetch error:', err.message);
      return res.status(502).json({ status: 'error', message: "Connection to DTEK failed" });
    }

    const match = html.match(/DisconSchedule\.fact\s*=\s*(\{.*?\})\s*(?:;|<\/script>)/s);
    if (!match) {
      if (html.includes('cf-turnstile') || html.includes('Just a moment')) {
        return res.json({ status: 'cloudflare', message: 'Cloudflare protection active. Try again later.' });
      }
      return res.json({ status: 'error', message: 'Schedule data not found on page' });
    }

    try {
      const parsed = JSON.parse(match[1]);
      if (parsed?.data) {
        return res.json({ status: 'success', rawFact: parsed.data });
      }
      return res.json({ status: 'error', message: 'Invalid data structure' });
    } catch (e) {
      return res.json({ status: 'error', message: 'JSON parsing failed' });
    }
  });
});

app.get('/api/health', (_, res) => res.json({ ok: true }));

function fetchUrl(url, cb) {
  const proto = url.startsWith('https') ? https : http;
  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
    },
  };

  proto.get(url, options, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      return fetchUrl(response.headers.location, cb);
    }

    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => cb(null, data));
  }).on('error', cb);
}

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  ⚡ DTEK Widget Server running at http://localhost:${PORT}\n`);
});
