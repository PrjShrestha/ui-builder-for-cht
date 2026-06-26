<!--
Planner reference + roadmap: how data passes between forms in CHT, what our no-code editor
already supports, and a phased plan to close the gaps.
Source: workflow wf_ae0ba4b9-f7e (2026-06-26) — 4-agent ground (CHT domain + 3 codebase
surfaces) → synthesis → adversarial verify. Verifier corrected the lineage-UI status
(it's mostly built, not greenfield). Verdict: sound-with-notes.
-->

# Form-to-form data passing in CHT — what's done, what's missing, the plan

**Version:** v0.1 — 2026-06-26 · **Status:** verified reference + roadmap.

## 1. How CHT passes data between forms (domain reference)
There is **no direct form→form pipe.** Data flows **report → a shared store → the next
form**, via two genuine cross-submission channels + plumbing:

- **① contact-summary** — `contact-summary.templated.js` computes a `context: {}` object
  from the contact doc **+ all that contact's prior reports**; CHT serializes it into the
  secondary `instance('contact-summary')`, and a new form reads derived prior-report state
  via `instance('contact-summary')/context/<key>`. (Also exposed to `properties.json`
  `context.expression` as `summary.<flag>`.) **The canonical report→form channel.**
- **② tasks** — a task in `tasks.js` fires off a triggering contact/report; tapping it
  opens a target form and `actions[n].modifyContent(content, contact, report, event)`
  injects values from the triggering report straight into the new form. **The most
  explicit form-to-form hand-off.**
- **Plumbing:** `inputs/contact` hydration (contact doc — incl. fields an earlier
  create/edit form wrote back — flows into `../inputs/contact/*`); `inputs/user`
  (logged-in user's settings doc); `select-contact`/`db:person` mid-form pickers; contact
  create/edit **write-back** to the contact doc (the upstream half); `source`/`source_id`
  routing (People vs Reports vs Task); `instance('user-contact-summary')` (4.21.0+).

## 2. Cross-map — what our editor supports (verified against code)
| CHT mechanism | Status | Surface | Gap |
|---|---|---|---|
| `instance('contact-summary')/context` — define keys + read into a **calc** | ✅ done | contact-summary | Reading works **only in the calculation column**; flag *bodies* are raw-JS unless via the extras.js helper |
| `inputs/user` hydration (who-submitted) | ✅ done | inputs-scaffold | Scaffold-on-create only; no in-editor toggle to add/remove later |
| tasks.js authoring (appliesTo/appliesIf/events/actions/form-launch) | ✅ done (auth) | tasks | — |
| `inputs/contact` hydration | ◑ partial | inputs-scaffold / calc | Single leaf only (no ancestor chain on create); `../inputs/contact/X` readable **only in calc**, not condition cards |
| Contact create/edit **write-back** | ◑ partial | forms | No affordance frames a field as "writes to the contact doc; later forms read it" |
| `select-contact`/`db:person` mid-form picker | ◑ partial | inputs-scaffold | Only the scaffolded `_id`; no no-code "pick a *different* contact (referral/household)" affordance |
| `source`/`source_id` routing | ◑ partial | scaffold / tasks | `source` emitted; **`source_id` has no first-class control** (raw text only) |
| tasks `modifyContent` (report field → form B) | ◑ partial | tasks | Only the single visit-window checkbox is structured; **arbitrary report-field→form-field mapping is raw JS** |
| `properties.json` `context.expression` (form eligibility, `summary.<flag>`) | ◑ partial | contact-summary | `PropertiesEditor` mounts the builder **without `summaryFlags`** → free-type, no key validation |
| **Condition cards** referencing contact-summary / contact-input | ❌ missing | condition cards | relevant/constraint builders take **only `fieldOptions`**; `contextKeys`/`inputContactFields` go **only** to the calc column — the sharpest asymmetry |
| `instance('user-contact-summary')` (4.21.0+) | ❌ missing | contact-summary | No key source/emitter |

**So, to your three surfaces:** **contact summary** is the strongest — genuinely no-code
for *defining* keys and *reading them into a calculation*. **Tasks** are well-authored
(triggers/conditions/actions) but the actual *data hand-off* (report field → launched
form) is mostly raw JS. **Condition cards** can only see same-form fields + cross-form
contact-choice *values* — they **cannot** gate on contact-summary/contact-input data.

## 3. Phased plan (cheapest-first, verified)
- **Phase 0 — one-line wiring (highest value/effort):** in `PropertiesEditor`, call
  `useContactSummaryContextKeys()` and pass it as `summaryFlags` to the already-mounted
  `ContextExpressionBuilder` (it already renders a flag `<select>` when the prop is
  non-empty — today it degrades to free-type). Makes the `summary.<flag>` form-eligibility
  rule validate against the keys the user actually defined.
- **Phase 1 — let condition cards reference contact-summary + contact-input (closes the
  sharpest asymmetry):** thread `contextKeys` + `inputContactFields` (already flowing to
  the calc `ExpressionField`) into the relevant/constraint/choice_filter builders +
  `UnifiedConditionBuilder`/`RelevantRuleBuilder`; extend the `relevantParser` grammar with
  rule kinds for `instance('contact-summary')/context/<key>` and `../inputs/contact/<field>`
  so they round-trip structurally (raw fallback preserved for anything unparseable). Highest
  functional value — gate visibility/validation on derived prior-report state.
- **Phase 2 — structured task→form data mapping:** a key:value `modifyContent` builder
  (set `content.<field>` from report fields / event values) + a first-class **`source_id`**
  control. Unlocks no-code authoring of the strongest cross-form channel (today only the
  one visit-window pattern is liftable; `source_id` has no control at all).
- **Phase 3 — finish the lineage inputs UI (last-mile wiring, NOT greenfield).**
  **Verifier correction:** the engine (`buildHierarchyBlock.ts`, tested) **and most of the
  UI already exist** — `client/src/ui/LineageBuilder.tsx` (~370 lines, imports
  `buildHierarchyBlock`/`computeLineageChain`), the `lineage_block` tile
  (`QuestionTypeCatalog.ts:294`), and `FormEditor.tsx:631-664` picker-interception + state.
  The remaining gap is narrow: **(a)** `<LineageBuilder>` is never rendered as JSX,
  **(b)** `lineageHierarchy` is never hydrated (`setLineageHierarchy` never called),
  **(c)** `lineageInsertIndex` is never read, **(d)** no commit-splice handler. So Phase 3 =
  *render the modal + hydrate the hierarchy from `/api/hierarchy` + handle the commit splice*,
  then the preview ladder / toast / staleness badge from `hierarchy-block-generator.md`.
- **Phase 4 — depth + stretch:** visual builder (or guided helper-call) for contact-summary
  flag *bodies*; a no-code `select-contact` "pick a different contact (type-…)" affordance
  with auto-derived `name`/`patient_id` calcs; `instance('user-contact-summary')` (4.21.0+);
  surface `duplicate_check` (4.19.0+).

## 4. Verifier notes (folded in)
Verdict **sound-with-notes**, no missed mechanisms. The one substantive correction: the
synthesis (inheriting a grounding error) claimed the lineage feature has "zero client
importers / no tile" — **false**; it's substantially built (see Phase 3), so it's last-mile
wiring, not a from-scratch build. The `hierarchy-block-generator.md` plan's effort estimate
should be read down accordingly. `user-contact-summary` = genuinely missing (confirmed).
