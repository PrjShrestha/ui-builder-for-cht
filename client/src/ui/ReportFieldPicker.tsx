/**
 * Picker for "field from a report form": two dropdowns (form, then field)
 * plus a custom-text escape hatch. The user has already committed to the
 * field-path string on save — the form selection is just UI scaffolding to
 * source the dropdown options.
 *
 * Form options come from the task's appliesToType (passed in). If that's
 * empty, we fall back to all app-category forms in the project — better to
 * show *something* pickable than nothing.
 */
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/store.js';
import { useReportFormFields } from './useReportFormFields.js';

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Form basenames that this rule's task runs against (from appliesToType). */
  availableForms: string[];
  placeholder?: string;
}

export function ReportFieldPicker(props: Props) {
  const { value, onChange, availableForms } = props;
  const allAppForms = useApp((s) =>
    s.forms.filter((f) => f.category === 'app').map((f) => f.filename.replace(/\.xlsx$/i, '')),
  );
  const formOptions = availableForms.length > 0 ? availableForms : allAppForms;

  const [pickedForm, setPickedForm] = useState<string | null>(() => formOptions[0] ?? null);
  const [useCustom, setUseCustom] = useState<boolean>(() => formOptions.length === 0);

  // If availableForms changes (task appliesToType edited), reset to first option.
  useEffect(() => {
    if (formOptions.length === 0) {
      setPickedForm(null);
      setUseCustom(true);
    } else if (!pickedForm || !formOptions.includes(pickedForm)) {
      setPickedForm(formOptions[0] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOptions.join('|')]);

  const { fields, loading } = useReportFormFields(useCustom ? null : pickedForm);

  const fieldKnown = useMemo(() => new Set(fields), [fields]);

  return (
    <span className="report-field-picker row gap">
      {!useCustom && formOptions.length > 0 ? (
        <>
          <select
            value={pickedForm ?? ''}
            onChange={(e) => setPickedForm(e.target.value || null)}
            title="Report form"
            className="form-picker"
          >
            {formOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            value={fieldKnown.has(value) ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={loading || fields.length === 0}
            title="Field path within the chosen form"
            className="field-picker"
          >
            <option value="">
              {loading ? '— loading fields… —' : fields.length === 0 ? '— no fields —' : '— pick a field —'}
            </option>
            {fields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </>
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={props.placeholder ?? 'field.path'}
        />
      )}
      <button
        type="button"
        className="link small"
        onClick={() => setUseCustom((v) => !v)}
        title={useCustom ? 'Pick from a form' : 'Type a custom field path'}
      >
        {useCustom ? 'pick' : 'custom'}
      </button>
    </span>
  );
}
