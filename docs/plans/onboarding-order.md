<!--
Planner-locked plan: new-project onboarding order + starting point.
Grounded against the templates (server/templates/*) and CHT docs (2026-06-26).
-->

# Plan: Onboarding order + new-project starting point

**Version:** v0.1 — 2026-06-26 · **Status:** PLANNER-LOCKED, developer-ready.

## 1. The recommended order (locked, matches CHT docs)
**Hierarchy → contact forms (per type) → app forms → tasks.** Why:
- **Hierarchy is the foundational dependency** — `contact_types` + `place_hierarchy_types`
  define the people/place types everything else references.
- **Contact forms are per contact-type** — a "person edit" form presupposes a `person` type.
- **Tasks are scoped to contacts in the hierarchy** — they process contacts per the user's
  position in the tree; a wrong hierarchy targets the wrong contacts.
- **Changing the hierarchy after launch is disruptive** — every contact/report doc stores
  ancestor IDs, so a later hierarchy change means rewriting all of them. Get it right first.
  (CHT: "Set Hierarchy", "Configurable Hierarchies", "Task Schema Parameters".)

## 2. Does CHT work without a hierarchy? (the nuance behind the guardrails)
**It boots and runs** — CHT falls back to the legacy default hierarchy
(`district_hospital → health_center → clinic → person`); `cht-conf`/deploy won't hard-fail
on empty `contact_types`. **But** you're then stuck with default types, **can't create
contacts in-app without contact forms**, and any form referencing an undefined type
(`select-contact type-<x>`, lineage, task `appliesToType`) **fails silently** at runtime.
So a hierarchy is **not a hard platform requirement but a practical one** — and because the
failure is *silent default-fallback / unresolved refs* (not a crash), a non-technical author
won't notice. **That is why we guide + warn rather than rely on errors.**

## 3. Starting point — default to `blank`, NOT `cht-default` (the key decision)
What each template actually ships (verified):

| Template | contact_types | app forms | contact forms | Role |
|---|---|---|---|---|
| `empty` | 0 | 0 | 0 | the real trap (silent fallback) — **de-emphasize / warn** |
| **`blank`** | **3** (district, health_facility, patient) | **0** | **0** | **DEFAULT** — foundation, no baggage |
| `malaria` | 5 (district…chw…patient) | 0 | 0 | opt-in deeper hierarchy starter |
| `cht-default` | 4 | 11 | 4 | the heavy baseline — opt-in "learn from an example", **not the default** |

**Decision (user, 2026-06-26): keep the existing new-project picker AS-IS — do not change it.**
The author already chooses `blank` / `cht-default` (etc.) at project creation, and that UX is
good — `blank` gives the foundation-without-baggage path, `cht-default` gives the learn-from-an-
example path. **No change to `NewProjectWizard` / the template list / the default selection.**
The no-hierarchy risk is handled entirely by the **post-pick guardrails** below (which work no
matter which template was chosen), so we don't need to touch the picker. (The table above is just
context for *why* the choice matters.)

## 4. Guided new-project flow
1. **Pick a starting point** — default `blank` (hierarchy seed); examples opt-in.
2. **Hierarchy first** — land the author in the Hierarchy editor to rename/define their
   contact types + levels (blank's district/health_facility/patient are placeholders).
3. **Generate contact forms per type** — reuse `buildContactFormScaffold` (one create/edit
   per defined type) so the hierarchy is actually populatable in-app.
4. **Build app forms** — hierarchy now available for `select-contact`, the lineage block,
   and properties `context.expression`.
5. **Build tasks / contact-summary** — they reference forms + types defined above.

## 5. Guardrails — guide, don't gate
- **Do not hard-block** form-building on a defined hierarchy (kills cold-start; CHT runs
  without one anyway).
- **Forms-tab nudge** when `contact_types` is empty: *"No contact types defined yet — your
  contact selectors, lineage blocks, and tasks won't have types to reference. Define your
  hierarchy first →"* (links to the Hierarchy editor).
- **Deploy-readiness checklist** before Deploy: hierarchy defined? a contact form per type?
  app-form contact selectors / lineage / tasks reference *defined* types? `base_settings`
  valid? — catches the silent-mismatch before it ships.
- **Graceful empty-hierarchy handling** in the scaffold + lineage generator (the scaffold's
  hardcoded `type-person` should degrade sanely when `person` isn't defined; lineage already
  has the empty-hierarchy test).

## 6. UI hooks
- **`NewProjectWizard.tsx`** — **no change** (per user): the existing `blank` / `cht-default`
  template picker stays as-is. (Listed only to say explicitly: leave it alone.)
- **`ProjectOverview.tsx`** — show the recommended order / a "next step" hint; the overview
  already disables sections by file presence — add a "start with Hierarchy" cue on a fresh
  project.
- **Forms tab (`FormEditor`/`FormsIndex`)** — the empty-`contact_types` nudge.
- **`DeployPanel.tsx`** — the readiness checklist.

## 7. Decisions (locked 2026-06-26)
1. **Order:** Hierarchy → contact forms → app forms → tasks (§1).
2. **Keep the new-project picker AS-IS** (user, 2026-06-26) — `blank` / `cht-default` choice at
   creation stays unchanged. The no-hierarchy risk is covered by the post-pick guardrails (§5),
   not by changing the picker.
3. **Guide, don't gate** — warnings + readiness checklist, no hard blocks (§5), because the
   no-hierarchy failure mode is silent, not a crash (§2).
4. **Contact-form generation is OFFERED, not auto** (user decision 2026-06-26). After the
   author defines/edits their hierarchy, the editor offers — never forces — to generate the
   create/edit contact forms for the defined types (configurable, per-type). The exact
   generated structure + affordance are scoped + adversarially verified in
   `contact-form-generator.md` (must match real CHT contact forms — contact_type-named top
   group + init-group `select-contact` placement, NOT a nested parent chain).

## 8. Resolved (was open)
Step 3 (generate contact forms per type) is **OFFERED, not automatic** (Decision 4) — keeps
the author in control, consistent with the configurable-not-forced stance of the scaffold/
lineage plans. The generator itself (what it emits per type, the affordance) is scoped in
`contact-form-generator.md`.
