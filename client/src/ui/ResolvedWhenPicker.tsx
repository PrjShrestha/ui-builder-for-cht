/**
 * Picker for a task's `resolvedIf`. Recognizes the canonical
 * "form X submitted in event window" shape; identifiers like
 * `checkTaskResolvedForHomeVisit` (just shown by name); everything else
 * gets a raw code editor.
 */
import { useEffect, useState } from 'react';
import {
  parseResolvedIf,
  serializeResolvedIf,
  type ResolvedIfPattern,
} from '@cht-ui/shared';

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export function ResolvedWhenPicker({ value, onChange }: Props) {
  const [pattern, setPattern] = useState<ResolvedIfPattern>(() => parseResolvedIf(value));
  const [rawText, setRawText] = useState<string>(value);
  const [showRaw, setShowRaw] = useState<boolean>(pattern.kind === 'raw');

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
        <div className="row gap">
          <span>Resolves when</span>
          <input
            value={pattern.formsRef}
            onChange={(e) => patch({ ...pattern, formsRef: e.target.value })}
            placeholder="FORMS.X or ['form_name']"
            style={{ minWidth: 240 }}
          />
          <span>is submitted within the event window.</span>
        </div>
      )}

      {!showRaw && pattern.kind === 'identifier' && (
        <div className="row gap">
          <span>Resolves via helper</span>
          <input
            value={pattern.name}
            onChange={(e) => patch({ ...pattern, name: e.target.value })}
          />
          <span className="muted">
            (defined in <code>tasks-extras.js</code>; edit there directly.)
          </span>
        </div>
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
