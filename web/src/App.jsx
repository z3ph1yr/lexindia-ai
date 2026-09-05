import React, { useEffect, useState } from 'react';
import { getHealth } from './api.js';
import Icon from './components/Icon.jsx';
import AskView from './views/AskView.jsx';
import SearchView from './views/SearchView.jsx';
import CompareView from './views/CompareView.jsx';
import SourcesView from './views/SourcesView.jsx';
import StatuteModal from './components/StatuteModal.jsx';

const VIEWS = [
  { id: 'ask', label: 'Ask', icon: 'ask' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'compare', label: 'Compare', icon: 'compare' },
  { id: 'sources', label: 'Sources', icon: 'sources' },
];

export function Highlight({ text, terms }) {
  if (!text) return null;
  const clean = (terms || []).filter((t) => t && t.length > 2);
  if (!clean.length) return <>{text}</>;
  const re = new RegExp(`(${clean.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return <>{text.split(re).map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <React.Fragment key={i}>{p}</React.Fragment>))}</>;
}

export default function App() {
  const [view, setView] = useState('ask');
  const [health, setHealth] = useState(null);
  const [statute, setStatute] = useState(null);
  const [pendingAsk, setPendingAsk] = useState(null);
  const [compareInit, setCompareInit] = useState(null);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => {});
    const h = (e) => setStatute(e.detail);
    window.addEventListener('open-statute', h);
    return () => window.removeEventListener('open-statute', h);
  }, []);

  const openStatute = (detail) => setStatute(detail);

  // Search → Ask workflow
  const askAbout = (question) => {
    setPendingAsk({ q: question, ts: Date.now() });
    setView('ask');
  };

  // Statute modal → side-by-side comparison
  const compareIPC = (ipcSection) => {
    setCompareInit({ section: ipcSection, ts: Date.now() });
    setStatute(null);
    setView('compare');
  };

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('ask')} title="LexIndia AI — home">
          <div className="mark"><Icon name="scales" size={20} strokeWidth={1.6} /></div>
          <div className="brand-text">
            <div className="wordmark">
              LexIndia<span className="dot">·</span>AI
            </div>
            <div className="sub">Indian penal law research engine</div>
          </div>
        </button>

        <nav className="nav" aria-label="Primary">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`nav-item ${view === v.id ? 'nav-active' : ''}`}
              onClick={() => setView(v.id)}
            >
              <Icon name={v.icon} size={14} />
              {v.label}
            </button>
          ))}
        </nav>

        <div className="topbar-right">
          {health && (
            <span className="chip chip-corpus" title="Demo corpus — two acts, curated core set, provenance-tracked">
              <span className="chip-dot" /> {health.corpus.provisions} provisions · IPC 1860 + BNS 2023
            </span>
          )}
        </div>
      </header>

      <div className="notice">
        Research prototype over statutory text. Not legal advice, and not a substitute for a licensed advocate.
        IPC 1860 provisions are historical (replaced by the Bharatiya Nyaya Sanhita, 2023 w.e.f. 01-07-2024:
        successors shown where mapped). Provision texts carry verification badges; verify against the Gazette before reliance.
      </div>

      <main className="view">
        {view === 'ask' && <AskView openStatute={openStatute} pendingAsk={pendingAsk} />}
        {view === 'search' && <SearchView openStatute={openStatute} onAskAbout={askAbout} />}
        {view === 'compare' && <CompareView openStatute={openStatute} initialSection={compareInit} />}
        {view === 'sources' && <SourcesView openStatute={openStatute} onAskAbout={askAbout} />}
      </main>

      <footer className="footer">
        <span>
          LexIndia AI — research MVP. Corpus: IPC 1860 (public domain; snapshot cross-verified against the
          official bare act) and BNS 2023 (official India Code text). Mapping and annotations are curated subsets.
        </span>
        <span className="footer-api">
          <code>GET /api/search</code> · <code>POST /api/query</code> · <code>GET /api/sections/:act/:section</code> ·{' '}
          <code>GET /api/provisions</code> · <code>GET /api/relations</code>
        </span>
      </footer>

      {statute && (
        <StatuteModal
          act={statute.act}
          section={statute.section}
          onClose={() => setStatute(null)}
          onCompare={compareIPC}
        />
      )}
    </div>
  );
}
