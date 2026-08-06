<!--
The single plain-language work queue. Written because the real detail had spread across
five review docs with P0/P1/P2 jargon that nobody outside the audits could follow.
This file is the list; the review docs stay as the evidence behind it. 2026-08-06.
-->

# What's next — the plain list

**One list, in order.** Each item says what it is, why it matters, and roughly how big. The
detailed evidence lives in the review docs linked per item — but you shouldn't need to read
them to know what to do next.

Status as of 2026-08-06: HEAD is `30c3d92`, pushed. All three geriatric-blocker features
shipped. All six field notes from the geriatric build shipped. Nothing below has started.

---

## GROUP A — Stop the tool from damaging configs (do first)

All small. Together they close a real risk: the tool can currently rewrite hand-written
JavaScript in `tasks.js` and `contact-summary-extras.js` in ways that change meaning
silently. **Nothing on disk is damaged today** — this is prevention, not cleanup.
Evidence: `docs/reviews/p0-verification-30c3d92-2026-08-05.md`.

**A1. Close the dangerous door in the Helpers tab.** *(~1 hour — do this one first)*
`ContactSummaryEditor.tsx:558`'s "✎ edit body" lets a user open a helper function whose
body the tool cannot faithfully rewrite. Measured on four real Nepal configs: **31 helper
bodies, none survive unchanged, 19 would crash on a device, 9 silently change meaning.**
Worse, `AppliesIfBuilder.tsx:207` tells the user *"nothing is dropped"* while it happens.
→ Only offer "edit body" for bodies the tool can round-trip losslessly; **delete that false
reassurance**; show a diff before saving. This is the cheapest, highest-value item in the
whole list because it removes the invitation while A2/A3 fix the cause.

**A2. Stop silently dropping code the parser doesn't understand.** *(small)*
The task-condition parser understands only `if (…) return false` guards plus one final
`return`. Everything else — `const`/`let`, loops, `else-if` branches, comments — is thrown
away, because the protective "keep the whole body as-is" fallback only triggers when
*nothing* was understood. That's backwards.
→ Flip it: if **anything** is unrecognised, keep the whole body verbatim. This single change
fixes the 19 crash cases and the 9 meaning-flips above.

**A3. Never rewrite the author's arguments.** *(small — PO directive)*
The tool currently rewrites `isAlive(contact)` into `isAlive(contact.contact)`. Whether that
argument is right is the config author's call, not ours — and it breaks our **own** shipped
malaria template (a check that never fired now fires for dead contacts).
→ Record the real argument and re-emit it unchanged; if the arguments don't match what we
expect, don't try to interpret the line at all. Spec:
`docs/handoff-argpreserve-and-translations-2026-08-06.md` §1.

**A4. Add our own templates as safety-net tests.** *(small)*
`server/templates/malaria/tasks.js` and a cht-default helper body become fixtures that must
survive an open-and-save unchanged. Either one would have caught A3 immediately.

**A5. Fix the "or" condition bracket bug.** *(one line + a test)*
Combining conditions with "or" can emit code where operator precedence changes the meaning —
e.g. a condition that should be false comes out true. The fix already exists in the file; it
just wasn't applied to one of the three places that needed it.

**A6. Fix the Decisions / sign-off view showing conditions backwards.** *(small)*
`DecisionsView.tsx:471-472` renders a "don't run this task when X" condition as "run this
task when X" — the **opposite**. That's the screen the MOH reviewer signs off on, so it
currently misstates the config.

---

## GROUP B — Finish the geriatric use case (do second)

The geriatric app is ~98% buildable without writing code. Two things block the last bit.
Evidence: `docs/reviews/geriatric-reaudit-2026-08-05.md`.

**B1. Let users create a translation key, with suggestions.** *(medium — PO directive)*
Right now a task's title needs a hand-typed identifier like `task.anc.followup.title`, and
the translations screen can only edit keys that already exist on disk — so a bilingual task
title can't be created in the tool at all. This blocks **17 of the 18 geriatric tasks**.
→ An "+ Add translation key" dropdown that suggests keys — led by *keys your config already
references but no file defines*, then CHT's naming conventions filled in with your real task
names, then a custom option. Plus: the task title becomes a picker showing the readable
string ("ANC follow-up") instead of the identifier, with inline Nepali + English entry.
Spec: `docs/handoff-argpreserve-and-translations-2026-08-06.md` §2.

**B2. Support "any of these options" conditions on multi-select questions.** *(medium)*
The only remaining thing in the geriatric spec that **cannot** be built no-code: a task that
fires when any of 5 checkboxes is ticked (the eye-examination task). The condition builder
only offers "equals", which is silently wrong for a multi-select.
→ Add a "includes / any of" operator, and only offer the choice dropdown when the field type
actually supports the chosen operator.

**B3. Fix the test that currently locks in the wrong answer.** *(small)*
The new automated test asserts the *incorrect* multi-select condition as if it were correct,
so it would block B2 from being fixed properly. Repoint it at a single-select field.

---

## GROUP C — Housekeeping (whenever there's slack)

- **C1. Make the automated tests actually run.** The server tests (72 of them) run on nobody's
  machine automatically, and the browser tests aren't all wired into CI. Add them.
- **C2. Triage the 8 failing browser tests.** They fail the same way before and after all this
  work — pre-existing, mostly click-timeout / off-screen-element issues. Expect CI red until
  these are looked at. (Dev already offered to take this.)
- **C3. Code-style checker is red** (110 errors, nearly all from one old config gap). Fix the
  config, then re-enable the check in CI.
- **C4.** `.gitignore` the stray `cht-district-form.png`.

---

## BACKLOG — real, but not blocking anything

Roughly in value order. Nothing here stops the geriatric build or risks data.

1. **Cross-form values are tedious** — pulling BMI/BP/sugar from another form takes ~7 steps
   per value. Works; could be one gesture.
2. **Pick a context value from a list, not free text** — one field in the cross-form builder
   is still a type-it-yourself box.
3. **"End the form here"** — e.g. stop when a patient declines consent. Today you wrap the
   remaining sections in a condition instead.
4. **Calculation tile is hidden** unless you switch to Advanced mode.
5. **Media cleanup** — replaced or deleted images stay in the project and keep shipping to
   devices; no "delete" and no warning for a missing image file.
6. **Text styling** — the geriatric spec's colour-coded/bold note text needs hand-typed
   markdown (~9 rows).
7. **Icon picker** — form icons are typed ids, not picked from a list. (Overlaps a request
   from the wider squad.)
8. **"Wrap these questions into a section"** — needs multi-select, which doesn't exist yet.
   Creating an empty section and adding questions to it already works.
9. **From the squad's MVP scope** (`docs/reviews/july16-meeting-synthesis.md` addendum):
   freeze variable names on already-deployed forms (renaming breaks collected data);
   assign a form to a role/persona; and treat the live preview as an *editing* surface, not
   just a preview.
