/**
 * Pure starter-pack operations — browser-safe.
 *
 * This file MUST NOT import any Node-only module (`node:fs`, `node:path`,
 * etc.) at the top level. The shared package's index.ts re-exports
 * everything here, so any top-level Node import would be evaluated when
 * Vite bundles `@cht-ui/shared` for the client — even though the client
 * never calls `loadStarterPack`. Vite externalizes `node:fs` and the
 * destructuring `{ readFileSync }` itself triggers the externalization
 * proxy.
 *
 * The Node-only loader lives in `./loadStarterPack.ts` and is NOT exported
 * from `shared/src/index.ts`. Server-side consumers (tests, the future V1
 * server route) import it via the deep path.
 *
 * `applyStarterPack` is pure: the caller supplies `appliedAt` (never
 * `Date.now()` inside this module). It never overwrites any existing
 * `questionMappings` entry — re-apply safety, MOH dealbreaker.
 */
import { encodeQuestionKey } from './key.js';
import type { FhirMapping, QuestionMapping, StarterPack } from './types.js';

export function applyStarterPack(
  mapping: FhirMapping,
  pack: StarterPack,
  appliedAt: string,
): FhirMapping {
  const next: Record<string, QuestionMapping> = { ...mapping.questionMappings };
  for (const concept of pack.concepts) {
    const key = encodeQuestionKey(pack.formId, concept.questionName);
    if (key in next) continue; // never overwrite — re-apply safety
    next[key] = {
      code: concept.code,
      system: concept.system,
      display: concept.display,
      source: 'starter-pack',
      dictionaryVersion: concept.dictionaryVersion,
      status: 'suggested',
      confirmedBy: null,
      confirmedAt: null,
      extras: {},
    };
  }
  return {
    schemaVersion: mapping.schemaVersion,
    starterPack: { id: pack.id, appliedAt },
    questionMappings: next,
    choiceMappings: mapping.choiceMappings,
    orphans: mapping.orphans,
    extras: mapping.extras,
  };
}
