/**
 * Tests for {@link findStructuralViolations} — the §A4 balance validator
 * underpinning the survey-builder group-authoring slice (see
 * docs/plans/survey-groups-and-scaffold.md).
 *
 * Five contract corners pinned here:
 *   1. Balanced surveys produce zero violations.
 *   2. Unmatched `begin` (no `end`) is caught and reported on the `begin`.
 *   3. Unmatched `end` (no preceding `begin`) is caught at the `end` row.
 *   4. Mismatched `begin group` ↔ `end repeat` (and vice versa) is caught.
 *   5. Crossed nesting (group inside repeat closed in the wrong order)
 *      surfaces as a mismatched-end at the offending closer.
 *
 * Bonus: arbitrary-depth nesting is allowed (groups in groups in repeats).
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  findStructuralViolations,
  isStructurallyBalanced,
  structuralMarker,
} from './structuralBalance.js';
import { type SurveyRow } from './types.js';

function row(partial: Partial<SurveyRow> & { type: string }): SurveyRow {
  return {
    rowId: partial.rowId ?? `${partial.type}-${partial.name ?? ''}`,
    name: partial.name ?? '',
    labels: {},
    extras: {},
    ...partial,
  };
}

/* ============================ marker classifier =========================== */

test('structuralMarker classifies the four structural types and rejects others', () => {
  assert.equal(structuralMarker(row({ type: 'begin group', name: 'inputs' })), 'begin-group');
  assert.equal(structuralMarker(row({ type: 'end group' })), 'end-group');
  assert.equal(structuralMarker(row({ type: 'begin repeat', name: 'rep' })), 'begin-repeat');
  assert.equal(structuralMarker(row({ type: 'end repeat' })), 'end-repeat');
  // case-insensitive
  assert.equal(structuralMarker(row({ type: 'Begin Group', name: 'g' })), 'begin-group');
  // non-structural — `select_one X` has a list-name suffix and must NOT match.
  assert.equal(structuralMarker(row({ type: 'select_one sex' })), null);
  assert.equal(structuralMarker(row({ type: 'text' })), null);
  assert.equal(structuralMarker(row({ type: '' })), null);
});

/* ============================== balanced =============================== */

test('balanced: empty survey is balanced', () => {
  assert.deepEqual(findStructuralViolations([]), []);
  assert.equal(isStructurallyBalanced([]), true);
});

test('balanced: flat survey with no structural rows is balanced', () => {
  const survey: SurveyRow[] = [
    row({ type: 'text', name: 'a' }),
    row({ type: 'integer', name: 'b' }),
  ];
  assert.deepEqual(findStructuralViolations(survey), []);
});

test('balanced: matched begin/end group is balanced', () => {
  const survey: SurveyRow[] = [
    row({ type: 'begin group', name: 'inputs' }),
    row({ type: 'text', name: 'x' }),
    row({ type: 'end group', name: 'inputs' }),
  ];
  assert.deepEqual(findStructuralViolations(survey), []);
});

test('balanced: matched begin/end repeat is balanced', () => {
  const survey: SurveyRow[] = [
    row({ type: 'begin repeat', name: 'children' }),
    row({ type: 'text', name: 'name' }),
    row({ type: 'end repeat', name: 'children' }),
  ];
  assert.deepEqual(findStructuralViolations(survey), []);
});

test('balanced: arbitrary nesting (groups in groups in repeats)', () => {
  const survey: SurveyRow[] = [
    row({ type: 'begin group', name: 'inputs', rowId: 'g1' }),
    row({ type: 'begin group', name: 'contact', rowId: 'g2' }),
    row({ type: 'text', name: 'a' }),
    row({ type: 'end group', name: 'contact', rowId: 'g2e' }),
    row({ type: 'begin repeat', name: 'children', rowId: 'r1' }),
    row({ type: 'begin group', name: 'child_meta', rowId: 'g3' }),
    row({ type: 'text', name: 'b' }),
    row({ type: 'end group', name: 'child_meta', rowId: 'g3e' }),
    row({ type: 'end repeat', name: 'children', rowId: 'r1e' }),
    row({ type: 'end group', name: 'inputs', rowId: 'g1e' }),
  ];
  assert.deepEqual(findStructuralViolations(survey), []);
});

/* =========================== unmatched-begin ============================ */

test('unmatched-begin: a `begin group` with no `end` is flagged on the begin row', () => {
  const survey: SurveyRow[] = [
    row({ type: 'begin group', name: 'orphan', rowId: 'g1' }),
    row({ type: 'text', name: 'x' }),
  ];
  const vs = findStructuralViolations(survey);
  assert.equal(vs.length, 1);
  assert.equal(vs[0]!.kind, 'unmatched-begin');
  assert.equal(vs[0]!.rowId, 'g1');
  assert.equal(vs[0]!.marker, 'begin-group');
  assert.match(vs[0]!.message, /no matching end/i);
});

test('unmatched-begin: a `begin repeat` with no `end` is flagged', () => {
  const survey: SurveyRow[] = [row({ type: 'begin repeat', name: 'r', rowId: 'r1' })];
  const vs = findStructuralViolations(survey);
  assert.equal(vs.length, 1);
  assert.equal(vs[0]!.kind, 'unmatched-begin');
  assert.equal(vs[0]!.marker, 'begin-repeat');
});

/* ============================ unmatched-end ============================= */

test('unmatched-end: a stray `end group` with no preceding `begin` is flagged on the end row', () => {
  const survey: SurveyRow[] = [
    row({ type: 'text', name: 'x' }),
    row({ type: 'end group', rowId: 'eg' }),
  ];
  const vs = findStructuralViolations(survey);
  assert.equal(vs.length, 1);
  assert.equal(vs[0]!.kind, 'unmatched-end');
  assert.equal(vs[0]!.rowId, 'eg');
  assert.equal(vs[0]!.index, 1);
});

test('unmatched-end: stray `end repeat` is flagged', () => {
  const survey: SurveyRow[] = [row({ type: 'end repeat', rowId: 'er' })];
  const vs = findStructuralViolations(survey);
  assert.equal(vs.length, 1);
  assert.equal(vs[0]!.kind, 'unmatched-end');
});

/* =========================== mismatched-end ============================= */

test('mismatched-end: `begin group` closed by `end repeat` is flagged on the end row', () => {
  const survey: SurveyRow[] = [
    row({ type: 'begin group', name: 'g', rowId: 'g1' }),
    row({ type: 'end repeat', rowId: 'er' }),
  ];
  const vs = findStructuralViolations(survey);
  assert.equal(vs.length, 1);
  assert.equal(vs[0]!.kind, 'mismatched-end');
  assert.equal(vs[0]!.rowId, 'er');
  assert.match(vs[0]!.message, /closes a begin group/i);
});

test('mismatched-end: `begin repeat` closed by `end group` is flagged', () => {
  const survey: SurveyRow[] = [
    row({ type: 'begin repeat', name: 'r', rowId: 'r1' }),
    row({ type: 'end group', rowId: 'eg' }),
  ];
  const vs = findStructuralViolations(survey);
  assert.equal(vs.length, 1);
  assert.equal(vs[0]!.kind, 'mismatched-end');
  assert.match(vs[0]!.message, /closes a begin repeat/i);
});

/* ============================ crossed nesting =========================== */

test('crossed nesting: group opened inside repeat but closed in the wrong order is caught', () => {
  // begin repeat
  //   begin group
  // end repeat          ← this closes the most-recent begin (the group), kind-mismatched
  //   end group         ← now closes the begin repeat — also kind-mismatched
  const survey: SurveyRow[] = [
    row({ type: 'begin repeat', name: 'r', rowId: 'r1' }),
    row({ type: 'begin group', name: 'g', rowId: 'g1' }),
    row({ type: 'end repeat', rowId: 'er' }),
    row({ type: 'end group', rowId: 'eg' }),
  ];
  const vs = findStructuralViolations(survey);
  // Two distinct mismatched-end violations — each `end` closes a `begin`
  // of the wrong kind. Surfacing both makes the failure mode legible.
  assert.equal(vs.length, 2);
  assert.equal(vs[0]!.kind, 'mismatched-end');
  assert.equal(vs[0]!.rowId, 'er');
  assert.equal(vs[1]!.kind, 'mismatched-end');
  assert.equal(vs[1]!.rowId, 'eg');
});

/* ============================ multiple violations ======================= */

test('multiple violations are surfaced in survey order', () => {
  const survey: SurveyRow[] = [
    row({ type: 'end group', rowId: 'eg-first' }),       // unmatched-end at idx 0
    row({ type: 'begin group', name: 'g', rowId: 'g1' }), // unmatched-begin at idx 1
  ];
  const vs = findStructuralViolations(survey);
  assert.equal(vs.length, 2);
  // unmatched-end is found first (at index 0); the lingering unmatched-begin
  // is reported after the survey walk completes.
  assert.equal(vs[0]!.kind, 'unmatched-end');
  assert.equal(vs[1]!.kind, 'unmatched-begin');
});
