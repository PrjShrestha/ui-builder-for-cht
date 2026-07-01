/**
 * Global app state. Tracks the currently open project, which view is
 * active, and a small in-memory cache of loaded resources (forms, hierarchy,
 * tasks, contact summary).
 *
 * State that is "saving" or "dirty" is also held here so that the chrome
 * (save button, dirty indicator) can render off a single source of truth.
 */
import { create } from 'zustand';

export type View =
  | { kind: 'no-project' }
  | { kind: 'project-overview' }
  | { kind: 'hierarchy' }
  | { kind: 'form'; id: string }
  | { kind: 'forms-index' }
  | { kind: 'tasks' }
  | { kind: 'contact-summary' }
  | { kind: 'flowchart'; id: string }
  | { kind: 'decisions' }
  | { kind: 'deploy' }
  | { kind: 'standard-codes' }
  | { kind: 'translations' };

export interface ProjectInfo {
  path: string;
  name: string;
  hasAppSettings: boolean;
  hasAppForms: boolean;
  hasContactForms: boolean;
  hasTasks: boolean;
  hasContactSummary: boolean;
  /**
   * Choice values indexed by surveyed field name, scanned from every
   * `forms/contact/*.xlsx` at project open. Lets the form condition builder
   * surface a values dropdown for `inputs/contact/<name>`-style calculates
   * whose underlying select_one lives in a different form. Read-only.
   */
  contactFieldChoices: Record<string, string[]>;
}

export interface FormListEntry {
  id: string;
  category: 'app' | 'contact';
  filename: string;
  hasProperties: boolean;
  hasXml: boolean;
}

interface AppState {
  project: ProjectInfo | null;
  view: View;
  forms: FormListEntry[];
  /** dirty[resourceKey] = true when there are unsaved edits. */
  dirty: Record<string, boolean>;
  /** saving[resourceKey] = true while a save request is in flight. */
  saving: Record<string, boolean>;
  /** Last error message, shown in the chrome. */
  lastError: string | null;

  setProject(p: ProjectInfo | null): void;
  setView(v: View): void;
  setForms(f: FormListEntry[]): void;
  setDirty(key: string, value: boolean): void;
  setSaving(key: string, value: boolean): void;
  setError(message: string | null): void;
}

export const useApp = create<AppState>((set) => ({
  project: null,
  view: { kind: 'no-project' },
  forms: [],
  dirty: {},
  saving: {},
  lastError: null,

  setProject: (p) => set({ project: p, view: p ? { kind: 'project-overview' } : { kind: 'no-project' } }),
  setView: (v) => set({ view: v }),
  setForms: (f) => set({ forms: f }),
  setDirty: (key, value) =>
    set((state) => ({ dirty: { ...state.dirty, [key]: value } })),
  setSaving: (key, value) =>
    set((state) => ({ saving: { ...state.saving, [key]: value } })),
  setError: (message) => set({ lastError: message }),
}));

export function isAnyDirty(state: Record<string, boolean>): boolean {
  return Object.values(state).some(Boolean);
}
