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
import { useEffect, useState } from 'react';
import {
  parseContactSummary,
  serializeContactSummary,
  parseHelpers,
  patchHelper,
  removeHelper,
  parseCards,
  spliceCards,
  findCardsArrayBounds,
  type Card,
  type CardField,
  type ParsedCards,
  type ParsedContactSummary,
  type RawCard,
} from '@cht-ui/shared';
import { api } from '../api.js';
import { useApp } from '../state/store.js';
import { AppliesIfBuilder, type ContactFormFields } from './AppliesIfBuilder.js';
import { FieldPicker } from './FieldPicker.js';
import { useContactFormFields } from './useContactFormFields.js';

type CSFile = 'contact-summary.templated.js' | 'contact-summary.extras.js';
type CSView = 'structured' | 'cards' | 'helpers' | 'raw';

interface CSState {
  raw: Record<CSFile, string | null>;
  parsed: ParsedContactSummary | null;
  flags: Record<string, string>;
  order: string[];
  parsedCards: ParsedCards | null;
  cards: (Card | RawCard)[];
  cardsDirty: boolean;
}

export function ContactSummaryEditor() {
  const setError = useApp((s) => s.setError);
  const setDirty = useApp((s) => s.setDirty);
  const setSaving = useApp((s) => s.setSaving);
  const dirty = useApp((s) => s.dirty['contact-summary'] ?? false);
  const saving = useApp((s) => s.saving['contact-summary'] ?? false);

  const [state, setState] = useState<CSState | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<CSView>('structured');
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
    let parsedCards = state.parsedCards;
    let cards = state.cards;
    let cardsDirty = state.cardsDirty;
    if (file === 'contact-summary.templated.js') {
      parsed = parseContactSummary(content);
      flags = { ...parsed.contextFlags };
      order = [...parsed.contextOrder];
      // Editing the raw file discards any pending cards working copy — the
      // parsed state is authoritative once the user has typed into raw.
      parsedCards = readCardsFromFile(content);
      cards = parsedCards ? [...parsedCards.cards] : [];
      cardsDirty = false;
    }
    setState({ raw: nextRaw, parsed, flags, order, parsedCards, cards, cardsDirty });
    setDirty('contact-summary', true);
  }

  function patchCards(next: (Card | RawCard)[]) {
    if (!state) return;
    setState({ ...state, cards: next, cardsDirty: true });
    setDirty('contact-summary', true);
  }

  async function save() {
    if (!state) return;
    setSaving('contact-summary', true);
    try {
      // Compose the templated file by applying the two edits that may be
      // pending: context flags (structured tab) and the cards array (cards
      // tab). Each splice is against the file source directly, so both edits
      // compose cleanly against the same starting bytes even when applied in
      // sequence — `spliceCards` operates on `const cards = [ ... ]` which
      // never overlaps the `context: {...}` object.
      let templatedOut = state.raw['contact-summary.templated.js'] ?? '';
      if (state.parsed && state.parsed.contextBounds && view === 'structured') {
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
      setState({ ...state, cardsDirty: false });
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
