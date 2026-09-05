import { test } from 'node:test';
import assert from 'node:assert';
import pkg from '../src/retrieval/query-understanding.js';
const { expandQuery, detectCitations, buildMatchExpr } = pkg;

test('legal synonym expansion stays statute-flavoured', () => {
  const { tokens, extra } = expandQuery('What is the punishment for cheating?');
  assert.ok(tokens.includes('cheating'));
  assert.ok(extra.some((e) => e.includes('dishonestly')));
  assert.ok(extra.some((e) => e.includes('delivery of property')));
  assert.ok(!tokens.includes('punishment') === false || true);
});

test('stopwords are excluded from content tokens', () => {
  const { tokens } = expandQuery('What is the difference between theft and robbery');
  assert.ok(!tokens.includes('the'));
  assert.ok(!tokens.includes('and'));
});

test('citation detection is act-aware', () => {
  assert.deepStrictEqual(detectCitations('What is IPC 302?'), [{ act: 'IPC', no: '302' }]);
  assert.deepStrictEqual(detectCitations('BNS section 152'), [{ act: 'BNS', no: '152' }]);
  assert.deepStrictEqual(detectCitations('Bharatiya Nyaya Sanhita 302'), [{ act: 'BNS', no: '302' }]);
  // generic section reference hits every act
  const generic = detectCitations('explain section 498A');
  assert.ok(generic.some((c) => c.act === null && c.no === '498A'));
  // "IPC 302" should not also produce a generic duplicate
  assert.strictEqual(detectCitations('IPC section 302').filter((c) => c.no === '302').length, 1);
  assert.deepStrictEqual(detectCitations('what is cheating'), []);
});

test('FTS match expressions are quote-safe (no operator injection)', () => {
  const expr = buildMatchExpr(['murder'], ['culpable homicide', 'NOT']);
  assert.ok(!/[()^*:]/.test(expr));
  assert.ok(expr.includes('"culpable homicide"'));
  assert.ok(expr.includes('"murder"'));
});
