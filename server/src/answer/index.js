/**
 * Answer pipeline (clean separation):
 *
 *   analysis (answer/analysis.js)      — deterministic query understanding
 *   retrieval (retrieval/hybrid.js)    — hybrid multi-channel search [caller]
 *   evidence (answer/evidence.js)      — what the generator may see
 *   generation (extractive | generate) — grounded composition
 *   citations (answer/citations.js)    — resolve/strip citation markers
 *   assembly (this file)               — response-ready answer object
 *
 * The generator can never reference a provision outside the evidence pack,
 * and every citation in the returned text is guaranteed to resolve to a
 * retrieved, provenance-carrying provision record.
 */
const { analyze } = require('./analysis');
const { selectEvidence } = require('./evidence');
const { composeExtractive, REFUSAL_TEXT } = require('./extractive');
const { composeLlm } = require('./generate');
const { resolveCitations } = require('./citations');
const { toMarkdown } = require('./render');
const { modelInfo } = require('../llm/provider');

async function generateAnswer(question, hybridResult, sourcePayloads) {
  const started = Date.now();
  const analysis = analyze(question, {
    section: hybridResult.explicitSection,
    legislation: hybridResult.legislationFilter,
  });

  // Stage: evidence selection
  const evidencePack = selectEvidence({ ...hybridResult, explicitSection: analysis.citations });

  // Stage: generation (LLM if configured, else extractive; extractive is the fallback)
  const generated = await composeLlm(analysis, evidencePack, {
    fallback: () => composeExtractive(analysis, evidencePack),
  });

  // Cited provisions that exist nowhere in the corpus get a specific hint.
  if (hybridResult.citationNotFound && generated.insufficient) {
    const missed = analysis.citations.map((c) => `${c.act || ''} Section ${c.no}`.trim()).join(', ');
    generated.structured.explanation =
      `The cited provision (${missed}) does not exist in the indexed corpus. The corpus contains the ` +
      `Indian Penal Code, 1860 (Sections 1–511 with lettered provisions) and the Bharatiya Nyaya Sanhita, 2023 (Sections 1–358). ` +
      `Double-check the section number, or ask about the underlying offence instead.`;
    generated.refineHint = 'Check the provision number — or describe the offence in plain words (e.g. “punishment for cheating”).';
  }

  // Stage: citation resolution — strip anything the sources cannot back.
  const baseText = generated.text || toMarkdown(generated.structured);
  const resolved = resolveCitations(baseText, sourcePayloads);

  const insufficient = Boolean(generated.insufficient);
  const citations = insufficient ? [] : resolved.citations;

  return {
    answer: {
      mode: generated.mode,
      refusal: insufficient,
      insufficient,
      refineHint: generated.refineHint || (insufficient ? 'Try naming the offence (e.g. “criminal breach of trust”), quoting a provision number (e.g. “Section 378”), or describing the facts in plain words.' : null),
      structured: generated.structured,
      text: resolved.text,
      citations,
      fallbackReason: generated.fallbackReason,
    },
    analysis,
    generation: {
      mode: generated.mode,
      model: generated.mode === 'llm' ? modelInfo() : null,
      grounded: true,
      groundingNote: 'Generation restricted to the retrieved evidence pack; citations post-validated against retrieved sources.',
      citationsValidated: { kept: resolved.kept, dropped: resolved.dropped.length, droppedCitations: resolved.dropped },
      latencyMs: (generated.modelLatencyMs || Date.now() - started),
    },
  };
}

module.exports = { generateAnswer, REFUSAL_TEXT };
