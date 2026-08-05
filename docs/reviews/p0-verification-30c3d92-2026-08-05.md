<!--
Adversarial verification of the three P0 fixes at 30c3d92 (4 parallel audits + a GO/NO-GO
judge), all claims reproduced against the compiled HEAD. Supersedes the P0 section of
geriatric-reaudit-2026-08-05.md. 2026-08-05.
-->

# P0 verification — `30c3d92` · **VERDICT: still NO-GO for a real config**

**P0-1 CLOSED · P0-3 CLOSED · P0-2 PARTIAL.** The batch did what it said. But the NO-GO stands for a **different and older** reason: two *pre-existing* silent-corruption classes in the same serializer — untouched by either commit — corrupt **the tool's own shipped templates** and **four real Nepal configs** on a zero-edit open+Save. Exposure on disk is still **zero** (latent, not realized).

**Every process claim verified true.** HEAD *is* pushed (live `git ls-remote` = `30c3d92`, 0 ahead/0 behind). Gates reproduce exactly: shared **610/610**, server **72/72**, typecheck 3/3, client build clean, geriatric e2e **2/2** and genuinely hermetic (booted its own servers, no env vars, no live CHT). Commit hygiene clean — 4 files, nothing snuck in. Two corrections: the push contained **7** commits, not 6; and **CI's e2e job is expected to go RED** — running CI's exact 11-spec command gives **8 failed / 38 passed**, deterministic, all `TimeoutError`, **not attributable to `30c3d92`** (its only client hunk is inside `MediaImageField`, which none of the 8 touch). `gh` isn't installed, so the actual run is unobservable from this machine.

## Per-P0 status

| | Status | Decisive evidence |
|---|---|---|
| **P0-1** guard-origin inversion | **CLOSED** ✅ | `guardGroup === undefined` is no longer a polarity proxy: `fromGuard?: boolean` on the raw rule (`appliesIfParser.ts:89`), set via `markGuardRaw` at both push sites (`:281`, `:301`), serializer decides on the explicit `rule.kind === 'raw' && !rule.fromGuard` (`:745`). Two independent verifications ran **20+ and 17 guard shapes** against transpiled `3fa6d39^` / `3fa6d39` / HEAD: all three audit reproducers **byte-stable** at HEAD where `3fa6d39` inverted them; **zero inversions** anywhere. The two shapes that change (brace insertion, else-drop) are truth-table identical over 4096 input combinations. **4 of the 7 new tests genuinely fail against a transpiled `3fa6d39` build** — the pin is not tautological. |
| **P0-2** OR/guard parenthesization | **PARTIAL** ⚠️ | `parenFor` (`:737-740`) is correct — truth-table-clean over ~120 input points at `:763`/`:765`, and the "unwrapped `\|\|` chains unchanged" pin holds. **But it is not applied at `:777`** (`return ${exprRaws.join(' && ')};`). Reproduced: an on-disk `return …anc_visits < 4;` plus one click on "+ raw JS" typed as `…risk === 'high' \|\| …risk === 'severe'` emits `return … < 4 && … === 'high' \|\| … === 'severe';` → at `visits=6, risk='severe'` the emitted code returns **true**, intended **false**. Valid JS, **fail-OPEN**, one click deep. Secondary: `if (A && B \|\| C)` now diffs on a zero-edit save (deliberately pinned at test `:146-156`), and any OR group containing a `field_age BETWEEN` reopens as a single un-re-OR-able raw row — so §3's "structured reopen" does not hold for the shape P0-2 was about. |
| **P0-3** media duplicate DOM id | **CLOSED** ✅ | `document.getElementById` gone from `FormEditor.tsx`; the hidden inputs carry **no `id` at all** (so no duplicate ids and no `<label for>` breakage); ref map is a `useRef` inside `MediaImageField` (`:2445`), instantiated per `SurveyRowCard` keyed by `row.rowId`, writes routing `setExtra → props.update → updateRow(row.rowId,…)`. No collision at DOM *or* write layer; per-locale slots distinct because the slot key *is* the column name. Caveat: **zero tests** for the bug it fixes; the media route still has no route-level test. |

## ⛔ The two pre-existing classes that keep this NO-GO

Both verifiably identical at `3fa6d39^` / `3fa6d39` / `30c3d92` — **not regressions from this work**, but they are why the build is not safe to point at a config.

**1. Statement / declaration loss.** The appliesIf model can represent only `if (…) return false` guards plus one final `return <expr>`; `extractRules` accumulates everything else into `unprocessed` and mines it for the **last return only** (`appliesIfParser.ts:309-317`). Every `const`/`let`, loop, `else-if` branch and comment is silently discarded, and the protective whole-body raw fallback (`:344-348`) only fires when **nothing** classified. Reproduced: `const lmp = Utils.getLmpDate(report); if (!lmp) {…}` → the `const` is **gone** while surviving code still references it (ReferenceError on device); an `if/else-if` chain collapses to its **last branch only**.

**Measured on the four real Nepal configs (via the exact UI flow — `parseHelpers` → wrap → parse → serialize → `patchHelper`): 31 helpers, ZERO byte-stable, 3 whitespace-only, 28 semantically changed — 19 emit valid JS referencing now-undeclared identifiers (ReferenceError), 9 are silent valid-JS meaning flips.** The worst: `getDOB` in **gandaki *and* moh-province** collapses its if/else-if chain to the last branch, so **every contact that has `date_of_birth` set silently gets an age-derived DOB** — valid JS, no error, wrong data. The repo's own `mini-config` fixture loses 2 of 3 helpers the same way.

**Reachable with zero semantic edits** — Contact Summary → Helpers → **"✎ edit body" → Save** (enabled, no diff, no confirm) → page Save. And the UI **affirmatively tells the user "nothing is dropped" while doing it** (`AppliesIfBuilder.tsx:206-208`). The suite is 610/610 green because none of the 7 new fixtures contains a variable declaration, loop, if/else, or comment.

**2. Argument-discarding rewrites.** `classifySimple` (`:513-519`) matches `fn(args)` and returns `{kind:'is_alive'|…}` **discarding the actual argument**; `ruleToGuardSource` then hardcodes it (`:788-797`). So a no-op save rewrites `isAlive(contact)` → `isAlive(contact.contact)` — valid JS, **different patient set**. This corrupts the tool's **own** templates: `server/templates/malaria/tasks.js`'s `if (!isAlive(contact) || isMuted(contact))` becomes `isAlive(contact.contact)`, and malaria's own helper is `isAlive(c) { return c && !c.date_of_death; }` — **before** the rewrite the guard never fires; **after**, it fires for dead contacts. In cht-default helper bodies it rewrites `isAlive(thisContact)` → `isAlive(contact.contact)` where `contact` isn't in scope → **ReferenceError**.

## Is the class systemically dead? No — locally patched.

- **Same file, same function, 14 lines below the fix:** the unparenthesized `:777` join. The fix landed on the two joins the audit *named*, not the join family.
- **Latent residue of the exact P0-1 shape:** `:743` gates the `fromGuard` check on being ungrouped while `:760` still maps every *grouped* rule through `ruleToGuardSource`, so a positive raw landing in a group emits inverted (12/16 truth-table points wrong at model level). Unreachable today **only** because parse won't group raws and the UI disables the connector pill for raw neighbours — an invariant held by UI gating with **no test pinning either constraint**.
- **Display consumers ignore polarity:** `DecisionsView.tsx:471-472` and `AppliesIfBuilder.tsx:464-475` render a guard-origin raw as a **positive** requirement — so the **MOH sign-off surface states the opposite of the config's meaning**. `fromGuard` exists; nothing downstream reads it.
- **Sibling modules are clean** (swept): `relevantParser`, `resolvedIfParser`, `contextExpressionParser` all emit raws into a single positive expression with explicit `negated` fields and no guard notion. The polarity-inference class exists only in `appliesIfParser.ts`.

**The structural lesson is unaddressed:** a "recognize a few shapes, discard the rest" model applied to arbitrary JS bodies **must refuse to structure** rather than silently drop — see [[feedback_roundtrip_tests_must_call_serializer]].

## Buildability: unchanged at **55 OK / 30 FRICTION / 1 GAP**
Checked, not assumed — the P0s are data-safety and touched no authoring surface. The one candidate mover (BETWEEN-in-OR reopen degradation) lands on rows already FRICTION on the title axis. Task R8 remains the single GAP.

## Next batch, ranked

**P0 — data-safety, blocks the greenlight**
1. **Parenthesize the `:777` return-join** (`exprRaws.join(' && ')` → `parenFor`) + the same for ternary operands. One line + a two-raw-row test.
2. **Stop statement/declaration loss.** Minimum viable: change the `:344` fallback gate from `rules.length === 0` to **"any unclassified statement present"** → refuse to structure, keep a whole-body raw row. Closes the 19 ReferenceError cases *and* the `getDOB` flip.
3. **Stop the argument-discarding rewrite.** Record actual call arguments on the 4 well-known kinds instead of hardcoding `contact.contact`/`user` (`:788-797`); don't classify a call whose args don't match. Corrupts the tool's own malaria + cht-default templates today.
4. **Gate the HelpersTab** — offer "✎ edit body" only for bodies the model round-trips losslessly; **delete the false "nothing is dropped" reassurance**; show a diff on save. Cheap.
5. **Pin the latent grouped-raw invariant** with tests; make `:760` respect `fromGuard`. Cheap.
6. **Make the Decisions/MOH view and the raw row render guard-origin polarity correctly** — a sign-off surface must not state the inverse.

**P1 — as queued**
7. `selected()`/`contains` + gate the dropdown on `fieldInfo.type` — **closes the last GAP (Task R8)**.
8. Fix the e2e that pins wrong `select_multiple` semantics (it currently pins corrupt output).
9. CI: add a **server-test step** (72/72 is enforced nowhere), both geriatric specs, route test for `POST /api/forms/:id/media`.
10. **Local-env e2e triage — accepted and raised:** 8 failed / 38 passed on CI's exact command, deterministic, `quick-hierarchy` looping on "element is outside of the viewport". Pre-existing; expect the pushed SHA's e2e job RED.
11. Wire `fieldChoiceOptions` into the 3rd `RelevantRuleBuilder` mount.

**P2/P3 tail unchanged** (task titles — see the PO question; context-key picker; end-form; cross-form assembly; calculate tile; grouped and/or; media hygiene; then cosmetics). **Housekeeping:** the `helper-builder.spec.ts` CI exclusion is factually stale *and* its fixture is hyphen-named `contact-summary-extras.js` while the server reads only the dot name `contact-summary.extras.js` — **fix the name, not just the exclusion** (that spec cannot currently see helpers at all). Gitignore the stray `cht-district-form.png`.

## Open question for the PO
**Are literal single-locale Nepali task titles acceptable** (typing Nepali *content*, not an identifier)? YES → the 17 task rows flip, buildability becomes **72 OK / 13 FRICTION / 1 GAP**, and P2-8 leaves the queue. NO → P2-8 (`TranslationsEditor` add-key + "title from label" derive) is the highest-leverage feature item and should be promoted above the P1 tail; it also unblocks the durable geriatric regression spec.

**Planner recommendation: NO — promote P2-8.** The geriatric spec supplies **both** Ne and Eng titles for all 18 tasks, which implies real per-language switching is wanted; literal titles would ship one language to every user. PO can override if Nepali-only is acceptable in practice.
