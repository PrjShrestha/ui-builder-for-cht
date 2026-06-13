/**
 * Round-trip suite for chained + grouped relevant expressions (Slice 2
 * commit A of the condition-builder plan, docs/plans/condition-builder.md).
 *
 * Cases split into three buckets per plan §6:
 *   Bucket A — canonical strings, assert STRUCTURED byte-stability:
 *              serializeAnyParsed(parseRelevantGrouped(x)) === x AND no
 *              isRawFallback.
 *   Bucket B — non-canonical / out-of-grammar strings, assert raw-fallback
 *              AND raw byte-identity (serializeAnyParsed === trimmed and
 *              result is a single RawRule). The serializer's §3.1
 *              self-check is what routes these to raw rather than
 *              silently reformatting.
 *   Bucket C — structural edge cases (per-clause raw inside a chain,
 *              empty input, whitespace-only, parens-only).
 *
 * The two-levels-max grammar boundary is enforced by both the type system
 * (GroupedExpression.subgroups is ParsedExpression[], not AnyParsed[]) AND
 * the parser (tryBuildGrouped rejects any subgroup with isRawFallback).
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  parseRelevant,
  parseRelevantGrouped,
  serializeAnyParsed,
} from './relevantParser.js';

/* ============================ Bucket A — structured byte-stability ============================ */

function assertStructured(src: string, expectGrouped = false): void {
  const parsed = parseRelevantGrouped(src);
  assert.equal(parsed.isRawFallback, false, `expected structured (not raw): ${src}`);
  if (expectGrouped) {
    assert.ok('subgroups' in parsed, `expected GroupedExpression for: ${src}`);
  } else {
    assert.ok(!('subgroups' in parsed), `expected flat ParsedExpression for: ${src}`);
  }
  assert.equal(
    serializeAnyParsed(parsed),
    src,
    `byte-stable round-trip failed for: ${JSON.stringify(src)}`,
  );
}

test('Bucket A — three-clause AND, canonical spacing', () => {
  assertStructured(`\${sex} = 'female' and \${age} > 18 and selected(\${conds}, 'x')`);
});

test('Bucket A — three-clause OR, canonical spacing', () => {
  assertStructured(`\${sex} = 'female' or \${age} > 18 or selected(\${conds}, 'x')`);
});

test('Bucket A — selected + comparison + not(selected) under a single AND', () => {
  assertStructured(
    `\${sex} = 'female' and selected(\${conds}, 'x') and not(selected(\${conds}, 'none'))`,
  );
});

test('Bucket A — grouped: (A and B) or C', () => {
  assertStructured(`(\${a} = 'x' and \${b} > 10) or \${c} = 'y'`, true);
});

test('Bucket A — grouped reverse: A or (B and C)', () => {
  assertStructured(`\${a} = 'x' or (\${b} > 10 and \${c} = 'y')`, true);
});

test('Bucket A — three-subgroup: (A and B) or (C and D) or E', () => {
  assertStructured(
    `(\${a} = 'x' and \${b} > 10) or (\${c} = 'y' and \${d} = 'z') or \${e} = 'q'`,
    true,
  );
});

test('Bucket A — grouped AND outer: (A or B) and (C or D)', () => {
  assertStructured(`(\${a} = 'x' or \${b} = 'y') and (\${c} = 'z' or \${d} = 'q')`, true);
});

/* ============================ Bucket B — raw-fallback byte-identity ============================ */

function assertRawByteIdentical(src: string): void {
  const parsed = parseRelevantGrouped(src);
  assert.equal(parsed.isRawFallback, true, `expected raw fallback for: ${src}`);
  // Single RawRule carrying the original (trimmed) text:
  assert.ok(!('subgroups' in parsed));
  assert.equal(parsed.rules.length, 1);
  assert.equal(parsed.rules[0]?.kind, 'raw');
  // Byte-identical to the trimmed input — the user's spelling is preserved verbatim:
  assert.equal(serializeAnyParsed(parsed), src.trim());
}

test('Bucket B — tight-spacing flat chain stays raw, byte-identical', () => {
  // Self-check fires: canonical form has spaces around `=` and `>`.
  assertRawByteIdentical(`\${a}='x' and \${b}>10`);
});

test('Bucket B — inner-padded parens stay raw, byte-identical', () => {
  // Serializer cannot reproduce inner padding ( A and B ); routes to raw.
  assertRawByteIdentical(`( \${a} = 'x' and \${b} > 10 ) or \${c} = 'y'`);
});

test('Bucket B — flat-mixed, no parens, stays raw, byte-identical', () => {
  // Both `and` and `or` at the top level with no grouping — mixed-precedence
  // short-circuit (parseRelevant lines 118-121).
  assertRawByteIdentical(`\${a} = 'x' or \${b} > 10 and \${c} = 'y'`);
});

test('Bucket B — three-level nesting refused (two-levels-max enforcement)', () => {
  assertRawByteIdentical(`((\${a} = 'x' and \${b} > 10) or \${c} = 'y') and \${d} = 'z'`);
});

test('Bucket B — paren group containing flat-mixed stays raw', () => {
  // Inside the first paren, (A and B or C) is itself flat-mixed → invalid;
  // the whole expression falls back to raw rather than partially parsing.
  assertRawByteIdentical(`(\${a} = 'x' and \${b} > 10 or \${c} = 'y') or \${d} = 'z'`);
});

/* ============================ Bucket C — structural edge cases ============================ */

test('Bucket C — single-combinator chain with one wrapped clause keeps that clause as raw, siblings structured', () => {
  // `(${a} = 'x') or ${b} = 'y'` is single-combinator (OR only) with one
  // wrapped clause. parseRelevantGrouped's grouped-detection self-check
  // rejects this because serializing the grouped candidate strips the
  // parens. The flat parser then handles it: the wrapped part doesn't
  // match any single-clause pattern → RawRule (preserved verbatim);
  // sibling is a comparison. Byte-stable round-trip.
  const src = `(\${a} = 'x') or \${b} = 'y'`;
  const parsed = parseRelevantGrouped(src);
  assert.ok(!('subgroups' in parsed));
  assert.equal(parsed.isRawFallback, false);
  assert.equal(parsed.rules.length, 2);
  assert.equal(parsed.rules[0]?.kind, 'raw');
  assert.equal(parsed.rules[1]?.kind, 'comparison');
  assert.equal(serializeAnyParsed(parsed), src);
});

test('Bucket C — per-clause raw inside a single-combinator AND chain stays structured', () => {
  // The middle clause is a CHT function the parser doesn't model; it lands
  // as a per-clause RawRule, siblings stay structured, byte-stable.
  const src = `\${sex} = 'female' and pulldata('x', 'y', 'z', 'q') and \${age} > 18`;
  const parsed = parseRelevantGrouped(src);
  assert.ok(!('subgroups' in parsed));
  assert.equal(parsed.isRawFallback, false);
  assert.equal(parsed.rules.length, 3);
  assert.equal(parsed.rules[1]?.kind, 'raw');
  assert.equal(serializeAnyParsed(parsed), src);
});

test('Bucket C — empty string parses to empty rules', () => {
  const parsed = parseRelevantGrouped('');
  assert.ok(!('subgroups' in parsed));
  assert.equal(parsed.rules.length, 0);
  assert.equal(parsed.isRawFallback, false);
  assert.equal(serializeAnyParsed(parsed), '');
});

test('Bucket C — single canonical clause stays flat', () => {
  const src = `\${sex} = 'female'`;
  const parsed = parseRelevantGrouped(src);
  assert.ok(!('subgroups' in parsed));
  assert.equal(parsed.rules.length, 1);
  assert.equal(parsed.rules[0]?.kind, 'comparison');
  assert.equal(serializeAnyParsed(parsed), src);
});

test('Bucket C — whitespace-only normalizes to empty', () => {
  const parsed = parseRelevantGrouped('   \t  ');
  assert.ok(!('subgroups' in parsed));
  assert.equal(parsed.rules.length, 0);
  assert.equal(serializeAnyParsed(parsed), '');
});

test('Bucket C — parens-only stays raw (not a valid clause)', () => {
  // `()` doesn't match any rule pattern; parseRelevant returns it as a
  // single raw rule. Self-check passes (text=`()` serializes to `()`).
  const parsed = parseRelevantGrouped('()');
  assert.ok(!('subgroups' in parsed));
  assert.equal(parsed.rules[0]?.kind, 'raw');
  assert.equal(serializeAnyParsed(parsed), '()');
});

/* ============================ Public-API sanity ============================ */

test('parseRelevant signature unchanged (still ParsedExpression, not AnyParsed)', () => {
  // This is a compile-time + runtime guard. If anyone widens parseRelevant
  // to return AnyParsed, the 5 consumers (RelevantRuleBuilder.tsx,
  // CalculationBuilder.tsx, DecisionsView.tsx, shared/calculationBuilder.ts)
  // break. Compile-time: TS prevents `subgroups` from appearing on the
  // ParsedExpression branch. Runtime: `{...parsed, rules}` spreads stay
  // safe because there's no `kind` discriminator on the flat shape.
  const flat = parseRelevant(`\${sex} = 'female' and \${age} > 18`);
  assert.ok(!('subgroups' in flat));
  assert.ok(!('outerCombinator' in flat));
  // The shape that 5 consumers depend on:
  assert.ok('combinator' in flat);
  assert.ok(Array.isArray(flat.rules));
  assert.ok('isRawFallback' in flat);
});
