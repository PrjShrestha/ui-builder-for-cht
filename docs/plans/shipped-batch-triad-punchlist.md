<!--
Triad + conformance audit of the shipped batch: calc Tier 1.5 (4362567), survey groups A1-A6
(6b0530e..6263c29), and the new-form scaffold (4fdd26f).
Source: planner workflow wf_d5887c8b-763 (2026-06-15), 6 agents — adversarial plan-vs-code per area
+ PO/PM + Designer + QA. Audited at HEAD 4fdd26f. Gates pre-verified green (225 shared tests,
typecheck clean, smoke YES). Planner-owned; developer-ready.
-->

# Punch list — shipped batch (Tier 1.5 + survey groups + scaffold)

**Date:** 2026-06-15 · **Audited SHA:** `4fdd26f` · **Status:** developer-ready.

## Verdict
**Conformant and byte-safe; not "done" by the triad gate.** Every area is faithfully built and the
round-trip invariant holds everywhere (no corruption on any path; the original lone-`begin group` bug
is fixed and pinned with an on-disk regression test). Blocking the "done" call: **2 blockers** — a
PO/PM cold-start failure on new forms, and a missing §A4 reorder/ungroup test set — plus a calc
re-hydration deviation, a latent validator-hardening gap, and a Designer a11y/discoverability batch.

---

## 🔴 Blockers

### B1 — New Default app form looks broken on first paint *(PO/PM `blocker` — signature abandonment trigger)*
A freshly-created Default app form opens in **Simple mode showing exactly ONE row**: a `string` named
`_id`, labeled "Patient ID", `select-contact type-person`. The other 15 scaffold rows are hidden, with
the grey note *"15 plumbing rows hidden."* To a non-coder this reads as *"the create button half-failed,"*
not *"scaffolding is ready."* That's Bhishan's exact abandonment trigger — and it's a direct collision
between Part B (seeds an `_id` string row in `inputs/contact`) and Simple mode (shows `string` rows).
- **Root cause:** `isHiddenInSimpleMode` exempts only `calculate` rows inside `inputs`, so the `_id`
  `string` leaks into Simple ([types.ts:176-231](../../shared/src/xlsform/types.ts#L176-L231)).
- **Fix:** treat **any** row inside the `inputs` group as plumbing/hidden in Simple (regardless of
  type), so a new Default form opens genuinely empty; and replace the "N plumbing rows hidden" note
  ([FormEditor.tsx:764-768](../../client/src/ui/FormEditor.tsx#L764-L768)) with a **positive
  scaffolding empty-state**: *"Your form is ready — the standard patient-linking setup is in place
  (view it in Full mode). Add your first question →."*
- **Related (HIGH):** on a Default form, **"+ Question" appends to the very end** — after the hidden
  trailing linking calculates ([FormEditor.tsx:492-537](../../client/src/ui/FormEditor.tsx#L492-L537)),
  so the first question silently lands behind invisible plumbing. Insert top-level questions **before**
  the trailing calculates, or give the empty Simple view a correctly-positioned "add your first
  question" target (the positional-insert mechanism already exists).

### B2 — §A4 reorder + A5 ungroup operations are untested *(QA `blocker`)*
Group-as-unit move, boundary-split rejection, and ungroup are **real shipped mutating paths with zero
unit AND zero e2e coverage** — they live as un-exported helpers (`findMatchingEndIndex`,
`moveSurveySlice`, `ungroup`) inside FormEditor. The only safety net is the save-time balance backstop,
which prevents on-disk corruption but does **not** verify the move *behaves* as specified. The plan's
Test-plan explicitly required this set.
- **Fix:** extract `findMatchingEndIndex` / `moveSurveySlice` (+ the predicted-violation decision) into
  a shared pure module and unit-test: (a) a begin-group drag moves the whole `begin..end` slice intact;
  (b) a leaf drag that would split a pair is rejected (survey unchanged); (c) drop-inside-own-span is
  refused; (d) ungroup keeps children at parent depth + refuses on no-matching-end. Add ≥1 Playwright
  drag e2e (group-as-unit + a rejected boundary split) and an ungroup e2e. (Anchors: onDragEnd
  [FormEditor.tsx:415-474](../../client/src/ui/FormEditor.tsx#L415-L474), ungroup :671-689.)

---

## 🟠 High

### H1 — Calc Tier 1.5: wrapped reference doesn't re-hydrate into the picker *(conformance `deviates`)*
Byte-safety holds (no corruption), but the plan's explicit promise — *"a wrapped reference reopens in
the Reference sub-mode even if the shared parser calls it raw"* — is **unmet**. `initialModeFor`
([CalculationBuilder.tsx:74-81](../../client/src/ui/CalculationBuilder.tsx#L74-L81)) routes by
`parseCalculation`'s *shape*, so `if(ref,ref,.)` (shape `decision_table`) opens in the If-then table and
spaced variants open in Raw — the `recognizeReference` recognizer lives **inside** `SingleValuePanel`
and never fires. Also `CONTACT_SUMMARY_ONCE_RE` ([calcReference.ts:69-70](../../shared/src/xlsform/calcReference.ts#L69-L70))
has no internal-whitespace tolerance, so `once( ref )` falls through to the `expression` kind.
- **Fix:** have `initialModeFor` consult `recognizeReference` **before** falling back to shape, so a
  recognized reference (any wrapper) opens in Single → Reference; widen the `once`/wrapper regexes to
  tolerate internal spacing.

### H2 — Balance validator matches by kind, not name (latent A6 gap) *(adversarial)*
`findStructuralViolations` pairs `begin`/`end` by **kind** (group vs repeat), never by **name**, so
`[begin group B][begin group A][end group B][end group A]` is reported balanced (0 violations) and would
save — yet pyxform pairs by name and rejects it. **Not reachable through today's mutation set** (group
drags move as units; end rows aren't independently draggable), so A6 holds in practice now — but any
future "insert raw row," paste, or import-merge path that places a bare begin/end slips past A6.
- **Fix (cheap hardening):** make the validator (or the save guard) enforce **name agreement** on the
  matched begin/end pair. ([structuralBalance.ts](../../shared/src/xlsform/structuralBalance.ts).)

### H3 — Designer a11y/discoverability batch
- **Save-block detail — ✅ DONE + one follow-up.** The badge is now a real `<button>` + popover
  listing every issue with ARIA/Escape/outside-click ([FormEditor.tsx:340-421](../../client/src/ui/FormEditor.tsx#L340-L421)) —
  the original hover-only/first-issue-only gap is closed. **Remaining (user-requested): make each
  listed issue clickable → jump to the offending row.** Each `StructuralViolation` already carries
  `rowId`/`index` ([structuralBalance.ts:31-44](../../shared/src/xlsform/structuralBalance.ts#L31-L44)). Wire:
  (1) render each popover `<li>` as a `<button class="link" onClick={() => onJumpToRow(v.rowId)}>` and
  close the popover on click;
  (2) add an `onJumpToRow` prop — FormEditor lifts the survey `mode` state out of `SurveyTab` (or adds a
  `revealRowId`), and on jump forces **Full mode** (structural rows are hidden in Simple) + sets
  `revealRowId`;
  (3) tag the row containers with a DOM anchor — `data-row-id={row.rowId}` on the `.survey-row` root
  ([:1251](../../client/src/ui/FormEditor.tsx#L1251)) AND on the `.survey-group-accordion` root
  ([~:1135](../../client/src/ui/FormEditor.tsx#L1135)) so begin-group violations are reachable;
  (4) `SurveyTab` `useEffect([revealRowId, mode])`: after the Full-mode re-render commits (rAF/timeout),
  `document.querySelector('[data-row-id="…"]')?.scrollIntoView({block:'center'})`, add a transient
  `.row-flash` class (a brief outline/bg pulse keyframe in styles.css), move focus to the row, clear
  `revealRowId`; no-op gracefully if the element isn't found (an unbalanced survey may render oddly).
  e2e: open the popover on an unbalanced survey, click an issue, assert Full mode + the row got
  `.row-flash` / received focus.
- **Group-as-unit drag is invisible.** The group drag handle is the same bare `⋮⋮` as a leaf row with
  no visible label/tooltip ([FormEditor.tsx:1054-1062](../../client/src/ui/FormEditor.tsx#L1054-L1062));
  the toolbar hint never says groups move as a unit. Mode-error trap (move 1 row vs 12). Differentiate
  the handle + add `title="Drag to move the whole group as one unit"` + update the hint.

### H4 — PO/PM vocabulary on the calc reference picker
- Kind labels "Contact input field" vs "Contact-summary value" are implementer vocab — Bhishan
  couldn't tell which yields "the patient's ID." Relabel toward intent + add a one-line helper under
  each radio (mirror the ExpressionField friendly-label + raw-tag pattern). ([CalculationBuilder.tsx:609-624](../../client/src/ui/CalculationBuilder.tsx#L609-L624).)
- Wrapper options ("Read once", "Use my current answer if empty") are opaque with no help/example.
  Add a `❔` tooltip per option + surface the plain-language `Result:` readback next to the wrapper.

---

## 🟡 Medium / Low
- **M1 — deep-nest legibility:** depth is one cumulative 2px grey rule per level; the `depth-${n}` class
  has no CSS (dead hook). Add a per-depth color ramp or a depth chip in the group header. ([styles.css:1180-1185](../../client/src/styles.css#L1180-L1185).)
- **M2 — SingleValuePanel radiogroup semantics:** the kind radios lack their own `<fieldset>`/`<legend>`,
  so SR announces the long descriptive paragraph as the group name; `TypedOutputInput` does it right —
  match it ([CalculationBuilder.tsx:461-479](../../client/src/ui/CalculationBuilder.tsx#L461-L479)).
- **M3 — mode tabs are ARIA tabs in name only:** `role=tab` with no `tabpanel`/`aria-controls`/arrow-key
  ([CalculationBuilder.tsx:299-313](../../client/src/ui/CalculationBuilder.tsx#L299-L313)) — either
  implement the full tab pattern or downgrade to a button group (carryover from the prior punch list).
- **M4 — scaffold round-trip test is structural, not byte-level:** asserts only `type`+`name`, so a
  dropped `relevant`/`appearance`/`calculation`/`default` on the scaffold would pass
  ([scaffolds.test.ts:81-105](../../shared/src/xlsform/scaffolds.test.ts#L81-L105)). Strengthen to
  byte/deepEqual on extras+labels. Add an automated scaffold smoke (serialize→parse→serialize byte-id).
- **M5 — blocked-drop feedback:** the only signal on a refused drag is a red error toast after the fact;
  phrase as protective ("Kept the form balanced — a group can't go inside itself") and suppress the
  self-drop toast.
- **L1 — `NO_LABEL` convention:** scaffold structural groups emit empty labels, not the canonical
  `NO_LABEL` the plan §A1/§B1 calls for ([scaffolds.ts:36-42](../../shared/src/xlsform/scaffolds.ts#L36-L42));
  structural rows also still render an editable label input that has no meaning.
- **L2 — contact scaffold non-canonical:** `style:pages` + bare `form_id` applied to contact forms
  (canonical uses no style + namespaced `contact:person:create`); contact placeholder `c80_household-create`
  exposes the filename convention and may freeze a non-coder.
- **L3 — comment drift:** CalculationBuilder header comment still claims a store-boundary save-time
  self-check that doesn't exist (the guard is parse-time). Fix the comment.

## Still deferred (from the survey-groups plan)
- **A5 "Group these" wrap** — honestly deferred (needs a multi-select mechanism). Pair it with the
  existing ungroup when multi-select lands; reuse the `handlePickerCommit` begin/end pair insert.

## Praise — do not regress
PO/PM: nested-group legibility (indent + border + "N rows inside" header summary) and the "Blank form"
discoverability + scaffold microcopy in FormsIndex are exemplary. Designer: the calc kind picker's
native-radio keyboard a11y (punch-list A2) is done correctly — keep it as the house pattern. QA: the
balance validator units, the A1 on-disk regression, the calc per-idiom byte-stability + the real
`diabetes_referral` fixture, and the clean A5-wrap deferral all over-deliver.
