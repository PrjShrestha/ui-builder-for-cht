<!--
Planner plan for the "event date-anchor picker" — the DO-FIRST task-scheduling
feature that makes LMP-anchored (report-date-field-anchored) multi-touchpoint task
schedules fully no-code. Pins the shared eventsParser parse/serialize contract +
round-trip cases so the dev can build without re-deriving it. 2026-06-28.
-->

# Plan: event date-anchor picker (task scheduling)

**Status:** v0.1 — PLANNER-LOCKED, **DO-FIRST** (PO priority 2026-06-28) · **Owner:** planner
· **Drives:** `docs/guides/anc-8-touchpoint-task.md` becomes fully no-code.

## 1. Problem
The Tasks → Events builder (`EventsEditor.tsx`) only offers a numeric **`days`** field,
labelled "days after the report's `reported_date`." So any schedule anchored to a
**report date field** (e.g. LMP) — the clinically correct anchor for ANC — drops to the
Raw JS `dueDate` (read-only in the visual builder today). Goal: a per-event **anchor +
offset** control so LMP-anchored multi-visit schedules are point-and-click.

## 2. UI (per event, in `EventRow`)
Replace the lone `days` input with:
- **Anchor** dropdown: `Submission date (reported_date)` (default) **or** a **report
  date field** — populated from the `appliesToType` form's `date`-type questions (reuse
  the field-picker scoping already wired for appliesIf/events; list only `date` questions).
- **Offset**: number + **unit** toggle (`days` / `weeks`).
- **Window**: existing `start` / `end` (unchanged).
- **Raw JS** fallback preserved; the existing Insert-field helper stays for advanced dueDates.

Fallbacks: if `appliesToType` is empty or has no date fields → anchor offers only
`reported_date` (+ raw). `weeks` is sugar: stored/emitted as `weeks*7` days.

## 3. Shared `eventsParser` contract (the load-bearing part)
Current: `SimpleEvent { id, days?, start?, end?, dueDateRaw?, extras }`, `shape: 'array' | 'raw'`.

**Extend** `SimpleEvent` with an optional structured anchor:
```
anchor?: { kind: 'reported_date' } | { kind: 'field', field: string }
offset?: { value: number, unit: 'days' | 'weeks' }
```
Keep `days` for the plain case and `dueDateRaw` for anything unrecognized.

**parse** — recognize exactly these `dueDate` shapes into structured form; everything
else stays `dueDateRaw` (raw fallback, as today):
- `addDays(getField(report, 'X'), N)` → `anchor:{kind:'field',field:'X'}, offset:{value:N,unit:'days'}`
- `addDays(getField(report, 'X'), N*7)` → `offset:{value:N,unit:'weeks'}`
- `addDays(report.reported_date, N)` (and `*7`) → `anchor:{kind:'reported_date'}`
- a bare `days: N` (no dueDate) → unchanged (`days:N`, implicit reported_date+days)

**serialize** — deterministic inverse, chosen to preserve byte-stability of existing forms:
- `reported_date` + `days` unit, no `dueDate` originally → emit **`days: N`** (unchanged — do NOT rewrite existing plain events into dueDate form).
- `field` anchor, or `weeks` unit, or reported_date expressed as a dueDate → emit
  `dueDate: (event, contact, report) => addDays(getField(report, '<field>'), <days>)`.
- `dueDateRaw` present → emit it verbatim.

**Helper strategy (OPEN — confirm CHT convention via cht-specialist before coding):**
the emitted `dueDate` needs a date-add + field-get. Options: (A) CHT nootils/Utils
globally available in the tasks runtime; (B) ensure `addDays`/`getField` exist in the
project's `tasks-extras.js` and reference them (preflight/generator offers to add if
missing). Pick the CHT-idiomatic form; document the assumption; the preflight validator
should flag a missing helper. **Do not ship until this is confirmed** — a wrong helper
name reproduces the exact silent-runtime-failure class we've been fighting.

## 4. Round-trip test cases (`shared/src/tasks/*.test.ts`)
- plain `days: 84` ↔ byte-stable (no dueDate introduced).
- field anchor + weeks ↔ `dueDate: ... addDays(getField(report,'lmp_date'), 84)`.
- the full **ANC 8** array (weeks 12/20/26/30/34/36/38/40) round-trips.
- generator form `schedule.map(...)` → stays `shape:'raw'`, verbatim.
- an unrecognized `dueDate` → `dueDateRaw`, verbatim.
- parse → serialize → parse is stable for all of the above.

## 5. Acceptance
- The ANC 8-touchpoint task is fully no-code, LMP-anchored, end-to-end.
- Existing forms with plain `days` are **byte-unchanged**.
- Any dueDate the parser doesn't recognize is preserved verbatim (raw fallback holds).

## 6. Out of scope
Contact-field anchors (report-only for now); multi-report anchors; dueDate expressions
beyond `addDays(anchor, offset)` (stay raw). No changes to `appliesIf`/`actions`.

## 7. Open decisions
1. **Helper strategy** (§3) — nootils vs `tasks-extras`; needs a CHT-conventions check.
2. Whether `reported_date + days` ever migrates to dueDate form — **recommend no** (keep
   `days`, back-compat) unless the user picks `weeks`.
