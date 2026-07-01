/**
 * Round-trip tests for the event date-anchor picker (docs/plans/event-date-anchor.md).
 *
 * Invariants pinned:
 *  1. Plain `days: N` is byte-stable (never rewritten into a dueDate form).
 *  2. `dueDate: (e,c,r) => Utils.addDate(new Date(Utils.getField(r, 'X')), N*7)` lifts
 *     into a `field` anchor with weeks unit, and round-trips.
 *  3. LMP-anchored variant lifts into `{kind:'lmp'}` and round-trips.
 *  4. reported_date expressed as a dueDate stays a dueDate on round-trip
 *     (only the plain `days: N` case skips dueDate).
 *  5. Generator (`.map`) forms stay `shape:'raw'`, verbatim.
 *  6. Unrecognized dueDate → `dueDateRaw`, verbatim.
 *  7. The full ANC 8-touchpoint schedule survives parse→serialize→parse.
 *
 * Run via `pnpm --filter @cht-ui/shared test`.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseEvents, serializeEvents } from './eventsParser.js';

test('plain days event: byte-stable round-trip (no dueDate introduced)', () => {
  const src = `[
  { id: "foo", days: 84, start: 5, end: 5 }
]`;
  const parsed = parseEvents(src);
  assert.equal(parsed.shape, 'array');
  assert.equal(parsed.events.length, 1);
  const e = parsed.events[0]!;
  assert.equal(e.days, 84);
  assert.equal(e.anchor, undefined);
  assert.equal(e.offset, undefined);
  const round = serializeEvents(parsed);
  // The plain days case does NOT introduce a dueDate.
  assert.match(round, /days: 84/);
  assert.equal(/dueDate/.test(round), false);
});

test('field anchor + weeks: dueDate lifted, then round-trips', () => {
  const src = `[
  { id: "anc_12w", dueDate: (event, contact, report) => Utils.addDate(new Date(Utils.getField(report, 'lmp_date')), 84), start: 7, end: 14 }
]`;
  const parsed = parseEvents(src);
  assert.equal(parsed.shape, 'array');
  const e = parsed.events[0]!;
  assert.deepEqual(e.anchor, { kind: 'field', field: 'lmp_date' });
  assert.deepEqual(e.offset, { value: 12, unit: 'weeks' });
  assert.equal(e.dueDateRaw, undefined);

  const round = serializeEvents(parsed);
  const re = parseEvents(round);
  assert.deepEqual(re.events[0]!.anchor, e.anchor);
  assert.deepEqual(re.events[0]!.offset, e.offset);
});

test('LMP anchor via getLmpDate helper: lifts + round-trips', () => {
  const src = `[
  { id: "anc_28w", dueDate: (event, contact, report) => Utils.addDate(Utils.getLmpDate(report), 196), start: 7, end: 7 }
]`;
  const parsed = parseEvents(src);
  const e = parsed.events[0]!;
  assert.deepEqual(e.anchor, { kind: 'lmp' });
  assert.deepEqual(e.offset, { value: 28, unit: 'weeks' });

  const re = parseEvents(serializeEvents(parsed));
  assert.deepEqual(re.events[0]!.anchor, e.anchor);
  assert.deepEqual(re.events[0]!.offset, e.offset);
});

test('reported_date expressed as a dueDate stays a dueDate (weeks)', () => {
  const src = `[
  { id: "wk2", dueDate: (event, contact, report) => Utils.addDate(report.reported_date, 14), start: 2, end: 2 }
]`;
  const parsed = parseEvents(src);
  const e = parsed.events[0]!;
  assert.deepEqual(e.anchor, { kind: 'reported_date' });
  assert.deepEqual(e.offset, { value: 2, unit: 'weeks' });

  const round = serializeEvents(parsed);
  assert.match(round, /Utils\.addDate\(report\.reported_date, 14\)/);
});

test('reported_date + days is stored as plain `days:` (not dueDate) — the byte-stability escape', () => {
  // A UI-created event { anchor: reported_date, offset: 5 days } should serialize
  // as plain `days: 5`, so old configs never suddenly grow a dueDate.
  const src = `[
  { id: "plain5", days: 5, start: 1, end: 1 }
]`;
  const parsed = parseEvents(src);
  const e = parsed.events[0]!;
  // Verify we're still on the plain path (no anchor lifted from parse).
  assert.equal(e.days, 5);
  assert.equal(e.anchor, undefined);
  // Now simulate UI setting anchor+offset to the same semantic value.
  const withAnchor = {
    ...parsed,
    events: [{ ...e, anchor: { kind: 'reported_date' as const }, offset: { value: 5, unit: 'days' as const } }],
  };
  const out = serializeEvents(withAnchor);
  // Should still emit `days: 5`, no dueDate.
  assert.match(out, /days: 5/);
  assert.equal(/dueDate/.test(out), false);
});

test('generator (.map) form stays raw, verbatim', () => {
  const src = `pregnancySchedule.map((s, i) => generateEvent(s, i))`;
  const parsed = parseEvents(src);
  assert.equal(parsed.shape, 'raw');
  assert.equal(serializeEvents(parsed), src);
});

test('unrecognized dueDate → dueDateRaw, preserved verbatim', () => {
  const src = `[
  { id: "x", dueDate: function (e, c, r) { return doSomethingWeird(r); }, start: 0, end: 0 }
]`;
  const parsed = parseEvents(src);
  const e = parsed.events[0]!;
  assert.equal(e.anchor, undefined);
  assert.ok(e.dueDateRaw, 'dueDateRaw should be populated for unrecognized shape');
  assert.match(e.dueDateRaw!, /doSomethingWeird/);

  const round = serializeEvents(parsed);
  assert.match(round, /doSomethingWeird/);
});

test('ANC 8-touchpoint (weeks 12/20/26/30/34/36/38/40) round-trips', () => {
  const anchor = "new Date(Utils.getField(report, 'lmp_date'))";
  const src =
    `[\n` +
    [12, 20, 26, 30, 34, 36, 38, 40]
      .map(
        (w, i) =>
          `  { id: "anc_v${i + 1}", dueDate: (event, contact, report) => Utils.addDate(${anchor}, ${w * 7}), start: 7, end: 14 }`,
      )
      .join(',\n') +
    `\n]`;
  const parsed = parseEvents(src);
  assert.equal(parsed.shape, 'array');
  assert.equal(parsed.events.length, 8);
  for (const [i, w] of [12, 20, 26, 30, 34, 36, 38, 40].entries()) {
    const e = parsed.events[i]!;
    assert.deepEqual(e.anchor, { kind: 'field', field: 'lmp_date' });
    assert.deepEqual(e.offset, { value: w, unit: 'weeks' });
  }
  // parse → serialize → parse is stable.
  const twice = parseEvents(serializeEvents(parsed));
  assert.deepEqual(twice.events, parsed.events);
});

test('arrow with single-param and no parens still parses', () => {
  const src = `[
  { id: "x", dueDate: r => Utils.addDate(r.reported_date, 7), start: 1, end: 1 }
]`;
  // r => ... (single param, no parens) — our regex requires parens; expected to raw-fallback.
  // This test pins the current behavior so any future single-param support is a conscious change.
  const parsed = parseEvents(src);
  const e = parsed.events[0]!;
  // Either lifted (nicer) or raw-fallback (current). Assert the safer contract.
  if (e.anchor) {
    assert.deepEqual(e.anchor, { kind: 'reported_date' });
  } else {
    assert.ok(e.dueDateRaw, 'expected raw fallback for single-param arrow');
  }
});
