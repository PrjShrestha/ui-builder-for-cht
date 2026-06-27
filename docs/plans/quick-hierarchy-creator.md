<!--
Planner spec for the "Quick hierarchy creator" — a guided empty→deployable
quick-start for the empty template. Synthesized from the requirements/validation
triad (Bhishan PO / Lal design / Lorena QA), 2026-06-28. Greenlit by the user.
Dev-ready: pull into DEV-HANDOFF at a priority the planner sets.
-->

# Plan: Quick hierarchy creator

**Status:** v0.1 — PLANNER-LOCKED (greenlit 2026-06-28) · **Owner:** planner
· **Builds on:** `onboarding-order.md` (guardrails), `contact-form-generator.md`
(the generator this chains into), `templates_new_project_matrix` (the gap this fills)

## 1. Problem & goal
Most users will start from the **empty** template. Today that drops them on a raw
"create your first place type" form with no idea what a "place type" is — the
cold-start abandonment that is the PO's signature failure mode. 

**Goal:** a non-technical DHO goes from an **empty project → a deployable config
(hierarchy + contact forms) in one sitting, without emailing a developer.** The
whole hierarchy is described the way they already think about it — "what are your
levels, biggest to smallest, and who sits at the bottom" — and the flow ends by
offering to generate the contact forms so the result is actually deployable, not
just a pretty empty tree.

## 2. Locked decisions
1. **Editable, pre-seeded list — not a hard "pick N first" gate.** (See §3 for the
   reconciliation of the user's "choose a number" with the triad's pushback.)
2. **The person leaf is explicit, pinned, and non-removable.** Every CHT hierarchy
   ends in a `person:true` leaf; the UI makes "the bottom is a person, not a place"
   obvious by *shape*, never by jargon.
3. **Step 5 (offer to generate contact forms) is in-MVP, not a later phase.** A
   hierarchy that isn't deployable is the same trap in a nicer shirt. It must be
   **skippable**.
4. **Linear chain only.** Forks (a type with multiple parents / sibling child types)
   stay in the full visual Hierarchy editor. A one-line footnote points there.
5. **Offered, skippable, non-destructive.** Surfaces only on a genuinely empty
   hierarchy; "guide, don't gate." Composes existing audited primitives
   (HierarchyEditor write path + contact-form generator) — **no new parser surface.**

## 3. The "number first" question — reconciled (needs your nod)
You chose: *"choose the number, then list them, then add/remove."* Both the PO and
the designer pushed back on making the number a **blocking first step** — "I always
miscount my own districts," and asking for a count *before* the user knows what a
"level" is forces a blind guess.

**Reconciliation (recommended):** keep the number, demote it from a gate to a
seed control. The user lands directly on the editable list, **pre-seeded** with a
worked example (2 place rows: *District*, *Health facility* + the locked person
row) so the screen is never blank. A small **"Levels: [2 ▾]"** stepper at the top
quickly adds/removes place rows; the list itself is the real interface (rename,
+ Add a place below, remove, reorder). This honors "choose a number → list → add/
remove" *and* the never-blank, never-blind-guess principle.

→ **Decision for you:** ship the reconciled version (number = optional seed), or do
you want a literal number-first step screen? Default if you don't say: reconciled.

## 4. UX flow & copy (from design)
One screen, titled **"Set up your places."**
Intro: *"List your places from biggest to smallest — for example Country, then
District, then Facility. The people you serve sit at the bottom."*

- **Place rows** (🏠 icon): drag handle + Move up/down buttons, editable name,
  Remove. Pre-seeded with 2 example rows. **"+ Add a place below"** under the last.
  Derived id shown muted inline: *"saved as health_facility"* so it's not a surprise.
- **Person leaf** (👤 icon): a visually distinct, **non-draggable, non-removable**
  card pinned to the bottom under a rule and heading **"The people here."** Editable
  name defaults to **"Person."** Helper: *"This is who your health workers register
  and care for — a patient, client, or household member. It's always the lowest
  level."* (Never the word "leaf" or "type.")
- **Footnote:** *"Need branching (a level under more than one parent)? Use the full
  Hierarchy editor."*
- **Primary button:** **"Set up my hierarchy."** Entry-point CTA label:
  **"Quick start"** / **"Set up my hierarchy."**
- **After scaffold — the form offer:** *"Want me to create the forms so you can
  start adding these places and people? (You can skip this.)"* — **Generate forms**
  / **Skip for now.**

## 5. What gets written (the scaffolding contract)
For place levels `L0…Ln` (top→bottom) and person leaf `P`:

- **`contact_types`** (in `base_settings.json`):
  - `L0`: `{ id, parents: [] }` (top has no parent)
  - `Li (i>0)`: `{ id, parents: [L(i-1).id] }` — strict linear chain
  - `P`: `{ id, person: true, parents: [Ln.id] }` — **person parents = the single
    bottom-most place** (linear intent). Rationale + test note in §8: the form
    generator's `resolveParentPlace` reads `parents[0]`, so the leaf's select-contact
    must point at `Ln`. Multi-parent persons (cht-default style) are an advanced tweak
    left to the full editor.
  - Each type also gets `create_form`/`edit_form` = `form:contact:<id>:create|edit`
    written **the same way AddTypeForm does today** (reuse that write path; do not
    re-implement).
- **`place_hierarchy_types`**: `[L0.id … Ln.id]` (places only, in order; person excluded).
- **`place-types.json`**: `{ <id>: "<friendly label>" }` for every place level.
- **Translations** (`messages-en.properties` or project equivalent): label keys for
  each type, matching how the hierarchy editor labels types today.
- **Nothing else in `base_settings.json` is touched** — the non-negotiable invariant.

**id derivation:** friendly name → slugify to `/^[a-z][a-z0-9_]*$/` (the existing
`validId` rule). Label keeps the original text (incl. Devanagari); id must be ASCII.

## 6. Surface & gating
- Empty-state **CTA in the Hierarchy editor** when parsed `contact_types.length === 0`
  — this helps the empty template *and* any project that opens with an empty hierarchy.
- The New-Project wizard can **route into** the same component after scaffolding an
  empty/blank project.
- **Gate on the actually-parsed `contact_types`, not the wizard's assumption.** If
  the hierarchy is non-empty, the quick creator does not appear (user uses the full
  editor). If somehow entered on a non-empty project, every level must pass the
  existing duplicate-id guard against current `contact_types` before writing.

## 7. Validation rules (from QA — these are the headline bugs)
- **Slug collision = block, never auto-suffix.** Dedupe on the *derived id*, not the
  typed label: "Health Facility" and "health-facility" both → `health_facility` →
  inline error, block Continue. Auto-suffixing (`_2`) would orphan
  `place_hierarchy_types` entries.
- **Collision with an existing contact type:** run the same guard the editor uses
  (`AddTypeForm`/`onRename` duplicate-id checks) against current types.
- **Empty/whitespace name:** trim, then reject (empty slug → `begin group ''`).
- **Unicode/Devanagari name:** route the text to the **label**; require a separate
  ASCII id; surface the requirement *before* scaffolding. **Do not auto-transliterate
  silently.**
- **Duplicate friendly names** (even if ids differ): inline per-row warning.

## 8. Edge & state cases
- **Zero places** (all removed): Continue disabled, helper *"Add at least one place."*
  Never allow a person-only chain.
- **One place + person:** valid (Place → Person). Allow.
- **Change the number after naming rows:** preserve already-typed names (don't wipe).
- **Remove a middle level:** re-parent the chain (`L(i+1).parents = [L(i-1).id]`) and
  rewrite `place_hierarchy_types` order; no dangling `parents:[deletedId]`.
- **Cancel/Back mid-flow:** **write nothing to disk until the final commit** (not
  incremental). If data was entered, confirm: *"Discard this hierarchy? Nothing's been
  saved yet."* From the wizard, Back returns to the template step without scaffolding.
- **Person parents wiring:** assert exactly `[Ln.id]` (the one real logic-bug risk).

## 9. Accessibility (we've been burned here before)
- Every row name is a real `<label>`-bound `<input>` (not placeholder-only).
- Keyboard reorder: **Move up/down buttons** mirroring the existing ←/→ pattern in
  HierarchyEditor (`aria-label="Move <name> up"`); drag is an enhancement, not the
  only path.
- `aria-live="polite"` region announcing reorder ("Ward moved to position 2").
- Errors tied via `aria-describedby` + icon + text — **never color alone.**
- Modal: `role="dialog"` + `aria-labelledby`, focus trap, focus first place input on
  open, Esc routes through the cancel-confirm. Targets ≥ 44×44px.

## 10. Out of scope (MVP)
Forks/branching; multi-parent persons; bilingual label editing inside this flow
(rename later in the full editor); advanced toggles. Keep it strictly linear so it
doesn't become a second, weaker tree editor.

## 11. Test plan & acceptance criteria (from QA)
**`node --test` in `shared/` (pure logic — preferred):**
- slugify + collision detection (label vs derived-id dedupe).
- chain assembly: `parents` wiring for L0 (`[]`), Li (`[L(i-1)]`), person (`[Ln]`).
- `place_hierarchy_types` = places-only, correct order; middle-removal re-parenting.
- **round-trip byte-stability** (parse→serialize→parse) on `base_settings.json`,
  `place-types.json`, and every generated `.xlsx`.
- **re-run idempotency**: second run is a no-op (`written: 0`, files byte-unchanged) —
  honors the generator's skip-not-overwrite.

**Fixtures:** `empty/`, `empty-with-stray-keys/` (base_settings with an unrelated
custom key that must survive byte-identical), `nonempty-collision/`.

**Playwright e2e:** empty-state CTA appears only when empty; add/remove/reorder
levels; change-N preserves typed names; cancel writes nothing; person leaf can't be
removed/dragged; the offered form-generation handoff (Generate / Skip for now).

**Acceptance gates:** (a) untouched `base_settings.json` keys diff-clean; (b) each of
collision / empty / unicode is blocked with a message; (c) generated chain's `parents`
match expected; (d) re-run no-op.

## 12. Pre-ship punch list (severity-tagged, from design)
- **Blocker:** keyboard reorder; non-removable person leaf enforced; no path to an
  empty or person-only chain; duplicate/blank-name validation blocks Continue.
- **Blocker:** cancel-with-data confirm — no silent data loss; nothing written before
  final commit.
- **Blocker (QA):** non-destructive on re-run — only the 4 owned files change; round-
  trip byte-stable.
- **High:** seeded example rows (never a blank screen); derived-id shown inline;
  aria-live reorder announcements; a11y labels on every control; the form-generation
  handoff is clearly **Skip**-able.
- **Medium:** non-color error cues; focus-on-error; 44px targets; 🏠/👤 iconography
  consistent with the tree.
- **Low:** microcopy polish ("biggest to smallest"); add/remove animation; sensible
  default seed.

## 13. Open questions for the planner/user
1. **§3** — reconciled "number-as-seed" flow (recommended) vs a literal number-first
   step? Default: reconciled.
2. **Person parents** — confirm `[Ln]` (register only at the bottom place) is the
   right default vs cht-default's "person under every place." Recommend `[Ln]` for
   the linear MVP; advanced multi-parent in the full editor.
3. **Priority/slot** in `DEV-HANDOFF.md` relative to the existing queue (incl. the
   Phase-1 UI wiring gap and lint/`.gitattributes`).
