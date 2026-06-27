/**
 * E2E for the Quick Hierarchy Creator (docs/plans/quick-hierarchy-creator.md).
 *
 * Spawns a throwaway "empty" project (mini-config minus contact_types /
 * place-types.json) so the empty-state CTA actually surfaces, then walks
 * the golden path end-to-end and verifies the round-trip:
 *
 *   1. Empty hierarchy → CTA is shown, "+ Type" still works alongside.
 *   2. Click Quick start → modal pre-seeded with District / Health
 *      facility / Person.
 *   3. Set up my hierarchy → success stage offers Generate forms / Skip.
 *   4. Skip for now → modal closes, tree now shows 3 types.
 *   5. Reload from disk → re-parsed contact_types match (round-trip).
 *
 * Plus a cancel-with-data confirm test (plan §8: writes nothing until
 * the final commit).
 */
import { test, expect } from './setup.js';
import type { Page, APIRequestContext } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(here, 'fixtures', 'mini-config');

/** Copy mini-config to a temp dir, then wipe the hierarchy so the
 *  empty-state CTA is the right surface to test. */
async function openEmptyTempProject(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  const tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), 'cht-ui-e2e-qhc-'));
  await fs.cp(FIXTURE_DIR, tmpProject, { recursive: true });

  // Wipe contact_types + place_hierarchy_types out of base_settings.json,
  // and clear place-types.json. Everything else (locales, etc) stays.
  const settingsPath = path.join(tmpProject, 'app_settings', 'base_settings.json');
  const settingsRaw = await fs.readFile(settingsPath, 'utf8');
  const settings = JSON.parse(settingsRaw);
  settings.contact_types = [];
  settings.place_hierarchy_types = [];
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

  const placeTypesPath = path.join(tmpProject, 'forms', 'contact', 'place-types.json');
  try {
    await fs.writeFile(placeTypesPath, JSON.stringify({}, null, 2));
  } catch {
    /* file may not exist on a fresh fixture; ignore */
  }

  const opened = await request.post('http://127.0.0.1:5174/api/project/open', {
    data: { path: tmpProject },
  });
  expect(opened.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.getByText(path.basename(tmpProject)).first()).toBeVisible();
  await page.locator('.nav-item', { hasText: 'Hierarchy' }).click();
  return tmpProject;
}

test('QHC golden path — empty project → CTA → wizard → Skip → tree shows new types', async ({
  page,
  request,
}) => {
  const tmp = await openEmptyTempProject(page, request);
  try {
    // 1. Empty-state CTA is the right surface.
    await expect(page.locator('.qhc-empty-cta')).toBeVisible();
    await expect(page.locator('.qhc-empty-cta h4')).toContainText('No contact types yet');

    // 2. Quick start → modal pre-seeded.
    await page.locator('.qhc-empty-cta').getByRole('button', { name: 'Quick start' }).click();
    const modal = page.locator('.qhc-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.qhc-rows li').nth(0).locator('input').first()).toHaveValue('District');
    await expect(modal.locator('.qhc-rows li').nth(1).locator('input').first()).toHaveValue('Health facility');
    await expect(modal.locator('.qhc-person-card input').first()).toHaveValue('Person');

    // 3. Commit.
    await modal.getByRole('button', { name: 'Set up my hierarchy' }).click();

    // 4. Success stage offers both actions; Skip for now closes cleanly.
    await expect(modal.getByText(/Your hierarchy is saved/)).toBeVisible();
    await modal.getByRole('button', { name: 'Skip for now' }).click();
    await expect(modal).not.toBeVisible();

    // 5. Tree now lists the three new types.
    const tree = page.locator('.tree-pane');
    await expect(tree.locator('.tree-row')).toHaveCount(3);
    await expect(tree).toContainText('district');
    await expect(tree).toContainText('health_facility');
    await expect(tree).toContainText('person');

    // 6. Round-trip: full reload re-parses the saved files; tree still has them.
    await page.goto('/');
    await page.locator('.nav-item', { hasText: 'Hierarchy' }).click();
    const tree2 = page.locator('.tree-pane');
    await expect(tree2.locator('.tree-row')).toHaveCount(3);
    await expect(tree2).toContainText('district');
    await expect(tree2).toContainText('health_facility');
    await expect(tree2).toContainText('person');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('QHC cancel-with-data → confirm dialog; nothing written if dismissed', async ({
  page,
  request,
}) => {
  const tmp = await openEmptyTempProject(page, request);
  try {
    await page.locator('.qhc-empty-cta').getByRole('button', { name: 'Quick start' }).click();
    const modal = page.locator('.qhc-modal');
    await expect(modal).toBeVisible();

    // Type something so the unsaved-data confirm fires.
    await modal.locator('.qhc-rows li').nth(0).locator('input').first().fill('Province');

    // The native window.confirm has to be approved BEFORE the click — wire a handler.
    let confirmText: string | null = null;
    page.once('dialog', (d) => {
      confirmText = d.message();
      void d.dismiss(); // dismissed = user clicked Cancel on the confirm
    });
    await modal.getByRole('button', { name: 'Cancel' }).click();
    expect(confirmText).toContain('Discard');
    // Modal stays open because the user dismissed the confirm.
    await expect(modal).toBeVisible();

    // Now actually close — accept the confirm.
    page.once('dialog', (d) => void d.accept());
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).not.toBeVisible();

    // Confirm nothing was written.
    const settingsRaw = await fs.readFile(
      path.join(tmp, 'app_settings', 'base_settings.json'),
      'utf8',
    );
    const settings = JSON.parse(settingsRaw);
    expect(settings.contact_types).toEqual([]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
