/**
 * Round-trip tests for the scoped choice-value rename.
 *
 * Invariants pinned:
 *   1. `selected(${list}, 'oldName')` in relevant/calculation/constraint
 *      is rewritten to `'newName'`.
 *   2. `${list} = 'oldName'` equality checks are rewritten.
 *   3. Both single- and double-quoted literals are handled, quote style preserved.
 *   4. Literals in expressions that do NOT reference the target list are
 *      LEFT ALONE (safety against collisions across lists).
 *   5. Choice `name` is renamed exactly once (no double-rewrites).
 *   6. Sibling choices' `choice_filter` extras get rewritten when they
 *      reference `oldName` as a string literal.
 *   7. No-op cases (empty names, identical names, missing choice) return the
 *      same object reference.
 *   8. Substring collisions (`oldName` inside `oldName_extra`) don't match —
 *      the string-literal matcher is anchored to the full quoted form.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { renameChoiceValue } from './renameChoiceValue.js';
import type { XLSForm } from './types.js';

function makeForm(overrides: Partial<XLSForm> = {}): XLSForm {
  return {
    survey: [],
    choices: [],
    settings: {},
    locales: ['en'],
    sourceColumns: {},
    unknownSheets: {},
    ...overrides,
  } as XLSForm;
}

test('renames the choice + rewrites `selected(${list}, "oldName")` in relevant', () => {
  const form = makeForm({
    survey: [
      {
        rowId: 'r1',
        name: 'danger_signs',
        type: 'select_multiple danger_signs',
        labels: {},
        extras: {},
      },
      {
        rowId: 'r2',
        name: 'refer_note',
        type: 'note',
        labels: {},
        extras: {
          relevant: "selected(${danger_signs}, 'feet swollen') and selected(${danger_signs}, 'nausea')",
        },
      },
    ],
    choices: [
      { rowId: 'c1', list_name: 'danger_signs', name: 'feet swollen', labels: { en: 'Feet swollen' }, extras: {} },
      { rowId: 'c2', list_name: 'danger_signs', name: 'nausea', labels: { en: 'Nausea' }, extras: {} },
    ],
  });
  const out = renameChoiceValue(form, 'danger_signs', 'feet swollen', 'feet_swollen');
  assert.equal(out.choices[0]?.name, 'feet_swollen');
  assert.equal(
    out.survey[1]?.extras['relevant'],
    "selected(${danger_signs}, 'feet_swollen') and selected(${danger_signs}, 'nausea')",
  );
});

test('rewrites `${list} = "oldName"` equality in calculation', () => {
  const form = makeForm({
    survey: [
      { rowId: 'r1', name: 'severity', type: 'select_one severity_list', labels: {}, extras: {} },
      {
        rowId: 'r2',
        name: 'flag',
        type: 'calculate',
        labels: {},
        extras: { calculation: "if(${severity} = 'high risk', 1, 0)" },
      },
    ],
    choices: [
      { rowId: 'c1', list_name: 'severity_list', name: 'high risk', labels: {}, extras: {} },
      { rowId: 'c2', list_name: 'severity_list', name: 'low', labels: {}, extras: {} },
    ],
  });
  const out = renameChoiceValue(form, 'severity_list', 'high risk', 'high_risk');
  assert.equal(out.survey[1]?.extras['calculation'], "if(${severity} = 'high_risk', 1, 0)");
});

test('double-quoted literals rewrite, quote style preserved', () => {
  const form = makeForm({
    survey: [
      { rowId: 'r1', name: 'x', type: 'select_one L', labels: {}, extras: {} },
      { rowId: 'r2', name: 'y', type: 'note', labels: {}, extras: { relevant: 'selected(${x}, "a b c")' } },
    ],
    choices: [{ rowId: 'c1', list_name: 'L', name: 'a b c', labels: {}, extras: {} }],
  });
  const out = renameChoiceValue(form, 'L', 'a b c', 'a_b_c');
  assert.equal(out.survey[1]?.extras['relevant'], 'selected(${x}, "a_b_c")');
});

test('DOES NOT rewrite literals in expressions unrelated to the target list', () => {
  // Two lists both happen to have a choice called `blocked`. Renaming
  // ONLY the one on `list_a` must leave the `list_b`-referencing
  // expression untouched.
  const form = makeForm({
    survey: [
      { rowId: 'r1', name: 'q_a', type: 'select_one list_a', labels: {}, extras: {} },
      { rowId: 'r2', name: 'q_b', type: 'select_one list_b', labels: {}, extras: {} },
      {
        rowId: 'r3',
        name: 'note_a',
        type: 'note',
        labels: {},
        extras: { relevant: "selected(${q_a}, 'blocked')" },
      },
      {
        rowId: 'r4',
        name: 'note_b',
        type: 'note',
        labels: {},
        extras: { relevant: "selected(${q_b}, 'blocked')" },
      },
    ],
    choices: [
      { rowId: 'c1', list_name: 'list_a', name: 'blocked', labels: {}, extras: {} },
      { rowId: 'c2', list_name: 'list_b', name: 'blocked', labels: {}, extras: {} },
    ],
  });
  const out = renameChoiceValue(form, 'list_a', 'blocked', 'blocked_a');
  assert.equal(out.survey[2]?.extras['relevant'], "selected(${q_a}, 'blocked_a')");
  // The list_b expression must be untouched — different list.
  assert.equal(out.survey[3]?.extras['relevant'], "selected(${q_b}, 'blocked')");
  // Only list_a's choice renamed.
  assert.equal(out.choices[0]?.name, 'blocked_a');
  assert.equal(out.choices[1]?.name, 'blocked');
});

test('sibling choice_filter in the same list rewrites when it references the old value', () => {
  const form = makeForm({
    choices: [
      {
        rowId: 'c1',
        list_name: 'symptoms',
        name: 'cascade_parent',
        labels: {},
        extras: {},
      },
      {
        rowId: 'c2',
        list_name: 'symptoms',
        name: 'cough',
        labels: {},
        extras: { choice_filter: "parent = 'cascade_parent'" },
      },
    ],
  });
  const out = renameChoiceValue(form, 'symptoms', 'cascade_parent', 'primary_symptom');
  assert.equal(out.choices[0]?.name, 'primary_symptom');
  assert.equal(out.choices[1]?.extras?.['choice_filter'], "parent = 'primary_symptom'");
});

test('substring collisions do NOT match (anchored quoted-literal rewrite)', () => {
  const form = makeForm({
    survey: [
      { rowId: 'r1', name: 'q', type: 'select_one L', labels: {}, extras: {} },
      {
        rowId: 'r2',
        name: 'n',
        type: 'note',
        labels: {},
        extras: {
          // Both a bare literal and a substring-containing one — only
          // the bare `'yes'` should rewrite, `'yes_extra'` stays.
          relevant: "selected(${q}, 'yes') or ${q} = 'yes_extra'",
        },
      },
    ],
    choices: [
      { rowId: 'c1', list_name: 'L', name: 'yes', labels: {}, extras: {} },
      { rowId: 'c2', list_name: 'L', name: 'yes_extra', labels: {}, extras: {} },
    ],
  });
  const out = renameChoiceValue(form, 'L', 'yes', 'affirmative');
  assert.equal(
    out.survey[1]?.extras['relevant'],
    "selected(${q}, 'affirmative') or ${q} = 'yes_extra'",
  );
});

test('no-op cases return the same reference (fast-path)', () => {
  const form = makeForm({
    choices: [{ rowId: 'c1', list_name: 'L', name: 'a', labels: {}, extras: {} }],
  });
  assert.equal(renameChoiceValue(form, 'L', 'a', 'a'), form, 'identical → same ref');
  assert.equal(renameChoiceValue(form, 'L', '', 'a'), form, 'empty old → same ref');
  assert.equal(renameChoiceValue(form, 'L', 'a', ''), form, 'empty new → same ref');
  assert.equal(renameChoiceValue(form, 'L', 'ghost', 'x'), form, 'missing choice → same ref');
});

test('preserves choice extras unchanged when they do not reference the old value', () => {
  const form = makeForm({
    choices: [
      {
        rowId: 'c1',
        list_name: 'L',
        name: 'a',
        labels: {},
        extras: { 'filter-category': 'safe', 'image': 'a.png' },
      },
    ],
  });
  const out = renameChoiceValue(form, 'L', 'a', 'a_renamed');
  assert.equal(out.choices[0]?.name, 'a_renamed');
  assert.deepEqual(out.choices[0]?.extras, { 'filter-category': 'safe', 'image': 'a.png' });
});

test('or_other suffix is honored — rows with `select_multiple L or_other` count as bound', () => {
  const form = makeForm({
    survey: [
      {
        rowId: 'r1',
        name: 'q',
        type: 'select_multiple L or_other',
        labels: {},
        extras: {},
      },
      {
        rowId: 'r2',
        name: 'n',
        type: 'note',
        labels: {},
        extras: { relevant: "selected(${q}, 'foo bar')" },
      },
    ],
    choices: [{ rowId: 'c1', list_name: 'L', name: 'foo bar', labels: {}, extras: {} }],
  });
  const out = renameChoiceValue(form, 'L', 'foo bar', 'foo_bar');
  assert.equal(out.survey[1]?.extras['relevant'], "selected(${q}, 'foo_bar')");
});
