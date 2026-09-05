/**
 * Stage: EMBED (optional)
 *
 * Computes chunk embeddings via any OpenAI-compatible /embeddings endpoint
 * (LLM_API_KEY / LLM_BASE_URL / EMBED_MODEL). Vectors are stored as JSON on
 * chunks.embedding with model + status metadata.
 *
 * The engine NEVER synthesizes embeddings locally: without a configured
 * provider, chunks stay 'pending' and retrieval transparently falls back to
 * BM25 + legal query expansion. This is reported in /api/health.
 */
const path = require('path');

const config = {
  baseUrl: (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.EMBED_MODEL || process.env.LLM_MODEL || 'text-embedding-3-small',
  batchSize: 64,
  maxChunks: Number(process.env.EMBED_MAX_CHUNKS || 2000),
};

function embeddingsConfigured() {
  return Boolean(config.apiKey);
}

async function embedChunks(db, log = console.log) {
  if (!embeddingsConfigured()) {
    log('[embed] no embedding provider configured — chunks left as pending (BM25 retrieval active)');
    return { embedded: 0, skipped: true };
  }
  const rows = db
    .prepare("SELECT chunk_id, text FROM chunks WHERE embedding_status = 'pending' LIMIT ?")
    .all(config.maxChunks);
  log(`[embed] embedding ${rows.length} chunks via ${config.baseUrl} (${config.model})`);

  const update = db.prepare('UPDATE chunks SET embedding = ?, embedding_status = ?, embedding_model = ? WHERE chunk_id = ?');
  let embedded = 0;
  for (let i = 0; i < rows.length; i += config.batchSize) {
    const batch = rows.slice(i, i + config.batchSize);
    const res = await fetch(`${config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, input: batch.map((r) => r.text) }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
    const data = await res.json();
    data.data.forEach((d, j) => {
      update.run(JSON.stringify(d.embedding), 'embedded', config.model, batch[j].chunk_id);
      embedded += 1;
    });
  }
  log(`[embed] embedded ${embedded} chunks`);
  return { embedded, skipped: false };
}

module.exports = { embedChunks, embeddingsConfigured, config };
