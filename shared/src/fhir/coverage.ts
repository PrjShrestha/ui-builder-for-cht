/**
 * FHIR V1 — single source of truth for "what is a mappable question?"
 * (docs/plans/fhir-v1-workbench.md PR2 / §C2).
 *
 * The workbench's denominator MUST come from this helper and nothing
 * else. The plan was explicit:
 *
 *   > The honest denominator ("12 / 19 mapped") comes from a single
 *   > shared helper — add `shared/src/fhir/coverage.ts` with one
 *   > canonical "mappable question" definition + a test, so the count
 *   > never drifts.
 *
 * The Simple-mode visible-row filter (`computeSimpleHiddenRowIds`) is
 * the right oracle: it already classifies plumbing — structural rows,
 * `inputs/*` calculates, `hidden`, start/end/today — as not-user-facing.
 * The workbench shows the SAME ~clinically-meaningful subset the form
 * editor's Simple mode shows, so the count is honest ("12 of ~19"
 * instead of misleading "12 of all 47 raw rows including plumbing").
 *
 * This module is pure — no I/O, no React, just an exported function
 * that takes the survey and returns the mappable subset. Same shape
 * the V1 route uses to build live keys, the workbench uses to render
 * the columns table, and the contract tests use to pin coverage.
 */
import {
  computeSimpleHiddenRowIds,
  isStructural,
  type SurveyRow,
} from '../xlsform/types.js';

/**
 * Filter a survey down to the subset the workbench treats as mappable.
 * Mirrors the Simple-mode visible-row filter so the workbench's "12 of N"
 * denominator matches what users see in the editor.
 *
 * **Mappable** = the row is NOT in `computeSimpleHiddenRowIds(survey)`
 * AND has a non-empty `name` (a row needs an identifier to be mapped
 * to a code). Structural rows are always excluded.
 */
export function mappableQuestions(survey: SurveyRow[]): SurveyRow[] {
  const hiddenIds = computeSimpleHiddenRowIds(survey);
  return survey.filter((r) => {
    if (!r.name) return false;
    if (isStructural(r)) return false;
    if (hiddenIds.has(r.rowId)) return false;
    return true;
  });
}

/** Coverage counts for a form's mappable subset against a mapping. */
export interface FormCoverage {
  /** Total mappable rows in the form (the "of N" denominator). */
  total: number;
  /** Rows with `status: 'confirmed'`. */
  confirmed: number;
  /** Rows with `status: 'suggested'` (a starter-pack pre-fill awaiting Accept). */
  suggested: number;
  /** Rows the user explicitly Skipped. */
  skipped: number;
  /** Rows with no mapping at all yet. */
  unmapped: number;
}

/**
 * Compute coverage for ONE form. Takes the form's mappable subset (so
 * the caller can reuse `mappableQuestions` if it has the survey, or
 * compute its own) and the mapping object keyed by encoded question
 * key. The mapping argument is shaped as a lookup function so this
 * helper doesn't depend on the codec module — keeps the helper trivial
 * to unit-test.
 *
 * The lookup must be backed by codec-built keys (never string concat
 * of `formId + '/' + name`) — see MVP §3 item 6 for the false-orphan
 * data-loss hazard.
 */
export function formCoverage(
  mappableRows: SurveyRow[],
  lookup: (rowName: string) => { status?: string } | undefined,
): FormCoverage {
  let confirmed = 0;
  let suggested = 0;
  let skipped = 0;
  for (const row of mappableRows) {
    const m = lookup(row.name);
    if (!m) continue;
    if (m.status === 'confirmed') confirmed++;
    else if (m.status === 'suggested') suggested++;
    else if (m.status === 'skipped') skipped++;
  }
  const total = mappableRows.length;
  return {
    total,
    confirmed,
    suggested,
    skipped,
    unmapped: total - confirmed - suggested - skipped,
  };
}
