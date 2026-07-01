/**
 * Rule: required cht-conf files exist at the project root.
 *
 * cht-conf compile/upload paths hard-require a small set of files. The
 * shared module has no FS access — the server probes disk and passes
 * the `RequiredFilesProbe` in. This rule turns that probe into results.
 *
 * Severity:
 *   - error   → `targets.js`, `tasks.js`, `app_settings/base_settings.json`
 *   - warn    → `.eslintrc` (linter fails but compile succeeds)
 *   - warn    → `resources.json` (soft; upload just warns)
 *
 * Each result carries a `stub-file` fix hint. The server route is what
 * actually writes the minimal-valid stub — matches CLAUDE.md's
 * "templates ship required minimal-valid files" invariant.
 */
import type { PreflightCheck, PreflightContext, PreflightResult, PreflightSeverity } from '../types.js';

export const REQUIRED_FILES_CHECK: PreflightCheck = {
  id: 'required-files',
  label: 'Required files',
};

/** Files this rule looks for, with their severity. Order-stable for tests. */
const REQUIRED_FILES: ReadonlyArray<{ path: string; severity: PreflightSeverity }> = [
  { path: 'targets.js', severity: 'error' },
  { path: 'tasks.js', severity: 'error' },
  { path: 'app_settings/base_settings.json', severity: 'error' },
  { path: '.eslintrc', severity: 'warn' },
  { path: 'resources.json', severity: 'warn' },
];

/** The set of paths this rule considers "required" (for the server allowlist). */
export const REQUIRED_FILE_PATHS: readonly string[] = REQUIRED_FILES.map((f) => f.path);

export function runRequiredFilesRule(ctx: PreflightContext): PreflightResult[] {
  if (ctx.requiredFiles === null) return [];

  const missing = new Set(ctx.requiredFiles.missing);
  const results: PreflightResult[] = [];
  for (const { path, severity } of REQUIRED_FILES) {
    if (!missing.has(path)) continue;
    results.push({
      ruleId: 'required-files',
      severity,
      message: `Missing required file: ${path}`,
      affectedItemId: path,
      fix: { kind: 'stub-file', path },
    });
  }
  return results;
}
