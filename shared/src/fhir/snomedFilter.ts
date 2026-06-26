/**
 * Zero-SNOMED guard. Two surfaces:
 *
 *   - `scanForSnomed(parsed, raw?)` — three-mode predicate (structural,
 *     stringified-leaf, raw-bytes). Used by `roundtrip.test.ts` to guard
 *     the bundled starter pack, AND by `parsedFormCache`-adjacent CI
 *     sampler that audits every vendored dictionary.
 *   - `dropSnomedAliases(aliases)` — pure helper used by snapshot source
 *     modules (esp. CIEL, which ships SNOMED cross-maps) to strip any
 *     alias that looks SNOMED-sourced *before* the entry hits the
 *     committed JSON.
 *
 * The two surfaces share the same needle set so a CIEL alias the filter
 * lets through can never re-trigger the scanner downstream — they fail in
 * lockstep, which is the contract the CI sampler tests.
 *
 * See docs/plans/fhir-pack-population.md "Zero-SNOMED filter is mandatory."
 */

const NEEDLES_CASE_SENSITIVE = [
  'snomed.info',
  '/sct',
  // The legacy HL7 OID for SNOMED-CT. Sometimes leaks through CIEL's
  // cross-map attributes even when the URL form isn't present.
  '2.16.840.1.113883.6.96',
] as const;
const NEEDLE_CASE_INSENSITIVE = 'snomed';

function checkString(s: string, path: string): string | null {
  for (const needle of NEEDLES_CASE_SENSITIVE) {
    if (s.includes(needle)) return `${path}: contains ${JSON.stringify(needle)}`;
  }
  if (s.toLowerCase().includes(NEEDLE_CASE_INSENSITIVE)) {
    return `${path}: contains case-insensitive 'snomed'`;
  }
  return null;
}

/**
 * Three-mode SNOMED predicate:
 *   (i)  recursive structural scan flagging any node where
 *        `system === 'http://snomed.info/sct'` or the OID appears,
 *   (ii) substring scan over ALL stringified leaf values for any of
 *        `snomed.info`, `/sct`, the OID, or a case-insensitive `snomed`
 *        token (catches free-text aliases / cross-map attributes),
 *   (iii) substring scan over the RAW committed file bytes (catches a
 *        token living in formatting/whitespace positions outside parsed
 *        values). Pass `rawBytes = ''` to skip this mode.
 */
export function scanForSnomed(
  parsed: unknown,
  rawBytes: string = '',
): { found: boolean; reason?: string } {
  function walk(v: unknown, path: string): string | null {
    if (typeof v === 'string') return checkString(v, path);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const r = walk(v[i], `${path}[${i}]`);
        if (r) return r;
      }
      return null;
    }
    if (v !== null && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const r = walk(val, path === '' ? k : `${path}.${k}`);
        if (r) return r;
      }
      return null;
    }
    return null;
  }

  const structuralOrLeaf = walk(parsed, '');
  if (structuralOrLeaf) return { found: true, reason: structuralOrLeaf };

  if (rawBytes) {
    const rawCheck = checkString(rawBytes, '<raw bytes>');
    if (rawCheck) return { found: true, reason: rawCheck };
  }

  return { found: false };
}

/**
 * Strip any alias that looks SNOMED-sourced. Pure: returns a new array.
 * Used by CIEL's source module before the entry hits the committed JSON.
 */
export function dropSnomedAliases(aliases: readonly string[]): string[] {
  return aliases.filter((a) => checkString(a, '') === null);
}

/**
 * Predicate form for callers that need to drop entire entries (e.g. when
 * a source's record has a system URL that resolves to SNOMED).
 */
export function isSnomedString(s: string): boolean {
  return checkString(s, '') !== null;
}
