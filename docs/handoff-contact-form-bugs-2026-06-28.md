<!--
Dev handoff for two bugs found during the pregnancy-tracker POC review
(docs/reviews/POC_status_Cht_pregnancy_development.md). Both verified against the
shipped cht-default reference forms. Planner-authored; fixes are dev work (client +
shared production code). 2026-06-28.
-->

# Dev handoff — two contact-form bugs (2026-06-28)

Found while reviewing a generated `district-create.xlsx` for the pregnancy-tracker
POC. Both reproduced/confirmed against the **cht-default** reference forms
(`server/templates/cht-default/forms/contact/{person,PLACE_TYPE}-create.xlsx`).
Priority: **Bug A (functional) before Bug B (cosmetic-but-footgun).**

> **Do NOT act on the third-party "validity review" the user was given.** It claimed
> three issues — (1) `type` default should be empty, (2) `inputs` needs
> `relevant: ./source = 'user'`, (3) `relevant=false()` breaks the calculates. **All
> three are wrong**: cht-default sets `type`/`place_type` via `default`, and its
> contact-create `inputs` group ships **`relevant=false()`** with the *same* meta
> calculates reading `inputs/user/*`. That review applied app/report-form rules to a
> contact form. The generated form is otherwise valid and matches cht-default.

---

## Bug A — generator emits `created_by*` with an off-by-one XPath (FUNCTIONAL)

**File:** `shared/src/xlsform/buildContactForm.ts` — the `meta` sub-group calculates
(create: `created_by`, `created_by_person_uuid`, `created_by_place_uuid`, ~lines
282–293; edit: `last_edited_by*`, ~301–307).

**Symptom:** every contact created via a generated form gets **empty** `created_by`,
`created_by_person_uuid`, `created_by_place_uuid` (and edit forms get empty
`last_edited_by*`) — a silent audit-trail gap.

**Root cause:** the calculate path is one level too shallow. The field sits at
`/data/<type>/meta/created_by`. The generator emits:
```
calculation: ../../inputs/user/name        // resolves to /data/<type>/inputs/... → does NOT exist
```
It needs **three** hops (`meta → <type> → data`, then `inputs/user/name`):
```
calculation: ../../../inputs/user/name      // correct
```
**Evidence:** cht-default `person-create.xlsx` has the identical `person › meta ›
created_by` nesting and uses **`../../../inputs/user/name`**. The bug is also visible
in the user's `district-create` screenshot (`created_by → ../../inputs/user/name`).

**Fix:** change all five meta calculations in `buildContactForm.ts` from
`../../inputs/...` to `../../../inputs/...` (create: name / contact_id / facility_id;
edit: name / contact_id).

**Why round-trip tests missed it:** they assert parse→serialize stability, not XPath
correctness. Add a direct assertion:
- **`node --test` in shared** — build a create form and assert each meta calc equals
  the expected `../../../inputs/user/<field>` string (and the edit form's
  `last_edited_by*`). One-liner per row; deterministic.
- Optional: a `cht-conf convert` smoke (pyxform) on an emitted form if a local
  toolchain is handy — the bad path would otherwise only show at runtime.

---

## Bug B — editor classifies a bare `string` field as "Select contact" (DISPLAY FOOTGUN)

**Files:** `client/src/ui/QuestionTypeCatalog.ts` — `findTileForRowType` (~384–403);
the `text` tile (`xlsformType: 'text'`, ~52–59); `select_contact`
(`xlsformType: 'string'`, ~260–268) and `mrdt_verify` (`xlsformType: 'string'`,
~280–288).

**Symptom:** any field with `type: string` and no special appearance renders with the
bold **"Select contact"** tile (sub-label `string`). Seen on the generated
`district-create` name field; **affects every `string` field in every form** — CHT
uses `string` heavily (cht-default name/short_name/external_id/notes are all
`string`).

**Root cause:** the **Text** tile is registered as `xlsformType: 'text'`, so a
`string` row never matches it. The only `'string'` tiles are `select_contact` and
`mrdt_verify` — both carry a `defaultExtras.appearance`. In `findTileForRowType`, a
bare `string` (empty appearance) matches `[select_contact, mrdt_verify]`, the
appearance-match (`withApp`) fails, and the no-appearance fallback
(`matches.find(m => !m.defaultExtras?.appearance)`) is `undefined` → returns
`matches[0]` = **`select_contact`**.

**Severity:** cosmetic (the saved `type` stays `string`), **but a footgun** — if a
user re-picks the type from the mislabeled tile, the editor would stamp
`appearance: select-contact type-person` onto a plain text field and corrupt it.

**Fix (pick one):**
- Make the **Text** tile recognize a bare `string` (e.g. an `aliases: ['string']`
  on the tile, consulted by `findTileForRowType`), **or**
- In `findTileForRowType`, when `baseType === 'string'` and the appearance contains
  neither `select-contact` nor `mrdt-verify`, return the **Text** tile.
- Either way: `select_contact` / `mrdt_verify` must only win when their appearance is
  actually present.

**Tests:**
- **Unit** (`findTileForRowType`): `('string','')` → Text; `('string','select-contact
  type-person')` → select_contact; `('string','mrdt-verify')` → mrdt_verify;
  `('text','')` → Text (unchanged).
- **Playwright:** open a generated contact form, assert the `name` row shows **Text**,
  not "Select contact".

---

## Context
- Surfaced in the pregnancy-tracker POC: `docs/reviews/POC_status_Cht_pregnancy_development.md`.
- The legitimate `select-contact` field in generated forms is the **person**
  create form's `_id_placement` ("Place this person under") — that one is correct and
  must stay select-contact. Don't touch it.
