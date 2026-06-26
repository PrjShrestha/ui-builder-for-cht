/**
 * Dictionary search route — backs the Standard-codes picker's step-2
 * "pick a code" surface. Lazy-loads the vendored
 * `shared/src/fhir/dictionaries/{systemId}.json` files, builds an
 * in-memory search index on first use, caches by file `(mtimeMs, size)`
 * the same way `parsedFormCache` does. Sub-50 ms per search by design;
 * the picker calls this on every debounced keystroke.
 *
 * Search ranking (highest first):
 *   1. Exact code match
 *   2. Code prefix match
 *   3. Display prefix match (word-boundary)
 *   4. Display substring match
 *   5. Alias substring match
 *
 * Pagination: limit (default 50, max 200) + offset; `total` returned for
 * the picker to render a "showing X of Y" line when relevant.
 *
 * See docs/plans/fhir-pack-population.md §"Verify the index scales".
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertDictionary,
  DICTIONARY_SYSTEM_URLS,
  type Dictionary,
  type DictionaryEntry,
  type DictionarySystemId,
} from '@cht-ui/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The bundled dictionaries ship inside the shared workspace. Server builds
 * to `server/dist/routes/`; resolve relative to the source tree so dev +
 * production both find the files. Mirrors the dual-path scheme that
 * `loadStarterPack` uses for the bundled MCH pack.
 */
function dictionaryFileCandidates(systemId: DictionarySystemId): string[] {
  return [
    // 1. Adjacent to shared/dist (production)
    path.resolve(__dirname, '..', '..', '..', 'shared', 'dist', 'fhir', 'dictionaries', `${systemId}.json`),
    // 2. Source tree (dev — tsc --watch may not have refreshed dist yet)
    path.resolve(__dirname, '..', '..', '..', 'shared', 'src', 'fhir', 'dictionaries', `${systemId}.json`),
  ];
}

async function resolveDictionaryPath(systemId: DictionarySystemId): Promise<string | null> {
  for (const candidate of dictionaryFileCandidates(systemId)) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

interface IndexedDictionary {
  dictionary: Dictionary;
  /** Lowercased searchable corpus per entry. Computed once at index build. */
  searchable: Array<{
    code: string;
    codeLower: string;
    displayLower: string;
    aliasesLower: string[];
  }>;
  /** Cache key — invalidate when the file changes. */
  mtimeMs: number;
  size: number;
}

/** Per-systemId cache. Lazy populated on first /search hit. */
const index = new Map<DictionarySystemId, IndexedDictionary>();

async function loadAndIndex(systemId: DictionarySystemId): Promise<IndexedDictionary | null> {
  const filePath = await resolveDictionaryPath(systemId);
  if (!filePath) return null;
  const stat = await fs.stat(filePath);
  const cached = index.get(systemId);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  assertDictionary(parsed);
  const searchable = parsed.entries.map((e) => ({
    code: e.code,
    codeLower: e.code.toLowerCase(),
    displayLower: e.display.toLowerCase(),
    aliasesLower: e.aliases.map((a) => a.toLowerCase()),
  }));
  const built: IndexedDictionary = {
    dictionary: parsed,
    searchable,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
  index.set(systemId, built);
  return built;
}

interface SearchHit {
  entry: DictionaryEntry;
  score: number;
}

function score(
  searchable: IndexedDictionary['searchable'][number],
  qLower: string,
): number {
  if (!qLower) return 1; // no query → keep all (sorted by code via dictionary order)
  if (searchable.codeLower === qLower) return 1000;
  if (searchable.codeLower.startsWith(qLower)) return 800;
  // Word-boundary prefix on display: "blood pressure" matches "pressure"
  const displayWords = searchable.displayLower.split(/[\s,/()]+/);
  if (displayWords.some((w) => w.startsWith(qLower))) return 600;
  if (searchable.displayLower.includes(qLower)) return 400;
  if (searchable.aliasesLower.some((a) => a.includes(qLower))) return 200;
  return 0;
}

interface SearchQuery {
  system?: string;
  q?: string;
  limit?: string;
  offset?: string;
}

const VALID_SYSTEMS = Object.keys(DICTIONARY_SYSTEM_URLS) as DictionarySystemId[];

export async function registerDictionaryRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Static "which dictionaries are available?" surface for the picker's
   * step-1. We don't gate on whether the file exists — the picker shows
   * the button regardless and search returns empty if the file isn't
   * vendored yet. Keeps the picker shape stable across script reruns.
   */
  app.get('/api/fhir/dictionary/list', async () => {
    const systems = await Promise.all(
      VALID_SYSTEMS.map(async (id) => {
        const filePath = await resolveDictionaryPath(id);
        let count: number | null = null;
        let version: string | null = null;
        if (filePath) {
          try {
            const indexed = await loadAndIndex(id);
            if (indexed) {
              count = indexed.dictionary.entries.length;
              version = indexed.dictionary.dictionaryVersion;
            }
          } catch {
            // bad file — surface as "available: false"
          }
        }
        return { systemId: id, system: DICTIONARY_SYSTEM_URLS[id], available: count !== null, count, version };
      }),
    );
    return { systems };
  });

  app.get<{ Querystring: SearchQuery }>('/api/fhir/dictionary/search', async (req, reply) => {
    const systemId = req.query.system as DictionarySystemId | undefined;
    if (!systemId || !VALID_SYSTEMS.includes(systemId)) {
      return reply.code(400).send({
        error: `Missing or invalid ?system=. Valid: ${VALID_SYSTEMS.join(', ')}`,
      });
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const q = (req.query.q ?? '').trim().toLowerCase();

    const indexed = await loadAndIndex(systemId);
    if (!indexed) {
      return {
        system: DICTIONARY_SYSTEM_URLS[systemId],
        systemId,
        dictionaryVersion: null,
        total: 0,
        entries: [],
        available: false,
      };
    }
    // eslint-disable-next-line no-undef
    const t0 = performance.now();
    const hits: SearchHit[] = [];
    for (let i = 0; i < indexed.searchable.length; i++) {
      const sc = score(indexed.searchable[i]!, q);
      if (sc > 0) hits.push({ entry: indexed.dictionary.entries[i]!, score: sc });
    }
    // Sort by score desc, then code asc for stability.
    hits.sort((a, b) => b.score - a.score || a.entry.code.localeCompare(b.entry.code));
    const page = hits.slice(offset, offset + limit).map((h) => h.entry);
    // eslint-disable-next-line no-undef
    const elapsed = +(performance.now() - t0).toFixed(1);
    app.log.info(
      { systemId, q, total: hits.length, ms: elapsed },
      'GET /api/fhir/dictionary/search',
    );
    return {
      system: indexed.dictionary.system,
      systemId,
      dictionaryVersion: indexed.dictionary.dictionaryVersion,
      total: hits.length,
      entries: page,
      available: true,
    };
  });
}
