/**
 * Friendly error translation for cht-conf stdout/stderr.
 *
 * Bhishan's complaint after the deploy macro shipped: when something
 * breaks, all he gets is a 40-line pyxform / webpack / chai traceback.
 * This catalog matches common stderr shapes and emits a plain-English
 * summary + an optional workaround hint.
 *
 * Invariant: a recognized pattern NEVER drops or rewrites the raw line.
 * The translator only ANNOTATES it (the raw line is still streamed in
 * full to the client). See translator.ts for the additive contract.
 */

export interface ErrorPattern {
  /** Stable id so the client can deduplicate hints across multiple lines. */
  id: string;
  /** A regex applied per-line over stderr (and high-signal stdout). */
  regex: RegExp;
  /** Single-line plain-English summary shown above the raw line. */
  friendly: (m: RegExpExecArray) => string;
  /** Optional one-line workaround the user can act on. */
  hint?: (m: RegExpExecArray) => string;
  /** Optional docs URL pointing at upstream / our docs / a GitHub issue. */
  docsUrl?: string;
  /**
   * If set, this is a known upstream cht-conf bug — UI renders a distinct
   * "Known issue" badge. Versions narrow when the hint becomes stale.
   */
  knownUpstreamBug?: {
    firstSeenInChtConfVersion?: string;
    fixedInChtConfVersion?: string;
    upstreamUrl?: string;
  };
}

export const ERROR_PATTERNS: ErrorPattern[] = [
  // ---- pyxform / xlsform spec errors (xls2xform under the hood) ----
  {
    id: 'pyxform-missing-required-column',
    // Matches pyxform / xlsform-spec output of the shape "missing required 'name' column"
    // regardless of whether the wrapping mentions ValueError, TypeError, XLSForm, or just pyxform.
    regex: /(?:pyxform|XLSForm|ValueError|TypeError).*?[Mm]issing.*?required.*?[\'"]([A-Za-z_:]+)[\'"]/,
    friendly: (m) => `Your form is missing the required \`${m[1]}\` column.`,
    hint: (m) =>
      `Add a "${m[1]}" column header in the survey sheet. The first row of every XLSForm needs at least type, name, and a label column.`,
    docsUrl: 'https://xlsform.org/en/#question-types',
  },
  {
    id: 'pyxform-bad-type',
    regex: /([\w./]+\.xlsx?).*?[Ll]ine\s+(\d+).*?[Ii]nvalid.*?type[:\s]+[\'"]([^\'"]+)[\'"]/,
    friendly: (m) => `Form ${m[1]} line ${m[2]}: "${m[3]}" is not a known question type.`,
    hint: (m) =>
      `Either fix the typo, or if "${m[3]}" is a CHT-specific type (db:person, select-contact …), check that the spelling matches the catalog exactly.`,
    docsUrl: 'https://xlsform.org/en/#question-types',
  },
  {
    id: 'pyxform-bad-select-list',
    regex: /([Cc]hoice\s+list|select_(?:one|multiple))\s+[\'"]([^\'"]+)[\'"].*?(?:not\s+found|undefined|missing)/,
    friendly: (m) => `The choice list "${m[2]}" referenced on a select question isn't defined in the choices sheet.`,
    hint: (m) =>
      `Add rows with list_name="${m[2]}" to the choices sheet, or fix the spelling on the select question's type cell.`,
  },
  {
    id: 'pyxform-bad-relevant',
    regex: /(?:relevant|XPath|XForm).*?(?:syntax|parse|invalid).*?[\'"]([^\'"]+)[\'"]/,
    friendly: (m) => `An XPath expression is malformed: \`${m[1]}\``,
    hint: () =>
      'Common gotcha: single-quote string values inside relevant — `\${field} = \'yes\'`. Use the visual builder above the raw field to assemble safe expressions.',
  },

  // ---- compile-app-settings webpack ----
  {
    id: 'compile-optional-chaining',
    // Webpack-4 swallows the `?.` context and emits just "Unexpected token '.'"
    // near the offending *-extras.js. Match either the bare token (with an
    // -extras.js reference for specificity) or an explicit ?. mention.
    regex: /(?:Unexpected token|SyntaxError).*?(?:\?\.|[\w-]+-extras\.js)/i,
    friendly: () =>
      'cht-conf cannot parse optional-chaining (`?.`) in contact-summary-extras.js or tasks-extras.js.',
    hint: () =>
      'Workaround: rewrite the line without `?.` (use `x && x.y`). Upstream cht-conf is webpack 4; this is a known limitation.',
    docsUrl: 'https://github.com/medic/cht-conf/issues',
    knownUpstreamBug: {
      firstSeenInChtConfVersion: '3.18.0',
      upstreamUrl: 'https://github.com/medic/cht-conf/issues',
    },
  },
  {
    id: 'compile-missing-module',
    regex: /Cannot\s+find\s+module\s+[\'"]([^\'"]+)[\'"]/,
    friendly: (m) => `Compile failed: the project references a JS module \`${m[1]}\` that doesn't exist.`,
    hint: (m) => `Check require()/import statements inside contact-summary.templated.js, tasks.js, or their *-extras.js files for the typo "${m[1]}".`,
  },

  // ---- auth / instance / network ----
  {
    id: 'auth-failed',
    regex: /(?:401|Unauthorized|Authentication\s+failed|Invalid\s+credentials)/i,
    friendly: () => 'CHT rejected your credentials.',
    hint: () =>
      'Double-check the User in the deploy target above and that you typed the password correctly. Note: password is never saved — re-enter it each session.',
  },
  {
    id: 'connection-refused',
    regex: /(?:ECONNREFUSED|connect\s+ECONNREFUSED|Connection\s+refused).*?([\d.:]+|localhost(?::\d+)?)/i,
    friendly: (m) => `Could not reach the CHT instance at ${m[1] ?? 'the configured URL'}.`,
    hint: () =>
      'If you picked --local, is Docker running? If --instance or --url, can you load the URL in a browser? Check VPN / network access.',
  },
  {
    id: 'dns-failure',
    regex: /(?:ENOTFOUND|getaddrinfo)\s+(?:ENOTFOUND\s+)?([\w.-]+)/,
    friendly: (m) => `DNS lookup for "${m[1]}" failed.`,
    hint: () => 'Check the URL for a typo, or your network connection.',
  },
  {
    id: 'port-in-use',
    regex: /(?:EADDRINUSE|address\s+already\s+in\s+use).*?(\d+)/i,
    friendly: (m) => `Port ${m[1]} is already in use on this machine.`,
    hint: () =>
      'Another process is bound to that port. On Windows: `netstat -ano | findstr :PORT` to find it. On macOS/Linux: `lsof -i :PORT`.',
  },

  // ---- project-shape errors ----
  {
    id: 'no-forms-dir',
    regex: /(?:forms?\s+directory|forms\/app).*?(?:not\s+found|missing|does\s+not\s+exist)/i,
    friendly: () => 'The project is missing the `forms/app/` directory.',
    hint: () => 'cht-conf expects every project to have forms/app/ for app forms and forms/contact/ for contact forms. Create the folder, even if empty.',
  },
  {
    id: 'no-base-settings',
    regex: /(?:base_settings\.json|app_settings\/base_settings).*?(?:not\s+found|missing|does\s+not\s+exist)/i,
    friendly: () => 'The project is missing app_settings/base_settings.json.',
    hint: () => 'compile-app-settings reads app_settings/base_settings.json as input. Create it (start from the blank template if needed).',
  },

  // ---- cht-conf usage / common typos ----
  {
    id: 'unknown-action',
    regex: /(?:Unknown\s+action|unrecognized\s+command).*?[\'"]?([\w-]+)[\'"]?/i,
    friendly: (m) => `cht-conf doesn't recognize the action "${m[1] ?? ''}".`,
    hint: () => 'This shouldn\'t happen via the UI — please report which button you clicked. The action catalog may be out of sync with the installed cht-conf version.',
  },
];

/**
 * Apply the catalog to a single line. Returns the first matching pattern,
 * or null. Multiple patterns matching the same line: first wins (order
 * matters in ERROR_PATTERNS — more-specific patterns first).
 */
export function matchErrorPattern(line: string): { pattern: ErrorPattern; match: RegExpExecArray } | null {
  for (const p of ERROR_PATTERNS) {
    // Each call gets a fresh regex object to avoid lastIndex state on /g.
    const re = new RegExp(p.regex.source, p.regex.flags);
    const m = re.exec(line);
    if (m) return { pattern: p, match: m };
  }
  return null;
}
