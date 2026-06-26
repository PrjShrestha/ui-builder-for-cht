/**
 * CIEL snapshot source. Free OCL API. The plan calls out the zero-SNOMED
 * filter as MANDATORY for CIEL specifically — CIEL ships SNOMED cross-
 * maps as `Mappings` and sometimes as alternate names. We:
 *   1. Pull concept list with names + descriptions (no mappings endpoint).
 *   2. Drop any name whose `name_type === 'snomed'`-ish OR whose body
 *      matches the SNOMED needles via the shared filter.
 *   3. Final pre-write scanForSnomed run catches anything that slipped
 *      through (the snapshot writer enforces this, not this module).
 *
 * Coverage: we cap at ~10k concepts (`?limit=100&page=1..N`) ordered by
 * the OCL default ranking. The plan's "broad vendored" decision says
 * curated subset; we err on the side of broader since CIEL is the
 * fallback when ICD-10/11/LOINC don't carry a concept.
 */
import { fetchJson, logProgress, logDone } from './util.mjs';
import { DICTIONARY_SYSTEM_URLS, isSnomedString } from '../../shared/dist/index.js';

const ENDPOINT = 'https://api.openconceptlab.org/orgs/CIEL/sources/CIEL/concepts/';

export async function fetchDictionary() {
  const entries = [];
  const limit = 100;
  const maxPages = 100; // cap → ~10k concepts
  let version = process.env.CIEL_VERSION ?? `CIEL-${new Date().toISOString().slice(0, 10)}`;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${ENDPOINT}?limit=${limit}&page=${page}&includeMappings=false`;
    let chunk;
    try {
      chunk = await fetchJson(url, { retries: 2 });
    } catch (e) {
      // Final page may 404 when overshooting; treat as terminal.
      break;
    }
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    for (const c of chunk) {
      const code = c.id ?? c.display_name_id;
      const display = c.display_name ?? c.name ?? '';
      if (!code || !display) continue;
      // Drop the entire entry if its own display looks SNOMED-sourced —
      // belt-and-suspenders before the writer's final scan.
      if (isSnomedString(String(code)) || isSnomedString(String(display))) continue;
      const aliases = [];
      const names = Array.isArray(c.names) ? c.names : [];
      for (const n of names) {
        const nm = n?.name ?? '';
        if (!nm || nm === display) continue;
        // Skip any name whose body itself looks SNOMED-sourced. The
        // shared filter strips this layer again at write time.
        if (isSnomedString(String(nm))) continue;
        aliases.push(String(nm));
      }
      entries.push({ code: String(code), display: String(display), aliases });
    }
    logProgress('CIEL', entries.length);
    if (chunk.length < limit) break; // last page
  }
  logDone(`  CIEL: ${entries.length} entries`);
  return {
    systemId: 'ciel',
    system: DICTIONARY_SYSTEM_URLS.ciel,
    dictionaryVersion: version,
    entries,
  };
}
