<!--
Crosswalk spec: our XLSForm IR -> Prof. David Levine's (Berkeley) clinical-logic IR
(predicate table + decision tables + phrase bank). OUR side is exact (shared/src/
xlsform/types.ts). THEIR side is PROVISIONAL — reconstructed from Levine's emails
(early July 2026); reconcile once Emett shares the repo + IR->Mermaid transpiler.
Written 2026-07-16. See [[collab_levine_berkeley_ir]].
-->

# IR crosswalk — our XLSForm IR → Levine clinical-logic IR

**Status:** draft for the Levine/Emett conversation. **Our schema = authoritative**
(`shared/src/xlsform/types.ts`). **Their schema = provisional** (from Levine's emails;
confirm against their repo). The transform is a **lossy lift**, not a bijection — see §4.

## 1. Our IR (source) — the XLSForm object
```jsonc
XLSForm {
  "locales": ["en","ne"],
  "surveyHeaders": { "ordered": string[], "labelLocales": string[] },
  "choicesHeaders": { "ordered": string[], "labelLocales": string[] },
  "survey": SurveyRow[],
  "choices": ChoiceRow[],
  "settings": { "form_id"?, "form_title"?, "version"?, "default_language"?, "extras": {col:str} },
  "extraSheets": RawSheet[]
}
SurveyRow  { "rowId", "type", "name", "labels": {loc:str}, "required"?: str, "extras": {col:str} }
ChoiceRow  { "rowId", "list_name", "name", "labels": {loc:str}, "extras": {col:str} }
```
Logic lives as **raw XForm-XPath strings** in `SurveyRow.extras`: `relevant`,
`calculation`, `constraint`, `choice_filter`, `default`. We store them verbatim; we do
not decompose their meaning.

## 2. Levine IR (target) — PROVISIONAL, from his emails
```jsonc
ClinicalIR {
  "inputs":     Input[],        // captured/measured values (typed, NOT booleans)
  "predicates": Predicate[],    // boolean-VALUED named facts (definition may use math)
  "computed":   Computed[],     // numeric/date OUTPUTS that aren't decisions (dose, EDD)
  "decisions":  DecisionTable[],// boolean facts -> classification/action
  "phraseBank": { key: {loc: str} }  // all wording + translations, pulled out
}
Input     { "name", "type": "int"|"real"|"date"|"enum"|"set"|"bool"|"text", "unit"?, "options"? }
Predicate { "name", "expr", "missing"?: "unknown" }   // e.g. age_mo<12 ? rr>=50 : rr>=40  (→ bool)
Computed  { "name", "type": "int"|"real"|"date", "expr" }   // e.g. dose_mg = weight_kg*40
DecisionTable {
  "name", "uses": string[],     // predicate names
  "rows": [ { "when": { <pred>: true|false|"*" }, "classification", "action" } ]
}
```
(The `computed` layer is our addition — Levine's Jul 8 note keeps continuous math in
the predicate layer / accepts non-boolean outputs; `computed` makes numeric outputs
first-class rather than forcing bands. Confirm they model this.)

## 3. The crosswalk (our element → their target)
| Our IR element | → Their target | Transform |
|---|---|---|
| Survey row, type `integer`/`decimal`/`date`/`select_one`/`select_multiple` used as a *measurement* | `inputs[]` (`int`/`real`/`date`/`enum`/`set`) | **Mechanical** — type map + `name`; enum `options` from its choices list |
| Survey row, type `string`/`text`/`tel`/`geopoint` (name, ID, phone, GPS) | `inputs[]` (`text`) — **data-capture passthrough**, not a decision | **Mechanical** |
| All `labels::<loc>` (survey + choices) | `phraseBank[name][loc]` | **Mechanical** |
| `settings.form_title` / choices labels | `phraseBank` | **Mechanical** |
| `choices` (list_name → names) | enum `options` on the matching `Input` | **Mechanical** |
| `extras.calculation` that yields a **number/date** (e.g. EDD = LMP+280, dose = wt*40, age) | `computed[]` (typed) | **Extract** — keep as typed numeric expr; NOT a predicate |
| `extras.calculation`/`constraint` that yields a **boolean/threshold** (e.g. `${age} < 60`) | `predicates[]` | **Extract (analysis)** — parse XPath, lift the comparison to a predicate expr |
| `extras.relevant` (skip logic) | `predicates[]` + decision wiring (the branch condition) | **Extract (analysis)** — condition → boolean predicate; edge in the flow |
| `select_multiple` option → `selected(${x},'opt')` | one `predicate` per option | **Extract/expand** — N booleans |
| Classification/advice logic scattered across `relevant`/`calculation` | `decisions[]` (decision table) | **Extract — HARDEST / lossy** (see §4) |
| `begin/end group`, `appearance`, `style`, `hint` | — (form presentation) | **Dropped** from the decision IR (kept only if they want annotations) |
| A blank/unmeasured input | `predicate.missing: "unknown"` (3rd state) | **Extract** — needs the missing-aware convention |

## 3.5 Calculations — where the logic actually hides (the crux)
In CHT most real logic lives in `calculation` cells, not just `relevant`. The lift must
**classify each calc by what it RETURNS** and route it:
- **Numeric/date output** (`edd = date(${lmp}+280)`, `dose = ${weight}*40`, age, BMI, score) → **`computed[]`** (typed). Not a predicate.
- **Boolean/threshold output** (`fast_breathing = if(${age_mo}<12, ${rr}>=50, ${rr}>=40)`) → **`predicates[]`** (boolean-valued, numeric definition).
- **String/plumbing** (`jr:choice-name(...)`, `coalesce`, `../../inputs/user/name`) → phraseBank / passthrough / **dropped** — not clinical logic.

**Key insight — a nested `if/else` calc is a decision tree in one cell**, so calculations
are the *best* source for recovering decision tables (better than scattered `relevant`s):
```
classification = if(${danger_sign}='yes','severe',
                   if(${cough}='yes' and ${fast_breathing}='yes','pneumonia','no_pneumonia'))
```
→ predicates `{danger_sign, cough, fast_breathing}` + decision table:
`{danger_sign:true} → severe`; `{false, cough:true, fast_breathing:true} → pneumonia`; else `no_pneumonia`.

**Cost:** needs a real **XForm-XPath expression parser** (tokenize → AST → infer return
type → flatten nested `if()` to rows). Our current calc handling (`calculationBuilder`/
`calcReference`) is a **reference-focused subset + raw fallback** — it does NOT parse
arbitrary nested if/else into a tree. So fully handling calc logic = build/borrow an
XPath AST parser. Heuristics cover the common shapes (single comparison, nested-if,
arithmetic); the long tail (Nepali-calendar math, exotic `jr:` functions, deep state
logic) stays raw/opaque or is handed to their AI. This is why their pipeline builds
decisions from the **guideline text** — reading intent from prose beats reverse-
engineering a 200-char nested `if()`.

## 3.6 Schema for the calculation lift (the parse target)
**Our code has no general calc-expression schema today** — `calculationBuilder` /
`calcReference` model a reference-focused subset (`${ref}`, contact-input / contact-
summary) + raw fallback. A full lift needs two new schemas:

**(a) Expression AST** — the parse of one XForm-XPath calculation:
```jsonc
Expr =
  | { "kind":"ref",   "name": string }                       // ${weight}, ../../inputs/user/name
  | { "kind":"lit",   "value": number|string|boolean }       // 280, 'yes'
  | { "kind":"binop", "op": "+|-|*|div|mod|=|!=|<|<=|>|>=|and|or", "l":Expr, "r":Expr }
  | { "kind":"not",   "arg":Expr }
  | { "kind":"if",    "cond":Expr, "then":Expr, "else":Expr } // XForm if() — the decision node
  | { "kind":"call",  "fn":string, "args":Expr[] }            // selected(), date(), jr:choice-name(), coalesce(), sum()…
```

**(b) Classified-calc record** — what the lift emits per `calculation` cell:
```jsonc
CalcLift {
  "name": string,
  "source": string,                 // original XPath — ALWAYS kept verbatim (round-trip anchor)
  "returnType": "boolean"|"number"|"date"|"string"|"unknown",   // = inferType(ast)
  "ast": Expr | null,               // null when unparseable → route:"raw"
  "route": "predicate"|"computed"|"decision"|"passthrough"|"raw",
  "confidence": "exact"|"heuristic"|"unparsed"
}
```
Routing rule: boolean & no nested-`if` → `predicate`; boolean/enum & nested-`if` →
`decision` (flatten); number/date → `computed`; string/plumbing → `passthrough`;
`ast===null` → `raw` (kept verbatim, surfaced for a human/AI).

**Nested-`if` → decision-table flatten** (the whole decision-extraction algorithm):
`if(c1, a, if(c2, b, c))` → `[{when: c1 → a}, {when: ¬c1 ∧ c2 → b}, {when: ¬c1 ∧ ¬c2 → c}]`;
each `when`'s atomic comparisons become `predicates`.

## 4. Honest caveats (say these to Emett/Levine)
1. **The reliable part is inputs + phraseBank + simple predicates.** Type-mapping the
   questions, pulling every label into the phrase bank, and lifting single-comparison
   `relevant`/`calculation` cells into predicates is mechanical-to-easy.
2. **Reconstructing *decision tables* from an existing form is the hard, lossy step.**
   In an XLSForm the "decision" is smeared across many `relevant`/`calculation` cells
   and choice lists; recovering a clean decision table requires real XPath analysis and
   guesswork. **This is exactly why their pipeline builds decisions from the *guideline
   text*, not from the form.** So: our-form → their-IR is a strong source for
   **inputs / predicates / phrase bank**, but **decision tables are better generated
   from the guideline** and reconciled against the extracted ones. The two pipelines
   *converge at the IR*; they don't substitute for each other.
3. **Numeric outputs don't booleanize** (dose, EDD, counts) — they must land in
   `computed`, not `predicates` (per the boolean-only analysis in the collab thread).
4. **Presentation is dropped** (groups/appearance/hints) — fine for a decision IR, but
   means their IR → *back* to an XLSForm has to re-synthesize form layout (their
   "compiler does little work" claim needs checking for CHT's `inputs/` block, contact
   linkage, tasks — the CHT-specific plumbing our generator adds).
5. **Not a round-trip.** ours→theirs is a lift (drops rendering); theirs→ours is a
   generate (re-adds rendering). Verify with their synthetic-patient harness that the
   round trip is *behaviourally* identical even though it's not byte-identical.

## 5. Open questions to confirm (unblocks finalizing this)
- Their **exact IR schema** (get the repo + the `IR→Mermaid` transpiler — it encodes the schema).
- Do they model **numeric `computed` outputs**, or only boolean decisions + predicates?
- Their **missing/unknown** convention (3-valued predicates)?
- Their **phrase-bank key** scheme (so our `name`→key mapping matches).
- Which direction is primary — **ours→theirs** (verify/visualize our forms) or
  **theirs→ours** (their AI generates, our editor + CHT compiler finishes)? The seam
  format is the same either way; the transform code differs.

## 6. Suggested build (small, additive, no change to existing code)
A new pure module `shared/src/interop/xlsformToClinicalIR.ts` — `XLSForm → ClinicalIR`
(mechanical parts done directly; predicate/decision extraction behind a clearly-marked
`extractDecisions()` that can start heuristic and later call their analyzer/AI). Read-
only; does not touch the parser/serializer/editor. Pairs with a `clinicalIRToXlsform`
adapter if we take their output. See [[collab_levine_berkeley_ir]].
