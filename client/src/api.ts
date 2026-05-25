/**
 * Thin client for the Fastify server. All routes are proxied through
 * /api/* by Vite in dev; same-origin in production.
 */
import type { XLSForm } from '@cht-ui/shared';
import type { FormListEntry, ProjectInfo } from './state/store.js';

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
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

  listForms: () => jsonFetch<{ forms: FormListEntry[] }>('/api/forms'),

  getForm: (id: string) =>
    jsonFetch<{ id: string; form: XLSForm; properties: unknown }>(
      `/api/forms/${encodeURIComponent(id)}`,
    ),

  saveForm: (id: string, form: XLSForm, properties?: unknown) =>
    jsonFetch<{ ok: true }>(`/api/forms/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ form, properties }),
    }),

  createForm: (category: 'app' | 'contact', basename: string) =>
    jsonFetch<{ ok: true; id: string }>('/api/forms/create', {
      method: 'POST',
      body: JSON.stringify({ category, basename }),
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
};
