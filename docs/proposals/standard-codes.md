# Proposal: Standard codes (FHIR / terminology mapping)

**Status:** drafted 2026-06-05, **not yet squad-approved**. Output of a
9-agent feasibility workflow (5 discovery + 3 persona + 1 synthesis).

**Author's note:** every recommendation below has a "why" rooted in
either persona reaction, license research, or repo invariant — don't
strip those when iterating.

---

## 1. Feasibility verdict

**Yes, with three named caveats.** The artifact-side discovery is clean:
every mappable thing (`SurveyRow.name`, `ChoiceRow` keyed by
`(formId, list_name, name)`, contact/place types) already has a stable
identifier the existing parsers produce, and the data lives in a
brand-new sidecar file we fully own — so the round-trip invariant is
automatic rather than at risk.

The hard parts are product and licensing, not technical:

1. **MVP only works if it ships with a starter pack.** Bhishan won't map
   47 questions from cold. Confirmed in persona check: *"If the section
   opens with 47 empty rows and a picker per row, I close the tab."*
2. **SNOMED CT must be off by default.** Nepal is World Bank
   lower-middle-income (FY26) → no SNOMED low-income waiver. Shipping
   SNOMED globally would put every adopter on the hook for an annual
   MLDS affiliate license + Statement of Usage. SNOMED exposed only via
   opt-in "Add a terminology server" advanced setting.
3. **Reject CommCare's JSONPath text-box approach.** Their FHIR Data
   Dictionary literally tells users to "practice on jsonpath.com first."
   Same JSON-editing trap we already rejected for relevance expressions.

## 2. Sidebar position + name

**Name: "Standard codes."** Not "Terminology mapping" (jargon), not
"FHIR mapping" (FHIR is invisible plumbing to a DHO). Tooltip: *"Attach
LOINC, ICD, or SNOMED codes so this data can be shared with national
health systems."*

**Position: between Decisions and Deploy.**

```
Overview / Hierarchy / Forms / Tasks / Contact summary / Decisions / Standard codes / Deploy
```

Reasoning: sidebar order is a workflow narrative — design data → define
logic → **prepare for the outside world** → ship. Below Deploy buries
it; before Decisions intrudes before the form is stable. The user's
original sketch placed it below Deploy; the synthesis disagrees and
recommends above. This is a squad decision.

**Primary editing surface is inline on the question's edit panel** in
Forms (DHIS2 pattern: codes live next to the data element they
describe), with a chip on the question row. The sidebar section is a
**review dashboard + orphan resolver**, not the place codes are first
typed.

## 3. Three-tier phasing

### MVP (this sprint) — "Review the starter pack"

- **Scope.** Read-only sidecar + inline picker on `app:*` form
  questions only. Filter candidates with `SIMPLE_MODE_VISIBLE_TYPES`
  (excludes `calculate`, `note`, `hidden`, metadata) so the denominator
  is honest — ~19 mappable rows in pregnancy, not 47. Ship a WHO
  SMART-Guideline / CIEL MCH starter pack that pre-fills the obvious
  bindings (LMP, BP, weight, fundal height, danger signs,
  parity/gravidity). Review-and-confirm flow only: "Accept" / "Change"
  / "Skip" per row. Dashboard shows per-form coverage of *clinically
  meaningful* questions.
- **File artifacts touched.** New: `fhir-mapping.json` at project root
  (sidecar), `shared/src/fhir/` (parser, serializer, types, key
  derivation, starter-pack importer),
  `shared/src/fhir/starter-packs/cht-mch-v1.json` (bundled). Modified:
  `client/src/ui/forms/QuestionEditor.tsx` (inline "Standard codes"
  panel), `client/src/ui/sidebar/Sidebar.tsx` (new entry),
  `server/src/routes/fhirMapping.ts` (GET/PUT sidecar).
- **Terminology sources.** Bundled offline only — CIEL MCH (~500
  concepts with LOINC/ICD-11 cross-maps) + LOINC top ~300 MCH codes +
  ICD-11 pregnancy chapter (~150). ~1.5–2 MB gzipped, shipped in
  `shared/`. No network.
- **Validation level.** Schema validation on read/write.
  Stale-mapping detection (orphans go to an "Unresolved mappings" tab,
  soft-deleted with undo, logged in Decisions). Round-trip test on
  `fhir-mapping.json` against gandaki fixture. Playwright happy-path +
  orphan flow.

### V1 (next sprint) — "Find a code I didn't get from the pack"

- **Scope.** Typeahead picker against a live terminology API for the
  long tail. Search by clinical name only ("last menstrual period"),
  never code number. Show `Display · LOINC 8665-2` with the code
  de-emphasized. Add choice-level mapping for `select_one` /
  `select_multiple` keyed by `(formId, list_name, choice.name)`.
  Suggest-a-code button that fuzzy-matches question label against the
  bundled pack and offers top 3 with confidence. Filter chips:
  `unmapped`, `low-confidence`, `clinically-reviewed`.
- **File artifacts touched.** New:
  `shared/src/fhir/terminologyClient.ts` (versioned response adapters,
  circuit breaker), `client/src/ui/fhir/CodePicker.tsx`, fixtures under
  `shared/src/fhir/__fixtures__/`. Modified: sidecar schema gains
  `choiceMappings[]` and `dictionaryVersion`/`source` per entry;
  question-row chip and Forms-list rollup.
- **Terminology sources.** Hybrid. Bundled pack remains source of
  truth and primary search index (sub-50 ms). Online enrichment via
  **NLM Clinical Tables** (free, no auth, 50 req/s soft cap) for LOINC
  + ICD-11, **OCL** for CIEL with deployer-supplied token. tx.fhir.org
  as opt-in fallback. SNOMED still off.
- **Validation level.** Contract tests against recorded fixtures
  (happy / paginated / 429 / malformed) for every default source.
  Circuit breaker (5 fails / 30 s) trips to bundled-only with a visible
  "LOINC API unreachable — using bundled subset (v2.82)" banner.
  Dictionary-version drift banner on project open. Nightly live-API
  job, non-blocking.

### V2 (later) — "Generate the FHIR Questionnaire"

- **Scope.** Contact-type / place-type mapping (Patient, Location).
  Per-question FHIR target-resource + target-path picker
  (Observation.code vs Condition.code etc.) — structured dropdowns,
  never JSONPath. Export a FHIR `Questionnaire` resource from the
  XLSForm + mappings, with `sdc-questionnaire-itemExtractionContext`
  and per-item `definition` pointers so a downstream mediator can
  `$extract` Observations/Conditions without touching cht-conf.
  "Standard codes ready" green ribbon on Deploy when all clinically
  meaningful questions are coded.
- **File artifacts touched.** New:
  `shared/src/fhir/questionnaireBuilder.ts`,
  `shared/src/fhir/sdcExtensions.ts`, export endpoint
  `server/src/routes/fhirExport.ts`. Sidecar schema gains `fhirResource`
  + `fhirPath` per entry.
- **Terminology sources.** Same as V1, plus optional
  deployer-configured tx server (OntoServer, licensed SNOMED tx).
  StructureMap-based extraction explicitly out of scope.
- **Validation level.** Generated Questionnaire validated against the
  SDC profile. Golden-file snapshot tests for the gandaki export.

## 4. Sidecar file shape

`fhir-mapping.json` at project root. Net-new, fully owned, sorted-key
deterministic serialization, LF endings, trailing newline, 2-space
indent. Unknown fields preserved verbatim across versions (XLSForm-extras
rule).

```json
{
  "schemaVersion": 1,
  "starterPack": { "id": "cht-mch-v1", "appliedAt": "2026-06-05T10:30:00Z" },
  "questionMappings": {
    "app:pregnancy/lmp_date": {
      "code": "8665-2",
      "system": "http://loinc.org",
      "display": "Last menstrual period start date",
      "source": "starter-pack",
      "dictionaryVersion": "LOINC-2.82",
      "confirmedBy": null,
      "confirmedAt": null
    },
    "app:pregnancy/fundal_height_cm": {
      "code": "11881-0",
      "system": "http://loinc.org",
      "display": "Fundal height by tape measure",
      "source": "starter-pack",
      "dictionaryVersion": "LOINC-2.82",
      "confirmedBy": null,
      "confirmedAt": null
    }
  },
  "choiceMappings": {},
  "orphans": []
}
```

Keys are the parser-proven stable shape: `(formId, name)` for questions,
`(formId, list_name, choice.name)` for choices. `confirmedBy: null`
distinguishes "starter-pack pre-fill, not yet reviewed" from "Bhishan
signed off." `source` is one of `starter-pack` / `manual` /
`online:<sourceId>`. SNOMED entries only appear when deployer adds a tx
server; default build never writes one.

## 5. Terminology source decision

**Starter dictionary:** CIEL MCH pack + LOINC top-300 + ICD-11 pregnancy
chapter. Hybrid: **bundled-first, online-fallback.**

- Bundled pack is ~1.5–2 MB gzipped, shipped inside `shared/`, indexed
  with a prefix/trigram index in-memory. Sub-50 ms autocomplete, zero
  network — only latency budget that survives a flaky link.
- CIEL is the primary source because it ships LOINC/SNOMED/ICD
  cross-maps as concept attributes — search "fundal height," pick one
  concept, LOINC code comes along for free (OpenMRS lesson: never type
  a code).
- Online APIs are enrichment, not the default. **NLM Clinical Tables**
  (free, no auth, no registration, 50 req/s soft cap, 50,000/day) for
  LOINC + ICD-11 long tail. **OCL** for CIEL when deployer supplies a
  token. tx.fhir.org as opt-in fallback.
- **SNOMED CT off by default.** Nepal does not qualify for SNOMED
  low-income waiver under World Bank FY26. Shipping SNOMED in the
  picker would put every adopter on the hook for an annual affiliate
  license + Statement of Usage. CI assertion: bundled pack contains
  zero SNOMED codes.

## 6. Round-trip safety contract

This feature promises NOT to:

1. Touch any XLSX, properties.json, or base_settings.json byte. No
   mapping metadata stored in XLSForm `extras`.
2. Mutate `tasks.js`, `contact-summary.templated.js`, or
   `place-types.json`. Codes live exclusively in `fhir-mapping.json`.
3. Reorder or drop unknown JSON fields in `fhir-mapping.json` on save.
4. Bump mtime on save-without-edit. A no-op open/save produces
   byte-identical output.
5. Silently drop orphaned mappings when a question is renamed or
   deleted. Orphans move to `orphans[]` with undo + Decisions log entry.
6. Write a mapping the user did not confirm. Starter-pack pre-fills
   land with `confirmedBy: null`; they count as "pending review," not
   "mapped."

Gated in CI by: round-trip test on populated `fhir-mapping.json` against
gandaki, smoke-parser sidecar-stability assertion, existing
`pnpm typecheck` + `pnpm lint --max-warnings=0`.

## 7. Top 5 risks + mitigations

1. **Cold-start abandonment.** Bhishan closes the tab if MVP ships
   without a starter pack. *Mitigation:* MVP gated on the CIEL/LOINC/
   ICD-11 MCH pack landing in `shared/` and auto-applying on first
   open. No standalone "pick a code from scratch" UX in MVP.
2. **SNOMED license trap.** Default SNOMED would obligate every adopter
   to an annual affiliate license under MLDS. *Mitigation:* CI
   assertion that bundled pack contains zero SNOMED codes; SNOMED
   exposed only via deployer-configured tx URL in advanced settings;
   no SNOMED references in default UI copy.
3. **Mapping rot when question names change.** Rename `lmp_date` and
   the LOINC binding orphans silently. *Mitigation:* on form load,
   reconcile `fhir-mapping.json` keys against the live XLSForm;
   orphans land in an "Unresolved mappings" tab with undo + Decisions
   log entry; soft-delete only.
4. **CommCare-style JSONPath regression.** Future temptation to expose
   `fhirPath` as a text box. *Mitigation:* V2 target-path picker is a
   structured cascading dropdown (resource → element), no free text.
5. **Online API outage masquerading as missing codes.** NLM or OCL
   down, user thinks the code doesn't exist. *Mitigation:* circuit
   breaker (5 fails / 30 s) trips to bundled-only with a visible
   "LOINC API unreachable" banner; last-success timestamp on the
   source; never silent retries.

## 8. Next concrete deliverable

This week, ship a **read-only `shared/src/fhir/` module** — no UI yet:

1. `FhirMapping` type.
2. `parse` / `serialize` with sorted-key deterministic output.
3. `node --test` round-trip case mirroring
   `shared/src/tasks/appliesIfParser.roundtrip.test.ts`.
4. `starter-packs/cht-mch-v1.json` hand-crafted to cover LMP + BP +
   weight + fundal height on `app:pregnancy`.
5. Smoke-test extension: `node scripts/smoke-parser.mjs
   <project>/fhir-mapping.json` returns `Round-trip stable: YES`.

That gives a checkable artifact before any sidebar pixel moves, and
it's the safest possible first commit — pure `shared/`, no client/server
surface, no terminology service decisions baked in yet.

## 9. Open questions for the squad

- Sidebar position: between Decisions and Deploy (synthesis) vs below
  Deploy (user's original sketch). Synthesis-recommended position is
  not yet locked.
- Section name: "Standard codes" is the recommendation; not user-tested
  yet.
- SNOMED licensing policy: confirm "off by default" is acceptable to
  the Medic-internal stance (no published stance found during
  discovery — see *Prior art* below).
- Starter-pack governance: who curates the CIEL/LOINC MCH pack? WHO
  SMART Guidelines IG? Medic-curated? Per-country override?
- Whether to align the sidecar shape with a future FHIR `ConceptMap`
  resource for portability.

## 10. Prior art notes (from workflow discovery)

- **Medic ships** [medic/cht-interoperability](https://github.com/medic/cht-interoperability)
  — TypeScript mediator over OpenHIM. **No declarative mapping
  config** — mappings are hand-coded TS. So we are not bound to mirror
  an existing Medic format.
- **No CHT community project** has done form-field → terminology
  mapping before. This is a real gap.
- **No published Medic stance** on LOINC vs SNOMED vs local concept
  dictionary. The proposal's default (LOINC-primary for observations,
  CIEL for cross-maps, SNOMED behind opt-in) is reasoned, not
  inherited.
- **OpenMRS O3 Form Builder** is the closest UX precedent: search by
  clinical name, pick concept, codes attach automatically via CIEL
  cross-maps. Strongest model to copy.
- **CommCare's FHIR Data Dictionary** uses JSONPath text boxes. Strong
  *negative* example — we deliberately reject this.
- **DHIS2** stores codes as Attributes on data elements (inline with
  the question they describe). Strongest model for the inline editing
  surface; their pre-mapped Implementation Guide packs are the model
  for the starter-pack approach.

## 11. Sources

- [FHIR R4 Observation](https://hl7.org/fhir/R4/observation.html)
- [FHIR Observation example: LMP](https://www.hl7.org/fhir/observation-example-date-lastmp.json.html)
- [LOINC 8665-2 — Last menstrual period start date](https://loinc.org/8665-2)
- [HL7 SDC — Form Data Extraction](https://www.hl7.org/fhir/uv/sdc/STU3/extraction.html)
- [LOINC license](https://loinc.org/downloads/)
- [NLM Clinical Tables LOINC API](https://clinicaltables.nlm.nih.gov/apidoc/loinc/v3/doc.html)
- [SNOMED CT licensing](https://www.nlm.nih.gov/healthit/snomedct/snomed_licensing.html)
- [SNOMED Affiliate License (non-member)](https://ihtsdo.freshdesk.com/support/solutions/articles/4000217735)
- [ICD-11 license (CC BY-ND 3.0 IGO)](https://icd.who.int/docs/icd-api/license/)
- [Open Concept Lab terminology service](https://openconceptlab.org/terminology-service/)
- [CIEL dictionary (OpenMRS)](https://openmrs.atlassian.net/wiki/spaces/docs/pages/25472353/The+MVP-CIEL+Concept+Dictionary)
- [medic/cht-interoperability](https://github.com/medic/cht-interoperability)
- [CHT Interoperability docs](https://docs.communityhealthtoolkit.org/building/interoperability/overview/)
- [OpenMRS O3 Form Builder](https://o3-docs.openmrs.org/docs/forms-in-o3/build-forms-with-o3-form-builder.en-US)
- [CommCare FHIR Integration](https://commcare-hq.readthedocs.io/fhir/index.html)
- [DHIS2 FHIR Adapter](https://github.com/dhis2/dhis2-fhir-adapter/blob/master/README.md)
