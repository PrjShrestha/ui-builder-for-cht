/**
 * Vendored-dictionary acceptance gates. These tests run against whichever
 * `dictionaries/{systemId}.json` files exist — they pass cleanly when the
 * directory is empty (foundation commit) and tighten the bar as each
 * dictionary is snapshotted.
 *
 * Contracts pinned (mirror docs/plans/fhir-pack-population.md "Tests"):
 *   1. Every committed dictionary file passes the zero-SNOMED oracle
 *      (parsed + raw + alias channels).
 *   2. Every entry has a non-empty `code` and `display`.
 *   3. Entries are sorted by `code` — non-determinism in the snapshot is
 *      a regression (diff churn + bug risk).
 *   4. The committed shape matches the runtime `Dictionary` type
 *      (`assertDictionary` throws on violation).
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertDictionary, DICTIONARY_SYSTEM_URLS } from './dictionary.js';
import { scanForSnomed } from './snomedFilter.js';

function dictionariesDir(): string {
  // Resolve dual-path the same way starterPack.ts does — tests run from
  // dist/, but the source `dictionaries/` is the only home for the JSON
  // files (they aren't compiled).
  const here = import.meta.dirname;
  const candidates = [
    join(here, 'dictionaries'),
    join(here, '..', '..', 'src', 'fhir', 'dictionaries'),
  ];
  for (const c of candidates) {
    try {
      readdirSync(c);
      return c;
    } catch {
      // try next
    }
  }
  throw new Error('dictionaries/ directory not found in source or dist');
}

function listJsonFiles(): string[] {
  const dir = dictionariesDir();
  return readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => join(dir, n));
}

test('dictionaries: every committed file passes the zero-SNOMED oracle', () => {
  const files = listJsonFiles();
  if (files.length === 0) {
    // Foundation commit — no dictionaries vendored yet. Test passes
    // vacuously; CI will tighten as files land.
    return;
  }
  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const scan = scanForSnomed(parsed, raw);
    assert.equal(scan.found, false, `${f} contains SNOMED reference: ${scan.reason ?? ''}`);
  }
});

test('dictionaries: every committed file matches the Dictionary shape', () => {
  const files = listJsonFiles();
  for (const f of files) {
    const parsed = JSON.parse(readFileSync(f, 'utf8'));
    assertDictionary(parsed);
    // System URL agrees with the systemId — catches a mis-tagged source.
    assert.equal(
      parsed.system,
      DICTIONARY_SYSTEM_URLS[parsed.systemId],
      `${f}: system URL doesn't match systemId ${parsed.systemId}`,
    );
  }
});

test('dictionaries: entries are sorted by code + have non-empty code/display', () => {
  const files = listJsonFiles();
  for (const f of files) {
    const parsed = JSON.parse(readFileSync(f, 'utf8'));
    let prev = '';
    for (let i = 0; i < parsed.entries.length; i++) {
      const e = parsed.entries[i];
      assert.equal(typeof e.code, 'string', `${f}[${i}]: code must be string`);
      assert.equal(typeof e.display, 'string', `${f}[${i}]: display must be string`);
      assert.notEqual(e.code, '', `${f}[${i}]: empty code`);
      assert.notEqual(e.display.trim(), '', `${f}[${i}]: empty display`);
      assert.ok(Array.isArray(e.aliases), `${f}[${i}]: aliases must be array`);
      if (i > 0) {
        assert.ok(
          prev.localeCompare(e.code) <= 0,
          `${f}: entries not sorted by code (${prev} > ${e.code} at index ${i})`,
        );
      }
      prev = e.code;
    }
  }
});

test('dictionaries: sampled SNOMED scan over a random subset (CI defence in depth)', () => {
  // The "sampled check in CI" the plan calls out — pick 100 random entries
  // per dictionary and re-run the per-string scan. Equivalent to the full
  // scan above today but a useful gate if we ever short-circuit the full
  // pass for size.
  const files = listJsonFiles();
  for (const f of files) {
    const parsed = JSON.parse(readFileSync(f, 'utf8'));
    const total = parsed.entries.length;
    if (total === 0) continue;
    const sampleSize = Math.min(100, total);
    // Deterministic sample: every `step`th entry. Avoids `Math.random` so
    // the test can't false-pass-or-fail on rerun.
    const step = Math.max(1, Math.floor(total / sampleSize));
    for (let i = 0; i < total; i += step) {
      const e = parsed.entries[i];
      const scan = scanForSnomed(e, '');
      assert.equal(
        scan.found,
        false,
        `${f}[${i}] (code ${e.code}) contains SNOMED reference: ${scan.reason ?? ''}`,
      );
    }
  }
});
