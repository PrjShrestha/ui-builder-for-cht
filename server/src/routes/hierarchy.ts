/**
 * Hierarchy routes: read/write app_settings/base_settings.json's
 * place_hierarchy_types and contact_types, plus forms/contact/place-types.json.
 *
 * Round-trip rule: we touch only the fields we know about. Every other
 * key in base_settings.json is preserved verbatim.
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInsideProject } from '../state.js';

interface ContactType {
  id: string;
  name_key?: string;
  group_key?: string;
  create_key?: string;
  edit_key?: string;
  icon?: string;
  parents?: string[];
  person?: boolean;
  primary_contact_key?: string;
  count_visits?: boolean;
  create_form?: string;
  edit_form?: string;
  // Anything else stays in the source JSON.
  [k: string]: unknown;
}

interface BaseSettings {
  place_hierarchy_types?: string[];
  contact_types?: ContactType[];
  [k: string]: unknown;
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(p: string, value: unknown): Promise<void> {
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, p);
}

export async function registerHierarchyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/hierarchy', async (_req, reply) => {
    let settingsPath;
    let placeTypesPath;
    try {
      settingsPath = await resolveInsideProject(path.join('app_settings', 'base_settings.json'));
      placeTypesPath = await resolveInsideProject(path.join('forms', 'contact', 'place-types.json'));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const settings = (await readJson<BaseSettings>(settingsPath)) ?? {};
    const placeTypes = (await readJson<Record<string, string>>(placeTypesPath)) ?? {};
    return {
      place_hierarchy_types: settings.place_hierarchy_types ?? [],
      contact_types: settings.contact_types ?? [],
      place_types_display: placeTypes,
    };
  });

  app.put<{
    Body: {
      place_hierarchy_types: string[];
      contact_types: ContactType[];
      place_types_display: Record<string, string>;
    };
  }>('/api/hierarchy', async (req, reply) => {
    let settingsPath;
    let placeTypesPath;
    try {
      settingsPath = await resolveInsideProject(path.join('app_settings', 'base_settings.json'));
      placeTypesPath = await resolveInsideProject(path.join('forms', 'contact', 'place-types.json'));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const settings = (await readJson<BaseSettings>(settingsPath)) ?? {};
    settings.place_hierarchy_types = req.body.place_hierarchy_types;
    settings.contact_types = req.body.contact_types;
    await writeJson(settingsPath, settings);
    await writeJson(placeTypesPath, req.body.place_types_display);
    return { ok: true };
  });
}
