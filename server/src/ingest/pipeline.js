/**
 * Ingestion pipeline (reproducible):
 *
 *   source → fetch → parse → normalize → provision extraction → chunking
 *          → verification (dual-source) → enrichment (relations)
 *          → embedding (optional) → indexing (FTS) → validation
 *
 * Every stage is a module; the pipeline records a run (ingest_runs) and a
 * validation report (data/validation-report.json). Never fabricates text:
 * if an official source cannot be reached, that act is skipped with a
 * warning rather than substituted.
 *
 * Usage:
 *   node src/ingest/pipeline.js [--refresh] [--skip-network]
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const { normalizeStatuteText, chunkText, isRepealNote, isValidProvisionNumber } = require('./normalize');
const SOURCES = require('./sources');
const { IPC_CORE, BNS_CORE } = require('./manifest');
const { fetchAllBnsSections } = require('./fetch-indiacode');
const { verifyIpcAgainstOfficial } = require('./verify-pdf');
const { verifyIpcCore } = require('./verify-ipc');
const { buildRelations } = require('./relations');
const { embedChunks, embeddingsConfigured } = require('./embed');
const { validate } = require('./validate');

const ROOT = path.resolve(__dirname, '../../..');
const SNAPSHOT = path.join(ROOT, 'data', 'raw', 'ipc-1860.json');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'legal.db');
const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

const IPC_ENACTED = '1860-10-06';
const IPC_IN_FORCE_UNTIL = '2024-06-30'; // BNS in force 01-07-2024
const BNS_EFFECTIVE = '2024-07-01';

async function main() {
  const args = new Set(process.argv.slice(2));
  const refresh = args.has('--refresh');
  const skipNetwork = args.has('--skip-network');
  const startedAt = new Date().toISOString();
  const log = (...a) => console.log(...a);

  // ------------------------------------------------------------- sources
  // Rebuild: the pipeline is the single writer; a stale schema would silently
  // corrupt the run (CREATE TABLE IF NOT EXISTS would skip migrated tables).
  for (const suffix of ['', '-wal', '-shm']) {
    const f = DB_PATH + suffix;
    if (fs.existsSync(f)) fs.rmSync(f);
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec(SCHEMA);
  const insSource = db.prepare('INSERT OR REPLACE INTO sources (source_id, name, authority, url, license, note) VALUES (?,?,?,?,?,?)');
  for (const s of SOURCES) insSource.run(s.source_id, s.name, s.authority, s.url, s.license, s.note);
  log(`[sources] registered ${SOURCES.length} sources`);

  // ----------------------------------------------------------- acts
  const insAct = db.prepare(`INSERT INTO acts
    (act_code, name, year, act_number, jurisdiction, status, effective_date, repealed_date, successor, note, source_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  insAct.run(
    'IPC', 'Indian Penal Code, 1860', 1860, '45 of 1860', 'IN', 'repealed', IPC_ENACTED, IPC_IN_FORCE_UNTIL, 'BNS',
    'Replaced by the Bharatiya Nyaya Sanhita, 2023 (Act 45 of 2023) w.e.f. 1 July 2024. Retained for historical liability (offences before that date).',
    'SRC-IPC-SNAPSHOT'
  );

  let bns = null;
  try {
    if (skipNetwork && !fs.existsSync(require('./fetch-indiacode').CACHE_FILE)) {
      throw new Error('skip-network requested and no cache present');
    }
    bns = await fetchAllBnsSections({ refresh, log });
  } catch (e) {
    log(`[fetch] WARNING: official BNS ingest skipped (${String(e.message).slice(0, 140)})`);
  }
  if (bns) {
    insAct.run(
      'BNS', 'Bharatiya Nyaya Sanhita, 2023', 2023, '45 of 2023', 'IN', 'in_force', BNS_EFFECTIVE, null, null,
      'Replaced the Indian Penal Code, 1860 w.e.f. 1 July 2024. Text ingested from the India Code Digital Repository API.',
      'SRC-INDIA-CODE-API'
    );
  }

  // ------------------------------------------------- provisions + chunks
  const insProvision = db.prepare(`INSERT INTO provisions
    (act_code, provision_no, title, full_text, normalized_text, chapter, chapter_title,
     collection, text_status, status, effective_date, effective_note, source_id, source_url,
     verified_against_url, verification, verification_score, repeal_note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insChunk = db.prepare(`INSERT INTO chunks
    (provision_id, act_code, provision_no, chunk_index, text, embedding_status)
    VALUES (?,?,?,?,?,?)`);

  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  if (!Array.isArray(snapshot) || snapshot.length < 400) {
    throw new Error(`Unexpected IPC snapshot shape (${snapshot && snapshot.length} rows) — refusing to ingest.`);
  }

  let ipcCoreVerified = 0;
  let ipcVerifiedTotal = 0;
  const ipcCoreList = IPC_CORE.filter((no) => snapshot.some((r) => String(r.Section) === no));

  // Snapshot text per provision (verification targets).
  const snapshotTexts = {};
  for (const row of snapshot) {
    const no = String(row.Section).trim();
    const text = normalizeStatuteText(row.section_desc || '');
    if (text && text.length > 40) snapshotTexts[no] = text;
  }

  // Dual-source verification: official PDF (primary), Indian Kanoon (fallback
  // for provisions the PDF extraction could not cover). Network optional.
  const verification = { results: {}, counts: { verified: 0, mismatch: 0, unverified: 0 } };
  try {
    if (skipNetwork) throw new Error('skip-network');
    const { results, counts } = await verifyIpcAgainstOfficial(snapshotTexts, { refresh, log });
    Object.assign(verification.results, results);
    verification.counts = counts;

    // Indian Kanoon fallback only for IPC CORE provisions not covered by the PDF
    const fallbackNos = ipcCoreList.filter((no) => !results[no]);
    if (fallbackNos.length) {
      const fb = await verifyIpcCore(fallbackNos, snapshotTexts, { refresh, log });
      Object.assign(verification.results, fb.results);
      for (const [k, v] of Object.entries(fb.counts)) verification.counts[k] = (verification.counts[k] || 0) + v;
    }
  } catch (e) {
    log(`[verify] WARNING: cross-verification unavailable (${String(e.message).slice(0, 100)}) — provisions marked unverified`);
  }

  let provisionCount = 0;
  let chunkCount = 0;
  let bnsCount = 0;
  db.exec('BEGIN');
  try {

  // IPC (extended: snapshot; core: cross-verified subset)
  for (const row of snapshot) {
    const no = String(row.Section).trim();
    if (!isValidProvisionNumber(no)) throw new Error(`Malformed provision number in snapshot: "${no}"`);
    const title = normalizeStatuteText(row.section_title || '');
    const text = normalizeStatuteText(row.section_desc || '');
    const isCore = IPC_CORE.includes(no);
    const v = verification.results[no];
    const full = text.length >= 10;
    const collection = isCore ? 'core' : 'extended';
    const ver = v && v.status === 'verified' ? 'verified' : 'unverified';
    const textStatus = full ? 'full' : 'title_only';
    const info = insProvision.run(
      'IPC', no, title, text, text, String(row.chapter || ''), normalizeStatuteText(row.chapter_title || ''),
      collection, textStatus, 'repealed', IPC_ENACTED,
      `In force until 30 June 2024; applies to offences committed before 1 July 2024 (BNS 2023 in force thereafter)`,
      'SRC-IPC-SNAPSHOT', SOURCES_URLS.ipcSnapshot,
      v && v.status === 'verified' ? v.url : null,
      ver, v && v.score != null ? v.score : null,
      isRepealNote(text) ? 1 : 0
    );
    const pid = Number(info.lastInsertRowid);
    provisionCount += 1;
    if (v && v.status === 'verified') {
      ipcVerifiedTotal += 1;
      if (isCore) ipcCoreVerified += 1;
    }

    const chunks = full ? chunkText(text) : [title];
    chunks.forEach((c, i) => {
      insChunk.run(pid, 'IPC', no, i, c, 'pending');
      chunkCount += 1;
    });
  }

  // BNS (official India Code text)
  if (bns) {
    const seen = new Set();
    for (const s of bns.sections) {
      const no = String(s.provisionNo || '').trim();
      if (!no) throw new Error('India Code section item missing section_number');
      const key = `BNS:${no.toUpperCase()}`;
      if (seen.has(key)) throw new Error(`Duplicate BNS section from official source: ${no}`);
      seen.add(key);
      const text = normalizeStatuteText(s.html || '', { isHtml: true });
      const title = normalizeStatuteText(s.title || '').replace(/\.$/, '');
      const isCore = BNS_CORE.includes(no);
      const info = insProvision.run(
        'BNS', no, title, text, text, null, null,
        isCore ? 'core' : 'extended', text ? 'full' : 'title_only', 'in_force', BNS_EFFECTIVE,
        'In force from 1 July 2024',
        'SRC-INDIA-CODE-API',
        `https://indiacode.gov.in/items/${s.uuid}`,
        null, 'official', null,
        isRepealNote(text) ? 1 : 0
      );
      const pid = Number(info.lastInsertRowid);
      provisionCount += 1;
      bnsCount += 1;
      const chunks = chunkText(text);
      chunks.forEach((c, i) => {
        insChunk.run(pid, 'BNS', no, i, c, 'pending');
        chunkCount += 1;
      });
    }
  }
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  db.exec('COMMIT');
  log(`[provisions] ${provisionCount} provisions, ${chunkCount} chunks (IPC: ${snapshot.length}, BNS: ${bnsCount})`);

  // ---------------------------------------------------------- relations
  const relCounts = buildRelations(db, log);

  // ------------------------------------------------------------ embed
  const embedResult = await embedChunks(db, log);

  // --------------------------------------------------------- validate
  const report = validate(db, path.join(path.dirname(DB_PATH), 'validation-report.json'));
  log(`[validate] status=${report.status} errors=${report.errors.length} warnings=${report.warnings.length}`);

  const counts = {
    provisions: provisionCount,
    chunks: chunkCount,
    acts: bns ? 2 : 1,
    ipcCoreVerified,
    ipcVerifiedTotal,
    verification: verification.counts,
    relations: relCounts,
    embeddings: embedResult,
  };
  db.prepare(`INSERT INTO ingest_runs (started_at, finished_at, stages, counts, validation, status)
    VALUES (?,?,?,?,?,?)`).run(
    startedAt, new Date().toISOString(),
    JSON.stringify(['sources', 'acts', 'fetch', 'verify', 'provisions', 'chunks', 'relations', 'embed', 'validate']),
    JSON.stringify(counts),
    JSON.stringify({ status: report.status, errors: report.errors.length, warnings: report.warnings.length }),
    report.status === 'ok' ? 'ok' : 'failed'
  );

  db.close();

  if (report.status !== 'ok') {
    console.error(`[pipeline] FAILED validation:\n${report.errors.slice(0, 30).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('[pipeline] done.', JSON.stringify(counts));
  }
}

const SOURCES_URLS = {
  ipcSnapshot: 'https://github.com/civictech-India/Indian-Law-Penal-Code-Json/blob/main/ipc.json',
};

main().catch((e) => {
  console.error('[pipeline] fatal:', e);
  process.exit(1);
});
