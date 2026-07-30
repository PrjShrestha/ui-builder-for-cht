/**
 * Unit tests for `resolveCreateFormBasename` — the pure client↔server
 * collision-resolution helper behind POST /api/forms/create.
 *
 * Regression pin for docs/handoff-waves-1-3-2026-07-29.md §Wave 1 · 1:
 * the client's `FormsIndex.doCreate` already runs
 * `deriveFormName(title, existingBasenamesInCategory)` — creating
 * "Patient Age" a second time yields `patient_age_2`. The old server
 * route did `source = title ?? basename; deriveFormName(source)`
 * WITHOUT the `existing` set, which collapsed the `_2` back to
 * `patient_age` and tripped the 409 guard. This test locks in the
 * corrected handshake:
 *   - a client-resolved `basename` is honoured verbatim
 *     (defensively re-slugified),
 *   - a title-only legacy caller still gets a `_2` suffix because we
 *     fold the on-disk basenames into the `existing` set.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveCreateFormBasename } from './forms.js';

test('client-resolved basename is honoured verbatim (no re-derive from title)', () => {
  // Client saw `patient_age.xlsx` on disk and resolved `patient_age_2`.
  // The server MUST NOT collapse this back to `patient_age`.
  const out = resolveCreateFormBasename('Patient Age', 'patient_age_2', ['patient_age']);
  assert.ok(!('error' in out));
  assert.equal(out.basename, 'patient_age_2');
  assert.equal(out.humanTitle, 'Patient Age');
});

test('client-resolved basename is defensively re-slugified (never trust raw text)', () => {
  // Older / malicious caller sent raw user text as `basename`; we
  // slugify rather than reject so cold-start typing doesn't hit a 400.
  const out = resolveCreateFormBasename('Patient Age', 'Patient Age!', []);
  assert.ok(!('error' in out));
  assert.equal(out.basename, 'patient_age');
});

test('title-only legacy caller: collision still gets numeric suffix from `existing`', () => {
  // The bug: title-only path previously ignored `existing`. Now it must
  // suffix so a second "Patient Age" from a legacy client also lands
  // as `patient_age_2` and NOT a 409.
  const out = resolveCreateFormBasename('Patient Age', undefined, ['patient_age']);
  assert.ok(!('error' in out));
  assert.equal(out.basename, 'patient_age_2');
});

test('title-only, no collisions → plain slug', () => {
  const out = resolveCreateFormBasename('Pregnancy Registration', undefined, []);
  assert.ok(!('error' in out));
  assert.equal(out.basename, 'pregnancy_registration');
  assert.equal(out.humanTitle, 'Pregnancy Registration');
});

test('basename-only (no title) → basename doubles as the friendly title', () => {
  const out = resolveCreateFormBasename(undefined, 'household_visit', []);
  assert.ok(!('error' in out));
  assert.equal(out.basename, 'household_visit');
  assert.equal(out.humanTitle, 'household_visit');
});

test('empty title AND empty basename → error (no fabricated name)', () => {
  const out = resolveCreateFormBasename('', '', []);
  assert.ok('error' in out);
  assert.match(out.error, /title or basename is required/);
});

test('undefined title AND undefined basename → error', () => {
  const out = resolveCreateFormBasename(undefined, undefined, []);
  assert.ok('error' in out);
  assert.match(out.error, /title or basename is required/);
});

test('title-only Devanagari with no ASCII fallback → error', () => {
  // Preserves the caller-side error message so the UI can point the
  // user at explicitly typing a Latin word.
  const out = resolveCreateFormBasename('गर्भावस्था', undefined, []);
  assert.ok('error' in out);
  assert.match(out.error, /Could not derive a filename/);
});

test('basename that slugifies to empty → error (raw text with no ASCII)', () => {
  const out = resolveCreateFormBasename(undefined, '中文', []);
  assert.ok('error' in out);
  assert.match(out.error, /Could not derive a filename/);
});

test('client basename wins over title even when title would slug differently', () => {
  // Guard against "server re-derives from title" regression: the client
  // may deliberately have chosen a different basename (rename flow, or
  // an explicit override in a future advanced UI).
  const out = resolveCreateFormBasename('Some Friendly Name', 'anc_v2', ['anc']);
  assert.ok(!('error' in out));
  assert.equal(out.basename, 'anc_v2');
  assert.equal(out.humanTitle, 'Some Friendly Name');
});

test('title trim: leading/trailing whitespace ignored for the empty check', () => {
  const out = resolveCreateFormBasename('  ', '', []);
  assert.ok('error' in out);
  assert.match(out.error, /title or basename is required/);
});

/* ============ contact category preserves hyphens (audit P0-2) ============ */

test('contact category: client basename with hyphens survives the defensive re-slug', () => {
  // CHT contact forms MUST land as <type>-create.xlsx; the app-category
  // slug folds `-` to `_`, which broke manual contact-form creation.
  const out = resolveCreateFormBasename('Household — create', 'household-create', [], 'contact');
  assert.ok(!('error' in out));
  assert.equal(out.basename, 'household-create');
});

test('contact category: title-only path also derives with hyphens', () => {
  const out = resolveCreateFormBasename('Household — create', undefined, [], 'contact');
  assert.ok(!('error' in out));
  assert.equal(out.basename, 'household-create');
});

test('app category (default): hyphens still fold to underscore', () => {
  const out = resolveCreateFormBasename(undefined, 'patient-edit', []);
  assert.ok(!('error' in out));
  assert.equal(out.basename, 'patient_edit');
});
