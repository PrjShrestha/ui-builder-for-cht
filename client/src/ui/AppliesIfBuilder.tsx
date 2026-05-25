/**
 * Visual rule builder for task `appliesIf` (and contact-summary flag bodies).
 *
 * Parses the JS into AppliesIfRule list via the shared appliesIfParser, lets
 * the user toggle dropdowns and checkboxes, serializes back. Falls back to
 * a raw code editor for expressions the parser couldn't lift.
 */
import { useEffect, useState } from 'react';
import {
  parseAppliesIf,
  serializeAppliesIf,
  type AppliesIfRule,
  type ParsedAppliesIf,
} from '@cht-ui/shared';

interface Props {
  value: string;
  onSave: (next: string) => void;
  onCancel: () => void;
  title?: string;
}

export function AppliesIfBuilder(props: Props) {
  const [parsed, setParsed] = useState<ParsedAppliesIf>(() => parseAppliesIf(props.value));
  const [showRaw, setShowRaw] = useState<boolean>(false);
  const [rawText, setRawText] = useState<string>(props.value);

  useEffect(() => {
    setParsed(parseAppliesIf(props.value));
    setRawText(props.value);
  }, [props.value]);

  function updateRule(idx: number, next: AppliesIfRule) {
    setParsed({ ...parsed, rules: parsed.rules.map((r, i) => (i === idx ? next : r)) });
  }
  function removeRule(idx: number) {
    setParsed({ ...parsed, rules: parsed.rules.filter((_, i) => i !== idx) });
  }
  function addRule(kind: AppliesIfRule['kind']) {
    let next: AppliesIfRule;
    switch (kind) {
      case 'is_task_user':
        next = { kind: 'is_task_user' };
        break;
      case 'is_alive':
        next = { kind: 'is_alive', negated: false };
        break;
      case 'is_muted':
        next = { kind: 'is_muted', negated: true };
        break;
      case 'has_error':
        next = { kind: 'has_error', negated: true };
        break;
      case 'helper':
        next = { kind: 'helper', name: 'isActivePregnancy', args: 'contact.contact, contact.reports, report', negated: false };
        break;
      case 'contact_field':
        next = { kind: 'contact_field', field: 'role', op: '===', value: 'patient' };
        break;
      case 'report_field':
        next = { kind: 'report_field', field: 'surveillance.has_chronic_symptoms', op: '===', value: 'yes' };
        break;
      case 'raw':
        next = { kind: 'raw', text: '' };
        break;
    }
    setParsed({ ...parsed, rules: [...parsed.rules, next] });
  }

  function save() {
    if (showRaw) {
      props.onSave(rawText);
      return;
    }
    props.onSave(serializeAppliesIf(parsed));
  }

  return (
    <div className="rule-builder-modal" role="dialog">
      <div className="rule-builder-card">
        <header className="row gap">
          <h3>{props.title ?? 'Rule builder — appliesIf'}</h3>
          <button className="link" onClick={props.onCancel}>cancel</button>
        </header>

        <div className="row gap">
          <button className={!showRaw ? 'active' : 'link'} onClick={() => setShowRaw(false)}>
            Visual
          </button>
          <button className={showRaw ? 'active' : 'link'} onClick={() => setShowRaw(true)}>
            Raw JS
          </button>
          {parsed.hasRawFallback && !showRaw && (
            <span className="badge warn">
              Some clauses couldn&apos;t be lifted; they appear as &quot;raw&quot; rows below.
            </span>
          )}
        </div>

        {!showRaw && (
          <>
            <p className="muted">
              All conditions are AND-combined. The function returns true when every condition is met.
              Parameters detected: <code>{parsed.params.join(', ') || '(none)'}</code>
            </p>
            <div className="rule-list">
              {parsed.rules.map((rule, idx) => (
                <AppliesIfRuleRow
                  key={idx}
                  rule={rule}
                  onChange={(r) => updateRule(idx, r)}
                  onRemove={() => removeRule(idx)}
                />
              ))}
              <div className="row gap toolbar">
                <button className="link" onClick={() => addRule('is_alive')}>+ alive check</button>
                <button className="link" onClick={() => addRule('is_muted')}>+ muted check</button>
                <button className="link" onClick={() => addRule('has_error')}>+ error check</button>
                <button className="link" onClick={() => addRule('is_task_user')}>+ task user</button>
                <button className="link" onClick={() => addRule('contact_field')}>+ contact field</button>
                <button className="link" onClick={() => addRule('report_field')}>+ report field</button>
                <button className="link" onClick={() => addRule('helper')}>+ helper fn</button>
                <button className="link" onClick={() => addRule('raw')}>+ raw JS</button>
              </div>
            </div>
            <div className="preview">
              <pre>{serializeAppliesIf(parsed)}</pre>
            </div>
          </>
        )}

        {showRaw && (
          <textarea
            className="code-editor medium"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            spellCheck={false}
          />
        )}

        <footer className="row gap end">
          <button onClick={save}>Save</button>
          <button className="link" onClick={props.onCancel}>cancel</button>
        </footer>
      </div>
    </div>
  );
}

function AppliesIfRuleRow(props: {
  rule: AppliesIfRule;
  onChange: (r: AppliesIfRule) => void;
  onRemove: () => void;
}) {
  const r = props.rule;
  const remove = (
    <button className="link danger" onClick={props.onRemove}>×</button>
  );

  switch (r.kind) {
    case 'is_task_user':
      return (
        <div className="row gap rule-row">
          <code>User is a task user</code>
          <span className="muted">(<code>isTaskUser(user)</code>)</span>
          {remove}
        </div>
      );

    case 'is_alive':
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
          <code>Contact is alive</code>
          {remove}
        </div>
      );

    case 'is_muted':
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
          <code>Contact is muted</code>
          <span className="muted">({r.negated ? 'i.e. not muted' : 'i.e. muted'})</span>
          {remove}
        </div>
      );

    case 'has_error':
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
          <code>Report has error</code>
          <span className="muted">({r.negated ? 'i.e. no error' : 'i.e. has error'})</span>
          {remove}
        </div>
      );

    case 'helper':
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
          <input
            value={r.name}
            onChange={(e) => props.onChange({ ...r, name: e.target.value })}
            placeholder="helper fn name"
          />
          <span>(</span>
          <input
            value={r.args}
            onChange={(e) => props.onChange({ ...r, args: e.target.value })}
            placeholder="arguments"
            style={{ minWidth: 240 }}
          />
          <span>)</span>
          {remove}
        </div>
      );

    case 'contact_field':
      return (
        <div className="row gap rule-row">
          <code>contact.contact.</code>
          <input
            value={r.field}
            onChange={(e) => props.onChange({ ...r, field: e.target.value })}
            placeholder="field"
          />
          <select
            value={r.op}
            onChange={(e) => props.onChange({ ...r, op: e.target.value as '===' | '!==' })}
          >
            <option value="===">=</option>
            <option value="!==">!=</option>
          </select>
          <input
            value={r.value}
            onChange={(e) => props.onChange({ ...r, value: e.target.value })}
            placeholder="value"
          />
          {remove}
        </div>
      );

    case 'report_field':
      return (
        <div className="row gap rule-row">
          <code>getField(report,</code>
          <input
            value={r.field}
            onChange={(e) => props.onChange({ ...r, field: e.target.value })}
            placeholder="field.path"
          />
          <code>)</code>
          <select
            value={r.op}
            onChange={(e) => props.onChange({ ...r, op: e.target.value as '===' | '!==' })}
          >
            <option value="===">=</option>
            <option value="!==">!=</option>
          </select>
          <input
            value={r.value}
            onChange={(e) => props.onChange({ ...r, value: e.target.value })}
            placeholder="value"
          />
          {remove}
        </div>
      );

    case 'raw':
      return (
        <div className="row gap rule-row">
          <input
            value={r.text}
            onChange={(e) => props.onChange({ ...r, text: e.target.value })}
            placeholder="raw JS expression"
            className="raw-rule-input"
          />
          {remove}
        </div>
      );
  }
}
