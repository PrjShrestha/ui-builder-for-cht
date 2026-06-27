/**
 * Thin client for the Fastify server. All routes are proxied through
 * /api/* by Vite in dev; same-origin in production.
 */
import type { XLSForm } from '@cht-ui/shared';
import type { FormListEntry, ProjectInfo } from './state/store.js';

export interface DeployConfig {
  target: 'local' | 'instance' | 'url';
  instance?: string;
  url?: string;
  user?: string;
}

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const errBody = (await res.json()) as { error?: string };
      detail = errBody.error ?? '';
    } catch {
      detail = await res.text();
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => jsonFetch<{ ok: boolean; time: string }>('/api/health'),

  getProject: () =>
    jsonFetch<{ open: boolean; project?: ProjectInfo; error?: string }>('/api/project'),

  openProject: (path: string) =>
    jsonFetch<{ open: boolean; project: ProjectInfo }>('/api/project/open', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  closeProject: () =>
    jsonFetch<{ open: boolean }>('/api/project/close', { method: 'POST' }),

  browse: (path: string) =>
    jsonFetch<{
      path: string;
      parent: string | null;
      entries: Array<{ name: string; isDirectory: boolean; isProjectRoot: boolean }>;
    }>(`/api/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),

  browseShortcuts: () =>
    jsonFetch<{ shortcuts: Array<{ label: string; path: string }> }>('/api/browse/shortcuts'),

  browseSearch: (path: string, query: string) =>
    jsonFetch<{ results: Array<{ path: string; name: string; isProjectRoot: boolean }> }>(
      `/api/browse/search?path=${encodeURIComponent(path)}&query=${encodeURIComponent(query)}`,
    ),

  browseMkdir: (path: string, name: string) =>
    jsonFetch<{ path: string }>('/api/browse/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path, name }),
    }),

  chtConfActions: () =>
    jsonFetch<{
      actions: Array<{
        name: string;
        category:
          | 'validate'
          | 'compile'
          | 'convert'
          | 'compress'
          | 'backup'
          | 'upload'
          | 'danger'
          | 'utility';
        requiresInstance: boolean;
        dangerous: boolean;
        label: string;
      }>;
      binaryAvailable: boolean;
      version: string | null;
    }>('/api/cht-conf/actions'),

  getDeployConfig: () =>
    jsonFetch<{ config: DeployConfig | null }>('/api/cht-conf/config'),

  setDeployConfig: (config: DeployConfig) =>
    jsonFetch<{ ok: true; config: DeployConfig }>('/api/cht-conf/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  runChtConfAction: (action: string, password?: string, extraArgs?: string[], dryRun?: boolean) =>
    jsonFetch<{ ok: true; runId: string; dryRun?: boolean }>('/api/cht-conf/run', {
      method: 'POST',
      body: JSON.stringify({ action, password, extraArgs, dryRun }),
    }),

  /** Chained-run macro — runs N cht-conf actions sequentially as one streamed run. */
  runChtConfSequence: (actions: string[], password?: string, dryRun?: boolean) =>
    jsonFetch<{ ok: true; runId: string }>('/api/cht-conf/run-sequence', {
      method: 'POST',
      body: JSON.stringify({ actions, password, dryRun }),
    }),

  getChtConfRun: (runId: string) =>
    jsonFetch<{
      id: string;
      action: string;
      startedAt: number;
      endedAt: number | null;
      exitCode: number | null;
      lines: string[];
      running: boolean;
    }>(`/api/cht-conf/runs/${encodeURIComponent(runId)}`),

  cancelChtConfRun: (runId: string) =>
    jsonFetch<{ ok: true }>(`/api/cht-conf/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
    }),

  listTemplates: () =>
    jsonFetch<{
      templates: Array<{
        id: string;
        label: string;
        description: string;
        forms: { app: number; contact: number };
        hasStarterContent: boolean;
      }>;
    }>('/api/templates'),

  createFromTemplate: (path: string, template: string) =>
    jsonFetch<{ ok: true; path: string }>('/api/templates/create', {
      method: 'POST',
      body: JSON.stringify({ path, template }),
    }),

  listForms: () => jsonFetch<{ forms: FormListEntry[] }>('/api/forms'),

  /** Working-tree changed forms via `git status --porcelain forms/`. Non-git
   *  projects come back as `{ git: false, changed: [] }` — the Deploy UI uses
   *  this to hide the "Select changed" quick-pick. See
   *  docs/plans/deploy-targeted-forms.md §3. */
  getChangedForms: () =>
    jsonFetch<{
      git: boolean;
      changed: Array<{ category: 'app' | 'contact'; basename: string; formId: string }>;
    }>('/api/forms/changed'),

  getForm: (id: string) =>
    jsonFetch<{ id: string; form: XLSForm; properties: unknown }>(
      `/api/forms/${encodeURIComponent(id)}`,
    ),

  saveForm: (id: string, form: XLSForm, properties?: unknown) =>
    jsonFetch<{ ok: true }>(`/api/forms/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ form, properties }),
    }),

  createForm: (
    category: 'app' | 'contact',
    basename: string,
    scaffold: 'default' | 'blank' = 'default',
  ) =>
    jsonFetch<{ ok: true; id: string }>('/api/forms/create', {
      method: 'POST',
      body: JSON.stringify({ category, basename, scaffold }),
    }),

  /** Batch contact-form generator (offered from the Hierarchy editor).
   *  See docs/plans/contact-form-generator.md. Skip-not-overwrite is a
   *  hard contract on the server; the client submits the (type,variant)
   *  list + the current contact_types snapshot. */
  generateContactForms: (body: {
    requests: Array<{ type: string; variant: 'create' | 'edit'; displayName?: string }>;
    contactTypes: Array<{ id: string; person?: boolean; parents?: string[] }>;
    locales?: string[];
  }) =>
    jsonFetch<{
      ok: true;
      written: number;
      skipped: number;
      invalid: number;
      failed: number;
      report: Array<{
        type: string;
        variant: 'create' | 'edit';
        basename: string;
        status: 'written' | 'skipped' | 'invalid' | 'failed';
        message?: string;
        warnings: string[];
      }>;
    }>('/api/forms/generate-contact', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteForm: (id: string) =>
    jsonFetch<{ ok: true }>(`/api/forms/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getHierarchy: () =>
    jsonFetch<{
      place_hierarchy_types: string[];
      contact_types: Array<Record<string, unknown> & { id: string }>;
      place_types_display: Record<string, string>;
    }>('/api/hierarchy'),

  saveHierarchy: (body: {
    place_hierarchy_types: string[];
    contact_types: Array<Record<string, unknown> & { id: string }>;
    place_types_display: Record<string, string>;
  }) =>
    jsonFetch<{ ok: true }>('/api/hierarchy', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  getTaskFiles: () =>
    jsonFetch<Record<'tasks.js' | 'task-schedules.js' | 'tasks-extras.js', string | null>>(
      '/api/tasks/files',
    ),

  saveTaskFile: (file: 'tasks.js' | 'task-schedules.js' | 'tasks-extras.js', content: string) =>
    jsonFetch<{ ok: true }>(`/api/tasks/files/${encodeURIComponent(file)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  getContactSummaryFiles: () =>
    jsonFetch<
      Record<'contact-summary.templated.js' | 'contact-summary.extras.js', string | null>
    >('/api/contact-summary/files'),

  saveContactSummaryFile: (
    file: 'contact-summary.templated.js' | 'contact-summary.extras.js',
    content: string,
  ) =>
    jsonFetch<{ ok: true }>(`/api/contact-summary/files/${encodeURIComponent(file)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  // FHIR V1 — Standard codes mapping (docs/plans/fhir-v1-workbench.md).
  // GET returns the reconciled mapping (orphans relocated from a stale
  // store); PUT writes the canonical bytes via compare-before-write +
  // atomic tmp+rename. Sidecar lives at <project>/fhir-mapping.json.
  getFhirMapping: () =>
    jsonFetch<{ mapping: import('@cht-ui/shared').FhirMapping }>('/api/fhir-mapping'),

  saveFhirMapping: (mapping: import('@cht-ui/shared').FhirMapping) =>
    jsonFetch<{ ok: true; written: boolean }>('/api/fhir-mapping', {
      method: 'PUT',
      body: JSON.stringify({ mapping }),
    }),

  /** Fetch the bundled cht-mch-v1 starter pack — used by the workbench
   *  to enumerate dictionaries + render dictionary-filtered code
   *  suggestions in the two-step picker. */
  getFhirPack: () =>
    jsonFetch<{ pack: import('@cht-ui/shared').StarterPack }>('/api/fhir-mapping/pack'),

  /** List the vendored terminology dictionaries with their entry counts +
   *  version pins. Backs the picker's step-1 button row — buttons render
   *  regardless of `available`; an unavailable dictionary just searches
   *  to empty. See docs/plans/fhir-pack-population.md. */
  listFhirDictionaries: () =>
    jsonFetch<{
      systems: Array<{
        systemId: import('@cht-ui/shared').DictionarySystemId;
        system: string;
        available: boolean;
        count: number | null;
        version: string | null;
      }>;
    }>('/api/fhir/dictionary/list'),

  /** Debounced search over one dictionary. The picker calls this on every
   *  keystroke (after a debounce window); sub-50 ms per call by design. */
  searchFhirDictionary: (params: {
    system: import('@cht-ui/shared').DictionarySystemId;
    q: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams({ system: params.system, q: params.q });
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    return jsonFetch<{
      system: string;
      systemId: import('@cht-ui/shared').DictionarySystemId;
      dictionaryVersion: string | null;
      total: number;
      entries: Array<{ code: string; display: string; aliases: string[] }>;
      available: boolean;
    }>(`/api/fhir/dictionary/search?${qs.toString()}`);
  },
};
