/**
 * FormEditor — the Phase 0 centerpiece.
 *
 * Loads an XLSForm from the server, lets the user:
 *  - add, remove, reorder (drag or up/down) survey rows
 *  - edit row name, type, required, and all locale labels
 *  - add, remove, reorder choices in a list; edit choice labels
 *  - edit form settings (title, version, default language)
 *  - run dependency analysis on the current order and surface violations
 *
 * Things this editor *deliberately doesn't* touch in Phase 0:
 *  - relevant / calculation / constraint expressions (read-only, displayed but not edited)
 *  - properties.json (saved verbatim if loaded; UI editor lands in P1B)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  QUESTION_TYPES,
  STRUCTURAL_TYPES,
  isStructural,
  validateOrdering,
  predictViolationsForMove,
  violationsByRowId,
  diffXlsForms,
  type OrderingViolation,
  type SurveyRow,
  type ChoiceRow,
  type XLSForm,
  type XLSFormDiff,
} from '@cht-ui/shared';
import { api } from '../api.js';
import { useApp } from '../state/store.js';
import { RelevantRuleBuilder } from './RelevantRuleBuilder.js';
import { CalculationBuilder } from './CalculationBuilder.js';
import { PropertiesEditor, type FormProperties } from './PropertiesEditor.js';
import { useContactFormFields } from './useContactFormFields.js';
import { FormPreview } from './FormPreview.js';
import { SaveDiffModal } from './SaveDiffModal.js';

export function FormEditor({ formId }: { formId: string }) {
  const setError = useApp((s) => s.setError);
  const setDirty = useApp((s) => s.setDirty);
  const setSaving = useApp((s) => s.setSaving);
  const dirty = useApp((s) => s.dirty[formId] ?? false);
  const saving = useApp((s) => s.saving[formId] ?? false);

  const [form, setForm] = useState<XLSForm | null>(null);
  /** Snapshot of the form as it was loaded from disk; used to diff before save. */
  const [originalForm, setOriginalForm] = useState<XLSForm | null>(null);
  const [properties, setProperties] = useState<FormProperties | null>(null);
  const [tab, setTab] = useState<'survey' | 'choices' | 'settings' | 'properties'>('survey');
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [pendingSaveDiff, setPendingSaveDiff] = useState<XLSFormDiff | null>(null);
  const contactForms = useContactFormFields();

  // Load form on mount or when id changes.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getForm(formId)
      .then((res) => {
        if (!alive) return;
        setForm(res.form);
        // Deep clone so subsequent edits don't mutate the snapshot.
        setOriginalForm(JSON.parse(JSON.stringify(res.form)) as XLSForm);
        setProperties((res.properties ?? null) as FormProperties | null);
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
  }, [formId, setError]);

  function patch(next: XLSForm) {
    setForm(next);
    setDirty(formId, true);
  }

  function requestSave() {
    if (!form || !originalForm) return;
    setPendingSaveDiff(diffXlsForms(originalForm, form));
  }

  async function performSave() {
    if (!form) return;
    setPendingSaveDiff(null);
    setSaving(formId, true);
    try {
      await api.saveForm(formId, form, properties ?? undefined);
      setOriginalForm(JSON.parse(JSON.stringify(form)) as XLSForm);
      setDirty(formId, false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(formId, false);
    }
  }

  const violations = useMemo(() => (form ? validateOrdering(form) : []), [form]);
  const violationsByRow = useMemo(() => violationsByRowId(violations), [violations]);

  if (loading) return <div className="loading">Loading {formId}…</div>;
  if (!form) return <div className="loading">No form data.</div>;

  return (
    <div className="form-editor">
      <header className="page-header">
        <div>
          <h1>{form.settings.form_title ?? form.settings.form_id ?? formId}</h1>
          <code className="form-id">{formId}</code>
        </div>
        <div className="row gap">
          {violations.length > 0 && (
            <span className="badge warn">{violations.length} ordering issue(s)</span>
          )}
          <button className={showPreview ? 'link active' : 'link'} onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? 'Hide preview' : 'Show preview'}
          </button>
          <button onClick={requestSave} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </header>

      {pendingSaveDiff && (
        <SaveDiffModal
          diff={pendingSaveDiff}
          onConfirm={() => void performSave()}
          onCancel={() => setPendingSaveDiff(null)}
        />
      )}

      <div className="tabs">
        <button className={tab === 'survey' ? 'active' : ''} onClick={() => setTab('survey')}>
          Survey ({form.survey.length})
        </button>
        <button className={tab === 'choices' ? 'active' : ''} onClick={() => setTab('choices')}>
          Choices ({form.choices.length})
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          Settings
        </button>
        {properties !== null && (
          <button
            className={tab === 'properties' ? 'active' : ''}
            onClick={() => setTab('properties')}
          >
            Properties
          </button>
        )}
      </div>

      {tab === 'survey' && (
        <div className={`survey-with-preview${showPreview ? ' with-preview' : ''}`}>
          <SurveyTab form={form} patch={patch} violationsByRow={violationsByRow} />
          {showPreview && (
            <div className="preview-pane">
              <FormPreview form={form} />
            </div>
          )}
        </div>
      )}
      {tab === 'choices' && <ChoicesTab form={form} patch={patch} />}
      {tab === 'settings' && <SettingsTab form={form} patch={patch} />}
      {tab === 'properties' && properties !== null && (
        <PropertiesEditor
          value={properties}
          locales={form.locales.length > 0 ? form.locales : ['en']}
          contactForms={contactForms}
          onChange={(p) => {
            setProperties(p);
            setDirty(formId, true);
          }}
          onClose={() => setTab('survey')}
        />
      )}
    </div>
  );
}

/* ------------------------------ Survey tab ------------------------------ */

function SurveyTab(props: {
  form: XLSForm;
  patch: (next: XLSForm) => void;
  violationsByRow: Map<string, OrderingViolation[]>;
}) {
  const { form, patch, violationsByRow } = props;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = form.survey.findIndex((r) => r.rowId === active.id);
    const newIndex = form.survey.findIndex((r) => r.rowId === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    // Predict violations; if any, confirm with the user before moving.
    const broken = predictViolationsForMove(form, String(active.id), newIndex);
    if (broken.length > 0) {
      const ok = window.confirm(
        `Moving this row will break dependency on: ${broken.join(', ')}.\n\n` +
          `These fields are referenced in the row's expressions but defined later. Move anyway?`,
      );
      if (!ok) return;
    }
    const next: XLSForm = {
      ...form,
      survey: arrayMove(form.survey, oldIndex, newIndex),
    };
    patch(next);
  }

  function addQuestion() {
    const counter = form.survey.length + 1;
    const newRow: SurveyRow = {
      rowId: `r_new_${Date.now()}_${counter}`,
      type: 'text',
      name: `q${counter}`,
      labels: { en: '' },
      required: '',
      extras: {},
    };
    patch({ ...form, survey: [...form.survey, newRow] });
  }

  function updateRow(rowId: string, updater: (r: SurveyRow) => SurveyRow) {
    patch({
      ...form,
      survey: form.survey.map((r) => (r.rowId === rowId ? updater(r) : r)),
    });
  }

  function removeRow(rowId: string) {
    patch({ ...form, survey: form.survey.filter((r) => r.rowId !== rowId) });
  }

  function moveRow(rowId: string, direction: -1 | 1) {
    const idx = form.survey.findIndex((r) => r.rowId === rowId);
    if (idx < 0) return;
    const newIndex = idx + direction;
    if (newIndex < 0 || newIndex >= form.survey.length) return;
    const broken = predictViolationsForMove(form, rowId, newIndex);
    if (broken.length > 0) {
      const ok = window.confirm(
        `Moving this row will break dependency on: ${broken.join(', ')}. Move anyway?`,
      );
      if (!ok) return;
    }
    patch({ ...form, survey: arrayMove(form.survey, idx, newIndex) });
  }

  return (
    <div className="survey-tab">
      <div className="row gap toolbar">
        <button onClick={addQuestion}>+ Question</button>
        <span className="muted">Drag rows to reorder. Reorder is blocked if it would break dependencies.</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={form.survey.map((r) => r.rowId)}
          strategy={verticalListSortingStrategy}
        >
          <div className="survey-list">
            {form.survey.map((row, idx) => {
              // Field options for the rule builder = names of all non-structural
              // rows defined before this one (so dependencies stay valid).
              const earlierFields = form.survey
                .slice(0, idx)
                .filter((r) => !isStructural(r) && r.name)
                .map((r) => r.name);
              return (
                <SurveyRowCard
                  key={row.rowId}
                  row={row}
                  locales={form.surveyHeaders.labelLocales}
                  violations={violationsByRow.get(row.rowId) ?? []}
                  fieldOptions={earlierFields}
                  update={(u) => updateRow(row.rowId, u)}
                  remove={() => removeRow(row.rowId)}
                  moveUp={() => moveRow(row.rowId, -1)}
                  moveDown={() => moveRow(row.rowId, 1)}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SurveyRowCard(props: {
  row: SurveyRow;
  locales: string[];
  violations: OrderingViolation[];
  fieldOptions: string[];
  update: (u: (r: SurveyRow) => SurveyRow) => void;
  remove: () => void;
  moveUp: () => void;
  moveDown: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.row.rowId,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const { row, violations } = props;
  const structural = isStructural(row);
  const expressionsPreview = ['relevant', 'calculation', 'constraint', 'appearance']
    .map((c) => (row.extras[c] ? `${c}: ${row.extras[c]}` : null))
    .filter(Boolean)
    .join('  ·  ');

  function setExtra(key: string, value: string) {
    props.update((r) => {
      const nextExtras = { ...r.extras };
      if (value === '') delete nextExtras[key];
      else nextExtras[key] = value;
      return { ...r, extras: nextExtras };
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`survey-row${structural ? ' structural' : ''}${violations.length ? ' has-violation' : ''}`}
    >
      <button className="drag-handle" {...attributes} {...listeners} aria-label="drag">
        ⋮⋮
      </button>
      <div className="row-fields">
        <div className="row gap">
          <select
            value={row.type}
            onChange={(e) => props.update((r) => ({ ...r, type: e.target.value }))}
            className="type-select"
          >
            <optgroup label="question">
              {QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </optgroup>
            <optgroup label="structural">
              {STRUCTURAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </optgroup>
            <optgroup label="other">
              <option value={row.type}>{row.type} (current)</option>
            </optgroup>
          </select>
          <input
            value={row.name}
            onChange={(e) => props.update((r) => ({ ...r, name: e.target.value }))}
            placeholder="name"
            className="name-input"
          />
          <label className="required-label">
            <input
              type="checkbox"
              checked={Boolean(row.required && row.required !== 'no' && row.required !== 'false')}
              onChange={(e) =>
                props.update((r) => ({ ...r, required: e.target.checked ? 'yes' : '' }))
              }
            />
            required
          </label>
          <div className="row gap row-actions">
            <button className="link" onClick={props.moveUp} aria-label="move up">↑</button>
            <button className="link" onClick={props.moveDown} aria-label="move down">↓</button>
            <button className="link danger" onClick={props.remove}>delete</button>
          </div>
        </div>
        <div className="labels-grid">
          {props.locales.map((loc) => (
            <label key={loc} className="label-row">
              <span className="locale-tag">label::{loc}</span>
              <input
                value={row.labels[loc] ?? ''}
                onChange={(e) =>
                  props.update((r) => ({
                    ...r,
                    labels: { ...r.labels, [loc]: e.target.value },
                  }))
                }
                placeholder={`label in ${loc}`}
              />
            </label>
          ))}
        </div>
        <button className="link expand-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? '▾ hide advanced' : '▸ show advanced'}
          {!expanded && expressionsPreview && <span className="muted"> — {expressionsPreview}</span>}
        </button>
        {expanded && (
          <div className="advanced-fields">
            <ExpressionField
              label="relevant"
              hint="Show this question only when expression is true. References other fields via ${name}."
              value={row.extras['relevant'] ?? ''}
              onChange={(v) => setExtra('relevant', v)}
              fieldOptions={props.fieldOptions}
            />
            <ExpressionField
              label="calculation"
              hint="Compute this field's value from other fields."
              value={row.extras['calculation'] ?? ''}
              onChange={(v) => setExtra('calculation', v)}
              fieldOptions={props.fieldOptions}
            />
            <ExpressionField
              label="constraint"
              hint="Reject the answer unless this expression is true."
              value={row.extras['constraint'] ?? ''}
              onChange={(v) => setExtra('constraint', v)}
              fieldOptions={props.fieldOptions}
            />
            <ExpressionField
              label="choice_filter"
              hint="Filter the choices list based on this expression."
              value={row.extras['choice_filter'] ?? ''}
              onChange={(v) => setExtra('choice_filter', v)}
              fieldOptions={props.fieldOptions}
            />
            <ExpressionField
              label="appearance"
              hint="CHT/XLSForm appearance hints, e.g. multiline, minimal, hidden."
              value={row.extras['appearance'] ?? ''}
              onChange={(v) => setExtra('appearance', v)}
            />
            <ExpressionField
              label="default"
              hint="Default value (literal or ${name} reference)."
              value={row.extras['default'] ?? ''}
              onChange={(v) => setExtra('default', v)}
            />
            <ExpressionField
              label="repeat_count"
              hint="Dynamic number of repeats (only for begin repeat rows)."
              value={row.extras['repeat_count'] ?? ''}
              onChange={(v) => setExtra('repeat_count', v)}
            />
            <div className="hints-grid">
              {props.locales.map((loc) => (
                <ExpressionField
                  key={`hint-${loc}`}
                  label={`hint::${loc}`}
                  hint=""
                  value={row.extras[`hint::${loc}`] ?? ''}
                  onChange={(v) => setExtra(`hint::${loc}`, v)}
                />
              ))}
              {props.locales.map((loc) => (
                <ExpressionField
                  key={`cmsg-${loc}`}
                  label={`constraint_message::${loc}`}
                  hint=""
                  value={row.extras[`constraint_message::${loc}`] ?? ''}
                  onChange={(v) => setExtra(`constraint_message::${loc}`, v)}
                />
              ))}
            </div>
            <details className="raw-extras">
              <summary>Raw column overrides (preserved from xlsx)</summary>
              {Object.entries(row.extras)
                .filter(
                  ([k]) =>
                    ![
                      'relevant',
                      'calculation',
                      'constraint',
                      'choice_filter',
                      'appearance',
                      'default',
                      'repeat_count',
                    ].includes(k) &&
                    !k.startsWith('hint::') &&
                    !k.startsWith('constraint_message::'),
                )
                .map(([k, v]) => (
                  <ExpressionField
                    key={k}
                    label={k}
                    hint=""
                    value={v}
                    onChange={(val) => setExtra(k, val)}
                  />
                ))}
            </details>
          </div>
        )}
        {!expanded && expressionsPreview && (
          <div className="expr-preview muted">{expressionsPreview}</div>
        )}
        {violations.length > 0 && (
          <div className="violation-banner">
            <strong>Dependency issue:</strong>{' '}
            references{' '}
            {violations.map((v, i) => (
              <span key={`${v.column}-${v.reference}-${i}`}>
                <code>{v.reference}</code>
                {' (defined later, in '}
                <code>{v.column}</code>
                {')'}
                {i < violations.length - 1 ? ', ' : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small text input for an arbitrary XLSForm expression column. */
function ExpressionField(props: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  /** When set, shows a "Build" button that opens the visual rule builder. */
  fieldOptions?: string[];
}) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [showCalcBuilder, setShowCalcBuilder] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const supportsRelevant =
    props.fieldOptions !== undefined &&
    ['relevant', 'constraint', 'choice_filter'].includes(props.label);
  const supportsCalculation = props.fieldOptions !== undefined && props.label === 'calculation';
  const supportsBuilder = supportsRelevant || supportsCalculation;
  const supportsChips =
    props.fieldOptions !== undefined &&
    props.fieldOptions.length > 0 &&
    ['relevant', 'calculation', 'constraint', 'choice_filter', 'default', 'repeat_count'].includes(
      props.label,
    );

  function insertRef(name: string) {
    const el = inputRef.current;
    const token = `\${${name}}`;
    if (!el) {
      props.onChange(props.value + token);
      return;
    }
    const start = el.selectionStart ?? props.value.length;
    const end = el.selectionEnd ?? start;
    const next = props.value.slice(0, start) + token + props.value.slice(end);
    props.onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }
  return (
    <label className="expr-field">
      <span className="expr-label">
        <code>{props.label}</code>
        {props.hint && <em className="muted"> — {props.hint}</em>}
        {supportsBuilder && (
          <button
            className="link"
            onClick={(e) => {
              e.preventDefault();
              if (supportsCalculation) setShowCalcBuilder(true);
              else setShowBuilder(true);
            }}
          >
            ✎ build
          </button>
        )}
      </span>
      {supportsChips && props.fieldOptions && (
        <div className="ref-chips">
          <span className="muted ref-chips-hint">insert:</span>
          {props.fieldOptions.map((name) => (
            <button
              key={name}
              type="button"
              className="ref-chip"
              onClick={(e) => {
                e.preventDefault();
                insertRef(name);
              }}
              title={`Insert \${${name}} at cursor`}
            >
              ${'{'}
              {name}
              {'}'}
            </button>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />

      {showBuilder && props.fieldOptions && (
        <RelevantRuleBuilder
          column={props.label}
          value={props.value}
          fieldOptions={props.fieldOptions}
          onCancel={() => setShowBuilder(false)}
          onSave={(v) => {
            props.onChange(v);
            setShowBuilder(false);
          }}
        />
      )}
      {showCalcBuilder && props.fieldOptions && (
        <CalculationBuilder
          title="Decision table — calculation"
          value={props.value}
          fieldOptions={props.fieldOptions}
          onCancel={() => setShowCalcBuilder(false)}
          onSave={(v) => {
            props.onChange(v);
            setShowCalcBuilder(false);
          }}
        />
      )}
    </label>
  );
}

/* ------------------------------ Choices tab ----------------------------- */

function ChoicesTab(props: { form: XLSForm; patch: (n: XLSForm) => void }) {
  const { form, patch } = props;
  const grouped = useMemo(() => groupChoices(form.choices), [form.choices]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onChoiceDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = form.choices.findIndex((c) => c.rowId === active.id);
    const newIndex = form.choices.findIndex((c) => c.rowId === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    // Only allow reordering within the same list_name to keep grouping stable.
    if (form.choices[oldIndex]?.list_name !== form.choices[newIndex]?.list_name) return;
    patch({ ...form, choices: arrayMove(form.choices, oldIndex, newIndex) });
  }

  function addChoice(list_name: string) {
    const newRow: ChoiceRow = {
      rowId: `c_new_${Date.now()}_${form.choices.length + 1}`,
      list_name,
      name: '',
      labels: {},
      extras: {},
    };
    patch({ ...form, choices: [...form.choices, newRow] });
  }

  function addList() {
    const name = window.prompt('Choice list name (e.g. yes_no, primary_conditions)');
    if (!name) return;
    addChoice(name);
  }

  function updateChoice(rowId: string, updater: (r: ChoiceRow) => ChoiceRow) {
    patch({
      ...form,
      choices: form.choices.map((c) => (c.rowId === rowId ? updater(c) : c)),
    });
  }

  function removeChoice(rowId: string) {
    patch({ ...form, choices: form.choices.filter((c) => c.rowId !== rowId) });
  }

  function moveChoice(rowId: string, direction: -1 | 1) {
    const idx = form.choices.findIndex((c) => c.rowId === rowId);
    if (idx < 0) return;
    const newIndex = idx + direction;
    if (newIndex < 0 || newIndex >= form.choices.length) return;
    patch({ ...form, choices: arrayMove(form.choices, idx, newIndex) });
  }

  return (
    <div className="choices-tab">
      <div className="row gap toolbar">
        <button onClick={addList}>+ Choice list</button>
        <span className="muted">Choices are grouped by list_name.</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onChoiceDragEnd}>
        {grouped.map((g) => (
          <section key={g.list_name} className="choice-list">
            <header className="row gap">
              <h3>{g.list_name}</h3>
              <button className="link" onClick={() => addChoice(g.list_name)}>
                + choice
              </button>
              <span className="muted">Drag rows to reorder within this list.</span>
            </header>
            <table className="choice-table">
              <thead>
                <tr>
                  <th></th>
                  <th>name</th>
                  {form.choicesHeaders.labelLocales.map((loc) => (
                    <th key={loc}>label::{loc}</th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <SortableContext
                items={g.rows.map((c) => c.rowId)}
                strategy={verticalListSortingStrategy}
              >
                <tbody>
                  {g.rows.map((c) => (
                    <SortableChoiceRow
                      key={c.rowId}
                      row={c}
                      locales={form.choicesHeaders.labelLocales}
                      update={(u) => updateChoice(c.rowId, u)}
                      remove={() => removeChoice(c.rowId)}
                      moveUp={() => moveChoice(c.rowId, -1)}
                      moveDown={() => moveChoice(c.rowId, 1)}
                    />
                  ))}
                </tbody>
              </SortableContext>
            </table>
          </section>
        ))}
      </DndContext>
    </div>
  );
}

function SortableChoiceRow(props: {
  row: ChoiceRow;
  locales: string[];
  update: (u: (r: ChoiceRow) => ChoiceRow) => void;
  remove: () => void;
  moveUp: () => void;
  moveDown: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.row.rowId,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const { row } = props;
  return (
    <tr ref={setNodeRef} style={style}>
      <td>
        <button className="drag-handle" {...attributes} {...listeners} aria-label="drag">
          ⋮⋮
        </button>
      </td>
      <td>
        <input
          value={row.name}
          onChange={(e) => props.update((r) => ({ ...r, name: e.target.value }))}
        />
      </td>
      {props.locales.map((loc) => (
        <td key={loc}>
          <input
            value={row.labels[loc] ?? ''}
            onChange={(e) =>
              props.update((r) => ({ ...r, labels: { ...r.labels, [loc]: e.target.value } }))
            }
          />
        </td>
      ))}
      <td className="row gap">
        <button className="link" onClick={props.moveUp}>↑</button>
        <button className="link" onClick={props.moveDown}>↓</button>
        <button className="link danger" onClick={props.remove}>×</button>
      </td>
    </tr>
  );
}

function groupChoices(rows: ChoiceRow[]): Array<{ list_name: string; rows: ChoiceRow[] }> {
  const out: Array<{ list_name: string; rows: ChoiceRow[] }> = [];
  const idx = new Map<string, number>();
  for (const r of rows) {
    if (!idx.has(r.list_name)) {
      idx.set(r.list_name, out.length);
      out.push({ list_name: r.list_name, rows: [] });
    }
    const i = idx.get(r.list_name);
    if (i !== undefined) out[i]?.rows.push(r);
  }
  return out;
}

/* ----------------------------- Settings tab ----------------------------- */

function SettingsTab(props: { form: XLSForm; patch: (n: XLSForm) => void }) {
  const { form, patch } = props;
  const s = form.settings;

  function set<K extends 'form_title' | 'form_id' | 'version' | 'default_language'>(
    key: K,
    value: string,
  ) {
    patch({ ...form, settings: { ...s, [key]: value } });
  }

  return (
    <div className="settings-tab">
      <label>
        <span>Form title</span>
        <input value={s.form_title ?? ''} onChange={(e) => set('form_title', e.target.value)} />
      </label>
      <label>
        <span>Form id</span>
        <input value={s.form_id ?? ''} onChange={(e) => set('form_id', e.target.value)} />
      </label>
      <label>
        <span>Version</span>
        <input value={s.version ?? ''} onChange={(e) => set('version', e.target.value)} />
      </label>
      <label>
        <span>Default language</span>
        <input
          value={s.default_language ?? ''}
          onChange={(e) => set('default_language', e.target.value)}
          placeholder="en"
        />
      </label>
      {Object.keys(s.extras).length > 0 && (
        <div className="settings-extras">
          <h3>Other settings (read-only in MVP)</h3>
          {Object.entries(s.extras).map(([k, v]) => (
            <div key={k} className="row gap">
              <code>{k}</code>
              <code>{v}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
