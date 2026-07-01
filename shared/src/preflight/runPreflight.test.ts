/**
 * Tests for the top-level runner (ordering + composition).
 *
 * Pins:
 *   - runs every rule pack
 *   - severity desc (error → warn → info); rule id alphabetical within severity
 *   - deterministic across repeated calls
 *   - does not mutate the input context (referential identity preserved)
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { runPreflight } from './index.js';
import { choiceRow, mkForm, surveyRow } from './rules/testFixtures.js';
import type { PreflightContext } from './types.js';

function makeContext(): PreflightContext {
  const form = mkForm(
    [
      surveyRow('integer', 'age'),
      // Triggers xlsform-identifiers (space) AND select-choices (missing list).
      surveyRow('select_one gender', 'gender field'),
      // Triggers dangling-refs.
      surveyRow('note', 'msg', { relevant: '${unknown}' }),
    ],
    [choiceRow('other', 'x')],
    'app',
  );
  return {
    forms: [{ formId: 'app', xlsform: form }],
    // Missing a required error-file + a warn-file → two required-files results.
    requiredFiles: { present: [], missing: ['targets.js', '.eslintrc'] },
  };
}

test('runs every registered rule and produces results', () => {
  const results = runPreflight(makeContext());
  const ruleIds = new Set(results.map((r) => r.ruleId));
  assert.ok(ruleIds.has('required-files'));
  assert.ok(ruleIds.has('xlsform-identifiers'));
  assert.ok(ruleIds.has('select-choices'));
  assert.ok(ruleIds.has('dangling-refs'));
});

test('ordering: severity desc, then ruleId alphabetical', () => {
  const results = runPreflight(makeContext());
  // Verify severity groups are contiguous and in the right order.
  const rank = { error: 0, warn: 1, info: 2 } as const;
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1]!;
    const curr = results[i]!;
    const prevRank = rank[prev.severity];
    const currRank = rank[curr.severity];
    assert.ok(prevRank <= currRank, `severity out of order at index ${i}`);
    if (prevRank === currRank) {
      assert.ok(prev.ruleId <= curr.ruleId, `ruleId out of order at index ${i}: ${prev.ruleId} vs ${curr.ruleId}`);
    }
  }
});

test('deterministic — two runs on the same input produce deep-equal reports', () => {
  const ctx = makeContext();
  const a = runPreflight(ctx);
  const b = runPreflight(ctx);
  assert.deepEqual(a, b);
});

test('does not mutate the input context', () => {
  const ctx = makeContext();
  const formBefore = ctx.forms[0]!.xlsform;
  const surveyRef = formBefore.survey;
  const choicesRef = formBefore.choices;
  const settingsRef = formBefore.settings;
  runPreflight(ctx);
  assert.equal(ctx.forms[0]!.xlsform, formBefore);
  assert.equal(ctx.forms[0]!.xlsform.survey, surveyRef);
  assert.equal(ctx.forms[0]!.xlsform.choices, choicesRef);
  assert.equal(ctx.forms[0]!.xlsform.settings, settingsRef);
});

test('empty context → empty results', () => {
  const results = runPreflight({ forms: [], requiredFiles: null });
  assert.deepEqual(results, []);
});
