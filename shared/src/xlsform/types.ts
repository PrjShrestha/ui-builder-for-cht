/**
 * XLSForm domain types.
 *
 * Phase 0 only edits a small subset of XLSForm columns. Everything else is
 * preserved verbatim through the `extras` map on each row, so we never lose
 * CHT-specific columns like `appearance`, `instance::tag`, `db-object`, etc.
 */

/** A label cell, indexed by locale (the `xx` in `label::xx`). */
export type LocaleMap = Record<string, string>;

/**
 * A row in the `survey` sheet.
 *
 * Known fields are typed; everything else (including columns added by CHT
 * extensions or future XLSForm versions) lives in `extras`.
 */
export interface SurveyRow {
  /** Stable row identifier assigned by the parser. Not persisted to the xlsx. */
  rowId: string;
  type: string;
  name: string;
  /** label::xx columns, indexed by locale code. */
  labels: LocaleMap;
  /** required column (truthy string in xlsform: "yes" / "true" / a calculation). */
  required?: string;
  /**
   * Any columns the parser did not interpret. Keys are the original header
   * strings (e.g., "relevant", "appearance", "instance::tag", "calculation").
   * Saved back verbatim.
   */
  extras: Record<string, string>;
}

/** A row in the `choices` sheet. */
export interface ChoiceRow {
  rowId: string;
  list_name: string;
  name: string;
  labels: LocaleMap;
  /** Preserves other columns like filter-category, image, etc. */
  extras: Record<string, string>;
}

/** The single-row `settings` sheet. */
export interface FormSettings {
  form_title?: string;
  form_id?: string;
  version?: string;
  default_language?: string;
  /** Anything else (style, path, instance_name, sms_keyword, etc.). */
  extras: Record<string, string>;
}

/**
 * Any sheet we don't recognize is preserved as raw cell data so we can
 * write it back unchanged on save (e.g., gandaki's `choices-backup`).
 */
export interface RawSheet {
  name: string;
  /** Original header order, including blanks. */
  headers: (string | null)[];
  /** Rows including the header row at index 0. Cells preserved as strings. */
  rows: (string | null)[][];
}

/**
 * In-memory representation of one XLSForm file.
 *
 * Round-trip invariant: parse(serialize(parse(xlsx))) === parse(xlsx) for
 * any xlsx the editor doesn't modify.
 */
export interface XLSForm {
  /** Locales discovered across all sheets (e.g. ["en", "ne"]). */
  locales: string[];
  /** Headers of the survey sheet, in original order, with unknown headers preserved. */
  surveyHeaders: SurveyHeaderInfo;
  /** Headers of the choices sheet. */
  choicesHeaders: ChoicesHeaderInfo;
  survey: SurveyRow[];
  choices: ChoiceRow[];
  settings: FormSettings;
  /** Any sheet other than survey/choices/settings. Preserved verbatim. */
  extraSheets: RawSheet[];
}

/**
 * Records the original header layout of the survey sheet so we can write
 * back in the same column order on save.
 */
export interface SurveyHeaderInfo {
  /** Headers in original order. */
  ordered: string[];
  /** Locales for which label columns exist, in original order. */
  labelLocales: string[];
}

export interface ChoicesHeaderInfo {
  ordered: string[];
  labelLocales: string[];
}

/** Question types we treat as "real" (vs grouping/structural rows). */
export const QUESTION_TYPES = [
  'text',
  'string',
  'integer',
  'decimal',
  'date',
  'time',
  'dateTime',
  'select_one',
  'select_multiple',
  'calculate',
  'hidden',
  'note',
  'image',
  'audio',
  'video',
  'geopoint',
  'barcode',
] as const;

/** Structural rows that don't take user input but define form structure. */
export const STRUCTURAL_TYPES = ['begin group', 'end group', 'begin repeat', 'end repeat'] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];
export type StructuralType = (typeof STRUCTURAL_TYPES)[number];

/** True if the row's type is a structural marker (begin/end group/repeat). */
export function isStructural(row: SurveyRow): boolean {
  const t = row.type.trim().toLowerCase();
  return (STRUCTURAL_TYPES as readonly string[]).includes(t);
}

/**
 * Types that carry user-facing content a content editor / translator might
 * want to edit even in "Simple mode": question fields plus notes. Calculates
 * and hidden rows are intentionally excluded — they're plumbing.
 */
const SIMPLE_MODE_VISIBLE_TYPES = new Set<string>([
  'text',
  'string',
  'integer',
  'decimal',
  'date',
  'time',
  'datetime',
  'select_one',
  'select_multiple',
  'note',
  'image',
  'audio',
  'video',
  'geopoint',
  'barcode',
]);

/**
 * True if the row should be hidden from the editor when the user has
 * selected "Simple" mode. This is a UI-only filter; the underlying
 * form.survey array is never mutated.
 *
 * Type-only check — does not know which group the row lives in. Prefer
 * {@link computeSimpleHiddenRowIds} when the survey is available, because
 * it treats `calculate` rows group-aware (only ones inside CHT's `inputs/`
 * block are hidden).
 */
export function isHiddenInSimpleMode(row: SurveyRow): boolean {
  const t = row.type.trim().toLowerCase();
  if ((STRUCTURAL_TYPES as readonly string[]).includes(t)) return true;
  // select_one / select_multiple carry a list name in the type cell
  // (e.g. "select_one sex_options"), so match the visible-type set on the
  // base token — otherwise every select question is wrongly hidden in
  // Simple mode. Single-token types (text, integer, note…) are unaffected.
  const baseType = t.split(/\s+/)[0] ?? t;
  return !SIMPLE_MODE_VISIBLE_TYPES.has(baseType);
}

/** CHT context-injection group name. Calculates inside it are plumbing
 *  (they pull `contact.*` / `user.*` data and never carry a clinician's
 *  answer), so Simple mode hides them while keeping other calculates —
 *  which usually feed reports / tasks / contact-summary — visible. */
const CHT_INPUTS_GROUP = 'inputs';

/**
 * Group-aware version of {@link isHiddenInSimpleMode}. Returns the set of
 * `rowId`s that should be hidden in Simple mode for this survey.
 *
 * Behaviour for `calculate` rows:
 *   - Inside the CHT `inputs/` group (at any depth) → hidden as plumbing.
 *   - Anywhere else → visible (treated as a real report-bound output).
 *
 * Every other "plumbing" classification from {@link isHiddenInSimpleMode}
 * (structural, hidden, start/end/today, etc.) is applied unchanged.
 */
export function computeSimpleHiddenRowIds(survey: SurveyRow[]): Set<string> {
  const hidden = new Set<string>();
  const groupStack: string[] = [];
  for (const row of survey) {
    const t = row.type.trim().toLowerCase();

    // Pop before classifying an end marker, so rows after a closed group
    // no longer see it on the stack.
    if (t === 'end group' || t === 'end repeat') {
      groupStack.pop();
    }

    if (t === 'calculate') {
      const insideInputs = groupStack.some((g) => g.toLowerCase() === CHT_INPUTS_GROUP);
      if (insideInputs) hidden.add(row.rowId);
    } else if (isHiddenInSimpleMode(row)) {
      hidden.add(row.rowId);
    }

    // Push after classifying, so a `begin group inputs` row is not itself
    // considered "inside inputs" (it's structural and hidden anyway, but
    // this keeps the stack semantics clean).
    if (t === 'begin group' || t === 'begin repeat') {
      groupStack.push(row.name);
    }
  }
  return hidden;
}
