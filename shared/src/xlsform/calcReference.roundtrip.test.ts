/**
 * Round-trip + recognizer tests for the Tier 1.5 "Reference a value"
 * helpers (`shared/src/xlsform/calcReference.ts`).
 *
 * Three buckets per docs/plans/calc-reference-builder.md §"Test plan":
 *
 *   Bucket A — canonical, byte-stable, re-hydrates. One per idiom.
 *     For each: emit → recognize → emit produces the same canonical
 *     string AND the recognizer agrees on kind + argument + wrapper.
 *     Also: parseCalculation+serializeCalculation byte-identity for
 *     the same input (the parent calc Tier-0 §3.1 guarantee).
 *
 *   Bucket B — real fixture. Every distinct `calculation` cell from
 *     `nssd/chis/forms/app/diabetes_referral.xlsx` (10 cells; 3 input-
 *     copies, 5 ctx reads, 2 genuine if-chains). The 3+5 references
 *     are recognized; the 2 if-chains are NOT recognized (caller routes
 *     them to the If-then table mode or raw — out of scope here).
 *     Every cell round-trips byte-identical through parseCalculation.
 *
 *   Bucket C — safety. Free-text typed keys / fields / mismatched
 *     wrapper variants degrade gracefully without crashing or false-
 *     recognizing.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emitContactInput,
  emitContactSummary,
  emitFieldRef,
  recognizeReference,
  type ContextWrapper,
} from './calcReference.js';
import { parseCalculation, serializeCalculation } from './calculationBuilder.js';

/* ============================== Bucket A ================================ */

test('Bucket A — contact-input emit/recognize round-trip', () => {
  const s = emitContactInput('_id');
  assert.equal(s, '../inputs/contact/_id');
  const r = recognizeReference(s);
  assert.deepEqual(r, { kind: 'contact-input', argument: '_id', wrapper: 'none' });
  // And the parent self-check preserves the bytes.
  const parsed = parseCalculation(s);
  assert.equal(parsed.shape, 'single');
  assert.equal(serializeCalculation(parsed), s);
});

test('Bucket A — contact-summary (bare) emit/recognize round-trip', () => {
  const s = emitContactSummary('glucometer_ctx', 'none');
  assert.equal(s, "instance('contact-summary')/context/glucometer_ctx");
  const r = recognizeReference(s);
  assert.deepEqual(r, { kind: 'contact-summary', argument: 'glucometer_ctx', wrapper: 'none' });
  const parsed = parseCalculation(s);
  assert.equal(parsed.shape, 'single');
  assert.equal(serializeCalculation(parsed), s);
});

test('Bucket A — contact-summary fallback-to-current emit/recognize round-trip', () => {
  const s = emitContactSummary('glucometer_ctx', 'fallback-to-current');
  assert.equal(
    s,
    "if(instance('contact-summary')/context/glucometer_ctx, instance('contact-summary')/context/glucometer_ctx, .)",
  );
  const r = recognizeReference(s);
  assert.deepEqual(r, {
    kind: 'contact-summary',
    argument: 'glucometer_ctx',
    wrapper: 'fallback-to-current',
  });
  // parseCalculation may classify this as decision_table (the if-shape) OR
  // raw (the self-check demoted it). Either way the bytes survive.
  const parsed = parseCalculation(s);
  assert.equal(serializeCalculation(parsed), s);
});

test('Bucket A — contact-summary read-once emit/recognize round-trip', () => {
  const s = emitContactSummary('previous_bmi_ctx', 'read-once');
  assert.equal(s, "once(instance('contact-summary')/context/previous_bmi_ctx)");
  const r = recognizeReference(s);
  assert.deepEqual(r, {
    kind: 'contact-summary',
    argument: 'previous_bmi_ctx',
    wrapper: 'read-once',
  });
  const parsed = parseCalculation(s);
  assert.equal(parsed.shape, 'single');
  assert.equal(serializeCalculation(parsed), s);
});

test('Bucket A — bare ${field} field-ref recognize', () => {
  const s = emitFieldRef('lmp_date');
  assert.equal(s, '${lmp_date}');
  const r = recognizeReference(s);
  assert.deepEqual(r, { kind: 'field-ref', argument: 'lmp_date', wrapper: 'none' });
});

test('Bucket A — every emit/recognize is a fixpoint (re-emit identical string)', () => {
  // The recognizer is the inverse of the emitter for every supported idiom.
  const cases: Array<{ s: string; kind: 'contact-input' | 'contact-summary' | 'field-ref'; wrapper: ContextWrapper }> = [
    { s: emitContactInput('name'), kind: 'contact-input', wrapper: 'none' },
    { s: emitContactSummary('k', 'none'), kind: 'contact-summary', wrapper: 'none' },
    { s: emitContactSummary('k', 'fallback-to-current'), kind: 'contact-summary', wrapper: 'fallback-to-current' },
    { s: emitContactSummary('k', 'read-once'), kind: 'contact-summary', wrapper: 'read-once' },
    { s: emitFieldRef('x'), kind: 'field-ref', wrapper: 'none' },
  ];
  for (const c of cases) {
    const r = recognizeReference(c.s);
    assert.ok(r, `${c.s} should be recognized`);
    assert.equal(r!.kind, c.kind);
    assert.equal(r!.wrapper, c.wrapper);
    let reEmitted: string;
    if (r!.kind === 'contact-input') reEmitted = emitContactInput(r!.argument);
    else if (r!.kind === 'contact-summary') reEmitted = emitContactSummary(r!.argument, r!.wrapper);
    else reEmitted = emitFieldRef(r!.argument);
    assert.equal(reEmitted, c.s);
  }
});

/* ============================== Bucket B ================================ */

interface FixtureCell {
  name: string;
  calc: string;
}

function loadDiabetesReferralCells(): FixtureCell[] {
  const here = import.meta.dirname;
  const candidates = [
    join(here, '__fixtures__', 'diabetes-referral-calc-cells.json'),
    join(here, '..', '..', 'src', 'xlsform', '__fixtures__', 'diabetes-referral-calc-cells.json'),
  ];
  for (const c of candidates) {
    try {
      const txt = readFileSync(c, 'utf8');
      return JSON.parse(txt) as FixtureCell[];
    } catch {
      // try next
    }
  }
  return [];
}

test('Bucket B — diabetes_referral.xlsx: 10 cells, recognizer breakdown matches the picker surface', () => {
  const cells = loadDiabetesReferralCells();
  assert.equal(cells.length, 10, 'fixture must carry exactly the 10 measured cells');

  let inputCopies = 0;
  let ctxReadsRecognized = 0;
  let unrecognized = 0;

  for (const cell of cells) {
    const r = recognizeReference(cell.calc);
    if (r === null) {
      unrecognized++;
      continue;
    }
    if (r.kind === 'contact-input') inputCopies++;
    else if (r.kind === 'contact-summary') ctxReadsRecognized++;
  }

  // Source-level breakdown (per the plan): 3 input-copies + 5 ctx reads
  // + 2 genuine if-chains. The picker's conservative recognizer rejects
  // ONE of the 5 ctx reads (`avg_result_ctx`, whose if-wrapper uses two
  // DIFFERENT refs — intentional semantics, not a stock wrapper). So the
  // picker exposes 3 + 4 = 7 references; 3 cells fall through to the
  // expression/raw kinds and survive verbatim via the §3.1 self-check.
  assert.equal(inputCopies, 3, 'expected 3 input-copies recognized');
  assert.equal(ctxReadsRecognized, 4, 'expected 4 ctx reads recognized (1 non-matching wrapper falls through)');
  assert.equal(unrecognized, 3, 'expected 3 unrecognized (2 if-chains + the non-matching wrapper)');
});

test('Bucket B — every diabetes_referral cell round-trips byte-identical through parseCalculation', () => {
  const cells = loadDiabetesReferralCells();
  assert.ok(cells.length > 0, 'fixture must be present');
  for (const cell of cells) {
    const parsed = parseCalculation(cell.calc);
    assert.equal(
      serializeCalculation(parsed),
      cell.calc.trim(),
      `byte-stability failed for ${cell.name}`,
    );
  }
});

test('Bucket B — the avg_result_ctx if(REF_A, REF_B, .) variant is NOT recognized as a wrapper', () => {
  // The actual nssd cell uses `avg_result` in the condition but
  // `avg_result_ctx` in the value — intentionally different references,
  // not a wrapper. The recognizer must require ref equality, so this
  // cell falls through to expression kind. It still round-trips
  // byte-identical because the parent self-check preserves it.
  const cells = loadDiabetesReferralCells();
  const avg = cells.find((c) => c.name === 'avg_result_ctx');
  assert.ok(avg, 'fixture must include avg_result_ctx');
  const r = recognizeReference(avg!.calc);
  // Either null OR a strict recognition that the wrapper is NOT
  // 'fallback-to-current' (i.e. it didn't false-match).
  if (r !== null) {
    assert.notEqual(r.wrapper, 'fallback-to-current');
  }
});

/* ============================== Bucket C ================================ */

test('Bucket C — empty string is not a reference', () => {
  assert.equal(recognizeReference(''), null);
  assert.equal(recognizeReference('   '), null);
});

test('Bucket C — literal / numeric / arbitrary expressions are not references', () => {
  for (const s of [`'yes'`, '"no"', '42', '3.14', `floor( today() div 365 )`, `concat('a','b')`]) {
    assert.equal(recognizeReference(s), null, `${s} should not be a reference`);
  }
});

test('Bucket C — wrapper with non-matching refs falls through (no false-recognize)', () => {
  // Mirrors the avg_result_ctx case but synthetic for clarity.
  const s =
    "if(instance('contact-summary')/context/a, instance('contact-summary')/context/b, .)";
  const r = recognizeReference(s);
  // Recognizer must NOT classify this as a fallback wrapper.
  if (r !== null) assert.notEqual(r.wrapper, 'fallback-to-current');
});

test('Bucket C — nested xpath in contact-input falls through (conservative recognizer)', () => {
  // `../inputs/contact/parent/_id` — nested. Plan §3 says the conservative
  // recognizer rejects nested paths; they survive via raw byte-identity.
  const s = '../inputs/contact/parent/_id';
  assert.equal(recognizeReference(s), null);
  const parsed = parseCalculation(s);
  assert.equal(serializeCalculation(parsed), s);
});

test('Bucket C — emitter accepts a free-typed key not in any project contextOrder', () => {
  // The picker allows free-type; the emitter doesn't care whether the key
  // is in the project's contact-summary or not. Round-trip still holds.
  const s = emitContactSummary('not_a_real_key', 'none');
  assert.equal(s, "instance('contact-summary')/context/not_a_real_key");
  const r = recognizeReference(s);
  assert.equal(r?.argument, 'not_a_real_key');
  const parsed = parseCalculation(s);
  assert.equal(parsed.shape, 'single');
  assert.equal(serializeCalculation(parsed), s);
});

/* ============== §H1 — widened once() whitespace tolerance ============== */
/*
 * docs/plans/shipped-batch-triad-punchlist.md §H1: the original
 * `CONTACT_SUMMARY_ONCE_RE` only matched the canonical no-spaces form
 * `once(<ref>)`, so spaced variants like `once( ref )` fell through to
 * the `expression` kind and re-opened in Custom-expression instead of
 * the Reference sub-mode. Tolerate internal whitespace inside the
 * parens — the inner reference itself stays canonical (no spaces
 * around `instance` or the slashes).
 */
test('§H1 — once() recognizer tolerates internal whitespace', () => {
  const variants = [
    "once(instance('contact-summary')/context/glucometer_ctx)",
    "once( instance('contact-summary')/context/glucometer_ctx )",
    "once(  instance('contact-summary')/context/glucometer_ctx  )",
    "once(\tinstance('contact-summary')/context/glucometer_ctx\t)",
    "once(\ninstance('contact-summary')/context/glucometer_ctx\n)",
  ];
  for (const s of variants) {
    const r = recognizeReference(s);
    assert.ok(r, `expected to recognize: ${JSON.stringify(s)}`);
    assert.equal(r!.kind, 'contact-summary');
    assert.equal(r!.argument, 'glucometer_ctx');
    assert.equal(r!.wrapper, 'read-once');
  }
});
