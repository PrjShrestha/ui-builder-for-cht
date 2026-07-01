/**
 * Tiny fixture helpers for the preflight rule tests. Not exported from
 * the module barrel — internal to the rule suites.
 */
import type { ChoiceRow, SurveyRow, XLSForm } from '../../xlsform/types.js';
import type { PreflightContext, PreflightContextForm } from '../types.js';

let seq = 0;
function nextRowId(): string {
  seq += 1;
  return `r${seq}`;
}

export function surveyRow(
  type: string,
  name: string,
  extras: Record<string, string> = {},
  labels: Record<string, string> = {},
): SurveyRow {
  return { rowId: nextRowId(), type, name, labels, extras };
}

export function choiceRow(list_name: string, name: string): ChoiceRow {
  return { rowId: nextRowId(), list_name, name, labels: {}, extras: {} };
}

export function mkForm(
  survey: SurveyRow[],
  choices: ChoiceRow[] = [],
  formId = 'test',
): XLSForm {
  return {
    locales: ['en'],
    surveyHeaders: { ordered: ['type', 'name', 'label::en'], labelLocales: ['en'] },
    choicesHeaders: { ordered: ['list_name', 'name', 'label::en'], labelLocales: ['en'] },
    survey,
    choices,
    settings: { form_id: formId, form_title: 'Test', version: '2026-01-01', extras: {} },
    extraSheets: [],
  };
}

export function mkContext(forms: PreflightContextForm[]): PreflightContext {
  return { forms, requiredFiles: null };
}
