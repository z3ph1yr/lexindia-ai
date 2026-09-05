const path = require('path');
const fs = require('fs');
const express = require('express');
const { rateLimit } = require('./rate-limit');

const ROOT = path.resolve(__dirname, '../..');

const app = express();
app.set('trust proxy', 1); // correct client IPs behind Netlify/Render proxies for rate limiting

// CORS: same-origin deployments need nothing; explicit origins via env only.
const corsOrigin = process.env.CORS_ORIGIN;
if (corsOrigin) {
  app.use((req, res, next) => {
    res.setHeader('access-control-allow-origin', corsOrigin);
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

// Public-demo safeguards (generous limits: a human never hits them).
// Tune via env in tests or private deployments.
const QUERY_MAX = Number(process.env.RATE_LIMIT_QUERY || 20);
const QUERY_BURST = Math.min(QUERY_MAX, Number(process.env.RATE_LIMIT_QUERY_BURST || 8));
app.use('/api/query', rateLimit({ key: 'query', max: QUERY_MAX, windowMs: 60000, burstMax: QUERY_BURST, burstMs: 10000 }));
app.use('/api', rateLimit({ key: 'api', max: Number(process.env.RATE_LIMIT_API || 120), windowMs: 60000, burstMax: 40, burstMs: 10000 }));

app.use('/api', require('./routes'));

// Serve the built web client if present (single-process production mode).
const dist = path.resolve(ROOT, 'web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h' }));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

module.exports = app;
