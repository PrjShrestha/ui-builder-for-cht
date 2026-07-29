<!--
Consolidated design + dev handoff for the 6 Geriatric/ANC field notes, organized as
three waves the developer can plan and execute together. Companion to the note-by-note
grounding + triad in handoff-improvement-notes-2026-07-29.md (read that for the full
per-note evidence). 2026-07-29.
-->

# Design + dev handoff — Geriatric/ANC field notes (Waves 1–3)

**One body of work, 6 notes, 3 waves — meant to be handed off and executed together.** Recommended order is Wave 1 → 2 → 3 (cheap-unblock first, biggest last), but they share foundations and can be planned as one. Full per-note grounding, the PO/Designer/QA triad, and the Wave 1 WIP review live in the companion doc **`handoff-improvement-notes-2026-07-29.md`**; this doc is the wave-organized execution plan.

**Provenance:** field notes from a health-post officer building the real Geriatric-care + ANC use case. Every `file:line` was grounded against HEAD.

## ⚠️ Read first — shipped foundations to REUSE, not rebuild

Three of the six notes have their hard half already built. Build the thin missing piece on top; do **not** reimplement these:

| Already shipped | Used by | Do NOT rebuild |
|---|---|---|
| `handlePickerCommit` auto-pairs `begin`/`end` (`FormEditor.tsx:822-851`); A2 nested groups + A6 save-time balance guard (`structuralBalance.ts`) | Wave 2 · 3b (groups) | the insert/balance machinery |
| Calc-builder reference picker — `contact-input` + `contact-summary` kinds w/ wrappers (`CalculationBuilder.tsx:562-637`); engine `calcReference.ts` | Wave 2 · 5 and Wave 3 · 6 | the reference emit/recognize engine |
| Contact-summary `context`-key add ("+ Add flag", `ContactSummaryEditor.tsx:141-157`) | Wave 3 · 6 | context-key CRUD + serializer |

**Shared dependencies across waves:**
- **`deriveFormName` / `slugifyHierarchyId`** (Wave 1 · 1) is reused for **section naming** (Wave 2 · 3b) — label-first, slug auto-derived.
- **Rename + rewrite-all-refs macro** (greenlit in `DEV-HANDOFF.md:44`) underpins Wave 1 · 1 safety **and** Wave 2 · 5 (a renamed field's `${ref}` in a label must stay in lockstep).
- **Round-trip invariant** applies to every serializer-touching item: `parse→serialize→parse` byte-stable for anything not edited.

---

# WAVE 1 — cheap unblock + two silent-trap fixes (ship as one PR)

Status: **in progress / uncommitted.** 3a is done; 1 and 2 each have one fix outstanding (folded in below from the WIP review).

## 1 · New-form title → slugify  🟡 (deploy trap)
**Design:** label-first create. User types a friendly title ("Patient Age"); the tool derives the filename/`form_id` (`patient_age`) and keeps the title as `form_title`. Show a muted "Saved as `patient_age`" hint; on collision, a numeric suffix (`_2`). Never reject friendly input.

**Dev — mostly done, one fix:**
- ✅ `deriveFormName.ts` + thorough unit tests; label-first dialog with hint; `scaffolds.ts` keeps `form_title` = title / `form_id` = slug; server derives defensively.
- 🟠 **FIX: collision resolution breaks across client↔server.** Client resolves `patient_age_2` and shows it, but the server (`forms.ts:352`) does `source = title ?? rawBasename` → re-derives from the title **without** the `existing` set → `patient_age` → the 409 guard (`forms.ts:362`) fires. A second form with a colliding title errors instead of getting the suffix. **Fix:** honor the client's already-resolved `basename` (defensively re-slugify via `slugifyHierarchyId`; use `title` only for `form_title`), and/or collision-resolve server-side by listing the category dir into `deriveFormName`'s `existing`. Keep the 409 as a race backstop.

**Acceptance + tests:**
- `deriveFormName.test.ts` (done) — slug rules, Devanagari→`''` fallback, collision suffix.
- **NEW flow test:** create "Patient Age" twice → second lands as `patient_age_2`, **not** a 409.
- Round-trip leg on `renameSurveyRow.roundtrip.test.ts` (rewrites `${foo}` across `relevant/calculation/constraint/choice_filter/default/repeat_count` + labels; full-form byte-stable).

## 2 · Numeric condition input can't clear "0"  🟠 (silent corrupter)
**Design:** the age operand should behave like the already-fixed `contact_field` input — hold the raw string, clear freely, validate at the edge, select-all on focus.

**Dev — core done, one fix:**
- ✅ IR `number → string` (`contextExpressionParser.ts:34`), raw `onChange`, `addRule` seeds `'18'`, select-on-focus, inline "Not a number" warning.
- 🟠 **FIX: the warning is display-only — nothing gates save.** An empty value serializes to `ageInYears(contact) >= ` (empty operand, `contextExpressionParser.ts:182`) = invalid, fails at deploy. **Fix:** block save (or omit / fall the rule back to raw) when the age value is empty or non-numeric.
- ⚪ Minor: parse regex is integer-only (`\d+`, `:96`) but the validator accepts decimals → `60.5` demotes to raw on reload. Restrict input to integers or widen the regex.

**Acceptance + tests:** Playwright — type `60`, backspace twice → input `""`, stored operand empty (not `0`); saving with an empty age does **not** emit an invalid expression.

## 3a · Unhide the Group tile  🔴 (top blocker — DONE)
**Design/dev:** ✅ `hiddenInSimple` removed from `begin_group` (`QuestionTypeCatalog.ts:335`); insert machinery untouched. Real forms are now buildable.
- **Open decision (not a bug):** `begin_repeat` is still `hiddenInSimple:true` (`:349`). Fine if intentional — but a repeat block (e.g. repeating medications in the geriatric form) will hit the same invisible-tile wall. Make it a conscious call; unhide it too if the use case needs repeats.

---

# WAVE 2 — proper authoring UX (groups · locales · label refs)

## 3b · Section-authoring flow  🟠
**Design (reuses shipped insert/balance machinery — build only the authoring UX):**
- A second primary toolbar button **`+ Add section`** beside `+ Add question`, opening the picker's **Structure** category directly.
- Section name is **label-first, slug auto-derived** (reuse `deriveFormName`/slugify from Wave 1).
- Toggle **"Show all on one screen"** = `field-list` appearance.
- Render as a **collapsible, indented container** with an **empty drop-zone**: *"Drag questions here, or + Add question."* Questions drag in/out; the group moves as one unit (`surveyEdits.planSurveyMove`).
- **NO multi-select needed** — create-empty + drag-in fully clears the blocker.

```
▼ Danger signs  [Show all on one screen ✓]        ⠿
   ├ ○ Chest pain?
   └ ○ Breathlessness?
   ┈┈┈ + Add question ┈┈┈
```

**Acceptance + tests — MUST-HAVE round-trip:** new **2-deep nesting fixture** → `parse→serialize→parse` byte-identical (`structuralBalance.test.ts` + serialize round-trip). Edges: `end group` with empty name tolerated; interleaved `[A][B][/A][/B]` → `mismatched-name`; save-guard blocks serialize on any violation.

**3c · "Wrap selected in section" — DEFERRED, does NOT gate 3b.** One-gesture bundling of existing questions needs a **multi-select mechanism** (checkbox/shift-click over >1 row — none exists today; editor is one-row-at-a-time), then reuses the begin/end-pair insert (handle non-contiguous selections). Same item as the deferred Survey-A5 "Group these" (`DEV-HANDOFF.md` §P2). Build only after 3b lands and the convenience earns it.

## 4 · Inline other-language labels + Add-a-language  🟠
**Design — two parts:**
- **(a) Add-time inline labels:** the add-picker collects **no** label today — give it **one label input per active locale** (`QuestionTypePicker.tsx:214-228`), threaded into the commit (`FormEditor.tsx:853-860`).
- **(b) Add-language control:** a **language chip bar** atop the survey editor — `English · नेपाली · [＋ Add language]`. `＋ Add language` picks a locale and appends to `form.locales` **+ `surveyHeaders.labelLocales` + `choicesHeaders.labelLocales`**, and reuses TranslationsEditor plumbing to create `messages-<locale>.properties`. **No add-locale UI exists anywhere today.** Home: TranslationsEditor toolbar (`FormEditor.tsx:3258-3292`).
- **Missing state:** reuse TranslationsEditor's **"!" missing glyph** + *"Add translation…"* placeholder so gaps show at authoring time.

**Acceptance + tests — MUST-HAVE round-trip:** add `ne` to a single-locale form → `label::ne` column **appended (not interleaved)**, original column order preserved, rows without a `ne` label emit `""` (not dropped), `default_language` unchanged, **both survey AND choices sheets** pick up the locale (two paths in `serialize.ts`). Edge: `label:ne` vs `label::ne` (`LABEL_HEADER_RE` accepts both) must not double-add.

## 5 · Insert a field / contact field into a label  🟠
**Design (calc-side contact-input picker already wired — build the label-side affordance):**
- **5a — generic `${field}` insert:** an insert-field button on label inputs (`FormEditor.tsx:1729-1743`), caret-splice pattern from `InsertFieldButton.tsx:43-49`, sourced from `earlierFields`/`fieldOptions` (`FormEditor.tsx:1095-1098`).
- **5b — "insert contact field":** picks `patient_name`/`patient_id` from the contact-form field list (like `FieldPicker`), **auto-creates one hidden `../inputs/contact/<field>` calculate** (name auto-derived, **deduped** if it exists, inside the `inputs/contact` group), and splices `${patient_name}` into the label at the caret. User never sees the calculate or the `${}`.
- **Empty state:** *"No contact fields available."* Idempotent.

**Acceptance + tests:** extend `calcReference.roundtrip.test.ts` + `structuralBalance` — inserting `patient_name` creates **exactly one** calc row inside `inputs/contact` (balance preserved) + one `${patient_name}` token; **re-insert is idempotent**; the label token round-trips; a later rename keeps the label ref in lockstep (rename-macro). Edge: name collision with an existing calc.

---

# WAVE 3 — cross-form values (latest from another form)

## 6 · Pull the latest value from another form via the contact-summary bridge  🟡 (biggest lift)
The "latest BMI/BP from the Diabetes screening" / "LMP/EDD from ANC" pattern: a `context_vars` calc group reading `instance('contact-summary')/context/<key>`, populated from another form's most-recent report. **The reference syntax is solved on both form-touching sides; the gaps are the contact-summary population and the coordination between the two ends.**

**Design (reuses both surfaces — zero net-new screens):**
- **Contact-summary side — new "Context values" sub-tab** beside context flags. Each row = *"bmi ← latest from Diabetes screening"*, built with a **`ReportFieldPicker`** (source form + field) that generates the `reports`-scan JS (`Utils.getMostRecentReport`-style) into the same `context: {}` object. **This is the real build** — today the per-flag editor is a bare raw-JS `<textarea>` (`ContactSummaryEditor.tsx:733-767`); the structured pickers that exist (Cards `FieldPicker`, Helpers `AppliesIfBuilder`) don't write into `context.<key>`.
- **Form calc side — a reference-picker source group "From another form (via contact summary)"** in `CalculationBuilder` listing those context vars; picking one emits the bridge calc (the `fallback-to-current` `if(ref, ref, .)` wrapper is already supported). No bridge syntax typed.
- **Empty state:** the picker group shows *"Define a context value in Contact Summary first →"* (deep link).

**Acceptance + tests — MUST-HAVE round-trip (spans two serializers):**
- Form side reuses the `calcReference` fallback-to-current round-trip.
- Contact-summary side: add one context key, then `parse→serialize→parse` — **only the `context` object's byte range changes; everything before `contextBounds.start` / after `.end` is byte-identical** (guards the `fields[]`/`cards[]`-verbatim invariant). Edges: a key needing quoting (`JSON.stringify` branch); `context` discovered via the `return {…}` fallback path, not just `const context =`.

---

## Dependency / sequencing notes for planning together
- **Wave 1 · 1 (deriveName)** ships the slugify helper that **Wave 2 · 3b** reuses for section naming — land 1 first or in parallel.
- **The rename-macro** (greenlit, `DEV-HANDOFF.md:44`) is a shared prerequisite for Wave 1 · 1 rename-safety **and** Wave 2 · 5's label-ref lockstep — build it once, early.
- **Wave 2 · 5 and Wave 3 · 6** both lean on the shipped `calcReference` engine — no rebuild; 5 adds a label-insert, 6 adds a contact-summary populator + a picker source group.
- **Wave 3 · 6** depends on nothing in Waves 1–2 functionally, but it's the heaviest and least finish-critical, so it stays last.

## Gates (run before each commit)
```
pnpm --filter @cht-ui/shared build && pnpm --filter @cht-ui/shared test
pnpm --filter @cht-ui/client build      # per the "verify app runs after client change" rule
pnpm typecheck && pnpm lint              # zero-warnings
```
Every serializer-touching item (3b, 4, 5, 6, and 1's rename-macro) needs its round-trip regression **in the same PR** as the feature.
