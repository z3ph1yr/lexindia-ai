import React, { useEffect } from 'react';
import Icon from './Icon.jsx';

/**
 * Retrieval inspector: opens the engine's internals for one answer —
 * the query, every retrieved provision, its relevance, why it was
 * retrieved, and whether it was actually USED in the generated answer.
 */
export default function RetrievalInspector({ result, onClose, onOpenStatute }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const usedKeys = new Set((result.answer?.citations || []).map((c) => `${c.act}:${c.section}`));
  const r = result.retrieval || {};
  const a = result.analysis || {};
  const channelLabels = {
    citation: 'Exact provision',
    bm25: 'Keyword (BM25)',
    expansion: 'Concept expansion',
    tfidf: 'Statistical vectors',
    vector: 'Embeddings',
    titleExact: 'Heading match',
    title: 'Heading match',
    phrase: 'Exact phrase',
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal inspector" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <div className="modal-sec">Retrieval inspector</div>
            <h2>How this answer was found</h2>
            <div className="modal-chapter">
              Question: “{result.question}”
              {a.displayTokens?.length ? ` · terms: ${a.displayTokens.join(', ')}` : ''}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="modal-body">
          <div className="inspector-summary">
            <div>
              <span className="inspector-k">Engine</span> {r.engine || 'hybrid-rrf'} · {r.tookMs ?? '—'} ms
            </div>
            <div>
              <span className="inspector-k">Channels active</span>{' '}
              {Object.entries(r.channels || {})
                .filter(([k, v]) => (typeof v === 'number' && v > 0) || (k === 'vector' && String(v) === 'provider-embeddings'))
                .map(([k, v]) => `${channelLabels[k] || k} (${typeof v === 'number' ? v : 'on'})`)
                .join(' · ') || '—'}
            </div>
            <div>
              <span className="inspector-k">Retrieval confidence</span> {r.confidence || '—'}
            </div>
            {a.expansions?.length > 0 && (
              <div>
                <span className="inspector-k">Query expanded with</span> {a.expansions.join(', ')}
              </div>
            )}
          </div>

          <table className="inspector-table">
            <thead>
              <tr>
                <th>Provision</th>
                <th>Relevance</th>
                <th>Retrieved via / why</th>
                <th>Used in answer</th>
              </tr>
            </thead>
            <tbody>
              {(r.scores || []).map((s) => {
                const key = s.provision.replace(' Section ', ':');
                const src = (result.sources || []).find((x) => `${x.actCode}:${x.section}` === key);
                const used = usedKeys.has(key);
                return (
                  <tr key={key} className={used ? 'row-used' : ''}>
                    <td>
                      <button
                        className="cite"
                        onClick={() => {
                          const [act, sec] = s.provision.split(' Section ');
                          onOpenStatute({ act, section: sec });
                        }}
                      >
                        {s.provision}
                      </button>
                      {src && <div className="inspector-title">{src.title}</div>}
                    </td>
                    <td>
                      {src && src.score ? (
                        <span className={`relevance rel-${src.score.relevanceLabel.split(' ')[0]}`}>
                          {src.score.relevanceLabel}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <div className="inspector-channels">{(s.channels || []).map((c) => channelLabels[c] || c).join(' + ')}</div>
                      {src?.why?.length > 0 && <div className="inspector-why">{src.why[0]}</div>}
                    </td>
                    <td>
                      {used ? (
                        <span className="used-yes"><Icon name="check" size={12} /> cited</span>
                      ) : (
                        <span className="used-no">retrieved, not cited</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="inspector-footnote">
            Citations in the answer are post-validated against this retrieved set: anything the
            generator cited beyond it was removed. Retrieval relevance ranks evidence for the
            synthesiser — it is not a measure of legal strength.
          </div>
        </div>
      </div>
    </div>
  );
}
