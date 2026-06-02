/**
 * Token-aware rename of a `list_name` on a survey `type` cell.
 *
 * The XLSForm `type` cell on a select_one / select_multiple / rank row can
 * carry trailing tokens — most commonly `or_other`, and historically
 * `<list_name>_label` for nested filter syntaxes. A naive
 * `"select_one " + newName` rewrite would destroy those trailing tokens, so
 * any UI that renames a list MUST go through this helper.
 *
 * Examples:
 *   renameListInType("select_one foo",            "foo", "bar") → "select_one bar"
 *   renameListInType("select_one foo or_other",   "foo", "bar") → "select_one bar or_other"
 *   renameListInType("select_multiple foo",       "foo", "bar") → "select_multiple bar"
 *   renameListInType("text",                      "foo", "bar") → "text"           (unchanged)
 *   renameListInType("select_one other_list",     "foo", "bar") → "select_one other_list" (unchanged)
 */

const LIST_BEARING_PREFIXES = new Set(['select_one', 'select_multiple', 'rank']);

/**
 * Returns the list_name token on a `type` cell, or undefined if the cell is
 * not a list-bearing select_one / select_multiple / rank row.
 */
export function extractListName(typeCell: string): string | undefined {
  const tokens = typeCell.trim().split(/\s+/);
  if (tokens.length < 2) return undefined;
  const head = tokens[0]!.toLowerCase();
  if (!LIST_BEARING_PREFIXES.has(head)) return undefined;
  return tokens[1];
}

/**
 * Rewrites the list_name token on a `type` cell, preserving the prefix
 * (`select_one` / `select_multiple` / `rank`) AND any tokens that follow
 * it (e.g. `or_other`). If the type cell doesn't carry `oldName` in the
 * list-name slot, the cell is returned unchanged.
 *
 * Whitespace between tokens is normalized to single spaces — the original
 * cell may have used tabs or multiple spaces, but XLSForm parsers all
 * tolerate single-space normalization on the type cell.
 */
export function renameListInType(typeCell: string, oldName: string, newName: string): string {
  if (!typeCell) return typeCell;
  if (oldName === newName) return typeCell;
  const tokens = typeCell.trim().split(/\s+/);
  if (tokens.length < 2) return typeCell;
  const head = tokens[0]!.toLowerCase();
  if (!LIST_BEARING_PREFIXES.has(head)) return typeCell;
  if (tokens[1] !== oldName) return typeCell;
  tokens[1] = newName;
  return tokens.join(' ');
}
