/**
 * Geriatric buildability blockers e2e
 * (docs/handoff-geriatric-blockers-2026-08-05.md).
 *
 *   §1 — choice-value dropdowns in the two modal rule builders: building
 *        "field = <choice>" requires ZERO typing — the value cell is a
 *        dropdown of the field's real choices (label shown, name stored).
 *   §3 — OR authoring: the and/or connector pill between appliesIf rule
 *        rows emits the ¬(A ∨ B) guard (`if (!A && !B) return false`),
 *        and the saved tasks.js round-trips it structured.
 *
 * Runs against the committed `fixtures/mini-config` (pregnancy.xlsx has a
 * `select_multiple danger_signs` with three real choices; tasks.js has
 * one pregnancy task). The OR test saves tasks.js, so it re-points the
 * server at a TEMP COPY of the fixture first — the committed fixture is
 * never mutated.
 */
import { test, expect, PROJECT_PATH } from './setup.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('§1 relevant builder — selected() value is a dropdown of the field’s real choices', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.nav-item', { hasText: 'Forms' }).click();
  await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();

  // `gravidity` (integer) sits BELOW danger_signs, so danger_signs is in
  // its earlier-fields options.
  const gravidityRow = page
    .locator('.survey-row')
    .filter({ has: page.locator('code.type-chip-raw', { hasText: /^integer$/ }) });
  await expect(gravidityRow).toBeVisible();
  await gravidityRow.getByRole('button', { name: /show advanced/ }).click();

  // Open the RelevantRuleBuilder via the relevant ExpressionField's build button.
  await gravidityRow
    .locator('.expr-field', { hasText: 'Show this question when' })
    .locator('button', { hasText: '✎ build' })
    .click();
  const modal = page.locator('.rule-builder-modal');
  await expect(modal).toBeVisible();

  await modal.getByRole('button', { name: '+ selected()' }).click();
  const row = modal.locator('.rule-row').last();
  // Field picker: pick danger_signs.
  await row.locator('select').first().selectOption('danger_signs');

  // §1 deliverable: the value cell is a populated choice dropdown, not a
  // free-text input.
  const valueSelect = row.locator('select.choice-value-select');
  await expect(valueSelect).toBeVisible();
  await valueSelect.selectOption('vaginal_bleeding');

  // Emitted expression uses the choice NAME — byte-identical to the typed path.
  await expect(modal.locator('.preview code')).toContainText(
    "selected(${danger_signs}, 'vaginal_bleeding')",
  );
});

test('§1 + §3 appliesIf builder — choice dropdowns + OR connector → && guard in tasks.js', async ({
  page,
  request,
}) => {
  // Copy the fixture to a temp dir — this test SAVES tasks.js.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cht-ui-geriatric-'));
  await fs.cp(PROJECT_PATH, tmp, { recursive: true });
  const open = await request.post('http://127.0.0.1:5174/api/project/open', {
    data: { path: tmp },
  });
  expect(open.ok()).toBeTruthy();

  await page.goto('/');
  await page.locator('.nav-item', { hasText: 'Tasks' }).click();

  // Expand the fixture's task card and open the appliesIf builder.
  const card = page.locator('.task-card').filter({ hasText: 'pregnancy-follow-up' }).first();
  // The card auto-expands when it's the only task; expand only if collapsed.
  const expand = card.getByRole('button', { name: '▸' });
  if (await expand.isVisible().catch(() => false)) await expand.click();
  await card
    .locator('.expr-field', { hasText: 'appliesIf' })
    .locator('button', { hasText: '✎ build' })
    .click();
  const modal = page.locator('.rule-builder-modal');
  await expect(modal).toBeVisible();

  // Two report-field rules, each picked entirely from dropdowns.
  for (const choice of ['vaginal_bleeding', 'severe_headache']) {
    await modal.getByRole('button', { name: '+ report field' }).click();
    const row = modal.locator('.rule-row').last();
    await row.locator('select.field-picker').selectOption('danger_signs');
    const valueSelect = row.locator('select.choice-value-select');
    await expect(valueSelect).toBeVisible();
    await valueSelect.selectOption(choice);
  }

  // §3 — flip the connector between the two new rows to OR.
  await modal.locator('select.connector-pill').last().selectOption('or');

  // The emitted guard is ¬(A ∨ B): inverted comparisons joined with `&&`.
  await expect(modal.locator('.preview pre')).toContainText(
    "if (Utils.getField(report, 'danger_signs') !== 'vaginal_bleeding' && Utils.getField(report, 'danger_signs') !== 'severe_headache') { return false; }",
  );

  await modal.getByRole('button', { name: 'Save' }).click();
  await expect(modal).toBeHidden();

  // Persist to disk and verify the file carries the OR guard.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  const files = await request.get('http://127.0.0.1:5174/api/tasks/files');
  expect(files.ok()).toBeTruthy();
  const tasksJs = (await files.json())['tasks.js'] as string;
  expect(tasksJs).toContain(
    "if (Utils.getField(report, 'danger_signs') !== 'vaginal_bleeding' && Utils.getField(report, 'danger_signs') !== 'severe_headache') { return false; }",
  );

  // Reopen: the same two OR-joined rows come back structured (not raw).
  await page.reload();
  await page.locator('.nav-item', { hasText: 'Tasks' }).click();
  const card2 = page.locator('.task-card').filter({ hasText: 'pregnancy-follow-up' }).first();
  const expand2 = card2.getByRole('button', { name: '▸' });
  if (await expand2.isVisible().catch(() => false)) await expand2.click();
  await card2
    .locator('.expr-field', { hasText: 'appliesIf' })
    .locator('button', { hasText: '✎ build' })
    .click();
  const modal2 = page.locator('.rule-builder-modal');
  await expect(modal2.locator('.rule-row')).toHaveCount(2);
  await expect(modal2.locator('select.connector-pill')).toHaveValue('or');
  await expect(modal2.getByText("couldn't be lifted")).toBeHidden();
});
