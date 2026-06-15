<!--
Planner-locked feature plan. Two related survey-builder capabilities:
(A) full group/repeat authoring, (B) a default `inputs` scaffold seeded on new-form creation.
Motivated by: the builder can place a `begin group` tile but emits an UNBALANCED group (no end),
and renders no nesting for any group except `inputs`. Grounded against HEAD (f4b959a) on 2026-06-15.
Authoritative scaffold reference: the CHT "Input data available in forms" docs (pasted by the user
2026-06-15) + the in-repo canonical templates at server/templates/cht-default/forms/.
-->

# Plan: Survey builder — group authoring + new-form scaffold

**Version:** v0.1 — 2026-06-15 · **Status:** PLANNER-LOCKED, developer-ready.
**Scope (locked):** FULL group authoring (A) **+** default `inputs` scaffold on new-form create (B).

> **Sequencing (planner, 2026-06-15):** build **after** calc Tier 1.5
> ([calc-reference-builder.md](./calc-reference-builder.md)); the punch-list blockers
> ([v03-calc-triad-punchlist.md](./v03-calc-triad-punchlist.md)) still come right after Tier 1.5 too —
> planner to confirm exact interleave when Tier 1.5 lands. Part A is foundational and should land
> before Part B leans on nested rendering.

## Why

The parser already understands groups losslessly (`STRUCTURAL_TYPES`, `isStructural`, depth-matching
in `buildDisplayItems`). The **authoring** layer doesn't:

- **Creating a group emits an invalid form.** The picker has "Group"/"Repeat" tiles
  ([QuestionTypeCatalog.ts:310-330](../../client/src/ui/QuestionTypeCatalog.ts#L310-L330)), but
  `handlePickerCommit` add-mode appends a **single** `begin group` row with no matching `end group`
  ([FormEditor.tsx:437-463](../../client/src/ui/FormEditor.tsx#L437-L463)) → unbalanced XLSForm,
  rejected by pyxform/cht-conf on deploy.
- **No nesting view.** Only the `inputs` group collapses (`COLLAPSIBLE_GROUP_NAMES = {'inputs'}`,
  [FormEditor.tsx:660](../../client/src/ui/FormEditor.tsx#L660)); every other group renders as flat
  bare `begin/end` rows ([buildDisplayItems:685-728](../../client/src/ui/FormEditor.tsx#L685-L728)).
- **Append-only insert.** New rows always go to the end ([addQuestion:411](../../client/src/ui/FormEditor.tsx#L411), `[...form.survey, newRow]`).
- **Structure-blind reorder.** `onDragEnd`/`moveRow` flat-`arrayMove` ([:377](../../client/src/ui/FormEditor.tsx#L377), :493); the only guard is the `${field}` dependency validator ([:172](../../client/src/ui/FormEditor.tsx#L172)). A drag can split a `begin`/`end` pair.

---

## Part A — Full group authoring

### A1. Create balanced (kills the invalid-form bug)
When `handlePickerCommit` commits a tile with `isStructural` (`begin group` / `begin repeat`), insert
a **matched pair** as a single edit:
- `begin group` + `end group` (both carrying the same `name`; `end` rows in CHT repeat the name).
- `begin repeat` + `end repeat`, and seed the repeat's `repeat_count` affordance (the editor already
  has a begin-repeat-only field at [FormEditor.tsx:913](../../client/src/ui/FormEditor.tsx#L913)).
- Default `label` to `NO_LABEL` for structural groups (CHT convention; see scaffold below).
- The pair wraps **nothing** by default (empty group, ready for questions) **or** the current
  selection if a multi-select exists (ties into A5 wrap).

### A2. Render groups as nested containers
Generalize `buildDisplayItems` beyond `COLLAPSIBLE_GROUP_NAMES` so **every** balanced `begin…end`
block becomes a nestable, collapsible `DisplayItem` with a `depth`. Render children indented by depth;
support arbitrary nesting (groups in groups, groups in repeats). Keep the existing `inputs`
default-collapsed behavior as a special case of the general one. `DisplayItem` ([:681-683](../../client/src/ui/FormEditor.tsx#L681-L683)) gains a recursive/`depth` shape.

### A3. Positional insert
"+ Question" must be able to target a position, not just append: an insert affordance **inside** each
group (and between rows). Minimum: an "+ add inside" control on each group container that inserts at
the group's end-1 (just before its `end` row); ideally also "insert after this row." `addQuestion`/
`handlePickerCommit` take an optional insert index instead of always pushing to `form.survey.length`.

### A4. Reorder integrity (group-as-unit + boundary-safe)
- Dragging a **group container** moves the whole `begin…end` subtree as one unit (reparent/reorder
  the slice, not a single row).
- Dragging a **row** may not cross a `begin`/`end` boundary in a way that splits a pair; either clamp
  the drop to legal positions or move the row into/out of the group cleanly (its index lands inside
  the target group's span).
- Add a **structural-balance validator** in `shared` (alongside `validateOrdering` in
  [dependencies.ts](../../shared/src/xlsform/dependencies.ts)): every `begin` has a matching `end`,
  properly nested, no crossing. Surface violations the same way the dependency violations render
  ([FormEditor.tsx:172](../../client/src/ui/FormEditor.tsx#L172)), and **block save** on imbalance.

### A5. Wrap / unwrap
- **Wrap:** select N contiguous rows → "Group these" inserts a `begin/end` pair around them (prompt
  for the group name). Reuses the Slice-2.C grouping UX vocabulary from the condition builder where
  sensible.
- **Unwrap:** on a group container, "Ungroup" removes the `begin`/`end` shell and keeps the children
  at the parent level (and dedents them).

### A6. Save-time guard
Before serialize/write, run the A4 balance validator; refuse to write an unbalanced survey (the
round-trip invariant: never emit a structurally-invalid form). This single guard retroactively
prevents the entire A1 bug class even if a future edit path forgets to pair.

---

## Part B — Default `inputs` scaffold on new-form create

`api.createForm('app' | 'contact', basename)` ([api.ts:161](../../client/src/api.ts#L161)) is the hook;
the server route that backs it seeds the initial `.xlsx`. **Authoritative source for the exact cells:
the vendored canonical templates at `server/templates/cht-default/forms/`** (cross-checked against the
pasted CHT "Input data available in forms" docs). Seed by category:

### B1. App form (`category: 'app'`)
Pre-collect the standard inputs the user asked for — user + contact + linking calculates, using the
conditional-contact-selector pattern so it works from People/Task/Reports alike:

```
type          name        label      appearance              relevant            default   calculation
begin group   inputs      NO_LABEL   field-list              ./source = 'user'             
hidden        source      Source                                                  user      
begin group   user        NO_LABEL                                                          
hidden        contact_id  Contact id                                                        
hidden        facility_id Facility id                                                       
hidden        name        Username                                                          
end group     user                                                                          
begin group   contact     NO_LABEL                                                          
string        _id         Patient ID select-contact type-person                             
hidden        patient_id  Medic ID                                                          
end group     contact                                                                       
end group     inputs                                                                        
calculate     patient_uuid       Patient UUID                                               ../inputs/contact/_id
calculate     patient_id         Patient ID                                                 ../inputs/contact/patient_id
calculate     created_by         Created by user                                            ../inputs/user/name
calculate     created_by_person_uuid  Creator uuid                                          ../inputs/user/contact_id
```

(`../inputs/contact/_id` and the top-level `../contact/_id` are both valid — the contact group is
mirrored at the top level. Use the `../inputs/...` form for clarity; note this for the Tier-1.5
reference picker too.)

### B2. Contact form (`category: 'contact'`)
Seed the contact-type-named top-level group per the create/edit conventions:
- **Create:** `begin group <contact_type>` (NO_LABEL) → `hidden parent` (Parent Id) → `hidden contact_type` → `end group`.
- **Edit:** the contact-type group + a nested `parent` group with the hydrated parent fields.
- The `<contact_type>` id should come from the project's contact types if known; else default `person`
  and let the user rename via the group editor (Part A makes the group visible/editable).

### B3. Declineable
The scaffold is the **default**, not forced: offer a "Blank form" option on create so a power user can
start empty. Once created, the scaffold is ordinary editable rows — no special-casing downstream.

---

## Round-trip contract
- Structural rows already parse/serialize losslessly — Part A is edit-operation correctness + UI, not
  a parser change. The **only** new shared code is the A4 balance validator (read-only analysis, like
  `validateOrdering`).
- The scaffold (Part B) is just initial bytes; a freshly-scaffolded form must satisfy
  parse→serialize→parse byte-stability and the smoke test from creation.
- **Never write an unbalanced survey** (A6). This is the invariant that makes group authoring safe.

## Test plan
- **shared:** unit tests for the balance validator (matched/unmatched/crossing/nested-deep), and a
  reorder-operation test set (move group-as-unit; reject boundary-splitting move; wrap/unwrap produce
  balanced output). Round-trip tests for each scaffold (app/contact-create/contact-edit) byte-stable.
- **e2e (Playwright):** create an app form → assert the inputs scaffold is present and the smoke
  round-trip is stable; add a group via the picker → assert a balanced `begin/end` pair (regression
  for the A1 bug); nest a question inside a group; drag a group as a unit; wrap two rows then unwrap;
  attempt a boundary-splitting drag → assert it's prevented and save stays balanced.
- **smoke:** `Round-trip stable: YES` on a scaffolded form and after each structural edit.

## Persona notes (dogfood when it lands)
- **Bhishan (PO/PM):** the cold-start win — a new form already has the patient/user plumbing wired, so
  he starts on real questions, not boilerplate xpath. Watch that "Blank form" is discoverable for the
  rare empty-start case.
- **Lal (Designer):** nesting depth, indentation legibility, drag affordance for group-as-unit, and
  clear "add inside" vs "add after" affordances; the wrap/unwrap actions need unambiguous labels.
- **Lorena (QA):** the balance validator + the A1 regression e2e are the critical-path guards; the
  scaffold round-trip tests pin Part B.

## Open questions for the planner
1. **Contact-type for B2:** pull from the project's configured contact types, or default `person` +
   rename? (Leaning: default + rename, since Part A makes renaming trivial.)
2. **field-list vs plain group default** when the user adds a group via A1: CHT uses `field-list`
   (one screen) very commonly — default the appearance to `field-list` or leave blank? (Leaning:
   offer it as a toggle on the group, default blank to avoid surprising one-screen behavior.)
3. **user-contact-summary** (`instance('user-contact-summary')/context/...`, ≥4.21.0) — fold into the
   Tier-1.5 contact-summary picker as a second source, or defer? (Defer unless a target config uses it.)
