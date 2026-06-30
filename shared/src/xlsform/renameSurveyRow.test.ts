/**
 * Tests for the atomic survey-row rename macro.
 *
 * Headline rules:
 *   - the renamed row's `name` swaps
 *   - every `${oldName}` reference in OTHER rows is rewritten in lockstep
 *     across relevant / calculation / constraint / choice_filter / default /
 *     repeat_count + labels (XLSForm's `${output}` template)
 *   - substring collisions are NOT rewritten (`${old_extra}` survives
 *     when renaming `old`)
 *   - whitespace inside the braces (`${ old }`) is tolerated
 *   - regex-metacharacters in the source name are handled (an invalid
 *     pre-fix name like `foo?` won't blow up the matcher)
 *   - no-op cases (empty / identical / no matching row) return the same
 *     instance reference so callers can short-circuit
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { renameSurveyRow } from './renameSurveyRow.js';
import type { XLSForm, SurveyRow } from './types.js';

function row(name: string, type: string, extras: Record<string, string> = {}): SurveyRow {
  return {
    rowId: `r_${name}_${Math.floor(Math.random() * 1e9)}`,
    type,
    name,
    labels: {},
    extras,
  };
}

function mkForm(rows: SurveyRow[]): XLSForm {
  return {
    locales: ['en'],
    surveyHeaders: { ordered: ['type', 'name', 'label::en'], labelLocales: ['en'] },
    choicesHeaders: { ordered: ['list_name', 'name', 'label::en'], labelLocales: ['en'] },
    survey: rows,
    choices: [],
    settings: { form_id: 'test', form_title: 'Test', version: '2026-01-01', extras: {} },
    extraSheets: [],
  };
}

/* ============================ §A — basic rename ============================ */

test('§A1 — renames the matching row + leaves other rows alone', () => {
  const f = mkForm([row('foo', 'integer'), row('bar', 'string')]);
  const out = renameSurveyRow(f, 'foo', 'foo_new');
  assert.equal(out.survey[0]!.name, 'foo_new');
  assert.equal(out.survey[1]!.name, 'bar');
});

test('§A2 — rewrites a ${foo} reference in another row.relevant', () => {
  const f = mkForm([
    row('foo', 'integer'),
    row('show_me', 'note', { relevant: '${foo} > 0' }),
  ]);
  const out = renameSurveyRow(f, 'foo', 'foo_new');
  assert.equal(out.survey[1]!.extras['relevant'], '${foo_new} > 0');
});

test('§A3 — rewrites references across every ref-bearing column', () => {
  const f = mkForm([
    row('age', 'integer'),
    row('q', 'note', {
      relevant: '${age} >= 18',
      calculation: 'if(${age} > 65, "senior", "adult")',
      constraint: '. >= ${age}',
      choice_filter: 'category = ${age}',
      default: '${age}',
      repeat_count: '${age}',
    }),
  ]);
  const out = renameSurveyRow(f, 'age', 'age_years');
  const r = out.survey[1]!.extras;
  assert.equal(r['relevant'], '${age_years} >= 18');
  assert.equal(r['calculation'], 'if(${age_years} > 65, "senior", "adult")');
  assert.equal(r['constraint'], '. >= ${age_years}');
  assert.equal(r['choice_filter'], 'category = ${age_years}');
  assert.equal(r['default'], '${age_years}');
  assert.equal(r['repeat_count'], '${age_years}');
});

test('§A4 — rewrites ${...} references inside labels (output template)', () => {
  const f = mkForm([row('age', 'integer')]);
  f.survey.push({
    rowId: 'r_n',
    type: 'note',
    name: 'greeting',
    labels: { en: 'You are ${age} years old.' },
    extras: {},
  });
  const out = renameSurveyRow(f, 'age', 'age_years');
  assert.equal(out.survey[1]!.labels['en'], 'You are ${age_years} years old.');
});

/* ============================ §B — precision ============================ */

test('§B1 — substring collisions are NOT rewritten (${old_extra} survives when renaming `old`)', () => {
  const f = mkForm([
    row('old', 'integer'),
    row('old_extra', 'string'),
    row('q', 'note', { relevant: '${old} > 0 and ${old_extra} = "x"' }),
  ]);
  const out = renameSurveyRow(f, 'old', 'old_new');
  // The ${old} ref → ${old_new}; ${old_extra} untouched.
  assert.equal(out.survey[2]!.extras['relevant'], '${old_new} > 0 and ${old_extra} = "x"');
});

test('§B2 — whitespace inside the braces is tolerated', () => {
  const f = mkForm([
    row('age', 'integer'),
    row('q', 'note', { relevant: '${ age } > 0' }),
  ]);
  const out = renameSurveyRow(f, 'age', 'age_new');
  assert.equal(out.survey[1]!.extras['relevant'], '${age_new} > 0');
});

test('§B3 — regex metacharacters in the source name do not break the matcher', () => {
  // Pre-fix bad names like "foo?" can land in the form before the
  // NameInput slugify guard fires. The macro must still rewrite their
  // ${...} refs cleanly.
  const f = mkForm([
    row('foo?', 'integer'),
    row('q', 'note', { relevant: '${foo?} > 0' }),
  ]);
  const out = renameSurveyRow(f, 'foo?', 'foo');
  assert.equal(out.survey[0]!.name, 'foo');
  assert.equal(out.survey[1]!.extras['relevant'], '${foo} > 0');
});

test('§B4 — multiple references in the same cell all rewrite', () => {
  const f = mkForm([
    row('x', 'integer'),
    row('q', 'note', { calculation: '${x} + ${x} - ${x}' }),
  ]);
  const out = renameSurveyRow(f, 'x', 'xx');
  assert.equal(out.survey[1]!.extras['calculation'], '${xx} + ${xx} - ${xx}');
});

/* ============================ §C — no-op shortcuts ============================ */

test('§C1 — empty fromName / toName returns the same instance', () => {
  const f = mkForm([row('foo', 'integer')]);
  assert.equal(renameSurveyRow(f, '', 'foo'), f);
  assert.equal(renameSurveyRow(f, 'foo', ''), f);
});

test('§C2 — identical fromName === toName is a no-op', () => {
  const f = mkForm([row('foo', 'integer')]);
  assert.equal(renameSurveyRow(f, 'foo', 'foo'), f);
});

test('§C3 — fromName not present + no refs to it returns the same instance', () => {
  const f = mkForm([row('foo', 'integer'), row('bar', 'string')]);
  // Renaming a name that doesn't exist anywhere is a no-op; we
  // preserve referential identity so callers can fast-path.
  assert.equal(renameSurveyRow(f, 'nonexistent', 'whatever'), f);
});

test('§C4 — fromName present as name only (no refs) still triggers a rebuild', () => {
  // The row name changes even when no other row references it.
  const f = mkForm([row('foo', 'integer')]);
  const out = renameSurveyRow(f, 'foo', 'foo_new');
  assert.notEqual(out, f);
  assert.equal(out.survey[0]!.name, 'foo_new');
});

/* ============================ §D — immutability ============================ */

test('§D1 — does not mutate the input form / survey rows', () => {
  const f = mkForm([
    row('foo', 'integer'),
    row('q', 'note', { relevant: '${foo} > 0' }),
  ]);
  const originalRelevant = f.survey[1]!.extras['relevant'];
  const out = renameSurveyRow(f, 'foo', 'foo_new');
  assert.equal(f.survey[0]!.name, 'foo', 'input row 0 name unchanged');
  assert.equal(f.survey[1]!.extras['relevant'], originalRelevant, 'input row 1 relevant unchanged');
  assert.notEqual(out.survey, f.survey, 'returned survey is a new array');
});
