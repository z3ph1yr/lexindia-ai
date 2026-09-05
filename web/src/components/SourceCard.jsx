import React, { useState } from 'react';
import Icon from '../components/Icon.jsx';

export default function SourceCard({ source, terms, rank, active, onOpen }) {
  const [expanded, setExpanded] = useState(false);
  const succ = source.bnsSuccessor;
  const full = source.text || '';
  const snippet = source.snippet || '';

  return (
    <article
      className={`source-card ${active ? 'source-active' : ''}`}
      style={{ '--stagger': rank }}
      onMouseEnter={undefined}
    >
      <button className="source-card-main" onClick={onOpen}>
        <div className="source-top">
          <span className="source-sec">
            {source.actCode} Section {source.section}
          </span>
          <span className="source-metas">
            {typeof source.score === 'object' && source.score?.relevanceLabel && (
              <span className={`relevance rel-${source.score.relevanceLabel.split(' ')[0]}`}>
                {source.score.relevanceLabel}
              </span>
            )}
            <span className="source-rank">#{rank}</span>
          </span>
        </div>
        <div className="source-title">{source.title}</div>
        <p className="source-snippet">
          <Highlight text={expanded ? full : snippet} terms={terms} />
        </p>
        {source.why?.length > 0 && (
          <ul className="why-list" title="Why this result?">
            {source.why.slice(0, 2).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        <div className="source-chips">
          {source.status === 'repealed' && (
            <span className="chip chip-repealed" title={source.act?.note}>
              historical
            </span>
          )}
          {source.verification === 'official' && (
            <span className="chip chip-official" title="Text ingested from the official India Code repository">
              official text
            </span>
          )}
          {source.verification === 'verified' && (
            <span className="chip chip-verified" title="Cross-verified against the official bare act">
              verified
            </span>
          )}
          {source.verification === 'unverified' && (
            <span className="chip chip-unverified" title="Snapshot text pending Gazette verification">
              unverified
            </span>
          )}
          {source.collection === 'core' && (
            <span className="chip chip-core" title="Part of the curated core set">core</span>
          )}
          {succ && (
            <span
              className="chip chip-bns"
              title={succ.confidence === 'verified' ? succ.note : `${succ.note} (mapping ${succ.confidence})`}
            >
              → {succ.to_section}
            </span>
          )}
          {source.annotations?.map((a, i) => (
            <span key={i} className="chip chip-judicial" title={`${a.authority} (${a.year})`}>
              ⚖ {a.authority} · {a.year}
            </span>
          ))}
        </div>
      </button>
      {full && full.length > snippet.length && (
        <button className="source-expand" onClick={() => setExpanded(!expanded)}>
          <Icon name="chevronDown" size={12} className={expanded ? 'rot-up' : ''} />
          {expanded ? 'Collapse provision text' : 'Show full provision text'}
        </button>
      )}
    </article>
  );
}

function Highlight({ text, terms }) {
  if (!text) return null;
  const clean = (terms || []).filter((t) => t && t.length > 2);
  if (!clean.length) return <>{text}</>;
  const re = new RegExp(
    `(${clean.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'gi'
  );
  return <>{text.split(re).map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <React.Fragment key={i}>{p}</React.Fragment>))}</>;
}
