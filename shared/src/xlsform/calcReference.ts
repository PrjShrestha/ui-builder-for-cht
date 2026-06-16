/**
 * Tier 1.5 of docs/plans/calc-reference-builder.md — "Reference a value"
 * helpers for the calculation builder.
 *
 * Three reference idioms surface in real CHT app forms (the motivating
 * config: `nssd/chis/forms/app/diabetes_referral.xlsx` — 8 of 10 calc
 * cells are mechanical references, never genuine logic):
 *
 *   1. **Contact input field** — `../inputs/contact/<field>`. The standard
 *      patient-link pattern; `inputs/contact/_id` / `name` / `patient_id`.
 *   2. **Contact-summary value** — `instance('contact-summary')/context/<key>`,
 *      optionally wrapped in one of two stock idioms:
 *      - `none`                   → bare reference.
 *      - `fallback-to-current`    → `if(<ref>, <ref>, .)`  (use the ctx value
 *                                    if present, else keep my own answer)
 *      - `read-once`              → `once(<ref>)`           (XForms `once()`)
 *   3. **Another field in this form** — `${field}` (already shipped as
 *      `field-ref` in Tier 1; covered here for the recognizer's completeness).
 *
 * This module is a pure string helper. NO `ParsedCalculation.shape` is
 * widened; NO parser is taught a new shape. The wrapped idioms are emitted
 * as fixed canonical strings and stored verbatim — the parent calc Tier-0
 * §3.1 self-check guarantees byte-stability on no-op open/save (either the
 * wrapped form survives as `decision_table`/`single` byte-identical, or it
 * demotes to `raw` and the bytes are preserved unchanged).
 *
 * Re-hydration is therefore a UI-level concern: the picker calls
 * {@link recognizeReference} on `props.value` to pre-select the right kind
 * and wrapper, independent of whatever `parseCalculation` decided about
 * the same string. This module IS that recognizer.
 */

/** The reference idioms the picker offers. `null` means "not a reference
 *  this module recognizes" — the caller falls through to the existing
 *  literal/number/expression kinds. */
export type ReferenceKind = 'contact-input' | 'contact-summary' | 'field-ref';

/** The two stock wrappers on a contact-summary context read. `none` is the
 *  bare reference (no wrapper). */
export type ContextWrapper = 'none' | 'fallback-to-current' | 'read-once';

/**
 * Result of recognizing a reference idiom. `argument` is the inner
 * payload: the bare field name (contact-input / field-ref) or the
 * context key (contact-summary), without any quoting or prefix.
 */
export interface RecognizedReference {
  kind: ReferenceKind;
  argument: string;
  /** Only meaningful when `kind === 'contact-summary'`. */
  wrapper: ContextWrapper;
}

/** `../inputs/contact/<field>` — capture the bare field segment. The field
 *  segment is conservative: `\w+` (no slashes), since the nssd fixture and
 *  the standard CHT pattern never carry nested paths. A nested path falls
 *  through to the expression kind and survives via raw byte-identity. */
const CONTACT_INPUT_RE = /^\.\.\/inputs\/contact\/([\w-]+)$/;

/** Bare `instance('contact-summary')/context/<key>`. The key segment is
 *  `\w+` for the same conservative reason as above. Single quotes around
 *  `contact-summary` only; the nssd cells (and the CHT convention) use
 *  single quotes, never doubles. */
const CONTACT_SUMMARY_BARE_RE =
  /^instance\('contact-summary'\)\/context\/([\w-]+)$/;

/** `once(instance('contact-summary')/context/<key>)`. The `once()` wrapper
 *  is the canonical CHT read-once idiom. Internal whitespace inside the
 *  parens is tolerated (punch-list §H1) — `once( ref )`, `once(\n ref \n)`
 *  etc. all re-hydrate the same. The bare reference itself is canonical
 *  (no spaces around `instance` or the slashes). */
const CONTACT_SUMMARY_ONCE_RE =
  /^once\(\s*instance\('contact-summary'\)\/context\/([\w-]+)\s*\)$/;

/**
 * `if(<ref>, <ref>, .)` with MATCHING refs. The wrapper's whole purpose is
 * "use the ctx value if present, else fall back to the current answer", so
 * the condition and the value MUST be the same expression — otherwise the
 * semantics are different (see nssd's `avg_result_ctx` cell, where the
 * condition checks `avg_result` but the value reads `avg_result_ctx` —
 * intentionally different, not a wrapper). Non-matching variants fall
 * through to the expression kind and survive via raw byte-identity.
 *
 * Spacing tolerated: optional whitespace around commas, around the dot,
 * and between `if(` and the first ref. Matches the spelling the parent
 * `serializeCalculation` would canonicalize an if-chain to.
 */
const CONTACT_SUMMARY_FALLBACK_RE =
  /^if\(\s*(instance\('contact-summary'\)\/context\/[\w-]+)\s*,\s*(instance\('contact-summary'\)\/context\/[\w-]+)\s*,\s*\.\s*\)$/;

/** Bare `${field}` reference. Matches the existing `field-ref` kind in
 *  CalculationBuilder.tsx; included here so the recognizer is complete. */
const FIELD_REF_RE = /^\$\{([^}]+)\}$/;

/** Strip the `instance('contact-summary')/context/` prefix and return the
 *  bare context key, or `null` if `s` isn't a bare ctx ref. */
function extractContextKey(s: string): string | null {
  const m = s.trim().match(CONTACT_SUMMARY_BARE_RE);
  return m ? m[1]! : null;
}

/**
 * Try to recognize a reference idiom in `raw`. Returns `null` when `raw`
 * doesn't match any of the four idioms (caller routes to literal / number
 * / expression). Trims surrounding whitespace before matching; never
 * mutates `raw`.
 */
export function recognizeReference(raw: string): RecognizedReference | null {
  const v = raw.trim();
  if (v === '') return null;

  // 1. Contact input field.
  const ci = v.match(CONTACT_INPUT_RE);
  if (ci) return { kind: 'contact-input', argument: ci[1]!, wrapper: 'none' };

  // 2a. Contact-summary read-once.
  const csOnce = v.match(CONTACT_SUMMARY_ONCE_RE);
  if (csOnce)
    return { kind: 'contact-summary', argument: csOnce[1]!, wrapper: 'read-once' };

  // 2b. Contact-summary fallback-to-current — only when the two refs match.
  const csFallback = v.match(CONTACT_SUMMARY_FALLBACK_RE);
  if (csFallback) {
    const refA = csFallback[1]!;
    const refB = csFallback[2]!;
    if (refA === refB) {
      const key = extractContextKey(refA);
      if (key !== null) {
        return { kind: 'contact-summary', argument: key, wrapper: 'fallback-to-current' };
      }
    }
    // Different refs — intentional non-wrapper semantics (e.g. nssd's
    // `avg_result_ctx`). Fall through to expression kind.
  }

  // 2c. Contact-summary bare reference.
  const csBare = v.match(CONTACT_SUMMARY_BARE_RE);
  if (csBare)
    return { kind: 'contact-summary', argument: csBare[1]!, wrapper: 'none' };

  // 3. Bare `${field}` reference — the existing field-ref kind.
  const fr = v.match(FIELD_REF_RE);
  if (fr) return { kind: 'field-ref', argument: fr[1]!, wrapper: 'none' };

  return null;
}

/* ============================== emitters ================================ */

/** Build a contact-input reference: `../inputs/contact/<field>`. */
export function emitContactInput(field: string): string {
  return `../inputs/contact/${field}`;
}

/** Build a contact-summary reference, optionally wrapped. Returns the
 *  bare reference for `wrapper === 'none'`. */
export function emitContactSummary(key: string, wrapper: ContextWrapper): string {
  const bare = `instance('contact-summary')/context/${key}`;
  switch (wrapper) {
    case 'none':
      return bare;
    case 'fallback-to-current':
      return `if(${bare}, ${bare}, .)`;
    case 'read-once':
      return `once(${bare})`;
  }
}

/** Build a same-form field reference: `${field}`. */
export function emitFieldRef(field: string): string {
  return `\${${field}}`;
}
