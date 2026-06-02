/**
 * Round-trip safety tests for the operations the InlineChoicesEditor and
 * QuestionTypePicker perform on form.choices:
 *
 *   1. Adding a brand-new ChoiceRow doesn't lose existing choice columns.
 *   2. Editing a ChoiceRow's name/label preserves its `extras` (e.g.
 *      `filter-category`, `image`) byte-for-byte.
 *   3. Renaming a list via renameListInType + ChoiceRow.list_name keeps
 *      trailing tokens like `or_other` on the survey row's `type` cell.
 *
 * These defend the CLAUDE.md round-trip invariant: parse → serialize →
 * parse is byte-stable for everything the editor doesn't explicitly touch.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { parseXlsForm } from './parse.js';
import { serializeXlsForm } from './serialize.js';
import { renameListInType } from './renameList.js';
import type { XLSForm } from './types.js';

/** Build a minimal XLSForm fixture with a select_one column carrying choice extras. */
function makeFixture(): XLSForm {
  return {
    locales: ['en', 'ne'],
    surveyHeaders: {
      ordered: ['type', 'name', 'label::en', 'label::ne', 'relevant', 'appearance'],
      labelLocales: ['en', 'ne'],
    },
    choicesHeaders: {
      ordered: ['list_name', 'name', 'label::en', 'label::ne', 'filter-category', 'image'],
      labelLocales: ['en', 'ne'],
    },
    survey: [
      {
        rowId: 'r1',
        type: 'select_one symptoms or_other',
        name: 'symptom',
        labels: { en: 'Symptoms', ne: 'लक्षण' },
        extras: { relevant: '${age} > 0', appearance: 'minimal' },
      },
    ],
    choices: [
      {
        rowId: 'c1',
        list_name: 'symptoms',
        name: 'fever',
        labels: { en: 'Fever', ne: 'ज्वरो' },
        extras: { 'filter-category': 'physical', image: 'fever.png' },
      },
      {
        rowId: 'c2',
        list_name: 'symptoms',
        name: 'cough',
        labels: { en: 'Cough', ne: 'खोकी' },
        extras: { 'filter-category': 'respiratory', image: '' },
      },
    ],
    settings: { extras: {} },
    extraSheets: [],
  };
}

async function rt(form: XLSForm): Promise<XLSForm> {
  const buf = await serializeXlsForm(form);
  return parseXlsForm(buf);
}

test('choices round-trip preserves filter-category and image extras', async () => {
  const f1 = makeFixture();
  const f2 = await rt(f1);
  const fever = f2.choices.find((c) => c.name === 'fever');
  const cough = f2.choices.find((c) => c.name === 'cough');
  assert.ok(fever, 'fever choice survived');
  assert.ok(cough, 'cough choice survived');
  assert.equal(fever!.extras['filter-category'], 'physical');
  assert.equal(fever!.extras['image'], 'fever.png');
  assert.equal(cough!.extras['filter-category'], 'respiratory');
});

test('survey row type cell with or_other round-trips intact', async () => {
  const f1 = makeFixture();
  const f2 = await rt(f1);
  assert.equal(f2.survey[0]!.type, 'select_one symptoms or_other');
});

test('adding a new choice row leaves existing choice extras intact', async () => {
  const f1 = makeFixture();
  f1.choices.push({
    rowId: 'c3',
    list_name: 'symptoms',
    name: 'joint_pain',
    labels: { en: 'Joint pain' },
    extras: {},
  });
  const f2 = await rt(f1);
  const fever = f2.choices.find((c) => c.name === 'fever');
  const joint = f2.choices.find((c) => c.name === 'joint_pain');
  assert.ok(joint, 'newly added choice survived');
  assert.equal(joint!.list_name, 'symptoms');
  // The pre-existing extras must not have been disturbed by the append.
  assert.equal(fever!.extras['filter-category'], 'physical');
  assert.equal(fever!.extras['image'], 'fever.png');
});

test('editing only name/label preserves untouched extras', async () => {
  const f1 = makeFixture();
  // Simulate an inline-editor edit that doesn't touch extras.
  f1.choices = f1.choices.map((c) =>
    c.name === 'fever' ? { ...c, labels: { ...c.labels, en: 'High fever' } } : c,
  );
  const f2 = await rt(f1);
  const fever = f2.choices.find((c) => c.list_name === 'symptoms' && c.labels['en'] === 'High fever');
  assert.ok(fever, 'edited row survives');
  assert.equal(fever!.extras['filter-category'], 'physical');
  assert.equal(fever!.extras['image'], 'fever.png');
});

test('list rename: row.type + choice.list_name update together, or_other survives', async () => {
  const f1 = makeFixture();
  const oldName = 'symptoms';
  const newName = 'sx';
  f1.survey = f1.survey.map((r) => ({
    ...r,
    type: renameListInType(r.type, oldName, newName),
  }));
  f1.choices = f1.choices.map((c) =>
    c.list_name === oldName ? { ...c, list_name: newName } : c,
  );
  const f2 = await rt(f1);
  assert.equal(f2.survey[0]!.type, 'select_one sx or_other');
  // All choice rows now belong to the renamed list.
  const renamed = f2.choices.filter((c) => c.list_name === 'sx');
  assert.equal(renamed.length, 2);
  // And extras stayed put across the rename.
  const fever = renamed.find((c) => c.name === 'fever');
  assert.equal(fever!.extras['filter-category'], 'physical');
});
