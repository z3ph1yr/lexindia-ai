/**
 * Stage 5b: EXTRACTIVE GENERATION (deterministic).
 * Composes the structured answer purely from the evidence pack. There is no
 * generative step: every sentence is either a mechanical composition over
 * provision metadata or a verbatim quote from retrieved statutory text.
 * Fabrication is structurally impossible in this mode.
 */
const { splitSentences, extractPenalty } = require('./text-utils');
const { toMarkdown } = require('./render');

const PENALTY_WORDS = ['punishment', 'penalty', 'punished', 'sentenc', 'jail', 'imprisonment', 'fine'];
const COMPARE_WORDS = ['difference', 'compare', 'versus', ' vs ', 'distinguish'];
const ACT_NAMES = { IPC: 'Indian Penal Code, 1860', BNS: 'Bharatiya Nyaya Sanhita, 2023' };

function composeExtractive(analysis, evidencePack) {
  const { evidence, sufficient, confidence } = evidencePack;

  if (!sufficient) return refusalAnswer(analysis, evidencePack);

  const q = analysis.question.toLowerCase();
  const wantsPenalty = analysis.intents.includes('penalty') || PENALTY_WORDS.some((w) => q.includes(w));
  const isCompare = analysis.intents.includes('compare') || COMPARE_WORDS.some((w) => q.includes(w.trim()));
  const isDefinition = analysis.intents.includes('definition');

  const cite = (e) => `[${e.act} Section ${e.section}]`;
  const lead = evidence.slice(0, 3).map(cite).join(', ');
  const acts = [...new Set(evidence.map((e) => e.act))].map((a) => ACT_NAMES[a] || a).join('; ');

  // 1. Direct answer — one or two sentences naming the governing provisions.
  // For penalty questions, prefer a provision that matched on CONTENT channels
  // (its text actually discusses the queried concept) over a provision that
  // is present only because the user cited its number — a wrong premise
  // ("punishment for theft under Section 302") must not be echoed.
  const contentMatched = wantsPenalty
    ? evidence.filter((e) => e.penalty && e.channels.some((c) => c !== 'citation'))
    : [];
  const penaltyHolder = wantsPenalty ? contentMatched[0] || evidence.find((e) => e.penalty) : null;
  let directAnswer;
  if (penaltyHolder) {
    directAnswer = `Under ${cite(penaltyHolder)}, the prescribed consequence is: ${penaltyHolder.penalty.replace(/\.$/, '')}.`;
  } else if (isDefinition && evidence[0].quotes.length) {
    directAnswer = `${cite(evidence[0])} governs this: “${trimTo(evidence[0].quotes[0], 260)}”`;
  } else {
    directAnswer = `The most relevant provisions (${acts}) for this query are ${lead}.`;
  }

  // 2. Applicable law — provision cards.
  const applicableLaw = evidence.map((e) => ({
    provision: `${e.act} Section ${e.section}`,
    title: e.title,
    status: e.status === 'repealed' ? 'historical (act replaced 01-07-2024)' : 'in force',
    verification: e.verification,
    quote: e.quotes.length ? e.quotes.map((x) => trimTo(x, 400)) : [],
    penalty: e.penalty,
  }));

  // 3. Explanation — verbatim statutory language, provision by provision.
  const explanationParts = [];
  for (const e of evidence) {
    const lines = [`**${e.act} Section ${e.section} — ${e.title}** ${cite(e)}`];
    for (const quote of e.quotes) lines.push(`> ${quote}`);
    if (wantsPenalty && e.penalty) lines.push(`Penalty: ${e.penalty}`);
    explanationParts.push(lines.join('\n\n'));
  }
  if (isCompare && evidence.length >= 2) {
    explanationParts.push(
      `_The provisions quoted above are the statutory basis for distinguishing the concepts; wording is reproduced verbatim from the corpus._`
    );
  }

  // 4. Caveats — mechanical, never editorial.
  const caveats = [];
  if (confidence === 'medium') {
    caveats.push('Retrieval confidence is moderate: the provisions below are the closest matches in the corpus, but relevance should be verified.');
  }
  const hasUnverified = evidence.some((e) => e.verification === 'unverified');
  if (hasUnverified) {
    caveats.push('One or more provisions come from a snapshot pending verification against the official Gazette.');
  }
  if (evidence.some((e) => e.act === 'IPC') && !evidence.some((e) => e.act === 'BNS')) {
    caveats.push('The IPC was replaced by the Bharatiya Nyaya Sanhita, 2023 with effect from 1 July 2024; check the mapped successor for offences after that date.');
  }
  if (evidence.some((e) => e.isRepealNote)) {
    caveats.push('At least one matched provision is recorded only as a repeal/omission note in the source snapshot.');
  }

  const structured = {
    directAnswer,
    applicableLaw,
    explanation: explanationParts.join('\n\n'),
    caveats,
  };

  return {
    mode: 'extractive',
    structured,
    text: toMarkdown(structured),
    insufficient: false,
  };
}

const REFUSAL_TEXT =
  "I couldn't find sufficient supporting provisions in the current legal knowledge base to answer this reliably.";

function refusalAnswer(analysis, evidencePack) {
  const { confidence } = evidencePack;
  const refineHint =
    'Try naming the offence (e.g. “criminal breach of trust”), quoting a provision number (e.g. “Section 378”), or describing the facts in plain words.';
  return {
    mode: 'extractive',
    structured: {
      directAnswer: REFUSAL_TEXT,
      applicableLaw: [],
      explanation: `${evidenceNote(confidence)} This demo indexes the Indian Penal Code, 1860 and the Bharatiya Nyaya Sanhita, 2023 only — questions of procedure, evidence, or other statutes are out of scope until those acts are ingested (same schema, same pipeline, new data).`,
      caveats: [],
    },
    text: toMarkdown({
      directAnswer: REFUSAL_TEXT,
      applicableLaw: [],
      explanation: `${evidenceNote(confidence)} This demo indexes the Indian Penal Code, 1860 and the Bharatiya Nyaya Sanhita, 2023 only.`,
      caveats: [],
    }),
    insufficient: true,
    refineHint,
  };
}

function evidenceNote(confidence) {
  return confidence === 'none'
    ? 'No provision in the corpus matched this query.'
    : 'The closest matches did not clear the confidence threshold for grounded answering.';
}

function trimTo(s, n) {
  s = String(s || '').trim();
  return s.length <= n ? s : s.slice(0, n - 1).replace(/[,\s]+\S*$/, '') + '…';
}

module.exports = { composeExtractive, REFUSAL_TEXT };
