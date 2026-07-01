/**
 * Lazy loader for the project's helper functions exported from
 * `tasks-extras.js` and `contact-summary-extras.js`. Used by the
 * appliesIf / resolvedWhen rule builders to surface a "helper fn"
 * picker instead of asking the user to type the function name.
 *
 * Each file is fetched once per session and cached at module scope so
 * 30+ rule-builder mounts don't kick off 30+ file reads. Concurrent
 * callers share the same in-flight promise.
 *
 * Returns the list of exported helper signatures across BOTH files,
 * tagged by source so the picker can group / label them. Parse errors
 * fall back to an empty list — the rule-builder then surfaces a raw
 * text input.
 */
import { useEffect, useState } from 'react';
import { parseHelpers } from '@cht-ui/shared';
import { api } from '../api.js';

export interface ProjectHelper {
  name: string;
  params: string[];
  /** Which extras file this helper lives in — useful for the picker
   *  to group ("tasks-extras" / "contact-summary-extras") and for an
   *  eventual "edit this helper" jump. */
  source: 'tasks-extras' | 'contact-summary-extras';
}

let cache: ProjectHelper[] | null = null;
let inflight: Promise<ProjectHelper[]> | null = null;

async function fetchAndParse(): Promise<ProjectHelper[]> {
  const out: ProjectHelper[] = [];
  try {
    const tasksFiles = await api.getTaskFiles();
    const tasksExtras = tasksFiles['tasks-extras.js'];
    if (tasksExtras) {
      const parsed = parseHelpers(tasksExtras);
      // Only surface EXPORTED helpers — unexported top-level functions
      // are internal scaffolding the rule builder can't call from JS.
      const exported = new Set(parsed.exportedNames);
      for (const h of parsed.helpers) {
        if (exported.has(h.name)) {
          out.push({ name: h.name, params: h.params, source: 'tasks-extras' });
        }
      }
    }
  } catch {
    /* tasks-extras unreachable — fall through */
  }
  try {
    const csFiles = await api.getContactSummaryFiles();
    const csExtras = csFiles['contact-summary.extras.js'];
    if (csExtras) {
      const parsed = parseHelpers(csExtras);
      const exported = new Set(parsed.exportedNames);
      for (const h of parsed.helpers) {
        if (exported.has(h.name)) {
          out.push({ name: h.name, params: h.params, source: 'contact-summary-extras' });
        }
      }
    }
  } catch {
    /* contact-summary extras unreachable */
  }
  // Sort by source first (tasks-extras above contact-summary-extras —
  // tasks helpers are the natural fit for appliesIf), then alpha.
  out.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'tasks-extras' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export function useProjectHelpers(): ProjectHelper[] {
  const [helpers, setHelpers] = useState<ProjectHelper[]>(() => cache ?? []);
  useEffect(() => {
    if (cache) {
      setHelpers(cache);
      return;
    }
    let alive = true;
    if (!inflight) {
      inflight = fetchAndParse().then((list) => {
        cache = list;
        return list;
      });
    }
    inflight.then((list) => {
      if (!alive) return;
      setHelpers(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  return helpers;
}
