import { test as base, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Project path to open before each test. Defaults to the committed
 * `fixtures/mini-config` so a fresh clone runs the suite with no env
 * export. Override with `PLAYWRIGHT_PROJECT_PATH` to point at a real
 * cht-conf project (e.g. config-gandaki) when running against richer data.
 */
export const PROJECT_PATH =
  process.env.PLAYWRIGHT_PROJECT_PATH ?? path.resolve(here, 'fixtures', 'mini-config');

/**
 * Custom fixture that ensures the dev server has a project open before each
 * test. Hits the Fastify API directly so we don't have to drive the project
 * picker UI in every test.
 */
export const test = base.extend<{ projectOpen: void }>({
  projectOpen: [
    async ({ request }, use) => {
      // 127.0.0.1 (not `localhost`) so the request lands on the IPv4 socket
      // Fastify binds to; on Windows, Node resolves localhost → ::1 (IPv6)
      // and the dev server doesn't listen there.
      const res = await request.post('http://127.0.0.1:5174/api/project/open', {
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
