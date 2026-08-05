/**
 * Geriatric handoff §1 — the extended fields fetch behind the
 * rule-builder choice-value dropdowns. Pins:
 *   - select fields expose their real choices (label from the preferred
 *     locale, name stored);
 *   - non-select fields expose NO choices key;
 *   - group nesting produces dotted paths;
 *   - meta fields / meta-rooted subtrees are excluded (parity with the
 *     old bare-name extraction, audit P1-5).
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { extractReportFieldInfos, isDateFieldType } from './reportFieldInfos.js';

const CHOICES: Array<{ list_name: string; name: string; labels: Record<string, string> }> = [
  { list_name: 'fail_pass', name: 'फेल', labels: { ne: 'फेल', en: 'Fail' } },
  { list_name: 'fail_pass', name: 'pass', labels: { ne: 'पास', en: 'Pass' } },
  { list_name: 'yesno', name: 'yes', labels: { en: 'Yes' } },
  { list_name: 'yesno', name: 'no', labels: { en: 'No' } },
];

test('select_one field carries its list choices; text field carries none', () => {
  const infos = extractReportFieldInfos(
    [
      { type: 'select_one fail_pass', name: 'chair_rise' },
      { type: 'text', name: 'notes' },
    ],
    CHOICES,
    ['en'],
  );
  assert.equal(infos.length, 2);
  const sel = infos.find((i) => i.path === 'chair_rise')!;
  assert.deepEqual(
    sel.choices,
    [
      { name: 'फेल', label: 'Fail' },
      { name: 'pass', label: 'Pass' },
    ],
    'select field exposes {name, label} choices',
  );
  const txt = infos.find((i) => i.path === 'notes')!;
  assert.equal('choices' in txt, false, 'text field has no choices key');
});

test('choice label prefers the given locale order, then any non-empty, then the name', () => {
  const nePref = extractReportFieldInfos(
    [{ type: 'select_one fail_pass', name: 'q' }],
    CHOICES,
    ['ne', 'en'],
  );
  assert.equal(nePref[0]!.choices![0]!.label, 'फेल');
  const noLabels = extractReportFieldInfos(
    [{ type: 'select_one bare', name: 'q' }],
    [{ list_name: 'bare', name: 'opt_a', labels: {} }],
    ['en'],
  );
  assert.equal(noLabels[0]!.choices![0]!.label, 'opt_a', 'falls back to the choice name');
});

test('grouped fields emit dotted paths and keep their choices', () => {
  const infos = extractReportFieldInfos(
    [
      { type: 'begin group', name: 'iha' },
      { type: 'select_one yesno', name: 'referral' },
      { type: 'end group', name: 'iha' },
    ],
    CHOICES,
    ['en'],
  );
  assert.equal(infos.length, 1);
  assert.equal(infos[0]!.path, 'iha.referral');
  assert.equal(infos[0]!.choices!.length, 2);
});

test('meta fields and meta-rooted groups are excluded; unknown lists yield no choices', () => {
  const infos = extractReportFieldInfos(
    [
      { type: 'start', name: 'start' },
      { type: 'begin group', name: 'meta' },
      { type: 'text', name: 'instanceID' },
      { type: 'end group', name: 'meta' },
      { type: 'select_one missing_list', name: 'q1' },
      { type: 'text', name: '_hidden' },
    ],
    [],
    ['en'],
  );
  assert.deepEqual(
    infos.map((i) => i.path),
    ['q1'],
    'meta/underscore rows excluded',
  );
  assert.equal('choices' in infos[0]!, false, 'select with an unknown list gets no choices key');
});

test('isDateFieldType matches the XLSForm date-shaped types only', () => {
  assert.equal(isDateFieldType('date'), true);
  assert.equal(isDateFieldType(' dateTime '), true);
  assert.equal(isDateFieldType('date_time'), true);
  assert.equal(isDateFieldType('text'), false);
  assert.equal(isDateFieldType('select_one yesno'), false);
});
