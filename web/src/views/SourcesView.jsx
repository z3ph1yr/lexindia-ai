import React, { useEffect, useState } from 'react';
import { getProvisions, getCorpus, getStats } from '../api.js';
import Icon from '../components/Icon.jsx';

const TABS = [
  { id: 'browse', label: 'Browse corpus', icon: 'database' },
  { id: 'about', label: 'Statistics & API', icon: 'info' },
];

export default function SourcesView({ openStatute }) {
  const [tab, setTab] = useState('browse');
  return (
    <div className="sources-view">
      <header className="view-head">
        <h1>
          <Icon name="database" size={20} /> Sources
        </h1>
        <p>
          The underlying knowledge base — legislation, provisions, provenance, and status. The engine is
          designed to power other applications through the same API this UI uses.
        </p>
      </header>

      <div className="tab-row">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={13} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'browse' ? <Browse openStatute={openStatute} /> : <About />}
    </div>
  );
}

function Browse({ openStatute }) {
  const [act, setAct] = useState('');
  const [collection, setCollection] = useState('');
  const [verification, setVerification] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [phase, setPhase] = useState('loading');
  const [data, setData] = useState(null);
  const [corpus, setCorpus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getCorpus().then(setCorpus).catch(() => {});
  }, []);

  async function load() {
    setPhase('loading');
    setError('');
    try {
      const d = await getProvisions({ act, collection, verification, q, page, limit: 25 });
      setData(d);
      setPhase('done');
    } catch (e) {
      setError(String(e.message || e));
      setPhase('error');
    }
  }

  useEffect(() => {
    load();
  }, [act, collection, verification, q, page]);

  const pages = data ? Math.ceil(data.total / data.limit) : 0;

  return (
    <>
      {corpus && (
        <div className="corpus-strip">
          {corpus.acts.map((a) => (
            <button
              key={a.act_code}
              className={`corpus-act ${act === a.act_code.toLowerCase() ? 'corpus-act-active' : ''}`}
              onClick={() => { setAct(act === a.act_code.toLowerCase() ? '' : a.act_code.toLowerCase()); setPage(1); }}
            >
              <Icon name="book" size={14} />
              <span>
                <strong>{a.act_code}</strong> {a.name.replace(/^The /, '')}
                <span className="corpus-act-note">{a.status === 'repealed' ? 'historical' : 'in force'}</span>
              </span>
            </button>
          ))}
          {corpus.sources && (
            <div className="corpus-sources">
              {corpus.sources.map((s) => (
                <span key={s.source_id} className={`chip chip-${s.authority}`} title={s.note}>
                  {s.authority}: {s.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="filter-row">
        <input
          className="filter-search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Filter by number, title, or text…"
          aria-label="Filter provisions"
        />
        <select value={collection} onChange={(e) => { setCollection(e.target.value); setPage(1); }} aria-label="Collection">
          <option value="">Core + extended</option>
          <option value="core">Core set</option>
          <option value="extended">Extended</option>
        </select>
        <select value={verification} onChange={(e) => { setVerification(e.target.value); setPage(1); }} aria-label="Verification">
          <option value="">Any verification</option>
          <option value="official">Official text</option>
          <option value="verified">Cross-verified</option>
          <option value="unverified">Unverified</option>
        </select>
      </div>

      {phase === 'loading' && <div className="loading-line"><span className="stage-dot pulse" /> Loading provisions…</div>}
      {phase === 'error' && (
        <div className="error-card"><Icon name="alert" size={18} /><div><strong>Could not load the corpus.</strong><p>{error}</p></div></div>
      )}

      {phase === 'done' && data && (
        <>
          <div className="search-meta">
            {data.total} provisions{act ? ` in ${act.toUpperCase()}` : ''} · page {data.page} of {pages || 1}
          </div>
          {data.results.length === 0 ? (
            <div className="empty-state">
              <Icon name="database" size={28} />
              <strong>No provisions match these filters</strong>
              <p>Loosen the filters or clear the search.</p>
            </div>
          ) : (
            <div className="explorer-list">
              {data.results.map((r, i) => (
                <button
                  key={r.provisionId}
                  className="explorer-row"
                  onClick={() => openStatute({ act: r.act, section: r.section })}
                  style={{ '--stagger': i % 25 }}
                >
                  <span className="source-sec">{r.act} Section {r.section}</span>
                  <span className="explorer-title">{r.title || <em className="missing-text-inline">no title</em>}</span>
                  <span className="explorer-badges">
                    {r.collection === 'core' && <span className="chip chip-core">core</span>}
                    <span className={`chip ${r.status === 'repealed' ? 'chip-repealed' : 'chip-grounded'}`}>
                      {r.status === 'repealed' ? 'historical' : 'in force'}
                    </span>
                    <span className={`chip ${r.verification === 'official' ? 'chip-official' : r.verification === 'verified' ? 'chip-verified' : 'chip-unverified'}`}>
                      {r.verification}
                    </span>
                    {r.source && (
                      <span className="chip chip-source" title={`${r.source.name} (${r.source.authority})`}>
                        {r.source.authority}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
          {pages > 1 && (
            <div className="pager">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button>
              <span>Page {page} / {pages}</span>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function About() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getStats().then(setStats).catch((e) => setError(String(e.message || e)));
  }, []);

  return (
    <div className="about-grid">
      <section className="about-card">
        <h2><Icon name="database" size={15} /> Knowledge base</h2>
        {error && <div className="error-card"><Icon name="alert" size={16} /><div><p>{error}</p></div></div>}
        {stats && (
          <dl className="stat-list">
            <div><dt>Provisions indexed</dt><dd>{stats.provisionsIndexed}</dd></div>
            <div><dt>Retrieval chunks</dt><dd>{stats.chunksIndexed}</dd></div>
            <div><dt>Legislation represented</dt><dd>{stats.legislationRepresented.map((a) => `${a.act_code} (${a.status === 'repealed' ? 'historical' : 'in force'})`).join(', ')}</dd></div>
            <div><dt>Source documents</dt><dd>{stats.sourceDocuments.length} — {stats.sourceDocuments.map((s) => s.name).join(' · ')}</dd></div>
            <div><dt>Successor relations (IPC → BNS)</dt><dd>{stats.successorRelations} curated pairs</dd></div>
            <div><dt>Judicial annotations</dt><dd>{stats.judicialAnnotations}</dd></div>
            <div><dt>Last corpus update</dt><dd>{stats.lastCorpusUpdate ? `${stats.lastCorpusUpdate.finishedAt} (pipeline ${stats.lastCorpusUpdate.status})` : '—'}</dd></div>
            <div><dt>Queries answered (this build)</dt><dd>{stats.queriesLogged}</dd></div>
          </dl>
        )}
      </section>

      <section className="about-card">
        <h2><Icon name="spark" size={15} /> Engine</h2>
        {stats && (
          <dl className="stat-list">
            <div><dt>Retrieval engine</dt><dd>{stats.retrieval.engine} · {stats.retrieval.fusion}</dd></div>
            <div><dt>Retrieval methods</dt><dd>{stats.retrieval.methods.join(' · ')}</dd></div>
            <div><dt>Embeddings</dt><dd>{stats.retrieval.embeddings}</dd></div>
            <div><dt>Answer synthesis</dt><dd>{stats.synthesis}</dd></div>
          </dl>
        )}
        <p className="about-note">
          Every answer is restricted to provisions retrieved from this knowledge base, and every
          citation is validated against the retrieved set before display. Answers are AI-generated
          and grounded in indexed legal sources — verify against the original source before relying
          on this information.
        </p>
      </section>

      <section className="about-card about-wide">
        <h2><Icon name="document" size={15} /> API — the engine powers other applications</h2>
        <p className="about-note">
          The UI is a thin client over a documented REST API. The same endpoints can drive a chat
          product, a document-drafting tool, or an internal compliance tool — no secrets, no
          session state, plain JSON.
        </p>
        <div className="api-example">
          <div className="api-block">
            <div className="api-label">Request</div>
            <pre>{`POST /api/query
Content-Type: application/json

{ "question": "What is the punishment for cheating?",
  "legislation": "bns" }`}</pre>
          </div>
          <div className="api-block">
            <div className="api-label">Response (abridged)</div>
            <pre>{`{
  "answer": {
    "mode": "extractive",
    "structured": {
      "directAnswer": "Under [BNS Section 318], the prescribed consequence is: shall be punished with imprisonment…",
      "applicableLaw": [
        { "provision": "BNS Section 318", "title": "Cheating", "status": "in force" }
      ],
      "explanation": "…",
      "caveats": []
    },
    "citations": [
      { "act": "BNS", "section": "318", "sourceId": "SRC-INDIA-CODE-API",
        "sourceUrl": "https://indiacode.gov.in/items/…" }
    ]
  },
  "sources": [ { "provision": "BNS Section 318", "matchedText": "…", "verification": "official" } ],
  "retrieval": { "engine": "hybrid-rrf", "confidence": "high", "tookMs": 12 },
  "generation": { "mode": "extractive", "citationsValidated": { "kept": 2, "dropped": 0 } }
}`}</pre>
          </div>
        </div>
        <div className="api-endpoints">
          {[
            ['GET', '/api/search?q=&legislation=&section=&limit=', 'hybrid-ranked provisions with "why" metadata'],
            ['POST', '/api/query', 'grounded answer brief + full generation metadata'],
            ['GET', '/api/sections/:act/:section', 'full provision record with provenance chain'],
            ['GET', '/api/provisions?act=&page=', 'paginated corpus browsing'],
            ['GET', '/api/relations', 'curated IPC → BNS successor pairs'],
            ['GET', '/api/stats', 'live engine statistics (this page)'],
          ].map(([m, path, desc]) => (
            <div key={path} className="api-endpoint">
              <span className={`api-method api-${m.toLowerCase()}`}>{m}</span>
              <code>{path}</code>
              <span className="api-desc">{desc}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
