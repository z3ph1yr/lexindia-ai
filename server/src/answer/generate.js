/**
 * Stage 5c: GROUNDED GENERATION (LLM mode).
 * The model receives ONLY the evidence pack. It must answer in a fixed JSON
 * shape, cite as [ACT Section N], and may only reference provisions present in the
 * evidence. Every citation is post-validated by citations.js; invalid ones
 * are stripped and reported. If the model returns unusable output, we fall
 * back to the deterministic extractive generator.
 */
const { chat, llmActive, config, modelInfo } = require('../llm/provider');
const { composeExtractive } = require('./extractive');

const SYSTEM_PROMPT = `You are the synthesis layer of a legal research engine for Indian penal law.

STRICT GROUNDING RULES:
1. Use ONLY the statutory excerpts provided between <evidence> tags as your factual basis.
2. NEVER invent section numbers, legislation, or citations. Cite only as [IPC Section 302] or [BNS Section 103], and only for provisions that appear in the evidence.
3. NEVER claim a provision says something unsupported by the retrieved text. Quote statutory language where the wording matters; do not paraphrase punishments.
4. Distinguish retrieved law from your own synthesis: general legal background you add must be clearly marked as interpretation (prefix such sentences with "Interpretation (not statutory text):") and must not introduce provisions outside the evidence.
5. If the evidence is insufficient to answer reliably, set "insufficient": true and say so — do not compensate with outside knowledge.
6. You assist with legal RESEARCH, not individualized legal advice; do not recommend a course of action or predict court outcomes.

Respond with ONLY a JSON object, no markdown fences, of the shape:
{"directAnswer": string, "explanation": string, "caveats": string[], "insufficient": boolean}
- directAnswer: 1-3 sentences, with [ACT Section N] citations.
- explanation: grounded explanation with citations and short verbatim quotes where useful.
- caveats: array of short strings (may be empty). Include one when evidence is incomplete or only partially verified.
- insufficient: true only when the evidence cannot support an answer.`;

function buildEvidenceContext(evidencePack) {
  return evidencePack.evidence
    .map((e, i) => {
      const status = e.status === 'repealed' ? 'historical — act replaced 01-07-2024' : 'in force';
      return `[${i + 1}] ${e.act} Section ${e.section} (${status}) — ${e.title}\n${e.text}`;
    })
    .join('\n\n');
}

function extractJson(raw) {
  if (!raw) return null;
  let t = String(raw).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    return typeof obj === 'object' && obj !== null ? obj : null;
  } catch {
    return null;
  }
}

async function composeLlm(analysis, evidencePack, { fallback } = {}) {
  if (!llmActive() || !evidencePack.sufficient) {
    return fallback();
  }
  const started = Date.now();
  let raw;
  try {
    raw = await chat([
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `<evidence>\n${buildEvidenceContext(evidencePack)}\n</evidence>\n\nQuestion: ${analysis.question}\n\nAnswer under the strict grounding rules.`,
      },
    ]);
  } catch (e) {
    const out = fallback();
    out.fallbackReason = `LLM synthesis failed (${String(e.message || e).slice(0, 120)}); deterministic extractive output used instead.`;
    return out;
  }

  const parsed = extractJson(raw);
  if (!parsed || typeof parsed.directAnswer !== 'string' || !parsed.directAnswer.trim()) {
    const out = fallback();
    out.fallbackReason = 'LLM output was not usable JSON; deterministic extractive output used instead.';
    return out;
  }

  if (parsed.insufficient === true) {
    const out = fallback();
    out.insufficient = true;
    out.structured.directAnswer =
      "I couldn't find sufficient supporting provisions in the current legal knowledge base to answer this reliably.";
    out.refineHint =
      'Try naming the offence (e.g. “criminal breach of trust”), quoting a provision number (e.g. “Section 378”), or describing the facts in plain words.';
    out.modelLatencyMs = Date.now() - started;
    return out;
  }

  const caveats = Array.isArray(parsed.caveats)
    ? parsed.caveats.filter((c) => typeof c === 'string').slice(0, 6)
    : [];

  return {
    mode: 'llm',
    structured: {
      directAnswer: parsed.directAnswer.trim(),
      applicableLaw: evidencePack.evidence.map((e) => ({
        provision: `${e.act} Section ${e.section}`,
        title: e.title,
        status: e.status === 'repealed' ? 'historical (act replaced 01-07-2024)' : 'in force',
        verification: e.verification,
        quote: e.quotes,
        penalty: e.penalty,
      })),
      explanation: String(parsed.explanation || '').trim(),
      caveats,
    },
    text: null, // assembled after citation resolution by the caller
    insufficient: false,
    modelLatencyMs: Date.now() - started,
  };
}

module.exports = { composeLlm, SYSTEM_PROMPT, buildEvidenceContext, extractJson, modelInfo };
