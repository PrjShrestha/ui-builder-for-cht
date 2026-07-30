/**
 * Derive a valid XLSForm-file basename from a human title. Mirrors the
 * "label-first, id auto-derived" pattern from Quick Hierarchy Creator +
 * AddTypeForm + ChoiceNameInput, applied to form-file creation.
 *
 * Previously, both the create dialog (`FormsIndex.tsx`) and the server
 * route (`forms.ts`) rejected non-identifier input rather than slugifying
 * — a non-coder typing "Patient Age" hit a cryptic error. This helper
 * makes the tool label-first: the user names the form ("Patient Age");
 * the tool derives the filename basename (`patient_age`); the human title
 * is what the CHT app UI shows.
 *
 * HYPHENS (audit P0-2, docs/reviews/waves-1-3-audit-2026-07-30.md): CHT
 * contact forms live on disk as `<type>-create.xlsx` / `<type>-edit.xlsx`
 * (see `buildContactForm.ts` `contactFormBasename` and the batch
 * generator's shape check). A slugify that folds every `-` to `_` makes
 * that contract impossible to satisfy manually — the dialog's own
 * placeholder "Household — create" would yield `household_create` and the
 * form would never be picked up as a contact form. `allowHyphens: true`
 * (used by the contact category) treats hyphens/en-/em-dashes in the
 * title as segment separators: each segment slugifies independently and
 * they re-join with `-`, so "Household — create" → `household-create`.
 *
 * @param title      human-facing form title (may contain spaces, punctuation,
 *                   Unicode). Empty / all-non-ASCII inputs return `''` — the
 *                   caller decides whether to prompt or error.
 * @param existing   basenames already taken in this project. Case-sensitive
 *                   match; the returned name is never in the set (numeric
 *                   suffix `_2`, `_3`, … appended until unique).
 * @param opts       `allowHyphens` — preserve hyphenated segments (contact
 *                   forms). Default `false` (app forms; XLSForm `form_id`
 *                   convention is underscore-only).
 * @returns `{ basename, collided }` — `collided:true` when a suffix was
 *          appended, so callers can surface "saved as `foo_2`" hints.
 */
import { slugifyHierarchyId } from '../hierarchy/buildLinearHierarchy.js';

export interface DerivedFormName {
  basename: string;
  collided: boolean;
}

export interface DeriveFormNameOptions {
  /** Preserve `-`-separated segments (CHT contact-form naming: `<type>-create`). */
  allowHyphens?: boolean;
}

/**
 * Slugify preserving hyphenated segments: split on ASCII hyphen and the
 * common typographic dashes (– —), slugify each side independently, and
 * re-join non-empty segments with `-`.
 */
export function slugifyWithHyphens(title: string): string {
  return title
    .split(/[-–—]+/)
    .map((seg) => slugifyHierarchyId(seg))
    .filter(Boolean)
    .join('-');
}

export function deriveFormName(
  title: string,
  existing: readonly string[] = [],
  opts: DeriveFormNameOptions = {},
): DerivedFormName {
  const slug = opts.allowHyphens ? slugifyWithHyphens(title) : slugifyHierarchyId(title);
  if (!slug) return { basename: '', collided: false };

  const taken = new Set(existing);
  if (!taken.has(slug)) return { basename: slug, collided: false };

  // Append the smallest numeric suffix that produces a name not in `existing`.
  // Starts at `_2` — the first collision means one already exists, so we're
  // creating the second. Cap the loop at a generous upper bound to keep this
  // pure and predictable; nobody should ever hit 100 collisions in practice.
  for (let i = 2; i < 1000; i++) {
    const candidate = `${slug}_${i}`;
    if (!taken.has(candidate)) return { basename: candidate, collided: true };
  }
  // Fell off the end — return the raw slug so the caller sees the intent;
  // the create step will fail its own "already exists" check.
  return { basename: slug, collided: true };
}
