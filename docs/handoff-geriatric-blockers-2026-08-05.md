<!--
Dev handoff for the 3 PO-greenlit items that flip the geriatric no-code buildability
verdict from NO to YES. Source audit: docs/reviews/geriatric-nocode-buildability-2026-08-05.md
(run against HEAD 9520942). 2026-08-05.
-->

# Handoff — geriatric buildability blockers (3 items, PO-greenlit 2026-08-05)

**Goal:** flip the QA verdict (`docs/reviews/geriatric-nocode-buildability-2026-08-05.md`) from NO to YES. These three account for the 1 hard gap + 26 of the 31 friction rows. Build in this order.

## 1 · Choice-value dropdowns in the two rule-builder modals  (flips 26 rows)

**Problem:** the in-form condition builder already offers a **choice-value dropdown** (`FormEditor.tsx:3147` area) — but the two modal builders never got it, so users hand-type auto-generated choice slugs (e.g. `फेल`'s slug) exactly where the no-code bar forbids it:
- `AppliesIfBuilder.tsx:360` — the report_field rule's value is a bare `<input>`. Hits **all 18 geriatric tasks** ("if फेल selected for X").
- `RelevantRuleBuilder.tsx` — comparison / selected / contact-summary rule values are free-typed. Hits the follow-up form's 8 cross-form relevance rows.

**Design:**
- When the picked field is a `select_one`/`select_multiple`, render the value as a **dropdown of that field's real choices** (label shown, name stored) with a "custom…" escape to the raw input. Non-select fields keep the plain input.
- **AppliesIf side:** `ReportFieldPicker` already knows the source form. Extend the fields fetch (`useReportFormFields.ts` / its server endpoint) to return `{name, type, choices?: {name, label}[]}` per field instead of bare names — the server already parses the form, so this is exposure, not new parsing.
- **Relevant side:** for in-form fields the choices are already client-side (same data the `FormEditor.tsx:3147` dropdown uses — reuse it). For contact-summary refs, the bridge metadata knows source form + field → same extended fetch as above.

**Acceptance:** building the geriatric task condition "IHA form's `<field>` = फेल" and the follow-up's "referral was triggered for section X" requires **zero typing**. Emitted expressions byte-identical to what the typed path produced (values are the same strings — no serializer change). Choice labels display localized; the stored value is the choice `name`.

**Tests:** unit on the extended fields fetch (select field → choices present, text field → none); e2e: open appliesIf builder → pick report field → value dropdown lists the form's real choices. Existing round-trip suites unchanged (no serializer edits).

## 2 · Display-image support  (kills the only hard GAP)

**Problem:** IHA R11 (chair-rise instructional illustration) is unbuildable: no `media::image` column surfaced anywhere in `FormEditor.tsx` (grep: zero hits) and no media upload route. The Photo tile is *capture*, not display.

**Design:**
- **Row card control** (notes first; harmless on other types): an "Image" field on the row card that shows the current `media::image` value with **[Upload…] / [Clear]**. Upload sends the file to the server; on success the cell is set to the bare filename.
- **Server route:** `POST /api/forms/:category/:form/media` — multipart file save into the CHT convention folder `forms/<category>/<form>-media/<filename>` (sibling of the `.xlsx`; `cht-conf upload-app-forms` picks that folder up as form attachments). Sanitize the filename; reject path separators. A `GET` list + `DELETE` are nice-to-have, not required.
- **Round-trip:** `media::image` is just an extras column — the parser already preserves it verbatim in `extras`; the editor only *surfaces* it. No parser/serializer change. (If the source sheet uses per-locale `media::image::<lang>`, show one control per locale exactly like labels — check `LABEL_HEADER_RE`'s sibling handling before assuming single-column.)

**Acceptance:** attach an image to a note → file lands in `<form>-media/`, the `media::image` cell holds the filename, form round-trips byte-stable, and `cht-conf convert/upload-app-forms` carries the attachment. Preflight: consider a warn when `media::image` references a file missing from `<form>-media/` (cheap, same rule family as danglingRefs).

**Tests:** shared round-trip case — a survey with a `media::image` extras column parses→serializes byte-stable (probably already covered by extras preservation; pin it explicitly). Server test: upload route writes inside the project only (reuse `resolveInsideProject`), rejects `../` names.

## 3 · OR authoring in the visual appliesIf builder  (Task R4–R8)

**Problem:** `AppliesIfBuilder.tsx` visual mode is AND-only ("All conditions are AND-combined"). `guardGroups` in `shared/src/tasks/appliesIfParser.ts` already **round-trips** an existing `if (A || B)` guard — there is just no authoring path. The nutrition tasks ("either of two options failed") therefore need a hidden-calc workaround or raw JS.

**Design:** mirror the in-form builder's connector approach at minimal scope: an **and/or connector pill between rule rows**, where consecutive OR-joined rows form one group. No mixed-precedence UI needed — `(A || B) && C` as "OR-group then AND" covers the spec; anything beyond falls back to raw JS as today.

> **⚠ SPEC CORRECTION (planner error, 2026-08-05 — the dev was right).** The original wording here said *"serialized to exactly the guard shape `guardGroups` already parses"*, i.e. `if (A || B)`. **That is semantically wrong.** Guards are early-return `if (cond) return false;` and rules are stored as **positives** that `ruleToGuardSource` re-inverts, so `if (A || B)` emits ¬(¬P1 ∨ ¬P2) = **P1 AND P2** — the exact opposite of the intent (verified at runtime: that shape is true only when *both* options are selected). The correct OR is De Morgan's ¬(P1 ∨ P2) = the **inverted guards joined with `&&`**, which is what shipped. Same class of planner error as Note 5b (calc placement) and Note 6 (`Utils` in the contact-summary runtime): the constraint was in the runtime/serializer semantics, not in the UI design. **Verify emit semantics against the parser's polarity handling before prescribing a wire shape.**

**Acceptance:** the nutrition task "फेल selected for option A **or** option B" is buildable visually; reopening shows the same two OR-joined rows (round-trips through `guardGroups`, not raw); existing pure-AND task expressions are byte-unchanged on no-op open/save.

**Tests:** `appliesIfParser` unit — author-side emit of an OR group parses back to the same structure; no-op stability on a pure-AND fixture; e2e: build the OR condition in the modal → saved `tasks.js` contains the `||` guard.

## Gates (each item, same PR as its tests)
```
pnpm --filter @cht-ui/shared build && pnpm --filter @cht-ui/shared test
pnpm --filter @cht-ui/client build && pnpm typecheck
```

## After all three land
Ping the planner → QA re-audit of the geriatric matrix (expected **YES**), then the Playwright **builder-as-driver geriatric spec** (mirror `anc-build-deploy.spec.ts`) becomes the durable regression. Remaining known frictions (end-form macro, calc tile in Simple mode, styling presets, icon picker) stay parked with the squad-scope A–D items pending PO scheduling.
