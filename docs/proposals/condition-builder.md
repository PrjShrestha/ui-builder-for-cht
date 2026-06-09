# Proposal: Survey condition builder — broader choices + chainable expressions

**Status:** drafted 2026-06-09, **not yet planner-locked**. Output of an
8-agent workflow (4 discovery + 3 persona + 1 synthesis).

**Authors' note:** the user (developer session) ran this workflow and
already locked two scope decisions before sending the plan to the planner.
See §1.5. Other decisions remain open for the planner.

## 1. Feasibility verdict

Both asks are tractable in a single PR-sized change. The parser side is
already chain-aware: `parseRelevant`
([shared/src/xlsform/relevantParser.ts](../../shared/src/xlsform/relevantParser.ts)
lines 112–134) paren-aware-splits the top level on a single combinator
(`and` xor `or`) and structures each clause into a typed `Rule`. Same-
combinator chains round-trip byte-stable. Mixed-combinator chains fall back
to `isRawFallback: true` (line 120).

Translation: chaining is a **read/build UX problem, not a grammar
problem**. Persistence stays `Record<string, string>` in `SurveyRow.extras`
(no new owned columns).

The choices fix is even simpler — one-source widening of `buildFieldChoices`
([client/src/ui/FormEditor.tsx](../../client/src/ui/FormEditor.tsx) line
1052) with zero XLSForm writes.

## 1.5 User-locked decisions (do not re-debate)

The user explicitly decided two things before sending this to the planner:

1. **Include the (group) affordance in this PR.** The synthesis
   recommended deferring `(pregnant AND age>18) OR referred`-style
   parenthesized mixed-combinator expressions to next sprint. The user
   overrode that — they want nested-clause UI in this PR, which requires
   a `relevantParser` extension to round-trip parenthesized mixed-
   combinator expressions structurally. Estimated extra cost: ~150 LOC
   client + ~80 LOC parser + new round-trip tests for the nested grammar.
2. **Phasing call deferred to planner.** The user said "take to planner
   first" — so whether this ships as one PR (~650 LOC with the group
   affordance) or two slices (choices fix first at ~80 LOC, chaining
   + group affordance second at ~570 LOC) is the planner's call.

Everything else below is the synthesis as-shipped from the workflow.

## 2. Scope

### In scope (MVP this PR or PR-pair)
- Cross-form contact-choices scan (server-side at project open).
- `buildFieldChoices` widening to merge in contact-form choices.
- Chaining UI: stacked clause rows with chip-form preview ("design C
  with design B's preview").
- Microcopy per §3.
- **`(group)` affordance for parenthesized mixed-combinator expressions
  (user-locked addition).**
- Parser extension for nested same-combinator subgroups under a different
  outer combinator.
- Round-trip tests for chained + grouped expressions.
- Playwright happy-path + cancel-safety test.

### Out of scope
- Path-suffix matching when contact-form field names diverge across forms
  (defer; ~95% of CHT configs share names by convention per discovery).
- Smart list-name guessing (option (a) from the choices diagnosis) —
  Bhishan explicitly rejected silent guessing.
- Recent-values hint (option (c)) — Lorena flagged as quoting-bug risk.
- Plain-language preview for `selected()`/`not()`/`today()` ops; comparisons
  get prose, the others stay code-style chips. Bhishan accepted code for
  those.
- Reordering clauses by drag (Lal P2).
- Keyboard-focusable chip group with backspace-to-delete (Lal P1) —
  ship with click-to-delete; keyboard polish next sprint.

## 3. Round-trip safety contract

The builder MUST guarantee, on every write to `row.extras[column]`:

1. **Parseability.** Output satisfies
   `serializeRelevant(parseRelevant(out)) === out`. For same-combinator
   chains this is already true. For the new parenthesized form
   (group affordance), the parser extension must preserve byte-stability
   on both new and pre-existing grouped expressions.
2. **No partial clauses.** `+ insert` disabled unless every clause in
   `clauses[]` AND the draft (if non-empty) has `field`, `op`, and —
   for ops that require it — `value`. Per-clause red border +
   `aria-invalid="true"` on the offender.
3. **No silent connector mixing.** With the (group) affordance now in
   scope, the user CAN mix AND/OR — but only by explicitly creating
   a group. Flat-mixed (no parens) is still refused; the builder offers
   "Group these into (…)" instead. The builder never emits
   `a or b and c` flat.
4. **Raw fallback is sacred.** If `parseRelevant(existing).isRawFallback`
   is `true` AND the new parser extension can't decompose it either,
   chaining is disabled entirely. Builder offers "edit as text" or "clear
   to use builder." No silent overwrite.
5. **`× start over` is byte-safe.** Clears session state only;
   `row.extras[column]` untouched until `+ insert` fires.
6. **Choices broadening is read-only.** No XLSForm bytes change as a
   result of contact-form scanning.

## 4. File-by-file task list

### Choices fix (option b)

- **`server/src/routes/project.ts`** (modify). On project read, walk
  `forms/contact/*.xlsx`, parse each with `parseXlsForm`, collect rows
  whose `type` matches `/^(select_one|select_multiple)\s+(\S+)/i`, build
  `contactFieldChoices: Record<string, string[]>` keyed by row `name`,
  attach to project payload. **~40 LOC.**
- **`client/src/state/store.ts`** (modify). Add `contactFieldChoices` to
  the project slice. **~10 LOC.**
- **`client/src/ui/FormEditor.tsx`** (modify). Pass through to builder;
  merge into result of `buildFieldChoices(survey, choices)` at line 1052
  with row-name as the join key. Fallback to path-suffix match against
  `extras['calculation']` if name doesn't hit. **~25 LOC.**

Keep the free-text fallback at FormEditor.tsx:1254 intact.

### Chaining UI + group affordance

- **`client/src/ui/FormEditor.tsx`** (modify, lines 1094–1308). Replace
  the single-strip return with stacked clauses + chip preview + group
  rendering. Rehydration from `parseRelevant` on row open. **~250 LOC**
  for the UI block + **~80 LOC** for the reducer + **~120 LOC** for the
  group affordance (nested clauses).
- **`shared/src/xlsform/relevantParser.ts`** (modify). Extend to
  round-trip parenthesized mixed-combinator expressions structurally:
  parse `(A and B) or C` to a `GroupedExpression` shape with one outer
  combinator and inner subgroups, each subgroup itself a same-combinator
  chain. **~80 LOC** + matching `serializeRelevant` changes **~40 LOC**.
- **`shared/src/xlsform/relevantParser.chain.roundtrip.test.ts`** (new).
  See §6 for the case list. **~150 LOC.**
- **`client/src/ui/`** new reducer + unit tests for `commitClause`,
  `popClause`, `startOver`, `insertAll`, `enterGroupMode`, `exitGroupMode`.
  **~60 LOC tests.**

## 5. Data shapes

### Reducer state (transient, NOT persisted)

```ts
type Clause = {
  field: string;
  op: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'selected' | 'not' | 'ref' | 'today';
  value: string;  // empty for ops in {'ref', 'today', 'not'}
};

type Connector = 'and' | 'or';

// A subgroup is a same-combinator chain. The outer expression is a
// different-combinator chain of subgroups. Two levels max — that's the
// grammar the parser extension supports.
type Subgroup = {
  clauses: Clause[];
  connector: Connector;          // intra-subgroup combinator
};

interface BuilderState {
  column: 'relevant' | 'calculation' | 'constraint' | 'choice_filter';
  // Flat single-combinator chain (the common case).
  clauses: Clause[];
  connectors: Connector[];        // length === max(0, clauses.length - 1)
  draft: Clause;
  lockedConnector: Connector | null;

  // Grouped mode: when the user clicks "Group these into (…)" or starts
  // a new group via "( ... )", the builder switches to two-level mode.
  // null = flat mode (common case); non-null = grouped mode.
  groups: Subgroup[] | null;
  outerConnector: Connector | null;
  activeGroupIndex: number | null; // which group the current draft commits to

  rawFallback: string | null;     // non-null = chaining disabled
}
```

**Persistence:** nothing in this state shape is persisted.
`SurveyRow.extras` stays `Record<string, string>`. The only thing written
to disk is the resulting string in `row.extras[column]`. Round-trip
invariant preserved.

### Parser extension shape (`relevantParser.ts`)

```ts
// Existing flat shape, kept:
interface ParsedExpression {
  combinator: Connector | null;
  rules: Rule[];
  isRawFallback: boolean;
}

// New nested shape, added:
interface GroupedExpression {
  kind: 'grouped';
  outerCombinator: Connector;
  subgroups: ParsedExpression[];  // each subgroup is a same-combinator chain
  isRawFallback: boolean;
}

type AnyParsed = ParsedExpression | GroupedExpression;
```

The parser tries flat first (today's behavior); if that fails AND the
expression has parenthesized subexpressions joined by a different top-
level combinator, attempt the grouped parse; if that also fails, fall
back to raw.

## 6. Test plan

### `shared/src/xlsform/relevantParser.chain.roundtrip.test.ts` (new)

- Three-clause AND: `${sex}='female' and ${age}>18 and selected(${conds},'x')` byte-stable.
- Three-clause OR: same with `or`.
- Mixed `selected()` + comparison + `not()` under single `and`.
- Mixed `and` and `or` flat (no parens): `isRawFallback: true`, serializes verbatim.
- **Grouped: `(${a}='x' and ${b}>10) or ${c}='y'` round-trips structured via the new `GroupedExpression` path.**
- **Grouped reverse: `${a}='x' or (${b}>10 and ${c}='y')` — same.**
- **Three-subgroup: `(A and B) or (C and D) or E` — round-trips as `GroupedExpression` with `outerCombinator: 'or'` and three subgroups.**
- Per-clause raw fallback inside an AND chain — that clause is `RawRule`, others stay structured.
- Edge: empty string, single-clause, only-whitespace, parens-only.

### Client reducer unit tests (new)

- `commitClause` pushes draft, sets `lockedConnector`.
- `popClause` pops last clause + last connector together.
- `startOver` resets without touching `column` or saved bytes.
- `insertAll` with empty draft serializes `clauses` only; non-empty draft
  includes it.
- `commitClause('or')` when `lockedConnector === 'and'` is a no-op in
  flat mode; offers to convert to grouped mode.
- `enterGroupMode` migrates current `clauses` into `groups[0]` as the
  first subgroup; sets `outerConnector`.

### Playwright e2e (new)

- Happy path: build two-clause `${sex}='female' and ${age}>18`, save,
  reload form, reopen row, see two chips. (Also implicitly tests the
  contact-form choices fix.)
- Cancel-chain safety: load row with existing single-clause `relevant`,
  stage two new clauses, press `× start over`, save, confirm
  `row.extras['relevant']` is byte-identical to load.
- **Group affordance: build `${a}='x' and ${b}>10`, click "Group these",
  add `or ${c}='y'`, insert, reload, see grouped chip rendering.**

### Smoke test

`node scripts/smoke-parser.mjs <path>/forms/app/pregnancy.xlsx` must still
print `Round-trip stable: YES`.

### Gates

- All 47 existing `shared/` tests green
- New round-trip tests green (estimated ~10 new cases)
- `pnpm lint --max-warnings=0` (currently broken pre-existing — separate
  cleanup PR per the FHIR slice's note)
- `pnpm typecheck` clean

## 7. Microcopy (Bhishan + Lal reconciled)

| Surface | Copy |
|---|---|
| Chain-extender button | `+ add another rule` |
| Connector options | `and also` / `or instead` (serialize as `and`/`or`) |
| Preview header | `This row shows when:` |
| Cancel button | `× start over` |
| Per-clause delete | `× remove rule` |
| Group affordance button | `( group these )` |
| Exit grouped mode | `flatten` |
| Raw-fallback banner | `This rule was hand-written. Edit as text, or clear it to use the builder.` |
| Flat-mixed AND/OR warning | `Mixing "and also" with "or instead" needs grouping. Press ( group these ) to combine rules.` |

## 8. Persona acceptance gates

### Bhishan (PO/PM)
- Cold-start a "show this row when sex is female AND age > 18" rule in
  under 30 seconds without reading help text.
- The `sex` dropdown shows `male` / `female` / `other` (not a free-text
  input) when this form pulls `sex` from contact.
- Preview reads "sex equals female and age greater than 18" — not the
  raw XPath — for comparisons.
- Group affordance lets him build `(pregnant AND age>18) OR referred`
  via point-and-click. Bhishan tested this exact case in persona
  feedback.

### Lal (Designer)
- One-clause case visually identical to today's strip (no regression for
  80% of rows).
- Multi-clause chip group has `role="group"` + `aria-label`, focusable.
- Connector dropdown reads `and also` / `or instead`, not `AND` / `OR`
  shouting.
- Group affordance is discoverable without onboarding (visible button,
  not a hidden gesture).
- Severity-tagged punch list of any remaining UX rough edges captured
  before merge.

### Lorena (QA)
- All 47 existing `shared/` round-trip tests green.
- New `relevantParser.chain.roundtrip.test.ts` covers the case list in §6.
- Reducer unit tests cover state transitions including group entry/exit.
- Playwright e2e covers happy-path + cancel-safety + group affordance.
- Smoke parser still YES on real CHT configs.

## 9. Open questions for the planner

These were NOT resolved by the synthesis or the user's pre-handoff
decisions:

1. **Phasing: one PR or two slices?** User said "take to planner first."
   The synthesis identified the choices fix alone as ~80 LOC and fully
   independent of chaining. One PR = faster total cycle, bigger diff.
   Two slices = lower regression risk, choices fix ships value
   immediately.
2. **Group affordance scope creep.** User locked it into this PR. The
   parser extension is the riskiest piece — it changes the
   `ParsedExpression` return type. Should the planner gate the group
   affordance behind the choices fix + flat chaining first, OR commit
   to all-three together?
3. **Mixed AND/OR without parens — refuse or auto-group?** Synthesis
   said refuse. But if the user has already typed three clauses, an
   "auto-group" affordance ("we'll wrap the AND clauses in parens for
   you") might be smoother UX. Lal hated overloaded controls; this is
   borderline.
4. **Path-suffix matching in choices merge.** Discovery noted that
   row-name match works ~95% of the time but path-suffix matching against
   `extras['calculation']` (`../inputs/contact/sex`) covers the
   remaining ~5%. In-scope for this PR or next sprint?
5. **Cross-form scan: synchronous at project open, or lazy on
   form-open?** Synchronous adds latency to project open (proportional
   to number of contact forms); lazy adds latency to first form open
   per session. Probably negligible either way; planner picks.

## 10. Next concrete deliverable

If planner says one PR: see §4 file list, target ~650 LOC.

If planner says split into two slices:

- **Slice 1 (this week, ~80 LOC):** Choices fix alone.
  - Server contact-form scan + project payload addition
  - Client store + buildFieldChoices merge
  - One Playwright test (`sex` dropdown populated)
  - No parser changes, no chaining UI.

- **Slice 2 (next, ~570 LOC):** Chaining + group affordance.
  - All chaining UI work + reducer + tests
  - Parser extension for grouped expressions
  - Group affordance UI
  - Playwright e2e

Either way, the smoke parser + all 47 existing tests stay green at
every commit.
