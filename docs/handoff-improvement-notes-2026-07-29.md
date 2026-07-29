<!--
Six field-generated improvement notes captured while a health-post officer built the
Geriatric-care + ANC use case in the tool. Each note grounded against HEAD by a code-search
pass, then run through the requirements/validation triad (PO Bhishan / Designer Lal / QA
Lorena). This is the developer-actionable compilation. 2026-07-29.
-->

# Handoff — field improvement notes (Geriatric + ANC build)

**2026-07-29 · source: a health-post officer building the real Geriatric-care + ANC use case, dropping `note-` items as they hit friction.** Every note below is grounded to `file:line` and carries a design shape + a test bar. These are **field blockers from the user building right now**, so they sit **ahead of the roadmap tiers** in `DEV-HANDOFF.md`.

**Key grounding result:** most of these are *not* net-new features. Notes 3, 5, and 6 have their hard half (the tile / the reference engine / the context-key add) **already shipped** — the gaps are discoverability, one affordance, or a raw-JS-only last mile. Fix the small thing; do **not** rebuild the shipped machinery.

## TL;DR — build order (3 waves)

| # | Note | Verdict | Severity | Wave |
|---|---|---|---|---|
| 3a | **Groups — unblock** | Tile exists but hidden in default Simple mode | 🔴 Blocker | **1 (this week)** |
| 2 | **Numeric input can't clear "0"** | Confirmed `Number('')===0` bug | 🟠 High (silent corrupter) | **1 (this week)** |
| 1 | **New-form title → slugify** | Absent; both layers *reject* instead of slug | 🟡 Medium (deploy trap) | **1 (this week)** |
| 3b | **Groups — authoring UX** | `+ Add section` flow, collapsible container | 🟠 High | 2 |
| 4 | **Inline EN/NE labels + Add-language** | Edit-time conditional; add-time none; no add-locale UI | 🟠 High | 2 |
| 5 | **Insert contact field into label** | Calc picker wired; label `${}` insert absent | 🟠 High | 2 |
| 6 | **Cross-form value (latest from form X)** | Value picker wired; from-other-form is raw-JS only | 🟡 Medium (biggest lift) | 3 |
| 3c | **Wrap selected into a section** | Needs a multi-select mechanism (none today); does NOT gate 3b | ⚪ Low (convenience) | Later |

**Wave 1 = ship together, all cheap:** unhide the Group tile (unblocks the #1 blocker), fix the numeric-input bug (silently corrupts every age/threshold condition), and slugify new-form titles (stops invalid names reaching deploy). PO (Bhishan) flagged all three as non-negotiable this week.

**MUST-HAVE round-trip regressions (QA / Lorena):** #3 (nested-group byte-stability), #4 (add-locale column append), #6 (contact-summary `context`-only rewrite). These touch the serializer invariant.

---

## Note 3 — Add Groups / sections  🔴 Blocker → 🟠 (UX)

**Verdict:** The Group tile **exists and its insert machinery is fully correct** — it's invisible because the editor defaults to *Simple* mode and the tile is flagged `hiddenInSimple`. A user who never clicks "Full" never sees "Question → Group." This is the top blocker (geriatric assessment + ANC are section-heavy), but the fix is tiny.

**Grounding:**
- Tile: `client/src/ui/QuestionTypeCatalog.ts:327-336` — `id:'begin_group'`, `hiddenInSimple:true` (at `:335`). Repeat likewise `:337-346` (`:345`).
- The gate: `client/src/ui/QuestionTypePicker.tsx:117` — `if (mode === 'simple' && t.hiddenInSimple) return false;`
- Default mode: `client/src/ui/FormEditor.tsx:498` — `useState<'simple'|'full'>('simple')`; picker gets `mode={mode}` at `:1217`; Simple/Full toggle `:1143-1156`.
- **Insert is already correct** — `handlePickerCommit` (`FormEditor.tsx:822-851`) inserts a **matched begin+end pair** as one edit; user never adds `end group` manually. Balance guard: `shared/src/xlsform/structuralBalance.ts:63-146`; group-as-unit move/ungroup `surveyEdits.ts:121-180` / `:202-234`. (A2 nested-collapsible groups + A6 save-time balance guard shipped — see `DEV-HANDOFF.md` §4 "Done".)

**Wave 1 fix (3a — unblock):** remove `hiddenInSimple:true` from the `begin_group` tile (`QuestionTypeCatalog.ts:335`), or relax the Simple filter for `isStructural` tiles (`QuestionTypePicker.tsx:117`). **No change to the insert machinery.** This alone makes real forms buildable.

**Wave 2 fix (3b — design it well, per Lal):**
- A second primary toolbar button **`+ Add section`** beside `+ Add question`, opening the picker's **Structure** category directly (don't make the group hide behind a mode toggle).
- Section names are **label-first, slug auto-derived** (ties to Note 1).
- Toggle **"Show all on one screen"** = `field-list` appearance.
- Render the group as a **collapsible, indented container tile** with an **empty drop-zone**: *"Drag questions here, or + Add question."*

> **This flow needs NO multi-select.** Create an empty section, then add/drag questions in one at a time (reuse the existing group-as-unit move). **Create-empty + drag-in fully clears the "can't build sections" blocker** — do not let the wrap gesture (3c) gate it.

**3c — "Wrap selected in section" (DEFERRED follow-up, does NOT gate 3b):** a one-gesture bundle of several *existing* questions into a new group. This is the **only** groups-related path that requires a **multi-select mechanism** — a way to select >1 survey row at once (checkboxes / shift-click); none exists today (the editor is strictly one-row-at-a-time). It then reuses the begin/end-pair insert (`handlePickerCommit`) around the first/last of the selection (must also handle a non-contiguous selection). Same item as the deferred **Survey A5 "Group these"** in `DEV-HANDOFF.md` §P2 (ungroup already shipped; wrap needs the selection UI first). Build only **after** 3b lands and the multi-select affordance is judged worth it.

```
▼ Danger signs  [Show all on one screen ✓]        ⠿
   ├ ○ Chest pain?
   └ ○ Breathlessness?
   ┈┈┈ + Add question ┈┈┈
```

**Acceptance + tests (Lorena) — MUST-HAVE round-trip:**
- After add-group, `findStructuralViolations() === []` and `isStructurallyBalanced() === true`.
- **New fixture, 2-deep nesting → `parse→serialize→parse` byte-identical** (`shared/src/xlsform/structuralBalance.test.ts` + a `serialize` round-trip).
- Edge cases a dev will miss: `end group` with an **empty name** must stay tolerated (existing §H2 case); interleaved `[A][B][/A][/B]` must flag `mismatched-name` (pyxform pairs by name); the save-guard must **block serialize** on any violation.

---

## Note 2 — Numeric condition input won't clear the "0"  🟠 High (silent corrupter)

**Verdict:** Confirmed bug. In the "who sees this form" condition builder, the age operand (e.g. `age > 60`) can't be cleared — backspacing the last digit snaps it back to `0`. Cheap fix, but until then every age/threshold condition a non-coder builds is quietly wrong while looking done.

**Grounding — exact:**
- `client/src/ui/ContextExpressionBuilder.tsx:361-366` (the `age_years` row, `:346-369`):
  ```tsx
  <input type="number" value={r.value}
    onChange={(e) => props.onChange({ ...r, value: Number(e.target.value) })} />
  ```
  `Number('') === 0`, so clearing the field writes `0` and the controlled `value={r.value}` re-renders `"0"` — unclearable. `age_years.value` is typed `number` (`shared/src/tasks/contextExpressionParser.ts:34`); `addRule` seeds `value: 18` (`ContextExpressionBuilder.tsx:126-128`).
- **Proof it's isolated:** the sibling `contact_field` numeric input was already fixed — it stores the **raw string** and validates separately (`ContextExpressionBuilder.tsx:410-443`, esp. `:410-411` `isNumericOp`/`isValidNumberLiteral`, `:438-443` `value: e.target.value`). The `age_years` row never got the same treatment. `CalculationBuilder.tsx:531-537` / `:852-858` also already avoid this.

**Fix:** at `ContextExpressionBuilder.tsx:364`, stop coercing on keystroke — mirror the `contact_field` pattern (hold the raw string, coerce/validate on commit). Designer adds: **select-all on focus** so `60` is easy to overtype.

**Acceptance + tests:** pure client → Playwright (`client/tests/`). Type `60`, backspace twice → input value `""`, stored operand empty (not `0`); no serializer change. No shared test needed.

---

## Note 1 — New-form title should auto-slugify  🟡 Medium (deploy trap)

**Verdict:** Absent. There's no "friendly title" concept at all — the create flow forces the user to type an already-valid identifier, and **both layers reject** non-identifier input instead of slugifying. A non-technical user who types "Patient Age" hits an error they don't understand (classic cold-start wall), or produces something that only fails later at deploy.

**Grounding:**
- Client dialog: `client/src/ui/FormsIndex.tsx:125-190`; single `basename` input `:129-140`; `doCreate` `:57-71` hard-validates `/^[a-zA-Z0-9_-]+$/` at `:59` and **rejects**. No `title` argument in `api.createForm` (`:64`).
- Server: `server/src/routes/forms.ts:315-366`; same reject at `:325`; `basename` used verbatim as the properties title (`:356`).
- Scaffold: `shared/src/xlsform/scaffolds.ts:156-179` (`baseForm`) sets `form_title` **and** `form_id` to `basename` verbatim (`:169-170`).
- **Helper already exists:** `slugifyHierarchyId` at `shared/src/hierarchy/buildLinearHierarchy.ts:108` (used by `TasksEditor.tsx:660`, `ChoiceNameInput.tsx`, preflight `xlsformIdentifiers.ts:31`). Direction greenlit in `DEV-HANDOFF.md:42` ("make naming automatic, not reactive").

**Fix:** collect a **human title** in the dialog; derive `basename = slugifyHierarchyId(title)`; show the derived id as a muted hint ("saved as `patient_age`"). Thread the human `title` through `api.createForm` → `forms.ts` body → scaffold so **`form_title` keeps the human title** while `form_id`/filename get the slug (`scaffolds.ts:169-170`). Slugify **defensively on the server too** (`forms.ts:325`) rather than reject.

**Acceptance + tests (Lorena):**
- New unit `shared/src/xlsform/deriveName.test.ts`: title → `^[a-z][a-z0-9_]*$`; spaces/punct → single `_`; leading digits/`_` stripped; **Devanagari NFKD-drops → empty → caller falls back to an explicit-id prompt** (mirror `slugifyHierarchyId`); duplicate name gets a numeric suffix, never a silent collision.
- **Reuses the rename-macro concern:** this is the same family as the greenlit **rename + rewrite-all-refs macro** (`DEV-HANDOFF.md:44`). Add the byte-stability leg to `renameSurveyRow.roundtrip.test.ts` (rename rewrites `${foo}` across `relevant/calculation/constraint/choice_filter/default/repeat_count` + labels, leaves `${foo_extra}` untouched, full-form round-trip byte-identical).

---

## Note 4 — Inline other-language labels + Add-a-language  🟠 High

**Verdict:** Two-part. (a) **Edit-time** multi-locale labels **already render** — but only if the form *already carries* the locale. (b) **Add-time** the picker collects **no label at all** (not even English). (c) There is **no UI anywhere to add a locale to a form** — every locale reference is read-only. For a bilingual EN/NE deployment this makes the tool produce the wrong artifact.

**Grounding:**
- Edit-time (row card): `client/src/ui/FormEditor.tsx:1729-1743` renders one label `<input>` per locale (`props.locales.map(...)`), driven by `form.surveyHeaders.labelLocales` passed at `:1103`. Hint/`constraint_message` per-locale too (`:1839`, `:1851`). So `label::ne` appears **iff `ne` already exists**.
- Add-time (picker): `client/src/ui/QuestionTypePicker.tsx:214-228` collects only `name`; new rows created with `labels:{en:''}` at `FormEditor.tsx:835/845/857`.
- **No add-locale affordance** — searched the whole client. TranslationsEditor toolbar has filter/scope/missing-badges only, no add-language (`FormEditor.tsx:3258-3292`, locale list `:3212-3213`); `PropertiesEditor.tsx:114` derives `allLocales` read-only; nothing mutates `form.locales`/`labelLocales`.

**Fix (Lal's shape):**
- **(a) Inline at add-time:** the single label field becomes **one label input per active locale**, stacked, in `QuestionTypePicker.tsx:214-228`; thread them into the commit at `FormEditor.tsx:853-860`.
- **(b) Add-language control:** a **language chip bar** atop the survey editor — `English · नेपाली · [＋ Add language]`. `＋ Add language` picks a locale and appends to `form.locales`, `form.surveyHeaders.labelLocales`, **and** `form.choicesHeaders.labelLocales`; reuse `TranslationsEditor` plumbing to create `messages-<locale>.properties`. Natural home: TranslationsEditor toolbar (`FormEditor.tsx:3258-3292`).
- **Missing state:** reuse TranslationsEditor's **"!" missing glyph** + *"Add translation…"* placeholder so untranslated locales are visible at authoring time.

**Acceptance + tests (Lorena) — MUST-HAVE round-trip:** new `serialize.roundtrip.test.ts` — adding `ne` to a single-locale form: new `label::ne` column **appended, not interleaved**, original column order preserved; rows without a `ne` label emit `""` (not dropped); `default_language` unchanged; **both survey AND choices sheets** pick up the locale (two code paths in `serialize.ts`). Edge: `label:ne` vs `label::ne` header spelling (`LABEL_HEADER_RE` accepts both) must not double-add.

---

## Note 5 — Insert a contact field (`patient_name`) into a label  🟠 High

**Verdict:** The **calc-builder half is shipped** (you *can* make a hidden `calculate = ../inputs/contact/name` via the reference picker). What's missing is the label-side affordance: there is **no way to insert `${field}` into a label** without typing it — which violates no-code. The one-click "insert contact field" that *also auto-creates the harvest calculate* doesn't exist yet.

**Grounding:**
- **Wired:** `CalculationBuilder.tsx:562-583` (`contact-input` radio kind → `emitContactInput`); engine `shared/src/xlsform/calcReference.ts:58,:151-153`. (Confirmed done in `DEV-HANDOFF.md` §4 "Form-data-passing".)
- **Absent:** label inputs are plain `<input>` with no insert affordance (`FormEditor.tsx:1729-1743`). `InsertFieldButton.tsx` exists but is a *different* thing — it inserts JS snippets (`Utils.getField(report,'…')`, `:78-81`) into **raw-JS** editors (resolvedIf/events/actions, header `:1-11`), not XLSForm `${field}`.

**Fix (Lal's shape):**
- **5a — generic `${field}` insert:** an insert-field button next to the label `<input>` (`FormEditor.tsx:1729-1743`) that splices `${name}` at the caret (reuse the caret-splice pattern `InsertFieldButton.tsx:43-49`), sourced from the `earlierFields`/`fieldOptions` list already computed at `FormEditor.tsx:1095-1098`.
- **5b — "insert contact field":** a `➕ contact field` control that picks `patient_name`/`patient_id` from the contact-form field list (like `FieldPicker`), **auto-creates one hidden harvest `calculate`** (`../inputs/contact/name`, name auto-derived, **deduped if it already exists**), and splices `${patient_name}` into the label. User never sees the calculate or the `${}`.
- **Empty state:** *"No contact fields available."* Idempotent.

**Acceptance + tests (Lorena):** extend `calcReference.roundtrip.test.ts` + `structuralBalance`. New cases for the *flow*: inserting `patient_name` creates **exactly one** calc row `../inputs/contact/name` **inside the `inputs/contact` group** (balance preserved) + one `${patient_name}` label token; **re-inserting is idempotent** (no duplicate calc); the `${patient_name}` label round-trips; if the user later renames the calc, the rename-macro (Note 1) keeps the label ref in lockstep. Edge: name collision with an existing calc.

---

## Note 6 — Cross-form value: pull the latest from another form  🟡 Medium (biggest lift)

**Verdict:** The single highest-leverage cross-form item — and the one that's genuinely mostly-to-build. The **reference syntax is solved on both sides that touch the form**, but the **contact-summary population from another form's latest report is raw-JS-only**, and nothing coordinates the two ends. This is the "pull the latest BMI/BP from the Diabetes screening" / "LMP/EDD from ANC" pattern the user documented (the `context_vars` calc group + `instance('contact-summary')/context/<key>` bridge).

**Grounding — what's already wired:**
- **Form calc side:** `CalculationBuilder.tsx:585-637` (`contact-summary` kind: context-key input + wrapper `<select>` covering `none`/`fallback-to-current`/`read-once`), engine `calcReference.ts:64-89,:157-167`. Context keys sourced via `useContactSummaryContextKeys.ts:42-80`, threaded `FormEditor.tsx:1787`→`CalculationBuilder.tsx:335`. **So the entire `context_vars` hidden group — including the `if(ref, ref, .)` fallback-to-current idiom the user's `_ctx` calcs use — is buildable today via pickers.**
- **Context-key add:** `ContactSummaryEditor.tsx:282-306` lists context keys with **"+ Add flag"** (`:302` → `addFlag` `:141-157`), rename/remove `:124-140`, save `:198-200`.

**The gap:**
- **Populating a key from another form's *latest report* is raw-JS only.** The per-flag editor is a bare `<textarea>` of JS (`FlagCard`, `ContactSummaryEditor.tsx:733-767`, textarea `:758-764`) — the author must hand-write `reports`-scan / `Utils.getMostRecentReport(...)` JS. The structured pickers that *do* exist (Cards `FieldPicker` `:649-654`, Helpers `AppliesIfBuilder` `:419-432`) don't write into `context.<key>`.
- **No coordination:** nothing links "pull latest BMI from the Diabetes form" → auto-register `bmi` in `context` → auto-create the `bmi_ctx` calc in this form → offer `${bmi_ctx}` in a label.

**Fix (Lal's shape — reuse both surfaces, zero net-new screens):**
- **Contact-summary side:** a **"Context values"** sub-tab beside context flags. Each row = *"bmi ← latest from Diabetes screening"*, built with a **`ReportFieldPicker`** (source form + field) that generates the `reports`-scan JS into the same `context: {}` object.
- **Form calc side:** add a reference-picker source group **"From another form (via contact summary)"** in `CalculationBuilder` listing those context vars; picking one emits the bridge calc — no bridge syntax typed.
- **Empty state:** picker group shows *"Define a context value in Contact Summary first →"* (deep link).

**Acceptance + tests (Lorena) — MUST-HAVE round-trip (spans two serializers):**
- Form side reuses the `calcReference` fallback-to-current round-trip.
- Contact-summary side: add one context key, then `parse→serialize→parse` — **only the `context` object's byte range changes; everything before `contextBounds.start` / after `.end` is byte-identical** (this guards the `fields[]`/`cards[]`-verbatim invariant). Edges: a key needing quoting (`JSON.stringify` branch); `context` discovered via the `return {…}` fallback path, not just `const context =`.

---

## Cross-references to the existing queue (avoid rebuilds / dedupe)

- **Note 1** is the *form-name* sibling of the greenlit **question-name autoderive + rename-macro** (`DEV-HANDOFF.md:44-45`). Same `slugifyHierarchyId` + same rename-macro dependency — build them as one family.
- **Note 3c "wrap selected"** = the deferred **Survey A5 "Group these"** P2 item (`DEV-HANDOFF.md` §P2) — needs a multi-select mechanism; split out of 3b so it does **not** gate the core groups work.
- **Notes 5/6 calc-side** are the **shipped** "Form-data-passing" work (`DEV-HANDOFF.md` §4). Do **not** rebuild the `contact-input`/`contact-summary` reference kinds — only add the label-insert (5) and the contact-summary population + coordination (6).
- **Note 6** is adjacent to Tier-2 **Contact-summary cards editor** and Phase-1 **conditions cross-form refs**, but distinct: it populates the `context` *flags*, not cards, and not condition cards.

## Suggested commit sequencing for the Developer session

1. **Wave 1 (one PR, this week):** unhide Group tile (3a) + numeric-input fix (2) + new-form slugify (1, with the `deriveName` unit test). All small, all high-impact, no serializer risk except the slugify unit test.
2. **Wave 2:** section-authoring UX (3b — **create-empty + drag-in, no multi-select**) → inline locales + Add-language (4, with the add-locale round-trip test) → label insert-field + contact-field (5). Each gets its round-trip/e2e test.
3. **Wave 3:** cross-form "Context values" builder + form-calc "from another form" group (6, with the two-serializer round-trip test).
4. **Later / optional:** 3c "wrap selected in section" — needs a multi-select mechanism first; not a blocker, build only if the convenience earns it.

---

## Review addendum — Wave 1 WIP audit (2026-07-29, planner)

Reviewed the uncommitted Wave 1 changes (groups tile, numeric-input bug, slugify) against this spec. **3a is done correctly.** Notes **2 and 1 have their hard parts right but each has one thing to fix before commit** — neither is a rebuild.

### ✅ 3a — Groups tile unhidden — correct
`QuestionTypeCatalog.ts:335` — `hiddenInSimple` removed from `begin_group`, insert machinery untouched. **Open decision (not a bug):** `begin_repeat` is still `hiddenInSimple:true` (`:349`). Fine if intentional, but a repeat block (e.g. repeating medications) will hit the same invisible-tile wall — make it a conscious call.

### 🟠 2 — Numeric bug fixed, but the save has no validity gate — FIX BEFORE COMMIT
Core fix is correct (IR `number → string` at `contextExpressionParser.ts:34`, raw `onChange`, `addRule` seeds `'18'`, select-on-focus, inline warning). Two gaps:
1. **No save-gate.** `PropertiesEditor.tsx` never blocks on an invalid rule; the warning is display-only. An **empty** age value serializes to `ageInYears(contact) >= ` (empty operand — `contextExpressionParser.ts:182`) = an **invalid expression that fails at deploy**. This is the same clear-the-field path the bug was about. **Fix:** gate save (or omit / fall the rule back to raw) when the age value is empty or non-numeric.
2. **Minor round-trip.** Parse regex is integer-only (`\d+`, `:96`) but `isValidNumberLiteral` accepts decimals → `60.5` serializes but **demotes to raw on reload**. Restrict input to integers or widen the regex. Low severity.

### 🟠 1 — Slugify excellent, but collision resolution breaks across the client↔server boundary — FIX BEFORE COMMIT
`deriveFormName.ts` + tests are thorough; the dialog is properly label-first with a "Saved as `…`" hint; `scaffolds.ts` correctly keeps `form_title` = human title / `form_id` = slug. **Defect:** the client resolves collisions (`deriveFormName(title, existing)` → `patient_age_2`) and shows the user that suffixed name, but the server (`forms.ts:352`) does `source = title ?? rawBasename` and **re-derives from the title WITHOUT the `existing` set** — dropping the suffix back to `patient_age` — then the 409 guard (`forms.ts:362`) fires. **Net: creating a second form whose title slugifies to an existing basename fails with "already exists," despite the UI promising a suffixed name.** Fails QA's "duplicate → numeric suffix, never collides" criterion end-to-end (the unit test passes because it only exercises `deriveFormName` in isolation, not the flow).
- **Fix:** server should honor the client's already-resolved `basename` (defensively re-slugify via `slugifyHierarchyId`, do **not** re-derive from `title`; use `title` only for `form_title`), **and/or** collision-resolve server-side by listing the category dir into `deriveFormName`'s `existing`. Keep the 409 as a race backstop. Add a flow-level test (create "Patient Age" twice → second lands as `patient_age_2`, not a 409).

**Gate reminder:** run `pnpm --filter @cht-ui/shared build && pnpm --filter @cht-ui/shared test` (deriveFormName + contextExpression round-trip) and `pnpm --filter @cht-ui/client build` before committing — per the "verify app runs after client change" rule.
