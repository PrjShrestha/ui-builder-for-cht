/**
 * Inline editor for the choices bound to a single select_one / select_multiple
 * row. Renders inside SurveyRowCard's advanced panel so the user can author
 * options without jumping to the Choices tab.
 *
 * Storage contract:
 *   - Reads and writes `form.choices` directly. The Choices tab is the same
 *     store — there is no divergence.
 *   - Preserves `ChoiceRow.extras` on every mutation. Stripping extras would
 *     quietly empty CHT-specific columns like `filter-category` / `image`,
 *     breaking the round-trip invariant.
 *   - List rename routes through `renameListInType` from @cht-ui/shared so
 *     trailing tokens like `or_other` survive intact.
 */
import { useMemo, useState } from 'react';
import {
  extractListName,
  renameListInType,
  type ChoiceRow,
  type XLSForm,
} from '@cht-ui/shared';

interface Props {
  form: XLSForm;
  /** The survey row whose `type` carries the bound list_name. */
  rowId: string;
  /** Default locale to show in the compact label column. */
  defaultLocale: string;
  patch: (next: XLSForm) => void;
}

export function InlineChoicesEditor(props: Props) {
  const row = props.form.survey.find((r) => r.rowId === props.rowId);
  const listName = row ? extractListName(row.type) : undefined;
  const existingLists = useMemo(() => {
    const s = new Set<string>();
    for (const c of props.form.choices) if (c.list_name) s.add(c.list_name);
    return [...s].sort();
  }, [props.form.choices]);
  const otherLists = existingLists.filter((l) => l !== listName);

  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');

  if (!row || !listName) return null;

  const choices = props.form.choices.filter((c) => c.list_name === listName);

  function addChoice() {
    const nextId = `c_inline_${Date.now()}_${choices.length + 1}`;
    const newChoice: ChoiceRow = {
      rowId: nextId,
      list_name: listName!,
      name: '',
      labels: {},
      extras: {},
    };
    props.patch({ ...props.form, choices: [...props.form.choices, newChoice] });
  }

  function updateChoice(rowId: string, updater: (c: ChoiceRow) => ChoiceRow) {
    props.patch({
      ...props.form,
      choices: props.form.choices.map((c) => (c.rowId === rowId ? updater(c) : c)),
    });
  }

  function removeChoice(rowId: string) {
    const choice = props.form.choices.find((c) => c.rowId === rowId);
    if (!window.confirm(`Delete option "${choice?.name || rowId}" from list "${listName}"?`)) return;
    props.patch({ ...props.form, choices: props.form.choices.filter((c) => c.rowId !== rowId) });
  }

  function moveChoice(rowId: string, direction: -1 | 1) {
    const idx = props.form.choices.findIndex((c) => c.rowId === rowId);
    if (idx < 0) return;
    // Only allow swap within the same list to keep grouping stable on disk.
    const target = idx + direction;
    if (target < 0 || target >= props.form.choices.length) return;
    if (props.form.choices[target]?.list_name !== listName) return;
    const next = [...props.form.choices];
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    props.patch({ ...props.form, choices: next });
  }

  /**
   * Token-aware list rename: rewrite this row's `type` cell via
   * renameListInType (preserving trailing tokens like `or_other`) and
   * every matching `ChoiceRow.list_name`.
   */
  function commitRename() {
    const target = renameDraft.trim();
    if (!target || target === listName) {
      setRenaming(false);
      return;
    }
    if (choices.length > 0) {
      const usingRows = props.form.survey.filter((r) =>
        r.type.trim().split(/\s+/)[1] === listName,
      ).length;
      if (
        !window.confirm(
          `Rename "${listName}" → "${target}"? This updates ${usingRows} question${usingRows === 1 ? '' : 's'} and ${choices.length} choice${choices.length === 1 ? '' : 's'}. Undoable until save.`,
        )
      ) {
        return;
      }
    }
    const newType = renameListInType(row!.type, listName!, target);
    props.patch({
      ...props.form,
      survey: props.form.survey.map((r) => (r.rowId === row!.rowId ? { ...r, type: newType } : r)),
      choices: props.form.choices.map((c) =>
        c.list_name === listName ? { ...c, list_name: target } : c,
      ),
    });
    setRenaming(false);
  }

  function reuseExisting(newList: string) {
    const newType = renameListInType(row!.type, listName!, newList);
    props.patch({
      ...props.form,
      survey: props.form.survey.map((r) => (r.rowId === row!.rowId ? { ...r, type: newType } : r)),
    });
  }

  return (
    <div className="inline-choices">
      <div className="inline-choices-head">
        <span className="muted small">choices in</span>
        {renaming ? (
          <>
            <input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
              placeholder="new list name"
            />
            <button className="link" onClick={commitRename}>save</button>
            <button className="link" onClick={() => setRenaming(false)}>cancel</button>
          </>
        ) : (
          <>
            <code>{listName}</code>
            <button
              className="link"
              onClick={() => {
                setRenameDraft(listName!);
                setRenaming(true);
              }}
              title="Rename this list (trailing tokens like or_other are preserved)"
            >
              rename
            </button>
            {otherLists.length > 0 && (
              <select
                className="inline-choices-reuse"
                value=""
                onChange={(e) => {
                  if (e.target.value) reuseExisting(e.target.value);
                  e.target.value = '';
                }}
                title="Switch this question to an existing list"
              >
                <option value="">switch to existing…</option>
                {otherLists.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </div>

      {choices.length === 0 ? (
        <p className="muted small">No options yet. Add one below.</p>
      ) : (
        <div className="inline-choices-table">
          <div className="inline-choices-head-row">
            <span>name</span>
            <span>label::{props.defaultLocale}</span>
            <span />
          </div>
          {choices.map((c) => (
            <div key={c.rowId} className="inline-choice-row">
              <input
                value={c.name}
                onChange={(e) => updateChoice(c.rowId, (x) => ({ ...x, name: e.target.value }))}
                placeholder="yes"
              />
              <input
                value={c.labels[props.defaultLocale] ?? ''}
                onChange={(e) =>
                  updateChoice(c.rowId, (x) => ({
                    ...x,
                    labels: { ...x.labels, [props.defaultLocale]: e.target.value },
                  }))
                }
                placeholder="Yes"
              />
              <div className="inline-choice-actions">
                <button
                  className="link"
                  onClick={() => moveChoice(c.rowId, -1)}
                  aria-label="move up"
                >
                  ↑
                </button>
                <button
                  className="link"
                  onClick={() => moveChoice(c.rowId, 1)}
                  aria-label="move down"
                >
                  ↓
                </button>
                <button
                  className="link danger"
                  onClick={() => removeChoice(c.rowId)}
                  aria-label="remove"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="inline-choices-foot">
        <button className="link" onClick={addChoice}>
          + Add option
        </button>
        <span className="muted small">
          Edits sync with the Choices tab. Other locales are still editable there.
        </span>
      </div>
    </div>
  );
}
