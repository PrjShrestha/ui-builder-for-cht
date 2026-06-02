/**
 * Project routes: open, close, current state, list project files at a glance.
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getProjectPath, setProjectPath } from '../state.js';

/** Minimal shape returned to the client when describing a project. */
interface ProjectInfo {
  path: string;
  name: string;
  hasAppSettings: boolean;
  hasAppForms: boolean;
  hasContactForms: boolean;
  hasTasks: boolean;
  hasContactSummary: boolean;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirHasFiles(p: string, extensions: string[]): Promise<boolean> {
  try {
    const entries = await fs.readdir(p);
    return entries.some((e) => extensions.some((ext) => e.toLowerCase().endsWith(ext)));
  } catch {
    return false;
  }
}

async function describeProject(projectPath: string): Promise<ProjectInfo> {
  return {
    path: projectPath,
    name: path.basename(projectPath),
    hasAppSettings: await fileExists(path.join(projectPath, 'app_settings', 'base_settings.json')),
    hasAppForms: await dirHasFiles(path.join(projectPath, 'forms', 'app'), ['.xlsx']),
    hasContactForms: await dirHasFiles(path.join(projectPath, 'forms', 'contact'), ['.xlsx']),
    hasTasks: await fileExists(path.join(projectPath, 'tasks.js')),
    hasContactSummary: await fileExists(path.join(projectPath, 'contact-summary.templated.js')),
  };
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/project', async () => {
    const projectPath = await getProjectPath();
    if (!projectPath) return { open: false };
    const exists = await fileExists(projectPath);
    if (!exists) {
      await setProjectPath(null);
      return { open: false, error: 'previous project path no longer exists' };
    }
    return { open: true, project: await describeProject(projectPath) };
  });

  app.post<{ Body: { path: string } }>(
    '/api/project/open',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (req, reply) => {
      const requested = req.body.path;
      const abs = path.resolve(requested);
      if (!(await fileExists(abs))) {
        return reply.code(400).send({ error: `Path does not exist: ${abs}` });
      }
      const stat = await fs.stat(abs);
      if (!stat.isDirectory()) {
        return reply.code(400).send({ error: `Path is not a directory: ${abs}` });
      }
      await setProjectPath(abs);
      return { open: true, project: await describeProject(abs) };
    },
  );

  app.post('/api/project/close', async () => {
    await setProjectPath(null);
    return { open: false };
  });

  app.get('/api/browse/shortcuts', async () => {
    const home = os.homedir();
    const shortcuts: Array<{ label: string; path: string }> = [{ label: 'Home', path: home }];
    if (process.platform === 'win32') {
      for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        const root = `${letter}:\\`;
        if (await fileExists(root)) shortcuts.push({ label: root, path: root });
      }
    } else {
      shortcuts.push({ label: '/', path: '/' });
    }
    return { shortcuts };
  });

  app.get<{ Querystring: { path?: string; query?: string } }>(
    '/api/browse/search',
    async (req, reply) => {
      const root = (req.query.path ?? '').trim();
      const query = (req.query.query ?? '').trim().toLowerCase();
      if (!root) return reply.code(400).send({ error: 'path is required' });
      if (!query) return { results: [] };
      const abs = path.resolve(root);
      if (!(await fileExists(abs))) {
        return reply.code(400).send({ error: `Path does not exist: ${abs}` });
      }
      const results: Array<{ path: string; name: string; isProjectRoot: boolean }> = [];
      const MAX_RESULTS = 200;
      const MAX_DEPTH = 6;
      async function walk(dir: string, depth: number): Promise<void> {
        if (results.length >= MAX_RESULTS || depth > MAX_DEPTH) return;
        let entries: import('node:fs').Dirent[];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (results.length >= MAX_RESULTS) return;
          if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
          const full = path.join(dir, e.name);
          if (e.name.toLowerCase().includes(query)) {
            results.push({
              path: full,
              name: e.name,
              isProjectRoot: await isProjectRoot(full),
            });
          }
          await walk(full, depth + 1);
        }
      }
      await walk(abs, 0);
      return { results };
    },
  );

  app.get<{ Querystring: { path?: string } }>('/api/browse', async (req, reply) => {
    const requested = (req.query.path ?? '').trim();
    if (!requested) {
      if (process.platform === 'win32') {
        const drives: string[] = [];
        for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
          const root = `${letter}:\\`;
          if (await fileExists(root)) drives.push(root);
        }
        return { path: '', parent: null, entries: drives.map((d) => ({ name: d, isDirectory: true, isProjectRoot: false })) };
      }
      return { path: '/', parent: null, entries: await listDirEntries('/') };
    }
    const abs = path.resolve(requested);
    if (!(await fileExists(abs))) {
      return reply.code(400).send({ error: `Path does not exist: ${abs}` });
    }
    const stat = await fs.stat(abs);
    if (!stat.isDirectory()) {
      return reply.code(400).send({ error: `Path is not a directory: ${abs}` });
    }
    const parent = path.dirname(abs);
    return {
      path: abs,
      parent: parent === abs ? null : parent,
      entries: await listDirEntries(abs),
    };
  });
}

async function isProjectRoot(p: string): Promise<boolean> {
  return fileExists(path.join(p, 'app_settings', 'base_settings.json'));
}

async function listDirEntries(
  dir: string,
): Promise<Array<{ name: string; isDirectory: boolean; isProjectRoot: boolean }>> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(
    dirs.map(async (e) => ({
      name: e.name,
      isDirectory: true,
      isProjectRoot: await isProjectRoot(path.join(dir, e.name)),
    })),
  );
}
