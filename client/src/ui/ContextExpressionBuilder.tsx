/**
 * Visual rule builder for a form's properties.json `context.expression`.
 *
 * Lets non-developers say "person, male, age 18-65, summary.X is true,
 * not muted, not deceased" via dropdowns. Raw text fallback for
 * expressions outside the supported grammar.
 */
import { useEffect, useState } from 'react';
import {
  parseContextExpression,
  serializeContextExpression,
  type ContextRule,
  type ParsedContextExpression,
} from '@cht-ui/shared';
import {
  FieldPicker,
  isNumericOp,
  isValidNumberLiteral,
  type ContactFormFields,
} from './FieldPicker.js';

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Known summary flag names (from contact-summary.templated.js) for the picker. */
  summaryFlags?: string[];
  /** Optional contact forms whose fields populate the `contact_field` picker. */
  contactForms?: ContactFormFields[];
  disabled?: boolean;
}

export function ContextExpressionBuilder({
  value,
  onChange,
  summaryFlags = [],
  contactForms = [],
  disabled,
}: Props) {
  const [parsed, setParsed] = useState<ParsedContextExpression>(() => parseContextExpression(value));
  const [showRaw, setShowRaw] = useState<boolean>(false);
  const [rawText, setRawText] = useState<string>(value);

  useEffect(() => {
    setParsed(parseContextExpression(value));
    setRawText(value);
  }, [value]);

  function patch(next: ParsedContextExpression) {
    setParsed(next);
    onChange(serializeContextExpression(next));
  }

  function updateRule(idx: number, r: ContextRule) {
    patch({ ...parsed, rules: parsed.rules.map((rule, i) => (i === idx ? r : rule)) });
  }
  function removeRule(idx: number) {
    patch({ ...parsed, rules: parsed.rules.filter((_, i) => i !== idx) });
  }
  function addRule(kind: ContextRule['kind']) {
    let r: ContextRule;
    switch (kind) {
      case 'contact_type':
        r = { kind: 'contact_type', value: 'person' };
        break;
      case 'contact_sex':
        r = { kind: 'contact_sex', value: 'male' };
        break;
      case 'contact_field':
        r = { kind: 'contact_field', field: 'role', op: '===', value: 'patient' };
        break;
      case 'age_years':
        r = { kind: 'age_years', op: '>=', value: 18 };
        break;
      case 'summary_flag':
        r = { kind: 'summary_flag', flag: summaryFlags[0] ?? 'show_form', negated: false };
        break;
      case 'not_muted':
        r = { kind: 'not_muted' };
        break;
      case 'not_deceased':
        r = { kind: 'not_deceased' };
        break;
      case 'raw':
        r = { kind: 'raw', text: '' };
        break;
      default:
        return;
    }
    patch({ ...parsed, rules: [...parsed.rules, r] });
  }

  if (disabled) {
    return <div className="muted">Task-only form: expression locked to <code>false</code>.</div>;
  }

  return (
    <div className="context-builder">
      <div className="row gap">
        <button className={!showRaw ? 'active' : 'link'} onClick={() => setShowRaw(false)}>
          Visual
        </button>
        <button className={showRaw ? 'active' : 'link'} onClick={() => setShowRaw(true)}>
          Raw JS
        </button>
        {parsed.hasRawFallback && !showRaw && (
          <span className="badge warn">
            Some clauses aren&apos;t recognized — they appear as &quot;raw&quot; rows.
          </span>
        )}
      </div>

      {!showRaw && (
        <>
          <p className="muted">
            Form shows when ALL conditions are met (AND-combined).
          </p>
          <div className="rule-list">
            {parsed.rules.map((rule, idx) => (
              <ContextRuleRow
                key={idx}
                rule={rule}
                summaryFlags={summaryFlags}
                contactForms={contactForms}
                onChange={(r) => updateRule(idx, r)}
                onRemove={() => removeRule(idx)}
              />
            ))}
            <div className="row gap toolbar">
              <button className="link" onClick={() => addRule('contact_type')}>+ contact type</button>
              <button className="link" onClick={() => addRule('contact_sex')}>+ sex</button>
              <button className="link" onClick={() => addRule('age_years')}>+ age</button>
              <button className="link" onClick={() => addRule('summary_flag')}>+ summary flag</button>
              <button className="link" onClick={() => addRule('contact_field')}>+ other contact field</button>
              <button className="link" onClick={() => addRule('not_muted')}>+ not muted</button>
              <button className="link" onClick={() => addRule('not_deceased')}>+ not deceased</button>
              <button className="link" onClick={() => addRule('raw')}>+ raw JS</button>
            </div>
          </div>
          <div className="preview">
            <code>{serializeContextExpression(parsed) || '(empty)'}</code>
          </div>
        </>
      )}

      {showRaw && (
        <textarea
          className="code-editor short"
          value={rawText}
          onChange={(e) => {
            setRawText(e.target.value);
            onChange(e.target.value);
          }}
          spellCheck={false}
        />
      )}
    </div>
  );
}

function ContextRuleRow(props: {
  rule: ContextRule;
  summaryFlags: string[];
  contactForms: ContactFormFields[];
  onChange: (r: ContextRule) => void;
  onRemove: () => void;
}) {
  const r = props.rule;
  const remove = <button className="link danger" onClick={props.onRemove}>×</button>;
  switch (r.kind) {
    case 'is_true':
      return <div className="row gap rule-row"><code>true</code> <span className="muted">(always show)</span> {remove}</div>;
    case 'is_false':
      return <div className="row gap rule-row"><code>false</code> <span className="muted">(never show)</span> {remove}</div>;

    case 'contact_type':
      return (
        <div className="row gap rule-row">
          <span>Contact type is</span>
          <select value={r.value} onChange={(e) => props.onChange({ ...r, value: e.target.value })}>
            <option value="person">person</option>
            <option value="clinic">clinic / area</option>
            <option value="health_center">health center</option>
            <option value="district_hospital">district hospital</option>
          </select>
          {!['person', 'clinic', 'health_center', 'district_hospital'].includes(r.value) && (
            <input value={r.value} onChange={(e) => props.onChange({ ...r, value: e.target.value })} />
          )}
          {remove}
        </div>
      );

    case 'contact_sex':
      return (
        <div className="row gap rule-row">
          <span>Sex is</span>
          <select value={r.value} onChange={(e) => props.onChange({ ...r, value: e.target.value })}>
            <option value="male">male</option>
            <option value="female">female</option>
            <option value="other">other</option>
          </select>
          {remove}
        </div>
      );

    case 'age_years':
      return (
        <div className="row gap rule-row">
          <span>Age in years</span>
          <select
            value={r.op}
            onChange={(e) => props.onChange({ ...r, op: e.target.value as ContextRule extends { kind: 'age_years' } ? never : never & ('>=' | '<=' | '>' | '<' | '===' | '!==') })}
          >
            <option value=">=">≥</option>
            <option value="<=">≤</option>
            <option value=">">&gt;</option>
            <option value="<">&lt;</option>
            <option value="===">=</option>
            <option value="!==">≠</option>
          </select>
          <input
            type="number"
            value={r.value}
            onChange={(e) => props.onChange({ ...r, value: Number(e.target.value) })}
            style={{ width: 80 }}
          />
          {remove}
        </div>
      );

    case 'summary_flag': {
      const inList = props.summaryFlags.includes(r.flag);
      return (
        <div className="row gap rule-row">
          <label className="row gap">
            <input
              type="checkbox"
              checked={r.negated}
              onChange={(e) => props.onChange({ ...r, negated: e.target.checked })}
            />
            NOT
          </label>
          <code>summary.</code>
          {props.summaryFlags.length > 0 ? (
            <select
              value={inList ? r.flag : '__custom__'}
              onChange={(e) => {
                if (e.target.value === '__custom__') return;
                props.onChange({ ...r, flag: e.target.value });
              }}
            >
              {props.summaryFlags.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
              <option value="__custom__">— custom —</option>
            </select>
          ) : null}
          {(!inList || props.summaryFlags.length === 0) && (
            <input
              value={r.flag}
              onChange={(e) => props.onChange({ ...r, flag: e.target.value })}
              placeholder="flag_name"
            />
          )}
          {remove}
        </div>
      );
    }

    case 'contact_field': {
      const valueInvalid = isNumericOp(r.op) && r.value !== '' && !isValidNumberLiteral(r.value);
      const valueEmpty = isNumericOp(r.op) && r.value.trim() === '';
      return (
        <div className="rule-row-block">
          <div className="row gap rule-row">
            <code>contact.</code>
            <FieldPicker
              value={r.field}
              contactForms={props.contactForms}
              onChange={(field) => props.onChange({ ...r, field })}
            />
            <select
              value={r.op}
              onChange={(e) =>
                props.onChange({
                  ...r,
                  op: e.target.value as '===' | '!==' | '>' | '<' | '>=' | '<=',
                })
              }
            >
              <option value="===">=</option>
              <option value="!==">≠</option>
              <option value=">">&gt;</option>
              <option value="<">&lt;</option>
              <option value=">=">≥</option>
              <option value="<=">≤</option>
            </select>
            <input
              value={r.value}
              onChange={(e) => props.onChange({ ...r, value: e.target.value })}
              placeholder={isNumericOp(r.op) ? 'number' : 'value'}
              className={valueInvalid ? 'invalid' : ''}
            />
            {remove}
          </div>
          {valueInvalid && (
            <div className="rule-row-warning">
              <strong>Not a number.</strong> Comparison <code>{r.op}</code> needs a numeric value
              (e.g. <code>20</code>, <code>5.5</code>, <code>-1</code>) — otherwise the rule
              won&apos;t round-trip and the row will be lost on save.
            </div>
          )}
          {valueEmpty && !valueInvalid && (
            <div className="rule-row-warning muted">
              Enter a number for the <code>{r.op}</code> comparison.
            </div>
          )}
        </div>
      );
    }

    case 'not_muted':
      return <div className="row gap rule-row"><code>Contact is not muted</code> {remove}</div>;
    case 'not_deceased':
      return <div className="row gap rule-row"><code>Contact is not deceased</code> {remove}</div>;

    case 'raw':
      return (
        <div className="row gap rule-row">
          <input
            value={r.text}
            onChange={(e) => props.onChange({ ...r, text: e.target.value })}
            placeholder="raw expression"
            className="raw-rule-input"
          />
          {remove}
        </div>
      );
  }
}
