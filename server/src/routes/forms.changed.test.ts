/**
 * Unit tests for parseGitPorcelain — the pure git-status parser that backs
 * the Deploy panel's "Select changed" quick-pick.
 * docs/plans/deploy-targeted-forms.md §3 + Tests section.
 *
 * We exercise the parser directly (no git subprocess, no Fastify) so tests
 * run fast and deterministically in CI without a real project on disk.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseGitPorcelain } from './forms.js';

test('parseGitPorcelain — empty output → empty array', () => {
  assert.deepEqual(parseGitPorcelain(''), []);
  assert.deepEqual(parseGitPorcelain('\n\n'), []);
});

test('parseGitPorcelain — modified app form', () => {
  const stdout = ' M forms/app/pregnancy.xlsx\n';
  const result = parseGitPorcelain(stdout);
  assert.deepEqual(result, [
    { category: 'app', basename: 'pregnancy', formId: 'app:pregnancy' },
  ]);
});

test('parseGitPorcelain — untracked contact form', () => {
  const stdout = '?? forms/contact/person.xlsx\n';
  const result = parseGitPorcelain(stdout);
  assert.deepEqual(result, [
    { category: 'contact', basename: 'person', formId: 'contact:person' },
  ]);
});

test('parseGitPorcelain — mixed app and contact, sorted by formId', () => {
  const stdout = [
    ' M forms/app/immunization.xlsx',
    'A  forms/contact/clinic.xlsx',
    ' M forms/app/death_report.xlsx',
  ].join('\n');
  const result = parseGitPorcelain(stdout);
  // localeCompare: 'a' < 'c' < 'i' → app:death_report, app:immunization, contact:clinic
  assert.deepEqual(result, [
    { category: 'app', basename: 'death_report', formId: 'app:death_report' },
    { category: 'app', basename: 'immunization', formId: 'app:immunization' },
    { category: 'contact', basename: 'clinic', formId: 'contact:clinic' },
  ]);
});

test('parseGitPorcelain — rename → only destination counted', () => {
  const stdout = 'R  forms/app/old_name.xlsx -> forms/app/new_name.xlsx\n';
  const result = parseGitPorcelain(stdout);
  assert.deepEqual(result, [
    { category: 'app', basename: 'new_name', formId: 'app:new_name' },
  ]);
});

test('parseGitPorcelain — duplicate lines deduped to one entry', () => {
  // e.g. both index and working-tree bits set (MM)
  const stdout = [
    'MM forms/app/pregnancy.xlsx',
    ' M forms/app/pregnancy.xlsx',
  ].join('\n');
  const result = parseGitPorcelain(stdout);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.formId, 'app:pregnancy');
});

test('parseGitPorcelain — non-xlsx files in forms/ ignored', () => {
  const stdout = [
    ' M forms/app/pregnancy.xml',
    ' M forms/app/pregnancy.properties.json',
    ' M forms/app/pregnancy.xlsx',
    ' M forms/README.md',
  ].join('\n');
  const result = parseGitPorcelain(stdout);
  assert.deepEqual(result, [
    { category: 'app', basename: 'pregnancy', formId: 'app:pregnancy' },
  ]);
});

test('parseGitPorcelain — files outside forms/ ignored', () => {
  const stdout = [
    ' M app_settings/base_settings.json',
    ' M tasks.js',
    ' M forms/app/malaria_screening.xlsx',
  ].join('\n');
  const result = parseGitPorcelain(stdout);
  assert.deepEqual(result, [
    { category: 'app', basename: 'malaria_screening', formId: 'app:malaria_screening' },
  ]);
});

test('parseGitPorcelain — quoted path (special chars) unwrapped correctly', () => {
  // git quotes paths that contain chars outside ASCII printable range or with spaces
  const stdout = `M  "forms/app/anc visit.xlsx"\n`;
  const result = parseGitPorcelain(stdout);
  assert.deepEqual(result, [
    { category: 'app', basename: 'anc visit', formId: 'app:anc visit' },
  ]);
});

test('parseGitPorcelain — sub-directories inside forms/app/ not matched', () => {
  // Only direct children of forms/app/ or forms/contact/ are valid form files
  const stdout = ' M forms/app/nested/child.xlsx\n';
  const result = parseGitPorcelain(stdout);
  assert.deepEqual(result, []);
});
