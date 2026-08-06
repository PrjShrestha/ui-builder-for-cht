<!--
The shareable "intermediate mapping" contract: how UI form edits become .xlsx and UI
task edits become tasks.js. Any producer (another UI, an AI pipeline) that emits these
IRs and calls these serializers gets valid CHT artifacts. Grounded in shared/src.
2026-07-16.
-->

# Intermediate representation + serializer contract

**One line:** the tool is an **IR ↔ serializer** design (think MVC where the **Model is
the IR**, the **View is the editor UI**, and the **serializer/parser is the compiler**
between the IR and the on-disk artifact). Both IRs live in the **`shared/`** package
(pure functions — no filesystem, no DOM). *That package is the shareable boundary:* **any
producer that emits a valid IR gets a valid artifact by calling the serializer — no need
to know xlsx internals or do JS-AST surgery.**

```
UI editor (View)  ⇄  IR object (Model, in shared/)  ⇄  serializer (shared/)  →  on-disk artifact
                        ▲
        anything else that emits the same IR plugs in here
        (AI pipeline, importer, another front-end)
```

## 1. Forms  → `.xlsx`   (clean, complete IR)
- **IR:** `XLSForm` (`shared/src/xlsform/types.ts`) — `{ survey: SurveyRow[], choices: ChoiceRow[], settings, surveyHeaders, choicesHeaders, extraSheets }`. Each `SurveyRow = { rowId, type, name, labels:{loc:str}, required?, extras:{col:rawString} }`; logic columns (`relevant`/`calculation`/`constraint`/`choice_filter`/`default`) are raw strings in `extras`.
- **Parser:** `parseXlsForm(bytes) → XLSForm`.
- **Serializer:** `serializeXlsForm(XLSForm) → bytes`  → then cht-conf `convert-app-forms` → `.xml`.
- **Guarantee:** `parse(serialize(x)) === parse(x)` — byte-stable for anything not edited.
- **To plug in:** emit an `XLSForm` object → `serializeXlsForm` → deployable `.xlsx`. This is the **best target for an external generator** — the IR is fully structured and complete.

## 2. Tasks  → `tasks.js`   (hybrid IR: structured fields + raw JS bodies)
- **IR:** `ParsedTaskFile` (`shared/src/tasks/jsParser.ts`):
  ```ts
  ParsedTaskFile { source: string; arrayBounds: {start,end} | null; entries: TaskEntry[] }
  TaskEntry      { …; fields: Record<string, FieldValue> }
  FieldValue =
    | { kind:'string'|'number'|'boolean'|'identifier'; value }   // typed primitives
    | { kind:'array'|'object'|'function'|'unknown';    raw }      // kept as raw JS text
  ```
- **Parser:** `parseTaskFile(source) → ParsedTaskFile` (finds the exported-array bounds; parses each task object into a `fields` map).
- **Serializer:** rebuild the exported-array body and splice it back by **byte range** — `source.slice(0, start+1) + <rebuilt entries> + source.slice(end)` — so **imports and helpers outside the array stay byte-identical**. (Currently `rebuildTasksFile()` in `client/src/ui/TasksEditor.tsx`; see caveat 4.)
- **Function/expression fields** (`appliesIf`, `resolvedIf`, `dueDate`, `modifyContent`) are **raw JS strings**. Visual sub-builders parse a *supported subset* into structured rules with **raw fallback**: `appliesIfParser`, `eventsParser`, `actionsParser`, `contextExpressionParser` (all in `shared/src/tasks/`).
- **To plug in:** two modes — (a) **edit-in-place**: give a `ParsedTaskFile`, we splice only the array; (b) **generate-fresh**: emit `TaskEntry[]` and we render a standalone `module.exports = [ … ]`. Complex fields are still emitted as JS source (see caveat 3).

## 3. Same pattern, the other config surfaces
| Surface | IR | Serializer target |
|---|---|---|
| Contact hierarchy | `contact_types[]` / `place_hierarchy_types` / `place-types.json` objects | `base_settings.json` (only those keys touched; rest byte-identical) |
| Contact summary | context-flags map + extras helpers (`contactSummaryParser`) | `contact-summary.templated.js` (only the `context` object rewritten; `fields[]`/`cards[]` verbatim) |
| Form eligibility | `ContextRule[]` (`contextExpressionParser`) | the `context.expression` string in `<form>.properties.json` |

Every one follows the rule: **structured where we own it, raw/verbatim where we don't.**

## 4. Honest caveats (so it's a real contract, not oversold)
1. **Forms IR is the clean one** — fully structured, complete, byte-stable. Best hand-off for any external generator.
2. **Tasks IR is a hybrid** — structure is typed, but logic fields are **raw JS text**. There is **no fully-abstract task-logic IR**; the visual builders cover common shapes and fall back to raw. So a producer still emits JS for `appliesIf`/`dueDate`/etc. (`Utils.*` is global in that runtime — see the tasks conventions).

   > **Why the forms IR is durable and the tasks IR keeps biting (empirical, 2026-08).** The forms artifact is **tabular**: rows × columns, so "keep every column I don't understand in `extras` and rewrite it in place" is a **complete** model — there is a finite, enumerable set of things to preserve, which is why that side has been byte-stable across every audit. `tasks.js` is **arbitrary JavaScript**: "recognize a few shapes" can never be complete, so the same instinct becomes *silent discard*. Three separate corruption classes were found in `appliesIfParser.ts` in one week — polarity inferred rather than recorded, statements outside the model dropped, call arguments discarded and hardcoded on emit — while the sibling parsers (`relevantParser`, `resolvedIfParser`, `contextExpressionParser`) stayed clean precisely because they record negation **explicitly** and emit into a single expression with no guard notion.
   >
   > **Design rule for any JS-shaped IR here: partial recognition must be all-or-nothing per body.** Classify a body fully or keep it verbatim; never re-emit a token the model didn't record. The protective raw fallback must trigger on *"anything unclassified present"*, not on *"nothing classified"*. See [[feedback_roundtrip_tests_must_call_serializer]].
3. **Round-trip, not equivalence of code style** — we preserve the original source and re-indent only inside the array; unrecognized bodies are kept verbatim.
4. **One gap to make tasks as clean a contract as forms:** `rebuildTasksFile()` lives in the **client**, not `shared`. Moving the entries→source rendering into `shared` (a small refactor) would make the task serializer callable by any producer the same way `serializeXlsForm` is. Recommended if we want tasks to be a first-class shareable seam.

## 5. Net
- **Forms:** `XLSForm` object + `serializeXlsForm` = a complete, shareable contract today.
- **Tasks:** `ParsedTaskFile`/`TaskEntry[]` + the (client-side) rebuild = the contract; move the rebuild into `shared` to finish it.
- Anything — an AI pipeline (e.g. Levine/Berkeley), an importer, another front-end — that produces these IRs "directly fits here." See [[ir-crosswalk-levine]] for mapping a *different* IR into ours.

## 6. Complete IR inventory

> **⚠ Maturity note — read before relying on these.** The **Forms**, **Hierarchy**, and
> **Tasks** IRs are the most exercised (real configs, round-trip tests, the POC build).
> **Contact-summary** (context / cards / helpers) and **FHIR mapping** are **newer and
> less battle-tested — treat their shapes as PROVISIONAL; they may change.** **Targets
> has no IR at all** yet (out of MVP; `targets.js` ships only as a stub) — if a targets
> editor is built later, its IR is TBD.

| Surface → artifact | IR (module in `shared/src/`) | Covers | Stability |
|---|---|---|---|
| **Form** → `forms/**/*.xlsx` | `XLSForm` — `xlsform/{types,parse,serialize}` | whole form: survey rows, choices, settings, headers, extra sheets | **stable** |
| ↳ a survey cell | `xlsform/relevantParser` | `relevant` / `constraint` / `choice_filter` rules (+ raw fallback) | stable |
| ↳ a survey cell | `xlsform/calculationBuilder` + `calcReference` | `calculation` — computed values + cross-form refs | stable |
| ↳ (engine) | `conditionBuilder/conditionReducer` | AND/OR clause chain behind the builders | stable |
| **Hierarchy** → `base_settings.json` + `place-types.json` | `hierarchy/hierarchyOrder` | contact_types, place_hierarchy_types, parent chain, labels | **stable** |
| **Tasks** → `tasks.js` | `tasks/jsParser` (`ParsedTaskFile`/`TaskEntry`/`FieldValue`) | task list; each task's fields (typed + raw JS bodies) | **stable** |
| ↳ a task field | `tasks/appliesIfParser` | `appliesIf` — when it fires | stable |
| ↳ a task field | `tasks/resolvedIfParser` | `resolvedIf` — when it's done | stable |
| ↳ a task field | `tasks/eventsParser` | `events[]` — schedule (anchor + offset, window, dueDate) | stable |
| ↳ a task field | `tasks/actionsParser` | `actions[]` + `modifyContent` field mappings | stable |
| **Contact summary** → `contact-summary.templated.js` (+ `-extras.js`) | `tasks/contactSummaryParser` (context), `contactSummary/cardsParser` (cards/fields), `tasks/helpersParser` (helpers) | `summary.X` eligibility flags + profile cards/fields + helper fns | **⚠ provisional** |
| **Form eligibility** → `forms/app/<form>.properties.json` | plain JSON (`FormProperties`) + `tasks/contextExpressionParser` (the `context.expression`) | title, icon, person/place, "who sees this form" (`ContextRule[]`) | stable-ish |
| **Translations** → `translations/messages-*.properties` | `translations/propertiesParser` | key → value, per locale | new |
| **FHIR mapping** → `forms/app/<form>.fhir-mapping.json` | `fhir/{types,parse,serialize}` (+ `key`/`reconcile`/`coverage`) | form field/choice ↔ LOINC/ICD/CIEL codes + coverage | **⚠ provisional** |
| **Targets** → `targets.js` | **none yet** (stub only) | — | **⚠ no IR** |

**Not IRs (they *operate on* the IRs above):** generators (`buildContactForm`,
`buildHierarchyBlock`, `buildLinearHierarchy`, `scaffolds`, `fhir/starterPack`); edit
macros/utilities (`surveyEdits`, `renameSurveyRow`, `renameChoiceValue`, `renameList`,
`structuralBalance`, `diff`, `dependencies`); the Tier-0 validator (`preflight/*` —
requiredFiles, xlsformIdentifiers, metaXpathHops, selectChoices, danglingRefs); FHIR
support (`dictionary`, `snomedFilter`).
