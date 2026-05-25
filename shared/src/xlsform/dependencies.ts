/**
 * XLSForm dependency analyzer.
 *
 * Many XLSForm columns can reference other questions via the `${field}`
 * syntax (and the older `${ /data/path/to/field }` syntax). The most
 * common columns:
 *
 *  - relevant      → controls whether a question is shown
 *  - calculation   → computes a value from other answers
 *  - constraint    → validates a value against other answers
 *  - choice_filter → filters choices based on other answers
 *  - repeat_count  → dynamic repeat length
 *  - default       → default value expression
 *  - constraint_message::xx (rarely references fields, but supported)
 *
 * If a row B references a field defined by row A, then B *depends on* A
 * and B must come AFTER A in the survey sheet. Reordering that violates
 * this produces a form that either fails to evaluate or silently uses
 * undefined values.
 *
 * This module:
 *   1. Extracts field references from one row's expression columns.
 *   2. Builds a dependency map across the whole survey.
 *   3. Validates that the current row ordering satisfies all dependencies.
 *   4. Reports violations the UI can render as warnings.
 */
import { isStructural, type SurveyRow, type XLSForm } from './types.js';

/** XLSForm columns commonly containing `${field}` references. */
export const REFERENCING_COLUMNS = [
  'relevant',
  'calculation',
  'constraint',
  'choice_filter',
  'repeat_count',
  'default',
] as const;

/**
 * Matches both `${name}` and `${ /path/to/name }` (whitespace tolerated).
 * The capture group is the final segment (after the last `/`).
 */
const FIELD_REF_RE = /\$\{\s*([^}\s]*?)\s*\}/g;

/** Extract the set of field names referenced by a single expression string. */
export function extractReferences(expr: string | undefined): string[] {
  if (!expr) return [];
  const refs: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  // Use a fresh regex copy because the global flag carries state.
  const re = new RegExp(FIELD_REF_RE.source, 'g');
  while ((m = re.exec(expr)) !== null) {
    const raw = m[1] ?? '';
    if (!raw) continue;
    // Take the last path segment (e.g., /data/group/age → age).
    const name = raw.split('/').filter((s) => s.length > 0).pop();
    if (name && !seen.has(name)) {
      seen.add(name);
      refs.push(name);
    }
  }
  return refs;
}

/** All field names referenced from any of REFERENCING_COLUMNS on this row. */
export function rowReferences(row: SurveyRow): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const col of REFERENCING_COLUMNS) {
    const v = row.extras[col];
    if (!v) continue;
    for (const ref of extractReferences(v)) {
      if (!seen.has(ref)) {
        seen.add(ref);
        out.push(ref);
      }
    }
  }
  return out;
}

/** A single ordering violation detected by validateOrdering(). */
export interface OrderingViolation {
  /** rowId of the row that references something it shouldn't be able to see yet. */
  rowId: string;
  /** Index of this row in the survey array. */
  rowIndex: number;
  /** Field name being referenced. */
  reference: string;
  /** rowId of the row that defines `reference`. */
  definingRowId: string;
  /** Index of the defining row in the survey array. */
  definingRowIndex: number;
  /** Which expression column triggered the violation. */
  column: (typeof REFERENCING_COLUMNS)[number];
  /** The raw expression text containing the reference. */
  expression: string;
}

/** Map a row's `name` → its index + rowId. Ignores structural begin/end markers. */
function buildNameIndex(rows: SurveyRow[]): Map<string, { index: number; rowId: string }> {
  const map = new Map<string, { index: number; rowId: string }>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || isStructural(r)) continue;
    if (r.name && !map.has(r.name)) {
      map.set(r.name, { index: i, rowId: r.rowId });
    }
  }
  return map;
}

/**
 * Validate that every `${ref}` in every row's expression columns refers to
 * a field defined earlier in the survey. Returns the list of violations.
 *
 * "Earlier" is computed against the array's current order — so calling
 * this after a drag-and-drop reorder shows exactly the violations that
 * the reorder introduced.
 */
export function validateOrdering(form: XLSForm): OrderingViolation[] {
  const violations: OrderingViolation[] = [];
  const nameIndex = buildNameIndex(form.survey);

  for (let i = 0; i < form.survey.length; i++) {
    const row = form.survey[i];
    if (!row || isStructural(row)) continue;
    for (const col of REFERENCING_COLUMNS) {
      const expr = row.extras[col];
      if (!expr) continue;
      for (const ref of extractReferences(expr)) {
        // Skip self-references (some forms use ${self} or reference the row's own name).
        if (ref === row.name) continue;
        const target = nameIndex.get(ref);
        if (!target) continue; // unknown ref — could be an itext, instance, or external field
        if (target.index > i) {
          violations.push({
            rowId: row.rowId,
            rowIndex: i,
            reference: ref,
            definingRowId: target.rowId,
            definingRowIndex: target.index,
            column: col,
            expression: expr,
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Group violations by rowId so the UI can render a single banner per
 * affected row, regardless of how many columns or refs are broken.
 */
export function violationsByRowId(
  violations: OrderingViolation[],
): Map<string, OrderingViolation[]> {
  const m = new Map<string, OrderingViolation[]>();
  for (const v of violations) {
    const list = m.get(v.rowId);
    if (list) list.push(v);
    else m.set(v.rowId, [v]);
  }
  return m;
}

/**
 * Given a target row and a candidate insertion index, predict whether the
 * move would create an ordering violation. Returns the references that
 * would break, or [] if the move is safe. Lets the UI gate a drag-drop
 * BEFORE the user releases.
 */
export function predictViolationsForMove(
  form: XLSForm,
  rowId: string,
  newIndex: number,
): string[] {
  const row = form.survey.find((r) => r.rowId === rowId);
  if (!row || isStructural(row)) return [];

  const refs = rowReferences(row);
  if (refs.length === 0) return [];

  // Simulate the post-move order.
  const after = form.survey.filter((r) => r.rowId !== rowId);
  after.splice(newIndex, 0, row);

  const nameIndex = buildNameIndex(after);
  const myIndex = after.findIndex((r) => r.rowId === rowId);
  const broken: string[] = [];
  for (const ref of refs) {
    if (ref === row.name) continue;
    const target = nameIndex.get(ref);
    if (!target) continue;
    if (target.index > myIndex) broken.push(ref);
  }
  return broken;
}

/**
 * For each row, the list of fields it depends on (transitive closure not
 * applied — only direct refs). Useful for the flowchart visualizer in P1D.
 */
export function buildDependencyMap(form: XLSForm): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const row of form.survey) {
    if (isStructural(row)) continue;
    m.set(row.rowId, rowReferences(row));
  }
  return m;
}
