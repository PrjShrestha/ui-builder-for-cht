/**
 * Parser/serializer for a contact-summary `cards` array.
 *
 * The simple shape we lift into a structured `Card`:
 *
 *   {
 *     label: 'contact.profile.pregnancy.active',
 *     appliesToType: 'report',
 *     fields: [
 *       { label: 'Weeks Pregnant', value: someExpr },
 *       { label: 'EDD',            value: otherExpr }
 *     ]
 *   }
 *
 * Anything else — an imperative `fields: function (report) { ... }` body, a
 * card carrying a `modifyContext`, a `...spread` inside the array, or an entry
 * that isn't a bare object literal — is kept as a verbatim `RawCard` at the
 * entry level. If the whole array isn't a `[ ... ]` literal (e.g. `.map(...)`
 * generator), the entire expression is returned as `shape: 'raw'`, verbatim.
 *
 * The invariant this file exists to defend: parse → serialize → parse must be
 * byte-for-byte stable for entries we don't understand. That way the editor
 * can safely lift the parts it CAN edit while leaving imperative cards
 * untouched.
 */

export interface CardField {
  label: string;
  /** Raw JS expression for the value (never lifted — always verbatim). */
  valueRaw: string;
}

export interface Card {
  shape: 'card';
  label: string;
  appliesToType: string;
  fields: CardField[];
}

export interface RawCard {
  shape: 'raw';
  /** Verbatim source of the array entry, including surrounding whitespace/newlines is NOT included. */
  raw: string;
}

export interface ParsedCards {
  /** 'array' when the input parsed as an array literal, 'raw' otherwise. */
  shape: 'array' | 'raw';
  /** Populated when shape === 'array'. */
  cards: (Card | RawCard)[];
  /** The full input trimmed. Always populated so the serializer can echo raw shapes back. */
  raw: string;
}

/**
 * Locate the `cards` array literal inside a full `contact-summary.templated.js`
 * source. Returns the byte range of the `[` / `]` pair (inclusive) or null if
 * the file doesn't declare cards as a top-level array literal.
 *
 * Recognized shapes (checked in order):
 *   1. `const cards = [ ... ]` / `let cards = [ ... ]` / `var cards = [ ... ]`
 *   2. `cards: [ ... ]` inside the trailing `module.exports = { ... }` object
 */
export function findCardsArrayBounds(
  source: string,
): { start: number; end: number } | null {
  const declRe = /\b(?:const|let|var)\s+cards\s*=\s*\[/g;
  const m1 = declRe.exec(source);
  if (m1) {
    const openIdx = m1.index + m1[0].length - 1;
    const closeIdx = matchBracket(source, openIdx, '[', ']');
    if (closeIdx >= 0) return { start: openIdx, end: closeIdx };
  }
  const exportRe = /module\s*\.\s*exports\s*=\s*\{/g;
  let last = -1;
  let em: RegExpExecArray | null;
  while ((em = exportRe.exec(source)) !== null) last = em.index + em[0].length - 1;
  if (last >= 0) {
    const close = matchBracket(source, last, '{', '}');
    if (close > 0) {
      const inner = source.slice(last, close);
      const innerRe = /\bcards\s*:\s*\[/g;
      const im = innerRe.exec(inner);
      if (im) {
        const openIdx = last + im.index + im[0].length - 1;
        const closeIdx = matchBracket(source, openIdx, '[', ']');
        if (closeIdx >= 0) return { start: openIdx, end: closeIdx };
      }
    }
  }
  return null;
}

/**
 * Splice a serialized `cards` array back into the original source at the range
 * returned by `findCardsArrayBounds`. Returns the source unchanged if bounds
 * are null. Preserves every byte outside the array literal.
 */
export function spliceCards(source: string, parsed: ParsedCards): string {
  const bounds = findCardsArrayBounds(source);
  if (!bounds) return source;
  const before = source.slice(0, bounds.start);
  const after = source.slice(bounds.end + 1);
  return `${before}${serializeCards(parsed)}${after}`;
}

/** Parse the raw text of a `cards` value into structured form. */
export function parseCards(source: string): ParsedCards {
  const trimmed = source.trim();
  if (!trimmed.startsWith('[')) {
    return { shape: 'raw', cards: [], raw: trimmed };
  }
  const end = matchBracket(trimmed, 0, '[', ']');
  if (end < 0 || end !== trimmed.length - 1) {
    return { shape: 'raw', cards: [], raw: trimmed };
  }
  const inner = trimmed.slice(1, end);
  const entries = splitTopLevelObjects(inner);
  if (entries === null) {
    return { shape: 'raw', cards: [], raw: trimmed };
  }
  const cards: (Card | RawCard)[] = entries.map(liftCardEntry);
  return { shape: 'array', cards, raw: trimmed };
}

/** Serialize back to JS source text. */
export function serializeCards(parsed: ParsedCards): string {
  if (parsed.shape === 'raw') return parsed.raw;
  if (parsed.cards.length === 0) return '[]';
  // Raw entries are emitted verbatim so their bytes are preserved across a
  // parse → serialize round-trip. Structured entries get a canonical two-space
  // indentation. We don't re-indent raws — that would compound indentation on
  // every save, breaking byte-stability.
  const parts = parsed.cards.map((entry) =>
    entry.shape === 'raw' ? entry.raw : indent(serializeStructuredCard(entry), '  '),
  );
  return `[\n${parts.join(',\n')}\n]`;
}

function serializeStructuredCard(entry: Card): string {
  const inner: string[] = [];
  inner.push(`label: ${JSON.stringify(entry.label)}`);
  inner.push(`appliesToType: ${JSON.stringify(entry.appliesToType)}`);
  const fieldLines = entry.fields.map(
    (f) => `    { label: ${JSON.stringify(f.label)}, value: ${f.valueRaw} }`,
  );
  const fieldsBody = fieldLines.length === 0 ? '[]' : `[\n${fieldLines.join(',\n')}\n  ]`;
  inner.push(`fields: ${fieldsBody}`);
  return `{\n  ${inner.join(',\n  ')}\n}`;
}

function indent(src: string, prefix: string): string {
  return src
    .split('\n')
    .map((line) => (line.length === 0 ? line : prefix + line))
    .join('\n');
}

/**
 * Try to lift an object-literal source into a structured Card. Any deviation
 * from the recognized shape (label string, appliesToType string, fields array
 * of `{ label, value }` object literals) returns a RawCard preserving the
 * original entry source verbatim.
 */
function liftCardEntry(entrySrc: string): Card | RawCard {
  const trimmed = entrySrc.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return { shape: 'raw', raw: entrySrc };
  }
  const props = parseObjectProperties(trimmed.slice(1, -1));
  if (props === null) return { shape: 'raw', raw: entrySrc };

  // Recognized keys only: label, appliesToType, fields. Anything else forces raw.
  const recognized = new Set(['label', 'appliesToType', 'fields']);
  for (const p of props) {
    if (!recognized.has(p.key)) return { shape: 'raw', raw: entrySrc };
  }

  const labelProp = props.find((p) => p.key === 'label');
  const typeProp = props.find((p) => p.key === 'appliesToType');
  const fieldsProp = props.find((p) => p.key === 'fields');
  if (!labelProp || !typeProp || !fieldsProp) return { shape: 'raw', raw: entrySrc };

  const label = readStringLiteral(labelProp.valueRaw);
  const appliesToType = readStringLiteral(typeProp.valueRaw);
  if (label === null || appliesToType === null) return { shape: 'raw', raw: entrySrc };

  const fields = liftFieldsArray(fieldsProp.valueRaw);
  if (fields === null) return { shape: 'raw', raw: entrySrc };

  return { shape: 'card', label, appliesToType, fields };
}

function liftFieldsArray(valueRaw: string): CardField[] | null {
  const trimmed = valueRaw.trim();
  if (!trimmed.startsWith('[')) return null;
  const end = matchBracket(trimmed, 0, '[', ']');
  if (end < 0 || end !== trimmed.length - 1) return null;
  const inner = trimmed.slice(1, end);
  const entries = splitTopLevelObjects(inner);
  if (entries === null) return null;

  const out: CardField[] = [];
  for (const entrySrc of entries) {
    const e = entrySrc.trim();
    if (!e.startsWith('{') || !e.endsWith('}')) return null;
    const props = parseObjectProperties(e.slice(1, -1));
    if (props === null) return null;
    // A field entry may only carry `label` (string literal) and `value` (raw expression).
    // Any other key forces the whole cards array back into raw territory upstream.
    const allowed = new Set(['label', 'value']);
    for (const p of props) if (!allowed.has(p.key)) return null;
    const labelProp = props.find((p) => p.key === 'label');
    const valueProp = props.find((p) => p.key === 'value');
    if (!labelProp || !valueProp) return null;
    const label = readStringLiteral(labelProp.valueRaw);
    if (label === null) return null;
    out.push({ label, valueRaw: valueProp.valueRaw.trim() });
  }
  return out;
}

function readStringLiteral(raw: string): string | null {
  const s = raw.trim();
  if (s.length < 2) return null;
  const q = s[0];
  if (q !== "'" && q !== '"') return null;
  if (s[s.length - 1] !== q) return null;
  // Reject template literals or strings containing unescaped quotes of the same kind.
  const end = scanString(s, 0, q);
  if (end !== s.length) return null;
  // Trivial unescape of \\ and \' / \" — good enough for the labels seen in CHT configs.
  const body = s.slice(1, -1);
  return body.replace(/\\(['"\\])/g, '$1');
}

interface RawProp {
  key: string;
  valueRaw: string;
}

/**
 * Parse `key: value, key: value` — the object body without surrounding braces.
 * Returns null if the source doesn't parse cleanly (e.g. spread, shorthand,
 * computed key).
 */
function parseObjectProperties(body: string): RawProp[] | null {
  const out: RawProp[] = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i] ?? '')) i++;
    const sk = skipNonCodeAt(body, i);
    if (sk !== null) { i = sk; continue; }
    if (i >= body.length) break;
    // Reject spreads and computed keys — those are not the "simple shape".
    if (body[i] === '.' && body[i + 1] === '.' && body[i + 2] === '.') return null;
    if (body[i] === '[') return null;

    let key = '';
    if (body[i] === "'" || body[i] === '"') {
      const q = body[i] as string;
      const e = scanString(body, i, q);
      key = body.slice(i + 1, e - 1);
      i = e;
    } else {
      const m = /[a-zA-Z_$][\w$]*/.exec(body.slice(i));
      if (!m || m.index !== 0) return null;
      key = m[0];
      i += m[0].length;
    }
    while (i < body.length && /\s/.test(body[i] ?? '')) i++;
    if (body[i] !== ':') return null;
    i++;
    while (i < body.length && /\s/.test(body[i] ?? '')) i++;

    const valueStart = i;
    let depth = 0;
    while (i < body.length) {
      const sk2 = skipNonCodeAt(body, i);
      if (sk2 !== null) { i = sk2; continue; }
      const c = body[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0) break;
      i++;
    }
    out.push({ key, valueRaw: body.slice(valueStart, i) });
  }
  return out;
}

/**
 * Split an array body at top-level commas, yielding one string per entry. Any
 * non-object element (spread, ternary, function call, bare identifier)
 * degrades the whole array — the caller should treat this as an unparseable
 * cards[] and return `shape: 'raw'`.
 */
function splitTopLevelObjects(body: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i] ?? '')) i++;
    const sk = skipNonCodeAt(body, i);
    if (sk !== null) { i = sk; continue; }
    if (i >= body.length) break;
    if (body[i] !== '{') return null;
    const close = matchBracket(body, i, '{', '}');
    if (close < 0) return null;
    out.push(body.slice(i, close + 1));
    i = close + 1;
  }
  return out;
}

/* ------------------------- helpers ------------------------- */

function matchBracket(src: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const sk = skipNonCodeAt(src, i);
    if (sk !== null) { i = sk; continue; }
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function skipNonCodeAt(src: string, i: number): number | null {
  const c = src[i];
  if (c === '/' && src[i + 1] === '/') {
    const nl = src.indexOf('\n', i);
    return nl < 0 ? src.length : nl + 1;
  }
  if (c === '/' && src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2);
    return end < 0 ? src.length : end + 2;
  }
  if (c === "'" || c === '"' || c === '`') return scanString(src, i, c);
  return null;
}

function scanString(src: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === quote) return i + 1;
    if (quote === '`' && c === '$' && src[i + 1] === '{') {
      const close = matchBracket(src, i + 1, '{', '}');
      if (close < 0) return src.length;
      i = close + 1;
      continue;
    }
    i++;
  }
  return src.length;
}
