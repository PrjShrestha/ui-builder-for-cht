/**
 * Standard Codes — V1 mapping workbench (docs/plans/fhir-v1-workbench.md).
 *
 * The single place codes are assigned to questions and choices across
 * every app form in the project. PR1 ships the SHELL: route wiring,
 * loading/empty/error states, and the inline "no app forms" + "no
 * sidecar yet" affordances. PR2 lands the workbench core (form picker
 * → mappable-columns table → two-step dictionary→code picker); PR3 the
 * choice-level expansion + multi-dictionary pack readiness.
 *
 * The reconciled mapping comes from `GET /api/fhir-mapping`; the route
 * reconciles the on-disk sidecar against the project's live keys so
 * renamed/deleted questions show up under `orphans[]` losslessly
 * (never silently dropped). Opening + leaving this view on a balanced
 * project is a byte-identical no-op on disk (the route's compare-
 * before-write enforces this).
 */
import { useEffect, useState } from 'react';
import type { FhirMapping } from '@cht-ui/shared';
import { api } from '../api.js';
import { useApp } from '../state/store.js';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; mapping: FhirMapping }
  | { kind: 'error'; message: string };

export function StandardCodesView() {
  const project = useApp((s) => s.project);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.getFhirMapping();
        if (alive) setState({ kind: 'ok', mapping: res.mapping });
      } catch (e) {
        if (alive) setState({ kind: 'error', message: (e as Error).message });
      }
    })();
    return () => {
      alive = false;
    };
    // Reload whenever the project changes — the sidecar is project-local.
  }, [project?.path]);

  return (
    <div className="standard-codes-view">
      <header>
        <h1>Standard codes</h1>
        <p className="muted">
          Map each question to a clinical code so reports and dashboards
          can compare results across deployments. (FHIR-style codes from
          LOINC, ICD-10, ICD-11, and CIEL.)
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
        <WorkbenchShell mapping={state.mapping} />
      )}
    </div>
  );
}

/** Empty state for projects with no `app:*` forms — nothing to map. */
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

/** Workbench shell rendered when the mapping is loaded. PR1 stops here
 *  with a summary card; PR2 fills in the form picker + mappable-columns
 *  table + two-step picker. */
function WorkbenchShell(props: { mapping: FhirMapping }) {
  const { mapping } = props;
  const questionCount = Object.keys(mapping.questionMappings).length;
  const orphanCount = mapping.orphans.length;
  const confirmedCount = Object.values(mapping.questionMappings).filter(
    (m) => m.status === 'confirmed',
  ).length;
  const suggestedCount = Object.values(mapping.questionMappings).filter(
    (m) => m.status === 'suggested',
  ).length;
  const skippedCount = Object.values(mapping.questionMappings).filter(
    (m) => m.status === 'skipped',
  ).length;

  return (
    <>
      <section className="card">
        <h2>Mapping summary</h2>
        {questionCount === 0 ? (
          <p className="muted">
            No mappings yet. The workbench will land in the next slice —
            it'll suggest the standard codes from the bundled MCH starter
            pack and let you Accept, Change, or Skip each one.
          </p>
        ) : (
          <ul className="standard-codes-summary">
            <li>
              <strong>{confirmedCount}</strong> confirmed
            </li>
            <li>
              <strong>{suggestedCount}</strong> suggested (awaiting your review)
            </li>
            <li>
              <strong>{skippedCount}</strong> skipped (no code applies)
            </li>
            {orphanCount > 0 && (
              <li className="orphan-line">
                <strong>{orphanCount}</strong> orphaned — saved mappings whose
                questions no longer exist in the surveys. Lossless; review and
                re-attach in the next slice.
              </li>
            )}
          </ul>
        )}
      </section>

      {/* Placeholder for the form picker + columns table. PR2 replaces
          this section with the real workbench. Surfacing the shape now
          gives reviewers something to click against and confirms the
          route wiring works end-to-end. */}
      <section className="card placeholder">
        <h3>Form picker + mappable columns</h3>
        <p className="muted">
          Coming in PR2 — pick an app form, see its mappable rows, and
          assign a dictionary + code per row. The bundled starter pack
          pre-fills suggestions so the screen never opens cold.
        </p>
      </section>
    </>
  );
}
