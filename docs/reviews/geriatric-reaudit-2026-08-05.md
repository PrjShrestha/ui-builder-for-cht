<!--
QA re-audit of the geriatric no-code buildability matrix after the 3-item blocker batch
(commit 3fa6d39), plus independent verification of each item, the inverted-helper-guard
incident, and the e2e/gate claims. Run as 6 parallel adversarial audits against HEAD.
Supersedes the counts in geriatric-nocode-buildability-2026-08-05.md. 2026-08-05.
-->

# QA re-audit — geriatric buildability after the blocker batch (`3fa6d39`)

**VERDICT: still NO — and for a new reason. `3fa6d39` introduces a silent config-corrupting round-trip regression that violates the byte-stability invariant. That outranks every friction row: do not point this build at a real config, and land the P0s before pushing.**

Row matrix (86 rows): **55 OK · 30 FRICTION · 1 GAP** — prior audit was 54/31/1, so **net movement is +1 OK.** The batch closed the mechanisms it targeted (media images genuinely work; OR authoring works; the choice dropdowns are real and well built) but the claimed "26 rows flip" did not happen — those rows improved *inside* the FRICTION bucket because each carries a **second** blocking requirement the handoff arithmetic missed.

| Sheet | OK | FRICTION | GAP |
|---|---|---|---|
| Task (18) | 0 | 17 | **1** (R8) |
| IHA (52) | 50 | 2 | 0 |
| Referral Follow-up (16) | 5 | 11 | 0 |
| **Total** | **55** | **30** | **1** |

**PO sensitivity case:** if literal single-locale task titles are acceptable (typing Nepali *content* rather than an identifier — which the no-code bar permits), the 17 task rows flip and it becomes **72 OK / 13 FRICTION / 1 GAP**. That is a scope decision, not engineering — reported both ways rather than picked.

---

## ⛔ P0 — the new regression that dominates the verdict

**Guard-origin raw conditions are silently inverted on a no-op open + save.** Reproduced at runtime, at HEAD, and against a transpiled `3fa6d39^`:

| source (real CHT idiom) | `3fa6d39^` | HEAD (`3fa6d39`) |
|---|---|---|
| `if (report.form !== 'pregnancy') { return false; }` | broken-but-fail-closed | `return report.form !== 'pregnancy';` — **inverted, valid JS, fail-OPEN** |
| `if (!isAlive(...)) {…} if (report.fields.flag === 'x') {…} return true;` | **byte-identical (correct)** | `… return report.fields.flag === 'x';` — **REGRESSION** |
| lumbini immunization `if (!childDob.isValid) {…} if (childAgeInYears > 5) {…}` | guards preserved | `return !childDob.isValid && childAgeInYears > 5;` — both inverted |
| `if (!isActivePregnancy(…)) { return false; }` | inverted (the reported bug) | **byte-stable ✅ — the helper fix is real and correct** |

**Root cause is structural, not a typo:** the parser gives a *solo* guard `guardGroups.push(undefined)` (`appliesIfParser.ts:281-284`) and `invertGuardRule` records no polarity for raws (`:660-661`), while the new serializer uses `guardGroup === undefined` as its proxy for "not guard-origin" (`:713`, `:721`, `:747`) — so every ungrouped raw is re-emitted as positive `return …;` with flipped polarity. **Fix shape: record guard origin explicitly** (a `fromGuard` flag or a group id for solo guards) instead of inferring it.

**Why nothing caught it:** reachable with **zero edits** (`AppliesIfBuilder.tsx:186` serializes on the modal's Save; the modal opens in Visual mode by default), it emits **valid JS** so `compile-app-settings` can't see it, and the suite is green at 603/603 because the one guard-origin-raw test **never calls the serializer** (`appliesIfParser.roundtrip.test.ts:464-479`) while the pure-AND stability pin (`:454-462`) uses source already in canonical form. Blast radius includes `*-extras.js` helper bodies via `ContactSummaryEditor.tsx:576-587`, where statement-loss compounds.

**Exposure on this machine: zero.** All four config git repos have a clean `tasks.js`; the tool-built projects contain no helper guards. **The risk was live; the damage was not done.** No config re-check campaign is needed — but this is the second silent-corruption class found in this file in one batch, which is itself the signal.

### The other two P0s (both small)
2. **Unparenthesized OR join** (`appliesIfParser.ts:733`/`:735`) — OR-joining a `field_age BETWEEN` row (a button the UI offers) emits `X < 84 || X > 90 && …` and silently mangles the author's logic. One-line fix.
3. **Duplicate media-upload DOM id** (`FormEditor.tsx:2486` + `:2497` `document.getElementById`) — writes the filename to the **wrong row** whenever two row cards are expanded. Fix with a `useRef`.

---

## Per-item outcome

**§2 display images — CLOSED ✅ (the only clean flip).** IHA R11 GAP → OK. `MediaImageField` mounts on every row card incl. notes, reachable in Simple mode; the server writes `forms/<category>/<basename>-media/<file>`, verified **byte-for-byte against vendored cht-conf 6.5.0** (`forms-utils.js:53`, and `upload-forms.js:97` turns that folder into `doc._attachments`) — the illustration really reaches devices. Parser/serializer correctly untouched; the append-path round-trip pin is real. **The dev's base64-JSON deviation is sound, not the suspected defect** — the route sets `bodyLimit` 15MB (`forms.ts:397`), measured ceiling ≈11.2MB raw (2MB and 5MB photos upload fine where the 1MB default rejects them). Carried defects: the duplicate-id bug (P0-3), **zero route-level tests**, orphaned/replaced files ship as attachments forever, and per-locale `media::image::<lang>` is edit-only (cannot be *created* no-code).

**§1 choice dropdowns — PARTIAL: closes the *value* axis on 17 of 26 rows, flips 0 rows to OK.** The mechanism is genuinely good — unit-tested `extractReportFieldInfos` + one shared `ChoiceValueInput` (stores the choice **name**, shows `Label (name)` in locale order, custom escape, plain-input fallback), and provably **emit-neutral** (no serializer hunk; the ungrouped-AND emit line is byte-identical to `3fa6d39^`). But:
- **17 of 18 task rows**: value typing is eliminated (the referenced IHA fields are `select_one`). They stay FRICTION on the **title** axis only.
- **Task R8 → now a hard GAP.** Its condition is membership in a 5-option `select_multiple`, but the appliesIf model has **no `selected`/`contains` kind** (`appliesIfParser.ts:23-30`) and the dropdown is gated on the *operator only*, never `fieldInfo.type` (`AppliesIfBuilder.tsx:552`) — so **a semantically wrong equality is one click away, and the batch's own e2e pins that wrong shape** against the fixture's `select_multiple` (`geriatric-blockers.spec.ts:104-106`). The workaround also fails: a hidden flag needs the `calculation` column, and the third `RelevantRuleBuilder` mount (`CalculationBuilder.tsx:387-396`) was left without `fieldChoiceOptions`.
- **RF R8–R15 (the other 8)**: not flipped — the same row's **context key is still a free-text datalist** (`RelevantRuleBuilder.tsx:545-551`), and OR/multi-select referral triggers route back through the unwired CalculationBuilder. **Zero test coverage** on this path.

**§3 OR authoring — SHIPPED, and the dev's spec correction is CORRECT ✅.** The planner's handoff §3 was semantically wrong and has been corrected in place. Connector pill exists, `orGroups` implemented in parse + serialize, emit→parse→emit is a fixpoint for 2-way/3-way/mixed-kind/`(A||B)&&C` in both orders, e2e pins UI → `&&`-guard on disk → structured reopen. Two defects: P0-2 (parenthesization) and the §3 e2e demonstrating OR on a `select_multiple`, where the `!==`-pair is false whenever both options are selected.

**Gates + e2e — the dev's numbers are exactly right; the e2e framing is not.** Independently re-ran: shared **603/603**, server **72/72**, typecheck 3/3, client build clean. But: **HEAD is 5 commits ahead of `origin/master`, so CI has never run on this batch** — every e2e claim rests on an unreproducible local run. The "15 specs fail identically, pre-existing/environmental" claim is **materially overstated**: only 2 of 16 specs structurally need a live CHT instance and 2 more default to a machine-specific output path, while 11 run against the in-repo `mini-config` (10 of them exactly CI's set) — a missing fixture cannot account for 15. `geriatric-blockers.spec.ts` is real and non-shallow for §1/§3 but **covers §2 not at all** and **is not in CI's run list**. `pnpm lint` still red (110/11), with 4 avoidable net-new `no-undef` (`api.ts:281,283`; `FormEditor.tsx:2448,2497`).

---

## Ranked queue

**P0 — before this build touches a real config, and before pushing**
1. Guard-origin raw inversion — record guard origin explicitly; add a serializer-exercising round-trip test per guard shape.
2. Parenthesize each operand in the OR/guard join.
3. Duplicate media-upload DOM id → `useRef`.

**P1 — closes the last GAP + the false-confidence traps**
4. `selected()`/`contains` op for `select_multiple` in the appliesIf model **and** gate the dropdown on `fieldInfo.type`. **Closes Task R8, the only remaining hard GAP.**
5. Fix the e2e that pins wrong semantics (add a `select_one` to `mini-config`, re-point `geriatric-blockers.spec.ts:104-119`).
6. Wire `fieldChoiceOptions` into `CalculationBuilder.tsx:387` + the `calculation` ExpressionField (`FormEditor.tsx:2174-2184`) — unblocks IHA R3's if-then texts *and* the RF referral-flag path in one edit.
7. Add both geriatric specs to CI (`ci.yml:98`), **push HEAD**, and add a route-level test for `POST /api/forms/:id/media`.

**P2 — remaining FRICTION**
8. Task titles: add-key support in `TranslationsEditor` + "title from label" derive (blocks 17 task rows on the strict bar; moot if the PO accepts literal titles).
9. Context-key **picker** replacing the datalist (blocks RF R8–R15).
10. No end-form primitive (IHA R1, RF R16). 11. Cross-form assembly many-stepped (~7 bridges). 12. `calculate` tile hidden in Simple. 13. Grouped mixed and/or in RelevantRuleBuilder. 14. Media hygiene: DELETE route + orphan-file preflight.

**P3 — cosmetic:** 15. styling presets (~9 rows). 16. icon picker (overlaps squad gap B). 17. reuse contact-injected choices in `fieldChoiceOptions`. 18. `ChoiceValueInput` discards off-list value on "pick"; single-quote choice names emit unescapable JS.

## Durable regression spec — ~80% ready, not yet
Driver primitives all exist, and `geriatric-blockers.spec.ts`'s own setup is the right pattern to copy (`setup.ts:13-14` env-or-fixture + `mkdtemp`/`fs.cp`/`POST /api/project/open` for write isolation). Blocked on **P0-1** (a task-authoring leg would otherwise pin corrupted output — the current spec already pins a wrong expression), **P1-4** (R8 has no no-code path to drive), and a decision on **P2-8** (no UI drives a bilingual task title). When built: `mini-config` is insufficient (no `messages-*.properties`, no HTN/DM screening forms for the BMI/BP pulls, no `targets.js`/`resources.json`) — extend it or build from `cht-default` via the new-project flow; use `GERI_OUTPUT_DIR ?? os.tmpdir()` (do **not** copy `anc-build-deploy.spec.ts`'s machine-specific default); assert on-disk only; gate live `cht-conf` behind an env flag so CI stays hermetic. Also retire the now-stale CI exclusion of `helper-builder.spec.ts` (its fixture landed in `97b2452`).
