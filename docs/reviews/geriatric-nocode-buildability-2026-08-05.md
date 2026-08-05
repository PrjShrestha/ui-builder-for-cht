<!--
QA (Lorena persona) audit: can the Geriatric-care use case (Geriatric care use case
XLS.xlsx — Form Overview + Task 18 rows + Integrated Health Assessment 52 rows +
Referral Follow-up 16 rows) be FULLY built no-code? Run against committed HEAD 9520942
(includes both fix-queue batches 4ffa82d + cc76328). 2026-08-05.
-->

# QA audit — Geriatric use case: fully buildable no-code?

**VERDICT: NO — not *fully* no-code by the strict bar (zero hand-typed identifiers/`${}`/JS). 86 spec rows: ~54 OK · ~31 FRICTION · 1 hard GAP.**
The two forms are ~93% clean-picker buildable and the entire 18-task sheet is *structurally* buildable in the tasks editor — what keeps this a NO is **narrow and fixable**: choice-value dropdowns missing in two rule-builder modals, one impossible row (display image), and OR-authoring in the task condition builder. With gap-list items 1–3 fixed, this flips to **YES**.

Verdict basis: committed HEAD `9520942` (both fix batches included). No dependence on uncommitted code.

## What lands OK (the strong majority)
- **All 28 select rows** (EN/NE labels + choices, required) → tile picker + per-locale inputs + inline choices with auto-derived names.
- **Every relevance chain in the spec** — single-select gates, section hides, multi-field or/and referral triggers (R9/R15/R20/R30/R35/R39), even the "any except X" shapes → the in-form UnifiedConditionBuilder, whose **choice-value dropdown** makes these genuinely zero-typing. Standout affordance.
- **`{Person_Name}` in labels** → insert-contact-field button (auto harvest calc).
- **Task structure ×18** — trigger form (picker), window 15/30/15 days (event editor), resolution "follow-up form submitted" (picker), action opens follow-up (dropdown): fully picker-driven.
- **Cross-form BMI/BP/sugar pulls** — the full loop exists (Context-values bridge → "From another form" calc → label insert) — works, but many-stepped (FRICTION, not GAP).

## Gap list (feeds the next dev batch)

**Blockers (the only true "can't do it no-code"):**
1. **No display-image support** (IHA R11, instructional illustration). No `media::image` column surfaced in the row editor, no media-file upload route. Fix: media column in the FormEditor row card + server upload to `<form>-media/`.
2. **Choice values are hand-typed in the two rule-builder modals.** `AppliesIfBuilder.tsx:360` (report-field value = bare input → hits **all 18 tasks**) and `RelevantRuleBuilder.tsx` comparison/contact-summary values (hits RF R8–R15 cross-form relevance). `ReportFieldPicker` already knows the source form — feed it the same choice dropdown `FormEditor.tsx:3147` uses.

**Friction:**
3. **No OR-authoring in the visual appliesIf builder** (Task R4–R8: "either option failed"). AND-only today; `guardGroups` round-trips existing `if(A||B)` but can't author it. Workaround: hidden calc flag in the form. Fix in `AppliesIfBuilder.tsx` + `appliesIfParser.ts`.
4. **No "close/end form" primitive** (consent-decline, RF R16). Workaround: relevance-wrap remaining sections. Fix: a "stop unless…" macro writing group relevance.
5. **Calculate tile hidden in Simple mode** (`QuestionTypeCatalog.ts:314`) — every cross-form pull forces the Advanced toggle.
6. **Cross-form assembly is many-stepped** — ~7 bridges for the RF linkage + if-then tables for the "which is high/normal" texts; all in-tool, far from one gesture. Assumes HTN/DM screening forms exist in the same project.
7. **Task titles are typed translation keys** (`TasksEditor.tsx:558`; slugify button mitigates).
8. **RelevantRuleBuilder modal lacks grouped mixed and/or** (uses flat `parseRelevant`; `parseRelevantGrouped` exists unused). Not strictly needed by this spec.

**Cosmetic:**
9. **No text-styling presets** for the spec's Medic color-codes/bold (~9 notes/hints) — requires hand-typed markdown/HTML.
10. **Form icon is a typed id** — no icon-bank picker (`PropertiesEditor.tsx`). Overlaps squad-scope gap B (icons/resources editor, see july16 synthesis addendum).

**Not exercised by this spec:** `begin_repeat`, per-question role visibility, targets.js.

## Row-by-row coverage (compressed)
- **Form Overview:** IHA title/context (age≥60) OK · icon FRICTION (typed id) · follow-up task-only lock OK.
- **IHA (52):** 28 selects OK · 9 notes+relevance OK · 6 multi-field referral notes OK · R48 OK (spec semantics ambiguous) · R2 person-name OK · R1 consent FRICTION (no end-form) · R3 cross-form pulls FRICTION (many-stepped, Advanced mode) · R11 image **GAP** · R52 n/a · styling on ~9 rows cosmetic-gap.
- **Referral Follow-up (16):** R3–R7 OK · R1/R2 FRICTION (bridges) · R8–R15 FRICTION ×8 (cross-form relevance works but value is free-typed — blocker #2) · R16 FRICTION (end-form).
- **Task (18):** structure fully OK · condition value typed on all 18 (blocker #2) · R4–R8 need OR (friction #3) · title keys typed (friction #7).

## Recommended next dev batch (pending PO greenlight)
1. Blocker #2 — choice-value dropdowns in AppliesIfBuilder + RelevantRuleBuilder (one pattern, two modals; flips 26 FRICTION rows to OK).
2. Blocker #1 — display-image (media column + upload).
3. Friction #3 — OR in appliesIf.
Then re-run this audit; expected verdict YES(-with-frictions). The Playwright "build the geriatric app end-to-end" spec (builder-as-driver, mirroring `anc-build-deploy.spec.ts`) becomes the durable regression once the blockers land.
