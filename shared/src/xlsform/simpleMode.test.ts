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

test('computeSimpleHiddenRowIds hides EVERY row inside inputs/ regardless of type (§B1 regression)', () => {
  // The Part-B scaffold seeds a `string _id` inside `inputs/contact` for
  // the patient-selector pattern; pre-fix that string row leaked into
  // Simple mode and a fresh Default app form opened as a single cryptic
  // _id row labeled "Patient ID". Hide every inputs descendant.
  const survey: SurveyRow[] = [
    row({ type: 'begin group', name: 'inputs', rowId: 'g_inputs' }),
    row({ type: 'begin group', name: 'contact', rowId: 'g_contact' }),
    row({ type: 'string', name: '_id', rowId: 's_id' }), // would-be visible by type
    row({ type: 'hidden', name: 'patient_id', rowId: 'h_pid' }),
    row({ type: 'end group', rowId: 'g_contact_end' }),
    row({ type: 'end group', rowId: 'g_inputs_end' }),
    row({ type: 'integer', name: 'gravidity', rowId: 'q_grav' }),
  ];
  const hidden = computeSimpleHiddenRowIds(survey);
  assert.equal(hidden.has('s_id'), true, 'string _id inside inputs/ MUST be hidden in Simple mode');
  assert.equal(hidden.has('h_pid'), true, 'hidden patient_id inside inputs/ stays hidden');
  assert.equal(hidden.has('g_contact'), true, 'nested begin group inside inputs/ stays hidden');
  assert.equal(hidden.has('q_grav'), false, 'real question OUTSIDE inputs/ stays visible');
});
