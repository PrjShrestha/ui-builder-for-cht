/**
 * One-click hierarchy-block codegen ("Add lineage") — emits the nested
 * `parent` chain that splices into the existing `inputs/contact` group,
 * sized by the form author's chosen leaf + depth.
 *
 * Plan: docs/plans/hierarchy-block-generator.md (v0.3, planner-locked
 * 2026-06-26). Pure codegen — no parser/serializer changes, no DOM, no
 * randomness, no Date.now() — every call with the same input produces
 * byte-identical output (per §6 + Decision §8.5).
 *
 * Why this exists: depth-at-runtime isn't possible (pyxform compiles a
 * static control tree; CHT hydrates values into the levels you pre-declare).
 * So the only way to surface ancestor-place data in a form is to author the
 * nested chain. This module is the deterministic author-time emitter.
 *
 * Crucial correctness bits (§2):
 *   - Depth is an AUTHOR CHOICE, not `place_hierarchy_types.length`.
 *   - Compute ancestors by re-walking `parentOf` from the chosen leaf, then
 *     **reverse** to outermost→innermost (leaf's immediate parent is the
 *     OUTERMOST `parent` group).
 *   - Source of truth = the `contact_types` parent tree, NOT
 *     `place_hierarchy_types` (which is a display hint and may omit a leaf-
 *     adjacent place like a household).
 *   - Person leaves map to their first place parent; we then walk that
 *     place's chain. `person.parents[0]` is a "permitted placement," not a
 *     lineage hint — surface a warning if there are multiple place parents.
 *   - Detect cycles + orphans; never emit a chain that would silently
 *     fabricate parents.
 *
 * The outermost `begin group parent` carries a `cht-ui-lineage:<sig>`
 * extras token so a later staleness check (§5) can detect a block built
 * against an older hierarchy without auto-rewriting it.
 */
import { type SurveyRow } from './types.js';

/** Subset of a `contact_types` entry this module reads. Matches the
 *  `ContactTypeLike` already exported from `hierarchyOrder.ts`; we accept
 *  a structurally-compatible shape so server + client callers don't need
 *  to convert between types. */
export interface ContactTypeNode {
  id: string;
  /** Allowed parent types — for places, the place's parent in the tree.
   *  For persons, the set of permitted placements (NOT a lineage). */
  parents?: string[];
  /** True for person types (excluded from `place_hierarchy_types`). */
  person?: boolean;
}

export interface LineageOptions {
  /** Which contact type the form is *about* — drives the ancestor chain.
   *  May be a person (we'll map to its first place parent) or a place. */
  leafType: string;
  /** How many ancestor `parent` groups to emit. Clamped to the chain
   *  length; 0 → no parent groups at all (still valid). */
  depth: number;
  /** Per-place-type-id toggles. When `true` for a type id, the
   *  corresponding `parent` group also includes hidden `name` and `phone`
   *  rows in addition to the always-present `_id`. Missing keys default
   *  off. */
  includeNamePhoneByType?: Record<string, boolean>;
  /** Optional friendly display names; only used for the staleness
   *  signature's stability hint, not for emitted labels (labels stay
   *  empty per scaffold convention). */
  displayNameByType?: Record<string, string>;
}

export interface LineageBlockResult {
  /** The parent-chain `SurveyRow[]` to splice at end-1 of the existing
   *  `inputs/contact` group. Empty when depth is 0 or the chain is empty. */
  rows: SurveyRow[];
  /** Place-type chain from outermost (leaf's immediate parent) to
   *  innermost. Used by the preview ladder + by the staleness signature.
   *  Length === number of begin/end `parent` group pairs in `rows`. */
  chain: string[];
  /** Diagnostics to surface in the UI (e.g. "this person has multiple
   *  place parents — using <X>; other branches won't be hydrated"). */
  warnings: string[];
  /** Deterministic signature for §5 staleness detection. Stamped onto
   *  the OUTERMOST begin-group's `extras['cht-ui-lineage']`. Identical
   *  inputs ⇒ identical signature. */
  signature: string;
}

/**
 * Walk a place-type id upward through its place-parent chain, collecting
 * ancestors in the order they're encountered (innermost-first). Stops at
 * the first cycle or when a node has no further place-parent. Returns the
 * raw chain; callers reverse + slice.
 */
function walkPlaceAncestorsUpward(
  startPlaceId: string,
  parentOf: Map<string, string | null>,
): { chain: string[]; cycle: boolean } {
  const chain: string[] = [];
  const seen = new Set<string>([startPlaceId]);
  let cursor: string | null = parentOf.get(startPlaceId) ?? null;
  while (cursor) {
    if (seen.has(cursor)) {
      // Cycle: stop here, surface as a diagnostic upstream.
      return { chain, cycle: true };
    }
    seen.add(cursor);
    chain.push(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return { chain, cycle: false };
}

/**
 * Build the place-only `parentOf` map (place → first place parent) from
 * a `contact_types` array. Person types are intentionally absent — they
 * are not part of the place chain. A place's first place-typed parent
 * wins (matches `deriveHierarchyOrder`'s tie-break + the visual tree).
 */
function buildPlaceParentOf(
  contactTypes: ContactTypeNode[],
): { parentOf: Map<string, string | null>; placeIds: Set<string> } {
  const placeIds = new Set(contactTypes.filter((t) => !t.person).map((t) => t.id));
  const parentOf = new Map<string, string | null>();
  for (const t of contactTypes) {
    if (t.person) continue;
    const placeParents = (t.parents ?? []).filter((p) => placeIds.has(p));
    parentOf.set(t.id, placeParents[0] ?? null);
  }
  return { parentOf, placeIds };
}

/**
 * Resolve the leaf's anchor place. For a place leaf this is the leaf
 * itself; for a person leaf this is the first place-typed parent (the
 * "permitted placement" tie-break, §2 Decision 4). Returns null if the
 * leaf type isn't in the contact_types array at all (orphan input —
 * upstream surfaces this as a warning).
 */
function resolveAnchorPlace(
  leafType: string,
  contactTypes: ContactTypeNode[],
  placeIds: Set<string>,
): { anchor: string | null; multiPlaceParents: boolean } {
  const node = contactTypes.find((t) => t.id === leafType);
  if (!node) return { anchor: null, multiPlaceParents: false };
  if (!node.person) {
    // Place leaf: the leaf IS the anchor — its OWN parent is the outermost
    // `parent` group. Walk from leafType's parent.
    return { anchor: leafType, multiPlaceParents: false };
  }
  // Person leaf: collect its place-typed parents; first wins, others warn.
  const placeParents = (node.parents ?? []).filter((p) => placeIds.has(p));
  if (placeParents.length === 0) return { anchor: null, multiPlaceParents: false };
  return {
    anchor: placeParents[0]!,
    multiPlaceParents: placeParents.length > 1,
  };
}

/**
 * Compute the outermost→innermost ancestor chain for a chosen leaf. The
 * chain is the list of `parent` group type ids the emitter will nest, in
 * order. Length is capped at `maxDepth`. Empty chain (depth 0 or no
 * ancestors) is valid and yields zero parent groups.
 *
 * Exposed for unit tests (§7 leaf-slice boundary, person multi-parent,
 * cycle/orphan guard) and for the live preview ladder.
 */
export function computeLineageChain(
  contactTypes: ContactTypeNode[],
  leafType: string,
  maxDepth: number,
): { chain: string[]; warnings: string[] } {
  const warnings: string[] = [];
  if (maxDepth <= 0) return { chain: [], warnings };

  const { parentOf, placeIds } = buildPlaceParentOf(contactTypes);
  const { anchor, multiPlaceParents } = resolveAnchorPlace(
    leafType,
    contactTypes,
    placeIds,
  );

  if (!anchor) {
    warnings.push(
      `Unknown or unanchored leaf type "${leafType}" — no ancestor chain emitted.`,
    );
    return { chain: [], warnings };
  }
  if (multiPlaceParents) {
    warnings.push(
      `Person type "${leafType}" has multiple permitted place parents; using the first listed. Other branches won't be hydrated by this form.`,
    );
  }

  // Walk the leaf's parents upward — the resulting list is already in the
  // order we emit (OUTERMOST first), because in CHT xpath terms a deeper
  // `/parent/parent/...` step goes UP the tree, so the FIRST upward step
  // (= the leaf's immediate parent) becomes the OUTERMOST `begin group
  // parent`, and the farthest ancestor becomes the INNERMOST nested group.
  //
  //   - place leaf: anchor === leafType, so we start from anchor's own
  //     parent (the leaf's IMMEDIATE parent is the outermost group).
  //   - person leaf: the leaf's first place parent IS the leaf's immediate
  //     parent in CHT semantics, so the anchor itself goes into the chain
  //     as the OUTERMOST entry, followed by its own ancestors.
  const leafNode = contactTypes.find((t) => t.id === leafType)!;
  const isPersonLeaf = !!leafNode.person;

  const outermostFirst: string[] = [];
  if (isPersonLeaf) {
    outermostFirst.push(anchor);
  }
  const walk = walkPlaceAncestorsUpward(anchor, parentOf);
  outermostFirst.push(...walk.chain);
  if (walk.cycle) {
    warnings.push(
      `Hierarchy contains a cycle reachable from "${anchor}" — truncating the chain at the first repeat.`,
    );
  }

  // Slice to the author's depth — keep the FIRST N (= closest ancestors).
  // Depth=1 → just the leaf's immediate parent; depth=2 → immediate +
  // grandparent; etc. Capping at the chain's natural length is implicit
  // in Array.slice's behaviour.
  const chain = outermostFirst.slice(0, maxDepth);

  return { chain, warnings };
}

/**
 * Stable signature for a generated lineage block. Stamped on the
 * outermost begin-group's `extras['cht-ui-lineage']` so a later check
 * (§5) can flag staleness when the hierarchy has shifted. Pure function
 * of inputs the generator actually consumes — re-arranging unrelated
 * contact types doesn't change the signature.
 */
export function lineageSignature(leafType: string, chain: string[]): string {
  // Compact, deterministic: leaf:chain[0]/chain[1]/...  No JSON, no
  // delimiters that occur in CHT type ids (which are kebab/underscore
  // alnum).
  return `${leafType}:${chain.join('/')}:v1`;
}

/**
 * The headline emitter. Returns the rows the editor should splice at
 * end-1 of the existing `inputs/contact` group. Caller is responsible
 * for the splice + the rowId-collision re-key on insert.
 *
 * Row shape per §3A:
 *   begin group parent  { cht-ui-lineage: <sig> }   // OUTERMOST ONLY
 *     hidden _id
 *     [hidden name, phone]                          // if per-level toggle on
 *     begin group parent
 *       hidden _id
 *       [hidden name, phone]
 *       ...                                         // nested to chain.length
 *     end group parent
 *   end group parent
 *
 * The block contains exactly `chain.length` begin/end `parent` pairs.
 * When `chain` is empty, returns zero rows (still a valid result —
 * the author chose depth 0 or the leaf has no ancestors).
 */
export function buildHierarchyBlock(
  contactTypes: ContactTypeNode[],
  opts: LineageOptions,
): LineageBlockResult {
  const { chain, warnings } = computeLineageChain(
    contactTypes,
    opts.leafType,
    opts.depth,
  );
  const signature = lineageSignature(opts.leafType, chain);
  const rows: SurveyRow[] = [];

  if (chain.length === 0) {
    return { rows, chain, warnings, signature };
  }

  const namePhoneOn = opts.includeNamePhoneByType ?? {};
  // Deterministic row-id scheme: lineage_<depth-index>_<role>. The caller
  // re-keys on splice to avoid collisions with existing survey rows
  // (matches the dnd-kit insert path that already does this for normal
  // question inserts).
  let cursor = 0;
  const seed = (role: string) => `lineage_${cursor}_${role}`;

  // Outermost-first emit; each level adds a begin group, its `_id` (+ name/
  // phone), then nests. We accumulate end-group rows on a stack and append
  // them in reverse at the end so depths line up without recursion.
  const closers: SurveyRow[] = [];
  for (let i = 0; i < chain.length; i++) {
    const placeType = chain[i]!;
    const isOutermost = i === 0;
    const beginExtras: Record<string, string> = {};
    if (isOutermost) {
      // Stamp the signature on the outermost begin only — one marker per
      // block keeps the file diff tight and the staleness scan O(N) over
      // begin-group rows.
      beginExtras['cht-ui-lineage'] = signature;
    }
    rows.push({
      rowId: seed('begin'),
      type: 'begin group',
      name: 'parent',
      labels: { en: '' },
      extras: beginExtras,
    });
    cursor++;
    rows.push({
      rowId: seed('id'),
      type: 'hidden',
      name: '_id',
      labels: { en: '' },
      extras: {},
    });
    cursor++;
    if (namePhoneOn[placeType]) {
      rows.push({
        rowId: seed('name'),
        type: 'hidden',
        name: 'name',
        labels: { en: '' },
        extras: {},
      });
      cursor++;
      rows.push({
        rowId: seed('phone'),
        type: 'hidden',
        name: 'phone',
        labels: { en: '' },
        extras: {},
      });
      cursor++;
    }
    // Hold the matching end-group; we'll append them all in reverse after
    // the nested begins are emitted, so the file reads outer→inner→close.
    closers.push({
      rowId: `lineage_close_${i}_end`,
      type: 'end group',
      name: 'parent',
      labels: { en: '' },
      extras: {},
    });
  }
  // Append closers in reverse so the innermost end is first (LIFO).
  for (let i = closers.length - 1; i >= 0; i--) {
    rows.push(closers[i]!);
  }
  return { rows, chain, warnings, signature };
}

/**
 * Read back the staleness signature from a survey, if present. Returns
 * the rowId of every begin-group carrying a `cht-ui-lineage` extras
 * token + the signature value, so the UI can compare to a freshly-
 * computed signature for the current hierarchy.
 */
export function findLineageSignatures(
  survey: SurveyRow[],
): Array<{ rowId: string; index: number; signature: string }> {
  const out: Array<{ rowId: string; index: number; signature: string }> = [];
  for (let i = 0; i < survey.length; i++) {
    const row = survey[i]!;
    const sig = row.extras['cht-ui-lineage'];
    if (sig) out.push({ rowId: row.rowId, index: i, signature: sig });
  }
  return out;
}

/**
 * Parse a signature string back into (leafType, chain). Returns null when
 * the format isn't recognized — defensive against signatures written by
 * future v2 generators or hand-edited files. Sister to
 * {@link lineageSignature}.
 */
export function parseLineageSignature(
  signature: string,
): { leafType: string; chain: string[]; version: string } | null {
  // Signature format: `<leafType>:<chain joined by />:<version>` e.g.
  // `chw:lvl6/lvl5/lvl4:v1`. Three colon-separated segments; the middle
  // one is the chain or empty when depth=0.
  const parts = signature.split(':');
  if (parts.length !== 3) return null;
  const [leafType, chainPart, version] = parts;
  if (!leafType || !version) return null;
  const chain = chainPart === '' ? [] : chainPart!.split('/');
  return { leafType, chain, version };
}

/**
 * Detect lineage blocks whose stamped signature no longer matches what
 * `buildHierarchyBlock` would emit for the CURRENT hierarchy. Used by
 * the editor to surface a "Lineage may be stale" badge per plan §5 —
 * NEVER auto-rewrites; the author re-opens the LineageBuilder modal to
 * regenerate at their own pace.
 *
 * "Stale" means: the embedded chain differs from the chain a fresh
 * computeLineageChain call (same leafType, same depth) would produce
 * today. Triggers include:
 *   - A type id was renamed (chain element changed).
 *   - A place was re-parented (chain element changed or order shifted).
 *   - The chosen leaf is no longer present (currentSignature is null).
 *   - The chain got shorter (the immediate parent type was removed).
 *
 * Returns an empty array when nothing is stale; the same row's badge
 * appears only when it's in the list.
 */
export function detectStaleLineageBlocks(
  survey: SurveyRow[],
  contactTypes: ContactTypeNode[],
): Array<{
  rowId: string;
  index: number;
  storedSignature: string;
  currentSignature: string | null;
  storedLeaf: string;
  storedChain: string[];
  currentChain: string[];
}> {
  const stale = [];
  for (const entry of findLineageSignatures(survey)) {
    const parsed = parseLineageSignature(entry.signature);
    if (!parsed) {
      // Unparseable signature — treat as stale so the user is nudged
      // to regenerate against the current generator. Don't drop it
      // silently.
      stale.push({
        rowId: entry.rowId,
        index: entry.index,
        storedSignature: entry.signature,
        currentSignature: null,
        storedLeaf: '',
        storedChain: [],
        currentChain: [],
      });
      continue;
    }
    const { chain: currentChain } = computeLineageChain(
      contactTypes,
      parsed.leafType,
      parsed.chain.length,
    );
    const currentSignature = lineageSignature(parsed.leafType, currentChain);
    if (currentSignature !== entry.signature) {
      stale.push({
        rowId: entry.rowId,
        index: entry.index,
        storedSignature: entry.signature,
        currentSignature,
        storedLeaf: parsed.leafType,
        storedChain: parsed.chain,
        currentChain,
      });
    }
  }
  return stale;
}
