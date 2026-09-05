/**
 * Stage 1: QUERY ANALYSIS.
 * Deterministic, pre-retrieval. Produces the structured understanding that
 * every later stage (retrieval, generation, caveats) consumes. No LLM here:
 * query understanding must be fast, testable, and never invent.
 */
const { expandQuery, detectCitations } = require('../retrieval/query-understanding');
const { tokenize, displayTokens } = require('../retrieval/query-normalize');

const INTENT_RULES = [
  { intent: 'penalty', re: /\b(punishment|penalty|sentenc|jail|prison|how long|imprison|fine)\b/i },
  { intent: 'definition', re: /\b(constitut|define|definition|means|what is|what are|meaning)\b/i },
  { intent: 'compare', re: /\b(difference|distinguish|compare|versus|vs\.?|contrast)\b/i },
  { intent: 'validity', re: /\b(still|valid|in force|repealed|today|now|current)\b/i },
  { intent: 'procedure', re: /\b(fir|complaint|file|register|procedure|bail|arrest)\b/i },
];

function analyze(question, opts = {}) {
  const { tokens, extra } = expandQuery(question);
  const citations = detectCitations(question);
  if (opts.section && !citations.some((c) => String(c.no).toUpperCase() === String(opts.section).toUpperCase())) {
    citations.push({ act: opts.legislation || null, no: String(opts.section).toUpperCase() });
  }
  const intents = INTENT_RULES.filter((r) => r.re.test(question)).map((r) => r.intent);
  return {
    question,
    displayTokens: displayTokens(question),
    stemTokens: tokenize(question),
    expansions: extra,
    citations,
    intents: intents.length ? intents : ['general'],
    legislationFilter: (opts.legislation || null),
    isOffTopicHint: /\b(passport|visa|income tax|divorce|marriage registration|property registration|trademark|company law)\b/i.test(question),
  };
}

module.exports = { analyze };
