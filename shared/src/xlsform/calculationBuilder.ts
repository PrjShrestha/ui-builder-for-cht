/**
 * Parser/serializer for an XLSForm `calculation` column expression,
 * viewed as a DMN-style decision table.
 *
 * The shape we recognize:
 *
 *   if(C1, V1, if(C2, V2, ... if(Cn, Vn, ELSE)))
 *
 * Each `(Ci, Vi)` is a rule row; ELSE is the otherwise output.
 * Any expression that doesn't match falls back to raw text.
 *
 * Conditions are parsed using the same shared `parseRelevant` grammar
 * (so users can express conditions like
 *   ${has_back_pain} = 'yes' and (${pain_duration} = 'more_6_weeks' or ...) and ${pain_severity} >= 4
 * via the same visual rule builder used for `relevant`).
 */
import { parseRelevant, serializeRelevant, type ParsedExpression } from './relevantParser.js';

export interface CalculationRule {
  /** The structured condition built from the relevantParser grammar. */
  condition: ParsedExpression;
  /** The literal output value if the condition holds (quoted strings preserve quotes). */
  output: string;
}

export interface ParsedCalculation {
  shape: 'decision_table' | 'raw';
  rules: CalculationRule[];
  /** Default output when no rule matches (the innermost `else` of the if-chain). */
  otherwise: string;
  /** Original raw text — preserved for fallback. */
  raw: string;
}

export function parseCalculation(source: string): ParsedCalculation {
  const trimmed = source.trim();
  if (!trimmed) return { shape: 'decision_table', rules: [], otherwise: "''", raw: trimmed };
  const parsed = peelIfChain(trimmed);
  if (parsed) return { shape: 'decision_table', ...parsed, raw: trimmed };
  return { shape: 'raw', rules: [], otherwise: "''", raw: trimmed };
}

export function serializeCalculation(parsed: ParsedCalculation): string {
  if (parsed.shape === 'raw') return parsed.raw;
  if (parsed.rules.length === 0) return parsed.otherwise || "''";
  let out = parsed.otherwise;
  for (let i = parsed.rules.length - 1; i >= 0; i--) {
    const r = parsed.rules[i];
    if (!r) continue;
    const condStr = serializeRelevant(r.condition);
    out = `if(${condStr}, ${r.output}, ${out})`;
  }
  return out;
}

function peelIfChain(
  source: string,
): { rules: CalculationRule[]; otherwise: string } | null {
  const rules: CalculationRule[] = [];
  let current = source.trim();
  while (current.startsWith('if(')) {
    const args = readArgList(current, 2); // index of `(`
    if (!args || args.length !== 3) return null;
    const cond = args[0]?.trim() ?? '';
    const thenVal = args[1]?.trim() ?? '';
    const elseExpr = args[2]?.trim() ?? '';
    rules.push({ condition: parseRelevant(cond), output: thenVal });
    current = elseExpr;
  }
  return { rules, otherwise: current };
}

/** Read a balanced ( ... ) starting at `parenIdx` (index of '('), return arg list. */
function readArgList(src: string, parenIdx: number): string[] | null {
  if (src[parenIdx] !== '(') return null;
  let depth = 0;
  let i = parenIdx;
  let argStart = parenIdx + 1;
  const args: string[] = [];
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"') {
      // skip string literal
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') i += 2;
        else i++;
      }
      i++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0 && c === ')') {
        args.push(src.slice(argStart, i));
        // The remainder after this paren shouldn't matter to the if-chain.
        // The caller treats anything after as part of the next nesting.
        return args;
      }
    } else if (c === ',' && depth === 1) {
      args.push(src.slice(argStart, i));
      argStart = i + 1;
    }
    i++;
  }
  return null;
}
