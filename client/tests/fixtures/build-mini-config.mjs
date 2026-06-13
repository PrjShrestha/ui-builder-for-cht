/**
 * Generator for `client/tests/fixtures/mini-config/` — a minimal cht-conf-shaped
 * project used by the Playwright suite. Run this once; the resulting .xlsx
 * files and base_settings.json are checked into the repo so a fresh clone
 * has the fixture immediately (no env export needed).
 *
 * Usage:
 *   pnpm install   # ExcelJS lives in shared/ → root resolves it via pnpm-workspace
 *   node client/tests/fixtures/build-mini-config.mjs
 */
import ExcelJS from 'exceljs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'mini-config');

async function writeXlsx(filePath, sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'cht-ui-builder fixture';
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const row of rows) ws.addRow(row);
  }
  await mkdir(dirname(filePath), { recursive: true });
  const buf = await wb.xlsx.writeBuffer();
  await writeFile(filePath, Buffer.from(buf));
}

// Contact form: person.xlsx — `sex` is a select_one with male/female/other.
// This is the source of truth the condition builder pulls from when an app
// form references `inputs/contact/sex` via a calculate.
await writeXlsx(join(root, 'forms', 'contact', 'person.xlsx'), {
  survey: [
    ['type', 'name', 'label::en', 'required'],
    ['select_one sex_options', 'sex', 'Sex', 'yes'],
    ['text', 'patient_name', 'Name', 'yes'],
    ['integer', 'age', 'Age', ''],
  ],
  choices: [
    ['list_name', 'name', 'label::en'],
    ['sex_options', 'male', 'Male'],
    ['sex_options', 'female', 'Female'],
    ['sex_options', 'other', 'Other'],
  ],
  settings: [
    // Canonical order matches serialize.ts:155 so the round-trip smoke passes.
    ['form_title', 'form_id', 'version'],
    ['person', 'Person', '1.0'],
  ],
});

// App form: pregnancy.xlsx — `sex` arrives via inputs/contact/sex (calculate),
// matching the canonical CHT contact-injection pattern. One real editable
// question (`lmp_date`) so the e2e test can open the unified condition
// builder, pick `sex` from the field dropdown, and assert the value cell
// is a populated `<select>` (because `contactFieldChoices['sex']` reaches
// the FormEditor from the server).
await writeXlsx(join(root, 'forms', 'app', 'pregnancy.xlsx'), {
  survey: [
    ['type', 'name', 'label::en', 'calculation', 'required'],
    ['begin group', 'inputs', '', '', ''],
    ['begin group', 'contact', '', '', ''],
    ['calculate', 'sex', '', '../inputs/contact/sex', ''],
    ['calculate', '_id', '', '../inputs/contact/_id', ''],
    ['end group', '', '', '', ''],
    ['end group', '', '', '', ''],
    ['date', 'lmp_date', 'Last menstrual period', '', 'yes'],
    ['integer', 'gravidity', 'Number of pregnancies', '', ''],
  ],
  choices: [['list_name', 'name', 'label::en']],
  settings: [
    // Canonical order matches serialize.ts:155 so the round-trip smoke passes.
    ['form_title', 'form_id', 'version'],
    ['pregnancy', 'Pregnancy', '1.0'],
  ],
});

// app_settings/base_settings.json — minimal so the server's `hasAppSettings`
// check returns true and the project opens cleanly.
await mkdir(join(root, 'app_settings'), { recursive: true });
await writeFile(
  join(root, 'app_settings', 'base_settings.json'),
  JSON.stringify(
    { contact_types: [], place_hierarchy_types: [], permissions: {} },
    null,
    2,
  ) + '\n',
);

console.log('Wrote mini-config fixture to', root);
