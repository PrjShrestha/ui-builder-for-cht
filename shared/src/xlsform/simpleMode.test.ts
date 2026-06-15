/**
 * Regression tests for Simple-mode visibility classification.
 *
 * The bug this guards: `isHiddenInSimpleMode` compared the FULL type cell
 * (e.g. "select_multiple danger_signs") against a set of bare type tokens
 * ("select_multiple"), so every select_one / select_multiple question was
 * wrongly hidden in Simple mode — which is the editor's DEFAULT view. A real
 * form's danger-signs question would have been invisible until the user
 * happened to switch to Full mode. The fix matches on the base token.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  isHiddenInSimpleMode,
  computeSimpleHiddenRowIds,
  type SurveyRow,
} from './types.js';

function row(partial: Partial<SurveyRow> & { type: string }): SurveyRow {
  return { rowId: partial.name ?? partial.type, name: '', labels: {}, extras: {}, ...partial };
}

test('select_one with a list name is VISIBLE in Simple mode (regression)', () => {
  assert.equal(isHiddenInSimpleMode(row({ type: 'select_one sex_options', name: 'sex' })), false);
});

test('select_multiple with a list name is VISIBLE in Simple mode (regression)', () => {
  assert.equal(
    isHiddenInSimpleMode(row({ type: 'select_multiple danger_signs', name: 'danger_signs' })),
    false,
  );
});

test('select_one with trailing or_other token stays visible', () => {
  assert.equal(isHiddenInSimpleMode(row({ type: 'select_one yn or_other', name: 'q' })), false);
});

test('plain question types remain visible', () => {
  for (const t of ['text', 'integer', 'date', 'note', 'geopoint']) {
    assert.equal(isHiddenInSimpleMode(row({ type: t })), false, `${t} should be visible`);
  }
});

test('plumbing types stay hidden', () => {
  for (const t of ['calculate', 'hidden', 'begin group', 'end group']) {
    assert.equal(isHiddenInSimpleMode(row({ type: t })), true, `${t} should be hidden`);
  }
});

test('computeSimpleHiddenRowIds keeps a select visible, hides inputs/ plumbing', () => {
  const survey: SurveyRow[] = [
    row({ type: 'begin group', name: 'inputs', rowId: 'g1' }),
    row({ type: 'calculate', name: 'sex', rowId: 'c1' }), // inside inputs → hidden
    row({ type: 'end group', rowId: 'g2' }),
    row({ type: 'select_multiple danger_signs', name: 'danger_signs', rowId: 'q1' }),
    row({ type: 'integer', name: 'gravidity', rowId: 'q2' }),
  ];
  const hidden = computeSimpleHiddenRowIds(survey);
  assert.equal(hidden.has('q1'), false, 'select question must be visible');
  assert.equal(hidden.has('q2'), false, 'integer must be visible');
  assert.equal(hidden.has('c1'), true, 'inputs/ calculate must be hidden');
  assert.equal(hidden.has('g1'), true, 'structural begin group must be hidden');
});
