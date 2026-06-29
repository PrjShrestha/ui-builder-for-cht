<!--
Planner gap analysis: the four areas a real CHT program (per the pregnancy-tracker
POC) still has to "drop to code" for, ranked by value × tractability. Spun out of
docs/reviews/POC_status_Cht_pregnancy_development.md. 2026-06-28.
Each greenlit gap gets its own triad pass + dedicated plan doc.
-->

# Planner item — no-code coverage gaps (post-POC)

**Date:** 2026-06-28 · **Source:** `docs/reviews/POC_status_Cht_pregnancy_development.md`
(pregnancy-tracker feasibility) · **Status:** analysis + recommended sequence; nothing
greenlit yet.

## The correction that reframes this
The POC first read "contact summary" as a gap. **It mostly isn't.** The Contact
summary tab already edits:
- **Context flags** — the `context: {}` object forms gate on (`summary.X` in
  properties.json) — i.e. *which forms show up when* (`show_pregnancy_form`,
  `show_delivery_form`, …).
- **Helpers (extras.js)** — the predicate functions those flags call
  (`isReadyForNewPregnancy`, …), visual body builder + raw fallback.
- Phase 0 wired those flags into the form properties editor, so eligibility
  expressions validate against them. **The form-visibility loop is closed in-UI.**

What is **not** editable: `cards[]` / `fields[]` — the *visual profile display*
(§7 condition cards, §8 display lists), preserved verbatim. So the contact-summary
gap is the **display**, not the logic.

## The four real gaps (value × tractability)
| # | Gap | Need | Tractability | Why |
|---|---|---|---|---|
| 1 | **Targets / dashboards (§9)** | High (every program) | **High** | Regular shape `{id,type,icon,goal,appliesTo,appliesIf,date}`, flat list. **Zero UI today** (dropped by decision). |
| 2 | **Contact-summary cards/fields display (§7–8)** | Med-High (visible profile) | **Low** | Real cards are arbitrary imperative JS (cht-default pregnancy card ≈100 lines, dynamic fields + `modifyContext`). Visual editor is hard. |
| 3 | **Translations mgmt (§11)** | Med-High (i18n / Nepali) | Med | Key-value `.properties`; partly covered by form labels today. |
| 4 | **Roles / permissions (§10)** | Med | Med | JSON in app_settings; usually set once. |

## Recommended sequence
1. **Targets editor first.** Best ROI: most regular to model, universally needed,
   currently nothing preserves/edits `targets.js` in the UI. (Note: targets were
   *dropped by user decision* — this would be **un-dropping** it; confirm before
   planning.)
2. **Contact-summary card editor — but scoped as a light/hybrid editor**, not a full
   card-logic builder: rename labels, edit `appliesToType`, edit static field lists,
   reorder cards, with **raw fallback** for imperative `fields: function(){}` cards.
   Same "visual where we can, raw where we can't" philosophy as the rule builders.
3. **Translations** (light key/value editor over `messages-*.properties`).
4. **Roles/permissions** (structured editor over the roles array).

## Not gaps (don't build)
- Form-eligibility logic — **already shipped** (context flags + extras helpers +
  Phase 0 properties wiring).
- pyxform recompile / live Enketo preview / Docker / CI-CD — out of MVP per CLAUDE.md;
  users run `cht-conf` / `cht --local`.

## Next step
Pick the top gap to take forward → run the requirements/validation triad
(Bhishan/Lal/Lorena) → write its dedicated `docs/plans/<gap>.md`. Recommend starting
with **Targets** unless the planner wants the contact-summary card display first.
