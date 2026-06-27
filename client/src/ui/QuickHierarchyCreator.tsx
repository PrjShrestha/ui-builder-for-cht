/**
 * Quick hierarchy creator — empty-template quick-start wizard.
 *
 * Plan: `docs/plans/quick-hierarchy-creator.md`. The author lists their
 * place levels biggest→smallest + a pinned person leaf at the bottom;
 * one click scaffolds the contact_types chain and saves it. After the
 * save succeeds, the wizard offers (but never forces) the contact-form
 * generator so the result is actually deployable, not just a tree.
 *
 * Behaviour anchors:
 *   - Writes NOTHING until the user clicks "Set up my hierarchy"
 *     (cancel/back drops everything; plan §8).
 *   - Person leaf is pinned, non-removable, non-draggable; its parents
 *     are always exactly `[last place id]` (plan §5/§8).
 *   - Slug collisions block (no auto-suffix — would orphan
 *     place_hierarchy_types; plan §7).
 *   - Devanagari / non-ASCII labels are allowed; the user must set an
 *     explicit ASCII id (no silent transliteration; plan §7).
 *   - "Branching?" footnote routes to the full HierarchyEditor (plan §4).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildQuickHierarchy,
  slugifyHierarchyId,
  validateQuickHierarchy,
  type QuickHierarchyContactType,
  type QuickHierarchyLevel,
  type QuickHierarchyResult,
  type QuickHierarchyValidationError,
} from '@cht-ui/shared';

/** Editable row holding the user's text + the id they typed (if any). */
interface DraftRow {
  /** Internal stable key so React keeps focus across reorders. */
  key: string;
  name: string;
  explicitId: string;
}

interface Props {
  /** Existing on-disk contact types — for collision check. */
  existingContactTypes: Array<{ id: string; person?: boolean }>;
  /**
   * Resolves to true if the save succeeded — wizard then swaps to the
   * "offer forms" success step. Reject on failure → wizard shows the
   * error and keeps the place list editable.
   */
  onCommit: (result: QuickHierarchyResult) => Promise<boolean>;
  /**
   * Caller opens the existing ContactFormGenerator after the success
   * step. The wizard closes itself first.
   */
  onRequestGenerator: (typesJustCreated: QuickHierarchyContactType[]) => void;
  /** Cancel / Esc / backdrop click. Drops the in-progress draft. */
  onClose: () => void;
}

/** Stable-key factory — every row needs a key independent of its name. */
function newKey(): string {
  return `qhc-${Math.random().toString(36).slice(2, 10)}`;
}

/** Pre-seed: 2 example place rows + 1 person row, none empty. */
function makeInitialPlaces(): DraftRow[] {
  return [
    { key: newKey(), name: 'District', explicitId: '' },
    { key: newKey(), name: 'Health facility', explicitId: '' },
  ];
}
function makeInitialPerson(): DraftRow {
  return { key: newKey(), name: 'Person', explicitId: '' };
}

export function QuickHierarchyCreator(props: Props) {
  const [places, setPlaces] = useState<DraftRow[]>(makeInitialPlaces);
  const [person, setPerson] = useState<DraftRow>(makeInitialPerson);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stage, setStage] = useState<'edit' | 'success'>('edit');
  // Live region for keyboard reorder announcements (plan §9).
  const [liveMessage, setLiveMessage] = useState<string>('');
  // Persist the last-built result so the success step can open the
  // ContactFormGenerator with the freshly-created types.
  const [lastResult, setLastResult] = useState<QuickHierarchyResult | null>(null);

  // Focus the first place input on open + Esc routes through cancel-confirm.
  const firstInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function hasUnsavedData(): boolean {
    // "Pre-seeded blank" doesn't count as unsaved; only changes from the seed do.
    const seedNames = ['District', 'Health facility'];
    const placesChanged =
      places.length !== 2 ||
      places.some((p, i) => p.name !== seedNames[i] || p.explicitId !== '');
    const personChanged = person.name !== 'Person' || person.explicitId !== '';
    return placesChanged || personChanged;
  }

  function handleClose() {
    if (stage === 'success') {
      props.onClose();
      return;
    }
    if (hasUnsavedData()) {
      // eslint-disable-next-line no-undef
      const ok = window.confirm(
        "Discard this hierarchy? Nothing's been saved yet.",
      );
      if (!ok) return;
    }
    props.onClose();
  }

  function asLevel(row: DraftRow): QuickHierarchyLevel {
    return { name: row.name, explicitId: row.explicitId };
  }

  const validation = useMemo(() => {
    return validateQuickHierarchy({
      places: places.map(asLevel),
      person: asLevel(person),
      existing: props.existingContactTypes,
    });
  }, [places, person, props.existingContactTypes]);

  const errorsByRow = useMemo(() => {
    const m = new Map<number | 'person', QuickHierarchyValidationError[]>();
    for (const e of validation.errors) {
      const list = m.get(e.row) ?? [];
      list.push(e);
      m.set(e.row, list);
    }
    return m;
  }, [validation.errors]);

  const canCommit = places.length > 0 && validation.errors.length === 0;

  function setLevelCount(n: number) {
    setPlaces((prev) => {
      if (n === prev.length) return prev;
      if (n > prev.length) {
        const padded = [...prev];
        while (padded.length < n) {
          padded.push({ key: newKey(), name: '', explicitId: '' });
        }
        return padded;
      }
      // Shrink: keep the first n (preserves typed names — plan §8).
      return prev.slice(0, n);
    });
  }

  function addRowBelow(idx: number) {
    setPlaces((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, { key: newKey(), name: '', explicitId: '' });
      return next;
    });
  }

  function removeRow(idx: number) {
    setPlaces((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveRow(idx: number, direction: -1 | 1) {
    setPlaces((prev) => {
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const a = next[idx]!;
      const b = next[target]!;
      next[idx] = b;
      next[target] = a;
      setLiveMessage(
        `${a.name || `Row ${idx + 1}`} moved to position ${target + 1} of ${prev.length}.`,
      );
      return next;
    });
  }

  function patchRow(idx: number, patch: Partial<DraftRow>) {
    setPlaces((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function commit() {
    if (!canCommit) return;
    const outcome = buildQuickHierarchy({
      places: places.map(asLevel),
      person: asLevel(person),
      existing: props.existingContactTypes,
    });
    if (!outcome.ok) {
      // Shouldn't happen if validation matched; surface anyway.
      setSaveError(outcome.errors.map((e) => e.message).join(' · '));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const ok = await props.onCommit(outcome.result);
      if (ok) {
        setLastResult(outcome.result);
        setStage('success');
      }
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="qtype-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="qtype-modal qhc-modal"
        role="dialog"
        aria-labelledby="qhc-title"
      >
        <div className="qtype-header">
          <h2 id="qhc-title">Set up your places</h2>
          <button className="link" onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* aria-live region for reorder announcements */}
        <div className="sr-only" aria-live="polite" role="status">
          {liveMessage}
        </div>

        {stage === 'edit' ? (
          <EditStage
            places={places}
            person={person}
            errorsByRow={errorsByRow}
            warnings={validation.warnings}
            saving={saving}
            saveError={saveError}
            canCommit={canCommit}
            firstInputRef={firstInputRef}
            setLevelCount={setLevelCount}
            patchRow={patchRow}
            addRowBelow={addRowBelow}
            removeRow={removeRow}
            moveRow={moveRow}
            setPerson={setPerson}
            onCancel={handleClose}
            onCommit={() => void commit()}
          />
        ) : (
          <SuccessStage
            placeCount={places.length}
            onSkip={() => props.onClose()}
            onGenerate={() => {
              if (lastResult) {
                props.onRequestGenerator(lastResult.contact_types);
              } else {
                props.onClose();
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ============================ edit stage ============================ */

function EditStage(props: {
  places: DraftRow[];
  person: DraftRow;
  errorsByRow: Map<number | 'person', QuickHierarchyValidationError[]>;
  warnings: Array<{ row: number | 'person'; message: string; code: string }>;
  saving: boolean;
  saveError: string | null;
  canCommit: boolean;
  firstInputRef: React.Ref<HTMLInputElement>;
  setLevelCount: (n: number) => void;
  patchRow: (idx: number, patch: Partial<DraftRow>) => void;
  addRowBelow: (idx: number) => void;
  removeRow: (idx: number) => void;
  moveRow: (idx: number, direction: -1 | 1) => void;
  setPerson: (next: DraftRow) => void;
  onCancel: () => void;
  onCommit: () => void;
}) {
  const placeCount = props.places.length;

  return (
    <>
      <div className="qhc-body">
        <p className="muted small qhc-intro">
          List your places from <strong>biggest to smallest</strong> — for example
          Country, then District, then Facility. The people you serve sit at the bottom.
        </p>

        <div className="qhc-stepper-row">
          <label className="qhc-stepper">
            <span>Levels</span>
            <select
              value={placeCount}
              onChange={(e) => props.setLevelCount(Number(e.target.value))}
              aria-label="Number of place levels"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="muted small">
            Quick way to add or trim rows. You can fine-tune the list below.
          </span>
        </div>

        <ol className="qhc-rows">
          {props.places.map((row, idx) => (
            <PlaceRow
              key={row.key}
              row={row}
              idx={idx}
              count={placeCount}
              errors={props.errorsByRow.get(idx) ?? []}
              warning={
                props.warnings.find((w) => w.row === idx)?.message ?? null
              }
              inputRef={idx === 0 ? props.firstInputRef : null}
              onPatch={(patch) => props.patchRow(idx, patch)}
              onAddBelow={() => props.addRowBelow(idx)}
              onRemove={() => props.removeRow(idx)}
              onMoveUp={() => props.moveRow(idx, -1)}
              onMoveDown={() => props.moveRow(idx, 1)}
            />
          ))}
        </ol>

        {placeCount === 0 && (
          <p className="muted small qhc-empty-helper">
            Add at least one place. Use <strong>Levels</strong> above, or the button below.
          </p>
        )}

        <div className="row gap qhc-add-row-line">
          <button
            className="link"
            onClick={() => props.setLevelCount(placeCount + 1)}
          >
            + Add a place below
          </button>
        </div>

        <PersonCard
          row={props.person}
          errors={props.errorsByRow.get('person') ?? []}
          warning={props.warnings.find((w) => w.row === 'person')?.message ?? null}
          onPatch={(patch) => props.setPerson({ ...props.person, ...patch })}
        />

        <p className="muted small qhc-fork-footnote">
          Need branching (a level under more than one parent)? Use the full{' '}
          <em>Hierarchy editor</em>.
        </p>

        {props.saveError && <div className="error-banner">{props.saveError}</div>}
      </div>

      <div className="qtype-actions">
        <button className="link" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          onClick={props.onCommit}
          disabled={!props.canCommit || props.saving}
          title={
            !props.canCommit
              ? 'Fix the errors above first'
              : 'Save these places and create the linear chain'
          }
        >
          {props.saving ? 'Saving…' : 'Set up my hierarchy'}
        </button>
      </div>
    </>
  );
}

/* ============================== rows ============================== */

function PlaceRow(props: {
  row: DraftRow;
  idx: number;
  count: number;
  errors: QuickHierarchyValidationError[];
  warning: string | null;
  inputRef: React.Ref<HTMLInputElement> | null;
  onPatch: (patch: Partial<DraftRow>) => void;
  onAddBelow: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { row, idx, count } = props;
  const derivedId = useMemo(() => {
    if (row.explicitId.trim()) return row.explicitId.trim();
    return slugifyHierarchyId(row.name.trim());
  }, [row.name, row.explicitId]);
  const errorId = props.errors.length > 0 ? `qhc-row-${idx}-error` : undefined;
  const hasErrors = props.errors.length > 0;

  return (
    <li className={`qhc-row${hasErrors ? ' has-error' : ''}`}>
      <div className="qhc-row-main">
        <span className="qhc-icon" aria-hidden="true">🏠</span>
        <div className="qhc-row-fields">
          <label className="qhc-row-name">
            <span className="sr-only">Place name (level {idx + 1})</span>
            <input
              ref={props.inputRef ?? undefined}
              value={row.name}
              onChange={(e) => props.onPatch({ name: e.target.value })}
              placeholder={`Level ${idx + 1} name`}
              aria-describedby={errorId}
              aria-invalid={hasErrors || undefined}
            />
          </label>
          <div className="qhc-row-id-line muted small">
            {derivedId ? (
              <>
                saved as <code>{derivedId}</code>
              </>
            ) : (
              <em>id needed</em>
            )}
            {row.name.trim() && !slugifyHierarchyId(row.name.trim()) && (
              <label className="qhc-explicit-id">
                <span className="sr-only">Explicit id</span>
                <input
                  value={row.explicitId}
                  onChange={(e) => props.onPatch({ explicitId: e.target.value })}
                  placeholder="explicit ascii id"
                  aria-label={`Explicit id for ${row.name || `level ${idx + 1}`}`}
                />
              </label>
            )}
          </div>
        </div>

        <div className="qhc-row-actions">
          <button
            className="link"
            onClick={props.onMoveUp}
            disabled={idx === 0}
            aria-label={`Move ${row.name || `row ${idx + 1}`} up`}
            title="Move up"
          >
            ↑
          </button>
          <button
            className="link"
            onClick={props.onMoveDown}
            disabled={idx === count - 1}
            aria-label={`Move ${row.name || `row ${idx + 1}`} down`}
            title="Move down"
          >
            ↓
          </button>
          <button
            className="link"
            onClick={props.onAddBelow}
            aria-label={`Add a place below ${row.name || `row ${idx + 1}`}`}
            title="Add a place below this row"
          >
            + below
          </button>
          <button
            className="link danger"
            onClick={props.onRemove}
            aria-label={`Remove ${row.name || `row ${idx + 1}`}`}
            title="Remove this place"
          >
            ✕
          </button>
        </div>
      </div>

      {hasErrors && (
        <div className="qhc-row-error" id={errorId} role="alert">
          {props.errors.map((e) => (
            <div key={e.code}>
              <span aria-hidden="true">⚠ </span>
              {e.message}
            </div>
          ))}
        </div>
      )}
      {props.warning && !hasErrors && (
        <div className="qhc-row-warning">
          <span aria-hidden="true">ⓘ </span>
          {props.warning}
        </div>
      )}
    </li>
  );
}

function PersonCard(props: {
  row: DraftRow;
  errors: QuickHierarchyValidationError[];
  warning: string | null;
  onPatch: (patch: Partial<DraftRow>) => void;
}) {
  const { row } = props;
  const derivedId = useMemo(() => {
    if (row.explicitId.trim()) return row.explicitId.trim();
    return slugifyHierarchyId(row.name.trim());
  }, [row.name, row.explicitId]);
  const hasErrors = props.errors.length > 0;
  const errorId = hasErrors ? 'qhc-person-error' : undefined;
  return (
    <div className={`qhc-person-card${hasErrors ? ' has-error' : ''}`}>
      <div className="qhc-person-rule" />
      <h3 className="qhc-person-heading">The people here</h3>
      <div className="qhc-row-main">
        <span className="qhc-icon" aria-hidden="true">👤</span>
        <div className="qhc-row-fields">
          <label className="qhc-row-name">
            <span className="sr-only">Person name</span>
            <input
              value={row.name}
              onChange={(e) => props.onPatch({ name: e.target.value })}
              placeholder="Person"
              aria-describedby={errorId}
              aria-invalid={hasErrors || undefined}
            />
          </label>
          <p className="muted small qhc-person-helper">
            This is who your health workers register and care for — a patient,
            client, or household member. It's always the lowest level.
          </p>
          <div className="qhc-row-id-line muted small">
            {derivedId ? (
              <>
                saved as <code>{derivedId}</code>
              </>
            ) : (
              <em>id needed</em>
            )}
            {row.name.trim() && !slugifyHierarchyId(row.name.trim()) && (
              <label className="qhc-explicit-id">
                <span className="sr-only">Explicit id for the person leaf</span>
                <input
                  value={row.explicitId}
                  onChange={(e) => props.onPatch({ explicitId: e.target.value })}
                  placeholder="explicit ascii id"
                  aria-label="Explicit id for the person leaf"
                />
              </label>
            )}
          </div>
        </div>
      </div>
      {hasErrors && (
        <div className="qhc-row-error" id={errorId} role="alert">
          {props.errors.map((e) => (
            <div key={e.code}>
              <span aria-hidden="true">⚠ </span>
              {e.message}
            </div>
          ))}
        </div>
      )}
      {props.warning && !hasErrors && (
        <div className="qhc-row-warning">
          <span aria-hidden="true">ⓘ </span>
          {props.warning}
        </div>
      )}
    </div>
  );
}

/* ============================ success stage ========================= */

function SuccessStage(props: {
  placeCount: number;
  onSkip: () => void;
  onGenerate: () => void;
}) {
  return (
    <>
      <div className="qhc-body">
        <p className="qhc-success-headline">
          ✓ Your hierarchy is saved.{' '}
          <span className="muted">
            {props.placeCount} place level{props.placeCount === 1 ? '' : 's'} + 1 person.
          </span>
        </p>
        <p>
          Want me to create the forms so you can start adding these places and people? You can skip this.
        </p>
        <p className="muted small">
          The forms generator opens with one row per place and the person — you can untick anything you don't want.
        </p>
      </div>
      <div className="qtype-actions">
        <button className="link" onClick={props.onSkip}>
          Skip for now
        </button>
        <button onClick={props.onGenerate}>Generate forms</button>
      </div>
    </>
  );
}
