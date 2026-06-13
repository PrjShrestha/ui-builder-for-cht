/**
 * Tests for `reconcileFhirMapping`.
 *
 * These freeze the orphan-relocate semantics and prove the determinism +
 * false-orphan guard the plan §4.5 acceptance bar requires.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { encodeQuestionKey } from './key.js';
import { reconcileFhirMapping } from './reconcile.js';
import { serializeFhirMapping } from './serialize.js';
import type { FhirMapping, QuestionMapping } from './types.js';

function entry(over: Partial<QuestionMapping> = {}): QuestionMapping {
  return {
    code: '8665-2',
    system: 'http://loinc.org',
    display: 'Last menstrual period start date',
    source: 'starter-pack',
    dictionaryVersion: 'LOINC-2.82',
    status: 'suggested',
    confirmedBy: null,
    confirmedAt: null,
    extras: {},
    ...over,
  };
}

function mapping(over: Partial<FhirMapping> = {}): FhirMapping {
  return {
    schemaVersion: 1,
    starterPack: null,
    questionMappings: {},
    choiceMappings: {},
    orphans: [],
    extras: {},
    ...over,
  };
}

test('reconcile — confirmed entry whose key is no longer live moves to orphans, preserving provenance', () => {
  const lmpKey = encodeQuestionKey('app:pregnancy', 'lmp_date');
  const m = mapping({
    questionMappings: {
      [lmpKey]: entry({
        status: 'confirmed',
        confirmedBy: 'bhishan@gandaki',
        confirmedAt: '2026-06-01T09:30:00Z',
      }),
    },
  });
  const result = reconcileFhirMapping(m, [/* lmp removed */]);
  assert.deepEqual(result.questionMappings, {});
  assert.equal(result.orphans.length, 1);
  const orphan = result.orphans[0];
  assert.ok(orphan, 'orphan must exist');
  assert.equal(orphan.originalKey, lmpKey);
  assert.equal(orphan.code, '8665-2');
  assert.equal(orphan.confirmedBy, 'bhishan@gandaki', 'confirmedBy must survive — no silent data loss');
  assert.equal(orphan.confirmedAt, '2026-06-01T09:30:00Z');
  assert.equal(orphan.reason, 'renamed-or-deleted');
});

test('reconcile — live key is kept untouched and byte-stable after serialize', () => {
  const lmpKey = encodeQuestionKey('app:pregnancy', 'lmp_date');
  const m = mapping({
    questionMappings: { [lmpKey]: entry({ status: 'confirmed', confirmedBy: 'x' }) },
  });
  const before = serializeFhirMapping(m);
  const reconciled = reconcileFhirMapping(m, [lmpKey]);
  const after = serializeFhirMapping(reconciled);
  assert.equal(after, before, 'reconcile over an all-live mapping must be a no-op');
});

test('reconcile — deterministic orphan order across opposite insertion orders', () => {
  const a = encodeQuestionKey('app:pregnancy', 'a_field');
  const b = encodeQuestionKey('app:pregnancy', 'b_field');
  const c = encodeQuestionKey('app:pregnancy', 'c_field');

  // Two mappings with the SAME logical contents but opposite insertion orders.
  const m1 = mapping({
    questionMappings: { [a]: entry(), [b]: entry({ code: 'X' }), [c]: entry({ code: 'Y' }) },
  });
  const m2 = mapping({
    questionMappings: { [c]: entry({ code: 'Y' }), [b]: entry({ code: 'X' }), [a]: entry() },
  });

  // Remove all three; all become orphans.
  const r1 = reconcileFhirMapping(m1, []);
  const r2 = reconcileFhirMapping(m2, []);

  // Same logical orphan set; identical serialized bytes (this is the
  // array-ordering non-determinism that the key-only sortDeep can't catch).
  assert.equal(serializeFhirMapping(r1), serializeFhirMapping(r2));
});

test('reconcile — false-orphan guard: a live name containing `/` is retained, not orphaned', () => {
  // The bug the codec exists to prevent: if liveQuestionKeys were produced
  // by string concatenation, "has/slash" would become "app:pregnancy/has/slash"
  // — which doesn't byte-match the on-disk encoded "app:pregnancy/has%2Fslash"
  // and the live confirmed binding would be silently relocated to orphans[].
  const onDiskKey = encodeQuestionKey('app:pregnancy', 'has/slash');
  const m = mapping({
    questionMappings: { [onDiskKey]: entry({ status: 'confirmed', confirmedBy: 'x' }) },
  });

  // Live keys produced via the codec — the only correct path.
  const liveViaCodec = [encodeQuestionKey('app:pregnancy', 'has/slash')];
  const result = reconcileFhirMapping(m, liveViaCodec);

  assert.equal(result.orphans.length, 0, 'confirmed live binding must NOT be orphaned');
  assert.ok(result.questionMappings[onDiskKey], 'confirmed live binding must be retained');
  assert.equal(result.questionMappings[onDiskKey]?.confirmedBy, 'x');
});

test('reconcile — pre-existing orphans are merged and sorted with new orphans', () => {
  const removedKey = encodeQuestionKey('app:pregnancy', 'removed_now');
  const m = mapping({
    questionMappings: { [removedKey]: entry({ code: 'NEW' }) },
    orphans: [
      {
        originalKey: encodeQuestionKey('app:pregnancy', 'old_orphan'),
        code: 'OLD',
        system: 'http://loinc.org',
        display: 'old',
        source: 'starter-pack',
        dictionaryVersion: 'LOINC-2.82',
        confirmedBy: null,
        confirmedAt: null,
        reason: 'renamed-or-deleted',
      },
    ],
  });
  const r = reconcileFhirMapping(m, []);
  assert.equal(r.orphans.length, 2);
  // Sorted by originalKey: 'app:pregnancy/old_orphan' < 'app:pregnancy/removed_now'
  assert.equal(r.orphans[0]?.code, 'OLD');
  assert.equal(r.orphans[1]?.code, 'NEW');
});

test('reconcile — does NOT mutate input', () => {
  const lmpKey = encodeQuestionKey('app:pregnancy', 'lmp_date');
  const original: FhirMapping = mapping({
    questionMappings: { [lmpKey]: entry() },
  });
  const snapshot = serializeFhirMapping(original);
  reconcileFhirMapping(original, []);
  assert.equal(serializeFhirMapping(original), snapshot, 'input must not be mutated');
});
