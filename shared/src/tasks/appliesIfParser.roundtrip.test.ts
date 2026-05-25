/**
 * Round-trip + numeric-operator tests for the appliesIf parser.
 *
 * Run via `node --test --import tsx shared/src/tasks/appliesIfParser.roundtrip.test.ts`
 * (or any test runner that consumes node:test).
 *
 * These exist to defend two invariants that broke real configs in the past:
 *   1. parse → serialize → parse is stable (no diff drift on open+save).
 *   2. Numeric comparisons (`age > 20`) survive a round trip; previously
 *      the parser fell back to `raw` and the structured row vanished.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseAppliesIf, serializeAppliesIf } from './appliesIfParser.js';

function roundTrip(source: string): string {
  return serializeAppliesIf(parseAppliesIf(source));
}

test('numeric `>` survives parse → serialize → parse', () => {
  const src = `function (contact, report) {
  if (contact.contact.age <= 20) { return false; }
  return true;
}`;
  const first = parseAppliesIf(src);
  assert.equal(first.rules.length, 1);
  const rule = first.rules[0];
  assert.equal(rule?.kind, 'contact_field');
  if (rule?.kind === 'contact_field') {
    assert.equal(rule.field, 'age');
    assert.equal(rule.op, '>');
    assert.equal(rule.value, '20');
  }
  const second = parseAppliesIf(roundTrip(src));
  assert.deepEqual(first.rules, second.rules);
});

test('string equality still round-trips', () => {
  const src = `function (contact) {
  if (contact.contact.role !== 'patient') { return false; }
  return true;
}`;
  const first = parseAppliesIf(src);
  assert.equal(first.rules[0]?.kind, 'contact_field');
  if (first.rules[0]?.kind === 'contact_field') {
    assert.equal(first.rules[0].op, '===');
    assert.equal(first.rules[0].value, 'patient');
  }
  const second = parseAppliesIf(roundTrip(src));
  assert.deepEqual(first.rules, second.rules);
});

test('OR-grouped guards do not explode into multiple lines on serialize', () => {
  const src = `function (contact, report) {
  if (!isTaskUser(user) || !isAlive(contact.contact) || isMuted(contact.contact) || hasError(report)) { return false; }
  return true;
}`;
  const serialized = roundTrip(src);
  const ifCount = (serialized.match(/\bif\b/g) ?? []).length;
  assert.equal(ifCount, 1, `expected one combined guard, got: ${serialized}`);
});

test('numeric guard inversion is exact (no off-by-one)', () => {
  // age > 20: guard becomes age <= 20, then back to age > 20.
  const rule = parseAppliesIf(
    `function (contact) { if (contact.contact.age <= 20) { return false; } return true; }`,
  ).rules[0];
  assert.equal(rule?.kind, 'contact_field');
  if (rule?.kind === 'contact_field') assert.equal(rule.op, '>');

  // age >= 20: guard becomes age < 20.
  const rule2 = parseAppliesIf(
    `function (contact) { if (contact.contact.age < 20) { return false; } return true; }`,
  ).rules[0];
  if (rule2?.kind === 'contact_field') assert.equal(rule2.op, '>=');
});

test('decimal values round-trip', () => {
  const src = `function (contact) {
  if (contact.contact.bmi < 18.5) { return false; }
  return true;
}`;
  const first = parseAppliesIf(src);
  if (first.rules[0]?.kind === 'contact_field') {
    assert.equal(first.rules[0].op, '>=');
    assert.equal(first.rules[0].value, '18.5');
  }
  const second = parseAppliesIf(roundTrip(src));
  assert.deepEqual(first.rules, second.rules);
});

test('negative values round-trip', () => {
  const src = `function (contact) {
  if (contact.contact.score <= -1) { return false; }
  return true;
}`;
  const first = parseAppliesIf(src);
  if (first.rules[0]?.kind === 'contact_field') {
    assert.equal(first.rules[0].op, '>');
    assert.equal(first.rules[0].value, '-1');
  }
  const second = parseAppliesIf(roundTrip(src));
  assert.deepEqual(first.rules, second.rules);
});

test('report_field numeric round-trip', () => {
  const src = `function (contact, report) {
  if (getField(report, 'weight') < 50) { return false; }
  return true;
}`;
  const first = parseAppliesIf(src);
  if (first.rules[0]?.kind === 'report_field') {
    assert.equal(first.rules[0].field, 'weight');
    assert.equal(first.rules[0].op, '>=');
    assert.equal(first.rules[0].value, '50');
  }
  assert.deepEqual(first.rules, parseAppliesIf(roundTrip(src)).rules);
});

test('mixed guard + return clauses preserve guard grouping', () => {
  const src = `function (contact, report) {
  if (!isAlive(contact.contact) || isMuted(contact.contact)) { return false; }
  return contact.contact.role === 'patient';
}`;
  const serialized = roundTrip(src);
  assert.match(serialized, /!isAlive\(contact\.contact\) \|\| isMuted\(contact\.contact\)/);
});
