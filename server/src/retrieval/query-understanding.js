/**
 * Legal query understanding: normalization, synonym expansion, citation
 * detection. Hand-tuned for penal-law vocabulary; in production this layer
 * becomes the place for a learned query rewriter — the interface stays the same.
 */
const { STOPWORDS } = require('./query-normalize');

/** Term -> extra retrieval terms. Deliberately statute-flavoured. */
const SYNONYMS = {
  murder: ['culpable homicide', 'punishment for murder', 'death'],
  homicide: ['culpable homicide', 'death'],
  cheating: ['cheat', 'dishonestly', 'fraudulently', 'delivery of property', 'deceive'],
  fraud: ['cheating', 'dishonestly', 'fraudulently', 'deceive'],
  theft: ['theft', 'dishonest', 'movable property', 'steal'],
  steal: ['theft', 'dishonest', 'movable property'],
  rob: ['robbery', 'theft', 'extortion'],
  robbery: ['robbery', 'theft', 'extortion'],
  dacoity: ['dacoit', 'robbery'],
  extortion: ['extortion', 'fear of injury', 'delivery of property'],
  rape: ['rape', 'sexual intercourse', 'consent'],
  assault: ['assault', 'criminal force'],
  hurt: ['hurt', 'grievous hurt', 'bodily pain'],
  dowry: ['dowry', 'cruelty', 'husband', 'marriage'],
  cruelty: ['cruelty', 'husband', 'wife', 'harassment'],
  bribe: ['gratification', 'public servant', 'illegal gratification'],
  bribery: ['gratification', 'public servant', 'illegal gratification'],
  defamation: ['defamation', 'harm to reputation', 'reputation'],
  forgery: ['forgery', 'false document', 'fraudulently'],
  kidnapping: ['kidnapping', 'abduction'],
  kidnap: ['kidnapping', 'abduction'],
  sedition: ['sedition', 'disaffection', 'government established by law'],
  trespass: ['criminal trespass', 'house-trespass', 'entry'],
  riot: ['unlawful assembly', 'riot', 'force'],
  conspiracy: ['criminal conspiracy', 'agree to do'],
  attempt: ['attempt', 'endeavour'],
  abetment: ['abet', 'instigate', 'conspire'],
  intoxication: ['intoxicated', 'drunk', 'consent'],
  insanity: ['unsoundness of mind', 'insane', 'unsound mind'],
  minor: ['child', 'seven years', 'twelve years'],
  punishment: ['punished', 'punishment', 'imprisonment', 'fine'],
  penalty: ['punished', 'punishment', 'imprisonment', 'fine'],
  jail: ['imprisonment', 'punished'],
  prison: ['imprisonment', 'punished'],
  selfdefence: ['private defence', 'right of private defence'],
  'self-defence': ['private defence', 'right of private defence'],
  blasphemy: ['outrage religious feelings', 'religious', 'insult religion'],
  negligence: ['rash', 'negligent act'],
  movable: ['moveable', 'movable property', 'moveable property'],
  moveable: ['movable', 'movable property', 'moveable property'],
  steal: ['theft', 'dishonest', 'movable property', 'moveable property'],
};

/** Expand a user query with controlled legal vocabulary. */
function expandQuery(q) {
  const tokens = q.toLowerCase().match(/[a-z][a-z-]+/g) || [];
  const content = tokens.filter((t) => !STOPWORDS.has(t));
  const extra = new Set();
  for (const t of content) {
    for (const syn of SYNONYMS[t] || []) extra.add(syn.toLowerCase());
  }
  return { tokens: content, extra: [...extra].slice(0, 14) };
}

/**
 * Detect explicit statutory citations with act awareness:
 * "IPC 302" / "section 498A" / "BNS Section 152" / "Bharatiya Nyaya Sanhita 302".
 * Returns [{ act: 'IPC'|'BNS'|null, no: '302' }]; null act = any act.
 */
function detectCitations(q) {
  const out = [];
  const push = (act, no) => {
    const c = { act: act ? act.toUpperCase() : null, no: no.toUpperCase() };
    if (!out.some((x) => x.act === c.act && x.no === c.no)) out.push(c);
  };
  const actFrom = (m) => {
    const a = (m[1] || '').toLowerCase();
    if (!a) return null;
    if (a.startsWith('b') || a.includes('sanhita') || a.includes('bns')) return 'BNS';
    return 'IPC';
  };

  // explicit act mention: "IPC 302", "Bharatiya Nyaya Sanhita section 302"
  const reAct = /\b(ipc|indian\s+penal\s+code|bns|bharatiya\s+nyaya\s+sanhita)\s*[-–]?\s*(?:section|sec\.?|s\.?|Section )?\s*(\d{1,3}[a-z]{0,2})\b/gi;
  let m;
  while ((m = reAct.exec(q))) push(actFrom(m), m[2]);

  // generic "section 302" (no act) — pinned against every act in the corpus
  const reGeneric = /\b(?:section|sec\.?|s\.?|Section )\s*(\d{1,3}[a-z]{0,2})\b/gi;
  while ((m = reGeneric.exec(q))) {
    // only when no act mention immediately precedes (already captured above)
    const before = q.slice(Math.max(0, m.index - 24), m.index);
    if (!/\b(ipc|penal\s+code|bns|sanhita)\s*[-–]?\s*$/i.test(before) && !out.some((x) => x.no === m[1].toUpperCase())) {
      push(null, m[1]);
    }
  }
  return out;
}

/** Build an FTS5 MATCH expression that is safe (no injection via operators). */
function buildMatchExpr(tokens, extra) {
  const safe = (s) => s.replace(/["'^*:()]/g, ' ').trim();
  const phrases = extra.filter((e) => e.includes(' ')).map((e) => `"${safe(e)}"`);
  const words = [...tokens.map(safe), ...extra.filter((e) => !e.includes(' ')).map(safe)]
    .filter(Boolean)
    .map((w) => `"${w}"`);
  return [...new Set([...words, ...phrases])].join(' OR ');
}

module.exports = { expandQuery, detectCitations, buildMatchExpr, STOPWORDS, SYNONYMS };
