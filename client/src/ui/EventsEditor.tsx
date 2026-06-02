/**
 * Visual editor for a task's `events` array. One card per event; raw-text
 * fallback for `someSchedule.map(...)` generator expressions.
 */
import { useEffect, useRef, useState } from 'react';
import { parseEvents, serializeEvents, type ParsedEvents, type SimpleEvent } from '@cht-ui/shared';
import { InsertFieldButton } from './InsertFieldButton.js';

interface Props {
  value: string;
  onChange: (next: string) => void;
  appliesToType?: string[];
}

export function EventsEditor({ value, onChange, appliesToType }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [parsed, setParsed] = useState<ParsedEvents>(() => parseEvents(value));
  const [rawText, setRawText] = useState<string>(value);
  const [showRaw, setShowRaw] = useState<boolean>(parsed.shape === 'raw');

  useEffect(() => {
    const p = parseEvents(value);
    setParsed(p);
    setRawText(value);
    if (p.shape === 'raw') setShowRaw(true);
  }, [value]);

  function patch(next: ParsedEvents) {
    setParsed(next);
    onChange(serializeEvents(next));
  }

  function patchEvent(idx: number, updater: (e: SimpleEvent) => SimpleEvent) {
    if (parsed.shape !== 'array') return;
    patch({ ...parsed, events: parsed.events.map((e, i) => (i === idx ? updater(e) : e)) });
  }

  function addEvent() {
    if (parsed.shape !== 'array') return;
    const next: SimpleEvent = {
      id: `event_${parsed.events.length + 1}`,
      days: 7,
      start: 1,
      end: 1,
      extras: {},
    };
    patch({ ...parsed, events: [...parsed.events, next] });
  }

  function removeEvent(idx: number) {
    if (parsed.shape !== 'array') return;
    patch({ ...parsed, events: parsed.events.filter((_, i) => i !== idx) });
  }

  return (
    <div className="events-editor">
      <div className="row gap">
        <button className={!showRaw ? 'active' : 'link'} onClick={() => setShowRaw(false)} disabled={parsed.shape !== 'array'}>
          Visual
        </button>
        <button className={showRaw ? 'active' : 'link'} onClick={() => setShowRaw(true)}>
          Raw JS
        </button>
        {parsed.shape === 'raw' && !showRaw && (
          <span className="muted">Events use a generator expression — switch to Raw JS to edit.</span>
        )}
      </div>

      {!showRaw && parsed.shape === 'array' && (
        <div className="events-list">
          {parsed.events.map((e, idx) => (
            <EventRow
              key={idx}
              event={e}
              onChange={(u) => patchEvent(idx, () => u)}
              onRemove={() => removeEvent(idx)}
            />
          ))}
          <button onClick={addEvent}>+ Event</button>
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
            <span className="muted small">Use to splice a field reference into a dueDate body.</span>
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

function EventRow(props: {
  event: SimpleEvent;
  onChange: (e: SimpleEvent) => void;
  onRemove: () => void;
}) {
  const e = props.event;
  return (
    <div className="event-card">
      <header className="row gap">
        <span className="muted">Event</span>
        <input
          value={e.id ?? ''}
          onChange={(ev) => props.onChange({ ...e, id: ev.target.value })}
          placeholder="event_id"
          className="name-input"
        />
        <button className="link danger" onClick={props.onRemove}>×</button>
      </header>
      {e.dueDateRaw ? (
        <details>
          <summary className="muted">Custom dueDate function (read-only here; edit in Raw JS)</summary>
          <pre className="muted small">{e.dueDateRaw}</pre>
        </details>
      ) : (
        <div className="row gap">
          <label className="expr-field" style={{ flex: 1 }}>
            <span className="expr-label">
              <code>days</code>
              <em className="muted"> — days after the report&apos;s reported_date when the event is due</em>
            </span>
            <input
              type="number"
              value={e.days ?? ''}
              onChange={(ev) => props.onChange({ ...e, days: ev.target.value === '' ? undefined : Number(ev.target.value) })}
            />
          </label>
        </div>
      )}
      <div className="row gap">
        <label className="expr-field" style={{ flex: 1 }}>
          <span className="expr-label">
            <code>start</code>
            <em className="muted"> — window opens this many days BEFORE the due date</em>
          </span>
          <input
            type="number"
            value={e.start ?? ''}
            onChange={(ev) => props.onChange({ ...e, start: ev.target.value === '' ? undefined : Number(ev.target.value) })}
          />
        </label>
        <label className="expr-field" style={{ flex: 1 }}>
          <span className="expr-label">
            <code>end</code>
            <em className="muted"> — window closes this many days AFTER the due date</em>
          </span>
          <input
            type="number"
            value={e.end ?? ''}
            onChange={(ev) => props.onChange({ ...e, end: ev.target.value === '' ? undefined : Number(ev.target.value) })}
          />
        </label>
      </div>
      {Object.keys(e.extras).length > 0 && (
        <details>
          <summary className="muted">Other keys (preserved)</summary>
          {Object.entries(e.extras).map(([k, v]) => (
            <div key={k} className="row gap">
              <code>{k}</code>
              <code className="muted">{v}</code>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
