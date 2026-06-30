/**
 * "Insert field reference" helper for the raw-JS code editors (resolvedIf,
 * events.dueDate, actions.modifyContent). Opens a small modal where the
 * user picks a report form (filtered by the task's appliesToType when
 * provided), lazily loads its fields, picks one, and the chosen snippet —
 * e.g. `Utils.getField(report, 'screening_for_cervical_cancer.checked_cervical_cancer')`
 * — is inserted at the textarea's cursor.
 *
 * The textarea ref is passed by the host so we can splice at caret
 * position instead of appending blindly.
 */
import { useMemo, useState } from 'react';
import { useApp } from '../state/store.js';
import { useReportFormFields } from './useReportFormFields.js';

interface Props {
  /** Form basenames the task runs on (appliesToType). Empty → all app forms. */
  availableForms: string[];
  /** Current value of the textarea / input we're inserting into. */
  value: string;
  /** Called with new value after insertion. */
  onChange: (next: string) => void;
  /** Cursor position to splice at; if null, snippet is appended. */
  caret?: number | null;
}

export function InsertFieldButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="link small"
        onClick={() => setOpen(true)}
        title="Insert a field reference at the cursor"
      >
        ➕ field
      </button>
      {open && (
        <InsertFieldModal
          availableForms={props.availableForms}
          onCancel={() => setOpen(false)}
          onPick={(snippet) => {
            setOpen(false);
            const pos = props.caret ?? props.value.length;
            const next = props.value.slice(0, pos) + snippet + props.value.slice(pos);
            props.onChange(next);
          }}
        />
      )}
    </>
  );
}

function InsertFieldModal(props: {
  availableForms: string[];
  onCancel: () => void;
  onPick: (snippet: string) => void;
}) {
  // Zustand selector stability — inline `s.forms.filter().map()` returns a
  // new array on every store read, which makes useSyncExternalStore think
  // the snapshot changed and triggers an infinite render loop ("Maximum
  // update depth exceeded"). Pull the stable slice; useMemo the derived
  // list. Same pattern as ReportFieldPicker.
  const forms = useApp((s) => s.forms);
  const allAppForms = useMemo(
    () =>
      forms
        .filter((f) => f.category === 'app')
        .map((f) => f.filename.replace(/\.xlsx$/i, '')),
    [forms],
  );
  const formOptions = props.availableForms.length > 0 ? props.availableForms : allAppForms;
  const [pickedForm, setPickedForm] = useState<string | null>(formOptions[0] ?? null);
  const { fields, loading } = useReportFormFields(pickedForm);
  const [shape, setShape] = useState<'getField' | 'raw'>('getField');

  function snippetFor(field: string): string {
    if (shape === 'getField') return `Utils.getField(report, '${field}')`;
    return `report.${field}`;
  }

  return (
    <div className="modal-overlay" onClick={props.onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Insert field reference</h2>
          <button className="link" onClick={props.onCancel}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="row gap">
            <label>
              <span>Form</span>
              <select
                value={pickedForm ?? ''}
                onChange={(e) => setPickedForm(e.target.value || null)}
                disabled={formOptions.length === 0}
              >
                {formOptions.length === 0 && <option value="">— no app forms —</option>}
                {formOptions.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Shape</span>
              <select value={shape} onChange={(e) => setShape(e.target.value as 'getField' | 'raw')}>
                <option value="getField">Utils.getField(report, &apos;…&apos;)</option>
                <option value="raw">report.…</option>
              </select>
            </label>
          </div>
          {props.availableForms.length === 0 && (
            <p className="muted small">
              No <code>appliesToType</code> set on this task — showing all app forms.
            </p>
          )}
          {loading ? (
            <p className="muted">Loading fields…</p>
          ) : fields.length === 0 ? (
            <p className="muted">No fields found in this form.</p>
          ) : (
            <ul className="folder-list">
              {fields.map((f) => (
                <li
                  key={f}
                  className="folder-entry"
                  onClick={() => props.onPick(snippetFor(f))}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="folder-name">{f}</span>
                  <code className="muted small">{snippetFor(f)}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
