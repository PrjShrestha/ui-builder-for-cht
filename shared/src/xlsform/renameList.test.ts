/**
 * Round-trip / correctness tests for token-aware list rename on the survey
 * `type` cell. Critical because a naive string replace would wipe trailing
 * tokens like `or_other`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { extractListName, renameListInType } from './renameList.js';

test('extractListName: returns the list_name on select_one', () => {
  assert.equal(extractListName('select_one yes_no'), 'yes_no');
});

test('extractListName: returns the list_name on select_multiple', () => {
  assert.equal(extractListName('select_multiple symptoms'), 'symptoms');
});

test('extractListName: returns the list_name on rank', () => {
  assert.equal(extractListName('rank priorities'), 'priorities');
});

test('extractListName: returns undefined on text', () => {
  assert.equal(extractListName('text'), undefined);
});

test('extractListName: returns the list_name even with or_other trailing', () => {
  assert.equal(extractListName('select_one yes_no or_other'), 'yes_no');
});

test('extractListName: tolerates extra whitespace', () => {
  assert.equal(extractListName('  select_one   yes_no  '), 'yes_no');
});

test('renameListInType: basic rename', () => {
  assert.equal(renameListInType('select_one yes_no', 'yes_no', 'yn'), 'select_one yn');
});

test('renameListInType: preserves or_other trailing token (critical)', () => {
  assert.equal(
    renameListInType('select_one yes_no or_other', 'yes_no', 'yn'),
    'select_one yn or_other',
  );
});

test('renameListInType: preserves multiple trailing tokens', () => {
  assert.equal(
    renameListInType('select_one yes_no or_other foo', 'yes_no', 'yn'),
    'select_one yn or_other foo',
  );
});

test('renameListInType: select_multiple', () => {
  assert.equal(
    renameListInType('select_multiple symptoms', 'symptoms', 'sx'),
    'select_multiple sx',
  );
});

test('renameListInType: select_multiple with or_other', () => {
  assert.equal(
    renameListInType('select_multiple symptoms or_other', 'symptoms', 'sx'),
    'select_multiple sx or_other',
  );
});

test('renameListInType: rank type', () => {
  assert.equal(renameListInType('rank priorities', 'priorities', 'p'), 'rank p');
});

test('renameListInType: leaves non-list types alone', () => {
  assert.equal(renameListInType('text', 'foo', 'bar'), 'text');
  assert.equal(renameListInType('integer', 'foo', 'bar'), 'integer');
  assert.equal(renameListInType('date', 'foo', 'bar'), 'date');
});

test('renameListInType: leaves selects with a different list_name alone', () => {
  assert.equal(
    renameListInType('select_one other_list', 'foo', 'bar'),
    'select_one other_list',
  );
});

test('renameListInType: no-op when oldName equals newName', () => {
  assert.equal(renameListInType('select_one foo', 'foo', 'foo'), 'select_one foo');
});

test('renameListInType: returns empty string unchanged', () => {
  assert.equal(renameListInType('', 'foo', 'bar'), '');
});

test('renameListInType: normalises whitespace but preserves order', () => {
  assert.equal(
    renameListInType('  select_one   yes_no   or_other  ', 'yes_no', 'yn'),
    'select_one yn or_other',
  );
});

test('renameListInType: tolerates mixed-case prefix and preserves its casing', () => {
  // XLSForm parsers tolerate "Select_One" as well as "select_one". We accept
  // both for the prefix check but leave the prefix's original case alone.
  assert.equal(
    renameListInType('Select_One yes_no', 'yes_no', 'yn'),
    'Select_One yn',
  );
});
