/**
 * Tests for the XLSForm identifier rule.
 *
 * Pins:
 *   - valid names pass
 *   - names with spaces / punctuation / a leading digit are flagged as errors
 *   - fix hint proposes the slugified name (must match slugifyHierarchyId)
 *   - structural rows (begin/end group) are skipped
 *   - rows with an empty name are skipped (a separate "row must have a name" check owns that)
 *   - a name that slugifies to '' (pure non-ASCII) is flagged but ships no fix
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { runXlsformIdentifiersRule } from './xlsformIdentifiers.js';
import { slugifyHierarchyId } from '../../hierarchy/buildLinearHierarchy.js';
import { mkContext, mkForm, surveyRow } from './testFixtures.js';

test('valid identifiers pass — no results', () => {
  const form = mkForm([
    surveyRow('integer', 'age'),
    surveyRow('text', '_leading_underscore_ok'),
    surveyRow('string', 'has_underscores_123'),
  ]);
  const ctx = mkContext([{ formId: 'app', xlsform: form }]);
  assert.deepEqual(runXlsformIdentifiersRule(ctx), []);
});

test('name with a space is flagged as error', () => {
  const bad = surveyRow('date', 'lmp date');
  const form = mkForm([bad]);
  const ctx = mkContext([{ formId: 'app', xlsform: form }]);
  const results = runXlsformIdentifiersRule(ctx);
  assert.equal(results.length, 1);
  const r = results[0]!;
  assert.equal(r.ruleId, 'xlsform-identifiers');
  assert.equal(r.severity, 'error');
  assert.equal(r.affectedItemId, 'app');
  assert.equal(r.rowId, bad.rowId);
  assert.equal(r.column, 'name');
});

test('fix hint slug equals slugifyHierarchyId(name)', () => {
  const bad = surveyRow('date', '3-lmp date');
  const form = mkForm([bad]);
  const results = runXlsformIdentifiersRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.equal(results.length, 1);
  const fix = results[0]!.fix;
  assert.ok(fix && fix.kind === 'rename-row', 'expected rename-row fix');
  if (fix && fix.kind === 'rename-row') {
    assert.equal(fix.to, slugifyHierarchyId('3-lmp date'));
    assert.equal(fix.from, '3-lmp date');
    assert.equal(fix.formId, 'app');
    assert.equal(fix.rowId, bad.rowId);
  }
});

test('leading digit is flagged', () => {
  const form = mkForm([surveyRow('integer', '2nd_child_age')]);
  const results = runXlsformIdentifiersRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.equal(results.length, 1);
});

test('punctuation is flagged', () => {
  const form = mkForm([surveyRow('text', 'user.name'), surveyRow('text', 'user?')]);
  const results = runXlsformIdentifiersRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.equal(results.length, 2);
});

test('structural begin/end group rows are skipped even with weird names', () => {
  const form = mkForm([
    surveyRow('begin group', 'has spaces'), // structural
    surveyRow('integer', 'age'),
    surveyRow('end group', ''),
  ]);
  const results = runXlsformIdentifiersRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.deepEqual(results, []);
});

test('rows with an empty name are skipped (separate defect class)', () => {
  const form = mkForm([surveyRow('integer', '')]);
  const results = runXlsformIdentifiersRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.deepEqual(results, []);
});

test('name that slugifies to "" is flagged, no fix hint', () => {
  // Pure Devanagari — slugifyHierarchyId returns ''.
  const bad = surveyRow('text', 'नाम');
  const form = mkForm([bad]);
  const results = runXlsformIdentifiersRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.equal(results.length, 1);
  assert.equal(results[0]!.fix, undefined);
});

test('multiple forms — each is scoped by formId', () => {
  const a = mkForm([surveyRow('integer', 'bad name')], [], 'a-form');
  const b = mkForm([surveyRow('integer', 'ok_name')], [], 'b-form');
  const results = runXlsformIdentifiersRule(
    mkContext([
      { formId: 'a', xlsform: a },
      { formId: 'b', xlsform: b },
    ]),
  );
  assert.equal(results.length, 1);
  assert.equal(results[0]!.affectedItemId, 'a');
});
