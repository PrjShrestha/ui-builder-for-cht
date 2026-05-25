/**
 * Reusable field-name input with a contact-form picker and a custom-text
 * fallback. Used by both AppliesIfBuilder (contact_field rule) and
 * ContextExpressionBuilder (contact_field rule).
 *
 * Why this exists as its own component: the obvious "if isKnown show
 * select, else show input" derived-state approach unmounts the input on
 * every keystroke once the value happens to match a known field, stealing
 * focus mid-typing. Here, custom-vs-pick is explicit useState that the
 * user toggles deliberately.
 */
import { useState } from 'react';

export interface ContactFormFields {
  /** Display label, e.g. "person" or "family". */
  label: string;
  /** Flat list of field names from that form's XLSForm survey rows. */
  fields: string[];
}

export function FieldPicker(props: {
  value: string;
  contactForms: ContactFormFields[];
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const { value, contactForms: forms, onChange, placeholder = 'field name' } = props;
  const knownFields = new Set(forms.flatMap((f) => f.fields));
  const [useCustom, setUseCustom] = useState<boolean>(
    () => forms.length === 0 || !knownFields.has(value),
  );

  return (
    <>
      {forms.length > 0 && !useCustom ? (
        <select
          value={knownFields.has(value) ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          title="Pick a field from a contact form"
        >
          {!knownFields.has(value) && <option value="">— pick a field —</option>}
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
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={useCustom && value === ''}
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
    </>
  );
}

/** True if op is a numeric comparison (RHS must be a number). */
export function isNumericOp(op: string): boolean {
  return op === '>' || op === '<' || op === '>=' || op === '<=';
}

/** True if value is a valid number for a numeric op. Empty string is invalid. */
export function isValidNumberLiteral(v: string): boolean {
  return v.trim() !== '' && /^-?\d+(?:\.\d+)?$/.test(v.trim());
}
