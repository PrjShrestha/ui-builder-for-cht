/**
 * Recognizer + emit fixpoint tests for the cross-form context-value
 * bridge (`shared/src/tasks/contextValuesParser.ts`).
 *
 * Contract:
 *   1. `emitContextValueBridge` produces a string
 *      `recognizeContextValueBridge` accepts and re-produces bit-for-bit.
 *   2. Whitespace variations of the canonical shape re-hydrate to the
 *      same structured record.
 *   3. Non-bridge expressions (a stock predicate call, a bare identifier,
 *      an empty string, a mismatched binding name, or the wrong falsy
 *      branch) return `null` — the UI falls back to the raw `<textarea>`.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  emitContextValueBridge,
  recognizeContextValueBridge,
} from './contextValuesParser.js';

test('emit → recognize is a fixpoint (canonical form)', () => {
  const bridge = { sourceForm: 'diabetes_screening', sourceField: 'bmi' };
  const emitted = emitContextValueBridge(bridge);
  const recognized = recognizeContextValueBridge(emitted);
  assert.deepEqual(recognized, bridge);
  // Re-emitting the recognized bridge yields byte-identical output.
  assert.equal(emitContextValueBridge(recognized!), emitted);
});

test('emitted string has the canonical prefix shape (readable multi-line IIFE)', () => {
  const s = emitContextValueBridge({ sourceForm: 'anc_screening', sourceField: 'lmp_date' });
  assert.match(s, /^\(function \(\) \{/);
  assert.match(s, /Utils\.getMostRecentReport\(reports, 'anc_screening'\)/);
  assert.match(s, /Utils\.getField\(report, 'lmp_date'\)/);
  assert.match(s, /\}\)\(\)$/);
});

test('recognizer accepts an unset (empty-strings) bridge — used as the "+ Add value" seed', () => {
  // The UI seeds a fresh bridge with empty `sourceForm`/`sourceField`
  // so the row renders the picker in an "unset" state. That seed MUST
  // still recognize as a bridge so it lands in the Context values tab
  // (not the raw-JS Context flags fallback).
  const bridge = { sourceForm: '', sourceField: '' };
  const s = emitContextValueBridge(bridge);
  assert.deepEqual(recognizeContextValueBridge(s), bridge);
});

test('recognizer accepts dotted field paths (e.g. preg_info.delivery_date)', () => {
  const bridge = { sourceForm: 'delivery', sourceField: 'preg_info.delivery_date' };
  const s = emitContextValueBridge(bridge);
  assert.deepEqual(recognizeContextValueBridge(s), bridge);
});

test('recognizer is whitespace-tolerant across all inter-token positions', () => {
  const variants = [
    // Compact one-liner (extreme end of the tolerance range)
    `(function(){var report=Utils.getMostRecentReport(reports,'f');return report?Utils.getField(report,'x'):undefined;})()`,
    // Extra spaces inside every group
    `( function ( )  {  var report  =  Utils.getMostRecentReport ( reports , 'f' ) ; return report ? Utils.getField ( report , 'x' ) : undefined ; } ) ( )`,
    // Newlines everywhere
    `(function () {\n    var report = Utils.getMostRecentReport(reports, 'f');\n    return report ? Utils.getField(report, 'x') : undefined;\n  })()`,
    // Trailing semicolon (some formatters add one)
    `(function () { var report = Utils.getMostRecentReport(reports, 'f'); return report ? Utils.getField(report, 'x') : undefined; })();`,
  ];
  for (const v of variants) {
    const r = recognizeContextValueBridge(v);
    assert.ok(r, `expected whitespace variant to recognize: ${JSON.stringify(v)}`);
    assert.equal(r!.sourceForm, 'f');
    assert.equal(r!.sourceField, 'x');
  }
});

test('recognizer rejects an empty / non-bridge expression', () => {
  assert.equal(recognizeContextValueBridge(''), null);
  assert.equal(recognizeContextValueBridge('   '), null);
  assert.equal(recognizeContextValueBridge('true'), null);
  assert.equal(recognizeContextValueBridge('function () { return true; }'), null);
  assert.equal(
    recognizeContextValueBridge(`isReadyForNewPregnancy(contact, reports)`),
    null,
  );
});

test('recognizer rejects a mismatched binding name (safety)', () => {
  // Same shape, but the `return` reads a different identifier from the
  // `var` — likely a hand-authored idiom that means something else.
  // Re-emitting under the canonical name would silently rewrite it.
  const bad = `(function () {
    var report = Utils.getMostRecentReport(reports, 'f');
    return other ? Utils.getField(other, 'x') : undefined;
  })()`;
  assert.equal(recognizeContextValueBridge(bad), null);
});

test('recognizer rejects the wrong falsy branch (null / empty-string ≠ undefined)', () => {
  // Falsy fallback semantics: an `undefined` ctx value flows through the
  // `fallback-to-current` wrapper correctly. `null` and `''` are falsy
  // too but semantically distinct — we conservatively reject them so
  // authors don't silently gain the wrapper's undefined-only shortcut.
  const nullBranch = `(function () {
    var report = Utils.getMostRecentReport(reports, 'f');
    return report ? Utils.getField(report, 'x') : null;
  })()`;
  const emptyBranch = `(function () {
    var report = Utils.getMostRecentReport(reports, 'f');
    return report ? Utils.getField(report, 'x') : '';
  })()`;
  assert.equal(recognizeContextValueBridge(nullBranch), null);
  assert.equal(recognizeContextValueBridge(emptyBranch), null);
});

test('recognizer rejects a double-quoted form/field (canonical form uses single quotes)', () => {
  // The CHT eslint config's `quotes: ['error', 'single']` rule makes
  // double-quoted string literals a lint failure. The recognizer accepts
  // BOTH so a hand-authored variant re-hydrates, but the emitter always
  // produces single quotes.
  const dq = `(function () {
    var report = Utils.getMostRecentReport(reports, "f");
    return report ? Utils.getField(report, "x") : undefined;
  })()`;
  const r = recognizeContextValueBridge(dq);
  assert.ok(r, 'double-quoted variant must re-hydrate');
  assert.equal(r!.sourceForm, 'f');
  assert.equal(r!.sourceField, 'x');
  // Re-emitting canonicalizes to single quotes so the config re-lints clean.
  assert.match(emitContextValueBridge(r!), /'f'/);
  assert.match(emitContextValueBridge(r!), /'x'/);
});
