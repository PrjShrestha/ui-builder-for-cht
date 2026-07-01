<!--
Planner plan: Tier 0 · in-app "Ready to deploy?" preflight validator. Runs
cht-conf's hard gates BEFORE cht-conf, so a non-coder never sees a raw
pyxform trace. One aggregation module in shared/, one section in the
existing DeployPanel, one server endpoint. 2026-07-01.
-->

# Plan: Preflight validator ("Ready to deploy?")

**Status:** v0.1 — PLANNER-LOCKED · **Tier:** 0 (highest leverage — "make it impossible to
build something that won't deploy") · **Owner:** planner · **Drives:** `DeployPanel`'s
existing readiness checklist becomes the single "is this project deployable?" surface.

## 1. Problem

Today a non-coder finds out a project is undeployable when `cht-conf` fails, at which
point the failure surfaces as a raw pyxform / webpack / eslint trace — the very failure
mode DEV-HANDOFF § Tier 0 calls out. Some of it is caught by the friendly-error
translator (`server/src/cht-conf/errorPatterns.ts`) at run time, and the existing
`DeployReadinessChecklist` (`DeployPanel.tsx:1019-1148`) already validates a few
project-level things (hierarchy ≥1 contact type; contact create form per place type; app
forms exist; `tasks.js` present). What's missing is **authoring-time** coverage of the
hard gates cht-conf itself checks, before the deploy button is pushed:

1. **Required-file presence** at the project root — `targets.js`, `tasks.js`,
   `contact-summary.templated.js`, `.eslintrc`, `resources.json`, `app_settings/base_settings.json`.
   Templates now ship these (memory: `decision_templates_ship_required_minimal`), but a
   real project imported from disk may not.
2. **XLSForm `name` validity** — pyxform rejects `name` cells that aren't valid
   identifiers. Users can currently type `1st visit` into a name cell (or paste in a
   translated label) and only discover the failure at compile time.
3. **`${field}` reference resolution** — `dependencies.validateOrdering()` catches the
   "referenced before defined" case, but not the "referenced field doesn't exist
   anywhere in this form" case (dangling `${}`), which is what most typo classes
   collapse to. It also doesn't cover `${}` with an empty body.
4. **`select_*` choices present** — a `select_one X` / `select_multiple X` with no
   matching `list_name = X` in the choices sheet (or an empty list) fails at compile.
5. **`form_id` conventions** — CHT app-form ids are lowercase-snake-case; a capitalized
   or space-containing form_id passes pyxform but breaks task/target refs downstream.

Every one of these is a compile-or-runtime silent break. The check logic must live in
`shared/` so a future CI per-template guard uses the same source of truth (memory:
`decision_templates_ship_required_minimal`, DEV-HANDOFF explicit ask).

## 2. Scope this cycle

**Ships:**
- One shared aggregation module: `shared/src/preflight/` with a single
  `runPreflightChecks(input)` entry point and one violation type.
- Six check packs (§3). Reuse `structuralBalance.findStructuralViolations()` and
  `dependencies.validateOrdering()` verbatim — the preflight layer is aggregation, not
  a rebuild.
- Extension to `DeployReadinessChecklist` in `DeployPanel.tsx` (do **not** add a new
  panel) — the existing checklist grows a "Preflight" section with per-pack collapsible
  rows.
- Two one-click fixes: **Slugify a bad `name`** (reuse `slugifyHierarchyId` +
  `renameSurveyRow` so every `${}` ref updates in lockstep) and **Stub a missing
  required file** (writes the same content the templates ship — one source of truth
  via `server/templates/blank/`). A third fix — **Add empty choice list** — piggybacks
  on the existing form-save path (no new server route).
- One new server endpoint: `POST /api/preflight/stub-file` (writes a minimal-valid
  stub for the requested filename). Everything else is client-side over `shared/`.
- Deep-link from a failing form-level violation to the offending row: reuse the
  `setRevealRowId` hook already wired in `FormEditor.tsx:224-227` via a `useApp` action.

**Non-goals this cycle** (deferred to future plan docs):
- XPath **repair** action for `../../ vs ../../../` hop mismatches — needs symbolic
  rewrite + round-trip test; violation is **detected**, no one-click fix.
- CI per-template guard integration — the shared registry is the source of truth,
  hooking it into `.github/workflows/ci.yml` is a separate ops task.
- Full contact/task/target cross-reference graph — checks are scoped to their own
  file class; cross-file references stay warnings, not errors.
- Blocking the Deploy button on preflight failures. Non-blocking (matches the
  existing checklist precedent — "seen-and-acknowledged, not gated").
- Adding preflight to any surface outside `DeployPanel` this cycle. Optional
  top-nav badge is called out in §9 open decisions.

## 3. Shared preflight contract (the load-bearing part)

New module `shared/src/preflight/` with these exports. Nothing goes in
`shared/src/xlsform/` because the checks span more than xlsform (required files,
form_id conventions, tasks presence). Existing xlsform validators are imported and
reused as-is.

```
// shared/src/preflight/types.ts
export type CheckId =
  | 'required-files'
  | 'xlsform-names-valid'
  | 'xlsform-refs-resolve'
  | 'select-choices-present'
  | 'form-id-convention'
  | 'survey-structure-balanced'; // wraps structuralBalance + validateOrdering

export type Severity = 'error' | 'warning';

export interface PreflightViolation {
  checkId: CheckId;
  severity: Severity;
  /** One-line human message. NEVER a raw pyxform trace. */
  message: string;
  /** Form the violation lives in; omitted for project-wide checks. */
  formId?: string;
  /** Project-root-relative file path (e.g. 'targets.js'); populated for
   *  required-files, absent for form-level checks (formId covers those). */
  affectedFile?: string;
  /** SurveyRow.rowId for form-level violations; the DeployPanel uses this to
   *  deep-link into the FormEditor via setRevealRowId. */
  rowId?: string;
  /** Optional one-click fix descriptor. Absent = no fix available yet. */
  fix?: PreflightFix;
}

export type PreflightFix =
  | { kind: 'slugify-name'; formId: string; rowId: string; currentName: string; proposedName: string }
  | { kind: 'stub-required-file'; filename: string /* project-root-relative, allowlisted */ }
  | { kind: 'add-empty-choice-list'; formId: string; listName: string };

export interface PreflightInput {
  /** Project-level facts the client already has (from GET /api/project +
   *  GET /api/hierarchy). Passed in so shared/ stays Node-free. */
  project: {
    hasTargetsJs: boolean;
    hasTasksJs: boolean;
    hasContactSummary: boolean;
    hasEslintrc: boolean;
    hasResourcesJson: boolean;
    hasBaseSettings: boolean;
  };
  forms: Array<{ formId: string; form: XLSForm; category: 'app' | 'contact' }>;
}

export function runPreflightChecks(input: PreflightInput): PreflightViolation[];
```

**Invariants (must hold):**
- `runPreflightChecks` is **pure**. No `fs`, no `fetch`, no globals. All I/O is done by
  the caller (client fetches, server writes stubs). This keeps `shared/` Node-free so
  it works in Vite.
- Violations are emitted in a **deterministic order**: `checkId` alphabetical, then
  `formId` (undefined last), then `rowId` (undefined last). Snapshot tests over real
  fixtures rely on this.
- **Never rejects unparseable input.** If a form failed to parse it isn't in `forms[]`
  at all (the parser already surfaces its own errors). If a `${}` body is unrecognized,
  the check skips it — the raw expression stays in the file, per the CLAUDE.md visual
  builder rule.
- **No new fields added to `SurveyRow`, `ChoiceRow`, `XLSForm`.** Preflight reads; it
  does not annotate. Round-trip parse→serialize→parse stays byte-for-byte stable.
- Export via `shared/src/index.ts` as a new re-export line. Rebuild `shared/` before
  the client typechecks (memory: `stale_vite_shared_bundle` — clear
  `node_modules/.vite` if the dev server was running).

**Per-check semantics:**

| checkId | Reads | Emits `error` when | Fix |
|---|---|---|---|
| `required-files` | `input.project` | any of six `has*` flags is false | `stub-required-file` (one violation per missing file) |
| `xlsform-names-valid` | `form.survey[].name` | `name` is non-empty and fails `/^[A-Za-z_][A-Za-z0-9_.-]*$/` (pyxform's identifier rule; underscore + dot + hyphen allowed after the first char) | `slugify-name` |
| `xlsform-refs-resolve` | expression columns via `extractReferences` | `${x}` where `x` is non-empty and no row's `name === x` anywhere in the form's survey; skips XPath-fragment refs (segments containing `.` or `..`) | none this cycle (warning severity on XPath-fragment refs) |
| `select-choices-present` | rows where `SELECT_TYPE_RE.test(type)` | list_name has zero rows in `form.choices` matching that list_name | `add-empty-choice-list` |
| `form-id-convention` | `form.settings.form_id` | non-empty and fails `/^[a-z][a-z0-9_-]*$/` on an **app** form | none (rename cascade outside this cycle) |
| `survey-structure-balanced` | wraps existing validators | any `StructuralViolation` from `findStructuralViolations` OR any `OrderingViolation` from `validateOrdering` | none (existing UI already covers) |

**Warning-only cases:**
- `form-id-convention` on **contact** forms → `warning` (not `error`) — tasks never
  reference contact-form ids by string, so the runtime hit is lower.
- `xlsform-refs-resolve` when the ref body contains an XPath fragment separator (`/`,
  `.`, `..`) → `warning` — legal syntax that's outside the resolver's grammar. Falls
  under the raw-text preserve rule.
- Empty `${}` body → `error` under `xlsform-refs-resolve` (message: "Empty reference
  in <column>"), no fix.

**Reuse notes for the dev:**
- `dependencies.extractReferences` returns the last path segment; that's what the
  resolver check needs. `dependencies.REFERENCING_COLUMNS` is the column set to scan.
- `structuralBalance.findStructuralViolations` and `dependencies.validateOrdering`
  are wrapped 1:1 into `survey-structure-balanced` violations — do not re-derive.
- `slugifyHierarchyId` in `shared/src/hierarchy/buildLinearHierarchy.ts` is the slug
  function to reuse for `slugify-name`'s `proposedName`. Note it strips leading
  non-alpha characters, so `'1st visit'` becomes `'st_visit'` — that's the accepted
  behavior; the fix button surfaces the proposed name before applying.

## 4. UI surface

Extend `DeployReadinessChecklist` in `DeployPanel.tsx` (existing component, lines
1019-1148). **Do not add a new top-level panel** — the checklist is already the "is
this project deployable?" surface; growing it keeps the mental model intact.

**Wiring:**
- `DeployReadinessChecklist` gains a `preflightViolations: PreflightViolation[]` prop
  (or fetches its own — see below). `DeployPanel` runs `runPreflightChecks` on mount
  and whenever `forms` or `project` changes. Selector must return a **stable ref**
  (memory: task-builder-parity #10, unstable-selector class — do not build the
  `forms[]` array inside the `useApp` selector; select the raw store slice and
  memoize with `useMemo`).
- Forms are already loaded lazily by `FormEditor` on demand. Preflight needs the
  parsed XLSForm for every form — reuse the existing `api.getForm(id)` and cache in
  a Zustand slice `preflight: { forms: Record<formId, XLSForm> }`. Load in parallel
  on DeployPanel mount; violations stream in as forms parse.
- Below the existing four checks, a new **"Preflight — pyxform / eslint gates"**
  section renders one collapsible row per `checkId`. Each row shows: check label,
  pass/fail glyph (matching the existing glyph set at `DeployPanel.tsx:1139`), count
  of violations, and — when expanded — the list of violations with a `Fix` button
  where `fix` is populated.
- Deep-link: clicking a form-level violation row calls
  `useApp.getState().setActiveTab('forms')` + `useApp.getState().setActiveFormId(formId)`
  + `useApp.getState().setRevealRowId(rowId)` — the same reveal path
  `StructuralIssuesBadge` uses at `FormEditor.tsx:224-227`. If the required store
  actions don't exist yet, add them as thin setters on the Zustand slice; do not
  refactor navigation.

**Fix buttons:**
- `slugify-name` → new `useApp` action `renameSurveyRowInForm(formId, rowId,
  proposedName)`. Loads the form via `api.getForm(id)` if not already in the slice,
  applies `renameSurveyRow` from `shared/src/xlsform/renameSurveyRow.ts` (which
  already cascades all `${}` refs — DEV-HANDOFF §"pyxform names & refs"), and PUTs the
  form back via `PUT /api/forms/:id`. Optimistically updates the slice; on server
  error, reverts and surfaces the message.
- `stub-required-file` → POSTs to new `/api/preflight/stub-file` (§5). On 200,
  triggers `api.getProject()` to refresh the six `has*` flags on the store, which
  re-runs the check.
- `add-empty-choice-list` → mutates the target form's `choices` array (append one
  row: `{ list_name: listName, name: 'option_1', labels: { <default_language>:
  'Option 1' }, extras: {} }`) and saves via the existing form PUT. No new endpoint.

**Refresh:** the checklist re-computes on prop / slice change; no manual refresh
button needed. If the user runs a deploy action that touches the working tree,
`refreshProjectInfo` already fires (`DeployPanel.tsx`).

**Fallback (visual builder rule):** if a `${}` body is unparseable or an expression
column contains something the reference extractor doesn't recognize, the check
**silently skips it** — never flags a false positive, never rewrites raw text. The
raw expression stays intact through the parse/serialize round-trip.

**Empty state:** with zero violations, the section collapses to a single "All
preflight checks pass" summary row (matches the existing checklist's minimal shape).

## 5. Server route

One new endpoint. Everything else runs in the client over `shared/`.

`POST /api/preflight/stub-file`

Request body:
```
{ "filename": "targets.js" }
```

Response (200):
```
{ "ok": true, "path": "<absolute>", "bytesWritten": 123 }
```

**Allowlist** (rejects anything else with 400):
- `targets.js`
- `tasks.js`
- `contact-summary.templated.js`
- `.eslintrc`
- `resources.json`
- `app_settings/base_settings.json`

**Content source:** read the file **verbatim** from `server/templates/blank/` — that
directory ships the minimal-valid version of every required file (memory:
`decision_templates_ship_required_minimal`, confirmed by `ls
server/templates/blank/`). One source of truth: if the template file changes, the
stub changes.

**Semantics:**
- Refuses if the target file **already exists** (409 with `{ ok: false, error: '…' }`).
  Never overwrites — non-destructive is the CLAUDE.md invariant.
- Path-traversal defense: the allowlist is a **literal string set**; server joins onto
  the current project path via `path.join(projectPath, filename)` and asserts the
  resolved path starts with `projectPath + path.sep`. Reject with 400 otherwise.
- Creates parent directory (`app_settings/`) with `mkdir -p` semantics if needed
  (only the `app_settings/base_settings.json` case).
- Reads the template stub with `fs.readFile` (utf8) and writes with `fs.writeFile`.
  Bytes match template exactly.

**Location:** extend `server/src/routes/cht-conf.ts` (already 818 lines; the route
lives with the deploy surface). If the file is too crowded to extend cleanly, create
`server/src/routes/preflight.ts` and register it from `server/src/index.ts` — but
prefer extending the existing file first.

**Error semantics:** friendly `{ ok: false, error: '…' }` responses matching the
existing project-route pattern. Never leaks fs error codes to the UI.

## 6. Round-trip / test cases

Tests live in `shared/src/preflight/runPreflightChecks.test.ts` (node:test over the
compiled `dist/`, per CLAUDE.md convention). Fixtures reuse the parser test corpus
in `shared/src/xlsform/`.

Numbered cases the test file asserts:

1. **All-clear project.** All six `has*` flags true, three valid forms, no violations
   → `runPreflightChecks` returns `[]`.
2. **Missing `targets.js`.** `hasTargetsJs: false` → exactly one violation with
   `checkId: 'required-files'`, `severity: 'error'`, `fix.kind: 'stub-required-file'`,
   `fix.filename: 'targets.js'`, `affectedFile: 'targets.js'`. No other violations.
3. **All six required files missing.** Six `required-files` violations, one per
   file, sorted alphabetically by `affectedFile`.
4. **Invalid `name` cell.** A survey row with `name: '1st visit'` → one
   `xlsform-names-valid` error with `fix.kind: 'slugify-name'`. `proposedName` equals
   `slugifyHierarchyId('1st visit')`.
5. **Valid names with `.` and `-`.** Rows with `name: 'foo.bar'` and `name: 'a-b'`
   → no violations (pyxform allows these after the first character).
6. **Empty `${}`.** Row with `relevant: '${} > 0'` → one `xlsform-refs-resolve`
   error, message names the empty ref; no `fix`.
7. **Dangling `${}` ref.** Row with `calculation: '${nonexistent_field}'` → one
   `xlsform-refs-resolve` error with `rowId` set to the referencing row.
8. **XPath-fragment ref.** Row with `relevant: '${../parent_field} > 0'` → one
   `xlsform-refs-resolve` **warning** (not error), no `fix`. Raw text unchanged.
9. **`select_one` with missing list.** Row `type: 'select_one moods'` where no
   `ChoiceRow.list_name === 'moods'` → one `select-choices-present` error with
   `fix.kind: 'add-empty-choice-list'`, `fix.listName: 'moods'`.
10. **Empty choice list.** `list_name = 'moods'` referenced by a `select_one` but zero
    rows in `form.choices` for that name → same violation shape as case 9.
11. **Bad `form_id` on app form.** `settings.form_id: 'Pregnancy Register'` on an app
    form → one `form-id-convention` **error**, no fix.
12. **Bad `form_id` on contact form.** Same string on a contact form → one
    `form-id-convention` **warning**, no fix.
13. **Structural imbalance.** Survey with unmatched `begin group` → one
    `survey-structure-balanced` error (wraps `StructuralViolation`'s message
    verbatim; `rowId` populated).
14. **Ordering violation.** Row B references row A but B is above A → one
    `survey-structure-balanced` error (wraps `OrderingViolation`).
15. **Deterministic ordering.** Given a fixture with violations across two forms and
    three checks, the returned array order is stable across runs and independent of
    the input `forms[]` order (snapshot compare).
16. **Round-trip after `slugify-name` fix.** Applying the `slugify-name` fix to a
    form → re-parsing the saved xlsx yields zero `xlsform-names-valid` violations
    for that row, and every `${old_name}` in expression columns is now
    `${new_name}` (delegates to `renameSurveyRow`'s existing test coverage; this
    test asserts preflight sees the fix as complete).
17. **Raw text preserved.** A row with
    `relevant: 'some_weird_thing(${x}, foo/bar)'` where `x` exists but the extractor
    doesn't understand `foo/bar` → only `x` is validated, `foo/bar` is silently
    ignored, the expression column's raw text is unchanged after a
    parse→serialize→parse cycle.

Server integration tests in `server/src/routes/cht-conf.test.ts` (or its sibling)
that POST `/api/preflight/stub-file` for each of the six allowlist filenames into a
scratch project dir and assert:

18. Written file matches `server/templates/blank/<filename>` **byte-for-byte**.
19. **Rejects unknown filenames** with 400 (e.g. `resources/foo.png`).
20. **Rejects existing files** with 409 (does not overwrite).
21. **Rejects path traversal** — `filename: '../evil'` and `filename:
    'app_settings/../../evil'` → 400 before any fs touch.

## 7. Acceptance

QA (Lorena) can check off:
- [ ] Opening a project missing `targets.js` shows a red "Preflight — required files"
      row in DeployPanel; clicking "Fix" writes the file and the row turns green
      without a page reload.
- [ ] Typing `1 first` into an XLSForm `name` cell and saving the form causes a red
      preflight row on the next DeployPanel render; clicking "Fix" renames the row
      and updates every `${1 first}`-style ref (i.e., preserves the cascade
      `renameSurveyRow` already guarantees).
- [ ] A form with a `select_one moods` and no `moods` list shows a red
      `select-choices-present` row; clicking "Fix" adds a stub `option_1` choice and
      the row turns green.
- [ ] Round-trip: run all check + fix cycles on a real cht-conf project (e.g.
      `config-gandaki/cht-config`), then run `node scripts/smoke-parser.mjs
      forms/app/pregnancy.xlsx` — still reports "Round-trip stable: YES".
- [ ] `pnpm --filter @cht-ui/shared build && pnpm --filter @cht-ui/shared test`
      passes all 17 shared cases (§6.1-17) plus the 4 server cases (§6.18-21).
- [ ] `pnpm typecheck` and `pnpm lint --max-warnings=0` clean on the new files (the
      pre-existing ~92 baseline lint errors are out of scope and untouched).
- [ ] With zero violations, the preflight section collapses to a single "All
      preflight checks pass" summary row.
- [ ] Deploy buttons remain **enabled** with violations present (non-blocking; the
      existing checklist precedent stands).
- [ ] Deep-link: clicking a `xlsform-names-valid` violation in DeployPanel navigates
      to the Forms tab, opens the offending form, and scrolls the offending row into
      view (existing `setRevealRowId` reveal animation fires).
- [ ] Path-traversal attempts (`../evil`) on `/api/preflight/stub-file` are rejected
      before any file is written; server logs the attempt.

## 8. Out of scope

- **XPath repair** (`../../` vs `../../../`) — detected as a warning; no auto-rewrite
  this cycle.
- **CI per-template guard** — the shared registry is designed to be called by CI, but
  wiring `runPreflightChecks` into `.github/workflows/ci.yml` is a separate PR.
- **Renaming `form_id`** — flagged, but the rename would need to cascade into tasks,
  targets, contact-summary, translations; deferred.
- **Cross-form reference graph** (a task referencing a form that no longer exists,
  etc.) — the existing coarse checks stay in place; per-reference resolution is a
  Tier 1 workstream (workflow simulator).
- **Blocking Deploy on failures** — non-blocking by design (matches existing
  checklist).
- **New shared exports beyond `preflight`** — do not touch `shared/src/xlsform/`
  files except to import from them. Round-trip invariant untouched.
- **Feature flag** for the new section — ships on for everyone (per CLAUDE.md "no
  feature flags").
- **New top-level UI panels** — extend `DeployReadinessChecklist` only. No
  `PreflightPanel.tsx`.
- **Additional server routes beyond `/api/preflight/stub-file`** — the two other
  fixes (slugify-name, add-empty-choice-list) go through the existing form PUT.

## 9. Open decisions

1. **Rename cascade on `form-id-convention` fix.** RESOLVED — defer the auto-rename
   this cycle. Detect + surface only; the fix requires touching tasks/targets/CS and
   is a separate plan doc. (No `fix` field on this check.)
2. **Should `runPreflightChecks` also run on project open, not just DeployPanel
   mount?** RECOMMEND yes — a small badge on the top-nav "Deploy" tab showing the
   error count, computed once per project state change. Cheap (pure function, forms
   already parsed) and matches the DEV-HANDOFF "optionally on project open" note. If
   the badge scope creeps, drop it — the DeployPanel section is the load-bearing
   surface. Decision punted to build time; safe to add or omit.
3. **`select-choices-present` fix stub content.** RECOMMEND `option_1` with label
   `Option 1` in the form's default language. Rationale: matches the shape existing
   `ChoiceRow`-adding code uses elsewhere; user renames immediately (label-first
   flow, memory: `decision_nocode_names_autoderived`).
