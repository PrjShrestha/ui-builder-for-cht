/**
 * Codec tests for the sidecar key encoder/decoder.
 *
 * These freeze the on-disk key format. `choiceMappings` is reserved `{}` in
 * MVP but V1 inherits this codec unmigrated, so the choice-key cases here
 * are part of the format contract, not exploratory.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  decodeChoiceKey,
  decodeQuestionKey,
  encodeChoiceKey,
  encodeQuestionKey,
} from './key.js';

/* ------------------------------ question keys ----------------------------- */

test('question key — plain inputs round-trip', () => {
  const key = encodeQuestionKey('app:pregnancy', 'lmp_date');
  assert.equal(key, 'app:pregnancy/lmp_date');
  assert.deepEqual(decodeQuestionKey(key), { formId: 'app:pregnancy', name: 'lmp_date' });
});

test('question key — basename containing `:` is NOT escaped', () => {
  // formId can legally contain `:` because forms.ts:31 does rest.join(':').
  const key = encodeQuestionKey('app:my:weird:form', 'field');
  assert.equal(key, 'app:my:weird:form/field');
  assert.deepEqual(decodeQuestionKey(key), { formId: 'app:my:weird:form', name: 'field' });
});

test('question key — `/` in name round-trips', () => {
  const key = encodeQuestionKey('app:pregnancy', 'has/slash');
  assert.equal(key, 'app:pregnancy/has%2Fslash');
  assert.deepEqual(decodeQuestionKey(key), { formId: 'app:pregnancy', name: 'has/slash' });
});

test('question key — `%` in name round-trips', () => {
  const key = encodeQuestionKey('app:pregnancy', 'has%percent');
  assert.equal(key, 'app:pregnancy/has%25percent');
  assert.deepEqual(decodeQuestionKey(key), { formId: 'app:pregnancy', name: 'has%percent' });
});

test('question key — adversarial input "%2F" in name decodes correctly', () => {
  // Literal "%2F" text in name — encoder escapes the `%` first, then no `/`
  // remains in the segment. Decoder must NOT collapse the encoded `%252F`
  // back into a `/`.
  const key = encodeQuestionKey('app:pregnancy', '%2Fliteral');
  assert.equal(key, 'app:pregnancy/%252Fliteral');
  assert.deepEqual(decodeQuestionKey(key), { formId: 'app:pregnancy', name: '%2Fliteral' });
});

test('question key — `/` in formId round-trips', () => {
  const key = encodeQuestionKey('app:my/weird/basename', 'field');
  assert.equal(key, 'app:my%2Fweird%2Fbasename/field');
  assert.deepEqual(decodeQuestionKey(key), {
    formId: 'app:my/weird/basename',
    name: 'field',
  });
});

test('question key — empty-string segment round-trips', () => {
  const a = encodeQuestionKey('', 'field');
  assert.equal(a, '/field');
  assert.deepEqual(decodeQuestionKey(a), { formId: '', name: 'field' });
  const b = encodeQuestionKey('app:pregnancy', '');
  assert.equal(b, 'app:pregnancy/');
  assert.deepEqual(decodeQuestionKey(b), { formId: 'app:pregnancy', name: '' });
});

test('question key — injectivity: shifting a `/` across the boundary yields distinct keys', () => {
  // The property orphan matching actually depends on. A bare round-trip test
  // does NOT prove this on its own.
  const a = encodeQuestionKey('app:preg', 'a/b');
  const b = encodeQuestionKey('app:preg/a', 'b');
  assert.notEqual(a, b, 'distinct tuples must produce distinct keys');
  assert.deepEqual(decodeQuestionKey(a), { formId: 'app:preg', name: 'a/b' });
  assert.deepEqual(decodeQuestionKey(b), { formId: 'app:preg/a', name: 'b' });
});

test('question key — missing separator throws', () => {
  assert.throws(() => decodeQuestionKey('no-slash-here'), /missing separator/);
});

/* ------------------------------- choice keys ------------------------------ */

test('choice key — plain inputs round-trip', () => {
  const key = encodeChoiceKey('app:pregnancy', 'yes_no', 'yes');
  assert.equal(key, 'app:pregnancy/yes_no/yes');
  assert.deepEqual(decodeChoiceKey(key), {
    formId: 'app:pregnancy',
    list_name: 'yes_no',
    name: 'yes',
  });
});

test('choice key — `/` in list_name round-trips', () => {
  const key = encodeChoiceKey('app:pregnancy', 'with/slash', 'option');
  assert.equal(key, 'app:pregnancy/with%2Fslash/option');
  assert.deepEqual(decodeChoiceKey(key), {
    formId: 'app:pregnancy',
    list_name: 'with/slash',
    name: 'option',
  });
});

test('choice key — `/` in name round-trips', () => {
  const key = encodeChoiceKey('app:pregnancy', 'symptoms', 'severe/bleeding');
  assert.equal(key, 'app:pregnancy/symptoms/severe%2Fbleeding');
  assert.deepEqual(decodeChoiceKey(key), {
    formId: 'app:pregnancy',
    list_name: 'symptoms',
    name: 'severe/bleeding',
  });
});

test('choice key — `%` in list_name round-trips', () => {
  const key = encodeChoiceKey('app:pregnancy', 'percent%name', 'option');
  assert.equal(key, 'app:pregnancy/percent%25name/option');
  assert.deepEqual(decodeChoiceKey(key), {
    formId: 'app:pregnancy',
    list_name: 'percent%name',
    name: 'option',
  });
});

test('choice key — `:` in formId combined with `/` in name decodes to the original triple', () => {
  // The multi-segment ambiguity case the proposal never tested.
  const key = encodeChoiceKey('app:foo:bar', 'opts', 'a/b');
  assert.equal(key, 'app:foo:bar/opts/a%2Fb');
  assert.deepEqual(decodeChoiceKey(key), {
    formId: 'app:foo:bar',
    list_name: 'opts',
    name: 'a/b',
  });
});

test('choice key — empty-string segment round-trips', () => {
  const key = encodeChoiceKey('app:pregnancy', '', 'option');
  assert.equal(key, 'app:pregnancy//option');
  assert.deepEqual(decodeChoiceKey(key), {
    formId: 'app:pregnancy',
    list_name: '',
    name: 'option',
  });
});

test('choice key — missing second separator throws', () => {
  assert.throws(() => decodeChoiceKey('app:pregnancy/no-second-slash'), /missing second separator/);
});

test('choice key — injectivity: shifting a `/` across boundaries yields distinct keys', () => {
  // (formId='a:b', list='x/y', name='z') vs (formId='a:b', list='x', name='y/z')
  const a = encodeChoiceKey('a:b', 'x/y', 'z');
  const b = encodeChoiceKey('a:b', 'x', 'y/z');
  assert.notEqual(a, b);
  assert.deepEqual(decodeChoiceKey(a), { formId: 'a:b', list_name: 'x/y', name: 'z' });
  assert.deepEqual(decodeChoiceKey(b), { formId: 'a:b', list_name: 'x', name: 'y/z' });
});
