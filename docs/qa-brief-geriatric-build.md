<!--
Self-contained brief for the dedicated QA session: build the FULL Geriatric-care use case
through the UI via Playwright and report where it stops. Assumes no prior conversation
context. 2026-08-06.
-->

# QA brief — build the full Geriatric-care use case

**Goal: find out how much of the real Geriatric-care use case can be built end-to-end through
the UI, with zero hand-typed identifiers, `${}` refs, XPath or JS — and report precisely where
that breaks.** Repo: `W:\medic\ui-builder-for-cht` (pnpm monorepo — `client/` React UI :5173,
`server/` Fastify :5174, `shared/` parsers/serializers).

**What the use case is:** an **Integrated Health Assessment form for the elder population**
(gated to contacts aged 60+) — a sectioned screening covering cognition, vision, hearing,
nutrition, mobility and chronic conditions, where a failed screen raises a **referral**, a
**task** for the health worker, and a **Referral Follow-up** form. It also pulls the latest
BMI / blood pressure / blood sugar from separate Hypertension and Diabetes screening forms, and
every label is bilingual English + Nepali.

## Start here
1. **`docs/NEXT.md`** — the current priority list, what just shipped, and the **safety rule**
   (see below). Items **A–G** are known findings; don't re-report them, but do note if you hit
   them differently.
2. **`docs/reviews/geriatric-reaudit-2026-08-05.md`** — the row-by-row static verdict
   (86 rows: which affordance builds each row, what's friction, what's impossible).
3. **`client/tests/geriatric-build.spec.ts`** — **an existing spec that already drives the
   FORMS side: 10/10 capabilities green.** Read it first; extend or mirror it rather than
   starting over. Its header documents the hermetic setup and the worker-restart gotcha.
4. The geriatric source spec (text dump of the customer's XLSX):
   `C:\Users\ADMIN\AppData\Local\Temp\claude\W--medic-ui-builder-for-cht\f6378412-1a1e-49d4-959f-d0287f18593b\scratchpad\geri-full.txt`
   — sheets: **Form Overview**, **Task (18 rows)**, **Integrated Health Assessment (52 rows)**,
   **Referral Follow-up (16 rows)**.

## What's already proven (don't redo)
The existing spec proves these *capabilities* work: label-first form create, `age >= 60`
eligibility, a section with "show all on one screen", adding Nepali, a bilingual `select_one`
with bilingual choices, relevance via the **choice dropdown**, patient-name insert with an
auto-created harvest calculate, a display image landing in `forms/app/<basename>-media/`,
multi-field OR relevance, and the cross-form BMI bridge (Contact Summary → Context values →
calculation → `${ref}` in a label).

## What to do — in priority order

**Phase 1 — the forms, at real scale (not one row each).** The existing spec proves each shape
once. Now build the **actual sheets**: all 52 Integrated Health Assessment rows and all 16
Referral Follow-up rows, with their real EN + NE labels, real choice lists, and real relevance
chains (including the multi-question referral triggers — "either eye failed", "any option
except none"). The question is whether the affordances **compose at volume** and whether the
interaction cost is tolerable. Record roughly how many UI actions each row pattern takes.

**Phase 2 — the tasks (18 rows). This is the untested frontier.** No probe has driven the task
side yet. Per task: trigger form + `appliesToType`, the condition ("X was फेल"), the
**15 / 30 / 15 day** window, resolution ("Referral Follow-up submitted"), and the action that
opens the follow-up form. Specifically stress:
- **The new "any of these options" operator** (shipped in `c66cfcb`, **never tested**) — the
  eye-examination task fires when **any** of 5 checkboxes in a `select_multiple` is ticked.
  Verify the emitted `tasks.js` is *semantically correct*, not merely that the UI accepted it.
- **OR conditions** on the nutrition tasks ("फेल for either option") via the connector pill.
- **Task titles are expected to BLOCK** — see below. Record exactly how far you get.

**Phase 3 — round-trip and deploy reality.** Reopen everything you built and re-save with no
edits: assert **byte-stability** on disk. Then confirm the project passes the in-app preflight,
and (only if a local CHT is available and you gate it behind an env flag) that
`cht compile-app-settings` + form conversion succeed.

## Known blockers — record, don't grind
- **Task titles need a translation key that cannot be created in the tool** (queue item 8, not
  yet built). The translations screen only edits keys already on disk. This is expected to stop
  ~17 of 18 tasks from being *fully* no-code. Confirm it and move on; a literal typed title is
  the fallback for continuing.
- **Item B in `NEXT.md`:** Contact Summary → Context values shows **no source-form dropdown**
  unless you visited the Forms page earlier in the same page-load, and a dirty Contact Summary
  makes the sidebar silently inert. Work around it; don't re-diagnose.
- **Item C:** a new section is **invisible in Simple mode** — switch to Full to author inside it.
- **Item E:** a new `calculate` lands *below* subsequently-added rows and so isn't offered as an
  "earlier field" — you'll need a manual **move up** before `${ref}` is referenceable.

## ⚠️ Safety rule (non-negotiable)
Known silent-corruption bugs bite when the tool **opens pre-existing hand-written JavaScript**.
Anything created *through the UI* is already in the tool's own shape and round-trips cleanly.
So: **build in a fresh project**, and **do NOT use Contact Summary → Helpers → "✎ edit body"**
(31 of 31 real helper bodies fail to survive it). Neither is needed here — cross-form values go
through the structured *Context values* tab. Detail:
`docs/reviews/p0-verification-30c3d92-2026-08-05.md`.

## Method — this matters more than finishing
**Classify every failure**, and say which it is:
- **(A) Test-authoring problem** — wrong selector, missing await, race, element off-screen.
  *Your* bug: fix and retry.
- **(B) Real tool limitation** — the affordance doesn't exist, or it demands typing an
  identifier / `${}` / JS.

Reporting a bad selector as a tool gap is the one outcome that actively misleads the team.
**Timebox**: after several honest attempts at one step, record it as unresolved-with-evidence
and move on. Partial coverage with an accurate report beats a complete spec.

## Environment gotchas (all previously hit)
- **Blank page on every spec = the stale shared bundle.** The client imports from
  `@cht-ui/shared`; if `shared/dist` is behind, Vite serves a cached bundle and the app renders
  nothing. Fix: `pnpm --filter @cht-ui/shared build` **and** `rm -rf client/node_modules/.vite`.
  Rebuilding alone does not re-optimize.
- **The server holds ONE globally-open project** and runs under `tsx` watch, so another session
  (or a restart re-reading `~/.cht-ui-builder/state.json`) can steal it mid-run — it surfaces as
  `404 Form file missing`. Re-POST `/api/project/open` on every navigation.
- **~8 e2e specs already fail on this machine** for pre-existing reasons (click timeouts,
  `quick-hierarchy` "element is outside of the viewport"). Don't chase them; do say if you hit
  the same *class* of problem.
- **There are no `data-testid`s** — selectors are CSS classes + visible text. `"Survey (N)"` is
  ambiguous (editor tab bar *and* Translate scope switcher) and `.page-header` exists on every
  screen, so it's a false readiness signal.
- **Playwright restarts the worker after a failure**, re-running `beforeAll`. With `mkdtemp`
  that discards the whole chain; use a stable temp path reset once at the start.
- The dev server may be down. Start it in the **Project runner** terminal tab (not your own
  session — session-spawned processes get reaped): `pnpm --filter @cht-ui/client dev`.

## Scope
You may write and modify anything under `client/tests/**` plus scratch files. **Do not modify
`client/src/**`, `server/src/**`, or `shared/src/**`** — production code belongs to the
developer session. If a step needs a production fix, that's a finding, not a task.

## Deliverables
1. **Coverage table** — for each of the 86 spec rows (group identical patterns; never skip a row
   with unique logic): built / built-with-friction / blocked, and the affordance used.
2. **New findings**, each classified (A) or (B), with what you attempted and the file or
   affordance involved. **Findings the static audit missed are the highest-value output.**
3. **Interaction cost** — rough click/keystroke count per row pattern. "Possible but takes 40
   actions per row" is a finding.
4. **Round-trip result** — did everything you built re-save byte-identically?
5. **The spec path(s)** and the exact command to run them.
6. **Verdict** — can the full geriatric use case be built no-code today? If not, the precise
   list of what stops it.
