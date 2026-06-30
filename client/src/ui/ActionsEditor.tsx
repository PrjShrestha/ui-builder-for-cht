/**
 * Visual editor for a task's `actions` array.
 *
 * Card per action with: type radio, form picker, "pass visit window" checkbox.
 * Raw fallback for custom modifyContent bodies.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseActions,
  serializeActions,
  type ModifyContentMapping,
  type ParsedActions,
  type TaskAction,
} from '@cht-ui/shared';
import { InsertFieldButton } from './InsertFieldButton.js';
import { useReportFormFields } from './useReportFormFields.js';

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
              appliesToType={appliesToType ?? []}
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
  /** Form basenames the parent task scopes to (from `appliesToType`).
   *  Used by the modifyContent source-field picker to surface fields
   *  from the report(s) that trigger this task. */
  appliesToType: string[];
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
          onChange={(e) => {
            // §Trap7 fix — toggling visit-window ON would clear any
            // existing structured mappings or custom JS, silently. If
            // the action carries work, confirm before clobbering it.
            if (e.target.checked) {
              const hasWork =
                (a.modifyContentMappings && a.modifyContentMappings.length > 0) ||
                !!a.customModifyContent;
              if (hasWork) {
                // eslint-disable-next-line no-undef
                const ok = window.confirm(
                  'Pass-visit-window will replace the existing modifyContent body (mappings or custom JS). Continue?',
                );
                if (!ok) return;
              }
            }
            props.onChange({
              ...a,
              passesVisitWindow: e.target.checked,
              modifyContentMappings: e.target.checked ? undefined : a.modifyContentMappings,
              customModifyContent: e.target.checked ? undefined : a.customModifyContent,
            });
          }}
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
        <ModifyContentEditor
          action={a}
          appliesToType={props.appliesToType}
          onChange={props.onChange}
        />
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
  /** Same list the parent ActionCard receives — used by the source
   *  picker to surface fields from the report(s) that triggered this
   *  task. */
  appliesToType: string[];
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
    // §Trap5 fix — deleting the LAST mapping silently flips the editor
    // back to "+ Add field mapping" empty state AND clears
    // customModifyContent. That's a destructive UI action with no
    // visual breadcrumb, so confirm. Global Ctrl+Z still works for
    // recovery, but the confirm makes the irreversible-on-save nature
    // explicit. Single-row deletes mid-list are routine — no confirm.
    if (current.length === 1) {
      // eslint-disable-next-line no-undef
      const ok = window.confirm(
        'Delete the last mapping? This clears the action\'s modifyContent entirely (Ctrl+Z restores).',
      );
      if (!ok) return;
    }
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
                  <MappingTargetPicker
                    actionForm={props.action.form}
                    value={m.targetField}
                    onChange={(v) => patchRow(idx, { targetField: v })}
                  />
                </td>
                <td>
                  <MappingSourcePicker
                    appliesToType={props.appliesToType}
                    value={m.sourceExpr}
                    onChange={(v) => patchRow(idx, { sourceExpr: v })}
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
          {/* §Trap4 fix — block adding a new row until the last existing
              one is filled. The serializer already drops empty rows
              defensively, but blocking the add at the UI level means a
              user can't accidentally accumulate a row of blanks the
              parser would later misclassify on re-open. */}
          {(() => {
            const last = mappings![mappings!.length - 1]!;
            const lastIncomplete =
              last.targetField.trim() === '' || last.sourceExpr.trim() === '';
            return (
              <button
                className="link"
                onClick={addMapping}
                disabled={lastIncomplete}
                title={
                  lastIncomplete
                    ? 'Fill the current row before adding another'
                    : 'Add another mapping'
                }
              >
                + Add mapping
              </button>
            );
          })()}
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

/* ============================ mapping pickers ============================ */

/**
 * Target side of one modifyContent row — the `content.<X>` cell. Pre-fix
 * this was a raw text input; users had to know the field name on the
 * form being opened. Now it's a dropdown of fields parsed from that
 * form's .xlsx (via `useReportFormFields`, which fetches app forms via
 * api.getForm). Falls back to a free-text input via "custom" toggle
 * for advanced cases (contact-create forms, fields the parser doesn't
 * surface, or fields the user is about to add).
 *
 * Action.form may be either an app-form basename (action.type === 'report')
 * or a contact-form basename (action.type === 'contact'). The hook
 * fetches via api.getForm('app:' + basename); for contact forms the
 * fetch returns no fields and the picker falls back to the input.
 */
function MappingTargetPicker(props: {
  actionForm: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { fields, loading } = useReportFormFields(props.actionForm || null);
  const fieldSet = useMemo(() => new Set(fields), [fields]);
  const [useCustom, setUseCustom] = useState<boolean>(false);
  const canPick = !useCustom && !loading && fields.length > 0;
  return (
    <span className="row gap" style={{ alignItems: 'center' }}>
      {canPick ? (
        <select
          value={fieldSet.has(props.value) ? props.value : ''}
          onChange={(e) => props.onChange(e.target.value)}
          title={`Field on ${props.actionForm}`}
        >
          <option value="">— pick a field —</option>
          {fields.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={loading ? 'loading…' : 'e.g. patient_id'}
        />
      )}
      {fields.length > 0 && (
        <button
          type="button"
          className="link small"
          onClick={() => setUseCustom((v) => !v)}
          title={useCustom ? 'Pick from the form fields' : 'Type a custom field name'}
        >
          {useCustom ? 'pick' : 'custom'}
        </button>
      )}
    </span>
  );
}

/**
 * Source side of one modifyContent row — the right-hand expression like
 * `report.patient_id` / `event.id` / `'literal'`. Pre-fix this was raw
 * text. Now it's a small mode selector + appropriate input:
 *
 *   - report.<field>: pick a triggering-report form (from the parent's
 *     `appliesToType`), then a field. Emits `report.<field>`.
 *   - event.<key>: dropdown of the common event-metadata keys
 *     (id, dueDate, type, days, start, end). Emits `event.<key>`.
 *   - literal: free text input. Emits whatever was typed verbatim
 *     (the user is expected to wrap in quotes themselves if they
 *     want a string literal).
 *
 * The picker auto-detects the mode on first render based on the value's
 * prefix; the user can switch modes (sticks via the modeTouched ref).
 * Same pattern as AppliesToTypeField's mode toggle.
 */
const EVENT_KEYS = ['id', 'dueDate', 'type', 'days', 'start', 'end'] as const;

function detectSourceMode(value: string): 'report' | 'event' | 'raw' {
  const v = value.trim();
  if (v.startsWith('report.')) return 'report';
  if (v.startsWith('event.')) return 'event';
  return 'raw';
}

function MappingSourcePicker(props: {
  appliesToType: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const initialMode = useMemo(() => detectSourceMode(props.value), [props.value]);
  const [mode, setMode] = useState<'report' | 'event' | 'raw'>(initialMode);
  const reportForms = props.appliesToType;
  const [pickedForm, setPickedForm] = useState<string | null>(
    () => reportForms[0] ?? null,
  );
  const { fields: reportFields, loading } = useReportFormFields(
    mode === 'report' ? pickedForm : null,
  );
  const reportFieldSet = useMemo(() => new Set(reportFields), [reportFields]);

  // When the user switches mode, prefill the value with a sensible default
  // so the form's preview stays consistent.
  function switchMode(next: 'report' | 'event' | 'raw') {
    setMode(next);
    if (next === 'event' && !props.value.startsWith('event.')) {
      props.onChange('event.id');
    } else if (next === 'raw' && (props.value.startsWith('report.') || props.value.startsWith('event.'))) {
      // Keep their previous value if they were typing freely; only reset
      // when coming FROM a structured shape.
      props.onChange('');
    }
  }

  const currentReportField = mode === 'report' && props.value.startsWith('report.')
    ? props.value.slice('report.'.length)
    : '';
  const currentEventKey = mode === 'event' && props.value.startsWith('event.')
    ? props.value.slice('event.'.length)
    : '';

  return (
    <span className="row gap mapping-source-picker" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <select
        value={mode}
        onChange={(e) => switchMode(e.target.value as 'report' | 'event' | 'raw')}
        title="Source kind"
        className="mapping-source-mode"
      >
        <option value="report">report.</option>
        <option value="event">event.</option>
        <option value="raw">custom</option>
      </select>
      {mode === 'report' && (
        <>
          {reportForms.length > 1 && (
            <select
              value={pickedForm ?? ''}
              onChange={(e) => setPickedForm(e.target.value || null)}
              title="Which triggering form to source from"
            >
              {reportForms.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
          <select
            value={reportFieldSet.has(currentReportField) ? currentReportField : ''}
            onChange={(e) =>
              props.onChange(e.target.value ? `report.${e.target.value}` : '')
            }
            disabled={loading || reportFields.length === 0}
          >
            <option value="">
              {!pickedForm
                ? '— set appliesToType first —'
                : loading
                  ? '— loading… —'
                  : reportFields.length === 0
                    ? '— no fields —'
                    : '— pick a field —'}
            </option>
            {reportFields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </>
      )}
      {mode === 'event' && (
        <select
          value={currentEventKey || 'id'}
          onChange={(e) => props.onChange(`event.${e.target.value}`)}
          title="Which event metadata field"
        >
          {EVENT_KEYS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      )}
      {mode === 'raw' && (
        <input
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder="e.g. 'literal' or contact.patient_id"
          style={{ flex: 1, minWidth: 180 }}
        />
      )}
    </span>
  );
}
