/**
 * Form routes: list, read, write XLSForms (and their properties.json).
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { getProjectPath, resolveInsideProject } from '../state.js';
import { getParsedForm, invalidate as invalidateParsedForm } from '../parsedFormCache.js';
import {
  serializeXlsForm,
  buildAppFormScaffold,
  buildBlankFormScaffold,
  buildContactFormScaffold,
  buildContactForm,
  contactFormBasename,
  type ContactTypeNode,
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

/**
 * Run a git subprocess against the project folder, returning stdout + exit code.
 * Uses `shell: true` on Windows because `git` resolves through Git-for-Windows'
 * shim. Captures errors silently — callers treat non-zero exit as "not a git
 * repo / unavailable" rather than throwing.
 */
function runGit(projectPath: string, gitArgs: string[]): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn('git', ['-C', projectPath, ...gitArgs], {
      shell: os.platform() === 'win32',
      windowsHide: true,
    });
    child.stdout?.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    child.stderr?.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    child.on('close', (code) => resolve({ stdout, code }));
    child.on('error', () => resolve({ stdout: '', code: -1 }));
    // Unused but referenced to satisfy strictness:
    void stderr;
  });
}

interface ChangedForm {
  category: FormCategory;
  basename: string;
  formId: string;
}

/**
 * Parse `git status --porcelain -- forms/` stdout into a deduplicated list of
 * changed form xlsx files. Exported for unit-testing; callers should use
 * `detectChangedForms` which handles the git subprocess.
 *
 * Handles:
 * - Modified/Added/Deleted/Untracked: `XY forms/app/pregnancy.xlsx`
 * - Renames: `R  forms/app/old.xlsx -> forms/app/new.xlsx` (destination wins)
 * - Quoted paths (git uses C-escapes + quotes when the path has special chars)
 */
export function parseGitPorcelain(stdout: string): ChangedForm[] {
  const seen = new Set<string>();
  const changed: ChangedForm[] = [];
  for (const rawLine of stdout.split('\n')) {
    if (rawLine.length < 4) continue;
    // Porcelain format: `XY <path>` or `XY <old> -> <new>` for renames.
    // Path starts at col 3 (after two status chars + space). For renames we
    // care about the destination side.
    let rel = rawLine.slice(3);
    const arrow = rel.indexOf(' -> ');
    if (arrow >= 0) rel = rel.slice(arrow + 4);
    // Quoted paths use C-style escapes; strip the surrounding quotes (good
    // enough for our regex match — we don't need byte-exact reconstruction).
    if (rel.startsWith('"') && rel.endsWith('"')) rel = rel.slice(1, -1);
    const m = /^forms\/(app|contact)\/([^/]+)\.xlsx$/i.exec(rel);
    if (!m) continue;
    const category = m[1] as FormCategory;
    const basename = m[2]!;
    const id = formId(category, basename);
    if (seen.has(id)) continue;
    seen.add(id);
    changed.push({ category, basename, formId: id });
  }
  changed.sort((a, b) => a.formId.localeCompare(b.formId));
  return changed;
}

/**
 * Discover which form xlsx files differ from the working tree's git baseline.
 * Used by the Deploy panel's "Select changed" quick-pick — see
 * docs/plans/deploy-targeted-forms.md §3. Returns `git: false` when the
 * project isn't a git repo (UI hides the button); otherwise the deduped list
 * of changed `forms/app/*.xlsx` + `forms/contact/*.xlsx`. Uses
 * `git status --porcelain` so unstaged + just-saved files are included
 * (the working-tree definition of "what I changed since last commit").
 */
async function detectChangedForms(projectPath: string): Promise<{ git: boolean; changed: ChangedForm[] }> {
  const probe = await runGit(projectPath, ['rev-parse', '--is-inside-work-tree']);
  if (probe.code !== 0 || probe.stdout.trim() !== 'true') {
    return { git: false, changed: [] };
  }
  const status = await runGit(projectPath, ['status', '--porcelain', '--', 'forms/']);
  if (status.code !== 0) return { git: true, changed: [] };
  return { git: true, changed: parseGitPorcelain(status.stdout) };
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

  app.get('/api/forms/changed', async (_req, reply) => {
    const projectPath = await getProjectPath();
    if (!projectPath) return reply.code(400).send({ error: 'No project open' });
    return detectChangedForms(projectPath);
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
    // Routed through the parsed-form cache — warm reads skip the ~105 ms
    // parse and just `fs.stat` the file. See parsedFormCache.ts.
    const form = await getParsedForm(paths.xlsx);
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
      // Bust the parsed-form cache — mtime keys cover external edits but
      // Windows mtime resolution can be coarser than the gap between our
      // own write and the next read, so explicit eviction is mandatory.
      invalidateParsedForm(paths.xlsx);
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
      invalidateParsedForm(paths.xlsx);
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

  /**
   * Batch generator: offered from the Hierarchy editor. Per `(type,
   * variant)` request: compute the hyphen basename, call
   * `buildContactForm` (set settings.form_id = 'contact:<type>:<variant>'
   * via the colon convention — already done by the shared builder),
   * skip if a file with that basename already exists (HARD rule from
   * plan §3 — we NEVER clobber a contact form), otherwise stamp
   * `version`, serialize, write, invalidate the parsed-form cache.
   *
   * Returns a per-file report so the modal can show "written: N,
   * skipped: M (already existed)" + per-entry warnings from the
   * builder (root place, orphan person, unknown type).
   *
   * Deliberately does NOT call `maintainFormConstants` — that helper is
   * app-report-form specific (FORMS.<UPPER> + APP_FORMS), and contact
   * forms have their own runtime convention (CHT looks them up by
   * filename / form_id, not via a constants module).
   */
  app.post<{
    Body: {
      requests: Array<{ type: string; variant: 'create' | 'edit'; displayName?: string }>;
      contactTypes: ContactTypeNode[];
      locales?: string[];
    };
  }>('/api/forms/generate-contact', async (req, reply) => {
    const { requests, contactTypes, locales } = req.body;
    if (!Array.isArray(requests) || requests.length === 0) {
      return reply.code(400).send({ error: 'requests must be a non-empty array' });
    }
    if (!Array.isArray(contactTypes)) {
      return reply.code(400).send({ error: 'contactTypes must be an array' });
    }

    // Ensure the contact-forms dir exists exactly once for the batch.
    const dir = await resolveInsideProject(path.join('forms', 'contact'));
    await fs.mkdir(dir, { recursive: true });
    // The route stamps the version once per batch so a multi-file
    // generate-run produces uniform metadata.
    const versionStamp = new Date().toISOString().slice(0, 10);

    interface GenReport {
      type: string;
      variant: 'create' | 'edit';
      basename: string;
      status: 'written' | 'skipped' | 'invalid' | 'failed';
      message?: string;
      warnings: string[];
    }
    const report: GenReport[] = [];

    for (const req of requests) {
      const basename = contactFormBasename(req.type, req.variant);
      const entry: GenReport = {
        type: req.type,
        variant: req.variant,
        basename,
        status: 'written',
        warnings: [],
      };
      if (!/^[a-zA-Z0-9_-]+$/.test(basename)) {
        entry.status = 'invalid';
        entry.message = `Invalid basename "${basename}" — contact type id must be alphanumeric (plus _, -).`;
        report.push(entry);
        continue;
      }
      const paths = await pathsForForm('contact', basename);
      // Skip-not-overwrite (plan §3 hard rule). NEVER clobber an
      // existing contact form — the author may have customised it.
      if (await fileExists(paths.xlsx)) {
        entry.status = 'skipped';
        entry.message = 'File already exists — left untouched.';
        report.push(entry);
        continue;
      }
      try {
        const built = buildContactForm(contactTypes, {
          type: req.type,
          variant: req.variant,
          displayName: req.displayName,
          locales,
        });
        entry.warnings = built.warnings;
        built.form.settings.version = versionStamp;
        const buf = await serializeXlsForm(built.form);
        await fs.writeFile(paths.xlsx, buf);
        invalidateParsedForm(paths.xlsx);
      } catch (e) {
        entry.status = 'failed';
        entry.message = (e as Error).message;
      }
      report.push(entry);
    }

    return {
      ok: true,
      report,
      written: report.filter((r) => r.status === 'written').length,
      skipped: report.filter((r) => r.status === 'skipped').length,
      invalid: report.filter((r) => r.status === 'invalid').length,
      failed: report.filter((r) => r.status === 'failed').length,
    };
  });

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
    invalidateParsedForm(paths.xlsx);
    return { ok: true };
  });
}
