/**
 * Snippet extraction for UI display (used by routes).
 * The ranked retrieval itself lives in hybrid.js.
 */

/** Best-matching region of a provision for display, plus highlight terms. */
function snippetFor(text, tokens, radius = 160) {
  if (!text) return { text: '', highlight: [] };
  const low = text.toLowerCase();
  let best = 0;
  let bestHits = -1;
  for (const t of tokens) {
    let idx = low.indexOf(t.toLowerCase());
    while (idx !== -1) {
      let hits = 0;
      const window = low.slice(Math.max(0, idx - radius), idx + radius);
      for (const u of tokens) if (window.includes(u.toLowerCase())) hits += 1;
      if (hits > bestHits) {
        bestHits = hits;
        best = idx;
      }
      idx = low.indexOf(t.toLowerCase(), idx + 1);
    }
  }
  const start = Math.max(0, best - radius / 2);
  const end = Math.min(text.length, best + radius * 1.5);
  return {
    text: (start > 0 ? '… ' : '') + text.slice(start, end).trim() + (end < text.length ? ' …' : ''),
    highlight: tokens,
  };
}

module.exports = { snippetFor };
