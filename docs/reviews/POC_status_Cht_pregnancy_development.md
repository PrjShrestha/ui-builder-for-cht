<!--
POC feasibility status: can the UI Builder for CHT build the "Pregnancy Tracking
System in CHT" described in the external design doc? Grounded against the tool's
actual left-nav editors + CLAUDE.md scope. 2026-06-28.
Source spec: "Pregnancy Tracking System in CHT — End-to-End Development Guide v1.0".
-->

# POC status — CHT pregnancy tracker on the UI Builder

**Date:** 2026-06-28 · **Tool HEAD:** `1e84332` (master) · **Assesses:** "Pregnancy
Tracking System in CHT — End-to-End Development Guide v1.0" (external .docx).
**Method:** mapped the spec's 15 sections against the tool's real editor surfaces
(left-nav: Overview, Hierarchy, Forms, Tasks, Contact summary, Decisions, Deploy,
Standard codes) and the CLAUDE.md scope boundaries.

## Verdict
**Feasible — this is the tool's canonical use case.** A pregnancy tracker is exactly
the kind of cht-conf project the builder edits non-destructively. It covers the
**spine** of the spec: hierarchy, contact types, contact forms, all application
forms, tasks, and the contact-summary *context* — i.e. all of Phase 1–2 and most of
Phase 3. **Four areas fall outside the no-code UI** and are hand-edited (the tool
preserves those files verbatim, so they coexist safely) or run via `cht-conf`,
exactly as the spec's own Testing/Deployment sections already assume. Roughly **70%
is point-and-click; the dashboards, the card *visuals*, roles, and full translations
are code edits.**

## Coverage matrix
| Spec section | In the UI? | Where / how |
|---|---|---|
| 1–2. Hierarchy + contact types | ✅ Full | **Hierarchy** tab → Quick hierarchy creator |
| 3. Contact forms | ✅ Full | Hierarchy → *Generate forms* → edit in **Forms** |
| 4. Application forms (Pregnancy reg, ANC, Delivery, PNC, Newborn…) | ✅ Full | **Forms** tab → new app form → survey editor |
| 5. Document structure | ✅ Emerges from the forms | — |
| 6. Tasks (ANC scheduling) | ✅ (date-window math may need raw expressions) | **Tasks** tab |
| 7. Condition cards (visual display) | ❌ **Not editable** (`cards[]` preserved verbatim) | hand-edit `contact-summary.templated.js` |
| 8. Contact summary — *form-eligibility logic* | ✅ **Editable** — context flags **+ extras.js helpers** (the "which forms show when" logic) | **Contact summary** tab → Context flags / Helpers |
| 8. Contact summary — *visual display* (`fields[]`/`cards[]`) | ❌ Verbatim, not editable | hand-edit `contact-summary.templated.js` |
| 9. Targets / dashboards | ❌ **Out of scope** (no editor, dropped by decision) | hand-edit `targets.js` |
| 10. Permissions / roles | ❌ No editor | hand-edit `base_settings` / `roles.json` |
| 11. Translations | ⚠️ Partial (form labels only; no mgmt UI) | labels in editor; hand-edit `.properties` |
| 12–13. Testing / deployment | ⚠️ Assisted | **Deploy** tab drives `cht-conf` convert/upload; still run `cht --local` |
| 14. Project structure | ✅ It edits a real cht-conf folder | — |

## Step-by-step build guide

**Before you start:** run the editor (`pnpm dev`, app on :5173) with a cht-conf
folder. Recommended: start from the **Empty** template so the Quick hierarchy creator
lays down your exact hierarchy. (Shortcut: **CHT baseline** ships ready-made
pregnancy/ANC/delivery/PNC forms to adapt, but its hierarchy differs from the spec.)

### Phase 1 — Hierarchy, contact types & contact forms
1. **New project → Empty template**, pick a folder (e.g. `pregnancy-tracker`), create; it opens.
2. **Hierarchy tab → Quick hierarchy creator.** Add place levels biggest→smallest:
   **District → Municipality → Health Facility → Household**, then name the person
   leaf **Person**. Finish — it scaffolds the contact types, the parent chain,
   `place_hierarchy_types`, and labels.
3. Accept the **"Generate contact forms"** offer → minimal-valid `*-create`/`*-edit`
   forms for every type (the spec's §3 list).
4. **Add the custom fields** from §2 (District Code, Facility Type, Ward, GPS
   Coordinates, National ID, Relationship to Household Head…): open each contact
   create form in **Forms** and add the questions in the survey editor. (The generator
   makes only the minimal name/sex fields — you add the rest here.)

### Phase 2 — Application forms (the health events)
For each of **Pregnancy Registration, ANC Visit, Danger Sign Assessment, Delivery,
Postnatal Visit, Newborn Registration**:
5. **Forms tab → new App form.** The scaffold gives `inputs / user / contact` groups + linking calculates.
6. Add the §4 questions with the right types — LMP/EDD/dates = `date`,
   Gravida/Parity/Visit Number = `integer`, Blood Group/Delivery Type = `select_one`,
   Danger Signs = `select_multiple`, etc.
7. Use the visual **relevant / constraint / calculation / choice_filter** builders for
   logic (e.g. `EDD = date(LMP + 280)`; show danger-sign follow-up only when a sign is
   positive). Anything outside their grammar drops to a **raw-text editor preserved on
   save**.
8. To read the mother's data into a visit form, use cross-form references:
   contact-summary context keys and `../inputs/contact/<field>` are pickable in
   calculation *and* relevant/constraint/choice_filter (wired this session).

### Phase 3 — Tasks & contact summary
9. **Tasks tab.** Author §6 tasks — Pregnancy Registration, ANC 1–4, Expected
   Delivery, PNC (1/3/7/42 days), Child Registration, Vaccination Reminder; set the
   trigger form + scheduling. **Note:** the gestational-week windows (16 / 20–24 /
   28–32 / 36 wks off LMP) are date math — set what the builder supports and drop to a
   raw expression for the window calc; custom JS stays byte-stable.
10. **Contact summary tab.** This is where "which forms show up when" lives, and it
    **is** editable: the **Context flags** sub-tab edits the `summary.<flag>`
    eligibility flags forms gate on (e.g. `show_pregnancy_form`, `show_delivery_form`),
    and the **Helpers (extras.js)** sub-tab edits the predicate functions those flags
    call (`isReadyForNewPregnancy`, …). Phase 0 wired these into the form properties
    editor so the form's eligibility expression validates against them.
11. **⚠️ Out of the UI for cards:** the Person/Household/Facility summary **cards and
    fields** (§7 + the §8 display lists) are *not* editable here — author `cards[]` /
    `fields[]` by hand in `contact-summary.templated.js`. The tool preserves them
    untouched on save.

### Phase 4 — Targets, permissions, translations (hand-edited)
12. **Targets (§9):** edit `targets.js` directly — dashboard indicators have no editor.
13. **Permissions/roles (§10):** edit roles/permissions in `app_settings` directly.
14. **Translations (§11):** form labels set in the editor land in the form; for
    `messages-en.properties` / `messages-ne.properties` task/card/target strings, edit
    the `.properties` files directly.

### Phase 5 — Test & deploy
15. **Deploy tab.** Convert + upload forms and app-settings to a CHT instance (runs
    `cht-conf` with your creds; git-changed detection shows pending work). Use the
    deploy-readiness checklist.
16. Run the §12 manual walk-through (`cht --local`, then District→…→Person, register a
    pregnancy, complete ANC, etc.). The tool does **not** recompile pyxform or give a
    live Enketo preview — run `cht-conf` / `cht --local` for that, as the spec states.

## Gaps as potential tool work (planner note)
The four out-of-UI areas are a clean real-world signal of where the no-code surface
ends. Candidates if we want a project like this to be 100% no-code:
- **Targets editor** (§9) — currently dropped by decision; this spec wants 9 indicators.
- **Condition-card / contact-summary `cards[]` + `fields[]` *display* editor** (§7–8) —
  the *logic* (context flags + extras.js helpers, i.e. which forms show when) is
  already editable; only the visual profile display is verbatim. See
  `docs/plans/no-code-coverage-gaps.md`.
- **Roles/permissions editor** (§10) and **translations management** (§11) — thin/absent.

None are blockers for the POC (all are code-editable and preserved verbatim), but
they're the recurring "drop to code" moments a non-technical DHO would hit.
