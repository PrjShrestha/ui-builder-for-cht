/**
 * Visual rule builder for task `appliesIf` (and contact-summary flag bodies).
 *
 * Parses the JS into AppliesIfRule list via the shared appliesIfParser, lets
 * the user toggle dropdowns and checkboxes, serializes back. Falls back to
 * a raw code editor for expressions the parser couldn't lift.
 */
import { useEffect, useState } from 'react';
import type React from 'react';
import {
  parseAppliesIf,
  serializeAppliesIf,
  type AppliesIfRule,
  type ParsedAppliesIf,
} from '@cht-ui/shared';

/** A contact form whose fields can be offered as a picker for `contact_field` rules. */
export interface ContactFormFields {
  /** Display label, e.g. "person" or "family". */
  label: string;
  /** Flat list of field names from that form's XLSForm survey rows. */
  fields: string[];
}

interface Props {
  value: string;
  onSave: (next: string) => void;
  onCancel: () => void;
  title?: string;
  /** Optional: contact forms whose fields populate the `contact_field` picker. */
  contactForms?: ContactFormFields[];
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
    setParsed({
      ...parsed,
      rules: parsed.rules.filter((_, i) => i !== idx),
      guardGroups: parsed.guardGroups.filter((_, i) => i !== idx),
    });
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
    setParsed({
      ...parsed,
      rules: [...parsed.rules, next],
      guardGroups: [...parsed.guardGroups, undefined],
    });
  }

  // Find rule-level validity issues that would silently corrupt round-trip.
  const validationErrors = parsed.rules.flatMap((rule, idx) => {
    if (rule.kind === 'contact_field' || rule.kind === 'report_field') {
      if (isNumericOp(rule.op) && !isValidNumberLiteral(rule.value)) {
        const where = rule.kind === 'contact_field' ? 'contact field' : 'report field';
        return [`Row ${idx + 1}: ${where} needs a numeric value for "${rule.op}".`];
      }
    }
    if (rule.kind === 'raw' && rule.text.trim() === '') {
      return [`Row ${idx + 1}: empty "raw JS" row — delete it or fill it in.`];
    }
    return [];
  });
  const canSave = showRaw || validationErrors.length === 0;

  function save() {
    if (showRaw) {
      props.onSave(rawText);
      return;
    }
    if (validationErrors.length > 0) return;
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
          <button
            className={!showRaw ? 'active' : 'link'}
            onClick={() => {
              if (!showRaw) return;
              // Switching Raw → Visual: re-parse rawText so changes carry over.
              const fromRaw = parseAppliesIf(rawText);
              if (rawText.trim() !== serializeAppliesIf(parsed).trim()) {
                const ok = window.confirm(
                  'Switch to Visual mode? Your raw edits will be re-parsed. ' +
                    'Anything the parser doesn\'t recognize will appear as a "raw" row — nothing is dropped.',
                );
                if (!ok) return;
              }
              setParsed(fromRaw);
              setShowRaw(false);
            }}
          >
            Visual
          </button>
          <button
            className={showRaw ? 'active' : 'link'}
            onClick={() => {
              if (showRaw) return;
              // Switching Visual → Raw: hand the current serialized form to the raw editor.
              setRawText(serializeAppliesIf(parsed));
              setShowRaw(true);
            }}
          >
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
                  contactForms={props.contactForms}
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

        {!showRaw && validationErrors.length > 0 && (
          <div className="rule-builder-errors">
            <strong>Fix these before saving:</strong>
            <ul>
              {validationErrors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

        <footer className="row gap end">
          <button onClick={save} disabled={!canSave}>
            Save
          </button>
          <button className="link" onClick={props.onCancel}>cancel</button>
        </footer>
      </div>
    </div>
  );
}

function AppliesIfRuleRow(props: {
  rule: AppliesIfRule;
  contactForms?: ContactFormFields[];
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
        <ContactFieldRow
          rule={r}
          contactForms={props.contactForms ?? []}
          onChange={props.onChange}
          remove={remove}
        />
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
            onChange={(e) =>
              props.onChange({
                ...r,
                op: e.target.value as '===' | '!==' | '>' | '<' | '>=' | '<=',
              })
            }
          >
            <option value="===">=</option>
            <option value="!==">!=</option>
            <option value=">">&gt;</option>
            <option value="<">&lt;</option>
            <option value=">=">&gt;=</option>
            <option value="<=">&lt;=</option>
          </select>
          <input
            value={r.value}
            onChange={(e) => props.onChange({ ...r, value: e.target.value })}
            placeholder={r.op === '===' || r.op === '!==' ? 'value' : 'number'}
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

/** True if op is a numeric comparison (RHS must be a number). */
function isNumericOp(op: string): boolean {
  return op === '>' || op === '<' || op === '>=' || op === '<=';
}

/** True if value is a valid number for a numeric op. Empty string is invalid. */
function isValidNumberLiteral(v: string): boolean {
  return v.trim() !== '' && /^-?\d+(?:\.\d+)?$/.test(v.trim());
}

function ContactFieldRow(props: {
  rule: Extract<AppliesIfRule, { kind: 'contact_field' }>;
  contactForms: ContactFormFields[];
  onChange: (r: AppliesIfRule) => void;
  remove: React.ReactNode;
}) {
  const { rule: r, contactForms: forms, onChange, remove } = props;
  const knownFields = new Set(forms.flatMap((f) => f.fields));
  // Explicit picker/custom mode — derived state caused focus theft as users
  // typed values that happened to match a known field name.
  const [useCustom, setUseCustom] = useState<boolean>(
    () => forms.length === 0 || !knownFields.has(r.field),
  );
  const valueInvalid = isNumericOp(r.op) && r.value !== '' && !isValidNumberLiteral(r.value);
  const valueEmpty = isNumericOp(r.op) && r.value.trim() === '';

  return (
    <div className="rule-row-block">
      <div className="row gap rule-row">
        <code>contact.contact.</code>
        {forms.length > 0 && !useCustom ? (
          <select
            value={knownFields.has(r.field) ? r.field : ''}
            onChange={(e) => onChange({ ...r, field: e.target.value })}
            title="Pick a field from a contact form"
          >
            {!knownFields.has(r.field) && <option value="">— pick a field —</option>}
            {forms.map((f) => (
              <optgroup key={f.label} label={f.label}>
                {f.fields.map((name) => (
                  <option key={`${f.label}:${name}`} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <input
            value={r.field}
            onChange={(e) => onChange({ ...r, field: e.target.value })}
            placeholder="field name"
            autoFocus={useCustom && r.field === ''}
          />
        )}
        {forms.length > 0 && (
          <button
            type="button"
            className="link small"
            onClick={() => setUseCustom((v) => !v)}
            title={useCustom ? 'Pick from contact forms' : 'Type a custom field name'}
          >
            {useCustom ? 'pick from form' : 'custom'}
          </button>
        )}
        <select
          value={r.op}
          onChange={(e) =>
            onChange({
              ...r,
              op: e.target.value as '===' | '!==' | '>' | '<' | '>=' | '<=',
            })
          }
        >
          <option value="===">=</option>
          <option value="!==">!=</option>
          <option value=">">&gt;</option>
          <option value="<">&lt;</option>
          <option value=">=">&gt;=</option>
          <option value="<=">&lt;=</option>
        </select>
        <input
          value={r.value}
          onChange={(e) => onChange({ ...r, value: e.target.value })}
          placeholder={isNumericOp(r.op) ? 'number' : 'value'}
          className={valueInvalid ? 'invalid' : ''}
        />
        {remove}
      </div>
      {valueInvalid && (
        <div className="rule-row-warning">
          <strong>Not a number.</strong> Comparison <code>{r.op}</code> needs a numeric value
          (e.g. <code>20</code>, <code>5.5</code>, <code>-1</code>) — otherwise the rule won&apos;t
          round-trip and the row will be lost on save.
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
