/**
 * Visual editor for a task's `actions` array.
 *
 * Card per action with: type radio, form picker, "pass visit window" checkbox.
 * Raw fallback for custom modifyContent bodies.
 */
import { useEffect, useRef, useState } from 'react';
import {
  parseActions,
  serializeActions,
  type ModifyContentMapping,
  type ParsedActions,
  type TaskAction,
} from '@cht-ui/shared';
import { InsertFieldButton } from './InsertFieldButton.js';

interface Props {
  value: string;
  /** Form basenames available in the project for the picker. */
  formOptions: string[];
  onChange: (next: string) => void;
  appliesToType?: string[];
}

export function ActionsEditor({ value, formOptions, onChange, appliesToType }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [parsed, setParsed] = useState<ParsedActions>(() => parseActions(value));
  const [showRaw, setShowRaw] = useState<boolean>(parsed.shape === 'raw');
  const [rawText, setRawText] = useState<string>(value);

  useEffect(() => {
    const p = parseActions(value);
    setParsed(p);
    setRawText(value);
    if (p.shape === 'raw') setShowRaw(true);
  }, [value]);

  function patch(next: ParsedActions) {
    setParsed(next);
    onChange(serializeActions(next));
  }
  function patchAction(idx: number, updater: (a: TaskAction) => TaskAction) {
    if (parsed.shape !== 'array') return;
    patch({ ...parsed, actions: parsed.actions.map((a, i) => (i === idx ? updater(a) : a)) });
  }
  function removeAction(idx: number) {
    if (parsed.shape !== 'array') return;
    patch({ ...parsed, actions: parsed.actions.filter((_, i) => i !== idx) });
  }
  function addAction() {
    if (parsed.shape !== 'array') return;
    patch({
      ...parsed,
      actions: [
        ...parsed.actions,
        { form: formOptions[0] ?? '', type: 'report', passesVisitWindow: false, extras: {} },
      ],
    });
  }

  return (
    <div className="actions-editor">
      <div className="row gap">
        <button className={!showRaw ? 'active' : 'link'} onClick={() => setShowRaw(false)} disabled={parsed.shape !== 'array'}>
          Visual
        </button>
        <button className={showRaw ? 'active' : 'link'} onClick={() => setShowRaw(true)}>
          Raw JS
        </button>
        {parsed.shape === 'raw' && !showRaw && (
          <span className="muted">Actions use a custom shape — switch to Raw JS to edit.</span>
        )}
      </div>

      {!showRaw && parsed.shape === 'array' && (
        <div className="actions-list">
          {parsed.actions.map((a, idx) => (
            <ActionCard
              key={idx}
              action={a}
              formOptions={formOptions}
              onChange={(u) => patchAction(idx, () => u)}
              onRemove={() => removeAction(idx)}
            />
          ))}
          <button onClick={addAction}>+ Action</button>
        </div>
      )}

      {showRaw && (
        <>
          <div className="row gap">
            <InsertFieldButton
              availableForms={appliesToType ?? []}
              value={rawText}
              onChange={(v) => {
                setRawText(v);
                onChange(v);
              }}
              caret={taRef.current?.selectionStart ?? null}
            />
            <span className="muted small">Use to splice a field reference into a modifyContent body.</span>
          </div>
          <textarea
            ref={taRef}
            className="code-editor short"
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value);
              onChange(e.target.value);
            }}
            spellCheck={false}
          />
        </>
      )}
    </div>
  );
}

function ActionCard(props: {
  action: TaskAction;
  formOptions: string[];
  onChange: (a: TaskAction) => void;
  onRemove: () => void;
}) {
  const a = props.action;
  return (
    <div className="event-card">
      <header className="row gap">
        <span className="muted">Action</span>
        <span className="row gap">
          <label className="row gap">
            <input
              type="radio"
              name={`action-type-${a.form}`}
              checked={(a.type ?? 'report') === 'report'}
              onChange={() => props.onChange({ ...a, type: 'report' })}
            />
            report
          </label>
          <label className="row gap">
            <input
              type="radio"
              name={`action-type-${a.form}`}
              checked={a.type === 'contact'}
              onChange={() => props.onChange({ ...a, type: 'contact' })}
            />
            contact
          </label>
        </span>
        <button className="link danger" onClick={props.onRemove}>×</button>
      </header>
      <label className="expr-field">
        <span className="expr-label">
          <code>form</code>
          <em className="muted"> — which form opens when the task is tapped</em>
        </span>
        {props.formOptions.length > 0 ? (
          <select value={a.form} onChange={(e) => props.onChange({ ...a, form: e.target.value })}>
            {!props.formOptions.includes(a.form) && a.form && (
              <option value={a.form}>{a.form} (custom)</option>
            )}
            {props.formOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={a.form}
            onChange={(e) => props.onChange({ ...a, form: e.target.value })}
            placeholder="form basename"
          />
        )}
      </label>
      <label className="row gap">
        <input
          type="checkbox"
          checked={a.passesVisitWindow}
          onChange={(e) =>
            props.onChange({
              ...a,
              passesVisitWindow: e.target.checked,
              // Toggling visit-window on clears the other two paths so
              // the serializer doesn't have to break ties.
              modifyContentMappings: e.target.checked ? undefined : a.modifyContentMappings,
              customModifyContent: e.target.checked ? undefined : a.customModifyContent,
            })
          }
        />
        <span>
          <strong>Pass visit window into the form</strong>{' '}
          <em className="muted">
            (sets <code>visit</code>, <code>current_period_start</code>,{' '}
            <code>current_period_end</code> — standard for scheduled follow-ups)
          </em>
        </span>
      </label>

      {/* Phase 2a — three-way modifyContent editor. Order matters:
          visit-window > structured mappings > opaque raw. The user
          toggles between them deliberately; no auto-detection beyond
          the parser's initial classify(). */}
      {!a.passesVisitWindow && (
        <ModifyContentEditor action={a} onChange={props.onChange} />
      )}
    </div>
  );
}

/**
 * Phase 2a — the structured modifyContent editor + the raw-fallback
 * surface for actions that need conditional logic the structured editor
 * can't express.
 *
 * Three branches by data shape:
 *   - mappings non-empty → structured per-row editor with add/delete.
 *   - customModifyContent set → read-only details (escape hatch — edit
 *     in Raw JS at the editor level).
 *   - neither set → "+ Add field mapping" button initializes the
 *     structured editor with one empty row.
 *
 * When the user deletes the last mapping, the parent action's
 * `modifyContentMappings` is set to `undefined` (NOT `[]`) so the
 * serializer routes back to the clean fallback. The parser's empty-
 * array guard is belt-and-braces.
 */
function ModifyContentEditor(props: {
  action: TaskAction;
  onChange: (a: TaskAction) => void;
}) {
  const a = props.action;
  const mappings = a.modifyContentMappings;
  const hasMappings = mappings !== undefined && mappings.length > 0;
  const hasRaw = !!a.customModifyContent;

  function updateMappings(next: ModifyContentMapping[]): void {
    // Empty-array convention: collapse to `undefined` so the serializer
    // path is unambiguous (plan §3 Phase 2a + the parser's belt-and-
    // braces guard in actionsParser.ts).
    props.onChange({
      ...a,
      modifyContentMappings: next.length > 0 ? next : undefined,
      customModifyContent: undefined,
    });
  }

  function addMapping(): void {
    updateMappings([
      ...(mappings ?? []),
      { targetField: '', sourceExpr: '' },
    ]);
  }

  function patchRow(idx: number, patch: Partial<ModifyContentMapping>): void {
    const current = mappings ?? [];
    updateMappings(current.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  }

  function removeRow(idx: number): void {
    const current = mappings ?? [];
    updateMappings(current.filter((_, i) => i !== idx));
  }

  if (hasMappings) {
    return (
      <div className="modify-content-editor">
        <div className="row gap" style={{ alignItems: 'baseline' }}>
          <strong>Copy report fields into the new form</strong>
          <em className="muted small">
            Each row writes <code>content.<i>target</i> = <i>source</i>;</code> into
            the task's <code>modifyContent</code>.
          </em>
        </div>
        <table className="modify-content-table">
          <thead>
            <tr>
              <th>target field (content.X)</th>
              <th>source expression</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {mappings!.map((m, idx) => (
              <tr key={idx}>
                <td>
                  <input
                    value={m.targetField}
                    onChange={(e) => patchRow(idx, { targetField: e.target.value })}
                    placeholder="e.g. patient_id"
                  />
                </td>
                <td>
                  <input
                    value={m.sourceExpr}
                    onChange={(e) => patchRow(idx, { sourceExpr: e.target.value })}
                    placeholder="e.g. report.patient_id  /  event.id  /  'literal'"
                  />
                </td>
                <td>
                  <button
                    className="link danger"
                    onClick={() => removeRow(idx)}
                    aria-label="Remove mapping"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row gap">
          <button className="link" onClick={addMapping}>
            + Add mapping
          </button>
        </div>
      </div>
    );
  }

  if (hasRaw) {
    return (
      <details>
        <summary className="muted">
          Custom modifyContent (read-only here; edit in Raw JS) — uses control flow
          or helper calls the structured editor can't express
        </summary>
        <pre className="small muted">{a.customModifyContent}</pre>
      </details>
    );
  }

  return (
    <div className="row gap">
      <button className="link" onClick={addMapping}>
        + Add field mapping
      </button>
      <em className="muted small">
        Copies a value from the triggering report into the new form
        (e.g. <code>content.patient_id = report.patient_id</code>).
      </em>
    </div>
  );
}
