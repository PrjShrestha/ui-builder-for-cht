<!--
User-facing how-to: build an ANC home-visit task with 8 touchpoints via the no-code
Tasks builder. Grounded in the current Tasks/Events editor (2026-06-28). Flags the one
part (LMP-date-anchored scheduling) that still needs the Raw JS toggle today, and
points at the queued "event date-anchor picker" that will make it fully no-code.
-->

# How-to: ANC visit task with 8 touchpoints (no-code)

Build a task that fires once a **pregnancy** form is submitted and schedules **8 ANC
home visits** at weeks **12, 20, 26, 30, 34, 36, 38, 40**.

**Status of no-code coverage:** the trigger, the "known LMP" condition, and the 8 visit
windows are **fully point-and-click**. The one part that isn't fully no-code *today* is
anchoring the schedule to the **LMP date field** (vs. the submission date) — that needs
the Events **Raw JS** toggle until the queued *event date-anchor picker* ships.

## Prerequisite
A **`pregnancy` app form** with an **LMP date question** (a `date` field, e.g. `lmp_date`).

## Steps (Tasks tab)

1. **Add the task** — Tasks → **+ New task**. Set **name** + **title** (title is a
   translation key; the editor hints where the EN/NE strings live in `.properties`).
2. **Trigger** — **`appliesTo`** = `reports` (default); **`appliesToType`** → tick
   **`pregnancy`**. Now it fires when a pregnancy form is submitted.
3. **`appliesIf` = known LMP** — in the appliesIf builder (its field picker is scoped to
   the pregnancy form), add **`lmp_date` is not empty** (or `lmp_method` = known).
4. **Priority** (optional) — high/medium.
5. **Events → `+ Event` ×8** — for each, set **`id`**, the due offset, and the window
   (`start` = days before due it opens, `end` = days after it closes; e.g. 7 / 14):

| Event id | Week | days |
|---|---|---|
| `anc_12` | 12 | 84 |
| `anc_20` | 20 | 140 |
| `anc_26` | 26 | 182 |
| `anc_30` | 30 | 210 |
| `anc_34` | 34 | 238 |
| `anc_36` | 36 | 252 |
| `anc_38` | 38 | 266 |
| `anc_40` | 40 | 280 |

## The one catch: "after LMP" vs "after submission"

The visual `days` field means **"days after the report's `reported_date`"** (when the
form was *submitted*), not after the LMP date.

- **Register at/near the LMP** (`reported_date` ≈ LMP)? The table above is correct —
  fill in the 8 `days` and you're **done, fully no-code**.
- **Need it clinically anchored to LMP** (so *late* registrations still schedule by
  gestational age)? The per-event `dueDate` (LMP + N weeks) is **read-only in the visual
  builder today**. Switch Events → **Raw JS** and write it, using the **Insert field**
  button to drop in the LMP reference:

```js
events: [
  { id: 'anc-12', start: 7, end: 14, dueDate: (event, contact, report) => Utils.addDate(Utils.getLmpDate(report), 12 * 7) },
  { id: 'anc-20', start: 7, end: 14, dueDate: (event, contact, report) => Utils.addDate(Utils.getLmpDate(report), 20 * 7) },
  // …26, 30, 34, 36, 38, 40
]
```

(`Utils.addDate` / `Utils.getLmpDate` / `Utils.getField` are **globally available** in
the tasks runtime — nothing to declare; the **Insert field** button splices the field
reference for you. `Utils.getLmpDate(report)` handles the various LMP field locations; for
a generic date field use `Utils.addDate(new Date(Utils.getField(report, '<path>')), days)`.)

## Coming soon (fully no-code)
An **event date-anchor picker** is queued (DEV-HANDOFF, top priority): pick the
**anchor** (`reported_date` *or* a report date field like `lmp_date`), an **offset** in
days/weeks, and the window — and it generates the correct `dueDate` for you. Once it
ships, this whole task is point-and-click end-to-end.
