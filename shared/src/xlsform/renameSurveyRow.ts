/**
 * Atomic survey-row rename: change `row.name` AND rewrite every
 * `${oldName}` reference across the form's expression columns (and
 * label outputs) so refs stay correct in lockstep with the rename.
 *
 * Used by the NameInput "Fix → slug" button (and any name-edit blur)
 * in the FormEditor. Without this, renaming a row silently dangles
 * every `${oldName}` reference in other rows' `relevant` /
 * `calculation` / `constraint` / `choice_filter` / `default` /
 * `repeat_count` / `${output}`-in-labels.
 *
 * Mirrors the choices-tab list rename shipped in `a361624` — same
 * regex-anchored, whitespace-tolerant `${...}` rewrite, applied to
 * every column that can carry a reference.
 *
 * Pure: returns a new XLSForm; the input is not mutated. Empty
 * `fromName` or `fromName === toName` is a no-op. The reference
 * matcher is anchored to `${<name>}` with optional inner whitespace
 * — so `${old}` rewrites cleanly but `${old_extra}` is untouched
 * (different identifier).
 */
import type { XLSForm, SurveyRow } from './types.js';

/** Columns that carry `${...}` references and need rewriting. */
const REF_COLUMNS = [
  'relevant',
  'calculation',
  'constraint',
  'choice_filter',
  'default',
  'repeat_count',
] as const;

function rewriteRef(text: string | undefined, escaped: string, toName: string): string | undefined {
  if (!text) return text;
  // Match `${<name>}` with optional whitespace inside the braces.
  // Anchored on the literal name — substring collisions (`old_extra`
  // when renaming `old`) don't match because we require the closing
  // `}` immediately after.
  return text.replace(
    new RegExp('\\$\\{\\s*' + escaped + '\\s*\\}', 'g'),
    `\${${toName}}`,
  );
}

function rewriteRow(row: SurveyRow, escaped: string, toName: string): SurveyRow {
  let nextExtras = row.extras;
  let extrasTouched = false;
  for (const col of REF_COLUMNS) {
    const before = row.extras[col];
    if (before === undefined) continue;
    const after = rewriteRef(before, escaped, toName);
    if (after !== before) {
      if (!extrasTouched) {
        nextExtras = { ...row.extras };
        extrasTouched = true;
      }
      // narrowing — after is defined when before was defined and not equal
      nextExtras[col] = after as string;
    }
  }

  let nextLabels = row.labels;
  let labelsTouched = false;
  for (const [locale, labelText] of Object.entries(row.labels)) {
    const after = rewriteRef(labelText, escaped, toName);
    if (after !== labelText) {
      if (!labelsTouched) {
        nextLabels = { ...row.labels };
        labelsTouched = true;
      }
      nextLabels[locale] = after as string;
    }
  }

  if (!extrasTouched && !labelsTouched) return row;
  return { ...row, extras: nextExtras, labels: nextLabels };
}

/**
 * Rename `fromName` to `toName` across the form: the row whose name is
 * `fromName` gets renamed, AND every `${fromName}` reference in any
 * row's `relevant` / `calculation` / `constraint` / `choice_filter` /
 * `default` / `repeat_count` / label cells is rewritten to
 * `${toName}`.
 *
 * Returns a new XLSForm. The original is not mutated. A no-op rename
 * (empty `fromName`, identical names, or no matching row) returns the
 * same instance — callers can fast-path on `result === form`.
 */
export function renameSurveyRow(
  form: XLSForm,
  fromName: string,
  toName: string,
): XLSForm {
  if (!fromName || !toName || fromName === toName) return form;
  // Escape regex metacharacters in the source name (XLSForm `name`
  // cells SHOULDN'T contain them, but the rename macro may be invoked
  // mid-fix on an invalid pre-fix name like "foo?" — be safe).
  const escaped = fromName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let anyTouched = false;
  const nextSurvey: SurveyRow[] = form.survey.map((row) => {
    let touched = false;
    let next: SurveyRow = row;
    // Step 1: if this is the row being renamed, swap its name.
    if (row.name === fromName) {
      next = { ...next, name: toName };
      touched = true;
    }
    // Step 2: rewrite every ref-bearing column / label on this row.
    const refRewritten = rewriteRow(next, escaped, toName);
    if (refRewritten !== next) {
      next = refRewritten;
      touched = true;
    }
    if (touched) anyTouched = true;
    return next;
  });

  if (!anyTouched) return form;
  return { ...form, survey: nextSurvey };
}
