/** Text utilities shared by evidence selection and extractive generation. */

function splitSentences(text) {
  return String(text || '')
    .replace(/\n+/g, ' ')
    .split(/(?<=[.;])\s+(?=[A-Z“"(])|\s(?=Explanation\b|\d+[a-z]?\.\s)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractPenalty(text) {
  const m = String(text || '').match(/(?:shall\s+be\s+punished[^.]*\.|punishment\s+(?:with|for)[^.]*\.)/i);
  return m ? m[0].trim() : null;
}

module.exports = { splitSentences, extractPenalty };
