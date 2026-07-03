/**
 * DEMO recording (not a CI test) — the live ANC reminder loop on the deployed
 * CHT instance, as the CHW sees it. Read-only walkthrough (no form submit, so
 * no Enketo-submit wall): login → patient record → the due ANC visit task →
 * the task launches the (task-only) pregnancy_visit form with the patient
 * pre-filled.
 *
 * Records a watchable video at 1500 ms/action.
 *   pnpm --filter @cht-ui/client exec playwright test cht-anc-demo.spec.ts
 *   # video: client\test-results\cht-anc-demo-…\video.webm
 *
 * Requires the seeded data + fixed schedule already live on the instance
 * (Sita Sharma + pregnancy_registration + the getField('lmp_date') anchor).
 */
import { test, expect } from '@playwright/test';

const BASE = 'https://127-0-0-1.local-ip.medicmobile.org:10445';
const CHW = { user: 'kamala_chw', pass: 'Anc7Health!2026' };
const SITA = '54556087-4614-421c-965d-94c43457aafb';

test.use({
  baseURL: BASE,
  ignoreHTTPSErrors: true,
  video: 'on',
  viewport: { width: 1366, height: 1400 },
  launchOptions: { slowMo: 1500 }, // 1.5s between actions so the clip is watchable
});

test('CHW reminder loop — due ANC visit task launches the visit form', async ({ page }) => {
  test.setTimeout(240_000);

  // 1. Log in as the CHW.
  await page.goto(`${BASE}/`);
  await page.getByRole('textbox', { name: 'User name' }).fill(CHW.user);
  await page.getByRole('textbox', { name: 'Password' }).fill(CHW.pass);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('link', { name: /Tasks/ })).toBeVisible({ timeout: 60_000 });

  // 2. Sita's record — patient under the full ANC hierarchy, with her reports.
  await page.goto(`${BASE}/#/contacts/${SITA}`);
  await expect(page.getByRole('heading', { name: 'Sita Sharma' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'pregnancy_registration' })).toBeVisible();

  // 3. The Tasks list — the 12-week ANC visit, due today (rules engine may take
  //    a moment to compute for the offline CHW).
  await page.goto(`${BASE}/#/tasks`);
  const task = page.getByRole('link', { name: /Sita Sharma.*Due/ });
  await expect(task).toBeVisible({ timeout: 90_000 });

  // 4. Tap the task → it launches the task-only pregnancy_visit form with the
  //    patient already selected.
  await task.click();
  await expect(page.getByRole('heading', { name: 'pregnancy_visit' })).toBeVisible({ timeout: 30_000 });
  // Linger a beat so the final frame is clearly captured.
  await page.waitForTimeout(2000);
});
