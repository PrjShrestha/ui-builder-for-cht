/**
 * Load the project's `contact-summary.templated.js` once per session and
 * expose its `context` keys (the symbols accessible via
 * `instance('contact-summary')/context/<key>` from any app form's XForm
 * expressions).
 *
 * Mirrors `useContactFormFields`: module-level cache + inflight promise +
 * subscriber set, so multiple FormEditor mounts share one fetch.
 *
 * Returns `[]` when:
 *   - the project has no contact-summary file (the calc reference picker
 *     then shows a free-type-only contact-summary mode);
 *   - the file exists but the parser can't find a `context` object;
 *   - the fetch fails (treat as missing — non-fatal).
 *
 * Used by `SingleValuePanel`'s "Contact-summary value" reference kind
 * (plan docs/plans/calc-reference-builder.md Tier 1.5).
 */
import { useEffect, useState } from 'react';
import { parseContactSummary } from '@cht-ui/shared';
import { api } from '../api.js';
import { useApp } from '../state/store.js';

let cache: string[] | null = null;
let inflight: Promise<string[]> | null = null;
let cacheKey: string | null = null;
const subscribers = new Set<(v: string[]) => void>();

async function loadContextKeys(): Promise<string[]> {
  try {
    const files = await api.getContactSummaryFiles();
    const src = files['contact-summary.templated.js'];
    if (!src) return [];
    return parseContactSummary(src).contextOrder;
  } catch {
    // No contact-summary route, or the file is unreadable — the picker
    // degrades to free-type, never errors.
    return [];
  }
}

export function useContactSummaryContextKeys(): string[] {
  const projectPath = useApp((s) => s.project?.path ?? '');
  const [keys, setKeys] = useState<string[]>(cache ?? []);

  useEffect(() => {
    if (!projectPath) {
      setKeys([]);
      return;
    }
    // Cache key is the project path: switching projects must re-fetch
    // (the contact-summary file is project-local).
    if (cache && cacheKey === projectPath) {
      setKeys(cache);
      return;
    }
    let alive = true;
    const notify = (v: string[]) => {
      if (alive) setKeys(v);
    };
    subscribers.add(notify);

    if (!inflight || cacheKey !== projectPath) {
      cacheKey = projectPath;
      inflight = loadContextKeys().then((out) => {
        cache = out;
        for (const fn of subscribers) fn(out);
        inflight = null;
        return out;
      });
    }

    return () => {
      alive = false;
      subscribers.delete(notify);
    };
  }, [projectPath]);

  return keys;
}
