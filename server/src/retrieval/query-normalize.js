/**
 * Query normalization for retrieval.
 * Deterministic, statute-flavoured tokenization shared by every channel.
 */
const STOPWORDS = new Set(
  ('a an the is are was were be been being am of to in for on at by with from as and or nor ' +
    'but if it its this that these those there here i me my we our you your he she his her him ' +
    'they them their what which who whom whose when where why how do does did done doing can ' +
    'could would should shall will may might must not no than then about into under over between ' +
    'against any some without applies applicable offence apply someone somebody person constitutes ' +
    'mean means regarding regard related relate tell please give show still ' +
    // demo-question meta-words: speak about the search, not the law
    'find explain provisions provision relating elements need want know understand ' +
    // corpus-universal terms: present in nearly every provision, non-discriminative
    'india indian law legal code act section sections ipc bns indian law').split(' ')
);

/** Rough Porter-ish suffix stripper (deterministic; FTS5 does its own Porter inside the index). */
function lightStem(t) {
  let s = t;
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('es')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}

function tokenize(q) {
  return (String(q || '').toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) || [])
    .filter((t) => !STOPWORDS.has(t) && !/^\d+$/.test(t) || /^\d{1,3}[a-z]{0,2}$/.test(t))
    .map((t) => (/[a-z]/.test(t) && t.length > 3 ? lightStem(t) : t));
}

/** Raw tokens (pre-stem, stopword-filtered) — used for display and snippets. */
function displayTokens(q) {
  return (String(q || '').toLowerCase().match(/[a-z][a-z-]+/g) || []).filter((t) => !STOPWORDS.has(t));
}

module.exports = { STOPWORDS, lightStem, tokenize, displayTokens };
