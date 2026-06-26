/**
 * Vendored terminology dictionary types. Separate from `StarterPack` /
 * `FhirConcept` (which are *question-keyed* pre-fill suggestions tied to
 * specific MCH form fields). A Dictionary is a *searchable code corpus*:
 * many codes per system, not tied to any question.
 *
 * See docs/plans/fhir-pack-population.md "Two real sub-issues" item 1 —
 * the planner-locked decision is (a): keep the per-question starter pack
 * intact, add a separate dictionaries block the picker step-2 searches.
 *
 * Storage: one JSON file per system at
 * `shared/src/fhir/dictionaries/{systemId}.json` — version-pinned + sorted
 * by code so the snapshot script's output is deterministic + diffable.
 *
 * Zero-SNOMED contract: a Dictionary MUST NOT contain any SNOMED-sourced
 * content. The snapshot script applies the filter per-entry + per-alias;
 * `roundtrip.test.ts:scanForSnomed` is the parsed+raw+alias oracle that
 * must stay green on every populated dictionary file.
 */

/** Short identifier used in API routes + filenames. Stable across releases. */
export type DictionarySystemId = 'loinc' | 'icd-10-who' | 'icd-11-who' | 'ciel';

/** Canonical FHIR system URLs the picker's outputs land in `QuestionMapping.system`. */
export const DICTIONARY_SYSTEM_URLS: Record<DictionarySystemId, string> = {
  loinc: 'http://loinc.org',
  'icd-10-who': 'http://id.who.int/icd/release/10',
  'icd-11-who': 'http://id.who.int/icd/release/11/mms',
  ciel: 'https://app.openconceptlab.org/orgs/CIEL/sources/CIEL',
};

/** Friendly label used in UI labels + system-picker buttons. */
export const DICTIONARY_LABELS: Record<DictionarySystemId, string> = {
  loinc: 'LOINC',
  'icd-10-who': 'ICD-10',
  'icd-11-who': 'ICD-11',
  ciel: 'CIEL',
};

export interface DictionaryEntry {
  /** Terminology code (e.g. "8665-2", "A09", "1A03"). */
  code: string;
  /** Human-readable clinical name from the source system. */
  display: string;
  /**
   * Free-text synonyms for fuzzy matching. MAY be empty. MUST NOT contain
   * SNOMED-sourced text — CIEL ships SNOMED cross-maps as alias entries
   * which the snapshot script strips before writing.
   */
  aliases: string[];
}

export interface Dictionary {
  /** Stable short id used by `/api/fhir/dictionary/search?system=<id>`. */
  systemId: DictionarySystemId;
  /** Canonical FHIR system URL — same value `QuestionMapping.system` ends up with. */
  system: string;
  /**
   * Version pin (e.g. `"LOINC-2.78"`, `"ICD11-2024-01"`, `"ICD10-WHO-2019"`,
   * `"CIEL-2026-06-25"`). Carried through to the user's saved mapping so a
   * future audit can tell which release of the dictionary a confirmed code
   * came from.
   */
  dictionaryVersion: string;
  /** Sorted by `code` (snapshot script enforces). Determinism = diffability. */
  entries: DictionaryEntry[];
}

/**
 * Cheap structural check for a parsed JSON value — used by the server's
 * lazy loader to refuse malformed vendored files at startup rather than
 * silently serving garbage. Throws on first violation. NOT a full schema
 * validator; the snapshot script's deterministic output is the source of
 * truth.
 */
export function assertDictionary(value: unknown): asserts value is Dictionary {
  if (!value || typeof value !== 'object') {
    throw new Error('Dictionary: not an object');
  }
  const d = value as Record<string, unknown>;
  if (typeof d.systemId !== 'string') throw new Error('Dictionary: missing/bad systemId');
  if (!(d.systemId in DICTIONARY_SYSTEM_URLS)) {
    throw new Error(`Dictionary: unknown systemId ${d.systemId}`);
  }
  if (typeof d.system !== 'string') throw new Error('Dictionary: missing system URL');
  if (typeof d.dictionaryVersion !== 'string') {
    throw new Error('Dictionary: missing dictionaryVersion');
  }
  if (!Array.isArray(d.entries)) throw new Error('Dictionary: entries must be an array');
}
