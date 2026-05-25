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
