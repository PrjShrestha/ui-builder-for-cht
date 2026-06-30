import { useEffect } from 'react';
import { isAnyDirty, useApp } from './state/store.js';
import { api } from './api.js';
import { Sidebar } from './ui/Sidebar.js';
import { ProjectPicker } from './ui/ProjectPicker.js';
import { ProjectOverview } from './ui/ProjectOverview.js';
import { FormsIndex } from './ui/FormsIndex.js';
import { FormEditor } from './ui/FormEditor.js';
import { HierarchyEditor } from './ui/HierarchyEditor.js';
import { TasksEditor } from './ui/TasksEditor.js';
import { ContactSummaryEditor } from './ui/ContactSummaryEditor.js';
import { FlowchartView } from './ui/FlowchartView.js';
import { DecisionsView } from './ui/DecisionsView.js';
import { DeployPanel } from './ui/DeployPanel.js';
import { StandardCodesView } from './ui/StandardCodesView.js';
import { ErrorBanner } from './ui/ErrorBanner.js';
import { ErrorBoundary } from './ui/ErrorBoundary.js';
import { UndoToastHost } from './ui/UndoToast.js';

export function App() {
  const project = useApp((s) => s.project);
  const view = useApp((s) => s.view);
  const setProject = useApp((s) => s.setProject);
  const setError = useApp((s) => s.setError);
  const dirty = useApp((s) => s.dirty);

  // Browser-level prompt when navigating away with unsaved edits. No content
  // is autosaved — losing the tab would otherwise silently throw away work.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!isAnyDirty(dirty)) return;
      e.preventDefault();
      // Most modern browsers ignore custom strings but still show a prompt.
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // On mount, see if the server already has a project open.
  useEffect(() => {
    let alive = true;
    api
      .getProject()
      .then((res) => {
        if (!alive) return;
        if (res.open && res.project) setProject(res.project);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [setProject, setError]);

  if (!project) {
    return (
      <div className="app">
        <ErrorBanner />
        <ProjectPicker />
        <UndoToastHost />
      </div>
    );
  }

  // Build a stable key per view so navigating to a different panel
  // auto-clears any captured error in the boundary. Includes formId
  // so flipping between two forms also resets.
  const viewKey =
    view.kind === 'form' || view.kind === 'flowchart' ? `${view.kind}:${view.id}` : view.kind;

  return (
    <div className="app">
      <ErrorBanner />
      <UndoToastHost />
      <Sidebar />
      <main className="main">
        {/* ErrorBoundary keeps the Sidebar usable when the active panel
            crashes (e.g. an unstable Zustand selector causing
            "Maximum update depth exceeded"). Without it a single
            render throw white-screens the whole app. */}
        <ErrorBoundary resetKey={viewKey}>
          {view.kind === 'project-overview' && <ProjectOverview />}
          {view.kind === 'forms-index' && <FormsIndex />}
          {view.kind === 'form' && <FormEditor formId={view.id} />}
          {view.kind === 'hierarchy' && <HierarchyEditor />}
          {view.kind === 'tasks' && <TasksEditor />}
          {view.kind === 'contact-summary' && <ContactSummaryEditor />}
          {view.kind === 'flowchart' && <FlowchartView formId={view.id} />}
          {view.kind === 'decisions' && <DecisionsView />}
          {view.kind === 'deploy' && <DeployPanel />}
          {view.kind === 'standard-codes' && <StandardCodesView />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
