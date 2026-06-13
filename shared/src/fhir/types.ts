/**
 * Public types for the Standard codes (FHIR / terminology mapping) module.
 *
 * The sidecar shape is owned by this tool and lives at the project root in
 * `fhir-mapping.json`. The parser/serializer treat unknown JSON fields as
 * preservable `extras` (top-level and per-entry) — same discipline as
 * XLSForm `extras` columns, so a future schema version is forward-compatible
 * with older builders.
 */

export type MappingStatus = 'suggested' | 'confirmed' | 'skipped' | 'orphaned';

/**
 * `online:${string}` is RESERVED-BUT-UNREACHABLE in MVP: no network producer
 * ships in this slice. Emitting it requires the V1 contract-test gate
 * (recorded fixtures + circuit breaker) before any fetch may produce it.
 */
export type MappingSource = 'starter-pack' | 'manual' | `online:${string}`;

export interface QuestionMapping {
  /** Required. The terminology code (e.g. "8665-2"). */
  code: string;
  /** Required. The code system URI (e.g. "http://loinc.org"). */
  system: string;
  /** Required. Human-readable clinical name from the source system. */
  display: string;
  /** Required. Where the code came from. */
  source: MappingSource;
  /** Required. e.g. "LOINC-2.82" — pins the dictionary release. */
  dictionaryVersion: string;
  /** Required. Workflow state for this entry. */
  status: MappingStatus;
  /** Required. Reviewer identity, or null if not yet blessed. */
  confirmedBy: string | null;
  /** Required. ISO timestamp of sign-off, or null if not yet blessed. */
  confirmedAt: string | null;
  /**
   * Reserved for V1 "suggest-a-code" fuzzy match. JSON.parse canonicalizes
   * numeric literals (e.g. `0.10` → `0.1`); this is the intentional frozen
   * contract — see plan §3.
   */
  confidence?: number;
  /** Reserved for V1 separate clinical-reviewer trail. */
  clinicalReview?: { reviewer: string; reviewedAt: string };
  /** Unknown per-entry keys, preserved verbatim. Includes null/0/false/"". */
  extras: Record<string, unknown>;
}

/**
 * Mirrors QuestionMapping. Reserved for V1 — MVP always emits
 * `choiceMappings: {}` but the format is frozen now so V1's
 * (formId, list_name, choice.name) 3-tuple needs no migration.
 */
export interface ChoiceMapping {
  code: string;
  system: string;
  display: string;
  source: MappingSource;
  dictionaryVersion: string;
  status: MappingStatus;
  confirmedBy: string | null;
  confirmedAt: string | null;
  confidence?: number;
  clinicalReview?: { reviewer: string; reviewedAt: string };
  extras: Record<string, unknown>;
}

export interface OrphanEntry {
  /** Codec-encoded key as it appeared in `questionMappings` at relocate time. */
  originalKey: string;
  code: string;
  system: string;
  display: string;
  source: MappingSource;
  dictionaryVersion: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  /**
   * MVP cannot distinguish rename from delete without diff context.
   * V1's route may refine to 'renamed' | 'deleted' | 'list-changed'.
   */
  reason: 'renamed-or-deleted';
}

export interface StarterPackRef {
  id: string;
  /** ISO timestamp. Supplied by the caller — never `Date.now()` inside this module. */
  appliedAt: string;
}

export interface FhirMapping {
  schemaVersion: 1;
  starterPack: StarterPackRef | null;
  /** Key = `encodeQuestionKey(formId, name)` from `./key.ts`. */
  questionMappings: Record<string, QuestionMapping>;
  /** Reserved `{}` in MVP. V1 keys are `encodeChoiceKey(formId, list_name, name)`. */
  choiceMappings: Record<string, ChoiceMapping>;
  /** Sorted by `reconcile()` on (originalKey, system, code). */
  orphans: OrphanEntry[];
  /** Unknown top-level keys, preserved verbatim. Includes null/0/false/"". */
  extras: Record<string, unknown>;
}

/* --------------------------- Starter pack types --------------------------- */

export interface FhirConcept {
  /** XLSForm row name this concept binds to (e.g. "lmp_date"). */
  questionName: string;
  code: string;
  system: string;
  display: string;
  dictionaryVersion: string;
  /** Free-text synonyms for V1 fuzzy-match. MUST NOT contain SNOMED-sourced text. */
  aliases: string[];
}

export interface StarterPack {
  id: string;
  /** The `formId` (e.g. "app:pregnancy") whose questions this pack binds. */
  formId: string;
  concepts: FhirConcept[];
}

/* ------------------------------ Error type ------------------------------- */

/**
 * Thrown by `parseFhirMapping` on schema / type violations. Distinguished
 * from raw `SyntaxError` (thrown by JSON.parse on malformed JSON, which is
 * re-wrapped into this type by parseFhirMapping).
 */
export class FhirMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FhirMappingError';
  }
}
