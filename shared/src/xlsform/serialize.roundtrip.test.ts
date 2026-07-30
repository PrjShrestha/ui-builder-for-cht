/**
 * Wave 2 §3b — section-authoring round-trip tests.
 *
 * The "+ Add section" flow (see `client/src/ui/FormEditor.tsx` +
 * `QuestionTypePicker.tsx`) commits a friendly section label as the
 * begin-group row's `labels.en`, an auto-derived slug as `name`, and
 * optionally `extras.appearance = 'field-list'` when the author toggles
 * "Show all on one screen." Nothing about that is a new serializer
 * concern — but authoring UX exists to let users build 2-deep nested
 * sections that never round-tripped in a test before. This file pins:
 *
 *   1. A 2-deep nested `begin group A / begin group B / row / end group B
 *      / end group A` survey — parsed from an xlsx buffer — round-trips
 *      byte-identical (parse → serialize → parse produces the same
 *      XLSForm structure, and the emitted xlsx re-parses to the same
 *      shape twice).
 *
 *   2. An `end group` with an empty name cell is tolerated — pyxform /
 *      the CHT default templates use both shapes; the balance guard
 *      already treats empty `end` names as "agrees with anything"
 *      (structuralBalance.ts §H2), so serialize/parse must round-trip
 *      both variants.
 *
 *   3. Interleaved `[A][B][/A][/B]` triggers `mismatched-name` from the
 *      balance guard — the save-time guard in FormEditor blocks
 *      serialize on any violation, so this is the invariant the section-
 *      authoring UX relies on to stay safe.
 *
 *   4. A group carrying the `field-list` appearance (the "Show all on
 *      one screen" toggle) round-trips its `appearance` cell verbatim.
 *
 * The tests use in-memory xlsx buffers built via the serializer itself
 * (feeding it an authored XLSForm), so we get real ExcelJS parsing on
 * the reload leg. That's the same shape the smoke-parser check uses
 * for real forms; it exercises the serialize→parse invariant end-to-
 * end without needing a fixture xlsx on disk.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseXlsForm } from './parse.js';
import { serializeXlsForm } from './serialize.js';
import { findStructuralViolations, isStructurallyBalanced } from './structuralBalance.js';
import type { ChoiceRow, SurveyRow, XLSForm } from './types.js';
import ExcelJS from 'exceljs';

/* ------------------------ helpers ------------------------ */

function row(partial: Partial<SurveyRow> & { rowId: string; type: string; name?: string }): SurveyRow {
  return {
    rowId: partial.rowId,
    type: partial.type,
    name: partial.name ?? '',
    labels: partial.labels ?? {},
    extras: partial.extras ?? {},
    required: partial.required,
  };
}

/** Build the minimum-viable XLSForm shell around a survey (`type` + `name` +
 *  `label::en` columns + a matching choices sheet). Keeps every test
 *  authoring one thing: the survey itself. */
function buildForm(survey: SurveyRow[]): XLSForm {
  return {
    locales: ['en'],
    surveyHeaders: {
      ordered: ['type', 'name', 'label::en', 'required', 'appearance'],
      labelLocales: ['en'],
    },
    choicesHeaders: {
      ordered: ['list_name', 'name', 'label::en'],
      labelLocales: ['en'],
    },
    survey,
    choices: [],
    settings: {
      form_title: 'Test',
      form_id: 'test',
      version: '2026-07-29',
      default_language: 'en',
      extras: {},
    },
    extraSheets: [],
  };
}

/** Serialize a form, re-parse it, and return the reloaded form. */
async function roundTrip(form: XLSForm): Promise<XLSForm> {
  const buf = await serializeXlsForm(form);
  return parseXlsForm(buf);
}

/**
 * Cell-matrix oracle (audit item 11): assert two serialized xlsx buffers
 * agree header-for-header and cell-for-cell on every sheet the builder
 * emits. This is the honest "byte-identical" check the §3b tests claim —
 * `stripRowIds` deep-equals the parsed IR, which is lossy by construction
 * (anything the parser normalizes away compares equal even if the on-disk
 * cells drifted). Raw zip-byte compare would flake on xlsx timestamps;
 * the cell matrix is the level at which "what lands in git" is defined.
 * Uses the §4 readers below (function declarations hoist).
 */
async function assertSheetsCellIdentical(
  bufA: Buffer,
  bufB: Buffer,
  sheets: string[] = ['survey', 'choices', 'settings'],
): Promise<void> {
  for (const sheet of sheets) {
    assert.deepEqual(
      await readSheetHeaders(bufB, sheet),
      await readSheetHeaders(bufA, sheet),
      `${sheet} sheet headers must be cell-identical across round-trips`,
    );
    assert.deepEqual(
      await readSheetRows(bufB, sheet),
      await readSheetRows(bufA, sheet),
      `${sheet} sheet rows must be cell-identical across round-trips`,
    );
  }
}

/** Compare two surveys ignoring `rowId` (the parser assigns fresh ids on
 *  reload; every other field is content the serializer/parser must round-
 *  trip byte-for-byte). */
function stripRowIds(rows: SurveyRow[]): Omit<SurveyRow, 'rowId'>[] {
  return rows.map((r) => {
    const clone: Omit<SurveyRow, 'rowId'> = {
      type: r.type,
      name: r.name,
      labels: { ...r.labels },
      extras: { ...r.extras },
    };
    if (r.required !== undefined && r.required !== '') clone.required = r.required;
    return clone;
  });
}

/* ============= 1. 2-deep nested group round-trip ============= */

test('Wave 2 §3b — 2-deep nested groups round-trip byte-identical through parse→serialize→parse', async () => {
  // begin group A            (danger_signs — the section-authoring flow's
  //   begin group B          product; friendly label, slug name)
  //     text q
  //   end group B
  // end group A
  const authored: SurveyRow[] = [
    row({
      rowId: 'gA',
      type: 'begin group',
      name: 'danger_signs',
      labels: { en: 'Danger signs' },
      extras: {},
    }),
    row({
      rowId: 'gB',
      type: 'begin group',
      name: 'chest',
      labels: { en: 'Chest' },
      extras: {},
    }),
    row({
      rowId: 'q1',
      type: 'text',
      name: 'chest_pain',
      labels: { en: 'Chest pain?' },
      extras: {},
    }),
    row({
      rowId: 'gB_end',
      type: 'end group',
      name: 'chest',
    }),
    row({
      rowId: 'gA_end',
      type: 'end group',
      name: 'danger_signs',
    }),
  ];

  // Balance invariant — the authoring UX depends on this staying green.
  assert.deepEqual(findStructuralViolations(authored), []);
  assert.equal(isStructurallyBalanced(authored), true);

  const form = buildForm(authored);
  const buf1 = await serializeXlsForm(form);
  const reloaded1 = await parseXlsForm(buf1);
  const buf2 = await serializeXlsForm(reloaded1);
  const reloaded2 = await parseXlsForm(buf2);

  // First round-trip: authored → reloaded content matches (ignoring rowIds).
  assert.deepEqual(stripRowIds(reloaded1.survey), stripRowIds(authored));
  // Second round-trip: reloaded1 → reloaded2 is a fixpoint (the stable
  // form of the parse↔serialize pair). This is the tighter guarantee:
  // any drift the first pass introduced would surface on the second.
  assert.deepEqual(stripRowIds(reloaded2.survey), stripRowIds(reloaded1.survey));
  // Audit item 11 — the honest byte-level oracle: the two serialized
  // buffers must agree cell-for-cell on every sheet, not just deep-equal
  // through the (lossy) parsed IR.
  await assertSheetsCellIdentical(buf1, buf2);
  // Balance survives too — the authoring UX's save-guard relies on
  // parse-then-check, so the parser must not silently rewrite the shape.
  assert.deepEqual(findStructuralViolations(reloaded1.survey), []);
  assert.deepEqual(findStructuralViolations(reloaded2.survey), []);
});

/* ============= 2. `end group` with empty name is tolerated ============= */

test('Wave 2 §3b — `end group` with empty name round-trips (some templates omit it)', async () => {
  // begin group A / row / end group   ← end row's name cell is empty
  const authored: SurveyRow[] = [
    row({ rowId: 'gA', type: 'begin group', name: 'inputs', labels: { en: 'Inputs' } }),
    row({ rowId: 'q1', type: 'text', name: 'note1', labels: { en: 'Note' } }),
    row({ rowId: 'gA_end', type: 'end group', name: '' }),
  ];

  // §H2 — the balance guard tolerates empty `end` names.
  assert.deepEqual(findStructuralViolations(authored), []);

  const form = buildForm(authored);
  const reloaded = await roundTrip(form);

  // The empty `end group` name survives; balance stays green.
  const endRow = reloaded.survey.find((r) => r.type.trim().toLowerCase() === 'end group');
  assert.ok(endRow, 'reloaded form must still have an end group row');
  assert.equal(endRow!.name, '', 'end group name must round-trip as empty');
  assert.deepEqual(findStructuralViolations(reloaded.survey), []);
});

/* ======= 3. Interleaved [A][B][/A][/B] triggers mismatched-name ======= */

test('Wave 2 §3b — interleaved `[A][B][/A][/B]` triggers mismatched-name and blocks the save-guard', () => {
  // Adversarial: pyxform pairs by name, so kind-balanced-but-name-crossed
  // fails on deploy. The save-guard in FormEditor calls
  // `findStructuralViolations` and refuses to serialize on any hit — the
  // section-authoring UX relies on this to stay safe. This test pins the
  // guard's oracle: interleaved `[A][B][/A][/B]` MUST produce
  // `mismatched-name` violations so the save-guard blocks the write.
  const survey: SurveyRow[] = [
    row({ rowId: 'gA', type: 'begin group', name: 'A' }),
    row({ rowId: 'gB', type: 'begin group', name: 'B' }),
    row({ rowId: 'eA', type: 'end group', name: 'A' }),
    row({ rowId: 'eB', type: 'end group', name: 'B' }),
  ];
  const vs = findStructuralViolations(survey);
  assert.ok(vs.length > 0, 'interleaved groups must produce at least one violation');
  assert.ok(
    vs.every((v) => v.kind === 'mismatched-name'),
    'all violations should be mismatched-name (kind-balanced by construction)',
  );
  assert.equal(isStructurallyBalanced(survey), false);
});

/* ======= 4. `field-list` appearance round-trips on a group row ======= */

test('Wave 2 §3b — group with `field-list` appearance ("Show all on one screen") round-trips', async () => {
  // The "Show all on one screen" toggle sets `extras.appearance =
  // 'field-list'` on the begin-group row. The XLSForm serializer must
  // route the appearance cell to the `appearance` column verbatim.
  const authored: SurveyRow[] = [
    row({
      rowId: 'gA',
      type: 'begin group',
      name: 'vitals',
      labels: { en: 'Vitals' },
      extras: { appearance: 'field-list' },
    }),
    row({ rowId: 'q1', type: 'integer', name: 'sys', labels: { en: 'Systolic' } }),
    row({ rowId: 'q2', type: 'integer', name: 'dia', labels: { en: 'Diastolic' } }),
    row({ rowId: 'gA_end', type: 'end group', name: 'vitals' }),
  ];

  const form = buildForm(authored);
  const buf1 = await serializeXlsForm(form);
  const reloaded1 = await parseXlsForm(buf1);
  const buf2 = await serializeXlsForm(reloaded1);
  const reloaded2 = await parseXlsForm(buf2);

  // Appearance stays on the begin row.
  const begin = reloaded1.survey.find((r) => r.type.trim().toLowerCase() === 'begin group');
  assert.ok(begin, 'reloaded form must have a begin group row');
  assert.equal(begin!.extras['appearance'], 'field-list');

  // Full survey content matches, and a second round-trip is a fixpoint —
  // pinned at cell level, not just through the parsed IR (audit item 11).
  assert.deepEqual(stripRowIds(reloaded1.survey), stripRowIds(authored));
  assert.deepEqual(stripRowIds(reloaded2.survey), stripRowIds(reloaded1.survey));
  await assertSheetsCellIdentical(buf1, buf2);
});

/* ======= 5. Combined: 2-deep + field-list + label on outer ======= */

test('Wave 2 §3b — combined shape (2-deep, outer field-list, friendly labels) round-trips', async () => {
  // The realistic shape from the "+ Add section" flow: outer section
  // carries a label + field-list; inner section carries a label; both
  // slugs derived. This is the shape a health-post officer authoring
  // "Danger signs > Chest" via the toolbar produces.
  const authored: SurveyRow[] = [
    row({
      rowId: 'gA',
      type: 'begin group',
      name: 'danger_signs',
      labels: { en: 'Danger signs' },
      extras: { appearance: 'field-list' },
    }),
    row({
      rowId: 'gB',
      type: 'begin group',
      name: 'chest',
      labels: { en: 'Chest' },
      extras: {},
    }),
    row({
      rowId: 'q1',
      type: 'select_one yesno',
      name: 'chest_pain',
      labels: { en: 'Chest pain?' },
      extras: {},
      required: 'yes',
    }),
    row({ rowId: 'gB_end', type: 'end group', name: 'chest' }),
    row({ rowId: 'gA_end', type: 'end group', name: 'danger_signs' }),
  ];

  assert.deepEqual(findStructuralViolations(authored), []);

  const form = buildForm(authored);
  const buf1 = await serializeXlsForm(form);
  const reloaded1 = await parseXlsForm(buf1);
  const buf2 = await serializeXlsForm(reloaded1);
  const reloaded2 = await parseXlsForm(buf2);

  // Structural balance survives.
  assert.deepEqual(findStructuralViolations(reloaded1.survey), []);
  // Content matches (ignoring rowIds) — first pass and fixpoint, pinned
  // at cell level too (audit item 11).
  assert.deepEqual(stripRowIds(reloaded1.survey), stripRowIds(authored));
  assert.deepEqual(stripRowIds(reloaded2.survey), stripRowIds(reloaded1.survey));
  await assertSheetsCellIdentical(buf1, buf2);
});

/* ============= 6. Add-language: appending `ne` to a single-locale form ============= */

/**
 * Read the header row of a specific sheet inside a freshly-serialized xlsx
 * buffer. Bypasses `parseXlsForm` (which normalizes into
 * `SurveyHeaderInfo.ordered`) so the test can assert the raw column order
 * that would actually land on disk / in git.
 */
async function readSheetHeaders(buf: Buffer, sheetName: string): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buf as any);
  let ws: ExcelJS.Worksheet | undefined;
  wb.eachSheet((s) => {
    if (s.name.toLowerCase() === sheetName.toLowerCase()) ws = s;
  });
  if (!ws) throw new Error(`sheet ${sheetName} not found in buffer`);
  const headerRow = ws.getRow(1);
  const maxCol = Math.max(ws.actualColumnCount ?? 0, ws.columnCount ?? 0);
  const out: string[] = [];
  for (let c = 1; c <= maxCol; c++) {
    const v = headerRow.getCell(c).value;
    if (v === null || v === undefined || v === '') out.push('');
    else out.push(String(v));
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

/**
 * Read every non-header row of a sheet as a raw string matrix, preserving
 * empty cells as "" (not dropped). This lets the test pin the "empty
 * string, not missing" invariant for rows that don't yet carry a `ne`
 * label — the whole point of the Add-language column-append.
 */
async function readSheetRows(buf: Buffer, sheetName: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buf as any);
  let ws: ExcelJS.Worksheet | undefined;
  wb.eachSheet((s) => {
    if (s.name.toLowerCase() === sheetName.toLowerCase()) ws = s;
  });
  if (!ws) throw new Error(`sheet ${sheetName} not found in buffer`);
  const headerRow = ws.getRow(1);
  const maxCol = Math.max(ws.actualColumnCount ?? 0, ws.columnCount ?? 0);
  let width = 0;
  for (let c = 1; c <= maxCol; c++) {
    const v = headerRow.getCell(c).value;
    if (v !== null && v !== undefined && v !== '') width = c;
  }
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber === 1) return;
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) {
      const v = excelRow.getCell(c).value;
      cells.push(v === null || v === undefined ? '' : String(v));
    }
    rows.push(cells);
  });
  return rows;
}

test('Wave 2 §4 — adding `ne` to a single-locale form APPENDS label::ne to survey + choices sheets', async () => {
  // Start from a single-locale (`en`) form with survey + choice rows +
  // "extras" columns (relevant, appearance) in the middle of the header
  // order. This shape mirrors what the Add-language chip bar starts from:
  // the user has authored English content, everything works, they add
  // Nepali as a second active locale. The serializer must append the new
  // column at the END of each sheet (never interleave), preserve the
  // existing column order verbatim, and emit "" for rows that don't yet
  // carry a `ne` label — the missing state is materialized on disk, not
  // dropped, so translators see empty cells to fill in.
  const survey: SurveyRow[] = [
    row({
      rowId: 's1',
      type: 'text',
      name: 'chest_pain',
      labels: { en: 'Chest pain?' },
      required: 'yes',
      extras: { relevant: '${age} > 18', appearance: 'multiline' },
    }),
    row({
      rowId: 's2',
      type: 'select_one yesno',
      name: 'breath',
      labels: { en: 'Breathless?' },
      extras: {},
    }),
  ];
  const choices: ChoiceRow[] = [
    { rowId: 'c1', list_name: 'yesno', name: 'yes', labels: { en: 'Yes' }, extras: {} },
    { rowId: 'c2', list_name: 'yesno', name: 'no', labels: { en: 'No' }, extras: {} },
  ];
  const before: XLSForm = {
    locales: ['en'],
    // `relevant` and `appearance` sit BEFORE the label column — the
    // append invariant is that adding `ne` moves nothing here.
    surveyHeaders: {
      ordered: ['type', 'name', 'required', 'relevant', 'appearance', 'label::en'],
      labelLocales: ['en'],
    },
    choicesHeaders: {
      ordered: ['list_name', 'name', 'label::en'],
      labelLocales: ['en'],
    },
    survey,
    choices,
    settings: {
      form_title: 'ANC',
      form_id: 'anc',
      version: '2026-07-29',
      default_language: 'en',
      extras: {},
    },
    extraSheets: [],
  };

  // Baseline: the "before" state serializes cleanly (headers as declared).
  const bufBefore = await serializeXlsForm(before);
  const surveyHeadersBefore = await readSheetHeaders(bufBefore, 'survey');
  assert.deepEqual(
    surveyHeadersBefore,
    ['type', 'name', 'required', 'relevant', 'appearance', 'label::en'],
    'baseline survey headers must match the ordered list before adding a locale',
  );
  const choicesHeadersBefore = await readSheetHeaders(bufBefore, 'choices');
  assert.deepEqual(
    choicesHeadersBefore,
    ['list_name', 'name', 'label::en'],
    'baseline choices headers must match the ordered list before adding a locale',
  );

  // Simulate the Add-language flow — the client appends `ne` to
  // `form.locales`, `surveyHeaders.labelLocales`, and
  // `choicesHeaders.labelLocales`. No row is touched (the user hasn't
  // typed any `ne` labels yet). The `default_language` in settings is
  // NOT changed — this is a strict addition.
  const after: XLSForm = {
    ...before,
    locales: [...before.locales, 'ne'],
    surveyHeaders: {
      ordered: before.surveyHeaders.ordered,
      labelLocales: [...before.surveyHeaders.labelLocales, 'ne'],
    },
    choicesHeaders: {
      ordered: before.choicesHeaders.ordered,
      labelLocales: [...before.choicesHeaders.labelLocales, 'ne'],
    },
  };

  const bufAfter = await serializeXlsForm(after);

  // ---- Assertion 1: label::ne is APPENDED, not interleaved. ----
  const surveyHeadersAfter = await readSheetHeaders(bufAfter, 'survey');
  assert.deepEqual(
    surveyHeadersAfter,
    ['type', 'name', 'required', 'relevant', 'appearance', 'label::en', 'label::ne'],
    'label::ne must land at the END of the survey header list, not interleaved',
  );
  assert.equal(
    surveyHeadersAfter[surveyHeadersAfter.length - 1],
    'label::ne',
    'label::ne must be the final survey column',
  );

  // ---- Assertion 2: original column order is preserved. ----
  // Every existing column stays at its baseline index; only the new
  // column is added at the end.
  for (let i = 0; i < surveyHeadersBefore.length; i++) {
    assert.equal(
      surveyHeadersAfter[i],
      surveyHeadersBefore[i],
      `survey column at index ${i} must not shift when adding a locale`,
    );
  }

  // ---- Assertion 3: rows without a `ne` label emit "" (not dropped). ----
  const surveyRows = await readSheetRows(bufAfter, 'survey');
  assert.equal(surveyRows.length, 2, 'both survey rows must be present after Add-language');
  // Column index 6 is `label::ne`; both authored rows carry en-only
  // labels, so the ne cell must be an empty string (not undefined /
  // missing, not the en value).
  for (let i = 0; i < surveyRows.length; i++) {
    const cell = surveyRows[i]![6];
    assert.equal(cell, '', `row ${i + 1} label::ne cell must be empty string, got ${JSON.stringify(cell)}`);
  }

  // ---- Assertion 4: BOTH survey AND choices sheets pick up the locale. ----
  const choicesHeadersAfter = await readSheetHeaders(bufAfter, 'choices');
  assert.deepEqual(
    choicesHeadersAfter,
    ['list_name', 'name', 'label::en', 'label::ne'],
    'choices sheet must also grow a label::ne column when the choicesHeaders.labelLocales gains `ne`',
  );
  const choiceRowsAfter = await readSheetRows(bufAfter, 'choices');
  assert.equal(choiceRowsAfter.length, 2, 'both choice rows must be present');
  for (let i = 0; i < choiceRowsAfter.length; i++) {
    const cell = choiceRowsAfter[i]![3];
    assert.equal(cell, '', `choice row ${i + 1} label::ne cell must be empty string`);
  }

  // ---- Assertion 5: default_language in settings is UNCHANGED. ----
  const settingsHeadersAfter = await readSheetHeaders(bufAfter, 'settings');
  const settingsRowsAfter = await readSheetRows(bufAfter, 'settings');
  const dlIdx = settingsHeadersAfter.findIndex((h) => h === 'default_language');
  assert.ok(dlIdx >= 0, 'settings sheet must still carry a default_language column');
  assert.equal(settingsRowsAfter.length, 1, 'settings sheet must have exactly one data row');
  assert.equal(
    settingsRowsAfter[0]![dlIdx],
    'en',
    'default_language must not be rewritten when a new locale is added',
  );

  // ---- Assertion 6: round-trip stability — parse → serialize → parse. ----
  const reloaded = await parseXlsForm(bufAfter);
  assert.ok(
    reloaded.surveyHeaders.labelLocales.includes('ne'),
    'reloaded form must carry `ne` in surveyHeaders.labelLocales',
  );
  assert.ok(
    reloaded.choicesHeaders.labelLocales.includes('ne'),
    'reloaded form must carry `ne` in choicesHeaders.labelLocales',
  );
  assert.ok(reloaded.locales.includes('ne'), 'reloaded form.locales must include `ne`');
  assert.equal(
    reloaded.settings.default_language,
    'en',
    'reloaded default_language must still be `en`',
  );
});

/* ==== 7. Edge: `label:ne` (single-colon) header must not duplicate on add ==== */

test('Wave 2 §4 — legacy `label:ne` header dedupes: adding ne does NOT create a duplicate label::ne', async () => {
  // Some legacy XLSForms carry the single-colon `label:ne` spelling.
  // LABEL_HEADER_RE parses both variants to the same locale `ne`, so the
  // Add-language flow must NOT append a second column when the legacy
  // form is loaded. This is the invariant the Add-language chip bar
  // relies on to be safe against forms that already carry a locale — it
  // just registers `ne` in `labelLocales` (idempotent).
  const before: XLSForm = {
    locales: ['en', 'ne'],
    surveyHeaders: {
      // legacy single-colon `label:ne` — some templates use this.
      ordered: ['type', 'name', 'label::en', 'label:ne', 'appearance'],
      // NOT declared in labelLocales — the client is about to add it.
      labelLocales: ['en'],
    },
    choicesHeaders: {
      ordered: ['list_name', 'name', 'label::en', 'label:ne'],
      labelLocales: ['en'],
    },
    survey: [
      row({
        rowId: 's1',
        type: 'text',
        name: 'q1',
        labels: { en: 'Q1', ne: 'प्रश्न १' },
        extras: {},
      }),
    ],
    choices: [
      {
        rowId: 'c1',
        list_name: 'yesno',
        name: 'yes',
        labels: { en: 'Yes', ne: 'हो' },
        extras: {},
      },
    ],
    settings: {
      form_title: 'T',
      form_id: 't',
      version: '2026-07-29',
      default_language: 'en',
      extras: {},
    },
    extraSheets: [],
  };

  // Simulate the client registering `ne` (idempotent on this form —
  // headers already contain a `label:ne` column that resolves to the
  // same locale via LABEL_HEADER_RE).
  const after: XLSForm = {
    ...before,
    surveyHeaders: {
      ordered: before.surveyHeaders.ordered,
      labelLocales: ['en', 'ne'],
    },
    choicesHeaders: {
      ordered: before.choicesHeaders.ordered,
      labelLocales: ['en', 'ne'],
    },
  };

  const buf = await serializeXlsForm(after);
  const surveyHeaders = await readSheetHeaders(buf, 'survey');
  // Exactly one `ne` label column — the legacy `label:ne` — must be present.
  const neCols = surveyHeaders.filter((h) => /^label(?:::|:)ne$/i.test(h));
  assert.equal(
    neCols.length,
    1,
    `expected exactly one ne label column, got ${neCols.length}: ${JSON.stringify(neCols)}`,
  );
  // AND the original column order is preserved (no reshuffle).
  assert.deepEqual(surveyHeaders, ['type', 'name', 'label::en', 'label:ne', 'appearance']);

  // Same invariant on the choices sheet.
  const choicesHeaders = await readSheetHeaders(buf, 'choices');
  const neChoiceCols = choicesHeaders.filter((h) => /^label(?:::|:)ne$/i.test(h));
  assert.equal(neChoiceCols.length, 1, 'choices sheet must also stay single-column for ne');
  assert.deepEqual(choicesHeaders, ['list_name', 'name', 'label::en', 'label:ne']);
});
