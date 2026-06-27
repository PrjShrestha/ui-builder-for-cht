/**
 * Hierarchy editor (P1A).
 *
 * Visual tree showing place_hierarchy_types + contact_types, with NSSD's
 * paired place+contact-person pattern. Edits write back to base_settings.json
 * and forms/contact/place-types.json.
 */
import { useEffect, useMemo, useState } from 'react';
import { deriveHierarchyOrder, nudgeHierarchyPosition } from '@cht-ui/shared';
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

  const treeRoots = useMemo(() => {
    if (!data) return [];
    return buildTree(data.contact_types);
  }, [data]);

  const selected = data?.contact_types.find((t) => t.id === selectedId) ?? null;

  if (loading) return <div className="loading">Loading hierarchy…</div>;
  if (!data) return <div className="loading">No hierarchy data.</div>;

  return (
    <div className="hierarchy-editor">
      <header className="page-header sticky-header">
        <h1>Hierarchy</h1>
        <div className="row gap">
          <button onClick={() => setAdding(true)}>+ Type</button>
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
          <h3>Contact types ({data.contact_types.length})</h3>
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
  const [id, setId] = useState('');
  const [isPerson, setIsPerson] = useState(false);
  const [parentId, setParentId] = useState<string>('');
  const duplicate = props.existingIds.includes(id);
  const validId = /^[a-z][a-z0-9_]*$/.test(id);
  const canCommit = id !== '' && validId && !duplicate;

  function commit() {
    if (!canCommit) return;
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
            <span>Type id</span>
            <input
              autoFocus
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="e.g. ward, chw, patient"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCommit) commit();
              }}
            />
            <span className="muted small">
              Lowercase letters, digits, underscores. Used in app_settings + form references.
              {duplicate && <strong style={{ color: '#dc2626' }}> — already exists</strong>}
              {id && !validId && !duplicate && (
                <strong style={{ color: '#dc2626' }}> — invalid id</strong>
              )}
            </span>
          </label>
          <label className="row gap">
            <input
              type="checkbox"
              checked={isPerson}
              onChange={(e) => setIsPerson(e.target.checked)}
            />
            <span>Person type (e.g. CHW, patient) — leave unchecked for a place</span>
          </label>
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

/**
 * Offered, never-auto contact-form generator (docs/plans/contact-form-
 * generator.md Decision B, plan §4). Mirrors the LineageBuilder modal
 * SHAPE — checklist of types, per-type create/edit toggles, live
 * preview — but writes to the filesystem (no snapshot-undo); the
 * result toast reports written/skipped counts.
 *
 * Existing files for `(type, variant)` are shown disabled "exists —
 * will skip" so the author understands the hard skip-not-overwrite
 * contract (plan §3 #4). Re-running after adding a new type only fills
 * the gaps.
 */
function ContactFormGenerator(props: {
  contactTypes: ContactType[];
  displayMap: Record<string, string>;
  onClose: () => void;
}) {
  // Per-(type,variant) check state. Default: every (type,variant) checked
  // ON so a fresh project gets every form with one click; existing
  // files are disabled but still rendered, with the checkbox checked +
  // disabled (so the user can SEE that yes, it would have been written
  // but a file's already there).
  const initialChecks = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const t of props.contactTypes) {
      m.set(`${t.id}:create`, true);
      m.set(`${t.id}:edit`, true);
    }
    return m;
  }, [props.contactTypes]);
  const [checks, setChecks] = useState<Map<string, boolean>>(initialChecks);
  const [existingBasenames, setExistingBasenames] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<
    | null
    | {
        written: number;
        skipped: number;
        invalid: number;
        failed: number;
        rows: Array<{
          type: string;
          variant: 'create' | 'edit';
          basename: string;
          status: 'written' | 'skipped' | 'invalid' | 'failed';
          message?: string;
          warnings: string[];
        }>;
      }
  >(null);
  const [error, setError] = useState<string | null>(null);

  // Pull the existing contact-form basenames so we can mark which
  // (type, variant) pairs are already on disk (and will skip).
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

  // Preview state. Filter to checked AND not-yet-existing for "will
  // write"; checked AND existing → "will skip"; unchecked → not in
  // either list. Computed every render so the toggle is immediate.
  const willWrite: Array<{ type: string; variant: 'create' | 'edit' }> = [];
  const willSkip: Array<{ type: string; variant: 'create' | 'edit' }> = [];
  for (const t of props.contactTypes) {
    for (const variant of ['create', 'edit'] as const) {
      if (!checks.get(`${t.id}:${variant}`)) continue;
      const basename = `${t.id}-${variant}`.toLowerCase();
      if (existingBasenames.has(basename)) {
        willSkip.push({ type: t.id, variant });
      } else {
        willWrite.push({ type: t.id, variant });
      }
    }
  }

  async function runGenerate() {
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
      });
      setReport({
        written: res.written,
        skipped: res.skipped,
        invalid: res.invalid,
        failed: res.failed,
        rows: res.report,
      });
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
          contact types you've defined. The new files land in{' '}
          <code>forms/contact/</code> as <code>&lt;type&gt;-create.xlsx</code> /{' '}
          <code>&lt;type&gt;-edit.xlsx</code>. <strong>Existing files are NEVER overwritten</strong> —
          a (type, variant) that already has a file is shown as "will skip".
        </p>

        {error && <div className="error-banner">{error}</div>}

        {report === null ? (
          <>
            {props.contactTypes.length === 0 ? (
              <p className="muted">No contact types defined yet.</p>
            ) : (
              <table className="codes-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th style={{ width: 80 }}>Kind</th>
                    <th style={{ width: 110 }}>Create</th>
                    <th style={{ width: 110 }}>Edit</th>
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
                        return (
                          <td key={variant}>
                            <label className="row gap" style={{ alignItems: 'center', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={checks.get(key) ?? false}
                                onChange={() => toggle(key)}
                                disabled={exists}
                              />
                              {exists ? (
                                <span className="muted small">exists — will skip</span>
                              ) : (
                                <span className="muted small">{basename}.xlsx</span>
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
                {willWrite.length === 0 && willSkip.length === 0
                  ? '(nothing selected)'
                  : [
                      `→ Will write ${willWrite.length} file${willWrite.length === 1 ? '' : 's'}:`,
                      ...willWrite.map((w) => `   ${w.type}-${w.variant}.xlsx`),
                      willSkip.length > 0 ? `→ Will skip ${willSkip.length} existing file${willSkip.length === 1 ? '' : 's'}:` : '',
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
                disabled={running || willWrite.length === 0}
              >
                {running ? 'Generating…' : `Generate ${willWrite.length} file${willWrite.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="lineage-builder-preview">
              <div className="muted small">Result:</div>
              <pre className="lineage-builder-ladder">
                {[
                  `✓ Written: ${report.written}`,
                  `→ Skipped (already existed): ${report.skipped}`,
                  report.invalid > 0 ? `✗ Invalid: ${report.invalid}` : '',
                  report.failed > 0 ? `✗ Failed: ${report.failed}` : '',
                  '',
                  ...report.rows.map((row) => {
                    const glyph =
                      row.status === 'written' ? '✓' :
                      row.status === 'skipped' ? '→' : '✗';
                    return `${glyph} ${row.basename}.xlsx  (${row.status}${row.message ? ' — ' + row.message : ''})`;
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
