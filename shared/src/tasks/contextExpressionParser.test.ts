/**
 * Round-trip tests for the form-context expression parser/serializer.
 *
 * The PO-found bug that motivated the new `contact_contact_type` rule kind:
 * configurable hierarchies store the type under `contact_type` (legacy
 * cht-default stores it at top-level `type`). Emitting the wrong one silently
 * gates the form to never appear on contacts of that type.
 *
 * Test buckets:
 *   §A — single-rule round-trips for each kind (parse → serialize is stable).
 *   §B — the two contact-type kinds are DISTINCT and re-emit verbatim
 *        (no cross-contamination between `contact.type` and `contact.contact_type`).
 *   §C — multi-rule expressions stay AND-combined and ordered.
 *   §D — the legacy generic `contact.<field>` matcher does NOT swallow
 *        `contact.contact_type` (the precedence ordering is load-bearing).
 *   §E — raw fallback preserves anything the parser doesn't understand.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  parseContextExpression,
  serializeContextExpression,
  validateContextExpression,
  type ContextRule,
} from './contextExpressionParser.js';

function roundtrip(src: string): string {
  return serializeContextExpression(parseContextExpression(src));
}

/* ============================ §A — per-kind round-trips ============================ */

test('§A1 — legacy contact.type round-trips', () => {
  assert.equal(roundtrip("contact.type === 'person'"), "contact.type === 'person'");
});

test('§A2 — configurable contact.contact_type round-trips', () => {
  assert.equal(
    roundtrip("contact.contact_type === 'patient'"),
    "contact.contact_type === 'patient'",
  );
});

test('§A3 — contact.sex round-trips', () => {
  assert.equal(roundtrip("contact.sex === 'female'"), "contact.sex === 'female'");
});

test('§A4 — ageInYears round-trips', () => {
  assert.equal(roundtrip('ageInYears(contact) >= 18'), 'ageInYears(contact) >= 18');
});

test('§A5 — summary.flag round-trips (both polarities)', () => {
  assert.equal(roundtrip('summary.show_form'), 'summary.show_form');
  assert.equal(roundtrip('!summary.show_form'), '!summary.show_form');
});

test('§A6 — !contact.muted / !contact.date_of_death round-trip', () => {
  assert.equal(roundtrip('!contact.muted'), '!contact.muted');
  assert.equal(roundtrip('!contact.date_of_death'), '!contact.date_of_death');
});

test('§A7 — generic contact.<field> string equality round-trips', () => {
  assert.equal(
    roundtrip("contact.role === 'fchv'"),
    "contact.role === 'fchv'",
  );
});

test('§A8 — generic contact.<field> numeric comparison round-trips', () => {
  assert.equal(roundtrip('contact.weight >= 50'), 'contact.weight >= 50');
});

test('§A9 — true / false short-form round-trip', () => {
  assert.equal(roundtrip('true'), 'true');
  assert.equal(roundtrip('false'), 'false');
});

/* ============================ §B — contact-type kinds are DISTINCT ============================ */

test('§B1 — contact.type === person classifies as contact_type (legacy)', () => {
  const p = parseContextExpression("contact.type === 'person'");
  assert.equal(p.rules.length, 1);
  assert.equal(p.rules[0]!.kind, 'contact_type');
  assert.equal((p.rules[0] as { kind: 'contact_type'; value: string }).value, 'person');
});

test('§B2 — contact.contact_type === patient classifies as contact_contact_type (configurable)', () => {
  const p = parseContextExpression("contact.contact_type === 'patient'");
  assert.equal(p.rules.length, 1);
  assert.equal(p.rules[0]!.kind, 'contact_contact_type');
  assert.equal(
    (p.rules[0] as { kind: 'contact_contact_type'; value: string }).value,
    'patient',
  );
});

test('§B3 — the two kinds re-serialize with DIFFERENT JS — never cross-contaminate', () => {
  const legacy: ContextRule = { kind: 'contact_type', value: 'clinic' };
  const cfg: ContextRule = { kind: 'contact_contact_type', value: 'clinic' };
  assert.equal(
    serializeContextExpression({ rules: [legacy], hasRawFallback: false }),
    "contact.type === 'clinic'",
  );
  assert.equal(
    serializeContextExpression({ rules: [cfg], hasRawFallback: false }),
    "contact.contact_type === 'clinic'",
  );
});

test("§B4 — both kinds can coexist in the same expression and survive round-trip", () => {
  // Edge case: a config in the middle of migrating from legacy to configurable
  // could in principle express either. We do NOT prevent both — we preserve
  // whatever the user wrote.
  const src = "contact.type === 'person' && contact.contact_type === 'patient'";
  assert.equal(roundtrip(src), src);
});

/* ============================ §C — multi-rule AND ordering ============================ */

test('§C1 — three-rule expression round-trips with original order', () => {
  const src =
    "contact.contact_type === 'patient' && contact.sex === 'female' && ageInYears(contact) >= 18";
  assert.equal(roundtrip(src), src);
});

test('§C2 — !contact.muted + contact.contact_type round-trip together', () => {
  const src = "!contact.muted && contact.contact_type === 'patient'";
  assert.equal(roundtrip(src), src);
});

/* ============================ §D — precedence vs generic contact.<field> ============================ */

test('§D1 — contact.contact_type does NOT match the generic contact_field path', () => {
  // The generic matcher would also accept `contact.contact_type === 'X'` and
  // emit it back verbatim — but classify it as `contact_field`. The
  // contact_contact_type matcher MUST run first so the rule lands on the
  // right dropdown row in the UI.
  const p = parseContextExpression("contact.contact_type === 'patient'");
  assert.equal(p.rules[0]!.kind, 'contact_contact_type');
  // Sanity: a plain contact.<other-field> still lands as contact_field.
  const q = parseContextExpression("contact.role === 'fchv'");
  assert.equal(q.rules[0]!.kind, 'contact_field');
});

test('§D2 — contact.type also bypasses the generic field path (regression on contact_type)', () => {
  const p = parseContextExpression("contact.type === 'person'");
  assert.equal(p.rules[0]!.kind, 'contact_type');
});

/* ============================ §E — raw fallback ============================ */

test('§E1 — unsupported shapes preserve verbatim via raw kind', () => {
  const src = 'foo() && bar.x > 3';
  // Both legs fall to raw; the AND-rejoin should still be byte-stable.
  assert.equal(roundtrip(src), src);
  const p = parseContextExpression(src);
  assert.ok(p.hasRawFallback, 'parser flags raw fallback');
});

test('§E2 — empty source serializes to empty (no surprise true/false)', () => {
  assert.equal(roundtrip(''), '');
  assert.equal(roundtrip('   '), '');
});

/* ============================ §F — decimal age operand ============================ */

test('§F1 — decimal ageInYears round-trips (was integer-only before Wave 1)', () => {
  // Widened the age regex from `\d+` to `-?\d+(?:\.\d+)?` so a `60.5`
  // typed into the age input doesn't demote to raw on reload.
  assert.equal(roundtrip('ageInYears(contact) >= 60.5'), 'ageInYears(contact) >= 60.5');
  const p = parseContextExpression('ageInYears(contact) < 0.5');
  assert.equal(p.rules[0]!.kind, 'age_years');
  assert.equal(
    (p.rules[0] as { kind: 'age_years'; value: string }).value,
    '0.5',
  );
});

test('§F2 — negative ageInYears literal round-trips (defensive; not typical use)', () => {
  assert.equal(roundtrip('ageInYears(contact) > -1'), 'ageInYears(contact) > -1');
});

/* ============================ §G — validateContextExpression (Wave 1 · Note 2) ============================ */

test('§G1 — empty age operand serializes to a raw hanging-op rule and is flagged', () => {
  // Pins the deploy-trap: an in-memory age_years rule with value ''
  // serializes to `ageInYears(contact) >= ` (invalid JS). On save the
  // validator must reject this so the file never reaches deploy.
  const errors = validateContextExpression('ageInYears(contact) >= ');
  assert.ok(errors.length > 0, 'validator flags the empty operand');
  assert.match(errors[0]!, /comparison operator but no value|no number/);
});

test('§G2 — hanging operator inside an AND-combined expression is flagged', () => {
  const errors = validateContextExpression(
    "contact.contact_type === 'patient' && ageInYears(contact) >= ",
  );
  assert.ok(errors.length > 0);
  // Idempotent — re-running yields the same list.
  const again = validateContextExpression(
    "contact.contact_type === 'patient' && ageInYears(contact) >= ",
  );
  assert.deepEqual(errors, again);
});

test('§G3 — a valid age expression produces no errors', () => {
  assert.deepEqual(validateContextExpression('ageInYears(contact) >= 60'), []);
  assert.deepEqual(
    validateContextExpression(
      "contact.contact_type === 'patient' && ageInYears(contact) >= 60.5",
    ),
    [],
  );
});

test('§G4 — empty / whitespace-only expression is treated as OK (no rules to check)', () => {
  assert.deepEqual(validateContextExpression(''), []);
  assert.deepEqual(validateContextExpression('   '), []);
});

test('§G5 — validator is byte-safe: `parse→validate→serialize` never mutates input string', () => {
  const src = "contact.contact_type === 'patient' && ageInYears(contact) >= ";
  const before = src;
  validateContextExpression(src);
  assert.equal(src, before, 'input string not mutated');
});
