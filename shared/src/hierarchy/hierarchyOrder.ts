/**
 * Derive `place_hierarchy_types` order from contact-type parent relationships.
 *
 * The CHT `place_hierarchy_types` array is conceptually a linear chain
 * (district → municipality → health_facility → ...). Each place type has at
 * most one place-type parent in that chain (people can have multiple parent
 * places — e.g. a CHW lives under any HF — but places themselves form a
 * tree). The old logic just appended new ids to the end and never re-derived,
 * which meant editing a place's parent in the tree silently left the array
 * stale on disk.
 *
 * This module computes a topologically-correct linear order:
 *   - roots first (place types whose `parents` contains no other place type)
 *   - then each root's place-type children, depth-first
 *   - stable tie-breaking: preserve the previous array's relative order for
 *     siblings, then fall back to alphabetical
 *   - any orphans / cycle-survivors append at the end
 *
 * Person types are excluded from the result (they never appear in
 * `place_hierarchy_types`).
 */

export interface ContactTypeLike {
  id: string;
  parents?: string[];
  person?: boolean;
}

/**
 * Re-derive `place_hierarchy_types` from the current `contact_types` array,
 * using `prev` only for stable sibling ordering.
 *
 * @param prev   The previous on-disk order. Used as a stable hint, NOT a
 *               source of truth.
 * @param types  The current contact_types.
 */
export function deriveHierarchyOrder(prev: string[], types: ContactTypeLike[]): string[] {
  const places = types.filter((t) => !t.person);
  const placeIds = new Set(places.map((t) => t.id));

  // First place-type parent of each place. If a place has multiple place
  // parents we follow the first listed one for the linear chain — matching
  // the visual tree which also uses parents[0].
  const parentOf = new Map<string, string | null>();
  for (const t of places) {
    const placeParents = (t.parents ?? []).filter((p) => placeIds.has(p));
    parentOf.set(t.id, placeParents[0] ?? null);
  }

  const prevIdx = new Map<string, number>();
  prev.forEach((id, i) => prevIdx.set(id, i));

  function siblingSort(a: ContactTypeLike, b: ContactTypeLike): number {
    const ai = prevIdx.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bi = prevIdx.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.id.localeCompare(b.id);
  }

  const childrenOf = new Map<string, ContactTypeLike[]>();
  for (const t of places) {
    const parent = parentOf.get(t.id);
    if (parent) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent)!.push(t);
    }
  }
  for (const kids of childrenOf.values()) kids.sort(siblingSort);

  const roots = places.filter((t) => parentOf.get(t.id) === null).sort(siblingSort);

  const result: string[] = [];
  const visited = new Set<string>();
  function walk(t: ContactTypeLike) {
    if (visited.has(t.id)) return;
    visited.add(t.id);
    result.push(t.id);
    for (const k of childrenOf.get(t.id) ?? []) walk(k);
  }
  for (const r of roots) walk(r);

  // Orphans from cycles or self-referencing nodes — append in `prev` order
  // first, then alphabetical, so the result stays stable.
  const orphans = places.filter((t) => !visited.has(t.id)).sort(siblingSort);
  for (const o of orphans) result.push(o.id);

  return result;
}

/**
 * Swap one place id with its neighbour in the place_hierarchy_types array.
 * Returns a new array; original is untouched. No-op if the swap is illegal
 * (out of bounds or the neighbour is a non-sibling parent/child).
 */
export function nudgeHierarchyPosition(
  order: string[],
  id: string,
  direction: -1 | 1,
): string[] {
  const idx = order.indexOf(id);
  if (idx < 0) return order;
  const target = idx + direction;
  if (target < 0 || target >= order.length) return order;
  const next = [...order];
  const a = next[idx];
  const b = next[target];
  next[idx] = b!;
  next[target] = a!;
  return next;
}
