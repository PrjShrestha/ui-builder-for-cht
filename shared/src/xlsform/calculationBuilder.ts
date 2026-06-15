/**
 * Parser/serializer for an XLSForm `calculation` column expression.
 *
 * The `calculation` column produces a VALUE (not a yes/no boolean), so it
 * does NOT share the condition builder's AND/OR clause model. This module
 * recognizes three structured shapes plus a raw fallback (plan v0.2 Tier 0):
 *
 *   - `decision_table` — nested if-chain: `if(C1, V1, if(C2, V2, ..., ELSE))`
 *     Each `(Ci, Vi)` is a rule; ELSE is the otherwise output. Conditions
 *     reuse the shared `parseRelevant` grammar.
 *   - `single` — a bare value cell (a `${field}` ref, an xpath path, a
 *     literal, or any single expression that doesn't open an if-chain).
 *     Stored verbatim in `otherwise`; rules are empty by construction.
 *   - `raw` — anything outside the supported grammar OR anything whose
 *     structured re-serialize wouldn't be byte-identical. Preserved
 *     verbatim in `raw`.
 *
 * Round-trip contract (plan v0.2 §3.1, §3.3, §3.4 — the non-negotiables):
 *
 *   §3.1 TOP-LEVEL SELF-CHECK runs for EVERY non-raw shape.
 *     `serializeCalculation(parseCalculation(x)) === x.trim()` holds for
 *     every result whose `shape !== 'raw'`. If it would fail, the parser
 *     demotes to `shape:'raw'` with `raw` = the original trimmed text.
 *     This is what defends against:
 *       - silent whitespace canonicalization in if-chains
 *         (`if(${a}=1,2,3)` → `if(${a} = 1, 2, 3)`)
 *       - the `readArgList` truncation case (`if(${a}=1,2,3) + 5` would
 *         parse as a decision table dropping the ` + 5` — the self-check
 *         spots the mismatch and demotes to raw)
 *
 *   §3.3 EMPTY-CELL `''` resurrection is GATED on genuinely-empty source.
 *     A truly blank source cell collapses to JS empty string `''` on
 *     serialize (length 0) so `setExtra` deletes the column cleanly. A
 *     present cell whose canonical serialize would be length 0 (e.g. a
 *     literal `''` calculation that someone deliberately wrote) MUST be
 *     preserved verbatim via `shape:'raw'`. **A present column is never
 *     deleted on save.**
 *
 *   §3.4 ONE DISCRIMINATED RECOGNIZER. No partial-parse-and-drop. After
 *     peeling an if-chain, any trailing text beyond the closing paren
 *     means the expression is not a clean decision table — self-check
 *     catches the resulting re-serialize mismatch and demotes to raw.
 */
import { parseRelevant, serializeRelevant, type ParsedExpression } from './relevantParser.js';

export interface CalculationRule {
  /** The structured condition built from the relevantParser grammar. */
  condition: ParsedExpression;
  /** The literal output value if the condition holds (quoted strings preserve quotes). */
  output: string;
}

export interface ParsedCalculation {
  /** Discriminator across the recognizer's three structured shapes plus raw. */
  shape: 'decision_table' | 'single' | 'raw';
  /** Rule rows for `'decision_table'`; always empty for `'single'`/`'raw'`. */
  rules: CalculationRule[];
  /** Default output when no rule matches (the innermost `else` of the if-chain),
   *  OR the bare value for `'single'`. Empty string for `'raw'` (the raw text
   *  is in `raw`). For a genuinely-empty source cell this is `''` (length 0),
   *  so serialize collapses cleanly and `setExtra` deletes the column. */
  otherwise: string;
  /** Original raw (trimmed) text — preserved for the `'raw'` fallback and
   *  consulted by the §3.3 empty-collapse gate. */
  raw: string;
}

export function parseCalculation(source: string): ParsedCalculation {
  const trimmed = source.trim();
  // §3.3 — genuinely-empty source: `otherwise: ''` (length 0) so serialize
  // returns `''` and setExtra deletes the column. Classified as `'single'`
  // because there is no if-chain to lift.
  if (!trimmed) return { shape: 'single', rules: [], otherwise: '', raw: trimmed };

  // Try the structured if-chain recognizer first.
  const peeled = peelIfChain(trimmed);
  if (peeled && peeled.rules.length > 0) {
    const candidate: ParsedCalculation = {
      shape: 'decision_table',
      rules: peeled.rules,
      otherwise: peeled.otherwise,
      raw: trimmed,
    };
    // §3.1 top-level self-check — byte-identity or raw.
    if (serializeCalculation(candidate) === trimmed) return candidate;
    return { shape: 'raw', rules: [], otherwise: '', raw: trimmed };
  }

  // Not an if-chain (or zero rules after peeling). Classify as a single
  // value cell — covers bare `${field}`, xpath paths, literals, and
  // function calls. Verify byte-identity via the §3.1 self-check.
  const single: ParsedCalculation = {
    shape: 'single',
    rules: [],
    otherwise: trimmed,
    raw: trimmed,
  };
  if (serializeCalculation(single) === trimmed) return single;
  return { shape: 'raw', rules: [], otherwise: '', raw: trimmed };
}

export function serializeCalculation(parsed: ParsedCalculation): string {
  if (parsed.shape === 'raw') return parsed.raw;
  if (parsed.shape === 'single') {
    // §3.3 — empty otherwise (length 0) collapses to '' so setExtra
    // deletes the column. A non-empty otherwise (a literal `''`, a
    // `${field}` ref, an xpath, a function call …) is preserved
    // verbatim — never replaced with the two-char `''` fallback.
    return parsed.otherwise;
  }
  // decision_table — build the nested if-chain right-to-left.
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

/** Read a balanced ( ... ) starting at `parenIdx` (index of '('), return arg list.
 *  Returns the args at the first balanced close paren — any text past that
 *  paren is silently dropped by this helper. That truncation is intentional
 *  (lets the outer `peelIfChain` walk straight into the next nesting) but
 *  *would* silently lose data (e.g. `if(${a}=1,2,3) + 5` → drops the ` + 5`).
 *  The §3.1 self-check in `parseCalculation` catches the resulting
 *  re-serialize mismatch and demotes the whole expression to `'raw'`, so the
 *  trailing text survives via the raw fallback. */
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
