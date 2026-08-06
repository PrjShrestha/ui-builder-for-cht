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
  //
  // Anchored on `chair_rise`, a SINGLE-select: `=` against a
  // select_multiple is semantically wrong (the stored value is a
  // space-separated list, so equality is false the moment a second option
  // is ticked), and the earlier version of this test pinned exactly that
  // wrong shape against `danger_signs`. Multi-selects need the "any of"
  // operator instead — docs/NEXT.md items 2 + 4.
  for (const choice of ['fail', 'pass']) {
    // `exact` matters: item 4 added a sibling "+ report field includes
    // option" button, which makes a substring match ambiguous.
    await modal.getByRole('button', { name: '+ report field', exact: true }).click();
    const row = modal.locator('.rule-row').last();
    await row.locator('select.field-picker').selectOption('chair_rise');
    const valueSelect = row.locator('select.choice-value-select');
    await expect(valueSelect).toBeVisible();
    await valueSelect.selectOption(choice);
  }

  // Label shown, NAME stored — the fixture's labels differ from its names.
  await expect(modal.locator('.rule-row').last().locator('select.choice-value-select')).toContainText(
    'Pass (pass)',
  );

  // §3 — flip the connector between the two new rows to OR.
  await modal.locator('select.connector-pill').last().selectOption('or');

  // The emitted guard is ¬(A ∨ B): inverted comparisons joined with `&&`.
  await expect(modal.locator('.preview pre')).toContainText(
    "if (Utils.getField(report, 'chair_rise') !== 'fail' && Utils.getField(report, 'chair_rise') !== 'pass') { return false; }",
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
    "if (Utils.getField(report, 'chair_rise') !== 'fail' && Utils.getField(report, 'chair_rise') !== 'pass') { return false; }",
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

test('§4 appliesIf builder — a multi-select field switches to "includes" and emits the split guard', async ({
  page,
  request,
}) => {
  // docs/NEXT.md item 4 / Task R8, the geriatric spec's only hard GAP:
  // "fires when ANY of these options is ticked". Equality against a
  // select_multiple is silently wrong (the answer is a space-separated
  // list), so picking one must switch the row to the includes kind and the
  // comparison operators must not be offered at all.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cht-ui-geri-includes-'));
  await fs.cp(PROJECT_PATH, tmp, { recursive: true });
  expect(
    (await request.post('http://127.0.0.1:5174/api/project/open', { data: { path: tmp } })).ok(),
  ).toBeTruthy();

  await page.goto('/');
  await page.locator('.nav-item', { hasText: 'Tasks' }).click();
  const card = page.locator('.task-card').filter({ hasText: 'pregnancy-follow-up' }).first();
  const expand = card.getByRole('button', { name: '▸' });
  if (await expand.isVisible().catch(() => false)) await expand.click();
  await card
    .locator('.expr-field', { hasText: 'appliesIf' })
    .locator('button', { hasText: '✎ build' })
    .click();
  const modal = page.locator('.rule-builder-modal');
  await expect(modal).toBeVisible();

  // Add an ordinary comparison row, then point it at the MULTI-select.
  await modal.getByRole('button', { name: '+ report field', exact: true }).click();
  const row = modal.locator('.rule-row').last();
  await row.locator('select.field-picker').selectOption('danger_signs');

  // The row auto-switched to "includes option" …
  const opSelect = row.locator('select').filter({ hasText: 'includes option' });
  await expect(opSelect).toHaveValue('includes');
  // … and the wrong-for-multi comparison operators are gone entirely.
  await expect(opSelect).not.toContainText('=');

  // Value still comes from the real choice list — zero typing.
  const valueSelect = row.locator('select.choice-value-select');
  await expect(valueSelect).toBeVisible();
  await valueSelect.selectOption('vaginal_bleeding');

  // The emitted guard is the space-split membership test, negated.
  await expect(modal.locator('.preview pre')).toContainText(
    "if (!(Utils.getField(report, 'danger_signs') || '').split(' ').includes('vaginal_bleeding')) { return false; }",
  );

  await modal.getByRole('button', { name: 'Save' }).click();
  await expect(modal).toBeHidden();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  const tasksJs = (await (await request.get('http://127.0.0.1:5174/api/tasks/files')).json())[
    'tasks.js'
  ] as string;
  expect(tasksJs).toContain(
    "(Utils.getField(report, 'danger_signs') || '').split(' ').includes('vaginal_bleeding')",
  );

  // Reopen: comes back as a structured row, not raw.
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
  await expect(modal2.locator('select.choice-value-select')).toHaveValue('vaginal_bleeding');
  await expect(modal2.getByText("couldn't be lifted")).toBeHidden();
});
