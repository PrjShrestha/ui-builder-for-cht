/**
 * Lazy field-name loader for a single report (app-category) form, keyed by
 * form basename (e.g. "cervical_cancer_screening"). Each form is fetched
 * once per session and cached at module scope; concurrent callers for the
 * same id share the same in-flight promise.
 *
 * Used by ReportFieldPicker and InsertFieldButton, where we don't want
 * 30+ XLSX parses to kick off just because the user opened the rule
 * builder.
 */
import { useEffect, useState } from 'react';
import { api } from '../api.js';

const cache = new Map<string, string[]>();
const dateCache = new Map<string, string[]>();
const inflight = new Map<string, Promise<{ fields: string[]; dateFields: string[] }>>();

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

/**
 * Walk the survey emitting GROUP-QUALIFIED dotted paths (`vitals.bmi`),
 * not bare leaf names. Report readers are path-based on both consumer
 * sides — `Utils.getField(report, 'vitals.bmi')` in tasks and
 * `report.fields.vitals.bmi` in contact-summary — so a bare `bmi` for a
 * grouped field reads `undefined` at runtime, silently masked by the
 * fallback wrappers (audit P1-5).
 *
 * `keep` decides whether a leaf row is included (given its row + the
 * current group stack). Structural rows manage the stack and are never
 * emitted. Subtrees rooted at a META group (`meta`, etc.) are skipped
 * entirely; top-level meta leaf names are skipped as before.
 */
function walkFieldPaths(
  survey: Array<{ name?: string; type: string }>,
  keep: (row: { name?: string; type: string }) => boolean,
): string[] {
  const out: string[] = [];
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
    if (!keep(r)) continue;
    const path = [...stack.filter(Boolean), r.name].join('.');
    out.push(path);
  }
  return out.filter((n, i, arr) => arr.indexOf(n) === i);
}

function extractFields(survey: Array<{ name?: string; type: string }>): string[] {
  return walkFieldPaths(survey, () => true);
}

function extractDateFields(survey: Array<{ name?: string; type: string }>): string[] {
  return walkFieldPaths(survey, (r) => {
    const t = r.type.trim().toLowerCase();
    // XLSForm date-shaped question types. `today` is meta-ish; excluded by META_FIELDS above.
    return t === 'date' || t === 'datetime' || t === 'date_time';
  });
}

async function fetchFields(basename: string): Promise<{ fields: string[]; dateFields: string[] }> {
  const id = `app:${basename}`;
  try {
    const res = await api.getForm(id);
    const fields = extractFields(res.form.survey);
    const dateFields = extractDateFields(res.form.survey);
    cache.set(basename, fields);
    dateCache.set(basename, dateFields);
    return { fields, dateFields };
  } catch {
    cache.set(basename, []);
    dateCache.set(basename, []);
    return { fields: [], dateFields: [] };
  }
}

export function useReportFormFields(formBasename: string | null): {
  fields: string[];
  loading: boolean;
} {
  const [fields, setFields] = useState<string[]>(() =>
    formBasename ? (cache.get(formBasename) ?? []) : [],
  );
  const [loading, setLoading] = useState<boolean>(
    () => formBasename != null && !cache.has(formBasename),
  );

  useEffect(() => {
    if (!formBasename) {
      setFields([]);
      setLoading(false);
      return;
    }
    const cached = cache.get(formBasename);
    if (cached) {
      setFields(cached);
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
      setFields(out.fields);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [formBasename]);

  return { fields, loading };
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
  const [dateFields, setDateFields] = useState<string[]>(() =>
    formBasename ? (dateCache.get(formBasename) ?? []) : [],
  );
  const [loading, setLoading] = useState<boolean>(
    () => formBasename != null && !dateCache.has(formBasename),
  );

  useEffect(() => {
    if (!formBasename) {
      setDateFields([]);
      setLoading(false);
      return;
    }
    const cached = dateCache.get(formBasename);
    if (cached) {
      setDateFields(cached);
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
      setDateFields(out.dateFields);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [formBasename]);

  return { dateFields, loading };
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
