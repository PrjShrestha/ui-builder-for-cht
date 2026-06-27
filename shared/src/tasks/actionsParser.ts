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
  /** Original function argument list, captured during parsing so the
   *  serializer can emit the same arity on round-trip. Real configs use
   *  both `function (content)` (1 arg) and the canonical
   *  `function (content, contact, report, event)` (4 args); auto-
   *  inflating the short form would silently rewrite the bytes on save.
   *  Only populated when modifyContentMappings is set; ignored
   *  otherwise. */
  modifyContentArgs?: string;
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
/**
 * Replace every string literal (single, double, backtick) in `src` with
 * an equal-length run of `_` so positions stay stable and downstream
 * regex / split logic never sees content that's actually inside strings.
 * Handles backslash-escapes inside quotes. Template-string ${…}
 * interpolations are NOT followed (rare in tasks.js; if a real config
 * uses them in modifyContent we'd reject for safety via the leftover
 * keyword check, which is the desired conservative outcome).
 *
 * Used by `tryParseSimpleMappings` to keep BUGs #2/#3/#4 from the
 * adversarial review fixed:
 *   - semicolons inside strings no longer split statements
 *   - `do` / `if` / `for` / `?` inside strings no longer trigger reject
 */
function stripStringContents(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      out += c;
      let j = i + 1;
      while (j < src.length) {
        const ch = src[j];
        if (ch === '\\' && j + 1 < src.length) {
          out += '__';
          j += 2;
          continue;
        }
        if (ch === c) {
          out += ch;
          j++;
          break;
        }
        out += '_';
        j++;
      }
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Result of recognizing a function/arrow modifyContent shape, with
 *  the original arg list preserved for byte-stable round-trip. */
interface ParsedMappingFn {
  body: string;
  /** Verbatim argument list, e.g. `'content'` or
   *  `'content, contact, report, event'`. The serializer emits this
   *  unchanged so a hand-written `function (content)` doesn't get
   *  inflated to 4 args on save. */
  args: string;
}

function recognizeMappingFn(trimmed: string): ParsedMappingFn | null {
  const funcMatch = /^function\s*\(([^)]*)\)\s*\{([\s\S]*)\}\s*$/.exec(trimmed);
  if (funcMatch) {
    return { args: (funcMatch[1] ?? '').trim(), body: funcMatch[2] ?? '' };
  }
  const arrowMatch = /^\(([^)]*)\)\s*=>\s*\{([\s\S]*)\}\s*$/.exec(trimmed);
  if (arrowMatch) {
    return { args: (arrowMatch[1] ?? '').trim(), body: arrowMatch[2] ?? '' };
  }
  return null;
}

export function tryParseSimpleMappings(raw: string): ModifyContentMapping[] | null {
  const result = tryParseSimpleMappingsFull(raw);
  return result ? result.mappings : null;
}

/** Internal entry that also returns the original arg list so the caller
 *  can stash it on the action for byte-stable serialization. */
export function tryParseSimpleMappingsFull(
  raw: string,
): { mappings: ModifyContentMapping[]; args: string } | null {
  const trimmed = raw.trim();
  const fn = recognizeMappingFn(trimmed);
  if (!fn) return null;
  const { body } = fn;

  // Strip string CONTENTS (positions preserved) so every regex below
  // sees code only. Bug #2/#3/#4 — keywords / semicolons / ternaries
  // inside strings should never trigger control-flow rejection or
  // mis-split a statement.
  const stripped = stripStringContents(body);

  // Reject keyword/control-flow tokens (now safe — strings stripped).
  // `.map(` has no word boundary since `.` ends the word.
  if (
    /\b(if|else|for|while|switch|return|do)\b/.test(stripped) ||
    /\bforEach\b/.test(stripped) ||
    /\bObject\.(entries|assign|keys|values)\b/.test(stripped) ||
    /\.map\(/.test(stripped) ||
    /\?/.test(stripped)
  ) {
    return null;
  }

  // Split body into top-level statements at semicolons. Use the
  // STRIPPED body for the split points but slice from the ORIGINAL
  // body so sourceExpr string literals are preserved verbatim.
  const mappings: ModifyContentMapping[] = [];
  let cursor = 0;
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] !== ';') continue;
    const segment = body.slice(cursor, i).trim();
    cursor = i + 1;
    if (segment.length === 0) continue;
    const m = /^content\.([a-zA-Z_$][\w$]*)\s*=\s*(.+)$/s.exec(segment);
    if (!m) return null;
    const targetField = m[1]!;
    const sourceExpr = m[2]!.trim();
    // RHS may NOT contain any function-call parens. v1 stays
    // conservative — real configs use `report.field` / `event.id` /
    // literals, never inline helper calls. Check on the stripped form
    // so a string like `'name(value)'` doesn't false-trigger.
    if (/\(/.test(stripStringContents(sourceExpr))) return null;
    mappings.push({ targetField, sourceExpr });
  }
  // Trailing segment after the last semicolon (allow a body without a
  // terminal `;`).
  const tail = body.slice(cursor).trim();
  if (tail.length > 0) {
    const m = /^content\.([a-zA-Z_$][\w$]*)\s*=\s*(.+)$/s.exec(tail);
    if (!m) return null;
    if (/\(/.test(stripStringContents(m[2]!.trim()))) return null;
    mappings.push({ targetField: m[1]!, sourceExpr: m[2]!.trim() });
  }
  if (mappings.length === 0) return null;
  return { mappings, args: fn.args };
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
    //
    // Drop rows whose targetField is empty — the UI can leave incomplete
    // "+ Add mapping" rows in state; emitting `content. = …` would be
    // syntactically invalid JS. The UI prevents this in v1 (the new
    // mapping doesn't reach onChange until both fields have content),
    // but the serializer also defends in depth.
    const usable = a.modifyContentMappings.filter(
      (m) => m.targetField.trim() !== '' && m.sourceExpr.trim() !== '',
    );
    if (usable.length === 0) {
      // All rows were empty — fall through to customModifyContent (or
      // emit nothing if neither is set). Defensive: keeps a round-trip
      // through a transient blank-row state from silently corrupting.
      if (a.customModifyContent) parts.push(`modifyContent: ${a.customModifyContent}`);
    } else {
      const lines = usable
        .map((m) => `        content.${m.targetField} = ${m.sourceExpr};`)
        .join('\n');
      // Preserve the original function arg list — real configs use
      // both `function (content)` and the canonical 4-arg form;
      // auto-inflating the short form rewrites bytes silently.
      const args = a.modifyContentArgs ?? 'content, contact, report, event';
      parts.push(
        `modifyContent: function (${args}) {\n${lines}\n      }`,
      );
    }
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
    const parsed = tryParseSimpleMappingsFull(raw);
    if (parsed) {
      action.modifyContentMappings = parsed.mappings;
      action.modifyContentArgs = parsed.args;
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
