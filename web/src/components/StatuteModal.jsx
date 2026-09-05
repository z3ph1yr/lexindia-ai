import React, { useEffect, useState } from 'react';
import { getSection } from '../api.js';
import Icon from './Icon.jsx';

export default function StatuteModal({ act, section, onClose, onCompare }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    getSection(act, section)
      .then(setData)
      .catch((e) => setError(String(e.message || e)));
  }, [act, section]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {error && (
          <div className="error-card modal-error">
            <Icon name="alert" size={18} />
            <div><strong>Could not load the provision.</strong><p>{error}</p></div>
          </div>
        )}
        {!data && !error && (
          <div className="modal-loading">
            <span className="stage-dot pulse" /> Retrieving statute…
          </div>
        )}
        {data && (
          <>
            <header className="modal-head">
              <div>
                <div className="modal-sec">
                  {data.actCode} Section {data.section}
                </div>
                <h2>{data.title}</h2>
                <div className="modal-chapter">
                  {data.chapterTitle ? `Chapter ${data.chapter} — ${data.chapterTitle}` : data.act ? data.act.name : ''}
                </div>
              </div>
              <button className="modal-close" onClick={onClose} aria-label="Close">
                <Icon name="close" size={16} />
              </button>
            </header>

            <div className="modal-body">
              <div className="statute-text">
                {data.normalized_text || (
                  <em className="missing-text">
                    Statutory text unavailable in this snapshot for this provision. (Recorded as “title
                    only” at ingest — a known, disclosed gap. Nothing was invented to fill it.)
                  </em>
                )}
              </div>

              {data.text_status !== 'full' && (
                <div className="modal-note">Text status: {data.text_status} — not verified against the Gazette.</div>
              )}

              {data.bnsSuccessor && (
                <div className="bns-card">
                  <div className="bns-head-row">
                    <div>
                      <div className="bns-label">
                        Related provision · in force today
                        {data.bnsSuccessor.confidence === 'indicative' ? ' · mapping indicative' : ''}
                      </div>
                      <div className="bns-mapping">
                        {data.actCode} Section {data.section} <span className="bns-arrow">→</span>{' '}
                        {data.bnsSuccessor.to_section}
                      </div>
                      {data.bnsSuccessor.note && <p className="bns-note">{data.bnsSuccessor.note}</p>}
                    </div>
                    {onCompare && data.actCode === 'IPC' && (
                      <button
                        className="btn-outline"
                        title="Open the IPC ↔ BNS side-by-side comparison"
                        onClick={() => onCompare(data.section)}
                      >
                        Compare side-by-side
                      </button>
                    )}
                  </div>
                </div>
              )}

              {data.annotations?.map((a, i) => (
                <div key={i} className="anno-card">
                  <div className="anno-head">
                    <span>⚖ Judicial note</span>
                    <span className="anno-authority">
                      {a.authority}
                      {a.year ? ` · ${a.year}` : ''}
                    </span>
                  </div>
                  <p>{a.note}</p>
                </div>
              ))}

              {data.related?.length > 0 && (
                <div className="related-row">
                  <span className="related-label">Related</span>
                  {data.related.map((r, i) => (
                    <button
                      key={i}
                      className="cite"
                      title={r.relationType === 'successor' ? 'Successor provision' : 'Automatically derived neighbour'}
                      onClick={() => setStatuteDirect(r.act, r.section)}
                    >
                      {r.act} Section {r.section}
                    </button>
                  ))}
                </div>
              )}

              {data.act && data.act.status === 'repealed' && <div className="modal-note">{data.act.note}</div>}

              {data.source && (
                <div className="prov-card">
                  <div className="prov-head">
                    <span>Provenance</span>
                    <span className={`prov-badge prov-${data.verification}`}>
                      {data.verification === 'official'
                        ? 'Official text (India Code)'
                        : data.verification === 'verified'
                          ? `Cross-verified${data.verification_score != null ? ` · overlap ${data.verification_score}` : ''}`
                          : 'Unverified snapshot'}
                    </span>
                  </div>
                  <div className="prov-body">
                    <div>
                      {data.source.name} · <span className="prov-authority">{data.source.authority}</span>
                    </div>
                    <div className="prov-links">
                      {data.sourceUrl && (
                        <a href={data.sourceUrl} target="_blank" rel="noreferrer">
                          source record <Icon name="external" size={11} />
                        </a>
                      )}
                      {data.verifiedAgainstUrl && (
                        <a href={data.verifiedAgainstUrl} target="_blank" rel="noreferrer">
                          verification evidence <Icon name="external" size={11} />
                        </a>
                      )}
                    </div>
                    {data.effectiveDate && (
                      <div className="prov-date">
                        {data.actCode === 'IPC'
                          ? `Enacted ${data.effectiveDate} · historical (see successor)`
                          : `In force w.e.f. ${data.effectiveDate}`}
                      </div>
                    )}
                    {data.updatedAt && <div className="prov-date">record updated {data.updatedAt}</div>}
                  </div>
                </div>
              )}
            </div>

            <footer className="modal-foot">
              <code>
                GET /api/sections/{data.actCode}/{data.section}
              </code>
              <span>Statutory text — public domain. Verify against the official Gazette before reliance.</span>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

function setStatuteDirect(act, section) {
  window.dispatchEvent(new CustomEvent('open-statute', { detail: { act, section } }));
}
