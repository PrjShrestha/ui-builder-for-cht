/**
 * cht-conf integration: catalog of supported actions, spawn the bundled
 * `cht` binary against the currently-open project, stream stdout/stderr
 * back to the client via SSE.
 *
 * cht-conf has no programmatic Node API for its CLI actions, so we spawn
 * the binary. cht-conf is bundled as a server dep so we don't depend on
 * what's installed in the project folder.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import { getProjectPath, getDeployConfig, setDeployConfig, type DeployConfig } from '../state.js';
import { matchErrorPattern } from '../cht-conf/errorPatterns.js';
import { isDryRunEnabled, runDryRun } from '../cht-conf/dryRun.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ActionMeta {
  name: string;
  category: 'validate' | 'compile' | 'convert' | 'compress' | 'backup' | 'upload' | 'danger' | 'utility';
  /** True if the action talks to a CHT instance (needs deploy target + auth). */
  requiresInstance: boolean;
  /** True if the action is potentially destructive — needs an extra confirm. */
  dangerous: boolean;
  /** Short human label for the UI. */
  label: string;
}

/**
 * Curated metadata for every action shipped by cht-conf v3.18.x. The
 * catalog is hand-written rather than auto-discovered so we can tag
 * category + safety. Unknown actions added by future cht-conf versions
 * are surfaced under 'utility' by the route handler.
 */
const ACTION_CATALOG: ActionMeta[] = [
  // validate
  { name: 'validate-app-forms',      category: 'validate', requiresInstance: false, dangerous: false, label: 'Validate app forms' },
  { name: 'validate-contact-forms',  category: 'validate', requiresInstance: false, dangerous: false, label: 'Validate contact forms' },
  { name: 'validate-collect-forms',  category: 'validate', requiresInstance: false, dangerous: false, label: 'Validate Collect forms' },
  { name: 'validate-training-forms', category: 'validate', requiresInstance: false, dangerous: false, label: 'Validate training forms' },
  { name: 'check-for-updates',       category: 'validate', requiresInstance: true,  dangerous: false, label: 'Check for updates' },
  { name: 'check-git',               category: 'validate', requiresInstance: false, dangerous: false, label: 'Check git status' },
  // compile
  { name: 'compile-app-settings',    category: 'compile', requiresInstance: false, dangerous: false, label: 'Compile app settings' },
  // convert
  { name: 'convert-app-forms',       category: 'convert', requiresInstance: false, dangerous: false, label: 'Convert app forms (xlsx → xml)' },
  { name: 'convert-contact-forms',   category: 'convert', requiresInstance: false, dangerous: false, label: 'Convert contact forms (xlsx → xml)' },
  { name: 'convert-collect-forms',   category: 'convert', requiresInstance: false, dangerous: false, label: 'Convert Collect forms' },
  { name: 'convert-training-forms',  category: 'convert', requiresInstance: false, dangerous: false, label: 'Convert training forms' },
  // compress
  { name: 'compress-images',         category: 'compress', requiresInstance: false, dangerous: false, label: 'Compress images' },
  { name: 'compress-pngs',           category: 'compress', requiresInstance: false, dangerous: false, label: 'Compress PNGs' },
  { name: 'compress-svgs',           category: 'compress', requiresInstance: false, dangerous: false, label: 'Compress SVGs' },
  // backup (reads from instance)
  { name: 'backup-app-settings',     category: 'backup', requiresInstance: true, dangerous: false, label: 'Backup app settings from instance' },
  { name: 'backup-all-forms',        category: 'backup', requiresInstance: true, dangerous: false, label: 'Backup all forms from instance' },
  // upload (writes to instance)
  { name: 'upload-app-settings',         category: 'upload', requiresInstance: true, dangerous: false, label: 'Upload app settings' },
  { name: 'upload-app-forms',            category: 'upload', requiresInstance: true, dangerous: false, label: 'Upload app forms' },
  { name: 'upload-contact-forms',        category: 'upload', requiresInstance: true, dangerous: false, label: 'Upload contact forms' },
  { name: 'upload-collect-forms',        category: 'upload', requiresInstance: true, dangerous: false, label: 'Upload Collect forms' },
  { name: 'upload-training-forms',       category: 'upload', requiresInstance: true, dangerous: false, label: 'Upload training forms' },
  { name: 'upload-resources',            category: 'upload', requiresInstance: true, dangerous: false, label: 'Upload resources (icons / images)' },
  { name: 'upload-branding',             category: 'upload', requiresInstance: true, dangerous: false, label: 'Upload branding' },
  { name: 'upload-partners',             category: 'upload', requiresInstance: true, dangerous: false, label: 'Upload partner logos' },
  { name: 'upload-custom-translations',  category: 'upload', requiresInstance: true, dangerous: false, label: 'Upload custom translations' },
  { name: 'upload-privacy-policies',     category: 'upload', requiresInstance: true, dangerous: false, label: 'Upload privacy policies' },
  { name: 'upload-extension-libs',       category: 'upload', requiresInstance: true, dangerous: false, label: 'Upload extension libs' },
  { name: 'upload-docs',                 category: 'upload', requiresInstance: true, dangerous: false, label: 'Upload generated docs' },
  { name: 'upload-sms-from-csv',         category: 'upload', requiresInstance: true, dangerous: false, label: 'Upload SMS from CSV' },
  // utility
  { name: 'csv-to-docs',             category: 'utility', requiresInstance: false, dangerous: false, label: 'Convert CSVs to docs' },
  { name: 'edit-contacts',           category: 'utility', requiresInstance: true,  dangerous: true,  label: 'Edit contacts (bulk)' },
  { name: 'move-contacts',           category: 'utility', requiresInstance: true,  dangerous: true,  label: 'Move contacts in hierarchy' },
  { name: 'create-users',            category: 'utility', requiresInstance: true,  dangerous: true,  label: 'Create users' },
  // danger
  { name: 'delete-all-forms',        category: 'danger', requiresInstance: true, dangerous: true, label: 'Delete ALL forms from instance' },
  { name: 'delete-forms',            category: 'danger', requiresInstance: true, dangerous: true, label: 'Delete selected forms from instance' },
];

interface ErrorHint {
  patternId: string;
  friendly: string;
  hint?: string;
  docsUrl?: string;
  /** True for known upstream cht-conf bugs — UI badges these differently. */
  knownUpstreamBug?: boolean;
  /** The raw line that triggered the hint (for cross-reference). */
  rawLine: string;
}

type RunUpdate =
  | { kind: 'line'; line: string }
  | { kind: 'hint'; hint: ErrorHint }
  | { kind: 'done'; exitCode: number | null };

interface RunState {
  id: string;
  action: string;
  cwd: string;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  /** Buffered log lines, capped at MAX_LINES. */
  lines: string[];
  /** Buffered friendly hints, replayed on reconnect. */
  hints: ErrorHint[];
  /** Subscribers receiving SSE updates. */
  listeners: Set<(update: RunUpdate) => void>;
  child: ChildProcess | null;
}

const runs = new Map<string, RunState>();
const MAX_LINES = 5000;

function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function chtBinary(): string {
  // The cht-conf binary is installed as a dep of this server workspace.
  // server/dist/routes/cht-conf.js → server/node_modules/.bin/cht.cmd
  const serverRoot = path.resolve(__dirname, '..', '..');
  const isWindows = os.platform() === 'win32';
  return path.join(serverRoot, 'node_modules', '.bin', isWindows ? 'cht.cmd' : 'cht');
}

function buildArgs(action: string, deploy: DeployConfig | null, extras: string[]): string[] {
  const args: string[] = [];
  // Deploy targeting flags only added when the action needs an instance.
  const meta = ACTION_CATALOG.find((a) => a.name === action);
  if (meta?.requiresInstance && deploy) {
    if (deploy.target === 'local') {
      args.push('--local');
    } else if (deploy.target === 'instance' && deploy.instance) {
      args.push(`--instance=${deploy.instance}`);
    } else if (deploy.target === 'url' && deploy.url) {
      args.push(`--url=${deploy.url}`);
    }
    if (deploy.user) args.push('--user', deploy.user);
  }
  args.push(action);
  args.push(...extras);
  return args;
}

function pushLine(state: RunState, line: string): void {
  if (state.lines.length >= MAX_LINES) state.lines.shift();
  state.lines.push(line);
  for (const fn of state.listeners) fn({ kind: 'line', line });

  // Additive translation: never mutate or drop the raw line. If the line
  // matches a recognized pattern, also emit a hint event with the friendly
  // summary + optional workaround.
  const match = matchErrorPattern(line);
  if (match) {
    // De-duplicate hints across consecutive lines that match the same
    // pattern id — pyxform tracebacks are noisy and we don't want six
    // copies of the same friendly summary.
    const last = state.hints[state.hints.length - 1];
    if (!last || last.patternId !== match.pattern.id) {
      const hint: ErrorHint = {
        patternId: match.pattern.id,
        friendly: match.pattern.friendly(match.match),
        hint: match.pattern.hint?.(match.match),
        docsUrl: match.pattern.docsUrl,
        knownUpstreamBug: Boolean(match.pattern.knownUpstreamBug),
        rawLine: line,
      };
      state.hints.push(hint);
      for (const fn of state.listeners) fn({ kind: 'hint', hint });
    }
  }
}

function finishRun(state: RunState, exitCode: number | null): void {
  state.endedAt = Date.now();
  state.exitCode = exitCode;
  state.child = null;
  for (const fn of state.listeners) fn({ kind: 'done', exitCode });
  state.listeners.clear();
}

function attachStreams(state: RunState, child: ChildProcess): void {
  let stdoutBuf = '';
  let stderrBuf = '';
  const onChunk = (buf: Buffer, which: 'stdout' | 'stderr') => {
    const text = buf.toString('utf8');
    if (which === 'stdout') {
      stdoutBuf += text;
      let i;
      while ((i = stdoutBuf.indexOf('\n')) !== -1) {
        pushLine(state, stdoutBuf.slice(0, i));
        stdoutBuf = stdoutBuf.slice(i + 1);
      }
    } else {
      stderrBuf += text;
      let i;
      while ((i = stderrBuf.indexOf('\n')) !== -1) {
        pushLine(state, `[stderr] ${stderrBuf.slice(0, i)}`);
        stderrBuf = stderrBuf.slice(i + 1);
      }
    }
  };
  child.stdout?.on('data', (b: Buffer) => onChunk(b, 'stdout'));
  child.stderr?.on('data', (b: Buffer) => onChunk(b, 'stderr'));
  child.on('close', (code) => {
    if (stdoutBuf) pushLine(state, stdoutBuf);
    if (stderrBuf) pushLine(state, `[stderr] ${stderrBuf}`);
    finishRun(state, code);
  });
  child.on('error', (err) => {
    pushLine(state, `[error] ${err.message}`);
    finishRun(state, -1);
  });
}

export async function registerChtConfRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/cht-conf/actions', async () => {
    return {
      actions: ACTION_CATALOG,
      binaryAvailable: await fileExists(chtBinary()),
      version: await readChtConfVersion(),
    };
  });

  app.get('/api/cht-conf/config', async () => {
    return { config: (await getDeployConfig()) ?? null };
  });

  app.put<{ Body: DeployConfig }>('/api/cht-conf/config', async (req) => {
    await setDeployConfig(req.body);
    return { ok: true, config: req.body };
  });

  app.post<{ Body: { action: string; password?: string; extraArgs?: string[]; dryRun?: boolean } }>(
    '/api/cht-conf/run',
    async (req, reply) => {
      const projectPath = await getProjectPath();
      if (!projectPath) return reply.code(400).send({ error: 'No project open' });
      const meta = ACTION_CATALOG.find((a) => a.name === req.body.action);
      if (!meta) return reply.code(400).send({ error: `Unknown action: ${req.body.action}` });

      const deploy = await getDeployConfig();
      const args = buildArgs(req.body.action, deploy, req.body.extraArgs ?? []);
      const id = newRunId();
      const state: RunState = {
        id,
        action: req.body.action,
        cwd: projectPath,
        startedAt: Date.now(),
        endedAt: null,
        exitCode: null,
        lines: [],
        hints: [],
        listeners: new Set(),
        child: null,
      };
      runs.set(id, state);

      // Dry-run path: skip the spawn entirely and replay a scripted fixture.
      // Triggers on per-request dryRun=true OR env CHT_UI_DRY_RUN=1. Used by
      // Playwright + manual UI testing without a real CHT instance.
      const dryRun = req.body.dryRun === true || isDryRunEnabled();
      if (dryRun) {
        pushLine(state, `[dry-run] cht ${args.join(' ')}`);
        pushLine(state, `(cwd: ${projectPath})`);
        void (async () => {
          const result = await runDryRun(req.body.action);
          for (const line of result.lines) pushLine(state, line);
          finishRun(state, result.exitCode);
        })().catch((e: Error) => {
          pushLine(state, `[dry-run error] ${e.message}`);
          finishRun(state, -1);
        });
        return { ok: true, runId: id, dryRun: true };
      }

      pushLine(state, `$ cht ${args.join(' ')}`);
      pushLine(state, `(cwd: ${projectPath})`);

      const env: NodeJS.ProcessEnv = { ...process.env };
      // cht-conf reads COUCH_URL / CHT_URL but mostly uses --user prompt;
      // we pipe the password to stdin below when supplied.
      if (req.body.password && deploy?.user) {
        // cht-conf reads from process.env.COUCH_PASSWORD as a fallback in
        // some actions; setting it covers cases where prompt-bypass works.
        env.COUCH_PASSWORD = req.body.password;
      }

      // Windows: spawning a `.cmd` directly raises EINVAL — need shell: true
      // so cmd.exe can interpret the batch wrapper. POSIX: shell: false is
      // safer (no quoting surprises in args).
      const child = spawn(chtBinary(), args, {
        cwd: projectPath,
        env,
        shell: os.platform() === 'win32',
        windowsHide: true,
      });
      state.child = child;
      // Send password followed by newline to satisfy interactive prompts.
      if (req.body.password) {
        child.stdin?.write(`${req.body.password}\n`);
      }
      child.stdin?.end();
      attachStreams(state, child);

      return { ok: true, runId: id };
    },
  );

  /**
   * Chained-run macro. Runs N actions sequentially under a single runId so
   * the client can stream one log. Stops on first non-zero exit code.
   * Useful for "Deploy this form" which is really
   * validate → compile → convert → upload-app-forms → upload-app-settings.
   */
  app.post<{ Body: { actions: string[]; password?: string; dryRun?: boolean } }>(
    '/api/cht-conf/run-sequence',
    async (req, reply) => {
      const projectPath = await getProjectPath();
      if (!projectPath) return reply.code(400).send({ error: 'No project open' });
      if (!Array.isArray(req.body.actions) || req.body.actions.length === 0) {
        return reply.code(400).send({ error: 'actions must be a non-empty array' });
      }
      // Validate every action is known.
      for (const name of req.body.actions) {
        if (!ACTION_CATALOG.find((a) => a.name === name)) {
          return reply.code(400).send({ error: `Unknown action: ${name}` });
        }
      }
      const deploy = await getDeployConfig();
      const dryRun = req.body.dryRun === true || isDryRunEnabled();
      const id = newRunId();
      const state: RunState = {
        id,
        action: `sequence(${req.body.actions.join(',')})`,
        cwd: projectPath,
        startedAt: Date.now(),
        endedAt: null,
        exitCode: null,
        lines: [],
        hints: [],
        listeners: new Set(),
        child: null,
      };
      runs.set(id, state);

      // Kick off async run loop — don't await; return runId immediately so
      // the client can subscribe to the SSE stream.
      void (async () => {
        const total = req.body.actions.length;
        for (let i = 0; i < total; i++) {
          const action = req.body.actions[i]!;
          pushLine(state, '');
          pushLine(state, `── step ${i + 1}/${total}: ${action} ──`);

          if (dryRun) {
            const result = await runDryRun(action);
            pushLine(state, `[dry-run] cht ${action}`);
            for (const line of result.lines) pushLine(state, line);
            if (result.exitCode !== 0) {
              pushLine(state, `✖ step ${i + 1}/${total} (${action}) failed with exit code ${result.exitCode}. Stopping.`);
              finishRun(state, result.exitCode);
              return;
            }
            pushLine(state, `✓ step ${i + 1}/${total} (${action}) OK`);
            continue;
          }

          const args = buildArgs(action, deploy ?? null, []);
          pushLine(state, `$ cht ${args.join(' ')}`);

          const env: NodeJS.ProcessEnv = { ...process.env };
          if (req.body.password && deploy?.user) {
            env.COUCH_PASSWORD = req.body.password;
          }
          const child = spawn(chtBinary(), args, {
            cwd: projectPath,
            env,
            shell: os.platform() === 'win32',
            windowsHide: true,
          });
          state.child = child;
          if (req.body.password) child.stdin?.write(`${req.body.password}\n`);
          child.stdin?.end();

          // Wire output to the shared state — but use a per-step promise so
          // we don't finish the macro until each child closes.
          const exitCode = await new Promise<number | null>((resolve) => {
            let stdoutBuf = '';
            let stderrBuf = '';
            child.stdout?.on('data', (b: Buffer) => {
              stdoutBuf += b.toString('utf8');
              let nl;
              while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
                pushLine(state, stdoutBuf.slice(0, nl));
                stdoutBuf = stdoutBuf.slice(nl + 1);
              }
            });
            child.stderr?.on('data', (b: Buffer) => {
              stderrBuf += b.toString('utf8');
              let nl;
              while ((nl = stderrBuf.indexOf('\n')) !== -1) {
                pushLine(state, `[stderr] ${stderrBuf.slice(0, nl)}`);
                stderrBuf = stderrBuf.slice(nl + 1);
              }
            });
            child.on('close', (code) => {
              if (stdoutBuf) pushLine(state, stdoutBuf);
              if (stderrBuf) pushLine(state, `[stderr] ${stderrBuf}`);
              resolve(code);
            });
            child.on('error', (err) => {
              pushLine(state, `[error] ${err.message}`);
              resolve(-1);
            });
          });

          if (exitCode !== 0) {
            pushLine(state, `✖ step ${i + 1}/${total} (${action}) failed with exit code ${exitCode}. Stopping.`);
            finishRun(state, exitCode);
            return;
          }
          pushLine(state, `✓ step ${i + 1}/${total} (${action}) OK`);
        }
        pushLine(state, '');
        pushLine(state, `✓ all ${total} step(s) completed`);
        finishRun(state, 0);
      })().catch((e: Error) => {
        pushLine(state, `[macro error] ${e.message}`);
        finishRun(state, -1);
      });

      return { ok: true, runId: id };
    },
  );

  app.get<{ Params: { runId: string } }>('/api/cht-conf/runs/:runId', async (req, reply) => {
    const state = runs.get(req.params.runId);
    if (!state) return reply.code(404).send({ error: 'Run not found' });
    return {
      id: state.id,
      action: state.action,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      exitCode: state.exitCode,
      lines: state.lines,
      hints: state.hints,
      running: state.endedAt === null,
    };
  });

  app.get<{ Params: { runId: string } }>(
    '/api/cht-conf/runs/:runId/stream',
    async (req: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
      const state = runs.get(req.params.runId);
      if (!state) return reply.code(404).send({ error: 'Run not found' });

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders();

      const send = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Replay buffered lines + hints first so a late subscriber sees the
      // same friendly translations the original viewer saw.
      for (const line of state.lines) send('line', { line });
      for (const hint of state.hints) send('hint', hint);
      if (state.endedAt !== null) {
        send('done', { exitCode: state.exitCode });
        reply.raw.end();
        return reply;
      }

      const listener = (update: RunUpdate) => {
        if (update.kind === 'done') {
          send('done', { exitCode: update.exitCode });
          reply.raw.end();
        } else if (update.kind === 'hint') {
          send('hint', update.hint);
        } else {
          send('line', { line: update.line });
        }
      };
      state.listeners.add(listener);

      req.raw.on('close', () => {
        state.listeners.delete(listener);
      });
      return reply;
    },
  );

  app.post<{ Params: { runId: string } }>('/api/cht-conf/runs/:runId/cancel', async (req, reply) => {
    const state = runs.get(req.params.runId);
    if (!state) return reply.code(404).send({ error: 'Run not found' });
    if (state.child) {
      state.child.kill('SIGTERM');
      pushLine(state, '[cancelled by user]');
    }
    return { ok: true };
  });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readChtConfVersion(): Promise<string | null> {
  try {
    const serverRoot = path.resolve(__dirname, '..', '..');
    const pkg = JSON.parse(
      await fs.readFile(path.join(serverRoot, 'node_modules', 'cht-conf', 'package.json'), 'utf8'),
    ) as { version: string };
    return pkg.version;
  } catch {
    return null;
  }
}
