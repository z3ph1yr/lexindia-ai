/**
 * Vector retrieval channel.
 *
 * Two tiers, honestly labelled:
 *   1. `tfidf`  — statistical term-weight vectors (TF-IDF + light stemming),
 *                 built in-process from the indexed corpus. This is a lexical-
 *                 statistical signal: it matches partially-stated terminology
 *                 and rare terms that BM25's conjunctive-ish matching misses.
 *                 It is NOT deep semantic understanding and is labelled as such.
 *   2. `vector` — true embedding vectors when a provider was configured at
 *                 ingest (chunks.embedding) plus an embeddings endpoint at
 *                 query time. Cosine similarity over provider embeddings.
 */
const { tokenize } = require('./query-normalize');
const { embeddingsConfigured, config } = require('../ingest/embed');

function buildTfidfIndex(db) {
  const rows = db
    .prepare('SELECT chunk_id, provision_id, act_code, provision_no, text FROM chunks')
    .all();
  const docs = [];
  const df = new Map();
  for (const r of rows) {
    const tokens = tokenize(r.text);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    docs.push({ chunk_id: r.chunk_id, provision_id: r.provision_id, act_code: r.act_code, provision_no: r.provision_no, tf });
  }
  const N = Math.max(1, docs.length);
  const vectors = docs.map((d) => {
    const vec = new Map();
    let norm = 0;
    for (const [t, f] of d.tf) {
      const w = (1 + Math.log(f)) * Math.log(1 + N / (df.get(t) || 1));
      vec.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    return { ...d, vec, norm, terms: [...d.tf.keys()] };
  });
  return { vectors, N, df };
}

function tfidfSearch(index, question, { limit = 24, actFilter = null, excludeIds = null } = {}) {
  const qTokens = tokenize(question);
  if (!qTokens.length) return [];
  const qtf = new Map();
  for (const t of qTokens) qtf.set(t, (qtf.get(t) || 0) + 1);
  const qvec = new Map();
  let qnorm = 0;
  for (const [t, f] of qtf) {
    const idf = Math.log(1 + index.N / ((index.df.get(t) || 0) + 1)) + 0.5; // unknown terms get low-but-nonzero weight? no: unknown -> tiny
    if (!(index.df.get(t) > 0)) continue;
    const w = (1 + Math.log(f)) * idf;
    qvec.set(t, w);
    qnorm += w * w;
  }
  if (!qvec.size) return [];
  qnorm = Math.sqrt(qnorm);

  const perProvision = new Map();
  for (const d of index.vectors) {
    if (excludeIds && excludeIds.has(d.provision_id)) continue;
    let dot = 0;
    for (const [t, w] of qvec) {
      const dw = d.vec.get(t);
      if (dw) dot += w * dw;
    }
    if (dot <= 0) continue;
    const score = dot / (qnorm * d.norm);
    const prev = perProvision.get(d.provision_id);
    const entry = { provision_id: d.provision_id, act_code: d.act_code, provision_no: d.provision_no, score, chunk_id: d.chunk_id };
    if (!prev || entry.score > prev.score) perProvision.set(d.provision_id, entry);
  }
  return [...perProvision.values()]
    .filter((e) => !actFilter || e.act_code === actFilter)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** True embedding channel: requires embedded chunks + provider at query time. */
async function embeddingSearch(db, question, { limit = 24, actFilter = null } = {}) {
  if (!embeddingsConfigured()) return null;
  const count = db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE embedding_status = 'embedded'").get().n;
  if (!count) return null;
  const rows = db.prepare('SELECT chunk_id, provision_id, act_code, provision_no, embedding FROM chunks WHERE embedding_status = ?').all('embedded');
  let qv;
  try {
    const res = await fetch(`${config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, input: [question] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    qv = (await res.json()).data[0].embedding;
  } catch {
    return null; // provider unavailable -> channel silently off
  }
  const perProvision = new Map();
  for (const r of rows) {
    let v;
    try { v = JSON.parse(r.embedding); } catch { continue; }
    let dot = 0, a = 0, b = 0;
    const n = Math.min(v.length, qv.length);
    for (let i = 0; i < n; i++) { dot += v[i] * qv[i]; a += v[i] * v[i]; b += qv[i] * qv[i]; }
    const score = a && b ? dot / (Math.sqrt(a) * Math.sqrt(b)) : 0;
    const prev = perProvision.get(r.provision_id);
    const entry = { provision_id: r.provision_id, act_code: r.act_code, provision_no: r.provision_no, score, chunk_id: r.chunk_id };
    if (!prev || entry.score > prev.score) perProvision.set(r.provision_id, entry);
  }
  return [...perProvision.values()]
    .filter((e) => !actFilter || e.act_code === actFilter)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

/** Top contributing terms for transparency ("why"). */
function topOverlapTerms(index, question, text, max = 4) {
  const qTokens = new Set(tokenize(question));
  const t = new Set(tokenize(text || ''));
  const hits = [];
  for (const tok of t) {
    if (qTokens.has(tok)) {
      const idf = Math.log(1 + index.N / ((index.df.get(tok) || 0) + 1));
      hits.push([tok, idf]);
    }
  }
  return hits.sort((a, b) => b[1] - a[1]).slice(0, max).map(([t]) => t);
}

module.exports = { buildTfidfIndex, tfidfSearch, embeddingSearch, topOverlapTerms };
