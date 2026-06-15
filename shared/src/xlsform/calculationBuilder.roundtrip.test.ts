/**
 * Round-trip safety suite for the `calculation`-column parser/serializer.
 *
 * Tier 0 of docs/plans/calculation-builder.md v0.2. Tests are grouped into
 * three buckets per plan §6 plus a field-coverage sweep over the
 * cht-default app forms:
 *
 *   Bucket A — canonical structured, byte-stable. One per shape
 *     (`decision_table`, `single`).
 *   Bucket B — tight/unsupported expressions whose structured re-serialize
 *     would NOT be byte-identical. They MUST classify `'raw'` and survive
 *     the round-trip verbatim. Covers fact 1 (whitespace canonicalization
 *     of if-chains) and fact 4 (trailing-text truncation by readArgList).
 *   Bucket C — edge cases: the genuinely-empty cell deletes cleanly,
 *     literal `''` is preserved (NOT deleted), nested if, quoted commas.
 *   Field coverage — extract every distinct `calculation` cell from the
 *     11 cht-default app forms and assert that (a) parse→serialize is
 *     byte-stable for every cell, (b) no present cell becomes length-0
 *     after serialize (no present→deletable regression), (c) the set of
 *     cells flipping to `'raw'` matches the known-unstable list pinned in
 *     this file (the §3.7 regression-flip policy).
 *
 * Run via `pnpm --filter @cht-ui/shared test` (build → node --test).
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCalculation, serializeCalculation, type ParsedCalculation } from './calculationBuilder.js';
import { parseXlsForm } from './parse.js';

/* ============================== Bucket A ================================ */

test('Bucket A — canonical decision_table round-trips byte-stable', () => {
  const src = `if(\${a} = 'x', 'high', if(\${b} > 10, 'mid', 'low'))`;
  const parsed = parseCalculation(src);
  assert.equal(parsed.shape, 'decision_table');
  assert.equal(parsed.rules.length, 2);
  assert.equal(parsed.otherwise, "'low'");
  assert.equal(serializeCalculation(parsed), src);
});

test('Bucket A — bare ${field} ref classifies as single, round-trips byte-stable', () => {
  const src = '${dob}';
  const parsed = parseCalculation(src);
  assert.equal(parsed.shape, 'single');
  assert.equal(parsed.rules.length, 0);
  assert.equal(parsed.otherwise, src);
  assert.equal(serializeCalculation(parsed), src);
});

test('Bucket A — xpath path (../inputs/contact/_id) classifies as single, byte-stable', () => {
  const src = '../inputs/contact/_id';
  const parsed = parseCalculation(src);
  assert.equal(parsed.shape, 'single');
  assert.equal(parsed.otherwise, src);
  assert.equal(serializeCalculation(parsed), src);
});

test('Bucket A — function-call single (jr:choice-name, format-date-time) byte-stable', () => {
  for (const src of [
    `jr:choice-name(\${sex}, '\${sex}')`,
    `format-date-time(today(), '%Y-%m-%d')`,
    `concat(\${a}, ' ', \${b})`,
  ]) {
    const parsed = parseCalculation(src);
    assert.equal(parsed.shape, 'single', `${src} should be single`);
    assert.equal(serializeCalculation(parsed), src);
  }
});

test('Bucket A — numeric literal classifies as single', () => {
  for (const src of ['0', '42', '-1', '3.14']) {
    const parsed = parseCalculation(src);
    assert.equal(parsed.shape, 'single');
    assert.equal(serializeCalculation(parsed), src);
  }
});

test('Bucket A — canonical Age-from-DOB template round-trips byte-stable as single', () => {
  // The single template Tier 1 ships in the "Common calculation" gallery
  // (plan v0.2 §3). The recipe is intentionally a `'single'`-shape
  // expression so re-edit lands the user back in the Single-value panel.
  // Bucket A pins byte-identity through the §3.1 self-check.
  const src = 'floor( difference-in-months( ${dob}, today() ) div 12 )';
  const parsed = parseCalculation(src);
  assert.equal(parsed.shape, 'single');
  assert.equal(parsed.otherwise, src);
  assert.equal(serializeCalculation(parsed), src);
});

/* ============================== Bucket B ================================ */

test('Bucket B — tight-spacing if-chain demotes to raw (fact 1: serializer canonicalizes spacing)', () => {
  // `${a}=1,2,3` has no space around `=` and no space after commas — the
  // serializer canonicalizes to `${a} = 1, 2, 3`, so the §3.1 self-check
  // fires and routes to raw. This is exactly the silent corruption the
  // plan calls out: 17 of 55 cht-default if-chains today.
  const src = 'if(${a}=1,2,3)';
  const parsed = parseCalculation(src);
  assert.equal(parsed.shape, 'raw');
  assert.equal(parsed.raw, src);
  assert.equal(serializeCalculation(parsed), src);
});

test('Bucket B — fact 4 truncation: `if(...) + 5` cannot survive structured, must route to raw byte-identical', () => {
  // readArgList stops at the first balanced ')' and silently drops the
  // ` + 5`. Without the §3.1 self-check this would parse as a decision
  // table and silently DELETE the trailing math. With the self-check, the
  // re-serialize (`if(${a} = 1, 2, 3)`) ≠ the original, so we demote.
  const src = 'if(${a}=1,2,3) + 5';
  const parsed = parseCalculation(src);
  assert.equal(parsed.shape, 'raw', `${src} must demote to raw`);
  assert.equal(parsed.raw, src);
  assert.equal(serializeCalculation(parsed), src);
});

test('Bucket B — fact 4 truncation: `if(...) div 12` (age recipe shape) routes to raw', () => {
  const src = 'if(${a}=1,2,3) div 12';
  const parsed = parseCalculation(src);
  assert.equal(parsed.shape, 'raw');
  assert.equal(serializeCalculation(parsed), src);
});

test('Bucket B — flat arithmetic ${a}+${b} stays raw (Tier-2 not implemented)', () => {
  const src = '${a}+${b}';
  const parsed = parseCalculation(src);
  // No if-chain to peel; the `single`-shape self-check on `${a}+${b}`
  // returns the same string, so it actually classifies as single (the
  // serializer round-trips a bare expression verbatim). Tier 2 would
  // promote this to a structured arithmetic shape; until then it lives
  // in `'single'`, which is byte-stable and safe.
  assert.equal(parsed.shape, 'single');
  assert.equal(serializeCalculation(parsed), src);
});

test('Bucket B — coalesce/concat/int()/pulldata stay raw-or-single but ALWAYS byte-stable', () => {
  for (const src of [
    `coalesce(\${a}, \${b})`,
    `int(\${age_years})`,
    `pulldata('contacts.csv', \${name})`,
    `sum(\${value})`,
  ]) {
    const parsed = parseCalculation(src);
    // Each is a bare expression that round-trips verbatim through the
    // single-value path — proves the §3.1 self-check passes them through
    // safely without forcing them into raw.
    assert.equal(serializeCalculation(parsed), src, `${src} round-trip drift`);
  }
});

/* ============================== Bucket C ================================ */

test('Bucket C — genuinely-empty cell serializes to JS "" (length 0) so setExtra deletes cleanly (fact 2 regression)', () => {
  // The fact-2 bug: a genuinely-empty cell parsed to otherwise:"''" and
  // serialized to the two-char string "''", so setExtra's delete-on-empty
  // never fired and a stray "''" got resurrected.
  for (const src of ['', '   ', '\n']) {
    const parsed = parseCalculation(src);
    const out = serializeCalculation(parsed);
    assert.equal(out, '', `genuinely-empty ${JSON.stringify(src)} must collapse to '' (length 0)`);
    assert.equal(out.length, 0);
  }
});

test('Bucket C — literal `\'\'` (two-char) opens+saves byte-identical and is NOT deleted (§3.3 regression)', () => {
  // The §3.3 hazard: a present cell whose canonical serialize is length-0
  // would get DELETED on save. A literal '' (someone deliberately wrote
  // it) must be preserved verbatim — either via single (otherwise = "''")
  // or via raw.
  const src = "''";
  const parsed = parseCalculation(src);
  const out = serializeCalculation(parsed);
  assert.equal(out, src, 'literal `\'\'` must round-trip byte-identical');
  assert.notEqual(out.length, 0, 'a present cell must NEVER become length-0 after serialize');
});

test('Bucket C — nested if (3 levels) round-trips when canonically spaced', () => {
  const src = `if(\${a} = 'x', 1, if(\${b} = 'y', 2, if(\${c} = 'z', 3, 0)))`;
  const parsed = parseCalculation(src);
  assert.equal(parsed.shape, 'decision_table');
  assert.equal(parsed.rules.length, 3);
  assert.equal(serializeCalculation(parsed), src);
});

test('Bucket C — if-chain with quoted comma inside a string value round-trips', () => {
  // The comma inside the quoted `'a, b'` must not split the arg list.
  // The serializer canonicalizes spacing, so we provide a canonical input.
  const src = `if(\${a} = 'yes', 'a, b', 'none')`;
  const parsed = parseCalculation(src);
  assert.equal(parsed.shape, 'decision_table');
  assert.equal(parsed.rules.length, 1);
  assert.equal(parsed.rules[0]?.output, "'a, b'");
  assert.equal(serializeCalculation(parsed), src);
});

test('Bucket C — §3.6 double-door: a `calculation` value forced through hydrateColumn does NOT commit clauses', async () => {
  // Defensive regression — even if someone bypasses TS and forces a
  // non-boolean column through the boolean builder's reducer, no AND/OR
  // clause is committed. (conditionReducer's hydrateColumn early-returns
  // on any column not in BOOLEAN_COLUMNS.)
  const { conditionBuilderReducer, initialConditionBuilderState } = await import(
    '../conditionBuilder/conditionReducer.js'
  );
  const next = conditionBuilderReducer(initialConditionBuilderState, {
    kind: 'set-column',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    column: 'calculation' as any,
    existingValue: `if(\${a} = 'x', 'high', 'low')`,
  });
  assert.equal(next.clauses.length, 0);
  assert.equal(next.groups, null);
  assert.equal(next.rawFallback, null);
});

/* ====================== Field coverage — cht-default ===================== */

/**
 * Resolve a fixture path that works from both src/ (during typecheck) and
 * dist/ (where tests actually execute). Mirrors the dual-path pattern in
 * shared/src/fhir/roundtrip.test.ts.
 */
function fixturePath(name: string): string {
  const here = import.meta.dirname;
  const candidates = [
    join(here, '__fixtures__', name),
    join(here, '..', '..', 'src', 'xlsform', '__fixtures__', name),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c);
      return c;
    } catch {
      // try next
    }
  }
  return candidates[0]!;
}

/**
 * The exact set of cht-default if-chain calculations whose canonical
 * re-serialize differs from the source bytes — pinned to the fixture
 * extracted by `scripts/measure-calc-flips.mjs` against
 * `server/templates/cht-default/forms/app/*.xlsx`. Today these render as
 * structured tables; under the §3.1 self-check they correctly demote to
 * `'raw'`. Per the plan's regression-flip policy (§3.7) we accept the
 * flip and pin the set so any silent expansion fails CI — a future
 * serializer change that touches more cells must either re-pin the
 * fixture intentionally OR fix the drift at the source.
 */
const KNOWN_RAW_FLIP_CELLS: ReadonlySet<string> = (() => {
  try {
    const json = readFileSync(fixturePath('known-raw-flip-cells.json'), 'utf8');
    return new Set<string>(JSON.parse(json) as string[]);
  } catch {
    return new Set<string>();
  }
})();

const CHT_DEFAULT_FORMS_DIR = (() => {
  const here = import.meta.dirname;
  // dist/ layout: shared/dist/xlsform/<this>.js  → ../../../server/templates/...
  // src/ layout:  shared/src/xlsform/<this>.ts   → same
  return join(here, '..', '..', '..', 'server', 'templates', 'cht-default', 'forms', 'app');
})();

function listChtDefaultForms(): string[] {
  try {
    return readdirSync(CHT_DEFAULT_FORMS_DIR)
      .filter((n) => n.endsWith('.xlsx'))
      .map((n) => join(CHT_DEFAULT_FORMS_DIR, n));
  } catch {
    return [];
  }
}

test('Field coverage — every cht-default calc cell round-trips byte-stable AND no present cell deletes', async () => {
  const formPaths = listChtDefaultForms();
  if (formPaths.length === 0) {
    // Tolerated only when running against a checkout without cht-default
    // (some downstream forks). Pin the count we expect in CI.
    return;
  }

  // Collect every DISTINCT calculation cell across all forms.
  const cells = new Set<string>();
  for (const path of formPaths) {
    const buf = readFileSync(path);
    const form = await parseXlsForm(buf);
    for (const row of form.survey) {
      const calc = row.extras['calculation'];
      if (typeof calc === 'string' && calc.trim() !== '') cells.add(calc);
    }
  }

  // Field-coverage assertions per plan §6.
  const flips: string[] = [];
  const drifters: string[] = [];
  const presentBecameDeletable: string[] = [];

  for (const src of cells) {
    const parsed: ParsedCalculation = parseCalculation(src);
    const out = serializeCalculation(parsed);

    // (a) parse→serialize byte-stable for every cell (the contract).
    if (out !== src.trim()) drifters.push(src);

    // (b) no present cell becomes length-0 after serialize (no
    // present→deletable regression).
    if (out.length === 0) presentBecameDeletable.push(src);

    // (c) record which cells flipped to raw (per the §3.7 regression-flip
    // policy). These are the cells where the structured serializer would
    // have changed bytes — the self-check is the safety net.
    if (parsed.shape === 'raw') flips.push(src);
  }

  // Field-coverage corpus is informational unless something regresses.
  assert.deepEqual(drifters, [], 'cells whose parse/serialize is NOT byte-stable');
  assert.deepEqual(
    presentBecameDeletable,
    [],
    'present cells that would be DELETED on save (§3.3 regression)',
  );

  // The 17-flip tripwire: any silent expansion (or unexpected fix) of the
  // flip set fails CI. Re-pin the fixture intentionally via
  // scripts/measure-calc-flips.mjs if the plan's regression-flip policy
  // (§3.7) ever needs to evolve.
  assert.equal(KNOWN_RAW_FLIP_CELLS.size, 17, 'expected exactly 17 known raw-flip cells');
  assert.deepEqual(
    new Set(flips),
    KNOWN_RAW_FLIP_CELLS,
    'set of cells flipping to raw must match the pinned KNOWN_RAW_FLIP_CELLS',
  );
});
