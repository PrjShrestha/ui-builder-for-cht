/**
 * Regex sanity for the cht-conf error-pattern catalog. We don't try to
 * cover every real upstream stderr — just the canonical shapes Bhishan has
 * seen, plus the contract that the catalog never matches an empty string.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ERROR_PATTERNS, matchErrorPattern } from './errorPatterns.js';

test('every pattern has a non-empty id, regex, friendly fn', () => {
  for (const p of ERROR_PATTERNS) {
    assert.ok(p.id, 'pattern has id');
    assert.ok(p.regex instanceof RegExp, 'pattern has regex');
    assert.equal(typeof p.friendly, 'function', 'pattern has friendly fn');
  }
});

test('ids are unique', () => {
  const ids = ERROR_PATTERNS.map((p) => p.id);
  const unique = new Set(ids);
  assert.equal(ids.length, unique.size, 'pattern ids should be unique');
});

test('matchErrorPattern returns null on empty input', () => {
  assert.equal(matchErrorPattern(''), null);
});

test('matchErrorPattern returns null on innocuous stdout', () => {
  assert.equal(matchErrorPattern('Connecting to https://demo.cht.example/medic ...'), null);
  assert.equal(matchErrorPattern('✓ uploaded form: malaria_screening'), null);
});

test('matches a pyxform missing-required-column failure', () => {
  const line = `pyxform.error.PyXFormError: ValueError: missing required 'name' column on survey sheet.`;
  const r = matchErrorPattern(line);
  assert.ok(r, 'should match');
  assert.equal(r!.pattern.id, 'pyxform-missing-required-column');
});

test('matches the optional-chaining compile bug', () => {
  const line = `webpack: SyntaxError: Unexpected token '.' near contact-summary-extras.js:42:8`;
  const r = matchErrorPattern(line);
  assert.ok(r);
  assert.equal(r!.pattern.id, 'compile-optional-chaining');
  assert.ok(r!.pattern.knownUpstreamBug, 'flagged as known upstream bug');
});

test('matches 401 auth failure', () => {
  const r = matchErrorPattern('Request failed: 401 Unauthorized');
  assert.ok(r);
  assert.equal(r!.pattern.id, 'auth-failed');
});

test('matches ECONNREFUSED with host:port', () => {
  const r = matchErrorPattern(
    `Error: connect ECONNREFUSED 127.0.0.1:5984`,
  );
  assert.ok(r);
  assert.equal(r!.pattern.id, 'connection-refused');
});

test('matches DNS lookup failure', () => {
  const r = matchErrorPattern(
    `Error: getaddrinfo ENOTFOUND demo.invalid.example`,
  );
  assert.ok(r);
  assert.equal(r!.pattern.id, 'dns-failure');
});

test('matches port-in-use', () => {
  const r = matchErrorPattern(
    `Error: listen EADDRINUSE: address already in use :::5988`,
  );
  assert.ok(r);
  assert.equal(r!.pattern.id, 'port-in-use');
});

test('matches missing forms directory', () => {
  const r = matchErrorPattern(
    `Error: forms directory not found in project root`,
  );
  assert.ok(r);
  assert.equal(r!.pattern.id, 'no-forms-dir');
});

test('friendly + hint render without throwing on real matches', () => {
  const fixtures = [
    `webpack: SyntaxError: Unexpected token '.' near contact-summary-extras.js:1:1`,
    `Error: 401 Unauthorized`,
    `Error: connect ECONNREFUSED 127.0.0.1:5984`,
    `pyxform.error: missing required 'name' column`,
  ];
  for (const line of fixtures) {
    const r = matchErrorPattern(line);
    assert.ok(r, `expected match for ${line}`);
    const friendly = r!.pattern.friendly(r!.match);
    assert.ok(friendly.length > 0);
    if (r!.pattern.hint) {
      const hint = r!.pattern.hint(r!.match);
      assert.ok(hint.length > 0);
    }
  }
});
