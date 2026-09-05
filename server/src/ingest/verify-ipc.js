/**
 * Stage: VERIFY (dual-source cross-verification of the IPC core set)
 *
 * For each curated IPC provision, retrieves the same provision from Indian
 * Kanoon (independent secondary archive) and computes token-set similarity
 * against the community-snapshot text. Results are cached verbatim in
 * data/raw/verify-cache/ so the pipeline is reproducible offline after the
 * first verification run.
 *
 * Never mutates text: verification only records a status, score and
 * evidence URL. On network failure the provision is marked 'unverified'
 * with a warning — it is never silently trusted.
 */
const fs = require('fs');
const path = require('path');
const { similarity, htmlToText } = require('./normalize');

const ROOT = path.resolve(__dirname, '../../../');
const CACHE_DIR = path.join(ROOT, 'data', 'raw', 'verify-cache');

const SEARCH_URL = 'https://indiankanoon.org/search/?formInput=';
const DOC_URL = 'https://indiankanoon.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const VERIFY_THRESHOLD = 0.82;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchDocRetry(url, { attempts = 4 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
      if (res.status === 429 || res.status === 503) {
        await sleep(12000 * (i + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (!/HTTP (429|503)/.test(String(e.message))) throw e;
    }
  }
  throw lastErr || new Error('rate limited');
}

async function fetchDoc(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Search Indian Kanoon for "Section N in The Indian Penal Code, 1860". */
async function findSectionDoc(provisionNo) {
  const q = `"Section ${provisionNo} in The Indian Penal Code"`;
  const html = await fetchDocRetry(SEARCH_URL + encodeURIComponent(q));
  const re = /<a href="(\/doc\/\d+\/?)"[^>]*>([^<]{5,140})<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const title = m[2].replace(/\s+/g, ' ').trim();
    if (new RegExp(`^Section ${provisionNo} in The Indian Penal Code`, 'i').test(title)) {
      return { docPath: m[1], title };
    }
  }
  return null;
}

/** Extract the provision text from an Indian Kanoon doc page. */
function extractDocText(html) {
  const m = html.match(/<section class="akn-section"[\s\S]*?>([\s\S]*?)<\/section>/i);
  if (m) return htmlToText(m[1]);
  const m2 = html.match(/<div class="doccontent"[\s\S]*?>([\s\S]*?)<\/div>/i);
  return m2 ? htmlToText(m2[1]) : '';
}

/**
 * Verify the IPC core list. snapshotTexts: { [provisionNo]: snapshot text }.
 * Returns { [provisionNo]: { status, score, url, error? } } with statuses:
 * verified | mismatch | unverified.
 */
async function verifyIpcCore(coreList, snapshotTexts, { refresh = false, log = console.log } = {}) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const out = {};
  const counts = { verified: 0, mismatch: 0, unverified: 0 };

  for (const no of coreList) {
    const cacheFile = path.join(CACHE_DIR, `${no}.json`);
    let record = null;
    if (!refresh && fs.existsSync(cacheFile)) {
      record = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } else {
      try {
        const doc = await findSectionDoc(no);
        if (!doc) throw new Error('section doc not found in archive search');
        const html = await fetchDoc(DOC_URL + doc.docPath);
        const theirText = extractDocText(html);
        if (!theirText || theirText.length < 20) throw new Error('empty extracted text');
        const snapshotText = snapshotTexts[no] || '';
        if (!snapshotText) throw new Error('snapshot text empty — nothing to compare');
        const score = similarity(theirText, snapshotText);
        record = {
          provision_no: no,
          doc_path: doc.docPath,
          doc_title: doc.title,
          score,
          status: score >= VERIFY_THRESHOLD ? 'verified' : 'mismatch',
          source: 'SRC-INDIAN-KANOON',
          checked_at: new Date().toISOString(),
          comparison_text: theirText, // kept for audit
        };
        log(`[verify] IPC Section ${no}: ${record.status} (similarity ${score})`);
      } catch (e) {
        record = {
          provision_no: no,
          status: 'unverified',
          error: String(e.message || e).slice(0, 200),
          source: 'SRC-INDIAN-KANOON',
          checked_at: new Date().toISOString(),
        };
        log(`[verify] IPC Section ${no}: unverified (${record.error})`);
      }
      fs.writeFileSync(cacheFile, JSON.stringify(record, null, 1));
      await sleep(350); // polite rate limit
    }
    counts[record.status] = (counts[record.status] || 0) + 1;
    out[no] = {
      status: record.status,
      score: record.score ?? null,
      url: record.doc_path ? DOC_URL + record.doc_path : null,
      error: record.error,
    };
  }
  return { results: out, counts };
}

module.exports = { verifyIpcCore, VERIFY_THRESHOLD };
