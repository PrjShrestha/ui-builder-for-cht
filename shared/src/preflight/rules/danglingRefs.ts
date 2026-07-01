/**
 * Rule: every `${x}` reference in an XLSForm resolves to a known field.
 *
 * Scans `relevant`, `calculation`, `constraint`, and `label::*` cells
 * (plus the other common referencing columns) for `${…}` tokens. A ref
 * is valid if any of:
 *   - the inner content matches a survey row `name` in the same form
 *   - it is (or ends in) a known input path — `../inputs/*` or
 *     `../inputs/contact/*` — which the runtime injects at evaluation
 *   - the inner content is empty (that's the "empty braces" defect and
 *     is emitted as a separate result)
 *
 * Ordering violations (ref exists but comes later in the survey) are
 * intentionally *not* flagged here — the FormEditor's `validateOrdering`
 * already surfaces those with a richer UI. Deferring to it avoids
 * double-reporting the same defect class.
 */
import { isStructural, type SurveyRow } from '../../xlsform/types.js';
import type { PreflightCheck, PreflightContext, PreflightResult } from '../types.js';

export const DANGLING_REFS_CHECK: PreflightCheck = {
  id: 'dangling-refs',
  label: 'Dangling references',
};

/** Columns scanned for `${…}` references. */
const REF_COLUMNS = [
  'relevant',
  'calculation',
  'constraint',
  'choice_filter',
  'repeat_count',
  'default',
] as const;

/** Capture the raw inner content of a `${...}` token, including path syntax. */
const REF_RE = /\$\{([^}]*)\}/g;

/**
 * Recognized input-path prefixes. CHT injects `../inputs/*` (and its
 * `../inputs/contact/*` variant) at form-eval time; refs into that
 * subtree resolve at runtime even though nothing in the survey sheet
 * declares them.
 */
const INPUT_PATH_PREFIXES = ['../inputs/', '../../inputs/', '../../../inputs/'];

function isInputPathRef(inner: string): boolean {
  const trimmed = inner.trim();
  if (!trimmed) return false;
  for (const prefix of INPUT_PATH_PREFIXES) {
    if (trimmed.startsWith(prefix)) return true;
  }
  return false;
}

function buildNameSet(survey: SurveyRow[]): Set<string> {
  const names = new Set<string>();
  for (const row of survey) {
    if (isStructural(row)) continue;
    if (row.name) names.add(row.name);
  }
  return names;
}

/** Iterate every ref-bearing cell of a row and yield {column, expr}. */
function* refBearingCells(row: SurveyRow): Iterable<{ column: string; expr: string }> {
  for (const col of REF_COLUMNS) {
    const v = row.extras[col];
    if (v) yield { column: col, expr: v };
  }
  // label::<locale> and hint::<locale> can carry ${output} refs. Iterate
  // the parsed label map and every extras key that starts with `hint::`.
  for (const locale of Object.keys(row.labels)) {
    const v = row.labels[locale];
    if (v) yield { column: `label::${locale}`, expr: v };
  }
  for (const key of Object.keys(row.extras)) {
    if (!key.startsWith('hint::')) continue;
    const v = row.extras[key];
    if (v) yield { column: key, expr: v };
  }
}

export function runDanglingRefsRule(ctx: PreflightContext): PreflightResult[] {
  const results: PreflightResult[] = [];
  for (const { formId, xlsform } of ctx.forms) {
    const names = buildNameSet(xlsform.survey);
    for (const row of xlsform.survey) {
      if (isStructural(row)) continue;
      for (const { column, expr } of refBearingCells(row)) {
        // Reset regex state per expression (global flag carries index).
        const re = new RegExp(REF_RE.source, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(expr)) !== null) {
          const inner = m[1] ?? '';
          const trimmed = inner.trim();
          if (!trimmed) {
            // `${}` or `${ }` — empty braces are their own defect.
            results.push({
              ruleId: 'dangling-refs',
              severity: 'error',
              message: `Empty ${'${}'} reference in ${column}`,
              affectedItemId: formId,
              rowId: row.rowId,
              column,
            });
            continue;
          }
          if (isInputPathRef(trimmed)) continue;
          // Path-shaped refs like `${/data/group/age}` → last segment.
          const lastSegment = trimmed.split('/').filter((s) => s.length > 0).pop() ?? '';
          if (names.has(trimmed) || names.has(lastSegment)) continue;
          results.push({
            ruleId: 'dangling-refs',
            severity: 'error',
            message: `Unknown reference "${'${'}${trimmed}}" in ${column}`,
            affectedItemId: formId,
            rowId: row.rowId,
            column,
          });
        }
      }
    }
  }
  return results;
}
