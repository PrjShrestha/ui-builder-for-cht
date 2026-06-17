/**
 * DEMO walkthrough — drives the survey editor through the five core authoring
 * actions, in order, as one continuous, watchable flow. Doubles as a real e2e
 * regression (it runs headless in CI) and a live demo (headed + slow locally).
 *
 *   1. Open a form
 *   2. Edit a question's name + label, and a translation
 *   3. Add choices to a select question
 *   4. Add a new question
 *   5. Move a question up and down
 *
 * It is UI-only (no Save), so it never mutates the committed `mini-config`
 * fixture — safe to run repeatedly. (To also demo round-trip-to-disk, see the
 * save→reload test in form-editing.spec.ts.)
 *
 * ── Run it as a DEMO (headed + slow, so you can watch each step) ────────────
 *   # one-time: build the non-client workspaces the dev server serves
 *   pnpm --filter @cht-ui/shared build && pnpm --filter @cht-ui/server build
 *   # then (Playwright auto-boots the servers, or reuses a running `pnpm dev`):
 *   pnpm --filter @cht-ui/client exec playwright test demo.spec.ts --headed
 *
 *   • Step-through (pause on each action):  add  --debug   (opens the Inspector)
 *   • Record a video to share:             add  --trace on   then
 *     pnpm --filter @cht-ui/client exec playwright show-trace
 *   • Slower/faster: change SLOW_MS below.
 *
 * ── Run it as a TEST (headless, fast) ──────────────────────────────────────
 *   pnpm --filter @cht-ui/client test:e2e        (or with CI=1)
 */
import { test, expect, PROJECT_PATH } from './setup.js';
import type { Page } from '@playwright/test';

// `DEMO=1` → headed + slow so you can watch each step (the live-demo mode).
// Unset → headless + fast, so the same file also runs as a normal e2e test.
const SLOW_MS = 700;
test.use({
  headless: !process.env.DEMO,
  launchOptions: { slowMo: process.env.DEMO ? SLOW_MS : 0 },
});

/** A survey row located by the raw type chip it renders (stable text). */
function rowByType(page: Page, rawType: RegExp) {
  return page
    .locator('.survey-row')
    .filter({ has: page.locator('code.type-chip-raw', { hasText: rawType }) });
}

/** A survey row located by its technical `name` (stable across label edits). */
function rowByName(page: Page, name: string) {
  return page
    .locator('.survey-row')
    .filter({ has: page.locator(`input.name-input[value="${name}"]`) });
}

/** Visible survey row names, in DOM order. */
function visibleRowNames(page: Page): Promise<string[]> {
  return page
    .locator('.survey-row input.name-input')
    .evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value));
}

test('demo — the five core survey-authoring actions, end to end', async ({ page }) => {
  // ── 1. Open the form ──────────────────────────────────────────────────────
  await test.step('1. Open the project, then the pregnancy form', async () => {
    await page.goto('/');
    // A fresh browser lands on the project picker; open the fixture project
    // through the UI. (If a project is already open, the picker won't appear
    // and we skip straight to the form.)
    const pathInput = page.getByRole('textbox', { name: /Project folder/i });
    try {
      await pathInput.waitFor({ state: 'visible', timeout: 4000 });
      await pathInput.fill(PROJECT_PATH);
      await page.getByRole('button', { name: 'Open' }).click();
    } catch {
      /* project already open — fall through to the sidebar */
    }
    await page.locator('.nav-item', { hasText: 'Forms' }).click();
    await page.getByRole('button', { name: 'pregnancy.xlsx' }).click();
    await expect(page.locator('.survey-row').first()).toBeVisible();
  });

  // ── 2. Edit a question's label + technical name ───────────────────────────
  await test.step('2a. Rename a question label (the user-facing title)', async () => {
    const lmpRow = rowByType(page, /^date$/);
    const enLabel = lmpRow
      .locator('.label-row')
      .filter({ has: page.getByText('label::en', { exact: true }) })
      .locator('input');
    await enLabel.fill('Last menstrual period');
    await expect(enLabel).toHaveValue('Last menstrual period');
  });

  await test.step('2b. Rename a question’s technical name (a leaf nothing references)', async () => {
    // `gravidity` is referenced by no other row, so renaming it is safe.
    await rowByName(page, 'gravidity').locator('input.name-input').fill('gravida');
    await expect(page.locator('.survey-row input.name-input[value="gravida"]')).toBeVisible();
  });

  // ── 3. Add choices to the danger-signs multi-select ───────────────────────
  await test.step('3. Add a choice to the danger-signs select', async () => {
    const dangerRow = rowByType(page, /^select_multiple danger_signs$/);
    await dangerRow.getByRole('button', { name: /show advanced/ }).click();
    const choices = dangerRow.locator('.inline-choices');
    await expect(choices).toBeVisible();
    const before = await choices.locator('.inline-choice-row').count();
    await choices.getByRole('button', { name: '+ Add option' }).click();
    const added = choices.locator('.inline-choice-row').last();
    await added.locator('input').nth(0).fill('convulsions'); // option name
    await added.locator('input').nth(1).fill('Convulsions'); // option label
    await expect(choices.locator('.inline-choice-row')).toHaveCount(before + 1);
  });

  // ── 4. Add a new question ─────────────────────────────────────────────────
  await test.step('4. Add a new "temperature" Number question', async () => {
    await page.getByRole('button', { name: '+ Question' }).click();
    const picker = page.locator('.qtype-modal');
    await expect(picker).toBeVisible();
    // Name it first — single-clicking a list-free tile auto-commits (Kobo parity).
    await picker
      .locator('input[placeholder*="has_fever"], input[placeholder*="patient_age"]')
      .first()
      .fill('temperature');
    await picker
      .locator('.qtype-tile')
      .filter({ has: page.locator('.qtype-tile-label', { hasText: /^Number$/ }) })
      .click();
    await expect(picker).not.toBeVisible();
    await expect(page.locator('.survey-row input.name-input[value="temperature"]')).toBeVisible();
  });

  // ── 5. Move a question up, then back down ─────────────────────────────────
  await test.step('5. Move danger_signs up, then down', async () => {
    expect(await visibleRowNames(page)).toEqual([
      'lmp_date',
      'lmp_note',
      'danger_signs',
      'gravida',
      'temperature',
    ]);

    // Benign move (danger_signs references nothing) — no dependency guard fires.
    // `.first()` targets the ROW header's move button (the open choices panel
    // adds per-option move buttons that would otherwise make this ambiguous).
    await rowByType(page, /^select_multiple danger_signs$/)
      .getByRole('button', { name: 'move up' })
      .first()
      .click();
    expect(await visibleRowNames(page)).toEqual([
      'lmp_date',
      'danger_signs',
      'lmp_note',
      'gravida',
      'temperature',
    ]);

    // Move it back down to where it started.
    await rowByType(page, /^select_multiple danger_signs$/)
      .getByRole('button', { name: 'move down' })
      .first()
      .click();
    expect(await visibleRowNames(page)).toEqual([
      'lmp_date',
      'lmp_note',
      'danger_signs',
      'gravida',
      'temperature',
    ]);
  });

  // ── (bonus) translation — done last so we never have to switch tabs back ───
  await test.step('6. Fill a Nepali translation on the Translate tab', async () => {
    await page.getByRole('button', { name: 'Translate' }).click();
    const noteTranslateRow = page
      .locator('.translate-grid tr')
      .filter({ has: page.getByText('lmp_note', { exact: true }) });
    await noteTranslateRow.locator('textarea').nth(1).fill('अन्तिम महिनावारीको टिप्पणी');
    await expect(noteTranslateRow.locator('textarea').nth(1)).toHaveValue(
      'अन्तिम महिनावारीको टिप्पणी',
    );
  });
});
