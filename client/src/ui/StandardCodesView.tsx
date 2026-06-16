/**
 * Standard Codes — V1 mapping workbench (docs/plans/fhir-v1-workbench.md).
 *
 * PR1 shipped the SHELL (route + view wiring). PR2 (this file) adds the
 * workbench CORE: form picker → mappable-columns table → two-step
 * dictionary→code picker with starter-pack auto-applied pre-fills.
 * PR3 will add choice-level mapping + ICD-10/CIEL pack expansion.
 *
 * The reconciled mapping comes from `GET /api/fhir-mapping`; the route
 * also auto-applies the bundled `cht-mch-v1` pack as `'suggested'`
 * pre-fills so the screen never opens cold. Suggested entries show as
 * dashed chips with Accept/Change/Skip actions; confirmed entries are
 * solid chips. The save call writes only on confirmed user action —
 * opening + leaving the view on a balanced project is a byte-identical
 * no-op (the route's compare-before-write enforces this).
 *
 * No free-text code/path entry in the default flow (Designer
 * dealbreaker §D). The "Custom code…" escape hatch is intentionally
 * present but secondary.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  encodeChoiceKey,
  encodeQuestionKey,
  mappableQuestions,
  formCoverage,
  SELECT_TYPE_RE,
  type ChoiceMapping,
  type ChoiceRow,
  type FhirMapping,
  type QuestionMapping,
  type StarterPack,
  type XLSForm,
} from '@cht-ui/shared';
import { api } from '../api.js';
import { useApp } from '../state/store.js';

interface FormSummary {
  id: string;
  filename: string;
  category: 'app' | 'contact';
}

type LoadState =
  | { kind: 'loading' }
  | {
      kind: 'ok';
      mapping: FhirMapping;
      pack: StarterPack | null;
      forms: FormSummary[];
    }
  | { kind: 'error'; message: string };

export function StandardCodesView() {
  const project = useApp((s) => s.project);
  const setError = useApp((s) => s.setError);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [mappingRes, packRes, formsRes] = await Promise.all([
          api.getFhirMapping(),
          // Pack endpoint can fail (no bundled pack) — treat as null.
          api.getFhirPack().catch(() => null),
          api.listForms(),
        ]);
        if (!alive) return;
        // PR1 shell scope: app forms only. PR3 broadens to contact forms.
        const forms = formsRes.forms.filter((f) => f.category === 'app');
        setState({
          kind: 'ok',
          mapping: mappingRes.mapping,
          pack: packRes?.pack ?? null,
          forms,
        });
      } catch (e) {
        if (alive) setState({ kind: 'error', message: (e as Error).message });
      }
    })();
    return () => {
      alive = false;
    };
  }, [project?.path]);

  async function save(next: FhirMapping): Promise<void> {
    if (state.kind !== 'ok') return;
    setState({ ...state, mapping: next });
    try {
      await api.saveFhirMapping(next);
    } catch (e) {
      setError(`Couldn't save mapping: ${(e as Error).message}`);
    }
  }

  return (
    <div className="standard-codes-view">
      <header>
        <h1>Standard codes</h1>
        <p className="muted">
          Map each question to a clinical code so reports and dashboards
          can compare results across deployments.
        </p>
      </header>

      {!project?.hasAppForms ? (
        <EmptyNoAppForms />
      ) : state.kind === 'loading' ? (
        <p className="muted">Loading the mapping…</p>
      ) : state.kind === 'error' ? (
        <div className="card error">
          <strong>Couldn't load the mapping</strong>
          <p className="muted">{state.message}</p>
          <button
            type="button"
            onClick={() => setState({ kind: 'loading' })}
            className="link"
          >
            Try again
          </button>
        </div>
      ) : (
        <Workbench
          forms={state.forms}
          mapping={state.mapping}
          pack={state.pack}
          onSave={save}
        />
      )}
    </div>
  );
}

function EmptyNoAppForms() {
  return (
    <div className="card">
      <p className="muted">
        This project has no app forms yet. Add one from the Forms tab to start
        mapping its questions to standard codes.
      </p>
    </div>
  );
}

/* ============================ workbench core ============================ */

function Workbench(props: {
  forms: FormSummary[];
  mapping: FhirMapping;
  pack: StarterPack | null;
  onSave: (next: FhirMapping) => void;
}) {
  const [activeFormId, setActiveFormId] = useState<string>(
    props.forms[0]?.id ?? '',
  );
  const [survey, setSurvey] = useState<XLSForm | null>(null);
  const [loadingForm, setLoadingForm] = useState(false);

  useEffect(() => {
    if (!activeFormId) return;
    let alive = true;
    setLoadingForm(true);
    api
      .getForm(activeFormId)
      .then((res) => {
        if (alive) setSurvey(res.form);
      })
      .catch(() => {
        if (alive) setSurvey(null);
      })
      .finally(() => {
        if (alive) setLoadingForm(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFormId]);

  return (
    <>
      <FormPicker
        forms={props.forms}
        activeId={activeFormId}
        mapping={props.mapping}
        onPick={setActiveFormId}
      />

      {loadingForm ? (
        <p className="muted">Loading {activeFormId}…</p>
      ) : !survey ? (
        <p className="muted">Couldn't load form.</p>
      ) : (
        <MappableColumnsTable
          formId={activeFormId}
          survey={survey}
          mapping={props.mapping}
          pack={props.pack}
          onSave={props.onSave}
        />
      )}
    </>
  );
}

/* ============================ form picker ============================ */

function FormPicker(props: {
  forms: FormSummary[];
  activeId: string;
  mapping: FhirMapping;
  onPick: (id: string) => void;
}) {
  return (
    <section className="card form-picker">
      <label>
        <strong>Pick a report:</strong>{' '}
        <select
          value={props.activeId}
          onChange={(e) => props.onPick(e.target.value)}
        >
          {props.forms.map((f) => {
            // Coverage in the dropdown label needs a per-form survey to
            // compute. For PR2 we approximate using a key-prefix count
            // — sound, since codec keys start with `<formId>/`. PR3
            // upgrades to a coverage map computed once per form.
            const prefix = `${f.id}/`;
            const total = Object.keys(props.mapping.questionMappings).filter(
              (k) => k.startsWith(prefix),
            ).length;
            const confirmed = Object.entries(props.mapping.questionMappings)
              .filter(([k]) => k.startsWith(prefix))
              .filter(([, m]) => m.status === 'confirmed').length;
            return (
              <option key={f.id} value={f.id}>
                {f.filename} ({confirmed}/{total} confirmed)
              </option>
            );
          })}
        </select>
      </label>
    </section>
  );
}

/* ============================ columns table ============================ */

function MappableColumnsTable(props: {
  formId: string;
  survey: XLSForm;
  mapping: FhirMapping;
  pack: StarterPack | null;
  onSave: (next: FhirMapping) => void;
}) {
  const rows = useMemo(() => mappableQuestions(props.survey.survey), [props.survey]);
  const coverage = useMemo(() => {
    return formCoverage(rows, (name) => {
      const key = encodeQuestionKey(props.formId, name);
      return props.mapping.questionMappings[key];
    });
  }, [rows, props.mapping, props.formId]);

  function updateMapping(
    rowName: string,
    next: QuestionMapping | null,
  ): void {
    const key = encodeQuestionKey(props.formId, rowName);
    const nextMappings: Record<string, QuestionMapping> = {
      ...props.mapping.questionMappings,
    };
    if (next === null) {
      delete nextMappings[key];
    } else {
      nextMappings[key] = next;
    }
    props.onSave({
      ...props.mapping,
      questionMappings: nextMappings,
    });
  }

  /** PR3 — write a per-choice mapping. The key is built via the codec
   *  (`encodeChoiceKey`) — NEVER string concat (MVP §3 item 6: a
   *  `/`-bearing list_name or choice.name would false-orphan a live
   *  binding on the next reconcile pass). */
  function updateChoiceMapping(
    listName: string,
    choiceName: string,
    next: ChoiceMapping | null,
  ): void {
    const key = encodeChoiceKey(props.formId, listName, choiceName);
    const nextChoices: Record<string, ChoiceMapping> = {
      ...props.mapping.choiceMappings,
    };
    if (next === null) {
      delete nextChoices[key];
    } else {
      nextChoices[key] = next;
    }
    props.onSave({
      ...props.mapping,
      choiceMappings: nextChoices,
    });
  }

  return (
    <section className="card columns-table">
      <header className="coverage-summary">
        <strong>Coverage:</strong>{' '}
        <span className="confirmed">{coverage.confirmed} confirmed</span>
        {' · '}
        <span className="suggested">{coverage.suggested} suggested</span>
        {' · '}
        <span className="skipped">{coverage.skipped} skipped</span>
        {' · '}
        <span className="unmapped">{coverage.unmapped} unmapped</span>
        {' / '}
        <strong>{coverage.total}</strong> mappable
      </header>

      {rows.length === 0 ? (
        <p className="muted">
          No mappable questions in this form. (Plumbing rows — structural,
          inputs/, hidden, calculate — aren't shown here, matching Simple mode.)
        </p>
      ) : (
        <table className="codes-table">
          <thead>
            <tr>
              <th>Question</th>
              <th>Code</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = encodeQuestionKey(props.formId, row.name);
              const m = props.mapping.questionMappings[key];
              // PR3 — if the row is a `select_one X` / `select_multiple X`,
              // collect its choices so the row can expand to per-option
              // mapping. The `SELECT_TYPE_RE` regex captures the
              // list_name in group 2; we then look up matching choice
              // rows in form.choices.
              const selectMatch = row.type.trim().match(SELECT_TYPE_RE);
              const listName = selectMatch ? selectMatch[2]! : null;
              const choices = listName
                ? props.survey.choices.filter((c) => c.list_name === listName)
                : [];
              return (
                <MappableRow
                  key={row.rowId}
                  formId={props.formId}
                  rowName={row.name}
                  rowLabel={row.labels['en'] || row.name}
                  listName={listName}
                  choices={choices}
                  mapping={m}
                  choiceMappings={props.mapping.choiceMappings}
                  pack={props.pack}
                  onChange={(next) => updateMapping(row.name, next)}
                  onChoiceChange={(choiceName, nextChoice) =>
                    updateChoiceMapping(listName!, choiceName, nextChoice)
                  }
                />
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ============================ per-row UI ============================ */

function MappableRow(props: {
  formId: string;
  rowName: string;
  rowLabel: string;
  /** PR3 — when the row is a `select_*`, the list_name + choices feed
   *  the choice-level expansion. `null`/empty = non-select row. */
  listName: string | null;
  choices: ChoiceRow[];
  mapping: QuestionMapping | undefined;
  choiceMappings: Record<string, ChoiceMapping>;
  pack: StarterPack | null;
  onChange: (next: QuestionMapping | null) => void;
  onChoiceChange: (choiceName: string, next: ChoiceMapping | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showChoices, setShowChoices] = useState(false);
  const m = props.mapping;
  const status: 'confirmed' | 'suggested' | 'skipped' | 'unmapped' = m
    ? (m.status as 'confirmed' | 'suggested' | 'skipped' | 'orphaned') ===
      'orphaned'
      ? 'unmapped' // shouldn't surface in the columns table
      : (m.status as 'confirmed' | 'suggested' | 'skipped')
    : 'unmapped';

  function accept(): void {
    if (!m) return;
    props.onChange({
      ...m,
      status: 'confirmed',
      confirmedBy: 'workbench-user',
      confirmedAt: new Date().toISOString(),
    });
  }

  function skip(): void {
    props.onChange({
      code: m?.code ?? '',
      system: m?.system ?? '',
      display: m?.display ?? '',
      dictionaryVersion: m?.dictionaryVersion ?? '',
      source: m?.source ?? 'manual',
      status: 'skipped',
      confirmedBy: 'workbench-user',
      confirmedAt: new Date().toISOString(),
      extras: m?.extras ?? {},
    });
  }

  function pick(picked: { code: string; system: string; display: string; dictionaryVersion: string }): void {
    props.onChange({
      code: picked.code,
      system: picked.system,
      display: picked.display,
      dictionaryVersion: picked.dictionaryVersion,
      source: 'manual',
      status: 'confirmed',
      confirmedBy: 'workbench-user',
      confirmedAt: new Date().toISOString(),
      extras: m?.extras ?? {},
    });
    setEditing(false);
  }

  return (
    <>
      <tr className={`row-status-${status}`}>
        <td>
          <strong>{props.rowLabel}</strong>
          <br />
          <code className="muted small">{props.rowName}</code>
        </td>
        <td>
          {m && (m.status === 'confirmed' || m.status === 'suggested') ? (
            <span className={`code-chip ${m.status}`}>
              <code>{m.code}</code>
              <span className="muted small"> ({systemLabel(m.system)})</span>
              <br />
              <span className="muted small">{m.display}</span>
            </span>
          ) : m && m.status === 'skipped' ? (
            <span className="muted">— skipped —</span>
          ) : (
            <span className="muted">— no code yet —</span>
          )}
        </td>
        <td>
          <span className={`status-chip status-${status}`}>{statusLabel(status)}</span>
        </td>
        <td>
          {status === 'suggested' && (
            <>
              <button type="button" className="primary" onClick={accept}>
                Accept
              </button>{' '}
              <button type="button" onClick={() => setEditing(true)}>
                Change
              </button>{' '}
              <button type="button" className="link" onClick={skip}>
                Skip
              </button>
            </>
          )}
          {status === 'confirmed' && (
            <>
              <button type="button" onClick={() => setEditing(true)}>
                Change
              </button>{' '}
              <button type="button" className="link" onClick={skip}>
                Skip
              </button>
            </>
          )}
          {status === 'skipped' && (
            <button type="button" onClick={() => setEditing(true)}>
              Map instead
            </button>
          )}
          {status === 'unmapped' && (
            <button type="button" onClick={() => setEditing(true)}>
              Pick a code…
            </button>
          )}
          {/* PR3 — `select_*` row gets an extra toggle to expand its
              choices for per-option mapping. Only shown for rows with
              ≥1 choice in the form's choice list. */}
          {props.listName && props.choices.length > 0 && (
            <>
              {' '}
              <button
                type="button"
                className="link expand-choices"
                onClick={() => setShowChoices((s) => !s)}
                aria-expanded={showChoices}
              >
                {showChoices ? '▾ hide options' : `▸ map ${props.choices.length} option${props.choices.length === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </td>
      </tr>
      {editing && props.pack && (
        <tr className="picker-row">
          <td colSpan={4}>
            <TwoStepPicker
              pack={props.pack}
              onPick={pick}
              onCancel={() => setEditing(false)}
            />
          </td>
        </tr>
      )}
      {/* PR3 — choice-level mapping rows. Rendered as sub-rows under the
          parent question; each carries its own (formId, list_name,
          choice.name) key in choiceMappings. Key is codec-built so a
          `/`-bearing choice name never false-orphans (MVP §3 item 6). */}
      {showChoices &&
        props.choices.map((choice) => (
          <ChoiceMappingRow
            key={choice.rowId}
            choice={choice}
            mapping={
              props.choiceMappings[
                encodeChoiceKey(props.formId, props.listName!, choice.name)
              ]
            }
            pack={props.pack}
            onChange={(next) => props.onChoiceChange(choice.name, next)}
          />
        ))}
    </>
  );
}

/* ============================ choice-level row ============================ */

/**
 * PR3 — per-option mapping row, rendered as a sub-row under a `select_*`
 * question when the user expands "map N options". Same Accept/Change/Skip
 * affordances as `MappableRow`, but writes into `mapping.choiceMappings`
 * (keyed by codec-built `(formId, list_name, choice.name)` per MVP §3
 * item 6). The starter pack today carries no choice-level concepts, so
 * choices arrive `unmapped` until the user picks one via the two-step
 * picker.
 */
function ChoiceMappingRow(props: {
  choice: ChoiceRow;
  mapping: ChoiceMapping | undefined;
  pack: StarterPack | null;
  onChange: (next: ChoiceMapping | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const m = props.mapping;
  const status: 'confirmed' | 'suggested' | 'skipped' | 'unmapped' = m
    ? (m.status as 'confirmed' | 'suggested' | 'skipped' | 'orphaned') === 'orphaned'
      ? 'unmapped'
      : (m.status as 'confirmed' | 'suggested' | 'skipped')
    : 'unmapped';

  function skip(): void {
    props.onChange({
      code: m?.code ?? '',
      system: m?.system ?? '',
      display: m?.display ?? '',
      dictionaryVersion: m?.dictionaryVersion ?? '',
      source: m?.source ?? 'manual',
      status: 'skipped',
      confirmedBy: 'workbench-user',
      confirmedAt: new Date().toISOString(),
      extras: m?.extras ?? {},
    });
  }

  function pick(picked: { code: string; system: string; display: string; dictionaryVersion: string }): void {
    props.onChange({
      code: picked.code,
      system: picked.system,
      display: picked.display,
      dictionaryVersion: picked.dictionaryVersion,
      source: 'manual',
      status: 'confirmed',
      confirmedBy: 'workbench-user',
      confirmedAt: new Date().toISOString(),
      extras: m?.extras ?? {},
    });
    setEditing(false);
  }

  const label = props.choice.labels['en'] || props.choice.name;

  return (
    <>
      <tr className={`choice-row row-status-${status}`}>
        <td className="choice-cell">
          ↳ <strong>{label}</strong>{' '}
          <code className="muted small">{props.choice.name}</code>
        </td>
        <td>
          {m && (m.status === 'confirmed' || m.status === 'suggested') ? (
            <span className={`code-chip ${m.status}`}>
              <code>{m.code}</code>
              <span className="muted small"> ({systemLabel(m.system)})</span>
              <br />
              <span className="muted small">{m.display}</span>
            </span>
          ) : m && m.status === 'skipped' ? (
            <span className="muted">— skipped —</span>
          ) : (
            <span className="muted">— no code yet —</span>
          )}
        </td>
        <td>
          <span className={`status-chip status-${status}`}>{statusLabel(status)}</span>
        </td>
        <td>
          {status === 'unmapped' && (
            <button type="button" onClick={() => setEditing(true)}>
              Pick a code…
            </button>
          )}
          {status === 'confirmed' && (
            <>
              <button type="button" onClick={() => setEditing(true)}>
                Change
              </button>{' '}
              <button type="button" className="link" onClick={skip}>
                Skip
              </button>
            </>
          )}
          {status === 'skipped' && (
            <button type="button" onClick={() => setEditing(true)}>
              Map instead
            </button>
          )}
        </td>
      </tr>
      {editing && props.pack && (
        <tr className="picker-row">
          <td colSpan={4}>
            <TwoStepPicker
              pack={props.pack}
              onPick={pick}
              onCancel={() => setEditing(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/* ============================ two-step picker ============================ */

function TwoStepPicker(props: {
  pack: StarterPack;
  onPick: (picked: { code: string; system: string; display: string; dictionaryVersion: string }) => void;
  onCancel: () => void;
}) {
  // Enumerate dictionaries from the pack — every distinct `system` URL.
  // The plan's locked set is LOINC + ICD-10 + ICD-11 + CIEL; today the
  // pack carries LOINC + ICD-11. PR3 backfills the other two.
  const dictionaries = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of props.pack.concepts) {
      if (!seen.has(c.system)) seen.set(c.system, systemLabel(c.system));
    }
    return Array.from(seen.entries()).map(([url, label]) => ({ url, label }));
  }, [props.pack]);

  const [activeDict, setActiveDict] = useState<string>(dictionaries[0]?.url ?? '');
  const [search, setSearch] = useState('');

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return props.pack.concepts.filter((c) => {
      if (c.system !== activeDict) return false;
      if (!q) return true;
      return (
        c.display.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.aliases.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [props.pack, activeDict, search]);

  return (
    <div className="two-step-picker">
      <div className="picker-step">
        <strong>1. Dictionary:</strong>
        <div className="row gap dict-buttons">
          {dictionaries.map((d) => (
            <button
              key={d.url}
              type="button"
              className={activeDict === d.url ? 'active' : 'link'}
              onClick={() => setActiveDict(d.url)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <div className="picker-step">
        <strong>2. Pick a code:</strong>
        <input
          type="search"
          className="picker-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by clinical name (e.g. systolic, fundal height, LMP)"
          autoFocus
        />
        <ul className="picker-results">
          {matches.length === 0 ? (
            <li className="muted">No matches in this dictionary.</li>
          ) : (
            matches.map((c) => (
              <li key={`${c.system}-${c.code}`}>
                <button
                  type="button"
                  className="picker-result"
                  onClick={() =>
                    props.onPick({
                      code: c.code,
                      system: c.system,
                      display: c.display,
                      dictionaryVersion: c.dictionaryVersion,
                    })
                  }
                >
                  <code>{c.code}</code> — {c.display}
                  {c.aliases.length > 0 && (
                    <span className="muted small"> (also: {c.aliases.slice(0, 3).join(', ')})</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
      <div className="picker-actions">
        <button type="button" className="link" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ============================ helpers ============================ */

function statusLabel(s: 'confirmed' | 'suggested' | 'skipped' | 'unmapped'): string {
  switch (s) {
    case 'confirmed':
      return 'Confirmed';
    case 'suggested':
      return 'Suggested (review)';
    case 'skipped':
      return 'Skipped';
    case 'unmapped':
      return 'Not mapped';
  }
}

/** Friendly label for a system URL. Falls back to the URL when unknown. */
function systemLabel(system: string): string {
  if (system === 'http://loinc.org') return 'LOINC';
  if (system.startsWith('http://id.who.int/icd/release/10')) return 'ICD-10';
  if (system.startsWith('http://id.who.int/icd/release/11')) return 'ICD-11';
  if (system.startsWith('https://app.openconceptlab.org')) return 'CIEL';
  return system;
}
