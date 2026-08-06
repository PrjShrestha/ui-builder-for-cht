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
  computeAuthoringHiddenRowIds,
  isInputsPlumbingCalculate,
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

/* ===== docs/NEXT.md item 1 — the AUTHORING hide set (Calculate tile) ===== */

test('isInputsPlumbingCalculate: the four Default-scaffold linking calculates are plumbing', () => {
  // buildAppFormScaffold seeds these at depth 0, OUTSIDE inputs/.
  for (const calc of [
    '../inputs/contact/_id',
    '../inputs/contact/patient_id',
    '../inputs/user/name',
    '../inputs/user/contact_id',
  ]) {
    assert.equal(
      isInputsPlumbingCalculate(row({ type: 'calculate', name: 'c', extras: { calculation: calc } })),
      true,
      `${calc} should classify as plumbing`,
    );
  }
});

test('isInputsPlumbingCalculate: author-written calculations are NOT plumbing', () => {
  const notPlumbing = [
    '', // brand-new row the author just added
    "instance('contact-summary')/context/bmi", // the cross-form pull
    '${weight} div (${height} * ${height})',
    '../inputs/contact/_id + 1', // an expression, not a bare re-export
    'concat(../inputs/user/name, "x")',
  ];
  for (const calc of notPlumbing) {
    assert.equal(
      isInputsPlumbingCalculate(row({ type: 'calculate', name: 'c', extras: { calculation: calc } })),
      false,
      `${JSON.stringify(calc)} should NOT classify as plumbing`,
    );
  }
});

test('isInputsPlumbingCalculate only ever applies to `calculate` rows', () => {
  assert.equal(
    isInputsPlumbingCalculate(
      row({ type: 'hidden', name: 'h', extras: { calculation: '../inputs/user/name' } }),
    ),
    false,
  );
});

test('authoring hide set KEEPS an author-added calculate visible (the Calculate-tile trap)', () => {
  // Unhiding the tile without this makes the row vanish the instant it is
  // created — the author sees only the "N plumbing rows hidden" counter.
  const survey: SurveyRow[] = [
    row({ type: 'integer', name: 'age', rowId: 'q1' }),
    row({ type: 'calculate', name: 'bmi', rowId: 'c_new', extras: { calculation: '' } }),
    row({
      type: 'calculate',
      name: 'bmi_pull',
      rowId: 'c_pull',
      extras: { calculation: "instance('contact-summary')/context/bmi" },
    }),
  ];
  const hidden = computeAuthoringHiddenRowIds(survey);
  assert.equal(hidden.has('c_new'), false, 'a freshly added calculate must stay visible');
  assert.equal(hidden.has('c_pull'), false, 'a cross-form pull calculate must stay visible');
  // The strict oracle still hides both — that difference is the point.
  const strict = computeSimpleHiddenRowIds(survey);
  assert.equal(strict.has('c_new'), true);
  assert.equal(strict.has('c_pull'), true);
});

test('authoring hide set still hides scaffold plumbing — fresh Default form opens EMPTY (§B1)', () => {
  // Mirrors buildAppFormScaffold exactly: inputs/ block + 4 linking
  // calculates at depth 0. Simple mode must show ZERO rows.
  const survey: SurveyRow[] = [
    row({ type: 'begin group', name: 'inputs', rowId: 'g_inputs' }),
    row({ type: 'hidden', name: 'source', rowId: 'r_source' }),
    row({ type: 'begin group', name: 'user', rowId: 'g_user' }),
    row({ type: 'hidden', name: 'contact_id', rowId: 'r_cid' }),
    row({ type: 'end group', name: 'user', rowId: 'g_user_end' }),
    row({ type: 'begin group', name: 'contact', rowId: 'g_contact' }),
    row({ type: 'string', name: '_id', rowId: 'r_id' }),
    row({ type: 'end group', name: 'contact', rowId: 'g_contact_end' }),
    row({ type: 'end group', name: 'inputs', rowId: 'g_inputs_end' }),
    row({ type: 'calculate', name: 'patient_uuid', rowId: 'c1', extras: { calculation: '../inputs/contact/_id' } }),
    row({ type: 'calculate', name: 'patient_id', rowId: 'c2', extras: { calculation: '../inputs/contact/patient_id' } }),
    row({ type: 'calculate', name: 'created_by', rowId: 'c3', extras: { calculation: '../inputs/user/name' } }),
    row({ type: 'calculate', name: 'created_by_person_uuid', rowId: 'c4', extras: { calculation: '../inputs/user/contact_id' } }),
  ];
  const hidden = computeAuthoringHiddenRowIds(survey);
  const visible = survey.filter((r) => !hidden.has(r.rowId)).map((r) => r.rowId);
  assert.deepEqual(visible, [], 'a freshly scaffolded Default form must open with no visible rows');
});

test('authoring hide set hides a calculate INSIDE inputs/ even with an author-ish calculation', () => {
  // Position wins over content: everything inside inputs/ is plumbing.
  const survey: SurveyRow[] = [
    row({ type: 'begin group', name: 'inputs', rowId: 'g' }),
    row({ type: 'calculate', name: 'weird', rowId: 'c', extras: { calculation: '${a} * 2' } }),
    row({ type: 'end group', name: 'inputs', rowId: 'g_end' }),
  ];
  assert.equal(computeAuthoringHiddenRowIds(survey).has('c'), true);
});

test('authoring hide set changes NOTHING for non-calculate rows', () => {
  const survey: SurveyRow[] = [
    row({ type: 'begin group', name: 'sec', rowId: 'g' }),
    row({ type: 'select_one yesno', name: 'q', rowId: 'q1' }),
    row({ type: 'hidden', name: 'flag', rowId: 'h1' }),
    row({ type: 'end group', name: 'sec', rowId: 'g_end' }),
  ];
  const strict = computeSimpleHiddenRowIds(survey);
  const authoring = computeAuthoringHiddenRowIds(survey);
  assert.deepEqual([...authoring].sort(), [...strict].sort());
});
