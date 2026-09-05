import React, { useEffect, useRef, useState } from 'react';
import { ask } from '../api.js';
import Brief from '../components/Brief.jsx';
import SourceCard from '../components/SourceCard.jsx';
import StatuteModal from '../components/StatuteModal.jsx';
import HowPanel from '../components/HowPanel.jsx';
import RetrievalInspector from '../components/RetrievalInspector.jsx';
import Icon from '../components/Icon.jsx';

const EXAMPLES = [
  'What constitutes theft under Indian law?',
  'Explain the legal elements of criminal breach of trust.',
  'Find the provisions relating to voluntarily causing hurt.',
  'Difference between culpable homicide and murder',
  'Is sedition still an offence in India?',
];

const STAGES = ['Understanding the question', 'Searching IPC 1860 + BNS 2023', 'Selecting evidence', 'Composing the answer'];

function recentKey() {
  return 'lexindia.recent';
}
function loadRecent() {
  try {
    return JSON.parse(localStorage.getItem(recentKey()) || '[]');
  } catch {
    return [];
  }
}
function pushRecent(q) {
  const list = [q, ...loadRecent().filter((x) => x !== q)].slice(0, 6);
  localStorage.setItem(recentKey(), JSON.stringify(list));
  return list;
}

export default function AskView({ openStatute, pendingAsk }) {
  const [question, setQuestion] = useState('');
  const [legislation, setLegislation] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState(loadRecent());
  const [stage, setStage] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const timers = useRef([]);
  const runRef = useRef(null);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Search-to-answer workflow: another view hands us a question to run.
  useEffect(() => {
    const q = pendingAsk && pendingAsk.q;
    if (q && q.trim()) {
      setQuestion(q);
      if (runRef.current) runRef.current(q);
    }
  }, [pendingAsk]);

  async function run(q) {
    const clean = String(q || '').trim();
    if (!clean || phase === 'loading') return;
    setQuestion(clean);
    setPhase('loading');
    setError('');
    setResult(null);
    setStage(0);
    timers.current.forEach(clearTimeout);
    timers.current = STAGES.map((_, i) => setTimeout(() => setStage(i + 1), 350 * (i + 1)));
    try {
      const data = await ask(clean, { legislation: legislation || undefined });
      timers.current.forEach(clearTimeout);
      setStage(STAGES.length);
      setResult(data);
      setPhase('done');
      setRecent(pushRecent(clean));
    } catch (e) {
      timers.current.forEach(clearTimeout);
      setError(String(e.message || e));
      setPhase('error');
    }
  }
  runRef.current = run;

  const terms = result
    ? [...new Set([...(result.analysis?.displayTokens || []), ...(result.sources || []).flatMap((s) => s.highlight || [])])]
    : [];

  return (
    <div className="ask-view">
      {phase !== 'done' && (
        <section className="hero">
          <div className="hero-kicker">
            <Icon name="scales" size={14} /> Indian penal law · IPC 1860 + BNS 2023
          </div>
          <h1>
            Ask the statute.
            <br />
            <em>Answered from the text itself.</em>
          </h1>
          <p className="hero-sub">
            AI-powered Indian legal research: search 933 provisions across both penal codes,
            get grounded answers with clickable citations to the exact statutory text —
            and inspect every retrieval. Free, no account needed.
          </p>
        </section>
      )}

      <form
        className={`askbar ${phase === 'done' ? 'askbar-docked' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          run(question);
        }}
      >
        <Icon name="search" size={17} className="askbar-icon" />
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Describe a situation, name an offence, or quote a provision — e.g. “punishment for criminal breach of trust”"
          aria-label="Legal research question"
        />
        <select
          className="legislation-select"
          value={legislation}
          onChange={(e) => setLegislation(e.target.value)}
          aria-label="Legislation filter"
        >
          <option value="">Both acts</option>
          <option value="ipc">IPC only</option>
          <option value="bns">BNS only</option>
        </select>
        <button type="submit" disabled={phase === 'loading' || !question.trim()}>
          {phase === 'loading' ? 'Researching…' : 'Research'}
        </button>
      </form>

      {phase === 'idle' && (
        <div className="hero-lower">
          <div className="examples">
            <div className="examples-label">Try asking</div>
            {EXAMPLES.map((e) => (
              <button key={e} className="example" onClick={() => run(e)}>
                {e}
              </button>
            ))}
          </div>
          {recent.length > 0 && (
            <div className="examples">
              <div className="examples-label">Recent</div>
              {recent.map((e) => (
                <button key={e} className="example example-recent" onClick={() => run(e)}>
                  <Icon name="arrowRight" size={12} /> {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {phase === 'loading' && (
        <div className="pipeline-loading" aria-live="polite">
          {STAGES.map((s, i) => (
            <div key={s} className={`pipeline-stage ${i < stage ? 'stage-done' : i === stage ? 'stage-active' : ''}`}>
              <span className="stage-dot" />
              {s}
            </div>
          ))}
        </div>
      )}

      {phase === 'error' && (
        <div className="error-card">
          <Icon name="alert" size={18} />
          <div>
            <strong>The research request failed.</strong>
            <p>{error}</p>
            <button className="btn-secondary" onClick={() => run(question)}>Try again</button>
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <section className={`results ${result.answer.refusal ? 'results-refusal' : ''}`}>
          <div className="brief-col">
            <Brief result={result} onOpenStatute={openStatute} onOpenInspector={() => setInspectorOpen(true)} />
          </div>
          {!result.answer.refusal && (
            <aside className="sources-col">
              <div className="sources-head">
                <h2>
                  <Icon name="database" size={13} /> Retrieved evidence
                </h2>
                <span className="sources-meta">
                  {result.sources.length} provisions · {result.retrieval?.confidence} confidence
                </span>
              </div>
              <div className="sources-list">
                {result.sources.map((s, i) => (
                  <SourceCard
                    key={s.section + s.actCode}
                    source={s}
                    terms={terms}
                    rank={i + 1}
                    onOpen={() => openStatute({ act: s.actCode, section: s.section })}
                  />
                ))}
              </div>
            </aside>
          )}
        </section>
      )}

      {phase === 'done' && result && <div className="ask-howline"><HowPanel result={result} /></div>}

      {phase === 'done' && result && inspectorOpen && (
        <RetrievalInspector
          result={result}
          onClose={() => setInspectorOpen(false)}
          onOpenStatute={openStatute}
        />
      )}
    </div>
  );
}
