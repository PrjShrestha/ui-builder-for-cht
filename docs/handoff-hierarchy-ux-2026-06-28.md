<!--
Dev handoff: 4 Hierarchy-editor UX improvements from PO review of the
"Add contact type" flow (2026-06-28). Planner-authored; all are client-side UI
work in HierarchyEditor.tsx. Designer lens applied inline; offer a full Lal pass
for the #3/#4 IA if wanted. None are bugs — polish + one consistency fix.
-->

# Dev handoff — Hierarchy-editor UX polish (2026-06-28)

Four items from a PO walkthrough of the Hierarchy editor + "Add contact type" modal.
All client-side in `client/src/ui/HierarchyEditor.tsx`. Priority: **#2 (consistency
fix) and #4 (count_visits places-only) first** — they remove real confusion/dead-ends;
#1 and #3 are layout/IA.

## 1. Move "+ Type" to the tree pane (LOW effort, clear win)
**Now:** "+ Type" sits in the top-right page header (`HierarchyEditor.tsx:154–155`)
alongside Generate-forms / Undo / Redo / Save — a crowded bar mixing list-actions
with page-actions.
**Do:** move "+ Type" (rename "+ Add type") into the **tree pane header**, next to
`<h3>Contact types ({n})</h3>` (`:242–243`), so the add-action heads the list it
appends to. Leave Generate / Undo / Redo / Save in the page header.

## 2. "+ Type" modal: auto-slugify the id + show a note (CONSISTENCY FIX)
**Now:** `AddTypeForm` (`:577–604`) treats the field as a raw id, validates with
`/^[a-z][a-z0-9_]*$/` (`:587`), and **hard-blocks** non-conforming input with a red
"— invalid id" (`:640–642`). Typing "Fchv Person" dead-ends.
**Problem:** the **Quick Hierarchy Creator already does the friendly thing** — it
slugifies the typed name to an id (`slugifyHierarchyId` in
`shared/src/hierarchy/buildLinearHierarchy.ts`) and shows the derived id live. The two
entry points disagree.
**Do:** make `AddTypeForm` match the creator:
- Treat the input as a **friendly name**; derive the id via `slugifyHierarchyId`.
- Show the derived id as a muted note ("saved as `fchv_person`") instead of a red error.
- Only block when the slug is **empty** (e.g. all non-ASCII / Devanagari → then require
  an explicit ASCII id, per `quick-hierarchy-creator.md` §7) or the id **duplicates** an
  existing type. Keep those two as real errors.
- Commit uses the derived id (the rest of `commit()` at `:590–604` is unchanged —
  `create_form`/`edit_form` etc. already key off `id`).

> **REVISED 2026-06-28 (pm) — SUPERSEDES THIS §3.** The two-section People/Places
> split below was built (`cdb36b0`), but the PO then decided against it. **Final
> decision: nest each person type as a leaf under its parent place in ONE unified
> tree** — drop the separate People section, keep the 👤/🏠 icons, and list a
> parent's person-children before its child place. `buildTree`
> (`HierarchyEditor.tsx:412–433`) already nests by `parents[0]`; this is mostly
> removing the section wrapper `cdb36b0` added + a sibling sort.

## 3. Surface person types — but NOT by re-sorting the indented tree
**Request:** "always sort person type first, then place types" (arrow at the
left tree).
**Tradeoff:** the left panel is an **indented hierarchy tree** (`buildTree`
`:412–433`, rendered `:247–256`) where vertical position encodes parent→child. The
person is the **leaf**, so it's at the bottom by design. Literally hoisting it to the
top detaches it from its parent and misrepresents the structure.
**Recommended instead:** split the tree pane into two labelled sections —
**"People ({n})"** (flat list of `person:true` types) first, then **"Places"** as the
indented chain below. Surfaces persons *and* reinforces #4's People-vs-Place split.
**Lighter alternative** if a full split is too much: sort each parent's `children`
person-first in `buildTree` (small visual effect on linear chains). **Confirm which**
with the planner before building — recommend the two-section layout.

## 4. Relabel the Person/Place + Count-visits controls
**Person/place binary** (`:514–521` in the detail editor; `:645–651` in the modal):
the lone "Person type (vs place)" checkbox is ambiguous. Reframe as a clear
two-option choice:
- **"Person (personnel — e.g. CHW, patient)"** vs **"Place (a facility or area — e.g.
  District, Health Facility)."**
- Keep **"Place"** as the term (matches `place_hierarchy_types` / `place-types.json` /
  `place_types_display` everywhere). PO floated "Location Type (Facility or
  Geographical Region)" — **decision for the planner**: adopt "Location Type" in the
  UI, or keep "Place" + that phrase as the description. Default: keep "Place".

**"Count visits (place-level)"** (`:522–529`; `count_visits` field `:27`):
- It's a **real CHT setting** (`count_visits` puts a visit count + "last visited" on a
  place's profile) — do **not** remove it.
- The reason it reads as nonsense: it's shown on **person** types too, where it's
  meaningless. **Show it only when the type is a place** (`!type.person`).
- Relabel → **"Track visits on this place's profile"** + a one-line tooltip:
  "Shows a visit count and 'last visited' on the contact's profile (CHT
  `count_visits`)."

## Notes
- All four are UI-only; no parser/round-trip surface, no `base_settings` shape change
  (except #4 already toggles the existing `person` / `count_visits` fields).
- #2 must keep the existing **non-destructive** id rules (no auto-suffix on collision;
  ASCII-id requirement for non-Latin labels) — reuse the creator's helper, don't
  re-implement.
- A full designer (Lal) pass on the #3 People/Places IA + #4 copy is available if the
  planner wants it before build.
