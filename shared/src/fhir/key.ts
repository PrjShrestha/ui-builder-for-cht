/**
 * Sidecar key codec.
 *
 * Layer boundary: `formId` is constructed at the server as
 * `${category}:${basename}` (`server/src/routes/forms.ts:22`, where
 * `parseFormId` does `rest.join(':')` so a basename may legally contain `:`).
 * The form route URL-decodes the id (`decodeURIComponent`, `forms.ts:163`)
 * before it reaches this codec, so the codec's percent-encoding is the
 * single canonical on-disk encoding layer. The XLSForm parser never
 * produces `formId` — that is solely the server's construction.
 *
 * Encoding contract:
 * - Each segment percent-encodes `%` → `%25` first, then `/` → `%2F`.
 * - `:` is intentionally NOT escaped (formId may legally contain it).
 * - Segments are joined with literal `/`.
 *
 * Properties (proven by tests):
 * - Injective: distinct input tuples always produce distinct encoded strings.
 * - Canonical: the decoder is the exact inverse of the encoder for every
 *   valid input.
 * - Orphan-match safe: the codec is the ONLY way to produce live keys for
 *   `reconcileFhirMapping`. String concatenation of `formId + '/' + name`
 *   is forbidden — a name legally containing `/` or `%` would fail to
 *   byte-match the escaped on-disk key and a confirmed, still-live binding
 *   would be silently relocated to `orphans[]` (a false-orphan data-loss bug).
 */

function encodeSegment(segment: string): string {
  let out = '';
  for (let i = 0; i < segment.length; i++) {
    const ch = segment.charAt(i);
    if (ch === '%') out += '%25';
    else if (ch === '/') out += '%2F';
    else out += ch;
  }
  return out;
}

function decodeSegment(segment: string): string {
  let out = '';
  let i = 0;
  while (i < segment.length) {
    const ch = segment.charAt(i);
    if (ch === '%' && i + 3 <= segment.length) {
      const hex = segment.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 3;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

export function encodeQuestionKey(formId: string, name: string): string {
  return `${encodeSegment(formId)}/${encodeSegment(name)}`;
}

export function decodeQuestionKey(key: string): { formId: string; name: string } {
  // The only unescaped `/` in the encoded form is the separator (every `/`
  // inside a segment was percent-encoded to `%2F` by encodeSegment), so
  // splitting at the FIRST unescaped `/` is unambiguous and recovers
  // the segment boundary even when `formId` itself contains `/`.
  const idx = key.indexOf('/');
  if (idx === -1) {
    throw new Error(`Invalid question key (missing separator): ${key}`);
  }
  return {
    formId: decodeSegment(key.slice(0, idx)),
    name: decodeSegment(key.slice(idx + 1)),
  };
}

export function encodeChoiceKey(formId: string, list_name: string, name: string): string {
  return `${encodeSegment(formId)}/${encodeSegment(list_name)}/${encodeSegment(name)}`;
}

export function decodeChoiceKey(key: string): { formId: string; list_name: string; name: string } {
  const first = key.indexOf('/');
  if (first === -1) {
    throw new Error(`Invalid choice key (missing first separator): ${key}`);
  }
  const second = key.indexOf('/', first + 1);
  if (second === -1) {
    throw new Error(`Invalid choice key (missing second separator): ${key}`);
  }
  return {
    formId: decodeSegment(key.slice(0, first)),
    list_name: decodeSegment(key.slice(first + 1, second)),
    name: decodeSegment(key.slice(second + 1)),
  };
}
