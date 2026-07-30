/**
 * Wave 2 · §5 — "insert field" / "insert contact field" affordance next to
 * each label input in the survey-row card.
 *
 * Two picker sections in one popover so a label input needs only one visual
 * affordance:
 *
 *   1. **Fields in this form** — earlier-in-form field names (the same list
 *      the row card already computes as `earlierFields` / `fieldOptions`).
 *      Picking one splices `${<name>}` at the caret in the label input.
 *
 *   2. **Contact fields** — contact-form field names surfaced via
 *      `useContactFormFields`. Picking one delegates to the caller's
 *      `onInsertContactField(field)` callback, which is responsible for
 *      calling `insertContactFieldRef` (idempotently adds a hidden harvest
 *      `calculate` row) and splicing `${<harvestName>}` at the caret. The
 *      auto-created harvest row and the label mutation MUST land in a single
 *      form-level patch so undo restores both halves together.
 *
 * The picker mirrors the caret-splice pattern from `InsertFieldButton.tsx`
 * (~lines 43-49) — the host owns the input `<ref>` and passes the current
 * `selectionStart` at open time. The popover closes after a pick.
 *
 * Design notes (docs/handoff-waves-1-3-2026-07-29.md §5):
 *   - Idempotency for contact-field: re-picking the same field creates
 *     ZERO additional rows (deduplication lives in `insertContactFieldRef`).
 *   - Empty state for contact fields: "No contact fields available."
 *   - The button is compact so it doesn't dominate the label row.
 */
import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Earlier-in-form field names available for §5a `${field}` insert.
   *  Same list `SurveyRowCard` already computes via `earlierFields`. */
  fieldOptions: string[];
  /** Contact-form field names available for §5b insert. Empty → the
   *  contact-fields section renders its "No contact fields available."
   *  empty state (idempotency-safe: the picker still opens). */
  contactFields: string[];
  /** Splice `${name}` into the host label at the tracked caret. */
  onInsertField: (name: string) => void;
  /** Splice a contact-field harvest reference into the host label at the
   *  tracked caret. The host is responsible for the `insertContactFieldRef`
   *  call + the atomic form patch. */
  onInsertContactField: (field: string) => void;
}

export function InsertLabelRefButton(props: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape. Mirrors the modal-overlay dismiss
  // ergonomics of `InsertFieldButton` without stealing focus with a full
  // modal (we're rendered inline on every label row).
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="label-insert-ref"
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <button
        type="button"
        className="link small"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Insert a field reference into this label"
      >
        + insert
      </button>
      {open && (
        <div
          className="label-insert-ref-menu"
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 20,
            minWidth: '18rem',
            maxHeight: '20rem',
            overflowY: 'auto',
            background: 'var(--surface, #fff)',
            border: '1px solid var(--border, #ccc)',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
            padding: '0.5rem',
          }}
        >
          <section className="label-insert-ref-section">
            <header
              className="muted small"
              style={{ padding: '0.25rem 0.5rem', fontWeight: 600 }}
            >
              Fields in this form
            </header>
            {props.fieldOptions.length === 0 ? (
              <p className="muted small" style={{ padding: '0.25rem 0.5rem' }}>
                No earlier fields to reference.
              </p>
            ) : (
              <ul
                className="label-insert-ref-list"
                style={{ listStyle: 'none', margin: 0, padding: 0 }}
              >
                {props.fieldOptions.map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      role="menuitem"
                      className="link"
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '0.25rem 0.5rem',
                      }}
                      onClick={() => {
                        setOpen(false);
                        props.onInsertField(name);
                      }}
                      title={`Insert \${${name}} at cursor`}
                    >
                      <code>{`\${${name}}`}</code>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <hr style={{ margin: '0.5rem 0', border: 'none', borderTop: '1px solid var(--border, #eee)' }} />
          <section className="label-insert-ref-section">
            <header
              className="muted small"
              style={{ padding: '0.25rem 0.5rem', fontWeight: 600 }}
            >
              Contact fields (auto-adds a hidden calculate)
            </header>
            {props.contactFields.length === 0 ? (
              <p className="muted small" style={{ padding: '0.25rem 0.5rem' }}>
                No contact fields available.
              </p>
            ) : (
              <ul
                className="label-insert-ref-list"
                style={{ listStyle: 'none', margin: 0, padding: 0 }}
              >
                {props.contactFields.map((field) => (
                  <li key={field}>
                    <button
                      type="button"
                      role="menuitem"
                      className="link"
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '0.25rem 0.5rem',
                      }}
                      onClick={() => {
                        setOpen(false);
                        props.onInsertContactField(field);
                      }}
                      title={`Insert contact field "${field}" (auto-creates a hidden harvest calculate)`}
                    >
                      <span>{field}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
