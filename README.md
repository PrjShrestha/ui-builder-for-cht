# CHT UI Builder

No-code editor for cht-conf project folders. Runs locally; reads and writes the
project folder on disk so the same folder remains deployable with `cht-conf`.

## Run

Requires Node 20+ and pnpm 9+. From this directory:

```sh
pnpm install
pnpm dev
```

This starts:

- Fastify API server on http://localhost:5174 (`/api/...`)
- Vite client on http://localhost:5173 (proxies `/api` to the server)

Open http://localhost:5173. The first screen asks for the absolute path to a
cht-conf project folder. Examples on this machine:

- `W:\ui-builder-for-cht\config-gandaki\cht-config`
- `W:\ui-builder-for-cht\config-nssd\chis`
- `W:\ui-builder-for-cht\config-nssd\waling`

The server remembers the last-opened path in `~/.cht-ui-builder/state.json`.

## What's in this build

### Phase 0 — Open + edit existing XLSForms
- Project picker; project description includes which files exist (forms,
  app_settings, tasks.js, contact-summary)
- Forms list view for `forms/app/` and `forms/contact/`
- **Survey editor:** add / remove / reorder (drag + ↑↓) questions; edit `type`,
  `name`, `required`, and all `label::xx` locales
- **Advanced fields:** edit `relevant`, `calculation`, `constraint`,
  `choice_filter`, `appearance`, `default`, `repeat_count`, plus
  `hint::xx` / `constraint_message::xx` per locale
- **Choices editor:** add / remove / reorder choices within a list; edit names
  and labels per locale
- **Settings editor:** form_title, form_id, version, default_language
- **Properties.json editor** (tab on app forms): localized titles, icon, context
  expression, person/place flags
- **Dependency safety on reorder:** drag-and-drop is intercepted when moving a
  row would break `${field}` references. The validator runs continuously and
  highlights every row that references something defined later.
- **Form preview pane:** stacked field preview alongside the survey editor, with
  a locale switcher.
- **Diff preview before save:** modal shows added / removed / modified rows,
  reordering, choice changes, and settings changes. Confirm to write.

### Phase 1A — Hierarchy editor
- Tree view over `contact_types` with NSSD-style paired place + contact-person
  pattern surfaced
- Edit id (with rename across `parents` references), display name, icon,
  person flag, count_visits, name_key, primary_contact_key, parents
- Writes back to `app_settings/base_settings.json` (touching only the keys it
  owns) and `forms/contact/place-types.json`

### Phase 1B — Form creation + contact-form mode
- Create new app forms (scaffolds .xlsx + .properties.json)
- Create new contact forms (scaffolds .xlsx)
- Same editor for both; "contact form" is just a directory difference

### Phase 1B-2 — Visual rule builder for XLSForm expressions
- "✎ build" button next to `relevant`, `constraint`, `choice_filter`
- Visual rule cards: comparison (`${field} OP value`), `selected(...)`,
  answered / not answered, plus AND/OR combinator
- Falls back to raw text editor for expressions outside the supported grammar
  (the raw text is preserved on save)

### Phase 1C — Tasks editor
- Structured view of `tasks.js`: each task is a card with editable name, title,
  icon, appliesTo, appliesToType, events, actions
- Function-valued fields (`appliesIf`, `resolvedIf`, `dueDate`) edited in a
  per-task code area
- Save rebuilds the exported array body via byte-range edit; imports and
  helpers outside the array stay untouched
- Raw-file tab for `tasks.js`, `task-schedules.js`, `tasks-extras.js`

### Phase 1C-bis — Contact-summary context flags editor
- Detects `const context = { ... }` in `contact-summary.templated.js`
  (or `context: { ... }` inside the final return statement)
- Each flag becomes a card with name + JS expression
- Add / rename / remove / edit flags
- `fields[]` and `cards[]` are left verbatim — only the context object is
  rewritten

### Phase 1D — Form-logic flowchart visualizer
- React Flow graph of every dependency edge in the XLSForm
  (relevant / calculation / constraint / choice_filter / repeat_count / default)

## Round-trip safety

The XLSForm parser separates known columns from "extras" per row. On save,
every unknown column is written back in the original column position. Sheets
the parser doesn't understand (e.g. gandaki's `choices-backup`) are preserved
verbatim. Hierarchy edits only mutate `place_hierarchy_types`,
`contact_types`, and `place-types.json` — every other key in
`base_settings.json` is preserved untouched.

Smoke-tested against `config-gandaki/cht-config/forms/app/pregnancy.xlsx`:
- 143 survey rows, 22 choices, en + ne locales, 18 survey columns
- `choices-backup` extra sheet preserved
- 132 dependency edges in the form's logic graph
- 5 pre-existing ordering violations detected in the real gandaki file
- Parse → serialize → parse round-trips byte-for-byte stable

## What's deliberately not in MVP

- Targets (`targets.js`) — explicitly dropped per user decision
- SMS forms / `registrations[]` / `schedules.json` / `forms.json` (Devanagari
  forms) — preserved verbatim but no UI editor
- Visual JS rule builder for `appliesIf` (code-editor only in MVP)
- Contact-summary `fields[]` and `cards[]` editors (preserved verbatim;
  Phase 2)
- pyxform invocation on save (re-compile .xlsx → .xml) — users still run
  `cht-conf convert-app-forms` or `cht --local`
- Live enketo preview (we ship a simplified stacked-field preview)
- Git integration (status, diff, commit) — out of MVP

## Project layout

```
app/
├── client/                 Vite + React + TS UI (port 5173)
│   └── src/ui/             Editor components
├── server/                 Fastify API (port 5174)
│   └── src/routes/         project, forms, hierarchy, tasks, contact-summary
├── shared/                 Parsers, serializers, types
│   └── src/
│       ├── xlsform/        types, parse, serialize, dependencies, relevantParser, diff
│       └── tasks/          jsParser, contactSummaryParser
└── scripts/smoke-parser.mjs  Round-trip smoke test
```

## Smoke test

After `pnpm install`:

```sh
pnpm --filter @cht-ui/shared build
node scripts/smoke-parser.mjs ../config-gandaki/cht-config/forms/app/pregnancy.xlsx
```

Should print survey stats and `Round-trip stable: YES`.
