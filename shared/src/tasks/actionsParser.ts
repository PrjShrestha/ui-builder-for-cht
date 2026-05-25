/**
 * Parser/serializer for a task's `actions` array.
 *
 * Canonical CHT shape (one or more entries):
 *   actions: [
 *     {
 *       type: 'report',                     // or 'contact'; defaults to 'report'
 *       form: 'back_pain_followup',
 *       modifyContent: function (content, contact, report, event) {
 *         content.visit = event.id;
 *         const dueDate = addDays(report.reported_date, event.days);
 *         content.current_period_start = addDays(dueDate, -event.start);
 *         content.current_period_end = addDays(dueDate, event.end);
 *       }
 *     }
 *   ]
 *
 * We recognize the canonical "pass visit window" modifyContent and surface
 * it as a single checkbox in the UI; any other modifyContent body is kept
 * verbatim in `customModifyContent`.
 */

export interface TaskAction {
  type?: 'report' | 'contact';
  form: string;
  /** True when modifyContent matches the canonical visit-window pattern. */
  passesVisitWindow: boolean;
  /** Raw modifyContent function source when it doesn't match the canonical pattern. */
  customModifyContent?: string;
  /** Any other keys preserved verbatim. */
  extras: Record<string, string>;
}

export interface ParsedActions {
  shape: 'array' | 'raw';
  actions: TaskAction[];
  raw: string;
}

const CANONICAL_VISIT_WINDOW_RE =
  /content\.visit\s*=\s*event\.id\s*;[\s\S]*?content\.current_period_start[\s\S]*?content\.current_period_end/;

export function parseActions(source: string): ParsedActions {
  const trimmed = source.trim();
  if (!trimmed.startsWith('[')) {
    return { shape: 'raw', actions: [], raw: trimmed };
  }
  const end = matchBracket(trimmed, 0, '[', ']');
  if (end < 0) return { shape: 'raw', actions: [], raw: trimmed };
  const inner = trimmed.slice(1, end);
  const objs = splitTopLevelObjects(inner);
  if (objs === null) return { shape: 'raw', actions: [], raw: trimmed };

  const actions: TaskAction[] = [];
  for (const o of objs) {
    const a = parseOneAction(o);
    if (!a) return { shape: 'raw', actions: [], raw: trimmed };
    actions.push(a);
  }
  return { shape: 'array', actions, raw: trimmed };
}

export function serializeActions(parsed: ParsedActions): string {
  if (parsed.shape === 'raw') return parsed.raw;
  if (parsed.actions.length === 0) return '[]';
  const items = parsed.actions.map(serializeOne);
  return `[${items.join(', ')}]`;
}

function serializeOne(a: TaskAction): string {
  const parts: string[] = [];
  if (a.type) parts.push(`type: '${a.type}'`);
  parts.push(`form: '${a.form}'`);
  if (a.passesVisitWindow) {
    parts.push(`modifyContent: function (content, contact, report, event) {
        content.visit = event.id;
        const dueDate = addDays(report.reported_date, event.days);
        content.current_period_start = addDays(dueDate, -event.start);
        content.current_period_end = addDays(dueDate, event.end);
      }`);
  } else if (a.customModifyContent) {
    parts.push(`modifyContent: ${a.customModifyContent}`);
  }
  for (const [k, v] of Object.entries(a.extras)) parts.push(`${k}: ${v}`);
  return `{ ${parts.join(', ')} }`;
}

function parseOneAction(src: string): TaskAction | null {
  const trimmed = src.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const body = trimmed.slice(1, -1);
  const out: TaskAction = { form: '', passesVisitWindow: false, extras: {} };
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i] ?? '')) i++;
    const sk = skipNonCodeAt(body, i);
    if (sk !== null) { i = sk; continue; }
    if (i >= body.length) break;
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
    classify(out, key, valueRaw);
  }
  return out;
}

function classify(action: TaskAction, key: string, raw: string): void {
  const k = key.toLowerCase();
  if (k === 'type') {
    const m = /^['"]([^'"]+)['"]$/.exec(raw);
    if (m && (m[1] === 'report' || m[1] === 'contact')) action.type = m[1];
    else action.extras[key] = raw;
    return;
  }
  if (k === 'form') {
    const m = /^['"]([^'"]+)['"]$/.exec(raw);
    if (m && m[1]) action.form = m[1];
    else action.extras[key] = raw;
    return;
  }
  if (k === 'modifycontent') {
    if (CANONICAL_VISIT_WINDOW_RE.test(raw)) {
      action.passesVisitWindow = true;
    } else {
      action.customModifyContent = raw;
    }
    return;
  }
  action.extras[key] = raw;
}

/* -------------------------- helpers -------------------------- */

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
