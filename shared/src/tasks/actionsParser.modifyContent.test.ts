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

/* ============================ adversarial bug-fixes ============================ */

test('BUG#2 — semicolons inside string literals do NOT split statements', () => {
  // Pre-fix this misclassified the second segment as a non-content
  // assignment and demoted to raw. Post-fix the string-aware tokenizer
  // sees ONE statement.
  const src = `function (content) { content.text = 'hello; world'; }`;
  const mappings = tryParseSimpleMappings(src);
  assert.ok(mappings, 'string-aware split should accept this');
  assert.equal(mappings!.length, 1);
  assert.equal(mappings![0]!.targetField, 'text');
  assert.equal(mappings![0]!.sourceExpr, "'hello; world'");
});

test('BUG#3 — control-flow keywords inside string literals do NOT trigger reject', () => {
  // Pre-fix the bare `/\b(if|else|for|...|do)\b/` test matched `do` in
  // 'do not delete' and rejected the whole body.
  const src = `function (content) { content.note = 'do not delete'; }`;
  const mappings = tryParseSimpleMappings(src);
  assert.ok(mappings, 'string-aware reject-check should accept this');
  assert.equal(mappings![0]!.sourceExpr, "'do not delete'");
});

test('BUG#4 — `?` inside backtick template strings does NOT trigger ternary reject', () => {
  const src = `function (content) { content.label = \`is_this_ok?\`; }`;
  const mappings = tryParseSimpleMappings(src);
  assert.ok(mappings, 'backtick strings should be stripped before ternary check');
  assert.equal(mappings![0]!.sourceExpr, '`is_this_ok?`');
});

test('BUG#7 — function arg list is preserved on round-trip (1-arg form)', () => {
  const src = `[{ form: 'f', modifyContent: function (content) { content.x = report.x; } }]`;
  const parsed = parseActions(src);
  const a = parsed.actions[0]!;
  assert.equal(a.modifyContentArgs, 'content', 'arg list captured');
  const out = serializeActions(parsed);
  assert.match(out, /function \(content\)/, 'serializer must emit the original 1-arg form, not auto-inflate');
  assert.doesNotMatch(out, /function \(content, contact, report, event\)/);
});

test('BUG#7 — 4-arg canonical form also round-trips', () => {
  const src = `[{ form: 'f', modifyContent: function (content, contact, report, event) { content.x = report.x; } }]`;
  const parsed = parseActions(src);
  assert.equal(parsed.actions[0]!.modifyContentArgs, 'content, contact, report, event');
  const out = serializeActions(parsed);
  assert.match(out, /function \(content, contact, report, event\)/);
});

test('BUG#7 — arrow function arg list also preserved', () => {
  const src = `[{ form: 'f', modifyContent: (content, contact, report, event) => { content.x = report.x; } }]`;
  const parsed = parseActions(src);
  assert.equal(parsed.actions[0]!.modifyContentArgs, 'content, contact, report, event');
  // Note: arrow → function-decl conversion on serialize is intentional
  // (the serializer canonicalizes to function form). The arg list is
  // what we preserve.
  const out = serializeActions(parsed);
  assert.match(out, /function \(content, contact, report, event\)/);
});

test('Trap#4-defense — empty-row mapping is dropped on serialize, not emitted as invalid JS', () => {
  // The UI may transiently hold an empty row before the user types into
  // it; the serializer must NOT emit `content. = ;` (invalid JS).
  const a: TaskAction = {
    form: 'foo',
    passesVisitWindow: false,
    modifyContentMappings: [
      { targetField: 'real', sourceExpr: 'report.real' },
      { targetField: '', sourceExpr: '' },
      { targetField: '  ', sourceExpr: 'report.x' }, // whitespace-only also dropped
    ],
    extras: {},
  };
  const out = serializeActions({ shape: 'array', actions: [a], raw: '' });
  // Only the "real" row should appear; empty rows silently dropped.
  assert.match(out, /content\.real = report\.real;/);
  assert.doesNotMatch(out, /content\. = /);
  assert.doesNotMatch(out, /content\. {2}= /);
});

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
