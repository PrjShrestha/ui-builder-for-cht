/**
 * E2E coverage for the three bread-and-butter UAT editing flows on a survey
 * form — the ones a tester reaches for first and that, until now, had NO
 * automated coverage (only the condition-builder dropdown + helper builder
 * were tested):
 *
 *   1. Editing the choices of a select_multiple (the "danger signs" question)
 *      — add / rename label / remove an option, and confirm the edit syncs to
 *      another surface (the Translate tab reads the same store).
 *   2. Editing labels + translations — edit the default-language label inline,
 *      see it on the Translate tab, fill a missing `ne` translation, and watch
 *      the per-locale "missing" counter fall.
 *   3. Reordering questions with the dependency guard — a benign move goes
 *      through silently; a move that would hoist a row above a `${field}` it
 *      references raises the guard, and dismissing it leaves the order intact.
 *
 * Flows 1–3 are UI-level (no save) so they never mutate the committed
 * `mini-config` fixture. A fourth test exercises the project's NON-NEGOTIABLE
 * invariant — round-trip safety to disk — by editing, saving through the
 * SaveDiffModal, reloading, and asserting the edit survived a real
 * serialize → write → re-parse cycle. That one saves, so it operates on an
 * isolated temp copy of the fixture, never the committed one.
 *
 * Runs against the committed `client/tests/fixtures/mini-config` project by
 * default (no env export needed). The dev server must be up (`pnpm dev`).
 */
import { test, expect } from './setup.js';
import type { Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(here, 'fixtures', 'mini-config');

/** Open the committed fixture's pregnancy form and wait for the survey list. */
async function openPregnancy(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.nav-item', { hasText: 'Forms' }).click();
  await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();
  await expect(page.locator('.survey-row').first()).toBeVisible();
}

// All tests run in the editor's DEFAULT Simple mode. After the
// isHiddenInSimpleMode base-token fix, Simple mode shows exactly the four
// user-facing rows [lmp_date, lmp_note, danger_signs, gravidity] (the inputs/
// calculates + structural rows stay hidden). The danger-signs select being
// visible here is itself the end-to-end regression guard for that fix —
// before it, every select question was hidden in the default view.

/** A survey row discriminated by the raw type chip it renders (stable text). */
function rowByType(page: Page, rawType: RegExp) {
  return page
    .locator('.survey-row')
    .filter({ has: page.locator('code.type-chip-raw', { hasText: rawType }) });
}

/** Names of the visible survey rows, in DOM order (live input values). */
function visibleRowNames(page: Page): Promise<string[]> {
  return page
    .locator('.survey-row input.name-input')
    .evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value));
}

/* ===================== 1. Editing select_multiple choices ===================== */

test('choices — add, rename label, and remove options on the danger-signs multi-select', async ({
  page,
}) => {
  await openPregnancy(page);

  const dangerRow = rowByType(page, /^select_multiple danger_signs$/);
  await expect(dangerRow).toBeVisible();
  await dangerRow.getByRole('button', { name: /show advanced/ }).click();

  const choices = dangerRow.locator('.inline-choices');
  await expect(choices).toBeVisible();
  // Fixture ships three options.
  await expect(choices.locator('.inline-choice-row')).toHaveCount(3);

  // --- Rename an option's label (name stays, label changes) ---
  // Anchor on the stable `name` cell (severe_headache) — the label cell is
  // about to change, so filtering on it would stop matching after the edit.
  const headacheRow = choices
    .locator('.inline-choice-row')
    .filter({ has: page.locator('input[value="severe_headache"]') });
  await headacheRow.locator('input').nth(1).fill('Bad headache');
  await expect(headacheRow.locator('input').nth(0)).toHaveValue('severe_headache');
  await expect(headacheRow.locator('input').nth(1)).toHaveValue('Bad headache');

  // --- Add a new option ---
  await choices.getByRole('button', { name: '+ Add option' }).click();
  await expect(choices.locator('.inline-choice-row')).toHaveCount(4);
  const added = choices.locator('.inline-choice-row').last();
  await added.locator('input').nth(0).fill('convulsions');
  await added.locator('input').nth(1).fill('Convulsions');

  // --- Remove an existing option (confirms via window.confirm) ---
  page.once('dialog', (d) => {
    expect(d.message()).toContain('blurred_vision');
    void d.accept();
  });
  await choices
    .locator('.inline-choice-row')
    .filter({ has: page.locator('input[value="blurred_vision"]') })
    .getByRole('button', { name: 'remove' })
    .click();
  await expect(choices.locator('.inline-choice-row')).toHaveCount(3);

  // --- The edit is in the shared store, so another surface (Translate tab,
  //     Choices scope) sees the added option and the removal. ---
  await page.getByRole('button', { name: 'Translate' }).click();
  await page.locator('.translate-tab').getByRole('button', { name: /^Choices \(/ }).click();
  await expect(page.getByText('convulsions', { exact: true })).toHaveCount(1);
  await expect(page.getByText('blurred_vision', { exact: true })).toHaveCount(0);
});

/* ===================== 2. Editing labels + translations ===================== */

test('labels — inline edit propagates to the Translate tab; filling a missing translation lowers the count', async ({
  page,
}) => {
  await openPregnancy(page);

  // Edit the default-language (en) label of lmp_date inline on its row.
  const lmpRow = rowByType(page, /^date$/);
  const enField = lmpRow
    .locator('.label-row')
    .filter({ has: page.getByText('label::en', { exact: true }) })
    .locator('input');
  await enField.fill('LMP date');

  // The Translate tab is a second view onto the same labels — it must reflect
  // the inline edit, and report `ne` as having 2 missing (gravidity, lmp_note).
  await page.getByRole('button', { name: 'Translate' }).click();
  await expect(page.locator('.translate-tab').getByText('ne: 2 missing')).toBeVisible();

  const lmpTranslateRow = page
    .locator('.translate-grid tr')
    .filter({ has: page.getByText('lmp_date', { exact: true }) });
  await expect(lmpTranslateRow.locator('textarea').nth(0)).toHaveValue('LMP date');

  // Fill the missing Nepali translation for gravidity → missing count drops.
  const gravidityRow = page
    .locator('.translate-grid tr')
    .filter({ has: page.getByText('gravidity', { exact: true }) });
  await gravidityRow.locator('textarea').nth(1).fill('गर्भधारण');
  await expect(page.locator('.translate-tab').getByText('ne: 1 missing')).toBeVisible();
});

/* ===================== 3. Reorder with the dependency guard ===================== */

test('reorder — a move with no broken references goes through without a prompt', async ({
  page,
}) => {
  await openPregnancy(page);
  expect(await visibleRowNames(page)).toEqual([
    'lmp_date',
    'lmp_note',
    'danger_signs',
    'gravidity',
  ]);

  // danger_signs references nothing; moving it up (swap with lmp_note, which
  // still sits below its `${lmp_date}` reference) breaks no dependency.
  await rowByType(page, /^select_multiple danger_signs$/)
    .getByRole('button', { name: 'move up' })
    .click();

  expect(await visibleRowNames(page)).toEqual([
    'lmp_date',
    'danger_signs',
    'lmp_note',
    'gravidity',
  ]);
});

test('reorder — the guard fires and blocks a move that would break a ${field} reference', async ({
  page,
}) => {
  await openPregnancy(page);

  // lmp_note has `relevant = ${lmp_date} != ''`. Moving it up swaps it above
  // lmp_date — the guard must warn and, on dismiss, leave the order untouched.
  let warned = '';
  page.once('dialog', (d) => {
    warned = d.message();
    void d.dismiss();
  });
  await rowByType(page, /^note$/).getByRole('button', { name: 'move up' }).click();

  await expect.poll(() => warned).toContain('lmp_date');
  // Order unchanged — dismissing the guard cancels the move.
  expect(await visibleRowNames(page)).toEqual([
    'lmp_date',
    'lmp_note',
    'danger_signs',
    'gravidity',
  ]);
});

test('reorder — the guard is overridable: accepting the warning performs the move', async ({
  page,
}) => {
  await openPregnancy(page);

  page.once('dialog', (d) => void d.accept());
  await rowByType(page, /^note$/).getByRole('button', { name: 'move up' }).click();

  // lmp_note is now above lmp_date — the guard warns but never hard-blocks.
  expect(await visibleRowNames(page)).toEqual([
    'lmp_note',
    'lmp_date',
    'danger_signs',
    'gravidity',
  ]);
});

/* ===================== 4. Round-trip safety to disk ===================== */

test('round-trip — an edit survives save → reload → re-parse on an isolated project copy', async ({
  page,
  request,
}) => {
  // Copy the fixture so the save writes to a throwaway project, never the
  // committed one. Round-trip safety is the repo's non-negotiable invariant,
  // so this is the test that actually exercises serialize → write → re-parse.
  const tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), 'cht-ui-e2e-'));
  try {
    await fs.cp(FIXTURE_DIR, tmpProject, { recursive: true });

    // 127.0.0.1 (not `localhost`) — see client/tests/setup.ts for the IPv4
    // vs ::1 rationale on Windows.
    const opened = await request.post('http://127.0.0.1:5174/api/project/open', {
      data: { path: tmpProject },
    });
    expect(opened.ok()).toBeTruthy();

    // Open the form from the temp project and make one durable edit.
    await page.goto('/');
    // Guard: confirm the UI really switched to the temp project BEFORE any
    // save can fire. The server saves to whichever project is open, so this
    // is what guarantees a save can never land on the committed fixture.
    await expect(page.getByText(path.basename(tmpProject)).first()).toBeVisible();
    await page.locator('.nav-item', { hasText: 'Forms' }).click();
    await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();
    await expect(page.locator('.survey-row').first()).toBeVisible();

    const dangerRow = rowByType(page, /^select_multiple danger_signs$/);
    await dangerRow.getByRole('button', { name: /show advanced/ }).click();
    const choices = dangerRow.locator('.inline-choices');
    await choices.getByRole('button', { name: '+ Add option' }).click();
    const added = choices.locator('.inline-choice-row').last();
    await added.locator('input').nth(0).fill('convulsions');
    await added.locator('input').nth(1).fill('Convulsions');

    // Save through the confirm-diff modal.
    await page.locator('.page-header').getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('.rule-builder-card').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.locator('.page-header').getByRole('button', { name: 'Saved', exact: true }),
    ).toBeVisible();

    // Reload from scratch — the server re-parses the .xlsx from disk, so this
    // proves the edit round-tripped through serialize → write → parse.
    await page.goto('/');
    await page.locator('.nav-item', { hasText: 'Forms' }).click();
    await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();
    await expect(page.locator('.survey-row').first()).toBeVisible();

    const reloadedDanger = rowByType(page, /^select_multiple danger_signs$/);
    await reloadedDanger.getByRole('button', { name: /show advanced/ }).click();
    const reloadedChoices = reloadedDanger.locator('.inline-choices');
    await expect(
      reloadedChoices.locator('.inline-choice-row').filter({
        has: page.locator('input[value="convulsions"]'),
      }),
    ).toHaveCount(1);
    // Untouched options are still there — the save didn't drop siblings.
    await expect(reloadedChoices.locator('.inline-choice-row')).toHaveCount(4);
  } finally {
    await fs.rm(tmpProject, { recursive: true, force: true });
  }
});
