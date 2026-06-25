/**
 * Parsed-form cache. Keyed by `(absPath, mtimeMs, size)` — `fs.stat` is
 * sub-ms, full `parseXlsForm` is ~105 ms/form on real CHT configs
 * (config-nssd: 69 forms = ~7.2 s cold). See docs/plans/perf-parse-cache.md
 * — this is the Tier-1 chokepoint that turns warm `/api/fhir-mapping` and
 * project-open from ~7 s into ~milliseconds.
 *
 * Safety: the cache is **read-only**. The XLSForm value is deep-frozen so
 * a consumer that accidentally mutates it crashes loudly instead of
 * corrupting the next caller's view. Serialization always works from
 * caller-supplied data, never from the cached parse — see the save path in
 * forms.ts. External edits change `mtimeMs` → automatic re-parse (no
 * staleness). Our own writes call `invalidate()` belt-and-suspenders.
 *
 * The forms-dir signature helper (`directorySignature`) is the Tier-1b key
 * used by callers that derive an artifact across the whole forms tree
 * (`buildLiveKeys`, `scanContactFieldChoices`) — same stat-based design,
 * one stat per file, no parse unless the signature changed.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseXlsForm, type XLSForm } from '@cht-ui/shared';

interface CacheEntry {
  mtimeMs: number;
  size: number;
  form: XLSForm;
}

const cache = new Map<string, CacheEntry>();

/**
 * Deep-freeze an XLSForm so accidental mutation by a consumer fails fast
 * rather than poisoning the cache. We don't try to recursively freeze
 * arbitrary leaf objects — XLSForm is a plain data shape (rows, choices,
 * settings); freezing top-level + the row arrays is the right granularity.
 */
function deepFreezeForm(form: XLSForm): XLSForm {
  Object.freeze(form);
  Object.freeze(form.survey);
  for (const r of form.survey) Object.freeze(r);
  Object.freeze(form.choices);
  for (const c of form.choices) Object.freeze(c);
  Object.freeze(form.settings);
  return form;
}

/**
 * Get a parsed XLSForm for `absPath`, returning a cached value when the
 * file's `(mtimeMs, size)` matches. Stat is sub-ms; a warm read is ~1 ms
 * vs ~105 ms for a cold `parseXlsForm`.
 *
 * The returned `XLSForm` is deep-frozen — callers MUST clone before
 * mutating. Forms editor's save flow already sends a full client-built
 * form back, so it never reuses the cached parse.
 */
export async function getParsedForm(absPath: string): Promise<XLSForm> {
  const stat = await fs.stat(absPath);
  const hit = cache.get(absPath);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
    return hit.form;
  }
  const buf = await fs.readFile(absPath);
  const form = deepFreezeForm(await parseXlsForm(buf));
  cache.set(absPath, { mtimeMs: stat.mtimeMs, size: stat.size, form });
  return form;
}

/**
 * Drop a single path's cache entry. Called by writers (saveForm, create,
 * delete) so the next read re-parses from the new bytes. mtime-keying
 * already covers external edits; this is belt-and-suspenders for our own
 * writes where mtime resolution on some Windows filesystems can be lower
 * than the time between write + read in tight tests.
 */
export function invalidate(absPath: string): void {
  cache.delete(absPath);
}

/**
 * Clear the entire cache. Used by project-close (the new project may have
 * forms at the same absolute paths via a relocated/symlinked tree) and by
 * tests.
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Cheap stat-based signature for a forms directory. Sorted
 * `name:mtimeMs:size` per file → a string. Callers that derive a whole-
 * directory artifact (live keys, contact-field choices) use this as a
 * cache key: if the signature is unchanged across requests, the previous
 * result is byte-equivalent. One stat per file, no parses.
 *
 * Returns null when the directory is unreadable so callers can degrade to
 * a non-cached path without distinguishing missing-dir from empty-dir.
 */
export async function directorySignature(
  dir: string,
  extension = '.xlsx',
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  const filtered = entries.filter((e) => e.toLowerCase().endsWith(extension));
  if (filtered.length === 0) return '';
  const stats = await Promise.all(
    filtered.map(async (name) => {
      try {
        const s = await fs.stat(path.join(dir, name));
        return `${name}:${s.mtimeMs}:${s.size}`;
      } catch {
        // Treat unreadable file as a signature change so callers re-build.
        return `${name}:?:?`;
      }
    }),
  );
  stats.sort();
  return stats.join('|');
}

/** Internal-use accessor for tests. */
export function _peek(absPath: string): CacheEntry | undefined {
  return cache.get(absPath);
}
