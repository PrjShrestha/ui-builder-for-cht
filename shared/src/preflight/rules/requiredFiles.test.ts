/**
 * Tests for the required-files rule.
 *
 * Pins:
 *   - the six required paths generate expected severities (error vs warn)
 *   - a null probe skips the rule (no results, not "everything failing")
 *   - present-and-missing lists are honored (only missing → results)
 *   - each result carries a stub-file fix hint
 *   - REQUIRED_FILE_PATHS is the stable allowlist (server route consumes it)
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { runRequiredFilesRule, REQUIRED_FILE_PATHS } from './requiredFiles.js';
import type { PreflightContext } from '../types.js';

function ctx(present: string[], missing: string[]): PreflightContext {
  return { forms: [], requiredFiles: { present, missing } };
}

test('null probe → rule is skipped (empty results)', () => {
  const results = runRequiredFilesRule({ forms: [], requiredFiles: null });
  assert.deepEqual(results, []);
});

test('empty missing → no results', () => {
  const results = runRequiredFilesRule(ctx(['targets.js', 'tasks.js'], []));
  assert.deepEqual(results, []);
});

test('missing targets.js → error result with stub-file fix', () => {
  const results = runRequiredFilesRule(ctx([], ['targets.js']));
  assert.equal(results.length, 1);
  const r = results[0]!;
  assert.equal(r.ruleId, 'required-files');
  assert.equal(r.severity, 'error');
  assert.equal(r.affectedItemId, 'targets.js');
  assert.deepEqual(r.fix, { kind: 'stub-file', path: 'targets.js' });
});

test('missing .eslintrc → warn (not error)', () => {
  const results = runRequiredFilesRule(ctx([], ['.eslintrc']));
  assert.equal(results.length, 1);
  assert.equal(results[0]!.severity, 'warn');
});

test('missing resources.json → warn (soft)', () => {
  const results = runRequiredFilesRule(ctx([], ['resources.json']));
  assert.equal(results.length, 1);
  assert.equal(results[0]!.severity, 'warn');
  assert.equal(results[0]!.affectedItemId, 'resources.json');
});

test('missing app_settings/base_settings.json → error', () => {
  const results = runRequiredFilesRule(ctx([], ['app_settings/base_settings.json']));
  assert.equal(results.length, 1);
  assert.equal(results[0]!.severity, 'error');
});

test('mixed missing → each result maps 1:1', () => {
  const missing = ['targets.js', '.eslintrc', 'resources.json'];
  const results = runRequiredFilesRule(ctx([], missing));
  assert.equal(results.length, 3);
  const paths = results.map((r) => r.affectedItemId).sort();
  assert.deepEqual(paths, ['.eslintrc', 'resources.json', 'targets.js']);
});

test('unknown paths in missing → ignored (only allowlisted files emit results)', () => {
  const results = runRequiredFilesRule(ctx([], ['not-required.txt', 'targets.js']));
  assert.equal(results.length, 1);
  assert.equal(results[0]!.affectedItemId, 'targets.js');
});

test('REQUIRED_FILE_PATHS is the allowlist the server route should consume', () => {
  // Sanity-check: the five files locked into the plan are all present.
  const expected = [
    'targets.js',
    'tasks.js',
    'app_settings/base_settings.json',
    '.eslintrc',
    'resources.json',
  ];
  for (const p of expected) {
    assert.ok(REQUIRED_FILE_PATHS.includes(p), `expected ${p} in REQUIRED_FILE_PATHS`);
  }
  assert.equal(REQUIRED_FILE_PATHS.length, expected.length);
});
