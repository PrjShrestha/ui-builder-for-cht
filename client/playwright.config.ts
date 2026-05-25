import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for ui-builder-for-cht smoke tests.
 *
 * Tests target the running dev server at http://localhost:5173 (proxied to
 * Fastify on :5174). They do not start the dev server themselves — run
 * `pnpm dev` from the repo root first.
 *
 * Tests assume a project is loaded; setup.ts ensures one via the API.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    actionTimeout: 5_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
