/**
 * Stage: FETCH (official source)
 *
 * Retrieves the Bharatiya Nyaya Sanhita, 2023 section items from the
 * India Code Digital Repository REST API (Government of India) and caches
 * them verbatim under data/raw/indiacode/. Subsequent runs replay the cache
 * (reproducible, and polite to the government server).
 *
 * Fallback: if the network is unavailable and no cache exists, the stage is
 * skipped with a warning — the BNS act is simply not ingested (never
 * substituted with unverified text).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../');
const CACHE_DIR = path.join(ROOT, 'data', 'raw', 'indiacode');
const CACHE_FILE = path.join(CACHE_DIR, 'bns-2023-sections.json');

const API = 'https://indiacode.gov.in/server/api';
const SECTION_COLLECTION = '9a5b5f4a-4ccf-4cef-9820-0d33f8a6707f';
const BNS_ACT_ID = 'AC_CEN_5_23_00048_2023-45_1719292564123';
const PAGE_SIZE = 100;

async function fetchAllBnsSections({ refresh = false, log = console.log } = {}) {
  if (!refresh && fs.existsSync(CACHE_FILE)) {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    log(`[fetch] using cached India Code snapshot (${cached.sections.length} sections, fetched ${cached.fetchedAt})`);
    return cached;
  }

  log('[fetch] querying India Code DSpace API for BNS 2023 section items…');
  const sections = [];
  let page = 0;
  let totalElements = null;
  const requestUrls = [];

  while (true) {
    const url = `${API}/discover/search/objects?scope=${SECTION_COLLECTION}&f.act_id=${BNS_ACT_ID},equals&size=${PAGE_SIZE}&page=${page}`;
    requestUrls.push(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw new Error(`India Code API HTTP ${res.status}`);
    const data = await res.json();
    const sr = data._embedded.searchResult;
    totalElements = sr.page.totalElements;
    const objs = sr._embedded.objects || [];
    for (const o of objs) {
      const it = o._embedded.indexableObject;
      const md = it.metadata || {};
      const note = (md['dc.identifier.section_page_note'] || [{}])[0].value || '';
      sections.push({
        provisionNo: (md['dc.identifier.section_number'] || [{}])[0].value,
        title: (md['dc.title'] || [{}])[0].value || '',
        html: note,
        uuid: it.uuid,
        uri: (md['dc.identifier.uri'] || [{}])[0].value || '',
        actName: (md['dc.title.act_name'] || [{}])[0].value || 'The Bharatiya Nyaya Sanhita, 2023',
        actNumber: (md['dc.identifier.act_number'] || [{}])[0].value || '',
        repealed: (md['dc.identifier.repealed'] || [{}])[0].value || 'false',
        accessioned: (md['dc.date.accessioned'] || [{}])[0].value || '',
        stateName: (md['dc.identifier.state_name'] || [{}])[0].value || '',
      });
    }
    page += 1;
    if (page * PAGE_SIZE >= totalElements || objs.length === 0) break;
    await sleep(400); // polite to the government server
  }

  const payload = {
    fetchedAt: new Date().toISOString(),
    sourceUrl: API,
    actId: BNS_ACT_ID,
    totalElements,
    requestUrls,
    sections,
  };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 1));
  log(`[fetch] cached ${sections.length} BNS section items (expected ${totalElements})`);
  if (sections.length !== totalElements) throw new Error(`Fetch mismatch: got ${sections.length}, expected ${totalElements}`);
  return payload;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { fetchAllBnsSections, CACHE_FILE, BNS_ACT_ID };
