/**
 * Normalization utilities for the ingestion pipeline.
 * Statutory text is never rewritten — only whitespace, HTML remnants and
 * encoding artifacts are normalized so retrieval and display behave.
 */

/** Convert the India Code note HTML fragment to plain text. */
function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<hr[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function normalizeWhitespace(t) {
  return String(t || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Full normalization for storage: verbatim wording preserved; HTML and
 * non-printing artifacts removed; whitespace canonicalized.
 */
function normalizeStatuteText(raw, { isHtml = false } = {}) {
  const t = normalizeWhitespace(isHtml ? htmlToText(raw) : raw);
  return t;
}

/**
 * Aggressive normalization for *comparison only* (verification scoring):
 * lowercase, punctuation stripped, whitespace collapsed.
 */
function normalizeForComparison(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-set Jaccard similarity in [0,1]. */
function similarity(a, b) {
  const A = new Set(normalizeForComparison(a).split(' ').filter(Boolean));
  const B = new Set(normalizeForComparison(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/**
 * Overlap coefficient |A∩B| / min(|A|,|B|): 1.0 when the smaller text is a
 * faithful subset of the larger (handles truncated excerpts and regional
 * extras such as official illustrations/footnotes).
 */
function overlapCoefficient(a, b) {
  const A = new Set(normalizeForComparison(a).split(' ').filter(Boolean));
  const B = new Set(normalizeForComparison(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

/** Detect provisions whose body is only a repeal/omission footnote. */
const REPEAL_RE = /^(rep(?:ealed)?\.?|omitted\.?|inserted|substituted|re-enacted|ins\.?|subs\.?)/i;
function isRepealNote(text) {
  return REPEAL_RE.test(String(text || '').trim());
}

/** Split a provision body into retrieval chunks on clause boundaries. */
function chunkText(text, { maxChars = 1800 } = {}) {
  const clean = normalizeWhitespace(text);
  if (clean.length <= maxChars) return [clean];
  const parts = clean.split(
    /\n(?=(?:Explanation|Exception|Illustrations?|First|Second|Third|Fourth|Fifth|Sixth|Seventh)\b|\n?\(?\d+[a-z]?\)|\n\d+[a-z]?\.\s|\n\()/i
  );
  const chunks = [];
  let buf = '';
  for (const p of parts) {
    if ((buf + '\n' + p).length > maxChars && buf) {
      chunks.push(buf.trim());
      buf = p;
    } else {
      buf = buf ? buf + '\n' + p : p;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

/** Valid IPC/BNS provision numbers: 1..3 digits + optional 1-2 letters. */
function isValidProvisionNumber(no) {
  return /^\d{1,3}[A-Z]{0,2}$/.test(String(no || '').trim().toUpperCase());
}

module.exports = {
  htmlToText,
  normalizeWhitespace,
  normalizeStatuteText,
  normalizeForComparison,
  similarity,
  overlapCoefficient,
  isRepealNote,
  chunkText,
  isValidProvisionNumber,
};
