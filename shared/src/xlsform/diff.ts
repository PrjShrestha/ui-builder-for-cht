/**
 * Structured diff between two XLSForms. Used by the UI to show users
 * what they're about to save.
 */
import type { ChoiceRow, FormSettings, SurveyRow, XLSForm } from './types.js';

export interface SurveyRowChange {
  rowId: string;
  before: SurveyRow | null;
  after: SurveyRow | null;
  /** Names of the columns that changed (when both before and after exist). */
  changedFields: string[];
}

export interface ChoiceRowChange {
  rowId: string;
  before: ChoiceRow | null;
  after: ChoiceRow | null;
  changedFields: string[];
}

export interface XLSFormDiff {
  surveyAdded: SurveyRow[];
  surveyRemoved: SurveyRow[];
  surveyModified: SurveyRowChange[];
  surveyReordered: boolean;
  choicesAdded: ChoiceRow[];
  choicesRemoved: ChoiceRow[];
  choicesModified: ChoiceRowChange[];
  settingsChanged: Array<{ key: string; before: string | undefined; after: string | undefined }>;
}

export function diffXlsForms(before: XLSForm, after: XLSForm): XLSFormDiff {
  const beforeSurvey = new Map(before.survey.map((r) => [r.rowId, r]));
  const afterSurvey = new Map(after.survey.map((r) => [r.rowId, r]));

  const surveyAdded: SurveyRow[] = [];
  const surveyRemoved: SurveyRow[] = [];
  const surveyModified: SurveyRowChange[] = [];

  for (const [id, a] of afterSurvey) {
    const b = beforeSurvey.get(id);
    if (!b) {
      surveyAdded.push(a);
      continue;
    }
    const changed = diffSurveyFields(b, a);
    if (changed.length > 0) {
      surveyModified.push({ rowId: id, before: b, after: a, changedFields: changed });
    }
  }
  for (const [id, b] of beforeSurvey) {
    if (!afterSurvey.has(id)) surveyRemoved.push(b);
  }
  // Detect reorder if the rowId sequence differs (for the IDs in both sets).
  const beforeIds = before.survey.filter((r) => afterSurvey.has(r.rowId)).map((r) => r.rowId);
  const afterIds = after.survey.filter((r) => beforeSurvey.has(r.rowId)).map((r) => r.rowId);
  const reordered = beforeIds.join('|') !== afterIds.join('|');

  const beforeChoices = new Map(before.choices.map((r) => [r.rowId, r]));
  const afterChoices = new Map(after.choices.map((r) => [r.rowId, r]));
  const choicesAdded: ChoiceRow[] = [];
  const choicesRemoved: ChoiceRow[] = [];
  const choicesModified: ChoiceRowChange[] = [];
  for (const [id, a] of afterChoices) {
    const b = beforeChoices.get(id);
    if (!b) {
      choicesAdded.push(a);
      continue;
    }
    const changed = diffChoiceFields(b, a);
    if (changed.length > 0) {
      choicesModified.push({ rowId: id, before: b, after: a, changedFields: changed });
    }
  }
  for (const [id, b] of beforeChoices) {
    if (!afterChoices.has(id)) choicesRemoved.push(b);
  }

  const settingsChanged = diffSettings(before.settings, after.settings);

  return {
    surveyAdded,
    surveyRemoved,
    surveyModified,
    surveyReordered: reordered,
    choicesAdded,
    choicesRemoved,
    choicesModified,
    settingsChanged,
  };
}

function diffSurveyFields(a: SurveyRow, b: SurveyRow): string[] {
  const changed: string[] = [];
  if (a.type !== b.type) changed.push('type');
  if (a.name !== b.name) changed.push('name');
  if ((a.required ?? '') !== (b.required ?? '')) changed.push('required');
  // Labels.
  const aLocales = new Set([...Object.keys(a.labels), ...Object.keys(b.labels)]);
  for (const loc of aLocales) {
    if ((a.labels[loc] ?? '') !== (b.labels[loc] ?? '')) changed.push(`label::${loc}`);
  }
  // Extras.
  const allKeys = new Set([...Object.keys(a.extras), ...Object.keys(b.extras)]);
  for (const k of allKeys) {
    if ((a.extras[k] ?? '') !== (b.extras[k] ?? '')) changed.push(k);
  }
  return changed;
}

function diffChoiceFields(a: ChoiceRow, b: ChoiceRow): string[] {
  const changed: string[] = [];
  if (a.list_name !== b.list_name) changed.push('list_name');
  if (a.name !== b.name) changed.push('name');
  const allLoc = new Set([...Object.keys(a.labels), ...Object.keys(b.labels)]);
  for (const loc of allLoc) {
    if ((a.labels[loc] ?? '') !== (b.labels[loc] ?? '')) changed.push(`label::${loc}`);
  }
  const allKeys = new Set([...Object.keys(a.extras), ...Object.keys(b.extras)]);
  for (const k of allKeys) {
    if ((a.extras[k] ?? '') !== (b.extras[k] ?? '')) changed.push(k);
  }
  return changed;
}

function diffSettings(
  a: FormSettings,
  b: FormSettings,
): Array<{ key: string; before: string | undefined; after: string | undefined }> {
  const out: Array<{ key: string; before: string | undefined; after: string | undefined }> = [];
  const known: Array<keyof FormSettings> = ['form_title', 'form_id', 'version', 'default_language'];
  for (const k of known) {
    if ((a[k] ?? undefined) !== (b[k] ?? undefined)) {
      out.push({ key: k as string, before: a[k] as string | undefined, after: b[k] as string | undefined });
    }
  }
  const allExtras = new Set([...Object.keys(a.extras), ...Object.keys(b.extras)]);
  for (const k of allExtras) {
    if ((a.extras[k] ?? '') !== (b.extras[k] ?? '')) {
      out.push({ key: k, before: a.extras[k], after: b.extras[k] });
    }
  }
  return out;
}

export function isEmptyDiff(d: XLSFormDiff): boolean {
  return (
    d.surveyAdded.length === 0 &&
    d.surveyRemoved.length === 0 &&
    d.surveyModified.length === 0 &&
    !d.surveyReordered &&
    d.choicesAdded.length === 0 &&
    d.choicesRemoved.length === 0 &&
    d.choicesModified.length === 0 &&
    d.settingsChanged.length === 0
  );
}
