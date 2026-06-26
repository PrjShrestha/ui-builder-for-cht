/**
 * Server entry point. Fastify on port 5174 by default; client (Vite) on 5173.
 *
 * The server is responsible for filesystem I/O against the user-selected
 * project folder. It exposes a small REST surface; all editing logic lives
 * in the client.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerProjectRoutes } from './routes/project.js';
import { registerFormRoutes } from './routes/forms.js';
import { registerHierarchyRoutes } from './routes/hierarchy.js';
import { registerTasksRoutes } from './routes/tasks.js';
import { registerContactSummaryRoutes } from './routes/contactSummary.js';
import { registerChtConfRoutes } from './routes/cht-conf.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerFhirMappingRoutes } from './routes/fhirMapping.js';
import { registerDictionaryRoutes } from './routes/dictionaries.js';

const PORT = Number(process.env.PORT ?? 5174);
const HOST = process.env.HOST ?? '127.0.0.1';

async function main() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  await app.register(cors, {
    // The Vite dev server runs on 5173; in production both serve from same origin.
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
  });

  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

  await registerProjectRoutes(app);
  await registerFormRoutes(app);
  await registerHierarchyRoutes(app);
  await registerTasksRoutes(app);
  await registerContactSummaryRoutes(app);
  await registerChtConfRoutes(app);
  await registerTemplateRoutes(app);
  await registerFhirMappingRoutes(app);
  await registerDictionaryRoutes(app);

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`UI Builder server listening on http://${HOST}:${PORT}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
