# Standard codes starter packs

This directory holds curated terminology packs that the Standard codes
feature pre-applies on first open so a non-developer (Bhishan) doesn't
face an empty mapping screen.

See [NOTICE.md](./NOTICE.md) for the licensing posture (LOINC + ICD-11
attribution, SNOMED-deliberately-absent rationale).

## Pack format

Each pack is a JSON file matching the `StarterPack` type in
`../types.ts`:

```ts
interface StarterPack {
  id: string;          // matches the file basename
  formId: string;      // e.g. "app:pregnancy"
  concepts: FhirConcept[];
}

interface FhirConcept {
  questionName: string;       // XLSForm row name (NOT label)
  code: string;
  system: string;             // 'http://loinc.org' or 'http://id.who.int/icd/...'
  display: string;            // verbatim from the source terminology
  dictionaryVersion: string;  // e.g. "LOINC-2.82", "ICD11-2024-01"
  aliases: string[];          // V1 fuzzy-match synonyms
}
```

## `cht-mch-v1.json` — coverage notes

The current pack covers maternal-and-child-health bindings most CHT
deployments include. It assumes a `formId` of `app:pregnancy` and the
following XLSForm row names:

| `questionName`         | Status                                 |
| ---------------------- | -------------------------------------- |
| `lmp_date`             | Common; widely used in MCH templates   |
| `bp_systolic`          | TODO verify against real form          |
| `bp_diastolic`         | TODO verify against real form          |
| `weight_kg`            | TODO verify against real form          |
| `fundal_height_cm`     | TODO verify against real form          |
| `gravidity`            | TODO verify against real form          |
| `parity`               | TODO verify against real form          |
| `pregnancy_condition`  | TODO verify against real form          |

The `// TODO verify against real form` lines reflect that the gandaki
config used for grounding the broader plan is not available on a fresh
clone; row-name accuracy for v1.1 should be validated against a real
`app:pregnancy.xlsx` from a partner deployment. The downside of a name
mismatch is benign: the binding simply doesn't apply (`applyStarterPack`
silently skips concepts whose question key isn't otherwise in the
mapping), so the user sees fewer pre-filled rows rather than wrong codes
on the wrong fields.

## Alias source attestation

Aliases for each concept are derived from:

- LOINC display strings and common clinical abbreviations
  (`SBP`, `LMP`, `SFH` — generic medical educational terms not
  trademarked by SNOMED)
- ICD-11 display strings
- Common English-language clinical generic terms (`weight`, `patient weight`)

No alias was sourced from a SNOMED CT Preferred Term, Fully Specified
Name, or any SNOMED-derivative dictionary. The zero-SNOMED oracle in
`../roundtrip.test.ts` scans both the parsed object and the raw file
bytes (including alias text) on every CI run.

## Adding aliases

When extending the alias list:

- Pull from LOINC's "Component", "System", or "Method" display strings,
  or from generic clinical-educational terminology
- Do NOT copy from a SNOMED concept browser; that includes the
  apparently-generic ones
- One commit, one pack — keep changes reviewable
