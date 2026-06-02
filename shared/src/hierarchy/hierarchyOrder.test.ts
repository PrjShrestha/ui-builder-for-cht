/**
 * Tests for the topological derivation of place_hierarchy_types from the
 * parent graph. Defends Bhishan's hierarchy-insert bug — adding a new place
 * between two existing places must re-order the array correctly, not just
 * append the new id at the end.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  deriveHierarchyOrder,
  nudgeHierarchyPosition,
  type ContactTypeLike,
} from './hierarchyOrder.js';

function t(id: string, parents: string[] = [], person = false): ContactTypeLike {
  return { id, parents, person };
}

test('linear chain: district → muni → HF → CHW (person)', () => {
  const types = [
    t('district'),
    t('municipality', ['district']),
    t('health_facility', ['municipality']),
    t('chw', ['health_facility'], true),
  ];
  assert.deepEqual(
    deriveHierarchyOrder([], types),
    ['district', 'municipality', 'health_facility'],
  );
});

test('person types are excluded from the result', () => {
  const types = [t('district'), t('chw', ['district'], true)];
  assert.deepEqual(deriveHierarchyOrder([], types), ['district']);
});

test('insert ward between municipality and HF: new order has ward in the middle', () => {
  // Bhishan's exact bug: he adds `ward` with parent=municipality, then changes
  // HF parent to ward. The DERIVED order must reflect that.
  const types = [
    t('district'),
    t('municipality', ['district']),
    t('ward', ['municipality']),
    t('health_facility', ['ward']),
  ];
  const prev = ['district', 'municipality', 'health_facility'];
  assert.deepEqual(
    deriveHierarchyOrder(prev, types),
    ['district', 'municipality', 'ward', 'health_facility'],
  );
});

test('previous order is used as stable tie-breaker among siblings', () => {
  // Two roots — neither has a place parent. Previous order favored district
  // first, so it stays first.
  const types = [t('zone'), t('district')];
  assert.deepEqual(
    deriveHierarchyOrder(['district', 'zone'], types),
    ['district', 'zone'],
  );
  // Same types, swapped prev order, result follows.
  assert.deepEqual(
    deriveHierarchyOrder(['zone', 'district'], types),
    ['zone', 'district'],
  );
});

test('new id with no prev entry slots alphabetically among siblings', () => {
  const types = [t('alpha'), t('charlie'), t('bravo')];
  // No prev for these — alphabetical.
  assert.deepEqual(deriveHierarchyOrder([], types), ['alpha', 'bravo', 'charlie']);
});

test('multi-parent place follows first listed parent for the linear chain', () => {
  // A place type listing TWO place parents — we follow parents[0] like the
  // visual tree does.
  const types = [
    t('district'),
    t('zone'),
    t('outpost', ['district', 'zone']),
  ];
  // Outpost's first parent is district, so it sits under district.
  // zone and district are siblings (no place parents) — prev order stable.
  assert.deepEqual(
    deriveHierarchyOrder(['district', 'zone', 'outpost'], types),
    ['district', 'outpost', 'zone'],
  );
});

test('orphans from cycles append at the end without crashing', () => {
  const types = [t('a', ['b']), t('b', ['a'])];
  const result = deriveHierarchyOrder([], types);
  // Neither a nor b can be reached from a root — both end up as orphans.
  assert.deepEqual(result.sort(), ['a', 'b']);
});

test('person parents are ignored when computing place chain', () => {
  // A place lists a person as one of its parents — we ignore that for the
  // chain (people aren't in place_hierarchy_types).
  const types = [
    t('district'),
    t('chw', ['district'], true),
    t('clinic', ['chw', 'district']),
  ];
  // clinic's first place parent is district (chw is filtered out).
  assert.deepEqual(
    deriveHierarchyOrder([], types),
    ['district', 'clinic'],
  );
});

test('renaming an id is reflected even without prev hint', () => {
  // Renamed `g50_subarea` → `subarea` while keeping the same parents — the
  // result must contain the new id and not the old one.
  const types = [t('district'), t('subarea', ['district'])];
  const prev = ['district', 'g50_subarea'];
  const order = deriveHierarchyOrder(prev, types);
  assert.ok(!order.includes('g50_subarea'));
  assert.ok(order.includes('subarea'));
});

test('nudgeHierarchyPosition swaps with neighbour, ignores OOB', () => {
  assert.deepEqual(
    nudgeHierarchyPosition(['a', 'b', 'c'], 'b', -1),
    ['b', 'a', 'c'],
  );
  assert.deepEqual(
    nudgeHierarchyPosition(['a', 'b', 'c'], 'b', 1),
    ['a', 'c', 'b'],
  );
  // OOB no-op
  assert.deepEqual(
    nudgeHierarchyPosition(['a', 'b', 'c'], 'a', -1),
    ['a', 'b', 'c'],
  );
  // Unknown id no-op
  assert.deepEqual(
    nudgeHierarchyPosition(['a', 'b', 'c'], 'z', 1),
    ['a', 'b', 'c'],
  );
});
