/**
 * Dry-run mode for cht-conf actions. Replays scripted output from
 * fixture files instead of spawning the real binary. Used by:
 *   - Anita's row-6 Playwright spec (deploy macro testable without CouchDB)
 *   - manual local dev when you want to exercise the friendly-translator
 *     without breaking a real instance
 *
 * Fixture file format (one per action, e.g.
 *   server/src/cht-conf/fixtures/validate-app-forms.txt):
 *
 *   # exit 0                              ← first line, optional; default 0
 *   Linting app forms in /path...         ← stdout line
 *   [stderr] Warning: foo                 ← stderr line (line is treated
 *                                            as stderr without the prefix)
 *   ✓ all forms passed
 *
 * Trigger dry-run by:
 *   - setting env CHT_UI_DRY_RUN=1 globally, OR
 *   - passing `dryRun: true` in the /api/cht-conf/run body (per-request override)
 *
 * No real fixture? The driver emits a synthetic "dry-run fallback" line
 * + a generic success exit so the UI shows something instead of hanging.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_ROOT = path.resolve(__dirname, 'fixtures');

export interface DryRunResult {
  /** Emitted in order. Lines prefixed with [stderr] are stderr; otherwise stdout. */
  lines: string[];
  exitCode: number;
}

/** Public: is dry-run mode active globally? */
export function isDryRunEnabled(): boolean {
  return process.env['CHT_UI_DRY_RUN'] === '1';
}

/**
 * Load and parse a fixture for an action. Falls back to a synthetic
 * success if no fixture file exists — keeps tests deterministic even when
 * we add a new action to the catalog before writing its fixture.
 */
export async function runDryRun(action: string): Promise<DryRunResult> {
  const fixturePath = path.join(FIXTURE_ROOT, `${action}.txt`);
  let raw: string;
  try {
    raw = await fs.readFile(fixturePath, 'utf8');
  } catch {
    return {
      lines: [
        `[dry-run] No fixture at ${fixturePath}.`,
        `[dry-run] Treating action "${action}" as a successful no-op.`,
        `[dry-run] Add a fixture file to script real output for tests.`,
      ],
      exitCode: 0,
    };
  }

  let exitCode = 0;
  const lines: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    if (rawLine.startsWith('# exit ')) {
      const n = parseInt(rawLine.slice(7).trim(), 10);
      if (!Number.isNaN(n)) exitCode = n;
      continue;
    }
    if (rawLine.startsWith('#')) continue; // comments
    if (rawLine === '' && lines.length === 0) continue; // skip leading blank
    lines.push(rawLine);
  }
  // Trim trailing blanks.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  return { lines, exitCode };
}
