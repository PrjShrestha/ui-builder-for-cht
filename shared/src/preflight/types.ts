/**
 * Preflight validator — shared types.
 *
 * Runs cht-conf's hard gates BEFORE cht-conf: catches the error classes
 * pyxform/cht-conf reject on so the user sees a friendly panel instead of
 * a raw compile trace. Read-only over an in-memory `PreflightContext`;
 * FS work (probing files, writing stubs) belongs on the server.
 *
 * See docs/plans/preflight-validator.md for the full contract.
 */
import type { XLSForm } from '../xlsform/types.js';

/** Stable id for one rule pack. UI can key collapsibles/telemetry by this. */
export type PreflightRuleId =
  | 'required-files'
  | 'xlsform-identifiers'
  | 'meta-xpath-hops'
  | 'select-choices'
  | 'dangling-refs';

/** Severity of a single result. */
export type PreflightSeverity = 'error' | 'warn' | 'info';

/**
 * A one-click fix hint the UI can offer next to a result. The shared
 * module only *describes* the fix; the client/server routes are what
 * actually apply it. `kind` is the discriminator; fields depend on kind.
 */
export type PreflightFix =
  | { kind: 'stub-file'; path: string }
  | { kind: 'rename-row'; formId: string; rowId: string; from: string; to: string }
  | { kind: 'regenerate-contact-form'; formId: string }
  | { kind: 'add-choice-list'; formId: string; listName: string };

/**
 * Metadata for one rule pack. Rules register a `PreflightCheck` so the
 * runner can produce empty-but-labelled entries when a pack has nothing
 * to report (useful for the "all green" UI state).
 */
export interface PreflightCheck {
  id: PreflightRuleId;
  /** Short human label for a section header. */
  label: string;
}

/**
 * A single verified issue emitted by a rule pack. Locates the failing
 * thing precisely enough to deep-link from the UI later.
 */
export interface PreflightResult {
  /** Which rule pack produced this. */
  ruleId: PreflightRuleId;
  severity: PreflightSeverity;
  /** Human message. No CHT-specific jargon. */
  message: string;
  /** File-scope: what the result lives in.
   *  - required-files → the file's project-relative path
   *  - xlsform-*      → the form basename (matches PreflightContext.forms[i].formId) */
  affectedItemId: string;
  /** Optional: row scope inside the form (XLSForm parser's stable rowId). */
  rowId?: string;
  /** Optional: column that triggered the result (e.g. 'relevant', 'calculation'). */
  column?: string;
  /** Optional: a cheap fix the UI can offer as a one-click button. */
  fix?: PreflightFix;
}

/**
 * One XLSForm entry in the context. `formId` is the file basename without
 * extension (e.g. "pregnancy", "person-create"); it lets results address
 * a form without leaking FS details into shared code.
 */
export interface PreflightContextForm {
  formId: string;
  xlsform: XLSForm;
  /**
   * Optional: true when this is a contact form (subject to the meta
   * `../../../inputs/user/*` hop-depth invariant). Callers know from the
   * containing directory (`forms/contact/*`) which forms are contacts;
   * if unset the meta-xpath rule skips the form.
   */
  isContactForm?: boolean;
}

/**
 * Result of a server-side probe for the required project-root files.
 * `null` in `PreflightContext.requiredFiles` means the probe was not
 * run (shared module has no FS access) — the rule pack is skipped.
 */
export interface RequiredFilesProbe {
  /** Project-relative paths present at the project root. */
  present: string[];
  /** Project-relative paths checked and missing. */
  missing: string[];
}

/**
 * The shared runner's input. Purely in-memory data — no FS handles.
 * The server assembles this from the parsed-forms cache + a filesystem
 * probe and passes it in.
 */
export interface PreflightContext {
  /** All app + contact forms already parsed by the XLSForm parser. */
  forms: PreflightContextForm[];
  /**
   * Result of the server-side required-files probe. `null` → the
   * required-files pack is skipped (no false negatives when FS access
   * is unavailable, e.g. calling shared from a headless CI helper).
   */
  requiredFiles: RequiredFilesProbe | null;
}
