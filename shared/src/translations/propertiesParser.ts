/**
 * Lossless parser + serializer for Java `.properties` files, which CHT uses
 * for translation catalogs (`messages-<locale>.properties`).
 *
 * The bar is byte-stability: parse(source) → serialize → source must be
 * identical when no updateProperty was called, so `git diff` after editing a
 * single translation cell shows only that one line changing.
 *
 * Grammar we handle (per the Java properties spec, which CHT follows):
 * - Comment lines start with `#` or `!` (optionally after leading whitespace).
 * - Blank lines contain only whitespace (or nothing).
 * - Entry lines are `key <sep> value`, where <sep> is `=`, `:`, whitespace,
 *   or any run of those, optionally with surrounding whitespace.
 * - A trailing `\` with an ODD number of backslashes continues the value on
 *   the next physical line (leading whitespace on the continuation is stripped
 *   per Java's semantics).
 * - Value escapes: `\n \t \r \f \\ \= \: \  \uXXXX`. Keys use the same escape
 *   forms (notably `\ ` for space-in-key like `District\ Hospital`).
 * - Non-ASCII UTF-8 is legal; the file is read/written as UTF-8.
 */

export type PropertyLine =
  | { kind: 'blank'; raw: string }
  | { kind: 'comment'; text: string; raw: string }
  | { kind: 'entry'; key: string; value: string; raw: string };

export type PropertiesFile = PropertyLine[];

// --- parse ------------------------------------------------------------------

/**
 * Splits `source` into physical-line slices that INCLUDE their line
 * terminator (`\r\n`, `\n`, or `\r`). The last slice has no terminator if
 * the source doesn't end with one. Preserving terminators verbatim is how we
 * keep byte-stability across mixed CRLF/LF files.
 */
function splitPhysicalLines(source: string): string[] {
  const lines: string[] = [];
  let i = 0;
  while (i < source.length) {
    let j = i;
    while (j < source.length && source[j] !== '\n' && source[j] !== '\r') j++;
    let end = j;
    if (j < source.length) {
      if (source[j] === '\r' && source[j + 1] === '\n') end = j + 2;
      else end = j + 1;
    }
    lines.push(source.slice(i, end));
    i = end;
  }
  return lines;
}

/** True if the physical line (excluding terminator) ends in an ODD run of `\`. */
function endsWithOddBackslashRun(bodyNoTerminator: string): boolean {
  let count = 0;
  for (let i = bodyNoTerminator.length - 1; i >= 0 && bodyNoTerminator[i] === '\\'; i--) count++;
  return count % 2 === 1;
}

/** Strip trailing `\r\n`, `\n`, or `\r` from a physical line slice. */
function stripTerminator(line: string): string {
  if (line.endsWith('\r\n')) return line.slice(0, -2);
  if (line.endsWith('\n') || line.endsWith('\r')) return line.slice(0, -1);
  return line;
}

/** Skip leading whitespace (spaces + tabs + form-feed) — Java semantics. */
function skipLeadingWs(s: string, from: number): number {
  let i = from;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\f')) i++;
  return i;
}

/** True if the logical line (leading ws stripped) is blank/comment. */
function classifyLeader(body: string): 'blank' | 'comment' | 'entry' {
  const i = skipLeadingWs(body, 0);
  if (i >= body.length) return 'blank';
  const ch = body[i];
  if (ch === '#' || ch === '!') return 'comment';
  return 'entry';
}

/**
 * Given the concatenated logical body of an entry (all continuation lines
 * folded, leading whitespace on continuation lines removed), decode into
 * `{ key, value }`. Follows Java's properties key/value grammar.
 */
function decodeEntry(logicalBody: string): { key: string; value: string } {
  let i = skipLeadingWs(logicalBody, 0);
  // Parse key: read until an unescaped separator char.
  let key = '';
  while (i < logicalBody.length) {
    const ch = logicalBody[i];
    if (ch === '\\') {
      const decoded = decodeEscape(logicalBody, i);
      key += decoded.char;
      i = decoded.next;
      continue;
    }
    if (ch === '=' || ch === ':' || ch === ' ' || ch === '\t' || ch === '\f') break;
    key += ch;
    i++;
  }
  // Skip whitespace before separator.
  i = skipLeadingWs(logicalBody, i);
  // Optional single `=` or `:` separator.
  if (i < logicalBody.length && (logicalBody[i] === '=' || logicalBody[i] === ':')) i++;
  // Skip whitespace after separator.
  i = skipLeadingWs(logicalBody, i);
  // Value is the rest, decoded.
  let value = '';
  while (i < logicalBody.length) {
    const ch = logicalBody[i];
    if (ch === '\\') {
      const decoded = decodeEscape(logicalBody, i);
      value += decoded.char;
      i = decoded.next;
      continue;
    }
    value += ch;
    i++;
  }
  return { key, value };
}

/**
 * Decode a single `\X` escape starting at `s[at]` (which is `\`). Returns
 * the decoded character (possibly empty for a stray trailing `\`) and the
 * index PAST the escape.
 */
function decodeEscape(s: string, at: number): { char: string; next: number } {
  const next = s[at + 1];
  if (next === undefined) return { char: '', next: at + 1 };
  if (next === 'n') return { char: '\n', next: at + 2 };
  if (next === 't') return { char: '\t', next: at + 2 };
  if (next === 'r') return { char: '\r', next: at + 2 };
  if (next === 'f') return { char: '\f', next: at + 2 };
  if (next === 'u') {
    const hex = s.slice(at + 2, at + 6);
    if (hex.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex)) {
      return { char: String.fromCharCode(parseInt(hex, 16)), next: at + 6 };
    }
    // Malformed \u — pass through the `u` literally, per Java's leniency.
    return { char: next, next: at + 2 };
  }
  // For `\=`, `\:`, `\ `, `\\`, and anything else, the char after `\` is
  // taken literally. This also handles `\#` and `\!`.
  return { char: next, next: at + 2 };
}

export function parseProperties(source: string): PropertiesFile {
  const physical = splitPhysicalLines(source);
  const out: PropertiesFile = [];
  let i = 0;
  while (i < physical.length) {
    const line = physical[i]!;
    const body = stripTerminator(line);
    const kind = classifyLeader(body);
    if (kind === 'blank') {
      out.push({ kind: 'blank', raw: line });
      i++;
      continue;
    }
    if (kind === 'comment') {
      out.push({ kind: 'comment', text: body, raw: line });
      i++;
      continue;
    }
    // Entry — may continue via trailing `\`.
    const rawParts: string[] = [line];
    let logicalBody = body;
    // Continuation only applies if odd trailing backslashes on THIS body.
    while (endsWithOddBackslashRun(logicalBody)) {
      // Drop the trailing `\` (one backslash) from the current logical body.
      logicalBody = logicalBody.slice(0, -1);
      if (i + 1 >= physical.length) break;
      i++;
      const cont = physical[i]!;
      rawParts.push(cont);
      const contBody = stripTerminator(cont);
      // Per Java, leading whitespace on continuation lines is stripped.
      const trimmedStart = skipLeadingWs(contBody, 0);
      logicalBody += contBody.slice(trimmedStart);
    }
    const { key, value } = decodeEntry(logicalBody);
    out.push({ kind: 'entry', key, value, raw: rawParts.join('') });
    i++;
  }
  return out;
}

// --- serialize --------------------------------------------------------------

/**
 * Encode the VALUE side of an entry with the minimum escapes required. The
 * separator has already been emitted before the value, so `=`/`:` inside
 * `value` need no escaping. A leading space in the value is escaped so it
 * doesn't get lost to Java's "skip whitespace after separator" rule.
 */
function encodeValueEscapes(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\f') out += '\\f';
    else if (ch === ' ' && i === 0) out += '\\ ';
    else out += ch;
  }
  return out;
}

/** Encode a KEY: escape whitespace, `=`, `:`, `#`, `!`, `\`, and control chars. */
function encodeKeyEscapes(key: string): string {
  let out = '';
  for (let i = 0; i < key.length; i++) {
    const ch = key[i]!;
    if (ch === '\\') out += '\\\\';
    else if (ch === ' ') out += '\\ ';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\f') out += '\\f';
    else if (ch === '=' || ch === ':') out += '\\' + ch;
    else if ((ch === '#' || ch === '!') && i === 0) out += '\\' + ch;
    else out += ch;
  }
  return out;
}

/**
 * Detect the dominant line terminator in an already-parsed file so appended
 * entries match the file's convention. Defaults to `\n` on empty files.
 */
function detectTerminator(file: PropertiesFile): string {
  for (const line of file) {
    const raw = 'raw' in line ? line.raw : '';
    if (raw.endsWith('\r\n')) return '\r\n';
    if (raw.endsWith('\n')) return '\n';
    if (raw.endsWith('\r')) return '\r';
  }
  return '\n';
}

/**
 * Split `entry.raw` into `<preValue>` (everything up to and including the
 * separator + optional whitespace, on the FIRST physical line only) and the
 * terminator to emit. Continuation lines in `raw` are discarded when we
 * rewrite; the rewritten entry lives on a single line matching the file's
 * terminator convention.
 */
function splitEntryRaw(raw: string, fallbackTerminator: string): { preValue: string; terminator: string } {
  const firstLineSlice = splitPhysicalLines(raw)[0] ?? raw;
  // Pick the terminator to emit: match the first physical line if it had
  // one; otherwise (no-terminator single-line entry) use the file default.
  let terminator = '';
  let body = firstLineSlice;
  if (firstLineSlice.endsWith('\r\n')) {
    terminator = '\r\n';
    body = firstLineSlice.slice(0, -2);
  } else if (firstLineSlice.endsWith('\n')) {
    terminator = '\n';
    body = firstLineSlice.slice(0, -1);
  } else if (firstLineSlice.endsWith('\r')) {
    terminator = '\r';
    body = firstLineSlice.slice(0, -1);
  } else {
    terminator = fallbackTerminator;
  }
  // If the first line ends with an odd run of backslashes, the LAST one is
  // the continuation marker (not part of the key/value bytes). Drop it so
  // we don't treat it as an escape for a nonexistent following char.
  if (endsWithOddBackslashRun(body)) body = body.slice(0, -1);
  let i = skipLeadingWs(body, 0);
  while (i < body.length) {
    const ch = body[i];
    if (ch === '\\') {
      if (body[i + 1] === 'u' && /^[0-9a-fA-F]{4}$/.test(body.slice(i + 2, i + 6))) {
        i += 6;
      } else {
        i += 2;
      }
      continue;
    }
    if (ch === '=' || ch === ':' || ch === ' ' || ch === '\t' || ch === '\f') break;
    i++;
  }
  i = skipLeadingWs(body, i);
  if (i < body.length && (body[i] === '=' || body[i] === ':')) i++;
  i = skipLeadingWs(body, i);
  return { preValue: body.slice(0, i), terminator };
}

/**
 * Re-decode an entry's `raw` to get the value it originally represented.
 * Used to detect edits: if `entry.value` equals this, the entry is untouched
 * and we emit `raw` verbatim; otherwise we rewrite.
 */
function decodeEntryValueFromRaw(raw: string): string {
  // Fold continuation lines the same way parse did.
  const physical = splitPhysicalLines(raw);
  let logicalBody = '';
  for (let i = 0; i < physical.length; i++) {
    const bodyRaw = stripTerminator(physical[i]!);
    if (i === 0) {
      logicalBody = bodyRaw;
    } else {
      const trimmedStart = skipLeadingWs(bodyRaw, 0);
      logicalBody += bodyRaw.slice(trimmedStart);
    }
    if (i < physical.length - 1 && endsWithOddBackslashRun(logicalBody)) {
      logicalBody = logicalBody.slice(0, -1);
    }
  }
  return decodeEntry(logicalBody).value;
}

export function serializeProperties(file: PropertiesFile): string {
  const terminator = detectTerminator(file);
  let out = '';
  for (const line of file) {
    if (line.kind === 'blank' || line.kind === 'comment') {
      out += line.raw;
      continue;
    }
    if (line.raw) {
      const originalValue = decodeEntryValueFromRaw(line.raw);
      if (originalValue === line.value) {
        out += line.raw;
        continue;
      }
      const { preValue, terminator: entryTerm } = splitEntryRaw(line.raw, terminator);
      out += preValue + encodeValueEscapes(line.value) + entryTerm;
      continue;
    }
    // No raw — a freshly-appended entry.
    out += encodeKeyEscapes(line.key) + ' = ' + encodeValueEscapes(line.value) + terminator;
  }
  return out;
}

// --- update -----------------------------------------------------------------

/**
 * Returns a new file with `key`'s value set to `value`. If the key already
 * exists (first occurrence, matching Java's load semantics), that entry's
 * `value` is updated in place; on serialize the line will be rewritten while
 * every other line remains byte-identical. Otherwise a new entry is appended.
 *
 * Appending preserves the file's trailing state: if the source didn't end in
 * a newline, a terminator is added before the new entry so it lands on its
 * own line.
 */
export function updateProperty(file: PropertiesFile, key: string, value: string): PropertiesFile {
  const out: PropertiesFile = file.map((line) => ({ ...line }) as PropertyLine);
  for (let i = 0; i < out.length; i++) {
    const line = out[i]!;
    if (line.kind === 'entry' && line.key === key) {
      out[i] = { ...line, value };
      return out;
    }
  }
  // Append. If the last line lacks a terminator, patch it so the new entry
  // starts on its own line.
  const terminator = detectTerminator(out);
  if (out.length > 0) {
    const last = out[out.length - 1]!;
    const raw = 'raw' in last ? last.raw : '';
    if (raw && !raw.endsWith('\n') && !raw.endsWith('\r')) {
      // Mutate the last line's raw to add a terminator. This keeps
      // byte-stability for the rest of the file and lets the new entry
      // appear on a clean line.
      if (last.kind === 'blank') out[out.length - 1] = { kind: 'blank', raw: raw + terminator };
      else if (last.kind === 'comment')
        out[out.length - 1] = { kind: 'comment', text: last.text, raw: raw + terminator };
      else if (last.kind === 'entry')
        out[out.length - 1] = { ...last, raw: raw + terminator };
    }
  }
  out.push({ kind: 'entry', key, value, raw: '' });
  return out;
}
