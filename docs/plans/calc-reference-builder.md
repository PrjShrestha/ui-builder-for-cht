<!--
Planner-locked feature plan. Extends docs/plans/calculation-builder.md (the calc builder).
Motivated by a real config: D:\medic\config-nssd\chis\forms\app\diabetes_referral.xlsx, where
8 of 10 calculation cells are mechanical references to `inputs` / contact-summary `context`.
Grounded against current HEAD (36e6f78) on 2026-06-15.
-->

# Plan: Calculation builder — Tier 1.5 "Reference a value"

**Version:** v0.1 — 2026-06-15 · **Status:** PLANNER-LOCKED, developer-ready.
**Parent:** [calculation-builder.md](./calculation-builder.md) (Tier 1 single-value mode). This is an
**additive** slice of the single-value mode — no new `shape`, no shared-parser widening.

> **Sequencing (planner, 2026-06-15):** build this **next**, ahead of the v0.3/calc punch list
> ([v03-calc-triad-punchlist.md](./v03-calc-triad-punchlist.md)) — per user, the inputs/context
> plumbing is the bigger real-world win. The two punch-list blockers (operator-label microcopy,
> cancel-safety e2e) stay queued immediately after. **Synergy:** this slice ADDS radio buttons to
> `SingleValuePanel`, so it inherits punch-list item **A2** (radiogroup keyboard a11y). Fix A2 as
> part of this slice rather than widening the debt — convert the `role=radio` button group to a
> native `<fieldset>`+`<input type=radio>` (keyboard nav for free) while you're in there.

## Why — measured, not assumed

`diabetes_referral.xlsx` (nssd) has 49 survey rows and **10 calculation cells; 8 are pure
plumbing** in three stock idioms. The same shape recurs across CHT report forms (your pasted CHT
docs note confirms idiom 1 is the standard patient-link pattern):

| Idiom | n | Emitted XLSForm | Today the author must… |
|---|---|---|---|
| **Contact input field** | 3 | `../inputs/contact/<field>` | hand-type the xpath |
| **Contact-summary value** | 5 | `instance('contact-summary')/context/<key>` + a wrapper | hand-type `instance(...)/context/...`, often **twice** inside an `if` |
| Genuine logic | 2 | the glucose→risk if-chains | (out of scope — stays in If-then table) |

The two observed wrappers on the context read:
- **fallback-to-current:** `if( <ref>, <ref>, . )` — "use the context value if present, else keep my own answer" (4 cells)
- **read-once:** `once( <ref> )` (1 cell)

A single typo in a doubled `instance('contact-summary')/context/glucometer_ctx` silently breaks the
form — exactly the error class a picker removes.

## Scope (locked: all three pickers + both wrappers)

Extend the single-value mode's kind radiogroup ([CalculationBuilder.tsx:360-373](../../client/src/ui/CalculationBuilder.tsx#L360-L373)) from
`literal | number | field-ref | expression` to add **two reference kinds**:

1. **Contact input field** → emits `../inputs/contact/<field>`.
   - Picker source: the contact fields the app already enumerates (`useContactFormFields()` /
     `project.contactFieldChoices`, [FormEditor.tsx:96](../../client/src/ui/FormEditor.tsx#L96)/:315), UNIONed with a known-minimal
     fallback set for forms whose `inputs` group is collapsed/empty (diabetes_referral's is — only
     `begin group inputs`/`end group inputs`): `_id`, `name`, `patient_id`, `date_of_birth`, `sex`,
     `parent/_id`, `phone`. Free-type allowed (datalist), so an unlisted field is never blocked.
2. **Contact-summary value** → emits `instance('contact-summary')/context/<key>`, with a wrapper
   `<select>`: *None* · *Use my current answer if empty* (`if(ref, ref, .)`) · *Read once* (`once(ref)`).
   - Picker source: `parseContactSummary(src).contextOrder` (the keys defined in the project's
     contact-summary `context` object, [contactSummaryParser.ts:13-26](../../shared/src/tasks/contactSummaryParser.ts#L13-L26)). Free-type allowed.
3. (existing) **Another field in this form** → `${field}` — already shipped as `field-ref`.

The `expression` (raw) kind stays as the escape hatch for anything else.

## The one new wire — context keys into FormEditor

FormEditor can't see the contact-summary today (the store only knows `'contact-summary'` as a view
kind). Add a hook **mirroring `useContactFormFields`**:

- `useContactSummaryContextKeys(): string[]` — fetches the contact-summary source via the existing
  `contactSummary` server route, runs `parseContactSummary(src).contextOrder`, returns the keys
  (memoized). Returns `[]` when there is no contact-summary (then the "Contact-summary value" kind
  shows free-type only, never errors).
- Thread it through FormEditor → `SurveyRowCard` → `CalculationBuilder` → `SingleValuePanel` as
  `contextKeys: string[]`, exactly the way `fieldKinds`/`fieldOptions` are already threaded.

No server change needed if the route already serves the source; otherwise add a thin GET.

## Round-trip contract (the sacred invariant)

This slice is **string-emit + verbatim-store**, so byte-stability is structural — but it MUST be
proven per idiom, because the wrapped forms touch the if-chain parser:

- **Bare references** (`../inputs/contact/X`, `instance('contact-summary')/context/X`, `${field}`)
  already classify as `shape:'single'` and round-trip byte-stable today (calc Tier 0 verified xpath
  → single). Re-hydration: extend `inferOutputKind` ([CalculationBuilder.tsx](../../client/src/ui/CalculationBuilder.tsx), used at SingleValuePanel :348) to
  detect the `../inputs/contact/` and `instance('contact-summary')/context/` prefixes and pre-select
  the right reference kind instead of falling to `expression`.
- **Wrapped context reads** (`if(ref, ref, .)`, `once(ref)`): emit ONE fixed canonical spelling and
  store it verbatim. `parseCalculation` may classify `if(ref,ref,.)` as a (degenerate) decision
  table; the Tier-0 self-check then either confirms byte-identity or demotes to `raw` — **either way
  the bytes are preserved on a no-op open/save**. Re-hydration into the picker is a **UI-level
  recognizer** over the verbatim `props.value` (a regex for the two exact idioms), independent of
  `parseCalculation`'s shape — so a wrapped reference reopens in the Reference sub-mode even if the
  shared parser calls it raw. **Do NOT add a new shared `shape` for this** — keep the parser
  untouched; the recognizer lives in the builder UI.
- **No restructuring on save.** The builder emits the canonical string and writes it through
  `setExtra` exactly as the other kinds do; it never re-serializes an existing cell it didn't change.

## Files (anchors at HEAD 36e6f78; grep the symbol if drifted)

- `client/src/ui/CalculationBuilder.tsx` — add `contact-input` + `contact-summary` to `OutputKind`
  and the radiogroup; new panels (a field `<select>`/datalist for input; a key `<select>`/datalist +
  wrapper `<select>` for context); extend `inferOutputKind` for the bare-reference prefixes; add the
  UI recognizer for the wrapped idioms; `SingleValuePanel` gains `inputContactFields: string[]` and
  `contextKeys: string[]` props. **While here, fix punch-list A2:** make the kind picker a native
  radio `<fieldset>` for keyboard a11y.
- `client/src/ui/FormEditor.tsx` — call the new hook; thread `contextKeys` (and the input-field
  list) through `SurveyRowCard` → `CalculationBuilder`, mirroring `fieldOptions`/`fieldKinds`.
- `client/src/ui/useContactSummaryContextKeys.ts` — **new** hook (mirror `useContactFormFields.ts`).
- `shared/src/xlsform/calculationBuilder.ts` — **read-only for shapes**; the only possible touch is
  if `inferOutputKind` lives there — keep it a pure string helper, no `shape` change.
- New: `shared/src/xlsform/calcReference.roundtrip.test.ts` — see test plan.

## Test plan

- **Bucket A (canonical, byte-stable, re-hydrates):** one per kind — `../inputs/contact/_id`;
  `instance('contact-summary')/context/glucometer_ctx`; the same wrapped `if(...,...,.)`; `once(...)`.
  Assert (a) parse→serialize byte-identity, (b) the UI recognizer maps each back to the right kind +
  wrapper.
- **Bucket B (real fixture):** extract all 10 `diabetes_referral.xlsx` calc cells; assert the 3
  input-copies and 5 context reads are recognized + re-emitted byte-identical, and the 2 if-chains
  are untouched (still If-then table / raw). This is the proof the feature covers the motivating form.
- **Bucket C (safety):** a contact-summary value typed free-hand for a key NOT in `contextOrder`
  still emits + round-trips; no-contact-summary project → "Contact-summary value" kind degrades to
  free-type, no crash; a wrapped idiom the recognizer doesn't match opens in raw mode byte-stable
  (never corrupted).
- **Smoke:** `Round-trip stable: YES` on `diabetes_referral.xlsx` before and after.

## Persona notes (dogfood when it lands)
- **Bhishan (PO/PM):** the win — "pull the patient's ID" and "use the glucometer value from the
  contact summary" become two dropdowns; no `instance(...)` typing. Watch the wrapper `<select>`
  wording ("Use my current answer if empty") reads plainly.
- **Lal (Designer):** fixing A2 here means the new radios are keyboard-correct from day one; keep the
  wrapper option labels plain-language, not `if(ctx,ctx,.)`.
- **Lorena (QA):** Bucket B (the nssd fixture) is the spec-coverage anchor; the wrapped-idiom
  recognizer needs the byte-stability proof since it straddles the if-chain parser.

## Open question for the planner
The known-minimal contact-field fallback list (idiom 1) is a guess at the common set. If nssd/other
configs reference contact fields beyond `_id/name/patient_id/date_of_birth/sex/parent/_id`, widen the
list — but free-type already covers the long tail, so this is polish, not a blocker.
