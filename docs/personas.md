# Personas — cht-ui-builder

The product is designed for **six personas**. Three of them double as the
**requirements + validation triad** that every substantive UI change is
dogfooded through; the other three are target users we design *for* and spawn
as **on-demand review lenses** when a change touches their surface.

**Naming scheme:** roles are the identity. Only three personas keep a human
name — **PO/PM = Bhishan, Designer = Lal, QA = Lorena**. Everyone else is named
by role.

## The six personas

| # | Role | Name | Can | Cannot | Key test |
|---|---|---|---|---|---|
| 1 | **PO / PM** | Bhishan | Build/edit forms (visual), decision tables, task schedules, reorder questions, edit choices, review flowcharts | Custom expressions, edit JSON, deploy to prod | Cold-start: build a complete form/task without a developer. Abandonment = MVP failed. |
| 2 | **Designer** | Lal | Everything PO/PM can + configure flows/journeys, flag UX/a11y, define workflows with MOH | Custom expressions, deploy to prod | UX audit quality: affordance, microcopy, a11y, cognitive load; severity-tagged punch list. |
| 3 | **Developer** | *(role)* | Everything above + custom JS, raw JSON/XLS escape hatch, deploy pipeline, git/rollback, FHIR/data-dictionary config | — (full power user) | Does the UI *reduce* his routine load, and is the escape hatch always present + lossless (round-trip)? |
| 4 | **MOH / Medical Reviewer** | *(role)* | View decision tables + flowcharts read-only, approve/flag clinical logic, auditable sign-off | Edit config, deploy, modify logic | Confirm a rule matches protocol in minutes, with a durable sign-off trail. |
| 5 | **Supervisor / Admin** | *(role)* | User management (create users, assign roles), hierarchy, view deploy status + change history | Modify clinical logic, edit form content, configure dictionaries | Stand up the hierarchy + roles without a developer; see what's deployed where. |
| 6 | **QA** | Lorena | Spec coverage, round-trip tests, CI + deterministic replay, fixture management, validate cht-conf output | (validation only) | Critical-path tests exist; a fresh engineer can run the malaria scenario day one. |

## Requirements + validation triad (always-on)

| Persona | Requirements role | Validation role |
|---|---|---|
| PO/PM — Bhishan | Works with DHOs/CHWs to learn what forms/tasks they need | Cold-start test — can he finish without a developer? |
| Designer — Lal | Works with MOH to finalize clinical workflows + sign-off | UX audit — severity-tagged punch list |
| QA — Lorena | N/A (pure QA) | Spec coverage, fixtures, round-trip, CI, replay |

Spawn all three in parallel for substantive UI changes. A change is "ready"
when Bhishan completes his journey, Lal's blocking items are fixed, and
Lorena's critical-path tests pass. For pure design proposals (no code), PO/PM +
Designer suffice; QA re-enters once implementation lands.

## On-demand review lenses (not the default triad)

Spawn selectively when a change touches their surface:

- **Developer** — escape hatch / round-trip safety / deploy / FHIR-standard-codes.
- **MOH Reviewer** — the Decisions (sign-off) surface, flowcharts, terminology-binding sign-off.
- **Supervisor** — Hierarchy, user/role management, deployment history.

> The authoritative, always-current persona definitions live in user-scoped
> memory (outside this repo). This file mirrors them so any session — including
> ones that can't read that memory — shares the same definitions. Last synced
> 2026-06-05.
