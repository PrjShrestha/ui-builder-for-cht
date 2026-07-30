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
  /**
   * Optional controlled-mode inputs. When `pickedForm` is provided, the
   * form dropdown becomes controlled from outside — the parent owns the
   * form-choice state and receives updates via `onFormChange`. Used by
   * the Contact Summary "Context values" tab, where the picked form is
   * part of the persisted structured bridge (not just internal UI).
   * Existing callers that only care about the field value can omit both;
   * the picker keeps the internal state it always had.
   */
  pickedForm?: string;
  onFormChange?: (next: string) => void;
}

export function ReportFieldPicker(props: Props) {
  const { value, onChange, availableForms, pickedForm: controlledForm, onFormChange } = props;
  const controlled = controlledForm !== undefined;
  // Zustand snapshot stability — selectors must return the SAME REFERENCE
  // when the underlying slice hasn't changed. A `s.forms.filter().map()`
  // builds a new array on every call → useSyncExternalStore considers the
  // snapshot changed → React re-renders → another store read → infinite
  // loop, crashing with "Maximum update depth exceeded". Select the
  // stable slice (`s.forms`) and derive via useMemo with `forms` as the
  // dep, so the derived list is stable as long as the forms list is.
  const forms = useApp((s) => s.forms);
  const allAppForms = useMemo(
    () =>
      forms
        .filter((f) => f.category === 'app')
        .map((f) => f.filename.replace(/\.xlsx$/i, '')),
    [forms],
  );
  const formOptions = availableForms.length > 0 ? availableForms : allAppForms;

  const [internalForm, setInternalForm] = useState<string | null>(() => formOptions[0] ?? null);
  const [useCustom, setUseCustom] = useState<boolean>(() => formOptions.length === 0);
  // Audit item 13 — distinguish "user clicked custom" from "custom was
  // auto-forced because formOptions was empty". On first paint the store's
  // forms list is often still loading, so `useCustom` seeded true and the
  // picker stayed stuck in free-text after the options arrived.
  const [customExplicit, setCustomExplicit] = useState(false);

  const pickedForm = controlled ? controlledForm || null : internalForm;

  function setPickedForm(next: string | null): void {
    if (controlled) {
      onFormChange?.(next ?? '');
    } else {
      setInternalForm(next);
    }
  }

  // If availableForms changes (task appliesToType edited, or the store's
  // forms list finished loading after first paint), keep the mode + the
  // internal selection coherent. Runs in controlled mode too — the parent
  // owns the picked FORM, but the custom/picker mode is this component's.
  useEffect(() => {
    if (formOptions.length === 0) {
      if (!controlled) setInternalForm(null);
      setUseCustom(true);
      return;
    }
    // Options are (now) available: recover from the auto-forced free-text
    // state unless the user explicitly chose custom (audit item 13).
    if (!customExplicit) setUseCustom(false);
    if (!controlled && (!internalForm || !formOptions.includes(internalForm))) {
      setInternalForm(formOptions[0] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOptions.join('|'), controlled, customExplicit]);

  const { fields, loading } = useReportFormFields(useCustom ? null : pickedForm);

  const fieldKnown = useMemo(() => new Set(fields), [fields]);

  // Audit item 13 — a saved bridge may reference a form/field that no
  // longer exists in the project (form deleted, field renamed). Rendering
  // a blank select while the row summary still claims the read hid the
  // breakage; instead keep the stored value visible in the dropdown and
  // flag it.
  const formOrphan =
    !useCustom && pickedForm !== null && pickedForm !== '' && !formOptions.includes(pickedForm);
  const fieldOrphan =
    !useCustom && !formOrphan && !loading && value.trim() !== '' && !fieldKnown.has(value);

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
            {formOrphan && (
              <option value={pickedForm!}>{pickedForm} — no longer in project</option>
            )}
            {formOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            value={fieldKnown.has(value) || fieldOrphan ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={loading || (fields.length === 0 && !fieldOrphan)}
            title="Field path within the chosen form"
            className="field-picker"
          >
            <option value="">
              {loading ? '— loading fields… —' : fields.length === 0 ? '— no fields —' : '— pick a field —'}
            </option>
            {fieldOrphan && (
              <option value={value}>{value} — not in this form</option>
            )}
            {fields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          {(formOrphan || fieldOrphan) && (
            <span
              className="badge warn"
              title={
                formOrphan
                  ? `The form "${pickedForm}" no longer exists in this project — the saved read will return nothing. Pick another form or switch to custom text.`
                  : `The field "${value}" isn't in "${pickedForm}" — the saved read will return nothing. Pick a field from the list or switch to custom text.`
              }
            >
              {formOrphan ? 'form missing' : 'field missing'}
            </span>
          )}
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
        onClick={() => {
          // A manual toggle is an explicit choice in EITHER direction —
          // afterwards the effect above must stop auto-flipping the mode.
          setCustomExplicit(true);
          setUseCustom((v) => !v);
        }}
        title={useCustom ? 'Pick from a form' : 'Type a custom field path'}
      >
        {useCustom ? 'pick' : 'custom'}
      </button>
    </span>
  );
}
