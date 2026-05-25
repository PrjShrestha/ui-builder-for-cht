/**
 * Parser/serializer for the `context.expression` field of a form's
 * .properties.json. It looks like JS but uses different vocab than
 * tasks `appliesIf`:
 *
 *   contact.type === 'person'        // not contact.contact.X
 *   contact.sex === 'male'
 *   ageInYears(contact) >= 18
 *   ageInYears(contact) <= 65
 *   summary.show_back_pain_surveillance_form
 *   !contact.muted
 *   !contact.date_of_death
 *
 * AND-combined with `&&`. Whatever doesn't match a known shape lands as raw.
 */

export type ContextRule =
  | { kind: 'contact_type'; value: string }
  | { kind: 'contact_sex'; value: string }
  | { kind: 'contact_field'; field: string; op: '===' | '!==' | '>' | '<' | '>=' | '<='; value: string }
  | { kind: 'age_years'; op: '>' | '<' | '>=' | '<=' | '===' | '!=='; value: number }
  | { kind: 'summary_flag'; flag: string; negated: boolean }
  | { kind: 'not_muted' }
  | { kind: 'not_deceased' }
  | { kind: 'is_true' }
  | { kind: 'is_false' }
  | { kind: 'raw'; text: string };

export interface ParsedContextExpression {
  rules: ContextRule[];
  hasRawFallback: boolean;
}

export function parseContextExpression(source: string): ParsedContextExpression {
  const trimmed = source.trim();
  if (!trimmed) return { rules: [], hasRawFallback: false };
  if (trimmed === 'false') return { rules: [{ kind: 'is_false' }], hasRawFallback: false };
  if (trimmed === 'true') return { rules: [{ kind: 'is_true' }], hasRawFallback: false };

  const operands = splitAnd(trimmed);
  const rules = operands.map(classify);
  return { rules, hasRawFallback: rules.some((r) => r.kind === 'raw') };
}

export function serializeContextExpression(parsed: ParsedContextExpression): string {
  if (parsed.rules.length === 0) return '';
  if (parsed.rules.length === 1 && parsed.rules[0]?.kind === 'is_false') return 'false';
  if (parsed.rules.length === 1 && parsed.rules[0]?.kind === 'is_true') return 'true';
  return parsed.rules.map(ruleToSource).filter(Boolean).join(' && ');
}

function classify(expr: string): ContextRule {
  const e = expr.trim().replace(/^\((.*)\)$/, '$1').trim();

  // !contact.muted / !contact.date_of_death
  if (e === '!contact.muted') return { kind: 'not_muted' };
  if (e === '!contact.date_of_death') return { kind: 'not_deceased' };

  // summary.X (boolean) or !summary.X
  let negated = false;
  let probe = e;
  if (probe.startsWith('!')) {
    negated = true;
    probe = probe.slice(1).trim();
  }
  const summary = /^summary\.([a-zA-Z_$][\w$]*)$/.exec(probe);
  if (summary && summary[1]) {
    return { kind: 'summary_flag', flag: summary[1], negated };
  }

  // ageInYears(contact) OP N
  const age = /^ageInYears\(\s*contact\s*\)\s*(>=|<=|===|!==|==|!=|>|<)\s*(\d+)$/.exec(e);
  if (age && age[1] && age[2]) {
    const n = Number(age[2]);
    return { kind: 'age_years', op: normalizeOp(age[1]), value: n };
  }

  // contact.type === 'X'
  const ctype = /^contact\.type\s*(===|!==|==|!=)\s*'([^']*)'$/.exec(e);
  if (ctype && ctype[1] && ctype[2] !== undefined) {
    if (ctype[1] === '===' || ctype[1] === '==') {
      return { kind: 'contact_type', value: ctype[2] };
    }
  }

  // contact.sex === 'X'
  const csex = /^contact\.sex\s*(===|!==|==|!=)\s*'([^']*)'$/.exec(e);
  if (csex && csex[1] && csex[2] !== undefined) {
    if (csex[1] === '===' || csex[1] === '==') {
      return { kind: 'contact_sex', value: csex[2] };
    }
  }

  // contact.X === 'Y' (generic, string value)
  const cfield = /^contact\.([a-zA-Z_$][\w$]*)\s*(===|!==|==|!=)\s*'([^']*)'$/.exec(e);
  if (cfield && cfield[1] && cfield[2] && cfield[3] !== undefined) {
    return {
      kind: 'contact_field',
      field: cfield[1],
      op: normalizeOp(cfield[2]) as '===' | '!==',
      value: cfield[3],
    };
  }

  // contact.X OP NUMBER (numeric comparison)
  const cfieldNum =
    /^contact\.([a-zA-Z_$][\w$]*)\s*(>=|<=|===|!==|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)$/.exec(e);
  if (cfieldNum && cfieldNum[1] && cfieldNum[2] && cfieldNum[3]) {
    return {
      kind: 'contact_field',
      field: cfieldNum[1],
      op: normalizeOp(cfieldNum[2]),
      value: cfieldNum[3],
    };
  }

  return { kind: 'raw', text: e };
}

function normalizeOp(op: string): '===' | '!==' | '>' | '<' | '>=' | '<=' {
  if (op === '==' || op === '===') return '===';
  if (op === '!=' || op === '!==') return '!==';
  if (op === '>=') return '>=';
  if (op === '<=') return '<=';
  if (op === '>') return '>';
  return '<';
}

function ruleToSource(rule: ContextRule): string {
  switch (rule.kind) {
    case 'is_true':
      return 'true';
    case 'is_false':
      return 'false';
    case 'contact_type':
      return `contact.type === '${rule.value}'`;
    case 'contact_sex':
      return `contact.sex === '${rule.value}'`;
    case 'contact_field':
      if (rule.op === '===' || rule.op === '!==') {
        return `contact.${rule.field} ${rule.op} '${rule.value}'`;
      }
      return `contact.${rule.field} ${rule.op} ${rule.value}`;
    case 'age_years':
      return `ageInYears(contact) ${rule.op} ${rule.value}`;
    case 'summary_flag':
      return rule.negated ? `!summary.${rule.flag}` : `summary.${rule.flag}`;
    case 'not_muted':
      return '!contact.muted';
    case 'not_deceased':
      return '!contact.date_of_death';
    case 'raw':
      return rule.text;
  }
}

function splitAnd(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if (depth === 0 && expr.slice(i, i + 2) === '&&') {
      out.push(expr.slice(last, i).trim());
      i++;
      last = i + 1;
    }
  }
  out.push(expr.slice(last).trim());
  return out.filter(Boolean);
}
