/**
 * Round-trip tests for the date_offset + age rule kinds.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseRelevant, serializeRelevant } from './relevantParser.js';

function rt(src: string): string {
  return serializeRelevant(parseRelevant(src));
}

test('age: > N years round-trips', () => {
  const src = 'floor((today() - ${dob}) div 365.25) > 20';
  assert.equal(rt(src), src);
  const p = parseRelevant(src);
  assert.equal(p.rules.length, 1);
  assert.equal(p.rules[0]!.kind, 'age');
});

test('date_offset: more than N years ago', () => {
  const src = 'today() - ${dob} > 20*365.25';
  assert.equal(rt(src), src);
  const p = parseRelevant(src);
  assert.equal(p.rules[0]!.kind, 'date_offset');
});

test('date_offset: less than N days ago', () => {
  const src = 'today() - ${visit_date} < 30';
  assert.equal(rt(src), src);
});

test('date_offset: more than N from now', () => {
  const src = '${due_date} - today() > 7';
  assert.equal(rt(src), src);
});

test('age combined with comparison via AND', () => {
  const src = "floor((today() - ${dob}) div 365.25) > 20 and ${sex} = 'female'";
  assert.equal(rt(src), src);
});

test('unknown multiplier falls back to raw', () => {
  // 42 isn't a known unit multiplier, must stay raw rather than misinterpret.
  const src = 'today() - ${field} > 5*42';
  const p = parseRelevant(src);
  assert.equal(p.rules[0]!.kind, 'raw');
});
