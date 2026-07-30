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
 * Canonical shape (single-expression IIFE so it composes cleanly into
 * the existing `context = { key: <expr>, ... }` object the contact-summary
 * parser/serializer already understands):
 *
 *   (function () {
 *     var report = Utils.getMostRecentReport(reports, 'diabetes_screening');
 *     return report ? Utils.getField(report, 'bmi') : undefined;
 *   })()
 *
 * The IIFE returns either the field value or `undefined`, so consumers on
 * the form side can safely chain the `fallback-to-current` wrapper
 * (`if(ref, ref, .)`) — an `undefined` ctx value falsily falls through to
 * the user's current answer.
 *
 * Round-trip contract: emit → recognize → emit is a fixpoint. The
 * contact-summary serializer preserves the containing `context` object
 * verbatim outside the byte range it rewrites, so a bridge value written
 * via the picker and re-opened later re-hydrates through this
 * recognizer, not the raw-JS fallback.
 *
 * Non-goals: this module does NOT teach the contact-summary parser a new
 * shape (`context` remains an object of `key: <valueExpr>` cells). The
 * bridge idiom is stored as the `<valueExpr>` string for one key —
 * exactly what the flag CRUD already handles.
 */

/** A recognized cross-form context-value bridge. */
export interface ContextValueBridge {
  /** Form basename (as passed to `Utils.getMostRecentReport`), e.g.
   *  `'diabetes_screening'`. Never carries the `.xlsx` suffix — this is
   *  the CHT form id used at report time. */
  sourceForm: string;
  /** Field path within the source form's report, e.g. `'bmi'` or
   *  `'preg_info.delivery_date'`. Passed verbatim to
   *  `Utils.getField(report, <path>)`. */
  sourceField: string;
}

/** Match the canonical IIFE bridge shape. Whitespace-tolerant — the
 *  contact-summary serializer's `${flags[key]}` interpolation can land
 *  with any indentation, so we accept any inter-token spacing without
 *  altering the recognized payload.
 *
 *  Groups:
 *    1 — the `report` binding name (usually `report`; we allow any
 *        identifier since a user may hand-edit the raw JS and later
 *        re-emit with the canonical name).
 *    2 — the source form (single- or double-quoted).
 *    3 — the same identifier as group 1, checked equal in code.
 *    4 — the source field (single- or double-quoted).
 *    5 — the same identifier as group 1, checked equal in code.
 *    6 — the source field again (same-quote as group 4).
 *
 *  The literal `undefined` in the falsy branch is required so the
 *  wrapper's falsy-fallback semantics hold. `null` / `''` are
 *  DIFFERENT semantics (falsy-but-not-nullish) — we conservatively
 *  reject them so the round-trip stays deterministic.
 */
const BRIDGE_RE =
  /^\(\s*function\s*\(\s*\)\s*\{\s*var\s+([a-zA-Z_$][\w$]*)\s*=\s*Utils\.getMostRecentReport\s*\(\s*reports\s*,\s*(['"])([^'"\\]*)\2\s*\)\s*;\s*return\s+([a-zA-Z_$][\w$]*)\s*\?\s*Utils\.getField\s*\(\s*([a-zA-Z_$][\w$]*)\s*,\s*(['"])([^'"\\]*)\6\s*\)\s*:\s*undefined\s*;?\s*\}\s*\)\s*\(\s*\)\s*;?\s*$/;

/**
 * Try to recognize an expression as a cross-form context-value bridge.
 * Returns `null` when the expression doesn't match the canonical shape
 * (caller falls back to the raw-JS `<textarea>` editor).
 */
export function recognizeContextValueBridge(expr: string): ContextValueBridge | null {
  if (!expr) return null;
  const m = expr.trim().match(BRIDGE_RE);
  if (!m) return null;
  const bind = m[1]!;
  const sourceForm = m[3]!;
  const bind2 = m[4]!;
  const bind3 = m[5]!;
  const sourceField = m[7]!;
  // All three identifier positions MUST refer to the same binding — a
  // mismatched name is likely a different idiom the user hand-wrote,
  // and re-emitting it would silently rename their variable.
  if (bind !== bind2 || bind !== bind3) return null;
  return { sourceForm, sourceField };
}

/**
 * Build the canonical bridge expression for a `(sourceForm, sourceField)`
 * pair. Emits the exact string the recognizer accepts as a fixpoint
 * (round-trip stable). Output is a SINGLE self-invoking function
 * expression — it composes into the `context: { key: <expr>, ... }`
 * shape the contact-summary serializer already writes, so no changes to
 * that serializer are needed.
 *
 * Quoting: both string arguments are single-quoted (the CHT eslint
 * config's `quotes: ['error', 'single']` rule; see `appliesIfParser`'s
 * `cht-eslint-safe` regression for the same reason). Backslashes and
 * single quotes inside the payload are backslash-escaped.
 */
export function emitContextValueBridge(bridge: ContextValueBridge): string {
  const form = jsSingleQuote(bridge.sourceForm);
  const field = jsSingleQuote(bridge.sourceField);
  return (
    `(function () {\n` +
    `    var report = Utils.getMostRecentReport(reports, ${form});\n` +
    `    return report ? Utils.getField(report, ${field}) : undefined;\n` +
    `  })()`
  );
}

function jsSingleQuote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
