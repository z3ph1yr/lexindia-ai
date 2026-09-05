/**
 * Hybrid retrieval engine.
 *
 *   user query → normalization
 *              → [citation channel]  exact act-aware provision lookup
 *              → [bm25 channel]      FTS5 BM25, literal query terms
 *              → [expansion channel] FTS5 BM25, legal-concept expanded terms
 *              → [tfidf channel]     statistical term-weight vectors (in-process)
 *              → [vector channel]    provider embeddings (when configured)
 *              → reciprocal-rank fusion → metadata boosts → top evidence
 *
 * Every candidate records WHICH channels retrieved it, so the UI can answer
 * "why this result?" without pretending any number is legal certainty.
 * Scores are fused relative ranks; the normalized `uiScore` is a retrieval-
 * relevance indicator, explicitly not a measure of legal strength.
 */
const { expandQuery, detectCitations, buildMatchExpr, SYNONYMS } = require('./query-understanding');
const { tokenize, displayTokens, lightStem } = require('./query-normalize');
const vector = require('./vector');
const { embeddingsConfigured } = require('../ingest/embed');

const RRF_K = 60;
const CHANNEL_WEIGHTS = {
  citation: 12.0,
  bm25: 2.0,
  expansion: 1.4,
  tfidf: 1.4,
  vector: 2.2,
  title: 0.8,
  titleExact: 3.0,
  phrase: 2.5,
};

/** Build (and memoize) the in-process TF-IDF index for the current DB. */
let cachedIndex = null;
let cachedDb = null;
function getTfidfIndex(db) {
  if (cachedIndex && cachedDb === db) return cachedIndex;
  cachedIndex = vector.buildTfidfIndex(db);
  cachedDb = db;
  return cachedIndex;
}

function normalizeAct(v) {
  if (!v) return null;
  const a = String(v).toLowerCase();
  if (a === 'ipc' || a === 'bns') return a.toUpperCase();
  return null;
}

/** Which quoted/expansion phrases actually appear in a text (for "why" provenance). */
function matchedPhrases(text, candidates) {
  const low = String(text || '').toLowerCase();
  return candidates.filter((c) => low.includes(c.toLowerCase()));
}

/**
 * Main entry.
 * opts: { legislation: 'IPC'|'BNS'|null, section: string|null, limit, status, collection }
 */
async function hybridSearch(db, question, opts = {}) {
  const started = Date.now();
  const h = await runHybrid(db, question, opts);

  // Typo tolerance: one retry with vocabulary-corrected tokens when the first
  // pass fails and no explicit citation is involved.
  const fuzzy =
    !opts._fuzzyRetry &&
    !h.citations.length &&
    (h.confidence === 'low' || h.confidence === 'none');
  if (fuzzy) {
    // correct on STEMMED tokens (expandQuery tokens are raw surface forms)
    const corrections = fuzzyCorrect(getTfidfIndex(db), tokenize(question));
    if (corrections.length) {
      let corrected = String(question);
      for (const [from, to] of corrections) {
        corrected = corrected.replace(new RegExp(`\\b${from}[a-z]{0,3}\\b`, 'gi'), to);
      }
      if (corrected.toLowerCase() !== String(question).toLowerCase()) {
        const retry = await runHybrid(db, corrected, { ...opts, _fuzzyRetry: true });
        if (retry.results.length > 0 && retry.confidence !== 'low') {
          return { ...retry, fuzzyFrom: corrections.map(([f, t]) => `${f}→${t}`), fuzzyQuestion: corrected };
        }
      }
    }
  }
  return h;
}

/** Levenshtein distance ≤ 1 test (cheap early-outs first). */
function withinOne(a, b) {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else { i++; j++; }
  }
  if (i < la || j < lb) edits++;
  return edits <= 1;
}

/** Correct query tokens against the corpus vocabulary (edit distance ≤ 1). */
function fuzzyCorrect(index, tokens) {
  const vocab = [...index.df.keys()];
  const corrections = [];
  for (const tok of tokens) {
    if (tok.length < 4 || /^\d/.test(tok)) continue;
    if (index.df.has(tok)) continue;
    let best = null;
    for (const v of vocab) {
      if (v[0] !== tok[0] || Math.abs(v.length - tok.length) > 1) continue;
      if (withinOne(tok, v)) {
        if (!best || v.length < best.length) best = v;
      }
    }
    if (best) corrections.push([tok, best]);
  }
  return corrections.slice(0, 3);
}

async function runHybrid(db, question, opts = {}) {
  const started = Date.now();
  const limit = Math.min(Math.max(Number(opts.limit) || 8, 1), 25);
  const legislation = normalizeAct(opts.legislation);
  const explicitSection = opts.section ? String(opts.section).trim().toUpperCase() : null;

  const displayTokensQ = displayTokens(question);
  const { tokens, extra } = expandQuery(question);
  const citations = detectCitations(question);
  if (explicitSection && !citations.some((c) => c.no === explicitSection)) {
    citations.push({ act: legislation, no: explicitSection });
  }

  const candidates = new Map(); // provision_id -> entry
  const channelCounts = {};

  const ensure = (id) => {
    let e = candidates.get(id);
    if (!e) {
      e = { provision_id: id, channels: [], why: [], channelScores: {} };
      candidates.set(id, e);
    }
    return e;
  };

  const addChannelResults = (channelName, results, whyBuilder) => {
    channelCounts[channelName] = results.length;
    results.forEach((r, i) => {
      const e = ensure(r.provision_id);
      if (!e.act_code) {
        Object.assign(e, {
          act_code: r.act_code,
          provision_no: r.provision_no,
          provision_id: r.provision_id,
        });
      }
      e.channelScores[channelName] = Math.max(e.channelScores[channelName] || 0, r.score || 0);
      e.channels.push(channelName);
      const why = whyBuilder ? whyBuilder(r, i) : null;
      if (why && !e.why.includes(why)) e.why.push(why);
    });
  };

  /* --------------------------- citation channel --------------------------- */
  const citationHits = [];
  for (const c of citations) {
    if (c.act && legislation && c.act !== legislation) continue; // act-aware filter
    const rows = c.act
      ? db.prepare('SELECT provision_id, act_code, provision_no, title FROM provisions WHERE UPPER(act_code) = ? AND UPPER(provision_no) = ?').all(c.act, c.no)
      : db.prepare('SELECT provision_id, act_code, provision_no, title FROM provisions WHERE UPPER(provision_no) = ?').all(c.no);
    for (const p of rows) {
      if (legislation && p.act_code !== legislation) continue;
      citationHits.push({ provision_id: p.provision_id, act_code: p.act_code, provision_no: p.provision_no, score: 1 });
    }
  }
  addChannelResults('citation', citationHits, (r) => `Exact citation: ${r.act_code} Section ${r.provision_no}`);

  // If the user cited specific provisions and NONE of them exist, lexical
  // channels would only produce noise (e.g. every "punishment" provision for
  // "IPC Section 999"). Refuse cleanly instead.
  const citationMiss = citations.length > 0 && citationHits.length === 0;
  if (citationMiss) {
    return {
      results: [],
      explicitSection,
      legislationFilter: legislation,
      citationNotFound: true,
      channels: { citation: 0, bm25: 0, expansion: 0, tfidf: 0, vector: 'not-configured', titleBoost: 0 },
      expanded: false,
      citations,
      confidence: 'low',
      normalized: { displayTokens: displayTokensQ, stemTokens: tokens, expansions: extra },
      took: Date.now() - started,
    };
  }

  /* ------------------------- bm25 literal channel ------------------------- */
  const literalExpr = buildMatchExpr(tokens, []);
  const bm25Literal = runFts(db, literalExpr, { legislation, limit: 24 });
  const literalTerms = tokens.map(lightStem);
  addChannelResults('bm25', bm25Literal, (r) => {
    const terms = vector.topOverlapTerms(getTfidfIndex(db), displayTokensQ.join(' '), r.provision_text, 3);
    return terms.length ? `Keyword match: “${terms.join('”, “')}” in provision text` : 'Keyword match in provision text';
  });

  /* ------------------------ expansion channel ----------------------------- */
  const expandedOnly = buildMatchExpr([], extra);
  // Not excluded from bm25 results: a provision matching both the literal and
  // the expanded query legitimately ranks higher (double channel credit).
  const bm25Expanded = expandedOnly ? runFts(db, expandedOnly, { legislation, limit: 24 }) : [];
  addChannelResults('expansion', bm25Expanded, (r) => {
    const phrases = matchedPhrases(r.provision_text, extra.filter((x) => x.includes(' ')));
    const words = matchedPhrases(r.provision_text, extra.filter((x) => !x.includes(' ')));
    const hit = phrases[0] || words[0];
    return hit ? `Legal-concept expansion matched “${hit}”` : 'Matched via legal-concept expansion';
  });

  /* --------------------------- tfidf channel ------------------------------ */
  const tfidfHits = vector.tfidfSearch(getTfidfIndex(db), question, { limit: 24, actFilter: legislation });
  addChannelResults('tfidf', tfidfHits, (r) => {
    const terms = vector.topOverlapTerms(getTfidfIndex(db), question, r.provision_text, 3);
    return terms.length ? `Weighted-term similarity (TF-IDF): “${terms.join('”, “')}”` : 'Weighted-term similarity (TF-IDF)';
  });

  /* -------------------------- vector channel ------------------------------ */
  let vectorHits = null;
  try {
    vectorHits = await vector.embeddingSearch(db, question, { limit: 24, actFilter: legislation });
    if (vectorHits) {
      vectorUsed = true;
      addChannelResults('vector', vectorHits, (r) => `Semantic similarity (embeddings) ${r.score ? `· cosine ${r.score.toFixed(2)}` : ''}`.trim());
    }
  } catch {
    vectorHits = null; /* provider off — channel silently absent */
  }

  /* ---------------------- load provision metadata -------------------------- */
  const provStmt = db.prepare(
    `SELECT provision_id, act_code, provision_no, title, normalized_text, chapter, chapter_title,
            collection, text_status, status, verification, verification_score, source_id, source_url,
            verified_against_url, effective_date
     FROM provisions WHERE provision_id = ?`
  );
  const sourceStmt = db.prepare('SELECT source_id, name, authority, url FROM sources WHERE source_id = ?');
  for (const e of candidates.values()) {
    const p = provStmt.get(e.provision_id);
    if (!p) { e.missing = true; continue; }
    Object.assign(e, p);
    // Heading channels: the official title is high-signal metadata. "Exact"
    // requires the heading to cover every query term and stay concise (a
    // short heading that IS the concept, e.g. "Theft" — not every section
    // whose long heading merely mentions it).
    const titleTokens = new Set(tokenize(p.title || ''));
    const qTokens = tokenize(question);
    let titleHits = 0;
    for (const t of qTokens) if (titleTokens.has(t)) titleHits += 1;
    e.titleHits = titleHits;
    if (qTokens.length && titleHits === qTokens.length && titleTokens.size === qTokens.length) {
      e.channels.push('titleExact');
      e.titleExactStrong = titleTokens.size === qTokens.length; // heading IS the concept
      e.why.push(`Heading match: “${p.title}” covers the whole query`);
    } else if (titleHits >= 2) {
      e.channels.push('title');
      e.why.push(`Heading match: “${p.title}” shares ${titleHits} key terms`);
    }
    // Exact-phrase channel: the statutory phrase appears verbatim (compared
    // on lightly-stemmed tokens so "causing" matches "causes" etc.).
    const phrase = String(question).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const phraseWords = phrase.split(' ').filter((w) => w.length > 2);
    if (phraseWords.length >= 2) {
      const stemPhrase = phraseWords.map((w) => (w.length > 3 ? lightStem(w) : w)).join(' ');
      const stemHay = (p.normalized_text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .split(' ')
        .map((w) => (w.length > 3 ? lightStem(w) : w))
        .join(' ');
      if (stemHay.includes(stemPhrase)) {
        e.channels.push('phrase');
        e.why.push(`Exact phrase match: “${phraseWords.join(' ')}” appears verbatim in the provision`);
      }
    }
  }

  /* ------------------------ filters (post-channel) ------------------------- */
  for (const [id, e] of candidates) {
    if (e.missing || (legislation && e.act_code !== legislation) ||
        (opts.status && e.status !== opts.status) ||
        (opts.collection && e.collection !== opts.collection)) {
      candidates.delete(id);
    }
  }

  /* ---------------------------- RRF fusion -------------------------------- */
  const fused = [...candidates.values()].map((e) => {
    let score = 0;
    const perChannel = {};
    for (const ch of new Set(e.channels)) {
      let rank = 0;
      if (ch === 'citation') rank = citationHits.findIndex((r) => r.provision_id === e.provision_id);
      else if (ch === 'bm25') rank = bm25Literal.findIndex((r) => r.provision_id === e.provision_id);
      else if (ch === 'expansion') rank = bm25Expanded.findIndex((r) => r.provision_id === e.provision_id);
      else if (ch === 'tfidf') rank = tfidfHits.findIndex((r) => r.provision_id === e.provision_id);
      else if (ch === 'vector') rank = vectorHits ? vectorHits.findIndex((r) => r.provision_id === e.provision_id) : -1;
      else if (ch === 'title' || ch === 'titleExact') rank = 0;
      else if (ch === 'phrase') rank = 0;
      if (rank < 0) rank = 0;
      let weight = CHANNEL_WEIGHTS[ch] || 1;
      if (ch === 'titleExact' && e.titleExactStrong) weight = 5.0;
      const w = weight / (RRF_K + rank + 1);
      perChannel[ch] = w;
      score += w;
    }
    e.rrf = score;
    e.perChannel = perChannel;
    return e;
  }).sort((a, b) => b.rrf - a.rrf);

  const top = fused.slice(0, limit);
  const maxScore = top[0]?.rrf || 1;
  for (const e of top) {
    e.uiScore = Math.round((e.rrf / maxScore) * 100) / 100;
    e.relevanceLabel = e.uiScore >= 0.85 ? 'strong retrieval match' : e.uiScore >= 0.6 ? 'moderate retrieval match' : e.uiScore >= 0.35 ? 'related' : 'weak';
    e.methods = [...new Set(e.channels)];
  }

  /* --------------------------- confidence gate ----------------------------- */
  // Query vocabulary coverage, synonym-aware and IDF-weighted: a query is
  // 'high' confidence when its DISTINCTIVE terms (or their legal synonyms)
  // are actually present in the retrieved provisions. Generic terms like
  // "procedure" contribute little; rare statute terms like "sedition" a lot.
  const idx = getTfidfIndex(db);
  const idf = (t) => Math.log(1 + idx.N / ((idx.df.get(t) || 0) + 1));
  const qContent = displayTokens(question);
  const matchedSet = new Set();
  for (const e of top.slice(0, 5)) {
    const hay = `${e.normalized_text || ''} ${e.title || ''}`.toLowerCase();
    for (const t of qContent) {
      if (matchedSet.has(t)) continue;
      const stripS = t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t;
      const synWords = (SYNONYMS[t] || []).filter((x) => !x.includes(' '));
      if (hay.includes(t) || hay.includes(stripS) || synWords.some((s) => hay.includes(s))) {
        matchedSet.add(t);
      }
    }
  }
  let wAll = 0;
  let wMatched = 0;
  for (const t of qContent) {
    const w = idf(t);
    wAll += w;
    if (matchedSet.has(t)) wMatched += w;
  }
  const coverage = wAll ? wMatched / wAll : 0;
  // 'High' requires the query's distinctive (rarest-half) terms to be matched;
  // 'medium' requires at least two distinct query terms somewhere in the top
  // results — a single accidental word overlap must not look like a match
  // (definitions sections collect vocabulary and match too easily).
  const sortedIdf = qContent.map((t) => idf(t)).sort((a, b) => b - a);
  const medianIdf = sortedIdf.length ? sortedIdf[Math.floor((sortedIdf.length - 1) / 2)] : 0;
  const distinctive = qContent.filter((t) => idf(t) >= medianIdf);
  const matchedDistinctive = distinctive.filter((t) => matchedSet.has(t)).length;
  const confidence = citations.length || explicitSection
    ? 'high'
    : !top.length
      ? 'none'
      : coverage >= 0.5 && (qContent.length <= 2 ? coverage >= 0.99 : matchedDistinctive >= 2)
        ? 'high'
        : coverage >= 0.4 && matchedSet.size >= 2 && matchedDistinctive >= 2 ? 'medium' : 'low';

  return {
    results: top,
    explicitSection,
    legislationFilter: legislation,
    channels: {
      citation: citationHits.length,
      bm25: bm25Literal.length,
      expansion: bm25Expanded.length,
      tfidf: tfidfHits.length,
      vector: vectorHits ? 'provider-embeddings' : embeddingsConfigured() ? 'provider-configured-not-ingested' : 'not-configured',
      titleBoost: top.filter((e) => e.channels.includes('title') || e.channels.includes('titleExact')).length,
    },
    expanded: extra.length > 0,
    citations,
    confidence,
    normalized: { displayTokens: displayTokensQ, stemTokens: tokens, expansions: extra },
    took: Date.now() - started,
  };
}

// vector channel hits are used directly in fusion (captured above)

function runFts(db, matchExpr, { legislation, limit, exclude } = {}) {
  if (!matchExpr) return [];
  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT c.chunk_id, c.provision_id, c.act_code, c.provision_no, p.normalized_text AS provision_text,
                p.title, p.chapter, p.chapter_title, p.collection, p.status, p.verification,
                bm25(chunks_fts, 6.0, 1.0) AS score
         FROM chunks_fts f
         JOIN chunks c ON c.chunk_id = f.rowid
         JOIN provisions p ON p.provision_id = c.provision_id
         WHERE chunks_fts MATCH ?
         ORDER BY score
         LIMIT ?`
      )
      .all(matchExpr, 60);
  } catch {
    return [];
  }
  const seen = new Map();
  for (const r of rows) {
    if (legislation && r.act_code !== legislation) continue;
    if (exclude && exclude.has(r.provision_id)) continue;
    const prev = seen.get(r.provision_id);
    const entry = { ...r, score: -r.score };
    if (!prev || entry.score > prev.score) seen.set(r.provision_id, entry);
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

function coverageFor(entry, tokens) {
  if (!tokens.length) return 0;
  const hay = `${entry.normalized_text || ''} ${entry.title || ''}`.toLowerCase();
  let hits = 0;
  for (const t of tokens) {
    const stem = t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t;
    if (hay.includes(t.toLowerCase()) || hay.includes(stem.toLowerCase())) hits += 1;
  }
  return hits / tokens.length;
}

module.exports = { hybridSearch, getTfidfIndex };
