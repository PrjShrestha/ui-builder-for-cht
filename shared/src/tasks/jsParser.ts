/**
 * Lightweight extractor for the structured-looking JS in tasks.js,
 * targets.js, and contact-summary.templated.js.
 *
 * The full tasks.js is JavaScript, so anything we do here is best-effort.
 * The MVP strategy:
 *   1. Find the top-level `module.exports = [ ... ]` array literal.
 *   2. For each object inside it, extract simple keyed values (name, title,
 *      icon, appliesTo, appliesToType, events, actions).
 *   3. For function-valued keys (appliesIf, resolvedIf, dueDate, modifyContent,
 *      passesIf), keep them as RAW source text. The UI shows them in a code
 *      editor; later passes try to lift the common patterns into a rule
 *      builder.
 *   4. On save, we never round-trip through a JS AST. Instead we use byte-
 *      range edits: read the original file, replace the structured object
 *      with a regenerated version that preserves the function bodies.
 *
 * Why this approach: anything more aggressive (acorn-based AST round-trip)
 * loses comments, formatting, and helper imports. cht-conf devs care about
 * their helpers. The MVP is editing only what we can see we can edit safely.
 */

export interface ParsedTaskFile {
  /** The entire original source text. */
  source: string;
  /** Bounds of the `module.exports = [ ... ]` array literal in `source`. */
  arrayBounds: { start: number; end: number } | null;
  /** Each entry corresponds to one element in the array. */
  entries: TaskEntry[];
}

export interface TaskEntry {
  /** Original byte bounds inside `source` (the object literal { ... }, inclusive of braces). */
  bounds: { start: number; end: number };
  /** The full source text between bounds. */
  source: string;
  /** Parsed keys we recognize. */
  fields: Record<string, FieldValue>;
}

export type FieldValue =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'identifier'; value: string }
  | { kind: 'array'; raw: string }
  | { kind: 'object'; raw: string }
  | { kind: 'function'; raw: string }
  | { kind: 'unknown'; raw: string };

/** Extract entries from a tasks.js / targets.js / similar source string. */
export function parseTaskFile(source: string): ParsedTaskFile {
  const arrayBounds = findExportArrayBounds(source);
  if (!arrayBounds) return { source, arrayBounds: null, entries: [] };
  const entries = splitArrayObjects(source, arrayBounds.start + 1, arrayBounds.end);
  const parsedEntries: TaskEntry[] = entries.map((e) => ({
    bounds: e.bounds,
    source: e.source,
    fields: parseObjectFields(e.source),
  }));
  return { source, arrayBounds, entries: parsedEntries };
}

/**
 * Locate `module.exports = [ ... ]` and return the start/end indices of
 * the `[`/`]` pair. Returns null if the file doesn't follow this shape.
 */
function findExportArrayBounds(src: string): { start: number; end: number } | null {
  // Look for `module.exports = [` or `module.exports=[` allowing whitespace.
  const re = /module\s*\.\s*exports\s*=\s*\[/g;
  const m = re.exec(src);
  if (!m) return null;
  const openIdx = m.index + m[0].length - 1;
  const closeIdx = matchBracket(src, openIdx, '[', ']');
  if (closeIdx < 0) return null;
  return { start: openIdx, end: closeIdx };
}

/** Given that `src[openIdx] === open`, find the index of the matching close. */
function matchBracket(src: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const c = src[i];
    if (c === undefined) return -1;
    // Skip strings, regex literals, comments, and template literals.
    const skipped = skipNonCodeAt(src, i);
    if (skipped !== null) {
      i = skipped;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Return index *after* a non-code span starting at i, or null if none. */
function skipNonCodeAt(src: string, i: number): number | null {
  const c = src[i];
  // Single-line comment.
  if (c === '/' && src[i + 1] === '/') {
    const nl = src.indexOf('\n', i);
    return nl < 0 ? src.length : nl + 1;
  }
  // Block comment.
  if (c === '/' && src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2);
    return end < 0 ? src.length : end + 2;
  }
  // Strings.
  if (c === "'" || c === '"' || c === '`') {
    return scanString(src, i, c);
  }
  return null;
}

function scanString(src: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    // Template literal expression `${ ... }`.
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

/** Split the body of an array literal at top-level commas, yielding objects. */
function splitArrayObjects(
  src: string,
  bodyStart: number,
  bodyEnd: number,
): Array<{ bounds: { start: number; end: number }; source: string }> {
  const entries: Array<{ bounds: { start: number; end: number }; source: string }> = [];
  let i = bodyStart;
  while (i < bodyEnd) {
    // Skip whitespace, commas, comments, and string literals between entries.
    let progressed = true;
    while (progressed && i < bodyEnd) {
      progressed = false;
      while (i < bodyEnd && /[\s,]/.test(src[i] ?? '')) {
        i++;
        progressed = true;
      }
      const sk = skipNonCodeAt(src, i);
      if (sk !== null && sk > i) {
        i = sk;
        progressed = true;
      }
    }
    if (i >= bodyEnd) break;
    if (src[i] !== '{') {
      // Unexpected garbage. Walk one char and retry — comments / strings
      // were already skipped above so this is genuinely odd content.
      i++;
      continue;
    }
    const close = matchBracket(src, i, '{', '}');
    if (close < 0 || close > bodyEnd) break;
    entries.push({
      bounds: { start: i, end: close },
      source: src.slice(i, close + 1),
    });
    i = close + 1;
  }
  return entries;
}

/**
 * Parse `{ key: value, ... }` into a Record<key, FieldValue>. Best-effort
 * over a small grammar: string literals, numeric literals, booleans, simple
 * identifiers, function expressions, array literals, nested object literals.
 */
export function parseObjectFields(src: string): Record<string, FieldValue> {
  const trimmed = src.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return {};
  const body = trimmed.slice(1, -1);
  const out: Record<string, FieldValue> = {};
  let i = 0;
  while (i < body.length) {
    // skip whitespace and commas.
    while (i < body.length && /[\s,]/.test(body[i] ?? '')) i++;
    // skip comments
    const sk = skipNonCodeAt(body, i);
    if (sk !== null) {
      i = sk;
      continue;
    }
    if (i >= body.length) break;
    // Key: identifier or string.
    let key: string | null = null;
    if (body[i] === "'" || body[i] === '"') {
      const stringEnd = scanString(body, i, body[i] as string);
      key = body.slice(i + 1, stringEnd - 1);
      i = stringEnd;
    } else {
      const m = /[a-zA-Z_$][a-zA-Z0-9_$]*/.exec(body.slice(i));
      if (!m) {
        i++;
        continue;
      }
      key = m[0];
      i += m[0].length;
    }
    // Skip whitespace and ':' then value.
    while (i < body.length && /[\s]/.test(body[i] ?? '')) i++;
    if (body[i] !== ':') continue;
    i++;
    while (i < body.length && /[\s]/.test(body[i] ?? '')) i++;
    const start = i;
    // Determine value extent.
    const ch = body[i];
    let value: FieldValue;
    if (ch === "'" || ch === '"' || ch === '`') {
      const endIdx = scanString(body, i, ch);
      value = { kind: 'string', value: body.slice(i + 1, endIdx - 1) };
      i = endIdx;
    } else if (ch === '[') {
      const end = matchBracket(body, i, '[', ']');
      const raw = body.slice(i, end + 1);
      value = { kind: 'array', raw };
      i = end + 1;
    } else if (ch === '{') {
      const end = matchBracket(body, i, '{', '}');
      const raw = body.slice(i, end + 1);
      value = { kind: 'object', raw };
      i = end + 1;
    } else if (/[0-9-]/.test(ch ?? '')) {
      const m = /^-?\d+(?:\.\d+)?/.exec(body.slice(i));
      if (m) {
        value = { kind: 'number', value: parseFloat(m[0]) };
        i += m[0].length;
      } else {
        value = { kind: 'unknown', raw: scanUntilTopComma(body, i) };
        i = start + value.raw.length;
      }
    } else {
      // Could be: function, arrow function, identifier, boolean, etc.
      // Scan to next top-level comma to capture the whole expression.
      const raw = scanUntilTopComma(body, i);
      if (raw === 'true') value = { kind: 'boolean', value: true };
      else if (raw === 'false') value = { kind: 'boolean', value: false };
      else if (
        raw.startsWith('function') ||
        /^\(.*?\)\s*=>/s.test(raw) ||
        /^[a-zA-Z_$][\w$]*\s*=>/.test(raw)
      ) {
        value = { kind: 'function', raw };
      } else if (/^[a-zA-Z_$][\w$]*$/.test(raw)) {
        value = { kind: 'identifier', value: raw };
      } else {
        value = { kind: 'unknown', raw };
      }
      i += raw.length;
    }
    out[key] = value;
  }
  return out;
}

/** Read raw characters from `i` until a top-level (depth-0) comma. */
function scanUntilTopComma(src: string, i: number): string 
{
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const sk = skipNonCodeAt(src, j);
    if (sk !== null) {
      j = sk;
      continue;
    }
    const c = src[j];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) break;
    j++;
  }
  return src.slice(i, j).trim();
}
