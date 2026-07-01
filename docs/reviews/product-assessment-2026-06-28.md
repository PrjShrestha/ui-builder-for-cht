<!--
Planner strategic assessment: product maturity of the CHT UI Builder, positioning
vs CommCare & KoboToolbox, and a prioritized roadmap of suggestions for the dev.
Grounded in README.md (feature surface + declared non-goals) and this session's
live deploy runs against a real poc-test project. 2026-06-28.
-->

# Product assessment — CHT UI Builder vs CommCare & Kobo (+ roadmap)

**Date:** 2026-06-28 · **Method:** grounded in `README.md` (feature surface + declared
non-goals), the shipped feature set, and this session's *actual* deploy runs against a
real `poc-test` project (which surfaced the reliability gaps first-hand).

## 1. How good is it now?

**Verdict: the most CHT-native authoring tool that exists — feature-broad and
genuinely deep on the hard CHT-specific parts — but two things keep it from being
trustworthy for its target non-coder: you can't *see* what you build, and you can't
yet reliably *ship* it.** Call it a strong late-alpha/beta: excellent at the parts
nobody else even attempts, rough on the end-to-end "a DHO ships a working app without a
developer" journey it's named for.

### Scorecard (honest)
| Capability | State | Notes |
|---|---|---|
| Form authoring (survey + choices + logic builders) | **Strong** | Kobo-style tile picker, inline choices, plain-English condition strip, Simple/Full mode, dependency-safe reorder, diff-before-save. |
| CHT logic authoring (tasks, contact-summary context, appliesIf, lineage) | **Strong / unique** | Nobody else authors `tasks.js` / contact-summary / lineage no-code. |
| Contact hierarchy & contact forms | **Strong** | Topological order derivation, generator, quick-hierarchy creator. |
| FHIR standard-codes mapping | **Strong / unique** | LOINC/ICD/CIEL, offline, MOH-gated orphans. |
| Decisions / sign-off surface | **Unique** | DMN-style decision tables for MOH sign-off — neither competitor has this. |
| Round-trip / local-first / no lock-in | **Strong / core moat** | Edits your real cht-conf folder losslessly; git-tracked; no platform captures your app. |
| **Live preview** | **Absent** | The "preview" is a simplified stacked view, not a real XPath renderer (declared non-goal). |
| **Deploy reliability** | **Fragile** | This session alone, deploying a UI-built project hard-failed 3×: missing `targets.js`, invalid XPath from a generator bug that skip-not-overwrite stranded, invalid field names + hand-typed `${}`. The abstraction leaks raw cht-conf failures to the user. |
| Config coverage (targets / cards / roles / translations) | **Partial** | No editor for dashboards, contact-summary cards/fields, roles, or full translations. |
| Collaboration / versioning / multi-user | **None** | Local single-user by design. |

### The two gaps that matter most
1. **You can't see it.** No live form preview and no way to see the *workflow* (which forms appear, which tasks fire, what the contact profile shows). For a non-coder this is the difference between "I think this is right" and "I can see it's right."
2. **You can't reliably ship it.** The happy path from "built in the UI" to "deployed to a phone" still meets cht-conf's raw hard-fails. Everything looks done in the editor, then `cht-conf` rejects it. That directly undercuts the product's core promise.

Everything else is genuinely good. These two are the difference between "impressive demo" and "a DHO actually uses it alone."

## 2. Positioning vs CommCare & KoboToolbox

**Category note:** this isn't a platform competing with CommCare/Kobo — **CHT is the
platform; this is its authoring layer.** The fair comparison is the *authoring
experience*: building a CHW app here vs. in CommCare's App Builder vs. surveys in
Kobo's form builder.

| Dimension | CHT UI Builder | CommCare (HQ App Builder) | KoboToolbox |
|---|---|---|---|
| Primary job | No-code editing of real cht-conf configs | Frontline-worker apps + case mgmt | Survey / M&E data collection |
| Form builder | Tile picker + visual logic + raw fallback | Vellum WYSIWYG (mature, drag-drop) | Web builder (XLSForm under hood) |
| **Live preview** | ❌ none | ✅ App Preview (live phone emulator) | ✅ instant form preview |
| Case / contact model | ✅ CHT contacts + hierarchy + lineage | ✅ Cases (very mature) | ❌ none (stateless surveys) |
| Longitudinal care: tasks/scheduling | ✅ tasks.js + contact-summary + schedules | ✅ conditional alerts / reminders | ❌ none |
| Dashboards / reports | ❌ no editor (hand-edit targets.js) | ✅ HQ reports + report builder | ✅ basic tables/charts/maps |
| Terminology / FHIR | ✅ FHIR code mapping | partial (data dictionary) | ❌ |
| Clinician sign-off / audit | ✅ DecisionsView (unique) | ❌ | ❌ |
| Deployment | ⚠️ drives cht-conf (leaky) | ✅ one-click publish + versioned releases | ✅ deploy + share link |
| Collaboration / versioning | ❌ local single-user | ✅ cloud, roles, app versions/releases | ✅ cloud, sharing, versions |
| Openness / lock-in | ✅ open-source, your files, self-host | open core, HQ hosting is tiered/paid | open-source, hosted (free/paid) |
| Offline runtime | ✅ CHT PWA | ✅ CommCare mobile (strong) | ✅ KoboCollect (ODK) |

### Where it wins
- **vs Kobo:** not the same category. Kobo is stateless surveys — no cases, no tasks, no longitudinal care. CHT + this tool does an entire class (continuity of care, CHW workflows) Kobo doesn't touch. For an actual community-health program, Kobo isn't a real alternative.
- **vs CommCare (the true analog):** the differentiators are **openness + no lock-in** (edit your real, git-tracked config; self-host; no per-user fees), **CHT-nativeness** (FHIR, CHT's exact task/contact-summary model), and the **sign-off/audit surface**. For any org already committed to CHT, *nothing else authors CHT configs no-code* — CommCare can't point at a cht-conf folder.

### Where it loses (and why it matters)
- **CommCare's App Preview + one-click publish + cloud collaboration is a dramatically smoother non-coder journey.** Preview and reliable publish are exactly the two gaps above. CommCare is 15 years more mature end-to-end.
- **Kobo's instant-preview simplicity for surveys is unbeaten** — a first-timer builds and sees a form in minutes. Our first-timer this session hit three deploy stack traces.

### One-line positioning
> The open, local-first, CHT-native CommCare App Builder — with a sign-off surface
> neither competitor has — whose moat (openness + CHT depth) is currently gated behind
> two fixable experience gaps: **preview** and **reliable deploy**.

## 3. Suggestions for the developer (prioritized)

### Tier 0 — Make it impossible to build something that won't deploy
*(This session proved the deploy path is the weakest link. This tier is the highest leverage.)*
1. **Authoring-time preflight validator.** Replicate cht-conf's *hard gates* inside the app and run them continuously + before deploy: required files present, valid XLSForm identifiers, XPath references that resolve (the `../../` vs `../../../` class), `${}` refs resolve, every `select_*` has choices, form_id conventions. Surface as a green/red "Ready to deploy" panel with **one-click fixes**. This converts deploy-time stack traces into edit-time checkmarks and kills the entire class of failures we hit.
2. **Own the deploy pipeline end-to-end.** compile → convert → upload as one flow with progress + the existing friendly-error translator + auto-fix suggestions, so a non-coder never sees raw cht-conf output. (Deploy exists but leaks.)
3. **Generator "refresh/overwrite existing" + project repair** *(queued)*. Skip-not-overwrite stranded the buggy forms this session; fixes must be applyable to existing projects, and known-bad patterns should be detectable + one-click repairable.
4. **Naming autoderive + rename-with-rewrite-all-refs macro** *(queued)*. No raw identifiers or `${}` for no-coders — labels in, names derived, refs via pickers.

### Tier 1 — Let people SEE what they build (the biggest gap vs CommCare/Kobo)
5. **Live form preview.** Revisit the declared non-goal — embed enketo-core (or the CHT renderer) so skip/validation/calc run live. It's the single thing that makes a no-code tool *feel real*.
6. **Workflow simulator — potentially a real differentiator.** CHT's value is the *logic*, which a form preview can't show. Build a sandbox: enter a sample contact + sample reports → see the contact-summary render, which forms become available, and which tasks/targets fire. **Neither CommCare nor Kobo does care-continuity simulation well.** This could leapfrog, not just catch up.

### Tier 2 — Close the "drop to code" gaps
7. **Targets / dashboard editor** (recommended first — most regular, universally needed; see `no-code-coverage-gaps.md`).
8. **Contact-summary cards/fields editor** (the visual profile — README's stated next CommCare-parity item; scope as light/hybrid with raw fallback).
9. **Roles/permissions editor** + **translations manager** (translations matters a lot for the multilingual/Nepali context).

### Tier 3 — Teams & scale (where CommCare HQ / Kobo are strong)
10. **Turn DecisionsView into a real review → approve → deploy flow.** Lean into the sign-off surface — an auditable "MOH approves this change before it ships" loop is something *neither competitor emphasizes*, and regulated health contexts value it. A differentiator, not just parity.
11. **Guided program recipes.** Extend the quick-hierarchy creator into end-to-end scaffolds ("empty → working pregnancy tracker") — CommCare has app templates; the pregnancy POC we scoped this session shows the demand.
12. **(Fork-in-the-road) A hosted/multi-user mode.** Local-first is a strength *and* a ceiling on collaboration. A hosted option that keeps the file-based openness would close the last gap with HQ/Kobo — but it's a large strategic bet; flag, don't rush.

## 4. Bottom line
The hard, differentiated work is largely **done** — CHT-native depth, round-trip
safety, FHIR, sign-off. The remaining work is not more features; it's **trust**:
*see it* (preview + simulator) and *ship it reliably* (preflight + owned deploy).
Do Tier 0 and one of Tier 1, and this goes from "impressive to a developer" to
"usable by Bhishan alone" — which is the entire point.
