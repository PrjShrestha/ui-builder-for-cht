/**
 * Reducer tests for the condition builder state machine (Slice 2 commit B
 * of docs/plans/condition-builder.md v0.2).
 *
 * Each test exercises ONE invariant from plan §3 / §6. Together they
 * prove:
 *   - commit pushes draft, sets lockedConnector (§3.3 lock-after-first)
 *   - pop pops last clause + last connector together (no orphan connector)
 *   - start-over is byte-safe (no caller-visible write trigger; §3.5)
 *   - insertAll never emits a flat-mixed string OR a dangling connector
 *     (§3.7 — the parser is the safety net)
 *   - commit-or-while-and-locked is a no-op (§3.3 structural guarantee)
 *   - raw fallback expressions disable chaining entirely (§3.4)
 *   - hydrate-from-existing round-trips a flat two-clause expression
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  conditionBuilderReducer,
  initialConditionBuilderState,
  isInsertReady,
  serializeBuilderState,
  type Clause,
  type ConditionBuilderState,
} from './conditionReducer.js';
import { parseRelevant, parseRelevantGrouped } from '../xlsform/relevantParser.js';

function withColumn(column: 'relevant' | 'calculation' | 'constraint' | 'choice_filter'): ConditionBuilderState {
  return conditionBuilderReducer(initialConditionBuilderState, {
    kind: 'set-column',
    column,
    existingValue: '',
  });
}

function setDraft(state: ConditionBuilderState, partial: Partial<Clause>): ConditionBuilderState {
  return conditionBuilderReducer(state, { kind: 'set-draft', partial });
}

function commit(state: ConditionBuilderState, connector: 'and' | 'or'): ConditionBuilderState {
  return conditionBuilderReducer(state, { kind: 'commit-clause', connector });
}

/* ----------------------------- commit-clause ----------------------------- */

test('commit-clause: first commit pushes draft to clauses, sets lockedConnector, leaves connectors empty', () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'sex', op: '=', value: 'female' });
  s = commit(s, 'and');

  assert.equal(s.clauses.length, 1);
  assert.deepEqual(s.clauses[0], { field: 'sex', op: '=', value: 'female' });
  assert.deepEqual(s.connectors, []);
  assert.equal(s.lockedConnector, 'and');
  assert.deepEqual(s.draft, { field: '', op: '=', value: '' });
});

test('commit-clause: second commit adds the connector between clauses[0] and clauses[1]', () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'sex', op: '=', value: 'female' });
  s = commit(s, 'and');
  s = setDraft(s, { field: 'age', op: '>', value: '18' });
  s = commit(s, 'and');

  assert.equal(s.clauses.length, 2);
  assert.equal(s.connectors.length, 1);
  assert.equal(s.connectors[0], 'and');
  assert.equal(s.lockedConnector, 'and');
});

test('commit-clause: refuses a partial draft (no field) — no-op', () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: '', op: '=', value: 'x' });
  const before = s;
  s = commit(s, 'and');
  assert.deepEqual(s, before, 'partial draft must not commit');
});

test('commit-clause: refuses a partial draft (no value for comparison) — no-op', () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'age', op: '>', value: '' });
  const before = s;
  s = commit(s, 'and');
  assert.deepEqual(s, before);
});

test("commit-clause: `commitClause('or')` while lockedConnector==='and' is a no-op (§3.3 — flat-mixed structurally impossible)", () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'sex', op: '=', value: 'female' });
  s = commit(s, 'and');
  s = setDraft(s, { field: 'age', op: '>', value: '18' });
  s = commit(s, 'and');
  const before = s;
  s = setDraft(s, { field: 'role', op: '=', value: 'patient' });
  s = commit(s, 'or'); // mismatched connector
  // The draft set succeeds; commit-clause is the no-op.
  assert.equal(s.clauses.length, before.clauses.length);
  assert.equal(s.lockedConnector, 'and');
  assert.deepEqual(s.draft, { field: 'role', op: '=', value: 'patient' });
});

/* -------------------------------- pop ------------------------------------ */

test('pop-clause: pops last clause AND the trailing connector together (no orphan connector)', () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'a', op: '=', value: '1' });
  s = commit(s, 'and');
  s = setDraft(s, { field: 'b', op: '=', value: '2' });
  s = commit(s, 'and');
  s = setDraft(s, { field: 'c', op: '=', value: '3' });
  s = commit(s, 'and');
  // 3 clauses, 2 connectors
  assert.equal(s.clauses.length, 3);
  assert.equal(s.connectors.length, 2);

  s = conditionBuilderReducer(s, { kind: 'pop-clause' });
  // 2 clauses, 1 connector — invariant `connectors.length === clauses.length - 1`
  assert.equal(s.clauses.length, 2);
  assert.equal(s.connectors.length, 1);
  assert.equal(s.lockedConnector, 'and');

  s = conditionBuilderReducer(s, { kind: 'pop-clause' });
  // 1 clause, 0 connectors. Locked connector unlocked (so user can pick again).
  assert.equal(s.clauses.length, 1);
  assert.equal(s.connectors.length, 0);
  assert.equal(s.lockedConnector, null);
});

test('pop-clause: pop on empty stack is a no-op', () => {
  const s = withColumn('relevant');
  const after = conditionBuilderReducer(s, { kind: 'pop-clause' });
  assert.deepEqual(after, s);
});

/* ----------------------------- start-over -------------------------------- */

test("start-over: clears clauses/connectors/draft/lockedConnector but keeps column (§3.5 — byte-safe; reducer doesn't write)", () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'sex', op: '=', value: 'female' });
  s = commit(s, 'and');
  s = setDraft(s, { field: 'age', op: '>', value: '18' });
  s = commit(s, 'and');
  s = setDraft(s, { field: 'role', op: '=', value: 'patient' }); // mid-build
  // Now: 2 committed clauses + a draft + locked connector
  s = conditionBuilderReducer(s, { kind: 'start-over' });

  assert.equal(s.column, 'relevant', 'column must NOT be cleared');
  assert.deepEqual(s.clauses, []);
  assert.deepEqual(s.connectors, []);
  assert.equal(s.lockedConnector, null);
  assert.deepEqual(s.draft, { field: '', op: '=', value: '' });
  assert.equal(s.rawFallback, null);
});

/* ----------------------------- serialize --------------------------------- */

test("serialize: emits canonical XLSForm fragment, parses back with isRawFallback:false (§3.7 — never emits flat-mixed)", () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'sex', op: '=', value: 'female' });
  s = commit(s, 'and');
  s = setDraft(s, { field: 'age', op: '>', value: '18' });
  s = commit(s, 'and');

  const serialized = serializeBuilderState(s);
  assert.equal(serialized, `\${sex} = 'female' and \${age} > 18`);

  // Round-trip through the parser: must not be a raw fallback. The
  // builder is structurally INCAPABLE of producing a string the parser
  // can't decompose (the AND/OR-mixing mutator is a reducer no-op above).
  const parsed = parseRelevant(serialized);
  assert.equal(parsed.isRawFallback, false);
  assert.equal(parsed.rules.length, 2);
});

test('serialize: with an empty draft, emits committed clauses only — never a dangling connector', () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'sex', op: '=', value: 'female' });
  s = commit(s, 'and');
  s = setDraft(s, { field: 'age', op: '>', value: '18' });
  s = commit(s, 'and');
  // No draft in flight.
  const out = serializeBuilderState(s);
  // No trailing ` and ` or ` or `.
  assert.ok(!/\s(and|or)\s*$/.test(out), `output must not end with a dangling connector: ${out}`);
});

test('serialize: includes the draft if it is complete', () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'sex', op: '=', value: 'female' });
  s = commit(s, 'and');
  s = setDraft(s, { field: 'age', op: '>', value: '18' });
  // draft is complete but not committed
  const out = serializeBuilderState(s);
  assert.equal(out, `\${sex} = 'female' and \${age} > 18`);
});

test('serialize: empty session emits empty string', () => {
  const s = withColumn('relevant');
  assert.equal(serializeBuilderState(s), '');
});

test('serialize: selected and selected-not produce canonical FHIR-ish output', () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'conds', op: 'selected', value: 'x' });
  s = commit(s, 'and');
  s = setDraft(s, { field: 'conds', op: 'selected-not', value: 'none' });
  s = commit(s, 'and');
  const out = serializeBuilderState(s);
  assert.equal(out, `selected(\${conds}, 'x') and not(selected(\${conds}, 'none'))`);
  assert.equal(parseRelevant(out).isRawFallback, false);
});

/* ----------------------------- isInsertReady ----------------------------- */

test('isInsertReady: false on empty session', () => {
  assert.equal(isInsertReady(initialConditionBuilderState), false);
});

test('isInsertReady: false when column is unset', () => {
  let s = withColumn('relevant');
  s = conditionBuilderReducer(s, { kind: 'set-column', column: '', existingValue: '' });
  s = setDraft(s, { field: 'sex', op: '=', value: 'female' });
  assert.equal(isInsertReady(s), false);
});

test('isInsertReady: true when single complete draft + no committed clauses', () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'sex', op: '=', value: 'female' });
  assert.equal(isInsertReady(s), true);
});

test('isInsertReady: false when partial draft + committed clauses (would emit dangling connector)', () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'sex', op: '=', value: 'female' });
  s = commit(s, 'and');
  s = setDraft(s, { field: 'age', op: '>', value: '' }); // partial — value missing
  assert.equal(isInsertReady(s), false);
});

test('isInsertReady: true when committed clauses + empty draft', () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'sex', op: '=', value: 'female' });
  s = commit(s, 'and');
  assert.equal(isInsertReady(s), true);
});

/* ---------------------------- raw fallback ------------------------------- */

test("raw-fallback: a flat-mixed `and`/`or` existing value disables chaining entirely (§3.4)", () => {
  // The existing column has mixed-combinator without parens — chaining
  // must be disabled and the original text preserved verbatim.
  const s = conditionBuilderReducer(initialConditionBuilderState, {
    kind: 'set-column',
    column: 'relevant',
    existingValue: `\${a} = 'x' and \${b} > 10 or \${c} = 'y'`,
  });
  assert.equal(s.rawFallback, `\${a} = 'x' and \${b} > 10 or \${c} = 'y'`);
  assert.deepEqual(s.clauses, []);
  assert.equal(isInsertReady(s), false);
});

test('hydrate: a grouped-paren expression populates the groups arm (commit C)', () => {
  // Commit C wakes up the `groups` arm: `(A and B) or C` reopens as two
  // subgroups joined by the outer OR. The newest subgroup is active by
  // default (the user most recently appended it).
  const s = conditionBuilderReducer(initialConditionBuilderState, {
    kind: 'set-column',
    column: 'relevant',
    existingValue: `(\${a} = 'x' and \${b} > 10) or \${c} = 'y'`,
  });
  assert.equal(s.rawFallback, null);
  assert.ok(s.groups);
  assert.equal(s.groups.length, 2);
  assert.equal(s.outerConnector, 'or');
  assert.equal(s.activeGroupIndex, 1);
  assert.equal(s.groups[0]?.connector, 'and');
  assert.equal(s.groups[0]?.clauses.length, 2);
  assert.equal(s.groups[1]?.clauses.length, 1);
  // Flat arms must be empty in grouped mode.
  assert.deepEqual(s.clauses, []);
  assert.equal(s.lockedConnector, null);
});

/* ------------------------------ rehydrate -------------------------------- */

test('hydrate: opening a row with an existing two-clause AND rehydrates two clauses + locked AND', () => {
  const s = conditionBuilderReducer(initialConditionBuilderState, {
    kind: 'set-column',
    column: 'relevant',
    existingValue: `\${sex} = 'female' and \${age} > 18`,
  });
  assert.equal(s.column, 'relevant');
  assert.equal(s.clauses.length, 2);
  assert.deepEqual(s.clauses[0], { field: 'sex', op: '=', value: 'female' });
  assert.deepEqual(s.clauses[1], { field: 'age', op: '>', value: '18' });
  assert.deepEqual(s.connectors, ['and']);
  assert.equal(s.lockedConnector, 'and');
  assert.equal(s.rawFallback, null);
});

test('hydrate: single canonical clause produces one committed clause, no locked connector', () => {
  const s = conditionBuilderReducer(initialConditionBuilderState, {
    kind: 'set-column',
    column: 'relevant',
    existingValue: `\${sex} = 'female'`,
  });
  assert.equal(s.clauses.length, 1);
  assert.equal(s.lockedConnector, null);
});

test('hydrate: empty existing value produces an empty session for the column', () => {
  const s = conditionBuilderReducer(initialConditionBuilderState, {
    kind: 'set-column',
    column: 'relevant',
    existingValue: '',
  });
  assert.equal(s.column, 'relevant');
  assert.equal(s.clauses.length, 0);
  assert.equal(s.rawFallback, null);
});

test('hydrate: a row with a `selected()` + comparison chain rehydrates both', () => {
  const s = conditionBuilderReducer(initialConditionBuilderState, {
    kind: 'set-column',
    column: 'relevant',
    existingValue: `selected(\${conds}, 'x') and \${age} > 18`,
  });
  assert.equal(s.clauses.length, 2);
  assert.deepEqual(s.clauses[0], { field: 'conds', op: 'selected', value: 'x' });
  assert.deepEqual(s.clauses[1], { field: 'age', op: '>', value: '18' });
});

test("hydrate: a row containing `not(selected(...))` rehydrates with op='selected-not'", () => {
  const s = conditionBuilderReducer(initialConditionBuilderState, {
    kind: 'set-column',
    column: 'relevant',
    existingValue: `not(selected(\${conds}, 'none'))`,
  });
  assert.equal(s.clauses.length, 1);
  assert.deepEqual(s.clauses[0], { field: 'conds', op: 'selected-not', value: 'none' });
});

test('hydrate: a row with date_offset (commit-B-unsupported rule kind) falls back to raw, text preserved', () => {
  // date_offset is structured by the parser but the commit-B Clause shape
  // can't represent it. Fall back to raw rather than silently lose info.
  const existing = `today() - \${visit_date} < 30`;
  const s = conditionBuilderReducer(initialConditionBuilderState, {
    kind: 'set-column',
    column: 'relevant',
    existingValue: existing,
  });
  assert.equal(s.rawFallback, existing);
  assert.equal(s.clauses.length, 0);
});

/* ------------------------- set-draft semantics --------------------------- */

test('set-draft: merges partial into draft, leaves committed clauses untouched', () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'sex', op: '=', value: 'female' });
  s = commit(s, 'and');
  s = setDraft(s, { field: 'age' });
  assert.deepEqual(s.draft, { field: 'age', op: '=', value: '' });
  assert.equal(s.clauses.length, 1);
});

/* ============================ Slice 2.C — grouped mode ============================ */
/*
 * Cases per synthesis §4. Together they prove the structural no-flat-
 * mixed guarantee at the reducer boundary (the JSX surface is exercised
 * via Playwright in the e2e suite).
 */

/** Helper to set up a 2-clause AND-locked flat chain. */
function withTwoFlatClauses(): ConditionBuilderState {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'a', op: '=', value: 'x' });
  s = commit(s, 'and');
  s = setDraft(s, { field: 'b', op: '>', value: '10' });
  s = commit(s, 'and');
  return s;
}

test('enter-group-mode: refused when fewer than 2 clauses are committed', () => {
  let s = withColumn('relevant');
  s = setDraft(s, { field: 'a', op: '=', value: 'x' });
  s = commit(s, 'and');
  const before = s;
  s = conditionBuilderReducer(s, { kind: 'enter-group-mode' });
  assert.deepEqual(s, before, 'one-clause state must not enter grouped mode');
});

test('enter-group-mode: refused when rawFallback is set', () => {
  const s = conditionBuilderReducer(initialConditionBuilderState, {
    kind: 'set-column',
    column: 'relevant',
    existingValue: `\${a} = 'x' or \${b} > 10 and \${c} = 'y'`, // flat-mixed → raw
  });
  assert.ok(s.rawFallback);
  const after = conditionBuilderReducer(s, { kind: 'enter-group-mode' });
  assert.deepEqual(after, s, 'raw fallback must refuse grouped-mode entry');
});

test('enter-group-mode: refused when the draft is partial-incomplete (no silent drop)', () => {
  let s = withTwoFlatClauses();
  s = setDraft(s, { field: 'c', op: '=', value: '' }); // started but incomplete
  const before = s;
  s = conditionBuilderReducer(s, { kind: 'enter-group-mode' });
  assert.deepEqual(s, before);
});

test("enter-group-mode: zeroes flat fields and collects clauses into groups[0], activeGroupIndex=0", () => {
  const flat = withTwoFlatClauses();
  const grouped = conditionBuilderReducer(flat, { kind: 'enter-group-mode' });
  assert.deepEqual(grouped.clauses, []);
  assert.deepEqual(grouped.connectors, []);
  assert.equal(grouped.lockedConnector, null);
  assert.ok(grouped.groups);
  assert.equal(grouped.groups.length, 1);
  assert.deepEqual(grouped.groups[0]?.clauses, flat.clauses);
  assert.equal(grouped.groups[0]?.connector, 'and');
  assert.equal(grouped.activeGroupIndex, 0);
  assert.equal(grouped.outerConnector, null);
});

test('enter-group-mode: preserves a complete draft verbatim (mid-thought clause survives)', () => {
  let s = withTwoFlatClauses();
  s = setDraft(s, { field: 'c', op: '=', value: 'y' });
  const before = s.draft;
  s = conditionBuilderReducer(s, { kind: 'enter-group-mode' });
  assert.deepEqual(s.draft, before);
});

test('add-subgroup: refused unless groups.length===1 with at least one clause', () => {
  // No groups yet.
  const flat = withTwoFlatClauses();
  let s = conditionBuilderReducer(flat, { kind: 'add-subgroup', connector: 'or' });
  assert.equal(s.groups, null);

  // Groups[0] empty (degenerate, but defend against it).
  s = {
    ...flat,
    clauses: [],
    connectors: [],
    lockedConnector: null,
    groups: [{ clauses: [], connector: 'and' }],
    activeGroupIndex: 0,
  };
  const after = conditionBuilderReducer(s, { kind: 'add-subgroup', connector: 'or' });
  assert.deepEqual(after, s);
});

test('add-subgroup: sets outerConnector and activates subgroup 2', () => {
  const flat = withTwoFlatClauses();
  let s = conditionBuilderReducer(flat, { kind: 'enter-group-mode' });
  s = conditionBuilderReducer(s, { kind: 'add-subgroup', connector: 'or' });
  assert.equal(s.outerConnector, 'or');
  assert.equal(s.activeGroupIndex, 1);
  assert.ok(s.groups);
  assert.equal(s.groups.length, 2);
  assert.deepEqual(s.groups[1]?.clauses, []);
});

test('commit-clause in grouped mode routes into the active subgroup', () => {
  const flat = withTwoFlatClauses();
  let s = conditionBuilderReducer(flat, { kind: 'enter-group-mode' });
  s = conditionBuilderReducer(s, { kind: 'add-subgroup', connector: 'or' });
  s = setDraft(s, { field: 'c', op: '=', value: 'y' });
  s = commit(s, 'and');

  // Subgroup 1 untouched, subgroup 2 gained the clause.
  assert.equal(s.groups?.[0]?.clauses.length, 2, 'subgroup 1 stays at 2 clauses');
  assert.equal(s.groups?.[1]?.clauses.length, 1, 'subgroup 2 gained the new clause');
  assert.deepEqual(s.groups?.[1]?.clauses[0], { field: 'c', op: '=', value: 'y' });
});

test('commit-clause in grouped mode: intra-subgroup mixed-connector is a no-op (§3.3)', () => {
  const flat = withTwoFlatClauses();
  let s = conditionBuilderReducer(flat, { kind: 'enter-group-mode' });
  s = conditionBuilderReducer(s, { kind: 'add-subgroup', connector: 'or' });
  s = setDraft(s, { field: 'c', op: '=', value: 'y' });
  s = commit(s, 'and'); // subgroup 2 locks AND

  s = setDraft(s, { field: 'd', op: '=', value: 'z' });
  const before = s;
  s = commit(s, 'or'); // mismatched — should be no-op
  assert.equal(s.groups?.[1]?.clauses.length, before.groups?.[1]?.clauses.length);
  assert.equal(s.groups?.[1]?.connector, 'and');
});

test('pop-clause in subgroup 2 that empties it drops subgroup 2 entirely', () => {
  const flat = withTwoFlatClauses();
  let s = conditionBuilderReducer(flat, { kind: 'enter-group-mode' });
  s = conditionBuilderReducer(s, { kind: 'add-subgroup', connector: 'or' });
  s = setDraft(s, { field: 'c', op: '=', value: 'y' });
  s = commit(s, 'and');
  // Subgroup 2 has 1 clause; pop empties it.
  s = conditionBuilderReducer(s, { kind: 'pop-clause' });
  assert.equal(s.groups?.length, 1);
  assert.equal(s.outerConnector, null);
  assert.equal(s.activeGroupIndex, 0);
  assert.equal(s.groups?.[0]?.clauses.length, 2, 'subgroup 1 untouched');
});

test('exit-group-mode (flatten) with a single subgroup restores the flat chain losslessly', () => {
  const flat = withTwoFlatClauses();
  const grouped = conditionBuilderReducer(flat, { kind: 'enter-group-mode' });
  const reflattened = conditionBuilderReducer(grouped, { kind: 'exit-group-mode' });
  assert.deepEqual(reflattened.clauses, flat.clauses);
  assert.deepEqual(reflattened.connectors, flat.connectors);
  assert.equal(reflattened.lockedConnector, flat.lockedConnector);
  assert.equal(reflattened.groups, null);
});

test('exit-group-mode with two non-empty subgroups is a no-op (would force flat-mixed)', () => {
  const flat = withTwoFlatClauses();
  let s = conditionBuilderReducer(flat, { kind: 'enter-group-mode' });
  s = conditionBuilderReducer(s, { kind: 'add-subgroup', connector: 'or' });
  s = setDraft(s, { field: 'c', op: '=', value: 'y' });
  s = commit(s, 'and');
  const before = s;
  s = conditionBuilderReducer(s, { kind: 'exit-group-mode' });
  assert.deepEqual(s, before);
});

test('exit-group-mode with one empty + one non-empty subgroup: empty dropped, flatten proceeds', () => {
  const flat = withTwoFlatClauses();
  let s = conditionBuilderReducer(flat, { kind: 'enter-group-mode' });
  s = conditionBuilderReducer(s, { kind: 'add-subgroup', connector: 'or' });
  // Subgroup 2 stays empty; flatten should collapse to subgroup 1 only.
  s = conditionBuilderReducer(s, { kind: 'exit-group-mode' });
  assert.deepEqual(s.clauses, flat.clauses);
  assert.equal(s.groups, null);
});

test('set-active-group: switches focus only when the draft is empty or complete', () => {
  const flat = withTwoFlatClauses();
  let s = conditionBuilderReducer(flat, { kind: 'enter-group-mode' });
  s = conditionBuilderReducer(s, { kind: 'add-subgroup', connector: 'or' });
  // Partial draft → refuse the switch.
  s = setDraft(s, { field: 'c', op: '=', value: '' });
  const partialBefore = s;
  s = conditionBuilderReducer(s, { kind: 'set-active-group', index: 0 });
  assert.deepEqual(s, partialBefore);
  // Clear → switch allowed.
  s = setDraft(s, { field: '', op: '=', value: '' });
  s = conditionBuilderReducer(s, { kind: 'set-active-group', index: 0 });
  assert.equal(s.activeGroupIndex, 0);
});

test('start-over: zeros groups/outerConnector/activeGroupIndex along with flat fields', () => {
  const flat = withTwoFlatClauses();
  let s = conditionBuilderReducer(flat, { kind: 'enter-group-mode' });
  s = conditionBuilderReducer(s, { kind: 'add-subgroup', connector: 'or' });
  s = setDraft(s, { field: 'c', op: '=', value: 'y' });
  s = conditionBuilderReducer(s, { kind: 'start-over' });
  assert.equal(s.groups, null);
  assert.equal(s.outerConnector, null);
  assert.equal(s.activeGroupIndex, null);
  assert.deepEqual(s.clauses, []);
  assert.equal(s.lockedConnector, null);
  assert.equal(s.column, 'relevant', 'column must survive start-over');
});

test('serialize: grouped state with one subgroup emits no parens (degrades to flat)', () => {
  const flat = withTwoFlatClauses();
  const grouped = conditionBuilderReducer(flat, { kind: 'enter-group-mode' });
  assert.equal(
    serializeBuilderState(grouped),
    `\${a} = 'x' and \${b} > 10`,
  );
});

test('serialize: grouped state with two non-empty subgroups emits canonical (A op B) or C', () => {
  const flat = withTwoFlatClauses();
  let s = conditionBuilderReducer(flat, { kind: 'enter-group-mode' });
  s = conditionBuilderReducer(s, { kind: 'add-subgroup', connector: 'or' });
  s = setDraft(s, { field: 'c', op: '=', value: 'y' });
  s = commit(s, 'and');
  assert.equal(
    serializeBuilderState(s),
    `(\${a} = 'x' and \${b} > 10) or \${c} = 'y'`,
  );
});

test("serialize: builder output ALWAYS round-trips through parseRelevantGrouped with isRawFallback:false (no flat-mixed reachable)", () => {
  // Exhaustive guard: drive a randomised-but-deterministic commit sequence
  // in BOTH flat and grouped modes and assert every emission parses cleanly.
  const seeds: Array<() => ConditionBuilderState> = [
    // Pure flat AND.
    () => {
      let s = withColumn('relevant');
      s = setDraft(s, { field: 'a', op: '=', value: '1' });
      s = commit(s, 'and');
      s = setDraft(s, { field: 'b', op: '=', value: '2' });
      s = commit(s, 'and');
      return s;
    },
    // Pure flat OR.
    () => {
      let s = withColumn('relevant');
      s = setDraft(s, { field: 'a', op: '=', value: '1' });
      s = commit(s, 'or');
      s = setDraft(s, { field: 'b', op: '=', value: '2' });
      s = commit(s, 'or');
      return s;
    },
    // Flat with mid-build mismatched commit (the no-op invariant).
    () => {
      let s = withColumn('relevant');
      s = setDraft(s, { field: 'a', op: '=', value: '1' });
      s = commit(s, 'and');
      s = setDraft(s, { field: 'b', op: '=', value: '2' });
      s = commit(s, 'or'); // no-op
      s = commit(s, 'and');
      return s;
    },
    // Grouped (AND-chain) or C.
    () => {
      const flat = withTwoFlatClauses();
      let s = conditionBuilderReducer(flat, { kind: 'enter-group-mode' });
      s = conditionBuilderReducer(s, { kind: 'add-subgroup', connector: 'or' });
      s = setDraft(s, { field: 'c', op: '=', value: 'y' });
      s = commit(s, 'and');
      return s;
    },
    // Grouped (AND) and (OR-chain).
    () => {
      const flat = withTwoFlatClauses();
      let s = conditionBuilderReducer(flat, { kind: 'enter-group-mode' });
      s = conditionBuilderReducer(s, { kind: 'add-subgroup', connector: 'and' });
      s = setDraft(s, { field: 'c', op: '=', value: 'y' });
      s = commit(s, 'or');
      s = setDraft(s, { field: 'd', op: '=', value: 'z' });
      s = commit(s, 'or');
      return s;
    },
  ];
  for (const seed of seeds) {
    const s = seed();
    const out = serializeBuilderState(s);
    if (out === '') continue;
    const parsed = parseRelevantGrouped(out);
    assert.equal(
      parsed.isRawFallback,
      false,
      `Builder produced an output that doesn't round-trip cleanly: ${out}`,
    );
  }
});
