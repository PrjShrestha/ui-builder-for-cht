/**
 * Phase 1b — round-trip tests for the two new Rule kinds in
 * relevantParser.ts (form-data-passing.md §3 Phase 1):
 *   - ContactInputComparisonRule  (`../inputs/contact/<field>` LHS)
 *   - ContactSummaryComparisonRule (`instance('contact-summary')/context/<key>` LHS,
 *      optionally `once(...)` or `if(ref,ref,.)`)
 *
 * Three buckets per the synthesis brief:
 *   - Bucket A: canonical strings parse to the structured kind AND
 *     serialize back byte-identical (the §3.1 self-check guarantee).
 *   - Bucket B: clauses that LOOK like our kinds but diverge in spacing
 *     or shape demote to `raw` so the bytes are preserved as-is.
 *   - Bucket C: edge cases — mismatched fallback wrapper refs, nested
 *     paths, both `!= ''` (string) and `!= 0` (numeric) variants.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseRelevant, serializeRelevant } from './relevantParser.js';

/* ============================ helpers ============================ */

/** Round-trip a single clause: parse, serialize, assert byte-identical
 *  AND structurally identical. */
function pinRoundTrip(input: string, expectedKind: string): void {
  const parsed = parseRelevant(input);
  assert.equal(parsed.rules.length, 1, `single-clause expected for ${input}`);
  const first = parsed.rules[0]!;
  assert.equal(
    first.kind,
    expectedKind,
    `expected kind ${expectedKind} for ${input}, got ${first.kind}`,
  );
  const reserialized = serializeRelevant(parsed);
  assert.equal(
    reserialized,
    input,
    `byte-identity broke: ${JSON.stringify(input)} → ${JSON.stringify(reserialized)}`,
  );
}

/** Round-trip a clause that should DEMOTE to raw (the §3.1 self-check
 *  catches any non-canonical input). The output bytes are preserved
 *  unchanged. */
function pinRawDemotion(input: string): void {
  const parsed = parseRelevant(input);
  assert.equal(parsed.rules.length, 1);
  assert.equal(parsed.rules[0]!.kind, 'raw', `${input} should demote to raw`);
  assert.equal(serializeRelevant(parsed), input, 'raw demotion must preserve bytes');
}

/* ====================== BUCKET A — canonical ===================== */

test('contact-input — string comparison: `../inputs/contact/sex = \'female\'`', () => {
  pinRoundTrip(`../inputs/contact/sex = 'female'`, 'contact-input-comparison');
});

test('contact-input — numeric comparison: `../inputs/contact/age >= 18`', () => {
  pinRoundTrip(`../inputs/contact/age >= 18`, 'contact-input-comparison');
});

test('contact-input — answered-style: `../inputs/contact/patient_id != \'\'`', () => {
  pinRoundTrip(`../inputs/contact/patient_id != ''`, 'contact-input-comparison');
});

test('contact-summary bare — `instance(\'contact-summary\')/context/show_pregnancy = \'true\'`', () => {
  pinRoundTrip(
    `instance('contact-summary')/context/show_pregnancy = 'true'`,
    'contact-summary-comparison',
  );
});

test('contact-summary read-once — `once(instance(\'contact-summary\')/context/lmp_date_8601) != 0`', () => {
  pinRoundTrip(
    `once(instance('contact-summary')/context/lmp_date_8601) != 0`,
    'contact-summary-comparison',
  );
});

test('contact-summary fallback-to-current with MATCHING refs round-trips', () => {
  pinRoundTrip(
    `if(instance('contact-summary')/context/previous_bmi, instance('contact-summary')/context/previous_bmi, .) > 25`,
    'contact-summary-comparison',
  );
});

/* ============== BUCKET B — spacing / shape divergence ============ */

test('contact-input with extra whitespace inside the path → raw (regex is strict)', () => {
  // The CONTACT_INPUT_RE in calcReference.ts is anchored + has no
  // whitespace inside the path; anything spacing-divergent inside the
  // prefix slips past recognizeReference and stays raw.
  pinRawDemotion(`../inputs/contact / sex = 'female'`);
});

test('contact-summary with double-quoted instance name → raw (only single quotes recognized)', () => {
  pinRawDemotion(`instance("contact-summary")/context/show_pregnancy = 'true'`);
});

/* =================== BUCKET C — edge cases ======================= */

test('contact-summary fallback wrapper with MISMATCHED refs falls through (intentional non-wrapper)', () => {
  // calcReference.ts:126 explicitly checks ref equality — non-matching
  // variants like nssd's `avg_result_ctx` cell are intentionally
  // SEMANTICALLY different and MUST survive verbatim. Some upstream
  // ops (combinators, parens) will let this pass — but as a clause
  // alone the recognizer returns null and the LHS-as-`${...}` regex
  // doesn't match either, so it falls to raw.
  pinRawDemotion(
    `if(instance('contact-summary')/context/a, instance('contact-summary')/context/b, .) > 25`,
  );
});

test('contact-input vs contact-summary — both string AND numeric variants are preserved per-clause', () => {
  // valueIsString must round-trip exactly. A common real-world
  // anti-pattern: forms gate on `!= 0` (numeric, returns nothing if
  // the ctx flag is unset) AND `!= ''` (string, returns '' if unset).
  // Auto-normalizing to one form would break hundreds of cells.
  pinRoundTrip(
    `instance('contact-summary')/context/x != 0`,
    'contact-summary-comparison',
  );
  pinRoundTrip(
    `instance('contact-summary')/context/x != ''`,
    'contact-summary-comparison',
  );
});

test('nested context key with hyphen — `instance(\'contact-summary\')/context/has-tb = \'yes\'`', () => {
  // Hyphens are allowed in context keys (CHT convention).
  pinRoundTrip(
    `instance('contact-summary')/context/has-tb = 'yes'`,
    'contact-summary-comparison',
  );
});

/* ========== combined with existing AND/OR chain support ========== */

test('contact-input ANDed with same-form comparison round-trips', () => {
  const input = `\${age} >= 18 and ../inputs/contact/sex = 'female'`;
  const parsed = parseRelevant(input);
  assert.equal(parsed.rules.length, 2);
  assert.equal(parsed.rules[0]!.kind, 'comparison');
  assert.equal(parsed.rules[1]!.kind, 'contact-input-comparison');
  assert.equal(serializeRelevant(parsed), input);
});

test('contact-summary ORed with selected() round-trips', () => {
  const input = `instance('contact-summary')/context/show_form = 'true' or selected(\${conditions}, 'hbp')`;
  const parsed = parseRelevant(input);
  assert.equal(parsed.combinator, 'or');
  assert.equal(parsed.rules.length, 2);
  assert.equal(parsed.rules[0]!.kind, 'contact-summary-comparison');
  assert.equal(parsed.rules[1]!.kind, 'selected');
  assert.equal(serializeRelevant(parsed), input);
});
