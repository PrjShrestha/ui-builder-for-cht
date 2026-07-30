/**
 * Contact Summary editor (P1C-bis).
 *
 * Renders the `context: { ... }` flags from contact-summary.templated.js
 * as editable cards. Each card has: name + a code expression. Save uses
 * the shared serializer to splice the new flags into the original file
 * at the original byte range — fields[] and cards[] are preserved
 * verbatim.
 *
 * The "Cards" tab layers on top of the same file: it lifts the
 * `cards = [ ... ]` array into structured entries (label + appliesToType
 * + [{label, value}] fields). Anything the parser can't lift (imperative
 * `fields: function () { ... }`, `modifyContext`, unrecognized props)
 * stays as a RawCard rendered read-only. Save splices the rewritten
 * cards array back into the file via `spliceCards` — every byte outside
 * the array literal is preserved.
 *
 * Falls back to raw code editor if the file doesn't contain a parseable
 * context object.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  emitContextValueBridge,
  parseContactSummary,
  recognizeContextValueBridge,
  serializeContactSummary,
  parseHelpers,
  patchHelper,
  removeHelper,
  parseCards,
  spliceCards,
  findCardsArrayBounds,
  type Card,
  type CardField,
  type ContextValueBridge,
  type ParsedCards,
  type ParsedContactSummary,
  type RawCard,
} from '@cht-ui/shared';
import { api } from '../api.js';
import { useApp } from '../state/store.js';
import { AppliesIfBuilder, type ContactFormFields } from './AppliesIfBuilder.js';
import { FieldPicker } from './FieldPicker.js';
import { ReportFieldPicker } from './ReportFieldPicker.js';
import { useContactFormFields } from './useContactFormFields.js';
import { invalidateContactSummaryContextKeys } from './useContactSummaryContextKeys.js';

type CSFile = 'contact-summary.templated.js' | 'contact-summary.extras.js';
/** Sub-tabs inside the Contact Summary editor. `values` = Wave 3 · Note 6
 *  cross-form context-value bridges (populated from another form's latest
 *  report); `structured` = the pre-existing context flags. */
type CSView = 'structured' | 'values' | 'cards' | 'helpers' | 'raw';

interface CSState {
  raw: Record<CSFile, string | null>;
  parsed: ParsedContactSummary | null;
  flags: Record<string, string>;
  order: string[];
  parsedCards: ParsedCards | null;
  cards: (Card | RawCard)[];
  cardsDirty: boolean;
  /**
   * True when flags/order have pending edits. Save serializes the
   * context object based on THIS (edit-based), never on which sub-tab
   * happens to be active — the previous view-gated check silently
   * dropped context-value edits when saving from the Cards/Raw tab
   * (audit P0-3).
   */
  contextDirty: boolean;
}

export function ContactSummaryEditor() {
  const setError = useApp((s) => s.setError);
  const setDirty = useApp((s) => s.setDirty);
  const setSaving = useApp((s) => s.setSaving);
  const dirty = useApp((s) => s.dirty['contact-summary'] ?? false);
  const saving = useApp((s) => s.saving['contact-summary'] ?? false);
  const appView = useApp((s) => s.view);
  // Wave 3 · Note 6 — the calc builder's "From another form" empty-state
  // link sets `view.subView = 'values'`, so a form-side jump lands on
  // the Context values tab, not the default flags tab.
  const initialSubView: CSView =
    appView.kind === 'contact-summary' && appView.subView === 'values'
      ? 'values'
      : appView.kind === 'contact-summary' && appView.subView === 'cards'
        ? 'cards'
        : appView.kind === 'contact-summary' && appView.subView === 'helpers'
          ? 'helpers'
          : appView.kind === 'contact-summary' && appView.subView === 'raw'
            ? 'raw'
            : 'structured';

  const [state, setState] = useState<CSState | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<CSView>(initialSubView);
  const [activeRaw, setActiveRaw] = useState<CSFile>('contact-summary.templated.js');
  const [editingHelper, setEditingHelper] = useState<string | null>(null);
  const [contactTypeIds, setContactTypeIds] = useState<string[]>([]);
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
        const parsedCards = templated ? readCardsFromFile(templated) : null;
        setState({
          raw: res,
          parsed,
          flags: { ...(parsed?.contextFlags ?? {}) },
          order: [...(parsed?.contextOrder ?? [])],
          parsedCards,
          cards: parsedCards ? [...parsedCards.cards] : [],
          cardsDirty: false,
          contextDirty: false,
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

  useEffect(() => {
    let alive = true;
    api
      .getHierarchy()
      .then((h) => {
        if (!alive) return;
        const ids = (h.contact_types as Array<{ id: string }>).map((t) => t.id).sort();
        setContactTypeIds(ids);
      })
      .catch(() => {
        /* hierarchy unavailable — picker just accepts free-text types */
      });
    return () => {
      alive = false;
    };
  }, []);

  function patchFlag(name: string, expression: string) {
    if (!state) return;
    setState({ ...state, flags: { ...state.flags, [name]: expression }, contextDirty: true });
    setDirty('contact-summary', true);
  }
  function renameFlag(oldName: string, newName: string) {
    if (!state || !newName || newName === oldName) return;
    // Keys are read as XML node names via `instance('contact-summary')/
    // context/<key>` — a key like `0-latest-visit` compiles but is
    // unreadable on the form side. Gate on the same identifier rule the
    // add path uses (audit P1-8).
    if (!/^[a-zA-Z_$][\w$]*$/.test(newName)) {
      setError(
        `"${newName}" is not a valid context key — use letters/digits/underscore, starting with a letter (form calcs read it as instance('contact-summary')/context/${newName}).`,
      );
      return;
    }
    if (state.flags[newName] !== undefined) return;
    const flags = { ...state.flags };
    flags[newName] = flags[oldName] ?? '';
    delete flags[oldName];
    const order = state.order.map((n) => (n === oldName ? newName : n));
    setState({ ...state, flags, order, contextDirty: true });
    setDirty('contact-summary', true);
  }
  function removeFlag(name: string) {
    if (!state) return;
    const flags = { ...state.flags };
    delete flags[name];
    setState({
      ...state,
      flags,
      order: state.order.filter((n) => n !== name),
      contextDirty: true,
    });
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
    setState({ ...state, flags, order: [...state.order, name], contextDirty: true });
    setDirty('contact-summary', true);
  }
  function patchRaw(file: CSFile, content: string) {
    if (!state) return;
    const nextRaw = { ...state.raw, [file]: content };
    let parsed = state.parsed;
    let flags = state.flags;
    let order = state.order;
    let parsedCards = state.parsedCards;
    let cards = state.cards;
    let cardsDirty = state.cardsDirty;
    let contextDirty = state.contextDirty;
    if (file === 'contact-summary.templated.js') {
      parsed = parseContactSummary(content);
      flags = { ...parsed.contextFlags };
      order = [...parsed.contextOrder];
      // Editing the raw file discards any pending cards working copy — the
      // parsed state is authoritative once the user has typed into raw.
      parsedCards = readCardsFromFile(content);
      cards = parsedCards ? [...parsedCards.cards] : [];
      cardsDirty = false;
      // Flags/order were just re-derived FROM the raw content — there is
      // no pending structured edit to re-serialize on save; the raw bytes
      // themselves are what will be written.
      contextDirty = false;
    }
    setState({ raw: nextRaw, parsed, flags, order, parsedCards, cards, cardsDirty, contextDirty });
    setDirty('contact-summary', true);
  }

  function patchCards(next: (Card | RawCard)[]) {
    if (!state) return;
    setState({ ...state, cards: next, cardsDirty: true });
    setDirty('contact-summary', true);
  }

  async function save() {
    if (!state) return;
    // Bridge validation (audit P1-8): a context value whose source form
    // or field is still unset would serialize an always-undefined scan —
    // "looks configured, reads nothing" on every device. Block the save
    // and point at the offending key instead.
    for (const key of state.order) {
      const bridge = recognizeContextValueBridge(state.flags[key] ?? '');
      if (bridge && (bridge.sourceForm.trim() === '' || bridge.sourceField.trim() === '')) {
        setError(
          `Context value "${key}" has no source ${bridge.sourceForm.trim() === '' ? 'form' : 'field'} yet — pick one in the Context values tab (or delete the row) before saving.`,
        );
        setView('values');
        return;
      }
    }
    setSaving('contact-summary', true);
    try {
      // Compose the templated file by applying the two edits that may be
      // pending: context flags/values and the cards array. Each splice is
      // against the file source directly, so both edits compose cleanly
      // against the same starting bytes even when applied in sequence —
      // `spliceCards` operates on `const cards = [ ... ]` which never
      // overlaps the `context: {...}` object.
      //
      // Gating is EDIT-based (contextDirty / cardsDirty), never based on
      // which sub-tab is active — a view-based gate silently dropped
      // context edits when saving from the Cards/Raw tab (audit P0-3).
      let templatedOut = state.raw['contact-summary.templated.js'] ?? '';
      if (state.parsed && state.parsed.contextBounds && state.contextDirty) {
        templatedOut = serializeContactSummary(state.parsed, state.flags, state.order);
      }
      if (state.parsedCards && state.parsedCards.shape === 'array' && state.cardsDirty) {
        const nextCards: ParsedCards = { ...state.parsedCards, cards: state.cards };
        templatedOut = spliceCards(templatedOut, nextCards);
      }
      await api.saveContactSummaryFile('contact-summary.templated.js', templatedOut);
      const extras = state.raw['contact-summary.extras.js'];
      if (extras !== null) await api.saveContactSummaryFile('contact-summary.extras.js', extras);
      setDirty('contact-summary', false);
      setState({ ...state, cardsDirty: false, contextDirty: false });
      // The calc builder's "From another form" picker caches context keys
      // at module scope — refresh it so a newly defined value shows up
      // without a reload (audit P1-4).
      invalidateContactSummaryContextKeys();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('contact-summary', false);
    }
  }

  /**
   * Add a fresh context-value bridge row to the shared flags map. The
   * new key defaults to a placeholder (`ctx_value_N`) and its value to
   * an empty bridge — the user then picks a source form + field, which
   * triggers `patchBridge` to overwrite the value with the emitted IIFE.
   */
  function addBridgeValue(): void {
    if (!state) return;
    const existing = new Set(state.order);
    let base = 'ctx_value';
    let name = base;
    for (let i = 1; existing.has(name); i++) name = `${base}_${i + 1}`;
    // Seed with an intentionally-invalid-JS placeholder that recognizes
    // as a bridge with EMPTY sourceForm/sourceField. The user MUST pick
    // a source form + field before saving; the empty state is rendered
    // as a picker prompt, not a raw-JS badge.
    const seed = emitContextValueBridge({ sourceForm: '', sourceField: '' });
    setState({
      ...state,
      flags: { ...state.flags, [name]: seed },
      order: [...state.order, name],
      contextDirty: true,
    });
    setDirty('contact-summary', true);
  }

  if (loading) return <div className="loading">Loading contact summary…</div>;
  if (!state) return <div className="loading">No contact summary data.</div>;

  const hasContext = state.parsed?.contextBounds != null;
  // Partition the shared flags map into (bridges, flags) so each sub-tab
  // shows only the shape it edits. The state is one map — sub-tabs are
  // views over it. A key whose value doesn't recognize as a bridge stays
  // in "Context flags" (which retains its raw-JS textarea escape hatch).
  const bridgeKeys: string[] = [];
  const flagKeys: string[] = [];
  for (const key of state.order) {
    const expr = state.flags[key] ?? '';
    if (recognizeContextValueBridge(expr)) bridgeKeys.push(key);
    else flagKeys.push(key);
  }

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
          Context flags ({flagKeys.length})
        </button>
        <button
          className={view === 'values' ? 'active' : ''}
          onClick={() => setView('values')}
          title="Context keys populated from another form's most-recent report"
        >
          Context values ({bridgeKeys.length})
        </button>
        <button
          className={view === 'cards' ? 'active' : ''}
          onClick={() => setView('cards')}
        >
          Cards ({state.parsedCards?.shape === 'array' ? state.cards.length : 'raw'})
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
              {flagKeys.map((name) => (
                <FlagCard
                  key={name}
                  name={name}
                  expression={state.flags[name] ?? ''}
                  onChange={(v) => patchFlag(name, v)}
                  onRename={(newName) => renameFlag(name, newName)}
                  onRemove={() => removeFlag(name)}
                />
              ))}
              {flagKeys.length === 0 && (
                <p className="muted">
                  No context flags defined. Cross-form values live under the
                  &quot;Context values&quot; tab.
                </p>
              )}
              <button onClick={addFlag}>+ Add flag</button>
            </div>
          )}
        </>
      )}

      {view === 'values' && (
        <ContextValuesTab
          hasContext={hasContext}
          bridgeKeys={bridgeKeys}
          flags={state.flags}
          onRename={renameFlag}
          onRemove={removeFlag}
          onPatchBridge={(name, next) =>
            patchFlag(name, emitContextValueBridge(next))
          }
          onAdd={addBridgeValue}
        />
      )}

      {view === 'cards' && (
        <CardsTab
          parsed={state.parsedCards}
          cards={state.cards}
          contactTypeIds={contactTypeIds}
          contactForms={contactForms}
          onChange={patchCards}
        />
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

/**
 * Locate + parse the `cards = [ ... ]` block inside a
 * contact-summary.templated.js source. Returns null when the file has no
 * cards declaration we recognize — the UI then shows a hint pointing at
 * the Raw tab. When the array is present but its contents can't be
 * split (e.g. `.map(...)` generator or spread element), `parseCards`
 * returns `shape: 'raw'`, which the CardsTab renders as a read-only
 * fallback.
 */
function readCardsFromFile(source: string): ParsedCards | null {
  const bounds = findCardsArrayBounds(source);
  if (!bounds) return null;
  const arrayText = source.slice(bounds.start, bounds.end + 1);
  return parseCards(arrayText);
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

/**
 * Cards editor surface. Renders each entry in `cards` as either:
 *   - a `StructuredCardEditor` (label + appliesToType + reorderable
 *     {label,value} field list) when the entry is a Card, or
 *   - a read-only `RawCardBlock` with the verbatim source and a hint
 *     to edit it in the Raw tab, when the entry is a RawCard.
 *
 * When the whole array degraded to raw (`.map(...)` / spread), we show
 * a single fallback block and no "+ Add card" button — offering one
 * would silently drop the generator on save.
 */
function CardsTab(props: {
  parsed: ParsedCards | null;
  cards: (Card | RawCard)[];
  contactTypeIds: string[];
  contactForms: ContactFormFields[];
  onChange: (next: (Card | RawCard)[]) => void;
}) {
  const { parsed, cards, contactTypeIds, contactForms, onChange } = props;

  if (!parsed) {
    return (
      <p className="muted">
        Couldn&apos;t find <code>cards = [...]</code> in contact-summary.templated.js. Edit raw
        text in the &quot;Raw files&quot; tab.
      </p>
    );
  }

  if (parsed.shape === 'raw') {
    return (
      <>
        <p className="muted">
          The <code>cards</code> array uses a generator expression (e.g. <code>.map()</code>) or a
          spread element the editor can&apos;t safely lift. The full expression is preserved on
          save. Edit it in the &quot;Raw files&quot; tab.
        </p>
        <pre className="small">{parsed.raw}</pre>
      </>
    );
  }

  function updateAt(idx: number, next: Card | RawCard) {
    onChange(cards.map((c, i) => (i === idx ? next : c)));
  }
  function removeAt(idx: number) {
    onChange(cards.filter((_, i) => i !== idx));
  }
  function moveCard(idx: number, delta: -1 | 1) {
    const target = idx + delta;
    if (target < 0 || target >= cards.length) return;
    const next = cards.slice();
    const [pulled] = next.splice(idx, 1);
    if (!pulled) return;
    next.splice(target, 0, pulled);
    onChange(next);
  }
  function addCard() {
    const fresh: Card = {
      shape: 'card',
      label: '',
      appliesToType: 'report',
      fields: [],
    };
    onChange([...cards, fresh]);
  }

  return (
    <div className="cs-cards">
      <p className="muted">
        Cards render report-driven summaries on a contact&apos;s profile (e.g. an
        &ldquo;Active pregnancy&rdquo; card). Editable rows show{' '}
        <code>{'{ label, appliesToType, fields: [...] }'}</code>; cards that compute their fields
        with JS code or carry extra keys are preserved verbatim below.
      </p>
      <datalist id="cs-contact-types">
        <option value="report" />
        <option value="person" />
        {contactTypeIds.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <div className="cards-list">
        {cards.map((c, idx) =>
          c.shape === 'card' ? (
            <StructuredCardEditor
              key={idx}
              card={c}
              contactForms={contactForms}
              canMoveUp={idx > 0}
              canMoveDown={idx < cards.length - 1}
              onChange={(next) => updateAt(idx, next)}
              onRemove={() => removeAt(idx)}
              onMoveUp={() => moveCard(idx, -1)}
              onMoveDown={() => moveCard(idx, 1)}
            />
          ) : (
            <RawCardBlock
              key={idx}
              card={c}
              canMoveUp={idx > 0}
              canMoveDown={idx < cards.length - 1}
              onMoveUp={() => moveCard(idx, -1)}
              onMoveDown={() => moveCard(idx, 1)}
              onRemove={() => removeAt(idx)}
            />
          ),
        )}
        <button onClick={addCard}>+ Add card</button>
      </div>
    </div>
  );
}

function StructuredCardEditor(props: {
  card: Card;
  contactForms: ContactFormFields[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (next: Card) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { card, contactForms, canMoveUp, canMoveDown, onChange, onRemove, onMoveUp, onMoveDown } =
    props;

  function patch(patchObj: Partial<Card>) {
    onChange({ ...card, ...patchObj });
  }
  function updateField(idx: number, next: CardField) {
    onChange({ ...card, fields: card.fields.map((f, i) => (i === idx ? next : f)) });
  }
  function removeField(idx: number) {
    onChange({ ...card, fields: card.fields.filter((_, i) => i !== idx) });
  }
  function moveField(idx: number, delta: -1 | 1) {
    const target = idx + delta;
    if (target < 0 || target >= card.fields.length) return;
    const next = card.fields.slice();
    const [pulled] = next.splice(idx, 1);
    if (!pulled) return;
    next.splice(target, 0, pulled);
    onChange({ ...card, fields: next });
  }
  function addField() {
    onChange({ ...card, fields: [...card.fields, { label: '', valueRaw: '' }] });
  }

  return (
    <div className="task-card">
      <header className="row gap">
        <strong>{card.label || '(unnamed card)'}</strong>
        <span className="muted small">appliesToType: {card.appliesToType}</span>
        <span style={{ marginLeft: 'auto' }} />
        <button
          className="link small"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          title="Move up"
        >
          ↑
        </button>
        <button
          className="link small"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          title="Move down"
        >
          ↓
        </button>
        <button className="link danger" onClick={onRemove}>
          delete
        </button>
      </header>
      <label className="expr-field">
        <span className="expr-label">
          <code>label</code>
        </span>
        <input
          value={card.label}
          onChange={(e) => patch({ label: e.target.value })}
          placeholder="contact.profile.pregnancy.active"
        />
      </label>
      <label className="expr-field">
        <span className="expr-label">
          <code>appliesToType</code>
        </span>
        <input
          value={card.appliesToType}
          onChange={(e) => patch({ appliesToType: e.target.value })}
          list="cs-contact-types"
          placeholder="report"
        />
      </label>

      <div className="expr-field">
        <span className="expr-label">
          <code>fields</code>
          <em className="muted"> — rows shown inside the card</em>
        </span>
        <div className="cards-fields-list">
          {card.fields.map((f, idx) => (
            <div key={idx} className="row gap card-field-row">
              <input
                value={f.label}
                onChange={(e) => updateField(idx, { ...f, label: e.target.value })}
                placeholder="label (e.g. Weeks Pregnant)"
                className="card-field-label"
              />
              <span className="muted small">value:</span>
              <FieldPicker
                value={f.valueRaw}
                contactForms={contactForms}
                onChange={(next) => updateField(idx, { ...f, valueRaw: next })}
                placeholder="thisContact.age"
              />
              <button
                className="link small"
                onClick={() => moveField(idx, -1)}
                disabled={idx === 0}
                title="Move up"
              >
                ↑
              </button>
              <button
                className="link small"
                onClick={() => moveField(idx, 1)}
                disabled={idx === card.fields.length - 1}
                title="Move down"
              >
                ↓
              </button>
              <button className="link danger" onClick={() => removeField(idx)}>
                delete
              </button>
            </div>
          ))}
          <button onClick={addField}>+ Add field</button>
        </div>
      </div>
    </div>
  );
}

function RawCardBlock(props: {
  card: RawCard;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const { card, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onRemove } = props;
  const preview = firstMeaningfulLine(card.raw);
  return (
    <div className="task-card raw-card">
      <header className="row gap">
        <strong>{preview}</strong>
        <span className="muted small">preserved verbatim</span>
        <span style={{ marginLeft: 'auto' }} />
        <button className="link small" onClick={onMoveUp} disabled={!canMoveUp} title="Move up">
          ↑
        </button>
        <button
          className="link small"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          title="Move down"
        >
          ↓
        </button>
        <button className="link danger" onClick={onRemove}>
          delete
        </button>
      </header>
      <details>
        <summary className="muted">
          This card uses JS the visual editor can&apos;t lift (imperative <code>fields</code>,
          <code> modifyContext</code>, or an unrecognized key). Edit in the &quot;Raw files&quot;
          tab.
        </summary>
        <pre className="small">{card.raw}</pre>
      </details>
    </div>
  );
}

function firstMeaningfulLine(raw: string): string {
  const labelMatch = /label\s*:\s*(['"])([^'"\\]*(?:\\.[^'"\\]*)*)\1/.exec(raw);
  if (labelMatch && labelMatch[2]) return labelMatch[2];
  const firstLine = raw.trim().split('\n')[0] ?? '';
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
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

/**
 * Wave 3 · Note 6 — "Context values" sub-tab. Lists context keys whose
 * value is derived from another form's most-recent report; each row is
 * a `ReportFieldPicker` (source form + source field) whose selection
 * emits the canonical IIFE bridge via `emitContextValueBridge`.
 *
 * Non-bridge keys stay in the sibling Context flags tab (with its raw-JS
 * `<textarea>` escape hatch). This tab NEVER shows a raw-JS badge: the
 * partition on `recognizeContextValueBridge` upstream guarantees every
 * key rendered here re-hydrates through the recognizer. If a user
 * hand-edits a bridge into a shape the recognizer can't lift, it
 * falls back to the flags tab on the next re-mount.
 */
function ContextValuesTab(props: {
  hasContext: boolean;
  bridgeKeys: string[];
  flags: Record<string, string>;
  onRename: (oldName: string, newName: string) => void;
  onRemove: (name: string) => void;
  onPatchBridge: (name: string, next: ContextValueBridge) => void;
  onAdd: () => void;
}) {
  const { hasContext, bridgeKeys, flags, onRename, onRemove, onPatchBridge, onAdd } = props;
  return (
    <div className="cs-context-values">
      <p className="muted">
        Cross-form values pulled from another form&apos;s most-recent report.
        Each row emits a <code>context.&lt;key&gt;</code> populated by a
        self-contained scan over the <code>reports</code> global — form calcs
        can then reference the key via{' '}
        <code>instance(&apos;contact-summary&apos;)/context/&lt;key&gt;</code>
        (see the Calculation builder&apos;s &quot;From another form&quot; picker).
      </p>
      {!hasContext && (
        <p className="muted">
          Couldn&apos;t find <code>context: {'{...}'}</code> in
          contact-summary.templated.js. Edit raw text in the &quot;Raw files&quot; tab.
        </p>
      )}
      {hasContext && (
        <div className="cs-flags">
          {bridgeKeys.map((name) => {
            const bridge = recognizeContextValueBridge(flags[name] ?? '');
            // The partition guarantees this recognizer succeeds. If it
            // ever returns null (defensive), we render a stub picker
            // seeded with empty strings — the row still round-trips.
            const safe: ContextValueBridge = bridge ?? { sourceForm: '', sourceField: '' };
            return (
              <ContextValueCard
                key={name}
                name={name}
                bridge={safe}
                onRename={(newName) => onRename(name, newName)}
                onChange={(next) => onPatchBridge(name, next)}
                onRemove={() => onRemove(name)}
              />
            );
          })}
          {bridgeKeys.length === 0 && (
            <p className="muted">
              No cross-form context values yet. Click <em>+ Add value</em> below
              to pull the latest report field from another form (e.g. BMI from
              the Diabetes screening form).
            </p>
          )}
          <button onClick={onAdd}>+ Add value</button>
        </div>
      )}
    </div>
  );
}

function ContextValueCard(props: {
  name: string;
  bridge: ContextValueBridge;
  onRename: (newName: string) => void;
  onChange: (next: ContextValueBridge) => void;
  onRemove: () => void;
}) {
  const [nameDraft, setNameDraft] = useState(props.name);
  useEffect(() => setNameDraft(props.name), [props.name]);
  // ReportFieldPicker's `availableForms` prop scopes its form dropdown to
  // a task's appliesToType. On this surface we don't have that — we want
  // the picker to expose ALL app forms in the project — so an empty
  // array falls through to the "all app forms" fallback in the picker.
  const availableForms = useMemo<string[]>(() => [], []);
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
      <label className="expr-field">
        <span className="expr-label">
          <code>source</code>
          <em className="muted"> — latest report from another form</em>
        </span>
        <ReportFieldPicker
          value={props.bridge.sourceField}
          availableForms={availableForms}
          pickedForm={props.bridge.sourceForm}
          onFormChange={(sourceForm) => {
            // Changing the form clears the field — the field list is
            // form-specific and re-derives once the new form loads.
            props.onChange({ sourceForm, sourceField: '' });
          }}
          onChange={(sourceField) => {
            props.onChange({ ...props.bridge, sourceField });
          }}
          placeholder="field.path"
        />
      </label>
      <p className="muted small">
        {props.bridge.sourceForm && props.bridge.sourceField ? (
          <>
            Reads <code>{props.bridge.sourceField}</code> from the most-recent{' '}
            <code>{props.bridge.sourceForm}</code> report; <code>undefined</code>
            {' '}when the patient has none.
          </>
        ) : (
          <>Pick a source form and field above.</>
        )}
      </p>
    </div>
  );
}
