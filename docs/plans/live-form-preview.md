<!--
Planner plan for Tier 1 · Live form preview — decision-locked renderer choice,
feature-coverage matrix, and integration contract so the dev can build without
re-deriving it. Plan-only this cycle. 2026-07-01.
-->

# Plan: live form preview (Tier 1)

**Status:** v0.1 — PLANNER-LOCKED, **PLAN ONLY THIS CYCLE** · **Owner:** planner
· **Sequence:** builds 4th (after Tier 0 preflight + owned deploy and Tier 2 cards
editor + translations). Pair plan with `docs/plans/workflow-simulator.md`.

## 1. Problem

`client/src/ui/FormPreview.tsx` (119 lines) renders survey rows as a **stacked,
label-only, no-logic** preview. Its own doc-comment concedes it: "no `relevant`,
no `calculation`, no group nesting honored, but field types and labels give a
strong 'what will the form look like' signal." That is fine as a shape check but
does **not** answer the questions users actually ask:

- If I fill this integer, does the follow-up question appear? (`relevant`)
- Does this calculated field compute the right value? (`calculation`)
- Does my `constraint` reject the value I expect it to?
- Does my `choice_filter` narrow the second select the way I intended?

CommCare and Kobo both ship a live form preview. Not having one is our single
biggest experience gap for non-technical authors: they only find out their skip
logic is wrong **after** cht-conf converts, uploads, and a CHW hits it on a
device. That feedback loop is measured in days.

The Tier 1 handoff says: "embed enketo-core (or CHT's form renderer) so current
form renders with live skip / validation / calc." This plan locks the renderer
choice, feature-coverage matrix, conversion path, sample-data strategy, UI
mount, and the CSP/bundle guardrails so the dev can build against a contract.

## 2. Scope this cycle

**This cycle produces this plan doc only.** No implementation, no dependency
added, no server route added. The dev cycle that picks this up will build to
the contract below.

The **build cycle** (next) delivers:

- **A. `enketo-core` embedded** as the renderer, pinned + bundled through Vite
  (no CDN, no `eval`). Renderer choice justified in §3.
- **B. A "Live preview" toggle on `FormPreview.tsx`** — the existing stacked
  view stays as the default (fast, cheap, always works). The toggle flips to
  the live renderer for the currently-open form. Same component, new mode.
- **C. Server route `POST /api/forms/:id/xform`** that ensures a fresh `.xml`
  for the requested form exists on disk (runs `convert-app-forms` or
  `convert-contact-forms` scoped to the single form) and returns the XForm
  body. Reuses the cht-conf spawn machinery already in `cht-conf.ts`.
- **D. Sample-data auto-generation** from parsed `SurveyRow[]` (text='',
  integer=0, date=today, select=first-choice); user can then edit any field
  in-preview and the logic re-evaluates. No separate sample-data UI this cycle.
- **E. Feature coverage per §4's matrix.** CHT-specific widgets not supported
  by enketo-core render with an inline "(CHT widget — deployed device only)"
  placeholder; the rest of the form still evaluates around them.

**Explicit non-goals** (see §8 for the full list):

- No workflow simulator (separate plan).
- No submission / persistence — preview is discard-on-close.
- No media (image, audio, video) upload interaction.
- No custom CHT widgets rendering live (`db:person`, `mrdt-verify`,
  `countdown-timer`, `select-contact`) — placeholders only.

## 3. Renderer decision — enketo-core (locked)

Three candidates, evaluated:

| Option | Cost | Benefit | Verdict |
|---|---|---|---|
| **enketo-core** (npm) | ~600 KB min+gzip bundle add; MIT; Node build passes through Vite; no runtime CDN once bundled | Battle-tested XForm renderer used by ODK, Ona, historically CHT itself; supports the XForm features we need out of the box (relevant, calculation, constraint, required, choice_filter, groups, repeats, select_one/multiple, text/int/decimal/date/time) | **LOCKED** |
| cht-core's form renderer | Unknown packaging surface; not published as a standalone npm; would require vendoring or a git-submodule dance | Perfect CHT parity | **REJECTED** — packaging risk + we lose the "one component, works locally" property |
| Custom TypeScript interpreter | 4–6 weeks build; forever-tail bug surface on XPath edge cases | Zero deps, smallest bundle | **REJECTED** — reinventing enketo poorly |

**Justification.** enketo-core is already the reference implementation for
XForm's spec surface; CHT's runtime is enketo-derived. Bundle cost of ~600 KB
lives inside the local editor (no CSP-restricted target instance), so
production CSP concerns do not apply — this bundle runs in the Vite dev/build
output that the user runs on `localhost:5173`. The dev cycle **must** confirm
empirically before merge:

- **BM-1.** `pnpm --filter @cht-ui/client build` size delta ≤ 900 KB
  (min+gzip) added to `dist/`. If it blows past that, reopen this decision.
- **BM-2.** No `eval` / `new Function` shows up in the bundled enketo code
  path we actually invoke (grep the dist bundle). Enketo uses an XPath JS
  library that has historically been eval-free; verify pin.
- **BM-3.** No external CDN or `fetch` from enketo at runtime — the whole
  editor runs on `localhost` and must work offline. Vite build with
  `network-only` proxy disabled must still render a form.

If any of BM-1/2/3 fail, the build cycle STOPS and reopens §3.

## 4. Feature coverage matrix (locked scope)

The Tier 1 spec is intentionally vague ("live skip / validation / calc"). This
matrix is the load-bearing part — the QA persona (Lorena) checks against it.

**Renders live** (in-scope for the build cycle):

- `relevant` — skip logic evaluated as the user types.
- `calculation` — recomputes as inputs change.
- `constraint` + `constraint_message` — inline validation.
- `required` (yes / expression).
- `choice_filter` — second-select narrows on the first.
- `type` coverage: `text`, `integer`, `decimal`, `date`, `time`, `dateTime`,
  `note`, `select_one`, `select_multiple`, `calculate`, `hidden`.
- Groups: `begin group` / `end group` — visual nesting + relevant at group level.
- Repeats: `begin repeat` / `end repeat` — add/remove instance, relevant re-eval.
- Localised labels: preview honours the same locale toggle already in
  `FormPreview.tsx` (line 17).

**Placeholder only** (renders "(CHT widget — deployed device only)" chip;
surrounding form logic still evaluates):

- `db:person`, `db:place`, `select-contact` — need CHT lineage state.
- `mrdt-verify`, `countdown-timer`, `rapid-diagnostic-test` — CHT device APIs.
- `image`, `audio`, `video`, `barcode`, `geopoint` — device hardware.
- Any `type` starting with `db:` or referencing an unknown CHT extension.

**Raw fallback** — if enketo-core throws during `Form.init()` on the current
XForm (unsupported construct, malformed XPath), the live-preview mode shows
the raw error message inline and offers a "Back to stacked view" button. The
stacked view **always** works because it reads parsed `SurveyRow[]`, not XML.

This mirrors the invariant from CLAUDE.md: visual builders MUST fall back
gracefully rather than reject.

## 5. Server route contract

**`POST /api/forms/:id/xform`**

Ensures the XForm exists on disk for the requested form and returns it.

- Path param `id`: the same `formId` shape `forms.ts` already uses
  (`app:pregnancy`, `contact:person`, etc.).
- Body: `{ }` (empty; may grow later).
- Response 200: `{ xform: string, xformPath: string, staleSeconds: number }`
  where `xform` is the raw XForm XML body and `staleSeconds` is
  `(xlsx.mtime - xml.mtime)` in seconds (positive = xls newer than xml, i.e.
  the render is behind the edit).
- Response 409 `{ error: 'convert-failed', stderr: string }` if
  `convert-app-forms --forms=<basename>` (or the contact variant) exits
  non-zero. Client shows the cht-conf error via the friendly-error translator
  already wired in `DeployPanel.tsx`.

Behaviour:

1. Resolve `xlsx`, `xml` paths via `pathsForForm(category, basename)` (already
   exists at `server/src/routes/forms.ts:80`).
2. If `xml` is missing OR older than `xlsx` (mtime compare), spawn the
   scoped convert action for that one form. Reuse the spawn machinery in
   `cht-conf.ts` (do **not** duplicate — extract a helper if needed).
3. On success, read `xml` from disk and return.

**Non-invariant:** this route only runs the **convert** action, which reads
`xlsx` and writes `xml` — nothing else. It does NOT touch other project files.
This satisfies the CLAUDE.md round-trip invariant for adjacent files.

## 6. UI surface

**Extend `client/src/ui/FormPreview.tsx`** (do not create a sibling component).
Same file, new toggle.

- New state: `mode: 'stacked' | 'live'`, default `'stacked'`.
- Header (currently line 26–40) gains a mode toggle next to the locale row:
  `Stacked` (current view) · `Live` (new).
- When `mode === 'live'`:
  1. Call `POST /api/forms/:id/xform` for the current form.
  2. If `staleSeconds > 0`, show a "Preview is behind — regenerating" banner
     while the convert runs. Once returned, render.
  3. Mount enketo-core's `Form` into a container `div`. Initial instance is
     auto-generated from parsed `SurveyRow[]` (text='', integer=0, date=today,
     select_one=first choice, select_multiple=[]).
  4. Errors from `Form.init()` swap the pane to the raw-error state described
     in §4.
- When `mode === 'stacked'` — unchanged from today.
- Toggle is persisted per session in `sessionStorage` so switching forms keeps
  the user in their chosen mode.
- The preview pane already lives inside `FormEditor.tsx:315–319` — no
  layout changes needed. The preview pane's fixed width is fine; enketo's
  default CSS is responsive.

**Reuse, do not reinvent:**

- Locale state + button row → keep as-is; enketo honours the form's
  `<itext>` translations, so passing the locale through to
  `Form.init({ languages: [locale] })` is enough.
- Field-type detection in `PreviewInput` (line 96) → not used in live mode;
  enketo owns rendering there.
- The friendly-error translator already used by `DeployPanel` → reuse for
  the 409 path.

## 7. Sample-data strategy (auto-generate this cycle)

The build cycle generates an initial instance from `SurveyRow[]`:

- `text` / `string` → `''`
- `integer` / `decimal` → `0`
- `date` → today (`YYYY-MM-DD`)
- `time` → `'00:00'`
- `dateTime` → now (ISO)
- `select_one` → first choice's `name`
- `select_multiple` → `''`
- `calculate` / `hidden` → left for enketo to compute
- CHT-specific widgets → skipped from instance seed (enketo will treat as empty)

The user then edits any field live in the preview to explore skip logic. This
is the minimal viable data strategy: no separate sample-data editor this
cycle. If Bhishan or the field team later ask for named sample contacts /
reports, that's the **workflow simulator** plan, not this one.

## 8. Test cases (`client/tests/*.spec.ts` + a shared helper)

The build cycle asserts these end-to-end. Sample form:
`config-gandaki/cht-config/forms/app/pregnancy.xlsx` (real config we already
use for the smoke test).

1. **Stacked-mode unchanged.** Opening pregnancy → preview pane shows the
   current stacked layout, locale toggle works, same DOM as before this cycle.
2. **Live toggle triggers convert.** Toggle to "Live" — the network tab shows
   one call to `POST /api/forms/app:pregnancy/xform`; response is XForm XML;
   enketo mounts.
3. **`relevant` evaluates live.** In pregnancy, filling `lmp_date` reveals the
   `edd` calculated field and the ANC-visit-count group; without it, they
   remain hidden.
4. **`calculation` recomputes.** Change `lmp_date` → `edd` recomputes to
   `lmp_date + 280 days` without a page reload.
5. **`constraint` shows inline.** A negative integer in a positive-only field
   surfaces the constraint message from the xls.
6. **`choice_filter` cascades.** Selecting a district narrows the ward
   `select_one` to that district's choices.
7. **Repeat add/remove.** ANC-visit repeat: click add → new instance; remove
   → gone; relevant re-evaluates.
8. **CHT widget placeholder.** A form with `select-contact` or
   `mrdt-verify` renders those rows as the "(CHT widget — deployed device
   only)" chip; the rest of the form still evaluates.
9. **Stale-xml regenerate.** Edit `lmp_date` label in the survey → toggle to
   Live → the "Preview is behind — regenerating" banner shows, then the new
   label appears.
10. **Convert failure surfaces cleanly.** Corrupt the xls (missing `type`
    column) → toggle to Live → 409 renders the friendly-error translator's
    message, "Back to stacked view" works.
11. **Round-trip untouched.** Toggling to Live and back does **not** mutate
    the xls on disk (mtime unchanged). This is the CLAUDE.md non-negotiable.

All 11 pass in Playwright before the build cycle is done.

## 9. Acceptance (QA-checkable)

- Toggling to "Live" on any of the four templates' forms renders enketo with
  no runtime errors in the browser console.
- Every item in §4's "Renders live" list is demonstrable on `pregnancy.xlsx`
  or an equivalent real form.
- Every item in §4's "Placeholder only" list renders the chip, not a crash.
- The stacked view remains the default and is byte-identical DOM to today.
- No `.xlsx`, `.properties.json`, `base_settings.json`, `tasks.js`, or
  `contact-summary.templated.js` is modified by opening or interacting with
  the preview. Only `.xml` files change (via cht-conf convert).
- Bundle size delta ≤ 900 KB gzip (BM-1). If over, dev reopens §3.
- No CDN / external `fetch` in the enketo runtime path (BM-3 grep passes).
- `pnpm lint` stays at zero warnings.
- `pnpm --filter @cht-ui/shared test` passes — this cycle changes nothing in
  `shared/`, so the round-trip tests already there stay green.

## 10. Out of scope

Explicit non-goals for this cycle **and** the immediate follow-on build cycle:

- **Workflow simulator** — contact + report + tasks + targets + summary
  simulation. Separate plan; different problem shape (rules harness, not a
  form renderer).
- **Submission / persistence.** The preview does not save. Filled data is
  discarded on close or form-switch.
- **Media capture** — image, audio, video, barcode, geopoint interaction.
- **Custom CHT widgets rendering live** — `db:person`, `db:place`,
  `select-contact`, `mrdt-verify`, `countdown-timer`,
  `rapid-diagnostic-test`. Placeholders this cycle; live rendering would
  require porting CHT device shims and is a separate, larger effort.
- **Multi-form preview / task-triggered form chaining.** One form at a time.
- **A dedicated "sample data" editor.** Auto-generated seed only; user edits
  in-preview. Named sample contacts / reports live in the simulator plan.
- **pyxform in-process.** We spawn the bundled cht-conf binary (same as
  everything else in `cht-conf.ts`). No Node binding to pyxform.
- **Preview against a remote CHT instance.** Local-only.
- **Regression against SMS / Devanagari-only forms.** Same as CLAUDE.md
  scope: preserved verbatim, no editor.

## 11. Open decisions

1. **Convert scope: whole-forms folder vs. single form.** cht-conf's
   `convert-app-forms` supports `--forms=<basename>`; the scoped version
   converts one form. **Recommend: single-form convert** — fastest, and
   nothing else on disk changes. If the flag is unreliable across cht-conf
   versions we bundle, fall back to whole-folder convert (still cheap for
   projects with < ~30 forms).
2. **Auto-run convert on live-toggle vs. always-on-form-save.** Running it
   on every survey-tab save would keep `.xml` warm but adds latency to every
   edit. **Recommend: on-demand only** — convert when the user first toggles
   to Live for that form in that session, and re-convert only if `xlsx.mtime
   > xml.mtime` on subsequent toggles. Matches how a real dev workflow uses
   `cht-conf`.
3. **Enketo version pin.** enketo-core has had breaking releases. **Recommend:
   pin to the same major version cht-core currently bundles** (dev must
   check cht-core's `package.json` at build time and match). Rationale: any
   XForm that renders in the deployed CHT should also render in our preview;
   version drift is the main way that stops being true.
