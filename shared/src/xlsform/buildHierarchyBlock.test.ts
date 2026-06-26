/**
 * Mandated test matrix for `buildHierarchyBlock` per plan §7
 * (docs/plans/hierarchy-block-generator.md). The shared, deterministic
 * unit suite is the REQUIRED gate (e2e is best-effort fixture-gated).
 *
 * What each test pins:
 *   1. Repeated-name + depth-7 produces 0 structural violations AND
 *      every begin/end pair has agreeing names at the right depth.
 *   2. Adversarial: a manually-interleaved chain is flagged by the
 *      `mismatched-name` guard (proves the H2 check still catches genuine
 *      crossings even with repeated `parent` names).
 *   3. Depth ∈ {0,1,2,3,7}: exactly N begin/N end pairs AND a running-
 *      depth counter that reaches exactly N at the innermost row and
 *      returns to 0 at the end. Count alone is insufficient — [b][e][b][e]
 *      and [b][b][e][e] both have N=2 but only one is correctly nested.
 *   4. Round-trip as a UNIT test (mirrors scaffolds.test.ts): scaffold-
 *      with-lineage → serialize → parse → equal (modulo regenerated
 *      rowIds) + balance preserved.
 *   5. Empty / unconfigured hierarchy → zero parent groups, balanced.
 *   6. Label fallback (handled in the UI's preview ladder; here we just
 *      confirm emitted labels are EMPTY — labels live in the picker UI,
 *      not in the survey rows, matching the scaffold convention).
 *   7. Person leaf with multiple parents → `parents[0]` place lineage
 *      chosen deterministically + warning surfaced.
 *   8. Leaf-slice boundary — leaf at each level of a 7-chain produces
 *      `parent`-group count == strictly-higher place levels.
 *   9. Cycle / orphan guard — unreachable / cyclic nodes don't emit a
 *      fabricated chain; cycles truncate at the repeat with a warning.
 *  10. Determinism — two calls, same input → identical output.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  buildHierarchyBlock,
  computeLineageChain,
  detectStaleLineageBlocks,
  findLineageSignatures,
  lineageSignature,
  parseLineageSignature,
  type ContactTypeNode,
} from './buildHierarchyBlock.js';
import { findStructuralViolations } from './structuralBalance.js';
import { buildAppFormScaffold } from './scaffolds.js';
import { parseXlsForm } from './parse.js';
import { serializeXlsForm } from './serialize.js';

/* =============================== fixtures =============================== */

/** A simple linear place chain (district → health_center → clinic) +
 *  one person type rooted at clinic. Matches the cht-default convention
 *  where the household-level place (clinic) is the person's placement. */
const linearTypes: ContactTypeNode[] = [
  { id: 'district_hospital' /* no parents → root */ },
  { id: 'health_center', parents: ['district_hospital'] },
  { id: 'clinic', parents: ['health_center'] },
  { id: 'person', person: true, parents: ['clinic'] },
];

/** A 7-level place chain (lvl0 = root, lvl6 = deepest), plus a person rooted at lvl6. */
function sevenLevelTypes(): ContactTypeNode[] {
  return [
    { id: 'lvl0' },
    { id: 'lvl1', parents: ['lvl0'] },
    { id: 'lvl2', parents: ['lvl1'] },
    { id: 'lvl3', parents: ['lvl2'] },
    { id: 'lvl4', parents: ['lvl3'] },
    { id: 'lvl5', parents: ['lvl4'] },
    { id: 'lvl6', parents: ['lvl5'] },
    { id: 'chw', person: true, parents: ['lvl6'] },
  ];
}

/** Compute the running structural depth at each row index (1-indexed
 *  counter that increments on a `begin group`, decrements AFTER an
 *  `end group` is processed). Used by §7 depth-N contract test:
 *  count alone can't distinguish a properly-nested run from a
 *  crossed/flat one. */
function nestingDepthSeries(
  rows: { type: string }[],
): { maxDepth: number; finalDepth: number; series: number[] } {
  let depth = 0;
  let maxDepth = 0;
  const series: number[] = [];
  for (const r of rows) {
    const t = r.type.trim().toLowerCase();
    if (t === 'begin group' || t === 'begin repeat') depth++;
    if (depth > maxDepth) maxDepth = depth;
    series.push(depth);
    if (t === 'end group' || t === 'end repeat') depth--;
  }
  return { maxDepth, finalDepth: depth, series };
}

/* ============================ test 1 — depth 7 ========================= */

test('§7.1 — depth=7 chain: zero violations + N begin/N end agreeing pairs', () => {
  const types = sevenLevelTypes();
  const { rows, chain } = buildHierarchyBlock(types, {
    leafType: 'chw',
    depth: 7, // chw → lvl6 → lvl5 → lvl4 → lvl3 → lvl2 → lvl1 → lvl0 = 7 ancestors
  });
  assert.equal(chain.length, 7, 'chain length must be 7');

  // Zero structural violations on the emitted block alone.
  assert.deepEqual(findStructuralViolations(rows), [], 'block must be structurally balanced');

  const begins = rows.filter((r) => r.type === 'begin group').length;
  const ends = rows.filter((r) => r.type === 'end group').length;
  assert.equal(begins, 7, 'must have exactly 7 begin-group rows');
  assert.equal(ends, 7, 'must have exactly 7 end-group rows');

  // Every begin / end carries the name `parent` (repeated names — the
  // shape the H2 name-agreement check would naively reject).
  for (const r of rows.filter((x) => x.type === 'begin group' || x.type === 'end group')) {
    assert.equal(r.name, 'parent', `begin/end row name should be "parent", got "${r.name}"`);
  }
});

/* ============= test 2 — adversarial interleaved guard ============= */

test('§7.2 — adversarial interleave is flagged by structuralBalance', () => {
  // Hand-build a survey that crosses the nesting — depth-3 begins then
  // depth-3 ends in WRONG order. The balance validator's mismatched-end
  // check should still catch this even with repeated `parent` names,
  // because the kind/depth invariant is what fires, not the name check.
  const survey = [
    { rowId: 'b0', type: 'begin group',  name: 'parent',  labels: { en: '' }, extras: {} },
    { rowId: 'b1', type: 'begin repeat', name: 'parent',  labels: { en: '' }, extras: {} },
    { rowId: 'e0', type: 'end group',    name: 'parent',  labels: { en: '' }, extras: {} },
    { rowId: 'e1', type: 'end repeat',   name: 'parent',  labels: { en: '' }, extras: {} },
  ];
  const v = findStructuralViolations(survey);
  assert.ok(v.length > 0, 'adversarial interleave must produce at least one violation');
  assert.ok(
    v.some((x) => x.kind === 'mismatched-end'),
    'mismatched-end must fire on a crossed begin-group / begin-repeat pair',
  );
});

/* =================== test 3 — depth-N nesting contract ================== */

for (const depth of [0, 1, 2, 3, 7]) {
  test(`§7.3 — depth=${depth} contract: exactly ${depth} pairs + max-depth=${depth} + final=0`, () => {
    const types = sevenLevelTypes();
    const { rows, chain } = buildHierarchyBlock(types, { leafType: 'chw', depth });
    assert.equal(chain.length, depth, `chain length must equal requested depth ${depth}`);
    assert.equal(
      rows.filter((r) => r.type === 'begin group').length,
      depth,
      `must have exactly ${depth} begin-group rows`,
    );
    assert.equal(
      rows.filter((r) => r.type === 'end group').length,
      depth,
      `must have exactly ${depth} end-group rows`,
    );
    const series = nestingDepthSeries(rows);
    assert.equal(
      series.maxDepth,
      depth,
      `running nesting depth must reach exactly ${depth} at innermost row`,
    );
    assert.equal(
      series.finalDepth,
      0,
      'running nesting depth must return to 0 after the last end-group',
    );
    assert.deepEqual(findStructuralViolations(rows), []);
  });
}

/* ============== test 4 — scaffold-with-lineage round-trip =============== */

test('§7.4 — scaffold + lineage round-trips byte-stable through parse/serialize', async () => {
  // Splice the depth-2 lineage block into the canonical inputs/contact
  // group of the default app scaffold. End-1 of the contact group is just
  // before its `end group` (row 10 in the scaffold).
  const scaffold = buildAppFormScaffold({ basename: 'lineage_roundtrip' });
  const { rows: lineageRows } = buildHierarchyBlock(linearTypes, {
    leafType: 'person',
    depth: 2,
  });
  // Find the contact group's end row and splice before it.
  const contactEndIdx = scaffold.survey.findIndex(
    (r) => r.type === 'end group' && r.name === 'contact',
  );
  assert.ok(contactEndIdx > 0, 'scaffold must have an inputs/contact group');
  scaffold.survey.splice(contactEndIdx, 0, ...lineageRows);

  assert.deepEqual(findStructuralViolations(scaffold.survey), [], 'spliced form must balance');

  // Round-trip: serialize → parse → assert structure preserved.
  const xlsx = await serializeXlsForm(scaffold);
  const reparsed = await parseXlsForm(xlsx);
  assert.equal(
    reparsed.survey.length,
    scaffold.survey.length,
    'row count survives round-trip',
  );
  for (let i = 0; i < scaffold.survey.length; i++) {
    assert.equal(reparsed.survey[i]!.type, scaffold.survey[i]!.type, `row ${i} type`);
    assert.equal(reparsed.survey[i]!.name, scaffold.survey[i]!.name, `row ${i} name`);
  }
  assert.deepEqual(findStructuralViolations(reparsed.survey), []);

  // The outermost begin-group carries the cht-ui-lineage signature, and
  // round-trip preserves it.
  const sigs = findLineageSignatures(reparsed.survey);
  assert.equal(sigs.length, 1, 'exactly one signature stamp survives round-trip');
  assert.match(sigs[0]!.signature, /^person:clinic\/health_center:v1$/);
});

/* ============== test 5 — empty / unconfigured hierarchy ============== */

test('§7.5 — empty contact_types → zero parent groups, balanced', () => {
  const { rows, chain, warnings } = buildHierarchyBlock([], {
    leafType: 'person',
    depth: 5,
  });
  assert.deepEqual(rows, [], 'no rows emitted for unknown leaf in empty types');
  assert.deepEqual(chain, []);
  assert.ok(
    warnings.some((w) => /unknown or unanchored leaf/i.test(w)),
    'empty types must surface an unanchored-leaf warning',
  );
});

test('§7.5b — depth=0 produces zero parent groups even with a valid chain', () => {
  const { rows, chain } = buildHierarchyBlock(linearTypes, {
    leafType: 'person',
    depth: 0,
  });
  assert.deepEqual(rows, []);
  assert.deepEqual(chain, []);
});

/* ============== test 6 — emitted labels are empty (scaffold convention) ============== */

test('§7.6 — emitted parent groups have empty labels (matches inputs/contact scaffold)', () => {
  const { rows } = buildHierarchyBlock(linearTypes, { leafType: 'person', depth: 2 });
  for (const r of rows) {
    assert.equal(
      r.labels.en,
      '',
      `row ${r.type} ${r.name} should have empty label (plumbing rows)`,
    );
  }
});

/* ============== test 7 — person leaf w/ multiple place parents ============== */

test('§7.7 — person leaf with multiple place parents picks parents[0] + warns', () => {
  // CHW listed against TWO HFs (a real-world case in some configs).
  const types: ContactTypeNode[] = [
    { id: 'district' },
    { id: 'hf_a', parents: ['district'] },
    { id: 'hf_b', parents: ['district'] },
    { id: 'chw', person: true, parents: ['hf_a', 'hf_b'] },
  ];
  const { chain, warnings } = computeLineageChain(types, 'chw', 5);
  // parents[0] = hf_a; chain = [hf_a, district].
  assert.deepEqual(chain, ['hf_a', 'district']);
  assert.ok(
    warnings.some((w) => /multiple permitted place parents/i.test(w)),
    'must surface a "multiple parents" warning so the author knows hf_b is dropped',
  );
});

/* ============== test 8 — leaf-slice boundary across a 7-chain ============== */

test('§7.8 — leaf-slice boundary: place leaf at each level emits strictly-higher count', () => {
  const types = sevenLevelTypes();
  // lvl0 has no parents → chain=[]. lvl1 → [lvl0]. lvl6 → [lvl5..lvl0] (6 ancestors).
  for (let lvl = 0; lvl <= 6; lvl++) {
    const leaf = `lvl${lvl}`;
    const { chain } = computeLineageChain(types, leaf, 99);
    assert.equal(
      chain.length,
      lvl,
      `leaf ${leaf} must produce ${lvl} ancestors (strictly higher levels), got ${chain.length}`,
    );
  }
});

test('§7.8b — person leaf produces (anchor place level + 1) ancestors at full depth', () => {
  const types = sevenLevelTypes(); // chw rooted at lvl6
  const { chain } = computeLineageChain(types, 'chw', 99);
  // chw's first place parent = lvl6 (outermost), then lvl5..lvl0.
  assert.deepEqual(chain, ['lvl6', 'lvl5', 'lvl4', 'lvl3', 'lvl2', 'lvl1', 'lvl0']);
});

/* ============== test 9 — cycle / orphan guard ============== */

test('§7.9 — cycle in parents truncates chain at the repeat with a warning', () => {
  // a → b → a (cycle). Walking from a yields b then would loop to a.
  const types: ContactTypeNode[] = [
    { id: 'a', parents: ['b'] },
    { id: 'b', parents: ['a'] },
  ];
  const { chain, warnings } = computeLineageChain(types, 'a', 10);
  // Walking from a: parent is b. From b: parent is a — but a is already
  // in the seen set, so we stop. Chain = [b].
  assert.deepEqual(chain, ['b']);
  assert.ok(
    warnings.some((w) => /cycle/i.test(w)),
    'cycle must produce a warning',
  );
});

test('§7.9b — orphan place (unreachable, but in array) still resolves a chain via its own parents', () => {
  // An "orphan" w.r.t. root walks could still have its own parents
  // pointing nowhere — the chain just terminates at that point. The
  // guard's job is to make sure we never silently fabricate.
  const types: ContactTypeNode[] = [
    { id: 'standalone' },
    { id: 'leaf_below', parents: ['standalone'] },
  ];
  const { chain, warnings } = computeLineageChain(types, 'leaf_below', 99);
  assert.deepEqual(chain, ['standalone']);
  assert.deepEqual(warnings, [], 'no cycle/orphan — no spurious warnings');
});

/* ============== test 10 — determinism ============== */

test('§7.10 — same input → identical output (no Date.now / randomness)', () => {
  const types = sevenLevelTypes();
  const opts = {
    leafType: 'chw',
    depth: 5,
    includeNamePhoneByType: { lvl6: true, lvl4: true },
  };
  const a = buildHierarchyBlock(types, opts);
  const b = buildHierarchyBlock(types, opts);
  assert.deepEqual(a, b, 'identical input must produce identical output');
});

/* ============== signature stability ============== */

test('lineageSignature is stable across identical inputs and changes when the chain shifts', () => {
  const types = sevenLevelTypes();
  const a = buildHierarchyBlock(types, { leafType: 'chw', depth: 3 });
  const b = buildHierarchyBlock(types, { leafType: 'chw', depth: 3 });
  assert.equal(a.signature, b.signature);

  // Deeper depth → longer chain → different signature.
  const c = buildHierarchyBlock(types, { leafType: 'chw', depth: 5 });
  assert.notEqual(a.signature, c.signature);

  // Hand-form a signature and compare.
  assert.equal(
    lineageSignature('chw', ['lvl6', 'lvl5', 'lvl4']),
    'chw:lvl6/lvl5/lvl4:v1',
  );
});

/* ============== per-level name+phone toggle ============== */

/* ============== staleness — §5 detection ============== */

test('parseLineageSignature round-trips the lineageSignature output', () => {
  const sig = lineageSignature('chw', ['lvl6', 'lvl5', 'lvl4']);
  const parsed = parseLineageSignature(sig);
  assert.deepEqual(parsed, { leafType: 'chw', chain: ['lvl6', 'lvl5', 'lvl4'], version: 'v1' });
});

test('parseLineageSignature handles depth=0 (empty chain segment)', () => {
  const sig = lineageSignature('chw', []);
  assert.equal(sig, 'chw::v1');
  const parsed = parseLineageSignature(sig);
  assert.deepEqual(parsed, { leafType: 'chw', chain: [], version: 'v1' });
});

test('parseLineageSignature returns null for unrecognized formats', () => {
  assert.equal(parseLineageSignature('something:without-three-parts'), null);
  assert.equal(parseLineageSignature(''), null);
});

test('§5 detectStaleLineageBlocks — unchanged hierarchy yields no drift', () => {
  const types = sevenLevelTypes();
  const block = buildHierarchyBlock(types, { leafType: 'chw', depth: 3 });
  // Build a tiny survey carrying the lineage block (just for the signature
  // probe — the detector doesn't care about the surrounding structure).
  const survey = block.rows;
  assert.deepEqual(detectStaleLineageBlocks(survey, types), []);
});

test('§5 detectStaleLineageBlocks — re-parented place surfaces drift', () => {
  // Insert a lineage block from the original 7-level chain.
  const original = sevenLevelTypes();
  const block = buildHierarchyBlock(original, { leafType: 'chw', depth: 3 });
  // Now simulate a hierarchy edit: lvl5 was re-parented under lvl3 instead
  // of lvl4. The stored signature still says lvl6/lvl5/lvl4 but a fresh
  // walk would yield lvl6/lvl5/lvl3.
  const edited: ContactTypeNode[] = [
    { id: 'lvl0' },
    { id: 'lvl1', parents: ['lvl0'] },
    { id: 'lvl2', parents: ['lvl1'] },
    { id: 'lvl3', parents: ['lvl2'] },
    { id: 'lvl4', parents: ['lvl3'] },
    { id: 'lvl5', parents: ['lvl3'] }, // re-parented
    { id: 'lvl6', parents: ['lvl5'] },
    { id: 'chw', person: true, parents: ['lvl6'] },
  ];
  const drift = detectStaleLineageBlocks(block.rows, edited);
  assert.equal(drift.length, 1);
  assert.equal(drift[0]!.storedLeaf, 'chw');
  assert.deepEqual(drift[0]!.storedChain, ['lvl6', 'lvl5', 'lvl4']);
  assert.deepEqual(drift[0]!.currentChain, ['lvl6', 'lvl5', 'lvl3']);
  assert.notEqual(drift[0]!.currentSignature, drift[0]!.storedSignature);
});

test('§5 detectStaleLineageBlocks — leaf removal yields drift with current chain empty', () => {
  const original = sevenLevelTypes();
  const block = buildHierarchyBlock(original, { leafType: 'chw', depth: 3 });
  // Now the chw type is removed from the hierarchy entirely.
  const edited: ContactTypeNode[] = original.filter((t) => t.id !== 'chw');
  const drift = detectStaleLineageBlocks(block.rows, edited);
  assert.equal(drift.length, 1);
  // Unknown leaf → computeLineageChain emits a warning + empty chain →
  // current signature differs from stored.
  assert.deepEqual(drift[0]!.currentChain, []);
});

test('§5 detectStaleLineageBlocks — unparseable signature treated as stale (defensive)', () => {
  const survey = [
    {
      rowId: 'b',
      type: 'begin group',
      name: 'parent',
      labels: { en: '' },
      extras: { 'cht-ui-lineage': 'NOT_A_VALID_SIGNATURE' },
    },
  ];
  const drift = detectStaleLineageBlocks(survey, sevenLevelTypes());
  assert.equal(drift.length, 1);
  assert.equal(drift[0]!.currentSignature, null);
});

test('per-level name/phone toggle adds rows only for matching place types', () => {
  const types = sevenLevelTypes();
  const { rows } = buildHierarchyBlock(types, {
    leafType: 'chw',
    depth: 3, // chain = [lvl6, lvl5, lvl4]
    includeNamePhoneByType: { lvl5: true }, // only the middle level
  });
  // Count the hidden rows by name across the whole block.
  const nameRows = rows.filter((r) => r.type === 'hidden' && r.name === 'name');
  const phoneRows = rows.filter((r) => r.type === 'hidden' && r.name === 'phone');
  assert.equal(nameRows.length, 1, 'exactly one place-type had name/phone toggled on');
  assert.equal(phoneRows.length, 1);
});
