/**
 * Server-side state: which project folder is currently open.
 *
 * Persisted to ~/.cht-ui-builder/state.json so the server remembers the
 * last folder across restarts. No multi-tenant logic in MVP — single
 * server, single user, single open project.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Persistent cht-conf deploy target. Password is NEVER persisted —
 * the UI prompts each run.
 */
export interface DeployConfig {
  target: 'local' | 'instance' | 'url';
  /** Used when target === 'instance' (Medic-hosted: <name>.dev.medicmobile.org). */
  instance?: string;
  /** Used when target === 'url' (arbitrary URL). */
  url?: string;
  /** Username for `cht --user <name>`. */
  user?: string;
}

interface StateFile {
  projectPath: string | null;
  deployConfig?: DeployConfig | null;
}

const STATE_DIR = path.join(os.homedir(), '.cht-ui-builder');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

let cached: StateFile | null = null;

async function ensureLoaded(): Promise<StateFile> {
  if (cached) return cached;
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StateFile>;
    cached = {
      projectPath: parsed.projectPath ?? null,
      deployConfig: parsed.deployConfig ?? null,
    };
  } catch {
    cached = { projectPath: null, deployConfig: null };
  }
  return cached;
}

async function persist(): Promise<void> {
  if (!cached) return;
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(cached, null, 2), 'utf8');
}

export async function getProjectPath(): Promise<string | null> {
  const s = await ensureLoaded();
  return s.projectPath;
}

export async function setProjectPath(p: string | null): Promise<void> {
  const s = await ensureLoaded();
  s.projectPath = p;
  await persist();
}

export async function getDeployConfig(): Promise<DeployConfig | null> {
  const s = await ensureLoaded();
  return s.deployConfig ?? null;
}

export async function setDeployConfig(cfg: DeployConfig | null): Promise<void> {
  const s = await ensureLoaded();
  s.deployConfig = cfg;
  await persist();
}

/**
 * Resolve a path inside the current project, refusing any path that
 * escapes the project root (path traversal protection).
 */
export async function resolveInsideProject(relative: string): Promise<string> {
  const root = await getProjectPath();
  if (!root) throw new Error('No project is open. Open a project folder first.');
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path ${relative} escapes project root`);
  }
  return resolved;
}
