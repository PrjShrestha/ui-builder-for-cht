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
import { parseContactSummary, recognizeContextValueBridge } from '@cht-ui/shared';
import { api } from '../api.js';
import { useApp } from '../state/store.js';

/**
 * A single context-value bridge exposed to the calc-side picker's
 * "From another form (via contact summary)" source group. Wave 3 · Note 6.
 */
export interface ContextBridgeKey {
  /** The context key (e.g. `bmi`). */
  key: string;
  /** Form basename the bridge reads from (e.g. `diabetes_screening`). */
  sourceForm: string;
  /** Field path within the source form's report (e.g. `bmi`). */
  sourceField: string;
}

interface Snapshot {
  keys: string[];
  bridges: ContextBridgeKey[];
}

let cache: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;
let cacheKey: string | null = null;
const subscribers = new Set<(v: Snapshot) => void>();

async function loadSnapshot(): Promise<Snapshot> {
  try {
    const files = await api.getContactSummaryFiles();
    const src = files['contact-summary.templated.js'];
    if (!src) return { keys: [], bridges: [] };
    const parsed = parseContactSummary(src);
    const bridges: ContextBridgeKey[] = [];
    for (const key of parsed.contextOrder) {
      const expr = parsed.contextFlags[key] ?? '';
      const b = recognizeContextValueBridge(expr);
      if (b) bridges.push({ key, sourceForm: b.sourceForm, sourceField: b.sourceField });
    }
    return { keys: parsed.contextOrder, bridges };
  } catch {
    // No contact-summary route, or the file is unreadable — the picker
    // degrades to free-type, never errors.
    return { keys: [], bridges: [] };
  }
}

function subscribeToSnapshot(
  projectPath: string,
  notify: (v: Snapshot) => void,
): () => void {
  if (!projectPath) {
    notify({ keys: [], bridges: [] });
    return () => {};
  }
  // ALWAYS register the subscriber — even on a warm cache — so a later
  // `invalidateContactSummaryContextKeys()` reaches every mounted hook.
  // The previous early-return left warm-cache subscribers unregistered,
  // which is why the calc builder showed stale "No cross-form values"
  // until a full reload (audit P1-4).
  let alive = true;
  const wrapped = (v: Snapshot) => {
    if (alive) notify(v);
  };
  subscribers.add(wrapped);
  if (cache && cacheKey === projectPath) {
    notify(cache);
  } else if (!inflight || cacheKey !== projectPath) {
    cacheKey = projectPath;
    inflight = loadSnapshot().then((out) => {
      cache = out;
      for (const fn of subscribers) fn(out);
      inflight = null;
      return out;
    });
  }
  return () => {
    alive = false;
    subscribers.delete(wrapped);
  };
}

/**
 * Drop the cached snapshot and re-fetch, notifying every mounted hook.
 * Call after any write to `contact-summary.templated.js` (the Contact
 * Summary editor's save) so the calc builder's "From another form"
 * picker reflects newly defined context values without a full reload —
 * the feature's own empty-state → deep-link → define → back loop
 * depends on this (audit P1-4). Mirrors `parsedFormCache.invalidate`.
 */
export function invalidateContactSummaryContextKeys(): void {
  cache = null;
  cacheKey = null;
  inflight = null;
  // Re-fetch eagerly so already-mounted consumers update in place.
  inflight = loadSnapshot().then((out) => {
    cache = out;
    for (const fn of subscribers) fn(out);
    inflight = null;
    return out;
  });
}

export function useContactSummaryContextKeys(): string[] {
  const projectPath = useApp((s) => s.project?.path ?? '');
  const [keys, setKeys] = useState<string[]>(cache?.keys ?? []);
  useEffect(() => subscribeToSnapshot(projectPath, (snap) => setKeys(snap.keys)), [projectPath]);
  return keys;
}

/**
 * Wave 3 · Note 6 — the calc-side "From another form (via contact summary)"
 * picker source group's dropdown data. Returns the subset of context keys
 * whose value in `contact-summary.templated.js` is the canonical
 * self-contained reports-scan IIFE the Contact Summary editor's
 * "Context values" sub-tab emits (or its legacy Utils-based predecessor).
 * Consumers use `.key` as the argument to
 * `emitContactSummary(key, 'fallback-to-current')` and display the
 * source form + field as human-readable context.
 */
export function useContactSummaryBridgeKeys(): ContextBridgeKey[] {
  const projectPath = useApp((s) => s.project?.path ?? '');
  const [bridges, setBridges] = useState<ContextBridgeKey[]>(cache?.bridges ?? []);
  useEffect(
    () => subscribeToSnapshot(projectPath, (snap) => setBridges(snap.bridges)),
    [projectPath],
  );
  return bridges;
}
