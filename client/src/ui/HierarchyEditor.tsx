/**
 * Hierarchy editor (P1A).
 *
 * Visual tree showing place_hierarchy_types + contact_types, with NSSD's
 * paired place+contact-person pattern. Edits write back to base_settings.json
 * and forms/contact/place-types.json.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  deriveHierarchyOrder,
  nudgeHierarchyPosition,
  slugifyHierarchyId,
} from '@cht-ui/shared';
import { api } from '../api.js';
import { useApp } from '../state/store.js';
import { useHistory } from '../state/useHistory.js';
import { showUndoToast } from './UndoToast.js';
import { QuickHierarchyCreator } from './QuickHierarchyCreator.js';
import type { QuickHierarchyResult } from '@cht-ui/shared';

interface ContactType extends Record<string, unknown> {
  id: string;
  name_key?: string;
  group_key?: string;
  create_key?: string;
  edit_key?: string;
  icon?: string;
  parents?: string[];
  person?: boolean;
  primary_contact_key?: string;
  count_visits?: boolean;
  create_form?: string;
  edit_form?: string;
}

interface HierarchyData {
  place_hierarchy_types: string[];
  contact_types: ContactType[];
  place_types_display: Record<string, string>;
}

export function HierarchyEditor() {
  const setError = useApp((s) => s.setError);
  const setDirty = useApp((s) => s.setDirty);
  const setSaving = useApp((s) => s.setSaving);
  const dirty = useApp((s) => s.dirty['hierarchy'] ?? false);
  const saving = useApp((s) => s.saving['hierarchy'] ?? false);

  const history = useHistory<HierarchyData>({
    onUndo: () => setDirty('hierarchy', true),
    onRedo: () => setDirty('hierarchy', true),
  });
  const data = history.current;
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Contact-form generator modal (docs/plans/contact-form-generator.md
  // Decision B). Offered, never auto — opens when the author clicks
  // "Generate contact forms…" in the header.
  const [generatorOpen, setGeneratorOpen] = useState(false);
  // Quick hierarchy creator (docs/plans/quick-hierarchy-creator.md).
  // Surfaces as the empty-state CTA when the parsed contact_types is
  // empty (plan §6 — gate on actually-parsed state, NOT a wizard flag).
  const [quickOpen, setQuickOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getHierarchy()
      .then((d) => {
        if (!alive) return;
        history.reset(d as HierarchyData);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setError]);

  function patch(next: HierarchyData) {
    history.patch(next);
    setDirty('hierarchy', true);
  }

  async function save() {
    if (!data) return;
    setSaving('hierarchy', true);
    try {
      await api.saveHierarchy({
        place_hierarchy_types: data.place_hierarchy_types,
        contact_types: data.contact_types,
        place_types_display: data.place_types_display,
      });
      setDirty('hierarchy', false);
      history.reset(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('hierarchy', false);
    }
  }

  /**
   * Atomic save path for the Quick Hierarchy Creator wizard. Writes the
   * full scaffolded triple to disk, then reseeds the editor's history.
   * Distinct from `save()` because the wizard writes from a fresh build,
   * not from the editor's in-memory state — and per plan §8 it MUST
   * write nothing until this single final commit.
   */
  async function quickCommit(result: QuickHierarchyResult): Promise<boolean> {
    setSaving('hierarchy', true);
    try {
      // The wizard's contact_types satisfy this editor's ContactType shape
      // (its index signature is a superset of the wizard's strict shape) —
      // cast at the API boundary rather than widen the wizard's return.
      const contactTypes = result.contact_types as ContactType[];
      await api.saveHierarchy({
        place_hierarchy_types: result.place_hierarchy_types,
        contact_types: contactTypes,
        place_types_display: result.place_types_display,
      });
      history.reset({
        place_hierarchy_types: result.place_hierarchy_types,
        contact_types: contactTypes,
        place_types_display: result.place_types_display,
      });
      setDirty('hierarchy', false);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving('hierarchy', false);
    }
  }

  // Unified tree (PO reversal — supersedes the two-section split shipped
  // in cdb36b0). Every type renders as one tree, persons nested as leaves
  // under their parent place via parents[0]; for each parent, person
  // children list first, then place children. See
  // docs/handoff-hierarchy-ux-2026-06-28.md §3 (final) — buildTree handles
  // both the parent-of nesting AND the sibling sort.
  const treeRoots = useMemo(
    () => (data ? buildTree(data.contact_types) : []),
    [data],
  );

  const selected = data?.contact_types.find((t) => t.id === selectedId) ?? null;

  if (loading) return <div className="loading">Loading hierarchy…</div>;
  if (!data) return <div className="loading">No hierarchy data.</div>;

  return (
    <div className="hierarchy-editor">
      <header className="page-header sticky-header">
        <h1>Hierarchy</h1>
        <div className="row gap">
          <button
            className="secondary"
            onClick={() => setGeneratorOpen(true)}
            disabled={data.contact_types.length === 0}
            title={
              data.contact_types.length === 0
                ? 'Add at least one contact type first'
                : 'Generate minimal-valid contact create/edit forms for the defined types — skips existing files.'
            }
          >
            Generate contact forms…
          </button>
          <button
            className="link"
            onClick={history.undo}
            disabled={!history.canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo last edit"
          >
            ↶ Undo
          </button>
          <button
            className="link"
            onClick={history.redo}
            disabled={!history.canRedo}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
          >
            ↷ Redo
          </button>
          <button onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </header>
      <div className="hierarchy-order">
        <strong className="muted small">place_hierarchy_types order:</strong>
        {data.place_hierarchy_types.length === 0 && (
          <span className="muted"> (none)</span>
        )}
        {data.place_hierarchy_types.map((id, i) => (
          <span key={id} className="hierarchy-order-pill">
            <button
              className="link"
              onClick={() => {
                patch({
                  ...data,
                  place_hierarchy_types: nudgeHierarchyPosition(
                    data.place_hierarchy_types,
                    id,
                    -1,
                  ),
                });
              }}
              disabled={i === 0}
              aria-label={`Move ${id} earlier in the chain`}
              title="Move earlier"
            >
              ←
            </button>
            <code>{id}</code>
            <button
              className="link"
              onClick={() => {
                patch({
                  ...data,
                  place_hierarchy_types: nudgeHierarchyPosition(
                    data.place_hierarchy_types,
                    id,
                    1,
                  ),
                });
              }}
              disabled={i === data.place_hierarchy_types.length - 1}
              aria-label={`Move ${id} later in the chain`}
              title="Move later"
            >
              →
            </button>
          </span>
        ))}
        <span className="muted small">
          Order follows the parent chain automatically. Use ←/→ to nudge places that share the same parent.
        </span>
      </div>
      <div className="hierarchy-grid">
        <section className="tree-pane">
          <header className="tree-pane-header">
            <h3>Contact types ({data.contact_types.length})</h3>
            <button onClick={() => setAdding(true)}>+ Add type</button>
          </header>
          {data.contact_types.length === 0 ? (
            <QuickHierarchyEmptyCTA onStart={() => setQuickOpen(true)} />
          ) : (
            <ul className="tree">
              {treeRoots.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  onSelect={setSelectedId}
                  selectedId={selectedId}
                />
              ))}
            </ul>
          )}
        </section>
        <section className="detail-pane">
          {selected ? (
            <ContactTypeDetail
              type={selected}
              allIds={data.contact_types.map((t) => t.id)}
              displayMap={data.place_types_display}
              onChange={(updated, displayName) => {
                const nextDisplay = { ...data.place_types_display };
                const id = updated.id ?? selected.id;
                if (displayName !== undefined) {
                  if (displayName.trim() === '') delete nextDisplay[id];
                  else nextDisplay[id] = displayName;
                }
                patch({
                  ...data,
                  contact_types: data.contact_types.map((t) =>
                    t.id === selected.id ? { ...t, ...updated } : t,
                  ),
                  place_hierarchy_types: deriveHierarchyOrder(
                    data.place_hierarchy_types,
                    data.contact_types.map((t) =>
                      t.id === selected.id ? { ...t, ...updated } : t,
                    ),
                  ),
                  place_types_display: nextDisplay,
                });
              }}
              onRename={(oldId, newId) => {
                if (!newId || newId === oldId) return;
                if (data.contact_types.some((t) => t.id === newId)) {
                  setError(`Type id "${newId}" already exists.`);
                  return;
                }
                const renamed = data.contact_types.map((t) => {
                  if (t.id === oldId) return { ...t, id: newId };
                  if (t.parents) {
                    return { ...t, parents: t.parents.map((p) => (p === oldId ? newId : p)) };
                  }
                  return t;
                });
                const ph = data.place_hierarchy_types.map((p) => (p === oldId ? newId : p));
                const display = { ...data.place_types_display };
                if (display[oldId] !== undefined) {
                  display[newId] = display[oldId];
                  delete display[oldId];
                }
                patch({
                  contact_types: renamed,
                  place_hierarchy_types: ph,
                  place_types_display: display,
                });
                setSelectedId(newId);
              }}
              onDelete={() => {
                const snapshotId = history.currentSnapshotId;
                const remaining = data.contact_types
                  .filter((t) => t.id !== selected.id)
                  .map((t) => {
                    if (!t.parents) return t;
                    return { ...t, parents: t.parents.filter((p) => p !== selected.id) };
                  });
                const display = { ...data.place_types_display };
                delete display[selected.id];
                patch({
                  contact_types: remaining,
                  place_hierarchy_types: data.place_hierarchy_types.filter((p) => p !== selected.id),
                  place_types_display: display,
                });
                setSelectedId(null);
                showUndoToast({
                  message: `Deleted type "${selected.id}"`,
                  onUndo: () => history.jumpTo(snapshotId),
                });
              }}
            />
          ) : (
            <p className="muted">Pick a contact type from the tree to edit.</p>
          )}
        </section>
      </div>

      {adding && (
        <AddTypeForm
          existingIds={data.contact_types.map((t) => t.id)}
          placeIds={data.contact_types.filter((t) => !t.person).map((t) => t.id)}
          onCancel={() => setAdding(false)}
          onCommit={(newType) => {
            const nextTypes = [...data.contact_types, newType];
            patch({
              contact_types: nextTypes,
              place_hierarchy_types: deriveHierarchyOrder(data.place_hierarchy_types, nextTypes),
              place_types_display: { ...data.place_types_display },
            });
            setSelectedId(newType.id);
            setAdding(false);
          }}
        />
      )}

      {generatorOpen && (
        <ContactFormGenerator
          contactTypes={data.contact_types}
          displayMap={data.place_types_display}
          onClose={() => setGeneratorOpen(false)}
        />
      )}

      {quickOpen && (
        <QuickHierarchyCreator
          existingContactTypes={data.contact_types}
          onCommit={quickCommit}
          onRequestGenerator={() => {
            setQuickOpen(false);
            // Open the existing ContactFormGenerator against the freshly
            // saved contact_types — the editor's state now holds them
            // because quickCommit reseeded history.
            setGeneratorOpen(true);
          }}
          onClose={() => setQuickOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Empty-state CTA shown in the Hierarchy tree pane when `contact_types`
 * is empty on disk (plan §6 — gate on PARSED state, not a wizard flag).
 * The user can also fall back to "+ Type" at the top, but the quick
 * start is the recommended path for the empty template.
 */
function QuickHierarchyEmptyCTA(props: { onStart: () => void }) {
  return (
    <div className="qhc-empty-cta">
      <h4>No contact types yet.</h4>
      <p className="muted">
        Set up your place levels in a guided list — biggest to smallest, with
        the people you care for at the bottom.
      </p>
      <button className="primary" onClick={props.onStart}>
        Quick start
      </button>
      <p className="muted small">
        Or use <strong>+ Type</strong> above to add one type at a time.
      </p>
    </div>
  );
}

interface TreeItem extends ContactType {
  children: TreeItem[];
}

function buildTree(types: ContactType[]): TreeItem[] {
  const byId = new Map<string, TreeItem>();
  for (const t of types) byId.set(t.id, { ...t, children: [] });
  const roots: TreeItem[] = [];
  for (const t of types) {
    const node = byId.get(t.id);
    if (!node) continue;
    const parents = t.parents ?? [];
    if (parents.length === 0) {
      roots.push(node);
    } else {
      // Place under the FIRST listed parent (visual approximation; many CHT types
      // list multiple parents like person → [district, municipality, ...] meaning
      // "can live under any of these").
      const firstParent = parents[0];
      const parent = firstParent ? byId.get(firstParent) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }
  // Sibling sort: for each parent, persons first then places — the
  // request from the PO walkthrough (people who live there read first,
  // child-places after). Stable across runs because the source order is
  // already deterministic.
  sortSiblingsPersonsFirst(roots);
  return roots;
}

function sortSiblingsPersonsFirst(siblings: TreeItem[]): void {
  siblings.sort((a, b) => {
    const aPerson = a.person === true ? 0 : 1;
    const bPerson = b.person === true ? 0 : 1;
    return aPerson - bPerson;
  });
  for (const s of siblings) sortSiblingsPersonsFirst(s.children);
}

function TreeNode(props: {
  node: TreeItem;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { node } = props;
  const active = props.selectedId === node.id;
  return (
    <li>
      <button
        className={`tree-row${active ? ' active' : ''}${node.person ? ' person' : ''}`}
        onClick={() => props.onSelect(node.id)}
      >
        <span className="tree-icon">{node.person ? '👤' : '🏠'}</span>
        <span className="tree-id">{node.id}</span>
        {node.parents && node.parents.length > 1 && (
          <span className="tree-multi-parent" title={`Also under: ${node.parents.slice(1).join(', ')}`}>
            +{node.parents.length - 1}
          </span>
        )}
      </button>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} selectedId={props.selectedId} onSelect={props.onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ContactTypeDetail(props: {
  type: ContactType;
  allIds: string[];
  displayMap: Record<string, string>;
  onChange: (next: Partial<ContactType>, displayName?: string) => void;
  onRename: (oldId: string, newId: string) => void;
  onDelete: () => void;
}) {
  const { type } = props;
  const [editId, setEditId] = useState(type.id);
  useEffect(() => setEditId(type.id), [type.id]);

  const availableParents = props.allIds.filter((id) => id !== type.id);

  return (
    <div className="type-detail">
      <div className="row gap">
        <label>
          <span>id</span>
          <input value={editId} onChange={(e) => setEditId(e.target.value)} />
        </label>
        {editId !== type.id && (
          <button className="link" onClick={() => props.onRename(type.id, editId)}>
            Rename
          </button>
        )}
        <button className="link danger" onClick={props.onDelete}>
          delete
        </button>
      </div>
      <label>
        <span>Display name (place-types.json)</span>
        <input
          value={props.displayMap[type.id] ?? ''}
          onChange={(e) => props.onChange({}, e.target.value)}
          placeholder={!type.person ? 'e.g. Health Center' : '(only for places)'}
          disabled={type.person === true}
        />
      </label>
      <label>
        <span>Icon</span>
        <input
          value={type.icon ?? ''}
          onChange={(e) => props.onChange({ icon: e.target.value })}
          placeholder="medic-clinic"
        />
      </label>
      <fieldset className="type-kind-fieldset">
        <legend>Type kind</legend>
        <label className="row gap">
          <input
            type="radio"
            name={`type-kind-${type.id}`}
            checked={type.person !== true}
            onChange={() => props.onChange({ person: false })}
          />
          <span>
            <strong>Place</strong>
            <em className="muted small"> — a facility or area (e.g. District, Health Facility)</em>
          </span>
        </label>
        <label className="row gap">
          <input
            type="radio"
            name={`type-kind-${type.id}`}
            checked={type.person === true}
            onChange={() => props.onChange({ person: true })}
          />
          <span>
            <strong>Person</strong>
            <em className="muted small"> — personnel or someone in care (e.g. CHW, Patient)</em>
          </span>
        </label>
      </fieldset>
      {/* `count_visits` is a real CHT setting that puts a visit count +
          "last visited" on a place's profile. Meaningless on persons —
          only surface it for places (plan §4). */}
      {type.person !== true && (
        <label
          className="row gap"
          title="Shows a visit count and 'last visited' on the contact's profile (CHT count_visits)."
        >
          <input
            type="checkbox"
            checked={type.count_visits === true}
            onChange={(e) => props.onChange({ count_visits: e.target.checked })}
          />
          <span>Track visits on this place's profile</span>
        </label>
      )}
      <label>
        <span>name_key</span>
        <input
          value={type.name_key ?? ''}
          onChange={(e) => props.onChange({ name_key: e.target.value })}
          placeholder={`contact.type.${type.id}`}
        />
      </label>
      <label>
        <span>primary_contact_key</span>
        <input
          value={type.primary_contact_key ?? ''}
          onChange={(e) => props.onChange({ primary_contact_key: e.target.value })}
          placeholder="clinic.field.contact"
        />
      </label>
      <fieldset>
        <legend>Parents (this type lives under)</legend>
        <div className="parents-grid">
          {availableParents.map((pid) => (
            <label key={pid} className="row gap">
              <input
                type="checkbox"
                checked={(type.parents ?? []).includes(pid)}
                onChange={(e) => {
                  const current = type.parents ?? [];
                  const next = e.target.checked
                    ? [...current, pid]
                    : current.filter((p) => p !== pid);
                  props.onChange({ parents: next.length > 0 ? next : undefined });
                }}
              />
              <span>{pid}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/**
 * Inline modal for adding a new contact type. Replaces the old
 * window.prompt + window.confirm pair (which Bhishan flagged as
 * unprofessional) and lets the user set the parent at creation time so
 * deriveHierarchyOrder places the type correctly without a follow-up edit.
 */
function AddTypeForm(props: {
  existingIds: string[];
  placeIds: string[];
  onCancel: () => void;
  onCommit: (newType: ContactType) => void;
}) {
  // The user types a friendly NAME; we derive the ASCII id via the same
  // `slugifyHierarchyId` helper the Quick Hierarchy Creator uses (plan
  // doc DEV-HANDOFF #4 §2 — consistency fix). The two entry points
  // disagreed pre-fix: AddTypeForm hard-rejected anything not matching
  // `/^[a-z][a-z0-9_]*$/`, dead-ending on "Fchv Person".
  const [name, setName] = useState('');
  const [explicitId, setExplicitId] = useState('');
  const [isPerson, setIsPerson] = useState(false);
  const [parentId, setParentId] = useState<string>('');

  // Resolve the actual id we'd write — explicit wins, else slugify the
  // typed name. Empty derivation happens when the name is all non-ASCII
  // (Devanagari etc.); in that case the user MUST supply an explicit id.
  const derivedFromName = slugifyHierarchyId(name.trim());
  const id = (explicitId.trim() || derivedFromName).trim();
  const validIdShape = /^[a-z][a-z0-9_]*$/.test(id);
  const duplicate = id !== '' && props.existingIds.includes(id);
  const needsExplicit = name.trim() !== '' && derivedFromName === '' && explicitId.trim() === '';
  const canCommit = id !== '' && validIdShape && !duplicate && !needsExplicit;

  function commit() {
    if (!canCommit) return;
    const newType: ContactType = {
      id,
      name_key: `contact.type.${id}`,
      icon: '',
      person: isPerson,
      // ALWAYS write create_form / edit_form — including for person
      // types. Pre-fix the gate was `if (!isPerson)` so a freshly-added
      // person type silently shipped without these fields; CHT then
      // shows NO "+ New <person>" affordance inside the parent place
      // because a contact_type is only creatable when its create_form
      // points at an existing form doc. cht-default's `person` type
      // ships both fields. The contact-form generator emits matching
      // create/edit form .xlsx files for every defined type.
      create_form: `form:contact:${id}:create`,
      edit_form: `form:contact:${id}:edit`,
    };
    if (parentId) newType.parents = [parentId];
    props.onCommit(newType);
  }

  return (
    <div
      className="qtype-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onCancel();
      }}
    >
      <div
        className="qtype-modal"
        style={{ maxWidth: 480 }}
        role="dialog"
        aria-label="Add contact type"
      >
        <div className="qtype-header">
          <h2>Add contact type</h2>
          <button className="link" onClick={props.onCancel} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="qtype-name-field">
            <span>Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ward, CHW, Patient"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCommit) commit();
              }}
            />
            <span className="muted small">
              {id ? (
                <>
                  saved as <code>{id}</code>
                </>
              ) : (
                <>Friendly label — we'll derive the id.</>
              )}
              {duplicate && (
                <strong style={{ color: '#dc2626' }}> — already exists</strong>
              )}
            </span>
          </label>
          {needsExplicit && (
            <label className="qtype-name-field">
              <span>Explicit id (ASCII)</span>
              <input
                value={explicitId}
                onChange={(e) => setExplicitId(e.target.value)}
                placeholder="ascii_id"
              />
              <span className="muted small">
                The name has no ASCII letters — set an id (lowercase letters, digits, underscores).
              </span>
            </label>
          )}
          <fieldset className="row gap" style={{ border: 0, padding: 0, margin: 0, gap: 12 }}>
            <legend className="sr-only">Type kind</legend>
            <label className="row gap">
              <input
                type="radio"
                name="add-type-kind"
                checked={!isPerson}
                onChange={() => setIsPerson(false)}
              />
              <span>
                <strong>Place</strong>
                <em className="muted small"> — a facility or area (e.g. District, Health Facility)</em>
              </span>
            </label>
            <label className="row gap">
              <input
                type="radio"
                name="add-type-kind"
                checked={isPerson}
                onChange={() => setIsPerson(true)}
              />
              <span>
                <strong>Person</strong>
                <em className="muted small"> — personnel or someone in care (e.g. CHW, Patient)</em>
              </span>
            </label>
          </fieldset>
          <label className="qtype-name-field">
            <span>Parent (optional)</span>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— no parent (root) —</option>
              {props.existingIds.map((pid) => (
                <option key={pid} value={pid}>
                  {pid} {!props.placeIds.includes(pid) ? '(person)' : ''}
                </option>
              ))}
            </select>
            <span className="muted small">
              For places, sets where it sits in the chain. For people, where they can be created.
            </span>
          </label>
        </div>
        <div className="qtype-actions">
          <button className="link" onClick={props.onCancel}>
            Cancel
          </button>
          <button onClick={commit} disabled={!canCommit}>
            Add type
          </button>
        </div>
      </div>
    </div>
  );
}

/* ======================= contact-form generator ======================= */

type GenMode = 'skip' | 'overwrite';

/**
 * Offered, never-auto contact-form generator (docs/plans/contact-form-
 * generator.md Decision B, plan §4). Mirrors the LineageBuilder modal
 * SHAPE — checklist of types, per-type create/edit toggles, live
 * preview — but writes to the filesystem (no snapshot-undo).
 *
 * Two modes:
 *   - 'skip' (default): existing files are NEVER overwritten — the
 *     original plan §3 #4 hard contract. Add-a-new-type and re-run
 *     fills only the gaps.
 *   - 'overwrite': existing files ARE clobbered, with an explicit
 *     window.confirm listing the affected files. Use when a generator
 *     fix (like the f0f0e20 `created_by*` XPath) needs to reach
 *     already-generated forms that the skip path would leave stale.
 *
 * Per-existing-file Delete button removes a form (xlsx + xml + props)
 * from inside the modal so the user doesn't have to leave the editor
 * to clear a stale form before regenerating.
 */
function ContactFormGenerator(props: {
  contactTypes: ContactType[];
  displayMap: Record<string, string>;
  onClose: () => void;
}) {
  // Per-(type,variant) check state. Default: every (type,variant) checked
  // ON so a fresh project gets every form with one click. In skip mode
  // existing checkboxes are disabled (skip wouldn't write anyway); in
  // overwrite mode they're enabled but unchecked by default — opt-in
  // each file the user explicitly wants to clobber.
  const initialChecks = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const t of props.contactTypes) {
      m.set(`${t.id}:create`, true);
      m.set(`${t.id}:edit`, true);
    }
    return m;
  }, [props.contactTypes]);
  const [checks, setChecks] = useState<Map<string, boolean>>(initialChecks);
  const [mode, setMode] = useState<GenMode>('skip');
  const [existingBasenames, setExistingBasenames] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [deletingBasename, setDeletingBasename] = useState<string | null>(null);
  const [report, setReport] = useState<
    | null
    | {
        written: number;
        overwritten: number;
        skipped: number;
        invalid: number;
        failed: number;
        rows: Array<{
          type: string;
          variant: 'create' | 'edit';
          basename: string;
          status: 'written' | 'overwritten' | 'skipped' | 'invalid' | 'failed';
          message?: string;
          previousBytes?: number;
          warnings: string[];
        }>;
      }
  >(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshExistingBasenames(): Promise<void> {
    try {
      const r = await api.listForms();
      const set = new Set<string>();
      for (const f of r.forms) {
        if (f.category === 'contact') {
          set.add(f.filename.replace(/\.xlsx$/i, '').toLowerCase());
        }
      }
      setExistingBasenames(set);
    } catch {
      /* listing failure is non-blocking */
    }
  }

  // Pull the existing contact-form basenames so we can mark which
  // (type, variant) pairs are already on disk.
  useEffect(() => {
    let alive = true;
    void api
      .listForms()
      .then((r) => {
        if (!alive) return;
        const set = new Set<string>();
        for (const f of r.forms) {
          if (f.category === 'contact') {
            set.add(f.filename.replace(/\.xlsx$/i, '').toLowerCase());
          }
        }
        setExistingBasenames(set);
      })
      .catch(() => {
        /* listing failure is non-blocking — fall back to "none exist" */
      });
    return () => {
      alive = false;
    };
  }, []);

  // When switching INTO overwrite mode, uncheck existing rows by default
  // so the user opts-in to each clobber. Switching back to skip leaves
  // selections alone — they'll just be no-ops on existing rows.
  function setModeAndAdjustChecks(next: GenMode): void {
    setMode(next);
    if (next === 'overwrite') {
      setChecks((prev) => {
        const out = new Map(prev);
        for (const t of props.contactTypes) {
          for (const v of ['create', 'edit'] as const) {
            const basename = `${t.id}-${v}`.toLowerCase();
            if (existingBasenames.has(basename)) out.set(`${t.id}:${v}`, false);
          }
        }
        return out;
      });
    }
  }

  function toggle(key: string) {
    setChecks((prev) => {
      const next = new Map(prev);
      next.set(key, !next.get(key));
      return next;
    });
  }

  function friendly(typeId: string): string {
    return props.displayMap[typeId] ?? typeId;
  }

  async function deleteExisting(basename: string): Promise<void> {
    // eslint-disable-next-line no-undef
    const ok = window.confirm(
      `Delete ${basename}.xlsx (and any converted .xml / .properties.json) from forms/contact/?\n\nThis is irreversible from the UI — restore from git if you have it tracked.`,
    );
    if (!ok) return;
    setDeletingBasename(basename);
    setError(null);
    try {
      await api.deleteForm(`forms/contact/${basename}.xlsx`);
      await refreshExistingBasenames();
    } catch (e) {
      setError(`Could not delete ${basename}.xlsx: ${(e as Error).message}`);
    } finally {
      setDeletingBasename(null);
    }
  }

  // Preview state. Each checked (type, variant) lands in exactly one
  // bucket based on mode + on-disk presence:
  //   skip mode:
  //     not existing → willWrite
  //     existing     → willSkip
  //   overwrite mode:
  //     not existing → willWrite
  //     existing     → willOverwrite
  const willWrite: Array<{ type: string; variant: 'create' | 'edit' }> = [];
  const willSkip: Array<{ type: string; variant: 'create' | 'edit' }> = [];
  const willOverwrite: Array<{ type: string; variant: 'create' | 'edit' }> = [];
  for (const t of props.contactTypes) {
    for (const variant of ['create', 'edit'] as const) {
      if (!checks.get(`${t.id}:${variant}`)) continue;
      const basename = `${t.id}-${variant}`.toLowerCase();
      const exists = existingBasenames.has(basename);
      if (!exists) {
        willWrite.push({ type: t.id, variant });
      } else if (mode === 'overwrite') {
        willOverwrite.push({ type: t.id, variant });
      } else {
        willSkip.push({ type: t.id, variant });
      }
    }
  }
  const totalToTouch = willWrite.length + willOverwrite.length;

  async function runGenerate() {
    // In overwrite mode, confirm before clobbering. List the files so
    // the user can sanity-check what's about to change.
    if (mode === 'overwrite' && willOverwrite.length > 0) {
      const list = willOverwrite.map((o) => `  • ${o.type}-${o.variant}.xlsx`).join('\n');
      // eslint-disable-next-line no-undef
      const ok = window.confirm(
        `Overwrite ${willOverwrite.length} existing contact form${willOverwrite.length === 1 ? '' : 's'}?\n\n${list}\n\nAny hand-edits to these files will be lost. Restore from git if needed.`,
      );
      if (!ok) return;
    }
    setRunning(true);
    setError(null);
    try {
      const requests: Array<{ type: string; variant: 'create' | 'edit'; displayName?: string }> = [];
      for (const t of props.contactTypes) {
        for (const variant of ['create', 'edit'] as const) {
          if (!checks.get(`${t.id}:${variant}`)) continue;
          requests.push({
            type: t.id,
            variant,
            displayName: props.displayMap[t.id],
          });
        }
      }
      if (requests.length === 0) {
        setError('Nothing selected — check at least one (type, variant) row.');
        setRunning(false);
        return;
      }
      const res = await api.generateContactForms({
        requests,
        contactTypes: props.contactTypes.map((t) => ({
          id: t.id,
          person: t.person,
          parents: t.parents,
        })),
        overwrite: mode === 'overwrite',
      });
      setReport({
        written: res.written,
        overwritten: res.overwritten,
        skipped: res.skipped,
        invalid: res.invalid,
        failed: res.failed,
        rows: res.report,
      });
      // After a successful run, refresh the existing-basenames cache
      // so re-running the modal in the same session sees the new files.
      await refreshExistingBasenames();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="qtype-backdrop" onMouseDown={(e) => {
      if (e.target === e.currentTarget) props.onClose();
    }}>
      <div
        className="qtype-modal lineage-builder-modal"
        role="dialog"
        aria-label="Generate contact forms"
      >
        <div className="qtype-header">
          <h2>Generate contact forms</h2>
          <button className="link" onClick={props.onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="muted small lineage-builder-intro">
          Generates minimal-valid <code>create</code> + <code>edit</code> forms for the
          contact types you've defined. Files land in{' '}
          <code>forms/contact/</code> as <code>&lt;type&gt;-create.xlsx</code> /{' '}
          <code>&lt;type&gt;-edit.xlsx</code>.
        </p>

        {error && <div className="error-banner">{error}</div>}

        {report === null ? (
          <>
            <fieldset className="cfg-mode-fieldset">
              <legend className="sr-only">Generation mode</legend>
              <label className="row gap">
                <input
                  type="radio"
                  name="cfg-mode"
                  checked={mode === 'skip'}
                  onChange={() => setModeAndAdjustChecks('skip')}
                />
                <span>
                  <strong>Generate new only</strong>{' '}
                  <em className="muted small">(skip existing files — safe default)</em>
                </span>
              </label>
              <label className="row gap">
                <input
                  type="radio"
                  name="cfg-mode"
                  checked={mode === 'overwrite'}
                  onChange={() => setModeAndAdjustChecks('overwrite')}
                />
                <span>
                  <strong>Regenerate (overwrite existing)</strong>{' '}
                  <em className="muted small">
                    — pick this when a generator fix needs to reach already-generated
                    forms. Hand-edits to those files will be lost.
                  </em>
                </span>
              </label>
            </fieldset>

            {props.contactTypes.length === 0 ? (
              <p className="muted">No contact types defined yet.</p>
            ) : (
              <table className="codes-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th style={{ width: 80 }}>Kind</th>
                    <th style={{ width: 130 }}>Create</th>
                    <th style={{ width: 130 }}>Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {props.contactTypes.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <strong>{friendly(t.id)}</strong>{' '}
                        <code className="muted small">{t.id}</code>
                      </td>
                      <td className="muted small">{t.person ? 'Person' : 'Place'}</td>
                      {(['create', 'edit'] as const).map((variant) => {
                        const key = `${t.id}:${variant}`;
                        const basename = `${t.id}-${variant}`.toLowerCase();
                        const exists = existingBasenames.has(basename);
                        // In skip mode, existing checkboxes are disabled
                        // (the row will skip regardless). In overwrite
                        // mode, they're enabled and the user opts-in
                        // per-file.
                        const checkboxDisabled = exists && mode === 'skip';
                        return (
                          <td key={variant}>
                            <label
                              className="row gap"
                              style={{ alignItems: 'center', cursor: 'pointer' }}
                            >
                              <input
                                type="checkbox"
                                checked={checks.get(key) ?? false}
                                onChange={() => toggle(key)}
                                disabled={checkboxDisabled || deletingBasename === basename}
                              />
                              {exists ? (
                                <span className="muted small">
                                  exists —{' '}
                                  {mode === 'overwrite' ? 'overwrite' : 'will skip'}
                                </span>
                              ) : (
                                <span className="muted small">{basename}.xlsx</span>
                              )}
                              {exists && (
                                <button
                                  className="link danger small"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    void deleteExisting(basename);
                                  }}
                                  disabled={deletingBasename === basename}
                                  title={`Delete ${basename}.xlsx (xlsx + xml + properties)`}
                                  aria-label={`Delete ${basename}.xlsx`}
                                >
                                  {deletingBasename === basename ? '…' : '🗑'}
                                </button>
                              )}
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="lineage-builder-preview">
              <div className="muted small">Preview:</div>
              <pre className="lineage-builder-ladder">
                {totalToTouch === 0 && willSkip.length === 0
                  ? '(nothing selected)'
                  : [
                      willWrite.length > 0
                        ? `→ Will write ${willWrite.length} new file${willWrite.length === 1 ? '' : 's'}:`
                        : '',
                      ...willWrite.map((w) => `   ${w.type}-${w.variant}.xlsx`),
                      willOverwrite.length > 0
                        ? `⚠ Will OVERWRITE ${willOverwrite.length} existing file${willOverwrite.length === 1 ? '' : 's'}:`
                        : '',
                      ...willOverwrite.map((w) => `   ${w.type}-${w.variant}.xlsx  (overwritten)`),
                      willSkip.length > 0
                        ? `→ Will skip ${willSkip.length} existing file${willSkip.length === 1 ? '' : 's'}:`
                        : '',
                      ...willSkip.map((w) => `   ${w.type}-${w.variant}.xlsx  (already on disk)`),
                    ]
                      .filter(Boolean)
                      .join('\n')}
              </pre>
            </div>

            <div className="qtype-actions">
              <button className="link" onClick={props.onClose}>
                Cancel
              </button>
              <button
                onClick={() => void runGenerate()}
                disabled={running || totalToTouch === 0}
                className={willOverwrite.length > 0 ? 'danger' : ''}
              >
                {running
                  ? 'Generating…'
                  : willOverwrite.length > 0
                    ? `Regenerate ${totalToTouch} file${totalToTouch === 1 ? '' : 's'} (overwrites ${willOverwrite.length})`
                    : `Generate ${totalToTouch} file${totalToTouch === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="lineage-builder-preview">
              <div className="muted small">Result:</div>
              <pre className="lineage-builder-ladder">
                {[
                  `✓ Written (new): ${report.written}`,
                  report.overwritten > 0
                    ? `↻ Overwritten (existing): ${report.overwritten}`
                    : '',
                  `→ Skipped (already existed): ${report.skipped}`,
                  report.invalid > 0 ? `✗ Invalid: ${report.invalid}` : '',
                  report.failed > 0 ? `✗ Failed: ${report.failed}` : '',
                  '',
                  ...report.rows.map((row) => {
                    const glyph =
                      row.status === 'written' ? '✓' :
                      row.status === 'overwritten' ? '↻' :
                      row.status === 'skipped' ? '→' : '✗';
                    const detail =
                      row.status === 'overwritten' && row.previousBytes !== undefined
                        ? ` — was ${row.previousBytes} bytes`
                        : row.message
                          ? ` — ${row.message}`
                          : '';
                    return `${glyph} ${row.basename}.xlsx  (${row.status}${detail})`;
                  }),
                  ...report.rows
                    .filter((r) => r.warnings.length > 0)
                    .flatMap((r) => [
                      '',
                      `⚠ ${r.basename} warnings:`,
                      ...r.warnings.map((w) => `   ${w}`),
                    ]),
                ]
                  .filter(Boolean)
                  .join('\n')}
              </pre>
            </div>

            <div className="qtype-actions">
              <button onClick={props.onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
