/**
 * Stage 3: EVIDENCE SELECTION.
 * Decides what the generator is allowed to see. The generator can never cite
 * or describe anything outside this pack — this is the structural guarantee
 * against invented provisions.
 */
const { splitSentences, extractPenalty } = require('./text-utils');

const MAX_PROVISIONS = 6;
const MAX_TEXT_CHARS = 2400;
const WEAK_UI_SCORE = 0.35;

function selectEvidence(hybridResult) {
  const { results, confidence, citations } = hybridResult;
  const normalized = hybridResult.normalized || { displayTokens: [], expansions: [] };
  const ranked = results.filter((r) => r.channels.includes('citation') || (r.uiScore ?? 0) >= WEAK_UI_SCORE);
  const selected = ranked.slice(0, MAX_PROVISIONS);
  const dropped = results.length - selected.length;

  const evidence = selected.map((r) => {
    const text = r.normalized_text || '';
    const qTokens = normalized.displayTokens.concat(normalized.expansions.map((e) => e.split(' ')[0]));
    const quotes = bestQuotes(text, qTokens);
    return {
      provision_id: r.provision_id,
      act: r.act_code,
      section: r.provision_no,
      title: r.title,
      status: r.status,
      verification: r.verification,
      uiScore: r.uiScore,
      channels: r.channels,
      text: text.slice(0, MAX_TEXT_CHARS),
      truncated: text.length > MAX_TEXT_CHARS,
      quotes,
      penalty: extractPenalty(text),
      isRepealNote: !text || text.length < 40,
    };
  });

  return {
    evidence,
    dropped,
    sufficient: evidence.length > 0 && confidence !== 'low' && confidence !== 'none',
    confidence,
    explicitCitations: citations,
  };
}

/** Pick the 1-3 sentences most relevant to the query (deterministic). */
function bestQuotes(text, tokens, max = 3) {
  const sents = splitSentences(text);
  if (sents.length <= max) return sents.filter(Boolean);
  const terms = tokens.filter(Boolean).map((t) => t.toLowerCase());
  const scored = sents.map((s) => {
    const low = s.toLowerCase();
    let hits = 0;
    for (const t of terms) if (low.includes(t)) hits += 1;
    return { s, hits };
  });
  return scored
    .sort((a, b) => b.hits - a.hits)
    .slice(0, max)
    .filter((x) => x.hits > 0)
    .map((x) => x.s);
}

module.exports = { selectEvidence };
