/**
 * Module-singleton "Deleted X — [Undo]" toast.
 *
 * Pattern: anywhere in the app can call `showUndoToast({ message, onUndo })`
 * and a small floating banner appears in the bottom-right for 6s with an
 * Undo button. Multiple toasts stack. Auto-dismiss timer resets if the
 * user hovers — they shouldn't lose the affordance while reading.
 *
 * Why module-singleton instead of context: keeps `showUndoToast` callable
 * from non-component code (validators, hierarchies, etc.) without
 * threading a provider through every editor. The `UndoToastHost`
 * subscribes once at app root.
 */
import { useEffect, useState } from 'react';

export interface UndoToastSpec {
  /** What was just done. e.g. 'Deleted "fever_duration"'. */
  message: string;
  /** Called when the user clicks Undo. */
  onUndo: () => void;
  /** Auto-dismiss after this many ms. Default 6000. */
  durationMs?: number;
}

interface ActiveToast extends UndoToastSpec {
  id: number;
  fadingOut: boolean;
}

type Listener = (toasts: ActiveToast[]) => void;

const listeners = new Set<Listener>();
let queue: ActiveToast[] = [];
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function notify() {
  for (const fn of listeners) fn(queue);
}

function scheduleDismiss(id: number, ms: number) {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    // Mark fading; remove a tick later so the CSS transition can play.
    queue = queue.map((q) => (q.id === id ? { ...q, fadingOut: true } : q));
    notify();
    setTimeout(() => {
      queue = queue.filter((q) => q.id !== id);
      timers.delete(id);
      notify();
    }, 200);
  }, ms);
  timers.set(id, t);
}

/**
 * Public API. Pushes a toast onto the global queue.
 * Returns the toast id so callers can dismiss it themselves if needed.
 */
export function showUndoToast(spec: UndoToastSpec): number {
  const id = nextId++;
  const duration = spec.durationMs ?? 6000;
  queue = [...queue, { ...spec, id, fadingOut: false }];
  notify();
  scheduleDismiss(id, duration);
  return id;
}

/** Mount this once at app root. */
export function UndoToastHost() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  useEffect(() => {
    listeners.add(setToasts);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);

  function fireUndo(t: ActiveToast) {
    try {
      t.onUndo();
    } finally {
      const tm = timers.get(t.id);
      if (tm) clearTimeout(tm);
      timers.delete(t.id);
      queue = queue.filter((q) => q.id !== t.id);
      notify();
    }
  }

  function dismiss(t: ActiveToast) {
    const tm = timers.get(t.id);
    if (tm) clearTimeout(tm);
    timers.delete(t.id);
    queue = queue.filter((q) => q.id !== t.id);
    notify();
  }

  function pauseDismiss(t: ActiveToast) {
    const tm = timers.get(t.id);
    if (tm) clearTimeout(tm);
  }
  function resumeDismiss(t: ActiveToast) {
    scheduleDismiss(t.id, t.durationMs ?? 6000);
  }

  // Global Escape dismisses the most recent toast. Important keyboard-a11y
  // path — without it, the only way to remove a toast was the mouse hover/leave
  // dance + 6s wait, or clicking Undo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (queue.length === 0) return;
      const last = queue[queue.length - 1];
      if (last) dismiss(last);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (toasts.length === 0) return null;
  return (
    // aria-live="assertive" — destructive ops should interrupt; a quiet
    // "polite" announcement is wrong for "you just deleted something."
    <div className="undo-toast-host" role="alert" aria-live="assertive" aria-atomic="true">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`undo-toast${t.fadingOut ? ' fading' : ''}`}
          onMouseEnter={() => pauseDismiss(t)}
          onMouseLeave={() => resumeDismiss(t)}
          onFocus={() => pauseDismiss(t)}
          onBlur={() => resumeDismiss(t)}
        >
          <span className="undo-toast-msg">{t.message}</span>
          <button
            className="link"
            onClick={() => fireUndo(t)}
            aria-label={`Undo: ${t.message}`}
          >
            Undo
          </button>
          <button
            className="link"
            onClick={() => dismiss(t)}
            aria-label="Dismiss"
            title="Dismiss (Esc)"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
