<!--
Planner-locked feature plan. Mimic cht-conf's targeted form upload in the Deploy panel:
deploy only the forms that changed, instead of the whole config.
Grounded against the current Deploy/cht-conf integration on 2026-06-19.
-->

# Plan: Deploy only changed/selected forms (mimic cht-conf targeted upload)

**Version:** v0.1 — 2026-06-19 · **Status:** PLANNER-LOCKED, developer-ready.

## Feasibility — YES, and the backend already supports it
cht-conf's targeted upload is a positional-args feature on its existing actions:
```
cht <target> convert-app-forms -- death_report immunization    # local: xlsx → xml for just these
cht <target> upload-app-forms  -- death_report immunization    # upload only these forms
cht <target> upload-contact-forms -- person clinic
```
(form name = the `.xlsx` basename, no extension — e.g. `death_report`.)

Our run-action route **already accepts `extraArgs`** and appends them after the action:
- `POST /api/cht-conf/runs` body type includes `extraArgs?: string[]` ([cht-conf.ts:292](../../server/src/routes/cht-conf.ts#L292));
- it passes `req.body.extraArgs ?? []` into `buildArgs` ([:305](../../server/src/routes/cht-conf.ts#L305)), which does `args.push(action); args.push(...extras)` ([:196-197](../../server/src/routes/cht-conf.ts#L196)).

So the server can run a targeted upload **today** — the gap is entirely client-side: `api.runChtConfAction(action, pw)` doesn't forward `extraArgs`, and DeployPanel runs every action whole (no form selection).

## Scope

### 1. Thread `extraArgs` through the client API
`api.runChtConfAction(action, pw?, extraArgs?: string[])` → include `extraArgs` in the POST body. (Backend already reads it; zero server change for the single-action path.)

### 2. Form picker in DeployPanel
For the form-scoped actions — `convert-app-forms`, `upload-app-forms`, `upload-contact-forms` — show a **checklist of that category's forms** (from the project's form list / store). Default = **all checked** (preserves today's whole-config behavior). On run, pass the selected basenames as `extraArgs = ['--', ...basenames]`.
- Map each form's `formId` (`app:death_report`) → basename (`death_report`) for the args; app forms feed `upload-app-forms`, contact forms feed `upload-contact-forms`.
- **Show the exact command preview** (`cht … upload-app-forms -- death_report`) so the user sees precisely what will be uploaded (Bhishan/Designer: honesty about scope).

### 3. "Changed forms" quick-pick (the headline win)
New server endpoint `GET /api/forms/changed` → run `git -C <projectRoot> status --porcelain -- forms/` (and/or `git diff --name-only HEAD -- forms/`), parse changed `*.xlsx` under `forms/app` + `forms/contact`, return `[{ category, basename, formId }]`. Graceful fallback: if the project isn't a git repo, return `{ git: false }` and the UI hides/disables the quick-pick (manual checklist still works).
- DeployPanel: a **"Select changed (N)"** button that checks exactly those boxes. Use **working-tree** changes (`status --porcelain`) so it catches both unstaged edits and forms you just saved this session.

### 4. Targeted convert→upload as a pair
`upload-app-forms` uploads the **converted XML**, which is stale right after an xlsx edit — so a targeted deploy must `convert-app-forms -- <names>` first, then `upload-app-forms -- <names>`. MVP: run them as **two single-action calls** with the same `extraArgs` (the UI already runs single actions). Nicer follow-up: extend the **sequence** endpoint ([cht-conf.ts:379](../../server/src/routes/cht-conf.ts#L379)) to carry per-action `extraArgs` so it's one "Deploy changed forms" button.

## Correctness / safety
- **No parser or round-trip impact** — this only narrows *what cht-conf uploads*; it touches no project files. Deployment remains cht-conf's job.
- The two correctness-sensitive bits: the **`--` separator** before names, and the **formId→basename** mapping. Smoke-test once against `--local` that `convert-app-forms -- death_report` + `upload-app-forms -- death_report` upload exactly that form. (cht-conf v3.18.x supports the `-- <names>` form; confirm on the bundled version.)
- Keep the dangerous/whole-config deploy exactly as-is; targeted is additive.

## Tests
- **api/route:** a request with `extraArgs: ['--','death_report']` produces a spawn whose `loggedArgs` end in `upload-app-forms -- death_report` (assert via the existing run-record/loggedArgs).
- **changed-detection unit:** parse a sample `git status --porcelain` output → correct basenames + categories; non-git project → `{ git:false }`.
- **e2e:** open Deploy, "Select changed", assert the command preview shows `-- <names>` and only the changed forms are listed; manual uncheck narrows it.

## Persona notes
- **Bhishan (PO/PM):** "I fixed one form — just push that one" is the common, low-risk case; full deploys are slow and scary. The command preview + "Select changed" makes scope obvious.
- **Developer:** mirrors the real cht-conf workflow (`upload-app-forms -- <names>`); the on-demand lens should confirm the `--`/basename handling matches cht-conf exactly.
- **QA (Lorena):** the loggedArgs assertion + changed-detection unit are the critical-path guards.

## Decisions (planner-locked, 2026-06-19)
1. **"Changed" = working-tree diff.** `git status --porcelain -- forms/` (plus untracked `*.xlsx`), not a deploy baseline. It's exactly what a user means by "what I changed," catches both unstaged edits and forms just saved this session, and needs no new persisted state. (A deploy-baseline is out of scope — we don't track last-deployed state.)
2. **v1 = two clicks (convert, then upload).** The targeted flow runs `convert-app-forms -- <names>` then `upload-app-forms -- <names>` as two single-action calls sharing the same `extraArgs` — no server change needed (the run-action path already carries `extraArgs`). Folding them into one "Deploy changed forms" button requires extending the **sequence** endpoint ([cht-conf.ts:379](../../server/src/routes/cht-conf.ts#L379)) to carry per-action `extraArgs`; **defer that to a follow-up** once the two-click flow is proven.
