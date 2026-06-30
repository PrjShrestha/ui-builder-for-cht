<!--
QA handoff: a Playwright e2e that rebuilds the `poc-test` project from scratch
through the UI (empty -> deployable), asserts the output is deploy-valid (encoding
the bugs we hit as regression guards), AND captures a watchable demo of the run.
Planner-authored 2026-06-28. Owner: QA (Lorena).
-->

# QA handoff — "build poc-test" e2e + demo capture

**Goal:** automate the exact flow a user did by hand — **new project → hierarchy →
contact forms → (app form) → deploy-valid output** — as a Playwright e2e, with
assertions that would have caught this session's bugs, **and produce a demo recording
of the run** (the PO wants a watchable artifact of the tool building a project end to
end).

## A. Setup
- New spec: `client/tests/poc-build.spec.ts` (run via `pnpm --filter @cht-ui/client test:e2e`).
- Build the project into a **temp folder** (OS temp dir); remove it in `afterAll`. Never target a real project path.
- **Pre-req:** `shared` is built and client+server are running (e2e harness). ⚠️ A stale `shared/dist` would test the *old* generator — rebuild shared first (`pnpm --filter @cht-ui/shared build`).

## B. UI walkthrough (mirror the manual build)
1. **New project → "Empty"** template. *(Click it explicitly — the picker defaults to "Blank".)*
2. **Location:** temp parent folder + name `poc-test` → **Create** → project opens.
3. **Hierarchy → Quick Hierarchy Creator** (empty-state CTA).
4. **Place levels (top→bottom):** District, Ward, Health facility, FCHV Area, Household (5). **Person leaf:** "Patient". Finish.
5. Accept the **"Generate contact forms"** offer.
6. **"+ Add type"** twice: `fchv` (Person, parent = FCHV Area) and `hf_officer` (Person, parent = Health facility) → generate their forms.
7. *(Optional, to match fully)* **Forms → new app form** `pregnancy_registration`; **Properties → Context →** tick "Available on people" + set **Contact type = patient**.
8. **Save.**

## C. Assertions on the produced folder (the regression value)
Parse/read the files the UI wrote:
1. **Required files exist:** `targets.js`, `tasks.js`, `.eslintrc`, `app_settings/base_settings.json`, `contact-summary.templated.js`. *(template-gap guard)*
2. **`contact_types`:** all 8 present with correct `parents`; **every type — incl. `patient`/`fchv`/`hf_officer` — has `create_form` AND `edit_form`.** ⚠️ **Currently RED for `patient`** (open person-`create_form` bug) — this is a deliberate test-first regression; it flips green when the dev ships the fix. Tell the team it's expected red until then.
3. **`place_hierarchy_types` == `["district","ward","health_facility","fchv_area","household"]`** (person excluded).
4. **Each generated contact `.xlsx`** — parse with `@cht-ui/shared` `parseXlsForm` and assert:
   - **no survey row `name` starts with `_`** *(catches `_id_placement`)*;
   - **`meta` calculates use `../../../inputs/user/...`** (three hops) *(catches the XPath off-by-one)*;
   - **every `name` matches `^[A-Za-z_][A-Za-z0-9_]*$`** and is non-empty *(catches space/punctuation names)*.
5. *(if app form made)* pregnancy_registration context expression contains **`contact.contact_type === 'patient'`** (not `contact.type`).

## D. Deploy-valid super-check (separate node/CI step — recommended)
Run **`cht compile-app-settings` + `cht convert-contact-forms`** against the produced
folder and assert **exit 0**. Both are local (no CHT instance needed) and catch the
`targets.js` / XPath / convert failures in one shot. *(upload/validate-contact-forms
needs a live instance — keep it out of CI.)*

## E. Demo capture (PO wants a watchable demo)
Make the run produce a shareable recording of the build:
- **Video (best for a stakeholder demo):** set `use: { video: 'on' }` in the Playwright
  config (or scope to this project). Playwright writes a `.webm` per test under
  `test-results/…`; convert to `.mp4` if needed for sharing. Run `--headed` with a small
  `slowMo` (e.g. 250–400ms) so the recording is watchable rather than a blur.
- **Trace (best for QA/dev debugging):** `use: { trace: 'on' }` → `trace.zip`, viewable
  with `npx playwright show-trace` (timeline + DOM snapshots + screenshots per step).
- **Storyboard screenshots (nice for docs):** `await page.screenshot({ path: 'demo/NN-<step>.png', fullPage: true })` at each milestone (new-project, hierarchy built, forms generated, context set, saved) — gives a labeled before/after sequence.
- Collect artifacts under a `demo/` (or `test-results/`) dir; the **video is the deliverable** the PO asked for. Keep the run deterministic so the demo is reproducible.

## F. Practical notes
- **Deterministic:** rowIds use `Date.now()` — assert on **structure/values**, never exact ids.
- Clean up the temp project dir in `afterAll`.
- Spec is **partly red today** (assertion C2) by design — it's the regression for the open person-`create_form` bug.
- Bugs this e2e guards against (all hit this session): template `targets.js` gap, `created_by` XPath off-by-one, `_id_placement` CouchDB reject, person-types-missing-`create_form`, invalid field names.
