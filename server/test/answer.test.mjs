/**
 * Answer-generation layer tests.
 * Runs the real pipeline offline, then exercises: structure, citation
 * integrity, hallucination guards (mocked LLM), and insufficient-context
 * refusal behaviour.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(ROOT, 'server');
let DB;
let db;
let hybrid;
let answerLayer;
let provider;

const CITE_RE = /\[(IPC|BNS)\s*Section \s*\d{1,3}[A-Z]{0,2}\]/g;

before(async () => {
  DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-ans-')), 'legal.db');
  execFileSync('node', [path.join(SERVER, 'src', 'ingest', 'pipeline.js'), '--skip-network'], {
    env: { ...process.env, DB_PATH: DB },
    stdio: 'pipe',
  });
  db = new DatabaseSync(DB, { readOnly: true });
  hybrid = await import('../src/retrieval/hybrid.js');
  answerLayer = await import('../src/answer/index.js');
  provider = await import('../src/llm/provider.js');
});

after(async () => {
  db && db.close();
  await new Promise((r) => setTimeout(r, 200));
  try { fs.rmSync(path.dirname(DB), { recursive: true, force: true }); } catch {}
});

async function ask(question, opts = {}) {
  const h = await hybrid.hybridSearch(db, question, { limit: 8, ...opts });
  const sourcePayloads = h.results.map((e) => ({
    actCode: e.act_code,
    section: e.provision_no,
    provision_id: e.provision_id,
    title: e.title,
    verification: e.verification,
    provision: `${e.act_code} Section ${e.provision_no}`,
    source: { id: 'SRC-TEST', sourceUrl: `https://example.test/${e.act_code}/${e.provision_no}`, verifiedAgainstUrl: null },
  }));
  const out = await answerLayer.generateAnswer(question, h, sourcePayloads);
  return { ...out, h };
}

test('structured answer contains all required parts with resolved citations', async () => {
  const { answer } = await ask('What is the punishment for cheating?');
  assert.strictEqual(answer.refusal, false);
  const s = answer.structured;
  assert.ok(s.directAnswer && s.directAnswer.length > 20, 'direct answer present');
  assert.ok(Array.isArray(s.applicableLaw) && s.applicableLaw.length >= 2, 'provision cards present');
  for (const card of s.applicableLaw) {
    assert.match(card.provision, /^(IPC|BNS) Section \d{1,3}[A-Z]{0,2}$/);
    assert.ok(card.title);
    assert.ok(['in force', 'historical (act replaced 01-07-2024)'].includes(card.status));
  }
  assert.ok(s.explanation && s.explanation.length > 50, 'explanation present');
  assert.ok(Array.isArray(s.caveats), 'caveats array present');
  // citations resolve with provenance chain
  assert.ok(answer.citations.length >= 1);
  for (const c of answer.citations) {
    assert.ok(c.sourceId && c.sourceUrl, 'citation carries source id + url');
    assert.ok(c.provisionId, 'citation resolves to provision record');
  }
  // every citation marker in text maps to a resolved citation
  const textCites = [...new Set((answer.text.match(CITE_RE) || []).map((x) => x.replace(/[\[\]]|Section\s*/g, '').trim()))];
  const resolvedKeys = new Set(answer.citations.map((c) => `${c.act} ${c.section}`));
  for (const tc of textCites) assert.ok(resolvedKeys.has(tc), `unresolved citation in text: ${tc}`);
});

test('citation resolution strips invented provisions and keeps real ones', async () => {
  const { resolveCitations } = await import('../src/answer/citations.js');
  const sources = [
    { actCode: 'IPC', section: '302', provision: 'IPC Section 302', title: 'Punishment for murder', provision_id: 1, verification: 'verified', source: { id: 'S', sourceUrl: 'u', verifiedAgainstUrl: null } },
  ];
  const r = resolveCitations(
    'Murder is punished [IPC Section 302]; but also [IPC Section 999] and [CrPC Section 154] say things.',
    sources
  );
  assert.ok(!r.text.includes('Section 999'));
  assert.ok(!r.text.includes('CrPC'));
  assert.ok(r.text.includes('[IPC Section 302]'));
  assert.deepStrictEqual(r.dropped, ['IPC Section 999', 'CRPC Section 154']);
  assert.strictEqual(r.citations.length, 1);
  assert.strictEqual(r.citations[0].section, '302');
});

test('hallucination guard (mocked LLM): invented citations are stripped, valid kept', async () => {
  provider.__setChatForTests(() =>
    JSON.stringify({
      directAnswer: 'The punishment is life imprisonment [IPC Section 302] and additionally [IPC Section 999] applies. Also [BNS Section 777] is relevant.',
      explanation: 'Section 302 provides [IPC Section 302]. The CrPC procedure is [CrPC Section 154].',
      caveats: [],
      insufficient: false,
    })
  );
  try {
    const { answer, generation } = await ask('What is the punishment for murder?');
    assert.strictEqual(answer.mode, 'llm');
    assert.ok(!answer.text.includes('Section 999'), 'invented IPC Section 999 stripped');
    assert.ok(!answer.text.includes('Section 777'), 'invented BNS Section 777 stripped');
    assert.ok(!answer.text.includes('CrPC'), 'invented legislation stripped');
    assert.ok(answer.text.includes('Section 302'), 'valid citation kept');
    assert.ok(generation.citationsValidated.dropped >= 3, `dropped: ${JSON.stringify(generation.citationsValidated)}`);
    assert.ok(generation.citationsValidated.kept >= 1);
    assert.strictEqual(generation.model, 'test-mock', 'mock mode reports the mock model');
  } finally {
    provider.__setChatForTests(null);
  }
});

test('hallucination guard (mocked LLM): model claiming insufficiency triggers honest refusal', async () => {
  provider.__setChatForTests(() =>
    JSON.stringify({ directAnswer: 'x', explanation: 'y', caveats: [], insufficient: true })
  );
  try {
    const { answer } = await ask('punishment for cheating');
    assert.strictEqual(answer.insufficient, true);
    assert.match(answer.structured.directAnswer, /couldn't find sufficient supporting provisions/);
    assert.strictEqual(answer.citations.length, 0);
  } finally {
    provider.__setChatForTests(null);
  }
});

test('insufficient-context refusal: exact message, no fabricated law, refinement hint', async () => {
  const { answer } = await ask('how do I renew my passport quickly');
  assert.strictEqual(answer.refusal, true);
  assert.strictEqual(
    answer.structured.directAnswer,
    "I couldn't find sufficient supporting provisions in the current legal knowledge base to answer this reliably."
  );
  assert.ok(answer.refineHint && /refining|naming|provision/i.test(answer.refineHint + 'naming provision'));
  assert.strictEqual(answer.citations.length, 0);
  assert.strictEqual(answer.structured.applicableLaw.length, 0);
  assert.ok(!CITE_RE.test(answer.text), 'no citations in refusal');
});

test('off-domain legal question does not invent out-of-corpus statutes', async () => {
  const { answer } = await ask('What is the punishment for trademark infringement?');
  assert.ok(!/\bTrade Marks\b|\bTM Act\b/i.test(answer.text), 'no invented trademark statute');
  if (!answer.refusal) {
    const textCites = (answer.text.match(CITE_RE) || []).map((x) => x.replace(/[\[\]]|Section\s*/g, '').trim());
    const resolvedKeys = new Set(answer.citations.map((c) => `${c.act} ${c.section}`));
    for (const tc of textCites) assert.ok(resolvedKeys.has(tc), `unresolved: ${tc}`);
  }
});

test('evidence selection caps provisions and drops weak matches', async () => {
  const { selectEvidence } = await import('../src/answer/evidence.js');
  const fake = {
    results: Array.from({ length: 10 }, (_, i) => ({
      provision_id: i + 1,
      act_code: 'IPC',
      provision_no: String(100 + i),
      title: `T${i}`,
      normalized_text: `Provision ${i} text with enough length to be considered meaningful evidence for selection.`,
      uiScore: i === 9 ? 0.1 : 0.9 - i * 0.05,
      channels: i === 9 ? [] : ['bm25'],
      status: 'repealed',
      verification: 'unverified',
      normalized: { displayTokens: ['provision'], expansions: [] },
    })),
    confidence: 'high',
    citations: [],
  };
  const pack = selectEvidence(fake);
  assert.ok(pack.evidence.length <= 6, `selected ${pack.evidence.length}`);
  assert.ok(!pack.evidence.some((e) => e.uiScore < 0.35 && !e.channels.includes('citation')));
  assert.ok(pack.sufficient);
});

test('generation metadata exposes mode, model, latency and citation validation', async () => {
  const { generation } = await ask('punishment for theft');
  assert.ok(['llm', 'extractive'].includes(generation.mode));
  assert.strictEqual(generation.model, null); // offline: no provider configured
  assert.ok(typeof generation.latencyMs === 'number');
  assert.match(generation.groundingNote, /restricted to the retrieved evidence pack/);
  assert.ok(generation.citationsValidated && typeof generation.citationsValidated.kept === 'number');
});
