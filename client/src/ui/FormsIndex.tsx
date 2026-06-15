import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp, type FormListEntry } from '../state/store.js';

export function FormsIndex() {
  const forms = useApp((s) => s.forms);
  const setForms = useApp((s) => s.setForms);
  const setView = useApp((s) => s.setView);
  const setError = useApp((s) => s.setError);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<{
    category: 'app' | 'contact';
    basename: string;
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

  async function doCreate() {
    if (!creating) return;
    if (!/^[a-zA-Z0-9_-]+$/.test(creating.basename)) {
      setError('Form name must be alphanumeric (plus _ -).');
      return;
    }
    try {
      const res = await api.createForm(creating.category, creating.basename, creating.scaffold);
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
          <button onClick={() => setCreating({ category: 'app', basename: '', scaffold: 'default' })}>+ App form</button>
          <button onClick={() => setCreating({ category: 'contact', basename: '', scaffold: 'default' })}>
            + Contact form
          </button>
          <button className="link" onClick={() => void reload()} disabled={loading}>
            {loading ? 'reloading…' : 'reload'}
          </button>
        </div>
      </header>

      {creating && (
        <div className="card create-form">
          <label>New {creating.category} form name (alphanumeric, _, -)</label>
          <div className="row">
            <input
              autoFocus
              value={creating.basename}
              onChange={(e) =>
                setCreating(creating ? { ...creating, basename: e.target.value } : null)
              }
              placeholder={creating.category === 'app' ? 'pregnancy_visit' : 'c80_household-create'}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doCreate();
                if (e.key === 'Escape') setCreating(null);
              }}
            />
            <button onClick={() => void doCreate()} disabled={!creating.basename}>
              Create
            </button>
            <button className="link" onClick={() => setCreating(null)}>
              cancel
            </button>
          </div>
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
                onChange={() =>
                  setCreating(creating ? { ...creating, scaffold: 'default' } : null)
                }
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
                onChange={() =>
                  setCreating(creating ? { ...creating, scaffold: 'blank' } : null)
                }
              />
              <span>
                <strong>Blank form</strong>{' '}
                <span className="muted small">— empty survey, no rows</span>
              </span>
            </label>
          </fieldset>
        </div>
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
