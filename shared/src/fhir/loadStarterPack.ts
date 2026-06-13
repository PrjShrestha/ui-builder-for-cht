/**
 * Node-only starter-pack loader.
 *
 * Uses `node:fs` and `import.meta.dirname` to find the bundled JSON pack
 * on disk. This file is intentionally NOT re-exported from
 * `shared/src/index.ts` because the client bundle would otherwise pull
 * `node:fs` through Vite's externalization proxy and throw at module-load
 * time (the destructuring `{ readFileSync }` itself accesses the proxy).
 *
 * Server-side and Node-runtime consumers import this directly:
 *   import { loadStarterPack } from '@cht-ui/shared/dist/fhir/loadStarterPack.js';
 * or via the relative path inside the shared workspace.
 *
 * Dual-path resolution handles both:
 *   1. Post-build with a future copy step (dist/fhir/starter-packs/<id>.json)
 *   2. Post-build without a copy step (../../src/fhir/starter-packs/<id>.json)
 * The src-relative fallback is the one that runs today because no copy step
 * is part of `pnpm --filter @cht-ui/shared build` yet; the dist-relative
 * candidate is checked first so a future copy step lands without code change.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StarterPack } from './types.js';

const BUNDLED_PACK_IDS: ReadonlyArray<string> = ['cht-mch-v1'];

export function loadStarterPack(id: string): StarterPack {
  if (!BUNDLED_PACK_IDS.includes(id)) {
    throw new Error(`Unknown starter pack id: ${id}`);
  }
  // import.meta.dirname resolves to the directory of the compiled .js file
  // (Node ≥ 20.11). At runtime this is .../shared/dist/fhir/.
  const here = import.meta.dirname;
  const candidates = [
    join(here, 'starter-packs', `${id}.json`),
    join(here, '..', '..', 'src', 'fhir', 'starter-packs', `${id}.json`),
  ];
  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, 'utf8');
      return JSON.parse(raw) as StarterPack;
    } catch {
      // Try next candidate.
    }
  }
  throw new Error(`Starter pack file not found for id: ${id}`);
}
