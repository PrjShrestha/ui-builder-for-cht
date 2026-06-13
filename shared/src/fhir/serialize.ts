/**
 * Deterministic serializer for `fhir-mapping.json`.
 *
 * Contract:
 * - Object keys are emitted in sorted (lexicographic by UTF-16 code units)
 *   order, recursively. Insertion order is irrelevant for the output bytes.
 * - **Arrays are NOT reordered.** Array order is the producing function's
 *   responsibility (`reconcile()` sorts `orphans[]` itself).
 * - Output uses LF line endings (any `\r` from `JSON.stringify` is stripped,
 *   defensively) and ends with exactly one trailing `\n`.
 * - Output has no UTF-8 BOM. The caller is responsible for writing with
 *   `'utf8'` encoding; this returns a JS string without a leading BOM
 *   character.
 * - Unknown-field preservation: top-level and per-entry `extras` are merged
 *   into the wire object using `Object.keys()` iteration so a future field
 *   valued `null`, `0`, `false`, or `""` survives.
 * - Pure: no clock reads, no env reads, no array reordering, no
 *   `Math.random`. Idempotent — `serialize(parse(serialize(x)))` is a
 *   fixpoint.
 *
 * First-save canonicalization (intentional, frozen): a foreign-formatted
 * sidecar with CRLF / 4-space indent / unsorted keys / `\uXXXX` escapes /
 * non-canonical numeric literals (`0.10`, `1e3`, integers > 2^53) is
 * rewritten once on first save into canonical form, and is thereafter
 * byte-stable. This is the intentional "idempotence" contract, not the
 * stronger (and impossible) "byte-identical to arbitrary input".
 */
import type {
  ChoiceMapping,
  FhirMapping,
  OrphanEntry,
  QuestionMapping,
} from './types.js';

export function serializeFhirMapping(m: FhirMapping): string {
  const wire = wireFhirMapping(m);
  const sorted = sortDeep(wire);
  const json = JSON.stringify(sorted, null, 2);
  // JSON.stringify does not emit CRLF, but normalize defensively so any
  // platform-introduced CR (e.g. from a hand-edited source we re-emit) is
  // canonicalized away.
  return json.replace(/\r\n?/g, '\n') + '\n';
}

/* ----------------------- wire-shape construction -------------------------- */

function wireFhirMapping(m: FhirMapping): Record<string, unknown> {
  const top: Record<string, unknown> = {
    schemaVersion: m.schemaVersion,
    starterPack:
      m.starterPack === null
        ? null
        : { id: m.starterPack.id, appliedAt: m.starterPack.appliedAt },
    questionMappings: mapEntries(m.questionMappings, wireEntry),
    choiceMappings: mapEntries(m.choiceMappings, wireEntry),
    orphans: m.orphans.map(wireOrphan),
  };
  // Merge top-level extras (preserves null/0/false/""). Known keys win.
  for (const k of Object.keys(m.extras)) {
    if (!(k in top)) top[k] = m.extras[k];
  }
  return top;
}

function wireEntry(v: QuestionMapping | ChoiceMapping): Record<string, unknown> {
  const out: Record<string, unknown> = {
    code: v.code,
    system: v.system,
    display: v.display,
    source: v.source,
    dictionaryVersion: v.dictionaryVersion,
    status: v.status,
    confirmedBy: v.confirmedBy,
    confirmedAt: v.confirmedAt,
  };
  if (v.confidence !== undefined) out.confidence = v.confidence;
  if (v.clinicalReview !== undefined) out.clinicalReview = v.clinicalReview;
  for (const k of Object.keys(v.extras)) {
    if (!(k in out)) out[k] = v.extras[k];
  }
  return out;
}

function wireOrphan(v: OrphanEntry): Record<string, unknown> {
  return {
    originalKey: v.originalKey,
    code: v.code,
    system: v.system,
    display: v.display,
    source: v.source,
    dictionaryVersion: v.dictionaryVersion,
    confirmedBy: v.confirmedBy,
    confirmedAt: v.confirmedAt,
    reason: v.reason,
  };
}

function mapEntries<T, U>(
  obj: Record<string, T>,
  fn: (v: T) => U,
): Record<string, U> {
  const out: Record<string, U> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = fn(v);
  }
  return out;
}

/* ---------------------- recursive key-only sort --------------------------- */

/**
 * Returns a new value with **object keys** sorted recursively. Arrays are
 * traversed but their order is preserved verbatim — see the contract note.
 */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = sortDeep(obj[k]);
    }
    return sorted;
  }
  return value;
}
