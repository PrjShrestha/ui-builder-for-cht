import { useEffect, useMemo, useState } from 'react';
import { deriveFormName } from '@cht-ui/shared';
import { api } from '../api.js';
import { useApp, type FormListEntry } from '../state/store.js';

export function FormsIndex() {
  const forms = useApp((s) => s.forms);
  const setForms = useApp((s) => s.setForms);
  const setView = useApp((s) => s.setView);
  const setError = useApp((s) => s.setError);
  const [loading, setLoading] = useState(false);
  // Onboarding §5 — when contact_types is empty, surface a non-blocking
  // nudge above the form lists so the author knows their `select-contact
  // type-X` / lineage / task `appliesToType` references will have no
  // types to bind to. Guide, don't gate (a fresh project can still build
  // forms — CHT just falls back to the legacy default hierarchy).
  const [contactTypesCount, setContactTypesCount] = useState<number | null>(null);
  const [creating, setCreating] = useState<{
    category: 'app' | 'contact';
    /**
     * Human-facing title the user types. Was previously called `basename`
     * and forced to be an identifier — the field-notes handoff
     * (2026-07-29) flagged this as the cold-start wall. Now we collect
     * the friendly title; the filename basename is derived via
     * `deriveFormName` and shown as a muted "saved as …" hint.
     */
    title: string;
    /** §B3 — `'default'` seeds the inputs scaffold; `'blank'` is the
     *  escape hatch for a power user starting from scratch. */
    scaffold: 'default' | 'blank';
  } | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const res = await api.listForms();
      setForms(res.forms);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    void api
      .getHierarchy()
      .then((h) => {
        if (alive) setContactTypesCount(h.contact_types.length);
      })
      .catch(() => {
        if (alive) setContactTypesCount(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function doCreate() {
    if (!creating) return;
    const title = creating.title.trim();
    if (title === '') {
      setError('Please enter a form name.');
      return;
    }
    // Derive locally for the pre-flight check so the user gets an
    // inline error instead of a 400 round-trip; the server also derives
    // defensively (see forms.ts create route). Contact forms preserve
    // hyphens — the on-disk contract is `<type>-create.xlsx` (audit P0-2).
    const existing = forms
      .filter((f) => f.category === creating.category)
      .map((f) => f.filename.replace(/\.xlsx$/i, ''));
    const { basename } = deriveFormName(title, existing, {
      allowHyphens: creating.category === 'contact',
    });
    if (basename === '') {
      setError(
        'That name has no ASCII letters to derive a filename from. Try adding a Latin word (e.g. add "ANC" or "visit").',
      );
      return;
    }
    try {
      const res = await api.createForm(creating.category, basename, creating.scaffold, {
        title,
      });
      setCreating(null);
      await reload();
      setView({ kind: 'form', id: res.id });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function doDelete(id: string) {
    const ok = window.confirm(`Delete form ${id}? This removes .xlsx, .xml, and .properties.json.`);
    if (!ok) return;
    try {
      await api.deleteForm(id);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const appForms = forms.filter((f) => f.category === 'app');
  const contactForms = forms.filter((f) => f.category === 'contact');

  return (
    <div className="forms-index">
      <header className="page-header">
        <h1>Forms</h1>
        <div className="row gap">
          <button onClick={() => setCreating({ category: 'app', title: '', scaffold: 'default' })}>+ App form</button>
          <button onClick={() => setCreating({ category: 'contact', title: '', scaffold: 'default' })}>
            + Contact form
          </button>
          <button className="link" onClick={() => void reload()} disabled={loading}>
            {loading ? 'reloading…' : 'reload'}
          </button>
        </div>
      </header>

      {/* Onboarding §5 — non-blocking empty-contact_types nudge. Shown
          only when the hierarchy fetch resolved with zero types (null =
          unknown, treated as silent). The author can still build forms;
          this surfaces the silent failure mode (select-contact / lineage
          / tasks bind to undefined types) before they hit it at runtime. */}
      {contactTypesCount === 0 && (
        <div className="onboarding-nudge">
          <strong>⚠ No contact types defined yet</strong>
          <p>
            Your contact selectors (<code>select-contact type-X</code>), lineage blocks, and
            task <code>appliesToType</code> rules have no types to bind to — these will
            <strong> silently fail</strong> at runtime, not at build/deploy.
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => setView({ kind: 'hierarchy' })}
          >
            Define your hierarchy first →
          </button>
        </div>
      )}

      {creating && (
        <CreateFormDialog
          creating={creating}
          forms={forms}
          onChange={(next) => setCreating(next)}
          onSubmit={() => void doCreate()}
          onCancel={() => setCreating(null)}
        />
      )}
      <section>
        <h2>App forms ({appForms.length})</h2>
        <FormTable forms={appForms} onOpen={(id) => setView({ kind: 'form', id })} onDelete={(id) => void doDelete(id)} onFlowchart={(id) => setView({ kind: 'flowchart', id })} />
      </section>
      <section>
        <h2>Contact forms ({contactForms.length})</h2>
        <FormTable forms={contactForms} onOpen={(id) => setView({ kind: 'form', id })} onDelete={(id) => void doDelete(id)} onFlowchart={(id) => setView({ kind: 'flowchart', id })} />
      </section>
    </div>
  );
}

/**
 * New-form dialog — label-first. User types a friendly title
 * ("Patient Age"); the filename basename is derived via
 * `deriveFormName` (slugify + numeric-suffix on collision) and shown as
 * a muted "saved as `patient_age`" hint. Blocks submission when the
 * title has no ASCII letters to derive from (pure Devanagari/CJK, etc.)
 * — the caller falls back to the user typing an explicit Latin word.
 *
 * Handoff: docs/handoff-improvement-notes-2026-07-29.md §Note 1.
 */
function CreateFormDialog(props: {
  creating: {
    category: 'app' | 'contact';
    title: string;
    scaffold: 'default' | 'blank';
  };
  forms: FormListEntry[];
  onChange: (next: {
    category: 'app' | 'contact';
    title: string;
    scaffold: 'default' | 'blank';
  }) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { creating, forms, onChange, onSubmit, onCancel } = props;
  const existing = useMemo(
    () =>
      forms
        .filter((f) => f.category === creating.category)
        .map((f) => f.filename.replace(/\.xlsx$/i, '')),
    [forms, creating.category],
  );
  const derived = useMemo(
    () =>
      deriveFormName(creating.title, existing, {
        allowHyphens: creating.category === 'contact',
      }),
    [creating.title, existing, creating.category],
  );
  const trimmed = creating.title.trim();
  const canSubmit = trimmed !== '' && derived.basename !== '';
  return (
    <div className="card create-form">
      <label htmlFor="new-form-title">
        New {creating.category} form title
      </label>
      <div className="row">
        <input
          id="new-form-title"
          autoFocus
          value={creating.title}
          onChange={(e) => onChange({ ...creating, title: e.target.value })}
          placeholder={
            creating.category === 'app' ? 'Pregnancy visit' : 'Household — create'
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) onSubmit();
            if (e.key === 'Escape') onCancel();
          }}
        />
        <button onClick={onSubmit} disabled={!canSubmit}>
          Create
        </button>
        <button className="link" onClick={onCancel}>
          cancel
        </button>
      </div>
      {trimmed !== '' && derived.basename !== '' && (
        <div className="muted small">
          Saved as <code>{derived.basename}</code>
          {derived.collided && (
            // Audit item 15 — print the COLLIDING SLUG, not the typed
            // title: "Patient age" collides with `patient_age.xlsx` even
            // when no form was ever titled "Patient age".
            <> — a form file named <code>{derived.slug}</code> already exists, so the
            filename gets a numeric suffix.</>
          )}
        </div>
      )}
      {trimmed !== '' && derived.basename === '' && (
        <div className="rule-row-warning">
          <strong>No ASCII letters to derive a filename from.</strong> Add a Latin
          word (e.g. "ANC" or "visit") so the tool can build a valid
          filename.
        </div>
      )}
      {/* §B3 — scaffold choice. Default seeds the canonical inputs
          plumbing (B1) for app forms or the contact-type group (B2)
          for contact forms; "Blank" is the escape hatch for a power
          user starting from scratch. */}
      <fieldset className="create-form-scaffold">
        <legend className="muted small">Start from</legend>
        <label className="row gap" style={{ alignItems: 'center' }}>
          <input
            type="radio"
            name="scaffold"
            value="default"
            checked={creating.scaffold === 'default'}
            onChange={() => onChange({ ...creating, scaffold: 'default' })}
          />
          <span>
            <strong>Default scaffold</strong>{' '}
            <span className="muted small">
              {creating.category === 'app'
                ? '— inputs/user/contact plumbing + patient linking calculates'
                : '— person contact-type group with parent + contact_type plumbing'}
            </span>
          </span>
        </label>
        <label className="row gap" style={{ alignItems: 'center' }}>
          <input
            type="radio"
            name="scaffold"
            value="blank"
            checked={creating.scaffold === 'blank'}
            onChange={() => onChange({ ...creating, scaffold: 'blank' })}
          />
          <span>
            <strong>Blank form</strong>{' '}
            <span className="muted small">— empty survey, no rows</span>
          </span>
        </label>
      </fieldset>
    </div>
  );
}

function FormTable(props: {
  forms: FormListEntry[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onFlowchart: (id: string) => void;
}) {
  if (props.forms.length === 0) return <p className="muted">None.</p>;
  return (
    <table className="form-table">
      <thead>
        <tr>
          <th>Filename</th>
          <th>.properties.json</th>
          <th>.xml</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {props.forms.map((f) => (
          <tr key={f.id}>
            <td>
              <button className="link" onClick={() => props.onOpen(f.id)}>
                {f.filename}
              </button>
            </td>
            <td>{f.hasProperties ? '✓' : '—'}</td>
            <td>{f.hasXml ? '✓' : '—'}</td>
            <td className="row gap">
              <button className="link" onClick={() => props.onFlowchart(f.id)}>
                flowchart
              </button>
              <button className="link danger" onClick={() => props.onDelete(f.id)}>
                delete
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
