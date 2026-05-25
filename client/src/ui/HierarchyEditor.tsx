/**
 * Hierarchy editor (P1A).
 *
 * Visual tree showing place_hierarchy_types + contact_types, with NSSD's
 * paired place+contact-person pattern. Edits write back to base_settings.json
 * and forms/contact/place-types.json.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../state/store.js';

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

  const [data, setData] = useState<HierarchyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getHierarchy()
      .then((d) => {
        if (!alive) return;
        setData(d as HierarchyData);
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

  function patch(next: HierarchyData) {
    setData(next);
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('hierarchy', false);
    }
  }

  const treeRoots = useMemo(() => {
    if (!data) return [];
    return buildTree(data.contact_types);
  }, [data]);

  const selected = data?.contact_types.find((t) => t.id === selectedId) ?? null;

  if (loading) return <div className="loading">Loading hierarchy…</div>;
  if (!data) return <div className="loading">No hierarchy data.</div>;

  return (
    <div className="hierarchy-editor">
      <header className="page-header">
        <h1>Hierarchy</h1>
        <div className="row gap">
          <button onClick={() => addType(data, patch, setSelectedId)}>+ Type</button>
          <button onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </header>
      <p className="muted">
        <strong>place_hierarchy_types order:</strong>{' '}
        {data.place_hierarchy_types.join(' → ') || '(none)'}
      </p>
      <div className="hierarchy-grid">
        <section className="tree-pane">
          <h3>Contact types ({data.contact_types.length})</h3>
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
        </section>
        <section className="detail-pane">
          {selected ? (
            <ContactTypeDetail
              type={selected}
              allIds={data.contact_types.map((t) => t.id)}
              displayMap={data.place_types_display}
              onChange={(updated, displayName) => {
                const nextDisplay = { ...data.place_types_display };
                if (displayName !== undefined) {
                  if (displayName.trim() === '') delete nextDisplay[updated.id];
                  else nextDisplay[updated.id] = displayName;
                }
                patch({
                  ...data,
                  contact_types: data.contact_types.map((t) =>
                    t.id === selected.id ? { ...t, ...updated } : t,
                  ),
                  place_hierarchy_types: syncHierarchyOrder(
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
                if (
                  !window.confirm(
                    `Delete type "${selected.id}"? This also removes it as a parent from other types.`,
                  )
                )
                  return;
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
              }}
            />
          ) : (
            <p className="muted">Pick a contact type from the tree to edit.</p>
          )}
        </section>
      </div>
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
  return roots;
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
      <label className="row gap">
        <input
          type="checkbox"
          checked={type.person === true}
          onChange={(e) => props.onChange({ person: e.target.checked })}
        />
        <span>Person type (vs place)</span>
      </label>
      <label className="row gap">
        <input
          type="checkbox"
          checked={type.count_visits === true}
          onChange={(e) => props.onChange({ count_visits: e.target.checked })}
        />
        <span>Count visits (place-level)</span>
      </label>
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

function syncHierarchyOrder(prev: string[], types: ContactType[]): string[] {
  // Hierarchy order should only include place (non-person) types.
  const placeIds = new Set(types.filter((t) => !t.person).map((t) => t.id));
  const filtered = prev.filter((p) => placeIds.has(p));
  // Append any new place ids not yet in the order.
  for (const p of placeIds) if (!filtered.includes(p)) filtered.push(p);
  return filtered;
}

function addType(
  data: HierarchyData,
  patch: (n: HierarchyData) => void,
  select: (id: string | null) => void,
) {
  const id = window.prompt('New type id (e.g. g50_subarea or person_chw)');
  if (!id) return;
  if (data.contact_types.some((t) => t.id === id)) {
    window.alert('That id already exists.');
    return;
  }
  const isPerson = window.confirm('Person type? (Cancel for place type.)');
  const newType: ContactType = {
    id,
    name_key: `contact.type.${id}`,
    icon: '',
    person: isPerson,
  };
  if (!isPerson) {
    newType.create_form = `form:contact:${id}:create`;
    newType.edit_form = `form:contact:${id}:edit`;
  }
  const next: HierarchyData = {
    contact_types: [...data.contact_types, newType],
    place_hierarchy_types: isPerson
      ? data.place_hierarchy_types
      : [...data.place_hierarchy_types, id],
    place_types_display: { ...data.place_types_display },
  };
  patch(next);
  select(id);
}
