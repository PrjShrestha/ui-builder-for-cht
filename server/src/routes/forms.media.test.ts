/**
 * Geriatric §2 — media-upload filename safety. The route writes inside
 * `forms/<category>/<basename>-media/` only; `sanitizeMediaFilename` is
 * the first gate (pure, tested here) and `resolveInsideProject` is the
 * write-time backstop on the joined path.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizeMediaFilename } from './forms.js';

test('plain image filenames pass through', () => {
  assert.equal(sanitizeMediaFilename('chair-rise.png'), 'chair-rise.png');
  assert.equal(sanitizeMediaFilename('IMG_0042.jpeg'), 'IMG_0042.jpeg');
});

test('spaces and exotic characters fold to underscore', () => {
  assert.equal(sanitizeMediaFilename('chair rise (step 2).png'), 'chair_rise__step_2_.png');
  // Non-ASCII folds per UTF-16 code unit ('व्यायाम' = 7 units → 7 underscores).
  assert.equal(sanitizeMediaFilename('व्यायाम.png'), '_______.png');
});

test('path traversal and separators are rejected outright', () => {
  assert.equal(sanitizeMediaFilename('../evil.png'), null);
  assert.equal(sanitizeMediaFilename('..\\evil.png'), null);
  assert.equal(sanitizeMediaFilename('sub/dir.png'), null);
  assert.equal(sanitizeMediaFilename('sub\\dir.png'), null);
  assert.equal(sanitizeMediaFilename('a..b.png'), null, 'any ".." sequence is rejected');
});

test('dotfiles and empty names are rejected', () => {
  assert.equal(sanitizeMediaFilename('.hidden'), null);
  assert.equal(sanitizeMediaFilename(''), null);
  assert.equal(sanitizeMediaFilename('   '), null);
});
