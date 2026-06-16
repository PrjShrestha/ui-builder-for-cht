/**
 * Tests for the FHIR V1 "mappable question" oracle
 * (docs/plans/fhir-v1-workbench.md §C2). Pins the canonical definition
 * so the workbench's denominator never drifts: it matches the form
 * editor's Simple-mode visible subset (structural / inputs/* / hidden
 * / start-end-today plumbing all excluded).
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mappableQuestions, formCoverage } from './coverage.js';
import { type SurveyRow } from '../xlsform/types.js';

function row(partial: Partial<SurveyRow> & { type: string; rowId: string }): SurveyRow {
  return {
    name: partial.name ?? '',
    labels: {},
    extras: {},
    ...partial,
  };
}

test('mappableQuestions excludes structural rows', () => {
  const survey: SurveyRow[] = [
    row({ type: 'begin group', name: 'g', rowId: 'g_begin' }),
    row({ type: 'text', name: 'patient_name', rowId: 'name' }),
    row({ type: 'end group', name: 'g', rowId: 'g_end' }),
  ];
  const ids = mappableQuestions(survey).map((r) => r.rowId);
  assert.deepEqual(ids, ['name']);
});

test('mappableQuestions excludes EVERY row inside the `inputs/` group (matches §B1)', () => {
  // The Part-B scaffold seeds a `string _id` inside `inputs/contact`.
  // §B1's Simple-mode fix hides every inputs descendant; the workbench
  // must mirror that so the count of "mappable" rows is honest.
  const survey: SurveyRow[] = [
    row({ type: 'begin group', name: 'inputs', rowId: 'g_inputs' }),
    row({ type: 'begin group', name: 'contact', rowId: 'g_contact' }),
    row({ type: 'string', name: '_id', rowId: 's_id' }), // user-typed but plumbing
    row({ type: 'end group', name: 'contact', rowId: 'g_contact_end' }),
    row({ type: 'end group', name: 'inputs', rowId: 'g_inputs_end' }),
    row({ type: 'integer', name: 'gravidity', rowId: 'q_grav' }),
  ];
  const ids = mappableQuestions(survey).map((r) => r.rowId);
  assert.deepEqual(ids, ['q_grav']);
});

test('mappableQuestions excludes hidden / calculate plumbing (Simple-mode parity)', () => {
  // The Simple-mode visible-type set excludes `hidden` AND `calculate`
  // (both are plumbing — derived values, never user input). The
  // workbench follows the same rule so its denominator matches what
  // users see in Simple mode.
  const survey: SurveyRow[] = [
    row({ type: 'hidden', name: 'meta_id', rowId: 'h1' }),
    row({ type: 'calculate', name: 'derived', rowId: 'c1' }),
    row({ type: 'integer', name: 'age', rowId: 'q1' }),
  ];
  const ids = mappableQuestions(survey).map((r) => r.rowId);
  assert.deepEqual(ids, ['q1']);
});

test('mappableQuestions excludes rows with no `name`', () => {
  const survey: SurveyRow[] = [
    row({ type: 'text', name: '', rowId: 'unnamed' }),
    row({ type: 'text', name: 'real', rowId: 'r1' }),
  ];
  const ids = mappableQuestions(survey).map((r) => r.rowId);
  assert.deepEqual(ids, ['r1']);
});

test('formCoverage tallies confirmed / suggested / skipped / unmapped correctly', () => {
  const rows: SurveyRow[] = [
    row({ type: 'text', name: 'a', rowId: 'a' }),
    row({ type: 'text', name: 'b', rowId: 'b' }),
    row({ type: 'text', name: 'c', rowId: 'c' }),
    row({ type: 'text', name: 'd', rowId: 'd' }),
    row({ type: 'text', name: 'e', rowId: 'e' }),
  ];
  const lookup = (name: string): { status: string } | undefined => {
    if (name === 'a') return { status: 'confirmed' };
    if (name === 'b') return { status: 'suggested' };
    if (name === 'c') return { status: 'skipped' };
    if (name === 'd') return { status: 'confirmed' };
    return undefined;
  };
  const cov = formCoverage(rows, lookup);
  assert.equal(cov.total, 5);
  assert.equal(cov.confirmed, 2);
  assert.equal(cov.suggested, 1);
  assert.equal(cov.skipped, 1);
  assert.equal(cov.unmapped, 1);
});

test('formCoverage on an empty survey returns all-zero counts', () => {
  const cov = formCoverage([], () => undefined);
  assert.deepEqual(cov, { total: 0, confirmed: 0, suggested: 0, skipped: 0, unmapped: 0 });
});
