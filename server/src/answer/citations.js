/**
 * Stage 5a: CITATION RESOLUTION.
 * Every citation marker produced by a generator ([IPC Section 302], [BNS Section 103]) is
 * resolved against the retrieved sources. Citations that do not resolve to a
 * retrieved record are hallucinations: they are stripped from the answer text
 * and counted — including markers citing legislation that is not in the
 * corpus at all (e.g. [CrPC Section 154]). A citation that survives carries the full
 * provenance chain (provision id, source id, source URL, evidence URL) so the
 * UI can open the underlying statute.
 */
const CITE_RE = /\[([A-Za-z]{1,8})\s*Section \s*(\d{1,3}[A-Z]{0,2})\]/g;
const KNOWN_ACTS = new Set(['IPC', 'BNS']);

/**
 * @param text answer text containing markers
 * @param sources retrieved payloads (as returned by routes' toResult)
 * @returns { text, citations[], dropped: string[], kept: number }
 */
function resolveCitations(text, sources) {
  const byKey = new Map(
    sources.map((s) => [`${s.actCode}:${s.section.toUpperCase()}`, s])
  );
  const citations = [];
  const dropped = [];
  const seen = new Set();
  const original = String(text || '');

  // Pass 1: classify every marker, recording positions.
  const markers = [];
  let m;
  CITE_RE.lastIndex = 0;
  while ((m = CITE_RE.exec(original))) {
    const actU = m[1].toUpperCase();
    const secU = m[2].toUpperCase();
    const valid = KNOWN_ACTS.has(actU) && byKey.has(`${actU}:${secU}`);
    markers.push({ act: actU, sec: secU, start: m.index, end: m.index + m[0].length, valid });
    if (!valid && !dropped.includes(`${actU} Section ${secU}`)) dropped.push(`${actU} Section ${secU}`);
  }

  // Pass 2: any sentence (or semicolon-separated claim) containing an invalid
  // marker is unsupported — drop the whole claim, not just the marker.
  const sentenceRe = /[^.!?;\n]+[.!?;]*\s*|[^.!?;\n]+$/g;
  let out = '';
  let cursor = 0;
  let sm;
  while ((sm = sentenceRe.exec(original))) {
    const sStart = sm.index;
    const sEnd = sm.index + sm[0].length;
    const hasDropped = markers.some((mk) => !mk.valid && mk.start >= sStart && mk.end <= sEnd);
    if (hasDropped) {
      out += original.slice(cursor, sStart);
      cursor = sEnd;
    }
  }
  if (cursor === 0) out = original; // nothing dropped

  // Pass 3: normalize kept markers and collect resolved citations.
  const finalText = out.replace(CITE_RE, (whole, act, sec) => {
    const actU = act.toUpperCase();
    const key = `${actU}:${sec.toUpperCase()}`;
    const s = byKey.get(key);
    if (!s || !KNOWN_ACTS.has(actU)) return '';
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({
        id: citations.length + 1,
        act: s.actCode,
        section: s.section,
        provision: s.provision,
        title: s.title,
        provisionId: s.provision_id,
        sourceId: s.source ? s.source.id : null,
        sourceUrl: s.source ? s.source.sourceUrl : null,
        verifiedAgainstUrl: s.source ? s.source.verifiedAgainstUrl : null,
        verification: s.verification,
      });
    }
    return `[${actU} Section ${sec.toUpperCase()}]`;
  });

  const cleaned = finalText.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleaned, citations, dropped, kept: citations.length };
}

module.exports = { resolveCitations, CITE_RE };
