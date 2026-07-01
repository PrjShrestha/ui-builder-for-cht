/**
 * Round-trip tests for the contact-summary cards parser.
 *
 * Invariants pinned:
 *   1. Static object-literal cards (label + appliesToType + fields:[{label,value}])
 *      lift into structured Card entries.
 *   2. A card with `fields: function () { ... }` degrades to a RawCard verbatim.
 *   3. Cards mixing structured + raw entries round-trip; the raw entries stay
 *      byte-identical across serialize.
 *   4. `.map(...)` / generator forms at the top level stay `shape: 'raw'`,
 *      verbatim.
 *   5. A real cht-default cards[] (three cards, all imperative) is stable
 *      across parse → serialize → parse (idempotent from the second pass on;
 *      RawCard.raw bytes never change once captured).
 *
 * Run via `pnpm --filter @cht-ui/shared build && pnpm --filter @cht-ui/shared test`.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  parseCards,
  serializeCards,
  findCardsArrayBounds,
  spliceCards,
  type Card,
  type RawCard,
} from './cardsParser.js';

test('static object literal cards lift into structured Card', () => {
  const src = `[
  {
    label: 'contact.profile.summary',
    appliesToType: 'report',
    fields: [
      { label: 'Weeks Pregnant', value: weeksPregnant },
      { label: 'EDD', value: eddValue }
    ]
  }
]`;
  const parsed = parseCards(src);
  assert.equal(parsed.shape, 'array');
  assert.equal(parsed.cards.length, 1);
  const c = parsed.cards[0]!;
  assert.equal(c.shape, 'card');
  const card = c as Card;
  assert.equal(card.label, 'contact.profile.summary');
  assert.equal(card.appliesToType, 'report');
  assert.equal(card.fields.length, 2);
  assert.equal(card.fields[0]!.label, 'Weeks Pregnant');
  assert.equal(card.fields[0]!.valueRaw, 'weeksPregnant');
  assert.equal(card.fields[1]!.label, 'EDD');
  assert.equal(card.fields[1]!.valueRaw, 'eddValue');
});

test('card with imperative `fields: function () { ... }` stays a RawCard, verbatim', () => {
  const entrySrc =
    `{\n` +
    `    label: 'contact.profile.pregnancy.active',\n` +
    `    appliesToType: 'report',\n` +
    `    fields: function (report) {\n` +
    `      const fields = [];\n` +
    `      return fields;\n` +
    `    }\n` +
    `  }`;
  const src = `[\n  ${entrySrc}\n]`;
  const parsed = parseCards(src);
  assert.equal(parsed.shape, 'array');
  assert.equal(parsed.cards.length, 1);
  const c = parsed.cards[0]!;
  assert.equal(c.shape, 'raw');
  const raw = c as RawCard;
  // The raw entry begins at `{` and ends at the matching `}` — full verbatim
  // slice from the array body.
  assert.equal(raw.raw, entrySrc);
  // Serializing then re-parsing gives back the same RawCard bytes.
  const round = parseCards(serializeCards(parsed));
  assert.equal(round.cards.length, 1);
  const rt = round.cards[0]!;
  assert.equal(rt.shape, 'raw');
  assert.equal((rt as RawCard).raw, entrySrc);
});

test('mixed array (some structured, some raw) round-trips', () => {
  const src = `[
  {
    label: 'Static',
    appliesToType: 'report',
    fields: [
      { label: 'A', value: thisContact.a }
    ]
  },
  {
    label: 'Imperative',
    appliesToType: 'person',
    fields: function () { return []; }
  }
]`;
  const parsed = parseCards(src);
  assert.equal(parsed.shape, 'array');
  assert.equal(parsed.cards.length, 2);
  assert.equal(parsed.cards[0]!.shape, 'card');
  assert.equal(parsed.cards[1]!.shape, 'raw');

  const rawBefore = (parsed.cards[1] as RawCard).raw;

  const out = serializeCards(parsed);
  const round = parseCards(out);
  assert.equal(round.shape, 'array');
  assert.equal(round.cards.length, 2);
  assert.equal(round.cards[0]!.shape, 'card');
  assert.equal(round.cards[1]!.shape, 'raw');

  const cardBefore = parsed.cards[0] as Card;
  const cardAfter = round.cards[0] as Card;
  assert.equal(cardAfter.label, cardBefore.label);
  assert.equal(cardAfter.appliesToType, cardBefore.appliesToType);
  assert.deepEqual(cardAfter.fields, cardBefore.fields);

  // Raw entry bytes are preserved across the round-trip.
  assert.equal((round.cards[1] as RawCard).raw, rawBefore);
});

test('.map / generator form stays raw at the whole-array level', () => {
  const src = `pregnancySchedule.map((s, i) => generateCard(s, i))`;
  const parsed = parseCards(src);
  assert.equal(parsed.shape, 'raw');
  assert.equal(parsed.cards.length, 0);
  assert.equal(parsed.raw, src);
  assert.equal(serializeCards(parsed), src);
});

test('spread element in array degrades the whole array to raw', () => {
  const src = `[ ...moreCards, { label: 'x', appliesToType: 'r', fields: [] } ]`;
  const parsed = parseCards(src);
  assert.equal(parsed.shape, 'raw');
  assert.equal(parsed.raw, src);
});

test('empty cards array parses to an empty structured list', () => {
  const parsed = parseCards('[]');
  assert.equal(parsed.shape, 'array');
  assert.equal(parsed.cards.length, 0);
  assert.equal(serializeCards(parsed), '[]');
});

test('card carrying a modifyContext degrades to RawCard, verbatim', () => {
  const entrySrc =
    `{\n` +
    `    label: 'foo',\n` +
    `    appliesToType: 'report',\n` +
    `    fields: [ { label: 'A', value: a } ],\n` +
    `    modifyContext: function (ctx) { ctx.x = 1; }\n` +
    `  }`;
  const src = `[\n  ${entrySrc}\n]`;
  const parsed = parseCards(src);
  assert.equal(parsed.cards.length, 1);
  const c = parsed.cards[0]!;
  assert.equal(c.shape, 'raw');
  assert.equal((c as RawCard).raw, entrySrc);
});

test('real cht-default cards[] is stable across parse → serialize → parse', () => {
  // Reproduces the exact shape of `server/templates/cht-default/contact-summary.templated.js`'s
  // cards array (three cards, all with imperative `fields: function (report) { ... }`,
  // one with a `modifyContext`). Every entry must degrade to a RawCard, and the raw
  // bytes must be identical after a serialize/parse round-trip.
  const src = `[
  {
    label: 'contact.profile.pregnancy.active',
    appliesToType: 'report',
    appliesIf: function (report) { return isActivePregnancy(thisContact, allReports, report); },
    fields: function (report) {
      const fields = [];
      return fields;
    },
    modifyContext: function (ctx, report) {
      ctx.pregnancy_uuid = report._id;
    }
  },
  {
    label: 'contact.profile.death.title',
    appliesToType: 'person',
    appliesIf: function () { return !isAlive(thisContact); },
    fields: function () {
      const fields = [];
      return fields;
    }
  },
  {
    label: 'contact.profile.pregnancy.past',
    appliesToType: 'report',
    appliesIf: function (report) { return true; },
    fields: function (report) {
      const fields = [];
      return fields;
    }
  }
]`;
  const first = parseCards(src);
  assert.equal(first.shape, 'array');
  assert.equal(first.cards.length, 3);
  for (const c of first.cards) assert.equal(c.shape, 'raw');
  const rawsFirst = first.cards.map((c) => (c as RawCard).raw);

  // Idempotency from the first serialize onwards: serialize → parse → serialize
  // yields the same bytes as the first serialize.
  const once = serializeCards(first);
  const second = parseCards(once);
  const twice = serializeCards(second);
  assert.equal(twice, once);

  // Raw bytes are preserved verbatim across the round-trip.
  const rawsSecond = second.cards.map((c) => (c as RawCard).raw);
  assert.deepEqual(rawsSecond, rawsFirst);
});

test('static card with an unrecognized property degrades to RawCard', () => {
  // A card that looks structured EXCEPT for a stray key we don't lift — the
  // whole card falls back to raw so the property survives verbatim on save.
  const entrySrc =
    `{\n` +
    `    label: 'x',\n` +
    `    appliesToType: 'report',\n` +
    `    fields: [ { label: 'A', value: 1 } ],\n` +
    `    icon: 'icon-x'\n` +
    `  }`;
  const src = `[\n  ${entrySrc}\n]`;
  const parsed = parseCards(src);
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0]!.shape, 'raw');
  assert.equal((parsed.cards[0] as RawCard).raw, entrySrc);
});

test('findCardsArrayBounds locates `const cards = [...]` declaration', () => {
  const src =
    `const context = { alive: true };\n` +
    `const cards = [\n` +
    `  { label: 'A', appliesToType: 'report', fields: [] }\n` +
    `];\n` +
    `module.exports = { context, cards };\n`;
  const b = findCardsArrayBounds(src);
  assert.notEqual(b, null);
  assert.equal(src[b!.start], '[');
  assert.equal(src[b!.end], ']');
});

test('findCardsArrayBounds locates cards inside `module.exports = { cards: [...] }`', () => {
  const src = `module.exports = { context: {}, cards: [\n  { label: 'A', appliesToType: 'report', fields: [] }\n], fields: [] };\n`;
  const b = findCardsArrayBounds(src);
  assert.notEqual(b, null);
  assert.equal(src[b!.start], '[');
  assert.equal(src[b!.end], ']');
});

test('spliceCards on unchanged parsed cards preserves the whole file for empty array', () => {
  const src =
    `const context = {};\n` +
    `const fields = [];\n` +
    `const cards = [];\n` +
    `module.exports = { context, cards, fields };\n`;
  const parsed = parseCards('[]');
  const out = spliceCards(src, parsed);
  assert.equal(out, src);
});

test('spliceCards swaps only the cards array — every other byte identical', () => {
  const header =
    `const context = { alive: true };\n` +
    `const fields = [ { appliesToType: 'person', label: 'a', value: 1 } ];\n` +
    `const cards = `;
  const cardsSrc = `[\n  { label: 'A', appliesToType: 'report', fields: [ { label: 'X', value: v } ] }\n]`;
  const footer = `;\nmodule.exports = { context, cards, fields };\n`;
  const src = header + cardsSrc + footer;
  const parsed = parseCards(cardsSrc);
  const nextCards = (parsed.cards as Card[]).map((c) => ({
    ...c,
    label: 'A-renamed',
  }));
  const nextParsed = { ...parsed, cards: nextCards };
  const out = spliceCards(src, nextParsed);
  // Header and footer bytes untouched.
  assert.equal(out.startsWith(header), true);
  assert.equal(out.endsWith(footer), true);
  // The array body carries the renamed label.
  assert.equal(out.includes('"A-renamed"'), true);
});

test('spliceCards with null bounds (no cards in file) returns source unchanged', () => {
  const src = `const context = {};\nmodule.exports = { context };\n`;
  assert.equal(findCardsArrayBounds(src), null);
  const parsed = parseCards('[]');
  assert.equal(spliceCards(src, parsed), src);
});

test('field entry with extra key (e.g. width) forces the card into RawCard', () => {
  // The simple-shape contract is strict: fields[] entries must be exactly
  // { label, value }. A field carrying `width` or `filter` sends the whole
  // card back to raw so the value survives verbatim.
  const entrySrc =
    `{\n` +
    `    label: 'x',\n` +
    `    appliesToType: 'report',\n` +
    `    fields: [\n` +
    `      { label: 'A', value: 1, width: 6 }\n` +
    `    ]\n` +
    `  }`;
  const src = `[\n  ${entrySrc}\n]`;
  const parsed = parseCards(src);
  assert.equal(parsed.cards[0]!.shape, 'raw');
});
