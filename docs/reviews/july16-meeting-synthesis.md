<!--
Planner synthesis of the July 16 2026 squad meeting transcript (no-code CHT).
Maps the meeting's decisions onto what the UI Builder has already shipped vs the
greenlit roadmap, and pulls out net-new signals. Source transcript:
C:\Users\ADMIN\Documents\july 16 meeting transcript no code cht.txt. Written 2026-07-16.
-->

# Synthesis — July 16 squad meeting (no-code CHT) vs. our roadmap

**Why this matters:** the meeting is scoping the *same problem this tool solves*, and
explicitly references our demo ("the demo Pra[jwol] did… a general UI for CHT
configurations"). So this is external validation + direction for the roadmap — read it
as "where the wider squad thinks this should go," and note we're **ahead of the phase
plan they drew** in several places.

## What the meeting decided
- **Three proposals on the table**, possibly front-ends to one backend:
  1. **Drag-and-drop / flowchart** (Trick-style, Swiss TPH; depends on draw.io) — visual workflow.
  2. **Form builder "in the spirit of Google Forms" + templates** — ← *this is essentially our tool.*
  3. **AI-assisted pipeline** (Ben's team): doctors write *intent* (clinical guideline / CHW manual) → AI generates the form → clinicians approve as a form/flowchart/decision.
- **Phase 1 / MVP (agreed):** let **non-technical** users make **simple form changes** — edit an existing form, add a question/field, fix labels/spelling, translations. **Explicitly NOT logic** (relevant / calculations / constraints) — deferred to Phase 2. Extension libs + summary logic out of MVP.
- **Templates + drag-and-drop pair up** (template as the starting point, drag-drop to modify) — but MVP is a **simple WYSIWYG**, not the flowchart.
- **Strongly emphasized (multiple people):** a **WYSIWYG preview** — render the form as the user sees it, edit inline (Josh, Samuel). Referenced Project Explorer (renders, can't edit).
- **Also requested:** a **sandbox/test instance** — make a change, fill the form, and *see the result: the task it triggers, the contact-summary update*. Plus **versioning + rollback**.
- **FHIR compliance** (Andra) — keep in scope or near-term.
- **Personas:** Phase 1 = non-technical; Phase 2 = technically-savvy-but-not-CHT-specialist (still needs to run the pipeline).

## Map to what we've SHIPPED (we're ahead of their phase plan)
| Meeting item | Our status |
|---|---|
| Non-technical simple form edits (add question/field, labels) | ✅ **Shipped** — tile picker, inline choices, Simple mode |
| Edit **existing** forms non-destructively | ✅ **Shipped & a differentiator** — lossless round-trip preserves unknown columns/sheets (see below) |
| Templates as starting point | ✅ **Shipped** — new-project templates + quick hierarchy creator |
| Phase-2 "logic" (relevant/calc/constraint/choice_filter) | ✅ **Already shipped** — visual builders + cross-form refs; we're a full phase ahead |
| Tasks (their "even harder than forms") | ✅ **Shipped** — task builder + event date-anchor picker (ANC-8 no-code) |
| FHIR compliance (Andra's ask) | ✅ **Shipped** — FHIR standard-codes mapping (LOINC/ICD/CIEL) |

## Map to our GREENLIT roadmap (their asks = our Tier 1) — strong validation
- **WYSIWYG preview** (their #1 lacking item) = our **Tier 1 live form preview**. Multiple stakeholders want it → confirms it as the top post-queue priority.
- **Sandbox: fill a form → see the task fire + contact-summary update** = our **workflow simulator** almost verbatim. Independent demand for exactly the feature we scoped. Keep it; it's a differentiator none of the three proposals offer.
- **AI pipeline + WYSIWYG "fit together perfectly"** (Josh: generate, then tweak one word in a visual editor) = the **AI → XLSForm-IR → editor** path. Our `XLSForm` object is the natural hand-off IR between Ben's AI pipeline and our editor; a JSON Schema over it + the Tier-0 preflight validator is the safety gate.

## Net-new signals for us to act on
1. **Our round-trip editing is a genuine moat — surface it.** David's key concern: *existing forms are hard to edit unless built with the tool's own grammar; even the AI pipeline has to rewrite them.* Trick rewrites; AI rewrites. **We edit in place, losslessly.** That's a real advantage over both other proposals for the "edit an existing CHT config" job — worth stating explicitly in positioning.
2. **We are the MVP they're describing — and past it.** Reframe our messaging to the squad: Phase 1 (non-technical simple edits) is *done*; we're delivering their Phase 2 (logic) now. Risk to manage: don't let the tool be scoped *down* to "labels only" when it already does more.
3. **Preview + simulator are now the clear priorities** — externally demanded, and they're what turns "impressive to a dev" into "trusted by a PO." Consistent with our Tier-1 ordering.
4. **Positioning vs Trick:** Trick is flowchart-first, denovo-oriented, draw.io-dependent, great for longitudinal/state-based *visualization* but still needs technical people for the arithmetic (Nepali-calendar, vaccination eligibility). We're WYSIWYG/edit-in-place. **Complementary, not competing** — a flowchart *view* could even be a later Tier.
5. **Versioning/rollback** — we're local-first + git-tracked, so the substrate exists; an in-UI version/rollback surface is a future Tier-3 item they explicitly want.
6. **FHIR compliance stays in scope** (Andra) — we already lead here; keep it.

## Addendum 2026-07-30 — "Direction agreed to date" (squad's consolidated MVP scope)

The squad's post-meeting scope note (pasted by the PO 2026-07-30) refines the July-16 direction. Mapping against our shipped state:

**Already shipped (their Phase-1 editable set):** question labels ✅ · hints ✅ (per-locale) · choices add/edit ✅ · typo/translation fixes ✅ (translations editor + add-language) · mandatory↔optional toggle ✅ (`FormEditor.tsx:2044-2052`) · question order ✅ (dependency-guarded reorder) · simple new form ✅ (label-first create + scaffold) · templates ✅ · hierarchy ✅ (they rank it "good to have" — we're ahead) · contact hydration ✅ mostly (lineage builder + inputs scaffold).

**Their Phase 2 (calculations / relevance / constraints):** ✅ already shipped — we remain a phase ahead.

**Net-new signals (NOT currently covered) — the four gaps their MVP scope opens:**

| # | Gap | Their words | Our state | Shape of the work |
|---|---|---|---|---|
| A | **Variable-name freeze on deployed forms** | "Not editable: variable names — changing them mid-collection breaks the meaning of longitudinal data" | We *allow* name edits (advanced `NameInput`) and have greenlit the rename-macro. The macro keeps the **form** consistent but cannot fix **already-collected reports** — their concern is data continuity, not ref integrity | Policy layer: block (or hard-warn) `name` edits on forms that are deployed / have collected data; rename-macro stays for pre-deployment. Needs a "deployed" signal (git tag? deploy history? explicit flag) |
| B | **Icons/images editor = properties + resources.json + form media** | "icons/logos live in form properties and resources, not the XLS — the tool must edit properties and resources too" | Properties `icon` is a raw string field; `resources.json` has **no editor** (only a preflight warn); no `media::image`/`<form>-media` handling | Small resources manager: list/upload images, maintain `resources.json` key→file map, icon *picker* in PropertiesEditor; later `media::image` on questions |
| C | **Persona/role form assignment** | "assigning it to a persona via form properties. Whole-form visibility per role is easy" | ContextExpressionBuilder has **no user-role rule kind** (verified — contact-type/age/summary-flag only) | Add a "logged-in user role/type" rule kind to the builder + parser (canonical CHT mechanism to be confirmed via cht-specialist: `user.*` in the context expression vs the properties `permission` key). Per-question role visibility stays out (matches their scope note) |
| D | **WYSIWYG rendered editing surface** | Phase 1 is "simple edits… through a rendered, WYSIWYG-style view" | Our editor is tile-based; live preview is greenlit Tier 1 but as *preview* | Raises Tier-1 preview from "see it" to "the editing surface": minimum viable = click-a-question-in-preview → opens its editor card (bridge), full inline editing later |

**Caveat they recorded** (only the first survived the paste): every interface works best de novo; editing arbitrary existing forms is hard for all of them — forms built in the tool's own grammar re-edit easily. **This is our moat restated** — we are the only proposal that edits existing configs losslessly in place.

**Planner recommendation:** A and C are small and land squarely inside their MVP definition — do first. B is medium (new file surface + upload plumbing) but explicitly named in-scope by the squad. D folds into the existing Tier-1 preview plan (upgrade its acceptance criteria rather than opening a new item).

## Recommended planner actions
- **Reaffirm roadmap order** — current queue → live preview → workflow simulator; the meeting validates both Tier-1 items as externally demanded.
- **Add "AI → XLSForm-IR" as an explicit roadmap item** (JSON Schema over the `XLSForm` object + preflight gate) — it's the integration seam with Ben's AI pipeline that Josh wants paired with WYSIWYG.
- **Write a one-page positioning note** for the squad: what's already shipped (Phase 1 + most of Phase 2), the round-trip-editing moat, and how we slot with the AI pipeline + Trick rather than competing.
- **Don't regress scope** — resist any "MVP = labels only" framing that undersells shipped capability.
