/**
 * Rule: contact forms' meta `created_by*` / `last_edited_by*` XPath hops
 * are the correct depth.
 *
 * The meta calculates live at `/data/<type>/meta/<field>`, so the harvest
 * from `inputs/user/*` needs three `../` hops:
 *
 *   ../../../inputs/user/name         ← correct (data/type/meta → data → inputs → user)
 *   ../../inputs/user/name            ← BUG: resolves to the wrong node, empty at runtime
 *
 * pyxform accepts both counts on compile — the bug only surfaces when CHT
 * saves contacts with empty `created_by*`. See buildContactForm.ts §275 for
 * the invariant + the round-trip test in buildContactForm.test.ts §"Bug A".
 *
 * Only contact forms are checked (identified by `isContactForm: true` on
 * the context). Non-contact forms use their own `../` conventions and
 * would produce false positives.
 */
import { isStructural } from '../../xlsform/types.js';
import type { PreflightCheck, PreflightContext, PreflightResult } from '../types.js';

export const META_XPATH_HOPS_CHECK: PreflightCheck = {
  id: 'meta-xpath-hops',
  label: 'Meta XPath hops',
};

const META_FIELDS = [
  'created_by',
  'created_by_person_uuid',
  'created_by_place_uuid',
  'last_edited_by',
  'last_edited_by_person_uuid',
  'last_edited_by_place_uuid',
];

/** Match a wrong-depth `../../inputs/user/...` (two hops) at the leading `..`. */
const TWO_HOP_INPUTS_USER_RE = /^\.\.\/\.\.\/inputs\/user\//;

export function runMetaXpathHopsRule(ctx: PreflightContext): PreflightResult[] {
  const results: PreflightResult[] = [];
  for (const { formId, xlsform, isContactForm } of ctx.forms) {
    if (!isContactForm) continue;
    for (const row of xlsform.survey) {
      if (isStructural(row)) continue;
      if (!META_FIELDS.includes(row.name)) continue;
      const calc = row.extras['calculation'];
      if (!calc) continue;
      if (!TWO_HOP_INPUTS_USER_RE.test(calc)) continue;
      results.push({
        ruleId: 'meta-xpath-hops',
        severity: 'error',
        message: `Meta field "${row.name}" uses "../../inputs/user/…" (2 hops); should be "../../../inputs/user/…" (3 hops)`,
        affectedItemId: formId,
        rowId: row.rowId,
        column: 'calculation',
        fix: { kind: 'regenerate-contact-form', formId },
      });
    }
  }
  return results;
}
