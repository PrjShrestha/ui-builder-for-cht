<!--
Planner conformance audit — milestone review after the hierarchy + contacts work.
Produced by adversarially-verified multi-agent audits (workflows wf_edc5700f-f5d +
wf_18c1d1f6-10d), grounded against the planner-locked plan docs and the shipped
cht-default templates. 2026-06-27.
-->

# Review: after hierarchy & contacts

**Date:** 2026-06-27 · **Audited HEAD:** `3126a01` (in sync with `origin/master`)
· **Method:** grounded review → adversarial re-verification, per commit, against the
locked plan docs + the round-trip invariants in `CLAUDE.md`. Two audit passes
(`wf_edc5700f-f5d`, `wf_18c1d1f6-10d`).

## TL;DR
The session's work is **real and round-trip-safe** — the dev's invariant discipline
held up under adversarial probing (27 probes against the new condition parser, 0
drift; tasks.js byte-range edits intact; custom logic never dropped). Everything I
scoped this session (onboarding guardrails, contact-form generator, FHIR B2/B3/H3,
LOINC snapshot, Phase-0 wiring) conforms to the locked decisions, **including the
hard "keep the new-project picker as-is" constraint.**

Two corrections to relay:
1. **Phase 1 cross-form refs are parser-complete but NOT wired into the UI** — the
   one genuine, still-open gap (small fix). "Phase 1a complete" is overstated.
2. **The `form_id` `form:`-prefix flag was a false alarm** — the dev is correct;
   my own plan doc prose (`contact-form-generator.md` §3 #5) was imprecise.

## Build health (current HEAD `3126a01`)
| Gate | State | Note |
|---|---|---|
| Typecheck (`pnpm typecheck`) | ✅ **GREEN** | Was 5 client errors at `97b2452`; fixed in the Phase-1 commits. |
| Shared build | ✅ GREEN | |
| Shared tests | **333 / 336** | The only 3 fails are FHIR round-trip fixtures — **CRLF, not logic** (`\n` vs `\r\n`). A clean LF checkout is 336/336. |
| Lint (`pnpm lint`, zero-warnings) | ❌ **RED — 90 problems** (80 err / 10 warn) | Unchanged baseline; deferred tech debt. ~60 are an eslint-config `globals` gap (`no-undef` on browser globals), 17 are real `no-useless-escape`. |

**Flag to dev:** "typecheck clean" + "tests all green" are both true *on a properly
configured checkout*, but a fresh `git clone` with `core.autocrlf=true` and no
`.gitattributes` gets **3 red tests**. The deferred `.gitattributes` (`*.json eol=lf`
for the FHIR fixtures) is a ~3-line fix that unblocks green-on-clone — worth promoting
out of "tech debt".

## Per-area conformance

### ✅ Onboarding guardrails — `525c649` (conforms)
- **`NewProjectWizard.tsx` UNTOUCHED** (empty diff) — the user's hard constraint
  (keep the blank/cht-default picker as-is) is honored.
- Forms-tab empty-`contact_types` nudge, ProjectOverview hierarchy-first cue, and
  DeployPanel readiness checklist all present and **non-blocking** ("guide, don't
  gate" — no form-building or deploy buttons disabled). Matches `onboarding-order.md`
  §5/§6/§7.

### ✅ Contact-form generator — `6d65502` (conforms, minimal-valid Decision B)
- Minimal-valid (person-create 19 rows / place-create 17 — not the 48–69 faithful
  clone), doc group named for the type, single `select-contact` placement
  (**variant-B nested-chain explicitly guarded by test**), required name, person-only
  required sex, `meta.created_by*`.
- **Skip-not-overwrite** enforced; **does NOT call `maintainFormConstants`**; new
  batch route `POST /api/forms/generate-contact` with no false snapshot-undo; offered
  via Hierarchy-editor modal, never auto-on-save; edit forms carry `read_only` on
  hydrated rows. Pure/deterministic; 12 tests.
- **`form_id` convention — SETTLED, dev is correct** (see below). Choices are
  English-only in v1 with a documented v1.1 TODO to load all 7 locales — acceptable
  for the minimal spec, noted.

### ✅ Phase-0 wiring + FHIR B2/B3/H3 — `b022787`/`29466ea`/`32eb331`/`62ac97c` (conforms)
- Phase-0: `summaryFlags` threaded **and consumed** in `ContextExpressionBuilder`;
  raw-text fallback preserved (invariant intact).
- B2 native radio fieldset (a11y); B3 non-color glyph cue; H3 orphans visible in both
  Workbench and DecisionsView (MOH gate). Picker code-contrast rule present.

### ✅ LOINC snapshot + P1 round-up + lineage — `21efc9f`/`97b2452`/`1534c65` (conforms)
- LOINC dictionary committed (4498 codes, ~790 KB), loaded from disk, **zero runtime
  API** — consistent with the free-codes-only FHIR decision.
- P1: B1 docstring corrected, `defaultInsertIndex` lifted to shared + 5 tests,
  helper-builder fixture added. Lineage fully committed end-to-end; working tree clean.

### ⚠️ Phase 1a/1b cross-form refs — `908ddd9` (mostly-conforms — **one real gap**)
- **Round-trip safety: bulletproof.** The 2 new rule kinds
  (`ContactInputComparisonRule`, `ContactSummaryComparisonRule`) are purely additive,
  fully fenced by the pre-existing self-check, and round-trip byte-for-byte. **27
  adversarial probes** (functions on LHS, foreign instances, nested paths, odd
  spacing, embedded operators) produced **zero drift**. 13 new tests + 25 existing all
  pass.
- **THE GAP (HIGH, verified, still present at HEAD):** the feature is parser-complete
  but **not wired into the UI**. In `FormEditor.tsx`, the **relevant / constraint /
  choice_filter** `ExpressionField` mounts (~lines 1757 / 1777 / 1786) **never pass
  `inputContactFields` / `contextKeys`** — only the `calculation` mount does (and that
  opens `CalculationBuilder`, not `RelevantRuleBuilder`). Consequences in the live UI:
  - the contact-input picker shows only **6 hardcoded fallback fields**, not the
    project's real contact fields;
  - the contact-summary context-key list is **always empty**;
  - **compounded by `3126a01`**, which hid the "+ contact-summary" button when
    `contextKeys` is empty → contact-summary referencing is now **hidden entirely** in
    these three builders.
- **Verdict:** "asymmetry close" / "Phase 1a complete" is **overstated**. The
  cross-form data never flows into the condition builders. **Fix is small** — mirror
  the `calculation` mount's two-prop pass at the other three mounts.

### ✅ Phase 2a structured modifyContent — `558bf5f` (mostly-conforms; one self-fixed defect)
- **Critical invariants hold:** edits rebuild only the exported array body via
  byte-range edit (imports/helpers outside `module.exports` stay byte-identical); any
  modifyContent the structured UI doesn't understand falls back to raw and is
  **preserved verbatim** — no custom logic dropped (verified with an
  `if`+`Object.entries`+`forEach` probe). The reject-list errs toward raw (correct
  failure direction).
- New `modifyContentMappings` model, three-way `ActionsEditor` UI, 15 tests — all
  confirmed exactly.
- **One genuine defect at `558bf5f`, since FIXED in `3126a01`:** when a body *was*
  lifted to the structured model, the serializer inflated the arg list
  (`function (content)` → `function (content, contact, report, event)`) — a
  byte-stability violation (BUG #7). `3126a01`'s `modifyContentArgs` resolves it
  (verified byte-stable after). Residual: lifted bodies still get re-indented to
  canonical spacing — by-design and semantically lossless; only affects the editor's
  own in-array content.

### ⏳ Adversarial fixes — `3126a01` (NOT cleanly audited)
The agent auditing this commit hit the structured-output retry cap and returned no
verdict. **Indirectly corroborated** by the other two agents: BUG #7's `modifyContentArgs`
fix, the string-aware tokenizer fixes (#2/#3/#4 — quoted content no longer
mis-tokenized), and the contact-summary-button hide were all confirmed. The full
"7 HIGH fixed / 5 mediums rejected-with-reasons" claim is **not independently
verified** — recommend a targeted re-run to close it.

## `form_id` convention — resolved (dev is correct)
Verified **two independent ways** (raw XLSX cell extraction *and* `parseXlsForm`)
against the shipped cht-default templates:
- `settings.form_id` = `contact:person:create` — **no** `form:` prefix
  (also `contact:person:edit`, `contact:PLACE_TYPE:create|edit`; XForm root ids match).
- `contact_types[].create_form` = `form:contact:person:create` — **with** prefix
  (all four place/person types).

They differ by the prefix **by design** — CHT stores the uploaded form doc under
`_id = form:<form_id>`, so the reference carries `form:` and the form's own id does
not. The generator reproduces this split exactly. The earlier "drift" flag was a
**false positive**; **the doc prose in `contact-form-generator.md` §3 #5 is what's
imprecise** (it implies the two strings should match verbatim). → Fix the plan prose.

## Open items / decisions for the planner
- **CIEL dictionary (OCL paywall, HTTP 403):** recommend **defer** — consistent with
  the locked free-codes-only FHIR decision. (OpenMRS public release is a possible free
  swap later; a paid OCL token contradicts the stance.)
- **Lint cleanup + `.gitattributes` + re-enable CI lint:** the one deliberately-skipped
  "Do next". Split it — `.gitattributes` is a quick green-on-clone win; the lint is
  mostly an eslint-config `globals` fix (~60 of 80) + 17 real `no-useless-escape`.
- **Phase-1 UI wiring gap (above):** new dev to-do — pass `inputContactFields` /
  `contextKeys` to the relevant/constraint/choice_filter `ExpressionField` mounts.
- **Variant-B contact-edit blocks / Phase 1c (conditionReducer ownership):**
  deferred-per-plan, consistent. No action.

## Follow-ups I can do on request
- Re-run the `3126a01` audit to close the gap.
- Fix the `form_id` prose in `contact-form-generator.md` §3 #5.
- Log the Phase-1 UI wiring gap into `DEV-HANDOFF.md` so the dev picks it up.
