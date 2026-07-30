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
import { parseXlsForm } from './parse.js';
import { serializeXlsForm } from './serialize.js';
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

/* ============ Wave 2 · §5 — auto-created harvest label ref stays in lockstep ============ */

test('§5 — after "insert contact field" auto-creates `patient_name`, renaming it rewrites the label token', () => {
  // Reproduces the flow Wave 2 §5b enables: the UI auto-creates a hidden
  // `patient_name` harvest calc (calculation = `../inputs/contact/name`)
  // and splices `${patient_name}` into a label. If the user later
  // renames the harvest calc, the label's `${patient_name}` must be
  // rewritten in lockstep — otherwise the label reference dangles.
  //
  // Byte-stability of the label rewrite is the acceptance criterion
  // named in docs/handoff-waves-1-3-2026-07-29.md §5.
  const f = mkForm([
    {
      rowId: 'r_harvest',
      type: 'calculate',
      name: 'patient_name',
      labels: { en: '' },
      extras: { calculation: '../inputs/contact/name' },
    },
    {
      rowId: 'r_greet',
      type: 'note',
      name: 'greeting',
      labels: { en: 'Hello ${patient_name}, welcome.' },
      extras: {},
    },
  ]);
  const out = renameSurveyRow(f, 'patient_name', 'patient_display_name');
  // The harvest calc keeps its calculation cell verbatim — no `${...}`
  // in there, so nothing gets rewritten (only `${old}` tokens do).
  assert.equal(out.survey[0]!.name, 'patient_display_name');
  assert.equal(out.survey[0]!.extras['calculation'], '../inputs/contact/name');
  // The label token is rewritten in lockstep.
  assert.equal(out.survey[1]!.labels['en'], 'Hello ${patient_display_name}, welcome.');
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

/* ============ Wave 1 · 1 — full parse→serialize→parse round-trip ============ */

/**
 * The handoff (docs/handoff-waves-1-3-2026-07-29.md §Wave 1 · 1) pins the
 * rename macro as a single acceptance case. Everything above tests the
 * in-memory transform. This test additionally exercises the full trip
 * through the XLSForm serializer + parser so the rewritten cells survive
 * a real xlsx round-trip (the shape the "Save" button hands to the
 * server and cht-conf later re-reads).
 *
 * The invariants pinned here in one place:
 *   1. Renaming `foo` → `foo_renamed` rewrites every `${foo}` across the
 *      full ref-bearing column set — relevant, calculation, constraint,
 *      choice_filter, default, repeat_count — plus label output tokens.
 *   2. The substring-collision case `${foo_extra}` in the same cell as
 *      `${foo}` stays as-is (only whole-name `${foo}` tokens rewrite;
 *      §B1 covers this on the transform, this pins it survives xlsx too).
 *   3. Serialize → parse → serialize → parse is a fixpoint on the
 *      renamed form: no drift on the second leg (the tighter guarantee
 *      §3b-style tests use). Content matches ignoring `rowId` (parser
 *      assigns fresh ids on reload; every other field must be identical).
 */
test('Wave 1 · 1 — rename `foo` → `foo_renamed` rewrites every ref-column + labels, `${foo_extra}` survives, form is parse→serialize→parse stable', async () => {
  // Authored form. The row named `foo_extra` exists on purpose — its
  // `${foo_extra}` references in the `q` row must NOT be rewritten when
  // we rename `foo`. Every ref-bearing column named in the handoff is
  // populated on the `q` row so the acceptance case exercises them all.
  const authored: XLSForm = {
    locales: ['en'],
    surveyHeaders: {
      ordered: [
        'type',
        'name',
        'label::en',
        'relevant',
        'calculation',
        'constraint',
        'choice_filter',
        'default',
        'repeat_count',
      ],
      labelLocales: ['en'],
    },
    choicesHeaders: { ordered: ['list_name', 'name', 'label::en'], labelLocales: ['en'] },
    survey: [
      {
        rowId: 'r_foo',
        type: 'integer',
        name: 'foo',
        labels: { en: 'Foo' },
        extras: {},
      },
      {
        rowId: 'r_foo_extra',
        type: 'integer',
        name: 'foo_extra',
        labels: { en: 'Foo extra (substring collision)' },
        extras: {},
      },
      {
        rowId: 'r_q',
        type: 'note',
        // Label output template exercises `${foo}` and the substring-collision
        // `${foo_extra}` side by side.
        name: 'q',
        labels: { en: 'foo=${foo}; foo_extra=${foo_extra}' },
        extras: {
          relevant: '${foo} > 0 and ${foo_extra} = "keep"',
          calculation: 'if(${foo} > 65, ${foo_extra}, ${foo})',
          constraint: '. >= ${foo} and . != ${foo_extra}',
          choice_filter: 'category = ${foo} and tag = ${foo_extra}',
          default: '${foo}',
          repeat_count: '${foo}',
        },
      },
    ],
    choices: [],
    settings: {
      form_id: 'rename_roundtrip',
      form_title: 'Rename round-trip',
      version: '2026-07-29',
      default_language: 'en',
      extras: {},
    },
    extraSheets: [],
  };

  // 1. Apply the rename macro.
  const renamed = renameSurveyRow(authored, 'foo', 'foo_renamed');

  // Sanity — the transform did the right thing before we send it through
  // the xlsx trip. Every column the handoff names must be rewritten.
  const q = renamed.survey.find((r) => r.name === 'q')!;
  assert.equal(renamed.survey[0]!.name, 'foo_renamed', 'row name swapped');
  assert.equal(renamed.survey[1]!.name, 'foo_extra', 'substring-collision row name untouched');
  assert.equal(q.extras['relevant'], '${foo_renamed} > 0 and ${foo_extra} = "keep"');
  assert.equal(q.extras['calculation'], 'if(${foo_renamed} > 65, ${foo_extra}, ${foo_renamed})');
  assert.equal(q.extras['constraint'], '. >= ${foo_renamed} and . != ${foo_extra}');
  assert.equal(q.extras['choice_filter'], 'category = ${foo_renamed} and tag = ${foo_extra}');
  assert.equal(q.extras['default'], '${foo_renamed}');
  assert.equal(q.extras['repeat_count'], '${foo_renamed}');
  assert.equal(q.labels['en'], 'foo=${foo_renamed}; foo_extra=${foo_extra}');

  // 2. Serialize → parse → serialize → parse — the renamed form must be
  //    a fixpoint through the xlsx round-trip. First reload should match
  //    the renamed content (ignoring rowIds — parser mints fresh ones).
  const buf1 = await serializeXlsForm(renamed);
  const reloaded1 = await parseXlsForm(buf1);
  const buf2 = await serializeXlsForm(reloaded1);
  const reloaded2 = await parseXlsForm(buf2);

  const stripIds = (rows: SurveyRow[]) =>
    rows.map((r) => ({
      type: r.type,
      name: r.name,
      labels: { ...r.labels },
      extras: { ...r.extras },
    }));

  assert.deepEqual(
    stripIds(reloaded1.survey),
    stripIds(renamed.survey),
    'first reload matches renamed content',
  );
  assert.deepEqual(
    stripIds(reloaded2.survey),
    stripIds(reloaded1.survey),
    'second reload is a fixpoint (no drift on the second leg)',
  );

  // 3. And every ref-column + label token still reads correctly after the
  //    xlsx round-trip — this is the byte-stability the handoff calls out.
  const qReloaded = reloaded1.survey.find((r) => r.name === 'q')!;
  assert.equal(qReloaded.extras['relevant'], '${foo_renamed} > 0 and ${foo_extra} = "keep"');
  assert.equal(
    qReloaded.extras['calculation'],
    'if(${foo_renamed} > 65, ${foo_extra}, ${foo_renamed})',
  );
  assert.equal(qReloaded.extras['constraint'], '. >= ${foo_renamed} and . != ${foo_extra}');
  assert.equal(qReloaded.extras['choice_filter'], 'category = ${foo_renamed} and tag = ${foo_extra}');
  assert.equal(qReloaded.extras['default'], '${foo_renamed}');
  assert.equal(qReloaded.extras['repeat_count'], '${foo_renamed}');
  assert.equal(qReloaded.labels['en'], 'foo=${foo_renamed}; foo_extra=${foo_extra}');
});
