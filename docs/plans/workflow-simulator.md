<!--
Planner plan for the Tier 1 "workflow simulator" — a sandboxed rules harness that
lets a PO enter a sample contact + sequence of sample reports and SEE the CHT
care-continuity outputs light up (context flags, form availability, task firings,
target increments). Plan-only cycle: no runtime, no components. Pins the data
shapes + eval contract + sandbox boundary so the next dev can build without
re-deriving the core wiring. 2026-07-01.
-->

# Plan: Workflow simulator (Tier 1)

**Status:** v0.1 — PLANNER-LOCKED, **PLAN-ONLY THIS CYCLE** · **Owner:** planner
· **Follows:** Tier 0 (preflight + owned deploy) + Tier 2 (cards/fields editor + translations).
· **Leapfrog claim:** neither CommCare nor Kobo simulates care-continuity logic
  end-to-end. This is the differentiator.

## 1. Problem

The PO/DHO opens a real project in the editor and has **no way to answer "if I
register this pregnant patient today and submit ANC visit 1 in two weeks, does
the ANC-2 task fire on the right date? Does the pregnancy card render? Does the
danger-sign form become available?"** Today the only way to answer is to deploy
to a dev instance, register a synthetic patient, and click through the app —
minutes to hours per what-if, and requires a technical dev. The editor already
**parses** the rules that answer these questions (`appliesIfParser`,
`contextExpressionParser`, `eventsParser`, `contactSummaryParser`,
`actionsParser`, `helpersParser`) but never **evaluates** them.

Concrete gaps:
- No JS evaluation runtime — nothing sandboxes the raw-fallback bodies our
  parsers hand back verbatim (raw `dueDate`, raw `appliesIf`, raw context
  flags, custom `contact-summary-extras` helpers).
- No synthetic-document builder — no UI to construct a sample contact doc
  and a chronological array of sample reports.
- No timeline output — no component to render "at t=0 the contact registered,
  at t=+14d you submitted `pregnancy_visit`, so at t=+28d task X fires and
  target Y increments by 1."
- No `Utils.*` mock layer — the CHT runtime injects globals (`Utils.getField`,
  `Utils.addDate`, `Utils.getLmpDate`, `Utils.now`, `Utils.isTimely`,
  `isAlive`, `isMuted`, `isTaskUser`, `hasError`) that our sandbox must
  provide before any real config can run.
- No wiring to the project's real forms/contact types/helpers — the simulator
  must consume the same project state the rest of the editor does.

## 2. Scope this cycle

**Plan only.** Deliverable is this doc. **No implementation files, no route,
no component.** The next cycle's dev builds directly from §3–§7.

**Ships next cycle (MVP v1):**
- Contact-doc editor + report-doc list editor keyed to the project's real forms
  and contact types (all pickers reuse existing components).
- Deterministic evaluation pipeline: contact-summary compute → form
  availability (`context.expression`) → task fire (`appliesIf` + `events`) →
  target increment.
- Timeline output: one row per simulated tick, showing which flags flipped,
  which forms became/left available, which tasks fired (with due date +
  window), which targets incremented.
- Sandbox with `Utils.*` + standard CHT helper stubs; project-custom
  `contact-summary-extras` helpers evaluated in the sandbox.
- Read-only: **never writes back to the project folder** (§3.5).

**Defers to v2 (documented, not built):**
- Target computation UI beyond a count-only summary (histogram of target
  values over time). v1 computes; v2 visualizes.
- Live enketo form preview integrated into the simulator (own Tier 1 plan doc).
- Multi-user simulation (task assignment across roles).
- Rewind / step-back through the timeline.

## 3. Shared contract (the load-bearing part)

The simulator has no shared parser/serializer — round-trip safety does not
apply (read-only, §3.5). It **does** have a load-bearing contract for the
inputs, outputs, and sandbox boundary that must be pinned before the dev
can build. This is the "shared eventsParser contract" analogue for this
feature.

### 3.1 Input shapes

Placed in `shared/src/simulator/types.ts` (new file — no existing module
fits; simulator is a new domain).

```ts
export interface SimContact {
  /** CHT doc `_id`; UI generates a synthetic UUID. */
  _id: string;
  /** Always 'contact' for configurable hierarchies; 'person'/'clinic'/etc.
   *  for legacy cht-default. Simulator honors whichever the project uses. */
  type: string;
  /** Configurable-type discriminator; empty when `type` is the legacy value. */
  contact_type?: string;
  /** Free-form user fields keyed to XLSForm names on the contact-create form. */
  fields: Record<string, string | number | boolean | null>;
  /** Optional lineage (parent chain). UI builds from the project's hierarchy. */
  parent?: SimContact;
}

export interface SimReport {
  _id: string;
  /** The form_id (e.g. 'pregnancy_visit'). Must match one of the project's app forms. */
  form: string;
  /** UNIX ms. Simulator sorts reports by this before evaluating. */
  reported_date: number;
  /** All XLSForm answers, flat by name (Utils.getField handles dot-notation). */
  fields: Record<string, string | number | boolean | null>;
}

export interface SimInput {
  /** t=0 for the simulation clock; defaults to `Date.now()` at UI mount. */
  clockStart: number;
  /** How far ahead to project task firings (default: 365 days). */
  horizonDays: number;
  contact: SimContact;
  /** Sorted ascending by reported_date before evaluation. */
  reports: SimReport[];
}
```

### 3.2 Output shape (the timeline)

```ts
export type SimEventKind =
  | 'contact_registered'    // t=0
  | 'report_submitted'      // one per SimReport
  | 'flag_changed'          // context flag value changed
  | 'form_available'        // context.expression flipped false→true
  | 'form_unavailable'      // true→false
  | 'task_fired'            // appliesIf true AND event.days offset reached
  | 'target_incremented';   // v1 emits; visualization deferred to v2

export interface SimTimelineEntry {
  t: number;                    // absolute ms
  tRelDays: number;             // days since clockStart
  kind: SimEventKind;
  detail: string;               // human-readable ("flag show_anc_form: false → true")
  refs: {                       // machine-readable pointers so the UI can deep-link
    reportId?: string;
    formId?: string;
    taskName?: string;
    flagKey?: string;
    targetId?: string;
  };
}

export interface SimResult {
  timeline: SimTimelineEntry[];
  /** Final state at horizonDays for a "state summary" pane. */
  finalContextFlags: Record<string, unknown>;
  finalAvailableForms: string[];
  finalScheduledTasks: Array<{ name: string; dueDate: number; startDate: number; endDate: number }>;
  finalTargetTotals: Record<string, number>;
  /** Any expression that fell to raw fallback and threw during eval — surfaced verbatim. */
  evalErrors: Array<{ where: string; source: string; message: string }>;
}
```

### 3.3 Evaluation order (deterministic, one pass)

For each tick (contact registration + each report in chronological order):

1. **Advance clock** to the tick's timestamp.
2. **Rebuild the contact-summary compute** with the current `(contact, reports-so-far, latest-report-or-null)`:
   - Evaluate every context flag expression (raw string via
     `contactSummaryParser.contextFlags`) in the sandbox.
   - Diff against previous flag snapshot → emit `flag_changed` entries.
3. **Rebuild form availability**: for every app form's `context.expression`,
   evaluate against `(contact, summary)`; diff → emit `form_available` /
   `form_unavailable`.
4. **Rebuild task list**: for every `tasks.js` task,
   - Evaluate `appliesIf(contact, report)` for each report in `reports-so-far`
     (matching `appliesToType`). If true, for each `event`, compute
     `dueDate + start/end window`. If `dueDate <= horizon`, schedule it.
   - Diff scheduled tasks against previous snapshot → emit `task_fired` when
     a new task appears whose `dueDate <= currentTick + 1d` (or move to
     final-state list if beyond current tick).
5. **Increment targets** (v1 count-only): for each target in `targets.js`,
   evaluate its `appliesIf` against reports-so-far; if true and this is the
   first tick where it's true, emit `target_incremented`.

The pass is **pure**: same `SimInput` → same `SimResult`. No wall-clock
reads; every helper that would read wall clock (`Utils.now`, `new Date()`)
is patched to the simulator's tick clock (§3.4).

### 3.4 Sandbox boundary — what runs, what is mocked

Placed in `shared/src/simulator/sandbox.ts`.

**Runs in the sandbox** (real, project-authored JS):
- The full body of each `context.<flag>` expression.
- The full body of each task's `appliesIf` function (parsers hand us the body
  string; we wrap it in `function (contact, report) { ... }` and invoke).
- The full body of each task event's `dueDate` arrow (structured shapes
  from `eventsParser` are converted to a synthetic arrow before eval, so the
  eval path is uniform for both structured and raw).
- Every function in the project's `contact-summary-extras.js` (parsed by
  `helpersParser`; source pasted verbatim into the sandbox global scope).
- The full body of each `context.expression` on a form's `.properties.json`.

**Provided by the sandbox host** (mocked, project code never sees the real thing):
- `Utils.getField(doc, 'dot.path')` — safe dot-notation reader; returns
  `undefined` for missing paths.
- `Utils.addDate(date, days)` — returns a new `Date`; delegates to native
  `Date` math against the simulator clock.
- `Utils.getLmpDate(report)` — reads `report.fields.lmp_date` (fallback
  `report.fields.lmp_date_8601`); the field-location variance handled here,
  matching the real CHT helper.
- `Utils.now()` → the simulator's tick clock, **not** wall-clock.
- `Utils.isTimely(date, days)` — returns `true` iff `Utils.now() <=
  addDate(date, days)`.
- `isAlive(contact)` → `!contact.date_of_death` (top-level or nested).
- `isMuted(contact)` → `!!contact.muted`.
- `hasError(report)` → `!!report.errors && report.errors.length > 0`.
- `isTaskUser(user)` → `true` (single-user simulation; §2 defer).
- `ageInYears(contact)`, `ageInMonths(contact)`, `ageInDays(contact)` —
  computed from `contact.date_of_birth` against the simulator clock.

**Blocked entirely** (throw a clear message the timeline captures under
`evalErrors`):
- `require()`, `import`, `process`, `fs`, `child_process`, `fetch`, `XMLHttpRequest`, `WebSocket`.
- Global `Date` reads that don't route through `Utils.now`/`new Date()` are
  allowed (native), but `Date.now()` is overridden to the simulator clock.
- Any network, disk, or timer (`setTimeout`, `setInterval`) — throw.

**Isolation mechanism.** Use `node:vm` `Script` + `createContext` on the
server side (route `POST /api/simulator/run`). The client sends `SimInput`
+ project state deltas; the server executes and returns `SimResult`. Client
never eval's project JS in-process (keeps the browser tab safe from
project-authored infinite loops and lets us enforce a wall-clock timeout).
Wall-clock cap: **2 seconds per run**; on timeout return whatever timeline
was accumulated + a synthetic `evalErrors` entry.

Rationale for server-side over Worker: the server already has the parsed
project state in memory (used by every other route), and the sandbox needs
`contact-summary-extras.js` source — which the server already reads for the
helpers picker. No new project I/O added.

### 3.5 Round-trip / write-back invariant

**The simulator is strictly read-only.** It never modifies the project
folder. No writes to `tasks.js`, `contact-summary.templated.js`,
`targets.js`, `app_settings.json`, or any form file. `SimInput` is
in-memory (Zustand slice, persisted to session storage so a reload keeps
the sample doc). This is called out because every other editor in this
repo writes back — the simulator is the exception.

## 4. UI surface

Placed at `client/src/ui/SimulatorView.tsx` (new component). Mounted as a
new top-level sidebar entry **"Simulator"** in `Sidebar.tsx`, between
"Tasks" and "Contact summary" (grouped with the rules-facing views, not
the deploy pane).

### 4.1 Layout — two columns

**Left column: inputs**
- **Contact editor** — reuses `FieldPicker`-style form generation:
  - Contact-type dropdown populated from the project's `contact_types`
    (same source `HierarchyEditor` reads).
  - Field editor generated from the selected contact type's create form
    (reuses `useContactFormFields` + the field renderers already in
    `FormPreview`).
  - "Autofill realistic values" button — populates fields with template
    defaults per §7.4.
- **Report list** — chronologically ordered, add/remove/reorder:
  - Per row: form picker (`<select>` of the project's app forms — same
    source `ActionsEditor` reads), `reported_date` datepicker (defaults
    to "next unused date, spaced 14 days after previous"), field editor
    generated from the selected form (reuses `useReportFormFields`).
  - Drag to reorder; drag also re-sequences dates monotonically.
- **Clock start** + **Horizon days** inputs at the top.

**Right column: outputs**
- **Timeline pane** — vertical list of `SimTimelineEntry` rows, grouped
  by day. Each row is one line: `+14d · task_fired · anc_2 · due 2026-08-15`.
  Icons per `SimEventKind`. Click a row to expand the raw source of the
  rule that produced it (helper source, `appliesIf` body, `context.expression`
  text) — this is the deep-link into the underlying editor.
- **State summary tabs** at the bottom (final state at `horizonDays`):
  - `Flags` — the final `contextFlags` map (key + value + which
    contact-summary line produced it).
  - `Available forms` — flat list of forms with `context.expression → true`.
  - `Scheduled tasks` — table (name, dueDate, window).
  - `Targets` — table (target id, count) — v1 count-only.
  - `Errors` — the `evalErrors` list; each entry links to the file+line
    of the offending source (via existing "Open in editor" affordance
    used by `DecisionsView`).

### 4.2 Pickers reused (no new pickers)

- Contact type dropdown → same source as `HierarchyEditor`.
- Form picker (report add + report row) → same `<select>` `ActionsEditor` uses.
- Field editors → `useContactFormFields` + `useReportFormFields`.
- "Open in editor" links → same handler `DecisionsView` uses.

**No hand-typed identifiers anywhere.** The user never types a form_id,
a field name, a contact type — everything is picked from real project
data (per PO directive `decision_nocode_names_autoderived`).

### 4.3 Raw-JS fallback rendering

When an expression falls to `raw` (e.g. `appliesIfParser` returned
`hasRawFallback: true`, or `contactSummaryParser` couldn't parse a flag),
the timeline row still shows the outcome (the sandbox evaluated it) but
the expandable detail shows the raw source verbatim + a "This rule
couldn't be parsed by the visual builder" note. Consistent with the
visual-builder-fallback pattern in CLAUDE.md.

## 5. Server route

Extends `server/src/routes/cht-conf.ts` — no, on second look this belongs
in its own route: `server/src/routes/simulator.ts`. Rationale:
`cht-conf.ts` is the deploy-pipeline route; the simulator is a
read-eval-return endpoint with different lifetimes (fast, stateless) and
different failure semantics (a bad rule is not a deploy failure).

### 5.1 Endpoint

`POST /api/simulator/run`

**Request:**
```ts
{
  projectPath: string;   // absolute path — already on the server session
  input: SimInput;       // §3.1
}
```

**Response (200):**
```ts
{ result: SimResult }    // §3.2
```

**Response (4xx):**
- `400` — `SimInput` failed validation (missing contact, unknown form_id,
  malformed date). Body: `{ error: string, path: string[] }`.
- `404` — project not currently open in the server session.
- `408` — sandbox wall-clock timeout hit (see §3.4). Body includes the
  partial timeline the run accumulated.

**Response (500):** unexpected exception outside the sandbox — return a
short cause + hint the user retry. Do **not** return sandbox internals.

### 5.2 Server-side flow

1. Load the project's parsed state (already cached by the existing
   project route).
2. For each task, contact-summary flag, form `context.expression`, and
   target: assemble the source string the sandbox needs (either the
   parser's raw fallback body or, for structured shapes, the synthetic
   equivalent — e.g. `SimpleEvent` with `anchor:{kind:'lmp'}, offset:{value:12,unit:'weeks'}`
   → `(event, contact, report) => Utils.addDate(Utils.getLmpDate(report), 84)`).
3. Instantiate ONE `vm.Context` per request, seed it with the `Utils.*`
   mocks + standard helpers + verbatim `contact-summary-extras.js`.
4. Iterate ticks per §3.3, appending to `timeline`; catch per-expression
   throws and push to `evalErrors` (never abort the whole run for one
   bad rule — one broken flag shouldn't hide the other 20 that work).
5. Return `SimResult`.

### 5.3 What the route does NOT do

- Does not persist the run.
- Does not cache the sandbox across requests (fresh `vm.Context` per run
  — simpler, and runs are cheap).
- Does not touch the file system after the initial project-state read.
- Does not shell out to `cht-conf` or `cht`.

## 6. Test cases (the numbered list the test file asserts against)

Placed in `shared/src/simulator/*.test.ts` (node:test over compiled dist,
per CLAUDE.md).

1. **Contact-only registration** — `SimInput` with contact, `reports=[]`.
   Timeline has exactly one entry: `contact_registered` at t=0. Final
   flags computed from `contact-summary` against empty reports.
2. **Simple flag flip** — a project with `show_pregnancy_form: contact.contact_type === 'patient'`.
   Register a patient → flag is `true`. Change contact_type to
   'household' → flag is `false`. Timeline shows the flip.
3. **Form availability** — a form with `context.expression: 'contact.contact_type === "patient" && summary.show_anc_form'`.
   Register patient → form unavailable (flag false). Submit report that
   flips flag → form becomes available. Timeline emits
   `form_available` at the correct tick.
4. **Task fires on `days` offset** — `appliesIf` returns true for a
   pregnancy-visit report; event `days: 14, start: 2, end: 5`. Submit
   the report at t=0 → timeline emits `task_fired` at t=+14d with
   window t=+12d to t=+19d.
5. **Task fires on LMP anchor** — event with structured anchor
   `{kind:'lmp'}, offset:{value:12,unit:'weeks'}`; report carries
   `lmp_date: '2026-05-01'`. Timeline emits `task_fired` on
   `2026-05-01 + 84 days`.
6. **Raw dueDate falls through** — event with `dueDateRaw:
   'function(){ return new Date(2027,0,1); }'`. Sandbox evaluates it →
   `task_fired` at 2027-01-01. `evalErrors` empty.
7. **Broken raw expression** — an `appliesIf` that throws (e.g. reads
   `report.nonexistent.deep.field`). `evalErrors` gets one entry, the
   run **continues** for other tasks, other tasks in the same run
   still fire.
8. **Utils.getField dot-notation** — a rule using
   `Utils.getField(report, 'group.subgroup.answer') === 'yes'`. Report
   has `fields: { 'group.subgroup.answer': 'yes' }`. Rule evaluates true.
9. **Sandbox blocks I/O** — inject a rule containing `require('fs')`.
   Rule throws inside the sandbox; `evalErrors` captures it; timeline
   otherwise proceeds.
10. **Wall-clock timeout** — inject a rule with `while(true){}`. Server
    returns `408` after 2 seconds; response body has a partial timeline
    + one `evalErrors` entry naming the offending rule.
11. **Chronological ordering** — `reports` supplied out of order; server
    sorts by `reported_date` before eval; timeline is chronological.
12. **Determinism** — same `SimInput` run twice → identical `SimResult`
    (byte-for-byte JSON stable).
13. **No project write** — after any run, `fs.stat`s of every project
    file are byte-unchanged. This is the round-trip-safety equivalent
    for this feature (§3.5).
14. **Custom helper from contact-summary-extras** — a project defines
    `isReadyForNewPregnancy(contact, reports)` in
    `contact-summary-extras.js`; a context flag calls it. Simulator
    evaluates the flag correctly using the real helper source.
15. **Target increment counts** — a target's `appliesIf` matches 3 of 5
    reports. `finalTargetTotals[targetId] === 3`. Three
    `target_incremented` entries in the timeline, one per matching
    report.

## 7. Acceptance

A QA persona (Lorena) can check off each of the following against a real
CHT project (gandaki or nssd):

1. Sidebar has a **"Simulator"** entry between Tasks and Contact summary;
   opens a two-column view (inputs left, outputs right).
2. Contact-type dropdown lists **exactly** the project's real contact
   types (no hand-typing).
3. Form dropdown in a report row lists **exactly** the project's real
   app forms (no hand-typing).
4. Adding a pregnancy contact + submitting a pregnancy-registration
   report causes: (a) `show_pregnancy_form: true` in the Flags tab, (b)
   `pregnancy_visit` in Available forms, (c) at least one row in
   Scheduled tasks whose name matches the project's ANC task, (d) at
   least one `task_fired` timeline entry.
5. Editing the report's LMP date shifts every LMP-anchored task's
   `dueDate` by exactly the same offset.
6. Deleting a report removes the task firings it caused (no ghost tasks).
7. A rule the parser flagged as `raw` still evaluates in the sandbox and
   contributes to the timeline — visual-builder failure never blocks
   simulation.
8. A rule that throws surfaces in the **Errors** tab with the rule's
   source + a link to open it in the underlying editor; the rest of the
   simulation still runs.
9. Two identical runs produce byte-identical `SimResult` JSON
   (determinism, verifiable via export button in the Errors tab).
10. After any run, `git status` on the project folder is clean — no
    file was written.
11. A rule containing `require('fs')` or `while(true){}` doesn't crash
    the server; the run returns a 408 with a partial timeline or a
    surfaced `evalErrors` entry, respectively.
12. `pnpm --filter @cht-ui/shared test` passes all 15 test cases in §6.

### 7.1 Template autofill (helper spec for §4.1's "Autofill realistic values" button)

Per-contact-type "autofill realistic values" content lives in
`shared/src/simulator/templates.ts` and is keyed to the project's
`contact_types`. For unknown contact types (any project not shipping
with the editor), autofill fills only what the create form marks
`required: yes`, using string defaults per field type. Autofill is a
convenience — the user can override any field. **Not** an acceptance
item on its own; the acceptance criterion is that button (§4.1) works.

## 8. Out of scope (do NOT build this cycle)

- Live enketo form preview (own Tier 1 plan; separate cycle).
- Target-value histogram / time-series chart (v2; v1 is count-only).
- Multi-user simulation, role-based task assignment.
- Rewind / step-back UI (v2).
- Editing project files from inside the simulator (never — §3.5).
- Auto-generating sample data from real de-identified project data
  (privacy scope; separate plan).
- Card / field rendering from contact-summary — cards[] and fields[]
  are preserved verbatim by the parser (no editor yet, per Tier 2);
  the simulator's state summary shows **flags only**. Cards/fields
  visualization ships when Tier 2 lands.
- SMS/Devanagari forms in the report list (out of MVP per CLAUDE.md).

## 9. Open decisions

1. **Sandbox host: server vs client Worker?** — **Recommend server-side
   `node:vm`** (§3.4). The server already has parsed project state; a
   Worker in the browser would need to re-load `contact-summary-extras.js`
   and re-parse rules per run. Server also enforces the 2s wall-clock
   cap cleanly. Downside: one extra HTTP round-trip per run — negligible
   (<50ms locally).
2. **Target eval in v1?** — **Recommend yes, count-only** (§3.3 step 5).
   The evaluation is nearly free once tasks work, and it lights up the
   Targets tab. Visualization defers to v2.
3. **Sidebar placement — new top-level entry vs nested in Tasks?** —
   **Recommend new top-level entry** ("Simulator"). Nesting in Tasks
   hides it and implies "task-only simulation" — the whole point is
   care-continuity across contact-summary + forms + tasks + targets.
