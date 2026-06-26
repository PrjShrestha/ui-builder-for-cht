/**
 * "Add lineage" configurator — the modal that opens after the user picks
 * the `lineage_block` tile in QuestionTypePicker. Implements the UX
 * contract in docs/plans/hierarchy-block-generator.md v0.3 §4:
 *
 *   - Leaf picker ("Who/what is this form about?") — friendly place names
 *     from `place_types_display`, never raw type ids, never the word
 *     "leaf" in the copy.
 *   - Depth (number input) — default = the full place-parent chain above
 *     the chosen leaf, editable down to 0.
 *   - Live preview ladder — re-rendered from the SAME `buildHierarchyBlock`
 *     output so the preview can't disagree with the inserted rows.
 *   - Advanced disclosure: per-named-level `name` + `phone` toggles
 *     (default off — `_id` only is the dominant case).
 *   - Multi-place-parent warning surfaced visibly (plan §2 #5).
 *
 * Pure presentational + state-local — no XLSForm parsing, no store
 * access. Parent (`FormEditor`) decides what to do with the rows.
 *
 * Affordance lives INSIDE QuestionTypePicker as a tile, NOT a second
 * toolbar button (§4.7). The picker hands off via a sentinel
 * `tileId === 'lineage_block'` commit.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildHierarchyBlock,
  computeLineageChain,
  type ContactTypeNode,
  type SurveyRow,
} from '@cht-ui/shared';

export interface LineageBuilderHierarchy {
  contact_types: ContactTypeNode[];
  /** Friendly display names keyed by type id. Missing keys → fall back
   *  to the raw type id (never empty string — see plan §4.5 + the §7.6
   *  label-fallback contract). */
  place_types_display: Record<string, string>;
}

export interface LineageCommit {
  rows: SurveyRow[];
  /** What was picked — for the toast text + the post-insert reveal target. */
  summary: { leafType: string; leafLabel: string; depth: number; chain: string[] };
  /** Outermost begin-group rowId — passed up so FormEditor can reveal it
   *  via the existing `revealRowId` channel. */
  outermostBeginRowId: string | null;
}

interface Props {
  hierarchy: LineageBuilderHierarchy;
  /** When `true`, the modal renders a banner explaining the form already
   *  has an `inputs/contact` group (so the splice will land cleanly).
   *  When `false`, no warning — the modal still works; the caller decides
   *  insertion point. */
  formHasInputsContact: boolean;
  onCancel: () => void;
  onCommit: (commit: LineageCommit) => void;
}

/**
 * Pick a friendly label for a type id. Always returns SOMETHING — never
 * an empty string (plan §4.5 + §7.6 require non-empty for label
 * fallback). Prefer the display map; fall back to a humanised id.
 */
function friendlyName(typeId: string, display: Record<string, string>): string {
  const d = display[typeId];
  if (d && d.trim()) return d;
  // Humanise: snake_case → Title Case so "district_hospital" reads as
  // "District Hospital" in the preview ladder.
  return typeId
    .split(/[_-]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/** Sort the leaf-picker options: persons first (they're the common case
 *  for report forms — "this form is about a patient"), then places by
 *  place_hierarchy order proxy (alphabetical fallback). */
function sortedLeafOptions(types: ContactTypeNode[]): ContactTypeNode[] {
  return [...types].sort((a, b) => {
    if (!!a.person !== !!b.person) return a.person ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

// TODO(v1.1) — Plan §0 "two configurable blocks" headline:
//   - Add ☑ "Include who submitted it" (inputs/user) toggle.
//   - Add ☑ "Include who it's about" (inputs/contact + ancestors) toggle.
// The current MVP assumes the form is built from `buildAppFormScaffold`
// (which already emits inputs/user + inputs/contact + linking calculates)
// and just adds the parent-chain block. The planner flagged the submitter/
// subject toggle semantics as "interpretation ambiguous" — if checked on a
// form that already has inputs/user, do we no-op? Replace? Augment? Defer
// until those semantics are pinned.
//
// TODO(v1.1) — Plan §4.9 A11y: add focus-trap (Tab/Shift+Tab cycling
// within the dialog) + restore-focus-on-close to the element that opened
// the picker. The Esc-to-dismiss + auto-focus-leaf-select gates are
// already covered.
export function LineageBuilder(props: Props) {
  const { hierarchy } = props;
  const leafOptions = useMemo(
    () => sortedLeafOptions(hierarchy.contact_types),
    [hierarchy.contact_types],
  );

  // Default leaf: the first person type if present (the dominant case for
  // app/report forms — "who is this patient?"); otherwise the
  // alphabetically-first place. Empty-hierarchy edge handled by the
  // empty-state render below.
  const defaultLeaf = useMemo(() => {
    return leafOptions[0]?.id ?? '';
  }, [leafOptions]);

  const [leafType, setLeafType] = useState<string>(defaultLeaf);

  // Compute the FULL natural chain for the current leaf (depth=999) so
  // we know the max depth + can default to full-chain.
  const fullChainResult = useMemo(
    () => computeLineageChain(hierarchy.contact_types, leafType, 999),
    [hierarchy.contact_types, leafType],
  );
  const maxDepth = fullChainResult.chain.length;

  // Depth defaults to the full chain (the most common author intent: "include
  // every ancestor I have"); editable down to 0. We snap it back to the new
  // max when the leaf changes, otherwise switching from a deeper leaf to a
  // shallower one would leave depth=5 against a chain of length 2 and
  // silently emit only 2 levels — confusing.
  const [depth, setDepth] = useState<number>(maxDepth);
  useEffect(() => {
    setDepth(maxDepth);
  }, [maxDepth]);

  // Per-place-type-id name/phone toggles. Stored as a flat record so the
  // user can include CHW-level contact info without including the
  // district-level — the dominant real-world ask (§4.6).
  const [namePhoneByType, setNamePhoneByType] = useState<Record<string, boolean>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // eslint-disable-next-line no-undef
  const dialogRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line no-undef
  const leafSelectRef = useRef<HTMLSelectElement>(null);

  // Auto-focus the leaf select on open — primary interaction.
  useEffect(() => {
    leafSelectRef.current?.focus();
  }, []);

  // Esc closes — matches QuestionTypePicker convention.
  useEffect(() => {
    // eslint-disable-next-line no-undef
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onCancel();
      }
    }
    // eslint-disable-next-line no-undef
    window.addEventListener('keydown', onKey);
    // eslint-disable-next-line no-undef
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  // Re-derive the block on every state change — same function the splice
  // path will call, so the preview can't disagree with what gets inserted.
  const block = useMemo(
    () =>
      buildHierarchyBlock(hierarchy.contact_types, {
        leafType,
        depth,
        includeNamePhoneByType: namePhoneByType,
      }),
    [hierarchy.contact_types, leafType, depth, namePhoneByType],
  );

  const leafLabel = friendlyName(leafType, hierarchy.place_types_display);

  // Find the outermost begin-group rowId from the emitted block — passed
  // up to FormEditor so the existing `revealRowId` channel can scroll +
  // flash + focus it after splice (the highest-value UX win, §4.2).
  const outermostBegin = block.rows.find((r) => r.type === 'begin group') ?? null;

  function handleInsert() {
    props.onCommit({
      rows: block.rows,
      summary: { leafType, leafLabel, depth, chain: block.chain },
      outermostBeginRowId: outermostBegin?.rowId ?? null,
    });
  }

  // Type inferred from the JSX onMouseDown signature — matches the
  // QuestionTypePicker backdrop handler's bare-arrow style.
  function onBackdropMouseDown(e: { target: unknown; currentTarget: unknown }) {
    if (e.target === e.currentTarget) props.onCancel();
  }

  return (
    <div className="qtype-backdrop" onMouseDown={onBackdropMouseDown}>
      <div
        className="qtype-modal lineage-builder-modal"
        role="dialog"
        aria-label="Add contact + ancestor lineage"
        ref={dialogRef}
      >
        <div className="qtype-header">
          <h2>Add contact + ancestor lineage</h2>
          <button className="link" onClick={props.onCancel} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="muted small lineage-builder-intro">
          Generates the hidden plumbing CHT fills in automatically — the contact
          this form is about, plus their ancestor places (CHW, facility, district…).
          Health workers won't see these rows; the data is used by tasks and reports.
        </p>

        {leafOptions.length === 0 ? (
          <p className="muted">
            This project has no contact types configured yet. Add some in the
            Hierarchy editor first.
          </p>
        ) : (
          <>
            <label className="qtype-name-field">
              <span>Who/what is this form about?</span>
              <select
                ref={leafSelectRef}
                value={leafType}
                onChange={(e) => setLeafType(e.target.value)}
              >
                {leafOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {friendlyName(t.id, hierarchy.place_types_display)}
                    {t.person ? ' (person)' : ''}
                  </option>
                ))}
              </select>
            </label>

            {!props.formHasInputsContact && (
              <div className="lineage-builder-warn">
                <strong>Heads-up:</strong> this form doesn't have an{' '}
                <code>inputs/contact</code> group yet. The lineage block will be
                inserted at the cursor; you may want to use the Default app
                scaffold instead, which already includes the wrapping{' '}
                <code>inputs</code> block.
              </div>
            )}

            {block.warnings.length > 0 && (
              <div className="lineage-builder-warn">
                {block.warnings.map((w, i) => (
                  <div key={i}>⚠ {w}</div>
                ))}
              </div>
            )}

            <label className="qtype-name-field">
              <span>
                How many ancestor levels?{' '}
                <span className="muted small">
                  ({maxDepth} available — default is the full chain)
                </span>
              </span>
              <input
                type="number"
                min={0}
                max={maxDepth}
                value={depth}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  // Clamp so the spinner can't drive depth past maxDepth — the
                  // slicer in buildHierarchyBlock would silently cap there
                  // anyway, but clamping in the UI keeps the preview ladder
                  // and the depth value in agreement.
                  setDepth(Math.max(0, Math.min(maxDepth, Math.floor(n))));
                }}
              />
            </label>

            <div className="lineage-builder-preview">
              <div className="muted small">Preview (read top-to-bottom):</div>
              <pre className="lineage-builder-ladder">
                {renderPreviewLadder(
                  leafLabel,
                  block.chain,
                  hierarchy.place_types_display,
                  namePhoneByType,
                )}
              </pre>
              <p className="muted small">
                {describeBlockSize(block.rows.length, block.chain.length, leafLabel)}
              </p>
            </div>

            {block.chain.length > 0 && (
              <details
                className="lineage-builder-advanced"
                open={advancedOpen}
                // eslint-disable-next-line no-undef
                onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
              >
                <summary>
                  Advanced — include <code>name</code> + <code>phone</code> per
                  level
                </summary>
                <p className="muted small">
                  Default is <code>_id</code> only at every level (the dominant
                  case). Add <code>name</code> + <code>phone</code> for a level
                  if your tasks/reports need that contact's info.
                </p>
                {block.chain.map((typeId) => (
                  <label key={typeId} className="lineage-builder-toggle">
                    <input
                      type="checkbox"
                      checked={!!namePhoneByType[typeId]}
                      onChange={(e) =>
                        setNamePhoneByType((prev) => ({
                          ...prev,
                          [typeId]: e.target.checked,
                        }))
                      }
                    />
                    <span>
                      Include name + phone for{' '}
                      <strong>{friendlyName(typeId, hierarchy.place_types_display)}</strong>
                    </span>
                  </label>
                ))}
              </details>
            )}

            <div className="qtype-actions">
              <button className="link" onClick={props.onCancel}>
                Cancel
              </button>
              <button onClick={handleInsert} disabled={block.rows.length === 0}>
                {block.rows.length === 0
                  ? 'Nothing to insert'
                  : `Insert ${block.chain.length} level${block.chain.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Render the preview ladder — the plain-place-name chain the author will
 * see, top-to-bottom. The convention: top line is the contact itself
 * (what the form is about), each subsequent line is the next ancestor
 * outward. Matches reading order of the emitted block — outermost first
 * IS the leaf's immediate parent. The contact line goes first because
 * that's what the form is structurally about; the parents are the
 * surrounding context.
 */
function renderPreviewLadder(
  leafLabel: string,
  chain: string[],
  display: Record<string, string>,
  namePhoneByType: Record<string, boolean>,
): string {
  const lines: string[] = [];
  lines.push(`📋 ${leafLabel}  (the contact)`);
  for (let i = 0; i < chain.length; i++) {
    const label = friendlyName(chain[i]!, display);
    const indent = '  '.repeat(i + 1);
    const fields = namePhoneByType[chain[i]!]
      ? ' — _id + name + phone'
      : ' — _id';
    lines.push(`${indent}↳ ${label}${fields}`);
  }
  if (chain.length === 0) {
    lines.push(`  (no ancestor levels — depth 0)`);
  }
  return lines.join('\n');
}

function describeBlockSize(rowCount: number, depth: number, leafLabel: string): string {
  if (depth === 0) {
    return `Adds ${rowCount} hidden row${rowCount === 1 ? '' : 's'} (the contact link only — no ancestors).`;
  }
  return `Adds ${rowCount} hidden row${rowCount === 1 ? '' : 's'} that CHT fills in automatically (${leafLabel} + ${depth} ancestor level${depth === 1 ? '' : 's'}). Health workers won't see them.`;
}
