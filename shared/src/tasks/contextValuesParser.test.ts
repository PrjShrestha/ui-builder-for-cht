/**
 * Recognizer + emit fixpoint tests for the cross-form context-value
 * bridge (`shared/src/tasks/contextValuesParser.ts`).
 *
 * Contract (post audit P0-1 — no `Utils` in the contact-summary runtime):
 *   1. `emitContextValueBridge` produces a SELF-CONTAINED `reports` scan
 *      (no `Utils.*`, no extras import) that `recognizeContextValueBridge`
 *      accepts and re-produces bit-for-bit.
 *   2. Whitespace variations of the canonical shape re-hydrate to the
 *      same structured record.
 *   3. The LEGACY `Utils.*` shape written by the pre-fix emitter still
 *      recognizes (self-healing migration: re-open in the picker, next
 *      save emits the fixed shape).
 *   4. Non-bridge expressions return `null` — the UI falls back to the
 *      raw `<textarea>`, which is lossless.
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

test('emitted JS is self-contained: NO Utils reference (undefined in contact-summary runtime)', () => {
  // Audit P0-1: `Utils` is global in tasks/targets only. The contact-summary
  // runtime exposes contact/reports/lineage. Any `Utils.` in the emitted
  // string is a guaranteed on-device ReferenceError that kills the whole
  // context object — this assertion is the regression gate for that class.
  const s = emitContextValueBridge({ sourceForm: 'anc_screening', sourceField: 'lmp_date' });
  assert.equal(/\bUtils\b/.test(s), false, 'emitted bridge must not reference Utils');
  assert.match(s, /^\(function \(\) \{/);
  assert.match(s, /reports\.forEach/);
  assert.match(s, /r\.form === 'anc_screening'/);
  assert.match(s, /'lmp_date'\.split\('\.'\)/);
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

test('recognizer is whitespace-tolerant across the canonical shape', () => {
  const compact = `(function(){var newest;reports.forEach(function(r){if(r.form==='f'&&(!newest||r.reported_date>newest.reported_date)){newest=r;}});var value=newest&&newest.fields;'x'.split('.').forEach(function(p){value=value&&value[p];});return value;})()`;
  const spaced = `( function ( ) { var newest ; reports.forEach ( function ( r ) { if ( r.form === 'f' && ( !newest || r.reported_date > newest.reported_date ) ) { newest = r ; } } ) ; var value = newest && newest.fields ; 'x'.split ( '.' ) .forEach ( function ( p ) { value = value && value [ p ] ; } ) ; return value ; } ) ( )`;
  const trailingSemi = emitContextValueBridge({ sourceForm: 'f', sourceField: 'x' }) + ';';
  for (const v of [compact, spaced, trailingSemi]) {
    const r = recognizeContextValueBridge(v);
    assert.ok(r, `expected whitespace variant to recognize: ${JSON.stringify(v.slice(0, 60))}…`);
    assert.equal(r!.sourceForm, 'f');
    assert.equal(r!.sourceField, 'x');
  }
});

test('LEGACY Utils-based shape (pre-fix emitter) still recognizes — self-healing migration', () => {
  // Files written by the broken emitter must re-open in the picker so the
  // next save rewrites them to the fixed shape. Loss of byte-stability on
  // that save is deliberate: the value cell is exactly what's being edited.
  const legacy = `(function () {
    var report = Utils.getMostRecentReport(reports, 'diabetes_screening');
    return report ? Utils.getField(report, 'bmi') : undefined;
  })()`;
  const r = recognizeContextValueBridge(legacy);
  assert.deepEqual(r, { sourceForm: 'diabetes_screening', sourceField: 'bmi' });
  // Re-emitting produces the FIXED shape, not the legacy one.
  const reEmitted = emitContextValueBridge(r!);
  assert.equal(/\bUtils\b/.test(reEmitted), false);
});

test('legacy recognizer rejects a mismatched binding name (safety)', () => {
  const bad = `(function () {
    var report = Utils.getMostRecentReport(reports, 'f');
    return other ? Utils.getField(other, 'x') : undefined;
  })()`;
  assert.equal(recognizeContextValueBridge(bad), null);
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

test('recognizer rejects hand-renamed identifiers in the canonical shape (falls to raw editor)', () => {
  // Canonical recognizer is strict on identifier names — a hand-edited
  // variant with different names is preserved verbatim via the raw-JS
  // fallback (lossless), never rewritten.
  const renamed = `(function () {
    var latest;
    reports.forEach(function (rep) {
      if (rep.form === 'f' && (!latest || rep.reported_date > latest.reported_date)) { latest = rep; }
    });
    var value = latest && latest.fields;
    'x'.split('.').forEach(function (p) { value = value && value[p]; });
    return value;
  })()`;
  assert.equal(recognizeContextValueBridge(renamed), null);
});

test('double-quoted literals in the canonical shape re-hydrate; emit canonicalizes to single quotes', () => {
  const dq = emitContextValueBridge({ sourceForm: 'f', sourceField: 'x' })
    .replace(`'f'`, `"f"`)
    .replace(`'x'.split`, `"x".split`);
  const r = recognizeContextValueBridge(dq);
  assert.ok(r, 'double-quoted variant must re-hydrate');
  assert.equal(r!.sourceForm, 'f');
  assert.equal(r!.sourceField, 'x');
  assert.match(emitContextValueBridge(r!), /'f'/);
});
