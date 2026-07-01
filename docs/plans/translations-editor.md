<!--
Planner plan for the Tier 2 translations editor — a key × locale grid over
messages-*.properties, non-destructive, keys sourced from real project data.
Pins the shared propertiesParser contract + round-trip cases + server route
shape so the dev can build in one green pass. 2026-07-01.
-->

# Plan: Translations editor (messages-\*.properties)

**Status:** v0.1 — PLANNER-LOCKED, Tier 2 · **Owner:** planner
· **Drives:** the "coverage gaps" bullet — translations — from
`docs/DEV-HANDOFF.md § Roadmap`. Non-coders stop hand-editing `.properties`.

## 1. Problem

Every real CHT app puts user-visible strings behind translation keys:
`task.malaria.followup.title`, `contact.type.patient.plural`,
`targets.deliveries.title`, card labels, field labels. Today the builder has
**no view of these**. If a task adds `title: 'task.foo.title'` and no key
lands in `messages-en.properties`, users see the raw key in the CHW app —
silently broken, only noticed after deploy. To fix it users open the `.properties`
file in a text editor and hand-write `key = value` pairs, which:

- misses keys entirely (no way to see what's referenced but undefined);
- corrupts escapes (`\uXXXX`, native UTF-8, line continuations) on save from
  editors that don't understand `.properties`;
- diverges locales (a key added to `en` but forgotten in `ne`);
- forces the PO's target audience (Bhishan/DHO/Kobo-fluent) into a raw text
  file to complete a build — the exact cold-start abandonment failure mode.

The two templates ship different layouts:

- **`cht-default`** puts files at `translations/messages-<LOCALE>.properties`.
- **`malaria`** puts them at `app_settings/forms/translations/messages-<LOCALE>.properties`.

Both are valid; a real project may have one, the other, or (rare) both. Real
files mix native UTF-8, `\uXXXX` escapes, comment lines, blank lines, and
whitespace-around-`=` styles. All of it must survive save unchanged.

## 2. Scope this cycle

Ship the minimum that removes the text-editor-fallback for the common case:

1. **Shared parser** (`shared/src/translations/propertiesParser.ts`) — lossless
   `.properties` parser + serializer with a round-trip test over both template
   files.
2. **Key extractor from `tasks.js`** — parse `name:` and `title:` string values
   inside `module.exports = [ ... ]` entries via the existing `jsParser`. This
   is the single highest-value source of referenced keys (task titles are the
   most visible surface).
3. **Server route** (`server/src/routes/translations.ts`) — locale + grid GET,
   single-cell PUT. Reads whichever of the two directories exists (both, if
   both). Writes back byte-stable except the edited cell.
4. **Client UI** (`client/src/ui/TranslationsEditor.tsx`) — key × locale grid.
   Rows sorted; missing-cell highlighting; per-cell edit → save → refresh.
5. **Sidebar entry + `view.kind: 'translations'`.**
6. **Node `--test` cases** over compiled `dist/` per the shared workflow.

### Non-goals (this cycle)

- Cards/fields label extraction from `contact-summary.templated.js`.
- Target label extraction from `targets.js`.
- Add-row UI for keys that neither exist in a `.properties` file nor are
  referenced by `tasks.js`. (Missing-key rows appear via the extractor only.)
- One-click "add all missing keys" macro. (Individual empty cells save fine;
  no batch button.)
- Placeholder / `{{}}` validation, locale-vs-locale variable-count checks.
- Bulk import from Crowdin / CSV / external service.
- Renames (rename `task.foo.title` → `task.bar.title` and rewrite all refs).
- The XLSForm per-column `label::LOCALE` editor — that's a Form tab, not this.

## 3. Shared `propertiesParser` contract (the load-bearing part)

The `.properties` grammar we support:

- Lines are either **comment** (starts with `#` or `!`), **blank** (only
  whitespace), or **entry** (`key <sep> value`).
- Separator between key and value is `=`, `:`, or whitespace, optionally
  surrounded by spaces (Java `.properties` spec). Preserve the exact
  separator run byte-for-byte.
- Keys may contain escaped spaces (`\ `) — that's why `messages-en.properties`
  has `District\ Hospital = Health Facility`. Store the **logical** key
  (`District Hospital`), keep the **raw** key text for round-trip.
- Values may continue on the next line if the line ends with an **odd** run
  of trailing backslashes (`foo = bar \` → next line continues). Preserve as-is
  on unedited lines; when a value is edited we write it back on a single line
  and drop continuations (edit rewrites the value, non-edited entries stay
  byte-identical).
- Escapes inside values: `\n`, `\t`, `\r`, `\f`, `\\`, `\=`, `\:`, `\ `,
  `\uXXXX`. Decode when producing the logical `value` string; **on serialize,
  emit only what's needed to disambiguate** (see below).
- Non-ASCII UTF-8 is legal in modern CHT-conf; keep bytes as-is on
  unedited lines. Edited values re-emit non-ASCII as **native UTF-8**
  (files are read/written as `utf8`), matching the malaria template style.

```ts
export interface ParsedProperties {
  /** Original source text; source of truth for byte-stable round-trip. */
  source: string;
  /** Line records in file order, one per physical or logical line group. */
  lines: PropertyLine[];
  /** Index: logical key -> line index in `lines[]`. First occurrence wins. */
  keyIndex: Record<string, number>;
}

export type PropertyLine =
  | { kind: 'blank'; raw: string }
  | { kind: 'comment'; raw: string }
  | {
      kind: 'entry';
      raw: string;                    // exact original bytes of the (possibly multi-line) entry
      key: string;                    // decoded logical key
      value: string;                  // decoded logical value
      /** Present only when this entry has been edited in-memory. */
      edited?: { value: string };
    };

export function parseProperties(source: string): ParsedProperties;
export function serializeProperties(parsed: ParsedProperties): string;
export function setValue(parsed: ParsedProperties, key: string, value: string): ParsedProperties;
```

**parse** — walks lines, folds line-continuation groups into one `entry`
record whose `raw` covers all physical lines. Comments, blank lines, and
duplicate-key entries are preserved verbatim in `lines[]`; only the first
occurrence of a key wins in `keyIndex` (mirrors Java's load semantics).

**serialize** — for each `line`:

- `blank` / `comment` / un-edited `entry` → emit `raw` unchanged (byte-stable).
- `entry` with `edited` → emit `<original-key-and-separator><encoded new value>\n`
  where the key text and separator run are copied from the original raw line,
  and the new value is encoded with the **minimum** escapes required:
  `\\`, `\n`, `\r`, `\t`, `\f`, and a leading space (`\ `) only if the value
  starts with whitespace. `=` and `:` inside values are NOT escaped
  (they don't need to be after the separator). Non-ASCII stays as native UTF-8.
- **New keys** (`setValue` on a key not in `keyIndex`) → append a new
  `entry` line with `<key> = <encoded value>\n`. Keys with spaces are
  escaped as `\ ` in the emitted key. Appends land at end-of-file with a
  single leading `\n` if the file didn't already end in `\n`.

**setValue** — returns a new `ParsedProperties`; does not mutate. Marks
`edited` on an existing entry, or appends a new one.

**Round-trip invariant** (the byte-for-byte bar):

```
parse(source) → serialize → equals source        // when no setValue was called
parse(serialize(parse(source))) equals parse(source)   // idempotent shape
```

Both must hold for every `messages-*.properties` file in
`server/templates/**` and for a fixture containing every escape form.

## 4. Key extraction from `tasks.js` (this cycle only)

Reuse `parseTaskFile` from `shared/src/tasks/jsParser.ts`. For each entry,
collect strings from:

- `title` field (top-level `title: 'task.foo.title'`) — the direct message key.
- `contactLabel`, `priorityLabel` when their `FieldValue` kind is `string`
  (skip when they're `${}` expressions — those aren't message keys).

Emit as:

```ts
export interface ReferencedKey {
  key: string;
  source: { file: 'tasks.js'; entryName?: string; field: 'title' | 'contactLabel' | 'priorityLabel' };
}
export function extractTaskKeys(tasksSource: string): ReferencedKey[];
```

Deferred to next cycle: `contact-summary.templated.js` `cards[].label` /
`fields[].label`, `targets.js` `title` / `subtitle`. The extractor is
plumbed as a list so adding those later is additive, not a rewrite.

## 5. Server route (`server/src/routes/translations.ts`)

Two candidate directories, checked in order:

1. `<project>/translations/`
2. `<project>/app_settings/forms/translations/`

Whichever exist are the source of truth. If **both** exist, the grid unions
their locales; files in both dirs with the same locale are treated as two
separate rows in a **files** map (rare but must not silently merge — see
Open decisions).

Endpoints:

```
GET  /api/translations
  → {
      dirs: Array<{ dir: 'translations' | 'app_settings/forms/translations'; locales: string[] }>,
      grid: {
        keys: string[],                             // sorted union of referenced + present keys
        referenced: Record<string, ReferencedKey['source'][]>,
        values: Record<string, Record<string, string | null>>
          // values[key][`${dir}::${locale}`] = string or null (missing)
      }
    }

PUT  /api/translations/:dirIndex/:locale
  body: { key: string, value: string }
  → { ok: true }
  Loads the file, calls setValue, serializeProperties, atomic tmp-file rename
  write. 400 on unknown dir/locale. Never creates a new locale file this cycle
  (the file must already exist; add-locale is out of scope).
```

`dirIndex` is `0` or `1` matching the order the server discovered dirs so the
UI can address the correct one without hard-coding paths. `locale` is the
suffix from `messages-<LOCALE>.properties`.

Error semantics — 400 with `{ error: string }` for: project not open,
resolveInsideProject rejects, unknown dir index, locale file not present,
key contains characters `.properties` can't represent even with escapes
(control chars other than the recognized ones). No 5xx path; the parser
never throws on real files.

## 6. UI (`client/src/ui/TranslationsEditor.tsx`)

Mounts on `view.kind === 'translations'`. Component tree:

- **Header**: project name (from sidebar), a "Reload from disk" button.
- **Directory tabs** (only if two dirs discovered): "Root `translations/`" and
  "App-settings `translations/`". Single-dir projects hide the tabs.
- **Empty state**: if no dir found → panel says "No `.properties` files yet.
  Run `cht-conf compile-app-settings` (or add a `translations/` folder with
  `messages-en.properties`)." — no CTA that would create a file this cycle.
- **Grid** (`<table>`): columns = `Key` then one column per locale, `en`
  first, others alphabetically. Rows = keys sorted (locale-agnostic string
  compare). Referenced-but-missing keys render with a subtle "referenced by
  tasks.js" chip in the Key cell.
- **Cell** = an inline `<input>` bound to a per-cell dirty flag. Missing
  cells (value `null`) render with a muted "—" placeholder and highlight
  border. On blur (or Enter), if dirty and non-empty, PUT the cell; on 200
  clear dirty, on 400 surface the server error via `setError`. Escape reverts.
- **No global Save button** — cells persist on blur. This matches the
  contact-summary pattern of small-scope commits and side-steps the "one
  dirty grid, 3 dozen edits" undo problem for the MVP.

Sidebar: add a `NavItem label="Translations"` between "Contact summary" and
"Decisions (sign-off)". No `disabled=` gate — the empty state carries the
message. The `view.kind` union in `client/src/state/store.ts` gets one new
variant: `{ kind: 'translations' }`.

`client/src/api.ts` gets two additions matching §5:

```ts
translations: {
  get: () => jsonFetch<TranslationsGrid>('/api/translations'),
  put: (dirIndex: number, locale: string, key: string, value: string) =>
    jsonFetch<{ ok: true }>(`/api/translations/${dirIndex}/${encodeURIComponent(locale)}`, {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    }),
},
```

## 7. Round-trip / test cases (`shared/src/translations/*.test.ts`)

Numbered so QA can check them one-for-one. All tests run via `node --test`
over compiled `dist/` per the shared workflow.

1. `parse(serialize(parse(cht-default/messages-en.properties)))` equals
   `parse(cht-default/messages-en.properties)` structurally, AND
   `serialize(parse(source))` equals `source` byte-for-byte (no edits).
2. Same for `malaria/messages-en.properties` and `malaria/messages-ne.properties`.
3. Edit a single value (`setValue('task.malaria.followup.title', 'D3 follow-up (edit)')`)
   → serialize → source differs **only** on that entry's line; all other lines
   are byte-identical (including the trailing whitespace on
   `contact.profile.anc_visit = ANC facility visits<tabs>` and the escape
   `District\ Hospital`).
4. Comment lines (`# hello`) and blank lines survive unchanged.
5. Key with escaped space (`District\ Hospital`) parses to logical key
   `District Hospital`; editing its value re-emits the escaped key form
   byte-for-byte.
6. A value containing `=` and `:` and native UTF-8 (Devanagari) parses to
   the correct logical string; re-emitting the SAME logical string yields
   the SAME original bytes (idempotent when unchanged).
7. `\uXXXX`-escaped value round-trips: parse decodes to the code point, and
   because the value is unedited, serialize emits the original `\uXXXX`
   bytes (not the decoded native form). Editing the value to the SAME
   decoded string re-emits as native UTF-8 (edited path — intentional).
8. A line-continuation entry (`foo = bar \` + next line `  baz`) parses to
   value `bar baz`; when unedited, serialize emits the original two lines
   verbatim; when edited, serialize emits a single-line `foo = <new value>`.
9. Duplicate key: parse keeps both entries in `lines[]`; `keyIndex` points
   at the first; `setValue` on that key edits the first occurrence and
   leaves the second byte-identical.
10. `setValue` on a brand-new key appends `<key> = <value>\n`; the file's
    original terminator is preserved (adds a leading `\n` only if the source
    didn't end in one).
11. `extractTaskKeys` on `templates/malaria/tasks.js` returns exactly
    `[{ key: 'task.malaria.followup.title', source: { file: 'tasks.js', entryName: 'malaria.followup', field: 'title' } }]`.
12. `extractTaskKeys` skips `title` values that look like `${...}` expressions
    (i.e. non-string `FieldValue` kinds) — no `${}` false positives.

## 8. Acceptance

Concrete checks the QA persona (Lorena) can tick off:

- Open the malaria template project; sidebar shows **Translations** nav item.
- Click it; grid shows both `en` and `ne` columns and the two dirs' locales
  merged if applicable. Rows include `task.malaria.followup.title` (from the
  extractor) and all keys present in the `.properties` files.
- A key referenced by `tasks.js` but missing from `en` shows highlighted
  empty cells and the "referenced by tasks.js" chip on the row.
- Edit a cell, tab out, reload the page — the new value is on disk in the
  correct `messages-<locale>.properties`.
- `git diff` after the edit shows **only** the one line changed; escapes,
  comments, blank lines, and trailing whitespace on other rows are
  byte-identical.
- Editing a value containing `\uXXXX`-escaped characters on a row that WAS
  unedited by us keeps the original `\uXXXX` bytes on save.
- Rename-heavy: run `pnpm --filter @cht-ui/shared test` — all round-trip
  cases §7 pass.
- Zero-warnings lint clean on the files we touched (`propertiesParser.ts`,
  `translations.ts`, `TranslationsEditor.tsx`, `Sidebar.tsx`, `store.ts`,
  `api.ts`). Pre-existing baseline errors elsewhere are out of scope.
- Nothing regresses in the contact-summary or tasks editors (we don't touch
  their parsers).

## 9. Out of scope

- Cards / fields / targets extraction (P1).
- Add-locale (creating `messages-fr.properties` from the UI). Users can
  copy the file on disk; the editor picks it up on reload.
- Add-row for a key that isn't referenced anywhere (P1 — needs UX for
  where to put it, which file, which locale first).
- Placeholder/`{{}}` count checks between locales.
- Renames / rewrite-all-refs macros for message keys (P2, mirrors
  `decision_nocode_names_autoderived`).
- Live enketo preview showing the translations applied (Tier 1).

## 10. Open decisions

1. **Two dirs found — merge or file-separate?** Recommend **file-separate**:
   the API surfaces both dirs; the UI shows a directory-tab switcher when
   both are non-empty. Merging would silently pick a winner and corrupt the
   other on save. Zero real projects in-hand have both, so the tabs are a
   safety valve, not a common path.
2. **`\uXXXX` re-emission on edited values** — recommend **native UTF-8** on
   edited cells (so `en` stays native; `\uXXXX` is legacy). Unedited entries
   keep whatever the file already had. Documented in §3, tested in §7 case 7.
3. **Row sort order** — recommend plain locale-agnostic string sort. Grouping
   by prefix (`task.*`, `contact.*`) is nicer but adds UX surface we can defer;
   sorted keys land alphabetically so `task.malaria.followup.title` sits near
   its neighbors already.
