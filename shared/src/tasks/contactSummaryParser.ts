/**
 * Lightweight parser for `contact-summary.templated.js`.
 *
 * Targets the canonical CHT pattern:
 *   const context = {
 *     show_pregnancy_form: isReadyForNewPregnancy(contact, reports),
 *     ...
 *   };
 *
 * Fallback: `context: { ... }` inside the LAST `return { ... }` statement.
 */

export interface ParsedContactSummary {
  source: string;
  contextBounds: { start: number; end: number } | null;
  contextFlags: Record<string, string>;
  contextOrder: string[];
}

export function parseContactSummary(source: string): ParsedContactSummary {
  const ctxBounds = findContextObjectBounds(source);
  if (!ctxBounds) return { source, contextBounds: null, contextFlags: {}, contextOrder: [] };
  const inner = source.slice(ctxBounds.start + 1, ctxBounds.end);
  const { flags, order } = parseFlagsObject(inner);
  return { source, contextBounds: ctxBounds, contextFlags: flags, contextOrder: order };
}

export function serializeContactSummary(
  parsed: ParsedContactSummary,
  nextFlags: Record<string, string>,
  nextOrder: string[],
): string {
  if (!parsed.contextBounds) return parsed.source;
  const lines: string[] = [];
  for (const key of nextOrder) {
    if (!(key in nextFlags)) continue;
    const keyOut = /^[a-zA-Z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
    lines.push(`  ${keyOut}: ${nextFlags[key]}`);
  }
  const before = parsed.source.slice(0, parsed.contextBounds.start);
  const after = parsed.source.slice(parsed.contextBounds.end + 1);
  return `${before}{\n${lines.join(',\n')}\n}${after}`;
}

function findContextObjectBounds(src: string): { start: number; end: number } | null {
  const declRe = /\b(?:const|let|var)\s+context\s*=\s*\{/g;
  const m1 = declRe.exec(src);
  if (m1) {
    const openIdx = m1.index + m1[0].length - 1;
    const closeIdx = matchBracket(src, openIdx, '{', '}');
    if (closeIdx >= 0) return { start: openIdx, end: closeIdx };
  }
  const returnRe = /\breturn\s*\{/g;
  let lastReturnIdx = -1;
  let rm: RegExpExecArray | null;
  while ((rm = returnRe.exec(src)) !== null) lastReturnIdx = rm.index;
  if (lastReturnIdx >= 0) {
    const returnOpen = src.indexOf('{', lastReturnIdx);
    const returnClose = matchBracket(src, returnOpen, '{', '}');
    if (returnClose > 0) {
      const inner = src.slice(returnOpen, returnClose);
      const innerCtxRe = /\bcontext\s*:\s*\{/g;
      const m2 = innerCtxRe.exec(inner);
      if (m2) {
        const openIdx = returnOpen + m2.index + m2[0].length - 1;
        const closeIdx = matchBracket(src, openIdx, '{', '}');
        if (closeIdx >= 0) return { start: openIdx, end: closeIdx };
      }
    }
  }
  return null;
}

function matchBracket(src: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const sk = skipNonCodeAt(src, i);
    if (sk !== null) { i = sk; continue; }
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
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

function parseFlagsObject(inner: string): { flags: Record<string, string>; order: string[] } {
  const flags: Record<string, string> = {};
  const order: string[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i] ?? '')) i++;
    const sk = skipNonCodeAt(inner, i);
    if (sk !== null) { i = sk; continue; }
    if (i >= inner.length) break;
    let key: string | null = null;
    if (inner[i] === "'" || inner[i] === '"') {
      const stringEnd = scanString(inner, i, inner[i] as string);
      key = inner.slice(i + 1, stringEnd - 1);
      i = stringEnd;
    } else {
      const m = /[a-zA-Z_$][\w$]*/.exec(inner.slice(i));
      if (!m) { i++; continue; }
      key = m[0];
      i += m[0].length;
    }
    while (i < inner.length && /[\s]/.test(inner[i] ?? '')) i++;
    if (inner[i] !== ':') continue;
    i++;
    while (i < inner.length && /[\s]/.test(inner[i] ?? '')) i++;
    const valueStart = i;
    let depth = 0;
    while (i < inner.length) {
      const sk2 = skipNonCodeAt(inner, i);
      if (sk2 !== null) { i = sk2; continue; }
      const c = inner[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0) break;
      i++;
    }
    const valueRaw = inner.slice(valueStart, i).trim();
    flags[key] = valueRaw;
    order.push(key);
  }
  return { flags, order };
}
