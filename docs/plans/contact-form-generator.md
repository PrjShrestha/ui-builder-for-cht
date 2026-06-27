<!--
Planner-locked plan: OFFERED per-type contact create/edit form generator.
Grounded by parsing the REAL cht-default contact templates + our codebase, designed, and
adversarially verified (workflow wf_f040c298-6c8, 2026-06-26). Verdict: sound-with-notes;
corrections folded in. Pairs with onboarding-order.md (Decision 4) + buildHierarchyBlock.
-->

# Plan: Contact-form generator ("Generate contact forms for your types")

**Version:** v0.1 — 2026-06-26 · **Status:** PLANNER-LOCKED (one strategic decision open — §2).

## 0. Why this exists (a dangling contract today)
When an author adds a **place** type in the Hierarchy editor, `AddTypeForm` already writes
`create_form`/`edit_form: form:contact:<id>:create|edit` (`HierarchyEditor.tsx:491`, guarded
`if(!isPerson)`) — **pointing at contact forms nothing generates.** So defining a type today
silently promises forms that don't exist. This generator closes that contract (for place
types) and gives custom person types their create/edit forms too.

## 1. Verified reality (parsed from real templates — this is the reference)
Real cht-default contact forms are **rich**: person-create ≈48 rows, place-create ≈69, each
with create+edit. Confirmed structure (full per-variant detail in workflow `wf_f040c298-6c8`):
- **Shared skeleton (every form):** top `begin group inputs` (NO_LABEL, `relevant=false()`)
  wrapping `user{contact_id,facility_id,name}`; a **doc group named EXACTLY the contact_type id**
  (NO_LABEL/field-list) holding the saved doc — `hidden parent`, `hidden type`, the fields, and
  a hidden `meta` group (`created_by*` calculated on create; carried-hidden + `last_edited_by*`
  on edit); a non-persisted `init`/selector group that computes `parent`/links + display labels.
- **Lineage = a SINGLE hidden `parent` + ONE `select-contact` placement selector** — **NOT** a
  nested ancestor chain (that's `buildHierarchyBlock`'s job for app forms). ✅ variant-B mistake
  avoided. Person-EDIT re-parent uses mutually-exclusive per-place-type `select-contact … bind-id-only`
  selectors coalesced into one `parent`.
- **person vs place** chosen by `ContactTypeNode.person`; place forms also carry primary-contact
  selection (+ an optional embedded new-person payload).

## 2. ⚠️ Strategic decision (needs your call): faithful clone vs minimal-valid
The verification shows the faithful cht-default shape carries **opinionated machinery** not every
project wants — inline **CHW user creation** (`user_for_contact`), the **ephemeral-DOB** age
calculator, place **primary-contact** selection + inline new-person, re-parent logic. Two paths:

- **A. Faithful clone** — parameterize near-exact copies of cht-default person/place create+edit.
  Most "complete", but heavy (~48-69 rows/form), imposes cht-default's opinions on every type, and
  is the most brittle to get byte-right.
- **B. Minimal-valid + extensible (RECOMMENDED)** — emit a clean, valid, round-tripping contact
  create/edit per type: the `inputs/user` harvest, the doc group named for the type (`hidden parent`
  default = resolved parent, `hidden type`, `name` [required], a single `select-contact` placement,
  a couple of common fields), the `meta` `created_by*`/`last_edited_by*` group, and **only the
  choice lists those rows reference**. The author extends from there. Lower risk, fits custom
  hierarchies, doesn't force CHW-creation/ephemeral-DOB on projects that don't use them.

**DECISION (2026-06-26): B — minimal-valid + extensible.** Build target = the **minimal spec**
below; the §1 faithful structures are the REFERENCE for fields/blocks an author may add, and for a
possible future **Hybrid** follow-up (opt-in rich blocks: DOB calculator, CHW user creation, place
primary-contact, re-parenting). Keeps generated forms legible and avoids imposing cht-default's
opinions on every type.

**Minimal-valid spec (the build target), per type:**
- **create** (`<type>-create.xlsx`): `inputs/user{contact_id,facility_id,name}` (relevant=false());
  doc group **named for the type** → `hidden parent` (default = resolved parent id),
  `hidden type` (default=`<type>`), `string name` (required), `string _id` appearance=`select-contact`
  (placement; person → `select-contact`, place → its primary-contact selector or omit for v1),
  `select_one sex` (required, **person only**), `meta{ calculate created_by/created_by_person_uuid/
  created_by_place_uuid }`. Choices sheet: **only** the lists these rows use (`male_female`, `yes_no`),
  in all project locales.
- **edit** (`<type>-edit.xlsx`): same doc group, hydrated — add `hidden _id` (read_only), carried
  `parent`/`type` (read_only), `meta` with carried `created_by*` (hidden, read_only) +
  `last_edited_by*` calculates. **No re-parent UI, no primary-contact, no DOB calculator in v1**
  (those are the Hybrid follow-up; §1 has their shape).

## 3. Non-negotiables (verified — true under EITHER A or B)
1. **Choices sheets are load-bearing and PROJECT-SPECIFIC.** Every `select_one`/`select_multiple`
   the form emits MUST have a matching non-empty choices list, in **all locales the project uses**
   (real templates carry 7). **Derive `place_type` + `generated_name` from the hierarchy's actual
   place types (`place_types_display`) and `roles` from `base_settings.json` — never hardcode
   cht-default's `district_hospital/health_center/clinic` or its roles.** Copy the static lists
   (`yes_no`, `male_female`, `boy_girl`, `select_dob_method`, …) verbatim from the shipped templates
   to preserve translations (only for lists the chosen shape actually uses).
2. **Edit forms emit `read_only` on carried/hydrated rows** (`_id`, `type`, `meta.created_by*`,
   `person_parent`/place `parent`).
3. **Per-variant `init` appearance** exactly: person-create = none; person-edit = `field-list`;
   place-create = `field-list`; place-edit trailing init = `field-list hidden`. (B can simplify the
   init group but must still be valid.)
4. **Skip-not-overwrite (hard rule):** the generator NEVER clobbers an existing contact form; it
   fills only missing `(type,variant)` files. Safe to re-run after adding a type.
5. **Pathing / id:** on-disk basename `<type>-create.xlsx` / `<type>-edit.xlsx` (hyphen, survives
   `parseFormId`'s colon-split); in-file `settings.form_id = 'contact:<type>:create|edit'` (colon,
   matching real templates + the `create_form`/`edit_form` strings AddTypeForm wrote). The two
   differ deliberately.
6. **Round-trip:** pure deterministic builder (no `Date.now`/random — route stamps version);
   `parse(serialize(form))` byte-stable; every nested group balanced.

## 4. Build
- **Shared:** new pure module `shared/src/xlsform/buildContactForm.ts` —
  `buildContactForm(contactTypes: ContactTypeNode[], { type, variant:'create'|'edit', displayName }) → XLSForm`.
  Reuse `ContactTypeNode` + the place-parent resolution (`parents[0]`) from `buildHierarchyBlock.ts`,
  and `scaffolds.ts` `row()`/`baseForm()` helpers (widen `CONTACT_SURVEY_HEADERS` to carry
  `required/appearance/relevant/calculation/default/read_only`). Keep the thin 4-row
  `buildContactFormScaffold` as the `+ Contact form` single-file escape hatch.
- **Server:** a **new batch route** `POST /api/forms/generate-contact` that, per `(type,variant)`:
  computes the hyphen basename, calls `buildContactForm`, sets `settings.form_id` to the **colon**
  convention itself (the existing `/api/forms/create` never sets a colon id), stamps `version`,
  `fileExists`→**skip** if present, else `serializeXlsForm` + write + `invalidateParsedForm`.
  Returns a per-file `written/skipped` report. **Do NOT call `maintainFormConstants`** (that helper
  is app-report-form specific). No `.xml` emitted (users run cht-conf).
- **Client:** offer it in the **Hierarchy editor** (the source of truth for types/person-flag/
  display-names/parents and the owner of the `create_form`/`edit_form` contract). A modal mirroring
  `LineageBuilder`'s **UI shape** (checklist of types with Person/Place badge; per-type create/edit
  toggles default-on; existing files shown disabled "exists — will skip"; a **live preview** of
  files-to-write vs skip + warnings like a parent-less place; a Generate button). **Offered, never
  auto** on hierarchy save. ⚠️ Reuse only the modal/checklist/preview **shape** — there is **no
  snapshot-undo** for filesystem writes (unlike `handleLineageCommit`'s in-editor splice); the toast
  reports written/skipped, no undo.

## 5. Tests
Structure-match per `(person/place × create/edit)` against the parsed real templates (or the §2-B
minimal spec, whichever is chosen) — including: exactly ONE `select-contact` in person-create init
(**assert no nested `parent` begin-group** — guards variant-B), doc group named for the type with
hidden `parent`(default=resolved)+`type`, required `name`/`sex`, edit-only hidden `_id`,
`read_only` on carried rows. **Choices completeness:** assert every `select_*` row's `list_name`
has a matching non-empty choices list in all project locales (catches the empty-choices failure).
**Round-trip:** `parse(serialize)` byte-stable + all groups balanced (`node --test` fixture +
smoke-parser per emitted file). **Determinism:** same input ⇒ byte-identical. **Pathing/id:**
basename passes `/^[a-zA-Z0-9_-]+$/`, `settings.form_id==='contact:<type>:create|edit'`.
**Skip-existing:** pre-existing file left byte-unchanged + reported skipped; second run is a no-op.
**Contract-closure:** a place type added via `AddTypeForm` gets files satisfying its
`create_form`/`edit_form` (person types get no such reference — justify the person path on its own).

## 6. Decisions (locked) + open
**Locked:** offered-not-auto (onboarding §Decision 4); both create+edit per type by default (per-type
toggle); skip-not-overwrite; new batch filesystem route (no false undo); colon `form_id` set in the
route; derive `place_type`/`generated_name`/`roles` from config; offered in the Hierarchy editor.
**Also locked:** generation depth = **minimal-valid + extensible** (§2); copy the static choice
lists (`male_female`, `yes_no`) **verbatim from the shipped templates** to preserve their 7 locales
(the only project-specific lists the minimal spec needs are none beyond those — `place_type`/`roles`/
`generated_name` are only required by the faithful/Hybrid blocks, so the project-derivation
requirement applies if/when those blocks ship).

**Deferred to the Hybrid follow-up (out of v1 scope under Decision B):** place primary-contact +
inline new-person, person-edit re-parent selectors, the ephemeral-DOB calculator, inline CHW
user-creation. The §1 reference + §3 non-negotiables (project-derived `place_type`/`roles`,
per-variant init appearance, all-place-type re-parent selectors) apply to those blocks when built,
not to v1.
