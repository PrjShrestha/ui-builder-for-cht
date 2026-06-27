/**
 * Tests for the Quick Hierarchy Creator scaffold (plan
 * docs/plans/quick-hierarchy-creator.md §11). The headline bugs the QA
 * persona called out are encoded one-test-per-rule below — see the §A
 * suite for shape, §B for slug behaviour, §C for collision, §D for
 * edge cases.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  buildQuickHierarchy,
  slugifyHierarchyId,
  validateQuickHierarchy,
  type QuickHierarchyInput,
} from './buildLinearHierarchy.js';

function lvl(name: string, explicitId?: string) {
  return explicitId === undefined ? { name } : { name, explicitId };
}

const ASCII_INPUT_2_PLACES: QuickHierarchyInput = {
  places: [lvl('District'), lvl('Health facility')],
  person: lvl('Person'),
  existing: [],
};

/* ====================== §A — output shape ============================ */

test('§A1 — 2-place + person scaffold: parents wiring, place_hierarchy_types order, place_types_display', () => {
  const out = buildQuickHierarchy(ASCII_INPUT_2_PLACES);
  assert.equal(out.ok, true);
  if (!out.ok) return;

  // Three rows: 2 places + 1 person, in input order.
  assert.equal(out.result.contact_types.length, 3);
  assert.equal(out.result.contact_types[0]!.id, 'district');
  assert.equal(out.result.contact_types[1]!.id, 'health_facility');
  assert.equal(out.result.contact_types[2]!.id, 'person');

  // Parents wiring: L0 has none, Li parents = [L(i-1)], person parents = [Ln].
  assert.equal(out.result.contact_types[0]!.parents, undefined);
  assert.deepEqual(out.result.contact_types[1]!.parents, ['district']);
  assert.deepEqual(out.result.contact_types[2]!.parents, ['health_facility']);

  // person flag set only on the leaf.
  assert.equal(out.result.contact_types[0]!.person, undefined);
  assert.equal(out.result.contact_types[2]!.person, true);

  // place_hierarchy_types: places only, in chain order (person excluded).
  assert.deepEqual(out.result.place_hierarchy_types, ['district', 'health_facility']);

  // Display map: only places, only when a friendly name was provided.
  assert.deepEqual(out.result.place_types_display, {
    district: 'District',
    health_facility: 'Health facility',
  });
});

test('§A2 — create_form/edit_form set on places, NOT on the person leaf (matches AddTypeForm convention)', () => {
  const out = buildQuickHierarchy(ASCII_INPUT_2_PLACES);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.result.contact_types[0]!.create_form, 'form:contact:district:create');
  assert.equal(out.result.contact_types[0]!.edit_form, 'form:contact:district:edit');
  assert.equal(out.result.contact_types[1]!.create_form, 'form:contact:health_facility:create');
  assert.equal(out.result.contact_types[2]!.create_form, undefined);
  assert.equal(out.result.contact_types[2]!.edit_form, undefined);
});

test('§A3 — name_key follows the contact.type.<id> convention for every row', () => {
  const out = buildQuickHierarchy(ASCII_INPUT_2_PLACES);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.result.contact_types[0]!.name_key, 'contact.type.district');
  assert.equal(out.result.contact_types[1]!.name_key, 'contact.type.health_facility');
  assert.equal(out.result.contact_types[2]!.name_key, 'contact.type.person');
});

test('§A4 — single place + person (valid minimum)', () => {
  const out = buildQuickHierarchy({
    places: [lvl('Clinic')],
    person: lvl('Patient'),
    existing: [],
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.result.place_hierarchy_types, ['clinic']);
  assert.deepEqual(out.result.contact_types[1]!.parents, ['clinic']);
});

/* ====================== §B — slugify behaviour ========================== */

test('§B1 — slugify lowercases + replaces non-[a-z0-9_] runs with single underscore', () => {
  assert.equal(slugifyHierarchyId('Health Facility'), 'health_facility');
  assert.equal(slugifyHierarchyId('  Health  Facility  '), 'health_facility');
  assert.equal(slugifyHierarchyId('Sub-District (East)'), 'sub_district_east');
});

test('§B2 — slugify strips leading digits (id must start with alpha)', () => {
  assert.equal(slugifyHierarchyId('1st Level'), 'st_level');
  assert.equal(slugifyHierarchyId('2024 Cohort'), 'cohort');
});

test('§B3 — Devanagari produces empty derivation (caller surfaces explicit-id requirement)', () => {
  assert.equal(slugifyHierarchyId('जिल्ला'), '');
  assert.equal(slugifyHierarchyId('स्वास्थ्य संस्था'), '');
});

test('§B4 — explicit ASCII id wins over slugified name (Devanagari label OK with explicit id)', () => {
  const out = buildQuickHierarchy({
    places: [lvl('जिल्ला', 'district')],
    person: lvl('व्यक्ति', 'person'),
    existing: [],
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.result.contact_types[0]!.id, 'district');
  // place_types_display still carries the Devanagari label (Unicode preserved).
  assert.equal(out.result.place_types_display['district'], 'जिल्ला');
  assert.equal(out.result.contact_types[1]!.id, 'person');
});

/* ====================== §C — validation / blocks ======================== */

test('§C1 — slug COLLISION on derived id is a block error (never auto-suffix)', () => {
  // "Health Facility" and "health-facility" both → health_facility.
  const { errors } = validateQuickHierarchy({
    places: [lvl('Health Facility'), lvl('health-facility')],
    person: lvl('Person'),
    existing: [],
  });
  const dup = errors.find((e) => e.code === 'duplicate_id');
  assert.ok(dup, 'expected duplicate_id error');
  // The second row is the offender.
  assert.equal(dup!.row, 1);
});

test('§C2 — collision with an EXISTING contact type is blocked even if input is internally consistent', () => {
  const { errors } = validateQuickHierarchy({
    places: [lvl('District'), lvl('Clinic')],
    person: lvl('Person'),
    existing: [{ id: 'district', person: false }],
  });
  assert.ok(errors.some((e) => e.code === 'collision_with_existing' && e.row === 0));
});

test('§C3 — empty / whitespace-only name with no explicit id → empty_name', () => {
  const { errors } = validateQuickHierarchy({
    places: [lvl('   '), lvl('District')],
    person: lvl('Person'),
    existing: [],
  });
  assert.ok(errors.some((e) => e.code === 'empty_name' && e.row === 0));
});

test('§C4 — Devanagari label with NO explicit id surfaces devanagari_needs_id (not silent transliteration)', () => {
  const { errors } = validateQuickHierarchy({
    places: [lvl('जिल्ला')],
    person: lvl('व्यक्ति', 'person'),
    existing: [],
  });
  assert.ok(errors.some((e) => e.code === 'devanagari_needs_id' && e.row === 0));
});

test('§C5 — explicit id that does NOT match ^[a-z][a-z0-9_]*$ is rejected', () => {
  const { errors } = validateQuickHierarchy({
    places: [lvl('District', '1District'), lvl('Facility', 'Health-Facility')],
    person: lvl('Person'),
    existing: [],
  });
  assert.equal(errors.filter((e) => e.code === 'invalid_explicit_id').length, 2);
});

test('§C6 — duplicate FRIENDLY label across rows is a warning (different ids allowed if explicit)', () => {
  const { errors, warnings } = validateQuickHierarchy({
    places: [lvl('Ward', 'ward_a'), lvl('Ward', 'ward_b')],
    person: lvl('Person'),
    existing: [],
  });
  assert.equal(errors.length, 0, 'distinct ids → no errors');
  assert.ok(warnings.some((w) => w.code === 'duplicate_label' && w.row === 1));
});

test('§C7 — zero places is a build error, NOT a validation error (UI helper, not per-row)', () => {
  const out = buildQuickHierarchy({
    places: [],
    person: lvl('Person'),
    existing: [],
  });
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.ok(out.errors.some((e) => e.code === 'empty_name'));
});

test('§C8 — build re-runs validation; invalid input never produces a result', () => {
  const out = buildQuickHierarchy({
    places: [lvl('District'), lvl('District')],
    person: lvl('Person'),
    existing: [],
  });
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.ok(out.errors.some((e) => e.code === 'duplicate_id'));
});

/* ====================== §D — round-trip / idempotency =================== */

test('§D1 — build twice with the same input produces identical output (deterministic, no clocks)', () => {
  const a = buildQuickHierarchy(ASCII_INPUT_2_PLACES);
  const b = buildQuickHierarchy(ASCII_INPUT_2_PLACES);
  assert.deepEqual(a, b);
});

test('§D2 — JSON round-trip of the result preserves contact_types/place_hierarchy_types/place_types_display', () => {
  const out = buildQuickHierarchy(ASCII_INPUT_2_PLACES);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  const wire = JSON.parse(JSON.stringify(out.result));
  assert.deepEqual(wire, out.result);
});

test('§D3 — a 3-level chain has place_hierarchy_types in input order (no re-sort surprises)', () => {
  const out = buildQuickHierarchy({
    places: [lvl('Country'), lvl('District'), lvl('Facility')],
    person: lvl('Person'),
    existing: [],
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.result.place_hierarchy_types, ['country', 'district', 'facility']);
});

test('§D4 — person leaf is ALWAYS the last contact_types row, regardless of order', () => {
  const out = buildQuickHierarchy({
    places: [lvl('A'), lvl('B'), lvl('C')],
    person: lvl('Person'),
    existing: [],
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  const last = out.result.contact_types[out.result.contact_types.length - 1]!;
  assert.equal(last.person, true);
  assert.equal(last.id, 'person');
});

test('§D5 — Person leaf parents are EXACTLY [last place id] (the load-bearing linear assertion §5/§8)', () => {
  const out = buildQuickHierarchy({
    places: [lvl('A'), lvl('B'), lvl('C')],
    person: lvl('Person'),
    existing: [],
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  const personRow = out.result.contact_types[out.result.contact_types.length - 1]!;
  assert.deepEqual(personRow.parents, ['c']);
});
