/**
 * Smoke tests for the helper rule builder (Contact summary → Helpers tab).
 *
 * Each test opens the helper builder for an existing helper, exercises one
 * regression we just shipped a fix for, and asserts the expected UI state.
 *
 * The dev server must be running (pnpm dev) on :5173/:5174 before these run.
 */
import { test, expect } from './setup.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // The text "Contact summary" appears in the sidebar nav AND the overview
  // card — scope to the sidebar nav-item.
  await page.locator('.nav-item', { hasText: 'Contact summary' }).click();
  await page.getByRole('button', { name: 'Helpers (extras.js)' }).click();
  await expect(page.locator('.helpers-list .task-card').first()).toBeVisible();
});

/** Open the first helper's "edit body" modal and resolve when it's mounted. */
async function openAnyHelperBuilder(page: import('@playwright/test').Page) {
  await page
    .locator('.helpers-list .task-card')
    .first()
    .getByRole('button', { name: /edit body/ })
    .click();
  await expect(page.locator('.rule-builder-modal')).toBeVisible();
}

test('helpers tab loads and shows at least one helper', async ({ page }) => {
  const count = await page.locator('.helpers-list .task-card').count();
  expect(count).toBeGreaterThan(0);
});

test('field picker excludes plumbing/meta fields', async ({ page }) => {
  await openAnyHelperBuilder(page);
  await page.locator('.rule-builder-modal').getByRole('button', { name: '+ contact field' }).click();

  const select = page.locator('.rule-row-block').last().locator('select').first();
  await expect(select).toBeVisible();

  // Pull all option values from the field-picker select.
  const options = await select.locator('option').evaluateAll((els) =>
    (els as HTMLOptionElement[]).map((o) => o.value).filter((v) => v.length > 0),
  );

  // Hard-banned names — anything that's pure XLSForm plumbing.
  for (const banned of ['_id', 'source', 'source_id', 'parent', 'start', 'end', 'meta']) {
    expect(options, `picker should not list ${banned}`).not.toContain(banned);
  }
  // Anything starting with _ is meta and should be hidden.
  expect(options.some((o) => o.startsWith('_'))).toBe(false);
});

/** Force the contact_field row into custom-input mode so tests don't depend
 * on whatever fields the loaded project happens to expose. */
async function forceCustomMode(row: import('@playwright/test').Locator) {
  const toggle = row.getByRole('button', { name: /custom|pick from form/ });
  if (await toggle.isVisible().catch(() => false)) {
    const txt = ((await toggle.textContent()) ?? '').trim().toLowerCase();
    // Button label is the OPPOSITE action: "custom" while in pick mode,
    // "pick from form" while in custom mode.
    if (txt === 'custom') await toggle.click();
  }
}

test('numeric op + non-numeric value disables Save and shows a warning', async ({ page }) => {
  await openAnyHelperBuilder(page);
  await page.locator('.rule-builder-modal').getByRole('button', { name: '+ contact field' }).click();

  const row = page.locator('.rule-row-block').last();
  await forceCustomMode(row);

  const fieldInput = row.getByPlaceholder('field name');
  await fieldInput.fill('age');

  // Op select is the last select in the row (after either the field-input or
  // the field-picker, the toggle button doesn't count).
  const opSelect = row.locator('select').last();
  await opSelect.selectOption('>');

  const valueInput = row.getByPlaceholder('number');
  await valueInput.fill('twenty');

  await expect(row.locator('.rule-row-warning:not(.muted)')).toContainText('Not a number');

  const save = page.locator('.rule-builder-modal').getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();

  await valueInput.fill('20');
  await expect(row.locator('.rule-row-warning:not(.muted)')).toHaveCount(0);
  await expect(save).toBeEnabled();
});

test('custom mode toggle does not yank focus while typing', async ({ page }) => {
  await openAnyHelperBuilder(page);
  await page.locator('.rule-builder-modal').getByRole('button', { name: '+ contact field' }).click();

  const row = page.locator('.rule-row-block').last();
  await forceCustomMode(row);

  const fieldInput = row.getByPlaceholder('field name');
  await fieldInput.fill(''); // clear default ('role')
  await fieldInput.focus();
  // Type a string slowly that may partial-match a real field — with derived
  // mode-switching this would unmount the input and lose focus.
  await fieldInput.pressSequentially('age_at_visit_date', { delay: 30 });
  await expect(fieldInput).toBeFocused();
  await expect(fieldInput).toHaveValue('age_at_visit_date');
});

test('empty raw row blocks Save with a clear message', async ({ page }) => {
  await openAnyHelperBuilder(page);
  await page.locator('.rule-builder-modal').getByRole('button', { name: '+ raw JS' }).click();

  const errors = page.locator('.rule-builder-errors');
  await expect(errors).toBeVisible();
  await expect(errors).toContainText(/empty.*raw JS.*row/i);

  const save = page.locator('.rule-builder-modal').getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();
});
