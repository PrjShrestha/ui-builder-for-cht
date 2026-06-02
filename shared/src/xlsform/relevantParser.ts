/**
 * Parser and serializer for a USEFUL SUBSET of XLSForm `relevant` /
 * `constraint` / `choice_filter` expressions.
 *
 * We support the patterns that show up in 90%+ of CHT forms surveyed:
 *
 *   ${age} >= 15
 *   ${sex} = 'female'
 *   ${age} >= 15 and ${age} <= 45 and ${sex} = 'female'
 *   selected(${conditions}, 'heart_condition')
 *   not(selected(${conditions}, 'none'))
 *   ${field} != ''   (i.e. "is answered")
 *
 * Anything outside this grammar is returned as a "raw" rule with the
 * original text; the UI still lets the user keep it. Round-trip safety:
 * if the user opens an expression we can't parse, edits *other* rules,
 * and saves, the raw text is preserved.
 */

export type Operator = '=' | '!=' | '>' | '<' | '>=' | '<=';
export type Combinator = 'and' | 'or';

export interface ComparisonRule {
  kind: 'comparison';
  field: string;
  op: Operator;
  value: string;
  /** True if value should be wrapped in quotes when serialized back. */
  valueIsString: boolean;
}

export interface SelectedRule {
  kind: 'selected';
  field: string;
  value: string;
  /** If true, the rule is `not(selected(...))`. */
  negated: boolean;
}

export interface AnsweredRule {
  kind: 'answered';
  field: string;
  /** If true, expression is `${field} = ''` (the field is NOT answered). */
  negated: boolean;
}

export interface RawRule {
  kind: 'raw';
  text: string;
}

export type DateUnit = 'days' | 'weeks' | 'months' | 'years';
export type DateOffsetComparator = 'more_than' | 'less_than';
export type DateOffsetDirection = 'ago' | 'from_now';

/**
 * "${field} is more/less than N days/weeks/months/years ago/from now" —
 * sugar over a date-arithmetic XPath expression. Serializes to
 *
 *   today() - ${field} > 20*365.25     (more than 20 years ago)
 *   today() - ${field} < 30            (less than 30 days ago)
 *   ${field} - today() > 7             (more than 7 days from now)
 */
export interface DateOffsetRule {
  kind: 'date_offset';
  field: string;
  comparator: DateOffsetComparator;
  /** Number as a string, so we can preserve "1.5" or empty-while-editing. */
  amount: string;
  unit: DateUnit;
  direction: DateOffsetDirection;
}

/**
 * "Age computed from ${field} op N years" — sugar over
 * `floor((today() - ${field}) div 365.25) op N`. Always whole-year integer
 * age. Op uses the standard Operator set.
 */
export interface AgeRule {
  kind: 'age';
  field: string;
  op: Operator;
  /** Number as a string, e.g. "20". */
  value: string;
}

export type Rule = ComparisonRule | SelectedRule | AnsweredRule | DateOffsetRule | AgeRule | RawRule;

const UNIT_DAYS: Record<DateUnit, number> = {
  days: 1,
  weeks: 7,
  months: 30,
  years: 365.25,
};

function unitForMultiplier(mult: number | null): DateUnit | null {
  if (mult === null || mult === 1) return 'days';
  if (mult === 7) return 'weeks';
  if (mult === 30) return 'months';
  if (mult === 365.25) return 'years';
  return null;
}

export interface ParsedExpression {
  combinator: Combinator;
  rules: Rule[];
  /** Whether the whole expression had to be treated as raw because grammar didn't match. */
  isRawFallback: boolean;
}

/** Parse an expression into rules + a combinator (default 'and'). */
export function parseRelevant(expr: string): ParsedExpression {
  const trimmed = expr.trim();
  if (!trimmed) return { combinator: 'and', rules: [], isRawFallback: false };

  // Detect outer combinator. If both `and` and `or` appear, we give up
  // and return raw — mixing requires precedence handling.
  const containsAnd = /\band\b/i.test(trimmed);
  const containsOr = /\bor\b/i.test(trimmed);
  if (containsAnd && containsOr) {
    return { combinator: 'and', rules: [{ kind: 'raw', text: trimmed }], isRawFallback: true };
  }
  const combinator: Combinator = containsOr ? 'or' : 'and';

  const parts = splitOnCombinator(trimmed, combinator);
  const rules: Rule[] = [];
  let anyRaw = false;
  for (const p of parts) {
    const r = parseSinglePart(p);
    if (r.kind === 'raw') anyRaw = true;
    rules.push(r);
  }
  return { combinator, rules, isRawFallback: anyRaw && rules.every((r) => r.kind === 'raw') };
}

/** Serialize rules back to an XLSForm expression. */
export function serializeRelevant(parsed: ParsedExpression): string {
  if (parsed.rules.length === 0) return '';
  if (parsed.rules.length === 1) return ruleToString(parsed.rules[0]!);
  return parsed.rules.map(ruleToString).join(` ${parsed.combinator} `);
}

/** Cheap, paren-aware split that respects function-call parens. */
function splitOnCombinator(expr: string, combinator: Combinator): string[] {
  const out: string[] = [];
  let depth = 0;
  let i = 0;
  let last = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0) {
      // Look for ` and ` or ` or ` boundary at word level.
      const w = wordAt(expr, i);
      if (w && w.toLowerCase() === combinator) {
        const prevCh = expr[i - 1];
        const nextCh = expr[i + w.length];
        if (
          (i === 0 || prevCh === ' ' || prevCh === '\t' || prevCh === ')') &&
          (nextCh === ' ' || nextCh === '\t' || nextCh === '(' || nextCh === undefined)
        ) {
          out.push(expr.slice(last, i).trim());
          i += w.length;
          last = i;
          continue;
        }
      }
    }
    i++;
  }
  out.push(expr.slice(last).trim());
  return out.filter(Boolean);
}

function wordAt(s: string, i: number): string | null {
  if (!/[a-zA-Z]/.test(s[i] ?? '')) return null;
  let j = i;
  while (j < s.length && /[a-zA-Z]/.test(s[j] ?? '')) j++;
  return s.slice(i, j);
}

/** Parse one boolean clause into a Rule. */
function parseSinglePart(part: string): Rule {
  const t = part.trim();
  if (!t) return { kind: 'raw', text: '' };

  // age: floor((today() - ${field}) div 365.25) OP N
  const ageRe = /^floor\(\(\s*today\(\)\s*-\s*\$\{\s*([^}\s]+)\s*\}\s*\)\s*div\s*365(?:\.25)?\s*\)\s*(>=|<=|!=|=|>|<)\s*(-?\d+(?:\.\d+)?)$/i;
  const ageMatch = ageRe.exec(t);
  if (ageMatch && ageMatch[1] && ageMatch[2] && ageMatch[3] !== undefined) {
    return {
      kind: 'age',
      field: ageMatch[1],
      op: ageMatch[2] as Operator,
      value: ageMatch[3],
    };
  }

  // date_offset (ago):    (today() - ${field}) > N            | N*7 | N*30 | N*365.25
  // date_offset (future): (${field} - today()) > N           | etc.
  // Parens optional. Comparator is > / < (>= and <= treated as same intent).
  const offRe = /^\(?\s*(today\(\)|\$\{\s*[^}\s]+\s*\})\s*-\s*(today\(\)|\$\{\s*[^}\s]+\s*\})\s*\)?\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)(?:\s*\*\s*(-?\d+(?:\.\d+)?))?$/i;
  const offMatch = offRe.exec(t);
  if (offMatch) {
    const left = offMatch[1]!;
    const right = offMatch[2]!;
    const op = offMatch[3]! as '>' | '<' | '>=' | '<=';
    const amount = offMatch[4]!;
    const mult = offMatch[5] === undefined ? null : Number(offMatch[5]);
    const unit = unitForMultiplier(mult);
    // Need exactly one ${field} and one today() in the subtraction.
    const leftIsToday = left.toLowerCase() === 'today()';
    const rightIsToday = right.toLowerCase() === 'today()';
    if (unit !== null && leftIsToday !== rightIsToday) {
      const field = (leftIsToday ? right : left).replace(/^\$\{\s*|\s*\}$/g, '');
      const direction: DateOffsetDirection = leftIsToday ? 'ago' : 'from_now';
      const comparator: DateOffsetComparator = op === '>' || op === '>=' ? 'more_than' : 'less_than';
      return { kind: 'date_offset', field, comparator, amount, unit, direction };
    }
  }

  // not(selected(${field}, 'value'))
  const notSel = /^not\(\s*selected\(\s*\$\{\s*([^}\s]+)\s*\}\s*,\s*'([^']*)'\s*\)\s*\)$/i.exec(t);
  if (notSel && notSel[1] && notSel[2] !== undefined) {
    return { kind: 'selected', field: notSel[1], value: notSel[2], negated: true };
  }
  // selected(${field}, 'value')
  const sel = /^selected\(\s*\$\{\s*([^}\s]+)\s*\}\s*,\s*'([^']*)'\s*\)$/i.exec(t);
  if (sel && sel[1] && sel[2] !== undefined) {
    return { kind: 'selected', field: sel[1], value: sel[2], negated: false };
  }
  // ${field} = ''   or   ${field} != ''
  const ans = /^\$\{\s*([^}\s]+)\s*\}\s*(=|!=)\s*''$/.exec(t);
  if (ans && ans[1]) {
    // `${f} != ''` means "answered". `${f} = ''` means "not answered".
    return { kind: 'answered', field: ans[1], negated: ans[2] === '=' };
  }
  // ${field} OP value
  const cmp = /^\$\{\s*([^}\s]+)\s*\}\s*(>=|<=|!=|=|>|<)\s*(.+)$/.exec(t);
  if (cmp && cmp[1] && cmp[2] && cmp[3] !== undefined) {
    const opRaw = cmp[2];
    const op: Operator = opRaw as Operator;
    const valueRaw = cmp[3].trim();
    const m = /^'([^']*)'$/.exec(valueRaw);
    if (m && m[1] !== undefined) {
      return { kind: 'comparison', field: cmp[1], op, value: m[1], valueIsString: true };
    }
    return { kind: 'comparison', field: cmp[1], op, value: valueRaw, valueIsString: false };
  }
  return { kind: 'raw', text: t };
}

function ruleToString(rule: Rule): string {
  switch (rule.kind) {
    case 'comparison': {
      const v = rule.valueIsString ? `'${rule.value.replace(/'/g, "\\'")}'` : rule.value;
      return `\${${rule.field}} ${rule.op} ${v}`;
    }
    case 'selected': {
      const inner = `selected(\${${rule.field}}, '${rule.value.replace(/'/g, "\\'")}')`;
      return rule.negated ? `not(${inner})` : inner;
    }
    case 'answered': {
      // Answered = `${f} != ''`; not answered = `${f} = ''`.
      return rule.negated ? `\${${rule.field}} = ''` : `\${${rule.field}} != ''`;
    }
    case 'date_offset': {
      const op = rule.comparator === 'more_than' ? '>' : '<';
      const days = UNIT_DAYS[rule.unit];
      const rhs = days === 1 ? rule.amount : `${rule.amount}*${days}`;
      const lhs =
        rule.direction === 'ago'
          ? `today() - \${${rule.field}}`
          : `\${${rule.field}} - today()`;
      return `${lhs} ${op} ${rhs}`;
    }
    case 'age': {
      return `floor((today() - \${${rule.field}}) div 365.25) ${rule.op} ${rule.value}`;
    }
    case 'raw':
      return rule.text;
  }
}
