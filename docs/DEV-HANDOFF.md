# Developer Handoff — UI Builder for CHT

**Generated 2026-06-26 · HEAD `b0aceb7` (master) · working tree DIRTY (lineage WIP, see below)**

This consolidates four audits run against the live repo at HEAD. The audits are ground truth: where they say something is built, it is built — **do not rebuild it.** The lineage feature in particular is fully wired end-to-end (see "Done — don't redo"). I re-verified the highest-impact claims (tree state, empty dictionary dir, the Phase-0 one-liner, lineage import/mount) directly against the source.

## ▶ Do next (in order)

> **Refreshed 2026-06-28** after the `after_hierarchy_and_contacts` audit (HEAD `3126a01`). Items 1–4 of the 2026-06-26 list are **DONE** — lineage committed, LOINC/CIEL snapshotted, Phase-0 wired, contact-form generator shipped (`6d65502`). The §2 table and §3 detail below are from 2026-06-26 and **partly superseded**; trust `docs/reviews/after_hierarchy_and_contacts.md` where they conflict.

1. **Quick hierarchy creator** (NEW — greenlit 2026-06-28). Guided empty→deployable quick-start for the **empty** template: name your place levels (biggest→smallest) + the person at the bottom → scaffold the chain → **offer** to generate the contact forms. Full spec: **`docs/plans/quick-hierarchy-creator.md`**. Composes existing audited primitives (the hierarchy write path + the contact-form generator) — **no new parser surface**. Don't skip the §7 validation rules (slug-collision = block, never auto-suffix) or the §11 round-trip/idempotency tests. Watch the four headline risks: gate on *actually-parsed* empty `contact_types`; person leaf `parents:[last place]`; non-destructive re-run (only the 4 owned files); write nothing until final commit.
2. **Phase-1 UI wiring gap** (the one real open finding from the audit). In `FormEditor.tsx`, the **relevant / constraint / choice_filter** `ExpressionField` mounts (~1757 / 1777 / 1786) don't pass `inputContactFields` / `contextKeys` — only the `calculation` mount does. **Mirror that two-prop pass.** The parser layer is already complete + round-trip-safe (27 probes, 0 drift); this is the last mile so users can actually pick their project's cross-form keys. (`3126a01` also hid the "+ contact-summary" button when `contextKeys` is empty — it un-hides once wired.)
3. **Lint + `.gitattributes`** — lint RED (~90: mostly the `eslint.config.js` browser-globals gap + 17 real `no-useless-escape`); add `.gitattributes` (`*.json eol=lf`) so the 3 FHIR CRLF tests pass on a fresh clone; then re-add `pnpm lint` to CI.

Then work the remaining **P1/P2** queue below (FHIR B2/B3/H3, H2 e2e, helper-builder fixture, Phase 2b). Trust the audit over stale entries.

---

## 1. Start here

### Working-tree reality (do this FIRST)
The 06-26 handoff claimed a clean tree; it is **stale**. Current `git status --porcelain` shows the **hierarchy-block / lineage generator mid-landing**:

```
 M client/src/styles.css
 M client/src/ui/FormEditor.tsx
 M client/src/ui/QuestionTypeCatalog.ts
 M shared/src/index.ts
?? client/src/ui/LineageBuilder.tsx
?? shared/src/xlsform/buildHierarchyBlock.ts
?? shared/src/xlsform/buildHierarchyBlock.test.ts
?? client/vite.config.run.mjs   (throwaway run-only config — do NOT commit; see P2)
```

The lineage work is **complete and self-consistent** (typecheck + its 26-test suite pass). **Commit or stash it on a known base before doing the lint/CI cleanup** so those fixes land cleanly. `git add` everything except `vite.config.run.mjs`.

### Build + restart (unblocks the live app)
The last live session ran a **stale `dist/`** (pre-cache, pre-dictionary-route) — that's why Standard codes was ~8s and `/api/fhir/dictionary/*` 404'd. The code is committed and correct; just rebuild:

```sh
pnpm build          # shared → server → client (shared MUST build first)
pnpm dev            # restart in the "Project runner" terminal tab, NOT this session
```

### Dictionary snapshot (unblocks FHIR off-pack search — OPS, no code change)
`shared/src/fhir/dictionaries/` contains **only README.md** — zero JSON. The population *pipeline* shipped (commit `0ccf97d`) but **data was never snapshotted**, so every dictionary returns `available:false` and the picker shows "only a few codes."

```sh
pnpm --filter @cht-ui/shared build
node scripts/build-terminology-pack.mjs --systems=loinc,ciel   # free, no auth — works NOW
```
Then commit the produced JSON. **ICD-10/ICD-11** are blocked on free WHO API creds (`WHO_ICD11_CLIENT_ID` / `WHO_ICD11_CLIENT_SECRET`, register at icd.who.int/icdapi) **and** an open product decision: **WHO vs CM** ICD-10 variant — confirm with the MoH/clinical owner before snapshotting ICD.

---

## 2. Queue at a glance

| Item | Status | Pri | What | Where |
|---|---|---|---|---|
| Phase-0 PropertiesEditor → summaryFlags | ☐ open | P1 | Thread `contextKeys` so context-expr key picker validates `summary.<flag>` | form-data-passing.md §3 Phase 0; `PropertiesEditor.tsx:40`, `FormEditor.tsx:327` |
| FHIR B2 — dictionary radio a11y | ☐ open | P1 | Replace `<button class=active>` row with native radio fieldset | fhir-v1-triad-punchlist.md B2; `StandardCodesView.tsx:771-787` |
| FHIR B3 — status non-color cue | ☐ open | P1 | Add glyph to status chips + implement missing `row-status-*` CSS | fhir-v1-triad-punchlist.md B3; `StandardCodesView.tsx:855-866`, `styles.css` |
| FHIR H3 — orphans invisible | ☐ open | P1 | Render orphans in workbench + DecisionsView (MOH gate) | punchlist H3; `StandardCodesView.tsx`, `DecisionsView.tsx` |
| FHIR B1 — manual escape hatch | ◑ partial | P1 | Delete false docstring OR add "Custom code…" `source:'manual'` path | punchlist B1; `StandardCodesView.tsx:18` |
| FHIR H2 — 3 UX-contract e2e | ◑ partial | P1 | reload-survival, Skip, Change-from-suggested, coverage-header | punchlist H2; `client/tests/fhir-mapping.spec.ts` |
| FHIR dictionary data | ⚙ ops | P0 | Snapshot LOINC/CIEL now; WHO creds for ICD | fhir-pack-population.md (see §1) |
| Lint zero-warnings RED | ⚙ ops | P1 | 92 problems — eslint.config.js missing browser globals | (no plan); `eslint.config.js:19-25` |
| `pnpm lint` excluded from CI | ☐ open | P1 | Re-add lint step after globals fixed | `.github/workflows/ci.yml:41-47` |
| helper-builder.spec red | ☐ open | P1 | Mini-config lacks contact-summary fixture | `client/tests/fixtures/mini-config/`, `helper-builder.spec.ts` |
| e2e in CI partial | ◑ partial | P1 | Add demo.spec.ts now; helper-builder after fixture | `.github/workflows/ci.yml:49-91` |
| Lineage staleness badge | ◑ partial | P1 | Detection done in shared; wire UI badge | hierarchy-block-generator.md §5; `FormEditor.tsx` |
| B1-related — insert before trailing calcs | ◑ partial | P1 | Confirm first question lands before linking calculates | punchlist B1; `FormEditor.tsx:1262-1266` |
| FHIR shared CRLF test gate | ⚙ ops | P1 | 3 roundtrip tests fail — fixture has CRLF, serializer LF | `shared/src/fhir/__fixtures__/*.json` (add `.gitattributes`) |
| Phase 1a/b/c — conditions cross-form refs | ☐ open | P1/P2 | relevant/constraint can't gate on prior-report state | form-data-passing.md §3 Phase 1; `RelevantRuleBuilder.tsx`, `relevantParser.ts` |
| Phase 2a — tasks modifyContent mapping | ☐ open | P1 | Structured key:value content.<f>=report.<y> | form-data-passing.md §3 Phase 2; `actionsParser.ts`, `ActionsEditor.tsx` |
| Phase 2b — task source_id control | ☐ open | P2 | First-class source_id (currently raw-JS only) | form-data-passing.md §3 Phase 2; `actionsParser.ts:131-154` |
| FHIR H4 — per-dict helper text | ◑ partial | P2 | List done; add plain-language helper per dictionary | punchlist H4; `StandardCodesView.tsx:771-787` |
| Survey A5 — "Group these" wrap | ☐ open | P2 | Needs multi-select; ungroup already shipped | survey-groups-and-scaffold.md §A5; `FormEditor.tsx:979-981` |
| Scaffold round-trip test depth | ☐ open | P2 | Assert extras+labels (deepEqual), add byte smoke | punchlist M4; `scaffolds.test.ts:81-105` |
| Survey H3 — group drag affordance | ☐ open | P2 | Differentiate group handle + tooltip | punchlist H3; `FormEditor.tsx:1054-1062` |
| Lineage e2e | ◑ partial | P2 | Optional fixture-gated tile→modal→splice test | hierarchy-block-generator.md §7 (best-effort) |
| `vite.config.run.mjs` untracked | ☐ open | P2 | Delete, fold into vite.config.ts, or .gitignore | repo root |
| Targeted deploy §4 one-click | ◑ defer | P2 | convert→upload sequence endpoint | deploy-targeted-forms.md §4 (deferred per Decision 2) |
| Onboarding guardrails | ☐ open | P2 | **Keep the new-project picker as-is** (user); add Hierarchy-first guidance + Forms-tab empty-`contact_types` nudge + deploy-readiness checklist | onboarding-order.md; `ProjectOverview.tsx`, `DeployPanel.tsx` |
| Contact-form generator (offered) | ☐ open | P2 | Offer in Hierarchy editor: generate **minimal-valid** create/edit per type (skip-existing); closes the `AddTypeForm` dangling `create_form`/`edit_form` contract | contact-form-generator.md (Decision B); new `buildContactForm.ts` + `POST /api/forms/generate-contact` |

---

## 3. P0 / P1 / P2 work

### P0 — cheapest highest-value first

**[OPS] FHIR dictionary snapshot** — see §1. `node scripts/build-terminology-pack.mjs --systems=loinc,ciel`, commit JSON. This is what makes FHIR off-pack search actually return codes; without it B1 is resolved only "in principle."

### P1

**[~3 lines] Phase-0: wire `summaryFlags` into PropertiesEditor** — VERIFIED exact. The whole chain already exists: `ContextExpressionBuilder` accepts `summaryFlags?` (`ContextExpressionBuilder.tsx:26,35`) and renders the validating `<select>` only when `length > 0` (`:243`). `contextKeys` is already in scope at `FormEditor.tsx:119`. Missing link only:
1. Add `summaryFlags?: string[]` to PropertiesEditor `Props` (`PropertiesEditor.tsx:40-47`).
2. Pass it to the `<ContextExpressionBuilder>` mount (`PropertiesEditor.tsx:151-156`).
3. At `FormEditor.tsx:327` `<PropertiesEditor … />`, add `summaryFlags={contextKeys}`.
No parser change. See form-data-passing.md §3 Phase 0.

**[OPS] Lint config regression (92 problems: 82 err, 10 warn)** — root cause: `eslint.config.js:19-25` declares only Node globals; client `.tsx` get `no-undef` for `window/document/HTMLInputElement/KeyboardEvent/setTimeout/requestAnimationFrame/CSS`. This is why LineageBuilder.tsx carries dense `// eslint-disable-next-line no-undef`. Fix: add a client-scoped flat-config block with browser globals; add Node globals for `*.mjs/*.cjs` scripts; add `NodeJS` global (`cht-conf.ts:343,440`); auto-fix 17 `no-useless-escape` in `errorPatterns.ts`. Then strip the now-redundant disable comments. Also note `MODULE_TYPELESS_PACKAGE_JSON` warning on eslint.config.js.

**[after lint] Re-add `pnpm lint` to CI** — `.github/workflows/ci.yml:41-47` (commented out, "pending separate cleanup PR"). Re-enable once globals fixed.

**FHIR B2 — dictionary selector a11y** — still a `<button className={active?'active':'link'}>` row (`StandardCodesView.tsx:771-787`), color-only state. Replace with native `<input type="radio" name="fhir-dictionary">` in `<label class="kind-radio">` inside a `<fieldset>` with visually-hidden legend — **mirror `CalculationBuilder.tsx:491-504`** (the A2 fix). fhir-v1-triad-punchlist.md B2.

**FHIR B3 — suggested-vs-confirmed effectively color-only** — `row-status-{confirmed|suggested|skipped|unmapped}` classes are emitted (`StandardCodesView.tsx:444,610`) but have **NO CSS rule** (grep returns nothing). `statusLabel` (`:855-866`) is plain text, no glyph. Add glyph per chip (⏳ Suggested / ✓ Confirmed / — Skipped) + implement `row-status-*` CSS (per-status left-border accent readable in greyscale). Keep dashed/solid chip border as reinforcing channel. punchlist B3.

**FHIR H3 — orphans invisible** — route computes + returns them (e2e proves `mapping.orphans` populated, `fhir-mapping.spec.ts:235-246`) but workbench renders no orphans block and `DecisionsView.tsx` has zero fhir/orphan references. Unmet: §C5 "coverage + orphans same screen" + MVP §7 MOH gate "orphans logged in DecisionsView." Render an orphans section in workbench + surface in DecisionsView (MOH audit trail). If deferring past V1, record it so the gate isn't silently unmet. punchlist H3 + fhir-standard-codes-mvp.md §7.

**FHIR B1 — manual escape hatch (partial)** — off-pack search is wired (`searchFhirDictionary` at `StandardCodesView.tsx:733`, switch in `0ccf97d`) and empty state is actionable. But the promised "Custom code…" `source:'manual'` free-text path **does not exist**; only the **false docstring at `StandardCodesView.tsx:18`** claims it. Either delete the docstring OR implement the disclosure-gated affordance. (Search also yields nothing until dictionaries are vendored — see P0.) punchlist B1.

**FHIR H2 — 3 UX-contract e2e (partial)** — strong route-contract e2e exists; missing in `fhir-mapping.spec.ts`: (a) workbench Accept → `page.reload()` → still-confirmed; (b) a Skip test; (c) a Change-from-suggested test; (d) coverage-header increment-on-Accept assertion (`StandardCodesView.tsx:310-321`). punchlist H2.

**[OPS] FHIR CRLF test gate** — `pnpm --filter @cht-ui/shared test` reports `fail 3` (roundtrip #1/#3/#6). **Not a code regression**: fixture `shared/src/fhir/__fixtures__/mch-pregnancy.fhir-mapping.json` was checked out CRLF; serializer correctly emits LF; byte-equality diffs `\r\n` vs `\n`. There is **no `.gitattributes`** (verified). Fix: add `.gitattributes` pinning `*.json` (at least fixtures) to `text eol=lf`, `git add --renormalize .`, re-run. Fold in the vendored-dict `.gitattributes` from fhir-pack-population.md §Storage. All logic tests (zero-SNOMED oracle, reconcile, codec, coverage) pass.

**helper-builder.spec.ts red** — mini-config fixture lacks `contact-summary.templated.js` / `extras.js`; the spec's beforeEach can't resolve. Add a minimal `contact-summary.templated.js` (context object + a couple extras helpers) to `client/tests/fixtures/mini-config/`, then add the spec to CI's playwright invocation.

**e2e in CI partial** — `ci.yml:49-91` runs only `condition-builder` / `form-editing` / `fhir-mapping`. **Add `demo.spec.ts` now** (fresh-clone-safe, uses mini-config). Add helper-builder after the fixture lands.

**Lineage staleness badge (partial — UI last-mile)** — shared `detectStaleLineageBlocks` / `findLineageSignatures` / `parseLineageSignature` fully implemented; outermost begin-group stamped with `extras['cht-ui-lineage']`. **Confirm whether any FormEditor/Hierarchy UI consumes `detectStaleLineageBlocks`**; if not, wire the non-destructive "Lineage block built from an older hierarchy — re-sync?" badge + the "N forms embed a lineage block" count after a hierarchy save. hierarchy-block-generator.md §5 (promoted to v1).

**Survey B1-related (partial)** — `buildDisplayItems` is aware Default scaffolds end with linking calculates at depth 0 (`FormEditor.tsx:1262-1266`) and positional insert (A3) is the mechanism, but no test/guard pins that the first top-level question lands **before** the trailing calculates. Confirm via code trace or test; add an e2e if missing. punchlist B1.

**Phase 1 — condition cards can't reference cross-form/prior-report state** (3 linked items; the calc column already can — this is the asymmetry). Mirror the CalculationBuilder reference-kind approach. form-data-passing.md §3 Phase 1:
- **1a** `RelevantRuleBuilder.tsx:21-32` Props only takes `fieldOptions`; thread `contextKeys`/`inputContactFields` into it + its FieldPicker (`:373-400`). At `FormEditor.tsx:1876-1885` the relevant/constraint/choice_filter branch mounts it WITHOUT those props (the calc branch at `:1892-1893` has them — that's the asymmetry).
- **1b** `relevantParser.ts` Rule union (`:87`) has no contact-summary/inputs kinds; `instance('contact-summary')/context/X` round-trips only as opaque `RawRule`. Add `contact_summary_ref` + `contact_input_ref` kinds with parse/serialize + raw self-check fallback.
- **1c (P2)** Decide whether `conditionReducer.ts` (the shared chain engine, `ClauseOp` at `:46-57`) or RelevantRuleBuilder owns condition cards before threading. No `UnifiedConditionBuilder.tsx` exists.

**Phase 2a — tasks modifyContent structured mapping** — `actionsParser.ts` models modifyContent as only `passesVisitWindow:boolean` OR opaque `customModifyContent:string` (`:23-32,70-86`); arbitrary report-field→form-field mapping is raw JS only (`ActionsEditor.tsx:190-195`). Add a `{targetField, sourceExpr}[]` model + key:value UI in ActionCard, preserving raw fallback. form-data-passing.md §3 Phase 2.

### P2

- **Phase 2b — task `source_id`**: falls into verbatim `extras` (`actionsParser.ts:131-154`); add field + ActionCard control. form-data-passing.md §3 Phase 2.
- **FHIR H4 helper text**: enumerable list done; add one-line plain-language helper per dict ("LOINC — what was measured (observations)", "ICD — diagnoses/conditions"). `StandardCodesView.tsx:771-787`.
- **Survey A5 wrap ("Group these")**: needs a multi-select mechanism (none exists). Then reuse `handlePickerCommit` begin/end-pair insert. **Ungroup already shipped.** survey-groups-and-scaffold.md §A5.
- **Scaffold test depth (M4)**: `scaffolds.test.ts:81-105` asserts only type+name; strengthen to deepEqual on extras+labels + add serialize→parse→serialize byte smoke.
- **Survey H3 group drag handle**: bare `⋮⋮` identical to leaf (`FormEditor.tsx:1054-1062`); differentiate + `title="Drag to move the whole group as one unit"` + update toolbar hint.
- **Lineage e2e (optional)**: fixture-gated Playwright — pick 🌳 tile → set depth → Insert → assert balanced spliced block + Full-mode reveal. hierarchy-block-generator.md §7 (best-effort per spec).
- **`vite.config.run.mjs`**: throwaway, untracked, header says "safe to delete, not meant to be committed" (only adds `watch.ignored` for `shared/dist`). Delete, fold the fix into `vite.config.ts`, or `.gitignore` it. **Do NOT commit as-is.**
- **Targeted deploy §4** (deferred per Decision 2): one-click convert→upload sequence endpoint carrying per-action `extraArgs`. Leave as follow-up.

---

## 4. Done — don't redo (cite commits)

### LINEAGE — fully wired end-to-end (NOT "last-mile")
The audit explicitly corrects the premise: **the wiring IS complete.** Don't rebuild any of:
- **Shared codegen** — `shared/src/xlsform/buildHierarchyBlock.ts` (456 lines): `buildHierarchyBlock`, `computeLineageChain`, `lineageSignature`, `findLineageSignatures`, `parseLineageSignature`, `detectStaleLineageBlocks`. Exported via `shared/src/index.ts:8`. **26 tests pass** (`buildHierarchyBlock.test.ts`).
- **Modal** — `client/src/ui/LineageBuilder.tsx` (377 lines): leaf picker, depth input (defaults full chain), live preview ladder, Advanced per-level name/phone toggles, multi-parent warnings, Esc-close, focus mgmt.
- **Tile** — `QuestionTypeCatalog.ts:289-304` (id `lineage_block`, 🌳, `__lineage_block__`, hidden in Simple).
- **Rendered** — `FormEditor.tsx:1152-1185` mounts `<LineageBuilder>` (import `:79`).
- **Picker interception + insert-index capture** — `handlePickerCommit` `FormEditor.tsx:721-727` (captures `lineageInsertIndex` before clearing — the documented gotcha).
- **Hydration** — `useEffect` `FormEditor.tsx:649-673` lazily fetches `api.getHierarchy()`.
- **Commit-splice** — `handleLineageCommit` `FormEditor.tsx:838-906`: positional splice, single atomic `patch()` (undo = one op), Simple→Full flip, force-expand inputs+contact, `onRequestReveal`, single Undo toast.

Only **partial** lineage items: the staleness *UI badge* (detection done, surface maybe unwired — P1 above) and an optional e2e (P2). Variant A (app/report forms) shipped per Decision §8.7; **Variant B (contact-edit) is intentionally DEFERRED** per plan.

### FHIR — done
- **B3a code legibility (P0, user-confirmed "can't read codes")** — fixed across `40d33b6`, `c7cb635`, `43d6fd0`, `749bc7b`. High-contrast per-state text (`.code-chip.confirmed #065f46`, `.suggested #92400e`), inner `<code>` neutralized, `.picker-result code` forced dark+bold, all ≥4.5:1 with inline WCAG-AA notes (`styles.css:412-474`).
- **H1 ICD-10 raw-URL** — `systemLabel` (`StandardCodesView.tsx:874-896`) matches WHO + hl7 ICD-10/-cm, ICD-11, CIEL; falls back to "Other code system" not a bare URL.
- **Parse perf cache** — `5315a35`. `server/src/parsedFormCache.ts` (keyed by absPath+mtime+size, deep-frozen, `invalidate()`) + 8-case test; warm `GET /api/fhir-mapping` **8420ms→4ms** on config-nssd (69 forms).
- **Dictionary pipeline infra** — `0ccf97d`. `scripts/build-terminology-pack.mjs` + `terminology-pack/{loinc,who-icd,ciel,util}.mjs`, `shared/src/fhir/dictionary.ts`, `snomedFilter.ts`, server `GET /api/fhir/dictionary/search` + `/list` w/ lazy load + mtime cache, picker switched to server search. **(Data not yet snapshotted — P0.)**

### Survey editor + scaffold — done
- **A1** balanced begin/end pair (`spliceSurvey`, e2e `form-editing.spec.ts:302`), **A2** nested collapsible groups, **A3** positional insert, **A4** reorder integrity (`shared/src/xlsform/surveyEdits.ts`, 17 tests), **A6** save-time balance guard + **H2 name-agreement hardening** (`structuralBalance.ts` new `mismatched-name` kind `:42`).
- **B1 cold-start blocker** — group-aware classifier (`types.ts:194-234`) so fresh Default form opens genuinely empty + positive empty-state.
- **Ungroup** shipped (`planUngroup`, e2e `:399`); **wrap** deferred (A5).
- **New-form scaffold** — `scaffolds.ts` (inputs/user/contact + 4 linking calculates; contact-type scaffold; blank-form radio in `FormsIndex.tsx:108-136`).
- **H3 jump-to-row** — fully wired (`StructuralIssuesBadge` buttons → `onJumpToRow` → reveal/flash, e2e `form-editing.spec.ts:498`).

### Form-data-passing — done (authoring + calc-column reads)
- contact-summary context keys defined + readable in **calculation** (`contactSummaryParser.ts`, `useContactSummaryContextKeys.ts`, CalculationBuilder `contact-summary` kind).
- `../inputs/contact/<field>` readable in **calculation** (CalculationBuilder `contact-input` kind). *(Not in condition cards — that's Phase 1a.)*
- tasks.js authoring (`TasksEditor.tsx`, `ActionsEditor.tsx`, `actionsParser.ts` with verbatim extras). *(modifyContent mapping + source_id = open Phase 2.)*

### Deploy/infra — done
- **Targeted form deploy** — `1813fa0` + `d1575c0`: form picker (convert/upload app+contact), default-all checklist, command preview, `extraArgs` threading (`api.ts`, `DeployPanel.tsx`).
- **Git-changed detection** — `d1575c0`: `GET /api/forms/changed` via `git status --porcelain -- forms/` (`forms.ts:195/231/254`, tests `forms.changed.test.ts`, win32 `shell:true`).
- **Deploy creds fixes** — `957a98b` (embed `user:password@host` for `--url`), `e065fec` (cht-conf `3.18.3`→`^6.4.1`).

### Gates (current)
- **typecheck** ✅ shared/client/server all clean.
- **shared build** ✅ clean.
- **shared tests** — survey/lineage suites all pass (buildHierarchyBlock 26, surveyEdits 17, structuralBalance, scaffolds); **only** failures are the 3 FHIR CRLF roundtrip tests (ops, §3).
- **lint** ⚙ RED (92 problems — config regression, §3).

---

## 5. Plan-doc index (`docs/plans/`)

| Doc | Covers |
|---|---|
| `fhir-v1-triad-punchlist.md` | FHIR B1/B2/B3/B3a, H1-H4 (audited `d22d08e`, now stale — see audit deltas) |
| `fhir-pack-population.md` | Dictionary snapshot pipeline, WHO creds, `.gitattributes`/repo-size, storage |
| `fhir-standard-codes-mvp.md` | FHIR MVP scope, §7 MOH gate, §4.10 idempotence tests, Decision 2 (ICD variant) |
| `hierarchy-block-generator.md` | Lineage §2/§3A/§4 (modal+wiring)/§5 (staleness, v1)/§7 (gate+e2e), §8.7 Variant decisions |
| `survey-groups-and-scaffold.md` | Survey §A1-A6 group authoring, §B1-B3 new-form scaffold |
| `form-data-passing.md` | §3 Phase 0 (PropertiesEditor), Phase 1 (conditions cross-form), Phase 2 (tasks data hand-off) |
| `deploy-targeted-forms.md` | Targeted deploy §1-3 (done), §4 one-click (deferred), §45 smoke-test |
| `perf-parse-cache.md` | Parse cache (plan `43d2701`, impl `5315a35`) — done |

**Note:** the survey punch list (`punchlist`/`fhir-v1-triad-punchlist.md`) is mostly accurate but predates several commits — trust the audit deltas over the doc where they conflict (e.g. H1/B3a/perf-cache are done despite older doc state).
