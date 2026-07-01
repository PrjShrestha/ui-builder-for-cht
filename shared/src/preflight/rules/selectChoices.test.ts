/**
 * Tests for the select-choices rule.
 *
 * Pins:
 *   - select_one X with non-empty list X passes
 *   - select_multiple X with non-empty list X passes
 *   - select_* with missing / empty list is flagged as error
 *   - fix hint carries the missing list name so the client can stub it
 *   - non-select rows are ignored
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { runSelectChoicesRule } from './selectChoices.js';
import { choiceRow, mkContext, mkForm, surveyRow } from './testFixtures.js';

test('select_one with a populated list passes', () => {
  const form = mkForm(
    [surveyRow('select_one sex', 'sex_of_child')],
    [choiceRow('sex', 'male'), choiceRow('sex', 'female')],
  );
  assert.deepEqual(runSelectChoicesRule(mkContext([{ formId: 'app', xlsform: form }])), []);
});

test('select_multiple with a populated list passes', () => {
  const form = mkForm(
    [surveyRow('select_multiple symptoms', 'observed')],
    [choiceRow('symptoms', 'fever'), choiceRow('symptoms', 'cough')],
  );
  assert.deepEqual(runSelectChoicesRule(mkContext([{ formId: 'app', xlsform: form }])), []);
});

test('select_one with no matching list → error + fix hint', () => {
  const bad = surveyRow('select_one sex', 'sex_of_child');
  const form = mkForm([bad], []);
  const results = runSelectChoicesRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.equal(results.length, 1);
  const r = results[0]!;
  assert.equal(r.ruleId, 'select-choices');
  assert.equal(r.severity, 'error');
  assert.equal(r.affectedItemId, 'app');
  assert.equal(r.rowId, bad.rowId);
  assert.deepEqual(r.fix, { kind: 'add-choice-list', formId: 'app', listName: 'sex' });
});

test('select_multiple with no matching list → error', () => {
  const form = mkForm([surveyRow('select_multiple symptoms', 'observed')], []);
  const results = runSelectChoicesRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.equal(results.length, 1);
  const fix = results[0]!.fix;
  assert.ok(fix && fix.kind === 'add-choice-list');
  if (fix && fix.kind === 'add-choice-list') {
    assert.equal(fix.listName, 'symptoms');
  }
});

test('list exists in choices sheet but for a different form-scope — still passes here', () => {
  // Rule is per-form; the choices sheet lives inside each XLSForm so
  // cross-form scoping is not part of the check.
  const form = mkForm(
    [surveyRow('select_one sex', 'sex_of_child')],
    [choiceRow('sex', 'male')],
  );
  assert.deepEqual(runSelectChoicesRule(mkContext([{ formId: 'app', xlsform: form }])), []);
});

test('non-select rows do not trigger the rule', () => {
  const form = mkForm(
    [surveyRow('text', 'name'), surveyRow('integer', 'age')],
    [],
  );
  assert.deepEqual(runSelectChoicesRule(mkContext([{ formId: 'app', xlsform: form }])), []);
});

test('structural rows (begin group/end group) are skipped', () => {
  const form = mkForm(
    [surveyRow('begin group', 'group1'), surveyRow('end group', '')],
    [],
  );
  assert.deepEqual(runSelectChoicesRule(mkContext([{ formId: 'app', xlsform: form }])), []);
});

test('multiple missing lists across forms — each is scoped', () => {
  const a = mkForm([surveyRow('select_one x', 'q1')], [], 'a');
  const b = mkForm([surveyRow('select_one y', 'q2')], [], 'b');
  const results = runSelectChoicesRule(
    mkContext([
      { formId: 'a', xlsform: a },
      { formId: 'b', xlsform: b },
    ]),
  );
  assert.equal(results.length, 2);
  const forms = results.map((r) => r.affectedItemId).sort();
  assert.deepEqual(forms, ['a', 'b']);
});
