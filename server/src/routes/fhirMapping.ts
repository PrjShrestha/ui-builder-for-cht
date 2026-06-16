/**
 * FHIR mapping routes — read/write `fhir-mapping.json` at the project root.
 *
 * V1 of the Standard-codes feature (docs/plans/fhir-v1-workbench.md PR1).
 * The MVP (commit 880139d) shipped the read-only `shared/src/fhir/` data
 * layer; this route is the FIRST writer of `fhir-mapping.json` and MUST
 * honor the round-trip contract the MVP types reserve:
 *
 *   1. Canonical serializer (sorted keys, LF, trailing `\n`, no BOM)
 *      from `serializeFhirMapping`.
 *   2. **Compare-before-write** — read the existing bytes, return early
 *      if `serializeFhirMapping(next) === existingBytes`. Opening +
 *      leaving the workbench on an already-canonical sidecar is a
 *      byte-identical no-op (no spurious mtime bump).
 *   3. **Atomic tmp+rename** matching the pattern in
 *      `server/src/routes/hierarchy.ts:45-49`. Never use a non-atomic
 *      `fs.writeFile` — a crash mid-write would leave a truncated
 *      sidecar.
 *   4. **Codec-built live keys** (`encodeQuestionKey` /
 *      `encodeChoiceKey`) — NEVER string concat of `formId + '/' + name`.
 *      A name legally containing `/` or `%` would false-orphan a
 *      live confirmed binding through string concat (MVP §3 item 6).
 *
 * The route is the ONLY file `fhir-mapping.json` ever has written to it
 * — no other byte on disk changes as a side-effect. The first save of
 * a foreign-formatted sidecar (4-space indent, CRLF, unsorted keys) is
 * a legitimate one-time canonicalization; subsequent saves are exact
 * no-ops on byte-identical content.
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  encodeChoiceKey,
  encodeQuestionKey,
  parseFhirMapping,
  reconcileFhirMapping,
  serializeFhirMapping,
  type FhirMapping,
} from '@cht-ui/shared';
import { resolveInsideProject } from '../state.js';
import { parseXlsForm } from '@cht-ui/shared';

const SIDECAR_FILENAME = 'fhir-mapping.json';

/** Empty mapping returned when the sidecar is absent. The shared parser
 *  requires `schemaVersion`, so we hand it the canonical empty shape
 *  rather than `{}` — future schema bumps add their own defaults here. */
function emptyMapping(): FhirMapping {
  return parseFhirMapping(
    JSON.stringify({
      schemaVersion: 1,
      questionMappings: {},
      choiceMappings: {},
      orphans: [],
    }),
  );
}

/**
 * Walk every `forms/app/*.xlsx` and `forms/contact/*.xlsx` and produce
 * the codec-keyed list of every live binding the picker could attach a
 * code to (questions + select choices). The route uses this list as the
 * input to `reconcileFhirMapping` so renamed/deleted rows are relocated
 * to `orphans[]` losslessly (never silently dropped).
 *
 * Critical: live keys MUST be produced by the codec — never by string
 * concat — or a name legally containing `/` or `%` false-orphans its
 * own confirmed binding (MVP §3 item 6). The codec strings here are
 * the same ones the V1 PUT will compare against.
 */
async function buildLiveKeys(projectPath: string): Promise<string[]> {
  const liveKeys = new Set<string>();
  for (const [category, dirName] of [
    ['app', 'forms/app'],
    ['contact', 'forms/contact'],
  ] as const) {
    let entries: string[];
    try {
      entries = await fs.readdir(path.join(projectPath, dirName));
    } catch {
      continue;
    }
    const xlsxFiles = entries.filter((e) => e.toLowerCase().endsWith('.xlsx'));
    for (const filename of xlsxFiles) {
      const basename = filename.replace(/\.xlsx$/i, '');
      const formId = `${category}:${basename}`;
      let form;
      try {
        const buf = await fs.readFile(path.join(projectPath, dirName, filename));
        form = await parseXlsForm(buf);
      } catch {
        // Unparseable workbook — best-effort; skip silently so the
        // reconcile doesn't drop everything else.
        continue;
      }
      // Question-level keys: every named survey row (structural rows
      // have empty `name` in cht-default — `encodeQuestionKey` would
      // still encode them but they aren't mappable, so skip).
      for (const r of form.survey) {
        if (!r.name) continue;
        liveKeys.add(encodeQuestionKey(formId, r.name));
      }
      // Choice-level keys: every (list_name, choice.name) the form's
      // choices sheet carries. Used by PR3's choice-level mapping.
      for (const c of form.choices) {
        if (!c.list_name || !c.name) continue;
        liveKeys.add(encodeChoiceKey(formId, c.list_name, c.name));
      }
    }
  }
  return Array.from(liveKeys);
}

/** Read + parse the sidecar, returning the empty mapping when absent. */
async function readSidecar(sidecarPath: string): Promise<FhirMapping> {
  try {
    const raw = await fs.readFile(sidecarPath, 'utf8');
    return parseFhirMapping(raw);
  } catch (e) {
    // eslint-disable-next-line no-undef
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyMapping();
    // A malformed sidecar is a hard failure — better than silently
    // dropping confirmed mappings.
    throw e;
  }
}

/** Atomic tmp+rename write — same pattern as hierarchy.ts:45-49. The
 *  caller MUST have already done the compare-before-write check;
 *  this helper assumes the bytes have changed and writes them. */
async function writeSidecar(sidecarPath: string, content: string): Promise<void> {
  const tmp = `${sidecarPath}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, sidecarPath);
}

export async function registerFhirMappingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/fhir-mapping', async (_req, reply) => {
    let sidecarPath: string;
    let projectPath: string;
    try {
      sidecarPath = await resolveInsideProject(SIDECAR_FILENAME);
      projectPath = path.dirname(sidecarPath);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const stored = await readSidecar(sidecarPath);
    const liveKeys = await buildLiveKeys(projectPath);
    // Reconcile relocates any stored key not in `liveKeys` to
    // `orphans[]` losslessly. Pure (no I/O); the route doesn't write
    // the reconciled state on GET — it returns it for the workbench to
    // edit and PUT back.
    const reconciled = reconcileFhirMapping(stored, liveKeys);
    return { mapping: reconciled };
  });

  app.put<{ Body: { mapping: FhirMapping } }>(
    '/api/fhir-mapping',
    {
      schema: {
        body: {
          type: 'object',
          required: ['mapping'],
          properties: { mapping: { type: 'object' } },
        },
      },
    },
    async (req, reply) => {
      let sidecarPath: string;
      try {
        sidecarPath = await resolveInsideProject(SIDECAR_FILENAME);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
      // Re-parse via the shared parser so the body's shape gets the
      // same defaults/validation the GET path applies. A malformed
      // body fails fast here.
      let normalized: FhirMapping;
      try {
        normalized = parseFhirMapping(JSON.stringify(req.body.mapping));
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
      const next = serializeFhirMapping(normalized);
      // Round-trip §2 — compare-before-write. Spurious writes are a
      // bug: every save that produces the same bytes on disk must be
      // a no-op (no mtime bump, no `git diff`). Read the existing
      // bytes (treating ENOENT as ''), bail early when equal.
      let existing = '';
      try {
        existing = await fs.readFile(sidecarPath, 'utf8');
      } catch (e) {
        // eslint-disable-next-line no-undef
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      if (existing === next) {
        return { ok: true, written: false };
      }
      await writeSidecar(sidecarPath, next);
      return { ok: true, written: true };
    },
  );
}
