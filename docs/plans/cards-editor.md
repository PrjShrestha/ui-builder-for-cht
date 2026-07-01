<!--
Planner plan for Tier 2 · Contact-summary cards/fields editor.
Extends ContactSummaryEditor with structured editing for the two arrays
currently preserved verbatim (cards[], fields[]). Static-shape lift only;
imperative fields/appliesIf/modifyContext stay raw. Pins the shared
cardsParser + fieldsParser contract so the dev can build without
re-deriving it. 2026-07-01.
-->

# Plan: contact-summary cards/fields editor

**Status:** v0.1 — PLANNER-LOCKED, **BUILD THIS CYCLE** (Tier 2) · **Owner:** planner
· **Follows:** `docs/plans/event-date-anchor.md`, `docs/plans/task-builder-parity.md` style.

## 1. Problem

`ContactSummaryEditor.tsx` today edits only the `context: { ... }` flags. The two
other exported arrays — `fields[]` and `cards[]` — are read verbatim by
`parseContactSummary`, echoed in the "Raw files" tab, and byte-copied on save.
That means the only way for Bhishan to add a **profile field** (e.g. a phone row
on the person card) or a **report card** (e.g. an "Active pregnancy" summary) is
to hand-edit JavaScript — the exact affordance the PO said we would not require
(`decision_nocode_names_autoderived`).

The real files are heterogeneous:
- `cht-default/contact-summary.templated.js` has 3 cards; 2 of them use
  `fields: function (report) { ... }` (imperative) and one has
  `modifyContext: function (ctx, report) { ... }`.
- `empty/blank/malaria` all ship `cards: []` and a flat `fields: [ {...}, {...} ]`
  of static rows.

So the editor must **lift the static shape** (label / appliesToType / static
field arrays / literal properties) into cards/rows, while **preserving verbatim**
every function body, comment, and unrecognized property it encounters. Same
non-destructive discipline as `contactSummaryParser`.

## 2. Scope this cycle

**Ships:**
- `shared/src/tasks/cardsParser.ts` — parse `const cards = [ ... ]` / a `cards:`
  key inside `module.exports = { ... }`; extract `label`, `appliesToType`,
  `appliesIf`, `fields` (only when `fields` is an **array literal** of object
  literals). Anything else stays in an `extrasRaw` map, verbatim.
- `shared/src/tasks/fieldsParser.ts` — parse `const fields = [ ... ]`; lift the
  eight literal properties listed in §3; anything else stays in `extrasRaw`.
  A single row that fails to lift (e.g. spread element, imperative
  `appliesIf` mixed with an object we can't classify) is preserved as
  `{ shape: 'raw', raw: '<verbatim source>' }`.
- `serializeCards` / `serializeFields` — deterministic inverse; splice into the
  original `contact-summary.templated.js` via **byte-range edit** using the
  parsed bounds. Both live inside the same file rewrite as `serializeContactSummary`
  so a single save can update `context` + `fields` + `cards` in one pass.
- `client/src/ui/ContactSummaryEditor.tsx` — two new tabs (`Cards`, `Fields`)
  alongside the existing `Context flags` / `Helpers` / `Raw`. Reorder via
  dnd-kit (same pattern as `EventsEditor`). Row / card editors are inline
  panels, not modals (matches existing `FlagCard` UX). Every row that
  contains anything we didn't lift shows a **read-only "Raw JS" details block**
  so the user sees what the editor won't touch.
- Round-trip tests (`cardsParser.roundtrip.test.ts`, `fieldsParser.roundtrip.test.ts`)
  covering the six cases in §6, and one end-to-end test that walks the full
  `cht-default/contact-summary.templated.js` through parse→serialize→parse and
  asserts byte-identical output for all unchanged parts.
- Template scaffolds: `empty/blank/malaria` already ship `cards: []`; leave
  them. `cht-default` already ships full cards; leave it. No template edits
  required this cycle (existing files satisfy the "minimal valid" bar —
  verified 2026-07-01 by reading all four).

**Defers:**
- Card fields **rendered via a function** (`fields: function (report) { ... }`) —
  the whole card is editable at the **card-level** (label, appliesToType, top-level
  appliesIf) but the `fields:` body is shown read-only and preserved verbatim.
- `modifyContext: function (...)` — preserved verbatim in `extrasRaw`; no editor.
- `context: {...}` inside a card (rare; observed nowhere in the templates but
  supported by CHT) — preserved verbatim in `extrasRaw`.
- Helper-fn / field pickers for `appliesIf` (raw editor with syntax highlighting only).
- Translation-key picker for `label` (Tier 2 translations editor is a separate
  plan doc; here the label is a plain text input).

## 3. Shared parser contract (the load-bearing part)

### 3.1 Type shapes

```ts
// shared/src/tasks/cardsParser.ts

export interface ParsedCards {
  source: string;
  // Byte range of the `[` / `]` pair of the cards array literal.
  // null when the file doesn't have a recognizable `cards = [ ... ]` / `cards: [ ... ]`.
  bounds: { start: number; end: number } | null;
  cards: CardEntry[];
}

export type CardEntry =
  | { shape: 'structured'; card: StructuredCard }
  | { shape: 'raw'; raw: string };

export interface StructuredCard {
  label?: string;                    // string literal only; template strings → raw
  appliesToType?: string;            // string literal only
  appliesIfRaw?: string;             // verbatim function source (or arrow)
  // `fields` in a card can be an array literal OR a function.
  // Array literal → lifted into `fields: FieldEntry[]`.
  // Function      → preserved as `fieldsRaw` (verbatim), `fields` is undefined.
  fields?: FieldEntry[];
  fieldsRaw?: string;
  // Everything else (modifyContext, context, custom keys, appliesIf we couldn't
  // recognize as a function shape) preserved verbatim keyed by property name,
  // rendered back in the same slot on serialize.
  extrasRaw: Record<string, string>;
  // Order the properties appeared in the original source. Preserved on emit.
  order: string[];
}
```

```ts
// shared/src/tasks/fieldsParser.ts

export interface ParsedFields {
  source: string;
  bounds: { start: number; end: number } | null;
  fields: FieldEntry[];
}

export type FieldEntry =
  | { shape: 'structured'; field: StructuredField }
  | { shape: 'raw'; raw: string };

export interface StructuredField {
  label?: string;              // string literal
  appliesToType?: string;      // string literal (supports "!person" — plain string)
  appliesIfRaw?: string;       // verbatim function/arrow source
  // `value` is almost always a JS expression (thisContact.phone, moment(...), etc.).
  // We keep it as raw text and never try to lift it — the field-picker for
  // no-code value selection is a future pass (see §8).
  valueRaw?: string;
  width?: number;              // numeric literal only
  filter?: string;             // string literal
  translate?: boolean | string; // boolean literal OR an expression → keep raw when non-boolean
  translateRaw?: string;       // set when `translate:` is not a literal boolean
  icon?: string;               // string literal
  extrasRaw: Record<string, string>;
  order: string[];
}
```

### 3.2 parse contract

- Locate the cards / fields array by these shapes (checked in order):
  1. `const cards = [ ... ]` (or `let` / `var`) at top level.
  2. `const cards = [ ... ]` reference — same detection as `contactSummaryParser`
     already uses for `const context`.
  3. `cards: [ ... ]` **inside** the trailing `module.exports = { ... }` block
     (fallback for the shorthand `module.exports = { cards: [...], fields: [...] }`).
- `null` bounds means the file doesn't declare cards / fields in a shape the
  editor understands. The UI renders "Couldn't find `cards = [...]`" (mirror
  the existing "Couldn't find `context: {...}`" message) and directs the user
  to the Raw tab.
- Within the array, each top-level object literal is one entry. **Any entry that
  isn't a bare `{ ... }` object literal** — spread element, ternary, function
  call, `...anotherArray` — makes the whole array degrade to a **single raw
  entry**: `[{ shape: 'raw', raw: <full array body> }]` and the editor shows
  the raw fallback. This is the same all-or-nothing degrade `parseEvents` uses
  when it sees `.map(...)`, and it keeps the mental model simple.
- Within each object, keys are classified: recognized ones lift into the typed
  fields; unrecognized ones (including function values on recognized keys we
  didn't expect a function for) go into `extrasRaw` **verbatim**. `order[]`
  captures the source order so re-emit is stable.
- Reuse `jsParser.ts`'s `parseObjectFields` + bracket-matching primitives.
  Both new parsers should export their helpers *only if* they need them —
  otherwise import from `jsParser.ts`. Do **not** duplicate `matchBracket` /
  `skipNonCodeAt` / `scanString`.

### 3.3 serialize contract (the byte-stability invariant)

- `serializeCards(parsed, nextCards)` and `serializeFields(parsed, nextFields)`
  each return a **new source string** with the array body rewritten. Non-array
  bytes are copied verbatim from `parsed.source`.
- If a card / field is `shape: 'raw'`, emit `raw` verbatim (no trimming).
- If a card / field is `shape: 'structured'`, emit properties **in `order[]`
  order**. Each property:
  - Lifted keys → re-serialized from the typed value (`label` → JSON.stringify;
    `width` → number; `appliesIfRaw` / `fieldsRaw` / `valueRaw` → verbatim).
  - `extrasRaw[key]` → verbatim.
- New properties added via the UI (a fresh field the user added, or `label` on
  a card that didn't have one) are appended to the end of `order`.
- A property the user **deleted** in the UI is removed from both the lifted
  slot and `order`. If it existed in `extrasRaw`, it's also removed there.
- **Byte-stability contract:** for any card / field the user did **not touch**
  in the editor session, `serialize` MUST produce byte-identical output to
  `parsed.source.slice(entry_bounds)`. Achieved by round-tripping through the
  same `order[]` + `extrasRaw` slots that captured the original property
  ordering and whitespace. Whitespace inside function bodies / verbatim
  properties is preserved because we slice source ranges, never regenerate.
- The **whole-file** rewrite lives in a new
  `shared/src/tasks/contactSummaryRewrite.ts` (or inlined into
  `contactSummaryParser.ts` — dev's call, whichever is cleaner). Contract:
  ```ts
  export function rewriteContactSummary(
    original: string,
    edits: {
      context?: { flags: Record<string, string>; order: string[] };
      cards?: CardEntry[];
      fields?: FieldEntry[];
    },
  ): string;
  ```
  Composed of three sequential byte-range splices (context, cards, fields).
  **Order:** splice from **highest offset to lowest** so earlier splices don't
  invalidate later bounds (same trick `serializeContactSummary` already relies
  on implicitly with a single splice). Bounds are computed once from the
  original source.

### 3.4 Round-trip invariant (non-negotiable)

For every real config in `server/templates/{cht-default,empty,blank,malaria}/`:
```
parse(source) → serialize(parsed, sameCards, sameFields) === source
```
byte-for-byte. Test file must assert this on all four templates directly. This
is the same bar `smoke-parser.mjs` enforces for XLSForm; extend it or add a
sibling smoke script for contact-summary if the dev wants a real-config gate.

## 4. UI surface (`ContactSummaryEditor.tsx`)

Add two tabs to the existing tab bar (currently `structured` / `helpers` /
`raw`). New tab keys: `cards` and `fields`. Tab order recommendation:
`Context flags | Fields | Cards | Helpers | Raw files`.

### 4.1 State extensions (in `CSState`)

```ts
interface CSState {
  raw: Record<CSFile, string | null>;
  parsed: ParsedContactSummary | null;
  parsedCards: ParsedCards | null;      // NEW
  parsedFields: ParsedFields | null;    // NEW
  flags: Record<string, string>;
  order: string[];
  cards: CardEntry[];                   // NEW — user-editable working copy
  fields: FieldEntry[];                 // NEW — user-editable working copy
}
```

Load time: run `parseCards` and `parseFields` on the same
`contact-summary.templated.js` source; seed working copies from the parsed
arrays.

### 4.2 Fields tab

- List view: each row shows `label`, `appliesToType`, `width`, and a small
  `filter`/`icon` chip when set. Uses the existing `.task-card` styling
  (same as `FlagCard`).
- Reorder: `<SortableContext>` from dnd-kit (identical wiring to
  `EventsEditor` and `ActionsEditor` — grep for `useSortable` in
  `client/src/ui/EventsEditor.tsx`).
- Row actions: `Edit`, `Delete`. Edit expands the row inline into an editor.
  No modal — matches the existing FlagCard pattern where editing is inline.
- Row editor fields (in this order, matches the visual salience the field
  will have in CHT's rendered card):
  1. **Label** — text input. Placeholder: `contact.age` — hint that CHT
     runs it through the translator; a link "Use as translation key"
     (defers to Tier 2 translations editor; for now just a plain text input).
  2. **Applies to type** — text input with datalist populated from the
     project's real contact types (grep `app_settings.json`'s
     `contact_types[].id`; reuse `useContactTypes()` if it exists — audit
     `client/src/ui/TasksEditor.tsx:752` shows `h.contact_types` is
     already on the store). Support the `!person` "not person" syntax by
     accepting free text — do **not** reject it.
  3. **Value** — code input (single-line `<input>` on top of a
     `<textarea>` toggle for long expressions). Preserve verbatim.
     No field picker this cycle (defer to §8).
  4. **Width** — numeric input (1–12).
  5. **Filter** — text input with a datalist of the CHT-standard filters
     hardcoded in an array constant: `age`, `simpleDate`, `relativeDay`,
     `lineage`, `weeksPregnant`. Free text still accepted.
  6. **Translate** — checkbox (only shown when parsed as a boolean literal).
     When `translateRaw` is set, show a read-only "This field uses an
     expression for `translate`; edit in the Raw tab" note instead.
  7. **Icon** — text input; datalist populated from the project's
     `resources.json` icon keys (piggyback on the same lookup
     `TasksEditor` uses for task icons — task-builder-parity's icon picker).
  8. **Applies-if** — collapsible details block. If `appliesIfRaw` is
     set, show it in a monospace textarea (read-only edit for advanced users;
     save preserves verbatim). "+ Add applies-if" adds a stub
     `function () { return true; }`.
  9. **Raw JS (unrecognized properties)** — read-only `<details>` block
     rendering `extrasRaw` verbatim. Present only when non-empty. Shows
     the user what the editor is preserving but not touching.
- `+ Add field` button at the end of the list. Adds a structured row with
  `label: ''`, `appliesToType: 'person'`, `width: 6`, `valueRaw: ''`.

### 4.3 Cards tab

Same shape as Fields tab, but the row editor has these top-level slots:
1. **Label** — text input.
2. **Applies to type** — text input + datalist (same as fields; the
   built-in `report` is by far the most common — hint that in the placeholder).
3. **Applies-if** — collapsible details, same as fields.
4. **Fields** — this is the nested part. Two states:
   - **Static list (parsed):** a mini fields-list identical to the Fields tab
     (reorderable, `+ Add`, inline row editor with the same eight slots).
   - **Imperative (`fieldsRaw` set):** read-only `<pre>` showing the
     function source, plus a note "This card computes its fields with JS
     code; edit in the Raw tab." Do not offer a "convert to static list"
     button — that's a lossy transform.
5. **Raw JS (unrecognized properties)** — same read-only `<details>` block.
   For `cht-default`'s pregnancy card this shows the entire `modifyContext`
   function; the user sees it's preserved but not touched.
6. `+ Add card` at the end of the list.

### 4.4 Save pipeline

The existing `save()` already writes both files via
`api.saveContactSummaryFile`. Extend it:

```ts
async function save() {
  // ...existing setup...
  let templatedOut = state.raw['contact-summary.templated.js'] ?? '';
  if (state.parsed && (view === 'structured' || view === 'cards' || view === 'fields')) {
    templatedOut = rewriteContactSummary(templatedOut, {
      context: state.parsed.contextBounds
        ? { flags: state.flags, order: state.order }
        : undefined,
      cards: state.parsedCards?.bounds ? state.cards : undefined,
      fields: state.parsedFields?.bounds ? state.fields : undefined,
    });
  }
  await api.saveContactSummaryFile('contact-summary.templated.js', templatedOut);
  // ...existing extras.js save...
}
```

The `view === 'raw'` branch stays as-is: raw wins when active, and switching
away from raw re-parses so the working copies re-hydrate (already the
existing `patchRaw` behavior; extend it to also refresh `parsedCards` /
`parsedFields`).

### 4.5 Reused components

- **dnd-kit reorder wiring:** copy the `SortableContext` / `useSortable`
  pattern from `EventsEditor.tsx`.
- **Error boundary + stable selectors:** obey the `#10` rule from
  task-builder-parity — every `useApp((s) => ...)` in the new tab code
  MUST return a stable ref (no inline `.filter/.map/{...}` selectors).
- **Contact-types datalist:** if the store already exposes contact types
  in a shape the tab can read, use it. Otherwise the dev may thread it
  from the parent (`ContactSummaryEditor` already imports `useApp`).

## 5. Server route

**No new endpoint.** The existing `PUT /api/contact-summary/files/:file` on
`server/src/routes/contactSummary.ts` already writes both files atomically
via the tmp-file pattern. The rewrite happens client-side (in `save()`
above), server just persists the resulting text. This is the same shape
`ContactSummaryEditor` already uses for context edits.

## 6. Round-trip / test cases

Assertions in `shared/src/tasks/cardsParser.roundtrip.test.ts` and
`fieldsParser.roundtrip.test.ts` (node:test over compiled dist/, same
pattern as `eventsParser.roundtrip.test.ts`):

1. **Empty array:** `const cards = []` and `const fields = []` parse to
   `[]` and round-trip byte-stable.
2. **`empty` template's `fields` array** (12 static rows, mix of `person`
   and `!person`, one row with `appliesIf: function () { ... }`) parses
   with every row `shape: 'structured'`, the appliesIf row keeps
   `appliesIfRaw` verbatim, and round-trips byte-identical.
3. **`cht-default` template's `cards` array** (3 cards, all with
   imperative `fields: function (report) { ... }`, one with
   `modifyContext: function (...)`) parses with every card
   `shape: 'structured'`, `fieldsRaw` verbatim, `modifyContext` in
   `extrasRaw` verbatim, and round-trips byte-identical.
4. **Structural edit test:** on the `empty` template, rename a field's
   `label` from `'contact.age'` to `'contact.date_of_birth'`; assert the
   serialized source has exactly that one string swapped and every other
   byte is identical (use a character-diff assertion).
5. **Property-order preservation:** on `cht-default`'s pregnancy card,
   parse → serialize with no edits; assert `serialized === original` for
   the card's byte range. This is the property-order invariant.
6. **Spread degrade:** an array containing `...moreCards` parses to a
   single `shape: 'raw'` entry with `raw` equal to the whole array body;
   round-trips verbatim. The editor renders the raw fallback for this file.
7. **Whole-file smoke (`rewriteContactSummary`):** on all four templates,
   `rewriteContactSummary(source, { context, cards, fields }) === source`
   when the arguments are exactly the parsed values with no edits. This
   is the whole-file byte-stability gate.

## 7. Acceptance

Lorena's checklist (QA persona):

- [ ] Open the `empty` template project. Fields tab shows the 12 static
      rows. Edit the width of one row from 6 → 8. Save. Reload. Only that
      one number changed; every other byte identical (diff the file).
- [ ] Reorder two rows via drag. Save. Reload. Rows are in the new order,
      every other byte identical.
- [ ] Delete a row. Save. Reload. Row is gone, every other byte identical.
- [ ] Open the `cht-default` template project. Cards tab shows 3 cards.
      Each card's "Fields" section reads "This card computes its fields
      with JS code" (imperative case). Card labels + appliesToType are
      editable. Change one label. Save. Reload. Only the label changed;
      the imperative `fields:` function body and the pregnancy card's
      `modifyContext` are byte-identical.
- [ ] For the pregnancy card, the "Raw JS (unrecognized properties)"
      details block shows the entire `modifyContext` function source.
- [ ] Add a new field via the Fields tab: label `contact.notes`, width 12,
      appliesToType `person`. Save. Reload. New row appears at the end
      of the array; the array is otherwise untouched.
- [ ] Add a new card via the Cards tab: label `Test`, appliesToType `report`,
      empty static fields list. Save. Reload. New card appears; existing
      cards byte-identical.
- [ ] Craft a file with `[ ...otherCards, { label: 'x' } ]` and open it.
      Editor shows raw fallback ("Couldn't parse cards array — edit in
      Raw tab"). No structural editing offered. Save round-trips
      byte-identical.
- [ ] `pnpm --filter @cht-ui/shared test` passes with the seven new
      round-trip cases.
- [ ] `pnpm typecheck && pnpm lint` clean (zero warnings from new code).

## 8. Out of scope

- **`value` picker for fields.** The `value` is arbitrary JS (`thisContact.age`,
  `moment(...)`, `getField(report, 'x')`). A field-picker over the contact/
  report shape would be Tier 2 follow-on, tied to the workflow simulator's
  contact-shape introspection. Ship it as a raw text input this cycle.
- **Imperative-`fields`-function editor.** No structured lift, no "convert
  to static list" button. Preserved verbatim.
- **`modifyContext` editor.** Preserved verbatim in `extrasRaw`.
- **Translation-key picker for `label`.** Bhishan sees a plain text input.
  Translations editor (separate Tier 2 plan doc) will layer over this.
- **Icon picker.** Text input + datalist from `resources.json`; no visual
  gallery this cycle.
- **Live preview of the rendered card.** Tier 1 workflow simulator.
- **Card `context: {...}` inline object.** Preserved verbatim.
- **Templates.** All four templates already ship valid, minimal cards/fields.
  No template edits this cycle.

## 9. Open decisions

1. **Where does `rewriteContactSummary` live** — a new
   `shared/src/tasks/contactSummaryRewrite.ts`, or extend
   `contactSummaryParser.ts`? **Recommend: extend the existing file.**
   `serializeContactSummary` is 15 lines; adding `rewriteContactSummary`
   that composes three splices next to it keeps the single-splice
   invariant discoverable in one place. Follows "prefer editing existing
   files" from CLAUDE.md.
2. **Do we ship an `appliesIf` **structured builder** for cards/fields, or
   just a raw text area?** **Recommend: raw text area this cycle.** The
   existing `AppliesIfBuilder` targets task predicates over
   `(contact, reports)`; card `appliesIf` is over `(report)` and the
   contract is different. Wiring a scoped variant is worth its own pass
   after this ships (candidate follow-on: reuse `ContextExpressionBuilder`
   the way `ContactSummaryEditor` reuses it for context flags).
3. **Should the "raw" fallback for a fields-array with one bad row degrade
   the *whole* array to raw, or lift the good rows and mark the bad one
   raw?** **Recommend: whole-array degrade** (per §3.2). Matches
   `parseEvents` semantics, keeps the mental model simple, and the user
   still has the Raw tab as an escape hatch. Row-level partial lift is a
   future refinement if real configs need it.
