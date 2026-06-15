<!--
Triad + conformance audit of condition-builder v0.3 and calculation-builder Tier 0/1.
Source: planner workflow run wf_783c6ea3-dce (2026-06-15), 7 agents — adversarial plan-vs-code
conformance per area, a real gate run, and the PO/PM + Designer + QA triad.
Audited at HEAD 36e6f78 (v0.3 helpers verified byte-identical to their f0095e1 origin).
Planner-owned doc; developer-ready punch list.
-->

# Punch list — CB v0.3 + calc Tier 0/1 (post-ship triad audit)

**Date:** 2026-06-15 · **Audited SHA:** `36e6f78` · **Status:** developer-ready.

## Verdict

**Conformant to plan; safety/round-trip core is solid; NOT "done" by the triad gate.**
Every planned item across CB v0.3, calc Tier 0, and calc Tier 1 is genuinely built (verified
in code, not from commit messages). Gates: typecheck **PASS**, shared tests **189/189**, smoke
**Round-trip stable: YES**. Blocking the "done" call: **2 blockers** (one convergent microcopy
fix flagged by both PO/PM and Designer; one missing cancel-safety e2e = QA's standing #1
regression) plus a coherent **a11y batch**. Fix the two blockers + a11y batch before Tier 2
stacks on top.

---

## 🔴 Blockers (fix before calling v0.3/calc done)

### B1 — Operator labels read as broken fragments *(PO/PM `high` + Designer `blocker`, convergent)*
`OP_FIELD_KINDS` labels end in a bare "value": `equals value`, `is more than value`,
`includes value`, `does not include value`. To a non-coder this scans as an unfinished
sentence ("sex equals value?"), and it **diverges from the prose preview**, which says "is" /
"is more than" — so the dropdown and the `This row shows when:` readback disagree.
- **Fix:** drop the trailing "value" (`equals`, `is not`, `is more than`, `is at least`,
  `includes`, `does not include`); reuse `COMPARISON_PROSE` verbatim so the dropdown and the
  readback match. Keep `has an answer` / `is not selected` as-is.
- **Where:** [FormEditor.tsx:1191-1203](../../client/src/ui/FormEditor.tsx#L1191-L1203) (`OPERATOR_LABELS`), align with `COMPARISON_PROSE` [:1172-1179](../../client/src/ui/FormEditor.tsx#L1172-L1179).
- This is the single most-read string by the target persona — leave-as-is reads as a bug.

### B2 — Cancel-safety `× start over` e2e is missing *(QA `blocker`, #1 prior regression, named a blocker in the plan)*
No Playwright test proves an in-progress chain can be abandoned without corrupting the saved
column at the on-disk byte level. The reducer-level start-over test exists but **cannot** prove
byte-identity (a pure reducer has no write side-effect to assert against); the contract in the
plan's §6/§7/§9 demands an API/serializer-level diff.
- **Fix:** add a case to [condition-builder.spec.ts](../../client/tests/condition-builder.spec.ts):
  open a row with an existing single-clause `relevant` (e.g. `lmp_date`), stage 2 new clauses,
  click `× start over`, save, then GET the form via API and assert the re-parsed
  `row.extras['relevant']` is **byte-identical** (accounting for `setExtra` delete-on-empty per §3.5).
- The reducer start-over tests ([conditionReducer.test.ts:142-158](../../shared/src/conditionBuilder/conditionReducer.test.ts#L142-L158), :556-568) stay as state-shape guards but do **not** count toward the §3.5 byte-safety gate.

---

## 🟠 Accessibility batch *(Designer, all `high` — half-implemented ARIA is worse than none)*

### A1 — Tablist keyboard-incomplete (calc mode switcher)
`role="tablist"` with `role="tab"`+`aria-selected` but **no** arrow-key nav, **no** roving
tabindex, **no** `aria-controls`; panels are not `role="tabpanel"`/`aria-labelledby`.
- **Fix (pick one):** implement the full tablist pattern (roving tabindex, Arrow/Home/End,
  `aria-controls`+`role=tabpanel`), **or** downgrade to a plain button group / native radiogroup
  (it behaves like a button group, not a tabbed document).
- **Where:** [CalculationBuilder.tsx:258-271](../../client/src/ui/CalculationBuilder.tsx#L258-L271); panels :273-309.

### A2 — Radiogroup keyboard-incomplete (SingleValuePanel + TypedOutputInput)
Same defect: `role="radiogroup"`/`role="radio"`+`aria-checked` but no arrow keys, no roving
tabindex (every radio is its own Tab stop).
- **Fix:** roving tabindex + Arrow handlers, **or** switch to native `<input type=radio>` in a
  `<fieldset>`/`<legend>` (gets all of this for free — lowest-risk for a kind-picker).
- **Where:** [CalculationBuilder.tsx:360-373](../../client/src/ui/CalculationBuilder.tsx#L360-L373) (value kind), :567-580 (output kind).

### A3 — "Show all fields" auto-relax flips silently
The useEffect force-enables the checkbox when a rehydrated/atypical field is selected, with no
announcement — the list jumps from ~3 to ~30 and the box ticks itself unexplained (WCAG 4.1.3).
- **Fix:** an `aria-live="polite"` note by the checkbox: `Showing all fields because "<field>" isn't typical for this check.`
- **Where:** [FormEditor.tsx:1371-1378](../../client/src/ui/FormEditor.tsx#L1371-L1378).

### A4 — Modal has no focus management
`role="dialog"` but no focus trap, no initial-focus move, no Escape-to-close (only the cancel
button closes). Same for the rule-builder modal shell.
- **Fix:** on open move focus to the heading/first control; trap Tab; close on Escape; restore
  focus to the trigger on close.
- **Where:** [CalculationBuilder.tsx:250](../../client/src/ui/CalculationBuilder.tsx#L250); overlay styles `styles.css:723-742`.

---

## 🟡 Nits (batch opportunistically; medium → low)

- **N1 `med`** — "Show all fields" checkbox sits mid-sentence in the condition strip (between
  field and operator). Move to the far right (after value) or tuck under the field dropdown as a
  "more fields… (N hidden)" link that only appears when fields were filtered. [FormEditor.tsx:1680-1694](../../client/src/ui/FormEditor.tsx#L1680-L1694).
- **N2 `med`** — Strip vocabulary: `build:` lead-in + three competing `+`/`×` buttons
  (`+ add another rule`, `+ insert`, `× start over`). For the one-clause case promote the finish
  action (rename `+ insert` → `Apply`/`Save this rule`, style it as primary) and demote/hide the
  others until relevant. FormEditor.tsx:1628, 1762-1840.
- **N3 `med`** — optgroup vocabulary is inconsistent across the two adjacent dropdowns:
  field uses "Typical for this check"/"Other fields", op uses "Common operators"/"Other operators".
  Align to one vocabulary; consider "Other fields (less common for this check)". FormEditor.tsx:1652/1660, 1396-1398.
- **N4 `med`** — Empty calc cell lands on a "Common calculation" *gallery* containing exactly one
  recipe (with a possibly-disabled Insert) — over-promises a library. Either default empty cells
  to **Single value** (covers 205/258 corpus cells) and let users opt into templates, or ship 2-3
  recipes, or reword to "Quick recipe" (singular). [CalculationBuilder.tsx:59-66](../../client/src/ui/CalculationBuilder.tsx#L59-L66), TEMPLATES :104.
- **N5 `med`** — Stale code comments (cosmetic but misleading): header [:19-22](../../client/src/ui/CalculationBuilder.tsx#L19-L22)
  claims a store-boundary save-time self-check that `setExtra` does **not** perform (the guard is
  parse-time / demote-to-raw-on-open); and :257 says "radio semantics via aria-pressed" while the
  code uses `role=tab`/`aria-selected`. Fix the comments to match reality.
- **N6 `low`** — Condition field dropdown shows raw XLSForm names (`inputs/contact/sex`), not
  question labels. Show `Sex (inputs/contact/sex)`. FormEditor.tsx:1670-1674.
- **N7 `low`** — Value placeholder `value or ${other_field}` leaks `${}` syntax to a
  non-technical author. Soften to "type a value, or pick a field…". FormEditor.tsx:1732.
- **N8 `low`** — Help `❔` is a non-interactive `<span>` (keyboard-unreachable; hover-only). Make
  it a real `<button>` or add `tabIndex=0` + focus-visible reveal. FormEditor.tsx:1046-1050.
- **N9 `low`** — Result readback: empty state "Empty — the cell will be cleared on save." reads as
  a deletion warning mid-edit; generic fallback is a dead end. Soften to "Nothing entered yet." /
  "Custom formula — preview not available, but it will be saved as you wrote it." CalculationBuilder.tsx:732-758.
- **N10 `low`** — Group e2e proves in-session rehydrate but not durable on-disk persistence of a
  grouped `relevant`. Optional: add a save→reload round-trip case parallel to the choices test.
  condition-builder.spec.ts:127-201.

---

## Conformance deviations (informational — no action required)

- **`today` broad in `OP_FIELD_KINDS`** ([conditionReducer.ts:621-634](../../shared/src/conditionBuilder/conditionReducer.ts#L621-L634)) where the plan marked it field-independent.
  Assessed **safe / more-permissive**: `today` is excluded from `COND_OPS_NEED_FIELD`, so the field
  `<select>` is disabled for it and op-first field filtering never consults its list — it can never
  strand a field. *Optional:* the `not`/`ref` broadness test ([conditionReducer.test.ts:736](../../shared/src/conditionBuilder/conditionReducer.test.ts#L736)) doesn't pin `today`; add it if you want the contract frozen.
- **No dedicated "xpath" control** — xpath paths route through the Custom-expression textarea.
  Functionally covered and byte-stable (Bucket A proves it); the plan phrasing implied a distinct
  affordance but the generic path is fine.

## Praise — do not regress
Calc cold-start (empty cell → "Common calculation" → Age-from-DOB → Insert) is walk-up usable
without a developer. Round-trip escape hatches (raw-fallback banner, "show XLSForm expression"
collapsible, Raw mode) are visible everywhere — the chief defense against cold-start abandonment.
State is encoded with more than color (greyscale-legible). The unit/reducer/round-trip test layer
**over-delivers** on the plans' buckets (11-op completeness, enum-growth always-pass, label-leakage
guard, inferFieldKind exhaustiveness; calc Buckets A/B/C + the 258-cell field sweep + exact-17 pin).

## Out of scope this pass — pre-existing lint debt *(planner decision, 2026-06-15: leave it)*
`pnpm lint` fails (exit 1, 106 errors + 9 warnings), but **all of it predates** the condition/calc
work — server-infra `no-undef`/`no-useless-escape` from commit `4583de2` (v0.1). It is **not a
regression** from any v0.3/calc slice. Documented here for visibility; **not** actioned now. Revisit
as its own task before any "lint-green" milestone (and note CI still omits `pnpm lint`).
