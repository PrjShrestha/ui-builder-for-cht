/**
 * Form routes: list, read, write XLSForms (and their properties.json).
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getProjectPath, resolveInsideProject } from '../state.js';
import {
  parseXlsForm,
  serializeXlsForm,
  buildAppFormScaffold,
  buildBlankFormScaffold,
  buildContactFormScaffold,
  type XLSForm,
} from '@cht-ui/shared';

/** Form categories the UI surfaces. */
type FormCategory = 'app' | 'contact';

interface FormListEntry {
  /** Unique id used in routes: "<category>:<filename-without-ext>" e.g. "app:pregnancy". */
  id: string;
  category: FormCategory;
  filename: string;
  hasProperties: boolean;
  hasXml: boolean;
}

function formId(category: FormCategory, basename: string): string {
  return `${category}:${basename}`;
}

function parseFormId(id: string): { category: FormCategory; basename: string } {
  const [cat, ...rest] = id.split(':');
  if ((cat !== 'app' && cat !== 'contact') || rest.length === 0) {
    throw new Error(`Invalid form id: ${id}`);
  }
  return { category: cat, basename: rest.join(':') };
}

async function listFormsInDir(dir: string, category: FormCategory): Promise<FormListEntry[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const xlsxFiles = entries.filter((e) => e.toLowerCase().endsWith('.xlsx'));
  const out: FormListEntry[] = [];
  for (const f of xlsxFiles) {
    const basename = f.replace(/\.xlsx$/i, '');
    const propsPath = path.join(dir, `${basename}.properties.json`);
    const xmlPath = path.join(dir, `${basename}.xml`);
    out.push({
      id: formId(category, basename),
      category,
      filename: f,
      hasProperties: await fileExists(propsPath),
      hasXml: await fileExists(xmlPath),
    });
  }
  out.sort((a, b) => a.filename.localeCompare(b.filename));
  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function pathsForForm(category: FormCategory, basename: string) {
  const dir = await resolveInsideProject(path.join('forms', category));
  return {
    xlsx: path.join(dir, `${basename}.xlsx`),
    xml: path.join(dir, `${basename}.xml`),
    properties: path.join(dir, `${basename}.properties.json`),
  };
}

/**
 * Add a FORMS.<UPPER>: ['<basename>'] entry to form-constants.js and append
 * the basename to APP_FORMS. Best-effort: bails silently if the file
 * doesn't exist or doesn't match the expected shape.
 */
async function maintainFormConstants(basename: string): Promise<void> {
  let p: string;
  try {
    p = await resolveInsideProject('form-constants.js');
  } catch {
    return;
  }
  let src: string;
  try {
    src = await fs.readFile(p, 'utf8');
  } catch {
    return;
  }
  const constName = basename.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();

  // 1) Add `FORMS.<constName>: ['<basename>'],` inside the `const FORMS = { ... }` block if not present.
  const formsOpen = src.search(/const\s+FORMS\s*=\s*\{/);
  if (formsOpen >= 0) {
    const braceOpen = src.indexOf('{', formsOpen);
    const braceClose = findMatchingBrace(src, braceOpen);
    if (braceClose > 0) {
      const block = src.slice(braceOpen, braceClose);
      if (!new RegExp(`\\b${constName}\\s*:`).test(block)) {
        // Insert before the closing brace; preserve trailing comma style.
        const before = src.slice(0, braceClose);
        const after = src.slice(braceClose);
        const trimmed = before.replace(/\s*$/, '');
        const needsComma = !trimmed.endsWith(',') && !trimmed.endsWith('{');
        const insertion = `${needsComma ? ',' : ''}\n  ${constName}: ['${basename}']\n`;
        src = trimmed + insertion + after;
      }
    }
  }

  // 2) Add basename to APP_FORMS array if present.
  const appFormsMatch = /APP_FORMS\s*:\s*\[([^\]]*)\]/.exec(src);
  if (appFormsMatch && appFormsMatch[1] !== undefined) {
    const existing = appFormsMatch[1];
    if (!new RegExp(`['"\`]${basename}['"\`]`).test(existing)) {
      const trimmed = existing.replace(/\s*,\s*$/, '');
      const sep = trimmed.trim().length > 0 ? ', ' : '';
      const replaced = src.replace(
        appFormsMatch[0],
        `APP_FORMS: [${trimmed}${sep}'${basename}']`,
      );
      src = replaced;
    }
  }

  await fs.writeFile(p, src, 'utf8');
}

function findMatchingBrace(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export async function registerFormRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/forms', async (_req, reply) => {
    const projectPath = await getProjectPath();
    if (!projectPath) return reply.code(400).send({ error: 'No project open' });
    const appDir = path.join(projectPath, 'forms', 'app');
    const contactDir = path.join(projectPath, 'forms', 'contact');
    const [appForms, contactForms] = await Promise.all([
      listFormsInDir(appDir, 'app'),
      listFormsInDir(contactDir, 'contact'),
    ]);
    return { forms: [...appForms, ...contactForms] };
  });

  app.get<{ Params: { id: string } }>('/api/forms/:id', async (req, reply) => {
    let parts;
    try {
      parts = parseFormId(decodeURIComponent(req.params.id));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const paths = await pathsForForm(parts.category, parts.basename);
    if (!(await fileExists(paths.xlsx))) {
      return reply.code(404).send({ error: `Form file missing: ${paths.xlsx}` });
    }
    const buf = await fs.readFile(paths.xlsx);
    const form = await parseXlsForm(buf);
    let properties: unknown = null;
    if (await fileExists(paths.properties)) {
      try {
        properties = JSON.parse(await fs.readFile(paths.properties, 'utf8'));
      } catch {
        properties = null;
      }
    }
    return { id: req.params.id, form, properties };
  });

  app.put<{ Params: { id: string }; Body: { form: XLSForm; properties?: unknown } }>(
    '/api/forms/:id',
    async (req, reply) => {
      let parts;
      try {
        parts = parseFormId(decodeURIComponent(req.params.id));
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
      const paths = await pathsForForm(parts.category, parts.basename);
      // Serialize and write atomically (write to tmp, rename).
      const buf = await serializeXlsForm(req.body.form);
      const tmp = `${paths.xlsx}.tmp`;
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, paths.xlsx);
      if (req.body.properties !== undefined && req.body.properties !== null) {
        const propBuf = JSON.stringify(req.body.properties, null, 2);
        await fs.writeFile(paths.properties, propBuf, 'utf8');
      }
      return { ok: true };
    },
  );

  app.post<{
    Body: { category: FormCategory; basename: string; scaffold?: 'default' | 'blank' };
  }>(
    '/api/forms/create',
    async (req, reply) => {
      const { category, basename } = req.body;
      const scaffoldKind = req.body.scaffold ?? 'default';
      if (category !== 'app' && category !== 'contact') {
        return reply.code(400).send({ error: 'category must be "app" or "contact"' });
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(basename)) {
        return reply.code(400).send({ error: 'basename must be alphanumeric + _ -' });
      }
      if (scaffoldKind !== 'default' && scaffoldKind !== 'blank') {
        return reply.code(400).send({ error: 'scaffold must be "default" or "blank"' });
      }
      const dir = await resolveInsideProject(path.join('forms', category));
      await fs.mkdir(dir, { recursive: true });
      const paths = await pathsForForm(category, basename);
      if (await fileExists(paths.xlsx)) {
        return reply.code(409).send({ error: `Form ${basename} already exists` });
      }
      // Per plan docs/plans/survey-groups-and-scaffold.md Part B: pick
      // the scaffold by category + user choice. Default scaffolds carry
      // the canonical inputs/contact-type plumbing the user otherwise has
      // to hand-type; `blank` is the escape hatch (§B3).
      const scaffold: XLSForm =
        scaffoldKind === 'blank'
          ? buildBlankFormScaffold({ basename, category })
          : category === 'app'
            ? buildAppFormScaffold({ basename })
            : buildContactFormScaffold({ basename });
      // The shared scaffold leaves `version` empty so the helper stays
      // deterministic (no Date.now() leak). The route stamps the
      // creation date here.
      scaffold.settings.version = new Date().toISOString().slice(0, 10);
      const buf = await serializeXlsForm(scaffold);
      await fs.writeFile(paths.xlsx, buf);
      if (category === 'app') {
        const props = {
          title: [{ locale: 'en', content: basename }],
          context: { person: true, place: false, expression: 'true' },
          icon: '',
        };
        await fs.writeFile(paths.properties, JSON.stringify(props, null, 2), 'utf8');
      }
      // Auto-maintain form-constants.js if it exists.
      await maintainFormConstants(basename);
      return { ok: true, id: formId(category, basename) };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/forms/:id', async (req, reply) => {
    let parts;
    try {
      parts = parseFormId(decodeURIComponent(req.params.id));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const paths = await pathsForForm(parts.category, parts.basename);
    for (const p of [paths.xlsx, paths.xml, paths.properties]) {
      if (await fileExists(p)) await fs.unlink(p);
    }
    return { ok: true };
  });
}
