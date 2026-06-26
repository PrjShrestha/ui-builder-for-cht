#!/usr/bin/env node
/**
 * Snapshot the four vendored terminology dictionaries (LOINC, ICD-10 WHO,
 * ICD-11 WHO, CIEL) from their free sources into
 * `shared/src/fhir/dictionaries/{systemId}.json`.
 *
 * Developer-run, NOT runtime. The plan's MVP Decision 2 forbids runtime
 * API pulls; this script's output is what ships. Re-run when a dictionary
 * release is updated — the produced JSON is deterministic (sorted by
 * code, stable alias dedup) so the diff is human-reviewable.
 *
 * Usage:
 *   node scripts/build-terminology-pack.mjs                # all 4 systems
 *   node scripts/build-terminology-pack.mjs --systems=loinc,ciel
 *
 * Env (NEVER committed):
 *   WHO_ICD11_CLIENT_ID, WHO_ICD11_CLIENT_SECRET — ICD-10 + ICD-11
 *   LOINC_VERSION, CIEL_VERSION                   — optional version pins
 *
 * Outputs each file's size + entry count + post-write SNOMED audit. Any
 * source failure prints the error but doesn't abort the whole run —
 * partial snapshots are normal during dictionary refresh (e.g. WHO API
 * down → keep yesterday's ICD files).
 */
import { writeDictionary, auditDictionary, logDone } from './terminology-pack/util.mjs';
import { fetchDictionary as fetchLoinc } from './terminology-pack/loinc.mjs';
import { fetchIcd10, fetchIcd11 } from './terminology-pack/who-icd.mjs';
import { fetchDictionary as fetchCiel } from './terminology-pack/ciel.mjs';

const ALL_SYSTEMS = ['loinc', 'icd-10-who', 'icd-11-who', 'ciel'];
const SOURCES = {
  loinc: fetchLoinc,
  'icd-10-who': fetchIcd10,
  'icd-11-who': fetchIcd11,
  ciel: fetchCiel,
};

function parseArgs(argv) {
  const args = { systems: ALL_SYSTEMS };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--systems=')) {
      const list = a.slice('--systems='.length).split(',').map((s) => s.trim()).filter(Boolean);
      const invalid = list.filter((s) => !ALL_SYSTEMS.includes(s));
      if (invalid.length) {
        console.error(`Unknown system(s): ${invalid.join(', ')}. Valid: ${ALL_SYSTEMS.join(', ')}`);
        process.exit(2);
      }
      args.systems = list;
    } else if (a === '--help' || a === '-h') {
      console.error(`Usage: node scripts/build-terminology-pack.mjs [--systems=<csv>]`);
      console.error(`  Systems: ${ALL_SYSTEMS.join(', ')}`);
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const results = [];
  const failures = [];

  for (const systemId of args.systems) {
    process.stderr.write(`\n→ ${systemId}\n`);
    try {
      const dict = await SOURCES[systemId]();
      const writeResult = await writeDictionary(dict);
      const audit = await auditDictionary(systemId);
      results.push({ systemId, ...writeResult, ...audit });
      logDone(
        `  ✓ wrote ${audit.entries} entries (${(audit.bytes / 1024).toFixed(1)} KB) → ` +
        `dictionaries/${systemId}.json  [${audit.version}]`,
      );
    } catch (e) {
      failures.push({ systemId, error: e.message });
      console.error(`  ✗ ${systemId}: ${e.message}`);
    }
  }

  console.error('\n--- summary ---');
  for (const r of results) {
    console.error(
      `  ${r.systemId.padEnd(12)} ${String(r.entries).padStart(6)} entries  ` +
      `${(r.bytes / 1024).toFixed(1).padStart(8)} KB  ${r.version}`,
    );
  }
  for (const f of failures) {
    console.error(`  ${f.systemId.padEnd(12)} FAILED — ${f.error}`);
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
