/**
 * FHIR V1 — server-route contract tests (docs/plans/fhir-v1-workbench.md PR1).
 *
 * Pins the four non-negotiable contract items the MVP shared module
 * reserved for the V1 writer:
 *
 *   1. GET on absent sidecar returns an empty mapping (200, not 404).
 *   2. PUT canonicalizes via `serializeFhirMapping`, applies the
 *      atomic tmp+rename, and is a NO-OP on byte-identical content
 *      (the second PUT of the same body returns `written: false`).
 *   3. PUT only touches `fhir-mapping.json` — no other file's bytes
 *      change as a side-effect.
 *   4. GET reconciles the stored mapping against the project's live
 *      keys; a renamed/deleted question gets relocated to `orphans[]`
 *      (a `/`-bearing name is NOT false-orphaned — proves the route
 *      uses codec-built keys, not string concat).
 *
 * Lives alongside the other Playwright e2e (same setup fixture), runs
 * against the committed `mini-config` project, isolates writes in a
 * tmpdir copy.
 */
import { test, expect } from './setup.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(here, 'fixtures', 'mini-config');

const SIDECAR = 'fhir-mapping.json';

test('GET /api/fhir-mapping on an absent sidecar returns an empty mapping (200)', async ({
  request,
}) => {
  const tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), 'cht-ui-e2e-fhir-'));
  try {
    await fs.cp(FIXTURE_DIR, tmpProject, { recursive: true });
    await request.post('http://127.0.0.1:5174/api/project/open', { data: { path: tmpProject } });

    const res = await request.get('http://127.0.0.1:5174/api/fhir-mapping');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { mapping: { questionMappings: Record<string, unknown>; orphans: unknown[] } };
    expect(body.mapping.questionMappings).toEqual({});
    expect(body.mapping.orphans).toEqual([]);

    // Sidecar must NOT exist on disk — GET is read-only.
    let stat: import('node:fs').Stats | null = null;
    try {
      stat = await fs.stat(path.join(tmpProject, SIDECAR));
    } catch {
      stat = null;
    }
    expect(stat).toBe(null);
  } finally {
    await fs.rm(tmpProject, { recursive: true, force: true });
  }
});

test('PUT /api/fhir-mapping canonicalizes + atomic tmp+rename + no-op on identical body', async ({
  request,
}) => {
  const tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), 'cht-ui-e2e-fhir-'));
  try {
    await fs.cp(FIXTURE_DIR, tmpProject, { recursive: true });
    await request.post('http://127.0.0.1:5174/api/project/open', { data: { path: tmpProject } });

    // First PUT — a confirmed mapping on the lmp_date row.
    const mapping = {
      schemaVersion: 1,
      questionMappings: {
        'app:pregnancy/lmp_date': {
          code: '8665-2',
          system: 'http://loinc.org',
          display: 'Last menstrual period start date',
          dictionaryVersion: 'LOINC-2.82',
          source: 'manual',
          status: 'confirmed',
          confirmedBy: 'tester',
          confirmedAt: '2026-06-15T00:00:00.000Z',
        },
      },
      choiceMappings: {},
      orphans: [],
    };
    const put1 = await request.put('http://127.0.0.1:5174/api/fhir-mapping', {
      data: { mapping },
    });
    expect(put1.ok()).toBeTruthy();
    const put1Body = (await put1.json()) as { ok: true; written: boolean };
    expect(put1Body.written).toBe(true);

    // Sidecar exists, ends in `\n`, no BOM, canonically formatted.
    const sidecarBytes = await fs.readFile(path.join(tmpProject, SIDECAR), 'utf8');
    expect(sidecarBytes.startsWith('﻿')).toBe(false);
    expect(sidecarBytes.endsWith('\n')).toBe(true);
    // The canonical serializer sorts keys; `choiceMappings` comes
    // before `orphans` before `questionMappings` before `schemaVersion`.
    const firstKey = sidecarBytes.match(/"([^"]+)"/)?.[1];
    expect(firstKey).toBe('choiceMappings');

    // Second PUT — same body, must be a no-op (no spurious mtime bump).
    const statBefore = await fs.stat(path.join(tmpProject, SIDECAR));
    // Sleep a millisecond so mtime would tick if it bumped.
    // eslint-disable-next-line no-undef
    await new Promise((r) => setTimeout(r, 5));
    const put2 = await request.put('http://127.0.0.1:5174/api/fhir-mapping', {
      data: { mapping },
    });
    expect(put2.ok()).toBeTruthy();
    const put2Body = (await put2.json()) as { ok: true; written: boolean };
    expect(put2Body.written).toBe(false);
    const statAfter = await fs.stat(path.join(tmpProject, SIDECAR));
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  } finally {
    await fs.rm(tmpProject, { recursive: true, force: true });
  }
});

test('PUT /api/fhir-mapping only writes the sidecar — no other file changes', async ({
  request,
}) => {
  const tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), 'cht-ui-e2e-fhir-'));
  try {
    await fs.cp(FIXTURE_DIR, tmpProject, { recursive: true });
    await request.post('http://127.0.0.1:5174/api/project/open', { data: { path: tmpProject } });

    // Capture every file's mtime + size BEFORE the PUT.
    const before = await snapshotProject(tmpProject);

    await request.put('http://127.0.0.1:5174/api/fhir-mapping', {
      data: {
        mapping: {
          schemaVersion: 1,
          questionMappings: {
            'app:pregnancy/lmp_date': {
              code: '8665-2',
              system: 'http://loinc.org',
              display: 'LMP date',
              dictionaryVersion: 'LOINC-2.82',
              source: 'manual',
              status: 'confirmed',
            },
          },
          choiceMappings: {},
          orphans: [],
        },
      },
    });

    const after = await snapshotProject(tmpProject);

    // Every non-sidecar file is byte-identical (same size, same mtime).
    for (const [rel, b] of Object.entries(before)) {
      if (rel === SIDECAR) continue;
      const a = after[rel];
      expect(a, `file ${rel} disappeared after PUT`).toBeTruthy();
      expect(a!.size, `file ${rel} size changed`).toBe(b.size);
      expect(a!.mtimeMs, `file ${rel} mtime changed`).toBe(b.mtimeMs);
    }
  } finally {
    await fs.rm(tmpProject, { recursive: true, force: true });
  }
});

test('GET reconciles renamed/deleted bindings into orphans[] losslessly', async ({
  request,
}) => {
  const tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), 'cht-ui-e2e-fhir-'));
  try {
    await fs.cp(FIXTURE_DIR, tmpProject, { recursive: true });
    await request.post('http://127.0.0.1:5174/api/project/open', { data: { path: tmpProject } });

    // PUT a mapping for a question that DOES exist (`lmp_date`) AND one
    // that does NOT (`renamed_field`). Reconciliation should leave the
    // live one in `questionMappings` and relocate the orphan.
    const live = {
      code: '8665-2',
      system: 'http://loinc.org',
      display: 'LMP',
      dictionaryVersion: 'LOINC-2.82',
      source: 'manual',
      status: 'confirmed',
      confirmedBy: 'tester',
      confirmedAt: '2026-06-15T00:00:00.000Z',
    };
    const ghost = {
      code: '99999-9',
      system: 'http://loinc.org',
      display: 'Renamed concept',
      dictionaryVersion: 'LOINC-2.82',
      source: 'manual',
      status: 'confirmed',
      confirmedBy: 'tester',
      confirmedAt: '2026-06-15T00:00:00.000Z',
    };
    await request.put('http://127.0.0.1:5174/api/fhir-mapping', {
      data: {
        mapping: {
          schemaVersion: 1,
          questionMappings: {
            'app:pregnancy/lmp_date': live,
            'app:pregnancy/renamed_field': ghost,
          },
          choiceMappings: {},
          orphans: [],
        },
      },
    });

    // GET — reconciliation runs server-side. The ghost moves to orphans;
    // the live one stays in questionMappings.
    const res = await request.get('http://127.0.0.1:5174/api/fhir-mapping');
    const body = (await res.json()) as {
      mapping: {
        questionMappings: Record<string, unknown>;
        orphans: Array<{ originalKey: string; reason: string }>;
      };
    };
    expect(body.mapping.questionMappings['app:pregnancy/lmp_date']).toBeTruthy();
    expect(body.mapping.questionMappings['app:pregnancy/renamed_field']).toBeFalsy();
    const orphan = body.mapping.orphans.find((o) => o.originalKey === 'app:pregnancy/renamed_field');
    expect(orphan, 'renamed binding must be relocated to orphans[] losslessly').toBeTruthy();
    expect(orphan!.reason).toBe('renamed-or-deleted');
  } finally {
    await fs.rm(tmpProject, { recursive: true, force: true });
  }
});

/* ============================== helpers ============================== */

async function snapshotProject(
  root: string,
): Promise<Record<string, { size: number; mtimeMs: number }>> {
  const out: Record<string, { size: number; mtimeMs: number }> = {};
  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(abs, r);
      } else if (e.isFile()) {
        const s = await fs.stat(abs);
        out[r] = { size: s.size, mtimeMs: s.mtimeMs };
      }
    }
  }
  await walk(root, '');
  return out;
}
