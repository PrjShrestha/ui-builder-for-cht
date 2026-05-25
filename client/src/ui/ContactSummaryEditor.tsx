/**
 * Contact Summary editor (P1C-bis).
 *
 * Renders the `context: { ... }` flags from contact-summary.templated.js
 * as editable cards. Each card has: name + a code expression. Save uses
 * the shared serializer to splice the new flags into the original file
 * at the original byte range — fields[] and cards[] are preserved
 * verbatim.
 *
 * Falls back to raw code editor if the file doesn't contain a parseable
 * context object.
 */
import { useEffect, useState } from 'react';
import {
  parseContactSummary,
  serializeContactSummary,
  parseHelpers,
  patchHelper,
  removeHelper,
  type ParsedContactSummary,
} from '@cht-ui/shared';
import { api } from '../api.js';
import { useApp } from '../state/store.js';
import { AppliesIfBuilder, type ContactFormFields } from './AppliesIfBuilder.js';
import { useContactFormFields } from './useContactFormFields.js';

type CSFile = 'contact-summary.templated.js' | 'contact-summary.extras.js';

interface CSState {
  raw: Record<CSFile, string | null>;
  parsed: ParsedContactSummary | null;
  flags: Record<string, string>;
  order: string[];
}

export function ContactSummaryEditor() {
  const setError = useApp((s) => s.setError);
  const setDirty = useApp((s) => s.setDirty);
  const setSaving = useApp((s) => s.setSaving);
  const dirty = useApp((s) => s.dirty['contact-summary'] ?? false);
  const saving = useApp((s) => s.saving['contact-summary'] ?? false);

  const [state, setState] = useState<CSState | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'structured' | 'helpers' | 'raw'>('structured');
  const [activeRaw, setActiveRaw] = useState<CSFile>('contact-summary.templated.js');
  const [editingHelper, setEditingHelper] = useState<string | null>(null);
  const contactForms = useContactFormFields();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getContactSummaryFiles()
      .then((res) => {
        if (!alive) return;
        const templated = res['contact-summary.templated.js'] ?? '';
        const parsed = templated ? parseContactSummary(templated) : null;
        setState({
          raw: res,
          parsed,
          flags: { ...(parsed?.contextFlags ?? {}) },
          order: [...(parsed?.contextOrder ?? [])],
        });
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
  }, [setError]);

  function patchFlag(name: string, expression: string) {
    if (!state) return;
    setState({ ...state, flags: { ...state.flags, [name]: expression } });
    setDirty('contact-summary', true);
  }
  function renameFlag(oldName: string, newName: string) {
    if (!state || !newName || newName === oldName) return;
    if (state.flags[newName] !== undefined) return;
    const flags = { ...state.flags };
    flags[newName] = flags[oldName] ?? '';
    delete flags[oldName];
    const order = state.order.map((n) => (n === oldName ? newName : n));
    setState({ ...state, flags, order });
    setDirty('contact-summary', true);
  }
  function removeFlag(name: string) {
    if (!state) return;
    const flags = { ...state.flags };
    delete flags[name];
    setState({ ...state, flags, order: state.order.filter((n) => n !== name) });
    setDirty('contact-summary', true);
  }
  function addFlag() {
    if (!state) return;
    let name = window.prompt('New context flag name (e.g. show_pregnancy_form)');
    if (!name) return;
    name = name.trim();
    if (!/^[a-zA-Z_$][\w$]*$/.test(name)) {
      setError('Flag name must be a valid JS identifier.');
      return;
    }
    if (state.flags[name] !== undefined) {
      setError('That flag already exists.');
      return;
    }
    const flags = { ...state.flags, [name]: 'function () {\n  return true;\n}' };
    setState({ ...state, flags, order: [...state.order, name] });
    setDirty('contact-summary', true);
  }
  function patchRaw(file: CSFile, content: string) {
    if (!state) return;
    const nextRaw = { ...state.raw, [file]: content };
    let parsed = state.parsed;
    let flags = state.flags;
    let order = state.order;
    if (file === 'contact-summary.templated.js') {
      parsed = parseContactSummary(content);
      flags = { ...parsed.contextFlags };
      order = [...parsed.contextOrder];
    }
    setState({ raw: nextRaw, parsed, flags, order });
    setDirty('contact-summary', true);
  }

  async function save() {
    if (!state) return;
    setSaving('contact-summary', true);
    try {
      // Rebuild contact-summary.templated.js from the parsed object + new flags.
      let templatedOut = state.raw['contact-summary.templated.js'] ?? '';
      if (state.parsed && state.parsed.contextBounds && view === 'structured') {
        templatedOut = serializeContactSummary(state.parsed, state.flags, state.order);
      }
      await api.saveContactSummaryFile('contact-summary.templated.js', templatedOut);
      const extras = state.raw['contact-summary.extras.js'];
      if (extras !== null) await api.saveContactSummaryFile('contact-summary.extras.js', extras);
      setDirty('contact-summary', false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('contact-summary', false);
    }
  }

  if (loading) return <div className="loading">Loading contact summary…</div>;
  if (!state) return <div className="loading">No contact summary data.</div>;

  const hasContext = state.parsed?.contextBounds != null;

  return (
    <div className="cs-editor">
      <header className="page-header">
        <h1>Contact summary</h1>
        <button onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </header>
      <p className="muted">
        Forms reference these flags as <code>summary.X</code> in their <code>properties.json</code>{' '}
        context expression. Editing changes only the <code>context: {'{}'}</code> object;{' '}
        <code>fields</code> and <code>cards</code> stay verbatim.
      </p>
      <div className="tabs">
        <button
          className={view === 'structured' ? 'active' : ''}
          onClick={() => setView('structured')}
        >
          Context flags ({state.order.length})
        </button>
        <button
          className={view === 'helpers' ? 'active' : ''}
          onClick={() => setView('helpers')}
        >
          Helpers (extras.js)
        </button>
        <button className={view === 'raw' ? 'active' : ''} onClick={() => setView('raw')}>
          Raw files
        </button>
      </div>

      {view === 'helpers' && (
        <HelpersTab
          source={state.raw['contact-summary.extras.js'] ?? ''}
          editingName={editingHelper}
          contactForms={contactForms}
          onEditStart={(name) => setEditingHelper(name)}
          onEditEnd={() => setEditingHelper(null)}
          onSaveHelper={(name, newName, newParams, newBody) => {
            const cur = state.raw['contact-summary.extras.js'] ?? '';
            const parsed = parseHelpers(cur);
            const next = patchHelper(parsed, name, newName, newParams, newBody);
            patchRaw('contact-summary.extras.js', next);
            setEditingHelper(null);
          }}
          onRemoveHelper={(name) => {
            const cur = state.raw['contact-summary.extras.js'] ?? '';
            const parsed = parseHelpers(cur);
            const next = removeHelper(parsed, name);
            patchRaw('contact-summary.extras.js', next);
          }}
        />
      )}

      {view === 'structured' && (
        <>
          {!hasContext && (
            <p className="muted">
              Couldn&apos;t find <code>context: {'{...}'}</code> in
              contact-summary.templated.js. Edit raw text in the &quot;Raw files&quot; tab.
            </p>
          )}
          {hasContext && (
            <div className="cs-flags">
              {state.order.map((name) => (
                <FlagCard
                  key={name}
                  name={name}
                  expression={state.flags[name] ?? ''}
                  onChange={(v) => patchFlag(name, v)}
                  onRename={(newName) => renameFlag(name, newName)}
                  onRemove={() => removeFlag(name)}
                />
              ))}
              <button onClick={addFlag}>+ Add flag</button>
            </div>
          )}
        </>
      )}

      {view === 'raw' && (
        <>
          <div className="tabs">
            {(['contact-summary.templated.js', 'contact-summary.extras.js'] as CSFile[]).map((f) => (
              <button
                key={f}
                className={activeRaw === f ? 'active' : ''}
                onClick={() => setActiveRaw(f)}
              >
                {f}
                {state.raw[f] === null && <em className="muted"> (missing)</em>}
              </button>
            ))}
          </div>
          <textarea
            className="code-editor"
            value={state.raw[activeRaw] ?? ''}
            onChange={(e) => patchRaw(activeRaw, e.target.value)}
            spellCheck={false}
          />
        </>
      )}
    </div>
  );
}

function HelpersTab(props: {
  contactForms: ContactFormFields[];
  source: string;
  editingName: string | null;
  onEditStart: (name: string) => void;
  onEditEnd: () => void;
  onSaveHelper: (name: string, newName: string, params: string[], body: string) => void;
  onRemoveHelper: (name: string) => void;
}) {
  const parsed = parseHelpers(props.source);
  const editing = parsed.helpers.find((h) => h.name === props.editingName);

  function addHelper() {
    const name = window.prompt('New helper name (e.g. isEligibleForBackPainSurveillance)');
    if (!name) return;
    if (!/^[a-zA-Z_$][\w$]*$/.test(name)) {
      window.alert('Helper name must be a valid identifier.');
      return;
    }
    if (parsed.helpers.some((h) => h.name === name)) {
      window.alert('A helper with that name already exists.');
      return;
    }
    const params = ['thisContact', 'allReports'];
    const body = '  if (!isPatient(thisContact)) { return false; }\n  return true;';
    props.onSaveHelper(name, name, params, body);
  }

  return (
    <div className="helpers-tab">
      <p className="muted">
        Predicate helpers like <code>isEligibleForBackPainSurveillance</code> live in{' '}
        <code>contact-summary.extras.js</code>. Context flags in the previous tab call these to
        decide which forms to show.
      </p>
      <button onClick={addHelper}>+ New helper</button>
      <div className="helpers-list">
        {parsed.helpers.map((h) => (
          <div key={h.name} className="task-card">
            <header className="row gap">
              <code>{h.name}({h.params.join(', ')})</code>
              <button className="link" onClick={() => props.onEditStart(h.name)}>
                ✎ edit body
              </button>
              <button className="link danger" onClick={() => props.onRemoveHelper(h.name)}>
                delete
              </button>
            </header>
            <details>
              <summary className="muted">View body</summary>
              <pre className="small">{h.body}</pre>
            </details>
          </div>
        ))}
        {parsed.helpers.length === 0 && (
          <p className="muted">No helpers detected. Use &quot;+ New helper&quot; to add one.</p>
        )}
      </div>

      {editing && (
        <AppliesIfBuilder
          title={`Edit ${editing.name}(${editing.params.join(', ')})`}
          value={`function (${editing.params.join(', ')}) {${editing.body}}`}
          contactForms={props.contactForms}
          onCancel={props.onEditEnd}
          onSave={(updated) => {
            // The builder serialises as `function (params) { body }` — extract body.
            const m = /^function\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/.exec(updated.trim());
            const body = m && m[1] !== undefined ? m[1] : updated;
            props.onSaveHelper(editing.name, editing.name, editing.params, body);
          }}
        />
      )}
    </div>
  );
}

function FlagCard(props: {
  name: string;
  expression: string;
  onChange: (v: string) => void;
  onRename: (newName: string) => void;
  onRemove: () => void;
}) {
  const [nameDraft, setNameDraft] = useState(props.name);
  useEffect(() => setNameDraft(props.name), [props.name]);
  return (
    <div className="task-card">
      <header className="row gap">
        <code>summary.</code>
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            if (nameDraft !== props.name) props.onRename(nameDraft);
          }}
          className="name-input"
        />
        <button className="link danger" onClick={props.onRemove}>
          delete
        </button>
      </header>
      <textarea
        className="code-editor short"
        value={props.expression}
        onChange={(e) => props.onChange(e.target.value)}
        spellCheck={false}
        placeholder={'function () { return true; }'}
      />
    </div>
  );
}
