<!--
Planner-locked feature plan. One-click insertion of the nested parent-lineage
group block, sized to the project's configured hierarchy.
Grounded against the Hierarchy editor + scaffold + group-authoring on 2026-06-26.
-->

# Plan: One-click hierarchy-block generator ("Add parent / contact lineage")

**Version:** v0.1 — 2026-06-26 · **Status:** PLANNER-LOCKED, developer-ready.
**Builds on:** `scaffolds.ts` (inputs/contact scaffold), the Hierarchy editor +
`deriveHierarchyOrder` (chain source), and group authoring (balanced insert +
`structuralBalance` guard).

## The feasibility reality (read first)
- **Runtime depth discovery is NOT possible.** XForms are static — the number of
  nested `parent` groups is fixed at build time. CHT *hydrates the values* into the
  levels you pre-declare (already dynamic); it cannot add/remove levels at fill-time.
  A shallower contact leaves trailing `parent` groups empty; a deeper one loses the
  extra ancestors. So depth must be decided when the form is authored.
- **Design-time generation from the configured hierarchy IS possible and is the
  right model.** The app already knows the hierarchy (`base_settings.json`
  `contact_types` + `place_hierarchy_types`, via `GET /api/hierarchy`), and
  `deriveHierarchyOrder` already yields the linear place chain. So we generate the
  exact nesting once, from config, in one click — and re-generate if the hierarchy
  changes.

## What it generates
Two variants (the user named both):

### A. App / report forms — "Add contact + ancestors"
The `inputs/contact/parent…` block the App-Forms tutorial shows:
```
begin group  inputs     {relevant: ./source = 'user', appearance: field-list}
  hidden     source     {default: user}
  begin group  contact
    string   _id        {appearance: select-contact type-<leaf>}   # contact in context
    hidden   patient_id
    begin group  parent                 # ancestor level 1
      hidden _id
      (hidden name / phone — optional, see decision 2)
      begin group  parent               # ancestor level 2
        hidden _id …
        …                               # nested to the configured depth
      end group
    end group
  end group
end group
calculate  patient_uuid   ../inputs/contact/_id
calculate  patient_id     ../inputs/contact/patient_id
```
Nesting depth = number of ancestor place levels above the contact-in-context =
length of the place chain (`deriveHierarchyOrder`) above the leaf. (NSSD's 7-level
hierarchy → 7 nested `parent` groups.)

### B. Contact (edit) forms — "Add parent lineage"
The contact-type-named top-level group → nested `parent` groups for the hydrated
ancestor data (per the CHT edit-form convention), same depth logic.

## Depth + names (from config, no guessing)
- Source: `GET /api/hierarchy` → `{ contact_types, place_hierarchy_types, place_types_display }`.
- Chain: `deriveHierarchyOrder(place_hierarchy_types, contact_types)` gives the
  ordered place chain (root → leaf). The ancestor stack for the contact-in-context
  is that chain **above** the chosen leaf, walked upward into nested `parent` groups.
- **Group labels** come from `place_types_display` (e.g. "Health Center"); fall back
  to the type id. Field labels: `_id` → "<Level> UUID", etc., matching the tutorial.

## Where it lives
- **In-editor insert:** a "Insert → Contact lineage / Parent lineage" affordance in
  the survey editor (next to "+ Question" / the group tools). Fetches `/api/hierarchy`,
  computes the chain, inserts the **balanced** block via the same path group authoring
  uses (so the `structuralBalance` guard + nested rendering apply for free).
- **New-form scaffold:** extend `scaffolds.ts` so the app-form scaffold's `inputs/contact`
  can optionally carry the full ancestor chain (today it stops at `contact._id`). Same
  generator, called server-side at create time.
Share ONE pure generator (`buildHierarchyBlock(hierarchy, opts) → SurveyRow[]`) in
`shared/`, consumed by both the client insert and the server scaffold.

## Round-trip / safety
- Pure codegen emitting **standard, balanced** group rows — no parser/serializer
  change. The emitted block must pass `findStructuralViolations` (balanced) and the
  smoke round-trip; add a unit test asserting depth-N input → N matched begin/end
  `parent` pairs, correctly nested.
- Re-sync (hierarchy changed after insert): MVP = insert only; **follow-up** =
  detect an existing `inputs/contact/parent…` block and offer "re-sync to current
  hierarchy" (replace the parent chain, preserve any user-added fields). Flag, don't
  silently rewrite.

## Decisions to lock
1. **Anchor for depth.** App forms: the contact-in-context can be any type, but the
   standard pattern declares the **full place chain** (leaf → root). Default to the
   full configured depth; optionally let the author pick the leaf contact type.
2. **Fields per level.** `_id` is always emitted (it's what links lineage). `name`
   and `phone` are common but not universal — default to **`_id` only**, with a
   checkbox to also emit `name`/`phone` per level (the tutorial's CHW example uses
   name+phone at the CHW level).
3. **field-list / hidden.** Match the tutorial: `inputs` is `field-list` + hidden
   parent fields; the whole block is gated `relevant = ./source = 'user'`.

## Persona notes
- **Bhishan (PO/PM):** the win — "add the whole lineage" instead of hand-nesting 7
  `parent` groups and 21 hidden fields without a typo. One click, sized to the
  project's real hierarchy.
- **Developer:** pure generator from `/api/hierarchy` + `deriveHierarchyOrder`,
  reusing the scaffold + balanced-insert; no XForm runtime trickery (correctly
  ruled out above).
- **QA (Lorena):** unit test (depth-N → N balanced nested pairs + correct labels)
  and a round-trip/smoke on a generated form; an e2e that inserts the block and
  saves balanced.

## Open question
Re-sync behavior when the hierarchy changes after a form already embeds a block —
auto-offer regenerate, or leave fully manual for v1? (Recommend manual insert for
v1; re-sync as a fast follow-up once the generator is proven.)
