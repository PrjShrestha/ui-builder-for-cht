# Developer Handoff — UI Builder for CHT

**Generated 2026-06-26 · HEAD `b0aceb7` (master) · working tree DIRTY (lineage WIP, see below)**

This consolidates four audits run against the live repo at HEAD. The audits are ground truth: where they say something is built, it is built — **do not rebuild it.** The lineage feature in particular is fully wired end-to-end (see "Done — don't redo"). I re-verified the highest-impact claims (tree state, empty dictionary dir, the Phase-0 one-liner, lineage import/mount) directly against the source.

## ▶ Do next (in order)

### 🔥 CURRENT TOP PRIORITY — 2026-07-29 — field notes from the live Geriatric + ANC build

A health-post officer is building the **real** Geriatric-care + ANC use case in the tool and filed 6 improvement notes. These are field blockers hit **today**, so they jump **ahead of the roadmap tiers below**. Key result: notes 3/5/6 have their hard half **already shipped** — fix the small gap, don't rebuild.

- **▶ Execute from:** **`docs/handoff-waves-1-3-2026-07-29.md`** — the consolidated wave-organized design + dev plan (all 3 waves, meant to be handed off together; shipped-foundations-to-reuse box up top; Wave 1 review fixes folded in).
- **Grounding reference:** `docs/handoff-improvement-notes-2026-07-29.md` — note-by-note evidence + PO/Designer/QA triad + the Wave 1 WIP review addendum.

**⚡ STATUS 2026-07-30 — all 3 waves SHIPPED (`0dbbe6c` / `c0c71a8` / `deb6fd4` / `e4fbab1`) and audited. Gates green (573/573 shared tests, typecheck, client build; lint red — 7 net-new + pre-existing config debt). ▶ NOW EXECUTE THE FIX QUEUE: `docs/reviews/waves-1-3-audit-2026-07-30.md`.**

**⚡ STATUS 2026-07-30 (pm) — fix-queue P0 1–3 + P1 4–8 verified DONE in working-tree WIP (all gates green, 580/580 shared tests). ① COMMIT that WIP now (one commit; exclude `cht-district-form.png`). ② Then the PO-scoped follow-up batch: fix-queue items 9, 10, 11, 13, 15** (items 12 + 14 deferred — see the scope-decision block in the audit doc, which also resolves the two open decisions in 15: unhide `begin_repeat` + offer it from the `+ Section` entry; restore 409 for explicit-basename duplicates while the title path keeps auto-suffixing).

**⛔ STATUS 2026-08-05 (late) — P0 fixes `30c3d92` verified: P0-1 CLOSED · P0-3 CLOSED · P0-2 PARTIAL. STILL NO-GO for a real config, now for PRE-EXISTING reasons.** Full verification (4 parallel audits, every claim reproduced against compiled HEAD): **`docs/reviews/p0-verification-30c3d92-2026-08-05.md`**. All process claims verified TRUE (push real via live `ls-remote`; shared 610/610, server 72/72, typecheck, client build, geriatric e2e 2/2 hermetic; 4 of 7 new tests genuinely fail against a transpiled `3fa6d39` build, so the pin is real). Two corrections: the push was **7** commits, and **CI's e2e job will go RED** — CI's exact 11-spec command gives 8 failed / 38 passed, deterministic, pre-existing, NOT from `30c3d92`.

**Why still NO-GO — two PRE-EXISTING classes in `appliesIfParser.ts`, untouched by either commit, that corrupt the tool's OWN templates and real configs on a zero-edit open+Save:** ① **statement/declaration loss** — only guards + one final `return` are representable; every `const`/`let`/loop/`else-if`/comment is dropped, and the whole-body raw fallback (`:344`) only fires when *nothing* classified. **Measured on the 4 real Nepal configs: 31 helpers, ZERO byte-stable, 19 → ReferenceError, 9 → silent meaning flips** (gandaki + moh-province `getDOB` collapses to its last branch → wrong DOB for every contact with `date_of_birth`). Reachable via Contact Summary → Helpers → "✎ edit body" → Save, **while the UI says "nothing is dropped"** (`AppliesIfBuilder.tsx:206-208`). ② **argument-discarding rewrites** — `isAlive(contact)` → `isAlive(contact.contact)` (`:513-519` discards args, `:788-797` hardcodes them); breaks `server/templates/malaria/tasks.js` (guard flips from never-fires to fires-for-dead-contacts) and ReferenceErrors cht-default helper bodies. Exposure on disk is **zero** — latent, not realized.

**NEXT P0 BATCH (data-safety): ① parenthesize the `:777` return-join (`parenFor` was applied at `:763`/`:765` but not here — fail-open, one click deep) · ② change the `:344` fallback gate to "any unclassified statement present" → refuse to structure instead of dropping · ③ record real call args on the 4 well-known kinds · ④ gate HelpersTab to losslessly-round-trippable bodies + delete the false "nothing is dropped" copy + diff on save · ⑤ pin the latent grouped-raw invariant, make `:760` respect `fromGuard` · ⑥ fix Decisions/MOH view + raw row to render guard-origin polarity (the sign-off surface currently states the inverse).** Then P1 as queued (selected()/contains closes the last GAP; the e2e that pins wrong semantics; CI server-test step; local-env e2e triage — accepted; 3rd RelevantRuleBuilder mount). Buildability unchanged: 55 OK / 30 FRICTION / 1 GAP.

**⛔ STATUS 2026-08-05 (pm) — geriatric blocker batch `3fa6d39` audited: DO NOT point this build at a real config, and land the P0s BEFORE pushing.** Full re-audit: **`docs/reviews/geriatric-reaudit-2026-08-05.md`**. Verdict still NO (55 OK / 30 FRICTION / 1 GAP — net +1); §2 media images CLOSED cleanly, §3 OR authoring shipped correctly (**and the dev's correction of the planner's §3 spec was right — handoff corrected in place**), §1 dropdowns well built but flip 0 rows (each carried a second blocker). **The batch introduces a NEW silent config-corrupting regression** — guard-origin raw conditions are inverted on a no-op open+save (`appliesIfParser.ts:281-284`/`:713`: `guardGroup === undefined` used as the "not guard-origin" proxy), valid JS so compile can't catch it, **fail-OPEN**, reachable with zero edits, and green tests missed it because the guard-origin-raw test never calls the serializer. Exposure on this machine is **zero** (all four config repos clean) — no re-check campaign needed. **P0s: ① record guard origin explicitly + serializer-exercising round-trip tests per guard shape · ② parenthesize the OR/guard join operands (`:733`) · ③ duplicate media-upload DOM id → `useRef` (`FormEditor.tsx:2486`/`:2497`).** Then P1: `selected()`/`contains` for `select_multiple` (closes the last GAP, Task R8), fix the e2e that pins wrong semantics, wire `fieldChoiceOptions` into the 3rd RelevantRuleBuilder mount, add both geriatric specs to CI + push. Gate numbers verified exactly as claimed (shared 603/603, server 72/72); the "15 e2e fail, environmental" framing is overstated and CI has never run this batch (5 commits unpushed).

**⚡ STATUS 2026-08-05 — both fix batches SHIPPED (`4ffa82d` P0 1–3 + P1 4–8, `cc76328` items 9/10/11/13/15). QA then audited the full geriatric use case for no-code buildability: verdict NO-narrowly (86 rows: 54 OK / 31 friction / 1 gap) — `docs/reviews/geriatric-nocode-buildability-2026-08-05.md`. ▶ NEXT (PO-greenlit): the 3-item batch in `docs/handoff-geriatric-blockers-2026-08-05.md`** — ① choice-value dropdowns in AppliesIfBuilder + RelevantRuleBuilder (flips 26 rows), ② display-image support (media column + upload route), ③ OR authoring in appliesIf. Then QA re-audit (expected YES) + the Playwright geriatric builder-as-driver spec.

The earlier 9/10/11/13/15 batch, one-line each (SHIPPED in `cc76328`; full detail in the audit doc §P2):
- **9** — lowercase both `existing` sets so a case-only filename collision (`Patient_Age.xlsx` vs "patient age") doesn't dead-end in a 409 on Windows.
- **10** — age save-gate: block *invalid* (non-`isValidNumberLiteral`) values too, not just empty — `1e5` currently saves then demotes to raw on reload.
- **11** — strengthen the "byte-identical" nested-groups test to a real cell-matrix compare (use the in-file `readSheetHeaders`/`readSheetRows`).
- **13** — ReportFieldPicker controlled mode: don't stick in free-text when `s.forms` is empty on first paint; show a visible "form/field no longer exists" state instead of a blank select.
- **15** — small UX set: collision hint prints the colliding *slug* (not the typed title); unhide `begin_repeat` + offer it from `+ Section`; 409 for explicit-basename duplicates (title path keeps suffixing); deep-link `subView` navigates even when the editor is already mounted; fix the misleading `contextValuesParser.test.ts:112` title. Three P0s first: ① Wave-3 bridge emits `Utils.*` which doesn't exist in the contact-summary runtime → ReferenceError kills the whole `context` on device (emit a self-contained `reports` scan); ② create-form slugify strips hyphens → manual `<type>-create.xlsx` contact forms impossible (preserve `-` for contact category); ③ contact-summary save is tab-gated → context edits silently dropped when saving from another tab (`contextDirty` flag). Two spec errors are owned + corrected in the audit doc (5b placement — dev was right; 6's `Utils`-style wording — wrong runtime). Notes 4 & 5 are clean — don't churn them.

**Wave 1 — ship together this week (all cheap, high-impact):**
1. **[BLOCKER, ~1 line] Unhide the Group tile.** The `begin_group` tile exists and auto-pairs `begin`/`end` correctly — it's just `hiddenInSimple:true` (`QuestionTypeCatalog.ts:335`) and Simple is the default mode (`FormEditor.tsx:498`), so a no-code user never sees "Add group." Remove the flag (or relax the Simple filter at `QuestionTypePicker.tsx:117`). Insert machinery (`FormEditor.tsx:822-851`) unchanged. **Real forms are unbuildable without this.**
2. **[BUG, silent corrupter] Numeric condition input can't clear "0".** `ContextExpressionBuilder.tsx:361-366` (age_years row) coerces `Number('')===0` on keystroke. Mirror the already-fixed `contact_field` string-value pattern (`:410-443`). Every age/threshold condition is silently wrong until fixed.
3. **[deploy trap] New-form title → slugify.** Create flow *rejects* non-identifier input instead of slugifying (`FormsIndex.tsx:59`, `forms.ts:325`); scaffold uses basename as both `form_id` and `form_title` (`scaffolds.ts:169-170`). Collect a human title, derive `form_id` via `slugifyHierarchyId` (`buildLinearHierarchy.ts:108`), keep the title as `form_title`. Same family as the greenlit question-name autoderive + rename-macro (below).

**Wave 2:** section-authoring UX (proper `+ Add section` flow) → inline EN/NE labels + an "Add language" control (no add-locale UI exists today) → label insert-field / "insert contact field" button. **Wave 3:** cross-form "Context values" builder (pull latest value from another form via the contact-summary bridge — the calc-side picker is already wired; the contact-summary population is raw-JS-only today).

**MUST-HAVE round-trip regressions:** nested-group byte-stability (Wave 1 #1 / Wave 2), add-locale column-append (Wave 2), contact-summary `context`-only rewrite (Wave 3).

---

> **Refreshed 2026-06-28** (twice). The quick hierarchy creator (`b4d837b`) and the Phase-1 UI wiring gap (`be8279f`) are now **DONE**. The 2026-06-26 list's items 1–4 are also done (lineage, LOINC/CIEL, Phase-0, contact-form generator `6d65502`). The §2 table and §3 detail below are from 2026-06-26 and **partly superseded**; trust `docs/reviews/after_hierarchy_and_contacts.md` where they conflict. Two new contact-form bugs found in the pregnancy POC review (full spec: **`docs/handoff-contact-form-bugs-2026-06-28.md`**).

1. **[BUG, functional] Contact-form generator `created_by*` off-by-one XPath.** `shared/src/xlsform/buildContactForm.ts` meta calculates emit `../../inputs/user/...` but the field sits at `/data/<type>/meta/...` — needs **`../../../inputs/user/...`** (cht-default uses 3 hops for the identical nesting). As-is, every generated contact gets **empty** `created_by*` / `last_edited_by*` (silent audit-trail gap). Fix the 5 paths + add a `node --test` asserting the emitted calc strings. See bug doc §A.
2. **[BUG, display footgun] Editor classifies bare `string` as "Select contact".** `QuestionTypeCatalog.ts` — the Text tile is `xlsformType:'text'`, so a `string` row matches only `select_contact`/`mrdt_verify` and `findTileForRowType` falls through to `select_contact`. Affects **every `string` field in every form**; cosmetic but a footgun (re-picking the tile would stamp a `select-contact` appearance onto a text field). Make a bare `string` (no select-contact/mrdt appearance) classify as **Text**. See bug doc §B.
3. **[BUG+UX] Form-context "Contact type" selector.** Full spec: **`docs/handoff-form-context-types-2026-06-28.md`**. The "who sees this form" builder (`ContextExpressionBuilder`) is hardcoded to legacy types (`person`/`clinic`/…) and emits **`contact.type === 'x'`** — **wrong for configurable hierarchies** (custom types live under `contact_type`, so the form is gated to **never appear**; likely already biting `pregnancy_registration`'s `true && contact.type === 'person'`). Wire the project's real `contact_types` into the builder, let users scope to a specific person type (e.g. `patient`), and emit `contact.contact_type` for configurable types (round-trip in shared).
4. **[UX] Hierarchy-editor polish (4 PO items).** Full spec: **`docs/handoff-hierarchy-ux-2026-06-28.md`**. (a) move "+ Type" into the tree pane header; (b) **consistency fix** — the "+ Type" modal should auto-slugify a friendly name to the id + show a note (like the Quick Hierarchy Creator already does) instead of dead-ending on "invalid id"; (c) surface person types via a "People" / "Places" two-section tree (not by re-sorting the indented tree — confirm with planner); (d) relabel "Person type (vs place)" → clear Person/Place choice, and show "Count visits" **only for places** with clearer copy (it's a real `count_visits` CHT setting, just meaningless on persons).
5. **[UX, user-reported] Choices tab — can't rename a choice list.** The list heading is static text (`FormEditor.tsx:2893`, `<h3>{g.list_name}</h3>`) — no rename control, so a list name can only be changed from the per-question inline editor. Add a rename affordance to the Choices-tab list header mirroring `InlineChoicesEditor.commitRename` (`InlineChoicesEditor.tsx:91–118`): use `renameListInType` (preserves trailing tokens like `or_other`) and rewrite **both** every survey row binding the list (its `type` cell) **and** every `ChoiceRow.list_name === old`. Confirm dialog; round-trip safe (reuses the shared helper). (Per-choice `name`/`label` editing already works — this is only the list rename.)
6. **Lint + `.gitattributes`** — lint RED (~90: mostly the `eslint.config.js` browser-globals gap + 17 real `no-useless-escape`); add `.gitattributes` (`*.json eol=lf`) so the 3 FHIR CRLF tests pass on a fresh clone; then re-add `pnpm lint` to CI.
7. **`client/vite.config.run.mjs`** — throwaway local run config, intentionally uncommitted; delete / fold into `vite.config.ts` / `.gitignore` (P2).

Then work the remaining **P1/P2** queue below (FHIR B2/B3/H3, H2 e2e, helper-builder fixture, Phase 2b). Trust the audit over stale entries.

### ⚡ Update — 2026-06-28 (pm)
Dev shipped **#1–#4 + `.gitattributes`**: contact-form `created_by*` path (`f0f0e20`), `string`→Text mislabel (`d627f8b`), form-context contact-type picker (`7ff6f04`), hierarchy-editor UX 4-pack (`cdb36b0`), `.gitattributes` (`d927251`). Doc backlog committed (`f6d710b`).

**Remaining / new (in order):**

- **⚠ [BUG, deploy-blocker — DO FIRST] Templates missing `targets.js`.** `server/templates/{empty,blank,malaria}/` ship `tasks.js` but **not** `targets.js`, so every project created from them fails `cht compile-app-settings` with *"Missing required declarative configuration file(s): targets.js"* (only `cht-default` ships it). Confirmed live on a `poc-test` build. **Fix:** add a minimal `targets.js` (`module.exports = [];` + a one-line comment that cht-conf requires the file and the UI doesn't edit targets in v0.1) to those three template dirs. **Optional:** have the DeployPanel readiness checklist (`525c649`) flag a missing `targets.js`/`tasks.js` pre-deploy so it's caught in-app. Does NOT reintroduce a targets editor — just makes the scaffold deployable (the empty→deployable gap).

  - **Generalize (PO directive 2026-06-28): every template ships minimal-valid versions of ALL files a standard cht-conf compile+upload pipeline requires — not just the ones with editors.** Audit of `server/templates/`: `empty`/`blank`/`malaria` are missing **`targets.js`** (hard blocker, above) AND **`resources.json`** (read by `cht upload-resources`; minimal `{}`). `tasks.js` / `contact-summary.templated.js` / `.eslintrc` / `app_settings/base_settings.json` are present in all four. **Durable fix:** add a CI/test guard that runs `cht compile-app-settings` (and a dry `upload-*` if feasible) against **each** template dir, so a missing-required-file regression can never ship — that empirically pins the required set rather than us guessing. "Out of scope to edit" (targets) ≠ "optional to ship".

  - **STATUS (dev, 2026-06-28):** hard-required set DONE — `targets.js` shipped to all templates (`cef326f`); the deploy hard-fail (`.eslintrc` / `base_settings.json` / `tasks.js` / `targets.js`) is fully satisfied. `resources.json` is **soft** (upload-resources warns/skips, not a gate) — ship minimal `{}` only if it actually warns.
  - **Planner call (2026-06-28): of the template-readiness items, do ONLY the CI guard above.** Dropped/deferred as low-value (don't build unless asked): `package.json` + cht-conf dep in templates (warn-only noise), `resources.json` stub (soft — upload skips), and the "validate scaffold on open" feature (templates now ship the required files). Lint cleanup stays deferred tech debt.

1. **[REVISION of `cdb36b0`] Nest person types in the unified place tree.** PO decision (2026-06-28): **drop** the "People (n)" / "Places (n)" two-section split and render **one tree** where each person type shows as a leaf **under its parent place** (`hf_officer`→`health_facility`, `fchv`→`fchv_area`, `patient`→`household`) so place-context is visible. Keep the 👤/🏠 icons; list a parent's **person-children first**, then its child place. `buildTree` (`HierarchyEditor.tsx:412–433`) already nests by `parents[0]` — this is mostly removing the section wrapper `cdb36b0` added + a sibling sort. **Supersedes** `handoff-hierarchy-ux-2026-06-28.md` §3.
2. **Choices-tab list rename** (#5 above) — still open.
3. **Lint** — `.gitattributes` done (`d927251`); the eslint browser-globals fix + re-adding `pnpm lint` to CI still open.
4. **`client/vite.config.run.mjs`** cleanup — still open.

---

### ⚡ Update — pyxform names & refs (2026-06-28, evening) — CURRENT do-next

Deploy hit pyxform on `pregnancy_registration.xlsx`: a `relevant` referenced a `name` that wasn't a valid XLSForm identifier (spaces/punctuation) plus a hand-written `${…}`. Dev shipped the immediate fix (rewrote the form — 7 names slugified, 1 ref rewritten, labels filled) + a `NameInput` edit-time warn/"Fix → slug" guard. **Planner direction: make naming automatic, not reactive.**

1. **[GREENLIT — next] Rename + rewrite-all-refs macro.** Required to make the "Fix → slug" button (and any name change) safe: renaming a row's `name` must rewrite **every** `${old}` reference across the form — `relevant` / `constraint` / `calculation` / `choice_filter` / repeat-count / `${}`-in-labels. Same shape as the choices-tab list rename (`a361624`). Without it, fixing a name silently breaks references (the dev's own stated limitation).
2. **[durable, recommended] Auto-derive `name` from the label on question CREATE.** The no-code "autoformed" fix: user types the human question text (label); the tool slugifies a valid `name` automatically (shown as a muted "saved as `…`", editable only as advanced), reusing `slugifyHierarchyId` — same pattern as Quick Hierarchy Creator / Add-Type. **Derive on create only**; do NOT auto-rename on later label edits (that would break refs — it routes through macro #1). Auto-suffix on collision (names are internal). Stops invalid identifiers at the source so a no-code user never touches an identifier. (Wants a short plan/triad pass before build — reshapes the editor's primary interaction.)
3. **Confirm refs are picker-only for no-code.** The visual relevant/calc/constraint builders already insert `${name}` via FieldPicker — ensure the no-code path never requires hand-typing `${}` (raw is advanced-only).

4. **[BUG class — generator fixes don't reach existing forms] Contact-form generator is skip-not-overwrite, so `f0f0e20`'s path fix never reached forms generated BEFORE it.** Confirmed on `poc-test`: `upload-contact-forms` validation fails on district/ward/health_facility/fchv_area/household/patient (old two-hop `../../inputs/...`) while `fchv`/`hf_officer` (generated post-fix) pass. The generator is correct now; the *old forms are permanently stale* because re-generating skips them. **Fix:** add a **regenerate / overwrite-existing** mode to the generator (clear confirm + a which-files diff, since it overwrites user-editable forms) so generator fixes can be applied to existing projects. (Distinct from the dropped template-readiness items.)

5. **[BUG, submit-time — HIGH] Generated person-create forms have a `_id_placement` field → CouchDB rejects on submit.** Runtime error in CHT: *`doc_validation: "Bad special document member: _id_placement"`* (a leading-underscore field name is a reserved CouchDB member). `buildContactForm.ts` emits a user-facing select-contact field named **`_id_placement`** ("Place this person under") for person+create. It's **non-standard AND unnecessary** — CHT places a contact from navigation context (the place you're under when you tap "+ New person") via the hidden `parent` field the generator already emits; cht-default person-create has **no** user-facing "place under" selector. **Fix: remove the `_id_placement` field** from the generator (align person-create with cht-default context placement). Affects ALL person-create forms; **passes cht-conf static validation, fails only at submit** (so static tests won't catch it — add a guard that no generated field name starts with `_`). Immediate no-code workaround: delete the "Place this person under" question from each person-create form in the survey editor + redeploy.

6. **[BUG, HIGH] Person contact types never get `create_form`/`edit_form` → can't be created in CHT (no "+").** Both creation paths omit them for persons: `AddTypeForm` writes them **only when `!isPerson`** (`HierarchyEditor.tsx:664–666`), and the Quick Hierarchy Creator's person leaf (`buildLinearHierarchy.ts:285+`, `personRow`) builds without them (places in the loop at `:275–276` get them). Confirmed on `poc-test`: `patient` had no `create_form`, so CHT showed **no "+ New patient" under household** even though `patient.parents=[household]` and the form files exist. cht-default's `person` type HAS both — they're required for a type to be creatable. **Fix: write `create_form`/`edit_form` for person types too in both paths** (same `form:contact:<id>:create|edit` shape as places). (The Hierarchy detail editor also doesn't expose these fields, so a user can't add them by hand — only fixable in config today.)

7. **[BUG — CONFIRMED, fix ready] AppliesIf "report field" row = infinite render loop.** Stack trace: *"getSnapshot should be cached … Maximum update depth exceeded"* at `ReportFieldPicker.tsx:25`. **Root cause:** the selector `useApp((s) => s.forms.filter(...).map(...))` returns a NEW array every render, so `useSyncExternalStore`'s `getSnapshot` is never stable → infinite loop. **Fix:** select the stable slice then `useMemo` the derived list (`useMemo` already imported): `const forms = useApp((s) => s.forms); const allAppForms = useMemo(() => forms.filter(f => f.category === 'app').map(f => f.filename.replace(/\.xlsx$/i, '')), [forms]);`. **Follow-up:** grep other `useApp((s) => …filter/map/{…})` selectors building a new array/object inline — same crash class. Add a regression test (mount appliesIf builder with a report_field row → no throw). — Original triage: Repro: Tasks → open a task's `appliesIf` rule builder → **"+ report field"** (and/or pick a field). Path: `AppliesIfBuilder.tsx` report_field case → `ReportFieldPicker.tsx` → `useReportFormFields.ts`. The picker/hook look defensive (try/catch, `?? []`; `appliesToType` is parsed to `string[]` at `TasksEditor.tsx:266`), so the throw isn't obvious statically — **grab the console stack trace on repro to pin it**. Suspects to check: `extractFields` does `r.type.trim()` on rows that may lack `type` (caught, but verify), and `ReportFieldPicker`'s `useApp((s) => s.forms.filter().map())` returns a **new array every render** (Zustand selector identity → possible render thrash). Add a guard + a regression test (open builder → add report_field → no throw).
8. **[FEATURE] Rule builders should pick real contacts/reports + operate on their fields, form-builder-style.** Applies to both `RelevantRuleBuilder` and `AppliesIfBuilder`. The pieces exist — contact fields via `FieldPicker` (real contact forms), report fields via `ReportFieldPicker` (real app-form fields) — but the PO wants a **consistent, complete experience like the form builder**: pick one of *your* reports/contacts → pick a field from it → operator → value, no hand-typing. Make it uniform across both builders, sourced from the project's real contact types + app forms, with the raw-text path as advanced-only. (Depends on #7 — the report path must not crash first.)

9. **[FEATURE] `appliesToType` should be a multi-select of the project's forms, not raw text.** Today `TasksEditor.tsx:332–334` renders `appliesToType` as a raw array-text input. Make it a **multi-select dropdown of the project's app forms** (and consider contact types — tasks can apply to contacts), building the JS array for the user; keep a raw-text fallback for advanced syntax (`FORMS.x`, `'report'`, `'contacts'`). Reuse `parseAppliesToType` (already raw→`string[]`, `useReportFormFields.ts:109`) + the app-forms list from the store. **Synergy:** `appliesToType` is what scopes the report-field picker (#7/#8) — a correct selection feeds those the right forms. Round-trip: preserve any unrepresentable raw verbatim.

10. **[RESILIENCE, HIGH] No React error boundary anywhere — a single component crash white-screens the whole editor.** Confirmed: zero `ErrorBoundary`/`componentDidCatch`/`getDerivedStateFromError` in `client/src`. #7's render loop took down the **entire app** (blank screen, session lost), and React's own console message recommends adding one. **Fix:** add an error boundary around the main view/router (and ideally around the rule-builder modals + each editor panel) that catches a render throw and shows a localized, recoverable message ("This panel hit an error — reload / go back") instead of unmounting everything. General safety net independent of #7 — turns "I lost my whole session" into "one panel glitched."

▶ **Task-builder parity initiative** — items **#7–#10 above + two NEW gaps** (modifyContent mapping **pickers** instead of raw text in `ActionsEditor`; task **`name`/`icon`/`title` pickers** — `name` label-first, `icon` from resources) are consolidated, with the form-builder patterns + a depends-first order, in **`docs/plans/task-builder-parity.md`**. Net goal: bring the Tasks editor to **form-builder no-code parity** — pick real data, never hand-type ids/`${}`, visual+raw, validate inline, round-trip-safe, crash-resilient. Most components already exist (`FieldPicker`, `ReportFieldPicker`, the form `<select>`); the work is wiring them into the remaining task surfaces.

This supersedes the stale lists above: nest-persons (`27e25fb`), choices-rename (`a361624`), vite cleanup are **shipped**; lint deferred.

---

## 🗺 Roadmap — trust & visibility (planner-greenlit, 2026-06-28)

From the product assessment (`docs/reviews/product-assessment-2026-06-28.md`). **Tier 0 + Tier 1 greenlit; Tier 2 = cards editor + translations only (NOT targets/dashboards, PO 2026-06-28); Tier 3 parked.** **Build order (PO 2026-06-28): ① event date-anchor picker (DO FIRST) → ② Tier 0 → ③ Tier 2 → ④ Tier 1. Tier 3 parked.**

### ▶▶ DO FIRST (PO priority, 2026-06-28) — Task scheduling: event date-anchor picker

**[NEW — build before Tier 0, PO priority] Event date-anchor picker.** Today the Tasks → Events builder only offers `days` measured from the report's `reported_date`, so any schedule anchored to a *report date field* (e.g. LMP) drops to the Raw JS `dueDate`. Add, per event, an **anchor** control = `reported_date` **or** a **report date field** (picked from the `appliesToType` form's date questions, e.g. `lmp_date`), an **offset** in **days or weeks**, plus the existing `start`/`end` window. Generate the correct `dueDate` (e.g. `addDays(<lmpField>, weeks*7)`) so LMP-anchored multi-touchpoint schedules — e.g. the **ANC 8-visit task** (`docs/guides/anc-8-touchpoint-task.md`) — become **fully no-code**. **Full spec + eventsParser contract: `docs/plans/event-date-anchor.md`.** Reuse the field-picker scoping already wired for appliesIf/events (`appliesToType`); keep the Raw JS fallback + the existing Insert-field helper; round-trip safe (parse/serialize the generated `dueDate`; any unrecognized `dueDate` stays raw). *(Deploy-trust Tier 0 below remains high-priority — do it right after.)*

### Tier 0 — make it impossible to build something that won't deploy (highest leverage)
- **[NEW] Authoring-time preflight validator.** In-app "Ready to deploy?" panel that runs cht-conf's *hard gates* before the user ever runs cht-conf: required files present (the template-requirements set), XLSForm `name`s are valid identifiers, XPath refs resolve (the `../../` vs `../../../` class + dangling `${}`), every `select_*` has a non-empty choices list, form_id conventions. Green/red per check + **one-click fixes** (reuse slugify / the meta-path fix / generator-overwrite). Run on Deploy-panel open (optionally on project open). **Share the check logic with the per-template CI compile guard** — one source of truth. Converts the deploy-time stack traces we hit this session into edit-time checkmarks.
- **[NEW] Own the deploy pipeline end-to-end.** compile → convert → upload as one flow with progress + the existing friendly-error translator + deep-links to the failing item's fix. A non-coder should never see a raw cht-conf trace.
- **Generator refresh/overwrite + repair** — already queued above (skip-not-overwrite item).
- **Naming autoderive + rename-macro** — already queued above (pyxform names/refs items).

### Tier 1 — let people SEE it (biggest gap vs CommCare/Kobo) — BUILD 4TH (after Tier 2) — both want a plan/triad pass first
- **[NEW] Live form preview.** Embed enketo-core (or CHT's form renderer) so the current form renders with live skip/validation/calc. Needs on-demand xls→xml (or reuse the converted `.xml`). README scoped it as ~2 sprints — **plan doc first.**
- **[NEW] Workflow simulator (highest upside).** Sandbox: user enters a sample contact + sample report(s) → sees the contact-summary (context flags + cards) compute, which app forms become available (`context.expression` eval), which tasks fire (`appliesIf`/events), which targets increment. A mini CHT rules harness over synthetic docs. Neither CommCare nor Kobo simulates care-continuity logic — a leapfrog. **Plan doc first.**

### Tier 2 — selected coverage gaps (PO: these two only) — BUILD 3RD (before Tier 1)
- **[NEW] Contact-summary cards/fields editor.** Visual editor for `cards[]` + `fields[]` (today preserved verbatim, no editor). Scope light/hybrid: labels, `appliesToType`, static field lists, reorder; **raw fallback** for imperative `fields: function(){}` cards. Wants a plan pass (real cards are imperative JS — see the cht-default pregnancy card).
- **[NEW] Translations editor.** View/edit `messages-*.properties` + the keys tasks/cards/targets/summaries reference — key × locale grid with missing-translation highlighting (extend the Forms→Translate pattern to the `.properties` files). Non-destructive: preserve unknown keys verbatim.
- ~~Targets / dashboard editor~~ — **not now** (PO 2026-06-28). `targets.js` still ships as a stub (deploy requirement) but gets no editor.

### Tier 3 — PARKED
Review→approve→deploy sign-off flow; guided program recipes; hosted/multi-user mode.

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
