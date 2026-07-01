/**
 * Parser/serializer for a task's `events` array.
 *
 * Common shape (the one our editor supports visually):
 *   events: [
 *     { id: 'foo_1week', days: 7, start: 2, end: 5 },
 *     { id: 'foo_1month', days: 30, start: 5, end: 7 }
 *   ]
 *
 * Some real configs use `events: someSchedule.map((s, i) => generateEvent(...))`
 * — that's a generator expression and we treat the whole thing as raw.
 *
 * An event can also carry a `dueDate: function (...) { ... }` instead of
 * the simple `days` integer; we expose both as a single union per event.
 */

import { jsSingleQuoteString } from './jsParser.js';

/**
 * Structured anchor for a `dueDate: (event, contact, report) => ...` shape we recognized.
 * `reported_date` = `report.reported_date`
 * `field`         = `Utils.getField(report, '<field>')`
 * `lmp`           = `Utils.getLmpDate(report)`  (dedicated helper; handles LMP path variance)
 */
export type EventAnchor =
  | { kind: 'reported_date' }
  | { kind: 'field'; field: string }
  | { kind: 'lmp' };

export interface EventOffset {
  value: number;
  unit: 'days' | 'weeks';
}

export interface SimpleEvent {
  /** Unique id of the event (e.g. 'pregnancy_v1'). Optional in source but encouraged. */
  id?: string;
  /** Days after the report's reported_date when this event is due. */
  days?: number;
  /** Window opens `start` days before the due date. */
  start?: number;
  /** Window closes `end` days after the due date. */
  end?: number;
  /**
   * Structured `dueDate` anchor + offset. Populated when the raw dueDate matches
   * one of the shapes in `parseDueDateExpr`. Mutually exclusive with `days` and
   * `dueDateRaw` (a shape we lifted structurally does not leave a raw copy).
   */
  anchor?: EventAnchor;
  offset?: EventOffset;
  /** Raw `dueDate: function(...) {...}` source if present (mutually exclusive with `days` + `anchor`). */
  dueDateRaw?: string;
  /** Any other key/value pairs we don't understand. Preserved verbatim. */
  extras: Record<string, string>;
}

export interface ParsedEvents {
  /** True if the source is an array literal of objects we successfully parsed. */
  shape: 'array' | 'raw';
  /** Populated when shape === 'array'. */
  events: SimpleEvent[];
  /** Populated when shape === 'raw' — the entire expression we couldn't lift. */
  raw: string;
}

/** Parse the raw text of an events value into structured form. */
export function parseEvents(source: string): ParsedEvents {
  const trimmed = source.trim();
  if (!trimmed.startsWith('[')) {
    return { shape: 'raw', events: [], raw: trimmed };
  }
  // Find balanced `[...]`.
  const end = matchBracket(trimmed, 0, '[', ']');
  if (end < 0) return { shape: 'raw', events: [], raw: trimmed };
  const inner = trimmed.slice(1, end);
  const objects = splitTopLevelObjects(inner);
  if (objects === null) return { shape: 'raw', events: [], raw: trimmed };

  const events: SimpleEvent[] = [];
  for (const objSrc of objects) {
    const evt = parseEventObject(objSrc);
    if (!evt) return { shape: 'raw', events: [], raw: trimmed };
    events.push(evt);
  }
  return { shape: 'array', events, raw: trimmed };
}

/** Serialize back to JS source text. */
export function serializeEvents(parsed: ParsedEvents): string {
  if (parsed.shape === 'raw') return parsed.raw;
  if (parsed.events.length === 0) return '[]';
  const lines = parsed.events.map((e) => `  ${serializeEvent(e)}`);
  return `[\n${lines.join(',\n')}\n]`;
}

function serializeEvent(e: SimpleEvent): string {
  const parts: string[] = [];
  // Single-quote (not JSON.stringify's double-quote) to match CHT's
  // eslint `quotes: ['error', 'single']` rule — cht-conf compile fails
  // if we emit double-quoted strings into tasks.js.
  if (e.id !== undefined) parts.push(`id: ${jsSingleQuoteString(e.id)}`);
  // Structured anchor/offset takes priority when present: emit dueDate.
  // Exception: reported_date + days unit → keep as plain `days:` to preserve
  // byte-stability of existing forms (do NOT rewrite plain events into dueDate).
  const structured = renderStructuredDueDate(e);
  if (structured !== null) {
    if (e.days !== undefined) parts.push(`days: ${e.days}`);
    parts.push(`dueDate: ${structured}`);
  } else if (e.anchor && e.offset && e.anchor.kind === 'reported_date' && e.offset.unit === 'days') {
    // reported_date + days = the plain-days case; emit `days:` and skip dueDate.
    parts.push(`days: ${e.offset.value}`);
  } else {
    if (e.days !== undefined) parts.push(`days: ${e.days}`);
    if (e.dueDateRaw) parts.push(`dueDate: ${e.dueDateRaw}`);
  }
  if (e.start !== undefined) parts.push(`start: ${e.start}`);
  if (e.end !== undefined) parts.push(`end: ${e.end}`);
  for (const [k, v] of Object.entries(e.extras)) parts.push(`${k}: ${v}`);
  return `{ ${parts.join(', ')} }`;
}

/**
 * Render a structured `dueDate: ...` arrow expression for an anchor+offset,
 * or null if the event isn't a structural dueDate case. Reported_date + days
 * is intentionally null (keeps plain `days:` for byte-stability).
 */
function renderStructuredDueDate(e: SimpleEvent): string | null {
  if (!e.anchor || !e.offset) return null;
  const days = e.offset.unit === 'weeks' ? e.offset.value * 7 : e.offset.value;
  if (e.anchor.kind === 'reported_date') {
    // Only emit dueDate for weeks unit — days stays as `days:` (see caller).
    if (e.offset.unit === 'weeks') {
      return `(event, contact, report) => Utils.addDate(report.reported_date, ${days})`;
    }
    return null;
  }
  if (e.anchor.kind === 'lmp') {
    return `(event, contact, report) => Utils.addDate(Utils.getLmpDate(report), ${days})`;
  }
  // field
  return `(event, contact, report) => Utils.addDate(new Date(Utils.getField(report, '${e.anchor.field}')), ${days})`;
}

function parseEventObject(src: string): SimpleEvent | null {
  const trimmed = src.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const body = trimmed.slice(1, -1);
  const event: SimpleEvent = { extras: {} };
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i] ?? '')) i++;
    const sk = skipNonCodeAt(body, i);
    if (sk !== null) { i = sk; continue; }
    if (i >= body.length) break;
    // Parse key.
    let key = '';
    if (body[i] === "'" || body[i] === '"') {
      const e2 = scanString(body, i, body[i] as string);
      key = body.slice(i + 1, e2 - 1);
      i = e2;
    } else {
      const m = /[a-zA-Z_$][\w$]*/.exec(body.slice(i));
      if (!m) return null;
      key = m[0];
      i += m[0].length;
    }
    while (i < body.length && /\s/.test(body[i] ?? '')) i++;
    if (body[i] !== ':') return null;
    i++;
    while (i < body.length && /\s/.test(body[i] ?? '')) i++;
    // Capture value up to top-level comma.
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
    const valueRaw = body.slice(valueStart, i).trim();
    classifyEventKey(event, key, valueRaw);
  }
  return event;
}

function classifyEventKey(event: SimpleEvent, key: string, valueRaw: string): void {
  const k = key.toLowerCase();
  if (k === 'id') {
    const m = /^['"]([^'"]*)['"]$/.exec(valueRaw);
    if (m && m[1] !== undefined) event.id = m[1];
    else event.extras[key] = valueRaw;
    return;
  }
  if (k === 'days' || k === 'start' || k === 'end') {
    const n = Number(valueRaw);
    if (!Number.isNaN(n)) {
      if (k === 'days') event.days = n;
      else if (k === 'start') event.start = n;
      else event.end = n;
      return;
    }
    event.extras[key] = valueRaw;
    return;
  }
  if (k === 'duedate' || k === 'dueDate') {
    // Try to lift into structured anchor+offset. Any shape we don't recognize
    // falls back to `dueDateRaw` (raw fallback preserves the user's expression
    // verbatim).
    const lifted = parseDueDateExpr(valueRaw);
    if (lifted) {
      event.anchor = lifted.anchor;
      event.offset = lifted.offset;
    } else {
      event.dueDateRaw = valueRaw;
    }
    return;
  }
  event.extras[key] = valueRaw;
}

/**
 * Try to lift a `dueDate` expression into structured anchor+offset. Recognized
 * shapes (whitespace-agnostic, param names ignored):
 *   (e, c, r) => Utils.addDate(new Date(Utils.getField(r, 'X')), N)  → field anchor
 *   (e, c, r) => Utils.addDate(Utils.getLmpDate(r), N)               → LMP anchor
 *   (e, c, r) => Utils.addDate(r.reported_date, N)                   → reported_date anchor
 *   function (e, c, r) { return Utils.addDate(...) }                 → same as above
 * `N` that's a multiple of 7 becomes weeks; else days. Returns null for anything else
 * (caller preserves the raw expression via `dueDateRaw`).
 */
export function parseDueDateExpr(
  expr: string,
): { anchor: EventAnchor; offset: EventOffset } | null {
  const body = extractArrowOrFunctionBody(expr);
  if (body === null) return null;
  // Extract the `Utils.addDate(<anchorExpr>, <days>)` call, ignoring whitespace.
  const call = /^Utils\.addDate\(\s*([\s\S]+?)\s*,\s*(-?\d+)\s*\)$/.exec(body.trim());
  if (!call || !call[1] || call[2] === undefined) return null;
  const anchorExpr = call[1].trim();
  const days = Number(call[2]);
  if (!Number.isFinite(days)) return null;
  const offset: EventOffset =
    days !== 0 && days % 7 === 0
      ? { value: days / 7, unit: 'weeks' }
      : { value: days, unit: 'days' };

  // report.reported_date  (any single-token param — 'report'/'r'/etc — we accept literal 'report' here since we normalized)
  if (/^[a-zA-Z_$][\w$]*\.reported_date$/.test(anchorExpr)) {
    return { anchor: { kind: 'reported_date' }, offset };
  }
  // Utils.getLmpDate(report)
  if (/^Utils\.getLmpDate\(\s*[a-zA-Z_$][\w$]*\s*\)$/.test(anchorExpr)) {
    return { anchor: { kind: 'lmp' }, offset };
  }
  // new Date(Utils.getField(report, 'X'))
  const fieldMatch = /^new\s+Date\(\s*Utils\.getField\(\s*[a-zA-Z_$][\w$]*\s*,\s*'([^']+)'\s*\)\s*\)$/.exec(
    anchorExpr,
  );
  if (fieldMatch && fieldMatch[1]) {
    return { anchor: { kind: 'field', field: fieldMatch[1] }, offset };
  }
  return null;
}

/**
 * Given an arrow (`(a, b, c) => body` or `x => body`) or `function (...) { return body }`,
 * return the body expression trimmed. Braced arrow bodies (`() => { return X }`) are
 * unwrapped. Anything else returns null (caller falls back to raw).
 */
function extractArrowOrFunctionBody(expr: string): string | null {
  const src = expr.trim();
  // Arrow: [(params)]? => body
  const arrow = /^(?:\(([^)]*)\)|([a-zA-Z_$][\w$]*))\s*=>\s*([\s\S]+)$/.exec(src);
  if (arrow) {
    const body = arrow[3]!.trim();
    // Braced body: unwrap { return X; }
    if (body.startsWith('{') && body.endsWith('}')) {
      const inner = body.slice(1, -1).trim();
      const ret = /^return\s+([\s\S]+?);?\s*$/.exec(inner);
      return ret && ret[1] ? ret[1].trim() : null;
    }
    return body;
  }
  // function (params) { return body; }
  const fn = /^function\s*[a-zA-Z_$]*\s*\(([^)]*)\)\s*\{([\s\S]*)\}\s*$/.exec(src);
  if (fn) {
    const inner = fn[2]!.trim();
    const ret = /^return\s+([\s\S]+?);?\s*$/.exec(inner);
    return ret && ret[1] ? ret[1].trim() : null;
  }
  return null;
}

/* ------------------------- helpers ------------------------- */

function matchBracket(src: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const sk = skipNonCodeAt(src, i);
    if (sk !== null) { i = sk - 1; continue; }
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

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
