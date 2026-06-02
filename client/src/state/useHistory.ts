/**
 * Generic per-resource undo / redo history hook.
 *
 * Lifted out of FormEditor so HierarchyEditor, TasksEditor and any future
 * editor get the same Ctrl+Z behavior without re-implementing the stack.
 *
 * Contract:
 *   - `current` is the latest snapshot (T | null while loading).
 *   - `patch(next)` replaces current, truncates redo branch, appends.
 *   - History is capped (default 50) — overflow drops oldest.
 *   - `reset(value)` seeds history with `value` (used on load + after save).
 *   - `canUndo`/`canRedo` drive button disabled state.
 *   - Ctrl+Z / Cmd+Z = undo, Ctrl+Shift+Z / Cmd+Y = redo. Bindings are
 *     enabled by passing `enableKeyboard: true`; key events fired while
 *     focus is inside an INPUT/TEXTAREA/SELECT fall through to native undo
 *     so the user can edit text without fighting the global handler.
 *
 * Snapshots are stored by reference. The caller is responsible for
 * passing immutable updates (`patch({...form, survey: [...]})`) — same
 * convention every callsite already uses.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseHistoryOptions {
  /** Max snapshots retained. Older snapshots drop when exceeded. */
  cap?: number;
  /** Wire Ctrl+Z / Ctrl+Shift+Z to undo/redo. Default true. */
  enableKeyboard?: boolean;
  /** Fired after a successful undo (not after patch). Useful for setDirty. */
  onUndo?: () => void;
  /** Fired after a successful redo. */
  onRedo?: () => void;
}

export interface UseHistory<T> {
  current: T | null;
  patch: (next: T) => void;
  /** Replace the entire history with a single snapshot. Used on load + post-save. */
  reset: (value: T | null) => void;
  undo: () => void;
  redo: () => void;
  /**
   * Snapshot id of the *current* state. Capture this BEFORE a destructive
   * patch and pass to `jumpTo()` later for "undo specifically this action"
   * semantics — critical for toast Undo which can fire seconds after the
   * user made other edits.
   */
  currentSnapshotId: number;
  /** Jump back to a previously-captured snapshot id. No-op if not in history. */
  jumpTo: (snapshotId: number) => void;
  canUndo: boolean;
  canRedo: boolean;
}

const DEFAULT_CAP = 50;

interface Snapshot<T> {
  id: number;
  value: T;
}

export function useHistory<T>(options: UseHistoryOptions = {}): UseHistory<T> {
  const cap = options.cap ?? DEFAULT_CAP;
  const enableKeyboard = options.enableKeyboard !== false;
  const [history, setHistory] = useState<Snapshot<T>[]>([]);
  const [idx, setIdx] = useState(-1);
  // Snapshot ids are monotonic and stable across truncation — callers can
  // capture an id and trust `jumpTo` will find it (or no-op if rolled past).
  const nextIdRef = useRef(1);

  const historyRef = useRef(history);
  const idxRef = useRef(idx);
  historyRef.current = history;
  idxRef.current = idx;
  const onUndoRef = useRef(options.onUndo);
  const onRedoRef = useRef(options.onRedo);
  onUndoRef.current = options.onUndo;
  onRedoRef.current = options.onRedo;

  const patch = useCallback(
    (next: T) => {
      const prev = historyRef.current;
      const at = idxRef.current;
      const truncated = prev.slice(0, at + 1);
      const snapshot: Snapshot<T> = { id: nextIdRef.current++, value: next };
      const appended = [...truncated, snapshot];
      const trimmed = appended.length > cap ? appended.slice(appended.length - cap) : appended;
      setHistory(trimmed);
      setIdx(trimmed.length - 1);
    },
    [cap],
  );

  const reset = useCallback((value: T | null) => {
    if (value === null) {
      setHistory([]);
      setIdx(-1);
    } else {
      const snapshot: Snapshot<T> = { id: nextIdRef.current++, value };
      setHistory([snapshot]);
      setIdx(0);
    }
  }, []);

  const undo = useCallback(() => {
    const at = idxRef.current;
    if (at <= 0) return;
    setIdx(at - 1);
    onUndoRef.current?.();
  }, []);

  const redo = useCallback(() => {
    const prev = historyRef.current;
    const at = idxRef.current;
    if (at >= prev.length - 1) return;
    setIdx(at + 1);
    onRedoRef.current?.();
  }, []);

  /**
   * Jump to a captured snapshot id. Critical for toast Undo: when the user
   * deletes a row, we capture id N (the state BEFORE the delete patch),
   * fire the toast, and pass `() => jumpTo(N)` as onUndo. Even if the user
   * makes 3 more edits before clicking Undo, we restore the pre-delete
   * state — not whatever was current 1 step ago.
   */
  const jumpTo = useCallback((snapshotId: number) => {
    const prev = historyRef.current;
    const targetIdx = prev.findIndex((s) => s.id === snapshotId);
    if (targetIdx < 0) return; // snapshot rolled off the cap or never existed
    setIdx(targetIdx);
    onUndoRef.current?.();
  }, []);

  useEffect(() => {
    if (!enableKeyboard) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // Don't hijack Ctrl+Z while user is typing inside a text control —
      // native input undo is what they want there. Also skip
      // contentEditable surfaces (rule builders may use them).
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (!e.shiftKey && key === 'z') {
        e.preventDefault();
        undo();
      } else if ((e.shiftKey && key === 'z') || key === 'y') {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enableKeyboard, undo, redo]);

  const currentSnapshot = idx >= 0 && idx < history.length ? history[idx] : null;
  return {
    current: currentSnapshot?.value ?? null,
    patch,
    reset,
    undo,
    redo,
    currentSnapshotId: currentSnapshot?.id ?? -1,
    jumpTo,
    canUndo: idx > 0,
    canRedo: idx >= 0 && idx < history.length - 1,
  };
}
