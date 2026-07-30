/**
 * Recognizer + emitter for the "latest value from another form" idiom
 * that populates `context: {}` in `contact-summary.templated.js`.
 *
 * Wave 3 · Note 6 (Geriatric/ANC field notes) — cross-form value bridge.
 * The reference syntax on the form side is already solved by
 * `xlsform/calcReference.ts` (`instance('contact-summary')/context/<key>`
 * with an optional `fallback-to-current` wrapper). The gap this parser
 * fills is populating a `context` key from another form's most-recent
 * report — today the per-flag editor is a raw `<textarea>`, and the
 * author has to hand-write the `reports`-scan JS.
 *
 * RUNTIME CONTRACT (audit P0-1, docs/reviews/waves-1-3-audit-2026-07-30.md):
 * the contact-summary runtime exposes ONLY `contact`, `reports`, and
 * `lineage` as globals — `Utils` does NOT exist here (it is global in
 * tasks.js / targets.js only). The first version of this emitter called
 * `Utils.getMostRecentReport` / `Utils.getField`, which compiles clean and
 * then throws `ReferenceError` on-device, killing the ENTIRE `context`
 * object (contact page + every form's `instance('contact-summary')` read).
 * The canonical shape is therefore a fully self-contained scan over the
 * `reports` global:
 *
 *   (function () {
 *     var newest;
 *     reports.forEach(function (r) {
 *       if (r.form === 'diabetes_screening' && (!newest || r.reported_date > newest.reported_date)) { newest = r; }
 *     });
 *     var value = newest && newest.fields;
 *     'vitals.bmi'.split('.').forEach(function (p) { value = value && value[p]; });
 *     return value;
 *   })()
 *
 * The dotted-path walk handles group-nested fields (`report.fields.vitals.bmi`).
 * With no matching report the IIFE returns `undefined`, so consumers on the
 * form side can safely chain the `fallback-to-current` wrapper
 * (`if(ref, ref, .)`) — a nullish ctx value falls through to the user's
 * current answer.
 *
 * Round-trip contract: emit → recognize → emit is a fixpoint. The legacy
 * `Utils.*` shape (written by the pre-fix emitter) is STILL recognized so
 * an affected project re-hydrates in the picker instead of dropping to
 * raw JS — and the next save re-emits the fixed shape (a deliberate
 * self-healing migration, not a byte-stability break: the value cell is
 * exactly what the user is editing).
 *
 * Non-goals: this module does NOT teach the contact-summary parser a new
 * shape (`context` remains an object of `key: <valueExpr>` cells). The
 * bridge idiom is stored as the `<valueExpr>` string for one key —
 * exactly what the flag CRUD already handles.
 */

/** A recognized cross-form context-value bridge. */
export interface ContextValueBridge {
  /** Form basename (matched against `report.form`), e.g.
   *  `'diabetes_screening'`. Never carries the `.xlsx` suffix — this is
   *  the CHT form id used at report time. */
  sourceForm: string;
  /** Field path within the source form's report, e.g. `'bmi'` or
   *  `'vitals.bmi'` for group-nested fields. Split on `.` and walked
   *  segment-by-segment over `report.fields`. */
  sourceField: string;
}

/**
 * Match the canonical self-contained scan. Whitespace-tolerant (the
 * contact-summary serializer's interpolation can land with any
 * indentation) but strict on identifier names (`newest`, `r`, `value`,
 * `p`) — hand-edited variants fall back to the raw-JS editor, which is
 * lossless.
 *
 * Groups: 1/2 quote + source form · 3/4 quote + source field.
 */
const BRIDGE_RE = new RegExp(
  '^\\(\\s*function\\s*\\(\\s*\\)\\s*\\{\\s*' +
    'var\\s+newest\\s*;\\s*' +
    'reports\\.forEach\\s*\\(\\s*function\\s*\\(\\s*r\\s*\\)\\s*\\{\\s*' +
    "if\\s*\\(\\s*r\\.form\\s*===\\s*(['\"])([^'\"\\\\]*)\\1\\s*&&\\s*\\(\\s*!newest\\s*\\|\\|\\s*r\\.reported_date\\s*>\\s*newest\\.reported_date\\s*\\)\\s*\\)\\s*\\{\\s*newest\\s*=\\s*r\\s*;\\s*\\}\\s*" +
    '\\}\\s*\\)\\s*;\\s*' +
    'var\\s+value\\s*=\\s*newest\\s*&&\\s*newest\\.fields\\s*;\\s*' +
    "(['\"])([^'\"\\\\]*)\\3\\s*\\.split\\s*\\(\\s*['\"]\\.['\"]\\s*\\)\\s*\\.forEach\\s*\\(\\s*function\\s*\\(\\s*p\\s*\\)\\s*\\{\\s*value\\s*=\\s*value\\s*&&\\s*value\\s*\\[\\s*p\\s*\\]\\s*;\\s*\\}\\s*\\)\\s*;\\s*" +
    'return\\s+value\\s*;?\\s*' +
    '\\}\\s*\\)\\s*\\(\\s*\\)\\s*;?\\s*$',
);

/**
 * Legacy shape written by the pre-fix emitter (calls `Utils.*`, which is
 * undefined in the contact-summary runtime — see the header). Recognized
 * ONLY so affected projects re-open in the picker; the next save emits
 * the fixed shape above.
 */
const LEGACY_UTILS_BRIDGE_RE =
  /^\(\s*function\s*\(\s*\)\s*\{\s*var\s+([a-zA-Z_$][\w$]*)\s*=\s*Utils\.getMostRecentReport\s*\(\s*reports\s*,\s*(['"])([^'"\\]*)\2\s*\)\s*;\s*return\s+([a-zA-Z_$][\w$]*)\s*\?\s*Utils\.getField\s*\(\s*([a-zA-Z_$][\w$]*)\s*,\s*(['"])([^'"\\]*)\6\s*\)\s*:\s*undefined\s*;?\s*\}\s*\)\s*\(\s*\)\s*;?\s*$/;

/**
 * Try to recognize an expression as a cross-form context-value bridge.
 * Returns `null` when the expression matches neither the canonical nor
 * the legacy shape (caller falls back to the raw-JS `<textarea>` editor).
 */
export function recognizeContextValueBridge(expr: string): ContextValueBridge | null {
  if (!expr) return null;
  const trimmed = expr.trim();

  const m = trimmed.match(BRIDGE_RE);
  if (m) {
    return { sourceForm: m[2]!, sourceField: m[4]! };
  }

  const legacy = trimmed.match(LEGACY_UTILS_BRIDGE_RE);
  if (legacy) {
    const bind = legacy[1]!;
    // All three identifier positions MUST refer to the same binding — a
    // mismatched name is likely a different idiom the user hand-wrote.
    if (bind !== legacy[4] || bind !== legacy[5]) return null;
    return { sourceForm: legacy[3]!, sourceField: legacy[7]! };
  }

  return null;
}

/**
 * Build the canonical bridge expression for a `(sourceForm, sourceField)`
 * pair. Emits the exact string `BRIDGE_RE` accepts as a fixpoint
 * (round-trip stable). Output is a SINGLE self-invoking function
 * expression — it composes into the `context: { key: <expr>, ... }`
 * shape the contact-summary serializer already writes, so no changes to
 * that serializer are needed. No `Utils`, no extras import — safe in the
 * bare contact-summary runtime.
 *
 * Quoting: single quotes throughout (the CHT eslint `quotes` rule).
 * Backslashes and single quotes in payloads are escaped.
 */
export function emitContextValueBridge(bridge: ContextValueBridge): string {
  const form = jsSingleQuote(bridge.sourceForm);
  const field = jsSingleQuote(bridge.sourceField);
  return (
    `(function () {\n` +
    `    var newest;\n` +
    `    reports.forEach(function (r) {\n` +
    `      if (r.form === ${form} && (!newest || r.reported_date > newest.reported_date)) { newest = r; }\n` +
    `    });\n` +
    `    var value = newest && newest.fields;\n` +
    `    ${field}.split('.').forEach(function (p) { value = value && value[p]; });\n` +
    `    return value;\n` +
    `  })()`
  );
}

function jsSingleQuote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
