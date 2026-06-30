/**
 * Tasks editor (P1C).
 *
 * Strategy: parse the exported array literal in tasks.js with the shared
 * parseTaskFile(). Show each task as an editable card. On save, we
 * regenerate the array body and replace it inside the original source
 * via byte-range edits — imports and helpers outside the array stay
 * untouched.
 *
 * Function-valued fields (appliesIf, resolvedIf, dueDate, modifyContent)
 * are edited in a code textarea per task. The visual JS rule builder is
 * a stretch in MVP; for now a code editor is correct enough.
 */
import { useEffect, useMemo, useState } from 'react';
import { parseTaskFile, type FieldValue, type ParsedTaskFile, type TaskEntry } from '@cht-ui/shared';
import { api } from '../api.js';
import { useApp } from '../state/store.js';
import { useHistory } from '../state/useHistory.js';
import { showUndoToast } from './UndoToast.js';
import { AppliesIfBuilder } from './AppliesIfBuilder.js';
import { EventsEditor } from './EventsEditor.js';
import { ResolvedWhenPicker } from './ResolvedWhenPicker.js';
import { ActionsEditor } from './ActionsEditor.js';
import { parseAppliesToType } from './useReportFormFields.js';

type FileKey = 'tasks.js' | 'task-schedules.js' | 'tasks-extras.js';
const SECONDARY_FILES: FileKey[] = ['task-schedules.js', 'tasks-extras.js'];

interface TasksState {
  raw: Record<FileKey, string | null>;
  parsed: ParsedTaskFile | null;
}

export function TasksEditor() {
  const setError = useApp((s) => s.setError);
  const setDirty = useApp((s) => s.setDirty);
  const setSaving = useApp((s) => s.setSaving);
  const dirty = useApp((s) => s.dirty['tasks'] ?? false);
  const saving = useApp((s) => s.saving['tasks'] ?? false);

  const history = useHistory<TasksState>({
    onUndo: () => setDirty('tasks', true),
    onRedo: () => setDirty('tasks', true),
  });
  const state = history.current;
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'structured' | 'raw'>('structured');
  const [activeRawFile, setActiveRawFile] = useState<FileKey>('tasks.js');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getTaskFiles()
      .then((res) => {
        if (!alive) return;
        const tasksSrc = res['tasks.js'] ?? '';
        const parsed = tasksSrc ? parseTaskFile(tasksSrc) : null;
        history.reset({ raw: res, parsed });
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setError]);

  function patchState(next: TasksState) {
    history.patch(next);
    setDirty('tasks', true);
  }
  function patchEntry(idx: number, next: TaskEntry) {
    if (!state?.parsed) return;
    const entries = state.parsed.entries.map((e, i) => (i === idx ? next : e));
    patchState({ ...state, parsed: { ...state.parsed, entries } });
  }
  function removeEntry(idx: number) {
    if (!state?.parsed) return;
    const target = state.parsed.entries[idx];
    const label =
      (target?.fields['name']?.kind === 'string' && target.fields['name'].value) || `task ${idx + 1}`;
    const snapshotId = history.currentSnapshotId;
    patchState({
      ...state,
      parsed: { ...state.parsed, entries: state.parsed.entries.filter((_, i) => i !== idx) },
    });
    showUndoToast({ message: `Deleted task "${label}"`, onUndo: () => history.jumpTo(snapshotId) });
  }
  function addEntry() {
    if (!state?.parsed) return;
    const newEntry: TaskEntry = {
      bounds: { start: 0, end: 0 },
      source: '{}',
      fields: {
        name: { kind: 'string', value: 'new_task' },
        title: { kind: 'string', value: 'task.new_task.title' },
        icon: { kind: 'string', value: 'icon-task' },
        appliesTo: { kind: 'string', value: 'reports' },
        appliesToType: { kind: 'array', raw: '[]' },
        appliesIf: { kind: 'function', raw: 'function (contact, report) {\n  return true;\n}' },
        events: { kind: 'array', raw: '[{ id: "new_task", days: 0, start: 0, end: 0 }]' },
        actions: { kind: 'array', raw: '[{ form: "new_form" }]' },
      },
    };
    patchState({
      ...state,
      parsed: { ...state.parsed, entries: [...state.parsed.entries, newEntry] },
    });
  }
  function patchRaw(file: FileKey, content: string) {
    if (!state) return;
    const nextRaw = { ...state.raw, [file]: content };
    let parsed = state.parsed;
    if (file === 'tasks.js') parsed = parseTaskFile(content);
    patchState({ raw: nextRaw, parsed });
  }

  async function save() {
    if (!state) return;
    setSaving('tasks', true);
    try {
      // Rebuild tasks.js if we have a parsed view; else write the raw text.
      let nextTasks = state.raw['tasks.js'] ?? '';
      if (state.parsed && state.parsed.arrayBounds && view === 'structured') {
        nextTasks = rebuildTasksFile(state.parsed);
      }
      await api.saveTaskFile('tasks.js', nextTasks);
      for (const f of SECONDARY_FILES) {
        const c = state.raw[f];
        if (c !== null) await api.saveTaskFile(f, c);
      }
      setDirty('tasks', false);
      // Re-parse what was just written and snapshot it as the new baseline.
      history.reset({
        raw: { ...state.raw, 'tasks.js': nextTasks },
        parsed: nextTasks ? parseTaskFile(nextTasks) : state.parsed,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('tasks', false);
    }
  }

  if (loading) return <div className="loading">Loading tasks…</div>;
  if (!state) return <div className="loading">No tasks data.</div>;

  return (
    <div className="tasks-editor">
      <header className="page-header sticky-header">
        <h1>Tasks</h1>
        <div className="row gap">
          <button
            className="link"
            onClick={history.undo}
            disabled={!history.canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo last edit"
          >
            ↶ Undo
          </button>
          <button
            className="link"
            onClick={history.redo}
            disabled={!history.canRedo}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
          >
            ↷ Redo
          </button>
          <button onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </header>

      <div className="tabs">
        <button className={view === 'structured' ? 'active' : ''} onClick={() => setView('structured')}>
          Structured ({state.parsed?.entries.length ?? 0})
        </button>
        <button className={view === 'raw' ? 'active' : ''} onClick={() => setView('raw')}>
          Raw files
        </button>
      </div>

      {view === 'structured' && (
        <>
          {!state.parsed?.arrayBounds && (
            <p className="muted">
              Couldn&apos;t locate <code>module.exports = [ ... ]</code> in tasks.js. Edit raw text in
              the &quot;Raw files&quot; tab.
            </p>
          )}
          {state.parsed?.arrayBounds && (
            <div className="task-cards">
              {state.parsed.entries.map((entry, idx) => (
                <TaskCard
                  key={idx}
                  entry={entry}
                  onChange={(e) => patchEntry(idx, e)}
                  onRemove={() => removeEntry(idx)}
                />
              ))}
              <button onClick={addEntry}>+ Add task</button>
            </div>
          )}
        </>
      )}

      {view === 'raw' && (
        <>
          <div className="tabs">
            {(['tasks.js', ...SECONDARY_FILES] as FileKey[]).map((f) => (
              <button
                key={f}
                className={activeRawFile === f ? 'active' : ''}
                onClick={() => setActiveRawFile(f)}
              >
                {f}
                {state.raw[f] === null && <em className="muted"> (missing)</em>}
              </button>
            ))}
          </div>
          <textarea
            className="code-editor"
            value={state.raw[activeRawFile] ?? ''}
            onChange={(e) => patchRaw(activeRawFile, e.target.value)}
            spellCheck={false}
          />
        </>
      )}
    </div>
  );
}

/* --------------------------- Task card UI --------------------------- */

function TaskCard(props: {
  entry: TaskEntry;
  onChange: (e: TaskEntry) => void;
  onRemove: () => void;
}) {
  const { entry } = props;
  const [expanded, setExpanded] = useState(true);

  function setField(name: string, value: FieldValue) {
    props.onChange({ ...entry, fields: { ...entry.fields, [name]: value } });
  }
  function clearField(name: string) {
    const nextFields = { ...entry.fields };
    delete nextFields[name];
    props.onChange({ ...entry, fields: nextFields });
  }
  function getRawNoQuote(name: string): string {
    const v = entry.fields[name];
    if (!v) return '';
    if (v.kind === 'array' || v.kind === 'object' || v.kind === 'function' || v.kind === 'unknown')
      return v.raw;
    return '';
  }
  const appliesToType = useMemo(
    () => parseAppliesToType(getRawNoQuote('appliesToType')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry.fields['appliesToType']],
  );
  function getString(name: string): string {
    const v = entry.fields[name];
    if (!v) return '';
    if (v.kind === 'string') return v.value;
    if (v.kind === 'identifier') return v.value;
    if (v.kind === 'unknown') return v.raw;
    return '';
  }
  function getRaw(name: string): string {
    const v = entry.fields[name];
    if (!v) return '';
    if (v.kind === 'array' || v.kind === 'object' || v.kind === 'function' || v.kind === 'unknown')
      return v.raw;
    if (v.kind === 'string') return JSON.stringify(v.value);
    if (v.kind === 'number') return String(v.value);
    if (v.kind === 'boolean') return String(v.value);
    if (v.kind === 'identifier') return v.value;
    return '';
  }

  return (
    <div className="task-card">
      <header className="row gap">
        <button className="link" onClick={() => setExpanded(!expanded)}>
          {expanded ? '▾' : '▸'}
        </button>
        <strong>{getString('name') || '(unnamed task)'}</strong>
        <span className="muted">— {getString('title')}</span>
        <button className="link danger" onClick={props.onRemove}>
          delete
        </button>
      </header>
      {expanded && (
        <div className="task-fields">
          <ScalarField label="name" value={getString('name')} onChange={(v) => setField('name', { kind: 'string', value: v })} />
          <TitleFieldWithI18nHint
            value={getString('title')}
            onChange={(v) => setField('title', { kind: 'string', value: v })}
          />
          <ScalarField label="icon" value={getString('icon')} onChange={(v) => setField('icon', { kind: 'string', value: v })} />
          <PriorityField
            value={getString('priority')}
            label={getString('priorityLabel')}
            onChangeValue={(v) =>
              v === ''
                ? clearField('priority')
                : setField('priority', { kind: 'string', value: v })
            }
            onChangeLabel={(v) =>
              v === ''
                ? clearField('priorityLabel')
                : setField('priorityLabel', { kind: 'string', value: v })
            }
          />
          <ScalarField
            label="appliesTo"
            value={getString('appliesTo')}
            onChange={(v) => setField('appliesTo', { kind: 'string', value: v })}
            placeholder="contacts or reports"
          />
          <AppliesToTypeField
            value={getRaw('appliesToType')}
            onChange={(v) => setField('appliesToType', { kind: 'array', raw: v })}
          />
          <AppliesIfWithBuilder
            value={getRaw('appliesIf')}
            appliesToType={appliesToType}
            onChange={(v) => setField('appliesIf', { kind: 'function', raw: v })}
          />
          <ResolvedIfWithPicker
            value={getRaw('resolvedIf')}
            appliesToType={appliesToType}
            onChange={(v) => {
              // If the user picked an identifier, store as identifier; else as function.
              const looksLikeIdentifier = /^[a-zA-Z_$][\w$]*$/.test(v.trim());
              setField(
                'resolvedIf',
                looksLikeIdentifier
                  ? { kind: 'identifier', value: v.trim() }
                  : { kind: 'function', raw: v },
              );
            }}
          />
          <EventsWithEditor
            value={getRaw('events')}
            appliesToType={appliesToType}
            onChange={(v) => {
              // If the raw text starts with [, it's an array literal; else a generator expression.
              const isArrayShape = v.trim().startsWith('[');
              setField(
                'events',
                isArrayShape ? { kind: 'array', raw: v } : { kind: 'unknown', raw: v },
              );
            }}
          />
          <ActionsWithEditor
            value={getRaw('actions')}
            appliesToType={appliesToType}
            onChange={(v) => {
              const isArrayShape = v.trim().startsWith('[');
              setField(
                'actions',
                isArrayShape ? { kind: 'array', raw: v } : { kind: 'unknown', raw: v },
              );
            }}
          />
          <details>
            <summary>Other recognized fields</summary>
            {Object.entries(entry.fields)
              .filter(
                ([k]) =>
                  ![
                    'name',
                    'title',
                    'icon',
                    'priority',
                    'priorityLabel',
                    'appliesTo',
                    'appliesToType',
                    'appliesIf',
                    'resolvedIf',
                    'events',
                    'actions',
                  ].includes(k),
              )
              .map(([k, v]) => (
                <RawField
                  key={k}
                  label={k}
                  value={getRaw(k)}
                  onChange={(val) =>
                    setField(k, v.kind === 'string'
                      ? { kind: 'string', value: val }
                      : v.kind === 'function'
                        ? { kind: 'function', raw: val }
                        : { kind: 'unknown', raw: val })
                  }
                />
              ))}
          </details>
        </div>
      )}
    </div>
  );
}

/* --------------------- Inline wrapped builders --------------------- */

function AppliesIfWithBuilder(props: {
  value: string;
  onChange: (v: string) => void;
  appliesToType: string[];
}) {
  const [showBuilder, setShowBuilder] = useState(false);
  return (
    <label className="expr-field">
      <span className="expr-label">
        <code>appliesIf</code>
        <em className="muted"> — function returning true when this task should fire</em>
        <button className="link" onClick={(e) => { e.preventDefault(); setShowBuilder(true); }}>
          ✎ build
        </button>
      </span>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="code-editor short"
        spellCheck={false}
      />
      {showBuilder && (
        <AppliesIfBuilder
          value={props.value}
          appliesToType={props.appliesToType}
          onCancel={() => setShowBuilder(false)}
          onSave={(v) => {
            props.onChange(v);
            setShowBuilder(false);
          }}
        />
      )}
    </label>
  );
}

function ResolvedIfWithPicker(props: {
  value: string;
  onChange: (v: string) => void;
  appliesToType: string[];
}) {
  return (
    <label className="expr-field">
      <span className="expr-label">
        <code>resolvedIf</code>
        <em className="muted"> — when this returns true the task disappears</em>
      </span>
      <ResolvedWhenPicker
        value={props.value}
        onChange={props.onChange}
        appliesToType={props.appliesToType}
      />
    </label>
  );
}

function EventsWithEditor(props: {
  value: string;
  onChange: (v: string) => void;
  appliesToType: string[];
}) {
  return (
    <label className="expr-field">
      <span className="expr-label">
        <code>events</code>
        <em className="muted"> — when the task is due relative to the trigger</em>
      </span>
      <EventsEditor
        value={props.value}
        onChange={props.onChange}
        appliesToType={props.appliesToType}
      />
    </label>
  );
}

function ActionsWithEditor(props: {
  value: string;
  onChange: (v: string) => void;
  appliesToType: string[];
}) {
  const forms = useApp((s) => s.forms);
  const formOptions = forms
    .filter((f) => f.category === 'app')
    .map((f) => f.filename.replace(/\.xlsx$/i, ''));
  return (
    <label className="expr-field">
      <span className="expr-label">
        <code>actions</code>
        <em className="muted"> — which form opens when the task is tapped</em>
      </span>
      <ActionsEditor
        value={props.value}
        formOptions={formOptions}
        onChange={props.onChange}
        appliesToType={props.appliesToType}
      />
    </label>
  );
}

function ScalarField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="expr-field">
      <span className="expr-label">
        <code>{props.label}</code>
      </span>
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
      />
    </label>
  );
}

/**
 * `title` is almost always a translation key (e.g. `task.malaria.followup.title`)
 * resolved against the project's `messages-<locale>.properties` files. The
 * raw key shape is non-obvious to non-developers, so we detect the key
 * pattern and surface a hint pointing at where the actual EN/NE strings
 * need to live. Doesn't gate the input — the user can still type a raw
 * string for hardcoded titles.
 */
function TitleFieldWithI18nHint(props: { value: string; onChange: (v: string) => void }) {
  const looksLikeKey = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/i.test(props.value.trim());
  return (
    <label className="expr-field">
      <span className="expr-label">
        <code>title</code>
        <em className="muted"> — translation key or literal string</em>
      </span>
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="task.malaria.followup.title"
      />
      {looksLikeKey && (
        <span className="muted small" style={{ marginTop: 4 }}>
          📖 This looks like a translation key. Add the EN + NE strings under
          {' '}<code>app_settings/forms/translations/messages-en.properties</code> and
          {' '}<code>messages-ne.properties</code> in your project folder.
        </span>
      )}
    </label>
  );
}

const PRIORITY_LEVELS = [
  { value: '', label: '— default (medium) —' },
  { value: 'high', label: 'high' },
  { value: 'medium', label: 'medium' },
  { value: 'low', label: 'low' },
];

/**
 * Renders the optional task `priority` field as a typed dropdown plus an
 * optional `priorityLabel` (also a translation key). Setting empty value
 * deletes the fields entirely so the round-trip stays minimal — the JS
 * serializer drops absent keys, matching the way unprioritised tasks ship.
 */
function PriorityField(props: {
  value: string;
  label: string;
  onChangeValue: (v: string) => void;
  onChangeLabel: (v: string) => void;
}) {
  const looksLikeLabelKey = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/i.test(props.label.trim());
  return (
    <label className="expr-field">
      <span className="expr-label">
        <code>priority</code>
        <em className="muted"> — affects sort order and color in the CHW task list</em>
      </span>
      <div className="row gap" style={{ flexWrap: 'wrap' }}>
        <select
          value={props.value}
          onChange={(e) => props.onChangeValue(e.target.value)}
          className="type-select"
        >
          {PRIORITY_LEVELS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          value={props.label}
          onChange={(e) => props.onChangeLabel(e.target.value)}
          placeholder="priorityLabel (translation key, optional)"
          style={{ flex: 1, minWidth: 240 }}
        />
      </div>
      {props.label && looksLikeLabelKey && (
        <span className="muted small" style={{ marginTop: 4 }}>
          📖 priorityLabel is also a translation key — same .properties files as title.
        </span>
      )}
    </label>
  );
}

/**
 * Visual picker for `appliesToType` — the array of form basenames /
 * contact-type ids the task scopes to. Pre-fix this was a raw textarea
 * where users had to hand-type `['person']` or `FORMS.PREGNANCY_REGISTRATION`
 * (DEV-HANDOFF #9 + task-builder-parity.md). Now it's a multi-select of
 * the project's actual app forms + contact types, with a raw escape
 * hatch for advanced syntax (`'report'`, `'contacts'`, `FORMS.X`, etc.).
 *
 * Mode auto-detects from the current raw value:
 *   - empty / pure string-literal array (`['a','b']`) → multi-select mode
 *   - anything else (FORMS.X, special tokens, free expressions) → raw mode
 *
 * Emit in multi-select mode: `[ 'name1', 'name2' ]` — the simplest shape
 * cht-conf accepts and that survives parseAppliesToType.
 */
function AppliesToTypeField(props: { value: string; onChange: (v: string) => void }) {
  const forms = useApp((s) => s.forms);

  // Stable list of pickable items, memoized off the upstream slice so
  // selector identity doesn't churn (lesson from c0c71a8).
  const appForms = useMemo(
    () =>
      forms
        .filter((f) => f.category === 'app')
        .map((f) => f.filename.replace(/\.xlsx$/i, ''))
        .sort(),
    [forms],
  );
  // Contact-types list — fetched once on mount via the hierarchy API
  // (same pattern PropertiesEditor uses for its ContextExpressionBuilder
  // dropdown). Tasks can scope to a contact type via appliesToType too,
  // so we offer both axes in the picker.
  const [contactTypeIds, setContactTypeIds] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    api
      .getHierarchy()
      .then((h) => {
        if (!alive) return;
        const ids = (h.contact_types as Array<{ id: string }>).map((t) => t.id).sort();
        setContactTypeIds(ids);
      })
      .catch(() => {
        /* hierarchy unavailable — picker just lists app forms */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Does the raw value look like a pure string-literal array (or empty)?
  // If yes, multi-select mode is safe; if no (FORMS.X / 'report' / weird),
  // start in raw mode so we don't truncate the user's expression.
  const isPureStringArray = useMemo(() => {
    const trimmed = props.value.trim();
    if (trimmed === '') return true;
    // Allow `[]`, `['a']`, `['a', 'b']`, double or single quotes; no
    // member-access / function-call / object-shorthand.
    if (!/^\[\s*(['"][^'"]+['"]\s*(,\s*['"][^'"]+['"]\s*)*)?\]$/.test(trimmed)) return false;
    return true;
  }, [props.value]);

  // Parsed picked set — falls back to parseAppliesToType for any value
  // (so even a raw-mode user sees their FORMS.X choices reflected in the
  // checkboxes when they flip to multi-select).
  const picked = useMemo(() => new Set(parseAppliesToType(props.value)), [props.value]);

  const [mode, setMode] = useState<'pick' | 'raw'>(isPureStringArray ? 'pick' : 'raw');
  // Track mode-source so we don't flip the user's mode out from under them
  // mid-edit when the auto-detect would prefer the other branch.
  const [modeTouched, setModeTouched] = useState(false);
  useEffect(() => {
    if (!modeTouched) setMode(isPureStringArray ? 'pick' : 'raw');
  }, [isPureStringArray, modeTouched]);

  function toggle(name: string) {
    const next = new Set(picked);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    if (next.size === 0) {
      props.onChange('[]');
      return;
    }
    // Emit alphabetized for diff stability.
    const sorted = [...next].sort();
    const literal = `[ ${sorted.map((n) => `'${n}'`).join(', ')} ]`;
    props.onChange(literal);
  }

  return (
    <label className="expr-field">
      <span className="expr-label">
        <code>appliesToType</code>
        <em className="muted"> — which forms / contact types this task fires on</em>
      </span>
      <div className="row gap" style={{ marginBottom: 6 }}>
        <button
          type="button"
          className={mode === 'pick' ? 'active' : 'link'}
          onClick={() => {
            setMode('pick');
            setModeTouched(true);
          }}
          disabled={!isPureStringArray && mode === 'raw'}
          title={
            !isPureStringArray
              ? 'Current value uses FORMS.X or other advanced syntax — switch to multi-select would drop it. Clear the raw value first.'
              : undefined
          }
        >
          Multi-select
        </button>
        <button
          type="button"
          className={mode === 'raw' ? 'active' : 'link'}
          onClick={() => {
            setMode('raw');
            setModeTouched(true);
          }}
        >
          Raw JS
        </button>
      </div>
      {mode === 'pick' ? (
        <div className="applies-to-type-picker">
          {appForms.length === 0 && contactTypeIds.length === 0 ? (
            <p className="muted small">
              No app forms or contact types yet in this project.
            </p>
          ) : (
            <>
              {appForms.length > 0 && (
                <fieldset>
                  <legend className="muted small">
                    App forms <span>({appForms.length})</span>
                  </legend>
                  <div className="applies-to-type-grid">
                    {appForms.map((name) => (
                      <label key={name} className="row gap">
                        <input
                          type="checkbox"
                          checked={picked.has(name)}
                          onChange={() => toggle(name)}
                        />
                        <code>{name}</code>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {contactTypeIds.length > 0 && (
                <fieldset>
                  <legend className="muted small">
                    Contact types <span>({contactTypeIds.length})</span>
                  </legend>
                  <div className="applies-to-type-grid">
                    {contactTypeIds.map((id) => (
                      <label key={id} className="row gap">
                        <input
                          type="checkbox"
                          checked={picked.has(id)}
                          onChange={() => toggle(id)}
                        />
                        <code>{id}</code>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </>
          )}
          <p className="muted small" style={{ marginTop: 4 }}>
            Emits a string-array literal. Switch to <strong>Raw JS</strong> for
            advanced syntax: <code>FORMS.X</code>, <code>'report'</code>,{' '}
            <code>'contacts'</code>.
          </p>
        </div>
      ) : (
        <>
          <textarea
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            className="code-editor short"
            spellCheck={false}
          />
          <span className="muted small">
            Advanced syntax. Example: <code>['person']</code>,{' '}
            <code>[FORMS.PREGNANCY_REGISTRATION, 'pregnancy']</code>,{' '}
            <code>'report'</code>.
          </span>
        </>
      )}
    </label>
  );
}

function RawField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  tall?: boolean;
}) {
  return (
    <label className="expr-field">
      <span className="expr-label">
        <code>{props.label}</code>
        {props.hint && <em className="muted"> — {props.hint}</em>}
      </span>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className={`code-editor ${props.tall ? 'medium' : 'short'}`}
        spellCheck={false}
      />
    </label>
  );
}

/* ---------------------------- Serialization ---------------------------- */

/**
 * Rebuild tasks.js by splicing a regenerated array body into the original
 * source between arrayBounds. Imports and helpers outside the array stay
 * untouched.
 */
function rebuildTasksFile(parsed: ParsedTaskFile): string {
  if (!parsed.arrayBounds) return parsed.source;
  const before = parsed.source.slice(0, parsed.arrayBounds.start + 1);
  const after = parsed.source.slice(parsed.arrayBounds.end);
  const bodies = parsed.entries.map(entryToSource).join(',\n  ');
  return `${before}\n  ${bodies}\n${after}`;
}

function entryToSource(entry: TaskEntry): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(entry.fields)) {
    const keyOut = /^[a-zA-Z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
    lines.push(`    ${keyOut}: ${fieldValueToSource(v)}`);
  }
  return `{\n${lines.join(',\n')}\n  }`;
}

function fieldValueToSource(v: FieldValue): string {
  switch (v.kind) {
    case 'string':
      return JSON.stringify(v.value);
    case 'number':
      return String(v.value);
    case 'boolean':
      return String(v.value);
    case 'identifier':
      return v.value;
    case 'array':
    case 'object':
    case 'function':
    case 'unknown':
      return v.raw;
  }
}
