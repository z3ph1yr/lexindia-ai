/**
 * LLM provider abstraction. Works with ANY OpenAI-compatible API
 * (OpenAI, Azure, Anthropic-compatible gateways, LM Studio, Ollama's
 * OpenAI-compat endpoint) via environment variables:
 *
 *   LLM_BASE_URL   e.g. https://api.openai.com/v1   (default)
 *   LLM_API_KEY    the key
 *   LLM_MODEL      e.g. gpt-4o-mini
 *
 * If unconfigured, the engine runs in deterministic extractive mode — the
 * answer layer quotes retrieved statutory text only and cannot fabricate.
 */
const config = {
  baseUrl: (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || 'gpt-4o-mini',
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 30000),
};

function llmConfigured() {
  return Boolean(config.apiKey && config.model);
}

async function chat(messages) {
  if (__testChatImpl) return __testChatImpl(messages);
  if (!llmConfigured()) throw new Error('LLM not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.1 }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM_PROMPT = `You are the synthesis layer of a legal research engine for Indian penal law.

STRICT GROUNDING RULES:
1. Use ONLY the statutory excerpts provided between <context> tags as your factual basis. Do not use outside knowledge of any other law or section.
2. NEVER invent section numbers, legislation, or citations. Every substantive claim must be followed by an inline citation of the exact form [IPC Section <number>] or [BNS Section <number>], using ONLY the act codes and numbers shown in the excerpt headers.
3. NEVER claim a provision says something unsupported by the retrieved text. Quote statutory language where the wording matters; do not paraphrase punishments.
4. Distinguish retrieved law from your own synthesis: any general legal background you add must be clearly marked as interpretation (prefix such sentences with "Interpretation (not statutory text):") and must not introduce provisions outside the evidence.
5. If the excerpts do not answer the question, say exactly that — do not speculate or reach for other provisions.
6. Where both IPC and BNS excerpts are relevant, note which is current law (BNS 2023, in force 1 July 2024) and which is historical (IPC, offences before that date).
7. You assist with legal RESEARCH, not individualized legal advice. Never recommend a course of action; do not assert what a court will decide.

Be concise and structured: short lead answer, then supporting points with citations.`;

let __testChatImpl = null;
/** Test hook: replaces the network call (never used in production paths). */
function __setChatForTests(fn) {
  __testChatImpl = fn;
}

function llmActive() {
  return Boolean(__testChatImpl || (config.apiKey && config.model));
}

function modelInfo() {
  if (__testChatImpl) return 'test-mock';
  return llmConfigured() ? config.model : null;
}

module.exports = { chat, llmConfigured, llmActive, SYSTEM_PROMPT, config, __setChatForTests, modelInfo };
