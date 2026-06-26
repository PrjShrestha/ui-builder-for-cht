# Vendored terminology dictionaries

This directory holds the snapshot JSON files the Standard-codes picker
queries via `GET /api/fhir/dictionary/search`:

| File | System | Source | Free? |
| --- | --- | --- | --- |
| `loinc.json` | LOINC | NLM Clinical Tables API | ✓ |
| `icd-10-who.json` | ICD-10 (WHO) | WHO ICD API | requires `WHO_ICD11_CLIENT_ID` + `WHO_ICD11_CLIENT_SECRET` env vars |
| `icd-11-who.json` | ICD-11 (WHO) | WHO ICD API | same WHO creds |
| `ciel.json` | CIEL | OCL CIEL source API | ✓ |

**These files are developer-snapshotted, not runtime-fetched** (plan MVP
Decision 2). Refresh by running:

```sh
# Build shared first — the script imports from shared/dist/.
pnpm --filter @cht-ui/shared build

# All four systems (needs WHO creds):
node scripts/build-terminology-pack.mjs

# Just the free sources:
node scripts/build-terminology-pack.mjs --systems=loinc,ciel
```

WHO creds are free — register at <https://icd.who.int/icdapi/> and export
the client_id + client_secret as env vars. They are never committed.

Each JSON file is sorted by `code` so diffs across snapshots are
human-reviewable. The pre-write zero-SNOMED scan ([snomedFilter.ts])
catches any SNOMED-sourced content the source modules let through — the
script refuses to write a file that fails the scan, and the
`shared/src/fhir/roundtrip.test.ts` oracle re-runs the scan on every
committed file in CI.

[snomedFilter.ts]: ../snomedFilter.ts
