/**
 * Unit tests for `deriveFormName` — the label-first form-basename helper.
 *
 * Pins the invariants from docs/handoff-improvement-notes-2026-07-29.md
 * §Note 1: title → valid XLSForm identifier, single underscore for
 * whitespace/punct runs, leading-digits/underscore stripped, Devanagari /
 * non-ASCII scripts that NFKD-drop to nothing return `''` (caller decides
 * fallback), and collision-avoidance via numeric suffix.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { deriveFormName } from './deriveFormName.js';

test('basic slugify: "Patient Age" → "patient_age"', () => {
  const out = deriveFormName('Patient Age');
  assert.equal(out.basename, 'patient_age');
  assert.equal(out.collided, false);
});

test('result matches the XLSForm identifier regex ^[a-z][a-z0-9_]*$', () => {
  const out = deriveFormName('Pregnancy Registration');
  assert.match(out.basename, /^[a-z][a-z0-9_]*$/);
});

test('whitespace / punctuation runs collapse to a single underscore', () => {
  assert.equal(deriveFormName('foo   bar!!!baz').basename, 'foo_bar_baz');
  assert.equal(deriveFormName('a-b.c/d').basename, 'a_b_c_d');
});

test('leading digits stripped so the first char is alphabetic', () => {
  // slugifyHierarchyId strips leading non-alpha; year prefix vanishes,
  // remainder starts with the first letter.
  assert.equal(deriveFormName('2024 Cohort').basename, 'cohort');
  assert.equal(deriveFormName('_leading_underscore').basename, 'leading_underscore');
});

test('Devanagari / non-ASCII with no [a-z0-9] after NFKD → empty string', () => {
  // Caller falls back to an explicit-id prompt when this returns ''.
  assert.equal(deriveFormName('गर्भावस्था').basename, '');
  assert.equal(deriveFormName('中文').basename, '');
  assert.equal(deriveFormName('日本語').basename, '');
});

test('mixed Latin + Devanagari keeps the Latin part', () => {
  assert.equal(deriveFormName('ANC गर्भावस्था visit').basename, 'anc_visit');
});

test('empty / whitespace-only input → empty string (no fabricated name)', () => {
  assert.equal(deriveFormName('').basename, '');
  assert.equal(deriveFormName('   ').basename, '');
  assert.equal(deriveFormName('!!!').basename, '');
});

test('collision: appends the smallest numeric suffix that is not in `existing`', () => {
  const out = deriveFormName('Patient Age', ['patient_age']);
  assert.equal(out.basename, 'patient_age_2');
  assert.equal(out.collided, true);
});

test('collision: skips already-taken suffixes', () => {
  const out = deriveFormName('foo', ['foo', 'foo_2', 'foo_3']);
  assert.equal(out.basename, 'foo_4');
  assert.equal(out.collided, true);
});

test('no collision when the slug is unique: collided=false', () => {
  const out = deriveFormName('Fresh Form', ['patient_age', 'household_visit']);
  assert.equal(out.basename, 'fresh_form');
  assert.equal(out.collided, false);
});

test('empty derivation stays empty even with `existing` — never fabricates', () => {
  const out = deriveFormName('中文', ['patient_age']);
  assert.equal(out.basename, '');
  assert.equal(out.collided, false);
});

test('numeric title alone → empty (leading-digit strip eats everything)', () => {
  assert.equal(deriveFormName('2024').basename, '');
});

/* ============ allowHyphens — CHT contact-form naming (audit P0-2) ============ */

test('allowHyphens: "Household — create" → "household-create" (em dash)', () => {
  const out = deriveFormName('Household — create', [], { allowHyphens: true });
  assert.equal(out.basename, 'household-create');
});

test('allowHyphens: ASCII hyphen and en dash also act as segment separators', () => {
  assert.equal(deriveFormName('patient-edit', [], { allowHyphens: true }).basename, 'patient-edit');
  assert.equal(deriveFormName('Ward – create', [], { allowHyphens: true }).basename, 'ward-create');
});

test('allowHyphens: segments slugify independently (spaces/punct inside a segment → _)', () => {
  assert.equal(
    deriveFormName('Health Facility - create form', [], { allowHyphens: true }).basename,
    'health_facility-create_form',
  );
});

test('allowHyphens: empty segments dropped (leading/trailing/double hyphens collapse)', () => {
  assert.equal(deriveFormName('-patient--create-', [], { allowHyphens: true }).basename, 'patient-create');
});

test('allowHyphens: default OFF — app forms still fold hyphens to underscore', () => {
  assert.equal(deriveFormName('patient-edit').basename, 'patient_edit');
});

test('allowHyphens: collision suffix still applies', () => {
  const out = deriveFormName('household-create', ['household-create'], { allowHyphens: true });
  assert.equal(out.basename, 'household-create_2');
  assert.equal(out.collided, true);
});
