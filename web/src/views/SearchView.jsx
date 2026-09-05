import React, { useEffect, useRef, useState } from 'react';
import { search } from '../api.js';
import Icon from '../components/Icon.jsx';
import { Highlight } from '../App.jsx';

const EXAMPLES = ['criminal conspiracy', 'grievous hurt', 'dowry death', 'extortion fear of injury'];

export default function SearchView({ openStatute, onAskAbout }) {
  const [q, setQ] = useState('');
  const [legislation, setLegislation] = useState('');
  const [collection, setCollection] = useState('');
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState('idle');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const firstRun = useRef(true);

  async function run(query, { legislation: leg, collection: col, status: st } = {}) {
    const clean = String(query || '').trim();
    if (!clean) return;
    setPhase('loading');
    setError('');
    try {
      const d = await search(clean, { limit: 12, legislation: leg, collection: col, status: st });
      setData({ ...d, searchedQ: clean });
      setPhase('done');
    } catch (e) {
      setError(String(e.message || e));
      setPhase('error');
    }
  }

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      run('theft', { legislation: '' });
      setQ('theft');
    }
  }, []);

  const submit = (e) => {
    e.preventDefault();
    run(q, { legislation, collection, status });
  };
  const refilter = (setter) => (value) => {
    setter(value);
    if (q.trim()) run(q, { legislation: legislation || undefined, collection: collection || undefined, status: status || undefined });
  };

  return (
    <div className="search-view">
      <header className="view-head">
        <h1>
          <Icon name="search" size={20} /> Legal search
        </h1>
        <p>Precise provision lookup across both acts — with provenance on every result.</p>
      </header>

      <form className="searchbar" onSubmit={submit}>
        <Icon name="search" size={16} className="askbar-icon" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search provisions — terminology, section number, or plain words"
          aria-label="Search provisions"
        />
        <button type="submit" disabled={!q.trim() || phase === 'loading'}>
          {phase === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>

      <div className="filter-row">
        <span className="filter-label"><Icon name="filter" size={12} /> Filters</span>
        <select value={legislation} onChange={(e) => { setLegislation(e.target.value); if (q.trim()) run(q, { legislation: e.target.value || undefined, collection: collection || undefined, status: status || undefined }); }} aria-label="Legislation">
          <option value="">Both acts</option>
          <option value="ipc">IPC only</option>
          <option value="bns">BNS only</option>
        </select>
        <select value={collection} onChange={(e) => { setCollection(e.target.value); if (q.trim()) run(q, { legislation: legislation || undefined, collection: e.target.value || undefined, status: status || undefined }); }} aria-label="Collection">
          <option value="">Core + extended</option>
          <option value="core">Core set</option>
          <option value="extended">Extended</option>
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); if (q.trim()) run(q, { legislation: legislation || undefined, collection: collection || undefined, status: e.target.value || undefined }); }} aria-label="Status">
          <option value="">Any status</option>
          <option value="in_force">In force</option>
          <option value="repealed">Historical</option>
        </select>
      </div>

      {phase === 'idle' && (
        <div className="examples examples-left">
          {EXAMPLES.map((e) => (
            <button key={e} className="example" onClick={() => { setQ(e); run(e); }}>
              {e}
            </button>
          ))}
        </div>
      )}

      {phase === 'loading' && <div className="loading-line"><span className="stage-dot pulse" /> Searching the corpus…</div>}
      {phase === 'error' && (
        <div className="error-card"><Icon name="alert" size={18} /><div><strong>Search failed.</strong><p>{error}</p></div></div>
      )}

      {phase === 'done' && data && (
        <>
          <div className="search-meta">
            {data.results.length === 0 ? (
              <span>No provisions matched “{data.searchedQ}”.</span>
            ) : (
              <span>
                {data.results.length} provisions for “{data.searchedQ}” · {data.retrieval.confidence} confidence · {data.retrieval.tookMs} ms
              </span>
            )}
          </div>
          {data.results.length === 0 ? (
            <div className="empty-state">
              <Icon name="search" size={28} />
              <strong>No results</strong>
              <p>Try different terminology, a section number, or clear the filters.</p>
            </div>
          ) : (
            <div className="search-results">
              {data.results.map((r, i) => (
                <button key={r.actCode + r.section} className="search-result" onClick={() => openStatute({ act: r.actCode, section: r.section })} style={{ '--stagger': i }}>
                  <div className="sr-top">
                    <span className="source-sec">{r.provision}</span>
                    <span className="sr-badges">
                      {r.status === 'repealed' && <span className="chip chip-repealed">historical</span>}
                      <span className={`chip ${r.verification === 'official' ? 'chip-official' : r.verification === 'verified' ? 'chip-verified' : 'chip-unverified'}`}>
                        {r.verification}
                      </span>
                      {r.bnsSuccessor && <span className="chip chip-bns" title={`Successor: ${r.bnsSuccessor.note || ''}`}>→ {r.bnsSuccessor.to_section}</span>}
                    </span>
                  </div>
                  <div className="sr-title">{r.title}</div>
                  <p className="sr-preview">
                    <Highlight text={r.matchedText} terms={r.highlight || []} />
                  </p>
                  <div className="sr-foot">
                    <span className="sr-leg">{r.legislation}</span>
                    <span className="sr-methods">{r.retrievalMethod.join(' · ')}</span>
                    <span className={`relevance rel-${r.score.relevanceLabel.split(' ')[0]}`}>{r.score.relevanceLabel}</span>
                    {onAskAbout && (
                      <button
                        className="ask-about"
                        title="Open the Ask interface with this provision as context"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAskAbout(`Explain ${r.actCode} Section ${r.section} — ${r.title}`);
                        }}
                      >
                        <Icon name="spark" size={11} /> Ask AI about this
                      </button>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
