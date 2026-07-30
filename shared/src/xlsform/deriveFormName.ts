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
 * @param title      human-facing form title (may contain spaces, punctuation,
 *                   Unicode). Empty / all-non-ASCII inputs return `''` — the
 *                   caller decides whether to prompt or error.
 * @param existing   basenames already taken in this project. Case-sensitive
 *                   match; the returned name is never in the set (numeric
 *                   suffix `_2`, `_3`, … appended until unique).
 * @returns `{ basename, collided }` — `collided:true` when a suffix was
 *          appended, so callers can surface "saved as `foo_2`" hints.
 */
import { slugifyHierarchyId } from '../hierarchy/buildLinearHierarchy.js';

export interface DerivedFormName {
  basename: string;
  collided: boolean;
}

export function deriveFormName(title: string, existing: readonly string[] = []): DerivedFormName {
  const slug = slugifyHierarchyId(title);
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
