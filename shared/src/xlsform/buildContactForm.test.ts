/**
 * Test matrix for the contact-form generator (Decision B — minimal-valid).
 * Plan: docs/plans/contact-form-generator.md §5.
 *
 * What's pinned:
 *   1. Structure-match per (person/place × create/edit) — doc group
 *      named for the type, hidden parent + type, required name,
 *      person-create has sex + placement selector + no nested parent
 *      chain (variant-B guard).
 *   2. Choices completeness — every `select_*` row's `list_name` has a
 *      matching non-empty choices list.
 *   3. Round-trip — `parse(serialize(form))` byte-stable + all groups
 *      balanced.
 *   4. Determinism — same input → byte-identical output.
 *   5. Pathing/id format — basename hyphen, form_id colon, both via
 *      the dedicated helpers.
 *   6. Edit-only carried-row read_only — `_id`, `parent`, `type`,
 *      `meta.created_by*` all carry `read_only: 'true'`.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildContactForm, contactFormBasename } from './buildContactForm.js';
import { type ContactTypeNode } from './buildHierarchyBlock.js';
import { findStructuralViolations } from './structuralBalance.js';
import { parseXlsForm } from './parse.js';
import { serializeXlsForm } from './serialize.js';

/* =============================== fixtures =============================== */

/** Linear cht-default-shaped hierarchy: district → health_center → clinic
 *  + a person rooted at clinic. Mirrors the buildHierarchyBlock fixture. */
const linearTypes: ContactTypeNode[] = [
  { id: 'district_hospital' },
  { id: 'health_center', parents: ['district_hospital'] },
  { id: 'clinic', parents: ['health_center'] },
  { id: 'person', person: true, parents: ['clinic'] },
];

/* ============== test 1 — structure-match per variant ============== */

test('§5.1 — person-create: doc group named "person", required name + sex, placement selector', () => {
  const { form, warnings } = buildContactForm(linearTypes, {
    type: 'person',
    variant: 'create',
  });
  void warnings;
  // Find the doc-group begin (after inputs/user — index after the user end).
  const docOpenIdx = form.survey.findIndex(
    (r) => r.type === 'begin group' && r.name === 'person',
  );
  assert.ok(docOpenIdx > 0, 'doc group "person" must exist');

  // `parent` row + `type` row + required `name` row + sex.
  const docRows = form.survey.slice(docOpenIdx);
  const parent = docRows.find((r) => r.name === 'parent' && r.type === 'hidden');
  const type = docRows.find((r) => r.name === 'type' && r.type === 'hidden');
  const name = docRows.find((r) => r.name === 'name' && r.type === 'string');
  const sex = docRows.find(
    (r) => r.name === 'sex' && r.type === 'select_one male_female',
  );
  assert.ok(parent, 'hidden parent row present');
  assert.equal(parent!.extras['default'], 'clinic', 'parent default = resolved place parent');
  assert.ok(type, 'hidden type row present');
  assert.equal(type!.extras['default'], 'person', 'type default = type id');
  assert.ok(name, 'string name row present');
  assert.equal(name!.required, 'yes');
  assert.ok(sex, 'select_one sex present for person');
  assert.equal(sex!.required, 'yes');

  // Placement selector for person-create (typed for parent place).
  const placement = docRows.find(
    (r) => r.type === 'string' && r.extras['appearance']?.startsWith('select-contact'),
  );
  assert.ok(placement, 'person-create has a select-contact placement selector');
  assert.match(placement!.extras['appearance']!, /type-clinic/);

  // §5.1 variant-B guard: NO nested `parent` chain in a contact form
  // (that's buildHierarchyBlock's job for app forms). Confirm only ONE
  // hidden row named `parent` lives anywhere in the survey.
  const parentRows = form.survey.filter(
    (r) => r.name === 'parent' && r.type === 'hidden',
  );
  assert.equal(parentRows.length, 1, 'contact form must have exactly one hidden parent — no nested chain');
});

test('§5.1 — place-create (clinic): no sex, no placement selector, parent defaults to its parent place', () => {
  const { form } = buildContactForm(linearTypes, {
    type: 'clinic',
    variant: 'create',
  });
  const docOpenIdx = form.survey.findIndex(
    (r) => r.type === 'begin group' && r.name === 'clinic',
  );
  assert.ok(docOpenIdx > 0);

  const docRows = form.survey.slice(docOpenIdx);
  assert.equal(
    docRows.find((r) => r.name === 'sex'),
    undefined,
    'place form must NOT have a sex field',
  );
  assert.equal(
    docRows.find(
      (r) => r.type === 'string' && r.extras['appearance']?.startsWith('select-contact'),
    ),
    undefined,
    'place-create v1 omits the placement selector (Hybrid follow-up)',
  );
  const parent = docRows.find((r) => r.name === 'parent' && r.type === 'hidden');
  assert.equal(parent!.extras['default'], 'health_center');
});

test('§5.6 — person-edit carries read_only on _id / parent / type / created_by*', () => {
  const { form } = buildContactForm(linearTypes, {
    type: 'person',
    variant: 'edit',
  });
  // Edit forms include _id row at the doc group.
  const idRow = form.survey.find(
    (r) => r.name === '_id' && r.type === 'hidden',
  );
  assert.ok(idRow, 'edit form has hidden _id');
  assert.equal(idRow!.extras['read_only'], 'true');

  for (const name of ['parent', 'type', 'created_by', 'created_by_person_uuid', 'created_by_place_uuid']) {
    const row = form.survey.find((r) => r.name === name);
    assert.ok(row, `edit form has carried ${name}`);
    assert.equal(
      row!.extras['read_only'],
      'true',
      `${name} must carry read_only=true on edit`,
    );
  }

  // No required `sex` or `name` editing happens — but `name` is still
  // editable on edit (per real cht-default). Confirm it's NOT read-only
  // (the contact's name is the one thing a user changes via an edit).
  const nameRow = form.survey.find((r) => r.name === 'name' && r.type === 'string');
  assert.equal(nameRow!.extras['read_only'], undefined);
});

/* ============== test 2 — choices completeness ============== */

test('§5.2 — every select_* row has a matching non-empty choices list', () => {
  for (const variant of ['create', 'edit'] as const) {
    for (const type of ['person', 'clinic'] as const) {
      const { form } = buildContactForm(linearTypes, { type, variant });
      const listsByName = new Map<string, number>();
      for (const c of form.choices) {
        listsByName.set(c.list_name, (listsByName.get(c.list_name) ?? 0) + 1);
      }
      for (const r of form.survey) {
        const m = r.type.match(/^select_(one|multiple)\s+(\S+)/);
        if (!m) continue;
        const listName = m[2]!;
        const count = listsByName.get(listName) ?? 0;
        assert.ok(
          count > 0,
          `${type}-${variant}: select_${m[1]} ${listName} has no choices`,
        );
      }
    }
  }
});

/* ============== test 3 — round-trip + balance ============== */

test('§5.3 — every (type × variant) emits a structurally balanced form', () => {
  for (const variant of ['create', 'edit'] as const) {
    for (const type of ['person', 'clinic', 'health_center', 'district_hospital']) {
      const { form } = buildContactForm(linearTypes, { type, variant });
      const v = findStructuralViolations(form.survey);
      assert.deepEqual(
        v,
        [],
        `${type}-${variant} must be structurally balanced (got ${v.map((x) => x.message).join('; ')})`,
      );
    }
  }
});

test('§5.3 — round-trip byte-stable through parse/serialize', async () => {
  const { form } = buildContactForm(linearTypes, {
    type: 'person',
    variant: 'create',
  });
  const xlsx = await serializeXlsForm(form);
  const reparsed = await parseXlsForm(xlsx);
  // Row count + (type, name) match.
  assert.equal(reparsed.survey.length, form.survey.length, 'row count survives round-trip');
  for (let i = 0; i < form.survey.length; i++) {
    assert.equal(reparsed.survey[i]!.type, form.survey[i]!.type, `row ${i} type`);
    assert.equal(reparsed.survey[i]!.name, form.survey[i]!.name, `row ${i} name`);
  }
  // Choices preserved.
  assert.equal(reparsed.choices.length, form.choices.length);
});

/* ============== test 4 — determinism ============== */

test('§5.4 — same input → byte-identical output', () => {
  const a = buildContactForm(linearTypes, { type: 'person', variant: 'create' });
  const b = buildContactForm(linearTypes, { type: 'person', variant: 'create' });
  assert.deepEqual(a.form, b.form);
});

/* ============== test 5 — pathing / id format ============== */

test('§5.5 — basename hyphen, form_id colon', () => {
  assert.equal(contactFormBasename('person', 'create'), 'person-create');
  assert.equal(contactFormBasename('health_center', 'edit'), 'health_center-edit');
  const { form } = buildContactForm(linearTypes, { type: 'person', variant: 'create' });
  assert.equal(form.settings.form_id, 'contact:person:create');
  const { form: editForm } = buildContactForm(linearTypes, { type: 'clinic', variant: 'edit' });
  assert.equal(editForm.settings.form_id, 'contact:clinic:edit');
});

test('§5.5 — basename matches the parseFormId-safe regex', () => {
  for (const type of ['person', 'clinic', 'health_center', 'district_hospital']) {
    for (const variant of ['create', 'edit'] as const) {
      assert.match(contactFormBasename(type, variant), /^[a-zA-Z0-9_-]+$/);
    }
  }
});

/* ============== warnings — root + orphan ============== */

test('warns when a non-person type has no place parent (root place)', () => {
  const { warnings } = buildContactForm(linearTypes, {
    type: 'district_hospital',
    variant: 'create',
  });
  assert.ok(
    warnings.some((w) => /no place parent/.test(w)),
    `expected a "no place parent" warning, got ${JSON.stringify(warnings)}`,
  );
});

test('warns when a person has no place parent', () => {
  const types: ContactTypeNode[] = [
    { id: 'orphan_person', person: true, parents: [] },
  ];
  const { warnings } = buildContactForm(types, {
    type: 'orphan_person',
    variant: 'create',
  });
  assert.ok(
    warnings.some((w) => /omit the placement selector/i.test(w)),
    `expected an orphan-person warning, got ${JSON.stringify(warnings)}`,
  );
});

test('warns on unknown leaf type', () => {
  const { warnings } = buildContactForm(linearTypes, {
    type: 'does_not_exist',
    variant: 'create',
  });
  assert.ok(
    warnings.some((w) => /not defined/i.test(w)),
    `expected an unknown-type warning, got ${JSON.stringify(warnings)}`,
  );
});

/* ============ Bug A — created_by* / last_edited_by* XPath depth ============ */

/**
 * The meta calculates sit at /data/<type>/meta/<field>; to reach
 * /data/inputs/user/<x> they need THREE `../` hops, not two. cht-default
 * `person-create.xlsx` has the identical nesting and uses the same
 * three-hop path. A two-hop emit resolves to /data/<type>/inputs/... which
 * doesn't exist → silently empty `created_by*` on every saved contact
 * (audit-trail gap). docs/handoff-contact-form-bugs-2026-06-28.md §A.
 */
function metaCalcOf(form: ReturnType<typeof buildContactForm>['form'], name: string): string {
  const row = form.survey.find((r) => r.name === name && r.type === 'calculate');
  if (!row) throw new Error(`expected a calculate row named ${name}`);
  return row.extras['calculation'] ?? '';
}

test('Bug A — person-create meta calcs use the three-hop ../../../inputs/user/<x> path', () => {
  const { form } = buildContactForm(linearTypes, { type: 'person', variant: 'create' });
  assert.equal(metaCalcOf(form, 'created_by'), '../../../inputs/user/name');
  assert.equal(metaCalcOf(form, 'created_by_person_uuid'), '../../../inputs/user/contact_id');
  assert.equal(metaCalcOf(form, 'created_by_place_uuid'), '../../../inputs/user/facility_id');
});

test('Bug A — place-create meta calcs use the three-hop path (every type variant)', () => {
  for (const t of ['district_hospital', 'health_center', 'clinic'] as const) {
    const { form } = buildContactForm(linearTypes, { type: t, variant: 'create' });
    assert.equal(
      metaCalcOf(form, 'created_by'),
      '../../../inputs/user/name',
      `place ${t} created_by`,
    );
    assert.equal(
      metaCalcOf(form, 'created_by_person_uuid'),
      '../../../inputs/user/contact_id',
      `place ${t} created_by_person_uuid`,
    );
    assert.equal(
      metaCalcOf(form, 'created_by_place_uuid'),
      '../../../inputs/user/facility_id',
      `place ${t} created_by_place_uuid`,
    );
  }
});

test('Bug A — edit forms emit last_edited_by* with the same three-hop path', () => {
  const { form } = buildContactForm(linearTypes, { type: 'person', variant: 'edit' });
  assert.equal(metaCalcOf(form, 'last_edited_by'), '../../../inputs/user/name');
  assert.equal(
    metaCalcOf(form, 'last_edited_by_person_uuid'),
    '../../../inputs/user/contact_id',
  );
});

test('Bug A — no meta calc anywhere uses the buggy two-hop ../../inputs/user/<x> path', () => {
  // Guard against regression on any (type, variant). If any emit ever
  // drops a hop again, this catches it across the whole matrix.
  for (const t of ['person', 'district_hospital', 'health_center', 'clinic'] as const) {
    for (const v of ['create', 'edit'] as const) {
      const { form } = buildContactForm(linearTypes, { type: t, variant: v });
      for (const row of form.survey) {
        if (row.type !== 'calculate') continue;
        const calc = row.extras['calculation'] ?? '';
        assert.doesNotMatch(
          calc,
          /^\.\.\/\.\.\/inputs\/user\//,
          `${t} ${v} row ${row.name} uses the two-hop path: ${calc}`,
        );
      }
    }
  }
});
