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

before(async () => {
  DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-e2e-')), 'legal.db');
  execFileSync('node', [path.join(SERVER, 'src', 'ingest', 'pipeline.js'), '--skip-network'], {
    env: { ...process.env, DB_PATH: DB },
    stdio: 'pipe',
  });
});

after(async () => {
  await new Promise((r) => setTimeout(r, 200));
  try { fs.rmSync(path.dirname(DB), { recursive: true, force: true }); } catch {}
});

test('offline pipeline ingests the IPC corpus with valid provenance', () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  const provisions = db.prepare('SELECT COUNT(*) n FROM provisions').get().n;
  const chunks = db.prepare('SELECT COUNT(*) n FROM chunks').get().n;
  const sources = db.prepare('SELECT COUNT(*) n FROM sources').get().n;
  assert.ok(provisions >= 575 && chunks >= provisions && sources >= 1);
  const runs = db.prepare('SELECT status FROM ingest_runs ORDER BY run_id DESC LIMIT 1').get();
  assert.strictEqual(runs.status, 'ok');
  const report = JSON.parse(fs.readFileSync(path.join(path.dirname(DB), 'validation-report.json'), 'utf8'));
  assert.strictEqual(report.status, 'ok');
  assert.ok(report.corpus.provisions >= 575);
  db.close();
});

test('hybrid search: murder provisions ranked, citations pinned, weak queries gated', async () => {
  const mod = await import('../src/retrieval/hybrid.js');
  const db = new DatabaseSync(DB, { readOnly: true });
  const r1 = await mod.hybridSearch(db, 'punishment for murder', {});
  assert.ok(r1.results.some((r) => r.provision_no === '302' && r.act_code === 'IPC'));
  assert.ok(['302', '303', '300'].includes(r1.results[0].provision_no));

  const r2 = await mod.hybridSearch(db, 'IPC 420', {});
  assert.ok(r2.results.some((r) => r.provision_no === '420'));
  assert.strictEqual(r2.confidence, 'high');

  const r3 = await mod.hybridSearch(db, 'how do I renew my passport', {});
  assert.ok(r3.confidence === 'low' || r3.confidence === 'none');

  const r4 = await mod.hybridSearch(db, 'difference between culpable homicide and murder', {});
  assert.ok(r4.results.some((r) => ['299', '300', '304'].includes(r.provision_no)));
  db.close();
});
