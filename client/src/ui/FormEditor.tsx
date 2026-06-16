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
import { Fragment, useEffect, useMemo, useReducer, useRef, useState, type ReactElement } from 'react';
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
  SELECT_TYPE_RE,
  computeSimpleHiddenRowIds,
  isStructural,
  inferFieldKind,
  validateOrdering,
  predictViolationsForMove,
  violationsByRowId,
  diffXlsForms,
  findStructuralViolations,
  planSurveyMove,
  planUngroup,
  type StructuralViolation,
  type FieldKind,
  type OrderingViolation,
  type SurveyRow,
  type ChoiceRow,
  type XLSForm,
  type XLSFormDiff,
  conditionBuilderReducer,
  initialConditionBuilderState,
  isDraftComplete,
  isDraftEmpty,
  isInsertReady,
  serializeBuilderState,
  fieldsTypicalForOp,
  opsTypicalForKind,
  type Clause,
  type ClauseOp,
  type ConditionColumn,
  type Subgroup,
} from '@cht-ui/shared';
import { api } from '../api.js';
import { useApp } from '../state/store.js';
import { RelevantRuleBuilder } from './RelevantRuleBuilder.js';
import { AppearancePicker } from './AppearancePicker.js';
import { CalculationBuilder } from './CalculationBuilder.js';
import { PropertiesEditor, type FormProperties } from './PropertiesEditor.js';
import { useContactFormFields } from './useContactFormFields.js';
import { useContactSummaryContextKeys } from './useContactSummaryContextKeys.js';
import { FormPreview } from './FormPreview.js';
import { SaveDiffModal } from './SaveDiffModal.js';
import { QuestionTypePicker } from './QuestionTypePicker.js';
import { findTileForRowType } from './QuestionTypeCatalog.js';
import { InlineChoicesEditor } from './InlineChoicesEditor.js';
import { useHistory } from '../state/useHistory.js';
import { showUndoToast } from './UndoToast.js';

export function FormEditor({ formId }: { formId: string }) {
  const setError = useApp((s) => s.setError);
  const setDirty = useApp((s) => s.setDirty);
  const setSaving = useApp((s) => s.setSaving);
  const dirty = useApp((s) => s.dirty[formId] ?? false);
  const saving = useApp((s) => s.saving[formId] ?? false);

  const formHistory = useHistory<XLSForm>({ onUndo: () => setDirty(formId, true), onRedo: () => setDirty(formId, true) });
  const form = formHistory.current;
  /** Snapshot of the form as it was loaded from disk; used to diff before save. */
  const [originalForm, setOriginalForm] = useState<XLSForm | null>(null);
  const [properties, setProperties] = useState<FormProperties | null>(null);
  const [tab, setTab] = useState<'survey' | 'choices' | 'settings' | 'properties' | 'translate'>(
    'survey',
  );
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [pendingSaveDiff, setPendingSaveDiff] = useState<XLSFormDiff | null>(null);
  const contactForms = useContactFormFields();
  // Tier 1.5 — flatten the contact-form field lists into a single deduped
  // name list for the calc builder's "Contact input field" reference kind.
  // Mirrors the FALLBACK_CONTACT_FIELDS union the builder does internally;
  // exposing the project-discovered list keeps the picker fresh while the
  // fallback covers projects whose contact forms collapse their inputs.
  const inputContactFields = useMemo(() => {
    const set = new Set<string>();
    for (const f of contactForms) for (const n of f.fields) set.add(n);
    return Array.from(set).sort();
  }, [contactForms]);
  const contextKeys = useContactSummaryContextKeys();

  // Load form on mount or when id changes.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getForm(formId)
      .then((res) => {
        if (!alive) return;
        formHistory.reset(res.form);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, setError]);

  function patch(next: XLSForm) {
    formHistory.patch(next);
    setDirty(formId, true);
  }
  const undo = formHistory.undo;
  const redo = formHistory.redo;
  const canUndo = formHistory.canUndo;
  const canRedo = formHistory.canRedo;
  // Reset history when the user opens a different form.
  useEffect(() => {
    formHistory.reset(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  function requestSave() {
    if (!form || !originalForm) return;
    // §A6 — refuse to save an unbalanced survey. The validator is read-only
    // and ran moments ago for the violations banner; re-running here guards
    // against any race where the UI banner lagged a mutation.
    const structural = findStructuralViolations(form.survey);
    if (structural.length > 0) {
      const first = structural[0]!;
      setError(
        `Can't save — the form has unbalanced groups/repeats. First issue: ${first.message}`,
      );
      return;
    }
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
      // Reset history — what just got saved is the new baseline. Otherwise
      // an undo after save would resurrect un-saved-but-undone state.
      formHistory.reset(form);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(formId, false);
    }
  }

  const violations = useMemo(() => (form ? validateOrdering(form) : []), [form]);
  const violationsByRow = useMemo(() => violationsByRowId(violations), [violations]);
  // §A4 structural-balance — read-only analysis, recomputed on every edit
  // so the banner reflects the current edit immediately. Empty array
  // means a balanced survey.
  const structuralViolations: StructuralViolation[] = useMemo(
    () => (form ? findStructuralViolations(form.survey) : []),
    [form],
  );

  if (loading) return <div className="loading">Loading {formId}…</div>;
  if (!form) return <div className="loading">No form data.</div>;

  return (
    <div className="form-editor">
      <header className="page-header sticky-header">
        <div>
          <h1>{form.settings.form_title ?? form.settings.form_id ?? formId}</h1>
          <code className="form-id">{formId}</code>
        </div>
        <div className="row gap">
          {structuralViolations.length > 0 && (
            <span
              className="badge danger"
              title={structuralViolations.map((v) => v.message).join('\n')}
            >
              {structuralViolations.length} structural issue(s) — save blocked
            </span>
          )}
          {violations.length > 0 && (
            <span className="badge warn">{violations.length} ordering issue(s)</span>
          )}
          <button
            className="link"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo last edit"
          >
            ↶ Undo
          </button>
          <button
            className="link"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
          >
            ↷ Redo
          </button>
          <button className={showPreview ? 'link active' : 'link'} onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? 'Hide preview' : 'Show preview'}
          </button>
          <button onClick={requestSave} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
          <button
            className="link"
            onClick={() => useApp.getState().setView({ kind: 'deploy' })}
            disabled={dirty}
            title={dirty ? 'Save first to enable deploy' : 'Open Deploy panel — deploy this form to the configured CHT instance'}
          >
            🚀 Deploy
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
        <button className={tab === 'translate' ? 'active' : ''} onClick={() => setTab('translate')}>
          Translate
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
          <SurveyTab
            form={form}
            patch={patch}
            undo={undo}
            getSnapshotId={() => formHistory.currentSnapshotId}
            jumpTo={formHistory.jumpTo}
            violationsByRow={violationsByRow}
            inputContactFields={inputContactFields}
            contextKeys={contextKeys}
          />
          {showPreview && (
            <div className="preview-pane">
              <FormPreview form={form} />
            </div>
          )}
        </div>
      )}
      {tab === 'choices' && (
        <ChoicesTab
          form={form}
          patch={patch}
          undo={undo}
          getSnapshotId={() => formHistory.currentSnapshotId}
          jumpTo={formHistory.jumpTo}
        />
      )}
      {tab === 'settings' && <SettingsTab form={form} patch={patch} />}
      {tab === 'translate' && <TranslateTab form={form} patch={patch} />}
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
  undo: () => void;
  /** Capture the current snapshot id so toast Undo can jump back exactly. */
  getSnapshotId: () => number;
  jumpTo: (id: number) => void;
  violationsByRow: Map<string, OrderingViolation[]>;
  /** Tier 1.5 — pre-derived contact-input field list + contact-summary
   *  context keys, threaded down to each SurveyRowCard for the calc
   *  builder's reference kinds. */
  inputContactFields: string[];
  contextKeys: string[];
}) {
  const { form, patch, violationsByRow } = props;
  const undo = props.undo;
  // §A4 surfaces structural-violation refusals via the shared error
  // toast so the user sees why a move was blocked.
  const setError = useApp((s) => s.setError);
  const [mode, setMode] = useState<'simple' | 'full'>('simple');
  // Begin-row IDs the user has explicitly TOGGLED via the group header.
  // The set stores "flip from default" intent — a group whose name is in
  // DEFAULT_COLLAPSED_GROUP_NAMES (`inputs`) is collapsed by default and
  // toggling it ADDS its id to flip to expanded; a plain group is expanded
  // by default and toggling it ADDS its id to flip to collapsed. See the
  // `collapsed: …` computation in walkChildren. Keying by begin rowId
  // (not name) lets multiple nested groups share a name without sharing
  // collapse state.
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Map a field name → ordered list of choice `name`s if it's a select_one /
  // select_multiple, so the expression builder can present a value dropdown.
  // Project-level contact-form choices are merged underneath so contact-
  // injected fields (e.g. `inputs/contact/sex`) get their values too;
  // form-local selects win on collision.
  const contactFieldChoices = useApp((s) => s.project?.contactFieldChoices);
  const fieldChoices = useMemo(
    () => buildFieldChoices(form.survey, form.choices, contactFieldChoices),
    [form.survey, form.choices, contactFieldChoices],
  );

  // Map field name → FieldKind for the type-aware soft filter (plan v0.3).
  // Choice-upgrade: a row with non-empty `fieldChoices[name]` (a Slice 1
  // contact-injected `select_one` calculate, or this form's own select)
  // classifies as 'choice' regardless of its raw `row.type`, so the op
  // picker keeps `includes`/`does not include` typical for it. Names not
  // present in the survey but present in `fieldChoices` get a defensive
  // 'choice' entry too (they aren't in `fieldOptions`, but it keeps the
  // map consistent for downstream lookups). This is pure render data —
  // never reaches `clauseToRule`/`serializeAnyParsed` (Lal/Developer A5).
  const fieldKinds = useMemo<Record<string, FieldKind>>(() => {
    const out: Record<string, FieldKind> = {};
    for (const r of form.survey) {
      if (!r.name) continue;
      const baseKind = inferFieldKind(r.type);
      const hasChoices = (fieldChoices[r.name]?.length ?? 0) > 0;
      out[r.name] = hasChoices ? 'choice' : baseKind;
    }
    for (const name of Object.keys(fieldChoices)) {
      if (!(name in out)) out[name] = 'choice';
    }
    return out;
  }, [form.survey, fieldChoices]);

  // Group consecutive rows that fall inside a "collapsed" begin/end group block.
  // In Simple mode we don't collapse — we just hide non-user-facing rows
  // (group-aware: calculates inside CHT's `inputs/` block are plumbing and
  // hidden, calculates elsewhere are treated as report outputs and kept).
  const simpleHiddenIds = useMemo(
    () => (mode === 'simple' ? computeSimpleHiddenRowIds(form.survey) : new Set<string>()),
    [form.survey, mode],
  );
  const displayItems = buildDisplayItems(form.survey, mode, collapsedGroupIds, simpleHiddenIds);
  // Flatten the recursive tree into the list of row IDs currently
  // visible (expanded). Collapsed groups contribute zero rows (the entire
  // begin..end subtree is hidden from the DndContext).
  const visibleRowIds = useMemo(() => flattenVisibleRowIds(displayItems), [displayItems]);
  const hiddenSimpleCount = simpleHiddenIds.size;

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    // §B2 — all structural decision logic lives in shared/planSurveyMove
    // so it's unit-tested and stays consistent with the §A6 save-guard
    // oracle. The caller is now thin: dispatch, surface error message
    // on reject, prompt for dependency-violation on leaf-ok.
    const plan = planSurveyMove(form.survey, String(active.id), String(over.id));
    if (plan.kind === 'rejected') {
      // Silent no-op for the same-row case; surface the message
      // otherwise so the user sees WHY their drop was refused.
      if (plan.reason !== 'rows-not-found' || String(active.id) !== String(over.id)) {
        setError(plan.message);
      }
      return;
    }

    // Predict dependency violations; if any, confirm with the user.
    // (Skipped for group-as-unit moves — the dependency validator is
    // per-row and a group move's per-row impact is harder to summarize;
    // the save-time validator still catches a broken survey.)
    if (!plan.isGroupMove) {
      const newIndex = form.survey.findIndex((r) => r.rowId === over.id);
      const broken = predictViolationsForMove(form, String(active.id), newIndex);
      if (broken.length > 0) {
        const ok = window.confirm(
          `Moving this row will break dependency on: ${broken.join(', ')}.\n\n` +
            `These fields are referenced in the row's expressions but defined later. Move anyway?`,
        );
        if (!ok) return;
      }
    }
    patch({ ...form, survey: plan.next });
  }

  // Phase-2 picker draft. Held in local state so the row doesn't enter
  // form.survey (and the dnd-kit SortableContext / dependency validator)
  // until the user picks a type. When `pickerMode` is 'edit' the picker
  // re-types the row whose rowId is `pickerEditRowId` instead of inserting.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerEditRowId, setPickerEditRowId] = useState<string | null>(null);
  // §A3 — when the user clicks "+ add inside <group>", remember the index
  // we should insert the new row(s) at. `null` means "append to the end"
  // (the legacy default). Cleared after every commit/cancel.
  const [pendingInsertIndex, setPendingInsertIndex] = useState<number | null>(null);
  const existingListNames = useMemo(() => {
    const s = new Set<string>();
    for (const c of form.choices) if (c.list_name) s.add(c.list_name);
    return [...s].sort();
  }, [form.choices]);

  function addQuestion(insertIndex?: number) {
    setPickerEditRowId(null);
    setPendingInsertIndex(insertIndex ?? null);
    setPickerOpen(true);
  }

  function handlePickerCommit(commit: import('./QuestionTypePicker.js').PickerCommit) {
    setPickerOpen(false);
    if (pickerEditRowId) {
      // Edit mode: re-type an existing row. Preserve everything except
      // type and the appearance extras the new tile dictates. Any unrelated
      // extras (relevant/calculation/constraint/etc) are kept intact.
      patch({
        ...form,
        survey: form.survey.map((r) => {
          if (r.rowId !== pickerEditRowId) return r;
          const nextExtras: Record<string, string> = { ...r.extras };
          for (const [k, v] of Object.entries(commit.extras)) {
            if (v) nextExtras[k] = v;
            else delete nextExtras[k];
          }
          return { ...r, type: commit.type, extras: nextExtras };
        }),
      });
      setPickerEditRowId(null);
      return;
    }
    // Add mode: append a new row + (for selects) any inline choice rows.
    const counter = form.survey.length + 1;
    const stamp = `${form.survey.length + 1}`;
    const commitedType = commit.type.trim().toLowerCase();
    const isBeginGroup = commitedType === 'begin group';
    const isBeginRepeat = commitedType === 'begin repeat';

    // §A3 — splice the new row(s) at `pendingInsertIndex` if the user
    // came via "+ add inside" / "+ add row here", otherwise append. Two
    // helpers share the splice so the structural-pair and single-row
    // branches stay symmetric.
    const insertAt = pendingInsertIndex;
    setPendingInsertIndex(null);
    function spliceSurvey(rows: SurveyRow[]): SurveyRow[] {
      if (insertAt === null || insertAt < 0 || insertAt > form.survey.length) {
        return [...form.survey, ...rows];
      }
      return [...form.survey.slice(0, insertAt), ...rows, ...form.survey.slice(insertAt)];
    }

    // §A1 — committing a structural tile inserts a MATCHED begin/end pair
    // as one edit. The picker only offers the `begin` tile; the user never
    // adds an `end` row directly. Without this, the picker emitted an
    // unbalanced survey that pyxform/cht-conf rejected on deploy
    // (docs/plans/survey-groups-and-scaffold.md §A1).
    if (isBeginGroup || isBeginRepeat) {
      const groupName = commit.name || `g${counter}`;
      const beginRow: SurveyRow = {
        rowId: `r_new_${stamp}_${counter}_begin`,
        type: commit.type,
        name: groupName,
        // CHT convention: structural rows carry NO_LABEL when label cells exist;
        // the picker's user-typed label (if any) lives in extras already.
        labels: { en: '' },
        required: '',
        extras: { ...commit.extras },
      };
      const endRow: SurveyRow = {
        rowId: `r_new_${stamp}_${counter}_end`,
        type: isBeginGroup ? 'end group' : 'end repeat',
        // CHT-conf convention: the `end` row repeats the group name so that
        // re-serialize keeps it. Some templates omit it; both round-trip.
        name: groupName,
        labels: { en: '' },
        required: '',
        extras: {},
      };
      patch({ ...form, survey: spliceSurvey([beginRow, endRow]) });
      return;
    }

    const newRow: SurveyRow = {
      rowId: `r_new_${stamp}_${counter}`,
      type: commit.type,
      name: commit.name || `q${counter}`,
      labels: { en: '' },
      required: '',
      extras: { ...commit.extras },
    };
    let nextChoices = form.choices;
    if (commit.list && commit.list.choices.length > 0) {
      const additions: ChoiceRow[] = commit.list.choices.map((c, i) => {
        const labels: Record<string, string> = {};
        if (c.label) labels['en'] = c.label;
        return {
          rowId: `c_new_${stamp}_${i}`,
          list_name: commit.list!.list_name,
          name: c.name || `opt_${i + 1}`,
          labels,
          extras: {},
        };
      });
      nextChoices = [...form.choices, ...additions];
    }
    patch({ ...form, survey: spliceSurvey([newRow]), choices: nextChoices });
  }

  function openTypePickerFor(rowId: string) {
    setPickerEditRowId(rowId);
    setPickerOpen(true);
  }

  function updateRow(rowId: string, updater: (r: SurveyRow) => SurveyRow) {
    patch({
      ...form,
      survey: form.survey.map((r) => (r.rowId === rowId ? updater(r) : r)),
    });
  }

  function removeRow(rowId: string) {
    if (!form) return;
    const row = form.survey.find((r) => r.rowId === rowId);
    const label = row?.name || row?.type || rowId;
    // Capture the pre-delete snapshot id BEFORE patching, so the toast Undo
    // jumps back to exactly that state even if the user makes other edits
    // before clicking Undo.
    const snapshotId = props.getSnapshotId();
    patch({ ...form, survey: form.survey.filter((r) => r.rowId !== rowId) });
    showUndoToast({
      message: `Deleted "${label}"`,
      onUndo: () => props.jumpTo(snapshotId),
    });
  }

  function moveRow(rowId: string, direction: -1 | 1) {
    const idx = form.survey.findIndex((r) => r.rowId === rowId);
    if (idx < 0) return;
    const newIndex = idx + direction;
    if (newIndex < 0 || newIndex >= form.survey.length) return;
    const targetRowId = form.survey[newIndex]!.rowId;

    // §B2 — share the §A4 structural decision with onDragEnd via the
    // shared planner. The dependency-violation prompt stays here (the
    // planner doesn't know about the dependency validator).
    const plan = planSurveyMove(form.survey, rowId, targetRowId);
    if (plan.kind === 'rejected') {
      setError(plan.message);
      return;
    }
    if (!plan.isGroupMove) {
      const broken = predictViolationsForMove(form, rowId, newIndex);
      if (broken.length > 0) {
        const ok = window.confirm(
          `Moving this row will break dependency on: ${broken.join(', ')}. Move anyway?`,
        );
        if (!ok) return;
      }
    }
    patch({ ...form, survey: plan.next });
  }

  function toggleGroup(beginRowId: string) {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      // Stored as a "flip from default" intent — see DEFAULT_COLLAPSED_GROUP_NAMES.
      if (next.has(beginRowId)) next.delete(beginRowId);
      else next.add(beginRowId);
      return next;
    });
  }

  /**
   * §A5 Ungroup — remove the begin/end shell of a group, leaving its
   * children at the parent depth. Refuses if the input is unbalanced
   * (the begin has no matching end) — the §A6 banner already tells the
   * user to fix the imbalance first. Children stay in survey order, just
   * with the structural rows excised.
   *
   * (The plan also locks a "Group these" wrap affordance for N contiguous
   * rows; that requires a multi-select mechanism not in the editor yet
   * and is deferred to a follow-up slice. Plan §A5 wrap.)
   */
  function ungroup(beginRowId: string) {
    // §B2 — delegate to shared/planUngroup so the operation is unit-tested
    // and uses the same balance oracle the §A6 save-guard does.
    const plan = planUngroup(form.survey, beginRowId);
    if (plan.kind === 'rejected') {
      setError(plan.message);
      return;
    }
    patch({ ...form, survey: plan.next });
  }

  /**
   * Render a `DisplayItem` — a flat row card, or a (potentially nested)
   * group container that recursively renders its children. Pulled out so
   * the rendering walk can mirror the recursive `buildDisplayItems` walk
   * verbatim and so a group's children can themselves include groups
   * (plan §A2).
   */
  function renderItem(item: DisplayItem): ReactElement {
    if (item.kind === 'row') {
      const row = item.row;
      const idx = form.survey.findIndex((r) => r.rowId === row.rowId);
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
          fieldChoices={fieldChoices}
          fieldKinds={fieldKinds}
          inputContactFields={props.inputContactFields}
          contextKeys={props.contextKeys}
          form={form}
          patch={patch}
          update={(u) => updateRow(row.rowId, u)}
          remove={() => removeRow(row.rowId)}
          moveUp={() => moveRow(row.rowId, -1)}
          moveDown={() => moveRow(row.rowId, 1)}
          onChangeType={() => openTypePickerFor(row.rowId)}
        />
      );
    }
    // Group container — recursive. The begin/end rows are NOT rendered as
    // independent cards; their content (name + structural kind) is folded
    // into the header. Each nesting level indents its children by the CSS
    // padding-left on `.survey-group-children` (cumulative through the
    // DOM, so a depth-3 group is indented 3×).
    return (
      <SurveyGroupAccordion
        key={item.beginRowId}
        item={item}
        renderItem={renderItem}
        toggleGroup={toggleGroup}
        addQuestion={addQuestion}
        ungroup={ungroup}
        formSurvey={form.survey}
      />
    );
  }

  return (
    <div className="survey-tab">
      <div className="row gap toolbar">
        <button onClick={() => addQuestion(defaultInsertIndex(form.survey))}>+ Question</button>
        <div className="row gap mode-toggle">
          <button
            className={mode === 'simple' ? 'active' : 'link'}
            onClick={() => setMode('simple')}
            title="Show only user-facing questions and notes"
          >
            Simple
          </button>
          <button
            className={mode === 'full' ? 'active' : 'link'}
            onClick={() => setMode('full')}
            title="Show every row including groups, hidden, calculate, and inputs"
          >
            Full
          </button>
        </div>
        {/* Only show the "N plumbing rows hidden" hint when there ARE
            visible rows. When Simple mode is empty (a freshly-scaffolded
            Default form), the empty-state below carries the message
            instead — §B1 cold-start fix. */}
        {mode === 'simple' && hiddenSimpleCount > 0 && displayItems.length > 0 && (
          <span className="muted small">
            {hiddenSimpleCount} plumbing row{hiddenSimpleCount === 1 ? '' : 's'} hidden (structural, hidden, inputs/ calculates) — switch to Full to edit.
          </span>
        )}
        {mode === 'full' && (
          <span className="muted small">Drag rows to reorder. Reorder is blocked if it would break dependencies.</span>
        )}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visibleRowIds} strategy={verticalListSortingStrategy}>
          <div className="survey-list">{displayItems.map(renderItem)}</div>
        </SortableContext>
      </DndContext>

      {/* §B1 — positive empty-state for the cold-start case. Simple
          mode + zero visible rows means either a freshly-scaffolded
          Default form (real plumbing exists, user just hasn't added
          questions yet) or a Blank form. Either way the right message
          is encouragement, not a "N rows hidden" warning. */}
      {mode === 'simple' && displayItems.length === 0 && (
        <div className="survey-empty-state">
          {hiddenSimpleCount > 0 ? (
            <>
              <p>
                <strong>Your form is ready.</strong> The standard patient-linking setup is in
                place ({hiddenSimpleCount} plumbing row
                {hiddenSimpleCount === 1 ? '' : 's'} — view in Full mode).
              </p>
              <p className="muted">Add your first question to start authoring.</p>
            </>
          ) : (
            <p className="muted">
              No questions yet. Click <strong>+ Question</strong> to add your first row.
            </p>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => addQuestion(defaultInsertIndex(form.survey))}
          >
            + Add your first question
          </button>
        </div>
      )}

      {pickerOpen && (
        <QuestionTypePicker
          title={pickerEditRowId ? 'Change question type' : 'Add question'}
          commitLabel={pickerEditRowId ? 'Change type' : 'Add question'}
          mode={mode}
          existingLists={existingListNames}
          hideNameField={Boolean(pickerEditRowId)}
          initialName={
            pickerEditRowId
              ? form.survey.find((r) => r.rowId === pickerEditRowId)?.name ?? ''
              : ''
          }
          initialTileId={
            pickerEditRowId
              ? findTileForRowType(
                  form.survey.find((r) => r.rowId === pickerEditRowId)?.type ?? '',
                  form.survey.find((r) => r.rowId === pickerEditRowId)?.extras['appearance'] ?? '',
                )?.id
              : undefined
          }
          defaultListNameSeed={pickerEditRowId ? undefined : undefined}
          onCancel={() => {
            setPickerOpen(false);
            setPickerEditRowId(null);
            setPendingInsertIndex(null);
          }}
          onCommit={handlePickerCommit}
        />
      )}
    </div>
  );
}

/**
 * Group `name`s that start collapsed by default in Full mode. `inputs` is
 * the CHT plumbing block (`contact.*`/`user.*`-driven calculates) every
 * deployed form carries — almost never edited, so the editor tucks it away.
 * Other groups start expanded; the user can collapse any of them via the
 * group header.
 */
const DEFAULT_COLLAPSED_GROUP_NAMES = new Set(['inputs']);

/** True for select_one / select_multiple / rank rows (list-bearing types). */
function isSelectRow(row: SurveyRow): boolean {
  const head = row.type.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return head === 'select_one' || head === 'select_multiple' || head === 'rank';
}

/**
 * Map a raw `row.type` cell (+ optional appearance) back to a human-friendly
 * tile label so the chip in SurveyRowCard reads as "Select one" instead of
 * "select_one yes_no". Falls back to the raw type when no catalog entry
 * matches (preserving the round-trip raw fallback for unrecognized types).
 */
function prettyTypeLabel(rawType: string, appearance: string): string {
  if (!rawType) return '(no type)';
  const tile = findTileForRowType(rawType, appearance);
  return tile?.label ?? rawType;
}

/**
 * Recursive display item — what the renderer walks. A `'row'` is a flat
 * survey row at the given `depth`; a `'group'` wraps its children
 * recursively and exposes the begin/end rowIds so drag/insert affordances
 * can find both bounds. Plan: docs/plans/survey-groups-and-scaffold.md §A2.
 */
type DisplayItem =
  | { kind: 'row'; row: SurveyRow; depth: number }
  | {
      kind: 'group';
      /** Group `name` (lifted from the begin row). Empty when the begin row
       *  has no name — still renders, just without a label chip. */
      name: string;
      /** `begin group` vs `begin repeat` — the renderer styles them
       *  differently and the "+ add inside" wording stays the same. */
      structuralType: 'group' | 'repeat';
      depth: number;
      /** Stable id of the begin row — used as the collapse-state key and
       *  React list key. */
      beginRowId: string;
      /** Stable id of the matching end row — needed by §A3 positional
       *  insert (place new rows at endRow's index) and §A4 group-as-unit
       *  drag (the begin..end slice is the unit). */
      endRowId: string;
      /** Number of rows strictly inside the group (excludes begin + end).
       *  Used by the collapsed-state header summary. */
      innerRowCount: number;
      children: DisplayItem[];
      collapsed: boolean;
    };

/**
 * §B1 — pick the index where a top-level "+ Question" should land. The
 * Part-B Default scaffold ends with linking `calculate` rows at depth 0
 * (`patient_uuid`/`patient_id`/`created_by`/`created_by_person_uuid`);
 * appending past those would silently bury the user's first real
 * question behind invisible plumbing. Insert just before that trailing
 * `calculate` run; on a form with no trailing calculates this returns
 * `survey.length` and the append-to-end behavior is preserved.
 */
function defaultInsertIndex(survey: SurveyRow[]): number {
  let depth = 0;
  let trailingStart = -1;
  for (let j = 0; j < survey.length; j++) {
    const t = survey[j]!.type.trim().toLowerCase();
    if (t === 'begin group' || t === 'begin repeat') {
      depth++;
      trailingStart = -1;
      continue;
    }
    if (t === 'end group' || t === 'end repeat') {
      depth--;
      trailingStart = -1;
      continue;
    }
    if (depth !== 0) continue;
    if (t === 'calculate') {
      if (trailingStart === -1) trailingStart = j;
    } else {
      // any other top-level row breaks the trailing-calc run
      trailingStart = -1;
    }
  }
  return trailingStart === -1 ? survey.length : trailingStart;
}

/** Walk a `DisplayItem[]` tree and return every row ID currently
 *  visible (expanded). Collapsed groups contribute zero rows — the entire
 *  begin..end subtree is hidden from the DndContext + sortable. */
function flattenVisibleRowIds(items: DisplayItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.kind === 'row') {
      out.push(it.row.rowId);
    } else if (!it.collapsed) {
      out.push(it.beginRowId);
      out.push(...flattenVisibleRowIds(it.children));
      out.push(it.endRowId);
    }
    // Collapsed groups contribute nothing — neither the begin/end pair
    // nor the children — so a sortable can't accidentally drop a row
    // inside a hidden group.
  }
  return out;
}

function buildDisplayItems(
  survey: SurveyRow[],
  mode: 'simple' | 'full',
  collapsedGroupIds: Set<string>,
  simpleHiddenIds: Set<string>,
): DisplayItem[] {
  if (mode === 'simple') {
    // Simple mode stays flat — structural rows are hidden via
    // simpleHiddenIds, and the user-facing rows render at depth 0.
    return survey
      .filter((r) => !simpleHiddenIds.has(r.rowId))
      .map((row): DisplayItem => ({ kind: 'row', row, depth: 0 }));
  }
  // Full mode — recursive depth-aware walk. Every balanced begin…end becomes
  // a nestable container; unbalanced surveys still walk safely (a stray
  // begin's children list keeps growing until the survey ends, and the
  // §A4 validator surfaces the imbalance via the page-header banner).
  const ctx = { survey, collapsedGroupIds, index: 0 };
  return walkChildren(ctx, 0);
}

interface WalkCtx {
  survey: SurveyRow[];
  collapsedGroupIds: Set<string>;
  index: number;
}

/** Walk forward from `ctx.index`, collecting display items at `depth`,
 *  until we hit a matching `end` (or run out of rows). The caller advances
 *  past the `end` row itself. */
function walkChildren(ctx: WalkCtx, depth: number): DisplayItem[] {
  const items: DisplayItem[] = [];
  while (ctx.index < ctx.survey.length) {
    const row = ctx.survey[ctx.index]!;
    const t = row.type.trim().toLowerCase();
    if (t === 'end group' || t === 'end repeat') {
      // Don't consume the end row — the caller (a recursive ascent or the
      // top-level loop) advances past it after the recursive return.
      return items;
    }
    if (t === 'begin group' || t === 'begin repeat') {
      const beginRow = row;
      const structuralType: 'group' | 'repeat' = t === 'begin group' ? 'group' : 'repeat';
      ctx.index++; // consume the begin row
      const children = walkChildren(ctx, depth + 1);
      // Either we hit a matching end (at ctx.index) or fell off the survey
      // (unbalanced). In the balanced case advance past the end row; in
      // the unbalanced case `endRow` is the last row we touched and we
      // leave it to the §A4 validator to surface.
      const endRow: SurveyRow | undefined = ctx.survey[ctx.index];
      if (endRow) {
        const endT = endRow.type.trim().toLowerCase();
        if (endT === 'end group' || endT === 'end repeat') ctx.index++;
      }
      items.push({
        kind: 'group',
        name: beginRow.name,
        structuralType,
        depth,
        beginRowId: beginRow.rowId,
        endRowId: endRow ? endRow.rowId : beginRow.rowId,
        innerRowCount: children.length,
        children,
        // Collapse-state convention: a group is collapsed by default iff
        // its `name` is in DEFAULT_COLLAPSED_GROUP_NAMES (the CHT `inputs`
        // plumbing block). The user-toggled set FLIPS that default —
        // toggling an `inputs` group EXPANDS it, toggling a plain group
        // COLLAPSES it. Storing only the flip means a freshly-added
        // group keeps the default behavior with no Set entry needed.
        collapsed: (() => {
          const defaultCollapsed = DEFAULT_COLLAPSED_GROUP_NAMES.has(beginRow.name);
          const userToggled = ctx.collapsedGroupIds.has(beginRow.rowId);
          return userToggled ? !defaultCollapsed : defaultCollapsed;
        })(),
      });
      continue;
    }
    items.push({ kind: 'row', row, depth });
    ctx.index++;
  }
  return items;
}

/**
 * Render a (potentially nested) group accordion as a sortable unit.
 * The group as a whole is a useSortable target with the begin row's id;
 * its drag handle moves the entire begin..end slice (§A4 group-as-unit
 * drag) via the slice-aware onDragEnd handler in SurveyTab. The
 * children are rendered recursively through `renderItem` so nesting
 * keeps working at any depth.
 */
function SurveyGroupAccordion(props: {
  item: Extract<DisplayItem, { kind: 'group' }>;
  renderItem: (item: DisplayItem) => ReactElement;
  toggleGroup: (beginRowId: string) => void;
  addQuestion: (insertIndex?: number) => void;
  ungroup: (beginRowId: string) => void;
  formSurvey: SurveyRow[];
}) {
  const { item } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.beginRowId });
  const style: import('react').CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const isCollapsed = item.collapsed;
  const kindLabel =
    item.structuralType === 'repeat' ? 'begin repeat → end repeat' : 'begin group → end group';
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`survey-group-accordion depth-${item.depth}`}
      data-structural-type={item.structuralType}
    >
      <div className="survey-group-header-row">
        <button
          type="button"
          className="drag-handle group-drag-handle"
          aria-label={`drag group ${item.name || '(unnamed)'}`}
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
        <button
          type="button"
          className="survey-group-header"
          onClick={() => props.toggleGroup(item.beginRowId)}
          aria-expanded={!isCollapsed}
          aria-controls={`group-children-${item.beginRowId}`}
          title={isCollapsed ? 'Expand group' : 'Collapse group'}
        >
          <span className="caret" aria-hidden="true">
            {isCollapsed ? '▸' : '▾'}
          </span>
          <code>{item.name || '(unnamed)'}</code>
          <span className="muted small">
            {item.innerRowCount} row{item.innerRowCount === 1 ? '' : 's'} inside ({kindLabel})
          </span>
        </button>
        {/* §A5 Ungroup — removes the begin/end shell, keeping children
            at the parent depth. Hidden behind a low-emphasis link so it
            doesn't compete with the header's collapse toggle. */}
        <button
          type="button"
          className="link group-ungroup"
          onClick={() => props.ungroup(item.beginRowId)}
          title="Remove this group's begin/end, keeping the rows inside"
        >
          ungroup
        </button>
      </div>
      {!isCollapsed && (
        <div id={`group-children-${item.beginRowId}`} className="survey-group-children">
          {item.children.map(props.renderItem)}
          {/* §A3 — "+ add inside" inserts a new row at the end of this group,
               just BEFORE the matching `end` row. */}
          <button
            type="button"
            className="link survey-add-inside"
            onClick={() => {
              const endIdx = props.formSurvey.findIndex((r) => r.rowId === item.endRowId);
              if (endIdx < 0) return;
              props.addQuestion(endIdx);
            }}
            title={`Insert a new row inside this ${item.structuralType}`}
          >
            + add inside {item.name || `(${item.structuralType})`}
          </button>
        </div>
      )}
    </div>
  );
}

function SurveyRowCard(props: {
  row: SurveyRow;
  locales: string[];
  violations: OrderingViolation[];
  fieldOptions: string[];
  fieldChoices: Record<string, string[]>;
  /** Coarse FieldKind per field name, for type-aware op/field soft-filter
   *  (plan v0.3). Names absent from this map are treated as 'unknown' at
   *  the picker (always-pass) — never silently mis-bucketed. */
  fieldKinds: Record<string, FieldKind>;
  /** Tier 1.5 — contact input field list and contact-summary context keys.
   *  Forwarded only to the calculation ExpressionField; the boolean
   *  builders ignore them. */
  inputContactFields: string[];
  contextKeys: string[];
  /** Whole form + patch, so the inline choices editor can mutate form.choices. */
  form: XLSForm;
  patch: (next: XLSForm) => void;
  update: (u: (r: SurveyRow) => SurveyRow) => void;
  remove: () => void;
  moveUp: () => void;
  moveDown: () => void;
  /** Opens the tile picker scoped to this row's type. */
  onChangeType: () => void;
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
          <button
            type="button"
            className="type-chip"
            onClick={props.onChangeType}
            title="Click to change question type"
          >
            <span className="type-chip-label">{prettyTypeLabel(row.type, row.extras['appearance'] ?? '')}</span>
            <code className="type-chip-raw">{row.type || '(no type)'}</code>
          </button>
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
            {isSelectRow(row) && (
              <InlineChoicesEditor
                form={props.form}
                rowId={row.rowId}
                defaultLocale={props.locales[0] ?? 'en'}
                patch={props.patch}
              />
            )}
            <UnifiedConditionBuilder
              fieldOptions={props.fieldOptions}
              fieldChoices={props.fieldChoices}
              fieldKinds={props.fieldKinds}
              getColumn={(col) => row.extras[col] ?? ''}
              setColumn={(col, value) => setExtra(col, value)}
            />
            <ExpressionField
              label="relevant"
              friendlyLabel="Show this question when…"
              hint="leave blank to always show"
              helpText="XPath expression. The question is hidden until this is true. References other fields via ${name}."
              value={row.extras['relevant'] ?? ''}
              onChange={(v) => setExtra('relevant', v)}
              fieldOptions={props.fieldOptions}
            />
            <ExpressionField
              label="calculation"
              friendlyLabel="Compute the value as…"
              hint="for calculate or hidden fields"
              helpText="XPath that computes this field's value from other fields. Common for `calculate` rows; can also pre-fill a regular question."
              value={row.extras['calculation'] ?? ''}
              onChange={(v) => setExtra('calculation', v)}
              fieldOptions={props.fieldOptions}
              inputContactFields={props.inputContactFields}
              contextKeys={props.contextKeys}
            />
            <ExpressionField
              label="constraint"
              friendlyLabel="Accept the answer only if…"
              hint="validation rule"
              helpText="XPath. If the answer doesn't satisfy this, the form blocks submission and shows the constraint_message below."
              value={row.extras['constraint'] ?? ''}
              onChange={(v) => setExtra('constraint', v)}
              fieldOptions={props.fieldOptions}
            />
            {isSelectRow(row) && (
              <ExpressionField
                label="choice_filter"
                friendlyLabel="Filter the choice list when…"
                hint="only for select questions"
                helpText="XPath evaluated per choice row. Use the choices sheet's filter-category column with this to show only matching options."
                value={row.extras['choice_filter'] ?? ''}
                onChange={(v) => setExtra('choice_filter', v)}
                fieldOptions={props.fieldOptions}
              />
            )}
            <AppearanceField
              value={row.extras['appearance'] ?? ''}
              rowType={row.type}
              onChange={(v) => setExtra('appearance', v)}
            />
            <ExpressionField
              label="default"
              friendlyLabel="Default value"
              hint="pre-fill"
              helpText="Literal value or ${other_field} reference. Pre-fills the answer; the user can still change it."
              value={row.extras['default'] ?? ''}
              onChange={(v) => setExtra('default', v)}
            />
            {row.type.trim().toLowerCase() === 'begin repeat' && (
              <ExpressionField
                label="repeat_count"
                friendlyLabel="Number of repeats"
                hint="for begin repeat only"
                helpText="XPath that returns a number — how many times this group repeats. Common pattern: ${family_size}."
                value={row.extras['repeat_count'] ?? ''}
                onChange={(v) => setExtra('repeat_count', v)}
              />
            )}
            <details className="raw-extras">
              <summary>Hints &amp; error messages</summary>
              <div className="hints-grid">
                {props.locales.map((loc) => (
                  <ExpressionField
                    key={`hint-${loc}`}
                    label={`hint::${loc}`}
                    friendlyLabel={`Help text (${loc})`}
                    hint="shown under the question"
                    helpText="Plain text shown beneath the question label to guide the user. Optional."
                    value={row.extras[`hint::${loc}`] ?? ''}
                    onChange={(v) => setExtra(`hint::${loc}`, v)}
                  />
                ))}
                {row.extras['constraint'] &&
                  props.locales.map((loc) => (
                    <ExpressionField
                      key={`cmsg-${loc}`}
                      label={`constraint_message::${loc}`}
                      friendlyLabel={`Error message (${loc})`}
                      hint="when the constraint above fails"
                      helpText="Shown to the user when the constraint rejects their answer. Only meaningful when a constraint is set."
                      value={row.extras[`constraint_message::${loc}`] ?? ''}
                      onChange={(v) => setExtra(`constraint_message::${loc}`, v)}
                    />
                  ))}
              </div>
            </details>
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

/**
 * Wrapper for the `appearance` column: text input + "Pick widgets" button
 * that opens AppearancePicker. The picker is a catalog of CHT and Enketo
 * appearance tokens; multiple tokens can be combined (space-separated).
 */
function AppearanceField(props: {
  value: string;
  rowType: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <label className="expr-field">
      <span className="expr-label">
        <code>appearance</code>
        <em className="muted">
          {' '}— widget hints (multiline, hidden, mrdt-verify, h1 blue, …).
        </em>
        <button
          className="link"
          onClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
        >
          ✎ pick widgets
        </button>
      </span>
      <input value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      {open && (
        <AppearancePicker
          value={props.value}
          rowType={props.rowType}
          onChange={props.onChange}
          onCancel={() => setOpen(false)}
        />
      )}
    </label>
  );
}

/** Small text input for an arbitrary XLSForm expression column. */
function ExpressionField(props: {
  /** The raw XLSForm column name (e.g. "relevant"). Used as the data key. */
  label: string;
  /** Plain-English title shown to the user. Falls back to `label` if absent. */
  friendlyLabel?: string;
  /** Short hint shown next to the label. */
  hint: string;
  /** Long-form help text shown in a hover tooltip with a `❔` icon. */
  helpText?: string;
  value: string;
  onChange: (v: string) => void;
  /** When set, shows a "Build" button that opens the visual rule builder. */
  fieldOptions?: string[];
  /** Tier 1.5 — contact input field list for the calc builder's
   *  "Contact input field" reference kind. Forwarded to CalculationBuilder. */
  inputContactFields?: string[];
  /** Tier 1.5 — contact-summary context keys for the calc builder's
   *  "Contact-summary value" reference kind. Forwarded to CalculationBuilder. */
  contextKeys?: string[];
}) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [showCalcBuilder, setShowCalcBuilder] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const supportsRelevant =
    props.fieldOptions !== undefined &&
    ['relevant', 'constraint', 'choice_filter'].includes(props.label);
  const supportsCalculation = props.fieldOptions !== undefined && props.label === 'calculation';
  const supportsBuilder = supportsRelevant || supportsCalculation;
  return (
    <label className="expr-field">
      <span className="expr-label">
        <strong>{props.friendlyLabel ?? props.label}</strong>
        {props.friendlyLabel && (
          <code className="raw-col-tag" title={`Raw XLSForm column: ${props.label}`}>
            {props.label}
          </code>
        )}
        {props.helpText && (
          <span className="help-icon" title={props.helpText} aria-label={props.helpText}>
            ❔
          </span>
        )}
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
          title="Calculation builder"
          value={props.value}
          fieldOptions={props.fieldOptions}
          inputContactFields={props.inputContactFields}
          contextKeys={props.contextKeys}
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

/**
 * Walks the survey + choices sheets to build a `name → choice-values` map.
 *
 * Two sources, in priority order (form-local wins on collision so the open
 * form's own select is never overridden by project-level context):
 *   1. `contactFieldChoices`: choices reachable from a select in any
 *      `forms/contact/*.xlsx`, scanned by the server at project open. Lets
 *      the condition builder surface a values dropdown for contact-injected
 *      fields like `inputs/contact/sex` whose underlying select_one lives
 *      in a different form. Optional — older server responses may omit it.
 *   2. This form's own select_one / select_multiple rows.
 *
 * Fields that resolve nowhere are absent from the result so the builder
 * falls back to the free-text input (the existing safety net).
 */
function buildFieldChoices(
  survey: SurveyRow[],
  choices: ChoiceRow[],
  contactFieldChoices?: Record<string, string[]>,
): Record<string, string[]> {
  // Start from project-level context (contact-form selects).
  const out: Record<string, string[]> = { ...(contactFieldChoices ?? {}) };

  // Overlay form-local selects so this form's own definitions win on collision.
  const listToValues = new Map<string, string[]>();
  for (const c of choices) {
    if (!c.list_name || !c.name) continue;
    if (!listToValues.has(c.list_name)) listToValues.set(c.list_name, []);
    listToValues.get(c.list_name)!.push(c.name);
  }
  for (const r of survey) {
    if (!r.name) continue;
    const m = r.type.trim().match(SELECT_TYPE_RE);
    if (!m) continue;
    const vals = listToValues.get(m[2]!);
    if (vals && vals.length > 0) out[r.name] = vals;
  }
  return out;
}

/**
 * Operators the visual condition builder offers. NOTE: `and` and `or` are
 * deliberately absent here — connectors live BETWEEN clauses (the
 * between-clause pill in stacked mode), never inside a single one. This
 * is the §3.7 structural guarantee: there is no UI path that can write
 * `${a}='x' or ${b}>10 and ${c}='y'` flat-mixed to row.extras. To mix
 * AND with OR, the user must press `( group these )` (commit C).
 */
type CondOp = ClauseOp;

const COND_OPS_NEED_FIELD: CondOp[] = [
  '=', '!=', '>', '<', '>=', '<=', 'selected', 'selected-not', 'not', 'ref',
];
const COND_OPS_NEED_VALUE: CondOp[] = ['=', '!=', '>', '<', '>=', '<=', 'selected', 'selected-not'];

// `calculation` is intentionally NOT in this list. It produces a VALUE,
// not a boolean, and is edited via the dedicated CalculationBuilder
// (mounted by ExpressionField when `supportsCalculation` holds). See
// docs/plans/calculation-builder.md v0.2 §3.6 — "double-door" fix.
const COLUMN_OPTIONS = [
  { value: 'relevant', label: 'Show when… (relevant)' },
  { value: 'constraint', label: 'Accept only if… (constraint)' },
  { value: 'choice_filter', label: 'Filter choices when… (choice_filter)' },
] as const;

/** Microcopy per plan §10. */
const CONNECTOR_LABELS = { and: 'and also', or: 'or instead' } as const;

/**
 * Comparison op → English. Used for the prose preview ("This row shows
 * when: sex is female and age is more than 18"). `today()` / `not(${field})`
 * / ref stay as code-style chips because there's no clean English form.
 */
const COMPARISON_PROSE: Record<'=' | '!=' | '>' | '<' | '>=' | '<=', string> = {
  '=': 'is',
  '!=': 'is not',
  '>': 'is more than',
  '<': 'is less than',
  '>=': 'is at least',
  '<=': 'is at most',
};

/**
 * Display-only natural-language labels for the op `<select>` (plan v0.3 §4,
 * v0.3-punchlist B1). The option `value`s remain the canonical `ClauseOp`
 * tokens — labels NEVER reach `clauseToRule`/`serializeAnyParsed`.
 *
 * **B1 fix (2026-06-15):** drop the trailing "value" from every comparison
 * label so the dropdown reads as a complete phrase, not a fragment.
 *
 * **User override (2026-06-15):** the four ordering operators (`>`, `<`,
 * `>=`, `<=`) stay as mathematical glyphs, NOT the verbose
 * `is more than` / `is at least` prose — they're universally readable and
 * leaning into NLP for them looked overdone. Equality/inequality keep
 * their plain-language form (`equals` / `is not`) since `=` / `!=` are
 * less obvious in isolation. The prose preview (`This row shows when:`)
 * still uses `COMPARISON_PROSE` verbatim for natural reading; dropdown
 * and preview differ only on the four ordering rows. Tracked so the
 * planner can revisit if the divergence proves confusing in usability.
 *
 * Banned tokens: `not(`, `today()`, `${field}`, `selected(`, `div`, `floor`.
 * None must appear in any label the user picks.
 */
const OPERATOR_LABELS: Record<ClauseOp, string> = {
  '=': 'equals',
  '!=': COMPARISON_PROSE['!='],
  '>': '>',
  '<': '<',
  '>=': '≥',
  '<=': '≤',
  selected: 'includes',
  'selected-not': 'does not include',
  not: 'is not selected',
  ref: 'has an answer',
  today: 'today',
};

function clauseToProse(c: Clause): string {
  if (c.op === '=' || c.op === '!=' || c.op === '>' || c.op === '<' || c.op === '>=' || c.op === '<=') {
    return `${c.field} ${COMPARISON_PROSE[c.op]} ${c.value}`;
  }
  if (c.op === 'selected') return `${c.field} includes ${c.value}`;
  if (c.op === 'selected-not') return `${c.field} does not include ${c.value}`;
  if (c.op === 'not') return `not(\${${c.field}})`;
  if (c.op === 'ref') return `\${${c.field}}`;
  return 'today()';
}

/**
 * Unified condition builder shown above the raw column inputs.
 *
 * Slice 2 commit B (docs/plans/condition-builder.md v0.2). The transient
 * state lives in `useReducer(conditionBuilderReducer, ...)`. The strip's
 * own op dropdown no longer carries `and`/`or` — those are the between-
 * clause connector pill in stacked mode, and the legacy fragment-append
 * path (`build()` returning ` and ` / ` or ` for direct string
 * concatenation) is gone. All writes to `row.extras[column]` flow through
 * `serializeBuilderState` → `serializeAnyParsed`.
 *
 * Layout:
 *   - **One-clause fidelity**: when `clauses.length===0 && draft empty`,
 *     OR `clauses.length===1 && draft empty && !rawFallback`, render a
 *     single horizontal strip — same column/field/value dropdowns,
 *     same free-text value fallback, same `+ insert` position as today.
 *     No chip group, no preview header.
 *   - **Stacked mode**: as soon as the chain has ≥2 clauses, OR the user
 *     starts a draft on top of a committed clause, show the committed
 *     clauses as chips with the between-clause connector pill, plus a
 *     prose preview header `This row shows when: …`.
 *   - **Raw fallback**: when the existing column value couldn't be cleanly
 *     parsed (mixed AND/OR without parens, three-level nesting, etc.),
 *     show the banner and keep chaining disabled; the existing text stays
 *     visible + editable in the ExpressionField below.
 */
function UnifiedConditionBuilder(props: {
  fieldOptions: string[];
  fieldChoices: Record<string, string[]>;
  /** FieldKind per field name. Missing keys fall through to 'unknown'
   *  (always-pass) — see plan v0.3 §3 never-de-emphasize contract. */
  fieldKinds: Record<string, FieldKind>;
  getColumn: (col: string) => string;
  setColumn: (col: string, value: string) => void;
}) {
  const [state, dispatch] = useReducer(conditionBuilderReducer, initialConditionBuilderState);

  // Whenever the user picks a column, hydrate the reducer from its
  // existing value. parseRelevantGrouped routes anything outside our
  // grammar to rawFallback (chaining disabled, text preserved).
  function onPickColumn(col: ConditionColumn | ''): void {
    const existingValue = col ? props.getColumn(col) : '';
    dispatch({ kind: 'set-column', column: col, existingValue });
  }

  function setDraft(partial: Partial<Clause>): void {
    dispatch({ kind: 'set-draft', partial });
  }

  // The connector picker default — only meaningful before a connector is
  // locked. After lock it's read-only and reflects the lock. In grouped
  // mode the active subgroup carries its own connector lock.
  const [connectorChoice, setConnectorChoice] = useState<'and' | 'or'>('and');

  /**
   * Resolve the locked connector for the current commit context. In flat
   * mode it's `state.lockedConnector`. In grouped mode it's the active
   * subgroup's `connector` (only locked once the subgroup has clauses).
   */
  function activeLockedConnector(): 'and' | 'or' | null {
    if (state.groups === null) return state.lockedConnector;
    const idx = state.activeGroupIndex;
    if (idx === null) return null;
    const active = state.groups[idx];
    return active && active.clauses.length > 0 ? active.connector : null;
  }

  function doAddAnother(): void {
    if (!isDraftComplete(state.draft)) return;
    const connector: 'and' | 'or' = activeLockedConnector() ?? connectorChoice;
    dispatch({ kind: 'commit-clause', connector });
  }

  function doInsert(): void {
    if (!state.column || !isInsertReady(state)) return;
    // Write the serialized chain to row.extras[column], replacing whatever's
    // there. Different from today's append-on-insert: chaining now produces
    // the FULL expression, so we own the column's value end-to-end.
    const out = serializeBuilderState(state);
    props.setColumn(state.column, out);
    // Reset the session by re-hydrating against the just-written value.
    dispatch({ kind: 'set-column', column: state.column, existingValue: out });
  }

  function doStartOver(): void {
    dispatch({ kind: 'start-over' });
  }

  function doUndoLastClause(): void {
    dispatch({ kind: 'pop-clause' });
  }

  function onGroupThese(): void {
    dispatch({ kind: 'enter-group-mode' });
  }

  function onFlatten(): void {
    dispatch({ kind: 'exit-group-mode' });
  }

  function onAddSubgroup(connector: 'and' | 'or'): void {
    dispatch({ kind: 'add-subgroup', connector });
  }

  /**
   * Switch the active subgroup. If the draft has been started but is not
   * yet complete, confirm with the user before discarding it — never
   * silently drop in-flight input (Lorena gate + Lal blocking #1).
   */
  function requestActiveGroupSwitch(index: number): void {
    const draftStarted = !isDraftEmpty(state.draft);
    const draftComplete = isDraftComplete(state.draft);
    if (draftStarted && !draftComplete) {
      // eslint-disable-next-line no-alert
      const ok = window.confirm('Discard the in-flight rule?');
      if (!ok) return;
      dispatch({ kind: 'set-draft', partial: { field: '', op: '=', value: '' } });
    }
    dispatch({ kind: 'set-active-group', index });
  }

  const choices = state.draft.field ? props.fieldChoices[state.draft.field] : undefined;
  const needsField = (COND_OPS_NEED_FIELD as string[]).includes(state.draft.op);
  const needsValue = (COND_OPS_NEED_VALUE as string[]).includes(state.draft.op);

  // ---- v0.3 type-aware soft filter --------------------------------------
  // Local UI state only — NEVER enters BuilderState or any serialization
  // path (Lal/Developer A7). If a saved/rehydrated field would be atypical
  // for the current op, default the toggle to ON so the saved selection is
  // never visually stranded.
  const [showAllFields, setShowAllFields] = useState(false);
  const kindOf = (n: string): FieldKind => props.fieldKinds[n] ?? 'unknown';

  // Op-first partition for the field picker. Active whenever the op takes
  // a field (so `today` doesn't activate filtering; the field select is
  // disabled in that case anyway). Selected field is forced into the
  // typical bucket so it always renders adjacent to the picker.
  const fieldHasOpHint = needsField;
  const splitFieldsByOp = fieldHasOpHint && !showAllFields;
  const typicalFields: string[] = [];
  const atypicalFields: string[] = [];
  if (splitFieldsByOp) {
    for (const name of props.fieldOptions) {
      if (name === state.draft.field) {
        typicalFields.push(name);
      } else if (fieldsTypicalForOp(state.draft.op, kindOf(name))) {
        typicalFields.push(name);
      } else {
        atypicalFields.push(name);
      }
    }
  }
  // Auto-relax: if the rehydrated/selected field is atypical for the
  // current op, surface it by forcing the flat list on next render. We
  // use a ref-like effect to flip the toggle exactly once per mismatch.
  useEffect(() => {
    if (!splitFieldsByOp) return;
    if (!state.draft.field) return;
    const k = kindOf(state.draft.field);
    if (!fieldsTypicalForOp(state.draft.op, k)) setShowAllFields(true);
    // intentionally narrow deps — only react to draft.field/op transitions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.draft.field, state.draft.op]);

  // Field-first partition for the op picker. Grouping only — every op
  // always stays in the DOM (no escape-hatch toggle needed; A6/A7).
  const fieldKindForOpPicker: FieldKind = state.draft.field ? kindOf(state.draft.field) : 'unknown';
  const splitOpsByField = state.draft.field !== '';
  const typicalOpsSet = splitOpsByField
    ? new Set(opsTypicalForKind(fieldKindForOpPicker))
    : null;
  // Stable display order — keep the canonical 11-op order; flag typical-vs-other.
  const opGroups: Array<{ label: string; ops: ClauseOp[] }> = (() => {
    const all: ClauseOp[] = ['=', '!=', '>', '<', '>=', '<=', 'selected', 'selected-not', 'not', 'ref', 'today'];
    if (!splitOpsByField || !typicalOpsSet) {
      return [{ label: 'all operators', ops: all }];
    }
    const typical = all.filter((o) => typicalOpsSet.has(o));
    const other = all.filter((o) => !typicalOpsSet.has(o));
    return [
      { label: 'Common operators', ops: typical },
      ...(other.length ? [{ label: 'Other operators', ops: other }] : []),
    ];
  })();

  // "Stacked" iff the FLAT chain has reached the chip threshold. Plan §4:
  // "the stacked-clause/chip UI only appears once a second clause exists."
  // In grouped mode the card stack always renders.
  const draftEmpty = isDraftEmpty(state.draft);
  const stacked = state.clauses.length >= 2 || (state.clauses.length >= 1 && !draftEmpty);

  const proseChips = state.clauses.map(clauseToProse);
  const draftProse = isDraftComplete(state.draft) ? clauseToProse(state.draft) : '…';

  // Group-mode derived state.
  const activeGroup: Subgroup | null =
    state.groups !== null && state.activeGroupIndex !== null
      ? (state.groups[state.activeGroupIndex] ?? null)
      : null;
  const activeSubgroupConnector = activeLockedConnector();
  const canGroupThese =
    state.groups === null &&
    state.clauses.length >= 2 &&
    state.lockedConnector !== null &&
    state.rawFallback === null;
  const canFlatten =
    state.groups !== null &&
    state.groups.filter((g) => g.clauses.length > 0).length <= 1;

  return (
    <div className="cond-strip cond-strip-unified">
      {state.rawFallback !== null && (
        <div
          className="muted"
          role="status"
          style={{ width: '100%', padding: '4px 0' }}
        >
          This rule was hand-written. Edit as text, or clear it to use the builder.
        </div>
      )}

      {/*
        Card stack — grouped mode. Each subgroup is its own bordered card;
        the active card commits the next clause from the strip below.
        Outer-connector pill renders between cards (or as a "+ add a
        second subgroup" affordance when only subgroup 1 exists).
      */}
      {state.groups !== null && state.rawFallback === null && (
        <div
          role="group"
          aria-label="Grouped conditions"
          className="cond-subgroup-stack"
          style={{ width: '100%' }}
        >
          <div className="muted ref-chips-hint" style={{ marginBottom: 4 }}>
            This row shows when:
          </div>
          {state.groups.map((sg, gi) => (
            <Fragment key={gi}>
              <section
                className={`cond-subgroup${gi === state.activeGroupIndex ? ' active' : ''}`}
                aria-current={gi === state.activeGroupIndex ? 'true' : undefined}
              >
                <button
                  type="button"
                  className="cond-subgroup-header"
                  aria-pressed={gi === state.activeGroupIndex}
                  tabIndex={gi === state.activeGroupIndex ? 0 : -1}
                  onClick={(e) => {
                    e.preventDefault();
                    if (gi !== state.activeGroupIndex) requestActiveGroupSwitch(gi);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const next = (gi + 1) % state.groups!.length;
                      requestActiveGroupSwitch(next);
                    }
                  }}
                >
                  subgroup {gi + 1}
                </button>
                <div
                  className="row gap"
                  style={{ flexWrap: 'wrap', alignItems: 'center' }}
                >
                  {sg.clauses.map((c, ci) => (
                    <span key={ci} className="row gap" style={{ alignItems: 'center' }}>
                      {ci > 0 && (
                        <span className="muted" style={{ fontSize: 12 }}>
                          {CONNECTOR_LABELS[sg.connector]}
                        </span>
                      )}
                      <code className="cond-preview">{clauseToProse(c)}</code>
                      <button
                        type="button"
                        className="link"
                        aria-label="remove rule"
                        title={
                          gi === state.activeGroupIndex && ci === sg.clauses.length - 1
                            ? 'Remove this rule'
                            : 'Switch to this subgroup to remove its last rule'
                        }
                        onClick={(e) => {
                          e.preventDefault();
                          if (
                            gi === state.activeGroupIndex &&
                            ci === sg.clauses.length - 1
                          ) {
                            doUndoLastClause();
                          }
                        }}
                        disabled={
                          gi !== state.activeGroupIndex ||
                          ci !== sg.clauses.length - 1
                        }
                      >
                        × remove rule
                      </button>
                    </span>
                  ))}
                  {sg.clauses.length === 0 && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      (empty — build a rule in the strip below)
                    </span>
                  )}
                </div>
              </section>
              {/* Outer-connector pill row. Between subgroup 1 and subgroup
                  2 once both exist, OR as the "+ add second subgroup"
                  affordance when only subgroup 1 has at least one clause. */}
              {gi === 0 && state.groups!.length === 2 && (
                <div className="cond-outer-connector muted" style={{ fontSize: 12 }}>
                  {state.outerConnector !== null
                    ? CONNECTOR_LABELS[state.outerConnector]
                    : CONNECTOR_LABELS.and}
                </div>
              )}
              {gi === 0 &&
                state.groups!.length === 1 &&
                sg.clauses.length >= 1 && (
                  <div
                    className="cond-outer-connector row gap"
                    style={{ alignItems: 'center', fontSize: 12 }}
                  >
                    <span className="muted">Add another subgroup with:</span>
                    <button
                      type="button"
                      className="link"
                      title="Start a second subgroup joined by 'and also'"
                      onClick={(e) => {
                        e.preventDefault();
                        onAddSubgroup('and');
                      }}
                    >
                      {CONNECTOR_LABELS.and}
                    </button>
                    <button
                      type="button"
                      className="link"
                      title="Start a second subgroup joined by 'or instead'"
                      onClick={(e) => {
                        e.preventDefault();
                        onAddSubgroup('or');
                      }}
                    >
                      {CONNECTOR_LABELS.or}
                    </button>
                  </div>
                )}
            </Fragment>
          ))}
        </div>
      )}

      {/* Flat-mode chip row — only when not grouped. */}
      {state.groups === null && stacked && state.rawFallback === null && (
        <div style={{ width: '100%' }}>
          <div className="muted ref-chips-hint" style={{ marginBottom: 4 }}>
            This row shows when:{' '}
            {state.clauses.map((_, i) => (
              <span key={i}>
                {i > 0 && (
                  <span className="muted">
                    {' '}{CONNECTOR_LABELS[state.connectors[i - 1] ?? 'and']}{' '}
                  </span>
                )}
                <code className="cond-preview">{proseChips[i]}</code>
              </span>
            ))}
            {!draftEmpty && (
              <>
                <span className="muted">
                  {' '}{CONNECTOR_LABELS[state.lockedConnector ?? connectorChoice]}{' '}
                </span>
                <code className="cond-preview">{draftProse}</code>
              </>
            )}
          </div>
          <div
            role="group"
            aria-label="Conditions for showing this row"
            className="row gap"
            style={{ flexWrap: 'wrap', marginBottom: 6 }}
          >
            {state.clauses.map((c, i) => (
              <span key={i} className="row gap" style={{ alignItems: 'center' }}>
                {i > 0 && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {CONNECTOR_LABELS[state.connectors[i - 1] ?? 'and']}
                  </span>
                )}
                <code className="cond-preview">{clauseToProse(c)}</code>
                <button
                  type="button"
                  className="link"
                  aria-label="remove rule"
                  title="Remove this rule"
                  onClick={(e) => {
                    e.preventDefault();
                    if (i === state.clauses.length - 1) doUndoLastClause();
                  }}
                  disabled={i !== state.clauses.length - 1}
                >
                  × remove rule
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <span className="muted ref-chips-hint">build:</span>
      <select
        className="ref-chip-select"
        value={state.column}
        onChange={(e) => onPickColumn(e.target.value as ConditionColumn | '')}
        title="Which column to add the fragment to"
      >
        <option value="">— column —</option>
        {COLUMN_OPTIONS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <select
        className="ref-chip-select"
        value={state.draft.field}
        onChange={(e) => setDraft({ field: e.target.value, value: '' })}
        title="Pick a field"
        disabled={state.rawFallback !== null || !needsField}
      >
        <option value="">— field —</option>
        {splitFieldsByOp ? (
          <>
            <optgroup label="Typical for this check">
              {typicalFields.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </optgroup>
            {atypicalFields.length > 0 && (
              <optgroup label="Other fields">
                {atypicalFields.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </optgroup>
            )}
          </>
        ) : (
          props.fieldOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))
        )}
      </select>
      {/* "Show all fields" — persistent escape hatch (plan v0.3 §3). Only
          rendered when the op-first filter is actually active; otherwise
          it would be a confusing no-op. Local UI state, never persisted. */}
      {fieldHasOpHint && (
        <label
          className="muted"
          style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          title="Show every field, including those less common for this check"
        >
          <input
            type="checkbox"
            checked={showAllFields}
            onChange={(e) => setShowAllFields(e.target.checked)}
            disabled={state.rawFallback !== null}
          />
          Show all fields
        </label>
      )}
      <select
        className="ref-chip-select"
        value={state.draft.op}
        onChange={(e) => setDraft({ op: e.target.value as ClauseOp, value: '' })}
        title="Pick what to add"
        disabled={state.rawFallback !== null}
      >
        {opGroups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.ops.map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABELS[op]}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {choices && choices.length > 0 ? (
        <select
          className="ref-chip-select"
          value={state.draft.value}
          onChange={(e) => setDraft({ value: e.target.value })}
          title="Pick a value from this field's choices"
          disabled={state.rawFallback !== null || !needsValue}
        >
          <option value="">— value —</option>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="cond-value-input"
          value={state.draft.value}
          onChange={(e) => setDraft({ value: e.target.value })}
          placeholder="value or ${other_field}"
          disabled={state.rawFallback !== null || !needsValue}
        />
      )}

      {/* Between-clause connector picker. Visible whenever a chain is in
          play, OR in grouped mode whenever the active subgroup has at
          least one clause. Locked after the first connector is chosen
          (intra-subgroup or flat) so flat-mixed AND/OR is structurally
          impossible (§3.3). The `( group these )` button is the escape
          hatch for mixed combinators. */}
      {((state.groups === null &&
        (state.clauses.length >= 1 || state.lockedConnector !== null)) ||
        (state.groups !== null && activeGroup !== null && activeGroup.clauses.length >= 1)) && (
        <select
          className="ref-chip-select"
          value={activeSubgroupConnector ?? connectorChoice}
          onChange={(e) => setConnectorChoice(e.target.value as 'and' | 'or')}
          title={
            activeSubgroupConnector !== null
              ? 'Mixing "and also" with "or instead" needs grouping. Press ( group these ) to combine rules.'
              : 'How the next rule combines with this one'
          }
          disabled={activeSubgroupConnector !== null}
        >
          <option value="and">{CONNECTOR_LABELS.and}</option>
          <option value="or">{CONNECTOR_LABELS.or}</option>
        </select>
      )}

      <button
        type="button"
        className="link"
        onClick={(e) => {
          e.preventDefault();
          doAddAnother();
        }}
        disabled={state.rawFallback !== null || !isDraftComplete(state.draft)}
        title={
          state.rawFallback !== null
            ? 'Clear the hand-written text first to use the builder'
            : 'Stage this clause and keep building'
        }
      >
        + add another rule
      </button>
      {canGroupThese && (
        <button
          type="button"
          className="link"
          onClick={(e) => {
            e.preventDefault();
            onGroupThese();
          }}
          title="Collect the current rules into a group so you can add rules joined by the other connector"
        >
          ( group these )
        </button>
      )}
      {state.groups !== null && (
        <button
          type="button"
          className="link"
          onClick={(e) => {
            e.preventDefault();
            onFlatten();
          }}
          disabled={!canFlatten}
          title={
            canFlatten
              ? 'Collapse the group back into a flat chain'
              : 'Remove a subgroup before flattening'
          }
        >
          flatten
        </button>
      )}
      <button
        type="button"
        className="link"
        onClick={(e) => {
          e.preventDefault();
          doInsert();
        }}
        disabled={!isInsertReady(state)}
        title={
          state.column
            ? `Write the full chain to ${state.column}`
            : 'Pick a column first'
        }
      >
        + insert
      </button>
      <button
        type="button"
        className="link"
        onClick={(e) => {
          e.preventDefault();
          doStartOver();
        }}
        disabled={
          state.clauses.length === 0 &&
          draftEmpty &&
          state.groups === null
        }
        title="Clear the in-progress chain (does not touch the saved value)"
      >
        × start over
      </button>
      {(state.clauses.length > 0 ||
        (activeGroup !== null && activeGroup.clauses.length > 0)) && (
        <button
          type="button"
          className="link"
          onClick={(e) => {
            e.preventDefault();
            doUndoLastClause();
          }}
          title="Pop the last committed clause off the chain"
        >
          ↶ undo last clause
        </button>
      )}
    </div>
  );
}

/* ------------------------------ Choices tab ----------------------------- */

function ChoicesTab(props: {
  form: XLSForm;
  patch: (n: XLSForm) => void;
  undo: () => void;
  getSnapshotId: () => number;
  jumpTo: (id: number) => void;
}) {
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
    if (!form) return;
    const choice = form.choices.find((c) => c.rowId === rowId);
    const snapshotId = props.getSnapshotId();
    patch({ ...form, choices: form.choices.filter((c) => c.rowId !== rowId) });
    showUndoToast({
      message: `Deleted choice "${choice?.name || rowId}"`,
      onUndo: () => props.jumpTo(snapshotId),
    });
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

/* ----------------------------- Translate tab ----------------------------- */

/**
 * Side-by-side translation grid. One row per labeled survey/choice row,
 * one column per locale, free-text cells. Editing a cell mutates
 * `row.labels[locale]` and propagates via `patch()`. Saves through the
 * normal form-save path.
 *
 * Only rows with a non-empty `name` and at least one existing label are
 * shown — structural begin/end markers and unlabeled calculate rows are
 * hidden so translators see only what they need to translate.
 */
function TranslateTab(props: { form: XLSForm; patch: (n: XLSForm) => void }) {
  const { form, patch } = props;
  const locales = form.surveyHeaders.labelLocales.length > 0
    ? form.surveyHeaders.labelLocales
    : ['en'];
  const choiceLocales = form.choicesHeaders.labelLocales.length > 0
    ? form.choicesHeaders.labelLocales
    : ['en'];
  const [filter, setFilter] = useState('');
  const [scope, setScope] = useState<'survey' | 'choices' | 'all'>('survey');

  const f = filter.trim().toLowerCase();
  const surveyRows = form.survey.filter((r) => {
    if (!r.name) return false;
    const hasAnyLabel = Object.values(r.labels).some((v) => v && v.trim());
    if (!hasAnyLabel) return false;
    if (!f) return true;
    if (r.name.toLowerCase().includes(f)) return true;
    return Object.values(r.labels).some((v) => v && v.toLowerCase().includes(f));
  });
  const choiceRows = form.choices.filter((c) => {
    if (!f) return true;
    if (c.list_name.toLowerCase().includes(f) || c.name.toLowerCase().includes(f)) return true;
    return Object.values(c.labels).some((v) => v && v.toLowerCase().includes(f));
  });

  function updateSurveyLabel(rowId: string, locale: string, value: string) {
    patch({
      ...form,
      survey: form.survey.map((r) =>
        r.rowId === rowId ? { ...r, labels: { ...r.labels, [locale]: value } } : r,
      ),
    });
  }
  function updateChoiceLabel(idx: number, locale: string, value: string) {
    patch({
      ...form,
      choices: form.choices.map((c, i) =>
        i === idx ? { ...c, labels: { ...c.labels, [locale]: value } } : c,
      ),
    });
  }

  const missingCounts = locales.map((loc) => ({
    locale: loc,
    missing: surveyRows.filter((r) => !r.labels[loc] || !r.labels[loc]!.trim()).length,
  }));

  return (
    <div className="translate-tab">
      <div className="row gap toolbar">
        <input
          type="search"
          placeholder="Filter by name or label text…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, maxWidth: 320 }}
        />
        <div className="row gap mode-toggle">
          <button
            className={scope === 'survey' ? 'active' : 'link'}
            onClick={() => setScope('survey')}
          >
            Survey ({surveyRows.length})
          </button>
          <button
            className={scope === 'choices' ? 'active' : 'link'}
            onClick={() => setScope('choices')}
          >
            Choices ({choiceRows.length})
          </button>
          <button className={scope === 'all' ? 'active' : 'link'} onClick={() => setScope('all')}>
            All
          </button>
        </div>
        <div className="row gap">
          {missingCounts.map((m) => (
            <span key={m.locale} className={`badge${m.missing > 0 ? ' warn' : ''}`}>
              {m.locale}: {m.missing} missing
            </span>
          ))}
        </div>
      </div>

      {(scope === 'survey' || scope === 'all') && (
        <section>
          <h3>Survey labels</h3>
          <table className="translate-grid">
            <thead>
              <tr>
                <th style={{ width: 180 }}>Field</th>
                {locales.map((loc) => (
                  <th key={loc}>label::{loc}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {surveyRows.map((r) => (
                <tr key={r.rowId}>
                  <td>
                    <code>{r.name}</code>
                    <div className="muted small">{r.type}</div>
                  </td>
                  {locales.map((loc) => (
                    <td key={loc}>
                      <textarea
                        value={r.labels[loc] ?? ''}
                        onChange={(e) => updateSurveyLabel(r.rowId, loc, e.target.value)}
                        rows={Math.max(1, Math.ceil((r.labels[loc]?.length ?? 0) / 50))}
                        placeholder={`(empty — translate from ${locales.find((l) => l !== loc && r.labels[l]) ?? 'en'})`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {surveyRows.length === 0 && (
                <tr>
                  <td colSpan={locales.length + 1} className="muted">
                    No survey rows match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {(scope === 'choices' || scope === 'all') && (
        <section>
          <h3>Choice labels</h3>
          <table className="translate-grid">
            <thead>
              <tr>
                <th style={{ width: 180 }}>List / choice</th>
                {choiceLocales.map((loc) => (
                  <th key={loc}>label::{loc}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {choiceRows.map((c, i) => (
                <tr key={`${c.list_name}:${c.name}:${i}`}>
                  <td>
                    <code>{c.list_name}</code> / <code>{c.name}</code>
                  </td>
                  {choiceLocales.map((loc) => (
                    <td key={loc}>
                      <textarea
                        value={c.labels[loc] ?? ''}
                        onChange={(e) => updateChoiceLabel(i, loc, e.target.value)}
                        rows={1}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {choiceRows.length === 0 && (
                <tr>
                  <td colSpan={choiceLocales.length + 1} className="muted">
                    No choices match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
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
