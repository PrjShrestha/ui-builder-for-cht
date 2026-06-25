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

## The size/coverage tradeoff — offline means "only what's vendored"
Full terminologies are huge (ICD-11 ~17k, LOINC ~100k) — vendoring all of them bloats the repo and the
in-memory index. So coverage is a deliberate choice:
- **Curated subset** (recommended default): a few hundred codes per dictionary, scoped to MCH/CHW use
  (observations for LOINC, conditions/diagnoses for ICD, CIEL for the rest). Offline, fast, covers the
  common cases. The long tail falls back to the raw-code escape hatch (B1 from the FHIR-triad punch list).
- **+ Online typeahead enrichment** (post-V1, the MVP's deferred V1.5): for the long tail, an optional
  live query to the same free APIs with a circuit breaker and a bundled fallback banner — only with the
  recorded-fixture contract gate the MVP types reserve. Bundled stays the source of truth.

## Verify the index scales
The picker builds an in-memory prefix/trigram index over the pack. Confirm it stays sub-50 ms search at
the chosen subset size (a few hundred–few thousand codes); if not, that's a small index tweak, not a
redesign.

## Tests
- Zero-SNOMED oracle green on the expanded pack (parsed + raw + alias).
- Snapshot script is **reproducible + version-pinned** (records source + version per system; re-running
  yields a deterministic, sorted pack — same determinism contract as the sidecar serializer).
- Picker e2e: each dictionary (LOINC/ICD-10/ICD-11/CIEL) shows >1 code and search returns matches;
  ICD-10 renders as "ICD-10", not a URL.

## Open product decision (yours)
**How much coverage, and online or not?** This sets the script's scope. Options below.
