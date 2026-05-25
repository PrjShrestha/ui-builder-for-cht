/**
 * Smoke test for the XLSForm parser/serializer.
 *
 * Usage:
 *   node scripts/smoke-parser.mjs <path/to/some.xlsx>
 *
 * Default: tests against gandaki/pregnancy.xlsx.
 *
 * Goal: prove that parse → serialize → parse produces a stable AST. Any
 * drift indicates the serializer is silently dropping or moving data.
 *
 * Note: this script is run with Node, so it imports the COMPILED `shared`
 * package from `shared/dist/`. Build first with: pnpm --filter @cht-ui/shared build
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const target =
  process.argv[2] ??
  path.resolve(
    new URL('..', import.meta.url).pathname,
    '..',
    'config-gandaki',
    'cht-config',
    'forms',
    'app',
    'pregnancy.xlsx',
  );

const { parseXlsForm, serializeXlsForm, validateOrdering, buildDependencyMap } = await import(
  '../shared/dist/index.js'
);

function summarize(form) {
  return {
    locales: form.locales,
    surveyRows: form.survey.length,
    choiceRows: form.choices.length,
    extraSheets: form.extraSheets.map((s) => s.name),
    settings: { ...form.settings, extras: undefined },
    surveyHeaders: form.surveyHeaders.ordered,
    choicesHeaders: form.choicesHeaders.ordered,
    firstFiveRows: form.survey.slice(0, 5).map((r) => ({
      type: r.type,
      name: r.name,
      labels: r.labels,
      extras: r.extras,
    })),
  };
}

console.log('# Reading', target);
const buf = await readFile(target);
const form1 = await parseXlsForm(buf);
const s1 = summarize(form1);
console.log('## Parse #1:');
console.log(JSON.stringify(s1, null, 2));

const violations = validateOrdering(form1);
console.log(`## Ordering violations in current order: ${violations.length}`);
if (violations.length > 0 && violations.length <= 5) {
  for (const v of violations) {
    console.log(
      `  - row #${v.rowIndex} references ${v.reference} (defined at #${v.definingRowIndex}) in column ${v.column}`,
    );
  }
}

const depMap = buildDependencyMap(form1);
let depCount = 0;
for (const refs of depMap.values()) depCount += refs.length;
console.log(`## Dependency edges: ${depCount}`);

const out = await serializeXlsForm(form1);
const form2 = await parseXlsForm(out);
const s2 = summarize(form2);

// Equality check.
const same = JSON.stringify(s1) === JSON.stringify(s2);
console.log(`## Round-trip stable: ${same ? 'YES' : 'NO'}`);
if (!same) {
  console.error('Round-trip drift detected.');
  // Diff first few rows for debugging.
  for (let i = 0; i < Math.min(form1.survey.length, form2.survey.length); i++) {
    const a = JSON.stringify(form1.survey[i]);
    const b = JSON.stringify(form2.survey[i]);
    if (a !== b) {
      console.error(`Row ${i} drift:`);
      console.error('  before:', a);
      console.error('  after :', b);
      if (i > 5) break;
    }
  }
  process.exit(1);
}
console.log('OK');
