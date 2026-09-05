import React from 'react';
import Icon from './Icon.jsx';

/**
 * Structured answer renderer:
 *   Answer → Applicable law (provision cards) → Explanation → Caveats → Sources
 * Citations are interactive: they open the underlying provision.
 */
function withCites(text, keyPrefix, onOpenStatute, onCiteFocus) {
  const citeRe = /\[(IPC|BNS)\s*Section \s*(\d{1,3}[A-Z]{0,2})\]/g;
  const nodes = [];
  let last = 0;
  let m;
  let i = 0;
  while ((m = citeRe.exec(text))) {
    if (m.index > last) nodes.push(<span key={`t${i++}`}>{text.slice(last, m.index)}</span>);
    const act = m[1];
    const sec = m[2];
    nodes.push(
      <button
        key={`c${i++}`}
        className="cite"
        title={`Open ${act} Section ${sec}`}
        onClick={() => onOpenStatute({ act, section: sec })}
        onMouseEnter={() => onCiteFocus && onCiteFocus(sec)}
        onMouseLeave={() => onCiteFocus && onCiteFocus(null)}
      >
        {act} Section {sec}
      </button>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(<span key={`t${i++}`}>{text.slice(last)}</span>);
  return nodes;
}

function inline(text, keyPrefix, onOpenStatute, onCiteFocus) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
  return parts.map((p, i) => {
    const k = `${keyPrefix}-${i}`;
    if (p.startsWith('**')) return <strong key={k}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('_') && p.endsWith('_') && p.length > 2) return <em key={k}>{p.slice(1, -1)}</em>;
    return <React.Fragment key={k}>{withCites(p, k, onOpenStatute, onCiteFocus)}</React.Fragment>;
  });
}

function MarkdownBlock({ text, onOpenStatute, onCiteFocus }) {
  if (!text) return null;
  return (
    <>
      {String(text)
        .split('\n\n')
        .map((para, pi) => (
          <div key={pi} className="brief-para">
            {para.split('\n').map((line, li) => {
              const t = line.trim();
              if (!t) return null;
              const key = `${pi}-${li}`;
              if (t.startsWith('> ')) {
                return (
                  <blockquote key={key} className="statute-quote">
                    <span className="qmark">“</span>
                    {withCites(t.slice(2), `q${key}`, onOpenStatute, onCiteFocus)}
                  </blockquote>
                );
              }
              if (t.startsWith('Penalty: ')) {
                return (
                  <div key={key} className="penalty">
                    <span className="penalty-label">Penalty</span>
                    <p className="brief-line">{withCites(t.slice(9), `p${key}`, onOpenStatute, onCiteFocus)}</p>
                  </div>
                );
              }
              if (t.startsWith('- ')) {
                return <div key={key} className="caveat-line">⚠ {withCites(t.slice(2), `c${key}`, onOpenStatute, onCiteFocus)}</div>;
              }
              if (/^\*\*.+\*\*$/.test(t)) return <div key={key} className="subhead">{t.slice(2, -2)}</div>;
              return <p key={key} className="brief-line">{inline(t, `l${key}`, onOpenStatute, onCiteFocus)}</p>;
            })}
          </div>
        ))}
    </>
  );
}

export default function Brief({ result, onOpenStatute, onCiteFocus, onOpenInspector }) {
  const { answer, meta } = result;
  const s = answer.structured || {};
  const citeFocusProps = { onOpenStatute, onCiteFocus };

  return (
    <article className="brief">
      <header className="brief-head">
        <div>
          <h1>Research brief</h1>
          <div className="brief-q">“{result.question}”</div>
        </div>
        <div className="brief-badges">
          <span className={`badge badge-${answer.mode}`}>
            {answer.mode === 'llm' ? 'LLM synthesis · grounded' : 'Extractive · deterministic'}
          </span>
          <span className="badge badge-muted">{meta.latencyMs} ms</span>
          {result.retrieval?.confidence && result.retrieval.confidence !== 'high' && (
            <span className={`badge ${result.retrieval.confidence === 'low' ? 'badge-low' : 'badge-medium'}`}>
              {result.retrieval.confidence} retrieval confidence
            </span>
          )}
        </div>
      </header>

      {answer.fallbackReason && <div className="brief-note">{answer.fallbackReason}</div>}

      {answer.refusal ? (
        <div className="refusal">
          <div className="refusal-mark">⊘</div>
          <div>
            <strong>{s.directAnswer || answer.text}</strong>
            <p>{s.explanation}</p>
            {answer.refineHint && <p className="refine-hint">💡 {answer.refineHint}</p>}
          </div>
        </div>
      ) : (
        <>
          <section className="brief-section">
            <h2 className="section-label">Answer</h2>
            <p className="direct-answer">{withCites(s.directAnswer || '', 'da', onOpenStatute, onCiteFocus)}</p>
          </section>

          {s.applicableLaw?.length > 0 && (
            <section className="brief-section">
              <h2 className="section-label">Applicable law</h2>
              <div className="law-cards">
                {s.applicableLaw.map((card, i) => {
                  const [act, sec] = card.provision.split(' Section ');
                  return (
                    <button key={i} className="law-card" onClick={() => onOpenStatute({ act, section: sec })}>
                      <div className="law-card-head">
                        <span className="law-card-provision">{card.provision}</span>
                        <span
                          className={`chip ${card.verification === 'official' ? 'chip-official' : card.verification === 'verified' ? 'chip-verified' : 'chip-unverified'}`}
                          title={`Text verification: ${card.verification}`}
                        >
                          {card.verification === 'official' ? 'official' : card.verification === 'verified' ? 'verified' : 'unverified'}
                        </span>
                      </div>
                      <div className="law-card-title">{card.title}</div>
                      {card.quote?.slice(0, 1).map((q, qi) => (
                        <p key={qi} className="law-card-quote">“{q}”</p>
                      ))}
                      <div className="law-card-foot">
                        <span className={`chip ${card.status !== 'in force' ? 'chip-repealed' : 'chip-grounded'}`}>{card.status}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="brief-section">
            <h2 className="section-label">Explanation</h2>
            <div className="brief-body">
              <MarkdownBlock text={s.explanation} {...citeFocusProps} />
            </div>
          </section>

          {s.caveats?.length > 0 && (
            <section className="brief-section">
              <h2 className="section-label">Caveats</h2>
              <ul className="caveat-list">
                {s.caveats.map((c, i) => (
                  <li key={i} className="caveat-line">⚠ {c}</li>
                ))}
              </ul>
            </section>
          )}

          {answer.citations?.length > 0 && (
            <footer className="brief-cites">
              <span className="brief-cites-label">Sources</span>
              {answer.citations.map((c) => (
                <button
                  key={c.id}
                  className="cite"
                  title={`${c.title} · source: ${c.sourceId || '—'}`}
                  onClick={() => onOpenStatute({ act: c.act, section: c.section })}
                >
                  {c.act} Section {c.section}
                </button>
              ))}
              {onOpenInspector && (
                <button className="inspector-link" onClick={onOpenInspector}>
                  <Icon name="info" size={12} /> View retrieval
                </button>
              )}
            </footer>
          )}
          {onOpenInspector && answer.citations?.length === 0 && !answer.refusal && (
            <footer className="brief-cites">
              <span className="brief-cites-label">Sources</span>
              <span className="how-muted">No provision-specific citations in this answer.</span>
              {onOpenInspector && (
                <button className="inspector-link" onClick={onOpenInspector}>
                  <Icon name="info" size={12} /> View retrieval
                </button>
              )}
            </footer>
          )}

          <div className="trust-strip">
            <Icon name="check" size={12} />
            <span>
              AI-generated answer grounded in indexed legal sources.
              <strong> Verify against the original source before relying on this information.</strong>
            </span>
          </div>
        </>
      )}
    </article>
  );
}
