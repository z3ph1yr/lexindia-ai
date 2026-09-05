-- ============================================================================
-- Legal AI Engine — SQLite schema v2 (provenance-first knowledge base)
--
-- Portable relational model. FTS5 is the only SQLite-specific piece
-- (swap for Postgres tsvector/pgvector at scale; retrieval module
-- abstracts it behind one interface).
-- ============================================================================

PRAGMA journal_mode = WAL;

-- ----------------------------------------------------------------------------
-- Source registry: every provision's provenance resolves to a registered
-- source. authority: 'official' (Government of India) | 'secondary'
-- (established legal archive) | 'community' (consolidation snapshot).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  source_id   TEXT PRIMARY KEY,             -- 'SRC-INDIA-CODE-API'
  name        TEXT NOT NULL,
  authority   TEXT NOT NULL,                -- official | secondary | community
  url         TEXT,
  license     TEXT,
  note        TEXT,
  registered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- Acts. Multi-act by design.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS acts (
  act_id        INTEGER PRIMARY KEY,
  act_code      TEXT NOT NULL UNIQUE,       -- 'IPC', 'BNS'
  name          TEXT NOT NULL,              -- 'Indian Penal Code, 1860'
  year          INTEGER,
  act_number    TEXT,                       -- '45 of 1860' / '45 of 2023'
  jurisdiction  TEXT NOT NULL DEFAULT 'IN',
  status        TEXT NOT NULL,              -- in_force | repealed
  effective_date TEXT,
  repealed_date TEXT,
  successor     TEXT,                       -- replacing act_code, if any
  note          TEXT,
  source_id     TEXT REFERENCES sources(source_id)
);

-- ----------------------------------------------------------------------------
-- Provisions: authoritative unit of law (section / article).
-- full_text = verbatim source text; normalized_text = whitespace/HTML-normalized.
-- collection: 'core' (curated, verified) | 'extended' (full act coverage).
-- verification: 'official' (source is Government of India) |
--               'verified' (dual-source check passed) | 'unverified'.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provisions (
  provision_id   INTEGER PRIMARY KEY,
  act_code       TEXT NOT NULL REFERENCES acts(act_code),
  provision_no   TEXT NOT NULL,             -- '302', '304B', '498A'
  title          TEXT,
  full_text      TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  chapter        TEXT,
  chapter_title  TEXT,
  collection     TEXT NOT NULL DEFAULT 'extended',
  text_status    TEXT NOT NULL DEFAULT 'full',   -- full | title_only
  status         TEXT NOT NULL DEFAULT 'in_force',   -- in_force | repealed
  effective_date TEXT,
  effective_note TEXT,
  source_id      TEXT NOT NULL REFERENCES sources(source_id),
  source_url     TEXT,
  verified_against_url TEXT,
  verification   TEXT NOT NULL DEFAULT 'unverified',
  verification_score REAL,
  repeal_note    INTEGER NOT NULL DEFAULT 0, -- body is a repeal/omission note
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prov_act_no ON provisions(act_code, provision_no);
CREATE INDEX IF NOT EXISTS idx_prov_collection ON provisions(act_code, collection);

-- ----------------------------------------------------------------------------
-- Chunks: retrieval units (long provisions split on clause boundaries).
-- Embedding columns reserved; populated only when an embedding provider is
-- configured (see ingest/embed.js). Never synthesized locally.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chunks (
  chunk_id        INTEGER PRIMARY KEY,
  provision_id    INTEGER NOT NULL REFERENCES provisions(provision_id),
  act_code        TEXT NOT NULL,
  provision_no    TEXT NOT NULL,
  chunk_index     INTEGER NOT NULL DEFAULT 0,
  text            TEXT NOT NULL,
  embedding       TEXT,
  embedding_status TEXT NOT NULL DEFAULT 'pending',  -- pending | embedded | unavailable
  embedding_model TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_prov_idx ON chunks(provision_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_act ON chunks(act_code);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  title,
  tokenize = 'porter unicode61',
  content = 'chunks',
  content_rowid = 'chunk_id'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text, title)
    SELECT c.chunk_id, c.text, p.title
    FROM chunks c JOIN provisions p ON p.provision_id = c.provision_id
    WHERE c.chunk_id = new.chunk_id;
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, title)
    VALUES('delete', old.chunk_id, old.text, '');
END;

-- ----------------------------------------------------------------------------
-- Provision relationships.
-- relation_type: 'successor' (IPC -> BNS, curated) | 'predecessor' (reverse edge)
--                | 'related' (derived lexical)
-- confidence: 'verified' | 'indicative' | 'derived'
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provision_relations (
  relation_id  INTEGER PRIMARY KEY,
  from_act     TEXT NOT NULL,
  from_no      TEXT NOT NULL,
  to_act       TEXT NOT NULL,
  to_no        TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  note         TEXT,
  confidence   TEXT NOT NULL DEFAULT 'indicative',
  score        REAL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rel_from ON provision_relations(from_act, from_no, relation_type);
CREATE INDEX IF NOT EXISTS idx_rel_to ON provision_relations(to_act, to_no, relation_type);

-- ----------------------------------------------------------------------------
-- Annotations: small curated, verified editorial/judicial notes.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS annotations (
  annotation_id INTEGER PRIMARY KEY,
  act_code     TEXT NOT NULL,
  provision_no TEXT NOT NULL,
  kind         TEXT NOT NULL,
  note         TEXT NOT NULL,
  authority    TEXT,
  year         INTEGER,
  confidence   TEXT NOT NULL DEFAULT 'verified',
  source_id    TEXT REFERENCES sources(source_id)
);

-- ----------------------------------------------------------------------------
-- Pipeline runs + validation history (reproducibility audit trail).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingest_runs (
  run_id       INTEGER PRIMARY KEY,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  stages       TEXT,
  counts       TEXT,        -- JSON
  validation   TEXT,        -- JSON summary
  status       TEXT         -- ok | failed
);

CREATE TABLE IF NOT EXISTS query_log (
  query_id    INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  question    TEXT NOT NULL,
  mode        TEXT,
  top_provision TEXT,
  top_score   REAL,
  result_count INTEGER
);
