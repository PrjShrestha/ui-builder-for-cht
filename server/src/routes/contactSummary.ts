/**
 * Contact summary routes. Phase 0: read/write contact-summary.templated.js
 * and contact-summary.extras.js as text. P1C-bis adds structured editing of
 * the `context` block.
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import { resolveInsideProject } from '../state.js';

async function readTextSafe(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

async function writeText(p: string, content: string): Promise<void> {
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, p);
}

const FILES = ['contact-summary.templated.js', 'contact-summary.extras.js'] as const;
type CSFile = (typeof FILES)[number];
function isCSFile(s: string): s is CSFile {
  return (FILES as readonly string[]).includes(s);
}

export async function registerContactSummaryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/contact-summary/files', async (_req, reply) => {
    try {
      const result: Record<CSFile, string | null> = {
        'contact-summary.templated.js': null,
        'contact-summary.extras.js': null,
      };
      for (const f of FILES) {
        const p = await resolveInsideProject(f);
        result[f] = await readTextSafe(p);
      }
      return result;
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.put<{ Params: { file: string }; Body: { content: string } }>(
    '/api/contact-summary/files/:file',
    async (req, reply) => {
      if (!isCSFile(req.params.file)) {
        return reply.code(400).send({ error: `unknown contact-summary file: ${req.params.file}` });
      }
      try {
        const p = await resolveInsideProject(req.params.file);
        await writeText(p, req.body.content);
        return { ok: true };
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    },
  );
}
