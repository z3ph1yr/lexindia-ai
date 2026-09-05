// Reproduce API crash with visible stderr
const { execFileSync, spawn } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '../..');
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-')), 'legal.db');
execFileSync('node', [path.join(ROOT, 'server/src/ingest/pipeline.js')], {
  env: { ...process.env, DB_PATH: DB },
  stdio: 'pipe',
});
console.log('pipeline done');
const child = spawn('node', [path.join(ROOT, 'server/src/index.js')], {
  env: { ...process.env, DB_PATH: DB, PORT: '8799' },
});
child.stderr.on('data', (d) => console.log('STDERR:', String(d)));
child.stdout.on('data', (d) => console.log('STDOUT:', String(d)));
child.on('exit', (c) => console.log('SERVER EXITED', c));

(async () => {
  const B = 'http://localhost:8799';
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(B + '/api/health'); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log('health:', await (await fetch(B + '/api/health')).text());
  console.log('search:', (await (await fetch(B + '/api/search?q=punishment+for+cheating&limit=3')).text()).slice(0, 300));
  console.log('query:', (await (await fetch(B + '/api/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'punishment for cheating' }) })).text()).slice(0, 200));
  console.log('ALL DONE');
  child.kill();
  process.exit(0);
})().catch((e) => { console.log('ERR', e); child.kill(); process.exit(1); });
