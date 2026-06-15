/**
 * Slice 1 of the condition-builder plan (docs/plans/condition-builder.md).
 *
 * Acceptance: when an app form references a contact-injected field
 * (e.g. `inputs/contact/sex` via a calculate), the unified condition
 * builder's value cell must render as a populated `<select>` of the
 * contact form's choices — NOT a free-text input.
 *
 * Runs against the committed `client/tests/fixtures/mini-config` project
 * by default (no env export needed).
 */
import { test, expect } from './setup.js';
import type { Locator } from '@playwright/test';

test('condition builder — value cell is a populated dropdown for contact-injected `sex` field', async ({
  page,
}) => {
  await page.goto('/');

  // Navigate to the pregnancy form via the Forms list.
  await page.locator('.nav-item', { hasText: 'Forms' }).click();
  await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();

  // Find the `lmp_date` row card. The inputs/contact group above it is
  // collapsed by default in Simple mode, so the row is visible immediately.
  // We discriminate by `code.type-chip-raw` which renders the row's raw
  // XLSForm type — `date` for lmp_date, `calculate` for the inputs rows,
  // `integer` for gravidity.
  const lmpRow = page
    .locator('.survey-row')
    .filter({ has: page.locator('code.type-chip-raw', { hasText: /^date$/ }) });
  await expect(lmpRow).toBeVisible();

  // Expand the advanced fields so the unified condition builder is in the DOM.
  await lmpRow.getByRole('button', { name: /show advanced/ }).click();

  // The build strip lives inside the row's advanced panel.
  const strip = lmpRow.locator('.cond-strip-unified');
  await expect(strip).toBeVisible();

  // Strip is [column ▼] [field ▼] [logic ▼] [value …]. The first three
  // are `.ref-chip-select` in DOM order.
  const dropdowns = strip.locator('.ref-chip-select');
  await dropdowns.nth(0).selectOption('relevant');
  await dropdowns.nth(1).selectOption('sex');
  await dropdowns.nth(2).selectOption('='); // comparison op → needs a value

  // The PR's deliverable: the value cell is a populated <select>,
  // not the free-text `<input class="cond-value-input">` fallback.
  const valueCell = strip.locator(
    'select[title="Pick a value from this field\'s choices"]',
  );
  await expect(valueCell).toBeVisible();
  await expect(
    strip.locator('input.cond-value-input'),
    'free-text fallback must NOT render when contact choices are available',
  ).toHaveCount(0);

  // Choices flow through from contact/person.xlsx → server scan →
  // ProjectInfo.contactFieldChoices → buildFieldChoices merge.
  const optionValues = await valueCell
    .locator('option')
    .evaluateAll((els) =>
      (els as HTMLOptionElement[]).map((o) => o.value).filter((v) => v.length > 0),
    );
  expect(optionValues).toEqual(['male', 'female', 'other']);
});

test('condition builder — fields without any choices source still show free-text input', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.nav-item', { hasText: 'Forms' }).click();
  await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();

  const lmpRow = page
    .locator('.survey-row')
    .filter({ has: page.locator('code.type-chip-raw', { hasText: /^date$/ }) });
  await lmpRow.getByRole('button', { name: /show advanced/ }).click();

  const strip = lmpRow.locator('.cond-strip-unified');
  const dropdowns = strip.locator('.ref-chip-select');
  await dropdowns.nth(0).selectOption('relevant');
  // `_id` is a calculate from `inputs/contact/_id` — earlier in the survey
  // than `lmp_date` and has no choices in either form, so the value cell
  // should fall back to the free-text input.
  await dropdowns.nth(1).selectOption('_id');
  await dropdowns.nth(2).selectOption('=');

  await expect(strip.locator('input.cond-value-input')).toBeVisible();
  await expect(
    strip.locator('select[title="Pick a value from this field\'s choices"]'),
  ).toHaveCount(0);
});

/* ============================ Slice 2.C — group affordance ============================ */
/*
 * Plan §6 locks two Playwright cases:
 *   - "group happy path": build a flat AND chain, click ( group these ),
 *     start a second subgroup with OR, add a clause, save, reload, see
 *     the grouped chip rendering.
 *   - "no-flat-mixed": no UI sequence can write a row.extras value
 *     parsing to isRawFallback=true via builder-introduced mixing.
 * Both run against the committed mini-config fixture.
 */

/** Walk the unified condition builder strip's draft input through one clause. */
async function buildClause(
  strip: Locator,
  field: string,
  op: string,
  value: string,
): Promise<void> {
  const dropdowns = strip.locator('.ref-chip-select');
  await dropdowns.nth(1).selectOption(field);
  await dropdowns.nth(2).selectOption(op);
  // Use the free-text input when the field has no choices (the case for
  // _id / sex in our fixture when used as a value rather than a key).
  const valueSelect = strip.locator('select[title="Pick a value from this field\'s choices"]');
  if (await valueSelect.count()) {
    await valueSelect.selectOption(value);
  } else {
    await strip.locator('input.cond-value-input').fill(value);
  }
}

test('condition builder — group happy path: build flat AND, group, add OR-joined subgroup, insert, see grouped chips re-rehydrate', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.nav-item', { hasText: 'Forms' }).click();
  await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();

  // Open the lmp_date row's advanced fields — same anchor as Slice 1 tests.
  const lmpRow = page
    .locator('.survey-row')
    .filter({ has: page.locator('code.type-chip-raw', { hasText: /^date$/ }) });
  await lmpRow.getByRole('button', { name: /show advanced/ }).click();

  const strip = lmpRow.locator('.cond-strip-unified');
  await expect(strip).toBeVisible();

  // Pick column: relevant.
  await strip.locator('.ref-chip-select').nth(0).selectOption('relevant');

  // Build clause 1: ${sex} = 'female'  (sex has choices from contact form).
  await buildClause(strip, 'sex', '=', 'female');
  await strip.getByRole('button', { name: '+ add another rule' }).click();

  // Build clause 2: ${_id} = 'x' — joins by AND-locked (default).
  await buildClause(strip, '_id', '=', 'x');
  await strip.getByRole('button', { name: '+ add another rule' }).click();

  // ( group these ) — collect the two flat clauses into subgroup 1.
  await strip.getByRole('button', { name: '( group these )' }).click();

  // Card stack appears.
  const groupStack = strip.locator('.cond-subgroup-stack');
  await expect(groupStack).toBeVisible();
  await expect(groupStack.locator('.cond-subgroup')).toHaveCount(1);

  // Add a second subgroup joined by "or instead".
  await groupStack
    .locator('.cond-outer-connector')
    .getByRole('button', { name: 'or instead' })
    .click();

  // Now two cards exist, the second is active.
  await expect(groupStack.locator('.cond-subgroup')).toHaveCount(2);
  await expect(
    groupStack.locator('.cond-subgroup').nth(1).locator('.cond-subgroup-header'),
  ).toHaveAttribute('aria-pressed', 'true');

  // Build clause 3 inside subgroup 2.
  await buildClause(strip, 'sex', '=', 'male');
  await strip.getByRole('button', { name: '+ add another rule' }).click();

  // + insert writes the full grouped chain to row.extras.relevant. The
  // reducer immediately rehydrates from the just-written value
  // (`set-column` action with the new existingValue), so the card stack
  // must re-rehydrate from a real parseRelevantGrouped round-trip.
  await strip.getByRole('button', { name: '+ insert' }).click();

  // Two cards still visible after rehydrate (this is the actual proof —
  // the chain made it through serializeAnyParsed → parseRelevantGrouped).
  await expect(groupStack.locator('.cond-subgroup')).toHaveCount(2);
  // Subgroup 1 has its two clauses; subgroup 2 has its one clause.
  await expect(
    groupStack.locator('.cond-subgroup').nth(0).locator('.cond-preview'),
  ).toHaveCount(2);
  await expect(
    groupStack.locator('.cond-subgroup').nth(1).locator('.cond-preview'),
  ).toHaveCount(1);
  // The serialized chain is mirrored in the row's raw `relevant`
  // ExpressionField directly below the strip.
  const relevantField = lmpRow.locator('.expr-field', {
    hasText: 'Show this question when…',
  });
  const rawValue = await relevantField.locator('textarea, input').first().inputValue();
  expect(rawValue).toBe(`(\${sex} = 'female' and \${_id} = 'x') or \${sex} = 'male'`);
});

test('condition builder — no UI sequence can write a flat-mixed value (§3.7 structural)', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.nav-item', { hasText: 'Forms' }).click();
  await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();

  const lmpRow = page
    .locator('.survey-row')
    .filter({ has: page.locator('code.type-chip-raw', { hasText: /^date$/ }) });
  await lmpRow.getByRole('button', { name: /show advanced/ }).click();

  const strip = lmpRow.locator('.cond-strip-unified');
  await strip.locator('.ref-chip-select').nth(0).selectOption('relevant');

  // Build clause 1 (AND-default).
  await buildClause(strip, 'sex', '=', 'female');
  await strip.getByRole('button', { name: '+ add another rule' }).click();

  // The connector picker is disabled after the first commit and its
  // title carries the §10 verbatim warning copy directing the user to
  // ( group these ) instead of allowing flat-mixed.
  const connector = strip.locator('.ref-chip-select[title*="Mixing"]');
  await expect(connector).toBeVisible();
  await expect(connector).toBeDisabled();
  await expect(connector).toHaveAttribute(
    'title',
    /Press \( group these \) to combine rules/,
  );

  // Build a second clause and commit it — connector remains AND-locked.
  await buildClause(strip, '_id', '=', 'x');
  await strip.getByRole('button', { name: '+ add another rule' }).click();

  // + insert; assert the resulting raw `relevant` value DOES NOT carry
  // top-level mixed AND/OR (the only way to mix is via grouped form,
  // which this sequence didn't take).
  await strip.getByRole('button', { name: '+ insert' }).click();
  const relevantField = lmpRow.locator('.expr-field', {
    hasText: 'Show this question when…',
  });
  const rawValue = await relevantField.locator('textarea, input').first().inputValue();
  // No parens (would only appear if grouped) AND no top-level mix.
  expect(rawValue).not.toContain('(');
  expect(rawValue).not.toMatch(/\band\b[^()]*\bor\b|\bor\b[^()]*\band\b/);
});

/* ============== v0.3 — type-aware soft filter + natural-language labels ============== */
/*
 * Plan v0.3 §6 pins six Playwright cases. All anchor on the `gravidity`
 * row (the only `integer` row in the fixture) so `earlierFields` carries
 * a useful variety:
 *   - `sex` (calculate, choice-upgraded via fieldChoices)
 *   - `_id` (calculate, no choices → unknown)
 *   - `lmp_date` (date)
 *   - `lmp_note` (note → text)
 *   - `danger_signs` (select_multiple → choice)
 * That mix lets each test verify a different filter direction without
 * adding new fixture rows.
 */

/** Resolve the `gravidity` row card (the only `integer` row). */
function gravidityRow(page: import('@playwright/test').Page) {
  return page
    .locator('.survey-row')
    .filter({ has: page.locator('code.type-chip-raw', { hasText: /^integer$/ }) });
}

/** Read option text values from a <select>, grouped by their <optgroup> label. */
async function optgroupSnapshot(sel: Locator): Promise<Record<string, string[]>> {
  return await sel.evaluate((el) => {
    const out: Record<string, string[]> = {};
    for (const g of el.querySelectorAll('optgroup')) {
      const label = g.getAttribute('label') ?? '';
      out[label] = Array.from(g.querySelectorAll('option')).map((o) => o.getAttribute('value') ?? '');
    }
    return out;
  });
}

test('v0.3 — op-first filtering: picking `is more than` groups date/numeric typical, text+choice atypical, still selectable', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.nav-item', { hasText: 'Forms' }).click();
  await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();

  const row = gravidityRow(page);
  await row.getByRole('button', { name: /show advanced/ }).click();
  const strip = row.locator('.cond-strip-unified');
  const dropdowns = strip.locator('.ref-chip-select');
  await dropdowns.nth(0).selectOption('relevant');
  // Pick the natural-language label for `>` — option `value` is still `>`.
  await dropdowns.nth(2).selectOption('>');

  const fieldSelect = dropdowns.nth(1);
  const snap = await optgroupSnapshot(fieldSelect);
  // `lmp_date` (date) typical; `_id` (unknown) always-pass; `lmp_note`
  // (text) atypical for ordering ops; choice fields (sex, danger_signs)
  // atypical too.
  expect(snap['Typical for this check']).toContain('lmp_date');
  expect(snap['Typical for this check']).toContain('_id');
  expect(snap['Other fields']).toContain('lmp_note');
  // Atypical field is STILL selectable (never hard-hidden).
  await fieldSelect.selectOption('lmp_note');
  await expect(fieldSelect).toHaveValue('lmp_note');
});

test('v0.3 — field-first ordering: picking date `lmp_date` groups comparison ops Common; all 11 still in DOM', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.nav-item', { hasText: 'Forms' }).click();
  await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();

  const row = gravidityRow(page);
  await row.getByRole('button', { name: /show advanced/ }).click();
  const strip = row.locator('.cond-strip-unified');
  const dropdowns = strip.locator('.ref-chip-select');
  await dropdowns.nth(0).selectOption('relevant');
  // Pick a date field FIRST so the op picker partitions field-first.
  await dropdowns.nth(1).selectOption('lmp_date');

  const opSelect = dropdowns.nth(2);
  const snap = await optgroupSnapshot(opSelect);
  // All 11 op values must appear somewhere in the DOM (no hiding).
  const all = ([] as string[]).concat(...Object.values(snap));
  for (const op of ['=', '!=', '>', '<', '>=', '<=', 'selected', 'selected-not', 'not', 'ref', 'today']) {
    expect(all).toContain(op);
  }
  // Comparison ordering ops are grouped under "Common operators".
  expect(snap['Common operators']).toContain('>');
  expect(snap['Common operators']).toContain('<');
  expect(snap['Common operators']).toContain('>=');
  expect(snap['Common operators']).toContain('<=');
});

test('v0.3 — Show all fields toggle flattens the field list (escape hatch)', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.nav-item', { hasText: 'Forms' }).click();
  await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();

  const row = gravidityRow(page);
  await row.getByRole('button', { name: /show advanced/ }).click();
  const strip = row.locator('.cond-strip-unified');
  const dropdowns = strip.locator('.ref-chip-select');
  await dropdowns.nth(0).selectOption('relevant');
  await dropdowns.nth(2).selectOption('>');

  const fieldSelect = dropdowns.nth(1);
  const beforeSnap = await optgroupSnapshot(fieldSelect);
  expect(Object.keys(beforeSnap).length).toBeGreaterThanOrEqual(2);

  // Toggle on — the persistent "Show all fields" label/checkbox.
  await strip.getByRole('checkbox', { name: 'Show all fields' }).check();

  // Now flat list (no optgroups).
  const afterSnap = await optgroupSnapshot(fieldSelect);
  expect(Object.keys(afterSnap)).toHaveLength(0);
});

test('v0.3 — `includes` (selected) narrows field list to choice incl. contact-injected sex', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.nav-item', { hasText: 'Forms' }).click();
  await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();

  const row = gravidityRow(page);
  await row.getByRole('button', { name: /show advanced/ }).click();
  const strip = row.locator('.cond-strip-unified');
  const dropdowns = strip.locator('.ref-chip-select');
  await dropdowns.nth(0).selectOption('relevant');
  // `selected` is the canonical op value; its dropdown label is `includes value`.
  await dropdowns.nth(2).selectOption('selected');

  const fieldSelect = dropdowns.nth(1);
  const snap = await optgroupSnapshot(fieldSelect);
  // `sex` is choice-upgraded via fieldChoices (contact-injected select).
  expect(snap['Typical for this check']).toContain('sex');
  expect(snap['Typical for this check']).toContain('danger_signs');
  // Non-choice rows (date, text) appear under "Other fields", still selectable.
  expect(snap['Other fields']).toContain('lmp_date');
});

test('v0.3 — unknown-kind field (`_id`) is always-pass: reachable under ordering op `>`', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.nav-item', { hasText: 'Forms' }).click();
  await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();

  const row = gravidityRow(page);
  await row.getByRole('button', { name: /show advanced/ }).click();
  const strip = row.locator('.cond-strip-unified');
  const dropdowns = strip.locator('.ref-chip-select');
  await dropdowns.nth(0).selectOption('relevant');
  await dropdowns.nth(2).selectOption('>');

  const fieldSelect = dropdowns.nth(1);
  const snap = await optgroupSnapshot(fieldSelect);
  // `_id` is a `calculate` with no fieldChoices → unknown → always-pass.
  expect(snap['Typical for this check']).toContain('_id');
});

test('v0.3 — relabeled op dropdown saves byte-identical canonical XPath (no label leakage)', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.nav-item', { hasText: 'Forms' }).click();
  await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();

  // Use the existing `lmp_date` row anchor for parity with the Slice 2 happy path.
  const lmpRow = page
    .locator('.survey-row')
    .filter({ has: page.locator('code.type-chip-raw', { hasText: /^date$/ }) });
  await lmpRow.getByRole('button', { name: /show advanced/ }).click();
  const strip = lmpRow.locator('.cond-strip-unified');
  await strip.locator('.ref-chip-select').nth(0).selectOption('relevant');

  // Build `${sex} = 'female'` using the relabeled dropdown ("equals value").
  await buildClause(strip, 'sex', '=', 'female');
  await strip.getByRole('button', { name: '+ insert' }).click();

  // The persisted raw XPath uses the canonical `=` token, not "equals".
  const relevantField = lmpRow.locator('.expr-field', {
    hasText: 'Show this question when…',
  });
  const rawValue = await relevantField.locator('textarea, input').first().inputValue();
  expect(rawValue).toBe(`\${sex} = 'female'`);
  expect(rawValue).not.toMatch(/equals|includes|is more than|has an answer/i);
});
