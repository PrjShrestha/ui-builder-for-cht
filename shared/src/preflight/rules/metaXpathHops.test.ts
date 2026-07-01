/**
 * Tests for the meta XPath hops rule.
 *
 * Pins:
 *   - contact forms with two-hop `../../inputs/user/*` are flagged
 *   - three-hop `../../../inputs/user/*` (correct depth) passes
 *   - only contact forms are checked; other forms are skipped
 *   - all six meta fields (created_by* + last_edited_by*) trigger
 *   - non-meta fields with `../../inputs/user/*` are NOT flagged
 *     (the rule is scoped to the known meta field names)
 *   - fix hint proposes regenerating the contact form
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { runMetaXpathHopsRule } from './metaXpathHops.js';
import { mkContext, mkForm, surveyRow } from './testFixtures.js';

test('contact form with correct 3-hop path — no results', () => {
  const form = mkForm([
    surveyRow('calculate', 'created_by', { calculation: '../../../inputs/user/name' }),
    surveyRow('calculate', 'created_by_person_uuid', {
      calculation: '../../../inputs/user/contact_id',
    }),
  ]);
  const ctx = mkContext([{ formId: 'person-create', xlsform: form, isContactForm: true }]);
  assert.deepEqual(runMetaXpathHopsRule(ctx), []);
});

test('contact form with 2-hop path — error result for each field', () => {
  const bad1 = surveyRow('calculate', 'created_by', { calculation: '../../inputs/user/name' });
  const bad2 = surveyRow('calculate', 'created_by_person_uuid', {
    calculation: '../../inputs/user/contact_id',
  });
  const form = mkForm([bad1, bad2]);
  const ctx = mkContext([{ formId: 'person-create', xlsform: form, isContactForm: true }]);
  const results = runMetaXpathHopsRule(ctx);
  assert.equal(results.length, 2);
  assert.equal(results[0]!.severity, 'error');
  assert.equal(results[0]!.affectedItemId, 'person-create');
  assert.equal(results[0]!.column, 'calculation');
  assert.deepEqual(results[0]!.fix, { kind: 'regenerate-contact-form', formId: 'person-create' });
});

test('non-contact form (isContactForm undefined) is skipped', () => {
  const form = mkForm([
    surveyRow('calculate', 'created_by', { calculation: '../../inputs/user/name' }),
  ]);
  const ctx = mkContext([{ formId: 'pregnancy', xlsform: form }]);
  assert.deepEqual(runMetaXpathHopsRule(ctx), []);
});

test('isContactForm: false is skipped', () => {
  const form = mkForm([
    surveyRow('calculate', 'created_by', { calculation: '../../inputs/user/name' }),
  ]);
  const ctx = mkContext([{ formId: 'pregnancy', xlsform: form, isContactForm: false }]);
  assert.deepEqual(runMetaXpathHopsRule(ctx), []);
});

test('all six meta fields are covered', () => {
  const rows = [
    surveyRow('calculate', 'created_by', { calculation: '../../inputs/user/name' }),
    surveyRow('calculate', 'created_by_person_uuid', {
      calculation: '../../inputs/user/contact_id',
    }),
    surveyRow('calculate', 'created_by_place_uuid', {
      calculation: '../../inputs/user/facility_id',
    }),
    surveyRow('calculate', 'last_edited_by', { calculation: '../../inputs/user/name' }),
    surveyRow('calculate', 'last_edited_by_person_uuid', {
      calculation: '../../inputs/user/contact_id',
    }),
    surveyRow('calculate', 'last_edited_by_place_uuid', {
      calculation: '../../inputs/user/facility_id',
    }),
  ];
  const form = mkForm(rows);
  const results = runMetaXpathHopsRule(
    mkContext([{ formId: 'edit', xlsform: form, isContactForm: true }]),
  );
  assert.equal(results.length, 6);
});

test('non-meta field name with 2-hop path — NOT flagged (scoped to meta names)', () => {
  const form = mkForm([
    surveyRow('calculate', 'some_other_calc', { calculation: '../../inputs/user/name' }),
  ]);
  const ctx = mkContext([{ formId: 'person-create', xlsform: form, isContactForm: true }]);
  assert.deepEqual(runMetaXpathHopsRule(ctx), []);
});

test('meta field with unrelated calculation — NOT flagged', () => {
  const form = mkForm([
    surveyRow('calculate', 'created_by', { calculation: 'concat("foo", "bar")' }),
  ]);
  const ctx = mkContext([{ formId: 'person-create', xlsform: form, isContactForm: true }]);
  assert.deepEqual(runMetaXpathHopsRule(ctx), []);
});
