/**
 * Round-trip + canonicalization-contract suite for the FHIR mapping module.
 *
 * Run via `pnpm --filter @cht-ui/shared test` (which builds first, then
 * invokes `node --test "dist/**\/*.test.js"`).
 *
 * The 10 cases freeze the developer/QA acceptance bar in plan §4.10. The
 * zero-SNOMED oracle in particular is the licensing guard for the bundled
 * pack — it scans BOTH the parsed object AND the raw committed file bytes
 * AND the free-text alias path, so a SNOMED reference can never slip in
 * through any provenance channel.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFhirMapping } from './parse.js';
import { serializeFhirMapping } from './serialize.js';
import { reconcileFhirMapping } from './reconcile.js';
import { encodeQuestionKey } from './key.js';
import { FhirMappingError, type FhirMapping, type QuestionMapping } from './types.js';

/* --------------------------- path resolution ----------------------------- */

/**
 * Resolve a path relative to the source `__fixtures__` directory. Mirrors
 * the dual-path approach in `starterPack.ts` so tests run whether or not
 * a build step has copied non-TS files into dist/.
 */
function fixturePath(name: string): string {
  const here = import.meta.dirname;
  const candidates = [
    join(here, '__fixtures__', name),
    join(here, '..', '..', 'src', 'fhir', '__fixtures__', name),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c);
      return c;
    } catch {
      // Try next candidate.
    }
  }
  throw new Error(`Fixture not found: ${name}`);
}

function bundledPackPath(): string {
  const here = import.meta.dirname;
  const candidates = [
    join(here, 'starter-packs', 'cht-mch-v1.json'),
    join(here, '..', '..', 'src', 'fhir', 'starter-packs', 'cht-mch-v1.json'),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c);
      return c;
    } catch {
      // Try next candidate.
    }
  }
  throw new Error('Bundled pack file not found');
}

/* ----------------------- zero-SNOMED oracle ------------------------------ */

/**
 * Three-mode SNOMED predicate (plan §4.10 #7):
 *   (i)  recursive structural scan flagging any node where
 *        `system === 'http://snomed.info/sct'` or the OID appears,
 *   (ii) substring scan over ALL stringified leaf values for any of
 *        `snomed.info`, `/sct`, the OID, or a case-insensitive `snomed`
 *        token (catches free-text aliases / cross-map attributes),
 *   (iii) substring scan over the RAW committed file bytes (catches a
 *        token living in formatting/whitespace positions outside parsed
 *        values).
 */
function scanForSnomed(
  parsed: unknown,
  rawBytes: string,
): { found: boolean; reason?: string } {
  const NEEDLES_CASE_SENSITIVE = ['snomed.info', '/sct', '2.16.840.1.113883.6.96'];
  const NEEDLE_CASE_INSENSITIVE = 'snomed';

  function checkString(s: string, path: string): string | null {
    for (const needle of NEEDLES_CASE_SENSITIVE) {
      if (s.includes(needle)) return `${path}: contains ${JSON.stringify(needle)}`;
    }
    if (s.toLowerCase().includes(NEEDLE_CASE_INSENSITIVE)) {
      return `${path}: contains case-insensitive 'snomed'`;
    }
    return null;
  }

  function walk(v: unknown, path: string): string | null {
    if (typeof v === 'string') return checkString(v, path);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const r = walk(v[i], `${path}[${i}]`);
        if (r) return r;
      }
      return null;
    }
    if (v !== null && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const r = walk(val, path === '' ? k : `${path}.${k}`);
        if (r) return r;
      }
      return null;
    }
    return null;
  }

  const structuralOrLeaf = walk(parsed, '');
  if (structuralOrLeaf) return { found: true, reason: structuralOrLeaf };

  const rawCheck = checkString(rawBytes, '<raw bytes>');
  if (rawCheck) return { found: true, reason: rawCheck };

  return { found: false };
}

/* ------------------------------ 10 test cases ----------------------------- */

const CANONICAL_PATH = (() => fixturePath('mch-pregnancy.fhir-mapping.json'))();
const NON_CANONICAL_PATH = (() => fixturePath('non-canonical.fhir-mapping.json.txt'))();
const POISONED_SYSTEM_PATH = (() => fixturePath('poisoned-snomed.json'))();
const POISONED_ALIAS_PATH = (() => fixturePath('poisoned-snomed-alias.json'))();

test('#1 — idempotence + no-op-on-own-output on the canonical fixture', () => {
  const s = readFileSync(CANONICAL_PATH, 'utf8');
  const parsed = parseFhirMapping(s);
  const reparsed = parseFhirMapping(serializeFhirMapping(parsed));
  assert.deepEqual(parsed, reparsed, 'parse → serialize → parse must deep-equal');

  const out1 = serializeFhirMapping(parseFhirMapping(s));
  assert.equal(out1, s, 'no-op-on-own-output: canonical fixture must serialize byte-identically');

  const out2 = serializeFhirMapping(parseFhirMapping(out1));
  assert.equal(out2, out1, 'idempotence: the serializer is a fixpoint on its own output');

  assert.ok(!s.includes('\r'), 'fixture (and therefore output) must contain no \\r');
  assert.equal(s.charCodeAt(0), 0x7b, 'must start with { (no BOM)');
  assert.equal(s.charAt(s.length - 1), '\n', 'must end with exactly one trailing newline');
});

test('#2 — one-time canonicalization boundary on the non-canonical fixture', () => {
  const raw = readFileSync(NON_CANONICAL_PATH, 'utf8');
  const out1 = serializeFhirMapping(parseFhirMapping(raw));
  assert.notEqual(out1, raw, 'first save MUST canonicalize a non-canonical input');
  const out2 = serializeFhirMapping(parseFhirMapping(out1));
  assert.equal(out2, out1, 'stable after the first save (idempotent thereafter)');
});

test('#3 — unknown-field preservation incl. null/0/false/"" and absent vs present-null', () => {
  const s = readFileSync(CANONICAL_PATH, 'utf8');
  const m = parseFhirMapping(s);

  // Top-level extras: null/0/false/"" survive deepEqual
  assert.equal(m.extras['futureBoolean'], false);
  assert.equal(m.extras['futureEmptyString'], '');
  assert.equal(m.extras['futureNumber'], 0);
  assert.equal(m.extras['futureUnknownTopLevel'], 'preserved verbatim');

  // Per-entry extras: null survives
  const lmpKey = encodeQuestionKey('app:pregnancy', 'lmp_date');
  const entry = m.questionMappings[lmpKey];
  assert.ok(entry);
  assert.ok('futurePerEntryNull' in entry.extras, 'present-null key must STAY present');
  assert.equal(entry.extras['futurePerEntryNull'], null);

  // Absent stays absent: the weight_kg entry has no per-entry extras
  const weightKey = encodeQuestionKey('app:pregnancy', 'weight_kg');
  const weightEntry = m.questionMappings[weightKey];
  assert.ok(weightEntry);
  assert.deepEqual(weightEntry.extras, {}, 'absent extras key must NOT be invented');

  // Byte-level round-trip: the unknown keys are emitted in sorted position
  const out = serializeFhirMapping(m);
  assert.equal(out, s, 'byte-identical round-trip with extras preserved');
});

test('#4 — order-independent determinism: insertion order does not affect output', () => {
  const lmpKey = encodeQuestionKey('app:pregnancy', 'lmp_date');
  const weightKey = encodeQuestionKey('app:pregnancy', 'weight_kg');

  const baseEntry = (over: Partial<QuestionMapping> = {}): QuestionMapping => ({
    code: '8665-2',
    system: 'http://loinc.org',
    display: 'X',
    source: 'starter-pack',
    dictionaryVersion: 'LOINC-2.82',
    status: 'suggested',
    confirmedBy: null,
    confirmedAt: null,
    extras: {},
    ...over,
  });

  const m1: FhirMapping = {
    schemaVersion: 1,
    starterPack: null,
    questionMappings: { [lmpKey]: baseEntry(), [weightKey]: baseEntry({ code: 'W' }) },
    choiceMappings: {},
    orphans: [],
    extras: { a: 1, b: 2 },
  };
  const m2: FhirMapping = {
    schemaVersion: 1,
    starterPack: null,
    questionMappings: { [weightKey]: baseEntry({ code: 'W' }), [lmpKey]: baseEntry() },
    choiceMappings: {},
    orphans: [],
    extras: { b: 2, a: 1 },
  };
  assert.equal(serializeFhirMapping(m1), serializeFhirMapping(m2));
});

test('#5 — schema-validation failure modes throw FhirMappingError, not raw errors', () => {
  // Empty object: missing schemaVersion
  assert.throws(() => parseFhirMapping('{}'), FhirMappingError);
  // Wrong type for code
  assert.throws(
    () =>
      parseFhirMapping(
        '{"schemaVersion":1,"questionMappings":{"k":{"code":123,"system":"http://loinc.org","display":"x","source":"manual","dictionaryVersion":"LOINC-2.82","status":"suggested","confirmedBy":null,"confirmedAt":null}}}',
      ),
    FhirMappingError,
  );
  // Non-object questionMappings
  assert.throws(
    () => parseFhirMapping('{"schemaVersion":1,"questionMappings":[]}'),
    FhirMappingError,
  );
  // Malformed JSON throws FhirMappingError too (wrapped, not raw SyntaxError)
  assert.throws(() => parseFhirMapping('{not json'), FhirMappingError);
  // Wrong schemaVersion
  assert.throws(() => parseFhirMapping('{"schemaVersion":2,"questionMappings":{}}'), FhirMappingError);
});

test('#6 — provenance required + confirmed entry survives round-trip byte-for-byte', () => {
  const s = readFileSync(CANONICAL_PATH, 'utf8');
  // Sanity: the fixture contains the confirmedBy string verbatim
  assert.ok(s.includes('bhishan@gandaki'), 'fixture must include confirmedBy');
  assert.ok(s.includes('2026-06-01T09:30:00Z'), 'fixture must include confirmedAt');
  // Round-trip and assert it's still there
  const out = serializeFhirMapping(parseFhirMapping(s));
  assert.ok(out.includes('bhishan@gandaki'));
  assert.ok(out.includes('2026-06-01T09:30:00Z'));
  assert.equal(out, s, 'audit trail is byte-stable across save');
});

test('#7 — zero-SNOMED oracle: green on the pack, red on BOTH poisoned fixtures', () => {
  // (a) Bundled pack — green in parsed-object form AND raw bytes
  const packPath = bundledPackPath();
  const packRaw = readFileSync(packPath, 'utf8');
  const packParsed: unknown = JSON.parse(packRaw);
  const packScan = scanForSnomed(packParsed, packRaw);
  assert.equal(
    packScan.found,
    false,
    `cht-mch-v1.json contains a SNOMED reference: ${packScan.reason ?? ''}`,
  );

  // (b) System-URI poisoning — must trip the oracle
  const sysRaw = readFileSync(POISONED_SYSTEM_PATH, 'utf8');
  const sysParsed: unknown = JSON.parse(sysRaw);
  const sysScan = scanForSnomed(sysParsed, sysRaw);
  assert.equal(sysScan.found, true, 'system-URI poisoned fixture must be flagged');

  // (c) Free-text alias poisoning — must ALSO trip the oracle
  const aliasRaw = readFileSync(POISONED_ALIAS_PATH, 'utf8');
  const aliasParsed: unknown = JSON.parse(aliasRaw);
  const aliasScan = scanForSnomed(aliasParsed, aliasRaw);
  assert.equal(
    aliasScan.found,
    true,
    'free-text alias poisoning must be flagged (otherwise system-URI test alone gives false confidence)',
  );
});

test('#8 — reconcile rename/delete + deterministic orphan order + false-orphan guard', () => {
  // (a) relocate, not drop
  const removedKey = encodeQuestionKey('app:pregnancy', 'lmp_date');
  const m: FhirMapping = {
    schemaVersion: 1,
    starterPack: null,
    questionMappings: {
      [removedKey]: {
        code: '8665-2',
        system: 'http://loinc.org',
        display: 'LMP',
        source: 'starter-pack',
        dictionaryVersion: 'LOINC-2.82',
        status: 'confirmed',
        confirmedBy: 'bhishan',
        confirmedAt: '2026-06-01T09:30:00Z',
        extras: {},
      },
    },
    choiceMappings: {},
    orphans: [],
    extras: {},
  };
  const r = reconcileFhirMapping(m, []);
  assert.equal(r.orphans.length, 1);
  assert.equal(r.orphans[0]?.confirmedBy, 'bhishan');

  // (b) deterministic orphan ordering across opposite insertion orders
  const k1 = encodeQuestionKey('app:pregnancy', 'a');
  const k2 = encodeQuestionKey('app:pregnancy', 'b');
  const stub = (code: string): QuestionMapping => ({
    code,
    system: 'http://loinc.org',
    display: 'x',
    source: 'starter-pack',
    dictionaryVersion: 'LOINC-2.82',
    status: 'suggested',
    confirmedBy: null,
    confirmedAt: null,
    extras: {},
  });
  const m1: FhirMapping = { ...m, questionMappings: { [k1]: stub('A'), [k2]: stub('B') } };
  const m2: FhirMapping = { ...m, questionMappings: { [k2]: stub('B'), [k1]: stub('A') } };
  assert.equal(
    serializeFhirMapping(reconcileFhirMapping(m1, [])),
    serializeFhirMapping(reconcileFhirMapping(m2, [])),
  );

  // (c) false-orphan guard: a live name with `/` is retained, not orphaned
  const slashKey = encodeQuestionKey('app:pregnancy', 'has/slash');
  const m3: FhirMapping = { ...m, questionMappings: { [slashKey]: stub('S') } };
  const live = [encodeQuestionKey('app:pregnancy', 'has/slash')];
  const r3 = reconcileFhirMapping(m3, live);
  assert.equal(r3.orphans.length, 0, 'live `/`-containing name must NOT be orphaned');
  assert.ok(r3.questionMappings[slashKey]);
});

test('#9 — number canonicalization is frozen (option-a: numbers canonicalize on first parse)', () => {
  const raw = readFileSync(NON_CANONICAL_PATH, 'utf8');
  const parsed = parseFhirMapping(raw);
  const lmpKey = encodeQuestionKey('app:pregnancy', 'lmp_date');
  const entry = parsed.questionMappings[lmpKey];
  assert.ok(entry);

  // confidence: 0.10 → 0.1
  assert.equal(entry.confidence, 0.1, 'confidence canonicalizes 0.10 → 0.1');

  // Unknown numeric extras canonicalize too
  assert.equal(entry.extras['unknownExponent'], 1000, '1e3 → 1000');
  assert.equal(entry.extras['unknownTrailingZero'], 1, '1.0 → 1');
  // 9007199254740993 > 2^53; JS clamps it to 2^53
  assert.equal(entry.extras['unknownLargeInt'], 9007199254740992, 'precision-clamped');

  // Idempotent thereafter
  const once = serializeFhirMapping(parseFhirMapping(raw));
  const twice = serializeFhirMapping(parseFhirMapping(once));
  assert.equal(twice, once);
});

test('#10 — Unicode canonicalization is frozen (\\uXXXX escape → literal UTF-8, no BOM)', () => {
  const raw = readFileSync(NON_CANONICAL_PATH, 'utf8');
  // Sanity: source contains the 6-char escape
  assert.ok(raw.includes('\\u00e9'), 'source fixture must contain the \\u00e9 escape');

  const out = serializeFhirMapping(parseFhirMapping(raw));
  // After canonicalization, the escape becomes a literal é character
  assert.ok(out.includes('é'), 'output must contain literal é');
  assert.ok(!out.includes('\\u00e9'), 'output must NOT contain the \\u00e9 escape anymore');
  // No BOM on output
  assert.notEqual(out.charCodeAt(0), 0xfeff, 'output must not start with U+FEFF (BOM)');
  assert.equal(out.charCodeAt(0), 0x7b, 'output must start with `{`');
  // Idempotent thereafter
  assert.equal(serializeFhirMapping(parseFhirMapping(out)), out);
});
