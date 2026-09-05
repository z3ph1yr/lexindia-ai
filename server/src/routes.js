const express = require('express');
const { db } = require('./db');
const { hybridSearch } = require('./retrieval/hybrid');
const { snippetFor } = require('./retrieval/search');
const { generateAnswer } = require('./answer');
const { llmConfigured } = require('./llm/provider');
const { embeddingsConfigured } = require('./ingest/embed');

const router = express.Router();

const ACT_NAMES = { IPC: 'Indian Penal Code, 1860', BNS: 'Bharatiya Nyaya Sanhita, 2023' };

/* ------------------------------- enrichment ------------------------------- */

function enrich(provisionRow) {
  const successor = db
    .prepare(`SELECT to_act, to_no, note, confidence FROM provision_relations
              WHERE from_act = ? AND UPPER(from_no) = UPPER(?) AND relation_type = 'successor'`)
    .get(provisionRow.act_code, provisionRow.provision_no);
  const related = db
    .prepare(`SELECT to_act, to_no, relation_type, confidence, score FROM provision_relations
              WHERE from_act = ? AND UPPER(from_no) = UPPER(?) AND relation_type IN ('successor','related')
              ORDER BY CASE relation_type WHEN 'successor' THEN 0 ELSE 1 END, score DESC LIMIT 5`)
    .all(provisionRow.act_code, provisionRow.provision_no);
  const annotations = db
    .prepare('SELECT kind, note, authority, year, confidence FROM annotations WHERE act_code = ? AND UPPER(provision_no) = UPPER(?)')
    .all(provisionRow.act_code, provisionRow.provision_no);
  const act = db.prepare('SELECT name, year, act_number, status, effective_date, repealed_date, successor, note FROM acts WHERE act_code = ?').get(provisionRow.act_code);
  const source = db.prepare('SELECT source_id, name, authority, url, license FROM sources WHERE source_id = ?').get(provisionRow.source_id);
  return { successor, related, annotations, act, source };
}

const CHANNEL_LABELS = {
  citation: 'Exact provision match',
  bm25: 'Keyword match',
  expansion: 'Legal-concept expansion',
  tfidf: 'Weighted-term similarity',
  vector: 'Semantic similarity (embeddings)',
  title: 'Heading match',
};

const METHOD_LABELS = {
  citation: 'Exact provision lookup',
  bm25: 'Lexical (BM25)',
  expansion: 'Legal-concept expansion',
  tfidf: 'Statistical vector (TF-IDF)',
  vector: 'Semantic (embeddings)',
  title: 'Heading match (partial)',
  titleExact: 'Heading match (full)',
};

/** Internal hybrid entry -> structured API result. */
function toResult(e, question) {
  const snippet = snippetFor(e.normalized_text || e.title || '', question.toLowerCase().split(/\s+/));
  const en = enrich(e);
  const uiScore = e.uiScore ?? 0;
  return {
    provision: `${e.act_code} Section ${e.provision_no}`,
    act: en.act,
    actCode: e.act_code,
    legislation: ACT_NAMES[e.act_code] || e.act_code,
    section: e.provision_no,
    title: e.title,
    chapter: e.chapter,
    chapterTitle: e.chapter_title,
    text: e.normalized_text,
    matchedText: snippet.text,
    highlight: snippet.highlight,
    score: {
      fused: e.rrf,
      uiScore,
      normalized: true,
      relevanceLabel: e.relevanceLabel,
      note: 'Relative retrieval-relevance score for ranking only — not a measure of legal certainty or strength of the provision.',
      perChannel: e.perChannel,
    },
    retrievalMethod: (e.methods || []).map((m) => METHOD_LABELS[m] || m),
    channels: e.methods || [],
    why: e.why || [],
    provision_id: e.provision_id,
    collection: e.collection,
    status: e.status,
    verification: e.verification,
    verification_score: e.verification_score,
    effectiveDate: e.effective_date,
    bnsSuccessor: en.successor
      ? { to_section: `${en.successor.to_act} Section ${en.successor.to_no}`, note: en.successor.note, confidence: en.successor.confidence }
      : null,
    related: en.related.map((r) => ({ act: r.to_act, section: r.to_no, relationType: r.relation_type, confidence: r.confidence })),
    annotations: en.annotations,
    source: en.source
      ? {
          id: en.source.source_id,
          name: en.source.name,
          authority: en.source.authority,
          sourceUrl: e.source_url || en.source.url || null,
          verifiedAgainstUrl: e.verified_against_url || null,
        }
      : null,
  };
}

/* ---------------------------------- health -------------------------------- */

router.get('/health', (req, res) => {
  const acts = db.prepare('SELECT COUNT(*) AS n FROM acts').get().n;
  const provisions = db.prepare('SELECT COUNT(*) AS n FROM provisions').get().n;
  const chunks = db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
  const embedded = db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE embedding_status = 'embedded'").get().n;
  const byAct = db.prepare("SELECT act_code, COUNT(*) AS n, SUM(collection = 'core') AS core FROM provisions GROUP BY act_code").all();
  res.json({
    status: 'ok',
    corpus: { acts, provisions, chunks, embedded, byAct },
    retrieval: {
      engine: 'hybrid-rrf',
      channels: ['citation', 'bm25', 'expansion', 'tfidf'].concat(embedded > 0 ? ['vector'] : []),
      vectors: embedded > 0 ? 'provider-embeddings' : embeddingsConfigured() ? 'provider-configured-not-ingested' : 'not-configured',
      fusion: 'reciprocal-rank',
    },
    synthesis: llmConfigured() ? 'llm-grounded' : 'extractive-deterministic',
  });
});

/* ------------------------------ engine stats ------------------------------ */

router.get('/stats', (req, res) => {
  const provisions = db.prepare('SELECT COUNT(*) AS n FROM provisions').get().n;
  const chunks = db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
  const acts = db.prepare('SELECT act_code, name, year, status, effective_date, repealed_date FROM acts').all();
  const sourceDocs = db.prepare('SELECT source_id, name, authority, url FROM sources').all();
  const relations = db.prepare("SELECT COUNT(*) AS n FROM provision_relations WHERE relation_type = 'successor'").get().n;
  const annotations = db.prepare('SELECT COUNT(*) AS n FROM annotations').get().n;
  const embedded = db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE embedding_status = 'embedded'").get().n;
  const lastRun = db.prepare('SELECT finished_at, status, counts FROM ingest_runs ORDER BY run_id DESC LIMIT 1').get();
  const queriesLogged = db.prepare('SELECT COUNT(*) AS n FROM query_log').get().n;
  let lastIngest = null;
  if (lastRun && lastRun.finished_at) {
    let counts = null;
    try { counts = JSON.parse(lastRun.counts); } catch {}
    lastIngest = { finishedAt: lastRun.finished_at, status: lastRun.status, provisionsIndexed: counts ? counts.provisions : null };
  }
  res.json({
    provisionsIndexed: provisions,
    chunksIndexed: chunks,
    legislationRepresented: acts,
    sourceDocuments: sourceDocs,
    successorRelations: relations,
    judicialAnnotations: annotations,
    retrieval: {
      engine: 'hybrid-rrf',
      methods: ['exact citation', 'BM25 (FTS5)', 'legal-concept expansion', 'TF-IDF statistical vectors'].concat(
        embedded > 0 ? ['provider embeddings'] : []
      ),
      fusion: 'reciprocal-rank fusion',
      embeddings: embedded > 0 ? `${embedded} chunks embedded` : 'not configured (lexical modes active)',
    },
    synthesis: llmConfigured() ? 'LLM synthesis, grounded + citation-validated' : 'deterministic extractive mode',
    lastCorpusUpdate: lastIngest,
    queriesLogged,
  });
});

/* --------------------------------- corpus --------------------------------- */

router.get('/corpus', (req, res) => {
  const acts = db.prepare('SELECT act_code, name, year, act_number, status, effective_date, repealed_date, successor, note FROM acts').all();
  const prov = db.prepare('SELECT act_code, collection, verification, COUNT(*) AS n FROM provisions GROUP BY act_code, collection, verification').all();
  const chunks = db.prepare('SELECT act_code, COUNT(*) AS n FROM chunks GROUP BY act_code').all();
  const relations = db.prepare('SELECT relation_type, confidence, COUNT(*) AS n FROM provision_relations GROUP BY relation_type, confidence').all();
  const sources = db.prepare('SELECT source_id, name, authority, url, license, note FROM sources').all();
  const lastRun = db.prepare('SELECT finished_at, status, counts FROM ingest_runs ORDER BY run_id DESC LIMIT 1').get();
  const queriesLogged = db.prepare('SELECT COUNT(*) AS n FROM query_log').get().n;
  let lastIngest = null;
  if (lastRun && lastRun.finished_at) {
    let counts = null;
    try { counts = JSON.parse(lastRun.counts); } catch {}
    lastIngest = { finishedAt: lastRun.finished_at, status: lastRun.status, provisions: counts ? counts.provisions : null };
  }
  res.json({
    acts,
    provisions: prov,
    chunks,
    relations,
    sources,
    lastIngest,
    queriesLogged,
    coverage: {
      demo: 'Two acts: IPC 1860 (historical; community snapshot, core cross-verified) and BNS 2023 (current law; official India Code text). Curated core set cross-verified against official/secondary sources.',
      production: 'BNS/BNSS/BSA 2023, CrPC/Evidence Act 1872, Constitution, judgments corpus — same schema, same pipeline, new ingest rows.',
    },
    provenance: 'Every provision carries source, source URL, verification status and evidence URL where verified. See data/raw/PROVENANCE.md.',
  });
});

/* --------------------------------- search --------------------------------- */
/**
 * GET /api/search
 *   q           free-text query (natural language, terminology, partial terms)
 *   section     optional exact provision number ("378")
 *   legislation optional filter: ipc | bns   (default: both)
 *   limit       optional result cap (default 8, max 25)
 *   status      optional filter: in_force | repealed | any (default any)
 *   collection  optional filter: core | extended
 */
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const section = req.query.section ? String(req.query.section) : null;
  if (!q && !section) return res.status(400).json({ error: 'Missing q or section' });
  if (q.length > 2000) return res.status(400).json({ error: 'Query too long' });
  const limit = Math.min(Number(req.query.limit) || 8, 25);

  const opts = {
    legislation: req.query.legislation ? String(req.query.legislation) : null,
    section,
    limit,
    status: req.query.status && req.query.status !== 'any' ? String(req.query.status) : null,
    collection: req.query.collection ? String(req.query.collection) : null,
  };
  if (opts.legislation && !['ipc', 'bns'].includes(opts.legislation.toLowerCase())) {
    return res.status(400).json({ error: "legislation must be 'ipc' or 'bns'" });
  }

  const h = await hybridSearch(db, q || `section ${section}`, opts);
  const results = h.results.map((e) => toResult(e, q || `section ${section}`));

  // Exact-section miss: offer the same number found in the other act.
  let note;
  if (section && !results.length) {
    const other = db
      .prepare('SELECT act_code, provision_no, title FROM provisions WHERE UPPER(provision_no) = UPPER(?)')
      .all(section);
    if (other.length) {
      note = `No provision Section ${section} in the requested legislation. Found Section ${section} in: ${other.map((o) => o.act_code).join(', ')}.`;
    } else {
      note = `No provision Section ${section} in the corpus.`;
    }
  }

  res.json({
    query: q || null,
    section: section || null,
    legislation: opts.legislation || 'both',
    normalized: h.normalized,
    expanded: h.expanded,
    citationsDetected: h.citations,
    results,
    retrieval: {
      engine: 'hybrid-rrf',
      channels: h.channels,
      expanded: h.expanded,
      confidence: h.confidence,
      tookMs: h.took,
      scoreSemantics: 'Fused reciprocal ranks across channels; uiScore is a normalized retrieval-relevance indicator, not legal certainty.',
    },
    note: note || undefined,
    meta: { retrievalEngine: 'hybrid-rrf', confidence: h.confidence, candidates: results.length },
  });
});

/* --------------------------------- query ---------------------------------- */

router.post('/query', express.json({ limit: '64kb' }), async (req, res) => {
  const question = String((req.body && req.body.question) || '').trim();
  if (!question) return res.status(400).json({ error: 'Missing question' });
  if (question.length > 2000) return res.status(400).json({ error: 'Question too long' });
  const legislation = req.body && req.body.legislation && ['ipc', 'bns'].includes(String(req.body.legislation).toLowerCase())
    ? String(req.body.legislation).toLowerCase()
    : null;

  const started = Date.now();
  const h = await hybridSearch(db, question, { limit: 8, legislation });

  const sourcePayloads = h.results.map((e) => toResult(e, question));
  const { answer, analysis, generation } = await generateAnswer(question, h, sourcePayloads);

  const sources = sourcePayloads.map((p, i) => ({ ...p, rank: i + 1 }));

  db.prepare('INSERT INTO query_log (question, mode, top_provision, top_score, result_count) VALUES (?,?,?,?,?)').run(
    question,
    answer.mode,
    h.results[0] ? `${h.results[0].act_code} ${h.results[0].provision_no}` : null,
    h.results[0] ? h.results[0].rrf : null,
    h.results.length
  );

  res.json({
    question,
    analysis: {
      displayTokens: analysis.displayTokens,
      expansions: analysis.expansions,
      citationsDetected: analysis.citations,
      intents: analysis.intents,
      legislationFilter: analysis.legislationFilter,
    },
    answer,
    sources,
    retrieval: {
      engine: 'hybrid-rrf',
      channels: h.channels,
      expanded: h.expanded,
      confidence: h.confidence,
      tookMs: h.took,
      fuzzyFrom: h.fuzzyFrom,
      scoreSemantics: 'Fused reciprocal ranks across channels; scores are retrieval-relevance indicators, not legal certainty.',
      methods: [...new Set(h.results.flatMap((r) => r.channels))],
      scores: h.results.map((r) => ({ provision: `${r.act_code} Section ${r.provision_no}`, uiScore: r.uiScore, channels: r.channels })),
    },
    generation,
    meta: {
      latencyMs: Date.now() - started,
      disclaimer: 'Research assistance over statutory text. Not legal advice, and not a substitute for a licensed advocate.',
    },
  });
});

/* -------------------------------- sections -------------------------------- */

/* ------------------------- relations (compare view) ----------------------- */

router.get('/relations', (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.from_act, r.from_no, r.to_act, r.to_no, r.note, r.confidence,
              p1.title AS from_title, p1.normalized_text AS from_text, p1.status AS from_status,
              p1.verification AS from_verification, p1.provision_id AS from_id,
              p2.title AS to_title, p2.normalized_text AS to_text, p2.status AS to_status,
              p2.verification AS to_verification, p2.provision_id AS to_id,
              p1.source_id AS from_source, p2.source_id AS to_source
       FROM provision_relations r
       JOIN provisions p1 ON p1.act_code = r.from_act AND UPPER(p1.provision_no) = UPPER(r.from_no)
       JOIN provisions p2 ON p2.act_code = r.to_act AND UPPER(p2.provision_no) = UPPER(r.to_no)
       WHERE r.relation_type = 'successor'
       ORDER BY CAST(r.from_no AS INTEGER), r.from_no`
    )
    .all();
  const trim = (t) => (t && t.length > 1400 ? t.slice(0, 1400) + ' …' : t);
  res.json({
    pairs: rows.map((r) => ({
      ipc: { act: r.from_act, section: r.from_no, title: r.from_title, text: trim(r.from_text), status: r.from_status, verification: r.from_verification, provisionId: r.from_id, sourceId: r.from_source },
      bns: { act: r.to_act, section: r.to_no, title: r.to_title, text: trim(r.to_text), status: r.to_status, verification: r.to_verification, provisionId: r.to_id, sourceId: r.to_source },
      note: r.note,
      confidence: r.confidence,
    })),
  });
});

/* ----------------------- provisions (source explorer) --------------------- */

router.get('/provisions', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const clauses = [];
  const params = [];
  if (req.query.act && ['ipc', 'bns'].includes(String(req.query.act).toLowerCase())) {
    clauses.push('UPPER(act_code) = UPPER(?)');
    params.push(String(req.query.act));
  }
  if (req.query.collection && ['core', 'extended'].includes(String(req.query.collection))) {
    clauses.push('collection = ?');
    params.push(String(req.query.collection));
  }
  if (req.query.verification && ['official', 'verified', 'unverified'].includes(String(req.query.verification))) {
    clauses.push('verification = ?');
    params.push(String(req.query.verification));
  }
  if (req.query.q && String(req.query.q).trim()) {
    clauses.push('(provision_no LIKE ? OR title LIKE ? OR normalized_text LIKE ?)');
    const like = `%${String(req.query.q).trim()}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM provisions ${where}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT provision_id, act_code, provision_no, title, normalized_text, collection, text_status,
              status, verification, verification_score, source_id, source_url, updated_at
       FROM provisions ${where}
       ORDER BY act_code, CAST(provision_no AS INTEGER), provision_no
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, (page - 1) * limit);
  const sourceNames = db.prepare('SELECT source_id, name, authority FROM sources').all();
  const srcMap = Object.fromEntries(sourceNames.map((s) => [s.source_id, s]));
  res.json({
    total,
    page,
    limit,
    results: rows.map((r) => ({
      provisionId: r.provision_id,
      act: r.act_code,
      legislation: ACT_NAMES[r.act_code] || r.act_code,
      section: r.provision_no,
      title: r.title,
      preview: (r.normalized_text || '').slice(0, 160),
      collection: r.collection,
      textStatus: r.text_status,
      status: r.status,
      verification: r.verification,
      verificationScore: r.verification_score,
      source: srcMap[r.source_id] || null,
      sourceUrl: r.source_url,
      updatedAt: r.updated_at,
    })),
  });
});

router.get('/sections/:act/:section', (req, res) => {
  const p = db
    .prepare(`SELECT provision_id, act_code, provision_no, title, normalized_text, full_text, chapter, chapter_title,
              collection, text_status, status, effective_date, effective_note, source_id, source_url,
              verified_against_url, verification, verification_score, updated_at
              FROM provisions WHERE UPPER(act_code) = UPPER(?) AND UPPER(provision_no) = UPPER(?)`)
    .get(req.params.act, req.params.section);
  if (!p) return res.status(404).json({ error: 'Provision not found in corpus' });
  const entry = {
    provision_id: p.provision_id, act_code: p.act_code, provision_no: p.provision_no, title: p.title,
    chapter: p.chapter, chapter_title: p.chapter_title, normalized_text: p.normalized_text,
    collection: p.collection, status: p.status, verification: p.verification,
    verification_score: p.verification_score, source_id: p.source_id, source_url: p.source_url,
    verified_against_url: p.verified_against_url, effective_date: p.effective_date,
  };
  const payload = toResult(entry, p.title || '');
  payload.full_text = p.full_text;
  payload.normalized_text = p.normalized_text;
  payload.text_status = p.text_status;
  payload.updatedAt = p.updated_at;
  delete payload.matchedText;
  delete payload.score;
  delete payload.retrievalMethod;
  delete payload.channels;
  delete payload.why;
  res.json(payload);
});

module.exports = router;
