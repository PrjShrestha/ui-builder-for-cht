import { test as base, expect } from '@playwright/test';

/**
 * Project path to open before each test. Override with PLAYWRIGHT_PROJECT_PATH
 * if your CHT config lives elsewhere.
 */
export const PROJECT_PATH =
  process.env.PLAYWRIGHT_PROJECT_PATH ?? 'W:\\ui-builder-for-cht\\config-gandaki\\cht-config';

/**
 * Custom fixture that ensures the dev server has a project open before each
 * test. Hits the Fastify API directly so we don't have to drive the project
 * picker UI in every test.
 */
export const test = base.extend<{ projectOpen: void }>({
  projectOpen: [
    async ({ request }, use) => {
      const res = await request.post('http://localhost:5174/api/project/open', {
        data: { path: PROJECT_PATH },
      });
      if (!res.ok()) {
        throw new Error(
          `Failed to open project at ${PROJECT_PATH}: ${res.status()} ${await res.text()}`,
        );
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
