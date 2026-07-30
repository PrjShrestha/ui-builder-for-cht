/**
 * Wave 2 · §5b helper — auto-create the hidden harvest `calculate` row for a
 * contact-form field the user just picked from a label's "insert contact
 * field" affordance.
 *
 * The idiom this codifies is the canonical CHT harvest pattern:
 *
 *   calculate  patient_name       calculation = ../inputs/contact/name
 *
 * i.e. a hidden `calculate` row named `patient_<field>` (or the field name
 * itself if it already carries the `patient_` prefix) whose `calculation`
 * cell reads `../inputs/contact/<field>`. The row is placed at the top
 * level of the survey **immediately after the outermost `end group inputs`**
 * — the placement cht-conf's own `pregnancy.xlsx` scaffold uses. Placing
 * the calc INSIDE `inputs/contact` would break the `../inputs/contact/...`
 * xpath (the `..` step would exit past `inputs`, so the ref no longer
 * resolves), so we deliberately keep the row outside the `inputs` block.
 *
 * The design note (docs/handoff-waves-1-3-2026-07-29.md §5) uses the
 * phrase "inside the `inputs/contact` group" as shorthand for "in the
 * inputs plumbing area"; the deployable xpath semantics force placement
 * as an `inputs` sibling.
 *
 * Contract:
 *   - **Deduped by calculation cell.** If any existing `calculate` row
 *     already carries `../inputs/contact/<field>`, we reuse its `name` and
 *     do NOT insert a duplicate row. Re-picking the same contact field is
 *     therefore a no-op that returns the SAME form instance (referential
 *     equality) — callers can fast-path on `result.form === form`.
 *   - **Name-collision-safe.** If the derived name (`patient_<field>`) is
 *     already used by a DIFFERENT row (a pre-existing row named
 *     `patient_name` that harvests something else, or a user-authored
 *     question with the same name), we suffix `_2`, `_3`, … until a free
 *     name is found. The label token spliced into the label always uses
 *     the freshly-picked harvest name so the ref stays in lockstep.
 *   - **Pure.** The input form is not mutated. All array/object writes go
 *     into fresh copies.
 *
 * This helper does NOT touch label text — the caller is responsible for
 * splicing `${harvestName}` at the caret in the label the user is editing.
 * Keeping the two operations in a single caller-side `patch()` gives
 * atomic undo for "user clicked insert contact field" (both the calc row
 * and the label mutation land or roll back together).
 */
import type { SurveyRow, XLSForm } from './types.js';

/** Result of {@link insertContactFieldRef}. */
export interface InsertContactFieldRefResult {
  /** The updated form. Referentially equal to the input when the calc row
   *  already existed (dedupe short-circuit) — callers may fast-path on
   *  identity. */
  form: XLSForm;
  /** The name of the harvest calc row — either the freshly-created one or
   *  the pre-existing dedup target. This is the `name` the caller should
   *  splice into the label as `${<harvestName>}`. Empty string if the
   *  input `contactField` was blank / whitespace-only. */
  harvestName: string;
  /** `true` iff a new calc row was inserted; `false` if the dedupe path
   *  reused an existing row. Useful for toasts / analytics. */
  wasCreated: boolean;
  /** `true` iff the derived default name (`patient_<field>`) collided with
   *  a pre-existing row that was NOT a dedupe target, and the helper had
   *  to fall back to a numeric suffix. The caller can surface this as a
   *  soft warning ("saved as `patient_name_2`"). */
  hadNameCollision: boolean;
}

/**
 * Derive the harvest calc row's `name` from the contact-form field name.
 *
 * The convention (grounded on `pregnancy.xlsx` and the diabetes-referral
 * fixture) is `patient_<field>`, with two micro-adjustments:
 *   - If the field already starts with `patient_`, use it verbatim
 *     (`patient_id` → `patient_id`, not `patient_patient_id`).
 *   - Strip leading underscores from otherwise-bare fields so `_id`
 *     doesn't become the ugly `patient__id`. Note this collapses `_id`
 *     onto `patient_id`; the caller's collision-guard suffixes if the
 *     underscored variant is already used elsewhere.
 */
export function deriveHarvestName(contactField: string): string {
  const f = contactField.trim();
  if (!f) return '';
  if (/^patient_/.test(f)) return f;
  const cleaned = f.replace(/^_+/, '');
  return `patient_${cleaned}`;
}

/**
 * Locate the survey index directly after the outermost `end group inputs`.
 * Returns `-1` if the survey has no top-level `inputs` block — in which
 * case the caller falls back to appending at the end of the survey.
 *
 * Only the outermost `inputs` group counts. A nested `inputs` inside some
 * other group is not the CHT plumbing block and would break the pattern.
 */
function findInsertAfterInputsEnd(survey: SurveyRow[]): number {
  const stack: string[] = [];
  for (let i = 0; i < survey.length; i++) {
    const r = survey[i]!;
    const t = r.type.trim().toLowerCase();
    if (t === 'begin group' || t === 'begin repeat') {
      stack.push(r.name);
      continue;
    }
    if (t === 'end group' || t === 'end repeat') {
      const closed = stack.pop();
      // Top-level `inputs` closing → insertion point is right after it.
      if (closed === 'inputs' && stack.length === 0) {
        return i + 1;
      }
    }
  }
  return -1;
}

/**
 * Ensure the harvest `calculate` row for `contactField` exists in `form`
 * and return the name to splice into the caller's label.
 *
 * See module doc for the full contract.
 */
export function insertContactFieldRef(
  form: XLSForm,
  contactField: string,
): InsertContactFieldRefResult {
  const field = contactField.trim();
  if (!field) {
    return { form, harvestName: '', wasCreated: false, hadNameCollision: false };
  }

  const targetCalc = `../inputs/contact/${field}`;

  // Dedup by calc cell: if any existing calculate row carries this exact
  // reference, reuse it — no new row and no name change.
  for (const r of form.survey) {
    if (r.type.trim().toLowerCase() !== 'calculate') continue;
    const c = (r.extras['calculation'] ?? '').trim();
    if (c === targetCalc) {
      return { form, harvestName: r.name, wasCreated: false, hadNameCollision: false };
    }
  }

  // Choose a name. Prefer `patient_<field>`; suffix if that's already
  // used by a row that is NOT our dedupe target (we already ruled that
  // out above).
  const defaultName = deriveHarvestName(field);
  const usedNames = new Set<string>();
  for (const r of form.survey) {
    if (r.name) usedNames.add(r.name);
  }
  let harvestName = defaultName;
  let hadNameCollision = false;
  if (usedNames.has(defaultName)) {
    hadNameCollision = true;
    // Numeric-suffix loop mirrors deriveFormName's collision resolution.
    // Bounded to keep static analysis happy — hitting 99 collisions on a
    // single field name is not a realistic scenario.
    let picked = false;
    for (let i = 2; i < 100; i++) {
      const candidate = `${defaultName}_${i}`;
      if (!usedNames.has(candidate)) {
        harvestName = candidate;
        picked = true;
        break;
      }
    }
    if (!picked) {
      // Extreme fallback — nothing was free within the bounded loop.
      // Use a timestamp-tagged name so the insert still succeeds; the
      // caller's label splice keeps the ref in lockstep.
      harvestName = `${defaultName}_${Date.now()}`;
    }
  }

  // Seed the label map with an empty string per active locale so the row
  // stays visible in the translator's grid (Wave 2 §4 pattern for new
  // rows). The harvest calc has no user-facing label, but an empty per-
  // locale cell keeps the missing-glyph logic uniform.
  const labels: Record<string, string> = {};
  for (const loc of form.surveyHeaders.labelLocales) {
    labels[loc] = '';
  }
  // If the form has no locales configured yet (edge — new blank form),
  // still emit an `en` slot so the label map is well-formed.
  if (Object.keys(labels).length === 0) labels['en'] = '';

  const newRow: SurveyRow = {
    // Deterministic-enough rowId; the parser regenerates rowIds anyway
    // (they aren't persisted to xlsx), so uniqueness within the session
    // is all that's needed.
    rowId: `harvest_${harvestName}_${form.survey.length + 1}`,
    type: 'calculate',
    name: harvestName,
    labels,
    extras: { calculation: targetCalc },
  };

  // Placement — right after the outermost `end group inputs`. If there's
  // no `inputs` block at all, append at the end (the caller's form is
  // unusual, but we still produce a syntactically valid survey).
  let insertAt = findInsertAfterInputsEnd(form.survey);
  if (insertAt < 0) insertAt = form.survey.length;

  const nextSurvey = [
    ...form.survey.slice(0, insertAt),
    newRow,
    ...form.survey.slice(insertAt),
  ];

  return {
    form: { ...form, survey: nextSurvey },
    harvestName,
    wasCreated: true,
    hadNameCollision,
  };
}
