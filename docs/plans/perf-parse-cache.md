<!--
Planner-locked perf plan. Two slow surfaces (Standard-codes mapping, project load) share one
root cause: uncached, eager parseXlsForm over many forms. Measured on config-nssd/chis (2026-06-25):
69 forms parse in ~7.2 s (~105 ms/form); no parsed-form cache exists.
-->

# Plan: Speed up project load + Standard-codes mapping (parsed-form cache)

**Version:** v0.1 — 2026-06-25 · **Status:** PLANNER-LOCKED, developer-ready.

## Measured root cause
- `parseXlsForm` costs **~105 ms/form**; **69 forms = ~7.2 s** (config-nssd/chis, cold).
- **No parsed-form cache** in the server — every request re-parses from disk.
- **`GET /api/fhir-mapping`** calls `buildLiveKeys`, which **parses ALL app+contact forms every time** ([fhirMapping.ts:74-115](../../server/src/routes/fhirMapping.ts#L74)) → ~7 s every time the Standard-codes workbench loads.
- **Project open** eagerly parses contact forms for choice maps ([project.ts:83-89](../../server/src/routes/project.ts#L83)).

## Fixes, by leverage

### Tier 1 — Server parsed-form cache (the 80/20; fixes both surfaces)
Add `getParsedForm(absPath): Promise<XLSForm>` that caches by **`(absPath, mtimeMs, size)`**:
- On call, `fs.stat` the file; if the key matches the cached entry, return it; else `parseXlsForm` and store.
- `stat` is ~sub-ms, so a warm read goes **~105 ms → ~1 ms**. External edits change `mtime` → automatic re-parse (no staleness).
- **Bust on our own writes:** `saveForm` (and any route that writes a form) deletes/refreshes that path's entry after write (belt-and-suspenders; the mtime key already covers it).
- **Route ALL parse call sites through it:** `forms.ts:272`, `fhirMapping.ts:93` (`buildLiveKeys`), `project.ts:87`. Single chokepoint.
- **Round-trip safety (must-hold):** the cache is **read-only**. Consumers that mutate (the editor's save path sends a full `XLSForm` from the client; the server serializes *that*, not the cached object) must never mutate a cached parse in place. Return a frozen object or document "treat as immutable"; serialization always works from the caller's form, so the cache never feeds a stale serialize. A `node --test` pins: edit→save busts the entry; a re-read after an external mtime change re-parses.

### Tier 1b — Cache the *derived* artifacts too
Even with per-form caching, `buildLiveKeys` still iterates + encodes all forms each GET. Cache its **result** keyed by a cheap **forms-dir signature** (sorted `name:mtime:size` list of `forms/app` + `forms/contact`): if the signature is unchanged, return the cached `liveKeys` set. Same for the project's `contactFieldChoices`. Warm FHIR GET and project load become **near-instant**.

### Tier 2 — Cold-start (first load is still ~7 s)
The cache fixes *repeat* loads; the first one still pays the parse. Two independent levers:
1. **Names-only fast path for `buildLiveKeys`.** Live keys need only row `name` + choice `(list_name, name)` — not the full round-trip parse (extras, column maps, etc.). A lightweight extractor that reads just those two sheets/columns should be **several× faster** than `parseXlsForm`. (Keep full parse for the editor; the fast path is reconcile-only.)
2. **Don't block project open on parsing.** Defer/lazy-load: open the project instantly (read settings + list form filenames only); compute `contactFieldChoices` **on first need** (first form edit) or in a background warm-up, not synchronously on open. The condition builder is the only consumer and it isn't on the project-overview screen.
- Optional, heavier follow-up: a small **worker-thread pool** for true-parallel cold parsing (xlsx parse is CPU-bound, so `Promise.all` on one thread doesn't actually parallelize it). Only if cold-start still hurts after Tier 1+2.

### Tier 3 — Frontend perceived perf
- Workbench: ensure it fetches `/api/fhir-mapping` **once** per open (not on every keystroke/interaction); show a skeleton/progress state for the cold case.
- Project overview: render immediately from the filename list; stream in per-form details as they resolve.

## Suggested order
Tier 1 (cache) → Tier 1b (derived caches) → measure. If cold-start still hurts: Tier 2.1 (names-only `buildLiveKeys`) + Tier 2.2 (lazy project open). Tier 3 alongside.

## Targets & instrumentation
Add timing logs around the parse chokepoint and the two routes. Targets on chis (69 forms): **warm `GET /api/fhir-mapping` < 200 ms** (from ~7 s); **warm project open < 500 ms**; **cold** FHIR GET roughly halved by the names-only path. Capture before/after numbers in the PR.

## Safety / scope
- **No parser or serializer behavior change** — purely a caching/lazy layer + a read-only fast extractor. The round-trip invariant is untouched as long as the cache is never mutated and the editor keeps serializing from the client-supplied form.
- A stale-cache bug would be a correctness hazard (serializing old bytes), so the mtime-key + bust-on-write + a regression test are mandatory, not optional.

## Persona notes
- **Bhishan (PO/PM):** 7 s to open Standard codes (and slow project loads) reads as "frozen/broken" — the cold-start abandonment trigger. Warm-instant + a skeleton state fixes the felt experience.
- **Developer:** single `getParsedForm` chokepoint keeps it simple; mtime-keying avoids manual invalidation bugs.
- **QA (Lorena):** the cache-invalidation regression test (edit→save busts; external mtime change re-parses; no stale serialize) is the critical-path guard — a stale cache could silently corrupt a round-trip.
