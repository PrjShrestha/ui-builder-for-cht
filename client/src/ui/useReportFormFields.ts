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
const inflight = new Map<string, Promise<string[]>>();

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

function extractFields(survey: Array<{ name?: string; type: string }>): string[] {
  return survey
    .filter((r) => {
      if (!r.name) return false;
      const lc = r.name.toLowerCase();
      if (lc.startsWith('_')) return false;
      if (META_FIELDS.has(lc)) return false;
      const t = r.type.trim().toLowerCase();
      // Drop pure structural rows; keep anything with a name otherwise.
      if (t === 'begin group' || t === 'end group') return false;
      if (t === 'begin repeat' || t === 'end repeat') return false;
      return true;
    })
    .map((r) => r.name!)
    .filter((n, i, arr) => arr.indexOf(n) === i);
}

async function fetchFields(basename: string): Promise<string[]> {
  const id = `app:${basename}`;
  try {
    const res = await api.getForm(id);
    const fields = extractFields(res.form.survey);
    cache.set(basename, fields);
    return fields;
  } catch {
    cache.set(basename, []);
    return [];
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
      setFields(out);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [formBasename]);

  return { fields, loading };
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
