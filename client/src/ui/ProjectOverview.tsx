import { useApp } from '../state/store.js';

export function ProjectOverview() {
  const project = useApp((s) => s.project);
  const setView = useApp((s) => s.setView);
  if (!project) return null;

  return (
    <div className="overview">
      <h1>{project.name}</h1>
      <code className="path">{project.path}</code>
      <p>This is a cht-conf project. Pick a section to start editing.</p>
      <div className="overview-grid">
        <OverviewCard
          title="Hierarchy"
          desc="Contact types and place hierarchy."
          available={project.hasAppSettings}
          onClick={() => setView({ kind: 'hierarchy' })}
        />
        <OverviewCard
          title="Forms"
          desc="Edit or create app forms and contact forms."
          available={project.hasAppForms || project.hasContactForms}
          onClick={() => setView({ kind: 'forms-index' })}
        />
        <OverviewCard
          title="Tasks"
          desc="Edit task definitions and schedules."
          available={project.hasTasks}
          onClick={() => setView({ kind: 'tasks' })}
        />
        <OverviewCard
          title="Contact summary"
          desc="Edit the context flags forms depend on."
          available={project.hasContactSummary}
          onClick={() => setView({ kind: 'contact-summary' })}
        />
      </div>
    </div>
  );
}

function OverviewCard(props: {
  title: string;
  desc: string;
  available: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`overview-card ${props.available ? '' : 'disabled'}`}
      onClick={props.onClick}
      disabled={!props.available}
    >
      <strong>{props.title}</strong>
      <span>{props.desc}</span>
      {!props.available && <em>missing from this project</em>}
    </button>
  );
}
