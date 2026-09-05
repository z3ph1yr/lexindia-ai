/**
 * Stage: VERIFY — official-source cross-verification for IPC 1860.
 *
 * Primary target: the official bare act PDF published by India Code
 * (Legislative Department, Ministry of Law & Justice), retrieved via the
 * Internet Archive snapshot of indiacode.nic.in. The PDF is parsed and each
 * provision's text region compared (token-set similarity, whitespace/pagination
 * insensitive) against the community-snapshot text used for display.
 *
 * Secondary target (fallback): Indian Kanoon per-provision pages.
 *
 * Verification NEVER rewrites stored text — it only records status, score
 * and evidence URL on the provision row.
 */
const fs = require('fs');
const path = require('path');
const { normalizeForComparison, overlapCoefficient, isRepealNote } = require('./normalize');
const { verifyIpcCore } = require('./verify-ipc');

const ROOT = path.resolve(__dirname, '../../..');
const PDF_DIR = path.join(ROOT, 'data', 'raw', 'indiacode');
const PDF_FILE = path.join(PDF_DIR, 'ipc-1860-official.pdf');
const PDF_ARCHIVE_URL =
  'https://web.archive.org/web/2023id_/https://www.indiacode.nic.in/bitstream/123456789/15407/1/ipc1860.pdf';

const VERIFY_THRESHOLD = 0.8;

async function ensureOfficialPdf({ refresh = false, log = console.log } = {}) {
  if (!refresh && fs.existsSync(PDF_FILE)) return PDF_FILE;
  fs.mkdirSync(PDF_DIR, { recursive: true });
  log('[verify-pdf] downloading official IPC bare act (India Code via Internet Archive)…');
  const res = await fetch(PDF_ARCHIVE_URL, { signal: AbortSignal.timeout(120000), redirect: 'follow' });
  if (!res.ok) throw new Error(`PDF fetch HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.slice(0, 5).toString('latin1') !== '%PDF-') throw new Error('not a PDF');
  fs.writeFileSync(PDF_FILE, buf);
  log(`[verify-pdf] cached official PDF (${buf.length} bytes)`);
  return PDF_FILE;
}

/** Extract per-provision text regions from the parsed official PDF text. */
function extractProvisionTexts(pdfText) {
  const text = String(pdfText || '').replace(/\r/g, '');
  // Section heading appears as its own line: "\n302.\n" (TOC-style repeat) and
  // inline with title: "\n302. Punishment for murder.--"
  const headingRe = /\n(\d{1,3}[A-Z]{0,2})\.\s*\n|\n(\d{1,3}[A-Z]{0,2})\.\s+[^\n]{3,160}\.--/g;
  const hits = [];
  let m;
  while ((m = headingRe.exec(text))) {
    hits.push({ no: (m[1] || m[2]).toUpperCase(), start: m.index + 1, end: m.index + m[0].length });
  }
  // The bare act is strictly ordered; in-text cross-references ("… section 302.")
  // can produce out-of-order pseudo-headings. Keep only monotonic boundaries.
  const compareNo = (a, b) => {
    const pa = a.match(/^(\d+)([A-Z]*)$/);
    const pb = b.match(/^(\d+)([A-Z]*)$/);
    const d = Number(pa[1]) - Number(pb[1]);
    return d !== 0 ? d : (pa[2] || '').localeCompare(pb[2] || '');
  };
  const kept = [];
  for (const h of hits) {
    const prev = kept[kept.length - 1];
    if (prev && compareNo(h.no, prev.no) < 0) continue;
    kept.push(h);
  }
  const regions = new Map();
  for (let i = 0; i < kept.length; i += 1) {
    const h = kept[i];
    const next = kept[i + 1];
    const end = next ? next.start : Math.min(text.length, h.start + 8000);
    let body = text.slice(h.end, end);
    // Official PDFs render page footnotes at the page bottom; they appear as
    // "1. Subs. by Act 3 of 1951, …" lines inside the region — strip them.
    body = body
      .split('\n')
      .filter((line) => !/^\s*\d+\.\s+(Subs|Ins|Omitted|Substituted|Inserted|Amended|Sub)\.?\s/i.test(line))
      .join('\n');
    body = body
      .replace(/--\s*\d+\s*of\s*\d+\s*--/g, ' ')
      .replace(/^\s*-{3,}\s*$/gm, ' ')
      .replace(/\d+\*\[/g, ' ')
      .replace(/\]\*\d*/g, ' ')
      .replace(/\d+\*/g, ' ')
      .replace(/-{5,}/g, ' ')
      .replace(/\t/g, ' ')
      .replace(/\bhe likely\b/g, 'be likely') // known PDF extraction artifact guard
      .replace(/\s+/g, ' ')
      .trim();
    // TOC-style echoes yield title-only regions; keep the richest per number.
    if (body.length > 20 && !isRepealNote(body) && body.length > (regions.get(h.no) || '').length) {
      regions.set(h.no, body);
    }
  }
  return regions;
}

async function parsePdfText(pdfFile) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: fs.readFileSync(pdfFile) });
  try {
    const d = await parser.getText();
    return d.text || '';
  } finally {
    await parser.destroy();
  }
}

/**
 * Verify IPC provisions (core + extended) against the official PDF.
 * Returns { results: {no: {status, score, url}}, counts }.
 */
async function verifyIpcAgainstOfficial(snapshotTexts, { refresh = false, log = console.log } = {}) {
  const results = {};
  const counts = { verified: 0, mismatch: 0, unverified: 0 };
  let pdfFile = null;
  try {
    pdfFile = await ensureOfficialPdf({ refresh, log });
  } catch (e) {
    log(`[verify-pdf] WARNING: official PDF unavailable (${String(e.message).slice(0, 120)})`);
  }

  let regions = new Map();
  if (pdfFile) {
    try {
      regions = extractProvisionTexts(await parsePdfText(pdfFile));
      log(`[verify-pdf] extracted ${regions.size} provision regions from official text`);
    } catch (e) {
      log(`[verify-pdf] WARNING: PDF parse failed (${String(e.message).slice(0, 120)})`);
    }
  }

  for (const [no, snapshotText] of Object.entries(snapshotTexts)) {
    if (regions.has(no) && snapshotText && snapshotText.length > 40) {
      const score = overlapCoefficient(regions.get(no), snapshotText);
      const status = score >= VERIFY_THRESHOLD ? 'verified' : 'mismatch';
      counts[status] += 1;
      results[no] = {
        status,
        score: Math.round(score * 1000) / 1000,
        url: PDF_ARCHIVE_URL,
        source: 'SRC-INDIA-CODE-API',
        note: 'Official bare act (archived India Code PDF), automated comparison (overlap coefficient)',
      };
      if (status === 'mismatch') log(`[verify-pdf] IPC Section ${no}: mismatch (overlap ${results[no].score})`);
    } else {
      results[no] = null; // fallback path handles these
    }
  }
  return { results, counts, regions };
}

module.exports = { verifyIpcAgainstOfficial, ensureOfficialPdf, extractProvisionTexts, VERIFY_THRESHOLD };
