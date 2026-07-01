/**
 * Rule: every XLSForm row `name` is a valid pyxform identifier.
 *
 * pyxform enforces `^[A-Za-z_][A-Za-z0-9_]*$` on survey row names.
 * Spaces, punctuation, or a leading digit hard-fail compile. The
 * fix hint carries the slugified proposal so the UI's rename-all-refs
 * macro (`renameSurveyRow`) can be invoked with one click — same
 * slugify the FormEditor's NameInput uses.
 */
import { isStructural } from '../../xlsform/types.js';
import { slugifyHierarchyId } from '../../hierarchy/buildLinearHierarchy.js';
import type { PreflightCheck, PreflightContext, PreflightResult } from '../types.js';

export const XLSFORM_IDENTIFIERS_CHECK: PreflightCheck = {
  id: 'xlsform-identifiers',
  label: 'XLSForm identifiers',
};

/** pyxform's identifier grammar. */
const VALID_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function runXlsformIdentifiersRule(ctx: PreflightContext): PreflightResult[] {
  const results: PreflightResult[] = [];
  for (const { formId, xlsform } of ctx.forms) {
    for (const row of xlsform.survey) {
      if (isStructural(row)) continue;
      // Skip blank name rows — those are already caught by structural checks
      // and slugifying "" yields "" which isn't a useful fix.
      if (!row.name) continue;
      if (VALID_NAME_RE.test(row.name)) continue;
      const slug = slugifyHierarchyId(row.name);
      const result: PreflightResult = {
        ruleId: 'xlsform-identifiers',
        severity: 'error',
        message: `Invalid identifier "${row.name}" — must match [A-Za-z_][A-Za-z0-9_]*`,
        affectedItemId: formId,
        rowId: row.rowId,
        column: 'name',
      };
      // Only offer the rename fix when the slug is itself a valid identifier —
      // if slugify returns '' (e.g. a purely-Devanagari name) the user needs
      // to type an ASCII name manually.
      if (slug && VALID_NAME_RE.test(slug)) {
        result.fix = {
          kind: 'rename-row',
          formId,
          rowId: row.rowId,
          from: row.name,
          to: slug,
        };
      }
      results.push(result);
    }
  }
  return results;
}
