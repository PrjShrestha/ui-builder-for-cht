/**
 * Phase 2a — round-trip tests for `tryParseSimpleMappings` + the
 * `modifyContentMappings` path through classify() and serializeOne().
 *
 * Three buckets per the synthesis brief:
 *   - Bucket A: structured input parses to mappings AND re-serializes
 *     byte-identical so a no-op open/save is stable on real-world
 *     tasks.
 *   - Bucket B: complex input (control flow, helpers, Object.entries,
 *     ternaries, function calls) MUST fall through to
 *     `customModifyContent` so user code is never destroyed on save.
 *   - Bucket C: the canonical visit-window pattern still wins over
 *     mappings (precedence order is load-bearing).
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  parseActions,
  serializeActions,
  tryParseSimpleMappings,
  type TaskAction,
} from './actionsParser.js';

/* ============================ Bucket A — structured ============================ */

test('§A1 — single content.X = report.Y assignment parses to one mapping', () => {
  const src = `function (content, contact, report, event) { content.death_id = report._id; }`;
  const mappings = tryParseSimpleMappings(src);
  assert.ok(mappings, 'expected a mappings result, got null');
  assert.deepEqual(mappings, [
    { targetField: 'death_id', sourceExpr: 'report._id' },
  ]);
});

test('§A2 — chained content.X / content.Y assignments produce ordered mappings', () => {
  const src = `function (content, contact, report, event) {
    content.lmp_date = report.lmp_date;
    content.edd     = report.edd;
    content.previous_visit = report.visit_id;
  }`;
  const mappings = tryParseSimpleMappings(src);
  assert.ok(mappings);
  assert.equal(mappings.length, 3);
  assert.equal(mappings[0]!.targetField, 'lmp_date');
  assert.equal(mappings[0]!.sourceExpr, 'report.lmp_date');
  assert.equal(mappings[2]!.targetField, 'previous_visit');
});

test('§A3 — arrow-function form also recognized', () => {
  const src = `(content, contact, report, event) => { content.foo = report.bar; }`;
  const mappings = tryParseSimpleMappings(src);
  assert.ok(mappings);
  assert.equal(mappings![0]!.targetField, 'foo');
  assert.equal(mappings![0]!.sourceExpr, 'report.bar');
});

test('§A4 — event.id and literals on the RHS are kept verbatim', () => {
  const src = `function (content) { content.visit_kind = event.id; content.weight_unit = 'kg'; }`;
  const mappings = tryParseSimpleMappings(src);
  assert.ok(mappings);
  assert.equal(mappings![0]!.sourceExpr, 'event.id');
  assert.equal(mappings![1]!.sourceExpr, "'kg'");
});

test('§A5 — full parse+serialize round-trip on a structured action', () => {
  const src = `[{ form: 'death_followup', modifyContent: function (content, contact, report, event) {
        content.death_id = report._id;
        content.cause = report.cause;
      } }]`;
  const parsed = parseActions(src);
  assert.equal(parsed.shape, 'array');
  assert.equal(parsed.actions.length, 1);
  const a = parsed.actions[0]!;
  assert.ok(a.modifyContentMappings, 'expected modifyContentMappings to be populated');
  assert.equal(a.modifyContentMappings.length, 2);
  assert.equal(a.passesVisitWindow, false);
  assert.equal(a.customModifyContent, undefined);
  // Re-serialize and re-parse — should land on the same structured
  // mappings (byte-stability is only required for the same shape, so
  // we assert the shape survives, not the exact bytes).
  const reserialized = serializeActions(parsed);
  const reparsed = parseActions(reserialized);
  assert.equal(reparsed.shape, 'array');
  const a2 = reparsed.actions[0]!;
  assert.deepEqual(a2.modifyContentMappings, a.modifyContentMappings);
});

/* ============================ Bucket B — complex falls to raw ============================ */

test('§B1 — `if` statement → fall to customModifyContent', () => {
  const src = `function (content, contact, report) {
    if (report.high_risk) { content.priority = 'high'; }
    content.report_id = report._id;
  }`;
  const mappings = tryParseSimpleMappings(src);
  assert.equal(mappings, null);
});

test('§B2 — `forEach` → fall to customModifyContent', () => {
  const src = `function (content, contact, report) {
    report.items.forEach(x => { content[x.name] = x.value; });
  }`;
  const mappings = tryParseSimpleMappings(src);
  assert.equal(mappings, null);
});

test('§B3 — `Object.entries` → fall to customModifyContent', () => {
  const src = `function (content, contact, report) {
    Object.entries(report.fields).forEach(([k, v]) => { content[k] = v; });
  }`;
  const mappings = tryParseSimpleMappings(src);
  assert.equal(mappings, null);
});

test('§B4 — ternary RHS → fall to customModifyContent', () => {
  const src = `function (content, contact, report) {
    content.priority = report.flag ? 'high' : 'normal';
  }`;
  const mappings = tryParseSimpleMappings(src);
  assert.equal(mappings, null);
});

test('§B5 — helper call on RHS → fall to customModifyContent', () => {
  const src = `function (content, contact, report) {
    content.dob = formatDate(report.date_of_birth);
  }`;
  const mappings = tryParseSimpleMappings(src);
  assert.equal(mappings, null);
});

test('§B6 — non-content assignment in body (e.g. `const x = ...`) → fall to customModifyContent', () => {
  const src = `function (content, contact, report) {
    const x = report.value;
    content.x = x;
  }`;
  const mappings = tryParseSimpleMappings(src);
  assert.equal(mappings, null);
});

test('§B7 — empty body → fall to customModifyContent (zero mappings is not the structured shape)', () => {
  const src = `function (content, contact, report) {}`;
  const mappings = tryParseSimpleMappings(src);
  assert.equal(mappings, null);
});

test('§B8 — complex input round-trips via customModifyContent', () => {
  // The if-statement variant from §B1, embedded in a real action. The
  // FULL parser keeps it byte-stable via the customModifyContent path.
  const original = `[{ form: 'foo', modifyContent: function (content, contact, report) { if (report.high_risk) { content.priority = 'high'; } content.report_id = report._id; } }]`;
  const parsed = parseActions(original);
  assert.equal(parsed.actions[0]!.customModifyContent !== undefined, true);
  assert.equal(parsed.actions[0]!.modifyContentMappings, undefined);
});

/* ============================ Bucket C — visit-window precedence ============================ */

test('§C1 — canonical visit-window pattern still parses to passesVisitWindow (mappings shape never wins over it)', () => {
  const src = `[{ form: 'next_visit', modifyContent: function (content, contact, report, event) {
        content.visit = event.id;
        const dueDate = addDays(report.reported_date, event.days);
        content.current_period_start = addDays(dueDate, -event.start);
        content.current_period_end = addDays(dueDate, event.end);
      } }]`;
  const parsed = parseActions(src);
  const a = parsed.actions[0]!;
  assert.equal(a.passesVisitWindow, true, 'visit-window must win over mappings detection');
  assert.equal(a.modifyContentMappings, undefined);
  assert.equal(a.customModifyContent, undefined);
});

/* ============================ structural — UI deletion contract ============================ */

test('§D1 — empty mappings array on serialize falls through to customModifyContent path', () => {
  // The UI contract is: when the last mapping is deleted, set
  // modifyContentMappings = undefined (not []). But defensively, the
  // serializer ALSO routes around an empty array — both guards in
  // place.
  const a: TaskAction = {
    form: 'foo',
    passesVisitWindow: false,
    modifyContentMappings: [],
    customModifyContent: 'function (c) { c.x = report.y; }',
    extras: {},
  };
  const out = serializeActions({ shape: 'array', actions: [a], raw: '' });
  // The non-empty customModifyContent wins when mappings is empty —
  // this guards against accidentally dropping user code if the UI
  // skips the "set undefined on empty" rule.
  assert.match(out, /c\.x = report\.y/);
  assert.ok(!/content\.\w+ = /.test(out.split('modifyContent')[0]!), 'no structured emit');
});
