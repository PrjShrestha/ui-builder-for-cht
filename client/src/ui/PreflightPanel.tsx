/**
 * Preflight panel — surfaces the shared `runPreflight` output as a
 * grouped, keyboard-navigable checklist. Read-only over the results:
 * this component NEVER applies a fix itself. Instead, when a result
 * carries a `fix` descriptor the row renders a "Fix" button that
 * calls `props.onFix(fix)` — the caller (DeployPanel) owns the
 * network/store side-effect. Keeps this component pure over its
 * inputs and testable in isolation.
 *
 * Design notes:
 *   - Status is communicated by a glyph FIRST (✓/✕/!); color only
 *     reinforces. Matches the DeployReadinessChecklist convention so
 *     the two sections read as one visual family.
 *   - Groups by severity in the fixed order error → warn → info.
 *     Empty groups collapse away. A single "All checks pass" row
 *     replaces every group when nothing failed.
 *   - Expandable per-check subsections use native <details>/<summary>
 *     so keyboard nav (Enter/Space to toggle, Tab to move between
 *     rows) is free. Matches the disclosure pattern in
 *     StandardCodesView / DeployPanel.
 */
import {
  PREFLIGHT_CHECKS,
  runPreflight,
  type PreflightContext,
  type PreflightFix,
  type PreflightResult,
  type PreflightRuleId,
  type PreflightSeverity,
} from '@cht-ui/shared';
import { useMemo } from 'react';

const SEVERITY_ORDER: readonly PreflightSeverity[] = ['error', 'warn', 'info'];

const SEVERITY_LABEL: Record<PreflightSeverity, string> = {
  error: 'Errors',
  warn: 'Warnings',
  info: 'Info',
};

/** Glyph is the primary status channel — non-color cue for a11y. */
const SEVERITY_GLYPH: Record<PreflightSeverity, string> = {
  error: '✕',
  warn: '!',
  info: 'i',
};

/** All checks failing = ✕; passing check on the summary row = ✓. */
const PASS_GLYPH = '✓';

export interface PreflightPanelProps {
  ctx: PreflightContext;
  /** Called when the user clicks a "Fix" button on a result row. */
  onFix?: (fix: PreflightFix) => void;
}

interface CheckGroup {
  ruleId: PreflightRuleId;
  label: string;
  results: PreflightResult[];
}

export function PreflightPanel({ ctx, onFix }: PreflightPanelProps) {
  const results = useMemo(() => runPreflight(ctx), [ctx]);

  const failingCount = results.length;
  // "Passing" here means the check pack ran and produced no results.
  // Every registered check contributes one pass/fail bit.
  const passingChecks = PREFLIGHT_CHECKS.filter(
    (c) => !results.some((r) => r.ruleId === c.id),
  ).length;

  if (failingCount === 0) {
    return (
      <section className="card preflight-panel">
        <header className="row gap" style={{ alignItems: 'baseline' }}>
          <strong>Preflight</strong>
          <span className="muted small">
            {passingChecks}/{PREFLIGHT_CHECKS.length} passing — all preflight checks pass.
          </span>
        </header>
        <ul className="preflight-list">
          <li className="preflight-row preflight-row-pass">
            <span className="preflight-glyph" aria-hidden="true">{PASS_GLYPH}</span>
            <span className="preflight-title">All preflight checks pass</span>
          </li>
        </ul>
      </section>
    );
  }

  return (
    <section className="card preflight-panel">
      <header className="row gap" style={{ alignItems: 'baseline' }}>
        <strong>Preflight</strong>
        <span className="muted small">
          {passingChecks}/{PREFLIGHT_CHECKS.length} passing, {failingCount} failing
        </span>
      </header>
      {SEVERITY_ORDER.map((severity) => {
        const groups = groupByCheck(results.filter((r) => r.severity === severity));
        if (groups.length === 0) return null;
        return (
          <div key={severity} className={`preflight-severity preflight-severity-${severity}`}>
            <h4 className="preflight-severity-header">
              <span className="preflight-glyph" aria-hidden="true">{SEVERITY_GLYPH[severity]}</span>
              <span>{SEVERITY_LABEL[severity]}</span>
              <span className="muted small">
                ({groups.reduce((n, g) => n + g.results.length, 0)})
              </span>
            </h4>
            {groups.map((g) => (
              <details
                key={g.ruleId}
                className="preflight-check"
                open={severity === 'error'}
              >
                <summary className="preflight-check-summary">
                  <span className="preflight-check-label">{g.label}</span>
                  <span className="muted small">
                    {g.results.length} {g.results.length === 1 ? 'issue' : 'issues'}
                  </span>
                </summary>
                <ul className="preflight-list">
                  {g.results.map((r, i) => (
                    <li key={`${r.ruleId}:${r.affectedItemId}:${r.rowId ?? ''}:${r.column ?? ''}:${i}`}
                        className={`preflight-row preflight-row-${severity}`}>
                      <span className="preflight-glyph" aria-hidden="true">
                        {SEVERITY_GLYPH[severity]}
                      </span>
                      <div className="preflight-row-body">
                        <div className="preflight-row-message">{r.message}</div>
                        <div className="preflight-row-subject muted small">
                          {formatSubject(r)}
                        </div>
                      </div>
                      {r.fix && onFix && (
                        <button
                          type="button"
                          className="link preflight-fix"
                          onClick={() => onFix(r.fix as PreflightFix)}
                        >
                          Fix
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        );
      })}
    </section>
  );
}

/**
 * Group results by ruleId while preserving both the shared
 * `PREFLIGHT_CHECKS` registration order (for stable section order
 * across renders) and the runner's per-rule order inside each group.
 */
function groupByCheck(results: PreflightResult[]): CheckGroup[] {
  const bucket = new Map<PreflightRuleId, PreflightResult[]>();
  for (const r of results) {
    const existing = bucket.get(r.ruleId);
    if (existing) existing.push(r);
    else bucket.set(r.ruleId, [r]);
  }
  const groups: CheckGroup[] = [];
  for (const check of PREFLIGHT_CHECKS) {
    const rs = bucket.get(check.id);
    if (rs && rs.length > 0) {
      groups.push({ ruleId: check.id, label: check.label, results: rs });
    }
  }
  return groups;
}

/**
 * Render the failing subject (form / row / file) as a compact
 * descriptor. `affectedItemId` is either a form basename or a
 * project-relative file path depending on the rule.
 */
function formatSubject(r: PreflightResult): string {
  const parts: string[] = [r.affectedItemId];
  if (r.rowId) parts.push(`row ${r.rowId}`);
  if (r.column) parts.push(`col ${r.column}`);
  return parts.join(' · ');
}
