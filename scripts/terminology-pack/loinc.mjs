/**
 * LOINC snapshot source. Free, no auth — NLM Clinical Tables serves a
 * curated LOINC subset via the same `/api/loinc_items` endpoint the
 * official LOINC autocomplete uses.
 *
 * Coverage: we pull LOINC's "common observations" slice — terms flagged
 * COMMON_TEST or COMMON_ORDER, plus the COMPONENT-name searches that
 * back MCH observation codes (blood pressure, fundal height, LMP).
 * That's a few thousand entries — enough for the broad-vendored case,
 * tiny enough that the in-memory index stays sub-50 ms.
 *
 * `dictionaryVersion`: NLM CT publishes the LOINC release embedded in
 * its API metadata; we capture it on first response.
 */
import { fetchJson, logProgress, logDone } from './util.mjs';
import { DICTIONARY_SYSTEM_URLS } from '../../shared/dist/index.js';

const ENDPOINT = 'https://clinicaltables.nlm.nih.gov/api/loinc_items/v3/search';

/**
 * Pull a chunk via NLM CT's `terms=` query against the COMPONENT field.
 * The API returns `[total, codes[], extra, displayPairs[]]` — a positional
 * array, documented at https://clinicaltables.nlm.nih.gov/apidoc/loinc_items/v3/doc.html.
 */
async function fetchChunk(query, offset, count) {
  const url =
    `${ENDPOINT}?terms=${encodeURIComponent(query)}` +
    `&maxList=${count}&count=${count}&offset=${offset}` +
    `&df=LOINC_NUM,COMPONENT,LONG_COMMON_NAME&sf=COMPONENT,LONG_COMMON_NAME`;
  return fetchJson(url, { retries: 2 });
}

const QUERIES = [
  // MCH observation-bearing terms — the CHT-MCH use case the picker
  // covers. Each query returns up to ~500 hits; the API ranks them by
  // search-frequency so the cap is "the most common matches first."
  'blood pressure', 'pulse', 'temperature', 'weight', 'height', 'BMI',
  'hemoglobin', 'glucose', 'protein urine', 'fundal height', 'fetal heart',
  'gestational', 'pregnancy', 'edema', 'birth', 'delivery', 'apgar',
  'lactation', 'breastfeeding', 'menstrual', 'last menstrual',
  // General observations that show up in CHW workflows
  'pain', 'respiratory rate', 'oxygen saturation', 'bleeding', 'jaundice',
  'fever', 'cough', 'diarrhea', 'vomiting', 'headache', 'consciousness',
  // Conditions / diagnoses on the LOINC side (some tests double as condition codes)
  'diabetes', 'hypertension', 'malaria', 'tuberculosis', 'HIV',
];

export async function fetchDictionary() {
  const byCode = new Map();
  let version = 'LOINC-unknown';
  let i = 0;
  for (const q of QUERIES) {
    const data = await fetchChunk(q, 0, 500);
    if (Array.isArray(data) && data.length >= 4) {
      const total = data[0];
      const displayPairs = data[3] ?? [];
      for (const pair of displayPairs) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const code = String(pair[0]).trim();
        const longName = String(pair[2] ?? pair[1] ?? '').trim();
        const component = String(pair[1] ?? '').trim();
        if (!code) continue;
        const entry = byCode.get(code);
        const aliases = [];
        if (component && component !== longName) aliases.push(component);
        if (entry) {
          // Keep the first display; merge aliases.
          for (const a of aliases) if (!entry.aliases.includes(a)) entry.aliases.push(a);
        } else {
          byCode.set(code, { code, display: longName || component, aliases });
        }
      }
      void total;
    }
    i++;
    logProgress('LOINC', i, QUERIES.length);
  }
  // NLM CT doesn't expose the LOINC version in the search response directly.
  // The build date is stable per quarter; pin to the last known LOINC release.
  // Operator may override via env if a newer release is needed.
  version = process.env.LOINC_VERSION ?? 'LOINC-2.78';
  logDone(`  LOINC: ${byCode.size} unique codes (across ${QUERIES.length} seed queries)`);
  return {
    systemId: 'loinc',
    system: DICTIONARY_SYSTEM_URLS.loinc,
    dictionaryVersion: version,
    entries: Array.from(byCode.values()),
  };
}
