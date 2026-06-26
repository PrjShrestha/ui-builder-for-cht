/**
 * Shared utilities for the dictionary snapshot pipeline. Pulls the zero-
 * SNOMED filter from `@cht-ui/shared` so the script and the test oracle
 * use the same predicate — a CIEL alias the script lets through can never
 * resurface in the CI sampler.
 */
import { writeFile, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// Node-script convention (see scripts/smoke-parser.mjs): import from the
// compiled `shared/dist/` directly. Root package.json doesn't declare
// `@cht-ui/shared` as a dep, so the bare-specifier resolver won't find it.
import { scanForSnomed, dropSnomedAliases } from '../../shared/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DICT_DIR = path.join(REPO_ROOT, 'shared', 'src', 'fhir', 'dictionaries');

/**
 * Write a Dictionary to its canonical file. Pre-write checks:
 *   1. Sort entries by code (deterministic diff).
 *   2. Strip SNOMED-sourced aliases per-entry.
 *   3. Drop any entry whose `code`/`display` itself looks SNOMED-sourced.
 *   4. Re-run the full scanForSnomed oracle on the final object before
 *      writing — never commit a file that would fail the round-trip
 *      pack guard.
 * Returns `{ kept, dropped, sampleAuditOk }`.
 */
export async function writeDictionary(dictionary) {
  const cleaned = cleanDictionary(dictionary);
  const json = JSON.stringify(cleaned, null, 2) + '\n';

  // Acceptance gate: the round-trip oracle has to pass over the serialized
  // bytes too, not just the parsed object — same belt-and-suspenders the
  // bundled pack uses.
  const scan = scanForSnomed(cleaned, json);
  if (scan.found) {
    throw new Error(`Snapshot for ${dictionary.systemId} failed SNOMED scan: ${scan.reason}`);
  }

  const outPath = path.join(DICT_DIR, `${cleaned.systemId}.json`);
  await writeFile(outPath, json, 'utf8');

  const fileSize = (await stat(outPath)).size;
  return {
    path: outPath,
    kept: cleaned.entries.length,
    dropped: dictionary.entries.length - cleaned.entries.length,
    bytes: fileSize,
  };
}

/**
 * Pure cleaner — used by writeDictionary and exported for tests. Strips
 * SNOMED-sourced aliases, drops entries whose code/display matches a
 * SNOMED needle, sorts by code, dedupes (same code appears twice → keep
 * first, merge aliases).
 */
export function cleanDictionary(dictionary) {
  const byCode = new Map();
  for (const e of dictionary.entries) {
    if (looksSnomed(e.code) || looksSnomed(e.display)) {
      continue;
    }
    const cleanedAliases = dropSnomedAliases(
      Array.isArray(e.aliases) ? e.aliases.filter((a) => typeof a === 'string') : [],
    );
    const existing = byCode.get(e.code);
    if (existing) {
      // Merge aliases; keep first display (sources usually agree).
      const merged = new Set([...existing.aliases, ...cleanedAliases]);
      existing.aliases = Array.from(merged);
    } else {
      byCode.set(e.code, {
        code: String(e.code),
        display: String(e.display).trim(),
        aliases: cleanedAliases,
      });
    }
  }
  const entries = Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
  return {
    systemId: dictionary.systemId,
    system: dictionary.system,
    dictionaryVersion: dictionary.dictionaryVersion,
    entries,
  };
}

function looksSnomed(s) {
  if (typeof s !== 'string') return false;
  const lower = s.toLowerCase();
  return (
    lower.includes('snomed') ||
    s.includes('snomed.info') ||
    s.includes('/sct') ||
    s.includes('2.16.840.1.113883.6.96')
  );
}

/**
 * Read back a written dictionary and verify it parses + passes the SNOMED
 * scan. Called by the orchestrator after writeDictionary to catch any
 * silent corruption between in-memory data and on-disk bytes.
 */
export async function auditDictionary(systemId) {
  const file = path.join(DICT_DIR, `${systemId}.json`);
  const raw = await readFile(file, 'utf8');
  const parsed = JSON.parse(raw);
  const scan = scanForSnomed(parsed, raw);
  if (scan.found) {
    throw new Error(`${systemId} dictionary failed post-write SNOMED audit: ${scan.reason}`);
  }
  return { systemId, entries: parsed.entries.length, version: parsed.dictionaryVersion, bytes: raw.length };
}

/**
 * Tiny HTTP fetcher with retry + JSON parse. Picks up native `fetch` in
 * Node 18+. Throws on non-2xx so source modules don't have to repeat the
 * boilerplate.
 */
export async function fetchJson(url, opts = {}) {
  const retries = opts.retries ?? 2;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts.fetchInit);
      if (!res.ok) {
        throw new Error(`${url} → HTTP ${res.status} ${res.statusText}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        const backoff = 500 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr;
}

export function logProgress(prefix, n, total) {
  if (n % 500 === 0 || n === total) {
    process.stderr.write(`\r  ${prefix}: ${n}${total ? `/${total}` : ''}    `);
  }
}

export function logDone(line) {
  process.stderr.write(`\n${line}\n`);
}
