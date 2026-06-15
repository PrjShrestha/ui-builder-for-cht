/**
 * Tests for `inferFieldKind` (plan v0.3 §6, types.ts).
 *
 * Two non-negotiable contracts:
 *  - **Exhaustive over `QUESTION_TYPES`**: every bare token in the union
 *    must map to a `FieldKind` that is one of the SIX enum members; an
 *    unmapped token quietly returning `undefined` would silently mis-bucket
 *    real survey rows.
 *  - **Co-domain pin**: the returned value is always one of the six listed
 *    `FieldKind` members. A future 7th `FieldKind` added without updating
 *    the classifier (and `OP_FIELD_KINDS`) must fail this test.
 *
 * The compound-type case (`select_one X`, `select_multiple X`) is the bug
 * that drove the §3.1 Slice 2 self-check and the Simple-mode fix; pinning
 * it here keeps Slice 2 + v0.3 type-aware filtering aligned on the same
 * regex (`SELECT_TYPE_RE`).
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  QUESTION_TYPES,
  STRUCTURAL_TYPES,
  SELECT_TYPE_RE,
  inferFieldKind,
  type FieldKind,
} from './types.js';

const ALL_KINDS = ['text', 'numeric', 'date', 'choice', 'geo', 'unknown'] as const;
const ALL_KIND_SET = new Set<string>(ALL_KINDS);

const EXPECTED: Record<(typeof QUESTION_TYPES)[number], FieldKind> = {
  text: 'text',
  string: 'text',
  barcode: 'text',
  note: 'text',
  hidden: 'text',
  integer: 'numeric',
  decimal: 'numeric',
  date: 'date',
  time: 'date',
  dateTime: 'date',
  select_one: 'choice',
  select_multiple: 'choice',
  calculate: 'unknown',
  image: 'unknown',
  audio: 'unknown',
  video: 'unknown',
  geopoint: 'geo',
};

test('inferFieldKind is EXHAUSTIVE over QUESTION_TYPES and pins co-domain', () => {
  for (const t of QUESTION_TYPES) {
    const got = inferFieldKind(t);
    assert.ok(ALL_KIND_SET.has(got), `${t} returned non-FieldKind value: ${String(got)}`);
    assert.equal(got, EXPECTED[t], `${t} expected ${EXPECTED[t]}, got ${got}`);
  }
});

test('inferFieldKind handles compound select_one / select_multiple suffix forms', () => {
  assert.equal(inferFieldKind('select_one sex'), 'choice');
  assert.equal(inferFieldKind('select_multiple symptoms'), 'choice');
  assert.equal(inferFieldKind('select_one  spaced_list'), 'choice');
  assert.equal(inferFieldKind('SELECT_ONE upper_list'), 'choice');
});

test('inferFieldKind falls through to "unknown" for custom / empty / unrecognized types', () => {
  assert.equal(inferFieldKind('weird_custom_type'), 'unknown');
  assert.equal(inferFieldKind(''), 'unknown');
  assert.equal(inferFieldKind('   '), 'unknown');
  assert.equal(inferFieldKind('calculate'), 'unknown');
});

test('inferFieldKind defensively returns "unknown" for structural rows', () => {
  for (const t of STRUCTURAL_TYPES) {
    assert.equal(inferFieldKind(t), 'unknown', `${t} should be unknown (structural)`);
  }
});

test('SELECT_TYPE_RE is the single source for select-type matching', () => {
  // The regex returned the list-name in group 2 — used by `buildFieldChoices`.
  const m = 'select_one sex'.match(SELECT_TYPE_RE);
  assert.ok(m);
  assert.equal(m![1], 'select_one');
  assert.equal(m![2], 'sex');
  // Bare select_one (no list name) must NOT match — that's the bare-token
  // case the classifier still upgrades to `choice` via its explicit branch.
  assert.equal(SELECT_TYPE_RE.test('select_one'), false);
});
