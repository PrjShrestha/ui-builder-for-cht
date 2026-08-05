/**
 * Lazy field-metadata loader for a single report (app-category) form,
 * keyed by form basename (e.g. "cervical_cancer_screening"). Each form is
 * fetched once per session and cached at module scope; concurrent callers
 * for the same id share the same in-flight promise.
 *
 * Used by ReportFieldPicker and InsertFieldButton, where we don't want
 * 30+ XLSX parses to kick off just because the user opened the rule
 * builder. The extraction itself lives in shared
 * (`extractReportFieldInfos`) so it's unit-tested and emits
 * GROUP-QUALIFIED dotted paths (`vitals.bmi`) — audit P1-5 — plus each
 * field's type and, for selects, its real choices (geriatric §1: the
 * rule builders' choice-value dropdowns).
 */
import { useEffect, useState } from 'react';
import {
  extractReportFieldInfos,
  isDateFieldType,
  type ReportFieldInfo,
} from '@cht-ui/shared';
import { api } from '../api.js';

interface FormFieldData {
  infos: ReportFieldInfo[];
  fields: string[];
  dateFields: string[];
}

const cache = new Map<string, FormFieldData>();
const inflight = new Map<string, Promise<FormFieldData>>();

const EMPTY: FormFieldData = { infos: [], fields: [], dateFields: [] };

async function fetchFields(basename: string): Promise<FormFieldData> {
  const id = `app:${basename}`;
  try {
    const res = await api.getForm(id);
    const infos = extractReportFieldInfos(
      res.form.survey,
      res.form.choices,
      res.form.surveyHeaders.labelLocales,
    );
    const data: FormFieldData = {
      infos,
      fields: infos.map((i) => i.path),
      dateFields: infos.filter((i) => isDateFieldType(i.type)).map((i) => i.path),
    };
    cache.set(basename, data);
    return data;
  } catch {
    cache.set(basename, EMPTY);
    return EMPTY;
  }
}

function useFormFieldData(formBasename: string | null): {
  data: FormFieldData;
  loading: boolean;
} {
  const [data, setData] = useState<FormFieldData>(() =>
    formBasename ? (cache.get(formBasename) ?? EMPTY) : EMPTY,
  );
  const [loading, setLoading] = useState<boolean>(
    () => formBasename != null && !cache.has(formBasename),
  );

  useEffect(() => {
    if (!formBasename) {
      setData(EMPTY);
      setLoading(false);
      return;
    }
    const cached = cache.get(formBasename);
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    let alive = true;
    let p = inflight.get(formBasename);
    if (!p) {
      p = fetchFields(formBasename).finally(() => inflight.delete(formBasename));
      inflight.set(formBasename, p);
    }
    p.then((out) => {
      if (!alive) return;
      setData(out);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [formBasename]);

  return { data, loading };
}

export function useReportFormFields(formBasename: string | null): {
  fields: string[];
  loading: boolean;
} {
  const { data, loading } = useFormFieldData(formBasename);
  return { fields: data.fields, loading };
}

/**
 * Geriatric §1 — full per-field metadata (`{path, type, choices?}`) for
 * the rule builders' choice-value dropdowns. Same fetch + cache path as
 * `useReportFormFields`.
 */
export function useReportFormFieldInfos(formBasename: string | null): {
  infos: ReportFieldInfo[];
  loading: boolean;
} {
  const { data, loading } = useFormFieldData(formBasename);
  return { infos: data.infos, loading };
}

/**
 * Like `useReportFormFields`, but returns only date-typed questions (XLSForm
 * type `date` / `datetime`). Used by the event date-anchor picker to
 * populate the anchor dropdown with valid date-field choices (e.g. `lmp_date`).
 * Shares the same fetch + cache path as `useReportFormFields`.
 */
export function useReportFormDateFields(formBasename: string | null): {
  dateFields: string[];
  loading: boolean;
} {
  const { data, loading } = useFormFieldData(formBasename);
  return { dateFields: data.dateFields, loading };
}

/**
 * Parse a `appliesToType` raw text (e.g. `[FORMS.foo, 'bar']`) into a list
 * of form basenames. Empty array / unparseable → empty list.
 */
export function parseAppliesToType(raw: string): string[] {
  const names = new Set<string>();
  // FORMS.identifier — the most common shape in real configs
  for (const m of raw.matchAll(/FORMS\.([A-Za-z_][\w]*)/g)) {
    names.add(m[1]!);
  }
  // Bare string literals 'name' / "name" (skip 'reports' / 'contacts' tokens)
  for (const m of raw.matchAll(/['"]([A-Za-z_][\w-]*)['"]/g)) {
    names.add(m[1]!);
  }
  return [...names];
}
