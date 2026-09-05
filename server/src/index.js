const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const express = require('express');
const { rateLimit } = require('./rate-limit');

const PORT = Number(process.env.PORT || 8787);
const ROOT = path.resolve(__dirname, '../..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'legal.db');

// Foolproof deploys: a fresh machine has no knowledge base yet — build it
// offline from the committed, cached corpora before opening the server.
if (!fs.existsSync(DB_PATH)) {
  console.log('[legal-ai-engine] no knowledge base found — running the ingest pipeline (offline caches)…');
  const res = spawnSync('node', [path.join(__dirname, 'ingest', 'pipeline.js'), '--skip-network'], {
    stdio: 'inherit',
    env: { ...process.env, DB_PATH },
  });
  if (res.status !== 0) {
    console.error('[legal-ai-engine] ingest failed — refusing to serve an empty corpus.');
    process.exit(1);
  }
}

const app = express();
app.set('trust proxy', 1); // correct client IPs behind Render/nginx for rate limiting

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

app.listen(PORT, () => {
  console.log(`[legal-ai-engine] API on http://localhost:${PORT}`);
});
