/**
 * Editor for an XLSForm `calculation` cell (the value-producing column).
 *
 * Tier 1 of docs/plans/calculation-builder.md v0.2. The cell can take
 * four authoring shapes, exposed via an a11y radio tablist:
 *
 *   - **Single value** — a bare `${field}` reference, an xpath path, or
 *     a literal (string or number) with visible auto-quote. Covers 205 of
 *     258 distinct cells in the cht-default corpus (plan §6).
 *   - **If-then table** — a DMN-style decision table; nested
 *     `if(C1, V1, if(C2, V2, ... ELSE))`. Rules are matched first-to-last.
 *   - **Common calculation** — a templates gallery that seeds the cell
 *     with a canonical recipe. Tier 1 ships exactly one: "Age from date
 *     of birth" (corpus-grounded, 1 occurrence).
 *   - **Raw** — verbatim XLSForm expression, escape hatch for everything
 *     outside the supported grammar. The same path the §3.1 self-check
 *     routes unstable structured candidates to.
 *
 * Round-trip contract (plan §3.1, §3.3): every save flows through the
 * `parseCalculation` self-check at the store boundary, so anything
 * outside the supported shapes is preserved verbatim. A present cell is
 * NEVER deleted on save — the `'single'` empty-collapse path only fires
 * for genuinely-empty source.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  parseCalculation,
  serializeCalculation,
  parseRelevant,
  serializeRelevant,
  type CalculationRule,
  type ParsedCalculation,
  type ParsedExpression,
} from '@cht-ui/shared';
import { RelevantRuleBuilder } from './RelevantRuleBuilder.js';

interface Props {
  value: string;
  fieldOptions: string[];
  onSave: (v: string) => void;
  onCancel: () => void;
  title?: string;
}

type Mode = 'single' | 'if-then' | 'common' | 'raw';

/** The 4-mode tablist labels (plan v0.2 §3). Keep the order stable —
 *  the tablist iterates this array in declaration order. */
const MODE_LABELS: Record<Mode, string> = {
  single: 'Single value',
  'if-then': 'If-then table',
  common: 'Common calculation',
  raw: 'Raw',
};

/** Derive the initial mode from the parsed shape. Empty cells default to
 *  the templates gallery — plan §3 "templates gallery FIRST on an empty
 *  cell". Non-empty cells route to the mode that fits their shape. */
function initialModeFor(parsed: ParsedCalculation): Mode {
  if (parsed.shape === 'raw') return 'raw';
  if (parsed.shape === 'decision_table') return 'if-then';
  // shape === 'single'. Empty otherwise (genuinely-empty source) → show
  // the gallery so the user sees the recipes immediately.
  if (parsed.otherwise.trim() === '') return 'common';
  return 'single';
}

/* ============================== templates ================================ */

interface CalcTemplate {
  /** Stable identifier used as the keyed list key. */
  id: string;
  /** Short title (button label + heading). */
  title: string;
  /** One-line description shown beneath the title. */
  description: string;
  /**
   * Whether this template needs a `${field}` argument the user picks at
   * insert time. The picker presents `fieldOptions` filtered by `accepts`.
   */
  fieldArg?: { label: string; accepts?: (name: string) => boolean };
  /** Build the cell text given the chosen field (or '' if none required). */
  build: (field: string) => string;
  /** Hint at the produced shape so the post-insert mode switch is correct. */
  resultMode: Mode;
}

/** Canonical Age-from-DOB recipe (plan v0.2 §3 — "1 recipe with corpus
 *  support"). Uses the `difference-in-months / div 12` form — the most
 *  widely-used age-in-years pattern in cht-default. The recipe round-trips
 *  byte-stable through the `'single'` self-check (Bucket A test pins it). */
const AGE_FROM_DOB: CalcTemplate = {
  id: 'age-from-dob',
  title: 'Age from date of birth',
  description: 'Whole-year age, recalculated against today’s date.',
  fieldArg: {
    label: 'Date-of-birth field',
    accepts: (n) => /dob|date_of_birth|birth/i.test(n),
  },
  build: (field) => `floor( difference-in-months( \${${field}}, today() ) div 12 )`,
  resultMode: 'single',
};

const TEMPLATES: ReadonlyArray<CalcTemplate> = [AGE_FROM_DOB];

/* ========================== typed output value =========================== */

/**
 * Detect the user-intended kind of an output cell so the typed-output
 * affordance can show the right control + auto-quote indicator. This is
 * purely a UI hint — the underlying string is what gets serialized.
 */
type OutputKind = 'literal' | 'number' | 'field-ref' | 'expression';

function inferOutputKind(raw: string): OutputKind {
  const v = raw.trim();
  if (v === '') return 'literal';
  if (/^'[^']*'$/.test(v) || /^"[^"]*"$/.test(v)) return 'literal';
  if (/^-?\d+(\.\d+)?$/.test(v)) return 'number';
  if (/^\$\{[^}]+\}$/.test(v)) return 'field-ref';
  return 'expression';
}

/** Strip surrounding single/double quotes for display in the literal input.
 *  The serializer re-adds them via `autoQuoteLiteral`. */
function unquoteLiteral(raw: string): string {
  const v = raw.trim();
  if (/^'(.*)'$/.test(v)) return v.slice(1, -1);
  if (/^"(.*)"$/.test(v)) return v.slice(1, -1);
  return v;
}

/** Wrap a user-typed literal in single quotes (XLSForm convention). Empty
 *  string maps to `''` so the cell isn't accidentally deleted by an empty
 *  output slot. */
function autoQuoteLiteral(raw: string): string {
  return `'${raw.replace(/'/g, "\\'")}'`;
}

/** Wrap a chosen field name as `${name}` — the XLSForm reference form. */
function quoteFieldRef(name: string): string {
  return `\${${name}}`;
}

/* ============================ main component ============================= */

export function CalculationBuilder(props: Props) {
  const [parsed, setParsed] = useState<ParsedCalculation>(() => parseCalculation(props.value));
  const [mode, setMode] = useState<Mode>(() => initialModeFor(parseCalculation(props.value)));
  const [rawText, setRawText] = useState<string>(props.value);
  const [singleValue, setSingleValue] = useState<string>(() => {
    const p = parseCalculation(props.value);
    return p.shape === 'single' ? p.otherwise : '';
  });
  const [editingCondIdx, setEditingCondIdx] = useState<number | null>(null);

  // Rehydrate from props.value whenever it changes (modal can re-open
  // on a different cell). Mode follows the parsed shape.
  useEffect(() => {
    const p = parseCalculation(props.value);
    setParsed(p);
    setRawText(props.value);
    setSingleValue(p.shape === 'single' ? p.otherwise : '');
    setMode(initialModeFor(p));
  }, [props.value]);

  /* -------------------------- table-mode actions -------------------------- */

  function patch(next: ParsedCalculation) {
    setParsed(next);
  }
  function patchRule(idx: number, updater: (r: CalculationRule) => CalculationRule) {
    if (parsed.shape !== 'decision_table') return;
    patch({ ...parsed, rules: parsed.rules.map((r, i) => (i === idx ? updater(r) : r)) });
  }
  function addRule() {
    // First rule promotes a single-value cell into a decision table.
    const base: ParsedCalculation =
      parsed.shape === 'decision_table'
        ? parsed
        : {
            shape: 'decision_table',
            rules: [],
            otherwise: parsed.otherwise,
            raw: parsed.raw,
          };
    patch({
      ...base,
      rules: [...base.rules, { condition: parseRelevant(''), output: "''" }],
    });
  }
  function removeRule(idx: number) {
    if (parsed.shape !== 'decision_table') return;
    patch({ ...parsed, rules: parsed.rules.filter((_, i) => i !== idx) });
  }

  /* --------------------------- template insert --------------------------- */

  function applyTemplate(template: CalcTemplate, field: string): void {
    const text = template.build(field);
    setRawText(text);
    setSingleValue(text);
    setParsed(parseCalculation(text));
    setMode(template.resultMode);
  }

  /* ------------------------------- save ---------------------------------- */

  function save() {
    if (mode === 'raw') {
      props.onSave(rawText);
      return;
    }
    if (mode === 'single') {
      // Single-value path: persist the user-edited single value verbatim.
      // The parent's setExtra normalizes a length-0 cell to a delete, so a
      // genuinely-empty `singleValue` collapses cleanly.
      props.onSave(singleValue);
      return;
    }
    if (mode === 'common') {
      // Templates panel; nothing to save directly — a template click
      // already updated `singleValue`/`rawText` and switched the mode.
      props.onSave(singleValue || rawText);
      return;
    }
    // 'if-then' table
    props.onSave(serializeCalculation(parsed));
  }

  /* ------------------------------ derived -------------------------------- */

  /** The string we'd save right now, used by both `Result:` and the
   *  collapsible compiled-expression panel. */
  const currentSerialized: string = useMemo(() => {
    if (mode === 'raw') return rawText;
    if (mode === 'single') return singleValue;
    if (mode === 'common') return singleValue || rawText;
    return serializeCalculation(parsed);
  }, [mode, rawText, singleValue, parsed]);

  const resultReadback = useMemo(
    () => describeCalculation(currentSerialized),
    [currentSerialized],
  );

  /* ------------------------------- render -------------------------------- */

  return (
    <div className="rule-builder-modal" role="dialog" aria-label="Calculation builder">
      <div className="rule-builder-card calc-card">
        <header className="row gap">
          <h3>{props.title ?? 'Calculation builder'}</h3>
          <button className="link" onClick={props.onCancel}>cancel</button>
        </header>

        {/* a11y tablist — radio semantics via aria-pressed on each tab. */}
        <div role="tablist" aria-label="Calculation mode" className="row gap calc-modes">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'active' : 'link'}
              onClick={() => setMode(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {mode === 'single' && (
          <SingleValuePanel
            value={singleValue}
            onChange={setSingleValue}
            fieldOptions={props.fieldOptions}
          />
        )}

        {mode === 'if-then' && (
          <DecisionTablePanel
            parsed={parsed}
            patch={patch}
            patchRule={patchRule}
            addRule={addRule}
            removeRule={removeRule}
            fieldOptions={props.fieldOptions}
            onEditCondition={setEditingCondIdx}
          />
        )}

        {mode === 'common' && (
          <TemplatesGallery
            templates={TEMPLATES}
            fieldOptions={props.fieldOptions}
            onApply={applyTemplate}
          />
        )}

        {mode === 'raw' && (
          <textarea
            className="code-editor medium"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            spellCheck={false}
            aria-label="Raw XLSForm expression"
          />
        )}

        {/* Plain-language Result: readback above the compiled-expression
            collapsible. Visible across all modes so the user can compare
            authoring vs. evaluated meaning at a glance (plan §3). */}
        <ResultReadback summary={resultReadback} expression={currentSerialized} />

        <footer className="row gap end">
          <button onClick={save}>Save</button>
          <button className="link" onClick={props.onCancel}>cancel</button>
        </footer>

        {editingCondIdx !== null &&
          mode === 'if-then' &&
          parsed.shape === 'decision_table' &&
          parsed.rules[editingCondIdx] && (
            <RelevantRuleBuilder
              column={`rule #${editingCondIdx + 1} condition`}
              value={serializeRelevant(parsed.rules[editingCondIdx]!.condition)}
              fieldOptions={props.fieldOptions}
              onCancel={() => setEditingCondIdx(null)}
              onSave={(v) => {
                patchRule(editingCondIdx, (r) => ({ ...r, condition: parseRelevant(v) }));
                setEditingCondIdx(null);
              }}
            />
          )}
      </div>
    </div>
  );
}

/* =========================== single-value panel ========================== */

function SingleValuePanel(props: {
  value: string;
  onChange: (v: string) => void;
  fieldOptions: string[];
}) {
  const kind = inferOutputKind(props.value);
  const [activeKind, setActiveKind] = useState<OutputKind>(kind);

  // The displayed input is bound to the OUTPUT shape (literal stripped of
  // quotes for typing; field-ref shown as the name; number raw). The
  // on-change handlers re-serialize into canonical XLSForm form.
  return (
    <div className="single-value-panel">
      <p className="muted">
        The cell evaluates to a single value. Pick what kind of value you want
        and the builder writes the right XLSForm syntax for you.
      </p>
      <div role="radiogroup" aria-label="Value kind" className="row gap">
        {(['literal', 'number', 'field-ref', 'expression'] as OutputKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={activeKind === k}
            className={activeKind === k ? 'active' : 'link'}
            onClick={() => setActiveKind(k)}
          >
            {kindLabel(k)}
          </button>
        ))}
      </div>

      {activeKind === 'literal' && (
        <label className="row gap" style={{ alignItems: 'center' }}>
          <span className="muted">Text:</span>
          <input
            value={unquoteLiteral(props.value)}
            onChange={(e) => props.onChange(autoQuoteLiteral(e.target.value))}
            placeholder="e.g. yes"
            aria-label="Literal text value"
          />
          <code className="muted" title="Auto-quoted to XLSForm string form">
            saved as <strong>{autoQuoteLiteral(unquoteLiteral(props.value)) || "''"}</strong>
          </code>
        </label>
      )}

      {activeKind === 'number' && (
        <label className="row gap" style={{ alignItems: 'center' }}>
          <span className="muted">Number:</span>
          <input
            type="number"
            value={/^-?\d+(\.\d+)?$/.test(props.value.trim()) ? props.value.trim() : ''}
            onChange={(e) => props.onChange(e.target.value)}
            placeholder="0"
            aria-label="Numeric value"
          />
        </label>
      )}

      {activeKind === 'field-ref' && (
        <label className="row gap" style={{ alignItems: 'center' }}>
          <span className="muted">Field:</span>
          <select
            value={extractFieldName(props.value)}
            onChange={(e) =>
              props.onChange(e.target.value ? quoteFieldRef(e.target.value) : '')
            }
            aria-label="Field reference"
          >
            <option value="">— pick a field —</option>
            {props.fieldOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <code className="muted">saved as <strong>{props.value || '${field}'}</strong></code>
        </label>
      )}

      {activeKind === 'expression' && (
        <label className="row gap" style={{ alignItems: 'flex-start' }}>
          <span className="muted">Expression:</span>
          <textarea
            className="code-editor small"
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            placeholder="e.g. floor((today() - ${dob}) div 365.25)"
            aria-label="Custom XLSForm expression"
            rows={2}
          />
        </label>
      )}
    </div>
  );
}

function kindLabel(k: OutputKind): string {
  switch (k) {
    case 'literal':
      return 'Text';
    case 'number':
      return 'Number';
    case 'field-ref':
      return 'Field value';
    case 'expression':
      return 'Custom expression';
  }
}

function extractFieldName(raw: string): string {
  const m = raw.trim().match(/^\$\{([^}]+)\}$/);
  return m ? m[1]! : '';
}

/* ========================== decision-table panel ========================= */

function DecisionTablePanel(props: {
  parsed: ParsedCalculation;
  patch: (next: ParsedCalculation) => void;
  patchRule: (idx: number, u: (r: CalculationRule) => CalculationRule) => void;
  addRule: () => void;
  removeRule: (idx: number) => void;
  fieldOptions: string[];
  onEditCondition: (idx: number) => void;
}) {
  const { parsed } = props;
  return (
    <>
      <p className="muted">
        First matching rule wins. If no rule matches, the &quot;otherwise&quot; value is used.
      </p>
      <table className="decision-table">
        <thead>
          <tr>
            <th style={{ width: 24 }}>#</th>
            <th>If…</th>
            <th style={{ width: 260 }}>Then output</th>
            <th style={{ width: 60 }}></th>
          </tr>
        </thead>
        <tbody>
          {parsed.shape === 'decision_table' &&
            parsed.rules.map((rule, idx) => (
              <tr key={idx}>
                <td>{idx + 1}</td>
                <td>
                  <div className="row gap">
                    <code className="cond-preview">
                      {serializeConditionSummary(rule.condition) || '(empty)'}
                    </code>
                    <button
                      className="link"
                      onClick={() => props.onEditCondition(idx)}
                      aria-label={`edit condition for rule ${idx + 1}`}
                      title="Edit condition"
                    >
                      ✎ edit
                    </button>
                  </div>
                </td>
                <td>
                  <TypedOutputInput
                    value={rule.output}
                    fieldOptions={props.fieldOptions}
                    onChange={(v) => props.patchRule(idx, (r) => ({ ...r, output: v }))}
                  />
                </td>
                <td>
                  <button
                    className="link danger"
                    onClick={() => props.removeRule(idx)}
                    aria-label={`remove rule ${idx + 1}`}
                    title="Remove rule"
                  >
                    × remove
                  </button>
                </td>
              </tr>
            ))}
          <tr className="otherwise-row">
            <td colSpan={2} style={{ textAlign: 'right' }}>
              <strong>otherwise</strong>
            </td>
            <td>
              <TypedOutputInput
                value={parsed.otherwise}
                fieldOptions={props.fieldOptions}
                onChange={(v) => props.patch({ ...parsed, otherwise: v })}
              />
            </td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <div className="row gap toolbar">
        <button onClick={props.addRule}>+ Rule</button>
      </div>
    </>
  );
}

/* ========================== typed output (Tier 1) ======================== */

/**
 * Typed-output replacement for the bare `<input placeholder="'yes' or 5">`
 * in the decision table. Picks a control based on the value's current
 * shape, with three explicit kind tabs so the user knows what's being
 * saved. Visible auto-quote indicator on the literal kind.
 */
function TypedOutputInput(props: {
  value: string;
  fieldOptions: string[];
  onChange: (v: string) => void;
}) {
  const detected = inferOutputKind(props.value);
  const [kind, setKind] = useState<OutputKind>(detected);
  // Re-sync the active kind tab when the underlying value changes shape
  // (e.g. the user picked a template that swapped the cell to a field-ref).
  useEffect(() => setKind(detected), [detected]);

  return (
    <div className="typed-output">
      <div role="radiogroup" aria-label="Output kind" className="row gap typed-output-kinds">
        {(['literal', 'number', 'field-ref'] as OutputKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={kind === k ? 'active' : 'link'}
            onClick={() => setKind(k)}
          >
            {kindLabel(k)}
          </button>
        ))}
      </div>
      {kind === 'literal' && (
        <div className="row gap" style={{ alignItems: 'center' }}>
          <input
            value={unquoteLiteral(props.value)}
            onChange={(e) => props.onChange(autoQuoteLiteral(e.target.value))}
            placeholder="yes"
            aria-label="Literal text"
          />
          <code className="muted typed-output-hint">
            saved as <strong>{autoQuoteLiteral(unquoteLiteral(props.value)) || "''"}</strong>
          </code>
        </div>
      )}
      {kind === 'number' && (
        <input
          type="number"
          value={/^-?\d+(\.\d+)?$/.test(props.value.trim()) ? props.value.trim() : ''}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder="0"
          aria-label="Numeric output"
        />
      )}
      {kind === 'field-ref' && (
        <select
          value={extractFieldName(props.value)}
          onChange={(e) =>
            props.onChange(e.target.value ? quoteFieldRef(e.target.value) : '')
          }
          aria-label="Field reference"
        >
          <option value="">— pick a field —</option>
          {props.fieldOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/* ============================== templates =============================== */

function TemplatesGallery(props: {
  templates: ReadonlyArray<CalcTemplate>;
  fieldOptions: string[];
  onApply: (t: CalcTemplate, field: string) => void;
}) {
  return (
    <div className="templates-gallery">
      <p className="muted">
        Pick a recipe to seed this calculation. You can edit it freely
        afterwards in any of the other modes.
      </p>
      {props.templates.map((t) => (
        <TemplateCard
          key={t.id}
          template={t}
          fieldOptions={props.fieldOptions}
          onApply={(field) => props.onApply(t, field)}
        />
      ))}
    </div>
  );
}

function TemplateCard(props: {
  template: CalcTemplate;
  fieldOptions: string[];
  onApply: (field: string) => void;
}) {
  const { template } = props;
  const accepts = template.fieldArg?.accepts;
  const candidates = useMemo(
    () => (accepts ? props.fieldOptions.filter(accepts) : props.fieldOptions),
    [accepts, props.fieldOptions],
  );
  const [chosen, setChosen] = useState<string>(() => candidates[0] ?? '');
  useEffect(() => {
    if (!chosen && candidates[0]) setChosen(candidates[0]);
  }, [candidates, chosen]);

  return (
    <section className="template-card" aria-labelledby={`tpl-${template.id}-title`}>
      <h4 id={`tpl-${template.id}-title`}>{template.title}</h4>
      <p className="muted">{template.description}</p>
      {template.fieldArg && (
        <label className="row gap" style={{ alignItems: 'center' }}>
          <span className="muted">{template.fieldArg.label}:</span>
          <select
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            aria-label={template.fieldArg.label}
          >
            {candidates.length === 0 && <option value="">— no matching field —</option>}
            {candidates.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row gap">
        <button
          type="button"
          onClick={() => props.onApply(chosen)}
          disabled={Boolean(template.fieldArg) && !chosen}
        >
          Insert
        </button>
        <code className="muted preview">
          {chosen ? template.build(chosen) : template.build('field')}
        </code>
      </div>
    </section>
  );
}

/* ============================ Result readback ============================ */

function ResultReadback(props: { summary: string; expression: string }) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="calc-result">
      <div className="row gap">
        <strong className="muted">Result:</strong>
        <span>{props.summary}</span>
        <button
          type="button"
          className="link"
          onClick={() => setShowRaw((s) => !s)}
          aria-expanded={showRaw}
        >
          {showRaw ? 'hide XLSForm expression' : 'show XLSForm expression'}
        </button>
      </div>
      {showRaw && (
        <pre className="preview" aria-label="Compiled XLSForm expression">
          {props.expression || '(empty)'}
        </pre>
      )}
    </div>
  );
}

/** Plain-language summary of what an XLSForm calculation expression
 *  produces. Best-effort for the recognized shapes; falls through to a
 *  generic message for anything else (raw mode keeps the truth in the
 *  collapsible `<pre>` below).  */
function describeCalculation(expr: string): string {
  const trimmed = expr.trim();
  if (trimmed === '') return 'Empty — the cell will be cleared on save.';
  // Bare field reference.
  const fieldRef = trimmed.match(/^\$\{([^}]+)\}$/);
  if (fieldRef) return `Uses the value of \${${fieldRef[1]!}}.`;
  // Quoted string literal.
  if (/^'[^']*'$/.test(trimmed) || /^"[^"]*"$/.test(trimmed)) {
    return `Always evaluates to ${trimmed}.`;
  }
  // Numeric literal.
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return `Always evaluates to ${trimmed}.`;
  // Recognized Age-from-DOB shape.
  if (/^floor\(\s*difference-in-months\(\s*\$\{[^}]+\},\s*today\(\)\s*\)\s*div\s*12\s*\)$/.test(trimmed)) {
    return 'Whole-year age computed against today’s date.';
  }
  // If-chain prose, mirroring the relevant-rule serializer's style.
  if (trimmed.startsWith('if(')) {
    const parsed = parseCalculation(trimmed);
    if (parsed.shape === 'decision_table') {
      const ruleProse = parsed.rules
        .map((r, i) => `rule ${i + 1}: when ${conditionProse(r.condition)}, output ${r.output}`)
        .join('; ');
      return `${ruleProse}; otherwise ${parsed.otherwise}.`;
    }
  }
  return 'Hand-written XLSForm expression (no plain-language preview).';
}

function conditionProse(cond: ParsedExpression): string {
  if (cond.rules.length === 0) return '(empty)';
  const parts = cond.rules.map((r) => {
    if (r.kind === 'comparison') {
      const v = r.valueIsString ? r.value : r.value;
      return `\${${r.field}} ${r.op} ${v}`;
    }
    if (r.kind === 'selected') {
      return `${r.negated ? 'not ' : ''}\${${r.field}} includes ${r.value}`;
    }
    if (r.kind === 'answered') {
      return `\${${r.field}} ${r.negated ? 'is empty' : 'is answered'}`;
    }
    if (r.kind === 'age') {
      return `age of \${${r.field}} ${r.op} ${r.value} years`;
    }
    if (r.kind === 'date_offset') {
      return `\${${r.field}} ${r.comparator === 'more_than' ? '>' : '<'} ${r.amount} ${r.unit} ${r.direction === 'ago' ? 'ago' : 'from now'}`;
    }
    return r.text;
  });
  return parts.join(` ${cond.combinator} `);
}

/* ============================== helpers ================================= */

/** Short human summary of a condition for the table cell. */
function serializeConditionSummary(cond: ParsedExpression): string {
  if (cond.rules.length === 0) return '';
  return conditionProse(cond);
}
