/**
 * Preflight validator — runner and public exports.
 *
 * `runPreflight` composes the rule packs into a single, deterministically
 * ordered list. Every check is a pure function over `PreflightContext`;
 * no I/O happens here.
 *
 * Ordering: severity desc (`error` → `warn` → `info`), then rule id
 * alphabetical, then original per-rule order (which each rule keeps
 * stable — form iteration order, then row order, then column order).
 * Deterministic ordering lets the UI diff panels between runs and lets
 * tests assert results by index without ambiguity.
 */
import { REQUIRED_FILES_CHECK, runRequiredFilesRule } from './rules/requiredFiles.js';
import { XLSFORM_IDENTIFIERS_CHECK, runXlsformIdentifiersRule } from './rules/xlsformIdentifiers.js';
import { META_XPATH_HOPS_CHECK, runMetaXpathHopsRule } from './rules/metaXpathHops.js';
import { SELECT_CHOICES_CHECK, runSelectChoicesRule } from './rules/selectChoices.js';
import { DANGLING_REFS_CHECK, runDanglingRefsRule } from './rules/danglingRefs.js';
import type { PreflightCheck, PreflightContext, PreflightResult, PreflightSeverity } from './types.js';

export * from './types.js';
export { REQUIRED_FILE_PATHS } from './rules/requiredFiles.js';

/** All registered checks, in a stable (id-alphabetical) order. */
export const PREFLIGHT_CHECKS: readonly PreflightCheck[] = [
  DANGLING_REFS_CHECK,
  META_XPATH_HOPS_CHECK,
  REQUIRED_FILES_CHECK,
  SELECT_CHOICES_CHECK,
  XLSFORM_IDENTIFIERS_CHECK,
];

const SEVERITY_RANK: Record<PreflightSeverity, number> = {
  error: 0,
  warn: 1,
  info: 2,
};

/**
 * Run every preflight rule against the given context and return a
 * deterministically ordered flat list of results.
 *
 * Sort key: (severity, ruleId, originalIndex). Original index is
 * preserved via a stable Array.prototype.sort — modern engines
 * guarantee stability, and both the rules and the runner iterate in
 * insertion order.
 */
export function runPreflight(ctx: PreflightContext): PreflightResult[] {
  const all: PreflightResult[] = [
    ...runRequiredFilesRule(ctx),
    ...runXlsformIdentifiersRule(ctx),
    ...runMetaXpathHopsRule(ctx),
    ...runSelectChoicesRule(ctx),
    ...runDanglingRefsRule(ctx),
  ];
  return all.sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    if (a.ruleId < b.ruleId) return -1;
    if (a.ruleId > b.ruleId) return 1;
    return 0;
  });
}
