<!--
Planner-locked plan. The Standard-codes pickers show only ~1 code for ICD-11/ICD-10/CIEL because the
bundled pack is a 10-concept hand-crafted MCH sample (7 LOINC + 1 each ICD-11/ICD-10/CIEL) and the
MVP-Decision-2 snapshot script (build-terminology-pack.mjs) was never built. Grounded 2026-06-25.
-->

# Plan: Populate the Standard-codes dictionaries (build-terminology-pack.mjs)

**Version:** v0.1 — 2026-06-25 · **Status:** PLANNER-LOCKED (one product decision open — see end).

## Symptom → cause
The two-step picker derives its dictionary list and its searchable codes **entirely from the bundled
pack** ([cht-mch-v1.json], offline-vendored — MVP Decision 2: no runtime API pulls). That pack has
**10 concepts**: 7 LOINC, **1 ICD-11, 1 ICD-10, 1 CIEL**. So ICD-11/ICD-10/CIEL each show ~one code.
The fix isn't in the UI — it's that **the dictionaries were never populated**, and
`scripts/build-terminology-pack.mjs` (MVP Decision 2) **does not exist**.

## Approach — build the snapshot script (developer-run, offline output)
Per MVP Decision 2: a one-shot, developer-run script that hits the **free** sources, filters to a
curated subset, pins versions, and writes the committed pack. The app still reads only the vendored
JSON at runtime (offline, fast autocomplete) — the script is just how we *refresh* it.

`scripts/build-terminology-pack.mjs`:
- **LOINC** → NLM Clinical Tables (`clinicaltables.nlm.nih.gov/api/loinc_items`) — free, no auth.
- **ICD-10** → NLM Clinical Tables `icd10cm_items` — free, no auth. (Note: that's ICD-10-**CM**; if WHO
  ICD-10 is required for Nepal/MoH, source from WHO instead — decide per the MoH coding standard.)
- **ICD-11** → **WHO ICD-11 API** (`id.who.int/icdapi`) — free but needs a registered client_id/secret
  (OAuth token). *(Correction to the MVP plan, which said NLM carries ICD-11 — it does not.)*
- **CIEL** → OCL (`api.openconceptlab.org`, CIEL source) — free API.
- Pin `dictionaryVersion` per system (e.g. `LOINC-2.78`, `ICD11-2024-01`, `ICD10CM-2025`, `CIEL-<date>`).
- **Zero-SNOMED filter is mandatory:** CIEL ships SNOMED cross-maps; the script must drop any
  `system === snomed` and any SNOMED-sourced `alias`/text. The existing `node --test` oracle
  ([roundtrip.test.ts] scanForSnomed: parsed + raw bytes + alias free-text) must stay green on the
  expanded pack — run it as the script's acceptance gate.
- Keep the committed pack format unchanged (`{ questionName, code, system, display, dictionaryVersion,
  aliases }`), and keep `NOTICE.md` attribution current (LOINC license notice; ICD-11 CC BY-ND →
  display strings verbatim; WHO ICD-10 / CIEL terms per their licenses).

## Two real sub-issues to fix alongside
1. **The pack mixes question-pre-fills with dictionary codes.** Today every concept carries a
   `questionName` (it's an MCH *starter pack* — suggestions keyed to specific questions). A *dictionary*
   (searchable code list) is a different shape: many codes per system, **not** tied to a question. The
   picker should search a **dictionary corpus** (system → [{code, display, aliases}]) independent of the
   per-question starter suggestions. Decide whether to (a) add a separate `dictionaries` block to the
   pack the picker searches, keeping `concepts[]` as the question pre-fills, or (b) keep one list and let
   `questionName` be optional. **(a) is cleaner** and avoids overloading one array.
2. **ICD-10 raw-URL label** (FHIR-triad H1): the lone ICD-10 entry uses `http://hl7.org/fhir/sid/icd-10`,
   which `systemLabel` doesn't recognize → renders the bare URL. Align the script's ICD-10 `system` to
   the canonical URL `systemLabel` expects (or extend `systemLabel`) — folds into this work.

## Decision (locked, 2026-06-25): BROAD vendored — full-ish dictionaries, offline
Vendor large slices of each system (WHO ICD-11 MMS ~17k, ICD-10, a LOINC observation slice, CIEL),
fully offline. **This changes the architecture** — you can no longer ship one JSON the client indexes on
open (17k+ codes per dictionary would re-create the exact slowness we're fixing). So:

### Separate the data + move search server-side
- **Starter pack stays small.** `cht-mch-v1.json` keeps only the per-question MCH *suggestions* (the
  `concepts[]` with `questionName`). The **dictionaries are a separate, large, vendored dataset** — e.g.
  `shared/src/fhir/dictionaries/{loinc,icd10,icd11,ciel}.<compact>` — never loaded into the client wholesale.
- **New server search endpoint:** `GET /api/fhir/dictionary/search?system=<sys>&q=<text>&limit=50`. The
  server **lazily** loads the requested dictionary on first query, builds a prefix/token index **once**,
  **caches it in memory**, and returns the top matches. The client fetches *matches*, not the corpus.
- **Picker change:** the two-step picker's step 2 switches from "filter the in-memory bundled pack" to
  "query the search endpoint (debounced)." The dictionary *list* (step 1) can still be a tiny static
  manifest. This keeps the workbench **open** fast (it loads zero dictionary data up front) and search
  fast (server-indexed, paginated) — reconciling broad coverage with the perf goal.
- **Reuse the parse-cache discipline** ([perf-parse-cache.md](./perf-parse-cache.md)): the dictionary
  index is built once and cached, same spirit as the form cache.

### Storage + repo size
Full-ish dictionaries are tens of MB. Store **compact** (newline-delimited `code\tdisplay\taliases`, or
minimal JSON; optionally gzip and decompress at index-build). Keep them in a clearly-separated dir so
diffs/reviews aren't drowned. Note the repo-size cost up front (it's the accepted trade for offline
completeness). `.gitattributes` (marking them generated/vendored) is worth adding.

### Zero-SNOMED at scale
The oracle currently scans the whole pack (parsed + raw bytes) every test — over tens of MB that's slow.
Run the **full** zero-SNOMED scan once **inside the snapshot script** (the build gate), and keep a
**fast sampled/structural** check in the unit suite so CI stays quick. The filter still strips any SNOMED
system/OID and SNOMED-sourced CIEL aliases at build time.

## ICD-10 source — confirm with MoH
WHO **ICD-10** vs US **ICD-10-CM** are different code sets. NLM Clinical Tables gives ICD-10-CM for free;
WHO ICD-10 is the international standard MoH-Nepal likely expects. **Confirm the coding standard with the
MoH/clinical owner before snapshotting** — re-pulling later is cheap, but mappings authored against the
wrong ICD-10 variant are not.

## Tests
- Zero-SNOMED oracle green on the expanded pack (parsed + raw + alias).
- Snapshot script is **reproducible + version-pinned** (records source + version per system; re-running
  yields a deterministic, sorted pack — same determinism contract as the sidecar serializer).
- Picker e2e: each dictionary (LOINC/ICD-10/ICD-11/CIEL) shows >1 code and search returns matches;
  ICD-10 renders as "ICD-10", not a URL.

## Status
Coverage decision **locked: broad vendored** (above). Remaining input needed before snapshotting:
the **ICD-10 variant** (WHO vs CM) from the MoH/clinical owner. Everything else is developer-ready.
