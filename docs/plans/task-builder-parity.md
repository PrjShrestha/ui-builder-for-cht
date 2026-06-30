<!--
Planner plan: bring the Tasks editor to parity with the form builder's no-code
patterns — pick real data, never hand-type ids/refs, visual+raw, validate inline,
round-trip-safe, crash-resilient. Consolidates DEV-HANDOFF #7–#10 + new gaps found
auditing TasksEditor/AppliesIfBuilder/ResolvedWhenPicker/ActionsEditor. 2026-06-28.
-->

# Plan: Task builder ← form builder parity

**Goal:** the Tasks editor (`TasksEditor` + `AppliesIfBuilder` + `ResolvedWhenPicker`
+ `ActionsEditor` + `EventsEditor`) should inherit **every** no-code pattern the
form/contact/hierarchy editors already prove out. The task builder is partway there;
this closes the gaps in one coherent pass.

## The patterns we've validated in the form builder (the "learnings")
- **A. Pick real data, never hand-type** — fields via `FieldPicker` (real contact
  forms), report fields via `ReportFieldPicker` (real app forms), contact types from
  real `contact_types`, forms from the real project form list, choices from real lists.
- **B. Label-first, auto-derived identifiers** — type the human label; slugify the
  `name`; never type identifiers or `${}` (see `decision_nocode_names_autoderived`).
- **C. References inserted by pickers, not typed.**
- **D. Visual builder + raw-text fallback, byte-preserved.**
- **E. Inline validation + one-click fix** (the `NameInput` "Fix → slug" pattern).
- **F. Round-trip safety** — parse→serialize byte-stable; raw preserved.
- **G. Resilience** — error boundary; Zustand selectors return **stable** refs (no
  inline `.filter/.map` building a new array each render — the #7 crash class).
- **H. Emit the correct CHT shape** (e.g. `contact.contact_type` for configurable types).

## Per-surface audit → action

| Surface | Today | Gap → action |
|---|---|---|
| appliesIf — **contact field** | ✅ `FieldPicker` (real contact forms) | keep |
| appliesIf — **report field** | ✅ `ReportFieldPicker` (real app forms) — **but CRASHES** | **#7** (confirmed fix: memoize the `useApp` selector) |
| appliesIf — **helper fn** | ❌ raw name + args text | **#8** pick from the project's real `contact-summary-extras` helpers + show the helper signature |
| **resolvedWhen** | ◑ `InsertFieldButton` only | **#8** bring to full real-data picker parity |
| **appliesToType** | ❌ raw text (`FORMS.X or ['form_name']`) | **#9** multi-select of the real project forms |
| actions — **form opened** | ✅ `<select>` of real forms | keep |
| actions — **modifyContent mappings** | ❌ raw text for both `targetField` + `sourceExpr` (`ActionsEditor.tsx:314,322`) | **NEW** target = `FieldPicker` on the **action's form**; source = `ReportFieldPicker` on the **triggering report** |
| task **`name`** | ❌ raw identifier (`new_task`) | **NEW** label-first + auto-slugify (per `decision_nocode_names_autoderived`) |
| task **`icon`** | ❌ raw text (`icon-task`) | **NEW** pick from the project's resources/icon set |
| task **`title` / `priorityLabel` / `contactLabel`** | ❌ raw (translation keys / `${}`) | **NEW** translation-key picker; `${}` refs via `FieldPicker` where they reference data |
| **all editors** | ❌ no error boundary; unstable selectors | **#10** error boundary + sweep every `useApp((s)=>…filter/map/{…})` selector |
| round-trip / raw fallback | ✅ byte-range edit (CLAUDE.md tasks invariant) | **maintain** |

## Consolidated order (depends-first)
1. **#7** — `ReportFieldPicker` crash (confirmed ~3-line fix). Unblocks the report side everywhere.
2. **#10** — error boundary + selector sweep. Cheap; stops a single throw white-screening the editor (and catches the rest of the #7 class).
3. **#9** — `appliesToType` multi-select of real forms (also scopes the report-field picker).
4. **modifyContent mapping pickers** (NEW) — target-form field + source-report field, no raw text.
5. **#8** — rule-builder real-data parity (helper-fn picker, `resolvedWhen`).
6. **Task `name`/`icon`/`title` pickers** (NEW) — `name` label-first; `icon` from resources; titles via translation-key/field pickers.

## Maintain (must not regress)
The CLAUDE.md tasks invariant: edits rebuild **only** the exported `module.exports`
array body via byte-range edit; imports/helpers outside stay byte-identical. Every new
picker must keep the **raw escape hatch** and round-trip byte-stable — exactly as the
form builder's visual builders do.

## Notes
- This is **applying validated patterns**, not net-new design — most of the components
  already exist (`FieldPicker`, `ReportFieldPicker`, the form-`<select>`); the work is
  wiring them into the remaining task surfaces + the naming/resilience principles.
- A short designer (Lal) pass on the task-`name` label-first interaction + the helper
  picker UX is worth it before build; the rest is mechanical.
