import React from 'react';
import Icon from './Icon.jsx';

/**
 * Retrieval transparency: the pipeline as a vertical flow —
 * Query → Retrieved → Evidence used → Generated answer.
 * Shows real metadata without technical noise.
 */
export default function HowPanel({ result }) {
  const r = result.retrieval || {};
  const g = result.generation || {};
  const a = result.analysis || {};
  const channelLabels = {
    citation: 'Exact provision',
    bm25: 'Keyword (BM25)',
    expansion: 'Concept expansion',
    tfidf: 'Statistical vectors',
    vector: 'Embeddings',
    titleBoost: 'Heading match',
  };

  const steps = [
    {
      label: 'Query understood',
      body: (
        <>
          {a.displayTokens?.length ? (
            <span className="how-tokens">
              {a.displayTokens.map((t) => (
                <span key={t} className="how-token">{t}</span>
              ))}
            </span>
          ) : (
            <span className="how-muted">—</span>
          )}
          {a.expansions?.length > 0 && (
            <div className="how-sub">
              expanded with legal concepts: {a.expansions.slice(0, 6).join(', ')}
            </div>
          )}
          {a.intents?.length > 0 && <div className="how-sub">intent: {a.intents.join(', ')}</div>}
          {r.fuzzyFrom?.length > 0 && (
            <div className="how-sub">typo-corrected: {r.fuzzyFrom.join(', ')} — results shown for the corrected query</div>
          )}
        </>
      ),
    },
    {
      label: `Retrieved ${r.scores?.length ?? result.sources?.length ?? 0} provisions`,
      body: (
        <>
          <div className="how-sub">
            hybrid search across{' '}
            {Object.entries(r.channels || {})
              .filter(([k, v]) => (typeof v === 'number' && v > 0) || (k === 'vector' && String(v) === 'provider-embeddings'))
              .map(([k]) => channelLabels[k] || k)
              .join(' + ') || '—'}{' '}
            · {r.tookMs ?? '—'} ms
          </div>
          <ul className="how-list">
            {(r.scores || []).slice(0, 4).map((s) => (
              <li key={s.provision}>
                {s.provision}{' '}
                <span className="how-channels">{s.channels.map((c) => channelLabels[c] || c).join(' + ')}</span>
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      label: `Evidence used: ${evidenceCount(result)} provisions`,
      body: <div className="how-sub">Generation saw only these retrieved texts — nothing outside the evidence pack.</div>,
    },
    {
      label: g.mode === 'llm' ? 'Answer generated with LLM synthesis' : 'Answer composed deterministically',
      body: (
        <div className="how-sub">
          {g.mode === 'llm' ? `model: ${g.model}` : 'no generative model involved (quotes only)'} · {g.latencyMs ?? '—'} ms ·
          {' '}citations verified: {g.citationsValidated?.kept ?? 0}, invalid removed: {g.citationsValidated?.dropped ?? 0}
          {g.fallbackReason ? ` · ${g.fallbackReason}` : ''}
        </div>
      ),
    },
  ];

  return (
    <details className="how-panel">
      <summary>
        <Icon name="info" size={13} /> How this answer was found
      </summary>
      <ol className="how-flow">
        {steps.map((s, i) => (
          <li key={i}>
            <div className="how-step-label">{s.label}</div>
            <div className="how-step-body">{s.body}</div>
          </li>
        ))}
      </ol>
      <div className="how-footnote">
        Retrieval scores rank evidence for the model; they are not a measure of legal strength.
        The knowledge base covers the Indian Penal Code, 1860 and the Bharatiya Nyaya Sanhita, 2023.
      </div>
    </details>
  );
}

function evidenceCount(result) {
  if (!result.answer?.structured?.applicableLaw) return result.sources?.length ?? 0;
  return result.answer.structured.applicableLaw.length;
}
