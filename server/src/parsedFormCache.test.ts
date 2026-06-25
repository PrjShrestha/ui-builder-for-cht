/**
 * Regression tests for the parsed-form cache. The cache is the perf
 * chokepoint (docs/plans/perf-parse-cache.md Tier 1) that turns
 * `/api/fhir-mapping` warm reads from ~7 s into ~milliseconds. A stale
 * cache would silently feed a wrong-parsed form to consumers — these
 * tests are the critical-path guard the QA persona (Lorena) flagged.
 *
 * Acceptance contracts pinned here:
 *   1. First read parses + stores; second read returns the same instance.
 *   2. Cached value is deeply frozen (mutation attempt throws in strict).
 *   3. External edit changes mtime → next read re-parses automatically.
 *   4. Explicit `invalidate(path)` evicts and forces re-parse on next call.
 *   5. `directorySignature` changes when a file in the directory changes.
 *
 * The tests use a real round-trip: scaffold → serialize → write → cache,
 * matching the editor's save path so the regression caught here is the
 * one a user would hit.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildBlankFormScaffold, serializeXlsForm } from '@cht-ui/shared';
import {
  getParsedForm,
  invalidate,
  clearCache,
  directorySignature,
  _peek,
} from './parsedFormCache.js';

async function makeXlsx(dir: string, basename: string): Promise<string> {
  const form = buildBlankFormScaffold({ basename, category: 'app' });
  const buf = await serializeXlsForm(form);
  const p = path.join(dir, `${basename}.xlsx`);
  await fs.writeFile(p, buf);
  return p;
}

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'parsed-form-cache-'));
}

test('cache: first read parses + stores; second read returns same instance', async () => {
  clearCache();
  const dir = await tmpDir();
  const p = await makeXlsx(dir, 'pregnancy');
  const a = await getParsedForm(p);
  const b = await getParsedForm(p);
  assert.equal(a, b, 'second read must return the same instance (cache hit)');
  const entry = _peek(p);
  assert.ok(entry, 'cache entry must exist after first read');
});

test('cache: returned form is deep-frozen', async () => {
  clearCache();
  const dir = await tmpDir();
  const p = await makeXlsx(dir, 'frozen');
  const form = await getParsedForm(p);
  // Top-level frozen
  assert.ok(Object.isFrozen(form));
  // Arrays frozen
  assert.ok(Object.isFrozen(form.survey));
  assert.ok(Object.isFrozen(form.choices));
  // Rows frozen — assigning into one must throw in strict mode (ESM is
  // strict by default, so `node --test` runs this in strict).
  if (form.survey.length > 0) {
    assert.throws(
      () => {
        (form.survey[0] as { type: string }).type = 'mutated';
      },
      /(read.only|Cannot assign|frozen)/i,
    );
  }
});

test('cache: external edit (mtime change) triggers automatic re-parse', async () => {
  clearCache();
  const dir = await tmpDir();
  const p = await makeXlsx(dir, 'mtime_test');
  const a = await getParsedForm(p);
  const aEntry = _peek(p)!;

  // Bump mtime to simulate an external edit. We rewrite the file with
  // different content (a fresh scaffold under a different basename → a
  // different settings.form_id at least). Sleep is needed because
  // Windows mtime resolution can be coarser than test timing — but we
  // can also force a mtime via fs.utimes which is what we'll do.
  const future = new Date(Date.now() + 10_000);
  await fs.utimes(p, future, future);

  const b = await getParsedForm(p);
  // The instance pointer should be different (re-parsed).
  assert.notEqual(a, b, 'external mtime change must trigger a re-parse');
  const bEntry = _peek(p)!;
  assert.notEqual(aEntry.mtimeMs, bEntry.mtimeMs, 'cached entry mtime must reflect the new value');
});

test('cache: invalidate(path) forces re-parse on next call', async () => {
  clearCache();
  const dir = await tmpDir();
  const p = await makeXlsx(dir, 'invalidate_test');
  const a = await getParsedForm(p);
  assert.ok(_peek(p), 'entry exists before invalidate');
  invalidate(p);
  assert.equal(_peek(p), undefined, 'entry removed after invalidate');
  const b = await getParsedForm(p);
  assert.notEqual(a, b, 'next read after invalidate must re-parse (new instance)');
});

test('cache: edit→save (rewrite + invalidate) yields fresh bytes on next read', async () => {
  // Models the editor save flow in forms.ts PUT:
  //   serialize new bytes → fs.writeFile → invalidate(path) → next GET
  //   must return the new parse, not the cached old one.
  clearCache();
  const dir = await tmpDir();
  const p = await makeXlsx(dir, 'save_test');
  const before = await getParsedForm(p);
  // Modify the form, write it back. The scaffold's blank survey is
  // empty; add a row so the difference is observable.
  const next = buildBlankFormScaffold({ basename: 'save_test', category: 'app' });
  next.survey.push({
    rowId: 'r-new',
    type: 'text',
    name: 'added_field',
    labels: {},
    extras: {},
  });
  const buf = await serializeXlsForm(next);
  await fs.writeFile(p, buf);
  invalidate(p);

  const after = await getParsedForm(p);
  assert.notEqual(before, after, 'must be a fresh instance after invalidate + read');
  const beforeNames = before.survey.map((r) => r.name);
  const afterNames = after.survey.map((r) => r.name);
  assert.ok(
    !beforeNames.includes('added_field'),
    'sanity: before-bytes do not include the new field',
  );
  assert.ok(
    afterNames.includes('added_field'),
    'after re-read, the new field is parsed from the new bytes — no stale serialize',
  );
});

test('directorySignature: changes when a file in the directory changes', async () => {
  clearCache();
  const dir = await tmpDir();
  await makeXlsx(dir, 'a');
  await makeXlsx(dir, 'b');
  const sig1 = await directorySignature(dir);
  assert.ok(sig1, 'signature is non-empty for a directory with files');

  // Bump mtime on one file → signature must change.
  const future = new Date(Date.now() + 10_000);
  await fs.utimes(path.join(dir, 'a.xlsx'), future, future);
  const sig2 = await directorySignature(dir);
  assert.notEqual(sig1, sig2, 'changing a file mtime must change the signature');

  // Add a new file → signature must change again.
  await makeXlsx(dir, 'c');
  const sig3 = await directorySignature(dir);
  assert.notEqual(sig2, sig3, 'adding a file must change the signature');
});

test('directorySignature: stable when nothing changes', async () => {
  clearCache();
  const dir = await tmpDir();
  await makeXlsx(dir, 'stable');
  const sig1 = await directorySignature(dir);
  const sig2 = await directorySignature(dir);
  assert.equal(sig1, sig2, 'two stat passes with no change → identical signature');
});

test('directorySignature: missing directory → null (callers degrade)', async () => {
  const sig = await directorySignature(path.join(os.tmpdir(), 'nonexistent-' + Date.now()));
  assert.equal(sig, null);
});
