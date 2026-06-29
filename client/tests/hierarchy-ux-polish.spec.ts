/**
 * E2E for DEV-HANDOFF #4 — Hierarchy-editor UX polish (4 items).
 * Spec: `docs/handoff-hierarchy-ux-2026-06-28.md`.
 *
 * Three checks (one per blockable regression risk):
 *   §1  — "+ Add type" button lives in the tree-pane header (not the page
 *         header).
 *   §2  — "+ Add type" modal accepts a FRIENDLY NAME, shows the derived
 *         id as a muted note, and commits with the slugified id —
 *         "Fchv Person" no longer dead-ends on "invalid id".
 *   §3  — the tree pane splits into "People (n)" and "Places (n)"
 *         sections; person types appear in the People list, NOT the
 *         indented Places tree.
 *   §4  — the Person/Place control is a radio (not a checkbox), and
 *         "Track visits on this place's profile" is hidden when the
 *         selected type is a person.
 */
import { test, expect } from './setup.js';
import type { Page, APIRequestContext } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(here, 'fixtures', 'mini-config');

async function openHierarchy(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cht-ui-e2e-hux-'));
  await fs.cp(FIXTURE_DIR, tmp, { recursive: true });
  const opened = await request.post('http://127.0.0.1:5174/api/project/open', {
    data: { path: tmp },
  });
  expect(opened.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.getByText(path.basename(tmp)).first()).toBeVisible();
  await page.locator('.nav-item', { hasText: 'Hierarchy' }).click();
  await expect(page.locator('.tree-pane')).toBeVisible();
  return tmp;
}

test('#4-§1 — "+ Add type" lives in the tree pane header, not the page header', async ({
  page,
  request,
}) => {
  const tmp = await openHierarchy(page, request);
  try {
    const treePaneHeader = page.locator('.tree-pane-header');
    await expect(treePaneHeader.getByRole('button', { name: '+ Add type' })).toBeVisible();
    // The page header keeps Generate / Undo / Redo / Save — NOT "+ Type".
    const pageHeader = page.locator('.page-header');
    await expect(pageHeader.getByRole('button', { name: /^\+ (Type|Add type)$/ })).toHaveCount(0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('#4-§2 — Add-type modal slugifies a friendly name and commits with the derived id', async ({
  page,
  request,
}) => {
  const tmp = await openHierarchy(page, request);
  try {
    await page
      .locator('.tree-pane-header')
      .getByRole('button', { name: '+ Add type' })
      .click();
    const modal = page.locator('[aria-label="Add contact type"]');
    await expect(modal).toBeVisible();

    // Type a friendly name that the OLD form rejected as "invalid id".
    await modal.locator('input').first().fill('Fchv Person');

    // The derived id surfaces in the muted note.
    await expect(modal.getByText(/saved as/)).toContainText('fchv_person');

    // Pick Person via the new radio. Then commit.
    await modal.locator('input[type=radio]').nth(1).check();
    await modal.getByRole('button', { name: 'Add type' }).click();
    await expect(modal).not.toBeVisible();

    // The new type lands in the unified tree under its derived id.
    await expect(
      page.locator('.tree-pane .tree-row .tree-id', { hasText: 'fchv_person' }),
    ).toBeVisible();
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('#4-§3 — unified tree: persons nest under their parent place; person-children list first', async ({
  page,
  request,
}) => {
  const tmp = await openHierarchy(page, request);
  try {
    // mini-config: district_hospital → health_center → clinic +
    // person parented under district_hospital (parents[0]). buildTree
    // therefore nests `person` as a CHILD of `district_hospital`, NOT
    // as a top-level row. Confirm via the indented <ul> shape.
    const tree = page.locator('.tree-pane .tree').first();
    await expect(tree).toBeVisible();

    // The person row exists once, somewhere in the tree.
    const personRow = tree
      .locator('.tree-row')
      .filter({ has: page.locator('.tree-id', { hasText: /^person$/ }) });
    await expect(personRow).toHaveCount(1);

    // It is NOT a top-level <li> — it must live inside a nested <ul>
    // (the second-level list under district_hospital).
    await expect(tree.locator('> li > ul .tree-row .tree-id', { hasText: /^person$/ }))
      .toHaveCount(1);

    // Sibling order: under district_hospital, the person child must
    // appear BEFORE the place child (health_center). Walk the children
    // <ul> in order; first row should be person.
    const districtChildren = tree.locator('> li > ul > li > .tree-row .tree-id');
    await expect(districtChildren.first()).toHaveText('person');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('#4-§4 — selecting a person hides "Track visits on this place\'s profile"', async ({
  page,
  request,
}) => {
  const tmp = await openHierarchy(page, request);
  try {
    // Click into the existing `person` type — anywhere in the unified tree.
    await page
      .locator('.tree-pane .tree-row')
      .filter({ has: page.locator('.tree-id', { hasText: /^person$/ }) })
      .click();
    const detail = page.locator('.detail-pane');
    await expect(detail.getByText('Type kind')).toBeVisible();
    await expect(detail.locator('input[type=radio]').nth(1)).toBeChecked(); // Person
    // count_visits must be hidden on persons.
    await expect(detail.getByText(/Track visits/)).toHaveCount(0);

    // Switch to a place — count_visits surfaces again.
    await page
      .locator('.tree-pane .tree-row')
      .filter({ has: page.locator('.tree-id', { hasText: /^clinic$/ }) })
      .click();
    await expect(detail.locator('input[type=radio]').nth(0)).toBeChecked(); // Place
    await expect(detail.getByText(/Track visits/)).toBeVisible();
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
