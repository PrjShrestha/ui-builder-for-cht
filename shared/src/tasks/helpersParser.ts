/**
 * Parser for predicate-style helper functions in contact-summary.extras.js
 * and tasks-extras.js.
 *
 * Surveyed shape:
 *
 *   function isXYZ(thisContact, allReports) {
 *     if (!isPatient(thisContact)) { return false; }
 *     ...
 *     return true;
 *   }
 *
 * Or arrow form:
 *
 *   const isXYZ = (thisContact, allReports) => { ... };
 *
 * The MVP focuses on these named, single-purpose predicate helpers. Other
 * function shapes in the file are preserved verbatim — only the recognized
 * helpers can be edited.
 */

export interface HelperFn {
  name: string;
  params: string[];
  /** Source of the function body between the outer braces. */
  body: string;
  /** Byte range of the whole declaration in the original source. */
  declStart: number;
  declEnd: number;
}

export interface ParsedHelpers {
  source: string;
  helpers: HelperFn[];
  /** The byte range of the file's module.exports = { ... } block (if found). */
  exportsBounds: { start: number; end: number } | null;
  /** Names already in module.exports. */
  exportedNames: string[];
}

export function parseHelpers(source: string): ParsedHelpers {
  const helpers: HelperFn[] = [];
  // Match `function NAME(params) { ... }` at top level.
  const fnRe = /(^|\n)\s*function\s+([a-zA-Z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(source)) !== null) {
    const name = m[2] ?? '';
    const params = (m[3] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    const braceOpen = m.index + m[0].length - 1;
    const braceClose = matchBracket(source, braceOpen, '{', '}');
    if (braceClose < 0) continue;
    const body = source.slice(braceOpen + 1, braceClose);
    helpers.push({
      name,
      params,
      body,
      declStart: m.index + (m[1] ? m[1].length : 0),
      declEnd: braceClose + 1,
    });
  }

  // Find module.exports = { ... } block.
  const exportsRe = /module\s*\.\s*exports\s*=\s*\{/g;
  const em = exportsRe.exec(source);
  let exportsBounds: { start: number; end: number } | null = null;
  let exportedNames: string[] = [];
  if (em) {
    const openIdx = em.index + em[0].length - 1;
    const closeIdx = matchBracket(source, openIdx, '{', '}');
    if (closeIdx > 0) {
      exportsBounds = { start: openIdx, end: closeIdx };
      const inner = source.slice(openIdx + 1, closeIdx);
      exportedNames = inner
        .split(',')
        .map((s) => s.trim().replace(/:.*$/, '').trim())
        .filter((s) => /^[a-zA-Z_$][\w$]*$/.test(s));
    }
  }

  return { source, helpers, exportsBounds, exportedNames };
}

/**
 * Splice a helper edit into the source: replaces the function body of
 * `name` with `newBody`. If `newName` differs from `name`, also renames
 * the declaration AND the entry in module.exports.
 */
export function patchHelper(
  parsed: ParsedHelpers,
  name: string,
  newName: string,
  newParams: string[],
  newBody: string,
): string {
  let src = parsed.source;
  const helper = parsed.helpers.find((h) => h.name === name);
  if (!helper) {
    // Append a new function to the file before module.exports.
    return appendNewHelper(src, parsed, newName, newParams, newBody);
  }
  // Build the new declaration string.
  const newDecl = `function ${newName}(${newParams.join(', ')}) {\n${newBody}\n}`;
  src = src.slice(0, helper.declStart) + newDecl + src.slice(helper.declEnd);
  // Rename in exports if needed.
  if (newName !== name && parsed.exportsBounds) {
    // Recompute bounds since src has shifted.
    src = renameExport(src, name, newName);
  } else if (!parsed.exportedNames.includes(name)) {
    src = addExport(src, newName);
  }
  return src;
}

export function removeHelper(parsed: ParsedHelpers, name: string): string {
  let src = parsed.source;
  const helper = parsed.helpers.find((h) => h.name === name);
  if (helper) {
    src = src.slice(0, helper.declStart) + src.slice(helper.declEnd);
  }
  src = removeExport(src, name);
  return src;
}

function appendNewHelper(
  src: string,
  parsed: ParsedHelpers,
  name: string,
  params: string[],
  body: string,
): string {
  const newDecl = `\n\nfunction ${name}(${params.join(', ')}) {\n${body}\n}\n`;
  if (parsed.exportsBounds) {
    const insertPos = parsed.exportsBounds.start;
    // Re-find the bounds after potential shifts (none in this path, but defensive).
    src = src.slice(0, insertPos - newDecl.length + newDecl.length) + newDecl + src.slice(insertPos - newDecl.length + newDecl.length);
    // Actually simpler: find module.exports again.
    const r = /module\s*\.\s*exports\s*=\s*\{/.exec(src);
    if (r) {
      const insert = r.index;
      src = src.slice(0, insert) + newDecl + src.slice(insert);
    }
    src = addExport(src, name);
  } else {
    src += newDecl;
  }
  return src;
}

function addExport(src: string, name: string): string {
  const exportsRe = /module\s*\.\s*exports\s*=\s*\{/;
  const em = exportsRe.exec(src);
  if (!em) {
    return src + `\nmodule.exports = { ${name} };\n`;
  }
  const open = em.index + em[0].length - 1;
  const close = matchBracket(src, open, '{', '}');
  if (close < 0) return src;
  const inner = src.slice(open + 1, close);
  if (new RegExp(`\\b${name}\\b`).test(inner)) return src;
  const trimmed = inner.replace(/\s*,?\s*$/, '');
  const sep = trimmed.trim().length > 0 ? ',\n  ' : '\n  ';
  const newInner = `${trimmed}${sep}${name}\n`;
  return src.slice(0, open + 1) + newInner + src.slice(close);
}

function removeExport(src: string, name: string): string {
  return src.replace(new RegExp(`,?\\s*\\b${name}\\b\\s*,?`), (match, _offset) => {
    if (match.includes(',')) return ',';
    return '';
  });
}

function renameExport(src: string, oldName: string, newName: string): string {
  return src.replace(new RegExp(`\\b${oldName}\\b`), newName);
}

/* -------------------- helpers (lower-case h) -------------------- */

function matchBracket(src: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const sk = skipNonCodeAt(src, i);
    if (sk !== null) { i = sk - 1; continue; }
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipNonCodeAt(src: string, i: number): number | null {
  const c = src[i];
  if (c === '/' && src[i + 1] === '/') {
    const nl = src.indexOf('\n', i);
    return nl < 0 ? src.length : nl + 1;
  }
  if (c === '/' && src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2);
    return end < 0 ? src.length : end + 2;
  }
  if (c === "'" || c === '"' || c === '`') return scanString(src, i, c);
  return null;
}

function scanString(src: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === quote) return i + 1;
    if (quote === '`' && c === '$' && src[i + 1] === '{') {
      const close = matchBracket(src, i + 1, '{', '}');
      if (close < 0) return src.length;
      i = close + 1;
      continue;
    }
    i++;
  }
  return src.length;
}
