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

export interface SimpleEvent {
  /** Unique id of the event (e.g. 'pregnancy_v1'). Optional in source but encouraged. */
  id?: string;
  /** Days after the report's reported_date when this event is due. */
  days?: number;
  /** Window opens `start` days before the due date. */
  start?: number;
  /** Window closes `end` days after the due date. */
  end?: number;
  /** Raw `dueDate: function(...) {...}` source if present (mutually exclusive with `days`). */
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
  if (e.id !== undefined) parts.push(`id: ${JSON.stringify(e.id)}`);
  if (e.days !== undefined) parts.push(`days: ${e.days}`);
  if (e.start !== undefined) parts.push(`start: ${e.start}`);
  if (e.end !== undefined) parts.push(`end: ${e.end}`);
  if (e.dueDateRaw) parts.push(`dueDate: ${e.dueDateRaw}`);
  for (const [k, v] of Object.entries(e.extras)) parts.push(`${k}: ${v}`);
  return `{ ${parts.join(', ')} }`;
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
    event.dueDateRaw = valueRaw;
    return;
  }
  event.extras[key] = valueRaw;
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
