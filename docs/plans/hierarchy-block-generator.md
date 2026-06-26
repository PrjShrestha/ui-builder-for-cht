<!--
Planner-locked feature plan. One-click insertion of the nested parent-lineage
group block, sized to the project's configured hierarchy.
v0.2 — corrected after adversarial verify + triad (workflow wf_d145415e-ef3, 2026-06-26).
The v0.1 depth premise ("depth = configured-hierarchy length") was WRONG; see Changelog.
-->

# Plan: One-click hierarchy-block generator ("Add lineage")

**Version:** v0.3 — 2026-06-26 · **Status:** PLANNER-LOCKED, developer-ready.
**Builds on:** `scaffolds.ts` (inputs/contact scaffold), the Hierarchy editor +
`deriveHierarchyOrder`, group authoring (balanced insert + `structuralBalance`),
and the `StructuralIssuesBadge` reveal/flip-to-Full precedent.

> **Changelog**
> - **v0.3** — reframed around the real requirement: capture *who submitted it*
>   (`inputs/user`) + *who it's about* (`inputs/contact` + optional ancestors),
>   configurably (§0). Locked the two open decisions — anchor on the `contact_types`
>   parent tree; **defer** the contact-edit variant B (ship app/report variant A first).
> - **v0.2** — verified (6-agent workflow). Fixed the depth model (it is **not**
>   the configured-hierarchy length — it's an author choice computed by re-walking
>   `parentOf` and **reversing**); re-grounded the contact-edit variant against real
>   CHT templates (single hidden `parent`, not a nested chain); confirmed the
>   repeated-`parent`-name nesting is **safe** through `structuralBalance`; added the
>   UX contract (invisible-on-insert is the #1 trap) and a mandated test matrix.
> - **v0.1** — initial scope (depth premise later found wrong).

## 0. Intent — capture "who submitted it" + "who it's about" (configurable)
The real requirement (user, 2026-06-26): a form should configurably capture —
- **Who submitted it** (the logged-in CHW/user) → the `inputs/user` block
  (`contact_id`, `name`, `phone`, `facility_id`) + metadata calculates (`created_by`,
  `created_by_person_uuid`, `created_by_place_uuid`). The scaffold already emits
  `inputs/user`; this surfaces it as an explicit, **toggleable** block.
- **Who it's about** (the contact in context / selected) → the `inputs/contact` block
  (`_id` via select-contact, `patient_id`) + linking calculates (`patient_uuid`,
  `patient_id`) + **optionally** the ancestor lineage (the nested `parent` chain, §2-3),
  sized by the leaf picker.

**Configurable** = the author picks: ☑ submitter, ☑ subject, the subject leaf ("who is
this about?"), how many ancestor levels (default full, editable), and name/phone per
named level. **Most report forms want submitter + subject + the linking calculates; the
deep ancestor chain is the configurable add-on, not the default headline** (real forms
rarely nest the whole hierarchy — §2). Net reframe: this feature is "capture submitter +
subject, with optional ancestors," not "nest the whole hierarchy."

## 1. Feasibility (verified)
- **Runtime depth discovery is NOT possible.** The **group-nesting depth** (number
  of nested named `parent` groups) is fixed at build time — pyxform compiles a static
  control tree + instance skeleton; Enketo/cht-form render against it. CHT *hydrates
  the values* into the levels you pre-declare. (`repeat` is the one runtime-dynamic
  construct, but it varies sibling **cardinality**, not ancestor **depth**, and CHT
  doesn't hydrate lineage into a repeat — so it doesn't change this conclusion.)
- A contact **shallower** than declared just leaves trailing `parent` groups empty;
  a **deeper** lineage's extra ancestors are simply **not surfaced in this form** —
  **not** data loss (the contact doc on disk is untouched).
- **So: depth-at-runtime → no; generate the static block from config at author time → yes.**

## 2. ⚠️ Depth is an AUTHOR CHOICE, not the hierarchy length (corrected)
The v0.1 formula "depth = configured-chain length" was wrong, verified against
`server/templates/cht-default`:
- `deriveHierarchyOrder(...)` returns **3** `[district_hospital, health_center, clinic]`,
  but on-disk `place_hierarchy_types` is **2** `[district_hospital, health_center]` —
  `clinic` (the household level) is a place type intentionally **excluded** from the
  array. The two sources **disagree by a level.**
- Real `pregnancy.xlsx` nests only **2** `parent` groups and bottoms out at a **CHW
  contact**, not the full place root chain. The canonical `inputs/contact` block has
  **zero** nested parents. **There is no CHT convention that nesting depth = hierarchy
  depth** — real depth is driven by *what data the form needs.*

**The model (locked):**
1. Depth is a **default + explicit author choice**, not an identity with hierarchy length.
2. Compute the ancestor stack by **re-walking `parentOf` from the chosen leaf** and
   **reversing** into outermost→innermost `parent` groups (the leaf's *immediate* parent
   is the **outermost** `parent` group). **Do NOT read `deriveHierarchyOrder`'s flat
   array left-to-right as the ancestor stack** — that array is root→leaf, folds
   orphans/cycles in flat, and would fabricate wrong nesting.
3. **Source of truth = the `contact_types` parent tree** (`parentOf`), not
   `place_hierarchy_types` (which is a display-order hint that may omit leaf places).
4. **Person leaf:** `person.parents[]` is a **set of allowed placements**, not a lineage
   (and `person.parents[0]` is often the **root**, e.g. `district_hospital`). Map the
   chosen person type to its first **place** parent, then walk that place's parent chain
   upward. (Or let the author anchor on a place leaf directly.) Document the tie-break.
5. **Guards (required):** detect **cycles/orphans** (a node not reachable from a root
   must not be emitted as a nested chain) and **multi-place-parent** places (following
   `parents[0]` silently drops other branches — surface a warning).

## 3. What it generates
### A. App / report forms — "patient + ancestor places"
**Splice** the nested `parent` chain **into the existing `inputs/contact` group** the
scaffold already emits — do **not** emit a competing `inputs` skeleton (the v0.1 example
wrongly dropped the `source` + `user` subgroups). Result (keeping scaffold structure):
```
inputs {relevant: ./source='user', field-list}
  source {hidden, default user}
  user   { … existing scaffold fields … }     # KEEP — do not drop
  contact
    string _id {select-contact type-<leaf>}
    hidden patient_id
    begin group parent          # leaf's immediate parent (OUTERMOST)
      hidden _id
      [hidden name, phone]       # only if the per-level toggle is on
      begin group parent         # grandparent … nested to chosen depth
        hidden _id …
      end group
    end group
  contact-close
inputs-close
calculate patient_uuid  ../inputs/contact/_id
```
`buildHierarchyBlock(hierarchy, opts)` returns **only the `parent`-chain rows** to
splice at end-1 of a named anchor group (default `contact`) — not a replacement skeleton.

### B. Contact edit/create forms — re-grounded (corrected)
v0.1's "nested parent chain in contact forms" does **not** match CHT. Real
`PLACE_TYPE-edit` / `person-edit` / `person-create` use a **single hidden `parent`
field** (+ an `init` group with `select-contact` selectors), **not** a nested
parent→parent chain — the framework resolves placement. **Either drop variant B or
restate it** to emit that single-parent + init-selector pattern. (Recommend: ship
variant A first; treat B as a separate, re-scoped task.)

## 4. UX contract (the part v0.1 missed — triad blockers)
The generated block is **100% plumbing** (begin group / hidden / calculate). The #1 trap:
**in Simple mode (the editor default) every row is hidden, so the screen shows nothing
change on insert** → reads as "it broke." Required:
1. **Confirmation toast** on insert (reuse `UndoToast`): *"Added contact + N ancestor
   levels (N hidden linking rows CHT fills in automatically — health workers won't see
   them)."* with a single **Undo** for the whole block.
2. **Flip to Full mode + auto-expand** the inserted `inputs`/lineage group, and move
   focus to its header (reuse the `StructuralIssuesBadge` `revealRowId` flip+scroll+focus
   path).
3. **Preview-before-commit ladder** (highest-leverage UX add): a read-only chain in
   **plain place names** from `place_types_display` — *"Health Center → Ward → CHW →
   Patient (4 levels) · adds N hidden fields"* — re-rendered live as the leaf/toggles
   change. Derive it from the **same `buildHierarchyBlock` output** so preview can't
   disagree with what's inserted.
4. **Render as one collapsible unit** ("Contact lineage (auto-generated)", collapsed,
   with a level count) so it lands as one tidy thing, not 21 scary rows.
5. **Leaf picker = "Who/what is this form about?"** populated from `place_types_display`
   human names (never raw type ids, never the word "leaf"); default the deepest leaf
   (person) so the common case is one click.
6. **name/phone behind an "Advanced" disclosure**, listed **by named level** (not depth
   index, not 7 up-front toggles) — default off (`_id` only). A single "include name +
   phone for the CHW level" shortcut covers the dominant case.
7. **Affordance = a tile inside the existing `QuestionTypePicker` modal** ("CHT building
   blocks → Contact + ancestor lineage"), **not** a second toolbar button — reuses the
   modal's focus/keyboard handling and the matched begin/end insert path; keeps the
   toolbar `[+ Question] [Simple|Full]`.
8. **Derive variant (A vs B) from the form category** — don't make the user choose
   between two jargon synonyms; one outcome-named verb per category.
9. **A11y:** real `<button>`; modal traps + returns focus (match `QuestionTypePicker`);
   leaf picker native `<select>` or arrow-key listbox; toggles real `<label><input
   type=checkbox>`; preview ladder is text; post-insert focus moves to the inserted
   group header.

## 5. Re-sync / staleness (was deferred — promote to v1 per triad)
Insert-only silently manufactures the drift this tool exists to prevent: edit the
hierarchy later and every embedded block is quietly wrong. **v1 must surface staleness
(not auto-rewrite):** stamp the generated begin-group with a marker extra
(`cht-ui-lineage: <signature>` e.g. depth + leaf), and show a **non-destructive badge**
when the embedded signature ≠ the current `deriveHierarchyOrder`/`parentOf` result
("Lineage block built from an older hierarchy — re-sync?"). After a depth-changing
Hierarchy save, surface a count ("N forms embed a lineage block that may need
re-syncing"). Auto-regenerate stays a follow-up.

## 6. Round-trip / safety (verified)
- **Repeated `parent` names are SAFE.** Verified: a depth-1/2/3/7 nested block of
  identically-named `parent` groups returns **0** `findStructuralViolations` (strict-LIFO
  pops inner-first; the H2 mismatched-name check only fires on genuine name-crossing).
  Real `pregnancy.xlsx` (nested `parent` *and* `contact` groups) returns 0. **No change
  needed** — but **pin it with a test** (§7) so a future generator bug can't regress to
  interleaved output.
- **Splice, don't replace** (§3A) — keep `source` + `user`; insert parent rows at end-1
  of the `contact` group.
- Pure codegen of standard rows → no parser change; emitted block must pass
  `findStructuralViolations` and round-trip byte-stable.
- **Deterministic rowIds** (mirror `scaffolds.ts` seed scheme; no `Date.now()`); the
  insert path re-keys to avoid collisions with existing survey rows.

## 7. Test plan (mandated matrix — was under-specified)
A shared, deterministic `buildHierarchyBlock` unit suite (no browser/server/fixture):
- **Repeated-name (blocker):** `buildHierarchyBlock(depth=7)` → `findStructuralViolations === []`
  AND every begin/end pair has agreeing names at the correct depth. **Plus** an adversarial
  test that deliberately interleaves the ends and asserts the guard flags it.
- **Depth-N nesting contract:** for depth ∈ {0,1,2,3,7}: exactly N `begin`/N `end`
  `parent` rows; a running nesting-depth counter reaches **exactly N** at the innermost
  row and returns to **0** at the end (count alone is insufficient — `[b][e][b][e]` and
  `[b][b][e][e]` both have N=2). depth=0 → zero parent groups, still balanced, never an
  unmatched begin.
- **Round-trip as a UNIT test** (mirror `scaffolds.test.ts`, **not** fixture-coupled
  smoke): scaffold-with-lineage → serialize → parse → assert (type,name) per row +
  balance preserved.
- **Empty/unconfigured hierarchy:** `place_hierarchy_types: []` → inputs/contact with
  **zero** parent groups, balanced.
- **Label fallback:** `place_types_display` with some keys missing → each group label is
  `display[type]` when present, exactly the **type id** when absent (never empty string).
- **Person leaf w/ multiple parents:** map to `parents[0]`'s place lineage deterministically;
  assert the chain matches `parentOf` above that place.
- **Leaf-slice boundary:** pick a leaf at each level of a 7-chain; assert parent-group
  count == strictly-higher place levels (pin inclusive/exclusive).
- **Cycle/orphan guard:** an unreachable/cyclic node is NOT emitted as a nested chain.
- **Determinism:** two calls, same input → identical output.
- e2e (insert+save balanced): **best-effort/fixture-gated** (Playwright needs a real
  config); the shared unit suite is the **required** gate.

## 8. Decisions (locked 2026-06-26)
1. **Depth:** default the **full place-parent chain above the chosen leaf** (computed by
   reversing the `parentOf` walk, §2), editable; leaf chosen via the "who is this form
   about?" picker. **Not** an identity with `place_hierarchy_types` length.
2. **Fields per level:** `_id` only by default; per-**named-level** toggle (behind an
   Advanced disclosure) adds `name` + `phone`.
3. **Variant B re-scoped:** contact-edit lineage = single hidden `parent` + init-selectors
   (per real CHT), or deferred; **not** a nested chain. Ship variant A first.
4. **Scaffold offers no lineage options** — keep the create dialog minimal (today's
   single-level `contact._id`); richer lineage is an explicit **in-editor** insert with
   the preview ladder. (Avoids two drifting entry points.)
5. **Re-sync = staleness badge in v1** (stamp marker + flag, never silently rewrite);
   auto-regenerate is a follow-up.
6. **Source of depth = the `contact_types` parent tree** (`parentOf` walk), not
   `place_hierarchy_types` — so the chain never silently skips a household-level place
   the forms need. (Resolves §9.)
7. **Contact-edit variant B is DEFERRED.** Ship variant A (app/report forms) first;
   re-scope the contact-form version later. The user's need is the app/report case.
8. **Two configurable blocks (the headline):** "who submitted it" (`inputs/user`) and
   "who it's about" (`inputs/contact` + optional ancestors), each independently
   toggleable; the linking calculates ride with whichever block is included. Deep
   ancestor nesting is opt-in, not the default (§0).

## 9. Resolved (was open)
- **Source of depth →** the `contact_types` **parent tree** (Decision 6). Treat
  `place_hierarchy_types` as a display-order hint only; never let it silently drop a
  household-level place. If a project's `place_hierarchy_types` deliberately omits levels
  the author still wants hydrated, the parent-tree walk includes them — which is the safe
  direction.
- **Variant B →** deferred (Decision 7). Ship app/report variant A first.
No open questions remain for v1.
