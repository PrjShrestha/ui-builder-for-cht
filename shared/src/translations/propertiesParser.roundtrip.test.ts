/**
 * Round-trip + edit tests for the `.properties` parser.
 *
 * Run: `pnpm --filter @cht-ui/shared build && pnpm --filter @cht-ui/shared test`
 *
 * The bar these tests defend:
 *   - parse(source) → serialize equals source byte-for-byte when nothing was
 *     edited (byte-stable across mixed CRLF/LF, escaped keys, native UTF-8,
 *     continuation lines, and \uXXXX-encoded values).
 *   - updateProperty on an existing key rewrites ONLY that entry's line;
 *     every other line is byte-identical after serialize.
 *   - Appending a new key lands at end-of-file and preserves the file's
 *     trailing state.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseProperties, serializeProperties, updateProperty } from './propertiesParser.js';

test('simple key=value round-trip is byte-stable (LF)', () => {
  const src = 'foo = bar\nbaz = qux\n';
  assert.equal(serializeProperties(parseProperties(src)), src);
});

test('simple key=value round-trip is byte-stable (CRLF)', () => {
  const src = 'foo = bar\r\nbaz = qux\r\n';
  assert.equal(serializeProperties(parseProperties(src)), src);
});

test('comments + blank lines are preserved verbatim', () => {
  const src = '# top comment\r\n! bang comment\r\n\r\nfoo = bar\r\n\r\n# trailing\r\n';
  assert.equal(serializeProperties(parseProperties(src)), src);
});

test('continuation lines round-trip verbatim when unedited', () => {
  const src = 'multi = line one \\\r\n  line two \\\r\n  line three\r\nnext = ok\r\n';
  const parsed = parseProperties(src);
  const entry = parsed.find((l) => l.kind === 'entry' && l.key === 'multi');
  assert.ok(entry && entry.kind === 'entry');
  assert.equal(entry.value, 'line one line two line three');
  assert.equal(serializeProperties(parsed), src);
});

test('value escapes (\\n, \\t, \\uXXXX) decode and re-emit verbatim when unedited', () => {
  // é = é, 中 = 中
  const src = 'greet = hi\\nthere\\ttab\r\nunicode = caf\\u00e9 \\u4e2d\r\n';
  const parsed = parseProperties(src);
  const greet = parsed.find((l) => l.kind === 'entry' && l.key === 'greet');
  const uni = parsed.find((l) => l.kind === 'entry' && l.key === 'unicode');
  assert.ok(greet && greet.kind === 'entry');
  assert.ok(uni && uni.kind === 'entry');
  assert.equal(greet.value, 'hi\nthere\ttab');
  assert.equal(uni.value, 'café 中');
  assert.equal(serializeProperties(parsed), src);
});

test('non-ASCII native UTF-8 in keys and values round-trips byte-for-byte', () => {
  const src = 'नमस्ते = नमस्कार\r\ncontact.type.district = जिल्ला\r\n';
  const parsed = parseProperties(src);
  const hi = parsed.find((l) => l.kind === 'entry' && l.key === 'नमस्ते');
  assert.ok(hi && hi.kind === 'entry');
  assert.equal(hi.value, 'नमस्कार');
  assert.equal(serializeProperties(parsed), src);
});

test('escaped-space key (District\\ Hospital) parses to logical key', () => {
  const src = 'District\\ Hospital = Health Facility\r\n';
  const parsed = parseProperties(src);
  const entry = parsed.find((l) => l.kind === 'entry');
  assert.ok(entry && entry.kind === 'entry');
  assert.equal(entry.key, 'District Hospital');
  assert.equal(entry.value, 'Health Facility');
  assert.equal(serializeProperties(parsed), src);
});

test('updateProperty on existing key rewrites only that line', () => {
  const src =
    '# comment\r\n' +
    'first = one\r\n' +
    'target = old value\r\n' +
    'trailing = keep\r\n' +
    '\r\n' +
    'after.blank = still here\r\n';
  const parsed = parseProperties(src);
  const updated = updateProperty(parsed, 'target', 'new value');
  const out = serializeProperties(updated);
  const expected =
    '# comment\r\n' +
    'first = one\r\n' +
    'target = new value\r\n' +
    'trailing = keep\r\n' +
    '\r\n' +
    'after.blank = still here\r\n';
  assert.equal(out, expected);
});

test('updateProperty appends a brand-new key at end-of-file with matching terminator', () => {
  const src = 'first = one\r\nsecond = two\r\n';
  const out = serializeProperties(updateProperty(parseProperties(src), 'third', 'three'));
  assert.equal(out, 'first = one\r\nsecond = two\r\nthird = three\r\n');
});

test('updateProperty on a file without a trailing newline adds one before appending', () => {
  const src = 'first = one\r\nsecond = two';
  const out = serializeProperties(updateProperty(parseProperties(src), 'third', 'three'));
  assert.equal(out, 'first = one\r\nsecond = two\r\nthird = three\r\n');
});

test('updateProperty preserves escaped key form when editing its value', () => {
  const src = 'District\\ Hospital = Health Facility\r\nother = keep\r\n';
  const parsed = parseProperties(src);
  const out = serializeProperties(updateProperty(parsed, 'District Hospital', 'Big Hospital'));
  assert.equal(out, 'District\\ Hospital = Big Hospital\r\nother = keep\r\n');
});

test('editing a value with a `:` separator preserves the original separator', () => {
  const src = 'colon.style : one\r\nequals.style = two\r\n';
  const parsed = parseProperties(src);
  const out = serializeProperties(updateProperty(parsed, 'colon.style', 'edited'));
  assert.equal(out, 'colon.style : edited\r\nequals.style = two\r\n');
});

test('editing a value drops any prior continuation and emits a single line', () => {
  const src = 'multi = line one \\\r\n  line two\r\nnext = ok\r\n';
  const parsed = parseProperties(src);
  const out = serializeProperties(updateProperty(parsed, 'multi', 'single now'));
  assert.equal(out, 'multi = single now\r\nnext = ok\r\n');
});

test('empty value entries (key =) round-trip byte-stable when unedited', () => {
  const src = 'a = value\r\nempty =\r\nb = value\r\n';
  const parsed = parseProperties(src);
  const empty = parsed.find((l) => l.kind === 'entry' && l.key === 'empty');
  assert.ok(empty && empty.kind === 'entry');
  assert.equal(empty.value, '');
  assert.equal(serializeProperties(parsed), src);
});

test('trailing whitespace on values is preserved on unedited entries', () => {
  const src = 'padded = value with trailing tabs\t\t\t\r\nnext = ok\r\n';
  const parsed = parseProperties(src);
  assert.equal(serializeProperties(parsed), src);
});

test('duplicate key: first occurrence wins updateProperty, second stays byte-identical', () => {
  const src = 'dup = first\r\nother = keep\r\ndup = second\r\n';
  const out = serializeProperties(updateProperty(parseProperties(src), 'dup', 'edited'));
  assert.equal(out, 'dup = edited\r\nother = keep\r\ndup = second\r\n');
});

test('updateProperty with the same value re-emits raw verbatim', () => {
  const src = 'keep = untouched\r\nother = fine\r\n';
  const parsed = parseProperties(src);
  const out = serializeProperties(updateProperty(parsed, 'keep', 'untouched'));
  assert.equal(out, src);
});

test('leading-whitespace-before-key round-trips byte-stable', () => {
  const src = '  indented = ok\r\n\tab = tabbed\r\n';
  const parsed = parseProperties(src);
  const indented = parsed.find((l) => l.kind === 'entry' && l.key === 'indented');
  assert.ok(indented && indented.kind === 'entry');
  assert.equal(indented.value, 'ok');
  assert.equal(serializeProperties(parsed), src);
});

test('newly-appended value escapes newlines and backslashes', () => {
  const src = 'first = one\r\n';
  const out = serializeProperties(updateProperty(parseProperties(src), 'new.key', 'has \\ and \n newline'));
  assert.equal(out, 'first = one\r\nnew.key = has \\\\ and \\n newline\r\n');
});

test('appended key with a space is escaped as \\ in the key', () => {
  const src = 'first = one\r\n';
  const out = serializeProperties(updateProperty(parseProperties(src), 'key with space', 'value'));
  assert.equal(out, 'first = one\r\nkey\\ with\\ space = value\r\n');
});
