/**
 * Tests for the starter-pack loader and apply function.
 *
 * Freezes the re-apply safety property (MOH dealbreaker) and proves
 * determinism so the V1 route can call applyStarterPack twice with the
 * same inputs and get the same on-disk bytes.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyStarterPack } from './starterPack.js';
import { loadStarterPack } from './loadStarterPack.js';
import { encodeQuestionKey } from './key.js';
import { serializeFhirMapping } from './serialize.js';
import type { FhirMapping, QuestionMapping } from './types.js';

const APPLIED_AT = '2026-06-05T10:30:00Z';

function emptyMapping(): FhirMapping {
  return {
    schemaVersion: 1,
    starterPack: null,
    questionMappings: {},
    choiceMappings: {},
    orphans: [],
    extras: {},
  };
}

test('loadStarterPack — cht-mch-v1 loads and contains at least one LOINC entry', () => {
  const pack = loadStarterPack('cht-mch-v1');
  assert.equal(pack.id, 'cht-mch-v1');
  assert.equal(pack.formId, 'app:pregnancy');
  assert.ok(pack.concepts.length > 0, 'pack must contain concepts');
  const hasLoinc = pack.concepts.some((c) => c.system === 'http://loinc.org');
  assert.ok(hasLoinc, 'pack must contain at least one LOINC entry');
});

test('loadStarterPack — unknown id throws', () => {
  assert.throws(() => loadStarterPack('does-not-exist'), /Unknown starter pack/);
});

test('applyStarterPack — over an empty mapping creates suggested/unconfirmed entries with mandatory provenance', () => {
  const pack = loadStarterPack('cht-mch-v1');
  const result = applyStarterPack(emptyMapping(), pack, APPLIED_AT);

  assert.equal(Object.keys(result.questionMappings).length, pack.concepts.length);
  for (const concept of pack.concepts) {
    const key = encodeQuestionKey(pack.formId, concept.questionName);
    const entry = result.questionMappings[key];
    assert.ok(entry, `entry must exist for ${key}`);
    assert.equal(entry.source, 'starter-pack');
    assert.equal(entry.status, 'suggested');
    assert.equal(entry.confirmedBy, null);
    assert.equal(entry.confirmedAt, null);
    assert.equal(entry.code, concept.code);
    assert.equal(entry.system, concept.system);
    assert.equal(entry.display, concept.display);
    assert.equal(entry.dictionaryVersion, concept.dictionaryVersion);
  }

  assert.deepEqual(result.starterPack, { id: pack.id, appliedAt: APPLIED_AT });
});

test('applyStarterPack — re-apply over a confirmed entry leaves confirmedBy intact (MOH dealbreaker)', () => {
  const pack = loadStarterPack('cht-mch-v1');
  const lmpConcept = pack.concepts.find((c) => c.questionName === 'lmp_date');
  assert.ok(lmpConcept, 'cht-mch-v1 must include lmp_date for this test');
  const lmpKey = encodeQuestionKey(pack.formId, 'lmp_date');

  const confirmedManually: QuestionMapping = {
    code: 'CUSTOM-LOINC',
    system: 'http://loinc.org',
    display: 'My custom display',
    source: 'manual',
    dictionaryVersion: 'LOINC-2.82',
    status: 'confirmed',
    confirmedBy: 'bhishan@gandaki',
    confirmedAt: '2026-06-01T09:30:00Z',
    extras: {},
  };
  const m: FhirMapping = {
    ...emptyMapping(),
    questionMappings: { [lmpKey]: confirmedManually },
  };

  const result = applyStarterPack(m, pack, APPLIED_AT);
  const after = result.questionMappings[lmpKey];
  assert.ok(after);
  assert.equal(after.code, 'CUSTOM-LOINC', 'manually-set code must be preserved');
  assert.equal(after.confirmedBy, 'bhishan@gandaki', 'confirmedBy must NOT reset to null');
  assert.equal(after.source, 'manual', 'source must NOT revert to starter-pack');
});

test('applyStarterPack — deterministic across two calls with the same inputs', () => {
  const pack = loadStarterPack('cht-mch-v1');
  const a = serializeFhirMapping(applyStarterPack(emptyMapping(), pack, APPLIED_AT));
  const b = serializeFhirMapping(applyStarterPack(emptyMapping(), pack, APPLIED_AT));
  assert.equal(a, b, 'two applyStarterPack calls with the same inputs must produce identical bytes');
});
