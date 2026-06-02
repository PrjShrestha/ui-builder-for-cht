/**
 * Kobo-style question-type picker.
 *
 * A modal that shows a tile grid grouped by category. The user types a
 * question name, picks a tile, and the parent gets back the chosen
 * SurveyRow shape (with sensible default extras and an auto-generated
 * list_name token for select_one / select_multiple).
 *
 * This file is intentionally pure-presentational — no XLSForm parsing,
 * no store access. The parent decides whether picking commits immediately
 * or stages a draft.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  QUESTION_TYPE_TILES,
  type QuestionTypeTile,
  type TileCategory,
} from './QuestionTypeCatalog.js';

export interface PickerCommit {
  /** Final `type:` cell value (e.g. `select_one option_list_3`). */
  type: string;
  /** Initial `extras` (e.g. `{ appearance: 'likert' }`). */
  extras: Record<string, string>;
  /** Name typed in the picker (may be empty). */
  name: string;
  /** Tile id that was picked (for analytics / re-opening). */
  tileId: string;
  /**
   * For selects: a generated `list_name` token + the initial choice rows the
   * user added inline. Parent is responsible for appending them to
   * `form.choices` (we don't have access to it from here).
   */
  list?: {
    list_name: string;
    choices: Array<{ name: string; label: string }>;
  };
}

interface Props {
  /** Title text on the modal header. */
  title?: string;
  /** Initial value of the name field. */
  initialName?: string;
  /** When set, that tile id is pre-selected on open (used by edit-type flow). */
  initialTileId?: string;
  /**
   * Simple/Full filter — when "simple", tiles marked `hiddenInSimple`
   * are filtered out of the grid (calculate, hidden, structural).
   */
  mode?: 'simple' | 'full';
  /**
   * Existing `list_name`s in this form, used to offer "reuse existing list"
   * for select_one / select_multiple. Empty array hides the reuse UI.
   */
  existingLists?: string[];
  /** Suggested list_name when the user picks select_one / multiple. */
  defaultListNameSeed?: string;
  /** Hide the "name" field (used when re-typing an existing row). */
  hideNameField?: boolean;
  /** Label on the primary commit button. Defaults to "Add question". */
  commitLabel?: string;
  onCancel: () => void;
  onCommit: (commit: PickerCommit) => void;
}

type PickerStep = 'pick-type' | 'configure-list';

export function QuestionTypePicker(props: Props) {
  const mode = props.mode ?? 'full';
  const [step, setStep] = useState<PickerStep>('pick-type');
  const [name, setName] = useState(props.initialName ?? '');
  const [activeTileId, setActiveTileId] = useState<string | undefined>(props.initialTileId);
  const [filter, setFilter] = useState<'all' | 'cht'>('all');
  const [search, setSearch] = useState('');
  const [listChoice, setListChoice] = useState<'new' | string>('new');
  const [newListName, setNewListName] = useState(() =>
    suggestListName(props.defaultListNameSeed ?? props.initialName ?? 'options'),
  );
  const [draftChoices, setDraftChoices] = useState<Array<{ name: string; label: string }>>([
    { name: '', label: '' },
    { name: '', label: '' },
  ]);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (props.hideNameField) {
      searchInputRef.current?.focus();
    } else {
      nameInputRef.current?.focus();
    }
  }, [props.hideNameField]);

  // Escape to dismiss.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onCancel();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const tiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return QUESTION_TYPE_TILES.filter((t) => {
      if (mode === 'simple' && t.hiddenInSimple) return false;
      if (filter === 'cht' && !t.chtOnly) return false;
      if (q && !t.label.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [mode, filter, search]);

  const byCategory = useMemo(() => {
    const map = new Map<TileCategory, QuestionTypeTile[]>();
    for (const t of tiles) {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    }
    return map;
  }, [tiles]);

  const activeTile = activeTileId
    ? QUESTION_TYPE_TILES.find((t) => t.id === activeTileId)
    : undefined;

  function handlePick(tile: QuestionTypeTile) {
    setActiveTileId(tile.id);
    if (tile.needsListName) {
      // Reseed the suggested list name from the latest typed name.
      setNewListName(suggestListName(name || tile.id, props.existingLists ?? []));
      setStep('configure-list');
      return;
    }
    // Kobo parity: single-click commits a tile that needs no further setup.
    // Defer to the next tick so React flushes the activeTileId state first
    // (so the closure in commit() sees the just-clicked tile).
    requestAnimationFrame(() => commitFor(tile));
  }

  function commitFor(tile: QuestionTypeTile) {
    let typeCell = tile.xlsformType;
    let list: PickerCommit['list'] | undefined;
    if (tile.needsListName) {
      const chosenList =
        listChoice === 'new' ? newListName.trim() || 'options' : listChoice;
      typeCell = `${tile.xlsformType} ${chosenList}`;
      if (listChoice === 'new') {
        list = {
          list_name: chosenList,
          choices: draftChoices
            .map((c) => ({ name: c.name.trim(), label: c.label.trim() }))
            .filter((c) => c.name || c.label),
        };
      }
    }
    props.onCommit({
      type: typeCell,
      extras: { ...(tile.defaultExtras ?? {}) },
      name,
      tileId: tile.id,
      list,
    });
  }

  function commit() {
    if (!activeTile) return;
    commitFor(activeTile);
  }

  function addChoiceRow() {
    setDraftChoices((rows) => [...rows, { name: '', label: '' }]);
  }
  function updateChoiceRow(idx: number, patch: Partial<{ name: string; label: string }>) {
    setDraftChoices((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function removeChoiceRow(idx: number) {
    setDraftChoices((rows) => rows.filter((_, i) => i !== idx));
  }

  const canCommitFromPickType = Boolean(activeTile && !activeTile.needsListName);

  return (
    <div className="qtype-backdrop" onMouseDown={(e) => {
      if (e.target === e.currentTarget) props.onCancel();
    }}>
      <div className="qtype-modal" role="dialog" aria-label="Pick question type">
        <div className="qtype-header">
          <h2>{props.title ?? 'Add question'}</h2>
          <button className="link" onClick={props.onCancel} aria-label="Close">
            ✕
          </button>
        </div>

        {step === 'pick-type' && (
          <>
            {!props.hideNameField && (
              <label className="qtype-name-field">
                <span>Question name</span>
                <input
                  ref={nameInputRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. has_fever, patient_age"
                  autoComplete="off"
                />
                <span className="muted small">
                  Used in expressions as <code>${'${' + (name || 'name') + '}'}</code>. No spaces.
                </span>
              </label>
            )}

            <div className="qtype-toolbar">
              <input
                ref={searchInputRef}
                className="qtype-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search types…"
                autoComplete="off"
              />
              <div className="qtype-filter">
                <label>
                  <input
                    type="radio"
                    checked={filter === 'all'}
                    onChange={() => setFilter('all')}
                  />
                  All
                </label>
                <label>
                  <input
                    type="radio"
                    checked={filter === 'cht'}
                    onChange={() => setFilter('cht')}
                  />
                  CHT-only
                </label>
              </div>
            </div>

            <div className="qtype-grid-scroll">
              {CATEGORY_ORDER.filter((c) => (byCategory.get(c)?.length ?? 0) > 0).map((cat) => (
                <section key={cat} className="qtype-cat">
                  <h3>{CATEGORY_LABELS[cat]}</h3>
                  <div className="qtype-grid">
                    {(byCategory.get(cat) ?? []).map((tile) => (
                      <button
                        key={tile.id}
                        type="button"
                        className={`qtype-tile${activeTileId === tile.id ? ' active' : ''}`}
                        onClick={() => handlePick(tile)}
                        title={tile.description}
                      >
                        <span className="qtype-tile-icon">{tile.icon}</span>
                        <span className="qtype-tile-label">{tile.label}</span>
                        <span className="qtype-tile-hint">{tile.description}</span>
                        {tile.chtOnly && <span className="qtype-badge">CHT</span>}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {tiles.length === 0 && (
                <p className="muted">No tiles match "{search}". Clear the search to see all.</p>
              )}
            </div>

            <div className="qtype-actions">
              <button className="link" onClick={props.onCancel}>
                Cancel
              </button>
              <button
                onClick={commit}
                disabled={!canCommitFromPickType}
                title={
                  !activeTile
                    ? 'Pick a type tile first'
                    : activeTile.needsListName
                      ? 'Click "Next: choices" instead'
                      : ''
                }
              >
                {props.commitLabel ?? 'Add question'}
              </button>
            </div>
          </>
        )}

        {step === 'configure-list' && activeTile && (
          <>
            <p className="muted">
              <strong>{activeTile.label}</strong> needs a list of options. Add them now or pick
              an existing list.
            </p>

            {(props.existingLists?.length ?? 0) > 0 && (
              <div className="qtype-list-choice">
                <label>
                  <input
                    type="radio"
                    checked={listChoice === 'new'}
                    onChange={() => setListChoice('new')}
                  />
                  Create new list
                </label>
                {(props.existingLists ?? []).map((l) => (
                  <label key={l}>
                    <input
                      type="radio"
                      checked={listChoice === l}
                      onChange={() => setListChoice(l)}
                    />
                    Reuse <code>{l}</code>
                  </label>
                ))}
              </div>
            )}

            {listChoice === 'new' && (
              <>
                <label className="qtype-name-field">
                  <span>List name</span>
                  <input
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    placeholder="options"
                  />
                  <span className="muted small">
                    Identifier used in <code>{activeTile.xlsformType} {newListName || 'name'}</code>.
                  </span>
                </label>

                <div className="qtype-choices-edit">
                  <div className="qtype-choices-head">
                    <span>name</span>
                    <span>label (shown to user) — press Enter to add another</span>
                    <span />
                  </div>
                  {draftChoices.map((row, i) => (
                    <div key={i} className="qtype-choice-row">
                      <input
                        value={row.name}
                        onChange={(e) => updateChoiceRow(i, { name: e.target.value })}
                        placeholder="yes"
                      />
                      <input
                        value={row.label}
                        onChange={(e) => updateChoiceRow(i, { label: e.target.value })}
                        placeholder="Yes"
                        onKeyDown={(e) => {
                          if (
                            e.key === 'Enter' &&
                            i === draftChoices.length - 1 &&
                            (row.name || row.label)
                          ) {
                            e.preventDefault();
                            addChoiceRow();
                          }
                        }}
                      />
                      <button
                        className="link danger"
                        onClick={() => removeChoiceRow(i)}
                        disabled={draftChoices.length <= 1}
                        aria-label="Remove choice"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button className="link" onClick={addChoiceRow}>
                    + Add choice
                  </button>
                </div>
              </>
            )}

            <div className="qtype-actions">
              <button className="link" onClick={() => setStep('pick-type')}>
                ← Back
              </button>
              <button onClick={commit}>{props.commitLabel ?? 'Add question'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function suggestListName(seed: string, existing: string[] = []): string {
  const base =
    seed
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'options';
  const used = new Set(existing);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}
