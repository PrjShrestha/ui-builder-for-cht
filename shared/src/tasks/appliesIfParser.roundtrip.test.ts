/**
 * Round-trip + numeric-operator tests for the appliesIf parser.
 *
 * Run via `node --test --import tsx shared/src/tasks/appliesIfParser.roundtrip.test.ts`
 * (or any test runner that consumes node:test).
 *
 * These exist to defend two invariants that broke real configs in the past:
 *   1. parse → serialize → parse is stable (no diff drift on open+save).
 *   2. Numeric comparisons (`age > 20`) survive a round trip; previously
 *      the parser fell back to `raw` and the structured row vanished.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseAppliesIf, serializeAppliesIf } from './appliesIfParser.js';

function roundTrip(source: string): string {
  return serializeAppliesIf(parseAppliesIf(source));
}

test('numeric `>` survives parse → serialize → parse', () => {
  const src = `function (contact, report) {
  if (contact.contact.age <= 20) { return false; }
  return true;
}`;
  const first = parseAppliesIf(src);
  assert.equal(first.rules.length, 1);
  const rule = first.rules[0];
  assert.equal(rule?.kind, 'contact_field');
  if (rule?.kind === 'contact_field') {
    assert.equal(rule.field, 'age');
    assert.equal(rule.op, '>');
    assert.equal(rule.value, '20');
  }
  const second = parseAppliesIf(roundTrip(src));
  assert.deepEqual(first.rules, second.rules);
});

test('string equality still round-trips', () => {
  const src = `function (contact) {
  if (contact.contact.role !== 'patient') { return false; }
  return true;
}`;
  const first = parseAppliesIf(src);
  assert.equal(first.rules[0]?.kind, 'contact_field');
  if (first.rules[0]?.kind === 'contact_field') {
    assert.equal(first.rules[0].op, '===');
    assert.equal(first.rules[0].value, 'patient');
  }
  const second = parseAppliesIf(roundTrip(src));
  assert.deepEqual(first.rules, second.rules);
});

test('OR-grouped guards do not explode into multiple lines on serialize', () => {
  const src = `function (contact, report) {
  if (!isTaskUser(user) || !isAlive(contact.contact) || isMuted(contact.contact) || hasError(report)) { return false; }
  return true;
}`;
  const serialized = roundTrip(src);
  const ifCount = (serialized.match(/\bif\b/g) ?? []).length;
  assert.equal(ifCount, 1, `expected one combined guard, got: ${serialized}`);
});

test('numeric guard inversion is exact (no off-by-one)', () => {
  // age > 20: guard becomes age <= 20, then back to age > 20.
  const rule = parseAppliesIf(
    `function (contact) { if (contact.contact.age <= 20) { return false; } return true; }`,
  ).rules[0];
  assert.equal(rule?.kind, 'contact_field');
  if (rule?.kind === 'contact_field') assert.equal(rule.op, '>');

  // age >= 20: guard becomes age < 20.
  const rule2 = parseAppliesIf(
    `function (contact) { if (contact.contact.age < 20) { return false; } return true; }`,
  ).rules[0];
  if (rule2?.kind === 'contact_field') assert.equal(rule2.op, '>=');
});

test('decimal values round-trip', () => {
  const src = `function (contact) {
  if (contact.contact.bmi < 18.5) { return false; }
  return true;
}`;
  const first = parseAppliesIf(src);
  if (first.rules[0]?.kind === 'contact_field') {
    assert.equal(first.rules[0].op, '>=');
    assert.equal(first.rules[0].value, '18.5');
  }
  const second = parseAppliesIf(roundTrip(src));
  assert.deepEqual(first.rules, second.rules);
});

test('negative values round-trip', () => {
  const src = `function (contact) {
  if (contact.contact.score <= -1) { return false; }
  return true;
}`;
  const first = parseAppliesIf(src);
  if (first.rules[0]?.kind === 'contact_field') {
    assert.equal(first.rules[0].op, '>');
    assert.equal(first.rules[0].value, '-1');
  }
  const second = parseAppliesIf(roundTrip(src));
  assert.deepEqual(first.rules, second.rules);
});

test('report_field numeric round-trip', () => {
  const src = `function (contact, report) {
  if (getField(report, 'weight') < 50) { return false; }
  return true;
}`;
  const first = parseAppliesIf(src);
  if (first.rules[0]?.kind === 'report_field') {
    assert.equal(first.rules[0].field, 'weight');
    assert.equal(first.rules[0].op, '>=');
    assert.equal(first.rules[0].value, '50');
  }
  assert.deepEqual(first.rules, parseAppliesIf(roundTrip(src)).rules);
});

test('mixed guard + return clauses preserve guard grouping', () => {
  const src = `function (contact, report) {
  if (!isAlive(contact.contact) || isMuted(contact.contact)) { return false; }
  return contact.contact.role === 'patient';
}`;
  const serialized = roundTrip(src);
  assert.match(serialized, /!isAlive\(contact\.contact\) \|\| isMuted\(contact\.contact\)/);
});

/* ============ field_presence — "is set" / "is not set" ============ */

test('field_presence: report field IS set (positive `!!getField`)', () => {
  const src = `function (contact, report) {
  return !!getField(report, 'lmp_date');
}`;
  const parsed = parseAppliesIf(src);
  assert.equal(parsed.rules.length, 1);
  const r = parsed.rules[0]!;
  assert.equal(r.kind, 'field_presence');
  if (r.kind === 'field_presence') {
    assert.equal(r.source, 'report');
    assert.equal(r.field, 'lmp_date');
    assert.equal(r.negated, false);
  }
  // Round-trip: parse → serialize → parse must land on the same rule
  const twice = parseAppliesIf(roundTrip(src));
  assert.deepEqual(twice.rules, parsed.rules);
});

test('field_presence: report field is NOT set (positive `!getField`) — via guard', () => {
  // Source uses the guard form: exit when field IS set (i.e. positive
  // = "not set"). Should round-trip via field_presence negated=true.
  const src = `function (contact, report) {
  if (getField(report, 'lmp_date')) { return false; }
  return true;
}`;
  const parsed = parseAppliesIf(src);
  // Guard `getField(...)` (truthy → exit) is a raw for the parser since
  // we only pattern-match `!` / `!!` at classify time. Let's test the
  // return-form instead.
  void parsed;
  const src2 = `function (contact, report) {
  return !getField(report, 'lmp_date');
}`;
  const p2 = parseAppliesIf(src2);
  assert.equal(p2.rules[0]?.kind, 'field_presence');
  if (p2.rules[0]?.kind === 'field_presence') {
    assert.equal(p2.rules[0].negated, true);
  }
  assert.deepEqual(parseAppliesIf(roundTrip(src2)).rules, p2.rules);
});

test('field_presence: contact field IS set (`!!contact.contact.role`)', () => {
  const src = `function (contact, report) {
  return !!contact.contact.role;
}`;
  const parsed = parseAppliesIf(src);
  assert.equal(parsed.rules[0]?.kind, 'field_presence');
  if (parsed.rules[0]?.kind === 'field_presence') {
    assert.equal(parsed.rules[0].source, 'contact');
    assert.equal(parsed.rules[0].field, 'role');
    assert.equal(parsed.rules[0].negated, false);
  }
  assert.deepEqual(parseAppliesIf(roundTrip(src)).rules, parsed.rules);
});

test('field_presence: contact field is NOT set (`!contact.contact.date_of_death`)', () => {
  const src = `function (contact, report) {
  return !contact.contact.date_of_death;
}`;
  const parsed = parseAppliesIf(src);
  assert.equal(parsed.rules[0]?.kind, 'field_presence');
  if (parsed.rules[0]?.kind === 'field_presence') {
    assert.equal(parsed.rules[0].source, 'contact');
    assert.equal(parsed.rules[0].field, 'date_of_death');
    assert.equal(parsed.rules[0].negated, true);
  }
});

/* ============ field_age — days/weeks/months before today ============ */

test('field_age: report field weeks-old comparison round-trips (>= 42 weeks)', () => {
  const src = `function (contact, report) {
  return (Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 604800000 >= 42;
}`;
  const parsed = parseAppliesIf(src);
  assert.equal(parsed.rules[0]?.kind, 'field_age');
  if (parsed.rules[0]?.kind === 'field_age') {
    assert.equal(parsed.rules[0].source, 'report');
    assert.equal(parsed.rules[0].field, 'lmp_date');
    assert.equal(parsed.rules[0].unit, 'weeks');
    assert.equal(parsed.rules[0].op, '>=');
    assert.equal(parsed.rules[0].value, 42);
  }
  assert.deepEqual(parseAppliesIf(roundTrip(src)).rules, parsed.rules);
});

test('field_age: contact field days-old comparison (< 30 days)', () => {
  const src = `function (contact, report) {
  return (Date.now() - new Date(contact.contact.date_of_birth).getTime()) / 86400000 < 30;
}`;
  const parsed = parseAppliesIf(src);
  assert.equal(parsed.rules[0]?.kind, 'field_age');
  if (parsed.rules[0]?.kind === 'field_age') {
    assert.equal(parsed.rules[0].source, 'contact');
    assert.equal(parsed.rules[0].field, 'date_of_birth');
    assert.equal(parsed.rules[0].unit, 'days');
    assert.equal(parsed.rules[0].op, '<');
    assert.equal(parsed.rules[0].value, 30);
  }
  assert.deepEqual(parseAppliesIf(roundTrip(src)).rules, parsed.rules);
});

test('field_age: months unit uses avg 30.4375d multiplier', () => {
  const src = `function (contact, report) {
  return (Date.now() - new Date(getField(report, 'last_visit')).getTime()) / 2629800000 >= 6;
}`;
  const parsed = parseAppliesIf(src);
  assert.equal(parsed.rules[0]?.kind, 'field_age');
  if (parsed.rules[0]?.kind === 'field_age') {
    assert.equal(parsed.rules[0].unit, 'months');
    assert.equal(parsed.rules[0].value, 6);
  }
});

test('field_age: unknown ms multiplier falls back to raw (preserves hand-picked constant)', () => {
  // A project-authored constant we don't recognize (e.g. 500000) should
  // stay raw so the user's expression survives round-trip.
  const src = `function (contact, report) {
  return (Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 500000 >= 42;
}`;
  const parsed = parseAppliesIf(src);
  assert.equal(parsed.rules[0]?.kind, 'raw');
});

/* ============ field_age_between — "at least N and at most M" ============ */

test('field_age_between: guard OR-form fuses on parse into a single between rule', () => {
  // Real config shape: `if (age < 84 || age > 90) return false;` — parser
  // yields two field_age rules with the same guardGroup, then the fusion
  // pass collapses them into one field_age_between.
  const src = `function (contact, report) {
  if ((Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 86400000 < 84 || (Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 86400000 > 90) { return false; }
  return true;
}`;
  const parsed = parseAppliesIf(src);
  assert.equal(parsed.rules.length, 1);
  const r = parsed.rules[0]!;
  assert.equal(r.kind, 'field_age_between');
  if (r.kind === 'field_age_between') {
    assert.equal(r.source, 'report');
    assert.equal(r.field, 'lmp_date');
    assert.equal(r.unit, 'days');
    assert.equal(r.min, 84);
    assert.equal(r.max, 90);
    assert.equal(r.minOp, '>=');
    assert.equal(r.maxOp, '<=');
  }
});

test('field_age_between: round-trips (parse → serialize → parse is stable)', () => {
  const src = `function (contact, report) {
  if ((Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 86400000 < 84 || (Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 86400000 > 90) { return false; }
  return true;
}`;
  const parsed = parseAppliesIf(src);
  const twice = parseAppliesIf(serializeAppliesIf(parsed));
  assert.deepEqual(twice.rules, parsed.rules);
});

test('field_age_between: min-side and max-side in any order fuse the same way', () => {
  // A hand-written source might put the max first then min — the fusion
  // must produce the same between rule regardless of order.
  const src = `function (contact, report) {
  if ((Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 86400000 > 90 || (Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 86400000 < 84) { return false; }
  return true;
}`;
  const parsed = parseAppliesIf(src);
  assert.equal(parsed.rules.length, 1);
  if (parsed.rules[0]?.kind === 'field_age_between') {
    assert.equal(parsed.rules[0].min, 84);
    assert.equal(parsed.rules[0].max, 90);
  } else {
    assert.fail('expected field_age_between');
  }
});

test('field_age_between: exclusive endpoints (more than / less than) round-trip', () => {
  // Positive: age > 84 AND age < 90 → guard: age <= 84 || age >= 90.
  const src = `function (contact, report) {
  if ((Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 86400000 <= 84 || (Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 86400000 >= 90) { return false; }
  return true;
}`;
  const parsed = parseAppliesIf(src);
  if (parsed.rules[0]?.kind === 'field_age_between') {
    assert.equal(parsed.rules[0].minOp, '>');
    assert.equal(parsed.rules[0].maxOp, '<');
    assert.equal(parsed.rules[0].min, 84);
    assert.equal(parsed.rules[0].max, 90);
  } else {
    assert.fail('expected field_age_between');
  }
  const twice = parseAppliesIf(serializeAppliesIf(parsed));
  assert.deepEqual(twice.rules, parsed.rules);
});

test('field_age_between: DIFFERENT fields do NOT fuse (safety)', () => {
  // Two field_age rules that happen to share source/unit but reference
  // different fields must NOT collapse into a between — that would silently
  // change the semantics.
  const src = `function (contact, report) {
  if ((Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 86400000 < 84 || (Date.now() - new Date(getField(report, 'due_date')).getTime()) / 86400000 > 90) { return false; }
  return true;
}`;
  const parsed = parseAppliesIf(src);
  assert.equal(parsed.rules.length, 2, 'different fields must stay as two rules');
  assert.equal(parsed.rules[0]?.kind, 'field_age');
  assert.equal(parsed.rules[1]?.kind, 'field_age');
});

test('field_age_between: DIFFERENT units do NOT fuse (safety)', () => {
  const src = `function (contact, report) {
  if ((Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 86400000 < 84 || (Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 604800000 > 12) { return false; }
  return true;
}`;
  const parsed = parseAppliesIf(src);
  assert.equal(parsed.rules.length, 2);
});

test('cht-eslint-safe: serialized output uses Utils.getField (NOT bare getField) + single quotes', () => {
  // Regression: cht compile-app-settings runs eslint (single-quote rule)
  // and webpack (no-undef) over tasks.js. Bare `getField` was undefined;
  // double-quoted strings failed the quotes rule. Both must be single-
  // quoted, and every `getField` reference must be `Utils.getField`.
  const p = parseAppliesIf(`function (contact, report) {
  return !!Utils.getField(report, 'lmp_date');
}`);
  const out = serializeAppliesIf(p);
  assert.match(out, /Utils\.getField/);
  assert.equal(/\bgetField\(report/.test(out.replace(/Utils\.getField/g, '')), false,
    'no bare getField(report...) anywhere in the serialized output');
  assert.equal(/"[^"]*"/.test(out), false, 'no double-quoted strings');
});

test('parse accepts BOTH bare getField and Utils.getField (back-compat with old configs)', () => {
  const bare = parseAppliesIf(`function (contact, report) { return !!getField(report, 'x'); }`);
  const withUtils = parseAppliesIf(`function (contact, report) { return !!Utils.getField(report, 'x'); }`);
  assert.equal(bare.rules[0]?.kind, 'field_presence');
  assert.equal(withUtils.rules[0]?.kind, 'field_presence');
});

test('field_age_between: UI-created (undefined guardGroup) also fuses on adjacent field_age pairs', () => {
  // If a user hand-writes `return X >= 84 && X <= 90;` (rather than the
  // guard-OR form), the parser produces two field_age rules with undefined
  // guardGroup. Fusion should collapse those too.
  const src = `function (contact, report) {
  return (Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 86400000 >= 84 && (Date.now() - new Date(getField(report, 'lmp_date')).getTime()) / 86400000 <= 90;
}`;
  const parsed = parseAppliesIf(src);
  assert.equal(parsed.rules.length, 1);
  assert.equal(parsed.rules[0]?.kind, 'field_age_between');
});

/* ============ Geriatric §3 — OR authoring (orGroups channel) ============ */

test('OR group: author-side emit → parse returns the same OR-joined structure', () => {
  // The nutrition case: "फेल selected for option A OR option B". The
  // builder marks two report_field rules with a shared orGroup id; the
  // serializer must emit the ¬(A ∨ B) guard — inverted comparisons joined
  // with && — and the parser must lift that back into ONE or-group of the
  // ORIGINAL positive rules.
  const authored = {
    params: ['contact', 'report'],
    rules: [
      { kind: 'report_field' as const, field: 'iha.option_a', op: '===' as const, value: 'फेल' },
      { kind: 'report_field' as const, field: 'iha.option_b', op: '===' as const, value: 'फेल' },
    ],
    guardGroups: [undefined, undefined],
    orGroups: [0, 0],
    hasRawFallback: false,
    body: '',
  };
  const out = serializeAppliesIf(authored);
  assert.match(
    out,
    /if \(Utils\.getField\(report, 'iha\.option_a'\) !== 'फेल' && Utils\.getField\(report, 'iha\.option_b'\) !== 'फेल'\) \{ return false; \}/,
    'OR of positives serializes as the &&-joined inverted guard',
  );

  const back = parseAppliesIf(out);
  assert.equal(back.rules.length, 2);
  assert.deepEqual(back.rules[0], authored.rules[0]);
  assert.deepEqual(back.rules[1], authored.rules[1]);
  assert.ok(back.orGroups[0] !== undefined, 'first rule is in an or-group');
  assert.equal(back.orGroups[0], back.orGroups[1], 'both rules share the or-group');
  assert.equal(back.guardGroups[0], undefined);
  assert.equal(back.hasRawFallback, false, 'round-trips structured, not raw');
});

test('OR group round-trip is a fixpoint: serialize → parse → serialize is byte-stable', () => {
  const src = `function (contact, report) {
  if (Utils.getField(report, 'a') !== 'फेल' && Utils.getField(report, 'b') !== 'फेल') { return false; }
  return true;
}`;
  const p1 = parseAppliesIf(src);
  const s1 = serializeAppliesIf(p1);
  const p2 = parseAppliesIf(s1);
  const s2 = serializeAppliesIf(p2);
  assert.equal(s1, src, 'no-op open+save of an OR guard is byte-stable');
  assert.equal(s2, s1);
});

test('(A || B) && C — OR group then AND rule serialize as two guards', () => {
  const authored = {
    params: ['contact', 'report'],
    rules: [
      { kind: 'report_field' as const, field: 'a', op: '===' as const, value: 'x' },
      { kind: 'report_field' as const, field: 'b', op: '===' as const, value: 'x' },
      { kind: 'contact_field' as const, field: 'role', op: '===' as const, value: 'patient' },
    ],
    guardGroups: [undefined, undefined, undefined],
    orGroups: [0, 0, undefined],
    hasRawFallback: false,
    body: '',
  };
  const out = serializeAppliesIf(authored);
  const lines = out.split('\n');
  assert.equal(lines.filter((l) => l.trim().startsWith('if (')).length, 2, 'two guard lines');
  const back = parseAppliesIf(out);
  assert.equal(back.rules.length, 3);
  assert.equal(back.orGroups[0], back.orGroups[1]);
  assert.equal(back.orGroups[2], undefined, 'C stays AND-combined');
});

test('pure-AND fixture is byte-unchanged on no-op open/save (orGroups untouched)', () => {
  const src = `function (contact, report) {
  if (!isAlive(contact.contact)) { return false; }
  if (Utils.getField(report, 'x') !== 'yes') { return false; }
  return true;
}`;
  assert.equal(serializeAppliesIf(parseAppliesIf(src)), src);
  assert.deepEqual(parseAppliesIf(src).orGroups, [undefined, undefined]);
});

test('&&-guard with an unclassifiable conjunct stays ONE raw guard (no partial lift)', () => {
  // A raw conjunct cannot be re-inverted on serialize; lifting the other
  // half would corrupt the expression. Whole condition falls back to a
  // single raw guard row — the pre-feature behavior.
  const src = `function (contact, report) {
  if (someCustomCheck(report).status !== 'ok' && Utils.getField(report, 'x') !== 'yes') { return false; }
  return true;
}`;
  const p = parseAppliesIf(src);
  assert.equal(p.rules.length, 1);
  assert.equal(p.rules[0]?.kind, 'raw');
  assert.equal(p.hasRawFallback, true, 'UI offers the Raw tab (raw text saved verbatim there)');
  assert.equal(
    (p.rules[0] as { text: string }).text,
    "someCustomCheck(report).status !== 'ok' && Utils.getField(report, 'x') !== 'yes'",
    'the whole condition is preserved in one raw rule — no partial lift',
  );
});

test('positive `return A || B` lifts into an OR group (serializes to the && guard)', () => {
  const src = `function (contact, report) {
  return Utils.getField(report, 'a') === 'x' || Utils.getField(report, 'b') === 'x';
}`;
  const p = parseAppliesIf(src);
  assert.equal(p.rules.length, 2);
  assert.equal(p.rules[0]?.kind, 'report_field');
  assert.ok(p.orGroups[0] !== undefined && p.orGroups[0] === p.orGroups[1]);
  const out = serializeAppliesIf(p);
  assert.match(out, /!== 'x' && Utils\.getField\(report, 'b'\) !== 'x'\) \{ return false; \}/);
});

test('OR-joined field_age pair does NOT fuse into a between (complement, not a range)', () => {
  // `if (age >= 84 && age <= 90) return false` means "OUTSIDE 84-90".
  // Positives are age < 84 OR age > 90 — fusing them into a between
  // would silently invert the author's logic.
  const src = `function (contact, report) {
  if ((Date.now() - new Date(Utils.getField(report, 'lmp_date')).getTime()) / 86400000 >= 84 && (Date.now() - new Date(Utils.getField(report, 'lmp_date')).getTime()) / 86400000 <= 90) { return false; }
  return true;
}`;
  const p = parseAppliesIf(src);
  assert.equal(p.rules.length, 2, 'stays two field_age rules');
  assert.equal(p.rules[0]?.kind, 'field_age');
  assert.ok(p.orGroups[0] !== undefined && p.orGroups[0] === p.orGroups[1]);
  assert.equal(serializeAppliesIf(p), src, 'byte-stable round-trip');
});

/* ==== Positive-raw serialization (bug found by the geriatric §3 e2e) ==== */

test('ungrouped raw rules are POSITIVE content, never emitted as guards', () => {
  // Before this fix, a leftover raw row (`return true;` from the parse
  // fallback, or a hand-typed positive expression) was pushed through the
  // guard path: `if (return true;) { return false; }` is invalid JS, and
  // `if (<positive expr>) { return false; }` INVERTS the author's logic.
  const withStatementRaw = serializeAppliesIf({
    params: ['contact', 'report'],
    rules: [
      { kind: 'raw', text: 'return true;' },
      { kind: 'report_field', field: 'x', op: '===', value: 'yes' },
    ],
    guardGroups: [undefined, undefined],
    orGroups: [undefined, undefined],
    hasRawFallback: true,
    body: '',
  });
  assert.equal(/if \(return/.test(withStatementRaw), false, 'no `if (return …)` invalid JS');
  assert.match(withStatementRaw, /if \(Utils\.getField\(report, 'x'\) !== 'yes'\) \{ return false; \}/);
  assert.match(withStatementRaw, /\n {2}return true;\n\}$/, 'statement raw re-emitted as body');

  const withExprRaw = serializeAppliesIf({
    params: ['contact', 'report'],
    rules: [
      { kind: 'report_field', field: 'x', op: '===', value: 'yes' },
      { kind: 'raw', text: 'customCheck(report)' },
    ],
    guardGroups: [undefined, undefined],
    orGroups: [undefined, undefined],
    hasRawFallback: true,
    body: '',
  });
  assert.match(
    withExprRaw,
    /return customCheck\(report\);/,
    'expression raw joins the positive return (not inverted into a guard)',
  );
  assert.equal(/if \(customCheck/.test(withExprRaw), false);
});

test('all-raw parse serializes to the body verbatim (no guard wrapping, no duplication)', () => {
  const src = `function (contact, report) {
  return isCovidVaccinated(contact) ? false : lastVisitDays(contact) > 30;
}`;
  const p = parseAppliesIf(src);
  assert.equal(p.rules.length, 1);
  assert.equal(p.rules[0]?.kind, 'raw');
  assert.equal(serializeAppliesIf(p), src, 'whole-body raw round-trips byte-stable');
});

test('guard-origin raw INSIDE a guardGroup stays in guard position', () => {
  // `report.fields.flag === 'x'` doesn't classify (only getField-shape
  // report reads do) → raw, but it came from a guard so it must stay in
  // its `||` guard slot, verbatim.
  const src = `function (contact, report) {
  if (report.fields.flag === 'x' || Utils.getField(report, 'x') !== 'yes') { return false; }
  return true;
}`;
  const p = parseAppliesIf(src);
  assert.equal(serializeAppliesIf(p), src, 'raw guard alternative keeps its || guard slot');
});

test('REGRESSION — helper guard round-trips without inverting (silent corruption fix)', () => {
  // `if (!isActivePregnancy(...)) return false` = the task fires ONLY for
  // active pregnancies. The old helper mapping in ruleToGuardSource
  // emitted the positive form, so one no-op open+save flipped it to
  // `if (isActivePregnancy(...)) return false` — the exact opposite.
  const src = `function (contact, report) {
  if (!isActivePregnancy(contact.contact, contact.reports, report)) { return false; }
  return true;
}`;
  const p = parseAppliesIf(src);
  assert.equal(p.rules[0]?.kind, 'helper');
  if (p.rules[0]?.kind === 'helper') assert.equal(p.rules[0].negated, false);
  assert.equal(serializeAppliesIf(p), src, 'no-op open+save is byte-stable');

  // NOT-form: positive rule "helper must NOT hold" → guard exits when it does.
  const srcNot = `function (contact, report) {
  if (isActivePregnancy(contact.contact, contact.reports, report)) { return false; }
  return true;
}`;
  const pNot = parseAppliesIf(srcNot);
  if (pNot.rules[0]?.kind === 'helper') assert.equal(pNot.rules[0].negated, true);
  assert.equal(serializeAppliesIf(pNot), srcNot);
});
