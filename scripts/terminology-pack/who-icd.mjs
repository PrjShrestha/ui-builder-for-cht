/**
 * WHO ICD API sources (ICD-10 + ICD-11). Both use the same OAuth client_id
 * + client_secret pair issued by https://icd.who.int/icdapi/.
 *
 * Env vars (NEVER committed):
 *   WHO_ICD11_CLIENT_ID
 *   WHO_ICD11_CLIENT_SECRET
 *
 * ICD-10 path: `release/10/2019/...` — WHO's most recent ICD-10 release.
 * ICD-11 path: `release/11/2024-01/mms` — Mortality and Morbidity Statistics
 * (the canonical clinical hierarchy).
 */
import { fetchJson, logProgress, logDone } from './util.mjs';
import { DICTIONARY_SYSTEM_URLS } from '../../shared/dist/index.js';

const TOKEN_URL = 'https://icdaccessmanagement.who.int/connect/token';
const API_BASE = 'https://id.who.int';
const HEADERS_COMMON = {
  // The WHO API requires both the version + language headers on every call.
  'Accept': 'application/json',
  'Accept-Language': 'en',
  'API-Version': 'v2',
};

async function getToken() {
  const id = process.env.WHO_ICD11_CLIENT_ID;
  const secret = process.env.WHO_ICD11_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      'WHO_ICD11_CLIENT_ID + WHO_ICD11_CLIENT_SECRET env vars are required. ' +
      'Register a free client at https://icd.who.int/icdapi/',
    );
  }
  const body = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    scope: 'icdapi_access',
    grant_type: 'client_credentials',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`WHO ICD token fetch failed: HTTP ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error('WHO ICD token response missing access_token');
  return data.access_token;
}

function authHeaders(token) {
  return { ...HEADERS_COMMON, Authorization: `Bearer ${token}` };
}

/**
 * Recursive walk of the ICD hierarchy. Yields a flat list of leaf-ish
 * entries (any node that has a `code`). The API exposes a `child` array of
 * URIs — we follow them depth-first with a depth cap to avoid infinite
 * loops on linked structure.
 */
async function walkHierarchy(token, rootUri, opts) {
  const seen = new Set();
  const entries = [];
  const maxNodes = opts.maxNodes ?? Infinity;

  async function visit(uri, depth) {
    if (seen.has(uri) || entries.length >= maxNodes) return;
    seen.add(uri);
    let node;
    try {
      node = await fetchJson(uri, { fetchInit: { headers: authHeaders(token) }, retries: 2 });
    } catch (e) {
      return;
    }
    const code = node.code ?? null;
    const title = node?.title?.['@value'] ?? '';
    if (code && title) {
      const aliases = [];
      // Inclusion notes carry common alternative phrasings clinicians use.
      const inclusions = node.inclusion ?? [];
      for (const inc of Array.isArray(inclusions) ? inclusions : []) {
        const label = inc?.label?.['@value'];
        if (label && typeof label === 'string' && label.trim()) {
          aliases.push(label.trim());
        }
      }
      // Synonyms (ICD-11 carries these explicitly).
      const synonyms = node.synonym ?? [];
      for (const syn of Array.isArray(synonyms) ? synonyms : []) {
        const label = syn?.label?.['@value'];
        if (label && typeof label === 'string' && label.trim()) {
          aliases.push(label.trim());
        }
      }
      entries.push({ code: String(code), display: title.trim(), aliases });
      if (entries.length % 200 === 0) logProgress(opts.label, entries.length);
    }
    // Recurse into children
    const children = node.child ?? [];
    for (const childUri of Array.isArray(children) ? children : []) {
      if (typeof childUri === 'string') {
        await visit(childUri, depth + 1);
        if (entries.length >= maxNodes) return;
      }
    }
  }

  await visit(rootUri, 0);
  return entries;
}

export async function fetchIcd10() {
  const token = await getToken();
  const releaseId = '2019';
  const root = `${API_BASE}/icd/release/10/${releaseId}`;
  const entries = await walkHierarchy(token, root, { label: 'ICD-10', maxNodes: 20000 });
  logDone(`  ICD-10: ${entries.length} entries`);
  return {
    systemId: 'icd-10-who',
    system: DICTIONARY_SYSTEM_URLS['icd-10-who'],
    dictionaryVersion: `ICD10-WHO-${releaseId}`,
    entries,
  };
}

export async function fetchIcd11() {
  const token = await getToken();
  const releaseId = '2024-01';
  const root = `${API_BASE}/icd/release/11/${releaseId}/mms`;
  const entries = await walkHierarchy(token, root, { label: 'ICD-11', maxNodes: 25000 });
  logDone(`  ICD-11: ${entries.length} entries`);
  return {
    systemId: 'icd-11-who',
    system: DICTIONARY_SYSTEM_URLS['icd-11-who'],
    dictionaryVersion: `ICD11-${releaseId}`,
    entries,
  };
}
