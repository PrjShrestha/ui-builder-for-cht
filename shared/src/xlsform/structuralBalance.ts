/**
 * Structural balance validator for an XLSForm survey.
 *
 * Sibling to `validateOrdering` (dependencies.ts) — that one catches
 * data-dependency violations; this one catches the *other* class of
 * survey-level bugs: a `begin group` / `begin repeat` without a matching
 * `end`, an `end` without a `begin`, or a `begin` of one kind closed by
 * an `end` of the other (`begin group` ⇢ `end repeat`).
 *
 * Plan: docs/plans/survey-groups-and-scaffold.md §A4 — the balance
 * invariant that makes group authoring safe. Read-only; pure; never
 * mutates the survey. Plays the same role the dependency validator plays:
 * surface violations the UI can render, and `findStructuralViolations` is
 * the hook the save-time guard (§A6) calls before letting a serialize
 * proceed.
 *
 * Why a dedicated module: the parser already preserves arbitrary
 * structural bytes losslessly (see `buildDisplayItems` depth-walk).
 * Authoring operations — picker insert, drag-reorder, wrap/unwrap —
 * can still produce a survey whose structural rows don't match up. This
 * module is what makes those operations safe.
 */
import { type SurveyRow } from './types.js';

/** What kind of structural marker a row is, or `null` for everything else. */
export type StructuralMarker = 'begin-group' | 'end-group' | 'begin-repeat' | 'end-repeat';

/** A balance violation pinned to the row that caused it. The row is identified
 *  by its `rowId` so a UI consumer can highlight it; `kind` discriminates the
 *  failure mode so the consumer can render different messages. */
export interface StructuralViolation {
  rowId: string;
  /** Row index in the survey (helpful for "row 17" diagnostics). */
  index: number;
  /** Structural marker on the offending row (or `null` if a `begin` without
   *  a matching `end` — the violation is reported on the `begin` row). */
  marker: StructuralMarker | null;
  kind:
    | 'unmatched-begin'  // `begin group`/`begin repeat` with no matching `end`
    | 'unmatched-end'    // `end group`/`end repeat` with no matching `begin`
    | 'mismatched-end'   // `begin group` closed by `end repeat` (or vice versa)
    | 'mismatched-name'; // `begin group A` closed by `end group B` (§H2 hardening)
  message: string;
}

/**
 * Classify a `SurveyRow.type` cell as a structural marker, or return `null`
 * if it's a normal question row. The check is on the bare type token (no
 * list-name suffix for selects), case-insensitive.
 */
export function structuralMarker(row: SurveyRow): StructuralMarker | null {
  const t = row.type.trim().toLowerCase();
  if (t === 'begin group') return 'begin-group';
  if (t === 'end group') return 'end-group';
  if (t === 'begin repeat') return 'begin-repeat';
  if (t === 'end repeat') return 'end-repeat';
  return null;
}

/** Compute every structural violation in the survey. Empty array = the
 *  survey is balanced. Order: violations are appended in survey order, so
 *  the first violation rendered is the first structurally-suspect row. */
export function findStructuralViolations(survey: SurveyRow[]): StructuralViolation[] {
  const violations: StructuralViolation[] = [];

  // A LIFO stack of open `begin` rows. Each entry remembers both the
  // marker kind (so we can detect group↔repeat crossing) and the survey
  // index (so an unmatched-begin can be reported at the right row).
  const open: Array<{ marker: 'begin-group' | 'begin-repeat'; rowId: string; index: number; name: string }> = [];

  for (let i = 0; i < survey.length; i++) {
    const row = survey[i]!;
    const marker = structuralMarker(row);
    if (!marker) continue;

    if (marker === 'begin-group' || marker === 'begin-repeat') {
      open.push({ marker, rowId: row.rowId, index: i, name: row.name });
      continue;
    }

    // end-group / end-repeat — must match the most recent open `begin`.
    const last = open.pop();
    if (!last) {
      violations.push({
        rowId: row.rowId,
        index: i,
        marker,
        kind: 'unmatched-end',
        message: `${row.type.trim()} at row ${i + 1} has no matching begin.`,
      });
      continue;
    }
    const expectedEnd = last.marker === 'begin-group' ? 'end-group' : 'end-repeat';
    if (marker !== expectedEnd) {
      violations.push({
        rowId: row.rowId,
        index: i,
        marker,
        kind: 'mismatched-end',
        message:
          `${row.type.trim()} at row ${i + 1} closes a ` +
          `${last.marker === 'begin-group' ? 'begin group' : 'begin repeat'}` +
          ` (row ${last.index + 1}${last.name ? ` "${last.name}"` : ''}).`,
      });
      // The `begin` is "consumed" by the mismatched `end` — don't double-count
      // it as unmatched. This mirrors how a real parser recovers.
      continue;
    }
    // §H2 — name agreement. pyxform pairs by NAME, not just kind, so a
    // sequence like `[begin group A][begin group B][end group A][end group B]`
    // is structurally balanced by kind but rejected by pyxform on deploy.
    // Today's mutation set (group-as-unit drag, ungroup) keeps names
    // aligned by construction, but any future "insert raw row," paste, or
    // import-merge path could slip past A6. Enforce name agreement here
    // as cheap hardening. Empty `end` names are tolerated (some templates
    // omit the name on `end` rows; both forms round-trip).
    if (row.name && last.name && row.name !== last.name) {
      violations.push({
        rowId: row.rowId,
        index: i,
        marker,
        kind: 'mismatched-name',
        message:
          `${row.type.trim()} "${row.name}" at row ${i + 1} closes a ` +
          `${last.marker === 'begin-group' ? 'begin group' : 'begin repeat'}` +
          ` named "${last.name}" (row ${last.index + 1}).`,
      });
    }
  }

  // Any `begin` rows still on the stack are unmatched.
  for (const o of open) {
    const row = survey[o.index]!;
    violations.push({
      rowId: o.rowId,
      index: o.index,
      marker: o.marker,
      kind: 'unmatched-begin',
      message:
        `${row.type.trim()} at row ${o.index + 1}` +
        `${o.name ? ` "${o.name}"` : ''} has no matching end.`,
    });
  }

  return violations;
}

/** Sugar: `true` iff the survey passes the balance contract. */
export function isStructurallyBalanced(survey: SurveyRow[]): boolean {
  return findStructuralViolations(survey).length === 0;
}
