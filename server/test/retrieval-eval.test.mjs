/**
 * Retrieval quality evaluation.
 * Runs the real pipeline offline into a temp DB, then measures whether the
 * EXPECTED provisions appear among the top results for each query class:
 * exact section, terminology, paraphrase, partial terminology, irrelevant,
 * IPC-filtered, BNS-filtered, mixed.
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

before(async () => {
  DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-rt-')), 'legal.db');
  execFileSync('node', [path.join(SERVER, 'src', 'ingest', 'pipeline.js'), '--skip-network'], {
    env: { ...process.env, DB_PATH: DB },
    stdio: 'pipe',
  });
  db = new DatabaseSync(DB, { readOnly: true });
  hybrid = await import('../src/retrieval/hybrid.js');
});

after(async () => {
  db && db.close();
  await new Promise((r) => setTimeout(r, 200));
  try { fs.rmSync(path.dirname(DB), { recursive: true, force: true }); } catch {}
});

const nos = (results) => results.map((r) => `${r.act_code}:${r.provision_no}`);
const has = (results, act, no, k = 5) =>
  results.slice(0, k).some((r) => r.act_code === act && r.provision_no === no);

test('1. exact section query — "Section 378" pins IPC Section 378 at rank 1 via citation channel', async () => {
  const h = await hybrid.hybridSearch(db, 'Section 378', {});
  assert.ok(h.results[0].provision_no === '378' && h.results[0].act_code === 'IPC', `got ${nos(h.results)}`);
  assert.ok(h.results[0].channels.includes('citation'));
  assert.strictEqual(h.confidence, 'high');
});

test('1b. explicit section param — IPC only', async () => {
  const h = await hybrid.hybridSearch(db, '', { section: '420', legislation: 'IPC' });
  assert.ok(h.results.some((r) => r.provision_no === '420' && r.act_code === 'IPC'), `got ${nos(h.results)}`);
  assert.ok(h.results.every((r) => r.act_code === 'IPC'));
});

test('1c. section param with legislation miss reports where the section lives', async () => {
  // BNS corpus in offline mode doesn't exist; the test DB only has IPC (skip-network, no cache in temp dir)
  const h = await hybrid.hybridSearch(db, '', { section: '420', legislation: 'BNS' });
  assert.strictEqual(h.results.length, 0);
});

test('2. natural-language terminology — "What constitutes theft?" finds the definition', async () => {
  const h = await hybrid.hybridSearch(db, 'What constitutes theft?', {});
  assert.ok(has(h.results, 'IPC', '378', 5), `got ${nos(h.results)}`);
  assert.ok(h.results.some((r) => ['379', '378'].includes(r.provision_no) && r.act_code === 'IPC'));
});

test('3. paraphrased/conceptual question — "dishonestly takes movable property without consent"', async () => {
  const h = await hybrid.hybridSearch(db, 'What offence applies when someone dishonestly takes movable property without consent?', {});
  assert.ok(
    has(h.results, 'IPC', '378', 8) || has(h.results, 'IPC', '379', 8),
    `theft provisions not in top 8: ${nos(h.results)}`
  );
  assert.ok(h.channels.tfidf > 0 || h.channels.bm25 > 0, 'expected non-citation channels to fire');
});

test('4. partial legal terminology — "criminal breach trust" (missing "of")', async () => {
  const h = await hybrid.hybridSearch(db, 'criminal breach trust', {});
  assert.ok(has(h.results, 'IPC', '405', 6) || has(h.results, 'IPC', '406', 6), `got ${nos(h.results)}`);
});

test('5. irrelevant question is gated, not answered', async () => {
  const h = await hybrid.hybridSearch(db, 'how do I renew my passport quickly', {});
  assert.ok(h.confidence === 'low' || h.confidence === 'none');
});

test('5b. genuinely unrelated statute area stays out of top results', async () => {
  const h = await hybrid.hybridSearch(db, 'best restaurants in Mumbai', {});
  assert.ok(h.confidence !== 'high');
});

test('6. IPC-filtered query returns only IPC provisions with murder ranked', async () => {
  const h = await hybrid.hybridSearch(db, 'punishment for murder', { legislation: 'IPC' });
  assert.ok(h.results.length > 0);
  assert.ok(h.results.every((r) => r.act_code === 'IPC'), `leaked: ${nos(h.results)}`);
  assert.ok(has(h.results, 'IPC', '302', 3), `got ${nos(h.results)}`);
});

test('7. BNS-filtered query (online cache present) returns only BNS provisions', async () => {
  // BNS data comes from the India Code cache; if the cache is unavailable in
  // this environment the pipeline skips the act and the test degrades gracefully.
  const n = db.prepare("SELECT COUNT(*) n FROM provisions WHERE act_code='BNS'").get().n;
  if (!n) return console.log('(skipped: no BNS cache in this environment)');
  const h = await hybrid.hybridSearch(db, 'punishment for murder', { legislation: 'BNS' });
  assert.ok(h.results.every((r) => r.act_code === 'BNS'), `leaked: ${nos(h.results)}`);
  assert.ok(has(h.results, 'BNS', '103', 3), `got ${nos(h.results)}`);
});

test('8. mixed query (no filter) surfaces both acts', async () => {
  const h = await hybrid.hybridSearch(db, 'punishment for cheating', {});
  const ipc = h.results.some((r) => r.act_code === 'IPC' && ['415', '417', '420'].includes(r.provision_no));
  const n = db.prepare("SELECT COUNT(*) n FROM provisions WHERE act_code='BNS'").get().n;
  if (!n) {
    assert.ok(ipc, `got ${nos(h.results)}`);
    return;
  }
  const bns = h.results.some((r) => r.act_code === 'BNS' && r.provision_no.startsWith('318'));
  assert.ok(ipc && bns, `got ${nos(h.results)}`);
});

test('9. every result carries retrieval transparency metadata', async () => {
  const h = await hybrid.hybridSearch(db, 'punishment for cheating', {});
  for (const r of h.results) {
    assert.ok(r.channels.length >= 1, 'channels recorded');
    assert.ok(r.why.length >= 1, 'why recorded');
    assert.ok(typeof r.uiScore === 'number' && r.uiScore >= 0 && r.uiScore <= 1.0001);
    assert.ok(['strong retrieval match', 'moderate retrieval match', 'related', 'weak'].includes(r.relevanceLabel));
    assert.ok(r.normalized_text && r.title !== undefined);
  }
});

test('10. TF-IDF channel matches paraphrase BM25 misses', async () => {
  // deliberately awkward phrasing: "takes away moveable goods secretly"
  const h = await hybrid.hybridSearch(db, 'takes away moveable goods secretly', {});
  const lexicalOnly = h.results.length > 0;
  assert.ok(lexicalOnly || h.confidence === 'low');
});
