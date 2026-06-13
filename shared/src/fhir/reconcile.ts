/**
 * Pure reconciliation: relocate any `questionMappings` entry whose key is no
 * longer live (because the underlying XLSForm row was renamed or deleted)
 * into `orphans[]`, with deterministic ordering so the serialized output is
 * byte-stable regardless of input `Record` insertion order.
 *
 * Caller contract — REQUIRED reading: `liveQuestionKeys` MUST be produced
 * by calling `encodeQuestionKey(formId, row.name)` from `./key.ts`.
 * String concatenation (`formId + '/' + row.name`) is FORBIDDEN — a name
 * containing `/` or `%` would produce a key that does not byte-match the
 * escaped on-disk key, and a confirmed still-live binding would be silently
 * relocated to `orphans[]` (a false-orphan data-loss bug). The V1 server
 * route inherits this contract.
 *
 * MVP stamps `reason: 'renamed-or-deleted'` because we have no diff context.
 * V1's route may refine to `'renamed' | 'deleted' | 'list-changed'`.
 */
import type { FhirMapping, OrphanEntry, QuestionMapping } from './types.js';

export function reconcileFhirMapping(
  mapping: FhirMapping,
  liveQuestionKeys: string[],
): FhirMapping {
  const live = new Set(liveQuestionKeys);
  const remaining: Record<string, QuestionMapping> = {};
  const newOrphans: OrphanEntry[] = [];

  for (const [key, entry] of Object.entries(mapping.questionMappings)) {
    if (live.has(key)) {
      remaining[key] = entry;
    } else {
      newOrphans.push({
        originalKey: key,
        code: entry.code,
        system: entry.system,
        display: entry.display,
        source: entry.source,
        dictionaryVersion: entry.dictionaryVersion,
        confirmedBy: entry.confirmedBy,
        confirmedAt: entry.confirmedAt,
        reason: 'renamed-or-deleted',
      });
    }
  }

  // Merge with any pre-existing orphans and sort deterministically.
  const allOrphans = [...mapping.orphans, ...newOrphans].sort(compareOrphans);

  return {
    schemaVersion: mapping.schemaVersion,
    starterPack: mapping.starterPack,
    questionMappings: remaining,
    choiceMappings: mapping.choiceMappings,
    orphans: allOrphans,
    extras: mapping.extras,
  };
}

function compareOrphans(a: OrphanEntry, b: OrphanEntry): number {
  if (a.originalKey !== b.originalKey) return a.originalKey < b.originalKey ? -1 : 1;
  if (a.system !== b.system) return a.system < b.system ? -1 : 1;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  return 0;
}
