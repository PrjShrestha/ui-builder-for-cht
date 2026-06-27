/**
 * Per-type contact-form generator — closes the dangling `create_form` /
 * `edit_form` contract that `AddTypeForm` already writes for every place
 * type added via the Hierarchy editor (HierarchyEditor.tsx). Without this,
 * defining a type silently promises forms that don't exist.
 *
 * Plan: docs/plans/contact-form-generator.md v0.1, Decision B
 * (minimal-valid + extensible). Pairs with `onboarding-order.md` Decision 4
 * (offered, never auto).
 *
 * Pure codegen — no fs, no Date.now(), no random. The server route stamps
 * `version`; the route is also responsible for skip-existing semantics.
 * `parse(serialize(form))` is byte-stable for every emitted form (the
 * round-trip contract every shared scaffold honors).
 *
 * Non-negotiables (plan §3) honored here:
 *   - Pathing/id split: server writes `<type>-create.xlsx` (hyphen) on
 *     disk; this module sets `settings.form_id = 'contact:<type>:create'`
 *     (colon) — the in-file id matches real cht-default templates + the
 *     `create_form` / `edit_form` string AddTypeForm wrote.
 *   - Choices are load-bearing: every `select_*` row in the emitted
 *     survey HAS a matching non-empty choices list in this module's
 *     output. v1 emits English-only `male_female` + `yes_no` (the only
 *     lists the minimal-valid spec uses). Real cht-default ships these
 *     in 7 locales; loading the verbatim-with-translations lists from
 *     the bundled templates is a v1.1 follow-up — flagged as TODO below.
 *   - Edit forms emit `read_only` on carried/hydrated rows (`_id`,
 *     `parent`, `type`, `meta.created_by*`).
 *   - Deterministic rowIds: `cf_<seq>_<role>` — caller is responsible for
 *     re-keying on splice into other surveys, but contact-form generation
 *     writes new files only (no splice), so deterministic IDs are fine.
 */
import { type ChoiceRow, type SurveyRow, type XLSForm } from './types.js';
import { type ContactTypeNode } from './buildHierarchyBlock.js';

export interface BuildContactFormOptions {
  /** Contact-type id (matches a `contact_types[].id`). */
  type: string;
  /** Create vs edit. */
  variant: 'create' | 'edit';
  /** Friendly display name for labels — falls back to humanised `type` id. */
  displayName?: string;
  /** Locales the produced form should declare — defaults to `['en']`. */
  locales?: string[];
}

export interface BuildContactFormReport {
  /** The emitted form, ready for `serializeXlsForm`. */
  form: XLSForm;
  /** Warnings for the modal preview — e.g. a place type with no parent. */
  warnings: string[];
}

/**
 * Surveys for the contact-form generator carry more columns than the
 * thin `buildContactFormScaffold`: every minimal-valid form uses
 * `required`, `relevant`, `calculation`, `appearance`, `default`, and
 * (edit only) `read_only`. Listing them up front fixes column order so
 * the diff against existing cht-default forms is human-readable.
 */
const CONTACT_GENERATOR_HEADERS = [
  'type',
  'name',
  'label::en',
  'required',
  'relevant',
  'calculation',
  'appearance',
  'default',
  'read_only',
];

/** Humanise a `snake_case` type id ("health_center" → "Health Center"). */
function humanise(typeId: string): string {
  return typeId
    .split(/[_-]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/** Resolve the first place-type parent for a type id. Mirrors
 *  `buildHierarchyBlock`'s person-leaf semantics: a person's
 *  `parents[0]` filtered to place ids; a place's `parents[0]` filtered
 *  to place ids. Returns null for root places (no warning — that's
 *  legal) and for orphan/unknown types (the caller surfaces a warning
 *  upstream). */
function resolveParentPlace(
  contactTypes: ContactTypeNode[],
  typeId: string,
): string | null {
  const placeIds = new Set(
    contactTypes.filter((t) => !t.person).map((t) => t.id),
  );
  const node = contactTypes.find((t) => t.id === typeId);
  if (!node) return null;
  const placeParents = (node.parents ?? []).filter((p) => placeIds.has(p));
  return placeParents[0] ?? null;
}

/* ------------------------------ choices ------------------------------ */

/**
 * TODO(v1.1) — load verbatim from `server/templates/cht-default/forms/
 * contact/person-create.xlsx` to preserve the 7 locales the cht-default
 * templates ship. v1 minimal-valid emits English-only; the author can
 * extend in-editor. Skip-existing semantics on the generator route mean
 * a v1.1 re-run won't clobber a project that has localised these.
 */
const MINIMAL_CHOICES_EN: Array<{ list: string; name: string; label: string }> = [
  { list: 'yes_no', name: 'yes', label: 'Yes' },
  { list: 'yes_no', name: 'no', label: 'No' },
  { list: 'male_female', name: 'male', label: 'Male' },
  { list: 'male_female', name: 'female', label: 'Female' },
];

function buildChoicesForVariant(
  isPerson: boolean,
  variant: 'create' | 'edit',
): ChoiceRow[] {
  // The minimal-valid spec uses `select_one sex` (person only). For
  // place forms and edit forms we still emit `male_female` for stability
  // (so a person-edit can be created later without re-introducing the
  // list); cheap, deterministic.
  void variant;
  void isPerson;
  return MINIMAL_CHOICES_EN.map((c, i) => ({
    rowId: `cf_choice_${i}`,
    list_name: c.list,
    name: c.name,
    labels: { en: c.label },
    extras: {},
  }));
}

/* -------------------------------- rows -------------------------------- */

/** Build a SurveyRow with sensible defaults — mirrors `scaffolds.ts:row`
 *  shape so the emitted forms diff cleanly against the existing
 *  scaffolds. */
function row(
  rowIdSeed: string,
  type: string,
  name: string,
  label: string,
  extras: Record<string, string> = {},
  required: string | undefined = undefined,
): SurveyRow {
  return {
    rowId: rowIdSeed,
    type,
    name,
    labels: label ? { en: label } : { en: '' },
    extras,
    ...(required ? { required } : {}),
  };
}

/**
 * Emit the per-variant survey rows for a single type. The doc group
 * is named EXACTLY the contact_type id (real cht-default convention —
 * `person`, `clinic`, etc.). `inputs/user` is the standard harvest
 * block (`relevant=false()` so the user submitting it never sees it
 * but the calculates can read its values).
 */
function buildSurvey(
  opts: BuildContactFormOptions,
  parentPlaceId: string | null,
  isPerson: boolean,
): SurveyRow[] {
  const { type, variant } = opts;
  const display = opts.displayName?.trim() || humanise(type);
  let seq = 0;
  const r = (
    t: string,
    name: string,
    label: string,
    extras: Record<string, string> = {},
    required: string | undefined = undefined,
  ) => row(`cf_${seq++}_${name || t.replace(/\s+/g, '_')}`, t, name, label, extras, required);

  const isCreate = variant === 'create';
  const survey: SurveyRow[] = [];

  // ──── inputs/user — the standard harvest block. relevant=false()
  // hides it from the runtime UI; meta calculates still read it. Mirrors
  // every real cht-default contact form.
  survey.push(r('begin group', 'inputs', '', { relevant: 'false()' }));
  survey.push(r('begin group', 'user', ''));
  survey.push(r('hidden', 'contact_id', 'User contact id'));
  survey.push(r('hidden', 'facility_id', 'User facility id'));
  survey.push(r('hidden', 'name', 'Username'));
  survey.push(r('end group', 'user', ''));
  survey.push(r('end group', 'inputs', ''));

  // ──── doc group, named EXACTLY the contact_type id. This is the
  // saved document. `parent` defaults to the resolved place parent so
  // CHT places the contact correctly under the hierarchy.
  survey.push(r('begin group', type, display, { appearance: 'field-list' }));

  if (!isCreate) {
    // Edit-only carried fields: `_id` is the document id (must be
    // hidden + read-only so the author can't accidentally change it).
    survey.push(
      r('hidden', '_id', `${display} id`, { read_only: 'true' }),
    );
  }

  // `parent` is always hidden; on create it defaults to the resolved
  // parent place id (so a CHW creating a Household lands it under their
  // own facility, etc.). On edit it's carried + read-only.
  survey.push(
    r(
      'hidden',
      'parent',
      'Parent place id',
      isCreate
        ? parentPlaceId
          ? { default: parentPlaceId }
          : {}
        : { read_only: 'true' },
    ),
  );

  // `type` is always carried; on create it defaults to the type id; on
  // edit it's read-only.
  survey.push(
    r(
      'hidden',
      'type',
      'Contact type',
      isCreate ? { default: type } : { read_only: 'true' },
    ),
  );

  // `name` is the only universally-required field on a contact doc.
  // pyxform / CHT use the `name` field as the contact's display name in
  // selectors.
  survey.push(
    r(
      'string',
      'name',
      `${display} name`,
      {},
      'yes',
    ),
  );

  if (isPerson && isCreate) {
    // Placement on create (person only): the author picks who the
    // person belongs to via a select-contact selector. v1 keeps it
    // simple — a single selector typed for the parent place.
    if (parentPlaceId) {
      survey.push(
        r(
          'string',
          '_id_placement',
          'Place this person under',
          { appearance: `select-contact type-${parentPlaceId}` },
          'yes',
        ),
      );
    }
    // person-only sex field — minimal-valid spec calls this out.
    // The list-name suffix matches the `male_female` choices the
    // generator ships below (and the cht-default convention).
    survey.push(
      r('select_one male_female', 'sex', 'Sex', {}, 'yes'),
    );
  }
  // For place create we deliberately OMIT the primary-contact selector
  // here (Decision B v1; primary-contact is a Hybrid follow-up block).
  // For place edit we just hydrate — same minimal shape as person edit.

  // ──── meta sub-group: created_by* (create) and last_edited_by* (edit).
  // Hidden + calculate; on create the calculates read inputs/user;
  // on edit `created_by*` is carried (hidden + read-only) and we add
  // `last_edited_by*`.
  survey.push(r('begin group', 'meta', '', { appearance: 'hidden' }));
  if (isCreate) {
    survey.push(
      r('calculate', 'created_by', '', { calculation: '../../inputs/user/name' }),
    );
    survey.push(
      r('calculate', 'created_by_person_uuid', '', {
        calculation: '../../inputs/user/contact_id',
      }),
    );
    survey.push(
      r('calculate', 'created_by_place_uuid', '', {
        calculation: '../../inputs/user/facility_id',
      }),
    );
  } else {
    // Edit: carry the existing created_by* (hidden + read-only) and
    // add last_edited_by*.
    survey.push(r('hidden', 'created_by', '', { read_only: 'true' }));
    survey.push(r('hidden', 'created_by_person_uuid', '', { read_only: 'true' }));
    survey.push(r('hidden', 'created_by_place_uuid', '', { read_only: 'true' }));
    survey.push(
      r('calculate', 'last_edited_by', '', { calculation: '../../inputs/user/name' }),
    );
    survey.push(
      r('calculate', 'last_edited_by_person_uuid', '', {
        calculation: '../../inputs/user/contact_id',
      }),
    );
  }
  survey.push(r('end group', 'meta', ''));

  survey.push(r('end group', type, ''));

  return survey;
}

/**
 * Build a minimal-valid contact form for the given `type, variant`.
 *
 * The server route is responsible for serializing this to xlsx, writing
 * the file (skip-existing!), and setting `version`. This module is pure
 * codegen.
 */
export function buildContactForm(
  contactTypes: ContactTypeNode[],
  opts: BuildContactFormOptions,
): BuildContactFormReport {
  const warnings: string[] = [];
  const node = contactTypes.find((t) => t.id === opts.type);
  if (!node) {
    warnings.push(
      `Type "${opts.type}" is not defined in the project's contact_types. The generated form will still work, but lineage-aware tooling will treat it as orphaned.`,
    );
  }
  const isPerson = !!node?.person;
  const parentPlaceId = resolveParentPlace(contactTypes, opts.type);
  if (!parentPlaceId && !isPerson) {
    // A place with no place-parent is normally a root (district_hospital);
    // surface a non-blocking note so the author confirms that's intentional.
    warnings.push(
      `Place type "${opts.type}" has no place parent — treated as a top-level place (the create form's hidden \`parent\` will be empty). If this isn't a root, set its parent in the Hierarchy editor.`,
    );
  } else if (!parentPlaceId && isPerson) {
    warnings.push(
      `Person type "${opts.type}" has no place parent — the create form will omit the placement selector. Add a place parent in the Hierarchy editor so the person can be placed under a contact.`,
    );
  }

  const locales = opts.locales && opts.locales.length > 0 ? opts.locales : ['en'];
  const survey = buildSurvey(opts, parentPlaceId, isPerson);
  const choices = buildChoicesForVariant(isPerson, opts.variant);

  const display = opts.displayName?.trim() || humanise(opts.type);
  const variantLabel = opts.variant === 'create' ? 'Create' : 'Edit';
  const form: XLSForm = {
    locales,
    surveyHeaders: {
      ordered: CONTACT_GENERATOR_HEADERS,
      labelLocales: ['en'],
    },
    choicesHeaders: {
      ordered: ['list_name', 'name', 'label::en'],
      labelLocales: ['en'],
    },
    survey,
    choices,
    settings: {
      // Title is shown in the contact-creation flow in CHT. Keep it
      // human; CHT's UI doesn't surface form_id directly.
      form_title: `${display} (${variantLabel.toLowerCase()})`,
      // form_id is the CONTRACT side — `contact:<type>:create|edit`
      // matches real cht-default templates + the `create_form` /
      // `edit_form` strings AddTypeForm wrote into `contact_types`.
      // Colon-separated, deliberately different from the disk basename
      // (which uses hyphens for `parseFormId` compatibility).
      form_id: `contact:${opts.type}:${opts.variant}`,
      // Generator is deterministic — the route stamps `version`.
      version: '',
      default_language: locales[0]!,
      extras: {},
    },
    extraSheets: [],
  };

  return { form, warnings };
}

/**
 * Helper exposed for the UI preview: derive the on-disk basename for a
 * `(type, variant)` pair. Hyphen-separated so `parseFormId` (which
 * splits on the LAST colon to get category) can still recover
 * `contact:<basename>` from the saved sidecar.
 */
export function contactFormBasename(type: string, variant: 'create' | 'edit'): string {
  return `${type}-${variant}`;
}
