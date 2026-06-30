/**
 * Pure scaffold for the Quick Hierarchy Creator wizard
 * (docs/plans/quick-hierarchy-creator.md).
 *
 * One-shot wizard for the empty template: the author lists their place
 * levels top→bottom + one person leaf, and this module shapes the data
 * that the existing `PUT /api/hierarchy` route persists. **No new parser
 * surface** — `place_hierarchy_types` is still derived by the canonical
 * `deriveHierarchyOrder`, and `contact_types` use the same shape
 * `AddTypeForm` already writes.
 *
 * Validation rules (plan §7):
 *   - Slug collision = block; never auto-suffix (would orphan
 *     place_hierarchy_types if the user later renames).
 *   - Empty/whitespace name → invalid; reject before scaffold.
 *   - Devanagari / non-ASCII name → require explicit ASCII id (no silent
 *     auto-transliteration). Friendly label keeps the Unicode text.
 *   - Duplicate FRIENDLY name across rows is a warning (different ids
 *     are legal); duplicate derived id is a block.
 *
 * Linear-only intent (plan §2 / §10): forks/branching stay in the full
 * HierarchyEditor.
 */

import type { ContactTypeLike } from './hierarchyOrder.js';
import { deriveHierarchyOrder } from './hierarchyOrder.js';

/* ------------------------------ types ----------------------------------- */

export interface QuickHierarchyLevel {
  /**
   * The friendly label the user typed. Kept verbatim (Unicode preserved)
   * — flows into `place_types_display` for places, and is what the UI
   * shows under the row.
   */
  name: string;
  /**
   * Explicit ASCII id. When provided non-empty, this wins over the
   * derived id (lets users with Devanagari labels still produce a
   * deployable config). Empty/missing → derive from `name`.
   */
  explicitId?: string;
}

export interface QuickHierarchyInput {
  /** Place levels top → bottom. Must contain at least one entry. */
  places: QuickHierarchyLevel[];
  /** The pinned person leaf at the bottom of the chain. */
  person: QuickHierarchyLevel;
  /**
   * Types already present on disk (for the collision check). Pass `[]`
   * for the empty-template flow; pass the live `contact_types` if the
   * wizard ever runs against a non-empty project (gated elsewhere, but
   * the validator must enforce it anyway — defence in depth).
   */
  existing: ContactTypeLike[];
}

export interface QuickHierarchyValidationError {
  /** Either the place-row index (0-based) or `'person'`. */
  row: number | 'person';
  code:
    | 'empty_name'
    | 'invalid_explicit_id'
    | 'devanagari_needs_id'
    | 'duplicate_id'
    | 'collision_with_existing';
  message: string;
}

export interface QuickHierarchyValidationWarning {
  row: number | 'person';
  code: 'duplicate_label';
  message: string;
}

export interface QuickHierarchyContactType {
  id: string;
  name_key: string;
  icon: string;
  person?: boolean;
  parents?: string[];
  create_form?: string;
  edit_form?: string;
}

export interface QuickHierarchyResult {
  contact_types: QuickHierarchyContactType[];
  place_hierarchy_types: string[];
  place_types_display: Record<string, string>;
}

export type QuickHierarchyOutcome =
  | { ok: true; result: QuickHierarchyResult; warnings: QuickHierarchyValidationWarning[] }
  | { ok: false; errors: QuickHierarchyValidationError[]; warnings: QuickHierarchyValidationWarning[] };

/* ---------------------- slugify + id derivation ------------------------- */

const VALID_ID_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Derive an ASCII id from a friendly label. Lowercases, replaces any
 * non-`[a-z0-9_]` run with a single underscore, strips leading digits/
 * underscores so the first char is alphabetic. Returns `''` if the
 * label is empty after stripping (the caller should then surface the
 * Unicode-needs-explicit-id error).
 */
export function slugifyHierarchyId(name: string): string {
  const lowered = name.toLowerCase().normalize('NFKD');
  // Strip combining marks (e.g. Devanagari conjuncts) and keep only a-z0-9; non-matches become '_'.
  const ascii = lowered
    .split('')
    .map((ch) => {
      if (/[a-z0-9]/.test(ch)) return ch;
      // Discard everything else — combining marks, punctuation, Devanagari, CJK, etc.
      return '_';
    })
    .join('');
  const collapsed = ascii.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  // First char must be alpha — strip any leading non-alpha (digits or
  // underscores that surfaced after digit-stripping in e.g. "2024 Cohort").
  const trimmed = collapsed.replace(/^[^a-z]+/, '');
  return trimmed;
}

function resolveId(level: QuickHierarchyLevel): string {
  const explicit = (level.explicitId ?? '').trim();
  if (explicit) return explicit;
  return slugifyHierarchyId(level.name.trim());
}

/* --------------------------- validation --------------------------------- */

/**
 * Inspect the input WITHOUT building. Use this to drive inline errors
 * in the modal so Continue is correctly enabled/disabled.
 */
export function validateQuickHierarchy(
  input: QuickHierarchyInput,
): { errors: QuickHierarchyValidationError[]; warnings: QuickHierarchyValidationWarning[] } {
  const errors: QuickHierarchyValidationError[] = [];
  const warnings: QuickHierarchyValidationWarning[] = [];

  if (input.places.length === 0) {
    // Special-case the all-removed state — the UI surfaces a helper, no per-row error.
    return { errors, warnings };
  }

  const rows: Array<{ row: number | 'person'; level: QuickHierarchyLevel }> = [
    ...input.places.map((p, i) => ({ row: i as number, level: p })),
    { row: 'person' as const, level: input.person },
  ];

  // Empty / explicit-id-shape per row.
  for (const { row, level } of rows) {
    const trimmedName = level.name.trim();
    const explicit = (level.explicitId ?? '').trim();
    if (!trimmedName && !explicit) {
      errors.push({ row, code: 'empty_name', message: 'Enter a name (or an explicit id).' });
      continue;
    }
    if (explicit) {
      if (!VALID_ID_RE.test(explicit)) {
        errors.push({
          row,
          code: 'invalid_explicit_id',
          message: `Id "${explicit}" must match ^[a-z][a-z0-9_]*$ — lowercase letters, digits, underscores; start with a letter.`,
        });
      }
    } else {
      const derived = slugifyHierarchyId(trimmedName);
      if (!derived) {
        // Name has no ASCII letters/digits — typical for Devanagari / Tibetan / CJK.
        errors.push({
          row,
          code: 'devanagari_needs_id',
          message: `Name "${trimmedName}" produces no ASCII id. Set an explicit id (lowercase letters, digits, underscores).`,
        });
      } else if (!VALID_ID_RE.test(derived)) {
        // Slugified, but couldn't recover a leading letter — surface as invalid_explicit_id.
        errors.push({
          row,
          code: 'invalid_explicit_id',
          message: `Derived id "${derived}" must start with a letter. Set an explicit id.`,
        });
      }
    }
  }

  // Cross-row duplicate-id check (only resolve ids for rows that already passed shape checks).
  const ids = new Map<string, number | 'person'>();
  for (const { row, level } of rows) {
    const id = resolveId(level);
    if (!id || !VALID_ID_RE.test(id)) continue;
    const prev = ids.get(id);
    if (prev !== undefined) {
      errors.push({
        row,
        code: 'duplicate_id',
        message: `Id "${id}" is already used by another row. Slug-collision: rename or set an explicit id.`,
      });
    } else {
      ids.set(id, row);
    }
  }

  // Collision against existing on-disk types.
  const existingIds = new Set(input.existing.map((t) => t.id));
  for (const { row, level } of rows) {
    const id = resolveId(level);
    if (!id || !VALID_ID_RE.test(id)) continue;
    if (existingIds.has(id)) {
      errors.push({
        row,
        code: 'collision_with_existing',
        message: `Id "${id}" already exists in the project. Pick another.`,
      });
    }
  }

  // Duplicate friendly labels (different ids) — warning only.
  const labels = new Map<string, number | 'person'>();
  for (const { row, level } of rows) {
    const trimmed = level.name.trim();
    if (!trimmed) continue;
    const prev = labels.get(trimmed);
    if (prev !== undefined) {
      warnings.push({
        row,
        code: 'duplicate_label',
        message: `Label "${trimmed}" matches another row — ids must differ.`,
      });
    } else {
      labels.set(trimmed, row);
    }
  }

  return { errors, warnings };
}

/* ------------------------------ build ----------------------------------- */

/**
 * Validate + scaffold. Returns either the persistable triple or the
 * collected errors. Callers (the modal) should already have called
 * `validateQuickHierarchy` to drive inline state; the build re-runs the
 * check anyway so a stale UI can't push invalid data to disk.
 */
export function buildQuickHierarchy(input: QuickHierarchyInput): QuickHierarchyOutcome {
  const { errors, warnings } = validateQuickHierarchy(input);
  if (input.places.length === 0) {
    errors.push({
      row: 0,
      code: 'empty_name',
      message: 'Add at least one place level before continuing.',
    });
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  const placeIds = input.places.map(resolveId);
  const personId = resolveId(input.person);

  const contact_types: QuickHierarchyContactType[] = [];
  const place_types_display: Record<string, string> = {};

  for (let i = 0; i < input.places.length; i++) {
    const level = input.places[i]!;
    const id = placeIds[i]!;
    const trimmedName = level.name.trim();
    const parentId = i === 0 ? undefined : placeIds[i - 1];
    const row: QuickHierarchyContactType = {
      id,
      name_key: `contact.type.${id}`,
      icon: '',
      create_form: `form:contact:${id}:create`,
      edit_form: `form:contact:${id}:edit`,
    };
    if (parentId) row.parents = [parentId];
    contact_types.push(row);
    // Only set place-types display when the user actually typed a label
    // (so the empty-string path doesn't write `{id: ''}` to disk).
    if (trimmedName) place_types_display[id] = trimmedName;
  }

  // Person leaf — parents = [last place id], strictly linear (plan §5).
  // ALSO writes create_form / edit_form so the type is actually
  // creatable in CHT. Without these, the app shows no "+ New <person>"
  // affordance inside the parent place — the type exists but can't be
  // added to. cht-default's `person` type ships both fields, and the
  // contact-form generator emits matching create/edit form files for
  // person types just like it does for places.
  const personRow: QuickHierarchyContactType = {
    id: personId,
    name_key: `contact.type.${personId}`,
    icon: '',
    person: true,
    create_form: `form:contact:${personId}:create`,
    edit_form: `form:contact:${personId}:edit`,
  };
  const lastPlaceId = placeIds[placeIds.length - 1];
  if (lastPlaceId) personRow.parents = [lastPlaceId];
  contact_types.push(personRow);

  // Re-derive `place_hierarchy_types` via the canonical helper so the
  // sibling-stable, person-excluded contract is honored end-to-end.
  const place_hierarchy_types = deriveHierarchyOrder([], contact_types);

  return {
    ok: true,
    result: {
      contact_types,
      place_hierarchy_types,
      place_types_display,
    },
    warnings,
  };
}
