/**
 * Field metadata extraction for the rule-builder pickers (geriatric
 * handoff §1, docs/handoff-geriatric-blockers-2026-08-05.md).
 *
 * The modal rule builders (AppliesIfBuilder, RelevantRuleBuilder) need
 * more than bare field names: to offer a CHOICE-VALUE DROPDOWN for
 * `select_one` / `select_multiple` fields ("label shown, name stored"),
 * they need each field's type and — for selects — its real choice rows.
 * The client previously extracted bare group-qualified paths in
 * `useReportFormFields.ts`; that walk now lives here (shared, pure, unit
 * tested) and returns full infos. This is exposure of already-parsed
 * data, not new parsing: the XLSForm's `survey` and `choices` sheets are
 * exactly what `parseXlsForm` produced.
 *
 * Path shape: GROUP-QUALIFIED dotted paths (`vitals.bmi`), matching both
 * report readers (`Utils.getField(report, 'vitals.bmi')` in tasks,
 * `report.fields.vitals.bmi` in contact-summary) — audit P1-5.
 */
import { SELECT_TYPE_RE } from './types.js';
import type { ChoiceRow, SurveyRow } from './types.js';

export interface ReportFieldChoice {
  /** The choice `name` — the value stored in the report / expression. */
  name: string;
  /** Display label: first non-empty label in `locales` order, then any
   *  non-empty label in sheet column order, then the name itself. */
  label: string;
}

export interface ReportFieldInfo {
  /** Group-qualified dotted path (`vitals.bmi`). */
  path: string;
  /** The row's raw XLSForm type cell, trimmed (`select_one fail_pass`). */
  type: string;
  /** Present only for select_one / select_multiple rows whose list has
   *  at least one choice. */
  choices?: ReportFieldChoice[];
}

const META_FIELDS = new Set([
  'source',
  'source_id',
  'parent',
  'meta',
  'start',
  'end',
  'today',
  'deviceid',
  'instanceid',
  'phone',
  'simserial',
  'subscriberid',
]);

function choiceLabel(labels: Record<string, string>, locales: readonly string[]): string | null {
  for (const loc of locales) {
    const v = labels[loc];
    if (v && v.trim() !== '') return v;
  }
  for (const v of Object.values(labels)) {
    if (v && v.trim() !== '') return v;
  }
  return null;
}

/**
 * Extract per-field infos from a parsed form's survey + choices sheets.
 * Group/repeat structure contributes to the dotted path; meta fields and
 * `_`-prefixed names are skipped (same exclusions the bare-name
 * extraction always had).
 *
 * @param locales label-locale preference order for choice labels
 *                (typically `surveyHeaders.labelLocales`).
 */
export function extractReportFieldInfos(
  survey: readonly Pick<SurveyRow, 'name' | 'type'>[],
  choices: readonly Pick<ChoiceRow, 'list_name' | 'name' | 'labels'>[] = [],
  locales: readonly string[] = [],
): ReportFieldInfo[] {
  const listToChoices = new Map<string, ReportFieldChoice[]>();
  for (const c of choices) {
    if (!c.list_name || !c.name) continue;
    if (!listToChoices.has(c.list_name)) listToChoices.set(c.list_name, []);
    listToChoices.get(c.list_name)!.push({
      name: c.name,
      label: choiceLabel(c.labels ?? {}, locales) ?? c.name,
    });
  }

  const out: ReportFieldInfo[] = [];
  const seen = new Set<string>();
  const stack: string[] = [];
  for (const r of survey) {
    const t = r.type.trim().toLowerCase();
    if (t === 'begin group' || t === 'begin repeat') {
      stack.push(r.name ?? '');
      continue;
    }
    if (t === 'end group' || t === 'end repeat') {
      stack.pop();
      continue;
    }
    if (!r.name) continue;
    const lc = r.name.toLowerCase();
    if (lc.startsWith('_')) continue;
    // Skip meta leaves at top level, and anything inside a meta-rooted group.
    if (stack.length === 0 && META_FIELDS.has(lc)) continue;
    if (stack.some((g) => META_FIELDS.has(g.toLowerCase()))) continue;
    const path = [...stack.filter(Boolean), r.name].join('.');
    if (seen.has(path)) continue;
    seen.add(path);
    const info: ReportFieldInfo = { path, type: r.type.trim() };
    const m = r.type.trim().match(SELECT_TYPE_RE);
    if (m) {
      const opts = listToChoices.get(m[2]!);
      if (opts && opts.length > 0) info.choices = opts;
    }
    out.push(info);
  }
  return out;
}

/** XLSForm date-shaped question types (used by the date-anchor pickers). */
export function isDateFieldType(type: string): boolean {
  const t = type.trim().toLowerCase();
  return t === 'date' || t === 'datetime' || t === 'date_time';
}
