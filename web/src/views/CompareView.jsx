import React, { useEffect, useMemo, useState } from 'react';
import { getRelations } from '../api.js';
import Icon from '../components/Icon.jsx';

export default function CompareView({ openStatute, initialSection }) {
  const [phase, setPhase] = useState('loading');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    getRelations()
      .then((d) => {
        setData(d);
        setPhase('done');
        let pick = d.pairs.find((p) => p.confidence === 'verified') || d.pairs[0];
        if (initialSection && initialSection.section) {
          const m = d.pairs.find((p) => p.ipc.section === initialSection.section);
          if (m) pick = m;
        }
        if (pick) {
          setSelected(pick);
          if (initialSection && initialSection.section) setFilter(pick.ipc.section);
        }
      })
      .catch((e) => {
        setError(String(e.message || e));
        setPhase('error');
      });
  }, [initialSection && initialSection.ts]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return data.pairs;
    return data.pairs.filter(
      (p) => p.ipc.section.toLowerCase().includes(f) || (p.ipc.title || '').toLowerCase().includes(f) || (p.note || '').toLowerCase().includes(f)
    );
  }, [data, filter]);

  return (
    <div className="compare-view">
      <header className="view-head">
        <h1>
          <Icon name="compare" size={20} /> IPC ↔ BNS comparison
        </h1>
        <p>
          Successor provisions after the Bharatiya Nyaya Sanhita, 2023 replaced the IPC (w.e.f. 1 July 2024).
          Only relationships from the curated, confidence-labelled mapping are shown.
        </p>
      </header>

      {phase === 'loading' && <div className="loading-line"><span className="stage-dot pulse" /> Loading the successor mapping…</div>}
      {phase === 'error' && (
        <div className="error-card"><Icon name="alert" size={18} /><div><strong>Could not load the mapping.</strong><p>{error}</p></div></div>
      )}

      {phase === 'done' && (
        <div className="compare-layout">
          <aside className="compare-list">
            <input
              className="compare-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by section or subject…"
              aria-label="Filter mapping"
            />
            {filtered.map((p) => (
              <button
                key={p.ipc.section}
                className={`compare-item ${selected && selected.ipc.section === p.ipc.section ? 'compare-item-active' : ''}`}
                onClick={() => setSelected(p)}
              >
                <span className="source-sec">Section {p.ipc.section}</span>
                <span className="compare-item-title">{p.ipc.title}</span>
                {p.confidence === 'indicative' && <span className="chip chip-unverified">indicative</span>}
              </button>
            ))}
            {filtered.length === 0 && <div className="compare-empty">No mapping matches “{filter}”.</div>}
          </aside>

          {selected && (
            <div className="compare-panel">
              <div className="compare-note">
                {selected.confidence === 'verified' ? (
                  <span className="chip chip-verified">verified mapping</span>
                ) : (
                  <span className="chip chip-unverified">indicative mapping — for expert confirmation</span>
                )}
                {selected.note && <span className="compare-note-text">{selected.note}</span>}
              </div>
              <div className="compare-grid">
                <CompareSide
                  side="IPC"
                  label="Repealed 30 June 2024"
                  tone="ipc"
                  provision={selected.ipc}
                  onOpen={openStatute}
                />
                <div className="compare-vs">
                  <Icon name="arrowRight" size={14} />
                  <span>re-enacted as</span>
                </div>
                <CompareSide
                  side="BNS"
                  label="In force from 1 July 2024"
                  tone="bns"
                  provision={selected.bns}
                  onOpen={openStatute}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CompareSide({ side, label, tone, provision, onOpen }) {
  return (
    <div className={`compare-side compare-${tone}`}>
      <div className="compare-side-head">
        <span className="compare-side-act">{side}</span>
        <span className="compare-side-label">{label}</span>
      </div>
      <button className="compare-side-sec" onClick={() => onOpen({ act: provision.act, section: provision.section })}>
        Section {provision.section} <Icon name="external" size={12} />
      </button>
      <div className="compare-side-title">{provision.title}</div>
      <div className="compare-side-text">
        {provision.text || <em className="missing-text">Text unavailable in this snapshot.</em>}
      </div>
      <div className="compare-side-foot">
        <span className={`chip ${provision.verification === 'official' ? 'chip-official' : provision.verification === 'verified' ? 'chip-verified' : 'chip-unverified'}`}>
          {provision.verification}
        </span>
      </div>
    </div>
  );
}
