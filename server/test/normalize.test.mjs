import { test } from 'node:test';
import assert from 'node:assert';
import {
  htmlToText,
  normalizeStatuteText,
  normalizeForComparison,
  chunkText,
  isValidProvisionNumber,
  isRepealNote,
  similarity,
  overlapCoefficient,
} from '../src/ingest/normalize.js';

test('htmlToText strips India Code note markup but keeps clause structure', () => {
  const html = '<span style="margin-left: 15px;"></span>(1) Whoever commits murder shall be punished with death.<br/><hr/><span></span>(2) A group commits murder.';
  const t = htmlToText(html);
  assert.match(t, /\(1\) Whoever commits murder/);
  assert.match(t, /\n\(2\) A group commits murder/);
  assert.ok(!/<|>/.test(t));
});

test('normalizeStatuteText canonicalizes whitespace without touching wording', () => {
  const t = normalizeStatuteText('Whoever  commits\tmurder\n\n\nshall  be punished.');
  assert.strictEqual(t, 'Whoever commits murder\n\nshall be punished.');
});

test('normalizeForComparison is punctuation- and case-insensitive', () => {
  assert.strictEqual(
    normalizeForComparison('Whoever, commits “murder”—shall!'),
    normalizeForComparison('whoever commits murder shall')
  );
});

test('chunkText keeps short provisions whole and splits long ones on clause boundaries', () => {
  const short = 'A short provision.';
  assert.deepStrictEqual(chunkText(short), [short]);
  const clauses = Array.from({ length: 40 }, (_, i) => `(${i + 1}) Clause number ${i + 1} with some statutory language that adds length. `).join('\n');
  const chunks = chunkText(clauses, { maxChars: 600 });
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 700, `chunk too long: ${c.length}`);
  const joined = chunks.join('\n').replace(/\s+/g, ' ');
  assert.ok(joined.includes('(1)'));
  assert.ok(joined.includes('(40)'));
});

test('isValidProvisionNumber accepts statute numbering, rejects junk', () => {
  assert.ok(isValidProvisionNumber('302'));
  assert.ok(isValidProvisionNumber('498A'));
  assert.ok(isValidProvisionNumber('376AB'));
  assert.ok(!isValidProvisionNumber(''));
  assert.ok(!isValidProvisionNumber('30-2'));
  assert.ok(!isValidProvisionNumber('section'));
  assert.ok(!isValidProvisionNumber('302BXY'));
});

test('isRepealNote flags repeal/omission footnotes only', () => {
  assert.ok(isRepealNote('Repealed by the Prevention of Corruption Act, 1988'));
  assert.ok(isRepealNote('Omitted by Act 25 of 2005.'));
  assert.ok(!isRepealNote('Whoever commits murder shall be punished with death.'));
});

test('similarity is order-insensitive and symmetric; overlapCoefficient rewards containment', () => {
  const a = 'Whoever commits murder shall be punished with death or imprisonment for life';
  const b = 'shall be punished with death or imprisonment for life whoever commits murder';
  assert.ok(similarity(a, b) > 0.9);
  // subset: official text contains everything the excerpt has, plus more
  const official = 'Whoever commits murder shall be punished with death or imprisonment for life and shall also be liable to fine and further consequences';
  const excerpt = 'Whoever commits murder shall be punished with death';
  assert.ok(overlapCoefficient(official, excerpt) > 0.9);
  assert.ok(overlapCoefficient(official, excerpt) > similarity(official, excerpt));
  assert.strictEqual(overlapCoefficient('', 'x'), 0);
});
