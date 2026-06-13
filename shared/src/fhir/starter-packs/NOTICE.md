# NOTICE — Standard codes starter packs

The `starter-packs/*.json` files in this directory redistribute curated
excerpts of third-party terminology content. The required attributions and
license posture are below. **All `display` strings are used verbatim with
no derivative edits.**

## LOINC (Logical Observation Identifiers Names and Codes)

> This material contains content from LOINC&reg; (http://loinc.org). LOINC
> is copyright &copy; 1995–2024, Regenstrief Institute, Inc. and the Logical
> Observation Identifiers Names and Codes (LOINC) Committee and is available
> at no cost under the license at http://loinc.org/license. LOINC&reg; is a
> registered United States trademark of Regenstrief Institute, Inc.

The LOINC excerpts in `cht-mch-v1.json` are a maternal-and-child-health
subset hand-curated against the LOINC 2.82 release (per the
`dictionaryVersion` field on each entry).

## ICD-11 (International Classification of Diseases, 11th Revision)

The ICD-11 excerpts in `cht-mch-v1.json` are reproduced under the World
Health Organization's **CC BY-ND 3.0 IGO** license
(<https://creativecommons.org/licenses/by-nd/3.0/igo/>):

> ICD-11 &copy; World Health Organization 2019/2024. Used under
> CC BY-ND 3.0 IGO.

The ND clause forbids derivative works on the term set. The `display`
strings in this pack are reproduced verbatim from the ICD-11 MMS
linearization (`http://id.who.int/icd/release/11/mms`) and have not been
edited.

## SNOMED CT — deliberately ABSENT

This pack contains zero SNOMED CT content. **Not in any `system` URI, not
under the SNOMED OID `2.16.840.1.113883.6.96`, and not in any free-text
`aliases[]` value.** This is enforced by a `node --test` assertion that
scans both the parsed object and the raw file bytes (see
`shared/src/fhir/roundtrip.test.ts`, the zero-SNOMED oracle).

SNOMED CT is free in 53 IHTSDO member countries and in low-income
countries under the SNOMED affiliate license waiver. Nepal is classified
as **lower-middle-income** under the World Bank's FY26 classifications
and therefore does NOT qualify for the waiver, so shipping SNOMED CT
content as part of this app would obligate every adopter to a per-territory
annual MLDS affiliate license + Statement of Usage. We instead expose
SNOMED only via a future "Add a terminology server" advanced setting where
the deployer plugs in their own licensed terminology service — their
license, their problem.

## Alias provenance (free-text)

The `aliases[]` entries (used by the future V1 typeahead) are derived from
LOINC display strings, common clinical abbreviations in widespread
educational use, and CIEL non-SNOMED concept attributes. **No SNOMED CT
Preferred Term or Fully Specified Name was used to source any alias.** This
preserves the SNOMED-free posture in the free-text path as well as the
`system` URI path.

## Adding new packs

When adding a new starter-pack JSON file:

1. Restrict `system` URIs to LOINC, ICD-11, or other freely-redistributable
   terminologies whose license permits inclusion in an open-source repo.
2. Add the corresponding attribution to this NOTICE.
3. Do **not** introduce SNOMED CT content in any field. CI (the
   `node --test` zero-SNOMED oracle) will fail the PR if you do.
