<!--
Planner-locked feature plan. Step 2 (V1) of the Standard-codes/FHIR feature.
Parent/contract: docs/plans/fhir-standard-codes-mvp.md (v0.4) — the MVP shared/ slice shipped in
commit 880139d. This plan promotes that doc's "deferred V1" + Addendum Decisions 3-4 into a
developer-ready UI+route slice. Grounded against HEAD on 2026-06-15.
-->

# Plan: Standard codes (FHIR) — V1 mapping workbench

**Version:** v0.1 — 2026-06-15 · **Status:** PLANNER-LOCKED, developer-ready.
**Parent contract:** [fhir-standard-codes-mvp.md](./fhir-standard-codes-mvp.md) (v0.4). The MVP shared
module (`shared/src/fhir/`: types, key codec, parse/serialize, reconcile, starterPack, the
`cht-mch-v1.json` pack) **shipped in `880139d`** and is the foundation this slice consumes. Do not
re-decide the locked decisions (SNOMED off; vendored/offline; dictionary-per-mapping; sidebar
workbench below Deploy; question- AND choice-level).

> **Sequencing:** this is the "scope the next feature" deliverable; it is **not** yet handed to the
> dev. The dev's current queue is the survey-groups follow-ups + whatever the shipped-batch triad
> surfaces. Slot V1 after those unless the planner re-prioritizes.

## What shipped vs what V1 adds
- **Shipped (MVP, `880139d`):** the whole read-only `shared/src/fhir/` data layer + the bundled pack
  + round-trip/zero-SNOMED gate. **No UI, no route, no network** — by design.
- **V1 (this plan):** the **sidebar workbench** that is the mapping surface, its **server route**, the
  **two-step (dictionary → code) picker**, **starter-pack auto-apply**, question- + choice-level
  mapping, and the coverage indicator. Online typeahead stays **optional/deferred** (bundled pack is
  the source of truth — MVP Decision 2).

## V1 grounding checks (do these first)
1. **Pack multi-dictionary readiness (Decision 4).** The picker chooses LOINC / ICD-10 / ICD-11 / CIEL
   first. Verify whether the shipped `cht-mch-v1.json` already carries (a) entries across those systems
   and (b) an **enumerable "available dictionaries" list** the picker can read. If not, the first V1
   task is a **pure data/format extension** of the pack (+ `build-terminology-pack.mjs` to snapshot the
   extra systems) — not a schema change (`system`/`code`/`display`/`dictionaryVersion` already exist).
   Confirm **ICD-10 is present** (added in MVP plan v0.4).
2. **No false-orphan regression.** Every live-key the route computes MUST come from
   `encodeQuestionKey`/`encodeChoiceKey` (shared/src/fhir/key.ts) — never string concat (MVP §3 item 6).

## A. Server route — `server/src/routes/fhirMapping.ts` (new)
Mirror the existing route patterns (`forms`, `hierarchy`). Register in the server bootstrap alongside them.
- **GET `/api/fhir-mapping`** — read `fhir-mapping.json` at project root (absent → return an empty
  `FhirMapping`), run `reconcileFhirMapping(mapping, liveKeys)` where `liveKeys` are codec-built from
  every form's live rows, return `{ mapping, orphans }`.
- **PUT `/api/fhir-mapping`** — `serializeFhirMapping(next)`, **read existing bytes, compare, skip write
  if identical**, else **atomic tmp+rename** per `server/src/routes/hierarchy.ts:45-49`, write `'utf8'`
  no BOM. Inherits MVP round-trip contract items #3–#8. The first save of a foreign-formatted sidecar
  legitimately canonicalizes once — not a regression.
- **Optional GET `/api/fhir-mapping/forms`** — the list of mappable forms + their columns, or compute
  client-side from already-loaded forms; pick whichever avoids a second form fetch.

## B. Sidebar + view wiring
- **`client/src/state/store.ts`** — add `{ kind: 'standard-codes' }` to the `View` union (after
  `deploy`, [store.ts:21](../../client/src/state/store.ts#L21)) + the view-switch.
- **`client/src/ui/Sidebar.tsx`** — a `NavItem` **below Deploy** (per Decision 3), gated on a
  "project has mappable `app:*` forms" boolean; ship empty/loading/error states.

## C. The workbench — `client/src/ui/StandardCodesView.tsx` (new)
The single place codes are assigned (Decision 3). Flow:
1. **Pick a report** — dropdown, `app:*` forms first.
2. **Mappable columns table** — filter rows by the Simple-mode visible-row filter
   (`isHiddenInSimpleMode` / `computeSimpleHiddenRowIds` in `shared/src/xlsform/types.ts`) so it shows
   the ~clinically-meaningful subset, **not all 47** (PO/PM cold-start guard). The honest denominator
   ("12 / 19 mapped") comes from a single shared helper — add **`shared/src/fhir/coverage.ts`** with
   one canonical "mappable question" definition + a test, so the count never drifts.
3. **Map each row** — starter-pack pre-fills appear as **suggestions** (`status:'suggested'`,
   `confirmedBy:null`) with per-row **Accept / Change / Skip**, so the screen never opens cold.
4. **`select_*` rows expand to their options** — each option gets its own dictionary + code picker
   (choice-level, keyed `(formId, list_name, choice.name)`, stored in `choiceMappings`).
5. **Coverage + orphans** in the same screen; orphans are lossless and also logged in
   `DecisionsView.tsx` (MOH trail).

## D. The two-step picker (Decision 4)
1. **Dictionary first** — LOINC / ICD-10 / ICD-11 / CIEL (SNOMED never in the set; the zero-SNOMED
   guard applies to every dictionary).
2. **Search by clinical name** within that dictionary → pick the code. **No free-text code/path entry
   in the default flow** (Designer dealbreaker); a raw-entry escape hatch may exist but is not primary.
- Suggested vs confirmed are **visually distinct** (dashed/muted chip vs solid). Accept sets
  `status:'confirmed'` + `confirmedBy`; Skip sets `status:'skipped'` with zero penalty.
- Autocomplete is served from the **in-memory index over the bundled pack** (offline, <50ms). Online
  typeahead is **deferred** optional enrichment with a bundled fallback banner.

## Round-trip contract (inherited, non-negotiable)
- The route is the first **writer** of `fhir-mapping.json`; it MUST honor the MVP serializer
  (sorted keys, LF, trailing `\n`, no BOM), compare-before-write, atomic tmp+rename, and codec-built
  live keys. **No other file's bytes ever change.** Opening + leaving the workbench on an already-
  canonical sidecar is a byte-identical no-op.
- Auto-apply lands as `suggested`/`confirmedBy:null` — **never** as confirmed; re-apply MUST NOT
  overwrite a confirmed row's `confirmedBy` (MVP `applyStarterPack` already guarantees this — reuse it).

## Test plan
- **Route contract tests:** GET on absent sidecar → empty mapping; PUT canonicalizes + is a no-op on
  its own output; PUT never touches a non-sidecar byte; reconcile relocates orphans; a `/`-in-name
  binding is not false-orphaned (the codec live-key guard end-to-end).
- **coverage.ts unit:** the denominator matches the Simple-mode visible set; stable across re-parse.
- **Playwright e2e:** auto-apply pre-fills MCH bindings as drafts on first open; Accept one, Skip one,
  Change a dictionary and re-pick; a `select_*` row expands and a choice-level code is assigned;
  coverage updates; reload → confirmed/suggested/skipped survive; an orphan (renamed question) surfaces
  losslessly. Suggested-vs-confirmed visual states asserted.

## Persona gates (MVP plan §7 V1, restated)
- **PO/PM (Bhishan):** pack auto-applies + visibly pre-fills as drafts; one-click Accept/Change/zero-
  penalty Skip; honest "X of ~19" denominator (never "of 47"); plain-language "Standard codes",
  clinical-name-first; no code/path typing reaches the PO.
- **Designer (Lal):** suggested vs confirmed visually distinct; no free-text code/path in the default
  flow; sidebar item ships empty/loading/error states; open-and-leave is a byte no-op.
- **MOH reviewer:** coverage counts `confirmed` separately from `suggested`; every mapping shows
  code+system+display+source+dictionaryVersion; re-apply preserves `confirmedBy`; orphans logged in
  `DecisionsView`.

## Build order
1. **PR 1 — route + wiring:** `fhirMapping.ts` (GET/PUT, atomic, codec live keys) + store View +
   Sidebar entry + an empty `StandardCodesView` shell with loading/empty/error. Contract tests.
2. **PR 2 — the workbench core:** form picker → mappable-columns table (coverage.ts) → starter-pack
   auto-apply + Accept/Change/Skip + the two-step dictionary→code picker (question-level). Playwright.
3. **PR 3 — choice-level:** `select_*` expand-to-options + `choiceMappings` population + the ICD disease-
   option flow. (Pack multi-dictionary readiness from the grounding check must land by here.)
- Online typeahead (`terminologyClient.ts` + circuit breaker, the first `online:` producer) is a
  **later/optional** slice — only with the recorded-fixture contract gate the MVP types reserve.

## Open questions (carried from MVP §8; resolve before/at PR 2)
- **Sidebar position** — below Deploy is the locked default (Decision 3); confirm no card-sort needed.
- **Section name** — "Standard codes" (not user-tested; low-risk).
- **Pack governance / expansion** — who curates beyond the hand-crafted MCH v1 (WHO SMART vs Medic vs
  per-country). Blocks pack *expansion*, not V1 UI.
