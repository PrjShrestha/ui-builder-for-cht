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
