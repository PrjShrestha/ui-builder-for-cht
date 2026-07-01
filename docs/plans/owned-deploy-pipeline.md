<!--
Planner-locked plan for Tier 0 · "Own the deploy pipeline" — the sequenced
compile→convert→upload flow that closes §4 of deploy-targeted-forms.md (the
deferred one-click item), adds a progress readout, and threads deep-links
into friendly-error hints so a non-coder never sees a raw cht-conf trace.
Companion to docs/plans/preflight-validator.md, which is the *gating* half
of Tier 0; this plan is the *pipeline* half. Grounded against the code on
2026-07-01.
-->

# Plan: Own the deploy pipeline (Tier 0 — one-click compile → convert → upload)

**Status:** v0.1 — PLANNER-LOCKED, **IMPLEMENT THIS CYCLE** (Tier 0, greenlit
in commit b9de29d) · **Owner:** planner
· **Drives:** a non-coder never sees a raw cht-conf trace; the everyday
"I changed one form, push it" is one gesture, not five.

**Scope split with `preflight-validator.md`:** that plan owns the *authoring-time
"Ready to deploy?" checks* — the preventive layer. This plan owns the
*pipeline that runs when the user clicks Deploy* — the sequencing, progress
UI, and hint-to-editor deep-linking. Two docs, one Tier-0 story.

## 1. Problem

The deploy panel already has almost everything it needs, and yet the
everyday deploy — "I changed one form, push it to `--local`" — still takes
five UI gestures and produces cryptic output on any failure. What's
already shipped, and what's still missing:

**Shipped (do not re-build):**
- Per-action buttons for every cht-conf action
  ([DeployPanel.tsx:444–469](../../client/src/ui/DeployPanel.tsx#L444)).
- Deploy target form (`--local` / `--instance` / `--url` + user + typed-each-run
  password) ([DeployPanel.tsx:538–691](../../client/src/ui/DeployPanel.tsx#L538)).
- Five pre-built macros — `deploy-forms`, `deploy-contact-forms`,
  `deploy-settings`, `deploy-everything`, `validate-only`
  ([DeployPanel.tsx:705–767](../../client/src/ui/DeployPanel.tsx#L705)) —
  served by the chained-run endpoint `POST /api/cht-conf/run-sequence`
  ([cht-conf.ts:602–726](../../server/src/routes/cht-conf.ts#L602)).
- Targeted-form picker for `convert-app-forms` / `upload-app-forms` /
  `upload-contact-forms` — checkbox list, "Select changed (N)" via
  `GET /api/forms/changed`, command-preview line
  ([DeployPanel.tsx:863–996](../../client/src/ui/DeployPanel.tsx#L863)).
- Friendly-error translator streams `hint` SSE events, dedup'd by
  `patternId` ([errorPatterns.ts](../../server/src/cht-conf/errorPatterns.ts) +
  translator wired into `attachStreams`).
- Deploy-readiness checklist (project-shape checks — hierarchy,
  contact-form parity, tasks.js, git)
  ([DeployPanel.tsx:1019–1148](../../client/src/ui/DeployPanel.tsx#L1019)).

**Missing (this cycle):**
- **`run-sequence` does not carry per-action `extraArgs`.** The macro path
  (§4 of `deploy-targeted-forms.md`, deferred per that plan's Decision 2)
  needs to say "convert-app-forms **-- pregnancy delivery** → upload-app-forms
  **-- pregnancy delivery**." Today the macros run the whole category every
  time — targeted deploy is single-action-only.
- **No "Deploy this form" one-click.** From the picker you get one action
  (convert *or* upload); to do "convert → upload of pregnancy" the user
  runs the picker twice. This is the exact UX §4 was supposed to fix.
- **Friendly hints have no deep-link.** The stderr-derived hint tells the
  user "your form is missing the required `name` column" (good) but not
  **which form** — the parse-error text is line-oriented and the file path
  frequently doesn't survive cht-conf's rewrapping. Four existing patterns
  (`pyxform-bad-type`, `pyxform-bad-select-list`, `pyxform-bad-relevant`,
  `compile-missing-module`) already capture a filename group; the UI
  should offer an **Open form** button when the server can resolve it.
- **Progress read-out is line-only.** During a five-step macro the user
  sees `── step 3/5: convert-app-forms ──` inline in the log but nothing
  at the panel top; a persistent progress row lets a non-coder tell
  "still running" from "wedged" from "done."

## 2. Scope this cycle

### Ship

1. **`extraArgs` per action in the sequence endpoint.** Extend
   `POST /api/cht-conf/run-sequence` to accept an array of step objects
   (`{ action, extraArgs? }`) alongside the existing string-array form
   (back-compat: strings still accepted, treated as
   `{ action, extraArgs: [] }`).
2. **"Deploy specific forms" macro.** A new pre-built entry in
   `DEPLOY_MACROS` whose actions run **through the existing form picker**
   to gather basenames, then dispatch
   `convert-{app,contact}-forms -- <basenames>` →
   `upload-{app,contact}-forms -- <basenames>` under a single runId.
3. **Progress row in `DeployPanel`.** A one-line "Step N/M — {action}"
   indicator rendered above the log, driven by a new SSE event `step`
   the sequence emits at each step boundary. The current inline
   `── step N/M ──` log marker stays for traceability; the top-of-panel
   row is the glance-target.
4. **Deep-links from friendly hints.** Extend `ErrorHint` (server) +
   `FriendlyHint` (client) with an optional
   `openTarget: { kind: 'form'; formId } | { kind: 'settings-file'; file }`.
   For the four patterns that already capture a filename, resolve
   `basename → formId` via the loaded form list and attach `openTarget`.
   The client renders an "Open {basename}" button that calls
   `setView({ kind: 'form', id: formId })`. No resolvable form? — omit
   `openTarget` (hint still renders, no button, identical to today).

### Explicit non-goals this cycle
- **Row-level deep-link inside FormEditor.** `View` today is `{ kind:
  'form', id }` — no `rowId` payload. Extending it is a ~15-line
  follow-up (same scope hole as the preflight plan's §2 non-goals; both
  consume the same extension when it lands). This cycle: form-level jump
  only.
- **Retry / resume mid-sequence.** If step 3 fails, the sequence stops
  (current behaviour). We do *not* add a "retry from step 3" button —
  the user re-clicks the macro; cht-conf actions are idempotent enough
  for that.
- **Auto-run preflight before deploy.** The preflight validator plan
  lands as a separate render; this plan does not gate deploy buttons on
  preflight errors (matches the existing checklist precedent —
  visibility, not gating).
- **New friendly-error regex patterns.** Only the four existing
  filename-bearing patterns get `openTargetFrom`; the catalog itself is
  not touched.
- **Streaming progress percent inside a single action.** cht-conf
  doesn't emit progress; we track step boundaries only.
- **Persist sequence-run history across dev-server restarts.** In-memory
  `runs` map is fine for MVP; same as today.

## 3. Server contract (the load-bearing part)

Two touches on `server/src/routes/cht-conf.ts` — extend the sequence
endpoint + enrich the hint payload — and one touch on
`server/src/cht-conf/errorPatterns.ts` to expose the filename capture
group per pattern.

### 3.1 Sequence step type

```ts
/** One step of a run-sequence macro. */
export type SequenceStep =
  | string                                          // shorthand: no extras
  | { action: string; extraArgs?: string[] };       // full form

/** Back-compat helper — normalize the body's `actions[]` field. */
function normalizeSteps(actions: SequenceStep[]): { action: string; extraArgs: string[] }[] {
  return actions.map((a) =>
    typeof a === 'string'
      ? { action: a, extraArgs: [] }
      : { action: a.action, extraArgs: a.extraArgs ?? [] },
  );
}
```

**Body shape (updated):**
```ts
POST /api/cht-conf/run-sequence
{
  actions: SequenceStep[],          // was: string[]; now accepts both
  password?: string,
  dryRun?: boolean,
}
```
The existing five macros (`DEPLOY_MACROS` in `DeployPanel.tsx`) keep
sending plain strings — the endpoint accepts both. Old macros = zero
changes required.

**Validation:**
- Reject if `actions` is not a non-empty array (already enforced;
  preserve).
- Reject if any element is neither a string nor an object with a string
  `action` field: 400 `actions[i].action is required`.
- Reject unknown action names: 400 `Unknown action: <name>` (already
  enforced; preserve for both string and object forms).

**Emit `step` events at each boundary:**
```ts
type RunUpdate =
  | { kind: 'line'; line: string }
  | { kind: 'hint'; hint: ErrorHint }
  | { kind: 'step'; index: number; total: number; action: string; extraArgs: string[] }  // NEW
  | { kind: 'done'; exitCode: number | null };
```
`step` is emitted **before** the `$ cht ...` line for that step, so the
client's progress row updates first and the log line follows. `step`
events are buffered on `RunState` alongside `lines` + `hints` and
replayed to a late subscriber (same pattern the SSE stream already uses
for `hint`).

**Argument assembly:** `buildArgs(action, deploy, password, extras)`
([cht-conf.ts:169](../../server/src/routes/cht-conf.ts#L169)) already
takes an `extras` array (currently only used by non-sequence
single-action runs via `/run`). The sequence loop passes each step's
`extraArgs` verbatim — the same `-- <basenames>` shape the picker
produces today. **No new arg-splicing logic**; we're wiring an existing
seam.

### 3.2 Hint deep-link payload

```ts
export interface ErrorHint {
  patternId: string;
  friendly: string;
  hint?: string;
  docsUrl?: string;
  knownUpstreamBug?: boolean;
  rawLine: string;
  /** NEW — where the user can jump to fix this. Omitted when the pattern
   *  can't identify a target (bare "auth-failed" doesn't have one). */
  openTarget?:
    | { kind: 'form'; formId: string }
    | { kind: 'settings-file'; file: string };
}
```

**Resolver contract (server):** the translator step (per-line inside
`attachStreams`) is given a `formIdResolver: (basename: string) =>
string | null` closure. The route builds this closure once per run by
enumerating `forms/app/*.xlsx` + `forms/contact/*.xlsx` and mapping
`basename → formId` (same enumeration `api.listForms()` uses). Look-up
is by **basename without extension** — the `pyxform-*` patterns yield
filenames like `forms/app/pregnancy.xlsx`, and their capture group 1 is
the file path; strip the directory + `.xlsx` suffix, look up.

**Per-pattern opt-in:** `ErrorPattern` gains an optional
`openTargetFrom?: (m: RegExpExecArray, resolve: (basename: string) => string | null) => ErrorHint['openTarget'] | undefined`.
Only four patterns implement it:
- `pyxform-bad-type` — capture group 1 is the file path; strip and
  resolve.
- `pyxform-bad-select-list` — no filename in the current regex; **skip
  in v1** (the pattern would need widening; out of scope). Left here
  intentionally so a future pass can add it.
- `pyxform-bad-relevant` — no filename in the current regex; **skip in
  v1** for the same reason.
- `compile-missing-module` — captures the module name, not a form file;
  **no `openTarget`**.

Realistically only **`pyxform-bad-type`** ships an `openTarget` in v1;
the seam exists so widening the regex on the others is a one-line
follow-up. **This is fine.** The contract is what's load-bearing; the
number of patterns using it is a decoration.

Returning `undefined` means "no deep-link this line" — hint renders
button-less (identical to today). The `openTargetFrom` call is wrapped
in a try/catch; a throw becomes `undefined`, logged server-side. **The
raw line is still streamed in full** — the additive-annotation
invariant in [errorPatterns.ts:9-12](../../server/src/cht-conf/errorPatterns.ts#L9)
is preserved.

### 3.3 Backwards compatibility

- **Endpoint**: string-array `actions` body **still valid**. All five
  existing macros work unchanged.
- **SSE**: `step` is a new event; existing clients that only listen to
  `line`, `hint`, `done` continue to work — unhandled events are
  ignored by `EventSource`.
- **Hint**: `openTarget` is optional; old clients ignore the field.

## 4. Client UI (`DeployPanel.tsx`)

Three targeted edits, no new files.

### 4.1 Progress row

Above the log toolbar
([DeployPanel.tsx:471–489](../../client/src/ui/DeployPanel.tsx#L471)),
render a `DeployProgress` row when `running === true`:
```
▶ step 2/5 — convert-app-forms      elapsed 00:04
```
- Driven by local state `progress: { index; total; action } | null`.
- Set from the new `step` SSE event; cleared on `done`.
- Non-sequence single-action runs get a lightweight `▶ {action}` variant
  (no fraction; drive off `runAction`'s `action.name` — not a `step`
  event, because single-action runs don't emit one).
- The existing `── step N/M: … ──` marker in the log is **kept** — it's
  the audit trail; the top-of-panel progress is the glance-target.
- Elapsed clock: `Date.now() - startedAt`; recompute on a 1s
  `setInterval` while `running` is true; clear on `done`.

### 4.2 "Deploy specific forms" macro

New entry in `DEPLOY_MACROS`
([DeployPanel.tsx:705](../../client/src/ui/DeployPanel.tsx#L705)):
```ts
{
  id: 'deploy-specific-forms',
  label: 'Deploy specific forms',
  description: 'pick app-form(s), convert → upload',
  actions: ['convert-app-forms', 'upload-app-forms'],  // default set
  needsInstance: true,
  usesFormPicker: 'app',                               // NEW field on DeployMacroSpec
}
```

Sibling entry for contact forms:
```ts
{
  id: 'deploy-specific-contact-forms',
  label: 'Deploy specific contact forms',
  description: 'pick contact-form(s), convert → upload',
  actions: ['convert-contact-forms', 'upload-contact-forms'],
  needsInstance: true,
  usesFormPicker: 'contact',
}
```

Two macros, not one, because the picker is scoped to a single category
(app vs contact) — the existing `DeployFormPicker` takes `category:
'app' | 'contact'` and filters `eligible` accordingly. Cross-category
"convert app+contact then upload app+contact" is what `deploy-everything`
is for.

**Flow when `usesFormPicker`:**
1. Click macro → open a variant of `DeployFormPicker` in "sequence
   mode" (a boolean prop; UI unchanged, `onConfirm` fires with the
   same `basenames` array).
2. Picker returns basenames + category.
3. `runMacro` builds the step array:
   ```ts
   const extra = ['--', ...basenames];
   const steps: SequenceStep[] =
     category === 'app'
       ? [{ action: 'convert-app-forms', extraArgs: extra },
          { action: 'upload-app-forms', extraArgs: extra }]
       : [{ action: 'convert-contact-forms', extraArgs: extra },
          { action: 'upload-contact-forms', extraArgs: extra }];
   ```
4. Fire `api.runChtConfSequence(steps, password, dryRun)`.
5. Picker's command-preview shows the whole two-step sequence, one
   line each — extend `DeployFormPicker` to accept an optional
   `previewSteps: { action: string; extraArgs?: string[] }[]` prop;
   when set, render each on its own line under "Command preview."
6. "No forms selected" case (cht-conf default = all): still runs both
   steps, without `-- <basenames>` — same "all forms in category"
   fallback the existing picker uses.

**Password gate**: the sequence needs a password when
`macro.needsInstance`; the existing `runMacro`
([DeployPanel.tsx:239](../../client/src/ui/DeployPanel.tsx#L239))
already blocks on missing password with an error banner. Extend so the
picker knows to open the password gate first if needed
(`pickerAction`-adjacent state — see the existing
`pickerExtraArgsForPending` bridge for the pattern). Detail: the two
new macros both need an instance; simplest is "picker only opens after
password is typed above." Guard with the same "⚠ enter password above
first" affordance the existing macros show.

**`api.runChtConfSequence` signature update:**
```ts
runChtConfSequence: (actions: SequenceStep[], password?: string, dryRun?: boolean) => …
```
`SequenceStep` inline in `client/src/api.ts` (see open decision #2).

### 4.3 "Open form" button on friendly hints

Extend the hint-rendering block
([DeployPanel.tsx:492–524](../../client/src/ui/DeployPanel.tsx#L492)):
```
┌─ ✖ Form pregnancy.xlsx line 12: "db:persn" is not a known question type. ─┐
│ Either fix the typo, or if "db:persn" is a CHT-specific type…              │
│ [ Open pregnancy.xlsx ]  [ open docs / upstream issue ↗ ]                  │
│ ▸ raw output that triggered this                                            │
└────────────────────────────────────────────────────────────────────────────┘
```
- Only renders when `hint.openTarget?.kind === 'form'` **and** the
  store's form list has a form with that id.
- Click → `useApp.getState().setView({ kind: 'form', id: openTarget.formId })`.
  Same store pattern the readiness checklist / other panels use.
- No `openTarget`, or unknown formId → button omitted (current
  appearance).

### 4.4 No new components

Everything above extends existing surfaces: `DeployPanel` (progress row +
hint button), `DeployMacros` (two new spec entries, no visual redesign),
`DeployFormPicker` (one new prop `previewSteps`; sequence-mode is *not*
a different modal). Splitting into a new file is not warranted; the
file is already ~1150 lines and cleanly sectioned by JSDoc banners —
grow it.

## 5. Round-trip / test cases

Server tests use `node:test` over `server/dist/`; client tests are
Playwright e2e. Every case must be automatable; every case must be
deterministic (dry-run mode where the run touches cht-conf).

### 5.1 Sequence endpoint (`server/src/routes/cht-conf.sequence.test.ts` — new)

1. **Back-compat:** body
   `{ actions: ['validate-app-forms', 'convert-app-forms'], dryRun: true }`
   → sequence runs, exits 0, `step` events fire with `index: 0..1`,
   `extraArgs: []` for both.
2. **Object-step form:** body
   `{ actions: [{ action: 'convert-app-forms', extraArgs: ['--', 'pregnancy'] }], dryRun: true }`
   → the dry-run log includes `-- pregnancy`.
3. **Mixed form:** body
   `{ actions: ['validate-app-forms', { action: 'convert-app-forms', extraArgs: ['--', 'pregnancy'] }], dryRun: true }`
   → step 1 has no extras, step 2 does; both exit 0.
4. **Unknown action rejected:** `{ actions: [{ action: 'bogus' }] }` →
   400 `Unknown action: bogus`. (Existing validation; assert
   step-object form preserves it.)
5. **Malformed step object:**
   `{ actions: [{ extraArgs: ['--', 'x'] }] }` (missing `action`) →
   400 `actions[i].action is required`.
6. **`step` SSE ordering:** subscribe to `/runs/:id/stream`; assert
   `step` arrives before the corresponding `$ cht …` `line` for that
   step index, for every step.
7. **`step` replay on reconnect:** subscribe after `done`; assert all
   `step` events replay in order.
8. **Failure stops sequence + no ghost `step`:** dry-run scenario where
   step 2 exits non-zero → step-3 `step` event does NOT fire; `done`
   carries the failing exit code.

### 5.2 Friendly-hint deep-link (`server/src/cht-conf/errorPatterns.test.ts` — extend)

9. Line `forms/app/pregnancy.xlsx Line 12: Invalid type: 'db:persn'`
   through `matchErrorPattern` **with** a resolver that maps
   `pregnancy → app:pregnancy` →
   `openTarget: { kind: 'form', formId: 'app:pregnancy' }`.
10. Same line through a resolver that returns `null` → `openTarget`
    absent (button-less hint).
11. Line without a filename group (e.g. `Choice list "sx" not found`)
    → `openTarget` absent (pattern has no `openTargetFrom`).
12. `openTargetFrom` throwing does NOT throw the translator — caught,
    treated as `undefined`. (Defensive against future pattern authors
    returning bogus.)

### 5.3 Client e2e (`client/tests/deploy-specific-forms.spec.ts` — new)

13. Open a fixture project with two app forms. Click "Deploy specific
    forms"; picker opens with both checked; command preview shows two
    lines
    (`cht --local convert-app-forms -- <a> <b>`,
    `cht --local upload-app-forms -- <a> <b>`).
14. Confirm (dry-run mode on); run streams; progress row reads
    "step 1/2 → step 2/2 → done"; exit code 0.
15. Un-check one form; command preview updates; run only carries the
    checked basenames.
16. **Friendly-hint open button e2e**: dry-run a `convert-app-forms`
    scripted scenario that emits a `pyxform-bad-type` line naming a
    resolvable file (dry-run fixtures live under
    `server/src/cht-conf/dryRun/`); click the hint's
    "Open pregnancy.xlsx" button; the app view switches to
    `{ kind: 'form', id: 'app:pregnancy' }`.

### 5.4 No round-trip test needed in `shared/`

Nothing in `shared/` changes. The parser round-trip invariants are
unaffected — this plan only touches server routes + client UI + one
new field on the server-only `ErrorPattern`/`ErrorHint` types.

## 6. Acceptance (QA / Lorena)

A checkable list against a checkout:
- [ ] `POST /api/cht-conf/run-sequence` accepts both `actions: string[]`
      and `actions: SequenceStep[]`. Every existing macro on the panel
      (`deploy-forms`, `deploy-contact-forms`, `deploy-settings`,
      `deploy-everything`, `validate-only`) still works unchanged.
- [ ] "Deploy specific forms" (app) and "Deploy specific contact forms"
      appear in the DeployMacros grid. Clicking either opens the form
      picker; confirming runs a two-step sequence in one runId.
- [ ] Progress row appears at the top of the log during a sequence run;
      updates on each step; elapsed clock counts up; disappears on
      `done`. On a step failure, the row holds the failing step's label
      until `done` arrives with the non-zero exit code.
- [ ] A friendly hint from `pyxform-bad-type` on a resolvable filename
      shows an "Open {basename}.xlsx" button. Click switches the view
      to the form editor for that form.
- [ ] A friendly hint that can't resolve, or a pattern without an
      `openTargetFrom`, renders **without** an Open button — same as
      today.
- [ ] Deploy panel still runs on projects that never open the picker
      (existing per-action buttons, existing macros): zero visual
      regression from this cycle.
- [ ] `pnpm --filter @cht-ui/server test` passes with the new sequence
      + hint tests.
- [ ] `pnpm --filter @cht-ui/client test:e2e` passes for the new
      Playwright spec (dry-run scenarios only; no real instance).
- [ ] `pnpm lint` and `pnpm typecheck` are green with **zero new
      warnings** (repo baseline unaddressed; do not touch pre-existing
      warnings).
- [ ] Round-trip invariant: nothing in `shared/` changed; the parser
      round-trip smoke test (`pnpm --filter @cht-ui/shared test` +
      `node scripts/smoke-parser.mjs …`) still passes on the reference
      config.

## 7. Out of scope this cycle

- Row-level deep-link into FormEditor (needs `View` shape extension —
  shared non-goal with the preflight plan).
- Retry / resume mid-sequence (rerun the macro instead).
- Auto-preflight-before-deploy gating (visibility, not gating; the
  preflight plan owns the gating half of Tier 0).
- Streaming progress inside a single cht-conf action (cht-conf doesn't
  emit it).
- New friendly-error regex patterns (only the existing filename-bearing
  ones get `openTargetFrom`).
- Widening `pyxform-bad-select-list` / `pyxform-bad-relevant` regexes
  to capture a filename so they can also deep-link — see §3.2; one-line
  follow-up.
- Cross-form / lineage `openTarget` (e.g. tasks.js line references a
  form) — the pattern catalog doesn't have those matches yet.
- Persisting sequence-run history across dev-server restarts (in-memory
  `runs` map is fine for MVP; same as today).
- Chaining preflight-fix → deploy in one click. Two separate gestures.

## 8. Open decisions

1. **Where in `DEPLOY_MACROS` order do the two new macros sit?**
   Recommend **between `deploy-contact-forms` and `deploy-settings`** —
   forms-flavoured macros together, then settings, then
   `deploy-everything`, then `validate-only`. Alternative: first,
   because targeted deploys are the most-frequent case. Not blocking;
   change with a one-line reorder.
2. **`SequenceStep` — inline in `api.ts` or re-export from `@cht-ui/shared`?**
   Recommend **inline**. The type is trivial
   (`string | { action; extraArgs? }`), client and server are the only
   consumers, and putting a two-line type through `shared/`'s build
   cycle costs more than it earns. Also keeps the shared-workspace
   surface minimal (CLAUDE.md invariant: shared is the load-bearing
   parser/serializer layer).
3. **On step failure, do we still emit the final `step` event for the
   subsequent (skipped) steps?** Recommend **no** — `step` fires only
   for steps that actually run. The `done` event's `exitCode`
   (non-zero) plus the `✖ step N/M …` log marker are the failure
   signal. The progress row holds the last emitted step until `done`
   clears it, which reads as "stopped here" (asserted by test §5.1 case
   8).
