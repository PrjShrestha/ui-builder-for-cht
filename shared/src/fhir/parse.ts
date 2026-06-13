/**
 * Parser for `fhir-mapping.json`.
 *
 * Strict: every required field on every entry is type-checked. On any
 * structural violation a typed `FhirMappingError` is thrown (NOT a raw
 * SyntaxError / TypeError) so the V1 server route can surface the cause to
 * the user.
 *
 * Unknown-field preservation: any top-level or per-entry key that isn't
 * known to the schema is copied into the corresponding `extras` bag using
 * `Object.keys()` iteration — so a future field whose value is `null`, `0`,
 * `false`, or `""` survives round-trip. (Same discipline as XLSForm extras.)
 */
import {
  type ChoiceMapping,
  type FhirMapping,
  FhirMappingError,
  type MappingSource,
  type MappingStatus,
  type OrphanEntry,
  type QuestionMapping,
} from './types.js';

const KNOWN_TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'starterPack',
  'questionMappings',
  'choiceMappings',
  'orphans',
]);

const KNOWN_ENTRY_KEYS = new Set([
  'code',
  'system',
  'display',
  'source',
  'dictionaryVersion',
  'status',
  'confirmedBy',
  'confirmedAt',
  'confidence',
  'clinicalReview',
]);

const VALID_STATUSES: ReadonlySet<MappingStatus> = new Set([
  'suggested',
  'confirmed',
  'skipped',
  'orphaned',
]);

export function parseFhirMapping(source: string): FhirMapping {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (e) {
    throw new FhirMappingError(`fhir-mapping is not valid JSON: ${(e as Error).message}`);
  }
  return validateFhirMapping(raw);
}

function validateFhirMapping(raw: unknown): FhirMapping {
  if (!isPlainObject(raw)) {
    throw new FhirMappingError('fhir-mapping root must be a JSON object');
  }
  const obj = raw;

  if (typeof obj.schemaVersion !== 'number') {
    throw new FhirMappingError('fhir-mapping.schemaVersion must be a number');
  }
  if (obj.schemaVersion !== 1) {
    throw new FhirMappingError(
      `fhir-mapping.schemaVersion=${String(obj.schemaVersion)} is not supported (expected 1)`,
    );
  }

  // starterPack: { id, appliedAt } | null
  let starterPack: FhirMapping['starterPack'] = null;
  if (!('starterPack' in obj) || obj.starterPack === null) {
    starterPack = null;
  } else {
    const sp = obj.starterPack;
    if (!isPlainObject(sp)) {
      throw new FhirMappingError('fhir-mapping.starterPack must be an object or null');
    }
    if (typeof sp.id !== 'string' || typeof sp.appliedAt !== 'string') {
      throw new FhirMappingError(
        'fhir-mapping.starterPack requires string `id` and string `appliedAt`',
      );
    }
    starterPack = { id: sp.id, appliedAt: sp.appliedAt };
  }

  // questionMappings: required object
  if (!('questionMappings' in obj) || !isPlainObject(obj.questionMappings)) {
    throw new FhirMappingError('fhir-mapping.questionMappings must be an object');
  }
  const questionMappings: Record<string, QuestionMapping> = {};
  for (const [k, v] of Object.entries(obj.questionMappings)) {
    questionMappings[k] = parseQuestionMapping(k, v);
  }

  // choiceMappings: optional object; default {}
  let choiceMappings: Record<string, ChoiceMapping> = {};
  if ('choiceMappings' in obj && obj.choiceMappings !== null && obj.choiceMappings !== undefined) {
    if (!isPlainObject(obj.choiceMappings)) {
      throw new FhirMappingError('fhir-mapping.choiceMappings must be an object');
    }
    choiceMappings = {};
    for (const [k, v] of Object.entries(obj.choiceMappings)) {
      choiceMappings[k] = parseChoiceMapping(k, v);
    }
  }

  // orphans: optional array; default []
  let orphans: OrphanEntry[] = [];
  if ('orphans' in obj && obj.orphans !== null && obj.orphans !== undefined) {
    if (!Array.isArray(obj.orphans)) {
      throw new FhirMappingError('fhir-mapping.orphans must be an array');
    }
    orphans = obj.orphans.map((o, i) => parseOrphan(i, o));
  }

  // Collect unknown top-level keys verbatim (incl. null/0/false/"").
  const extras: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(k)) {
      extras[k] = obj[k];
    }
  }

  return {
    schemaVersion: 1,
    starterPack,
    questionMappings,
    choiceMappings,
    orphans,
    extras,
  };
}

function parseQuestionMapping(key: string, v: unknown): QuestionMapping {
  if (!isPlainObject(v)) {
    throw new FhirMappingError(`questionMappings[${key}] must be an object`);
  }
  const o = v;
  return {
    code: requireString(o, 'code', `questionMappings[${key}]`),
    system: requireString(o, 'system', `questionMappings[${key}]`),
    display: requireString(o, 'display', `questionMappings[${key}]`),
    source: requireSource(o, `questionMappings[${key}]`),
    dictionaryVersion: requireString(o, 'dictionaryVersion', `questionMappings[${key}]`),
    status: requireStatus(o, `questionMappings[${key}]`),
    confirmedBy: requireStringOrNull(o, 'confirmedBy', `questionMappings[${key}]`),
    confirmedAt: requireStringOrNull(o, 'confirmedAt', `questionMappings[${key}]`),
    ...(o.confidence !== undefined
      ? { confidence: requireNumber(o, 'confidence', `questionMappings[${key}]`) }
      : {}),
    ...(o.clinicalReview !== undefined
      ? { clinicalReview: requireClinicalReview(o.clinicalReview, `questionMappings[${key}]`) }
      : {}),
    extras: collectExtras(o, KNOWN_ENTRY_KEYS),
  };
}

function parseChoiceMapping(key: string, v: unknown): ChoiceMapping {
  if (!isPlainObject(v)) {
    throw new FhirMappingError(`choiceMappings[${key}] must be an object`);
  }
  const o = v;
  return {
    code: requireString(o, 'code', `choiceMappings[${key}]`),
    system: requireString(o, 'system', `choiceMappings[${key}]`),
    display: requireString(o, 'display', `choiceMappings[${key}]`),
    source: requireSource(o, `choiceMappings[${key}]`),
    dictionaryVersion: requireString(o, 'dictionaryVersion', `choiceMappings[${key}]`),
    status: requireStatus(o, `choiceMappings[${key}]`),
    confirmedBy: requireStringOrNull(o, 'confirmedBy', `choiceMappings[${key}]`),
    confirmedAt: requireStringOrNull(o, 'confirmedAt', `choiceMappings[${key}]`),
    ...(o.confidence !== undefined
      ? { confidence: requireNumber(o, 'confidence', `choiceMappings[${key}]`) }
      : {}),
    ...(o.clinicalReview !== undefined
      ? { clinicalReview: requireClinicalReview(o.clinicalReview, `choiceMappings[${key}]`) }
      : {}),
    extras: collectExtras(o, KNOWN_ENTRY_KEYS),
  };
}

function parseOrphan(index: number, v: unknown): OrphanEntry {
  if (!isPlainObject(v)) {
    throw new FhirMappingError(`orphans[${index}] must be an object`);
  }
  const o = v;
  if (o.reason !== 'renamed-or-deleted') {
    throw new FhirMappingError(
      `orphans[${index}].reason must equal 'renamed-or-deleted' (got ${String(o.reason)})`,
    );
  }
  return {
    originalKey: requireString(o, 'originalKey', `orphans[${index}]`),
    code: requireString(o, 'code', `orphans[${index}]`),
    system: requireString(o, 'system', `orphans[${index}]`),
    display: requireString(o, 'display', `orphans[${index}]`),
    source: requireSource(o, `orphans[${index}]`),
    dictionaryVersion: requireString(o, 'dictionaryVersion', `orphans[${index}]`),
    confirmedBy: requireStringOrNull(o, 'confirmedBy', `orphans[${index}]`),
    confirmedAt: requireStringOrNull(o, 'confirmedAt', `orphans[${index}]`),
    reason: 'renamed-or-deleted',
  };
}

/* ------------------------------ helpers ----------------------------------- */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(o: Record<string, unknown>, field: string, ctx: string): string {
  const v = o[field];
  if (typeof v !== 'string') {
    throw new FhirMappingError(`${ctx}.${field} must be a string (got ${typeName(v)})`);
  }
  return v;
}

function requireNumber(o: Record<string, unknown>, field: string, ctx: string): number {
  const v = o[field];
  if (typeof v !== 'number') {
    throw new FhirMappingError(`${ctx}.${field} must be a number (got ${typeName(v)})`);
  }
  return v;
}

function requireStringOrNull(
  o: Record<string, unknown>,
  field: string,
  ctx: string,
): string | null {
  const v = o[field];
  if (v === null) return null;
  if (typeof v === 'string') return v;
  throw new FhirMappingError(`${ctx}.${field} must be a string or null (got ${typeName(v)})`);
}

function requireSource(o: Record<string, unknown>, ctx: string): MappingSource {
  const v = o.source;
  if (typeof v !== 'string') {
    throw new FhirMappingError(`${ctx}.source must be a string`);
  }
  if (v === 'starter-pack' || v === 'manual') return v;
  if (v.startsWith('online:') && v.length > 'online:'.length) {
    // online:${string} is reserved-but-unreachable in MVP. Accept it on read
    // (so a hand-edited file isn't rejected) but the V1 contract-test gate
    // governs producing it.
    return v as MappingSource;
  }
  throw new FhirMappingError(
    `${ctx}.source must be 'starter-pack' | 'manual' | 'online:<sourceId>' (got ${JSON.stringify(v)})`,
  );
}

function requireStatus(o: Record<string, unknown>, ctx: string): MappingStatus {
  const v = o.status;
  if (typeof v !== 'string' || !VALID_STATUSES.has(v as MappingStatus)) {
    throw new FhirMappingError(
      `${ctx}.status must be 'suggested' | 'confirmed' | 'skipped' | 'orphaned' (got ${JSON.stringify(v)})`,
    );
  }
  return v as MappingStatus;
}

function requireClinicalReview(
  v: unknown,
  ctx: string,
): { reviewer: string; reviewedAt: string } {
  if (!isPlainObject(v)) {
    throw new FhirMappingError(`${ctx}.clinicalReview must be an object`);
  }
  if (typeof v.reviewer !== 'string' || typeof v.reviewedAt !== 'string') {
    throw new FhirMappingError(
      `${ctx}.clinicalReview requires string \`reviewer\` and string \`reviewedAt\``,
    );
  }
  return { reviewer: v.reviewer, reviewedAt: v.reviewedAt };
}

function collectExtras(
  o: Record<string, unknown>,
  known: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) {
    if (!known.has(k)) {
      out[k] = o[k];
    }
  }
  return out;
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
