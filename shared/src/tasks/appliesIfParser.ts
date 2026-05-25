/**
 * Lift the common shapes of CHT task `appliesIf` / contact-summary flag
 * expressions into a small structured rule model the UI can render with
 * dropdowns and checkboxes.
 *
 * Surveyed gandaki + nssd, these are the patterns that show up:
 *
 *   if (!isTaskUser(user)) return false;
 *   if (!isAlive(contact.contact)) return false;
 *   if (isMuted(contact.contact)) return false;
 *   if (hasError(report)) return false;
 *   return contact.contact.role === 'patient';
 *   return contact.contact.gender !== 'male';
 *   return isActivePregnancy(contact.contact, contact.reports, report);
 *   return getField(report, 'surveillance.has_chronic_symptoms') === 'yes';
 *
 * The goal isn't a JS AST. It's pattern-matching the bodies that real
 * configs actually contain. Anything outside those patterns is returned
 * as a single 'raw' rule containing the entire body, and the UI shows it
 * in a code editor.
 */

export type AppliesIfRule =
  | { kind: 'is_task_user' }
  | { kind: 'is_alive'; negated: boolean }
  | { kind: 'is_muted'; negated: boolean }
  | { kind: 'has_error'; negated: boolean }
  | { kind: 'helper'; name: string; args: string; negated: boolean }
  | { kind: 'contact_field'; field: string; op: '===' | '!=='; value: string }
  | { kind: 'report_field'; field: string; op: '===' | '!=='; value: string }
  | { kind: 'raw'; text: string };

export interface ParsedAppliesIf {
  /** The function's signature parameters in declaration order, e.g. ['contact', 'report']. */
  params: string[];
  /** Ordered rules; AND-combined. */
  rules: AppliesIfRule[];
  /** True if any rule fell back to raw — UI should offer a "Raw" tab. */
  hasRawFallback: boolean;
  /** Original source body (between the function's braces). */
  body: string;
}

const HELPER_NAMES_STANDARD = new Set(['isAlive', 'isMuted', 'hasError', 'isTaskUser']);

/** Parse a function or arrow expression source string. */
export function parseAppliesIf(source: string): ParsedAppliesIf {
  const trimmed = source.trim();
  // function (a, b) { body }
  // (a, b) => { body }
  // a => { body }
  // (a, b) => expr     (concise — wrap as a return)
  const fnMatch = /^function\s*[a-zA-Z_$]*\s*\(([^)]*)\)\s*\{([\s\S]*)\}\s*$/m.exec(trimmed);
  const arrowBlock = /^\(?([^)]*)\)?\s*=>\s*\{([\s\S]*)\}\s*$/m.exec(trimmed);
  const arrowConcise = /^\(?([^)]*)\)?\s*=>\s*([\s\S]*)\s*$/m.exec(trimmed);

  let params: string[] = [];
  let body = '';
  if (fnMatch && fnMatch[1] !== undefined && fnMatch[2] !== undefined) {
    params = splitParams(fnMatch[1]);
    body = fnMatch[2];
  } else if (arrowBlock && arrowBlock[1] !== undefined && arrowBlock[2] !== undefined) {
    params = splitParams(arrowBlock[1]);
    body = arrowBlock[2];
  } else if (arrowConcise && arrowConcise[1] !== undefined && arrowConcise[2] !== undefined) {
    params = splitParams(arrowConcise[1]);
    body = `return ${arrowConcise[2]};`;
  } else {
    return { params: [], rules: [{ kind: 'raw', text: trimmed }], hasRawFallback: true, body: trimmed };
  }

  const rules = extractRules(body);
  const hasRawFallback = rules.some((r) => r.kind === 'raw');
  return { params, rules, hasRawFallback, body };
}

function splitParams(s: string): string[] {
  return s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Walk the function body extracting guard clauses + the final return.
 * Anything we don't recognize lands as a single 'raw' rule with the rest
 * of the body so we never silently drop logic.
 */
function extractRules(body: string): AppliesIfRule[] {
  const rules: AppliesIfRule[] = [];
  // Walk the body finding `if (cond) return false;` (with balanced parens),
  // accumulating leftover content into `unprocessed`.
  let i = 0;
  let unprocessed = '';
  while (i < body.length) {
    const ifIdx = body.indexOf('if', i);
    if (ifIdx < 0) {
      unprocessed += body.slice(i);
      break;
    }
    // Must be `if` followed by whitespace or `(`.
    const next = body[ifIdx + 2];
    if (next !== ' ' && next !== '\t' && next !== '(' && next !== '\n') {
      unprocessed += body.slice(i, ifIdx + 1);
      i = ifIdx + 1;
      continue;
    }
    // Capture text before `if`.
    unprocessed += body.slice(i, ifIdx);
    // Find the opening paren.
    let parenStart = ifIdx + 2;
    while (parenStart < body.length && body[parenStart] !== '(') parenStart++;
    if (parenStart >= body.length) {
      unprocessed += body.slice(ifIdx);
      break;
    }
    // Find matching close paren via depth tracking (no string awareness — guards are short).
    let depth = 0;
    let j = parenStart;
    let parenEnd = -1;
    while (j < body.length) {
      const c = body[j];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) {
          parenEnd = j;
          break;
        }
      }
      j++;
    }
    if (parenEnd < 0) {
      unprocessed += body.slice(ifIdx);
      break;
    }
    const cond = body.slice(parenStart + 1, parenEnd);
    // After `)`, expect optionally `{`, then `return false;`, then optionally `}`.
    let k = parenEnd + 1;
    while (k < body.length && /\s/.test(body[k] ?? '')) k++;
    let hasBrace = false;
    if (body[k] === '{') {
      hasBrace = true;
      k++;
      while (k < body.length && /\s/.test(body[k] ?? '')) k++;
    }
    const tail = body.slice(k);
    const retMatch = /^return\s+false\s*;?/.exec(tail);
    if (!retMatch) {
      // Not a guard — treat the whole `if (...)` as unprocessed and move on.
      unprocessed += body.slice(ifIdx, parenEnd + 1);
      i = parenEnd + 1;
      continue;
    }
    k += retMatch[0].length;
    while (k < body.length && /\s/.test(body[k] ?? '')) k++;
    if (hasBrace && body[k] === '}') k++;

    // Successfully matched a guard. Split the condition on top-level ||.
    const subs = splitOrOperands(cond);
    for (const op of subs) {
      const rule = classifySimple(op);
      rules.push(invertGuardRule(rule));
    }
    i = k;
  }

  // 2) Find the final `return <expr>;` if any.
  const returnRe = /return\s+([^;]+);?/g;
  let returnExpr: string | null = null;
  let rm: RegExpExecArray | null;
  while ((rm = returnRe.exec(unprocessed)) !== null) {
    const txt = rm[1]?.trim() ?? '';
    if (txt === 'true' || txt === 'false') continue;
    returnExpr = txt;
  }
  if (returnExpr) {
    const subs = splitAnd(returnExpr);
    for (const s of subs) {
      rules.push(classifySimple(s));
    }
  }

  // 3) If we got nothing useful and the body has real content, fallback raw.
  if (rules.length === 0 && body.trim().length > 0) {
    rules.push({ kind: 'raw', text: body.trim() });
  }
  return rules;
}

/** Splits `a || b || c` at top level; honors parens. */
function splitOrOperands(expr: string): string[] {
  return splitAtTopLevel(expr, ['||']);
}
/** Splits `a && b && c` at top level. */
function splitAnd(expr: string): string[] {
  return splitAtTopLevel(expr, ['&&']);
}

function splitAtTopLevel(expr: string, ops: string[]): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if (depth === 0) {
      for (const op of ops) {
        if (expr.slice(i, i + op.length) === op) {
          out.push(expr.slice(last, i).trim());
          i += op.length - 1;
          last = i + 1;
          break;
        }
      }
    }
  }
  out.push(expr.slice(last).trim());
  return out.filter(Boolean);
}

/** Classify a single bare expression (no &&/|| at top level). */
function classifySimple(expr: string): AppliesIfRule {
  const e = expr.trim();
  // Strip leading ! for negation tracking.
  let negated = false;
  let stripped = e;
  if (stripped.startsWith('!')) {
    negated = true;
    stripped = stripped.slice(1).trim();
  }

  // isAlive(...) / isMuted(...) / hasError(...) / isTaskUser(user)
  const fn = /^([a-zA-Z_$][\w$]*)\s*\(([^)]*)\)$/.exec(stripped);
  if (fn && fn[1]) {
    const name = fn[1];
    if (name === 'isTaskUser') return { kind: 'is_task_user' };
    if (name === 'isAlive') return { kind: 'is_alive', negated };
    if (name === 'isMuted') return { kind: 'is_muted', negated };
    if (name === 'hasError') return { kind: 'has_error', negated };
    return { kind: 'helper', name, args: fn[2] ?? '', negated };
  }

  // contact.contact.X === 'Y'  or  contact.contact.X !== 'Y'
  const contactCmp =
    /^contact\.contact\.([a-zA-Z_$][\w$.]*)\s*(===|!==|==|!=)\s*'([^']*)'$/.exec(stripped);
  if (contactCmp && contactCmp[1] && contactCmp[2] && contactCmp[3] !== undefined) {
    return {
      kind: 'contact_field',
      field: contactCmp[1],
      op: normalizeOp(contactCmp[2]),
      value: contactCmp[3],
    };
  }

  // getField(report, 'X') === 'Y'
  const reportCmp =
    /^getField\(\s*report\s*,\s*'([^']+)'\s*\)\s*(===|!==|==|!=)\s*'([^']*)'$/.exec(stripped);
  if (reportCmp && reportCmp[1] && reportCmp[2] && reportCmp[3] !== undefined) {
    return {
      kind: 'report_field',
      field: reportCmp[1],
      op: normalizeOp(reportCmp[2]),
      value: reportCmp[3],
    };
  }

  return { kind: 'raw', text: e };
}

function normalizeOp(op: string): '===' | '!==' {
  if (op === '===' || op === '==') return '===';
  return '!==';
}

/**
 * Convert a guard rule (which expressed when to EXIT early) into the
 * positive form (the condition that MUST hold). E.g. guard `!isAlive(x)`
 * becomes "is_alive: not negated".
 */
function invertGuardRule(r: AppliesIfRule): AppliesIfRule {
  switch (r.kind) {
    case 'is_alive':
    case 'is_muted':
    case 'has_error':
    case 'helper':
      return { ...r, negated: !r.negated };
    case 'contact_field':
    case 'report_field':
      return { ...r, op: r.op === '===' ? '!==' : '===' };
    case 'is_task_user':
      // Guards usually check `!isTaskUser(user)` → the rule is "is task user". Negation
      // doesn't apply here; treat presence as the positive requirement.
      return r;
    case 'raw':
      return r;
  }
}

/** Render rules back 
to a JS function body. */
export function serializeAppliesIf(parsed: ParsedAppliesIf): string {
  const lines: string[] = [];
  const params = parsed.params.join(', ');
  lines.push(`function (${params}) {`);
  for (const rule of parsed.rules) {
    const guard = ruleToGuardSource(rule);
    if (guard) lines.push(`  if (${guard}) { return false; }`);
  }
  const anyRecognized = parsed.rules.some((r) => r.kind !== 'raw');
  if (!anyRecognized) {
    for (const r of parsed.rules) {
      if (r.kind === 'raw') lines.push(`  ${r.text}`);
    }
  } else {
    lines.push('  return true;');
  }
  lines.push('}');
  return lines.join('\n');
}

function ruleToGuardSource(rule: AppliesIfRule): string | null {
  switch (rule.kind) {
    case 'is_task_user':
      return `!isTaskUser(user)`;
    case 'is_alive':
      return rule.negated ? `isAlive(contact.contact)` : `!isAlive(contact.contact)`;
    case 'is_muted':
      return rule.negated ? `!isMuted(contact.contact)` : `isMuted(contact.contact)`;
    case 'has_error':
      return rule.negated ? `!hasError(report)` : `hasError(report)`;
    case 'helper':
      return rule.negated ? `!${rule.name}(${rule.args})` : `${rule.name}(${rule.args})`;
    case 'contact_field': {
      const cmp = rule.op === '===' ? '!==' : '===';
      return `contact.contact.${rule.field} ${cmp} '${rule.value}'`;
    }
    case 'report_field': {
      const cmp = rule.op === '===' ? '!==' : '===';
      return `getField(report, '${rule.field}') ${cmp} '${rule.value}'`;
    }
    case 'raw':
      return rule.text || null;
  }
}
