const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const PORT = Number(process.env.PORT || 8787);
const ROOT = path.resolve(__dirname, '../..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'legal.db');

// Foolproof deploys: a fresh machine has no knowledge base yet — build it
// offline from the committed, cached corpora before opening the server.
// (Serverless deploys ship the prebuilt DB; this never triggers there.)
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

const app = require('./app');

app.listen(PORT, () => {
  console.log(`[legal-ai-engine] API on http://localhost:${PORT}`);
});
