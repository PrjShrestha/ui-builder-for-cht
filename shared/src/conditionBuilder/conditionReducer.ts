/**
 * Pure state machine for the unified condition builder.
 *
 * Slice 2 commit B of docs/plans/condition-builder.md v0.2. The reducer
 * is in `shared/` (not `client/`) so it tests against the existing
 * `node --test "dist/**\/*.test.js"` runner without standing up a new
 * client-side test framework. It has zero React imports and operates
 * over plain TS values + parser types from `../xlsform/relevantParser`.
 *
 * Responsibilities (plan §3, §5):
 *   - Hold the chain-building session state (committed clauses + the
 *     in-flight draft) for a single `row.extras[column]` column.
 *   - Reject the silent-AND/OR-mix invariant — `commitClause('or')`
 *     while `lockedConnector === 'and'` is a no-op in flat mode (the
 *     `( group these )` button in commit C lifts that constraint).
 *   - Rehydrate from an existing column value via `parseRelevantGrouped`
 *     so a row opened with `${sex} = 'female' and ${age} > 18` reappears
 *     as two committed clauses + a locked AND. Grammar boundaries route
 *     to raw fallback (chaining disabled, text preserved verbatim).
 *   - Serialize the session state to a single XLSForm-column string via
 *     `serializeAnyParsed` — there is NO code path that emits a hand-
 *     concatenated connector (plan §3.7 legacy-fragment-append deletion).
 *
 * What this reducer does NOT do:
 *   - It does not write to `row.extras[column]`. The caller does that on
 *     `insertAll`. `× start over` is byte-safe because it only mutates
 *     reducer state.
 *   - Groups (parenthesized mixed-combinator) are reserved fields on the
 *     state shape; the commit-C group-affordance UI populates them. In
 *     commit B those fields are always null and groups rehydrate to raw.
 *   - It does not own the column's existing free-text value when raw —
 *     the UI keeps the text visible and editable; the reducer just
 *     remembers `rawFallback` so chaining is disabled.
 */
import {
  parseRelevantGrouped,
  serializeAnyParsed,
  type ParsedExpression,
  type Rule,
} from '../xlsform/relevantParser.js';

/** Operators the visual builder offers. `and`/`or` are NOT here — those
 *  live between clauses, not inside one (plan §3.7). */
export type ClauseOp =
  | '='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'selected'      // selected(${field}, 'value')
  | 'selected-not'  // not(selected(${field}, 'value'))
  | 'not'           // not(${field})
  | 'ref'           // ${field}
  | 'today';        // today()

/** A single atomic clause assembled in the strip. */
export interface Clause {
  field: string;
  op: ClauseOp;
  /** Empty for ops in {'ref','today','not','selected'-without-value}. */
  value: string;
}

export type Connector = 'and' | 'or';

export type ConditionColumn =
  | 'relevant'
  | 'calculation'
  | 'constraint'
  | 'choice_filter';

export interface ConditionBuilderState {
  column: ConditionColumn | '';
  /** Committed clauses for THIS column this session (not yet inserted). */
  clauses: Clause[];
  /** `connectors[i]` joins `clauses[i]` to `clauses[i + 1]`. Length === max(0, clauses.length - 1). */
  connectors: Connector[];
  /** The currently-armed strip. */
  draft: Clause;
  /** Set after the first connector is chosen; pins the chain to one combinator. */
  lockedConnector: Connector | null;
  /** Non-null when the existing column couldn't be cleanly parsed; chaining disabled. */
  rawFallback: string | null;
  // Group fields are reserved for commit C. In commit B they're always null;
  // grouped expressions rehydrate to rawFallback rather than the groups arm.
  groups: null;
  outerConnector: null;
  activeGroupIndex: null;
}

export const EMPTY_DRAFT: Clause = { field: '', op: '=', value: '' };

export const initialConditionBuilderState: ConditionBuilderState = {
  column: '',
  clauses: [],
  connectors: [],
  draft: EMPTY_DRAFT,
  lockedConnector: null,
  rawFallback: null,
  groups: null,
  outerConnector: null,
  activeGroupIndex: null,
};

/* ----------------------------- actions ----------------------------------- */

export type ConditionBuilderAction =
  | { kind: 'set-column'; column: ConditionColumn | ''; existingValue: string }
  | { kind: 'set-draft'; partial: Partial<Clause> }
  | { kind: 'commit-clause'; connector: Connector }
  | { kind: 'pop-clause' }
  | { kind: 'start-over' };

export function conditionBuilderReducer(
  state: ConditionBuilderState,
  action: ConditionBuilderAction,
): ConditionBuilderState {
  switch (action.kind) {
    case 'set-column': {
      if (!action.column) {
        return { ...initialConditionBuilderState };
      }
      return hydrateColumn(action.column, action.existingValue);
    }
    case 'set-draft':
      return { ...state, draft: { ...state.draft, ...action.partial } };
    case 'commit-clause': {
      // Plan §3.3: structurally cannot mix AND/OR in flat mode. Reject as no-op.
      if (state.lockedConnector !== null && state.lockedConnector !== action.connector) {
        return state;
      }
      // Plan §3.2: refuse a partial clause.
      if (!isDraftComplete(state.draft)) return state;
      const isFirstCommit = state.clauses.length === 0;
      return {
        ...state,
        clauses: [...state.clauses, state.draft],
        // The connector joins THIS new clause to the previous one, so the
        // first commit produces zero connectors. Subsequent commits add one.
        connectors: isFirstCommit
          ? state.connectors
          : [...state.connectors, action.connector],
        draft: EMPTY_DRAFT,
        lockedConnector: action.connector,
      };
    }
    case 'pop-clause': {
      if (state.clauses.length === 0) return state;
      const nextClauses = state.clauses.slice(0, -1);
      const nextConnectors = state.connectors.slice(0, -1);
      return {
        ...state,
        clauses: nextClauses,
        connectors: nextConnectors,
        // Re-unlock if the chain dropped to ≤1 clause.
        lockedConnector: nextClauses.length > 1 ? state.lockedConnector : null,
      };
    }
    case 'start-over': {
      // Byte-safe: only the reducer state is touched; caller never writes
      // to row.extras as a result of this action (plan §3.5).
      return {
        ...state,
        clauses: [],
        connectors: [],
        draft: EMPTY_DRAFT,
        lockedConnector: null,
      };
    }
  }
}

/* ---------------------------- serialization ------------------------------ */

/**
 * Serialize the current session to a single XLSForm-column string.
 *
 * Used by the FormEditor on `+ insert` to write to `row.extras[column]`.
 * All builder writes flow through this; the legacy fragment-append path
 * at FormEditor.tsx:1128-1143 is removed in commit B (plan §3.7).
 *
 * Output is guaranteed to round-trip through `parseRelevantGrouped` with
 * `isRawFallback: false`: the reducer cannot emit flat-mixed combinators
 * (mixed-commit is a no-op) and the serializer goes through the parser's
 * own canonical form.
 *
 * Honors the draft: if the draft is complete, it's included as the final
 * clause. The caller's `+ insert` is disabled-by-validation when the draft
 * is partial AND a clause exists (would emit a dangling connector — see
 * `isInsertReady`).
 */
export function serializeBuilderState(state: ConditionBuilderState): string {
  if (state.rawFallback !== null) return state.rawFallback;

  const allClauses = [...state.clauses];
  if (isDraftComplete(state.draft)) allClauses.push(state.draft);
  if (allClauses.length === 0) return '';

  const combinator: Connector = state.lockedConnector ?? 'and';
  const rules: Rule[] = allClauses.map(clauseToRule);
  const flat: ParsedExpression = { combinator, rules, isRawFallback: false };
  return serializeAnyParsed(flat);
}

/**
 * True when the current session has enough to insert: at least one
 * complete clause OR a complete draft, with no dangling connector
 * (committed-clauses-with-partial-draft is rejected).
 */
export function isInsertReady(state: ConditionBuilderState): boolean {
  if (state.column === '') return false;
  if (state.rawFallback !== null) return false;
  const draftComplete = isDraftComplete(state.draft);
  if (state.clauses.length === 0) return draftComplete;
  // Already-committed clauses: insert is fine even with empty draft.
  // Partial draft with committed clauses would emit a dangling connector → no.
  if (isDraftEmpty(state.draft)) return true;
  return draftComplete;
}

/* ----------------------------- helpers ----------------------------------- */

export function isDraftEmpty(c: Clause): boolean {
  return c.field === '' && c.value === '' && c.op === '=';
}

export function isDraftComplete(c: Clause): boolean {
  if (c.op === 'today') return true;
  if (c.op === 'ref' || c.op === 'not') return c.field !== '';
  // `selected` / `selected-not` need a value (the choice name)
  if (c.op === 'selected' || c.op === 'selected-not') {
    return c.field !== '' && c.value !== '';
  }
  // Comparisons
  return c.field !== '' && c.value !== '';
}

function clauseToRule(c: Clause): Rule {
  if (c.op === 'today') return { kind: 'raw', text: 'today()' };
  if (c.op === 'ref') return { kind: 'raw', text: `\${${c.field}}` };
  if (c.op === 'not') return { kind: 'raw', text: `not(\${${c.field}})` };
  if (c.op === 'selected') {
    return { kind: 'selected', field: c.field, value: c.value, negated: false };
  }
  if (c.op === 'selected-not') {
    return { kind: 'selected', field: c.field, value: c.value, negated: true };
  }
  // Comparison: `${field} OP value` where value is either a string
  // literal, a number, or a `${ref}` to another field.
  const valueRaw = c.value;
  if (valueRaw === '') {
    return { kind: 'comparison', field: c.field, op: c.op, value: '', valueIsString: true };
  }
  if (/^\$\{[^}]+\}$/.test(valueRaw) || /^-?\d+(\.\d+)?$/.test(valueRaw)) {
    return { kind: 'comparison', field: c.field, op: c.op, value: valueRaw, valueIsString: false };
  }
  return { kind: 'comparison', field: c.field, op: c.op, value: valueRaw, valueIsString: true };
}

function ruleToClause(r: Rule): Clause | null {
  if (r.kind === 'comparison') {
    return { field: r.field, op: r.op, value: r.value };
  }
  if (r.kind === 'selected') {
    return {
      field: r.field,
      op: r.negated ? 'selected-not' : 'selected',
      value: r.value,
    };
  }
  // The remaining rule kinds (answered, date_offset, age, raw) don't
  // have a clean 1:1 in the commit-B Clause shape, so a column whose
  // structured parse includes any of these falls back to raw.
  return null;
}

function hydrateColumn(
  column: ConditionColumn,
  existingValue: string,
): ConditionBuilderState {
  const parsed = parseRelevantGrouped(existingValue);

  // Raw fallback — keep the text editable in the UI, disable chaining.
  if (parsed.isRawFallback) {
    return {
      ...initialConditionBuilderState,
      column,
      rawFallback: existingValue,
    };
  }
  // Grouped expressions are commit-C territory. For commit B they fall
  // back to raw so the column's text is preserved verbatim. Once commit C
  // lands, the reducer's `groups`/`outerConnector` fields populate from
  // `parsed.subgroups` and the UI shows the group structure.
  if ('subgroups' in parsed) {
    return {
      ...initialConditionBuilderState,
      column,
      rawFallback: existingValue,
    };
  }
  // Flat chain (zero or more rules joined by a single combinator).
  const clauses: Clause[] = [];
  for (const rule of parsed.rules) {
    const c = ruleToClause(rule);
    if (c === null) {
      // Some rule didn't map to a Clause (e.g. date_offset). Fall back to
      // raw rather than silently losing the rule.
      return {
        ...initialConditionBuilderState,
        column,
        rawFallback: existingValue,
      };
    }
    clauses.push(c);
  }
  return {
    ...initialConditionBuilderState,
    column,
    clauses,
    connectors:
      clauses.length > 1
        ? Array.from({ length: clauses.length - 1 }, () => parsed.combinator)
        : [],
    lockedConnector: clauses.length > 1 ? parsed.combinator : null,
  };
}
