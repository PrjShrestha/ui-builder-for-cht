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
          onChange={(e) => props.onChange({ ...a, passesVisitWindow: e.target.checked })}
        />
        <span>
          <strong>Pass visit window into the form</strong>{' '}
          <em className="muted">
            (sets <code>visit</code>, <code>current_period_start</code>,{' '}
            <code>current_period_end</code> — standard for scheduled follow-ups)
          </em>
        </span>
      </label>
      {a.customModifyContent && !a.passesVisitWindow && (
        <details>
          <summary className="muted">Custom modifyContent (read-only here; edit in Raw JS)</summary>
          <pre className="small muted">{a.customModifyContent}</pre>
        </details>
      )}
    </div>
  );
}
