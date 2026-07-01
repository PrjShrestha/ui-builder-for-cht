/**
 * Picker for a task's `resolvedIf`. Recognizes the canonical
 * "form X submitted in event window" shape; identifiers like
 * `checkTaskResolvedForHomeVisit` (just shown by name); everything else
 * gets a raw code editor.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseResolvedIf,
  serializeResolvedIf,
  type ResolvedIfPattern,
} from '@cht-ui/shared';
import { InsertFieldButton } from './InsertFieldButton.js';
import { useApp } from '../state/store.js';
import { useProjectHelpers } from './useProjectHelpers.js';

interface Props {
  value: string;
  onChange: (next: string) => void;
  appliesToType?: string[];
}

export function ResolvedWhenPicker({ value, onChange, appliesToType }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [pattern, setPattern] = useState<ResolvedIfPattern>(() => parseResolvedIf(value));
  const [rawText, setRawText] = useState<string>(value);
  const [showRaw, setShowRaw] = useState<boolean>(pattern.kind === 'raw');

  // Real-data pickers for the structured branches (task-builder-parity
  // #8). The forms list comes from the stable store slice + useMemo'd
  // derived value so we don't re-trigger the c0c71a8 selector-crash
  // class. The helpers list piggybacks on the cached fetch shared with
  // AppliesIfBuilder's HelperRow.
  const forms = useApp((s) => s.forms);
  const appForms = useMemo(
    () =>
      forms
        .filter((f) => f.category === 'app')
        .map((f) => f.filename.replace(/\.xlsx$/i, ''))
        .sort(),
    [forms],
  );
  const helpers = useProjectHelpers();

  useEffect(() => {
    const p = parseResolvedIf(value);
    setPattern(p);
    setRawText(value);
    if (p.kind === 'raw') setShowRaw(true);
  }, [value]);

  function patch(next: ResolvedIfPattern) {
    setPattern(next);
    onChange(serializeResolvedIf(next));
  }

  return (
    <div className="resolved-when">
      <div className="row gap">
        <button className={!showRaw ? 'active' : 'link'} onClick={() => setShowRaw(false)}>
          Visual
        </button>
        <button className={showRaw ? 'active' : 'link'} onClick={() => setShowRaw(true)}>
          Raw JS
        </button>
      </div>

      {!showRaw && pattern.kind === 'submitted_in_window' && (
        <FormsRefPicker
          formsRef={pattern.formsRef}
          appForms={appForms}
          onChange={(v) => patch({ ...pattern, formsRef: v })}
        />
      )}

      {!showRaw && pattern.kind === 'identifier' && (
        <ResolvedHelperPicker
          name={pattern.name}
          helpers={helpers}
          onChange={(v) => patch({ ...pattern, name: v })}
        />
      )}

      {!showRaw && pattern.kind === 'raw' && (
        <div>
          <span className="muted">Custom logic — edit in Raw JS.</span>
        </div>
      )}

      {!showRaw && (
        <div className="row gap toolbar">
          <button
            className="link"
            onClick={() =>
              patch({ kind: 'submitted_in_window', formsRef: 'FORMS.BACK_PAIN_FOLLOWUP' })
            }
          >
            use "form submitted in window"
          </button>
          <button
            className="link"
            onClick={() => patch({ kind: 'identifier', name: 'checkTaskResolved' })}
          >
            use helper identifier
          </button>
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

/**
 * Picker for the `formsRef` half of "submitted in event window" —
 * which form's submission resolves the task. Most projects reference
 * one form (`FORMS.PREGNANCY_HOME_VISIT`) but the syntax also accepts
 * an array. Single-select dropdown of project app forms; custom-text
 * toggle for advanced syntax (FORMS.X, multi-form arrays).
 */
function FormsRefPicker(props: {
  formsRef: string;
  appForms: string[];
  onChange: (v: string) => void;
}) {
  const { formsRef, appForms, onChange } = props;
  // "Simple" = matches one of the app forms verbatim (or quoted).
  // Anything else (FORMS.X / array / weird) goes to custom mode so we
  // don't truncate the user's expression.
  const stripped = formsRef.trim().replace(/^['"]/, '').replace(/['"]$/, '');
  const isSimple = appForms.includes(stripped);
  const [useCustom, setUseCustom] = useState<boolean>(!isSimple && formsRef.trim() !== '');
  return (
    <div className="row gap">
      <span>Resolves when</span>
      {useCustom ? (
        <input
          value={formsRef}
          onChange={(e) => onChange(e.target.value)}
          placeholder="FORMS.X or ['form_a', 'form_b']"
          style={{ minWidth: 280 }}
        />
      ) : (
        <select
          value={isSimple ? stripped : ''}
          onChange={(e) => onChange(`'${e.target.value}'`)}
          title="App form whose submission resolves the task"
        >
          <option value="">— pick a form —</option>
          {appForms.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      )}
      {appForms.length > 0 && (
        <button
          type="button"
          className="link small"
          onClick={() => setUseCustom((v) => !v)}
          title={useCustom ? 'Pick from app forms' : 'Type FORMS.X or a multi-form array'}
        >
          {useCustom ? 'pick' : 'custom'}
        </button>
      )}
      <span>is submitted within the event window.</span>
    </div>
  );
}

/**
 * Helper-fn name picker for the `identifier` resolvedIf shape. Same
 * useProjectHelpers source as AppliesIfBuilder's HelperRow; same
 * pick / custom toggle. Identifier-shape resolvedIf does NOT take
 * args (the helper is called by cht-conf with the appropriate task
 * context internally), so this is name-only.
 */
function ResolvedHelperPicker(props: {
  name: string;
  helpers: ReturnType<typeof useProjectHelpers>;
  onChange: (v: string) => void;
}) {
  const { name, helpers, onChange } = props;
  const known = helpers.find((h) => h.name === name);
  const [useCustom, setUseCustom] = useState<boolean>(!known && helpers.length > 0);
  return (
    <div className="row gap">
      <span>Resolves via helper</span>
      {useCustom || helpers.length === 0 ? (
        <input value={name} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <select
          value={name}
          onChange={(e) => onChange(e.target.value)}
          title="Pick a helper from tasks-extras.js / contact-summary-extras.js"
        >
          {!known && <option value={name}>{name} (unknown)</option>}
          <optgroup label="tasks-extras.js">
            {helpers
              .filter((h) => h.source === 'tasks-extras')
              .map((h) => (
                <option key={`t:${h.name}`} value={h.name}>
                  {h.name}({h.params.join(', ')})
                </option>
              ))}
          </optgroup>
          <optgroup label="contact-summary-extras.js">
            {helpers
              .filter((h) => h.source === 'contact-summary-extras')
              .map((h) => (
                <option key={`c:${h.name}`} value={h.name}>
                  {h.name}({h.params.join(', ')})
                </option>
              ))}
          </optgroup>
        </select>
      )}
      {helpers.length > 0 && (
        <button
          type="button"
          className="link small"
          onClick={() => setUseCustom((v) => !v)}
        >
          {useCustom ? 'pick' : 'custom'}
        </button>
      )}
      <span className="muted">
        (defined in <code>tasks-extras.js</code> / <code>contact-summary-extras.js</code>)
      </span>
    </div>
  );
}
