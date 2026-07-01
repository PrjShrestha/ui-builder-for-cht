/**
 * Tests for the dangling-refs rule.
 *
 * Pins:
 *   - `${x}` where x is a same-form row name → passes
 *   - `${../inputs/foo}` and `${../inputs/contact/_id}` → passes
 *   - `${nonexistent}` → error result
 *   - empty braces `${}` / `${ }` → error result ("empty reference")
 *   - refs are scanned in relevant / calculation / constraint / etc.
 *   - path-shaped refs like `${/data/group/age}` resolve on last segment
 *   - substring collisions do not accidentally resolve (`${age_years}`
 *     does NOT resolve against a row named `age`)
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { runDanglingRefsRule } from './danglingRefs.js';
import { mkContext, mkForm, surveyRow } from './testFixtures.js';

test('ref to a known same-form name passes', () => {
  const form = mkForm([
    surveyRow('integer', 'age'),
    surveyRow('note', 'msg', { relevant: '${age} > 18' }),
  ]);
  assert.deepEqual(runDanglingRefsRule(mkContext([{ formId: 'app', xlsform: form }])), []);
});

test('ref into ../inputs/* passes (runtime-injected)', () => {
  const form = mkForm([
    surveyRow('note', 'msg', { calculation: '${../inputs/patient_name}' }),
  ]);
  assert.deepEqual(runDanglingRefsRule(mkContext([{ formId: 'app', xlsform: form }])), []);
});

test('ref into ../inputs/contact/* passes', () => {
  const form = mkForm([
    surveyRow('calculate', 'patient_id', { calculation: '${../inputs/contact/_id}' }),
  ]);
  assert.deepEqual(runDanglingRefsRule(mkContext([{ formId: 'app', xlsform: form }])), []);
});

test('deeper ../../inputs/* prefix is also accepted', () => {
  const form = mkForm([
    surveyRow('calculate', 'name', { calculation: '${../../inputs/user/name}' }),
  ]);
  assert.deepEqual(runDanglingRefsRule(mkContext([{ formId: 'app', xlsform: form }])), []);
});

test('unknown ref → error with column populated', () => {
  const bad = surveyRow('note', 'msg', { relevant: '${nonexistent} = 1' });
  const form = mkForm([bad]);
  const results = runDanglingRefsRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.equal(results.length, 1);
  const r = results[0]!;
  assert.equal(r.ruleId, 'dangling-refs');
  assert.equal(r.severity, 'error');
  assert.equal(r.affectedItemId, 'app');
  assert.equal(r.rowId, bad.rowId);
  assert.equal(r.column, 'relevant');
});

test('empty braces ${} → error labelled "Empty"', () => {
  const bad = surveyRow('calculate', 'x', { calculation: '${} + 1' });
  const form = mkForm([bad]);
  const results = runDanglingRefsRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.equal(results.length, 1);
  assert.equal(results[0]!.column, 'calculation');
  assert.match(results[0]!.message, /Empty/);
});

test('whitespace-only ${ } → error', () => {
  const bad = surveyRow('calculate', 'x', { calculation: '${   } + 1' });
  const form = mkForm([bad]);
  const results = runDanglingRefsRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.equal(results.length, 1);
  assert.match(results[0]!.message, /Empty/);
});

test('path-shaped ref resolves on last segment', () => {
  const form = mkForm([
    surveyRow('integer', 'age'),
    surveyRow('note', 'msg', { relevant: '${/data/group/age} > 18' }),
  ]);
  assert.deepEqual(runDanglingRefsRule(mkContext([{ formId: 'app', xlsform: form }])), []);
});

test('substring collision: ${age_years} does NOT resolve to `age`', () => {
  const form = mkForm([
    surveyRow('integer', 'age'),
    surveyRow('note', 'msg', { relevant: '${age_years} > 18' }),
  ]);
  const results = runDanglingRefsRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.equal(results.length, 1);
});

test('scans multiple ref columns — one bad ref per column', () => {
  const bad = surveyRow('integer', 'age', {
    relevant: '${nope}',
    calculation: '${also_nope}',
    constraint: '${ok}',
  });
  const ok = surveyRow('integer', 'ok');
  const form = mkForm([ok, bad]);
  const results = runDanglingRefsRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.equal(results.length, 2);
  const cols = results.map((r) => r.column).sort();
  assert.deepEqual(cols, ['calculation', 'relevant']);
});

test('scans label::en for ${output} refs', () => {
  const form = mkForm([
    surveyRow('note', 'greeting', {}, { en: 'Hello ${nope}' }),
  ]);
  const results = runDanglingRefsRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.equal(results.length, 1);
  assert.equal(results[0]!.column, 'label::en');
});

test('scans hint::en columns via extras', () => {
  const form = mkForm([
    surveyRow('note', 'q', { 'hint::en': 'See ${missing}' }),
  ]);
  const results = runDanglingRefsRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.equal(results.length, 1);
  assert.equal(results[0]!.column, 'hint::en');
});

test('multiple ${} tokens in one cell → one result per token', () => {
  const bad = surveyRow('note', 'msg', { relevant: '${nope1} > 0 and ${nope2} > 0' });
  const form = mkForm([bad]);
  const results = runDanglingRefsRule(mkContext([{ formId: 'app', xlsform: form }]));
  assert.equal(results.length, 2);
});
