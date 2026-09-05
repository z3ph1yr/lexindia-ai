import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(ROOT, 'server');
let DB;
let child;
let base;

before(async () => {
  DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-api-')), 'legal.db');
  execFileSync('node', [path.join(SERVER, 'src', 'ingest', 'pipeline.js'), '--skip-network'], {
    env: { ...process.env, DB_PATH: DB },
    stdio: 'pipe',
  });
  const port = 8791;
  base = `http://localhost:${port}`;
  child = spawn('node', [path.join(SERVER, 'src', 'index.js')], {
    env: { ...process.env, DB_PATH: DB, PORT: String(port), RATE_LIMIT_QUERY: '1000', RATE_LIMIT_QUERY_BURST: '1000', RATE_LIMIT_API: '5000' },
    stdio: 'ignore',
  });
  // wait for server
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
});

after(async () => {
  if (child) child.kill();
  // give the OS a moment to release the DB file on Windows
  await new Promise((r) => setTimeout(r, 300));
  if (DB) {
    try { fs.rmSync(path.dirname(DB), { recursive: true, force: true }); } catch {}
  }
});

test('health reports the offline corpus', async () => {
  const h = await (await fetch(`${base}/api/health`)).json();
  assert.strictEqual(h.status, 'ok');
  assert.ok(h.corpus.provisions >= 575);
  assert.ok(h.corpus.byAct.some((a) => a.act_code === 'IPC'));
  assert.strictEqual(h.synthesis, 'extractive-deterministic');
});

test('search returns provenance-tagged provisions', async () => {
  const d = await (await fetch(`${base}/api/search?q=punishment+for+cheating&limit=4`)).json();
  assert.ok(d.results.length >= 3);
  const top = d.results[0];
  assert.strictEqual(top.actCode, 'IPC');
  assert.ok(['verified', 'unverified'].includes(top.verification));
  assert.ok(top.source && top.source.id);
  assert.ok(top.related !== undefined);
});

test('query endpoint grounds an extractive answer with citations', async () => {
  const r = await fetch(`${base}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'What is the punishment for cheating?' }),
  });
  const d = await r.json();
  assert.strictEqual(d.answer.mode, 'extractive');
  assert.ok(!d.answer.refusal);
  assert.ok(d.answer.text.includes('Section 420') || d.answer.text.includes('Section 415'));
  assert.ok(d.sources.length >= 2);
  assert.ok(d.sources[0].bnsSuccessor !== undefined);
});

test('query refuses off-topic questions instead of bluffing', async () => {
  const d = await (
    await fetch(`${base}/api/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'how do I renew my passport' }),
    })
  ).json();
  assert.strictEqual(d.answer.refusal, true);
});

test('section lookup returns full provenance chain', async () => {
  const s = await (await fetch(`${base}/api/sections/IPC/302`)).json();
  assert.strictEqual(s.section, '302');
  assert.match(s.normalized_text, /Whoever commits murder/);
  assert.ok(s.source.id);
  assert.ok(['verified', 'unverified'].includes(s.verification));
  assert.ok(s.act.status === 'repealed');
  const miss = await fetch(`${base}/api/sections/IPC/999`);
  assert.strictEqual(miss.status, 404);
});

test('corpus endpoint exposes the provenance strategy', async () => {
  const c = await (await fetch(`${base}/api/corpus`)).json();
  assert.ok(c.sources.length >= 1);
  assert.ok(c.coverage.demo.includes('IPC'));
  assert.ok(c.provenance.length > 20);
});
