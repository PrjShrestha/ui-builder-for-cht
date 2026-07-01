/**
 * Rule: every `select_one X` / `select_multiple X` row references a
 * non-empty choices list.
 *
 * pyxform silently ships an empty select if the list has zero rows in
 * the choices sheet — the resulting form renders with no options and
 * the CHW cannot answer. Catching this at authoring time is cheap.
 *
 * The fix hint proposes adding a stub choice list; the client's
 * `addStubChoiceList` action does the actual append.
 */
import { SELECT_TYPE_RE, isStructural } from '../../xlsform/types.js';
import type { PreflightCheck, PreflightContext, PreflightResult } from '../types.js';

export const SELECT_CHOICES_CHECK: PreflightCheck = {
  id: 'select-choices',
  label: 'Select choices',
};

export function runSelectChoicesRule(ctx: PreflightContext): PreflightResult[] {
  const results: PreflightResult[] = [];
  for (const { formId, xlsform } of ctx.forms) {
    // Precompute list-name → row count for O(1) lookup per select row.
    const listSizes = new Map<string, number>();
    for (const c of xlsform.choices) {
      listSizes.set(c.list_name, (listSizes.get(c.list_name) ?? 0) + 1);
    }
    for (const row of xlsform.survey) {
      if (isStructural(row)) continue;
      const m = SELECT_TYPE_RE.exec(row.type);
      if (!m) continue;
      const listName = m[2];
      if (!listName) continue;
      const size = listSizes.get(listName) ?? 0;
      if (size > 0) continue;
      results.push({
        ruleId: 'select-choices',
        severity: 'error',
        message: `Select "${row.name}" references choice list "${listName}" which has no options`,
        affectedItemId: formId,
        rowId: row.rowId,
        column: 'type',
        fix: { kind: 'add-choice-list', formId, listName },
      });
    }
  }
  return results;
}
