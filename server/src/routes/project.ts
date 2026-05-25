/**
 * Project routes: open, close, current state, list project files at a glance.
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
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
}
