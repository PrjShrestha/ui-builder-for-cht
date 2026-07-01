/**
 * Atomic choice-value rename: change one `ChoiceRow.name` in a given
 * `list_name` AND rewrite every string-literal reference to that value
 * across the form's expression columns and choice `choice_filter`
 * cells — but ONLY within expressions that also reference that list
 * via `${rowName}`. Same shape as `renameSurveyRow`, applied one level
 * down (choice values instead of row names).
 *
 * ## The problem this solves
 * CHT XLSForm expressions reference choice values as string literals,
 * e.g. `selected(${danger_signs}, 'feet_swollen')`. When a user renames
 * a choice from `feet swollen` → `feet_swollen` via the ChoiceNameInput
 * auto-slugify, every such literal in `relevant` / `calculation` /
 * `constraint` / `choice_filter` / `default` must be rewritten in
 * lockstep, or the expression silently stops matching the choice.
 *
 * ## Why scoped rewrite (not global find/replace)
 * Naive `s/'oldName'/'newName'/g` across every expression would rewrite
 * ANY quoted literal that happens to match — including unrelated string
 * comparisons on OTHER lists whose choices happen to share a value. We
 * limit rewrite to expressions that contain `${x}` for some `x` bound
 * to the target list (i.e. some survey row whose `type` is
 * `select_(one|multiple) <list>` (`or_other`-suffix included)). That's
 * the safe intersection: literals inside those expressions almost
 * always mean "a value of that list".
 *
 * ## What gets rewritten
 *  - `ChoiceRow.name` on the target row (list + old name).
 *  - `ChoiceRow.choice_filter` on ANY choice in the same list (choice_filter
 *    can reference the choice's own list via ${itself}).
 *  - For each survey row referencing the list via `${x}`:
 *      `relevant`, `calculation`, `constraint`, `choice_filter`, `default`,
 *      `repeat_count`, labels (any locale).
 *
 * ## Not rewritten (documented limits)
 *  - Space-separated defaults on `select_multiple` (`default: yes maybe`).
 *    Would need per-token rewrite with awareness of which cells are
 *    multi-value; the risk of over-eager rewrite outweighs the benefit
 *    for the tiny fraction of forms that use this.
 *  - Free-form comments / hint columns (no reference semantics).
 *
 * ## Round-trip safety
 * Pure: returns a new XLSForm; the input is not mutated. A no-op (same
 * name, or no matching choice) returns the same instance for fast-path
 * comparison. Cells with no rewrite work are left byte-identical.
 */
import type { XLSForm, SurveyRow, ChoiceRow } from './types.js';

/** Columns that carry expressions and MAY reference choice values as string literals. */
const REF_COLUMNS = [
  'relevant',
  'calculation',
  'constraint',
  'choice_filter',
  'default',
  'repeat_count',
] as const;

/**
 * Extract the `list_name` from a survey `type` cell like
 *   `select_one danger_signs`
 *   `select_multiple danger_signs or_other`
 * Returns the list name if the type is a select_*, else undefined.
 */
function typeListName(type: string): string | undefined {
  const m = /^\s*(select_one|select_multiple)\s+([^\s]+)/.exec(type);
  return m?.[2];
}

/**
 * Rewrite every `'oldName'` and `"oldName"` string literal in `text` to
 * the corresponding new-name literal, preserving the original quote
 * style. Anchored on the exact literal contents — no substring drift
 * (`'oldName_extra'` is untouched because the closing quote is present).
 */
function rewriteQuotedLiteral(
  text: string | undefined,
  oldName: string,
  newName: string,
): string | undefined {
  if (!text) return text;
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`'${escaped}'`, 'g'), `'${newName}'`)
    .replace(new RegExp(`"${escaped}"`, 'g'), `"${newName}"`);
}

/**
 * Does the expression reference any of these row names via `${x}`? We
 * check with `${` + whitespace + name + whitespace + `}` — same shape as
 * renameSurveyRow's matcher. If ANY of the target-list-bound rows shows
 * up, we treat literals in this expression as candidates for rewrite.
 */
function expressionReferencesAny(
  expr: string | undefined,
  boundRowNames: readonly string[],
): boolean {
  if (!expr || boundRowNames.length === 0) return false;
  for (const name of boundRowNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\$\\{\\s*${escaped}\\s*\\}`).test(expr)) return true;
  }
  return false;
}

/**
 * Rename choice value `oldName` → `newName` inside `list_name`, and
 * rewrite every string-literal reference in expressions that reference
 * that list via `${x}`.
 *
 * Returns a new XLSForm. The original is not mutated. No-op cases (empty
 * names, identical names, or no choice matches) return the same instance.
 */
export function renameChoiceValue(
  form: XLSForm,
  list: string,
  oldName: string,
  newName: string,
): XLSForm {
  if (!list || !oldName || !newName || oldName === newName) return form;

  // Find the choice row that matches. If nothing matches, no-op.
  const targetIdx = form.choices.findIndex(
    (c) => c.list_name === list && c.name === oldName,
  );
  if (targetIdx < 0) return form;

  // Rows bound to this list via `select_one <list>` / `select_multiple <list>`
  // (with optional `or_other` suffix). Their `name` values are the anchors
  // that make a string literal in an expression a valid rewrite candidate.
  const boundRowNames = form.survey
    .filter((r) => typeListName(r.type) === list)
    .map((r) => r.name)
    .filter((n): n is string => Boolean(n));

  // Rewrite the target choice's own `name`.
  const nextChoices: ChoiceRow[] = form.choices.map((c, i) => {
    if (i === targetIdx) return { ...c, name: newName };
    // For OTHER choices in the SAME list: their `choice_filter` (in
    // extras) can reference sibling values as literals. Rewrite there
    // too, since they implicitly work with this list.
    if (c.list_name === list) {
      const cf = c.extras?.['choice_filter'];
      const rewritten = rewriteQuotedLiteral(cf, oldName, newName);
      if (rewritten !== cf) {
        return { ...c, extras: { ...(c.extras ?? {}), choice_filter: rewritten as string } };
      }
    }
    return c;
  });

  // Rewrite every survey row's expression columns and labels — but only
  // for expressions that reference the target list via `${x}`.
  let surveyTouched = false;
  const nextSurvey: SurveyRow[] = form.survey.map((row) => {
    let nextExtras = row.extras;
    let extrasTouched = false;
    for (const col of REF_COLUMNS) {
      const before = row.extras[col];
      if (before === undefined) continue;
      if (!expressionReferencesAny(before, boundRowNames)) continue;
      const after = rewriteQuotedLiteral(before, oldName, newName);
      if (after !== before) {
        if (!extrasTouched) {
          nextExtras = { ...row.extras };
          extrasTouched = true;
        }
        nextExtras[col] = after as string;
      }
    }

    // Labels can carry `${x}` outputs but choice values in labels are
    // unusual; we still scan them for consistency.
    let nextLabels = row.labels;
    let labelsTouched = false;
    for (const [locale, labelText] of Object.entries(row.labels)) {
      if (!expressionReferencesAny(labelText, boundRowNames)) continue;
      const after = rewriteQuotedLiteral(labelText, oldName, newName);
      if (after !== labelText) {
        if (!labelsTouched) {
          nextLabels = { ...row.labels };
          labelsTouched = true;
        }
        nextLabels[locale] = after as string;
      }
    }

    if (!extrasTouched && !labelsTouched) return row;
    surveyTouched = true;
    return { ...row, extras: nextExtras, labels: nextLabels };
  });

  const anyTouched = surveyTouched || nextChoices !== form.choices;
  if (!anyTouched) return form;
  return { ...form, survey: nextSurvey, choices: nextChoices };
}
