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

/** One structured mapping in a modifyContent body — `content.<target> =
 *  <sourceExpr>;`. The `sourceExpr` is kept as a literal string (e.g.
 *  `report.field_name`, `event.id`, `'literal'`) so the UI can render
 *  it without re-parsing. See form-data-passing.md §3 Phase 2a. */
export interface ModifyContentMapping {
  /** The `<field>` in `content.<field> = …;` — must be a JS identifier. */
  targetField: string;
  /** The RHS expression as written — usually `report.X`, `event.Y`, or
   *  a literal. The parser preserves bytes verbatim so the round-trip is
   *  byte-stable for any expression `tryParseSimpleMappings` accepts. */
  sourceExpr: string;
}

export interface TaskAction {
  type?: 'report' | 'contact';
  form: string;
  /** True when modifyContent matches the canonical visit-window pattern. */
  passesVisitWindow: boolean;
  /** Phase 2a — when modifyContent is a function whose body is a flat
   *  sequence of `content.<field> = <expr>;` assignments and NOTHING
   *  else (no if/forEach/ternary/Object.entries/function-calls), it
   *  parses to this structured mapping. Precedence in `classify`:
   *  visit-window > mappings > custom raw. When the UI deletes the last
   *  mapping it MUST set this to `undefined` (not `[]`) so the
   *  serializer routes back to a clean fallback path. */
  modifyContentMappings?: ModifyContentMapping[];
  /** Raw modifyContent function source when it doesn't match either of
   *  the structured patterns above. The §3.1-style raw-fallback escape
   *  hatch — user code is never lost on save. */
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

/**
 * Phase 2a — recognize a modifyContent function body whose every
 * statement is `content.<identifier> = <safe-expr>;` and nothing else.
 *
 * Patterns accepted (case-insensitive function/arrow):
 *   function (content, contact, report, event) { content.X = report.x; }
 *   function (content, contact, report)        { content.X = event.id; }
 *   (content, contact, report, event) => { content.X = report.x; ... }
 *
 * Returns null (the caller falls through to `customModifyContent`) when
 * the body contains any of:
 *   - `if`, `else`, `for`, `while`, `switch`, `return`
 *   - `forEach`, `Object.entries`, `Object.assign`, `.map(`
 *   - ternaries (`?` outside a string)
 *   - function-call statements that aren't a simple identifier-or-
 *     member-access RHS of `content.X = <expr>;`
 *
 * The conservative-by-default reject-list is the load-bearing safety net
 * documented in the critical-gotchas list: real config-nssd / cht-default
 * tasks use ALL of these patterns at production scale (lines 205-228,
 * 495-500, 638-641 in the real corpus); misclassifying any of them as
 * structured would destroy user code on save.
 */
export function tryParseSimpleMappings(raw: string): ModifyContentMapping[] | null {
  const trimmed = raw.trim();
  // Match function-decl or arrow body; capture the body bytes.
  // Function-decl:  `function (...) { BODY }`
  // Arrow:          `(...) => { BODY }`  (with or without parens — but
  //                   without parens we can't get args, so require parens
  //                   to match the canonical CHT spelling).
  let body: string | null = null;
  const funcMatch =
    /^function\s*\(([^)]*)\)\s*\{([\s\S]*)\}\s*$/.exec(trimmed);
  if (funcMatch) {
    body = funcMatch[2] ?? '';
  } else {
    const arrowMatch = /^\(([^)]*)\)\s*=>\s*\{([\s\S]*)\}\s*$/.exec(trimmed);
    if (arrowMatch) body = arrowMatch[2] ?? '';
  }
  if (body === null) return null;

  // Reject keyword/control-flow tokens at any position. Word-boundary
  // matches keep us from rejecting `if_` (unlikely but defensive).
  // The .map( pattern uses no word boundary since `.` ends the word.
  if (
    /\b(if|else|for|while|switch|return|do)\b/.test(body) ||
    /\bforEach\b/.test(body) ||
    /\bObject\.(entries|assign|keys|values)\b/.test(body) ||
    /\.map\(/.test(body) ||
    // Ternary `?` outside a string. The body's strings are
    // tokenized below; here we do a cheap regex check on the body
    // stripped of strings. If there are no quotes the check is exact.
    /\?[^']/.test(body.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, ''))
  ) {
    return null;
  }

  // Split body into top-level statements at semicolons. We don't allow
  // multi-line expressions, so each non-empty trimmed segment must be a
  // `content.<id> = <expr>` assignment.
  const mappings: ModifyContentMapping[] = [];
  const statements = body
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    const m = /^content\.([a-zA-Z_$][\w$]*)\s*=\s*(.+)$/.exec(stmt);
    if (!m) return null;
    const targetField = m[1]!;
    const sourceExpr = m[2]!.trim();
    // The RHS must NOT contain function-call parens unless they're a
    // helper that the v1 reject-list above already allows through.
    // Cheap heuristic: reject any `(` that isn't immediately preceded
    // by a `.` chain that we explicitly know is safe. v1 plays it safe
    // and rejects all `(` — real configs use `report.field` /
    // `event.id` / literals, not helper calls inline.
    if (/\(/.test(sourceExpr)) return null;
    mappings.push({ targetField, sourceExpr });
  }
  if (mappings.length === 0) return null;
  return mappings;
}

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
  } else if (a.modifyContentMappings && a.modifyContentMappings.length > 0) {
    // Phase 2a structured mappings. Indentation matches the visit-
    // window literal above EXACTLY (8 spaces for the body, 6 for the
    // closing brace) so round-trip is byte-stable against forms that
    // were authored by hand and saved through this serializer.
    const lines = a.modifyContentMappings
      .map((m) => `        content.${m.targetField} = ${m.sourceExpr};`)
      .join('\n');
    parts.push(
      `modifyContent: function (content, contact, report, event) {\n${lines}\n      }`,
    );
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
    // Precedence (load-bearing — flipping the order risks the canonical
    // visit-window pattern being misread as 4 simple assignments):
    //   1. Visit-window canonical pattern wins.
    //   2. Phase 2a structured mappings (flat content.X = expr; sequence).
    //   3. Fall through to opaque customModifyContent.
    if (CANONICAL_VISIT_WINDOW_RE.test(raw)) {
      action.passesVisitWindow = true;
      return;
    }
    const mappings = tryParseSimpleMappings(raw);
    if (mappings) {
      action.modifyContentMappings = mappings;
      return;
    }
    action.customModifyContent = raw;
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
