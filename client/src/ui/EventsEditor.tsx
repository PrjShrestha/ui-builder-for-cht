/**
 * Visual editor for a task's `events` array. One card per event; raw-text
 * fallback for `someSchedule.map(...)` generator expressions.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseEvents,
  serializeEvents,
  type EventAnchor,
  type EventOffset,
  type ParsedEvents,
  type SimpleEvent,
} from '@cht-ui/shared';
import { InsertFieldButton } from './InsertFieldButton.js';
import { useReportFormDateFields } from './useReportFormFields.js';

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
              appliesToType={appliesToType ?? []}
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
  appliesToType: string[];
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
        <EventAnchorRow event={e} appliesToType={props.appliesToType} onChange={props.onChange} />
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

/**
 * Anchor + offset controls for an event (the visual side of docs/plans/event-date-anchor.md).
 *
 * Anchor = "what date does this event count from" — the report's `reported_date`
 * (default), a `date`-typed field on the report (e.g. `lmp_date`), or LMP via the
 * dedicated `Utils.getLmpDate(report)` helper. Offset = number + unit (days/weeks).
 *
 * We only show LMP as an option if the `appliesToType` form actually has an
 * `lmp_date` date field (heuristic: the helper is pregnancy-specific).
 *
 * A plain event ({days: N}, no anchor structure) is displayed as reported_date+days
 * for editing consistency, but re-serializes as plain `days: N` when the user leaves
 * it that way — see the serializer's byte-stability guard.
 */
function EventAnchorRow(props: {
  event: SimpleEvent;
  appliesToType: string[];
  onChange: (e: SimpleEvent) => void;
}) {
  const { event: e, appliesToType, onChange } = props;
  // Pick the FIRST form in appliesToType as the source for date fields. Real
  // projects usually target one form per task; if multiple, we surface fields
  // from the first (user can still use raw JS for cross-form anchors).
  const primaryForm = appliesToType[0] ?? null;
  const { dateFields, loading } = useReportFormDateFields(primaryForm);
  const hasLmp = useMemo(
    () => dateFields.some((n) => /lmp/i.test(n)),
    [dateFields],
  );

  // Derive the currently-displayed anchor + offset:
  //  - Structured `anchor + offset` → show as-is.
  //  - Plain `days: N`             → show as reported_date + N days (unstructured).
  const currentAnchor: EventAnchor = e.anchor ?? { kind: 'reported_date' };
  const currentOffset: EventOffset =
    e.offset ?? { value: e.days ?? 0, unit: 'days' };

  const anchorValue =
    currentAnchor.kind === 'reported_date'
      ? 'reported_date'
      : currentAnchor.kind === 'lmp'
        ? 'lmp'
        : `field:${currentAnchor.field}`;

  function setAnchor(next: EventAnchor): void {
    // reported_date + days is the plain-days case; keep `days` field, drop anchor/offset.
    if (next.kind === 'reported_date' && currentOffset.unit === 'days') {
      const { anchor: _a, offset: _o, ...rest } = e;
      void _a;
      void _o;
      onChange({ ...rest, days: currentOffset.value });
      return;
    }
    // Any other structural shape: drop plain `days`, set anchor+offset.
    const { days: _d, ...rest } = e;
    void _d;
    onChange({ ...rest, anchor: next, offset: currentOffset });
  }

  function setOffset(next: EventOffset): void {
    // Same guard: reported_date + days stays plain.
    if (currentAnchor.kind === 'reported_date' && next.unit === 'days') {
      const { anchor: _a, offset: _o, ...rest } = e;
      void _a;
      void _o;
      onChange({ ...rest, days: next.value });
      return;
    }
    const { days: _d, ...rest } = e;
    void _d;
    onChange({ ...rest, anchor: currentAnchor, offset: next });
  }

  return (
    <div className="row gap">
      <label className="expr-field" style={{ flex: 2 }}>
        <span className="expr-label">
          <code>due</code>
          <em className="muted"> — anchor date this event counts from</em>
        </span>
        <select
          value={anchorValue}
          onChange={(ev) => {
            const v = ev.target.value;
            if (v === 'reported_date') setAnchor({ kind: 'reported_date' });
            else if (v === 'lmp') setAnchor({ kind: 'lmp' });
            else if (v.startsWith('field:')) setAnchor({ kind: 'field', field: v.slice('field:'.length) });
          }}
          disabled={loading}
        >
          <option value="reported_date">Submission date (reported_date)</option>
          {hasLmp && <option value="lmp">LMP date (Utils.getLmpDate — pregnancy helper)</option>}
          {dateFields.length > 0 && (
            <optgroup label={primaryForm ? `Date fields on ${primaryForm}` : 'Report date fields'}>
              {dateFields.map((f) => (
                <option key={f} value={`field:${f}`}>{f}</option>
              ))}
            </optgroup>
          )}
          {currentAnchor.kind === 'field' && !dateFields.includes(currentAnchor.field) && (
            <option value={`field:${currentAnchor.field}`}>
              {currentAnchor.field} (unknown)
            </option>
          )}
        </select>
      </label>
      <label className="expr-field" style={{ flex: 1 }}>
        <span className="expr-label">
          <code>offset</code>
          <em className="muted"> — days/weeks after the anchor when due</em>
        </span>
        <div className="row gap">
          <input
            type="number"
            value={currentOffset.value}
            onChange={(ev) =>
              setOffset({
                value: ev.target.value === '' ? 0 : Number(ev.target.value),
                unit: currentOffset.unit,
              })
            }
            style={{ width: 80 }}
          />
          <select
            value={currentOffset.unit}
            onChange={(ev) =>
              setOffset({
                value: currentOffset.value,
                unit: ev.target.value as 'days' | 'weeks',
              })
            }
          >
            <option value="days">days</option>
            <option value="weeks">weeks</option>
          </select>
        </div>
      </label>
    </div>
  );
}
