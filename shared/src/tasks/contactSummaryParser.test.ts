/**
 * Round-trip + byte-stability tests for the contact-summary parser +
 * serializer (`shared/src/tasks/contactSummaryParser.ts`).
 *
 * The non-negotiable invariant this file defends is:
 *
 *   Only the `context` object's byte range changes on save.
 *   Everything before `contextBounds.start` / after `.end` is byte-
 *   identical, including the surrounding `fields = [...]` / `cards = [...]`
 *   declarations that other editors own.
 *
 * That contract is what lets Wave 3 · Note 6 write cross-form bridge
 * values into `context: {}` without disturbing the file's other
 * declarations (a serializer that reflowed the whole file would break
 * the Cards editor's independent `spliceCards` write against the same
 * source).
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  emitContextValueBridge,
} from './contextValuesParser.js';
import {
  parseContactSummary,
  serializeContactSummary,
} from './contactSummaryParser.js';

/* ============================================================
 * Bridge value + byte-stability outside `context: {}`
 * ============================================================
 */

test('adding a context-value bridge only rewrites bytes inside the `context: {}` range', () => {
  const source = `const extras = require('./contact-summary.extras.js');
const { isAlive } = extras;

const thisContact = contact;
const allReports = reports;

const context = {
  alive: isAlive(thisContact),
};

const fields = [
  { appliesToType: 'person', label: 'patient_id', value: thisContact.patient_id, width: 4 },
];

const cards = [];

module.exports = {
  context: context,
  fields: fields,
  cards: cards,
};
`;
  const parsed = parseContactSummary(source);
  assert.ok(parsed.contextBounds, 'parser must locate the context object');
  const bounds = parsed.contextBounds!;
  const before = source.slice(0, bounds.start);
  const after = source.slice(bounds.end + 1);

  // Add one bridge value alongside the existing flag.
  const bridge = emitContextValueBridge({
    sourceForm: 'diabetes_screening',
    sourceField: 'bmi',
  });
  const nextFlags = { ...parsed.contextFlags, bmi: bridge };
  const nextOrder = [...parsed.contextOrder, 'bmi'];
  const serialized = serializeContactSummary(parsed, nextFlags, nextOrder);

  // 1) Everything BEFORE the context object is byte-identical.
  assert.equal(
    serialized.slice(0, bounds.start),
    before,
    'bytes before contextBounds.start must be preserved verbatim',
  );

  // 2) Everything AFTER the context object is byte-identical. The
  //    serializer's `after` slice starts at `bounds.end + 1`, so it
  //    includes the trailing `;` of the `const context = { ... };`
  //    declaration and every byte through EOF. Comparing that slice
  //    end-to-end is a direct proof of the invariant.
  const trailingAnchor = `;\n\nconst fields =`;
  const anchorInOrig = source.indexOf(trailingAnchor);
  const anchorInOut = serialized.indexOf(trailingAnchor);
  assert.ok(anchorInOrig > 0, 'fixture must have a fields declaration after context');
  assert.ok(anchorInOut > 0, 'output must retain the fields declaration');
  assert.equal(
    serialized.slice(anchorInOut),
    source.slice(anchorInOrig),
    'bytes after contextBounds.end must be preserved verbatim',
  );
  // `after` starts right after the `}` at bounds.end, so its first bytes
  // are the trailing `;\n\nconst fields` block.
  assert.equal(after.startsWith(trailingAnchor), true, 'sanity: `after` starts with the trailing anchor');

  // 3) Re-parsing lifts the bridge back into the flags map.
  const reparsed = parseContactSummary(serialized);
  assert.equal(reparsed.contextOrder.length, 2);
  assert.equal(reparsed.contextOrder[1], 'bmi');
  assert.ok(reparsed.contextFlags['bmi']);
});

/* ============================================================
 * (a) Key needing JSON.stringify quoting
 * ============================================================
 */

test('a context key that is not a bare JS identifier is emitted quoted', () => {
  const source = `const context = {
  alive: isAlive(thisContact),
};
module.exports = { context };
`;
  const parsed = parseContactSummary(source);
  assert.ok(parsed.contextBounds);
  const bridge = emitContextValueBridge({
    sourceForm: 'delivery',
    sourceField: 'preg_info.delivery_date',
  });
  // The property name "0-latest-visit" fails the identifier regex and
  // MUST take the JSON.stringify branch in `serializeContactSummary`.
  const nextFlags = { ...parsed.contextFlags, '0-latest-visit': bridge };
  const nextOrder = [...parsed.contextOrder, '0-latest-visit'];
  const out = serializeContactSummary(parsed, nextFlags, nextOrder);
  assert.match(out, /"0-latest-visit":/);

  // And the containing file is byte-stable outside the context object.
  const bounds = parsed.contextBounds!;
  assert.equal(out.slice(0, bounds.start), source.slice(0, bounds.start));
});

/* ============================================================
 * (b) `context` discovered via the `return { context: {...} }` fallback
 * ============================================================
 */

test('context discovered via the `return { context: {...} }` fallback also round-trips byte-stable outside', () => {
  const source = `module.exports = function (contact, reports, lineage) {
  const thisContact = contact;
  return {
    context: {
      alive: true,
    },
    fields: [{ label: 'p', value: thisContact.name }],
    cards: [],
  };
};
`;
  const parsed = parseContactSummary(source);
  assert.ok(parsed.contextBounds, 'fallback path must still find the context object');
  const bounds = parsed.contextBounds!;

  const bridge = emitContextValueBridge({
    sourceForm: 'anc_screening',
    sourceField: 'lmp_date',
  });
  const nextFlags = { ...parsed.contextFlags, lmp: bridge };
  const nextOrder = [...parsed.contextOrder, 'lmp'];
  const out = serializeContactSummary(parsed, nextFlags, nextOrder);

  // Bytes before the context object literal are byte-identical.
  assert.equal(out.slice(0, bounds.start), source.slice(0, bounds.start));

  // The trailing fields+cards+function-close is preserved verbatim.
  const trailingAnchor = `,\n    fields:`;
  const origAnchor = source.indexOf(trailingAnchor);
  const outAnchor = out.indexOf(trailingAnchor);
  assert.ok(origAnchor > 0);
  assert.ok(outAnchor > 0);
  assert.equal(out.slice(outAnchor), source.slice(origAnchor));

  // Bridge is re-recognizable after the round-trip.
  const reparsed = parseContactSummary(out);
  assert.ok(reparsed.contextFlags['lmp']);
});

/* ============================================================
 * (c) Mixed context — both stock flags AND bridge values — round-trips
 * ============================================================
 */

test('a mixed context (flags + bridges) round-trips byte-stable outside `context`', () => {
  const source = `const extras = require('./contact-summary.extras.js');
const { isAlive, isReadyForNewPregnancy } = extras;

const thisContact = contact;
const allReports = reports;

const context = {
  alive: isAlive(thisContact),
  show_pregnancy_form: isReadyForNewPregnancy(thisContact, allReports),
};

const fields = [];
const cards = [];

module.exports = { context, fields, cards };
`;
  const parsed = parseContactSummary(source);
  assert.equal(parsed.contextOrder.length, 2);
  assert.ok(parsed.contextBounds);
  const bounds = parsed.contextBounds!;

  const bridge = emitContextValueBridge({
    sourceForm: 'diabetes_screening',
    sourceField: 'bmi',
  });
  // Insert the bridge between the two existing flags — order must be preserved.
  const nextFlags: Record<string, string> = {
    alive: parsed.contextFlags['alive']!,
    bmi: bridge,
    show_pregnancy_form: parsed.contextFlags['show_pregnancy_form']!,
  };
  const nextOrder = ['alive', 'bmi', 'show_pregnancy_form'];
  const out = serializeContactSummary(parsed, nextFlags, nextOrder);

  // Byte-stability outside the context bounds.
  assert.equal(out.slice(0, bounds.start), source.slice(0, bounds.start));

  const trailingAnchor = `;\n\nconst fields = [];`;
  const origAnchor = source.indexOf(trailingAnchor);
  const outAnchor = out.indexOf(trailingAnchor);
  assert.ok(origAnchor > 0);
  assert.ok(outAnchor > 0);
  assert.equal(out.slice(outAnchor), source.slice(origAnchor));

  // Re-parse and confirm order + all three keys survive.
  const reparsed = parseContactSummary(out);
  assert.deepEqual(reparsed.contextOrder, ['alive', 'bmi', 'show_pregnancy_form']);
  assert.match(reparsed.contextFlags['alive']!, /isAlive/);
  assert.match(reparsed.contextFlags['show_pregnancy_form']!, /isReadyForNewPregnancy/);
  // The bridge is the self-contained reports scan — and NEVER references
  // Utils, which is undefined in the contact-summary runtime (audit P0-1).
  assert.match(reparsed.contextFlags['bmi']!, /reports\.forEach/);
  assert.equal(/\bUtils\b/.test(reparsed.contextFlags['bmi']!), false);
});

/* ============================================================
 * (d) Serializer is idempotent when no bridge is added — the file's
 *     bytes are stable across parse → serialize with the same flags.
 * ============================================================
 */

test('serializing without any change re-emits the context object without touching outside bytes', () => {
  const source = `const context = {
  alive: isAlive(thisContact),
  show_pregnancy_form: isReadyForNewPregnancy(thisContact, reports),
};

module.exports = { context };
`;
  const parsed = parseContactSummary(source);
  const out = serializeContactSummary(parsed, parsed.contextFlags, parsed.contextOrder);
  const bounds = parsed.contextBounds!;
  assert.equal(out.slice(0, bounds.start), source.slice(0, bounds.start));
  // Trailing `;\n\nmodule.exports` slice is byte-identical (`;` is
  // outside contextBounds — the serializer preserves it verbatim).
  const trailingAnchor = `;\n\nmodule.exports`;
  const origAnchor = source.indexOf(trailingAnchor);
  const outAnchor = out.indexOf(trailingAnchor);
  assert.equal(out.slice(outAnchor), source.slice(origAnchor));
});
