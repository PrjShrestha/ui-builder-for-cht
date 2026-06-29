<!--
Dev handoff: the form-eligibility "Context (who sees this form)" builder doesn't
know the project's real contact types, and emits contact.type (wrong for
configurable hierarchies). From PO review of pregnancy_registration's Properties
tab against a custom config (patient/fchv/hf_officer). 2026-06-28. Planner-authored.
-->

# Dev handoff — form-context "Contact type" selector: wire real types + fix `contact.type`

Surfaced reviewing `pregnancy_registration` → Properties → **Context (who sees this
form)** against a configurable config whose person types are `patient`, `fchv`,
`hf_officer` (places: `district`/`ward`/`health_facility`/`fchv_area`/`household`).

## What works today
- **Person vs place gate** = the **"Available on people"** / **"Available on places"**
  checkboxes → CHT `context.person` / `context.place` booleans
  (`PropertiesEditor.tsx:130–147`). Keep these.

## Problem 1 — "Contact type is" dropdown is hardcoded (UX gap)
`ContextExpressionBuilder.tsx:175–190` renders a **fixed** list:
`person` / `clinic` / `health_center` / `district_hospital` — the *legacy*
cht-default types. It never receives or reads the project's `contact_types`, so a
user **cannot scope a form to `patient`** (or any custom type). `addRule('contact_type')`
also defaults `value: 'person'` (`:63`). The builder's `Props` (`:22–30`) has no
contact-types input.

## Problem 2 — emits `contact.type`, wrong for configurable hierarchies (CORRECTNESS)
The serializer always emits **`contact.type === '<x>'`** (`contextExpressionParser.ts:135–136`;
parse at `:78–82`; comment at `:6` is explicit about using `contact.type`).
- Correct for the **legacy** hardcoded types (`person`/`clinic`/…), whose docs have
  `type: "person"` etc.
- **Wrong for configurable/custom types.** A `patient` document has `type: "contact"`
  and **`contact_type: "patient"`** — so `contact.type === 'patient'` matches nothing,
  and (because `expression` AND-combines with the `person`/`place` flags) the form is
  gated to **never appear**. This is likely already biting the user: their
  `pregnancy_registration` shows `true && contact.type === 'person'`, which can't match
  any contact in this config.
- **Correct form:** `contact.contact_type === 'patient'`. (Dev: confirm against the
  target CHT version; for custom/configurable types it is `contact_type`.)

## What to build (matches the PO ask: "person true/false, and if person → which type")
1. **Feed the project `contact_types` into the builder.** FormEditor already fetches
   the hierarchy (`api.getHierarchy()` for lineage); thread the contact-types list
   (id + person flag + display name) → `PropertiesEditor` → `ContextExpressionBuilder`
   as a new prop (mirror how `summaryFlags` / `contactForms` are passed at
   `PropertiesEditor.tsx:155–161`).
2. **Render the "Contact type is" dropdown from those types**, grouped **person** vs
   **place** (and ideally filtered to match whichever of Available-on-people/places is
   ticked). Drop the four hardcoded `<option>`s. Keep a free-text escape for an
   unknown id (the existing fallback input at `:185–187`).
3. **Specific-person-type UX:** when "Available on people" is checked, offer a
   **"Specific person type(s)"** picker populated from the person types → selecting
   `patient` emits `contact.contact_type === 'patient'` (multiple → e.g.
   `['patient','fchv'].includes(contact.contact_type)`).
4. **Emit `contact_type` for configurable types.** Add a parser/serializer path so a
   configurable type emits `contact.contact_type === '<id>'` while the legacy four can
   still emit `contact.type === '<id>'` (or migrate fully to `contact_type` if the
   target CHT supports it). **Round-trip both** (parse→serialize byte-stable; keep the
   raw-fallback for anything unrecognized — `ContextExpressionBuilder` already has it).

## Notes
- Touches **shared** (`contextExpressionParser.ts`), not just UI — needs a round-trip
  test for the new `contact_type` form (add to `shared/src/tasks/*.test.ts`).
- Don't break the legacy-type case (configs imported from cht-default rely on
  `contact.type === 'person'`).
- The `context.person`/`context.place` booleans already cover the broad gate — the new
  type picker is the *narrowing* on top, optional.
