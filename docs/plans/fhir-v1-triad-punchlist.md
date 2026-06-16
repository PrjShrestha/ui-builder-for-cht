<!--
Triad + conformance audit of FHIR V1 (PR1 route cfd49c9, PR2 workbench a20f699, PR3 choice-level +
pack d22d08e). Source: planner workflow wf_8f130c53-0ee (2026-06-15), 6 agents — adversarial
plan-vs-code (route / workbench / choice-level+pack) + PO/PM + Designer + QA. Audited at HEAD d22d08e.
Gates pre-verified green (254 shared tests, 25/25 e2e, typecheck clean). Planner-owned; dev-ready.
-->

# Punch list — FHIR V1 mapping workbench

**Date:** 2026-06-15 · **Audited SHA:** `d22d08e` · **Status:** developer-ready.

## Verdict
**Safety core solid; V1 not yet usable unaided.** The route round-trip contract, the codec false-orphan
guard (proven end-to-end), and the zero-SNOMED licensing oracle (3-mode, over the expanded
LOINC/ICD-11/ICD-10/CIEL pack) all pass — there is **no data-loss or SNOMED-leak risk** in what shipped.
But the PO/PM could not complete the mapping journey unaided, the Designer found two a11y blockers, and
there are two concrete functional bugs plus three missing UX-contract e2e. This is a polish pass on a
safe foundation, not a rebuild.

---

## 🔴 Blockers

### B1 — Off-pack dead-end: no way to map anything not in the bundled pack *(PO/PM `high` + Designer `high`, convergent)*
For any concept not in the ~10 baked-in pack entries, the picker search returns "No matches" and the
only action is **Skip** — no success path. The bundled pack has **zero choice-level concepts**, so
**every disease-select option dead-ends today.** Worse, the `StandardCodesView` header docstring
([:17-19](../../client/src/ui/StandardCodesView.tsx#L17-L19)) claims a *"Custom code… escape hatch is
intentionally present"* — **it does not exist anywhere in the component.**
- **Fix:** implement the secondary "Custom code…" affordance the comment promises (behind a disclosure,
  writes `source:'manual'`), **or** at minimum make the empty state actionable. Either way, delete the
  false docstring. ([TwoStepPicker empty state :730-732](../../client/src/ui/StandardCodesView.tsx#L730-L732); choice rows have no pack source, [:552-560](../../client/src/ui/StandardCodesView.tsx#L552-L560).)

### B2 — Dictionary selector abandons the proven native-radio a11y pattern *(Designer `blocker`)*
The dictionary selector is a row of `<button className={active?'active':'link'}>`
([:706-717](../../client/src/ui/StandardCodesView.tsx#L706-L717)) — no `role`, no `name=` grouping, no
roving tabindex, no arrow-key handler; "active" is conveyed **only by background color**. This is the
exact anti-pattern the calc kind picker *already solved* (the A2 fix). A keyboard/SR user can't tell
which dictionary is selected.
- **Fix:** carry the house pattern verbatim — native `<input type="radio" name="fhir-dictionary">` in
  `<label className="kind-radio">` inside a `<fieldset>` with a visually-hidden legend. Arrow-keys +
  grouped announcement + `aria-checked` come free. (Reference: `CalculationBuilder.tsx:491-504`.)

### B3 — Suggested-vs-confirmed is effectively color-only *(Designer `blocker`)*
The only non-color cue is the code-chip border (solid vs dashed, [styles.css:382-389](../../client/src/styles.css#L382-L389));
the status-chips are color+text, and the `row-status-{confirmed|suggested|skipped|unmapped}` classes
are **emitted in the TSX but have no CSS rule at all** — the intended row tint doesn't exist. In
greyscale, a needs-review suggestion and a locked-in confirmed mapping are distinguished almost entirely
by reading chip text.
- **Fix:** add a glyph to each status chip (e.g. ⏳ Suggested / ✓ Confirmed / — Skipped) so shape carries
  meaning, and actually implement the `row-status-*` rules (a per-status left-border accent reads in
  greyscale). Keep the dashed-vs-solid border as a reinforcing third channel.

---

## 🟠 High

### H1 — ICD-10 dictionary renders as a raw URL *(functional bug, this commit; PO/PM `high`)*
The new ICD-10 pack concept uses system `http://hl7.org/fhir/sid/icd-10`, but `systemLabel`
([:782-788](../../client/src/ui/StandardCodesView.tsx#L782-L788)) only matches
`http://id.who.int/icd/release/10…`. So `systemLabel('http://hl7.org/fhir/sid/icd-10')` returns the
**bare URL** — the picker's "1. Dictionary" tab and the code-chip suffix show a raw URL instead of
"ICD-10" on the cold-start screen. (The PR3 commit message's claim that the new systems are "already
recognized by systemLabel" is false for ICD-10; the e2e misses it because it only clicks LOINC.)
- **Fix:** align the pack's ICD-10 `system` to the WHO-style URL (consistent with the ICD-11 entry +
  MVP Decision 4) **or** add the hl7 spelling to `systemLabel`; and never render a bare URL — fall back
  to "Other code system."

### H2 — Three plan-mandated UX-contract e2e are missing *(QA `high`)*
The data-safety e2e are strong, but the *workflow a PO/MOH touches* is under-covered:
- **reload→survive** — no test does `page.reload()` and asserts confirmed/suggested/skipped re-hydrate
  from disk (current tests re-read via the API, not the UI). *Single highest-value missing test.*
- **Skip + Change-from-suggested** — only **Accept** is exercised; Skip (the PO's zero-penalty escape)
  and Change (the core correction path) have no e2e.
- **coverage indicator** — `coverage.ts` is unit-tested but no e2e asserts the workbench renders/increments
  the honest "X of N" count; a "12 of 47" regression would pass the suite.
- **Fix:** add the three e2e to `client/tests/fhir-mapping.spec.ts`.

### H3 — Orphans are invisible in the UI (§C5 + MOH gate unmet) *(conformance miss)*
The route computes orphans ([fhirMapping.ts:156](../../server/src/routes/fhirMapping.ts#L156)) and returns
them on `mapping.orphans`, but the **workbench renders no orphans block** and **`DecisionsView.tsx` has
zero fhir/orphan references.** A renamed question's confirmed binding is preserved in the JSON but
invisible to the user — the §C5 ("coverage + orphans in the same screen") and MVP §7 MOH gate
("orphans logged in DecisionsView") are both unmet.
- **Fix:** render an orphans section in the workbench + surface them in `DecisionsView` (the MOH trail).
  If deferring, record it explicitly as out-of-V1 so the gate isn't silently unmet.

### H4 — Terminology walk-up + the missing enumerable-dictionaries list *(PO/PM `high` + conformance)*
Bhishan is never told what LOINC/ICD/CIEL mean — bare acronym buttons, no basis to choose → freeze.
And the **Decision-4 "enumerable available-dictionaries list" was never implemented** (the plan's PR3
grounding check called for it): dictionaries are inferred ad-hoc from `concept.system`, so a dictionary
with zero curated concepts silently never appears as a tab — exactly the gap the enumerable list was
meant to close ([picker derives dicts at :678-684](../../client/src/ui/StandardCodesView.tsx#L678-L684)).
- **Fix:** add a one-line plain-language helper per dictionary (mirror the calc kind-help pattern), and
  add the enumerable dictionaries list to the pack/`StarterPack` type so the picker reads it rather than
  inferring from present concepts.

---

## 🟡 Medium / Low
- **M1 — denominator drift:** the columns-table header uses the honest `coverage.ts` denominator, but the
  FormPicker dropdown computes a **second** self-referential count (existing mappings, not the mappable
  subset, [:222-239](../../client/src/ui/StandardCodesView.tsx#L222-L239)). Unify on the one helper.
- **M2 — non-pregnancy cold-start:** pack pre-fills match only `app:pregnancy` by exact formId, so an ANC
  form named anything else opens fully cold (all red). Consider matching by question-name overlap or
  letting the user declare which form the pack applies to. *(Design question — planner to decide.)*
- **M3 — route has no fast unit/contract test:** every route guarantee rides on Playwright; the
  `/`-in-name false-orphan guard is proven in `shared/` but never through the HTTP boundary
  (`buildLiveKeys`). Add a Fastify `.inject()` contract test (also de-risks from Playwright flakiness).
- **M4 — picker results a11y:** `.picker-result` has `:hover` but no `:focus-visible`; no `aria-live`
  match count. **M5 — choice expand affordance** weak (11px link in the Actions cell, no `aria-controls`).
  **M6 — dictionaryVersion** captured but never surfaced (MOH provenance). **M7 — sidebar disabled** state
  has no tooltip explaining what unlocks it. **M8 — loading/error:** Try-again may not re-fetch (effect
  keys only on `project.path`); loading has no `aria-live`.
- **L1 — Skip has no undo** (route through the existing undo-toast). **L2 — coverage "stable across
  re-parse"** not directly asserted. **L3 — GET-on-absent literal-empty branch** no longer covered after
  the PR2 auto-apply change. **L4 — suggested-vs-confirmed** e2e asserts class, not computed style.

## Praise — do not regress
The zero-SNOMED oracle (3-mode, over the expanded pack), the false-orphan codec guard (injectivity for
both 2- and 3-segment keys + `/`-in-name retain), and the PUT byte-isolation test (mtime + full-tree
snapshot) are the licensing/data-safety guard done correctly. The coverage header breakdown, the honest
"Suggested (review)" pre-fill model, and the compare-before-write no-op-on-open are the right instincts —
the blockers are about making those instincts **legible without color and keyboard-complete.**

## Out of scope (per plan, correctly deferred)
A5 "Group these" wrap (survey editor); online typeahead + circuit breaker (post-V1, needs the recorded-
fixture contract gate); real pack curation beyond the representative samples (`build-terminology-pack.mjs`
was not added — pack governance, planner-flagged).
