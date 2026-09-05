# LexIndia AI — Legal AI Engine for Indian Penal Law (MVP)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/z3ph1yr/lexindia-ai)

A working demonstration of the core system: a **provenance-first legal knowledge base**,
**hybrid retrieval**, and **grounded answer synthesis** over real Indian statutory law, behind a
**legal research product interface** with a transferable API + schema.

> **What this is not:** a lawyer, a legal-advice service, or a production system.
> **What it is:** a real, verifiable foundation — every provision traceable to a source,
> every answer grounded in retrieved statutory text with validated citations.

## The product (frontend)

Four minimal navigation areas (`web/`), styled as a serious legal-tech research tool
(paper/ink palette, Newsreader serif for statutory text, restrained motion):

- **Ask** — the hero experience: large natural-language query bar, legislation filter
  (Both / IPC / BNS), example + recent queries, staged progress while researching, then a
  **research brief**: Answer → Applicable law (provision cards) → Explanation → Caveats →
  Sources, with interactive inline citations and a **"How this answer was found"** flow
  (query analysis → retrieved provisions → evidence used → generation).
- **Search** — dedicated provision search with legislation/collection/status filters,
  text previews, relevance labels, retrieval-method transparency per result, and an
  **"Ask AI about this"** jump from any result into the grounded answer workflow.
- **Compare** — IPC ↔ BNS side-by-side for curated successor pairs (verified / indicative
  labelled), with both texts and the mapping note.
- **Sources** — the knowledge base browser plus **Statistics & API**: live engine metrics
  (provisions indexed, legislation, source documents, retrieval methods, last corpus update —
  real values only) and a developer section with a realistic request/response example.

Cross-cutting features demonstrating engine depth:

- **Retrieval inspector** — "View retrieval" on any answer opens the engine's internals:
  the query, every retrieved provision, its relevance, why it was retrieved, and whether it
  was **actually cited in the answer** (invalid citations would have been stripped and
  reported — the panel shows that accounting).
- **Source-level citations** — every legal citation is interactive and opens the exact
  provision: full text, legislation, source, and a verified source link.
- **Related provision** — statute records with verified IPC ↔ BNS relationships expose a
  "Compare side-by-side" jump straight into the comparison view.
- **Trust indicators** — each answer carries: *"AI-generated answer grounded in indexed
  legal sources. Verify against the original source before relying on this information."*
  No accuracy claims are made anywhere.

States handled: staged loading, empty results, no-results, insufficient-evidence refusal
(with refinement hint), errors with retry, source loading.

---

## What is demonstrated

| Client requirement | Where it lives |
| --- | --- |
| Legal knowledge base | SQLite schema (`server/src/schema.sql`) — multi-act, provenance-first; 933 provisions across IPC 1860 + BNS 2023 |
| Search & retrieval | **Hybrid engine** (`server/src/retrieval/hybrid.js`): 5 fused channels (exact citation, BM25, legal-concept expansion, TF-IDF statistical vectors, embeddings when configured) + reciprocal-rank fusion + confidence gating |
| AI-powered querying | Strictly grounded synthesis (`server/src/llm/answer.js`): LLM mode when a key is configured (citations post-validated); deterministic **extractive mode** otherwise — it quotes retrieved statutes and cannot invent law |
| User interface | React research UI (`web/`): answer briefs with inline citations, source rail with **"why this result?"** provenance (channels, relevance labels), statute viewer with provenance panel |
| Architecture for a proprietary product | Chunk-based corpus model, provider-agnostic LLM/embedding layers, documented REST API, portability path to Postgres/pgvector |
| Transferable code / schema / API | Plain SQL schema, reproducible pipeline, test suite (39 tests incl. retrieval-quality evaluation) |

## The knowledge base (corpus strategy: quality over quantity)

**Two acts, every provision traceable:**

- **BNS 2023** (the current penal code, in force 01-07-2024) — all **358** provisions ingested
  from the **official India Code REST API** (Government of India); status `official`.
- **IPC 1860** (historical act, retained for pre-2024 liability) — all **575** provisions from a
  community snapshot, of which **538** are **cross-verified against the official bare-act text**
  (archived India Code PDF) with recorded overlap scores; mismatches and gaps are flagged, never
  papered over (Section 304B is a disclosed `title_only` gap).

On top of the full acts sits a **curated core set** (~107 provisions across both codes) chosen
for penal-law query coverage, plus **42 curated IPC→BNS successor relations** (verified/indicative
confidence recorded), ~2,600 *derived* lexical "related provision" links, and 3 hand-verified
judicial annotations (e.g. Section 124A abeyance, *S.G. Vombatkere*, 2022).

Full details: [`data/raw/PROVENANCE.md`](data/raw/PROVENANCE.md) — the exact provenance strategy,
verification mechanics, and known limitations.

## Ingestion pipeline (reproducible)

```
source registry → fetch (official API / snapshot, cached) → parse → normalize
  → provision extraction → chunking → dual-source verification → enrichment
  (successor map + derived relations + annotations) → embedding (optional) →
  indexing (FTS) → validation → ingest_runs + validation-report.json
```

Run: `node server/src/ingest/pipeline.js [--refresh] [--skip-network]`

- `--skip-network` replays caches only (deterministic, used by the test suite).
- Every run is recorded (`ingest_runs`) and **gated by validation**: missing provision numbers,
  duplicates, empty text, malformed metadata, missing provenance, invalid/dangling relationships,
  orphaned chunks, repeal-status inconsistencies. Errors fail the run (exit 1);
  `data/validation-report.json` holds the full report.
- Never fabricates: if an official source is unreachable, that act is skipped with a warning —
  unverified text is never substituted.

## Retrieval engine (hybrid, with transparency)

```
user query → normalization (statute-flavoured tokenizer, stemming, stopwords)
  ├─ citation channel   exact act-aware provision lookup ("Section 378", "IPC 420", "BNS Section 152")
  ├─ bm25 channel       FTS5 BM25 over chunk text (title-weighted 6:1)
  ├─ expansion channel  BM25 over legal-concept synonyms ("movable" ↔ "moveable",
  │                     "cheating" → "dishonest inducement", "sedition" → "disaffection…")
  ├─ tfidf channel      in-process TF-IDF statistical vectors (matches partially-stated
  │                     terminology: "criminal breach trust" → Section 405)
  └─ vector channel     provider embeddings (cosine) when configured end-to-end
→ reciprocal-rank fusion (weighted) → heading boosts → top evidence → citations
```

- **Transparency:** every result records which channels retrieved it and a plain-language
  `why` list ("Keyword match: 'trust', 'breach'", "Heading match: 'Theft' covers the whole
  query", "Exact citation: IPC Section 420"), plus retrieval methods in human labels.
- **Honest scores:** `score.uiScore` is a normalized *retrieval-relevance* indicator
  (0–1, relative to the best result) explicitly labelled as not representing legal certainty.
- **Confidence gating:** IDF-weighted query-vocabulary coverage over the top results; queries
  whose distinctive terms are absent are refused (low) or cautioned (medium) instead of bluffing.
- **Filters:** `legislation=ipc|bns`, `section=`, `status=`, `collection=`, `limit`.

Search API:

```
GET /api/search?q=...&legislation=ipc|bns&section=378&limit=8&status=in_force&collection=core
```

Retrieval quality is measured, not asserted — `test/retrieval-eval.test.mjs` runs the real
pipeline offline and asserts expected provisions land in the top-k for: exact section,
terminology, paraphrased/conceptual questions, partial terminology, irrelevant queries,
IPC-filtered, BNS-filtered and mixed queries.

## Grounding & anti-hallucination design

**Answer pipeline** (`server/src/answer/` — clean separation):

```
QUESTION → query analysis (answer/analysis.js: tokens, legal-concept expansions,
           act-aware citations, intent) → hybrid retrieval → EVIDENCE SELECTION
           (answer/evidence.js: the only provisions the generator may see)
           → GROUNDED GENERATION (extractive, or LLM with strict grounding)
           → CITATION RESOLUTION (answer/citations.js: every [ACT Section N] resolved
           against retrieved records; anything unresolved is stripped — sentence
           and all) → CITED ANSWER
```

1. **Extractive mode (default, zero config):** no generative step at all — direct answer,
   provision cards, and explanation are composed deterministically from retrieved statutory
   text (quotes + mechanically extracted penalties). Fabrication is structurally impossible.
2. **LLM mode (opt-in, any OpenAI-compatible endpoint):** the model sees *only* the evidence
   pack; the system prompt forbids inventing sections/legislation/citations, requires marking
   interpretation as "Interpretation (not statutory text)", and demands JSON output
   (`directAnswer / explanation / caveats / insufficient`). Every citation is post-validated;
   invented ones (including invented legislation like `[CrPC Section 154]`) are stripped **with the
   sentence that relied on them**, and the drop is reported.
3. **Answer structure:** Answer → Applicable law (provision cards with verification + status)
   → Explanation (quoted statutory language) → Caveats → Sources. Every citation is clickable
   and opens the underlying provision with its provenance chain.
4. **Failure behavior:** insufficient evidence returns exactly — *"I couldn't find sufficient
   supporting provisions in the current legal knowledge base to answer this reliably."* — plus
   a query-refinement hint and zero fabricated law.
5. **"How this answer was generated"** UI panel: query analysis (terms, expansions, intent),
   retrieval (engine, channels, confidence, latency, per-provision scores/methods), generation
   (mode, model, latency, citations kept/dropped), and the grounding guarantee.
6. **Confidence gating:** IDF-weighted vocabulary coverage over top results; weak queries are
   refused (low) or cautioned (medium) instead of bluffing.

## Quality controls & tests

```bash
npm test                     # 47 tests: normalization, chunking, citations, validator,
                             # PDF extraction, hybrid retrieval evaluation, end-to-end API,
                             # answer generation (structure, hallucination guards, refusals)
node server/src/ingest/pipeline.js   # validation gate (errors => non-zero exit)
```

## Quick start

```bash
npm run setup   # installs, ingests (offline caches), builds the UI
npm start       # http://localhost:8787  (serves UI + API, single process)
npm test        # quality controls
```

**Public deployment:** see [`DEPLOY.md`](DEPLOY.md) — Render one-click blueprint (`render.yaml`),
Dockerfile, env-var reference, secrets policy, and a 2-minute post-deploy checklist.
The engine runs with zero configuration and zero API cost (deterministic extractive mode);
LLM synthesis and embeddings are opt-in via env vars.

Dev mode: `npm run dev:server` + `npm run dev:web` (Vite proxies `/api`).
Optional LLM synthesis: `LLM_API_KEY=sk-... LLM_MODEL=gpt-4o-mini npm --prefix server start`.
Optional embeddings (semantic retrieval): set `LLM_API_KEY` + `EMBED_MODEL` and re-run the
pipeline; `chunks.embedding` fills and `/api/health` reports hybrid availability.

## REST API

```
GET  /api/health                       corpus stats by act + active modes
GET  /api/corpus                       acts, sources registry, verification spread, provenance
GET  /api/search?q=&legislation=&section=&limit=&status=&collection=
                                       hybrid-ranked provisions + snippets + why + provenance
POST /api/query  { "question", "legislation"? }   grounded research brief + metadata
GET  /api/sections/:act/:section       full provision record (text, annotations, relations, provenance)
GET  /api/provisions?act=&collection=&verification=&q=&page=   corpus browser (paginated)
GET  /api/relations                    curated IPC→BNS successor pairs (both texts included)
```

## Architecture

```
┌────────────── web/ (React + Vite) ──────────────┐
│  ask bar → research brief (validated citations) │
│  source rail (verification badges, successors)  │
│  statute viewer (provenance panel, relations)   │
└──────────────────────┬──────────────────────────┘
                       │ REST /api
┌──────────────────────▼──────────────────────────┐
│ query layer: confidence gate → grounded synthesis│
│   mode A: LLM (validated citations)              │
│   mode B: extractive (deterministic)             │
├──────────────────────────────────────────────────┤
│ retrieval: citation detection · synonym expansion│
│   · BM25/FTS5 (title-weighted) · [vector seam]   │
├──────────────────────────────────────────────────┤
│ knowledge base: sources → acts → provisions →    │
│   chunks (FTS + embedding columns) · relations · │
│   annotations · ingest_runs · validation report  │
└──────────────────────────────────────────────────┘
```

**Expansion path (by design, not aspiration):**

- *New acts* (BNSS 2023, BSA 2023, CrPC/Evidence Act 1872, Constitution, state acts) = a new
  fetcher + manifest rows in the pipeline; schema unchanged. See `server/src/ingest/`.
- *Vectors*: `chunks.embedding` + the embed stage exist end-to-end; wire reciprocal-rank fusion
  in `retrieval/search.js` once a provider is configured — callers do not change.
- *Judgments*: a judgment is `(provision → document, paragraph → chunk)`; the annotations table
  graduates from curated JSON to ingested case law with reporter citations.
- *Scale*: swap SQLite/FTS5 for Postgres + pgvector (same relations); LLM layer already
  provider-agnostic.

## Honest limitations (deliberate, and stated)

- No BNSS/BSA/CrPC/Evidence coverage yet — procedural questions refuse rather than bluff.
- Retrieval is lexical (BM25 + expansion) until an embedding provider is configured.
- IPC snapshot text, even where verified, should be re-checked against the live Gazette before
  production reliance; the 5 mismatches + 1 gap are recorded in the validation report.
- BNS successor mappings marked `indicative` are flagged for expert confirmation.

## Repository layout

```
data/raw/            corpus snapshot, official-PDF + India Code caches, PROVENANCE.md
data/                legal.db (generated), validation-report.json (generated)
server/src/          schema.sql · db.js · routes.js
server/src/ingest/   pipeline.js · sources.js · manifest.js · normalize.js
                     fetch-indiacode.js · verify-pdf.js · verify-ipc.js
                     relations.js · embed.js · validate.js · bns-mapping.js
server/src/retrieval search.js · hybrid.js · query-understanding.js · query-normalize.js · vector.js
server/src/answer/   index.js · analysis.js · evidence.js · citations.js · extractive.js · generate.js · render.js · text-utils.js
server/src/llm/      provider.js (provider-agnostic chat + test seam)
server/test/         47 tests (unit + pipeline + retrieval evaluation + answer generation + API)
web/src/             App (nav shell) · views/ (Ask, Search, Compare, Sources) · components/ (Brief, SourceCard, StatuteModal, HowPanel, Icon) · styles.css
```
